/**
 * @fileoverview Node.js example - Publish signaling endpoints
 */

import { bootstrapPeerPigeon, SignalDirectory, exportRawPublicKey } from '../src/index.js';

async function main() {
  try {
    console.log('Starting PeerSignalDir publish example...');
    
    // Bootstrap PeerPigeon with local server
    console.log('Bootstrapping PeerPigeon mesh...');
    const { mesh, dht } = await bootstrapPeerPigeon({
      appId: 'example-app',
      hardcodedSeeds: [
        { t: 'ws', u: 'ws://127.0.0.1:3000' }
      ]
    });
    
    console.log('Mesh initialized, WebDHT ready');
    
    // Generate Ed25519 keypair
    console.log('Generating Ed25519 keypair...');
    const subtle = globalThis.crypto?.subtle || (await import('crypto')).webcrypto.subtle;
    const keypair = await subtle.generateKey(
      { name: 'Ed25519' },
      true,
      ['sign', 'verify']
    );
    
    const publicKeyRaw = await exportRawPublicKey(keypair.publicKey);
    console.log('Keypair generated, public key:', 
      Array.from(publicKeyRaw, b => b.toString(16).padStart(2, '0')).join(''));
    
    // Create SignalDirectory and publish endpoints
    console.log('Creating SignalDirectory...');
    const dir = new SignalDirectory(dht);
    
    console.log('Publishing signaling endpoints...');
    const record = await dir.publish({
      appId: 'example-app',
      region: 'us-central',
      publicKey: publicKeyRaw,
      privateKey: keypair.privateKey,
      urls: [
        { t: 'ws', u: 'wss://signal-a.example.com/ws' },
        { t: 'http', u: 'https://signal-b.example.com/sdp' }
      ],
      caps: ['ice-restart', 'bundle-policy'],
      ttlSec: 600
    });
    
    console.log('Successfully published signaling record!');
    console.log('Record details:');
    console.log({
      id: Array.from(record.id, b => b.toString(16).padStart(2, '0')).join(''),
      seq: record.seq.toString(),
      timestamp: new Date(record.ts).toISOString(),
      ttl: record.ttl,
      urls: record.urls,
      capabilities: record.caps
    });
    
    console.log('Waiting for DHT propagation...');
    
    // Wait a bit for propagation, then exit
    setTimeout(() => {
      console.log('Publish example completed successfully!');
      console.log('You can now run node-find.mjs to discover this endpoint');
      process.exit(0);
    }, 5000);
    
  } catch (error) {
    console.error('Publish example failed:', error);
    process.exit(1);
  }
}

// Handle uncaught errors gracefully
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception in publish example:', error);
  process.exit(1);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection in publish example:', error);
  process.exit(1);
});

main();
