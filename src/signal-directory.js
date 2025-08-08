/**
 * @fileoverview Signal directory for publishing and finding signaling endpoints
 */

import * as crypto from './util/crypto.js';
import { canonicalEncode, concatBytes, bufEq } from './util/encoding.js';

/**
 * SignalDirectory manages publishing and discovery of signaling endpoints
 */
export class SignalDirectory {
  /**
   * Create a new SignalDirectory
   * @param {object} dht - DHT adapter instance
   * @param {object} [cryptoAdapter] - Custom crypto adapter (uses default if not provided)
   */
  constructor(dht, cryptoAdapter = crypto) {
    this.dht = dht;
    this.crypto = cryptoAdapter;
  }

  /**
   * Generate topic key for app and optional region
   * @param {string} appId - Application identifier
   * @param {string} [region] - Optional region identifier
   * @returns {Promise<Uint8Array>} Topic key bytes
   */
  async topicKey(appId, region) {
    const topicString = region ? 
      `signal:${appId}:region:${region}` : 
      `signal:${appId}`;
    
    const topicBytes = new TextEncoder().encode(topicString);
    return await this.crypto.sha1(topicBytes);
  }

  /**
   * Publish a signaling record to the DHT
   * @param {object} options - Publishing options
   * @param {string} options.appId - Application identifier
   * @param {string} [options.region] - Optional region identifier
   * @param {Uint8Array} options.publicKey - Ed25519 public key (32 bytes)
   * @param {CryptoKey} options.privateKey - Ed25519 private key for signing
   * @param {Array<{t: 'ws'|'http', u: string}>} options.urls - Signaling endpoint URLs
   * @param {string[]} [options.caps] - Optional capability tags
   * @param {number} [options.ttlSec=600] - Time-to-live in seconds
   * @param {bigint} [options.seq] - Sequence number (defaults to current timestamp)
   * @param {number} [options.extraShards=4] - Number of additional storage shards
   * @returns {Promise<object>} Published SignalRecord
   */
  async publish({
    appId,
    region,
    publicKey,
    privateKey,
    urls,
    caps,
    ttlSec = 600,
    seq,
    extraShards = 4
  }) {
    // Validate inputs
    if (!appId || typeof appId !== 'string') {
      throw new Error('appId must be a non-empty string');
    }
    
    if (!(publicKey instanceof Uint8Array) || publicKey.length !== 32) {
      throw new Error('publicKey must be a 32-byte Uint8Array');
    }
    
    if (!Array.isArray(urls) || urls.length === 0) {
      throw new Error('urls must be a non-empty array');
    }
    
    for (const url of urls) {
      if (!url.t || !url.u || typeof url.t !== 'string' || typeof url.u !== 'string') {
        throw new Error('Each URL must have t (type) and u (URL) string properties');
      }
      if (!['ws', 'http'].includes(url.t)) {
        throw new Error('URL type must be "ws" or "http"');
      }
    }

    // Generate topic and record ID
    const topic = await this.topicKey(appId, region);
    const id = await this.crypto.sha1(publicKey);
    
    // Get crypto for random values
    const crypto = globalThis.crypto || (await import('crypto')).webcrypto;
    
    // Create record structure (without signature)
    const now = Date.now();
    const record = {
      v: 1,
      kind: 'signal',
      topic,
      id,
      seq: seq || BigInt(now),
      ts: now,
      ttl: ttlSec,
      urls: [...urls], // Copy array
      salt: crypto.getRandomValues(new Uint8Array(16)),
      pk: publicKey
    };
    
    // Add optional fields
    if (caps && Array.isArray(caps)) {
      record.caps = [...caps];
    }

    // Create canonical encoding for signing
    const recordForSigning = { ...record };
    const messageString = canonicalEncode(recordForSigning);
    const messageBytes = new TextEncoder().encode(messageString);
    
    // Sign the record
    const signature = await this.crypto.signEd25519(messageBytes, privateKey);
    record.sig = signature;

    // Encode record for storage
    const recordBytes = await this.crypto.cborEncode(record);
    
    // Store at primary topic key
    await this.dht.put(topic, recordBytes);
    console.log(`Published signal record to primary topic (${topic.length} bytes)`);
    
    // Store at additional random shards for redundancy
    for (let i = 0; i < extraShards; i++) {
      const randomSalt = crypto.getRandomValues(new Uint8Array(8));
      const shardKey = await this.crypto.sha1(concatBytes(topic, randomSalt));
      
      try {
        await this.dht.put(shardKey, recordBytes);
        console.log(`Published to shard ${i + 1}/${extraShards}`);
      } catch (error) {
        console.warn(`Failed to publish to shard ${i + 1}:`, error.message);
      }
    }
    
    return record;
  }

  /**
   * Find signaling records for an application
   * @param {string} appId - Application identifier
   * @param {string} [region] - Optional region identifier
   * @param {number} [limit=32] - Maximum number of records to return
   * @returns {Promise<Array<object>>} Array of valid SignalRecords
   */
  async find(appId, region, limit = 32) {
    if (!appId || typeof appId !== 'string') {
      throw new Error('appId must be a non-empty string');
    }

    console.log(`Finding signaling endpoints for app: ${appId}${region ? `, region: ${region}` : ''}`);

    const topic = await this.topicKey(appId, region);
    const allRecords = new Map(); // Use Map to dedupe by record ID
    
    // Discovery strategy: probe primary topic + deterministic ring keys
    const discoveryKeys = [topic]; // Start with primary topic
    
    // Add 8 deterministic ring keys for discovery
    for (let i = 0; i < 8; i++) {
      const ringKeySeed = new TextEncoder().encode(`s${i}`);
      const ringKey = await this.crypto.sha1(concatBytes(topic, ringKeySeed));
      discoveryKeys.push(ringKey);
    }
    
    // Fetch from all discovery keys
    for (const key of discoveryKeys) {
      try {
        const values = await this.dht.get(key);
        
        for (const valueBytes of values) {
          try {
            const record = await this.crypto.cborDecode(valueBytes);
            const validRecord = await this.validateRecord(record, appId, region);
            
            if (validRecord) {
              const recordId = Array.from(validRecord.id).join(','); // Convert to string key
              const existing = allRecords.get(recordId);
              
              // Keep highest sequence number for each ID
              if (!existing || validRecord.seq > existing.seq) {
                allRecords.set(recordId, validRecord);
              }
            }
          } catch (error) {
            console.warn('Failed to decode/validate DHT record:', error.message);
          }
        }
      } catch (error) {
        console.warn(`Failed to fetch from discovery key:`, error.message);
      }
    }
    
    // Convert to array and sort by sequence number (newest first)
    const records = Array.from(allRecords.values())
      .sort((a, b) => b.seq > a.seq ? 1 : -1)
      .slice(0, limit);
    
    console.log(`Found ${records.length} valid signaling records`);
    return records;
  }

  /**
   * Validate a signaling record
   * @param {object} record - Record to validate
   * @param {string} expectedAppId - Expected application ID
   * @param {string} [expectedRegion] - Expected region
   * @returns {Promise<object|null>} Valid record or null if invalid
   */
  async validateRecord(record, expectedAppId, expectedRegion) {
    try {
      // Basic structure validation
      if (record.v !== 1 || record.kind !== 'signal') {
        return null;
      }
      
      if (!(record.topic instanceof Uint8Array) || 
          !(record.id instanceof Uint8Array) ||
          !(record.pk instanceof Uint8Array) ||
          !(record.sig instanceof Uint8Array)) {
        return null;
      }
      
      if (record.pk.length !== 32 || record.sig.length !== 64) {
        return null;
      }
      
      if (!Array.isArray(record.urls) || record.urls.length === 0) {
        return null;
      }
      
      // Verify topic matches expected app/region
      const expectedTopic = await this.topicKey(expectedAppId, expectedRegion);
      if (!bufEq(record.topic, expectedTopic)) {
        return null;
      }
      
      // Verify ID matches public key hash
      const expectedId = await this.crypto.sha1(record.pk);
      if (!bufEq(record.id, expectedId)) {
        return null;
      }
      
      // Check TTL (not expired)
      const now = Date.now();
      const expiryTime = record.ts + (record.ttl * 1000);
      if (now > expiryTime) {
        console.log('Record expired, skipping');
        return null;
      }
      
      // Verify signature
      const recordForSigning = { ...record };
      delete recordForSigning.sig;
      
      const messageString = canonicalEncode(recordForSigning);
      const messageBytes = new TextEncoder().encode(messageString);
      
      const isValid = await this.crypto.verifyEd25519(messageBytes, record.sig, record.pk);
      if (!isValid) {
        console.warn('Record signature verification failed');
        return null;
      }
      
      return record;
    } catch (error) {
      console.warn('Record validation error:', error.message);
      return null;
    }
  }
}
