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
let bootstrapHubs = ['wss://pigeonhub.fly.dev/','wss://pigeonhub-c.fly.dev/'];
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

// Set max listeners to prevent memory leak warnings
hub.setMaxListeners(20);

// Event listener functions (stored for cleanup)
const onStarted = ({ host, port }) => {
    console.log(`✅ Hub running on ws://${host}:${port}`);
    console.log(`   Health: http://${host}:${port}/health`);
    console.log(`   Hubs:   http://${host}:${port}/hubs\n`);
};

const onPeerConnected = ({ peerId, totalConnections }) => {
    console.log(`✅ Peer: ${peerId.substring(0, 8)}... (${totalConnections} total)`);
};

const onPeerDisconnected = ({ peerId, totalConnections }) => {
    console.log(`❌ Peer: ${peerId.substring(0, 8)}... (${totalConnections} remaining)`);
};

const onHubRegistered = ({ peerId, totalHubs }) => {
    console.log(`🏢 Hub: ${peerId.substring(0, 8)}... (${totalHubs} total)`);
};

const onBootstrapConnected = ({ uri }) => {
    console.log(`🔗 Connected to bootstrap: ${uri}`);
};

const onHubDiscovered = ({ peerId }) => {
    console.log(`🔍 Discovered hub: ${peerId.substring(0, 8)}...`);
};

const onError = (error) => {
    console.error('❌ Error:', error.message);
};

// Register event listeners
hub.on('started', onStarted);
hub.on('peerConnected', onPeerConnected);
hub.on('peerDisconnected', onPeerDisconnected);
hub.on('hubRegistered', onHubRegistered);
hub.on('bootstrapConnected', onBootstrapConnected);
hub.on('hubDiscovered', onHubDiscovered);
hub.on('error', onError);

// Memory monitoring (every 5 minutes)
const MEMORY_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes
let memoryMonitor = null;

const startMemoryMonitoring = () => {
    memoryMonitor = setInterval(() => {
        const usage = process.memoryUsage();
        const heapUsedMB = (usage.heapUsed / 1024 / 1024).toFixed(2);
        const heapTotalMB = (usage.heapTotal / 1024 / 1024).toFixed(2);
        const rssMB = (usage.rss / 1024 / 1024).toFixed(2);
        const externalMB = (usage.external / 1024 / 1024).toFixed(2);
        
        console.log(`\n📊 Memory Usage:`);
        console.log(`   RSS: ${rssMB} MB`);
        console.log(`   Heap Used: ${heapUsedMB} MB / ${heapTotalMB} MB`);
        console.log(`   External: ${externalMB} MB`);
        console.log(`   Connections: ${hub.connections ? hub.connections.size : 0}\n`);
        
        // Force garbage collection if heap usage is over 500MB (requires --expose-gc flag)
        if (global.gc && usage.heapUsed > 500 * 1024 * 1024) {
            console.log('🧹 Running garbage collection...');
            global.gc();
        }
    }, MEMORY_CHECK_INTERVAL);
};

// Cleanup function to remove all event listeners
const cleanup = async () => {
    console.log('\n🛑 Shutting down...');
    
    // Stop memory monitoring
    if (memoryMonitor) {
        clearInterval(memoryMonitor);
        memoryMonitor = null;
    }
    
    // Remove all event listeners to prevent memory leaks
    hub.off('started', onStarted);
    hub.off('peerConnected', onPeerConnected);
    hub.off('peerDisconnected', onPeerDisconnected);
    hub.off('hubRegistered', onHubRegistered);
    hub.off('bootstrapConnected', onBootstrapConnected);
    hub.off('hubDiscovered', onHubDiscovered);
    hub.off('error', onError);
    
    // Remove all remaining listeners
    hub.removeAllListeners();
    
    // Stop the hub server
    await hub.stop();
    
    console.log('✅ Stopped');
    process.exit(0);
};

// Graceful shutdown
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// Handle uncaught errors
process.on('uncaughtException', (error) => {
    console.error('� Uncaught Exception:', error);
    cleanup();
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
    cleanup();
});

// Start the hub
hub.start().then(() => {
    // Start memory monitoring after successful start
    startMemoryMonitoring();
}).catch(error => {
    console.error('❌ Failed to start:', error.message);
    process.exit(1);
});
