/**
 * @fileoverview Node.js example - Find signaling endpoints
 */

import { bootstrapPeerPigeon, SignalDirectory } from '../src/index.js';

async function main() {
  try {
    console.log('Starting PeerSignalDir find example...');
    
    // Bootstrap PeerPigeon with local server
    console.log('Bootstrapping PeerPigeon mesh...');
    const { mesh, dht } = await bootstrapPeerPigeon({
      appId: 'example-app',
      hardcodedSeeds: [
        { t: 'ws', u: 'ws://127.0.0.1:3000' }
      ]
    });
    
    console.log('Mesh initialized, WebDHT ready');
    
    // Create SignalDirectory and find endpoints
    console.log('Creating SignalDirectory...');
    const dir = new SignalDirectory(dht);
    
    console.log('Searching for signaling endpoints...');
    const records = await dir.find('example-app', 'us-central');
    
    if (records.length === 0) {
      console.log('No signaling endpoints found');
      console.log('Make sure to run node-publish.mjs first to publish some endpoints');
    } else {
      console.log(`Found ${records.length} signaling endpoint(s):`);
      
      records.forEach((record, index) => {
        console.log(`\nEndpoint ${index + 1}:`);
        console.log({
          id: Array.from(record.id, b => b.toString(16).padStart(2, '0')).join(''),
          sequence: record.seq.toString(),
          timestamp: new Date(record.ts).toISOString(),
          timeToLive: record.ttl + ' seconds',
          urls: record.urls,
          capabilities: record.caps || 'none',
          expiresAt: new Date(record.ts + record.ttl * 1000).toISOString()
        });
      });
      
      // Show available URLs in a more usable format
      console.log('\nSignaling URLs found:');
      records.forEach((record, recordIndex) => {
        record.urls.forEach((url, urlIndex) => {
          console.log(`  ${recordIndex + 1}.${urlIndex + 1}: ${url.t.toUpperCase()} - ${url.u}`);
        });
      });
    }
    
    // Try finding in a different region
    console.log('\nSearching for endpoints in all regions...');
    const globalRecords = await dir.find('example-app'); // No region specified
    
    if (globalRecords.length > records.length) {
      console.log(`Found ${globalRecords.length - records.length} additional endpoint(s) in other regions`);
    }
    
    setTimeout(() => {
      console.log('\nFind example completed successfully!');
      process.exit(0);
    }, 1000);
    
  } catch (error) {
    console.error('Find example failed:', error);
    process.exit(1);
  }
}

// Handle uncaught errors gracefully
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception in find example:', error);
  process.exit(1);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection in find example:', error);
  process.exit(1);
});

main();
