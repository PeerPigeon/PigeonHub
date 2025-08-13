#!/usr/bin/env node

/**
 * Bootstrap Node Runner
 * 
 * This script starts a PeerPigeon bootstrap node with WebSocket signaling server.
 * It combines the existing server.js functionality with PeerPigeon mesh networking.
 * 
 * Usage:
 *   node bootstrap-node.js --port=3001 --role=primary
 *   node bootstrap-node.js --port=3002 --role=secondary
 */

import { BootstrapNode } from './modules/BootstrapNode.js';
import { PeerPigeonServerManager } from './modules/PeerPigeonServerManager.js';
import { BOOTSTRAP_CONFIG } from './config/bootstrap-config.js';

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};

  // First argument can be node ID (bootstrap-primary, bootstrap-secondary)
  if (args[0] && !args[0].startsWith('--')) {
    parsed.nodeId = args[0];
    args.shift(); // Remove node ID from args for flag parsing
  }

  args.forEach(arg => {
    if (arg.startsWith('--')) {
      const [key, value] = arg.substring(2).split('=');
      parsed[key] = value || true;
    }
  });

  return parsed;
}

// Main bootstrap node runner
class BootstrapNodeRunner {
  constructor() {
    this.args = parseArgs();
    this.bootstrapNode = null;
    this.serverManager = null;
    this.isRunning = false;
  }

  /**
   * Start the bootstrap node and signaling server
   */
  async start() {
    try {
      console.log('🚀 Starting PigeonHub Bootstrap Node...');
      
      // Determine configuration based on arguments
      let nodeConfig;
      
      if (this.args.nodeId) {
        // Use specific node configuration by ID
        nodeConfig = BOOTSTRAP_CONFIG.BOOTSTRAP_NODES.find(node => node.id === this.args.nodeId);
        if (!nodeConfig) {
          throw new Error(`No bootstrap node configuration found for ID: ${this.args.nodeId}`);
        }
      } else {
        // Use role-based configuration (legacy support)
        const role = this.args.role || 'primary';
        const port = parseInt(this.args.port) || (role === 'primary' ? 3001 : 3002);
        nodeConfig = BOOTSTRAP_CONFIG.BOOTSTRAP_NODES.find(node => 
          node.role === role && node.port === port
        );
        if (!nodeConfig) {
          throw new Error(`No bootstrap node configuration found for role: ${role}, port: ${port}`);
        }
      }

      const host = this.args.host || nodeConfig.host || 'localhost';
      const port = parseInt(this.args.port) || nodeConfig.port;

      console.log(`📋 Configuration: ${nodeConfig.id} (${nodeConfig.role}) on ${host}:${port}`);

      // Start the signaling server manager (only if this node is a signaling server)
      if (nodeConfig.isSignalingServer) {
        this.serverManager = new PeerPigeonServerManager({
          port,
          host,
          maxPeers: 100
        });

        await this.serverManager.start();
      }

      // Create and start the bootstrap node
      this.bootstrapNode = new BootstrapNode(nodeConfig);
      await this.bootstrapNode.init();

      // Link bootstrap node and server manager for cross-node signaling
      if (this.serverManager && this.bootstrapNode) {
        this.serverManager.setBootstrapNode(this.bootstrapNode);
        this.bootstrapNode.setServerManager(this.serverManager);
        console.log(`🔗 Cross-node signaling relay configured between bootstrap node and server manager`);
      }

      // Connect to mesh network (if not primary)
      if (nodeConfig.connectsTo) {
        // Wait a bit before connecting to ensure primary is ready
        console.log(`⏳ Waiting 2 seconds before connecting to mesh...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        await this.bootstrapNode.connect();
      }

      this.isRunning = true;

      // Set up periodic status reporting
      this.startStatusReporting();

      // Set up keepalive pings between bootstrap servers
      this.startBootstrapKeepalive();

      // Set up health monitoring
      this.startHealthMonitoring();

      console.log(`✅ Bootstrap node ${nodeConfig.id} is running successfully!`);
      
      if (nodeConfig.isSignalingServer) {
        console.log(`🌐 WebSocket server: ws://${host}:${port}`);
      }
      console.log(`🔗 Mesh role: ${nodeConfig.role}`);
      
      if (nodeConfig.connectsTo) {
        console.log(`📡 Connected to: ${nodeConfig.connectsTo}`);
      }

      return true;

    } catch (error) {
      console.error('❌ Failed to start bootstrap node:', error);
      process.exit(1);
    }
  }

  /**
   * Stop the bootstrap node
   */
  async stop() {
    console.log('🛑 Stopping bootstrap node...');

    if (this.bootstrapNode) {
      await this.bootstrapNode.disconnect();
    }

    if (this.serverManager) {
      await this.serverManager.stop();
    }

    this.isRunning = false;
    console.log('✅ Bootstrap node stopped');
  }

  /**
   * Start periodic status reporting
   */
  startStatusReporting() {
    setInterval(() => {
      if (!this.isRunning) return;

      const bootstrapStats = this.bootstrapNode ? this.bootstrapNode.getStats() : {};
      const serverStats = this.serverManager ? this.serverManager.getStats() : {};

      console.log('📊 Status Report:');
      console.log(`   Bootstrap Node: ${bootstrapStats.nodeId} (${bootstrapStats.role})`);
      console.log(`   Connected Peers: ${bootstrapStats.connectedPeers}`);
      console.log(`   Discovered Peers: ${bootstrapStats.discoveredPeers}`);
      console.log(`   Messages Handled: ${bootstrapStats.messagesHandled}`);
      console.log(`   PeerPigeon Server Peers: ${serverStats.peerPigeonStats?.connectedPeers || 0}`);
      console.log(`   Uptime: ${Math.round(bootstrapStats.uptime / 1000)}s`);
      console.log('');

    }, 30000); // Report every 30 seconds
  }

  /**
   * Start keepalive pings between bootstrap servers
   */
  startBootstrapKeepalive() {
    setInterval(() => {
      if (!this.isRunning || !this.bootstrapNode || !this.bootstrapNode.mesh) return;

      // Send keepalive ping to maintain connection between bootstrap servers
      try {
        const mesh = this.bootstrapNode.mesh;
        const connectedPeers = mesh.getConnectedPeerIds ? mesh.getConnectedPeerIds() : [];
        
        if (connectedPeers.length > 0) {
          console.log(`💓 Sending keepalive ping to ${connectedPeers.length} bootstrap peer(s)`);
          
          // Send a lightweight ping message to each connected bootstrap peer
          connectedPeers.forEach(peerId => {
            try {
              mesh.sendDirectMessage(peerId, {
                type: 'bootstrap-keepalive',
                from: this.bootstrapNode.config.id,
                timestamp: Date.now()
              });
            } catch (error) {
              console.log(`⚠️  Keepalive ping failed to ${peerId.substring(0, 8)}...: ${error.message}`);
            }
          });
        }
      } catch (error) {
        console.log(`⚠️  Keepalive ping error: ${error.message}`);
      }

    }, 45000); // Send keepalive every 45 seconds (before Heroku's 55s timeout)
  }

  /**
   * Start health monitoring
   */
  startHealthMonitoring() {
    setInterval(() => {
      if (!this.isRunning) return;

      const bootstrapHealth = this.bootstrapNode ? this.bootstrapNode.healthCheck() : { healthy: false };
      const serverHealth = this.serverManager ? this.serverManager.healthCheck() : { healthy: false };

      if (!bootstrapHealth.healthy || !serverHealth.healthy) {
        console.log('⚠️  Health check failed:');
        console.log(`   Bootstrap Node: ${bootstrapHealth.healthy ? '✅' : '❌'}`);
        console.log(`   Server Manager: ${serverHealth.healthy ? '✅' : '❌'}`);
      }

    }, 60000); // Check every minute
  }

  /**
   * Send a test message through the mesh
   */
  sendTestMessage() {
    if (this.bootstrapNode) {
      return this.bootstrapNode.sendTestMessage();
    }
    return null;
  }

  /**
   * Get combined statistics
   */
  getStats() {
    return {
      bootstrap: this.bootstrapNode ? this.bootstrapNode.getStats() : null,
      server: this.serverManager ? this.serverManager.getStats() : null,
      isRunning: this.isRunning
    };
  }
}

// Create and start the bootstrap node runner
const runner = new BootstrapNodeRunner();

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Received SIGINT, shutting down gracefully...');
  await runner.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
  await runner.stop();
  process.exit(0);
});

// Handle errors
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start the bootstrap node
runner.start().catch(error => {
  console.error('❌ Failed to start:', error);
  process.exit(1);
});

// Export for programmatic use
export { runner, BootstrapNodeRunner };
export default runner;
