/**
 * PeerPigeon Bootstrap Node
 * 
 * This module creates a PeerPigeon mesh node that acts as a bootstrap node
 * for the PigeonHub network. Bootstrap nodes are always-on nodes that help
 * other peers discover the network.
 */

// Initialize WebRTC for Node.js following PeerPigeon's pattern
let webrtcInitialized = false;

// Setup global error handlers to prevent crashes like the CLI does
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception in bootstrap node:', error.message);
  console.error('Stack:', error.stack);
  // Don't exit immediately, try to recover
});

process.on('unhandledRejection', (reason, _promise) => {
  console.error('❌ Unhandled Promise Rejection in bootstrap node:', reason);
  // Don't exit immediately, try to recover
});

async function initializeWebRTC() {
  if (webrtcInitialized) return true;
  
  try {
    // Add timeout to prevent hanging on import
    const importPromise = Promise.all([
      import('ws'),
      import('@koush/wrtc'),
      import('crypto')
    ]);
    
    const timeoutPromise = new Promise((resolve, reject) => {
      setTimeout(() => reject(new Error('WebRTC import timeout')), 10000);
    });
    
    const [WebSocket, wrtc, crypto] = await Promise.race([importPromise, timeoutPromise]);
    
    // Make WebRTC available globally for Node.js
    global.RTCPeerConnection = wrtc.default.RTCPeerConnection;
    global.RTCSessionDescription = wrtc.default.RTCSessionDescription;
    global.RTCIceCandidate = wrtc.default.RTCIceCandidate;
    global.WebSocket = WebSocket.default;
    
    // CRITICAL: Add crypto polyfill for PeerPigeon's UnSEA system
    if (!global.crypto) {
      global.crypto = {
        getRandomValues: (array) => {
          return crypto.default.randomFillSync(array);
        }
      };
    }
    
    webrtcInitialized = true;
    return true;
  } catch (error) {
    console.error('❌ Failed to load WebRTC dependencies:', error.message);
    console.error('Please ensure ws and @koush/wrtc are installed: npm install ws @koush/wrtc');
    console.error('Stack trace:', error.stack);
    return false;
  }
}

import { PeerPigeonMesh, DebugLogger } from 'peerpigeon';
import { BOOTSTRAP_CONFIG } from '../config/bootstrap-config.js';

// Enable debugging for PeerPigeon
DebugLogger.enable('PeerPigeonMesh');
DebugLogger.enable('ConnectionManager');
DebugLogger.enable('SignalingClient');

export class BootstrapNode {
  constructor(nodeConfig) {
    this.config = nodeConfig;
    this.mesh = null;
    this.isInitialized = false;
    this.stats = {
      startTime: Date.now(),
      peersConnected: 0,
      messagesHandled: 0,
      reconnections: 0
    };

    // Create debug logger for this bootstrap node
    this.debug = DebugLogger.create(`BootstrapNode-${nodeConfig.id}`);
  }

  /**
   * Initialize the bootstrap node
   */
  async init() {
    try {
      this.debug.log(`Initializing bootstrap node: ${this.config.id}`);

      // Initialize WebRTC for Node.js environment
      const webrtcReady = await initializeWebRTC();
      if (!webrtcReady) {
        throw new Error('Failed to initialize WebRTC for Node.js');
      }

      // Generate peer ID using PeerPigeon's method
      const peerId = await PeerPigeonMesh.generatePeerId();
      this.debug.log(`Generated peer ID for ${this.config.id}: ${peerId}`);

      // Create PeerPigeon mesh with CLI-style configuration
      const meshOptions = {
        peerId: peerId,
        maxPeers: BOOTSTRAP_CONFIG.MESH_CONFIG.maxPeers || 5,
        minPeers: BOOTSTRAP_CONFIG.MESH_CONFIG.minPeers || 0,
        autoDiscovery: BOOTSTRAP_CONFIG.MESH_CONFIG.autoDiscovery !== undefined ? BOOTSTRAP_CONFIG.MESH_CONFIG.autoDiscovery : true,
        enableWebDHT: BOOTSTRAP_CONFIG.MESH_CONFIG.enableWebDHT !== undefined ? BOOTSTRAP_CONFIG.MESH_CONFIG.enableWebDHT : true,
        enableCrypto: BOOTSTRAP_CONFIG.MESH_CONFIG.enableCrypto !== undefined ? BOOTSTRAP_CONFIG.MESH_CONFIG.enableCrypto : true,
        ignoreEnvironmentErrors: true // Allow Node.js environment like CLI
      };

      this.debug.log(`Mesh options: ${JSON.stringify(meshOptions, null, 2)}`);

      this.mesh = new PeerPigeonMesh(meshOptions);

      // Set up event listeners
      this.setupEventListeners();

      // Initialize the mesh with timeout like the CLI
      const initPromise = this.mesh.init();
      const timeoutPromise = new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error('Mesh initialization timeout')), 30000);
      });
      
      await Promise.race([initPromise, timeoutPromise]);
      this.debug.log(`Bootstrap node ${this.config.id} initialized with peer ID: ${peerId}`);

      this.isInitialized = true;
      return true;

    } catch (error) {
      this.debug.error(`Failed to initialize bootstrap node ${this.config.id}:`, error);
      throw error;
    }
  }

  /**
   * Connect to the mesh network
   */
  async connect() {
    if (!this.isInitialized) {
      throw new Error('Bootstrap node must be initialized before connecting');
    }

    try {
      if (this.config.connectsTo) {
        this.debug.log(`Connecting to signaling server: ${this.config.connectsTo}`);
        
        // For primary bootstrap node connecting to its own server, add a delay
        if (this.config.role === 'primary') {
          this.debug.log(`Primary bootstrap node connecting to its own signaling server - waiting a moment...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
        // Add timeout to connection to prevent hanging like the CLI
        const connectPromise = this.mesh.connect(this.config.connectsTo);
        const timeoutPromise = new Promise((resolve, reject) => {
          setTimeout(() => reject(new Error('Connection timeout')), 15000);
        });
        
        await Promise.race([connectPromise, timeoutPromise]);
        this.debug.log(`Successfully connected to signaling server - PeerPigeon will handle WebRTC connections automatically`);
        
      } else {
        this.debug.log(`Bootstrap node not configured to connect to signaling server`);
      }

      return true;

    } catch (error) {
      this.debug.error(`Failed to connect to mesh network:`, error);
      this.stats.reconnections++;
      throw error;
    }
  }

  /**
   * Disconnect from the mesh network
   */
  async disconnect() {
    if (this.mesh) {
      this.debug.log(`Disconnecting bootstrap node: ${this.config.id}`);
      this.mesh.disconnect();
      this.debug.log(`Bootstrap node disconnected`);
    }
  }

  /**
   * Set up event listeners for the mesh
   */
  setupEventListeners() {
    try {
      if (!this.mesh || typeof this.mesh.addEventListener !== 'function') {
        this.debug.log('Warning: Mesh does not support event handling');
        return;
      }

      // Connection events
      this.mesh.addEventListener('connected', () => {
        try {
          this.debug.log(`Connected to signaling server`);
        } catch (error) {
          console.error('❌ Error handling connected event:', error.message);
        }
      });

      this.mesh.addEventListener('disconnected', () => {
        try {
          this.debug.log(`Disconnected from signaling server`);
          // PeerPigeon will handle reconnection automatically
        } catch (error) {
          console.error('❌ Error handling disconnected event:', error.message);
        }
      });

      // Message events with better error handling
      this.mesh.addEventListener('messageReceived', (data) => {
        try {
          this.stats.messagesHandled++;
          this.debug.log(`📨 Message received from ${data.from?.substring(0, 8)}...: ${JSON.stringify(data.content).substring(0, 200)}`);
          
          // Log specific message types for debugging
          if (data.content?.type === 'peer-announce-relay') {
            this.debug.log(`🔍 DEBUGGING: Received peer-announce-relay message for ${data.content.peerId?.substring(0, 8)}...`);
          }
          
          // Bootstrap nodes can relay/store messages if needed
          this.handleBootstrapMessage(data);
        } catch (error) {
          console.error('❌ Error handling messageReceived event:', error.message);
        }
      });

      // CRITICAL: Listen for peer connections to relay to WebSocket clients immediately
      this.mesh.addEventListener('peerConnected', (data) => {
        try {
          this.stats.peersConnected++;
          this.debug.log(`Peer connected: ${data.peerId?.substring(0, 8)}... (Total connected: ${this.mesh.getConnectedPeerCount()})`);
          
          // IMMEDIATELY relay this peer to WebSocket clients
          if (this.serverManager && this.serverManager.webSocketServer) {
            this.debug.log(`🌐 CRITICAL: Immediately relaying newly connected mesh peer ${data.peerId?.substring(0, 8)}... to WebSocket clients`);
            this.serverManager.webSocketServer.relayMeshPeerToWebSocketClients(data.peerId);
          }
        } catch (error) {
          console.error('❌ Error handling peerConnected event:', error.message);
        }
      });

      this.mesh.addEventListener('peerDisconnected', (data) => {
        try {
          this.debug.log(`Peer disconnected: ${data.peerId?.substring(0, 8)}... (Total connected: ${this.mesh.getConnectedPeerCount()})`);
        } catch (error) {
          console.error('❌ Error handling peerDisconnected event:', error.message);
        }
      });

      this.mesh.addEventListener('peerDiscovered', (data) => {
        try {
          this.debug.log(`Peer discovered: ${data.peerId?.substring(0, 8)}... - PeerPigeon will handle connection automatically`);
          
          // IMMEDIATELY relay this peer to WebSocket clients
          if (this.serverManager && this.serverManager.webSocketServer) {
            this.debug.log(`🌐 CRITICAL: Immediately relaying newly discovered mesh peer ${data.peerId?.substring(0, 8)}... to WebSocket clients`);
            this.serverManager.webSocketServer.relayMeshPeerToWebSocketClients(data.peerId);
          }
        } catch (error) {
          console.error('❌ Error handling peerDiscovered event:', error.message);
        }
      });

      // Status events with better error handling
      this.mesh.addEventListener('statusChanged', (data) => {
        try {
          this.debug.log(`Status changed:`, data);
        } catch (error) {
          console.error('❌ Error handling statusChanged event:', error.message);
        }
      });

      // DHT events (for future use) with better error handling
      this.mesh.addEventListener('dhtValueChanged', (data) => {
        try {
          this.debug.log(`DHT value changed: ${data.key}`);
        } catch (error) {
          console.error('❌ Error handling dhtValueChanged event:', error.message);
        }
      });
    } catch (error) {
      console.error('❌ Critical error setting up event handlers:', error.message);
      console.error('Stack trace:', error.stack);
    }
  }

  /**
   * Handle messages specific to bootstrap nodes
   */
  handleBootstrapMessage(messageData) {
    // Bootstrap nodes can implement special message handling here
    // For example: storing bootstrap information, relaying to other bootstrap nodes, etc.
    
    if (messageData.content?.type === 'bootstrap-ping') {
      // Respond to bootstrap ping requests
      this.mesh.sendDirectMessage(messageData.from, {
        type: 'bootstrap-pong',
        bootstrapNodeId: this.config.id,
        timestamp: Date.now(),
        stats: this.getStats()
      });
    }

    if (messageData.content?.type === 'bootstrap-keepalive') {
      // Handle keepalive pings from other bootstrap servers
      // Just acknowledge receipt to maintain connection
      this.mesh.sendDirectMessage(messageData.from, {
        type: 'bootstrap-keepalive-ack',
        from: this.config.id,
        timestamp: Date.now()
      }).catch(error => {
        // Don't log keepalive errors unless debugging
        // console.log(`Keepalive ack failed: ${error.message}`);
      });
    }

    if (messageData.content?.type === 'bootstrap-keepalive-ack') {
      // Received acknowledgment of our keepalive ping
      // This helps maintain the connection but we don't need to do anything
    }
    
    // Handle cross-node signaling relay requests
    if (messageData.content?.type === 'signaling-relay') {
      this.handleSignalingRelay(messageData);
    }

    // Handle cross-node peer announcement relay
    if (messageData.content?.type === 'peer-announce-relay') {
      this.handlePeerAnnounceRelay(messageData);
    }

    // NEW: Handle WebSocket peer announcements from mesh gateways
    if (messageData.content?.type === 'websocket-peer-announcement') {
      this.handleWebSocketPeerAnnouncement(messageData);
    }
  }

  /**
   * Handle cross-node signaling relay between bootstrap nodes
   */
  handleSignalingRelay(messageData) {
    try {
      const { targetPeerId, signalingMessage } = messageData.content;
      
      this.debug.log(`Received signaling relay request for peer ${targetPeerId?.substring(0, 8)}...`);
      
      // Check if we have a ServerManager that can relay the message
      if (this.serverManager && this.serverManager.relaySignalingMessage) {
        const success = this.serverManager.relaySignalingMessage(targetPeerId, signalingMessage);
        
        if (success) {
          this.debug.log(`Successfully relayed signaling message to ${targetPeerId?.substring(0, 8)}...`);
        } else {
          this.debug.log(`Failed to relay signaling message - peer ${targetPeerId?.substring(0, 8)}... not found locally`);
        }
      } else {
        this.debug.log(`No ServerManager available for signaling relay`);
      }
    } catch (error) {
      this.debug.error(`Error handling signaling relay:`, error);
    }
  }

  /**
   * Set the server manager for this bootstrap node
   */
  setServerManager(serverManager) {
    this.serverManager = serverManager;
    this.debug.log(`Server manager attached for cross-node signaling relay`);
  }

  /**
   * Request signaling relay through mesh network
   */
  requestSignalingRelay(targetPeerId, signalingMessage) {
    if (this.mesh) {
      this.debug.log(`Requesting signaling relay for peer ${targetPeerId?.substring(0, 8)}...`);
      
      const relayMessage = {
        type: 'signaling-relay',
        targetPeerId,
        signalingMessage,
        sourceBootstrapId: this.config.id,
        timestamp: Date.now()
      };
      
      // Send relay request to all connected bootstrap peers using direct messaging
      const connectedPeerIds = this.mesh.getConnectedPeerIds();
      this.debug.log(`🔍 DIRECT RELAY: Sending to connected bootstrap peers: ${JSON.stringify(connectedPeerIds)}`);
      
      let lastMessageId = null;
      for (const peerId of connectedPeerIds) {
        this.debug.log(`🔍 DIRECT RELAY: Sending relay request to ${peerId?.substring(0, 8)}...`);
        const messageId = this.mesh.sendDirectMessage(peerId, relayMessage);
        this.debug.log(`🔍 DIRECT RELAY: Result for ${peerId?.substring(0, 8)}...: ${messageId}`);
        lastMessageId = messageId;
      }
      
      this.debug.log(`Sent signaling relay request via direct messaging: ${lastMessageId}`);
      return lastMessageId;
    }
    return null;
  }

  /**
   * Handle cross-node peer announcement relay
   */
  handlePeerAnnounceRelay(messageData) {
    try {
      const { peerId, data, sourcePort } = messageData.content;
      
      this.debug.log(`🔍 DEBUGGING: handlePeerAnnounceRelay called for peer ${peerId?.substring(0, 8)}... from port ${sourcePort}`);
      this.debug.log(`Received cross-node peer announce relay for peer ${peerId?.substring(0, 8)}... from port ${sourcePort}`);
      
      // Check if we have a ServerManager that can handle the cross-node peer announcement
      if (this.serverManager && this.serverManager.webSocketServer && this.serverManager.webSocketServer.handleCrossNodePeerAnnounce) {
        this.debug.log(`🔍 DEBUGGING: Calling handleCrossNodePeerAnnounce on server manager`);
        this.serverManager.webSocketServer.handleCrossNodePeerAnnounce({
          peerId,
          data,
          sourcePort
        });
        
        this.debug.log(`Successfully relayed cross-node peer announcement for ${peerId?.substring(0, 8)}...`);
      } else {
        this.debug.log(`❌ No ServerManager available for cross-node peer announcement relay`);
        this.debug.log(`🔍 DEBUGGING: serverManager=${!!this.serverManager}, webSocketServer=${!!this.serverManager?.webSocketServer}, handleCrossNodePeerAnnounce=${!!this.serverManager?.webSocketServer?.handleCrossNodePeerAnnounce}`);
      }
    } catch (error) {
      this.debug.error(`Error handling cross-node peer announcement relay:`, error);
    }
  }

  /**
   * Get bootstrap node statistics
   */
  getStats() {
    const meshStatus = this.mesh ? this.mesh.getStatus() : {};
    
    return {
      ...this.stats,
      uptime: Date.now() - this.stats.startTime,
      nodeId: this.config.id,
      role: this.config.role,
      isInitialized: this.isInitialized,
      meshStatus,
      connectedPeers: this.mesh ? this.mesh.getConnectedPeerCount() : 0,
      discoveredPeers: this.mesh ? this.mesh.getDiscoveredPeers().length : 0
    };
  }

  /**
   * Get the PeerPigeon mesh instance
   */
  getMesh() {
    return this.mesh;
  }

  /**
   * Handle WebSocket peer announcements from mesh gateways
   */
  handleWebSocketPeerAnnouncement(messageData) {
    try {
      const { peerId, data, gateway } = messageData.content;
      
      this.debug.log(`🌐 Received WebSocket peer announcement for ${peerId?.substring(0, 8)}... from gateway port ${gateway}`);
      
      // If we have a ServerManager on a different port, relay this peer announcement
      if (this.serverManager && this.serverManager.options.port !== gateway) {
        this.debug.log(`🌐 Relaying WebSocket peer ${peerId?.substring(0, 8)}... to our WebSocket server on port ${this.serverManager.options.port}`);
        
        // Announce this peer to our local WebSocket clients
        if (this.serverManager.webSocketServer && this.serverManager.webSocketServer.relayMeshPeerToWebSocketClients) {
          this.serverManager.webSocketServer.relayMeshPeerToWebSocketClients(peerId);
        }
        
        // Also handle it as a cross-node peer announce for proper integration
        if (this.serverManager.webSocketServer && this.serverManager.webSocketServer.handleCrossNodePeerAnnounce) {
          this.serverManager.webSocketServer.handleCrossNodePeerAnnounce({
            peerId,
            data: { ...data, isMeshPeer: true, originalGateway: gateway },
            sourcePort: gateway
          });
        }
      }
      
      // CRITICAL: If this is a mesh peer announcement, we should also add it to our mesh's known peers
      if (this.mesh && peerId !== this.mesh.peerId) {
        this.debug.log(`🌐 CRITICAL: Adding WebSocket peer ${peerId?.substring(0, 8)}... to our mesh's known peers for cross-network discovery`);
        
        // Try to add this peer to our mesh's discovery system
        if (this.mesh.addKnownPeer) {
          this.mesh.addKnownPeer(peerId, {
            ...data,
            isWebSocketPeer: true,
            gateway: gateway,
            discoveredAt: Date.now()
          });
        }
        
        // Trigger a peer discovered event for our own mesh
        if (this.mesh.dispatchEvent) {
          this.mesh.dispatchEvent(new CustomEvent('peerDiscovered', {
            detail: { peerId, ...data, isWebSocketPeer: true, gateway }
          }));
        }
      }
    } catch (error) {
      this.debug.error(`Error handling WebSocket peer announcement:`, error);
    }
  }

  /**
   * Perform health check
   */
  healthCheck() {
    return {
      healthy: this.isInitialized && this.mesh !== null,
      stats: this.getStats(),
      timestamp: Date.now()
    };
  }

  /**
   * Send a test message to the mesh
   */
  sendTestMessage() {
    if (this.mesh) {
      const messageId = this.mesh.sendMessage({
        type: 'bootstrap-test',
        from: this.config.id,
        timestamp: Date.now(),
        message: 'Test message from bootstrap node'
      });
      
      this.debug.log(`Sent test message: ${messageId}`);
      return messageId;
    }
    return null;
  }
}

export default BootstrapNode;
