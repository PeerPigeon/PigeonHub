#!/usr/bin/env node

/**
 * Start a PeerPigeon Hub
 * 
 * Usage:
 *   npm run hub
 *   PORT=3001 npm run hub
 *   PORT=8080 npm run hub
 *   BOOTSTRAP_HUBS=ws://localhost:3000 PORT=3001 npm run hub
 *   BOOTSTRAP_HUBS=ws://hub1:3000,ws://hub2:3001 PORT=3002 npm run hub
 */

import { PeerPigeonServer } from 'peerpigeon';

// Get port from environment variable or use default
const PORT = parseInt(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Get bootstrap hubs from environment variable
let bootstrapHubs = ['wss://pigeonhub.fly.dev/'];
if (process.env.BOOTSTRAP_HUBS) {
    bootstrapHubs = process.env.BOOTSTRAP_HUBS.split(',').map(uri => uri.trim()).filter(uri => uri);
    console.log(`🔗 Bootstrap hubs configured: ${bootstrapHubs.join(', ')}\n`);
}

console.log('🚀 Starting PeerPigeon Hub...\n');

// Create hub server
const hub = new PeerPigeonServer({
    port: PORT,
    host: HOST,
    isHub: true,
    autoConnect: true, // Auto-connect to bootstrap on port 3000
    bootstrapHubs: bootstrapHubs.length > 0 ? bootstrapHubs : undefined
});

// Event listeners
hub.on('started', ({ host, port }) => {
    console.log(`✅ Hub running on ws://${host}:${port}`);
    console.log(`   Health: http://${host}:${port}/health`);
    console.log(`   Hubs:   http://${host}:${port}/hubs\n`);
});

hub.on('peerConnected', ({ peerId, totalConnections }) => {
    console.log(`✅ Peer: ${peerId.substring(0, 8)}... (${totalConnections} total)`);
});

hub.on('peerDisconnected', ({ peerId, totalConnections }) => {
    console.log(`❌ Peer: ${peerId.substring(0, 8)}... (${totalConnections} remaining)`);
});

hub.on('hubRegistered', ({ peerId, totalHubs }) => {
    console.log(`🏢 Hub: ${peerId.substring(0, 8)}... (${totalHubs} total)`);
});

hub.on('bootstrapConnected', ({ uri }) => {
    console.log(`🔗 Connected to bootstrap: ${uri}`);
});

hub.on('hubDiscovered', ({ peerId }) => {
    console.log(`🔍 Discovered hub: ${peerId.substring(0, 8)}...`);
});

hub.on('error', (error) => {
    console.error('❌ Error:', error.message);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down...');
    await hub.stop();
    console.log('✅ Stopped');
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Shutting down...');
    await hub.stop();
    process.exit(0);
});

// Start the hub
hub.start().catch(error => {
    console.error('❌ Failed to start:', error.message);
    process.exit(1);
});
