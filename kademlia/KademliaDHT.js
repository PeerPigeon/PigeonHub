/**
 * Standalone Kademlia DHT Implementation
 * 
 * A pure Kademlia Distributed Hash Table implementation for bootstrap node registration.
 * This is completely separate from PeerPigeon's WebDHT and uses standard Kademlia protocol.
 */

import crypto from 'crypto';
import dgram from 'dgram';
import { EventEmitter } from 'events';

// Kademlia constants
const K = 20;                    // Bucket size (k)
const ALPHA = 3;                 // Concurrency parameter
const ID_LENGTH = 160;           // Node ID length in bits
const KEY_LENGTH = 160;          // Key length in bits
const BUCKET_REFRESH_INTERVAL = 3600000;   // 1 hour
const KEY_REPUBLISH_INTERVAL = 86400000;   // 24 hours
const KEY_EXPIRE_TIME = 86400000;          // 24 hours
const NODE_TIMEOUT = 900000;               // 15 minutes

/**
 * Kademlia Contact/Node representation
 */
class KademliaContact {
  constructor(id, address, port) {
    this.id = id;                    // 160-bit node ID (hex string)
    this.address = address;          // IP address
    this.port = port;               // UDP port
    this.lastSeen = Date.now();     // Last contact timestamp
    this.rtt = null;                // Round-trip time
    this.failureCount = 0;          // Failed ping count
  }

  /**
   * Calculate XOR distance to another node ID
   */
  distanceTo(otherId) {
    const thisBuffer = Buffer.from(this.id, 'hex');
    const otherBuffer = Buffer.from(otherId, 'hex');
    
    let distance = BigInt(0);
    for (let i = 0; i < 20; i++) { // 160 bits = 20 bytes
      const xor = thisBuffer[i] ^ otherBuffer[i];
      distance = (distance << BigInt(8)) | BigInt(xor);
    }
    
    return distance;
  }

  /**
   * Check if contact is stale
   */
  isStale() {
    return Date.now() - this.lastSeen > NODE_TIMEOUT;
  }

  /**
   * Update last seen timestamp
   */
  touch() {
    this.lastSeen = Date.now();
    this.failureCount = 0;
  }

  /**
   * Record failure
   */
  recordFailure() {
    this.failureCount++;
  }

  /**
   * Check if contact should be evicted
   */
  shouldEvict() {
    return this.failureCount >= 5 || this.isStale();
  }
}

/**
 * K-Bucket for storing contacts
 */
class KBucket {
  constructor(rangeMin, rangeMax) {
    this.rangeMin = rangeMin;       // Minimum distance (inclusive)
    this.rangeMax = rangeMax;       // Maximum distance (exclusive)
    this.contacts = [];             // Array of KademliaContact
    this.lastChanged = Date.now();  // Last modification time
  }

  /**
   * Add contact to bucket
   */
  addContact(contact) {
    const existingIndex = this.contacts.findIndex(c => c.id === contact.id);
    
    if (existingIndex !== -1) {
      // Contact exists, move to tail (most recently seen)
      const existing = this.contacts.splice(existingIndex, 1)[0];
      existing.touch();
      this.contacts.push(existing);
      this.lastChanged = Date.now();
      return true;
    }

    if (this.contacts.length < K) {
      // Bucket has space
      this.contacts.push(contact);
      this.lastChanged = Date.now();
      return true;
    }

    // Bucket is full, check if we can evict the head
    const head = this.contacts[0];
    if (head.shouldEvict()) {
      this.contacts.shift();
      this.contacts.push(contact);
      this.lastChanged = Date.now();
      return true;
    }

    return false; // Bucket full, cannot add
  }

  /**
   * Remove contact from bucket
   */
  removeContact(contactId) {
    const index = this.contacts.findIndex(c => c.id === contactId);
    if (index !== -1) {
      this.contacts.splice(index, 1);
      this.lastChanged = Date.now();
      return true;
    }
    return false;
  }

  /**
   * Get closest contacts to target
   */
  getClosestContacts(targetId, count = K) {
    return this.contacts
      .map(contact => ({
        contact,
        distance: contact.distanceTo(targetId)
      }))
      .sort((a, b) => {
        if (a.distance < b.distance) return -1;
        if (a.distance > b.distance) return 1;
        return 0;
      })
      .slice(0, count)
      .map(item => item.contact);
  }

  /**
   * Check if bucket needs refresh
   */
  needsRefresh() {
    return Date.now() - this.lastChanged > BUCKET_REFRESH_INTERVAL;
  }

  /**
   * Get all contacts
   */
  getAllContacts() {
    return [...this.contacts];
  }

  /**
   * Get bucket size
   */
  size() {
    return this.contacts.length;
  }
}

/**
 * Kademlia DHT Value storage
 */
class KademliaValue {
  constructor(key, value, publisher, timestamp = Date.now()) {
    this.key = key;
    this.value = value;
    this.publisher = publisher;      // Node ID that published this value
    this.timestamp = timestamp;      // When it was stored
    this.republishTime = timestamp + KEY_REPUBLISH_INTERVAL;
    this.expireTime = timestamp + KEY_EXPIRE_TIME;
  }

  /**
   * Check if value has expired
   */
  isExpired() {
    return Date.now() > this.expireTime;
  }

  /**
   * Check if value needs republishing
   */
  needsRepublish() {
    return Date.now() > this.republishTime;
  }

  /**
   * Update republish time
   */
  updateRepublishTime() {
    this.republishTime = Date.now() + KEY_REPUBLISH_INTERVAL;
  }
}

/**
 * Main Kademlia DHT Node
 */
export class KademliaDHT extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.nodeId = options.nodeId || this.generateNodeId();
    this.port = options.port || 0; // 0 = random port
    this.address = options.address || '0.0.0.0';
    
    // Routing table - array of k-buckets
    this.routingTable = [];
    this.initializeRoutingTable();
    
    // Local data storage
    this.dataStore = new Map(); // key -> KademliaValue
    
    // Network
    this.socket = null;
    this.pendingRequests = new Map(); // requestId -> { resolve, reject, timeout }
    this.requestCounter = 0;
    
    // Maintenance timers
    this.bucketRefreshTimer = null;
    this.republishTimer = null;
    this.expireTimer = null;
    
    // Bootstrap nodes
    this.bootstrapNodes = options.bootstrapNodes || [];
    
    // State
    this.isRunning = false;
    
    console.log(`🔗 Kademlia DHT node created: ${this.nodeId.substring(0, 8)}...`);
  }

  /**
   * Generate random 160-bit node ID
   */
  generateNodeId() {
    return crypto.randomBytes(20).toString('hex');
  }

  /**
   * Initialize routing table with empty k-buckets
   */
  initializeRoutingTable() {
    for (let i = 0; i < ID_LENGTH; i++) {
      this.routingTable[i] = new KBucket(i, i + 1);
    }
  }

  /**
   * Calculate the bucket index for a given node ID
   */
  getBucketIndex(nodeId) {
    const distance = this.nodeDistance(this.nodeId, nodeId);
    
    // Find the position of the most significant bit
    let bucketIndex = 0;
    let temp = distance;
    
    while (temp > BigInt(0)) {
      bucketIndex++;
      temp = temp >> BigInt(1);
    }
    
    return Math.max(0, Math.min(bucketIndex - 1, ID_LENGTH - 1));
  }

  /**
   * Calculate XOR distance between two node IDs
   */
  nodeDistance(id1, id2) {
    const buffer1 = Buffer.from(id1, 'hex');
    const buffer2 = Buffer.from(id2, 'hex');
    
    let distance = BigInt(0);
    for (let i = 0; i < 20; i++) {
      const xor = buffer1[i] ^ buffer2[i];
      distance = (distance << BigInt(8)) | BigInt(xor);
    }
    
    return distance;
  }

  /**
   * Bind to port with automatic increment on conflict
   */
  async bindWithPortIncrement() {
    const originalPort = this.port;
    const maxAttempts = 100;
    let attempts = 0;
    
    console.log(`🔌 Attempting to bind to ${this.address}:${this.port}`);
    
    while (attempts < maxAttempts) {
      try {
        await new Promise((resolve, reject) => {
          const onError = (err) => {
            this.socket.removeListener('error', onError);
            reject(err);
          };
          
          this.socket.once('error', onError);
          
          this.socket.bind(this.port, this.address, (err) => {
            this.socket.removeListener('error', onError);
            if (err) {
              reject(err);
            } else {
              const address = this.socket.address();
              this.port = address.port;
              this.address = address.address;
              resolve();
            }
          });
        });
        
        // Success!
        if (this.port !== originalPort) {
          console.log(`⚡ Port ${originalPort} was in use, incremented to ${this.port}`);
        } else {
          console.log(`✅ Successfully bound to ${this.address}:${this.port}`);
        }
        return;
        
      } catch (err) {
        if (err.code === 'EADDRINUSE') {
          attempts++;
          const oldPort = this.port;
          this.port++;
          console.log(`🔄 Port ${oldPort} in use, trying ${this.port}`);
          
          // Close current socket and create new one
          if (this.socket) {
            this.socket.close();
          }
          this.socket = dgram.createSocket('udp4');
          this.socket.on('message', (msg, rinfo) => {
            this.handleMessage(msg, rinfo);
          });
          
          continue;
        } else {
          console.error(`❌ Binding failed:`, err);
          throw err;
        }
      }
    }
    
    throw new Error(`Failed to bind after trying ${maxAttempts} ports starting from ${originalPort}`);
  }

  /**
   * Start the Kademlia DHT node
   */
  async start() {
    if (this.isRunning) {
      throw new Error('Kademlia DHT is already running');
    }

    // Create UDP socket
    this.socket = dgram.createSocket('udp4');
    
    // Setup message handler
    this.socket.on('message', (msg, rinfo) => {
      this.handleMessage(msg, rinfo);
    });

    // Bind to port with auto-increment on conflict
    await this.bindWithPortIncrement();
    
    // Setup error handler AFTER binding succeeds
    this.socket.on('error', (err) => {
      console.error('❌ Kademlia socket error:', err);
      this.emit('error', err);
    });

    this.isRunning = true;
    
    // Start maintenance tasks
    this.startMaintenance();
    
    console.log(`🚀 Kademlia DHT started on ${this.address}:${this.port}`);
    
    // Bootstrap the network
    if (this.bootstrapNodes.length > 0) {
      await this.bootstrap();
    }
    
    this.emit('started');
  }

  /**
   * Stop the Kademlia DHT node
   */
  async stop() {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    
    // Stop maintenance
    this.stopMaintenance();
    
    // Close socket
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    
    // Clear pending requests
    for (const [requestId, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('DHT shutting down'));
    }
    this.pendingRequests.clear();
    
    console.log(`🛑 Kademlia DHT stopped`);
    this.emit('stopped');
  }

  /**
   * Bootstrap into the network
   */
  async bootstrap() {
    console.log(`🌐 Bootstrapping with ${this.bootstrapNodes.length} nodes...`);
    
    // Add bootstrap nodes to routing table
    for (const bootstrapNode of this.bootstrapNodes) {
      const contact = new KademliaContact(
        bootstrapNode.nodeId,
        bootstrapNode.address,
        bootstrapNode.port
      );
      this.addContact(contact);
    }
    
    // Perform node lookup for our own ID to populate routing table
    try {
      await this.findNode(this.nodeId);
      console.log('✅ Bootstrap completed successfully');
      this.emit('bootstrapped');
    } catch (error) {
      console.error('❌ Bootstrap failed:', error);
      this.emit('bootstrapFailed', error);
    }
  }

  /**
   * Store a key-value pair in the DHT
   */
  async store(key, value) {
    const keyHash = crypto.createHash('sha1').update(key).digest('hex');
    console.log(`💾 Storing key: ${key} -> ${keyHash.substring(0, 8)}...`);
    
    // Store locally
    const kademliaValue = new KademliaValue(key, value, this.nodeId);
    this.dataStore.set(keyHash, kademliaValue);
    
    // Find closest nodes to the key
    const closestNodes = await this.findNode(keyHash);
    
    // Store on closest nodes
    const storePromises = closestNodes.slice(0, K).map(contact => 
      this.sendStore(contact, keyHash, value)
    );
    
    const results = await Promise.allSettled(storePromises);
    const successful = results.filter(r => r.status === 'fulfilled').length;
    
    console.log(`📡 Stored on ${successful}/${storePromises.length} nodes`);
    this.emit('stored', { key, keyHash, successful, total: storePromises.length });
    
    return keyHash;
  }

  /**
   * Retrieve a value from the DHT
   */
  async get(key) {
    const keyHash = crypto.createHash('sha1').update(key).digest('hex');
    console.log(`🔍 Retrieving key: ${key} -> ${keyHash.substring(0, 8)}...`);
    
    // Check local storage first
    const localValue = this.dataStore.get(keyHash);
    if (localValue && !localValue.isExpired()) {
      console.log('📦 Found value locally');
      return localValue.value;
    }
    
    // Find closest nodes to the key
    const closestNodes = await this.findNode(keyHash);
    
    // Query closest nodes for the value
    for (const contact of closestNodes.slice(0, ALPHA)) {
      try {
        const value = await this.sendGet(contact, keyHash);
        if (value !== null) {
          console.log(`📦 Found value on node: ${contact.id.substring(0, 8)}...`);
          
          // Store locally for caching
          const kademliaValue = new KademliaValue(key, value, contact.id);
          this.dataStore.set(keyHash, kademliaValue);
          
          return value;
        }
      } catch (error) {
        console.error(`❌ Failed to get from ${contact.id.substring(0, 8)}...:`, error);
      }
    }
    
    console.log('❌ Value not found in DHT');
    return null;
  }

  /**
   * Find the closest nodes to a target ID
   */
  async findNode(targetId) {
    const contacted = new Set();
    const closest = new Map(); // nodeId -> contact
    
    // Start with closest known nodes
    const initialContacts = this.findClosestContacts(targetId, ALPHA);
    for (const contact of initialContacts) {
      closest.set(contact.id, contact);
    }
    
    let improved = true;
    
    while (improved && closest.size < K) {
      improved = false;
      
      // Get ALPHA closest uncontacted nodes
      const toContact = Array.from(closest.values())
        .filter(contact => !contacted.has(contact.id))
        .slice(0, ALPHA);
      
      if (toContact.length === 0) {
        break;
      }
      
      // Query them in parallel
      const promises = toContact.map(contact => {
        contacted.add(contact.id);
        return this.sendFindNode(contact, targetId);
      });
      
      const results = await Promise.allSettled(promises);
      
      // Process results
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const contact = toContact[i];
        
        if (result.status === 'fulfilled') {
          // Update contact as responsive
          contact.touch();
          this.addContact(contact);
          
          // Add returned nodes to closest set
          for (const returnedContact of result.value) {
            if (!closest.has(returnedContact.id) && returnedContact.id !== this.nodeId) {
              closest.set(returnedContact.id, returnedContact);
              improved = true;
            }
          }
        } else {
          // Mark contact as failed
          contact.recordFailure();
        }
      }
      
      // Keep only the K closest
      if (closest.size > K) {
        const sortedContacts = Array.from(closest.values())
          .map(contact => ({
            contact,
            distance: contact.distanceTo(targetId)
          }))
          .sort((a, b) => {
            if (a.distance < b.distance) return -1;
            if (a.distance > b.distance) return 1;
            return 0;
          })
          .slice(0, K);
        
        closest.clear();
        for (const item of sortedContacts) {
          closest.set(item.contact.id, item.contact);
        }
      }
    }
    
    return Array.from(closest.values());
  }

  /**
   * Register as a bootstrap node
   */
  async registerBootstrapNode(metadata = {}) {
    const registrationKey = `bootstrap:${this.nodeId}`;
    const registrationData = {
      nodeId: this.nodeId,
      address: this.address,
      port: this.port,
      timestamp: Date.now(),
      metadata: {
        capabilities: ['bootstrap', 'dht'],
        version: '1.0.0',
        ...metadata
      }
    };
    
    const keyHash = await this.store(registrationKey, registrationData);
    
    console.log(`🚀 Registered as bootstrap node: ${this.nodeId.substring(0, 8)}...`);
    this.emit('bootstrapRegistered', registrationData);
    
    return { keyHash, registrationData };
  }

  /**
   * Discover bootstrap nodes
   */
  async discoverBootstrapNodes() {
    const discoveredNodes = [];
    
    // Search for bootstrap registrations in local storage
    for (const [keyHash, value] of this.dataStore.entries()) {
      if (value.key.startsWith('bootstrap:') && !value.isExpired()) {
        discoveredNodes.push(value.value);
      }
    }
    
    console.log(`🔍 Discovered ${discoveredNodes.length} bootstrap nodes locally`);
    
    // TODO: Could also search the network for bootstrap: prefixed keys
    // This would require implementing a key prefix search mechanism
    
    this.emit('bootstrapNodesDiscovered', discoveredNodes);
    return discoveredNodes;
  }

  /**
   * Find closest contacts in routing table
   */
  findClosestContacts(targetId, count = K) {
    const allContacts = [];
    
    // Collect all contacts from all buckets
    for (const bucket of this.routingTable) {
      allContacts.push(...bucket.getAllContacts());
    }
    
    // Sort by distance to target
    return allContacts
      .map(contact => ({
        contact,
        distance: contact.distanceTo(targetId)
      }))
      .sort((a, b) => {
        if (a.distance < b.distance) return -1;
        if (a.distance > b.distance) return 1;
        return 0;
      })
      .slice(0, count)
      .map(item => item.contact);
  }

  /**
   * Add contact to routing table
   */
  addContact(contact) {
    if (contact.id === this.nodeId) {
      return false; // Don't add ourselves
    }

    const bucketIndex = this.getBucketIndex(contact.id);
    const bucket = this.routingTable[bucketIndex];
    
    const added = bucket.addContact(contact);
    if (added) {
      console.log(`➕ Added contact to bucket ${bucketIndex}: ${contact.id.substring(0, 8)}...`);
      this.emit('contactAdded', contact);
    }
    
    return added;
  }

  /**
   * Remove contact from routing table
   */
  removeContact(contactId) {
    const bucketIndex = this.getBucketIndex(contactId);
    const bucket = this.routingTable[bucketIndex];
    
    const removed = bucket.removeContact(contactId);
    if (removed) {
      console.log(`➖ Removed contact from bucket ${bucketIndex}: ${contactId.substring(0, 8)}...`);
      this.emit('contactRemoved', contactId);
    }
    
    return removed;
  }

  /**
   * Handle incoming UDP messages
   */
  handleMessage(buffer, rinfo) {
    try {
      const message = JSON.parse(buffer.toString());
      
      // Update contact info for sender
      if (message.senderId && message.senderId !== this.nodeId) {
        const contact = new KademliaContact(message.senderId, rinfo.address, rinfo.port);
        this.addContact(contact);
      }
      
      if (message.type === 'response' && message.requestId) {
        // Handle response to our request
        this.handleResponse(message);
      } else {
        // Handle incoming request
        this.handleRequest(message, rinfo);
      }
      
    } catch (error) {
      console.error('❌ Error parsing message:', error);
    }
  }

  /**
   * Handle incoming requests
   */
  async handleRequest(message, rinfo) {
    const response = {
      type: 'response',
      requestId: message.requestId,
      senderId: this.nodeId
    };

    try {
      switch (message.method) {
        case 'ping':
          response.result = { pong: true };
          break;

        case 'find_node':
          const targetId = message.params.targetId;
          const closestContacts = this.findClosestContacts(targetId, K);
          response.result = {
            contacts: closestContacts.map(c => ({
              id: c.id,
              address: c.address,
              port: c.port
            }))
          };
          break;

        case 'store':
          const { key, value } = message.params;
          const kademliaValue = new KademliaValue(key, value, message.senderId);
          this.dataStore.set(key, kademliaValue);
          response.result = { stored: true };
          console.log(`📥 Stored key from ${message.senderId.substring(0, 8)}...: ${key.substring(0, 8)}...`);
          break;

        case 'get':
          const requestedKey = message.params.key;
          const storedValue = this.dataStore.get(requestedKey);
          if (storedValue && !storedValue.isExpired()) {
            response.result = { value: storedValue.value };
          } else {
            response.result = { value: null };
          }
          break;

        default:
          response.error = { message: `Unknown method: ${message.method}` };
      }
    } catch (error) {
      response.error = { message: error.message };
    }

    // Send response
    const responseBuffer = Buffer.from(JSON.stringify(response));
    this.socket.send(responseBuffer, rinfo.port, rinfo.address);
  }

  /**
   * Handle responses to our requests
   */
  handleResponse(message) {
    const pending = this.pendingRequests.get(message.requestId);
    if (!pending) {
      return; // Unknown request ID
    }

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(message.requestId);

    if (message.error) {
      pending.reject(new Error(message.error.message));
    } else {
      // Return full response if requested, otherwise just the result
      pending.resolve(pending.returnFullResponse ? message : message.result);
    }
  }

  /**
   * Send a request and wait for response
   */
  sendRequest(contact, method, params, timeoutMs = 5000, returnFullResponse = false) {
    return new Promise((resolve, reject) => {
      const requestId = `req_${++this.requestCounter}_${Date.now()}`;
      
      const message = {
        type: 'request',
        requestId,
        method,
        params,
        senderId: this.nodeId
      };

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Request timeout'));
      }, timeoutMs);

      this.pendingRequests.set(requestId, { resolve, reject, timeout, returnFullResponse });

      const buffer = Buffer.from(JSON.stringify(message));
      this.socket.send(buffer, contact.port, contact.address, (err) => {
        if (err) {
          clearTimeout(timeout);
          this.pendingRequests.delete(requestId);
          reject(err);
        }
      });
    });
  }

  /**
   * Send PING request
   */
  async sendPing(contact) {
    const startTime = Date.now();
    await this.sendRequest(contact, 'ping', {});
    const rtt = Date.now() - startTime;
    contact.rtt = rtt;
    contact.touch();
    return rtt;
  }

  /**
   * Discover a node by pinging an address without knowing the nodeId first
   */
  async discoverNodeByAddress(address, port) {
    console.log(`🔍 Discovering node at ${address}:${port}...`);
    
    // Create a temporary contact with a placeholder nodeId
    const tempContact = new KademliaContact('00'.repeat(20), address, port);
    
    try {
      // Send ping request and capture the response
      const response = await this.sendRequest(tempContact, 'ping', {}, 5000, true); // true = return full response
      
      if (response && response.senderId) {
        console.log(`✅ Discovered node: ${response.senderId.substring(0, 8)}... at ${address}:${port}`);
        
        // Create a proper contact with the discovered nodeId
        const realContact = new KademliaContact(response.senderId, address, port);
        realContact.touch();
        
        // Add to routing table using DHT's method
        this.addContact(realContact);
        
        // Return the contact we created (not the result of addContact)
        return realContact;
      } else {
        throw new Error('No nodeId in ping response');
      }
    } catch (error) {
      console.log(`❌ Failed to discover node at ${address}:${port}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Send FIND_NODE request
   */
  async sendFindNode(contact, targetId) {
    const result = await this.sendRequest(contact, 'find_node', { targetId });
    
    // Convert response to KademliaContact objects
    return result.contacts.map(c => new KademliaContact(c.id, c.address, c.port));
  }

  /**
   * Send STORE request
   */
  async sendStore(contact, key, value) {
    return await this.sendRequest(contact, 'store', { key, value });
  }

  /**
   * Send GET request
   */
  async sendGet(contact, key) {
    const result = await this.sendRequest(contact, 'get', { key });
    return result.value;
  }

  /**
   * Start maintenance tasks
   */
  startMaintenance() {
    // Bucket refresh - periodically refresh stale buckets
    this.bucketRefreshTimer = setInterval(() => {
      this.refreshBuckets();
    }, BUCKET_REFRESH_INTERVAL);

    // Key republishing - republish keys we're responsible for
    this.republishTimer = setInterval(() => {
      this.republishKeys();
    }, KEY_REPUBLISH_INTERVAL);

    // Expire old keys
    this.expireTimer = setInterval(() => {
      this.expireKeys();
    }, KEY_EXPIRE_TIME / 10); // Check every 2.4 hours

    console.log('🔧 Started Kademlia maintenance tasks');
  }

  /**
   * Stop maintenance tasks
   */
  stopMaintenance() {
    if (this.bucketRefreshTimer) {
      clearInterval(this.bucketRefreshTimer);
      this.bucketRefreshTimer = null;
    }

    if (this.republishTimer) {
      clearInterval(this.republishTimer);
      this.republishTimer = null;
    }

    if (this.expireTimer) {
      clearInterval(this.expireTimer);
      this.expireTimer = null;
    }

    console.log('🛑 Stopped Kademlia maintenance tasks');
  }

  /**
   * Refresh stale buckets
   */
  async refreshBuckets() {
    for (let i = 0; i < this.routingTable.length; i++) {
      const bucket = this.routingTable[i];
      
      if (bucket.needsRefresh() && bucket.size() > 0) {
        // Generate a random ID in this bucket's range and do a lookup
        const randomId = this.generateRandomIdForBucket(i);
        try {
          await this.findNode(randomId);
          console.log(`🔄 Refreshed bucket ${i}`);
        } catch (error) {
          console.error(`❌ Failed to refresh bucket ${i}:`, error);
        }
      }
    }
  }

  /**
   * Republish keys that need republishing
   */
  async republishKeys() {
    const keysToRepublish = [];
    
    for (const [keyHash, value] of this.dataStore.entries()) {
      if (value.needsRepublish() && !value.isExpired()) {
        keysToRepublish.push({ keyHash, value });
      }
    }

    for (const { keyHash, value } of keysToRepublish) {
      try {
        // Find closest nodes to the key
        const closestNodes = await this.findNode(keyHash);
        
        // Republish to closest nodes
        const promises = closestNodes.slice(0, K).map(contact =>
          this.sendStore(contact, keyHash, value.value)
        );
        
        await Promise.allSettled(promises);
        value.updateRepublishTime();
        
        console.log(`🔄 Republished key: ${value.key}`);
      } catch (error) {
        console.error(`❌ Failed to republish key ${value.key}:`, error);
      }
    }
  }

  /**
   * Remove expired keys
   */
  expireKeys() {
    const expiredKeys = [];
    
    for (const [keyHash, value] of this.dataStore.entries()) {
      if (value.isExpired()) {
        expiredKeys.push(keyHash);
      }
    }

    for (const keyHash of expiredKeys) {
      const value = this.dataStore.get(keyHash);
      this.dataStore.delete(keyHash);
      console.log(`🗑️  Expired key: ${value.key}`);
      this.emit('keyExpired', { key: value.key, keyHash });
    }
  }

  /**
   * Generate random ID for bucket refresh
   */
  generateRandomIdForBucket(bucketIndex) {
    // Generate a random ID that falls within the bucket's range
    const nodeIdBuffer = Buffer.from(this.nodeId, 'hex');
    const randomBuffer = crypto.randomBytes(20);
    
    // Flip the bit at position bucketIndex to ensure it's in the right bucket
    const byteIndex = Math.floor(bucketIndex / 8);
    const bitIndex = bucketIndex % 8;
    
    if (byteIndex < 20) {
      // Copy our node ID and flip the appropriate bit
      for (let i = 0; i < 20; i++) {
        randomBuffer[i] = nodeIdBuffer[i];
      }
      
      // Flip the bit to put it in the target bucket
      randomBuffer[byteIndex] ^= (1 << (7 - bitIndex));
      
      // Randomize the remaining bits
      for (let i = byteIndex; i < 20; i++) {
        if (i === byteIndex) {
          // Only randomize the lower bits
          const mask = (1 << (7 - bitIndex)) - 1;
          randomBuffer[i] = (randomBuffer[i] & ~mask) | (crypto.randomBytes(1)[0] & mask);
        } else {
          randomBuffer[i] = crypto.randomBytes(1)[0];
        }
      }
    }
    
    return randomBuffer.toString('hex');
  }

  /**
   * Get DHT statistics
   */
  getStats() {
    const totalContacts = this.routingTable.reduce((sum, bucket) => sum + bucket.size(), 0);
    const activeBuckets = this.routingTable.filter(bucket => bucket.size() > 0).length;
    const storedKeys = this.dataStore.size;
    
    return {
      nodeId: this.nodeId,
      address: this.address,
      port: this.port,
      isRunning: this.isRunning,
      totalContacts,
      activeBuckets,
      storedKeys,
      buckets: this.routingTable.map((bucket, index) => ({
        index,
        size: bucket.size(),
        lastChanged: bucket.lastChanged,
        needsRefresh: bucket.needsRefresh()
      }))
    };
  }

  /**
   * Get detailed network information
   */
  getNetworkInfo() {
    const stats = this.getStats();
    const contacts = [];
    
    for (const bucket of this.routingTable) {
      for (const contact of bucket.getAllContacts()) {
        contacts.push({
          id: contact.id,
          address: contact.address,
          port: contact.port,
          lastSeen: contact.lastSeen,
          rtt: contact.rtt,
          failureCount: contact.failureCount,
          isStale: contact.isStale()
        });
      }
    }
    
    const keys = Array.from(this.dataStore.entries()).map(([keyHash, value]) => ({
      keyHash,
      key: value.key,
      publisher: value.publisher,
      timestamp: value.timestamp,
      isExpired: value.isExpired(),
      needsRepublish: value.needsRepublish()
    }));
    
    return {
      ...stats,
      contacts,
      keys
    };
  }

  /**
   * Manually add bootstrap nodes
   */
  addBootstrapNodes(nodes) {
    this.bootstrapNodes.push(...nodes);
    
    if (this.isRunning) {
      // Add them to routing table immediately
      for (const node of nodes) {
        const contact = new KademliaContact(node.nodeId, node.address, node.port);
        this.addContact(contact);
      }
    }
  }

  /**
   * Ping all contacts to check liveness
   */
  async pingAllContacts() {
    const allContacts = [];
    for (const bucket of this.routingTable) {
      allContacts.push(...bucket.getAllContacts());
    }

    const pingPromises = allContacts.map(async (contact) => {
      try {
        const rtt = await this.sendPing(contact);
        return { contact, success: true, rtt };
      } catch (error) {
        contact.recordFailure();
        return { contact, success: false, error: error.message };
      }
    });

    const results = await Promise.allSettled(pingPromises);
    const successCount = results.filter(r => 
      r.status === 'fulfilled' && r.value.success
    ).length;

    console.log(`📡 Pinged ${allContacts.length} contacts, ${successCount} responded`);
    return results;
  }

  // ... (continuing with protocol methods in next part)
}
