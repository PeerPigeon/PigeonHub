import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { URL } from 'url';
import { PeerPigeonMesh } from 'peerpigeon';

// WebRTC setup for Node.js environment
let webrtcInitialized = false;

async function initializeWebRTC() {
  if (webrtcInitialized) return true;
  
  try {
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
    return true;
  } catch (error) {
    console.error('❌ Failed to initialize WebRTC:', error.message);
    throw error;
  }
}

/**
 * Usage Example:
 * 
 * // Basic usage with defaults
 * const hub = new PigeonHub();
 * await hub.start();
 * 
 * // Custom configuration
 * const hub = new PigeonHub({
 *   port: 4000,
 *   host: '0.0.0.0',
 *   meshOptions: {
 *     maxPeers: 10,
 *     minPeers: 2,
 *     autoDiscovery: false,
 *     enableWebDHT: false,
 *     enableCrypto: true,
 *   }
 * });
 * await hub.start();
 * 
 * // Graceful shutdown
 * await hub.stop();
 */

/**
 * PigeonHub - WebSocket Signaling Server for PeerPigeon Mesh Network
 *
 * This class provides WebSocket signaling functionality for local development
 * and testing of the PeerPigeon mesh network. It handles peer discovery,
 * WebRTC signaling, and connection management.
 */
class PigeonHub {
  constructor(options = {}) {
    // Server configuration
    this.port = options.port || process.env.PORT || 3000;
    this.host = options.host || process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost');
    
    // Shared mesh support
    this.sharedMesh = options.sharedMesh || null;
    this.signalingServers = options.signalingServers || [];
    
    // Network namespace configuration
    this.networkName = options.networkName || process.env.NETWORK_NAME || 'PeerPigeonHub';
    this.allowGlobalFallback = options.allowGlobalFallback !== false; // Default to true
    
    // Default mesh options optimized for INSTANT hub-to-hub connections
    const defaultMeshOptions = {
      maxPeers: 8, // Allow more connections for hub role
      minPeers: 1,
      autoDiscovery: true, // ENABLE - discover peers via signaling servers
      autoConnect: true, // ENABLE - connect immediately when peer discovered
      enableWebDHT: false, // DISABLE - WebDHT causes 10+ second delays for hubs
      enableCrypto: false, // DISABLE - crypto slows down connection establishment
      // Network namespace support - CRITICAL for hub isolation
      networkName: this.networkName,
      allowGlobalFallback: this.allowGlobalFallback,
      // Signaling servers (if any) - PRIMARY discovery method for hubs
      signalingServers: this.signalingServers,
      // AGGRESSIVE connection establishment for instant connections
      connectionTimeout: 500, // 500ms - very fast timeout
      heartbeatInterval: 2000, // Fast heartbeat - 2s
      retryAttempts: 5, // More retries but faster
      retryDelay: 50, // 50ms between retries - very fast
      // PeerPigeon specific optimizations for signaling server discovery
      discoveryInterval: 100, // Discover peers every 100ms via signaling servers
      connectImmediately: true, // Connect as soon as peer is discovered
      aggressiveConnect: true, // Force immediate connections
      fastBootstrap: true // Skip slow bootstrap processes
    };
    
    // Merge provided mesh options with defaults
    this.meshOptions = { ...defaultMeshOptions, ...options.meshOptions };
    
    // Internal state
    this.connections = new Map(); // peerId -> WebSocket connection
    this.peerData = new Map(); // peerId -> { peerId, timestamp, data }
    this.server = null;
    this.wss = null;
    this.mesh = null;
    this.cleanupInterval = null;
    this.isRunning = false;
  }

  /**
   * Check if we're running in a cloud deployment vs local development
   */
  isCloudDeployment() {
    return process.env.NODE_ENV === 'production' || 
           !!process.env.PORT || 
           !!process.env.HEROKU_APP_NAME || 
           !!process.env.FLY_APP_NAME;
  }

  /**
   * Check if a URL or error is localhost-related
   */
  isLocalhostRelated(urlOrError) {
    const str = typeof urlOrError === 'string' ? urlOrError : urlOrError?.message || '';
    return str.includes('localhost') || 
           str.includes('127.0.0.1') || 
           str.includes('::1');
  }

  /**
   * Network namespace management methods
   */
  setNetworkName(networkName) {
    if (this.isRunning) {
      throw new Error('Cannot change network name while server is running. Stop first.');
    }
    
    this.networkName = networkName || 'PeerPigeonHub';
    
    // Update mesh options
    this.meshOptions = {
      ...this.meshOptions,
      networkName: this.networkName
    };
    
    console.log(`🌐 PigeonHub network name set to: ${this.networkName}`);
    return this.networkName;
  }

  getNetworkName() {
    return this.networkName;
  }

  getOriginalNetworkName() {
    return this.mesh?.getOriginalNetworkName?.() || this.networkName;
  }

  isUsingGlobalFallback() {
    return this.mesh?.isUsingGlobalFallback?.() || false;
  }

  setAllowGlobalFallback(allow) {
    this.allowGlobalFallback = allow !== false;
    
    // Update mesh options
    this.meshOptions = {
      ...this.meshOptions,
      allowGlobalFallback: this.allowGlobalFallback
    };
    
    if (this.mesh?.setAllowGlobalFallback) {
      this.mesh.setAllowGlobalFallback(this.allowGlobalFallback);
    }
    
    console.log(`🔄 PigeonHub global fallback ${allow ? 'enabled' : 'disabled'}`);
    return this.allowGlobalFallback;
  }

  getNetworkInfo() {
    return {
      networkName: this.networkName,
      originalNetworkName: this.getOriginalNetworkName(),
      isInFallbackMode: this.isUsingGlobalFallback(),
      allowGlobalFallback: this.allowGlobalFallback
    };
  }

  /**
   * Initialize the PeerPigeon mesh
   */
  async initializeMesh() {
    try {
      // Use shared mesh if provided, otherwise create new mesh
      if (this.sharedMesh) {
        console.log(`🔗 Using network-specific shared mesh for network '${this.networkName}'...`);
        this.mesh = this.sharedMesh;
        console.log(`✅ Using network-specific mesh with peer ID: ${this.mesh.peerId}`);
        console.log(`🌐 Hub Network: ${this.mesh.getNetworkName?.() || this.networkName} (ISOLATED)`);
      } else {
        // Initialize WebRTC first
        await initializeWebRTC();
        
        console.log(`🔄 Creating new mesh for hub network '${this.networkName}'...`);
        this.mesh = new PeerPigeonMesh(this.meshOptions);
        
        // IMMEDIATE STATUS CHECK
        console.log(`📊 Created mesh with peer ID: ${this.mesh.peerId || 'pending'}`);
        console.log(`📊 Initial peer count: ${this.mesh.getConnectedPeerCount?.() || 0}`);
        
        // Initialize mesh IMMEDIATELY with fast settings
        console.log("� FAST INIT: Initializing PeerPigeon mesh with aggressive settings...");
        const initPromise = this.mesh.init();
        
        // Don't wait for init to complete, but log when it does
        initPromise.then(() => {
          console.log("⚡ INSTANT MESH READY - Peer ID:", this.mesh.peerId);
          console.log(`🌐 Network: ${this.mesh.getNetworkName?.() || this.networkName}`);
          console.log(`� Peer count: ${this.mesh.getConnectedPeerCount?.() || 0}`);
          
          // Force immediate discovery after init
          if (this.mesh.startDiscovery) {
            this.mesh.startDiscovery();
            console.log("🔍 FORCED immediate peer discovery");
          }
        }).catch(err => {
          console.error('❌ Fast mesh init failed:', err);
        });
      }
      
      // Set up comprehensive mesh event listeners 
      this.mesh.addEventListener('peerConnected', (data) => {
        console.log(`🚀 HUB-TO-HUB CONNECTION! Peer: ${data.peerId.substring(0, 8)}...`);
        console.log(`📊 Total mesh peers: ${this.mesh.getConnectedPeerCount()}`);
        console.log(`⚡ Connected at: ${new Date().toISOString()}`);
      });
      
      this.mesh.addEventListener('peerDisconnected', (data) => {
        console.log(`💔 HUB DISCONNECTED! Peer: ${data.peerId.substring(0, 8)}...`);
        console.log(`📊 Remaining mesh peers: ${this.mesh.getConnectedPeerCount()}`);
      });
      
      this.mesh.addEventListener('peerDiscovered', (data) => {
        console.log(`🔍 HUB DISCOVERED! Peer: ${data.peerId.substring(0, 8)}... - attempting connection...`);
      });
      
      this.mesh.addEventListener('signalingConnected', (data) => {
        console.log(`📡 SIGNALING CONNECTED! URL: ${data.url}`);
      });
      
      this.mesh.addEventListener('signalingDisconnected', (data) => {
        console.log(`📡 SIGNALING DISCONNECTED! URL: ${data.url}`);
      });
      
      this.mesh.addEventListener('error', (data) => {
        console.log(`❌ MESH ERROR: ${data.error}`);
      });
      
      this.mesh.addEventListener('peerDisconnected', (data) => {
        console.log(`💔 Peer disconnected: ${data.peerId.substring(0, 8)}...`);
        console.log(`📊 Remaining peers: ${this.mesh.getConnectedPeerCount()}`);
        
        // DO NOT announce peer disconnections to WebDHT
        // Peers should remain discoverable and connected even when they disconnect from this hub
        
        // Attempt to reconnect if we've dropped below minimum peers immediately
        const currentPeers = this.mesh.getConnectedPeerCount();
        const minPeers = this.meshOptions.minPeers || 1;
        if (currentPeers < minPeers) {
          console.log(`🔄 MESH RECONNECT: Below minimum peers (${currentPeers}/${minPeers}), triggering discovery...`);
          if (this.mesh.startDiscovery) {
            this.mesh.startDiscovery().catch(err => {
              console.log(`⚠️  MESH RECONNECT FAILED: ${err.message}`);
            });
          }
        }
      });
      
      this.mesh.addEventListener('peerDiscovered', (data) => {
        console.log(`🎯 MESH DEBUG: Peer discovered: ${data.peerId.substring(0, 8)}...`);
        console.log(`🎯 MESH DEBUG: Attempting to connect to discovered peer...`);
        
        // Ensure mesh attempts to connect to discovered peer
        try {
          if (this.mesh.connectToPeer) {
            console.log(`🔗 MESH CONNECT: Explicitly connecting to peer ${data.peerId.substring(0, 8)}...`);
            this.mesh.connectToPeer(data.peerId).catch(err => {
              console.log(`⚠️  MESH CONNECT: Failed to connect to ${data.peerId.substring(0, 8)}...: ${err.message}`);
            });
          }
        } catch (connectError) {
          console.log(`⚠️  MESH CONNECT ERROR: ${connectError.message}`);
        }
      });
      
      // Handle connection failures
      this.mesh.addEventListener('connectionFailed', (data) => {
        console.log(`❌ MESH CONNECTION FAILED: ${data.peerId?.substring(0, 8)}... - ${data.error || 'Unknown error'}`);
        
        // Retry connection immediately if we have few connections
        const currentPeers = this.mesh.getConnectedPeerCount();
        const maxPeers = this.meshOptions.maxPeers || 5;
        if (currentPeers < Math.floor(maxPeers / 2)) {
          console.log(`🔄 MESH RETRY: Retrying connection to ${data.peerId?.substring(0, 8)}...`);
          if (this.mesh.connectToPeer) {
            this.mesh.connectToPeer(data.peerId).catch(retryErr => {
              console.log(`⚠️  MESH RETRY FAILED: ${retryErr.message}`);
            });
          }
        }
      });
      
      console.log("🎯 MESH DEBUG: Event listeners set up for peer discovery debugging");
      
    } catch (err) {
      console.error('Failed to initialize PeerPigeon Mesh:', err);
      throw err;
    }
  }

  /**
        // Let PeerPigeon handle its own protocol messages
        console.log(`� MESH MESSAGE: Received from ${data.from.substring(0, 8)}...`);
        
        // Try to parse the content as JSON for cross-bootstrap signaling only
        let messageContent;
        try {
          messageContent = JSON.parse(data.content);
        } catch (error) {
          // If it's not JSON, it's likely a standard PeerPigeon message - let it be processed normally
          return;
        }
        
        // Only handle our custom cross-bootstrap signaling, let PeerPigeon handle client messages
        if (messageContent && messageContent.type === 'cross-bootstrap-signaling') {
          const signalNetworkName = messageContent.networkName || 'global';
          console.log(`🌐 CROSS-BOOTSTRAP RECEIVE: Routing ${messageContent.originalMessage.type} from ${messageContent.originalMessage.fromPeerId.substring(0, 8)} to ${messageContent.targetPeerId.substring(0, 8)} (network: ${signalNetworkName})`);
          
          // Another bootstrap node is requesting signaling routing
          const targetPeerId = messageContent.targetPeerId;
          const originalMessage = messageContent.originalMessage;
          
          // Validate network namespace for target peer
          const targetPeerData = this.peerData.get(targetPeerId);
          const targetNetworkName = targetPeerData?.networkName || 'global';
          
          // Check if networks are compatible
          const networksCompatible = targetNetworkName === signalNetworkName || 
                                   (this.allowGlobalFallback && (targetNetworkName === 'global' || signalNetworkName === 'global'));
          
          if (!networksCompatible) {
            console.log(`🚫 CROSS-BOOTSTRAP NETWORK MISMATCH: Blocking signal from '${signalNetworkName}' to '${targetNetworkName}' peer`);
            return;
          }
          
          // Try to route to the target peer if it's connected locally
          const success = this.sendToSpecificPeer(targetPeerId, originalMessage);
          if (success) {
            console.log(`✅ CROSS-BOOTSTRAP SUCCESS: ${originalMessage.type} routed to local peer ${targetPeerId.substring(0, 8)}... (network: ${targetNetworkName})`);
          } else {
            console.log(`❌ CROSS-BOOTSTRAP FAILED: Target peer ${targetPeerId.substring(0, 8)} not found locally (network: ${targetNetworkName})`);
          }
        }
      });
      
      // Subscribe to WebDHT for cross-hub peer discovery
      if (this.mesh.webDHT) {
        console.log("🌐 Setting up WebDHT subscription for cross-hub peer discovery");
        
        // Subscribe to peer announcements in the WebDHT
        this.mesh.webDHT.subscribe('peer-announcements', (data) => {
          console.log(`🔍 WebDHT: Received peer announcement for ${data.peerId?.substring(0, 8)}...`);
          
          // Validate network compatibility
          const peerNetworkName = data.networkName || 'global';
          if (peerNetworkName === this.networkName || 
              (this.allowGlobalFallback && (peerNetworkName === 'global' || this.networkName === 'global'))) {
            
            // Announce this peer to all our local WebSocket connections
            for (const [localPeerId, connection] of this.connections) {
              if (connection.readyState === WebSocket.OPEN && this.isConnectionAlive(connection)) {
                this.sendToConnection(localPeerId, {
                  type: 'peer-discovered',
                  data: { peerId: data.peerId, ...data.metadata },
                  fromPeerId: 'webdht',
                  targetPeerId: localPeerId,
                  networkName: peerNetworkName,
                  timestamp: Date.now()
                });
              }
            }
          }
        });
        
        // Method to announce local peers to WebDHT
        this.announceLocalPeersToWebDHT = () => {
          for (const [peerId, peerData] of this.peerData) {
            if (peerData.connected) {
              this.mesh.webDHT.publish('peer-announcements', {
                peerId: peerId,
                networkName: peerData.networkName || this.networkName,
                metadata: peerData.data,
                timestamp: Date.now(),
                hubId: this.mesh.peerId
              });
            }
          }
        };
      } else {
        console.log("⚠️  WebDHT not available - cross-hub discovery disabled");
      }
      
      console.log("🎯 MESH DEBUG: Event listeners set up for peer discovery debugging");
      
    } catch (err) {
      console.error('Failed to initialize PeerPigeon Mesh:', err);
      throw err;
    }
  }

  /**
   * Find an available port starting from the specified port
   */
  async findAvailablePort(startPort, host = 'localhost') {
    const net = await import('net');
    
    return new Promise((resolve) => {
      const server = net.createServer();
      
      server.listen(startPort, host, () => {
        const port = server.address().port;
        server.close(() => {
          resolve(port);
        });
      });
      
      server.on('error', () => {
        // Port is in use, try the next one
        this.findAvailablePort(startPort + 1, host).then(resolve);
      });
    });
  }

  /**
   * Validate peer ID format
   */
  validatePeerId(peerId) {
    return typeof peerId === 'string' && /^[a-fA-F0-9]{40}$/.test(peerId);
  }

  /**
   * Find closest peers using XOR distance calculation
   */
  findClosestPeers(targetPeerId, allPeerIds, maxPeers = 3) {
    if (!targetPeerId || !allPeerIds || allPeerIds.length === 0) {
      return [];
    }

    // XOR distance calculation (simplified)
    const distances = allPeerIds.map(peerId => {
      let distance = 0;
      const minLength = Math.min(targetPeerId.length, peerId.length);

      for (let i = 0; i < minLength; i++) {
        const xor = parseInt(targetPeerId[i], 16) ^ parseInt(peerId[i], 16);
        distance += xor;
      }

      return { peerId, distance };
    });

    // Sort by distance and return closest peers
    distances.sort((a, b) => a.distance - b.distance);
    return distances.slice(0, maxPeers).map(item => item.peerId);
  }

  /**
   * Get active local WebSocket peers only (excludes mesh peers)
   */
  getLocalPeers(excludePeerId = null) {
    const peers = [];
    const stalePeers = [];

    // Add only local WebSocket connections
    for (const [peerId, connection] of this.connections) {
      if (peerId !== excludePeerId) {
        if (connection.readyState === WebSocket.OPEN && this.isConnectionAlive(connection)) {
          peers.push(peerId);
        } else {
          // Mark stale connections for cleanup
          stalePeers.push(peerId);
        }
      }
    }

    // Clean up stale connections
    stalePeers.forEach(peerId => {
      console.log(`🧹 Cleaning up stale connection: ${peerId.substring(0, 8)}...`);
      this.connections.delete(peerId);
      this.peerData.delete(peerId);
    });

    return peers;
  }

  /**
   * Get mesh peers only (other bootstrap nodes)
   */
  getMeshPeers(excludePeerId = null) {
    const meshPeers = [];
    
    if (this.mesh) {
      const peers = this.mesh.getPeers() || [];
      peers.forEach(meshPeer => {
        if (meshPeer.peerId && meshPeer.peerId !== excludePeerId) {
          meshPeers.push(meshPeer.peerId);
        }
      });
    }

    return meshPeers;
  }

  /**
   * Get active peers and clean up stale connections
   * Includes both local WebSocket connections AND mesh peers
   */
  getActivePeers(excludePeerId = null) {
    const localPeers = this.getLocalPeers(excludePeerId);
    const meshPeers = this.getMeshPeers(excludePeerId);
    
    return [...localPeers, ...meshPeers];
  }

  /**
   * Check if a connection is alive
   */
  isConnectionAlive(connection) {
    if (!connection || connection.readyState !== WebSocket.OPEN) {
      return false;
    }

    // Simple alive check - if connection is open, it's considered alive
    // Detailed health monitoring is handled by the peer mesh itself
    return true;
  }

  /**
   * Send data to a specific connection
   */
  sendToConnection(peerId, data) {
    const connection = this.connections.get(peerId);
    if (connection && connection.readyState === WebSocket.OPEN) {
      try {
        connection.send(JSON.stringify(data));
        return true;
      } catch (error) {
        console.error(`Error sending to ${peerId}:`, error);
        // Clean up failed connection
        this.cleanupPeer(peerId);
        return false;
      }
    } else if (connection && (connection.readyState === WebSocket.CLOSED || connection.readyState === WebSocket.CLOSING)) {
      // Clean up closed connection
      this.cleanupPeer(peerId);
    }
    return false;
  }

  /**
   * Clean up a WebSocket connection without affecting peer-to-peer connections
   */
  cleanupPeer(peerId) {
    const wasConnected = this.connections.has(peerId);
    this.connections.delete(peerId);
    this.peerData.delete(peerId);

    if (wasConnected) {
      console.log(`🧹 Cleaned up WebSocket for peer: ${peerId.substring(0, 8)}... (peer-to-peer connections remain intact)`);
      
      // DO NOT notify other peers about WebSocket disconnection
      // Peers should remain connected to each other even if they lose WebSocket connection to hub
      // Only the mesh itself should handle actual peer disconnections
    }
  }

  /**
   * Broadcast message to closest peers
   */
  broadcastToClosestPeers(fromPeerId, message, maxPeers = 5) {
    const activePeers = this.getActivePeers(fromPeerId);
    const closestPeers = this.findClosestPeers(fromPeerId, activePeers, maxPeers);

    console.log(`Broadcasting from ${fromPeerId} to ${closestPeers.length} closest peers`);

    closestPeers.forEach(peerId => {
      this.sendToConnection(peerId, message);
    });
  }

  /**
   * Send message to a specific peer
   */
  sendToSpecificPeer(targetPeerId, message) {
    return this.sendToConnection(targetPeerId, message);
  }

  /**
   * Set up periodic cleanup of stale connections
   */
  setupPeriodicCleanup() {
    this.cleanupInterval = setInterval(() => {
      const totalConnections = this.connections.size;
      this.getActivePeers(); // This will clean up stale connections
      const cleanedUp = totalConnections - this.connections.size;

      if (cleanedUp > 0) {
        console.log(`🧹 Periodic cleanup: removed ${cleanedUp} stale connections, ${this.connections.size} active`);
      }
      
      // Additional connection health check - encourage connections if peers are isolated
      this.checkConnectionHealth();
    }, 30000); // Clean up every 30 seconds
  }

  /**
   * Check connection health and encourage peer connections
   */
  checkConnectionHealth() {
    const activePeers = this.getLocalPeers();
    
    // If we have multiple peers but they might not be connected to each other, encourage connections
    if (activePeers.length >= 2) {
      console.log(`🔍 HEALTH CHECK: ${activePeers.length} active peers - checking connectivity`);
      
      // For each peer, ensure they know about other peers (in case some were missed)
      activePeers.forEach(peerId => {
        const otherPeers = activePeers.filter(otherId => otherId !== peerId).slice(0, 3); // Limit to 3 peers
        
        if (otherPeers.length > 0) {
          const peerData = this.peerData.get(peerId);
          const peerNetworkName = peerData?.networkName || 'global';
          
          otherPeers.forEach(otherId => {
            const otherPeerData = this.peerData.get(otherId);
            const otherNetworkName = otherPeerData?.networkName || 'global';
            
            // Only suggest connections within compatible networks
            if (peerNetworkName === otherNetworkName || 
                (this.allowGlobalFallback && (peerNetworkName === 'global' || otherNetworkName === 'global'))) {
              
              // Send a gentle connection reminder
              this.sendToConnection(peerId, {
                type: 'peer-discovered',
                data: { peerId: otherId, ...otherPeerData?.data },
                fromPeerId: 'health-check',
                targetPeerId: peerId,
                networkName: this.networkName,
                timestamp: Date.now()
              });
            }
          });
        }
      });
    }
  }

  /**
   * Handle WebSocket connection
   */
  handleConnection(ws, req) {
    // Extract peerId from query parameters (optional - for compatibility)
    const url = new URL(req.url, `http://${req.headers.host}`);
    const queryPeerId = url.searchParams.get('peerId');
    const queryNetworkName = url.searchParams.get('networkName') || this.networkName;

    let peerId = null;

    // If peerId is provided in query, validate it
    if (queryPeerId) {
      if (!/^[a-fA-F0-9]{40}$/.test(queryPeerId)) {
        console.log(`❌ Invalid peerId format: ${queryPeerId}, closing connection`);
        ws.close(1008, 'Invalid peerId format - must be 40 hex characters');
        return;
      }
      
      peerId = queryPeerId;
      console.log(`✅ Peer connected with query peerId: ${peerId.substring(0, 8)}... (${this.connections.size + 1} total)`);
    } else {
      // PeerPigeon browser clients connect without peerId - wait for first message
      console.log(`� Browser peer connected, waiting for identification...`);
    }

    // Store connection (temporarily without peerId if needed)
    if (peerId) {
      // Check if peerId is already connected
      if (this.connections.has(peerId)) {
        const existingConnection = this.connections.get(peerId);
        if (existingConnection.readyState === WebSocket.OPEN) {
          console.log(`⚠️  Peer ${peerId.substring(0, 8)}... already connected, closing duplicate`);
          ws.close(1008, 'Peer already connected');
          return;
        } else {
          console.log(`🔄 Replacing stale connection for ${peerId.substring(0, 8)}...`);
          this.cleanupPeer(peerId);
        }
      }

      this.connections.set(peerId, ws);
      this.peerData.set(peerId, {
        peerId,
        networkName: queryNetworkName,
        timestamp: Date.now(),
        connected: true,
        connectedAt: Date.now(),
        lastActivity: Date.now()
      });

      // Send connection confirmation
      ws.send(JSON.stringify({
        type: 'connected',
        data: { peerId },
        fromPeerId: 'system',
        timestamp: Date.now()
      }));
    } else {
      // Store temporarily with a temp ID until we get the real peerId
      const tempId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      ws.tempId = tempId;
      ws.pendingIdentification = true;
    }

    // Set up connection metadata
    ws.connectedAt = Date.now();

    // Handle incoming messages - peer is already identified
    ws.on('message', (data) => this.handleMessage(ws, peerId, data));

    // Handle connection close
    ws.on('close', (code, reason) => {
      console.log(`🔌 WebSocket disconnected for peer ${peerId?.substring(0, 8)}... (${code}: ${reason}) - peer-to-peer connections remain active`);

      if (peerId) {
        this.cleanupPeer(peerId);
      }

      console.log(`📊 Active WebSocket connections: ${this.connections.size}`);
    });

    // Handle connection errors
    ws.on('error', (error) => {
      // Use less severe logging for localhost-related errors when running in cloud
      if (this.isLocalhostRelated(error) && this.isCloudDeployment()) {
        console.log(`ℹ️  Localhost peer connection issue for ${peerId?.substring(0, 8)}...: ${error.message}`);
      } else {
        console.error(`❌ WebSocket error for ${peerId?.substring(0, 8)}...:`, error);
      }

      // Clean up errored WebSocket connection (peer-to-peer connections remain intact)
      if (peerId && (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING)) {
        this.cleanupPeer(peerId);
      }
    });
  }
  /**
   * Handle incoming WebSocket messages
   */
  handleMessage(ws, initialPeerId, data) {
    try {
      console.log(`🔍 RAW MESSAGE: Received data from ${initialPeerId || ws.tempId || 'unknown'}: ${data.toString().substring(0, 200)}...`);
      
      const message = JSON.parse(data);
      const { type, data: messageData, targetPeerId, networkName } = message;

      console.log(`📨 PARSED MESSAGE: type=${type}, peerId=${message.peerId || messageData?.peerId || 'none'}, network=${networkName || 'none'}`);
      console.log(`🚨 FULL MESSAGE STRUCTURE:`, {
        type: message.type,
        hasNetworkName: !!message.networkName,
        networkName: message.networkName,
        hasDataNetworkName: !!(messageData && messageData.networkName),
        dataNetworkName: messageData?.networkName,
        allKeys: Object.keys(message)
      });

      // Extract peerId from message if not provided at connection
      let peerId = initialPeerId;
      if (!peerId && message.peerId) {
        peerId = message.peerId;
        console.log(`🆔 Extracted peerId from message.peerId: ${peerId.substring(0, 8)}...`);
      }
      if (!peerId && messageData && messageData.peerId) {
        peerId = messageData.peerId;
        console.log(`🆔 Extracted peerId from messageData.peerId: ${peerId.substring(0, 8)}...`);
      }

      // Check network namespace compatibility
      const clientNetworkName = networkName || 'global'; // Default for backward compatibility
      if (clientNetworkName !== this.networkName && clientNetworkName !== 'global' && this.networkName !== 'global') {
        // Network mismatch - only allow if one is global or fallback is enabled
        if (!this.allowGlobalFallback) {
          console.log(`🚫 Network mismatch: client '${clientNetworkName}' vs server '${this.networkName}', message rejected`);
          return;
        } else {
          console.log(`🔄 Network fallback: client '${clientNetworkName}' connecting to '${this.networkName}'`);
        }
      }

      // Only log signaling messages, not regular peer messages
      const isSignalingMessage = ['announce', 'offer', 'answer', 'ice-candidate'].includes(type);
      if (isSignalingMessage) {
        console.log(`📨 Received ${type} from ${peerId?.substring(0, 8) || 'unknown'}... (network: ${clientNetworkName})`);
      }

      const responseMessage = {
        type,
        data: messageData,
        fromPeerId: peerId,
        targetPeerId,
        networkName: this.networkName, // Include server's network name
        timestamp: Date.now()
      };

      // Handle different message types - SIGNALING ONLY
      switch (type) {
        case 'connection-status': {
          // Handle connection status updates from peers
          const { targetPeerId: statusTargetPeerId, status, error } = messageData || {};
          
          console.log(`📊 CONNECTION STATUS: ${peerId.substring(0, 8)} -> ${statusTargetPeerId?.substring(0, 8)}: ${status}${error ? ` (${error})` : ''}`);
          
          // If connection failed, we could potentially retry or suggest alternative peers
          if (status === 'failed' && statusTargetPeerId) {
            console.log(`⚠️  Connection failed between ${peerId.substring(0, 8)} and ${statusTargetPeerId.substring(0, 8)}, checking for alternatives...`);
            
            // Find other available peers for the failed peer
            const activePeers = this.getLocalPeers(peerId).filter(otherPeerId => {
              const otherPeerData = this.peerData.get(otherPeerId);
              const otherNetworkName = otherPeerData?.networkName || 'global';
              return otherPeerId !== statusTargetPeerId && // Exclude the failed peer
                     (otherNetworkName === clientNetworkName || 
                      (this.allowGlobalFallback && (otherNetworkName === 'global' || clientNetworkName === 'global')));
            });
            
            if (activePeers.length > 0) {
              console.log(`🔄 RETRY: Suggesting ${activePeers.length} alternative peers to ${peerId.substring(0, 8)}`);
              activePeers.slice(0, 2).forEach(alternativePeerId => { // Limit to 2 alternatives
                this.sendToConnection(peerId, {
                  type: 'initiate-connection',
                  targetPeerId: alternativePeerId,
                  fromPeerId: 'system',
                  retry: true,
                  timestamp: Date.now()
                });
              });
            }
          }
          break;
        }

        case 'announce': {
          console.log(`� Received announce from ${peerId.substring(0, 8)}... (network: ${clientNetworkName})`);
          this.handleAnnounce(peerId, messageData, ws);
          break;
        }

        case 'goodbye': {
          // Handle peer disconnect
          this.peerData.delete(peerId);
          this.broadcastToClosestPeers(peerId, responseMessage);
          break;
        }

        case 'offer':
        case 'answer':
        case 'ice-candidate': {
          // CRITICAL DEBUG: Log all signaling messages
          if (type === 'offer') {
            console.log(`🚨 SIGNALING CRITICAL: ${type} from ${peerId.substring(0, 8)} to ${targetPeerId?.substring(0, 8)} (network: ${clientNetworkName})`);
          } else if (type === 'answer') {
            console.log(`🚨 SIGNALING CRITICAL: ${type} from ${peerId.substring(0, 8)} to ${targetPeerId?.substring(0, 8)} (network: ${clientNetworkName})`);
            console.log('🔍 WEBSOCKET DEBUG: Received answer message:', {
              type,
              fromPeerId: peerId?.substring(0, 8) + '...',
              targetPeerId: targetPeerId?.substring(0, 8) + '...',
              hasTargetPeerId: !!targetPeerId,
              hasData: !!messageData,
              networkName: clientNetworkName
            });
          } else if (type === 'ice-candidate') {
            console.log(`🧊 ICE CANDIDATE: from ${peerId.substring(0, 8)} to ${targetPeerId?.substring(0, 8)} (network: ${clientNetworkName})`);
          }

          console.log(`🚨 SWITCH: Reached ${type} case for ${peerId.substring(0, 8)}`);

          // Handle WebRTC signaling - this is the server's primary purpose
          if (targetPeerId) {
            // Validate network namespace for target peer before routing
            const targetPeerData = this.peerData.get(targetPeerId);
            const targetNetworkName = targetPeerData?.networkName || 'global';
            
            // Check if sender and target are in compatible networks
            const networksCompatible = targetNetworkName === clientNetworkName || 
                                     (this.allowGlobalFallback && (targetNetworkName === 'global' || clientNetworkName === 'global'));
            
            if (!networksCompatible) {
              console.log(`🚫 NETWORK MISMATCH: Blocking ${type} from '${clientNetworkName}' to '${targetNetworkName}' peer`);
              return;
            }
            
            console.log(`✅ NETWORK COMPATIBLE: Routing ${type} from '${clientNetworkName}' to '${targetNetworkName}' peer`);
            
            // Try to send to local peer first
            const success = this.sendToSpecificPeer(targetPeerId, responseMessage);
            if (!success) {
              console.log(`⚠️  Failed to send ${type} to ${targetPeerId.substring(0, 8)}... (peer not found locally)`);
              
              // If target peer is not local, route through mesh to other bootstrap nodes
              const meshPeers = this.getMeshPeers();
              if (this.mesh && meshPeers.length > 0) {
                console.log(`🌐 CROSS-BOOTSTRAP ROUTING: Sending ${type} from ${peerId.substring(0, 8)} to ${targetPeerId.substring(0, 8)} via mesh (network: ${clientNetworkName})`);
                
                // Send to all mesh peers to find the one that has the target peer
                let routedSuccessfully = false;
                meshPeers.forEach(meshPeerId => {
                  try {
                    const message = {
                      type: 'cross-bootstrap-signaling',
                      originalMessage: responseMessage,
                      targetPeerId: targetPeerId,
                      networkName: clientNetworkName, // Include network namespace
                      fromBootstrapNode: this.mesh.peerId,
                      timestamp: Date.now()
                    };
                    this.mesh.sendDirectMessage(meshPeerId, JSON.stringify(message));
                    routedSuccessfully = true;
                  } catch (error) {
                    console.error(`❌ Failed to route ${type} via mesh peer ${meshPeerId.substring(0, 8)}:`, error);
                  }
                });
                
                if (!routedSuccessfully) {
                  console.log(`❌ ROUTING FAILED: No mesh peers available to route ${type} to ${targetPeerId.substring(0, 8)}`);
                }
              } else {
                console.log(`❌ ROUTING FAILED: No mesh available for cross-bootstrap routing`);
              }
            } else if (type === 'answer') {
              console.log(`✅ WEBSOCKET DEBUG: Answer successfully routed to ${targetPeerId.substring(0, 8)}...`);
            } else {
              console.log(`✅ SIGNALING SUCCESS: ${type} routed to ${targetPeerId.substring(0, 8)}...`);
            }
          } else {
            console.log(`⚠️  ${type} message missing targetPeerId`);
          }
          break;
        }

        default:
          // Signaling server should NOT route regular peer messages
          // Peers handle their own message routing through WebRTC data channels
          console.log(`⚠️  Ignoring non-signaling message type '${type}' - peers should route their own messages`);
          ws.send(JSON.stringify({
            type: 'error',
            error: `Signaling server does not route '${type}' messages. Use WebRTC data channels for peer-to-peer communication.`,
            timestamp: Date.now()
          }));
          break;
      }
    } catch (error) {
      console.error(`❌ Error handling message from ${initialPeerId || ws.tempId || 'unknown'}:`, error);
      console.error(`❌ Raw data that caused error: ${data.toString()}`);
      
      try {
        ws.send(JSON.stringify({
          type: 'error',
          error: 'Invalid message format',
          timestamp: Date.now()
        }));
      } catch (sendError) {
        console.error(`❌ Failed to send error response: ${sendError.message}`);
      }
    }
  }

  /**
   * Start the PigeonHub server
   */
  async start() {
    if (this.isRunning) {
      console.log('⚠️  PigeonHub is already running');
      return;
    }

    try {
      // Initialize PeerPigeon mesh asynchronously - don't block startup
      this.initializeMesh().catch(err => {
        console.error('❌ Mesh initialization failed:', err);
      });

      // Find available port
      const availablePort = await this.findAvailablePort(this.port, this.host);
      if (availablePort !== this.port) {
        console.log(`⚠️  Port ${this.port} is in use, using port ${availablePort} instead`);
        this.port = availablePort;
      }

      // Create HTTP server
      this.server = createServer();

      // Add health check endpoint
      this.server.on('request', (req, res) => {
        // Enable CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
          res.writeHead(200);
          res.end();
          return;
        }

        if (req.url === '/health' && req.method === 'GET') {
          try {
            const health = {
              status: 'healthy',
              timestamp: Date.now(),
              port: this.port,
              isRunning: this.isRunning,
              connections: this.connections.size,
              peerId: this.mesh?.peerId?.substring(0, 8) + '...'
            };

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(health));
          } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'unhealthy', error: error.message }));
          }
        } else if (req.url === '/status' && req.method === 'GET') {
          try {
            const status = this.getStatus();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(status, null, 2));
          } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
          }
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
        }
      });

      // Create WebSocket server
      this.wss = new WebSocketServer({ server: this.server });

      console.log('🚀 Starting PeerPigeon WebSocket server...');

      // Set up WebSocket connection handling
      this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));

      // Set up periodic cleanup
      this.setupPeriodicCleanup();

      // Start server
      await new Promise((resolve, reject) => {
        this.server.listen(this.port, this.host, (error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });

      this.isRunning = true;

      console.log(`🌐 PeerPigeon WebSocket server running on ws://${this.host}:${this.port}`);
      console.log('📝 Usage: Connect with ?peerId=<40-char-hex-id>');
      console.log('📊 Ready to handle peer connections...');

      // Connect to other signaling servers if specified (asynchronously - don't block)
      this.connectToSignalingServers().catch(err => {
        console.log('⚠️ Signaling server connection failed:', err.message);
      });

    } catch (error) {
      console.error('❌ Failed to start server:', error);
      throw error;
    }
  }

  /**
   * Connect to other signaling servers for mesh discovery
   */
  async connectToSignalingServers() {
    const signalingServers = this.signalingServers;
    
    if (!signalingServers || !Array.isArray(signalingServers) || signalingServers.length === 0) {
      console.log('ℹ️  No external signaling servers configured for mesh discovery');
      return;
    }
    
    console.log(`🔗 Connecting to ${signalingServers.length} signaling server(s) for mesh discovery...`);
    
    // Connect to all servers asynchronously without blocking
    signalingServers.forEach(serverUrl => {
      console.log(`🔗 IMMEDIATE: Starting connection to ${serverUrl}`);
      this.mesh.connect(serverUrl).then(() => {
        console.log(`✅ IMMEDIATE: Connected to signaling server: ${serverUrl}`);
        console.log(`� IMMEDIATE: Peer count after connection: ${this.mesh.getConnectedPeerCount?.() || 0}`);
        console.log(`�🔍 Peer discovery active for ${serverUrl}`);
      }).catch(error => {
        console.log(`❌ IMMEDIATE: Connection failed to ${serverUrl}: ${error.message}`);
        if (this.isLocalhostRelated(serverUrl)) {
          console.log(`ℹ️  Localhost signaling server not available: ${serverUrl} (${error.message})`);
        } else {
          console.warn(`⚠️  Failed to connect to signaling server ${serverUrl}: ${error.message}`);
        }
      });
    });
    
    console.log('🌐 Mesh discovery connections initiated (running asynchronously)');
  }

  /**
   * Stop the PigeonHub server
   */
  async stop() {
    if (!this.isRunning) {
      console.log('⚠️  PigeonHub is not running');
      return;
    }

    console.log('🛑 Shutting down PigeonHub server...');

    // Clear cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Close all connections
    for (const [, connection] of this.connections) {
      connection.close(1001, 'Server shutting down');
    }

    // Close WebSocket server
    if (this.wss) {
      this.wss.close();
    }

    // Close HTTP server
    if (this.server) {
      await new Promise((resolve) => {
        this.server.close(() => {
          resolve();
        });
      });
    }

    // Clean up state
    this.connections.clear();
    this.peerData.clear();
    this.isRunning = false;

    console.log('✅ PigeonHub server stopped');
  }

  /**
   * Get server status and statistics
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      port: this.port,
      host: this.host,
      activeConnections: this.connections.size,
      peerId: this.mesh?.peerId,
      meshOptions: this.meshOptions
    };
  }

  // Simple message forwarding methods (PeerPigeon style)
  forwardSignalingMessage(fromPeerId, message) {
    const targetPeerId = message.targetPeerId;
    if (!targetPeerId) {
      console.log(`❌ No target peer ID in signaling message from ${fromPeerId.substring(0, 8)}...`);
      return;
    }

    // Try same-hub forwarding first
    const targetConnection = this.connections.get(targetPeerId);
    if (targetConnection && targetConnection.readyState === WebSocket.OPEN) {
      // Same-hub forwarding
      targetConnection.send(JSON.stringify({
        ...message,
        fromPeerId,
        timestamp: Date.now()
      }));
      console.log(`🔄 Same-hub: Forwarded ${message.type} from ${fromPeerId.substring(0, 8)}... to ${targetPeerId.substring(0, 8)}...`);
      return;
    }

    // Cross-hub forwarding via mesh
    if (this.mesh) {
      this.mesh.broadcast(JSON.stringify({
        ...message,
        fromPeerId,
        crossHub: true,
        timestamp: Date.now()
      }));
      console.log(`🌐 Cross-hub: Forwarded ${message.type} from ${fromPeerId.substring(0, 8)}... to ${targetPeerId.substring(0, 8)}... via mesh`);
    } else {
      console.log(`❌ Target peer ${targetPeerId.substring(0, 8)}... not found (no mesh available)`);
    }
  }

  forwardMessage(fromPeerId, message) {
    // Generic message forwarding - same logic as signaling
    this.forwardSignalingMessage(fromPeerId, message);
  }

  handleAnnounce(fromPeerId, message, ws) {
    console.log(`📢 Same-hub peer announced: ${fromPeerId.substring(0, 8)}...`);
    
    // Store peer data WITH NETWORK NAME
    this.peerData.set(fromPeerId, {
      peerId: fromPeerId,
      data: message.data,
      networkName: message.networkName || 'global',
      timestamp: Date.now()
    });
    
    // INSTANT SAME-HUB DISCOVERY: Broadcast peer-discovered to all other peers immediately (like official server)
    for (const [otherPeerId, connection] of this.connections.entries()) {
      if (otherPeerId !== fromPeerId && connection.readyState === WebSocket.OPEN) {
        connection.send(JSON.stringify({
          type: 'peer-discovered',
          data: {
            peerId: fromPeerId,
            timestamp: Date.now(),
            ...message.data
          },
          fromPeerId: 'system',
          timestamp: Date.now()
        }));
      }
    }
    
    // Cross-hub logic runs asynchronously in background (non-blocking)
    setImmediate(() => {
      if (this.mesh) {
        const meshPeers = this.getMeshPeers();
        const crossHubMessage = {
          type: 'client-peer-announcement',
          clientPeerId: fromPeerId,
          clientData: message.data,
          networkName: message.networkName || 'global',
          fromBootstrapNode: this.mesh.peerId,
          crossHub: true,
          timestamp: Date.now()
        };
        
        meshPeers.forEach(meshPeerId => {
          try {
            this.mesh.sendDirectMessage(meshPeerId, JSON.stringify(crossHubMessage));
          } catch (error) {
            console.error(`❌ Failed to announce to mesh peer ${meshPeerId.substring(0, 8)}:`, error);
          }
        });
        
        console.log(`🌐 Cross-hub: Announced ${fromPeerId.substring(0, 8)}... to ${meshPeers.length} mesh peers`);
      }
    });
  }

  handleGoodbye(fromPeerId, message, ws) {
    console.log(`👋 Peer goodbye: ${fromPeerId.substring(0, 8)}...`);
    
    // Clean up peer data
    this.peerData.delete(fromPeerId);
    
    // Broadcast goodbye to mesh
    if (this.mesh) {
      const meshPeers = this.getMeshPeers();
      const goodbyeMessage = {
        type: 'client-peer-goodbye',
        clientPeerId: fromPeerId,
        networkName: message.networkName || 'global',
        fromBootstrapNode: this.mesh.peerId,
        crossHub: true,
        timestamp: Date.now()
      };
      
      meshPeers.forEach(meshPeerId => {
        try {
          this.mesh.sendDirectMessage(meshPeerId, JSON.stringify(goodbyeMessage));
        } catch (error) {
          console.error(`❌ Failed to send goodbye to mesh peer ${meshPeerId.substring(0, 8)}:`, error);
        }
      });
      
      console.log(`👋 Cross-hub: Sent goodbye for ${fromPeerId.substring(0, 8)}... to ${meshPeers.length} mesh peers`);
    }
  }
}

// Example usage for testing
async function main() {
  const hub = new PigeonHub({
    port: 3000,
    host: 'localhost',
    signalingServers: [], // No signaling servers for main hub - others connect to it
    meshOptions: {
      maxPeers: 5,
      minPeers: 1,
      autoDiscovery: true,
      autoConnect: true,
      enableWebDHT: false,  // DISABLE WebDHT for instant hub connections
      enableCrypto: false,  // DISABLE crypto for faster connections
      signalingServerUrls: [], // Main hub doesn't need to connect to signaling servers
    }
  });

  try {
    await hub.start();
    console.log('� Server status:', hub.getStatus());

    // Handle graceful shutdown
    const cleanup = async () => {
      console.log('\n🛑 Received shutdown signal...');
      await hub.stop();
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

  } catch (error) {
    console.error('❌ Failed to start PigeonHub:', error);
    process.exit(1);
  }
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

// Export for programmatic use
export default PigeonHub;
export { PigeonHub };
