import { PigeonHub } from './websocket-server/server.js';
import { PeerPigeonMesh } from 'peerpigeon';
import { generateNetworkMeshId } from './utils/MeshIdUtils.js';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// WebRTC setup for Node.js environment
let webrtcInitialized = false;
let globalMesh = null; // Singleton mesh shared by ALL bootstrap managers

async function initializeWebRTC() {
  if (webrtcInitialized) return true;
  
  try {
    console.log('🔧 Setting up WebRTC for Node.js environment...');
    const [WebSocket, wrtc] = await Promise.all([
      import('ws'),
      import('@koush/wrtc')
    ]);
    
    // Make WebRTC available globally for Node.js - like CLI does
    global.RTCPeerConnection = wrtc.default.RTCPeerConnection;
    global.RTCSessionDescription = wrtc.default.RTCSessionDescription;
    global.RTCIceCandidate = wrtc.default.RTCIceCandidate;
    global.WebSocket = WebSocket.default;
    
    webrtcInitialized = true;
    console.log('✅ WebRTC globals set up for Node.js');
    return true;
  } catch (error) {
    console.error('❌ Failed to initialize WebRTC:', error.message);
    throw error;
  }
}

async function getOrCreateGlobalMesh(meshOptions) {
  if (globalMesh) {
    console.log('🔗 Using existing global mesh instance...');
    return globalMesh;
  }
  
  console.log('🌐 Creating new global mesh instance...');
  await initializeWebRTC();
  
  globalMesh = new PeerPigeonMesh(meshOptions);
  
  console.log('🔄 Initializing global mesh with timeout...');
  const initPromise = globalMesh.init();
  const timeoutPromise = new Promise((_, reject) => 
    setTimeout(() => reject(new Error('Global mesh initialization timeout')), 30000)
  );
  
  try {
    await Promise.race([initPromise, timeoutPromise]);
    console.log(`✅ Global mesh initialized with peer ID: ${globalMesh.peerId}`);
  } catch (error) {
    // Use less severe logging for localhost-related timeout issues in cloud environments
    const isCloudEnvironment = process.env.NODE_ENV === 'production' || process.env.PORT;
    const isTimeoutError = error.message?.includes('timeout');
    
    if (isCloudEnvironment && isTimeoutError) {
      console.log(`ℹ️  Global mesh initialization timeout (likely localhost connectivity): ${error.message}`);
    } else {
      console.error('❌ Failed to initialize global mesh:', error.message);
    }
    globalMesh = null; // Reset on failure
    throw error;
  }
  
  return globalMesh;
}

/**
 * BootstrapManager - Manages bootstrap nodes in a PeerPigeon mesh
 */
class BootstrapManager {
  constructor(options = {}) {
    // Configuration
    this.bootstrapNodes = options.bootstrapNodes || [
      { port: 3000, host: 'localhost' },
      { port: 3001, host: 'localhost' },
      { port: 3002, host: 'localhost' },
      // Cloud bootstrap nodes
      { url: 'wss://pigeonhub-c.fly.dev', host: 'pigeonhub-c.fly.dev', port: 443 },
      { url: 'wss://pigeonhub-c-e60f01c2a291.herokuapp.com', host: 'pigeonhub-c-e60f01c2a291.herokuapp.com', port: 443 }
    ];

    // Network identification
    this.networkId = options.networkId || 'global-peerpigeon';
    
    // Base mesh configuration - using CLI pattern
    // IMPORTANT: Lower maxPeers to prevent WebRTC connection concurrency issues
    // When bootstrap nodes discover many peers simultaneously, they can overwhelm
    // the WebRTC connection establishment process
    const baseMeshOptions = {
      maxPeers: 3, // Reduced from 10 to prevent simultaneous connection overload  
      minPeers: 2,
      autoDiscovery: true,
      enableWebDHT: true,
      enableCrypto: false,
      ignoreEnvironmentErrors: true // Allow Node.js environment like CLI
    };

    // Mesh configuration
    this.meshOptions = {
      ...baseMeshOptions,
      networkId: this.generateDeterministicNetworkId(this.networkId),
      ...options.meshOptions
    };

    // Bootstrap nodes configuration
    this.bootstrapMeshOptions = {
      ...this.meshOptions,
      maxPeers: 50,
      minPeers: 1,
      ...options.bootstrapMeshOptions
    };

    // Ensure unique peer IDs
    delete this.meshOptions.peerId;
    delete this.bootstrapMeshOptions.peerId;

    // Internal state
    this.hubs = new Map();
    this.isRunning = false;
    this.bootstrapNodeIds = new Map();
  }

  generateDeterministicNetworkId(networkId) {
    return generateNetworkMeshId(networkId);
  }

  getMeshConfig() {
    return {
      ...this.meshOptions,
    };
  }

  async initializeSharedMesh() {
    try {
      console.log('🌐 Initializing bootstrap manager...');
      
      console.log(`📋 Network ID: ${this.networkId}`);
      console.log(`🔗 Mesh Network Identifier (SHA1): ${this.meshOptions.networkId}`);
      
      // Use global singleton mesh shared across ALL bootstrap managers
      this.mesh = await getOrCreateGlobalMesh(this.meshOptions);
      
      console.log('✅ Bootstrap manager initialized - using global shared mesh');
      
      return this.mesh;
    } catch (error) {
      console.error('❌ Failed to initialize bootstrap manager:', error);
      throw error;
    }
  }

  setupMeshEventHandlers() {
    // Event handlers will be set up by the bootstrap node itself
  }

  getBootstrapRegistry() {
    const registry = [];
    
    for (const [port, hub] of this.hubs) {
      if (hub.isRunning) {
        registry.push({
          port: port,
          host: hub.host,
          peerId: hub.mesh?.peerId,
          connections: hub.mesh?.getConnectedPeerCount() || 0,
          timestamp: Date.now()
        });
      }
    }
    
    return registry;
  }

  updateBootstrapRegistry(nodes) {
    console.log(`📝 Updated bootstrap registry with ${nodes.length} nodes`);
  }

  async createBootstrapHub(nodeConfig) {
    const uniquePeerId = await PeerPigeonMesh.generatePeerId();
    console.log(`🆔 Generated unique peer ID for bootstrap node on ${nodeConfig.port || nodeConfig.url}: ${uniquePeerId}`);
    
    // Configure signaling servers including cloud endpoints
    const signalingServers = [
      // 'ws://localhost:3000',  // Local primary
      process.env.AWS_SIGNAL,
      // 'wss://pigeonhub.fly.dev',  // Fly.dev cloud hub
      // 'wss://pigeonhub-server-3c044110c06f.herokuapp.com'  // Heroku cloud hub
    ].filter(Boolean); // Remove undefined values
    
    console.log(`🔗 Bootstrap node ${nodeConfig.port || nodeConfig.url} will connect to signaling servers:`, signalingServers);
    
    // Don't create new mesh options - use the manager's mesh!
    const hub = new PigeonHub({
      port: nodeConfig.port,
      host: nodeConfig.host,
      sharedMesh: this.mesh,  // ← Pass the manager's mesh instead of creating new one
      signalingServers: signalingServers
    });

    // Use URL as key for cloud nodes, port for local nodes
    const nodeKey = nodeConfig.url || nodeConfig.port;
    this.hubs.set(nodeKey, hub);
    this.bootstrapNodeIds.set(nodeKey, uniquePeerId);
    
    console.log(`📊 Bootstrap node ${nodeKey} will join mesh network: ${this.meshOptions.networkId}`);
    console.log(`📊 Bootstrap node ${nodeKey} | Peer ID: ${this.mesh.peerId} (global shared mesh)`);
    
    return hub;
  }

  async start(startBootstrapNodes = false) {
    if (this.isRunning) {
      console.log('⚠️  BootstrapManager is already running');
      return;
    }

    try {
      console.log('🚀 Starting BootstrapManager...');
      
      await this.initializeSharedMesh();
      
      this.isRunning = true;
      
      console.log('🎉 BootstrapManager ready!');
      console.log(`🌐 Mesh network: ${this.meshOptions.networkId}`);
      
      await this.startOwnBootstrapNode();
      
      this.setupStatusReporting();
      
    } catch (error) {
      console.error('❌ Failed to start BootstrapManager:', error);
      await this.stop();
      throw error;
    }
  }

  async startOwnBootstrapNode() {
    const port = parseInt(process.env.PORT) || 3000;
    const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost');
    
    console.log(`🔍 DEBUG: Starting bootstrap node on ${host}:${port} (from PORT=${process.env.PORT})`);
    
    try {
      const nodeConfig = { port, host };
      const hub = await this.createBootstrapHub(nodeConfig);
      await hub.start();
      
      // Set up PeerPigeon mesh event listeners
      if (hub.mesh) {
        const actualPort = hub.port;
        
        hub.mesh.addEventListener('peerConnected', (data) => {
          console.log(`🤝 Bootstrap mesh peer connected: ${data.peerId.substring(0, 8)}...`);
          console.log(`🔄 Bootstrap node ${actualPort} mesh peer count: ${hub.mesh.getConnectedPeerCount()}`);
          console.log('📊 Updated Status:', this.getManagerStatus());
        });

        hub.mesh.addEventListener('peerDisconnected', (data) => {
          console.log(`👋 Bootstrap mesh peer disconnected: ${data.peerId.substring(0, 8)}...`);
          console.log(`🔄 Bootstrap node ${actualPort} mesh peer count: ${hub.mesh.getConnectedPeerCount()}`);
          console.log('📊 Updated Status:', this.getManagerStatus());
        });

        hub.mesh.addEventListener('messageReceived', (data) => {
          console.log(`📨 Bootstrap mesh message from ${data.from.substring(0, 8)}...: ${JSON.stringify(data.content).substring(0, 100)}`);
        });
        
        console.log(`✅ Set up PeerPigeon mesh event listeners for bootstrap coordination`);
      }
      
      const actualPort = hub.port;
      
      console.log(`✅ Own bootstrap node started on port ${actualPort}`);
      if (actualPort !== port) {
        console.log(`🔄 Port changed from requested ${port} to actual ${actualPort}`);
      }
      console.log(`📊 Bootstrap node count: ${this.hubs.size}`);
      
      // PigeonHub will automatically connect to other signaling servers
      console.log(`🌐 Bootstrap node ${actualPort} will automatically connect to other bootstrap nodes via signaling servers`);
      
    } catch (error) {
      console.error(`❌ Failed to start own bootstrap node on port ${port}:`, error);
      throw error;
    }
  }

  setupStatusReporting() {
    // Status is logged immediately when active
  }

  getTotalConnections() {
    let total = 0;
    for (const [, hub] of this.hubs) {
      total += hub.mesh?.getConnectedPeerCount() || 0;
    }
    return total;
  }

  async stop() {
    if (!this.isRunning) {
      console.log('⚠️  BootstrapManager is not running');
      return;
    }

    console.log('🛑 Stopping BootstrapManager...');

    this.hubs.clear();
    this.bootstrapNodeIds.clear();
    this.isRunning = false;

    console.log('✅ BootstrapManager stopped');
  }

  getManagerStatus() {
    const firstHub = this.hubs.values().next().value;
    return {
      isRunning: this.isRunning,
      bootstrapPeerId: firstHub?.mesh?.peerId,
      totalBootstrapNodes: this.hubs.size,
      totalConnections: this.getTotalConnections()
    };
  }
}

// Example usage and CLI entrypoint
async function main() {
  const manager = new BootstrapManager({
    meshOptions: {
      enableCrypto: false,
    }
  });

  try {
    await manager.start();
    
    const status = manager.getManagerStatus();
    const firstHub = manager.hubs.values().next().value;
    
    console.log('🎉 Bootstrap manager started successfully!');
    console.log('📊 Status:', status);
    console.log('');
    console.log('📝 This instance provides:');
    console.log(`   🌐 Mesh network ID: ${manager.meshOptions.networkId}`);
    console.log(`   🆔 Bootstrap peer ID: ${status.bootstrapPeerId}`);
    console.log(`   🏠 Bootstrap node on port: ${firstHub?.port || process.env.PORT || 3000}`);
    console.log('');
    console.log('📝 Other bootstrap managers can:');
    console.log('   1. Run the same code on different ports');
    console.log('   2. Automatically discover and connect to this instance');
    console.log('   3. Join the same mesh network with unique peer IDs');
    console.log('');
    console.log('📋 To start another instance:');
    console.log('   PORT=3001 node manual-hub/bootstrap-manager.js');
    console.log('   PORT=3002 node manual-hub/bootstrap-manager.js');

    const cleanup = async () => {
      console.log('\n🛑 Received shutdown signal...');
      await manager.stop();
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

  } catch (error) {
    console.error('❌ Failed to start BootstrapManager:', error);
    process.exit(1);
  }
}

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export default BootstrapManager;
export { BootstrapManager };
