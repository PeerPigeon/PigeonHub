/**
 * WebSocket Server Controller
 * 
 * A programmatic interface to start and control WebSocket signaling servers
 * for bootstrap nodes with custom ports and cross-node relay functionality.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { URL } from 'url';
import { BOOTSTRAP_CONFIG } from '../config/bootstrap-config.js';

export class WebSocketServerController {
  constructor(options = {}) {
    this.options = {
      port: options.port || 3001,
      host: options.host || 'localhost',
      maxPeers: options.maxPeers || 100,
      ...options
    };

    this.server = null;
    this.wss = null;
    this.connections = new Map(); // peerId -> WebSocket connection
    this.peerData = new Map(); // peerId -> { peerId, timestamp, data }
    this.isRunning = false;
    this.crossNodeRelay = null;
    this.meshGateway = null; // Reference to bootstrap node's mesh for gateway functionality
    
    this.stats = {
      startTime: null,
      totalConnections: 0,
      messagesProcessed: 0,
      activeConnections: 0
    };
  }

  /**
   * Start the WebSocket server
   */
  async start() {
    if (this.isRunning) {
      console.log(`⚠️  WebSocket server already running on port ${this.options.port}`);
      return true;
    }

    try {
      console.log(`🚀 Starting WebSocket server on ${this.options.host}:${this.options.port}`);

      // Create HTTP server
      this.server = createServer();

      // Set up HTTP routes BEFORE WebSocket server
      this.setupHttpRoutes();

      // Create WebSocket server
      this.wss = new WebSocketServer({ server: this.server });

      // Set up WebSocket handling
      this.setupWebSocketHandling();

      // Start the server
      await new Promise((resolve, reject) => {
        this.server.listen(this.options.port, this.options.host, (error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });

      this.isRunning = true;
      this.stats.startTime = Date.now();

      console.log(`✅ WebSocket server running on ws://${this.options.host}:${this.options.port}`);
      console.log('📝 Usage: Connect with ?peerId=<40-char-hex-id>');

      // Start periodic cleanup
      this.startPeriodicCleanup();

      return true;

    } catch (error) {
      console.error(`❌ Failed to start WebSocket server:`, error);
      throw error;
    }
  }

  /**
   * Stop the WebSocket server
   */
  async stop() {
    if (!this.isRunning) return;

    try {
      console.log(`🛑 Stopping WebSocket server on port ${this.options.port}...`);

      // Close all connections
      for (const [peerId, connection] of this.connections) {
        if (connection.readyState === WebSocket.OPEN) {
          connection.close(1001, 'Server shutting down');
        }
      }

      // Close the server
      if (this.wss) {
        this.wss.close();
      }

      if (this.server) {
        await new Promise((resolve) => {
          this.server.close(resolve);
        });
      }

      this.isRunning = false;
      console.log(`✅ WebSocket server stopped`);

    } catch (error) {
      console.error(`❌ Error stopping WebSocket server:`, error);
      throw error;
    }
  }

  /**
   * Set cross-node relay function
   */
  setCrossNodeRelay(relayFunction) {
    this.crossNodeRelay = relayFunction;
    console.log(`🔗 Cross-node signaling relay function registered for port ${this.options.port}`);
  }

  /**
   * Set mesh gateway (reference to bootstrap node's mesh)
   */
  setMeshGateway(bootstrapMesh) {
    this.meshGateway = bootstrapMesh;
    console.log(`🌐 Mesh gateway configured for WebSocket server on port ${this.options.port}`);
    
    // Listen for mesh events to relay to WebSocket clients
    if (this.meshGateway && this.meshGateway.addEventListener) {
      console.log(`🌐 Setting up mesh event listeners for peer discovery relay...`);
      
      // Listen for new peer discoveries
      this.meshGateway.addEventListener('peerDiscovered', (data) => {
        console.log(`🌐 Mesh peer discovered: ${data.peerId?.substring(0, 8)}... - relaying to WebSocket clients`);
        this.relayMeshPeerToWebSocketClients(data.peerId);
      });
      
      // Listen for peer connections 
      this.meshGateway.addEventListener('peerConnected', (data) => {
        console.log(`🌐 Mesh peer connected: ${data.peerId?.substring(0, 8)}... - relaying to WebSocket clients`);
        this.relayMeshPeerToWebSocketClients(data.peerId);
      });
      
      // Listen for incoming messages that might indicate peer presence
      this.meshGateway.addEventListener('messageReceived', (data) => {
        // Define internal PigeonHub message types that should not trigger peer discovery
        const internalMessageTypes = [
          'bootstrap-keepalive',
          'bootstrap-keepalive-ack', 
          'bootstrap-ping',
          'bootstrap-pong',
          'signaling-relay',
          'peer-announce-relay',
          'websocket-peer-announcement'
        ];
        
        // Only relay peer discovery for non-internal messages
        const isInternalMessage = data.content?.type && internalMessageTypes.includes(data.content.type);
        
        if (data.from && !this.hasRelayedPeer(data.from) && !isInternalMessage) {
          console.log(`🌐 Message from unknown mesh peer ${data.from?.substring(0, 8)}... - relaying to WebSocket clients`);
          this.relayMeshPeerToWebSocketClients(data.from);
          this.markPeerAsRelayed(data.from);
        } else if (isInternalMessage) {
          console.log(`🔧 Filtered internal message type '${data.content.type}' from ${data.from?.substring(0, 8)}... - not relaying to clients`);
        }
      });
    }
    
    // IMMEDIATELY relay any existing mesh peers to current WebSocket clients
    this.relayExistingMeshPeersToAllClients();
  }
  
  /**
   * Track which peers we've already relayed to avoid spam
   */
  hasRelayedPeer(peerId) {
    if (!this.relayedPeers) this.relayedPeers = new Set();
    return this.relayedPeers.has(peerId);
  }
  
  markPeerAsRelayed(peerId) {
    if (!this.relayedPeers) this.relayedPeers = new Set();
    this.relayedPeers.add(peerId);
  }
  
  /**
   * Relay existing mesh peers to all current WebSocket clients
   */
  relayExistingMeshPeersToAllClients() {
    if (!this.meshGateway) return;
    
    console.log(`🌐 Relaying existing mesh peers to all current WebSocket clients...`);
    
    // Get all active WebSocket clients
    const activeClients = this.getActivePeers();
    console.log(`🌐 Found ${activeClients.length} active WebSocket clients to notify`);
    
    // For each client, relay all mesh peers
    activeClients.forEach(clientPeerId => {
      const connection = this.connections.get(clientPeerId);
      if (connection && connection.readyState === WebSocket.OPEN) {
        this.relayMeshPeersToWebSocketClient(clientPeerId, connection);
      }
    });
  }

  /**
   * Set up HTTP routes for status and debugging
   */
  setupHttpRoutes() {
    this.server.on('request', (req, res) => {
      // Enable CORS
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      if (req.url === '/health' && req.method === 'GET') {
        try {
          // Simple health check for Fly.io
          const health = {
            status: 'healthy',
            timestamp: Date.now(),
            port: this.options.port,
            isRunning: this.isRunning
          };

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(health));
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'unhealthy', error: error.message }));
        }
      } else if (req.url === '/status' && req.method === 'GET') {
        try {
          const meshStatus = this.getMeshNetworkStatus();
          const serverStats = this.getStats();

          const status = {
            timestamp: Date.now(),
            port: this.options.port,
            isRunning: this.isRunning,
            meshStatus: meshStatus.meshStatus || {},
            connectedPeers: meshStatus.connectedPeers || [],
            discoveredPeers: meshStatus.discoveredPeers || [],
            webSocketClients: meshStatus.webSocketClients || 0,
            serverStats,
            rawMeshData: {
              rawConnectedPeers: meshStatus.rawConnectedPeers || [],
              rawDiscoveredPeers: meshStatus.rawDiscoveredPeers || []
            }
          };

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(status, null, 2));
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: error.message }));
        }
      } else if (req.url === '/force-refresh' && req.method === 'POST') {
        try {
          this.forceMeshNetworkRefresh();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'Mesh refresh triggered' }));
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: error.message }));
        }
      } else if (req.url === '/bootstrap-servers' && req.method === 'GET') {
        try {
          const bootstrapServers = {
            servers: BOOTSTRAP_CONFIG.PRODUCTION_BOOTSTRAP_SERVERS || [],
            description: 'Available PigeonHub bootstrap servers for mesh network discovery'
          };
          
          res.writeHead(200, { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(JSON.stringify(bootstrapServers, null, 2));
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: error.message }));
        }
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    });
  }

  /**
   * Set up WebSocket connection handling
   */
  setupWebSocketHandling() {
    this.wss.on('connection', (ws, req) => {
      let peerId = null;

      // Extract peerId from query parameters
      const url = new URL(req.url, `http://${req.headers.host}`);
      const queryPeerId = url.searchParams.get('peerId');

      if (!queryPeerId || !this.validatePeerId(queryPeerId)) {
        console.log(`❌ Invalid peerId: ${queryPeerId}`);
        ws.close(1008, 'Invalid peerId');
        return;
      }

      peerId = queryPeerId;

      // Check for duplicate connections
      if (this.connections.has(peerId)) {
        const existingConnection = this.connections.get(peerId);
        if (existingConnection.readyState === WebSocket.OPEN) {
          console.log(`⚠️  Peer ${peerId.substring(0, 8)}... already connected, closing duplicate`);
          ws.close(1008, 'Peer already connected');
          return;
        } else {
          this.cleanupPeer(peerId);
        }
      }

      // Store connection
      this.connections.set(peerId, ws);
      this.peerData.set(peerId, {
        peerId,
        timestamp: Date.now(),
        connected: true
      });

      ws.connectedAt = Date.now();
      this.stats.totalConnections++;
      this.stats.activeConnections = this.connections.size;

      console.log(`✅ Peer ${peerId.substring(0, 8)}... connected to port ${this.options.port} (${this.connections.size} total)`);

      // Send connection confirmation
      ws.send(JSON.stringify({
        type: 'connected',
        peerId,
        timestamp: Date.now()
      }));

      // Handle messages
      ws.on('message', (data) => {
        this.handleMessage(ws, peerId, data);
      });

      // Handle connection close
      ws.on('close', (code, reason) => {
        console.log(`🔌 Peer ${peerId?.substring(0, 8)}... disconnected from port ${this.options.port} (${code}: ${reason})`);
        this.cleanupPeer(peerId);
        this.stats.activeConnections = this.connections.size;
      });

      // Handle connection errors
      ws.on('error', (error) => {
        console.error(`❌ WebSocket error for ${peerId?.substring(0, 8)}... on port ${this.options.port}:`, error);
        this.cleanupPeer(peerId);
        this.stats.activeConnections = this.connections.size;
      });
    });
  }

  /**
   * Handle incoming WebSocket messages
   */
  handleMessage(ws, peerId, data) {
    try {
      const message = JSON.parse(data);
      const { type, data: messageData, targetPeerId } = message;

      console.log(`📨 Received ${type} from ${peerId.substring(0, 8)}... on port ${this.options.port}`);
      this.stats.messagesProcessed++;

      const responseMessage = {
        type,
        data: messageData,
        fromPeerId: peerId,
        targetPeerId,
        timestamp: Date.now()
      };

      // Handle different message types
      switch (type) {
        case 'announce':
          this.handleAnnounce(peerId, messageData, ws);
          break;

        case 'goodbye':
          this.handleGoodbye(peerId);
          break;

        case 'offer':
        case 'answer':
        case 'ice-candidate':
          this.handleSignaling(responseMessage);
          break;

        default:
          console.log(`⚠️  Ignoring non-signaling message type '${type}' on port ${this.options.port}`);
          ws.send(JSON.stringify({
            type: 'error',
            error: `Signaling server does not route '${type}' messages.`,
            timestamp: Date.now()
          }));
          break;
      }
    } catch (error) {
      console.error(`❌ Error handling message from ${peerId?.substring(0, 8)}... on port ${this.options.port}:`, error);
      ws.send(JSON.stringify({
        type: 'error',
        error: 'Invalid message format',
        timestamp: Date.now()
      }));
    }
  }

  /**
   * Handle peer announcement
   */
  handleAnnounce(peerId, messageData, ws) {
    this.peerData.set(peerId, {
      peerId,
      timestamp: Date.now(),
      data: messageData,
      connected: true
    });

    const activePeers = this.getActivePeers(peerId);
    console.log(`📢 Announcing ${peerId.substring(0, 8)}... to ${activePeers.length} local peers on port ${this.options.port}`);

    // Send peer-discovered messages to local peers
    activePeers.forEach(otherPeerId => {
      this.sendToConnection(otherPeerId, {
        type: 'peer-discovered',
        data: { peerId, ...messageData },
        fromPeerId: 'system',
        targetPeerId: otherPeerId,
        timestamp: Date.now()
      });
    });

    // Send existing peers to new peer
    activePeers.forEach(existingPeerId => {
      const existingPeerData = this.peerData.get(existingPeerId);
      ws.send(JSON.stringify({
        type: 'peer-discovered',
        data: { peerId: existingPeerId, ...existingPeerData?.data },
        fromPeerId: 'system',
        targetPeerId: peerId,
        timestamp: Date.now()
      }));
    });

    // NEW: Relay peer announcement to other bootstrap nodes for cross-node discovery
    if (this.crossNodeRelay) {
      console.log(`🌐 Relaying peer announcement ${peerId.substring(0, 8)}... to other bootstrap nodes`);
      this.crossNodeRelay(null, {
        type: 'peer-announce-relay',
        peerId,
        data: messageData,
        sourcePort: this.options.port,
        timestamp: Date.now()
      });
    }

    // NEW: If we have a mesh gateway, also announce this peer to the mesh
    if (this.meshGateway) {
      console.log(`🌐 Announcing WebSocket peer ${peerId.substring(0, 8)}... to PeerPigeon mesh`);
      this.announcePeerToMesh(peerId, messageData);
    }

    // NEW: Relay any existing mesh peers to this new WebSocket client
    if (this.meshGateway) {
      this.relayMeshPeersToWebSocketClient(peerId, ws);
    }

    // CRITICAL: Force mesh to refresh peer discovery to catch any missed peers
    if (this.meshGateway && this.meshGateway.requestPeerDiscovery) {
      console.log(`🌐 Forcing mesh peer discovery refresh for new WebSocket client...`);
      setTimeout(() => {
        this.meshGateway.requestPeerDiscovery();
        // Give it a moment, then relay again
        setTimeout(() => {
          this.relayMeshPeersToWebSocketClient(peerId, ws);
        }, 1000);
      }, 500);
    }
  }

  /**
   * Handle peer goodbye
   */
  handleGoodbye(peerId) {
    this.peerData.delete(peerId);
    // Could broadcast goodbye to other peers if needed
  }

  /**
   * Handle WebRTC signaling messages
   */
  handleSignaling(message) {
    const { targetPeerId, type } = message;

    if (targetPeerId) {
      const success = this.sendToConnection(targetPeerId, message);
      if (!success) {
        // ANTI-LOOP PROTECTION: Check relay hop count before attempting cross-node relay
        if (message.relayHop && message.relayHop >= 2) {
          console.log(`🚫 ANTI-LOOP: Dropping signaling for ${targetPeerId?.substring(0, 8)}... - too many relay hops (${message.relayHop})`);
          return;
        }
        
        // ANTI-LOOP PROTECTION: Don't relay back to the source bootstrap
        if (message.sourceBootstrapId && message.originalSource === this.options.port) {
          console.log(`🚫 ANTI-LOOP: Skipping relay for ${targetPeerId?.substring(0, 8)}... - originated from this server (port ${this.options.port})`);
          return;
        }
        
        // Try cross-node relay if local peer not found
        if (this.crossNodeRelay) {
          console.log(`🌐 Attempting cross-node relay for peer ${targetPeerId?.substring(0, 8)}... from port ${this.options.port}`);
          console.log(`🔍 CROSS-NODE RELAY DEBUG: Signaling message type: ${type}, from: ${message.fromPeerId?.substring(0, 8)}, to: ${targetPeerId?.substring(0, 8)}`);
          console.log(`🔍 CROSS-NODE RELAY DEBUG: Message data:`, JSON.stringify(message, null, 2));
          
          // Add relay hop tracking and source to prevent loops
          const relayMessage = {
            ...message,
            relayHop: (message.relayHop || 0) + 1,
            originalSource: message.originalSource || this.options.port
          };
          
          console.log(`🔍 RELAY DEBUG: Attempting to relay ${message.type} message to ${targetPeerId?.substring(0, 8)}... on port ${this.options.port} (hop ${relayMessage.relayHop})`);
          
          const relayResult = this.crossNodeRelay(targetPeerId, relayMessage);
          console.log(`🔍 CROSS-NODE RELAY DEBUG: Relay result:`, relayResult);
          
          if (relayResult) {
            console.log(`✅ Cross-node relay initiated for ${type} message to ${targetPeerId?.substring(0, 8)}...`);
          } else {
            console.log(`❌ Cross-node relay failed for ${type} message to ${targetPeerId?.substring(0, 8)}...`);
          }
        } else {
          console.log(`⚠️  Failed to send ${type} to ${targetPeerId.substring(0, 8)}... - peer not found and no cross-node relay`);
        }
      } else {
        console.log(`✅ Successfully sent ${type} to local peer ${targetPeerId?.substring(0, 8)}... on port ${this.options.port}`);
      }
    } else {
      console.log(`⚠️  ${type} message missing targetPeerId on port ${this.options.port}`);
    }
  }

  /**
   * Send message to specific connection
   */
  sendToConnection(peerId, message) {
    const connection = this.connections.get(peerId);
    if (connection && connection.readyState === WebSocket.OPEN) {
      try {
        connection.send(JSON.stringify(message));
        return true;
      } catch (error) {
        console.error(`❌ Error sending to ${peerId?.substring(0, 8)}...:`, error);
        this.cleanupPeer(peerId);
      }
    }
    return false;
  }

  /**
   * Get active peers (excluding specified peer)
   */
  getActivePeers(excludePeerId = null) {
    const activePeers = [];
    for (const [peerId, connection] of this.connections) {
      if (peerId !== excludePeerId && connection.readyState === WebSocket.OPEN) {
        activePeers.push(peerId);
      }
    }
    return activePeers;
  }

  /**
   * Clean up peer data
   */
  cleanupPeer(peerId) {
    this.connections.delete(peerId);
    this.peerData.delete(peerId);
  }

  /**
   * Validate peer ID format
   */
  validatePeerId(peerId) {
    return typeof peerId === 'string' && /^[a-fA-F0-9]{40}$/.test(peerId);
  }

  /**
   * Start periodic cleanup of stale connections
   */
  startPeriodicCleanup() {
    setInterval(() => {
      const totalConnections = this.connections.size;
      
      // Remove stale connections
      for (const [peerId, connection] of this.connections) {
        if (connection.readyState !== WebSocket.OPEN) {
          this.cleanupPeer(peerId);
        }
      }

      const cleanedUp = totalConnections - this.connections.size;
      if (cleanedUp > 0) {
        console.log(`🧹 Port ${this.options.port}: Cleaned up ${cleanedUp} stale connections, ${this.connections.size} active`);
      }

      this.stats.activeConnections = this.connections.size;
    }, 30000); // Clean up every 30 seconds
  }

  /**
   * Get server statistics
   */
  getStats() {
    return {
      ...this.stats,
      uptime: this.stats.startTime ? Date.now() - this.stats.startTime : 0,
      isRunning: this.isRunning,
      port: this.options.port,
      activeConnections: this.stats.activeConnections
    };
  }

  /**
   * Health check
   */
  healthCheck() {
    return {
      healthy: this.isRunning,
      stats: this.getStats(),
      timestamp: Date.now()
    };
  }

  /**
   * Send signaling message to specific peer (for cross-node relay)
   */
  sendSignalingMessage(targetPeerId, message) {
    return this.sendToConnection(targetPeerId, message);
  }

  /**
   * Handle cross-node peer announcement relay
   */
  handleCrossNodePeerAnnounce(peerInfo) {
    const { peerId, data, sourcePort } = peerInfo;
    
    // Don't relay back to the same port
    if (sourcePort === this.options.port) {
      return;
    }

    console.log(`🌐 Received cross-node peer announcement: ${peerId?.substring(0, 8)}... from port ${sourcePort}`);

    // Send peer-discovered to all local peers
    const activePeers = this.getActivePeers();
    activePeers.forEach(localPeerId => {
      this.sendToConnection(localPeerId, {
        type: 'peer-discovered',
        data: { peerId, ...data },
        fromPeerId: 'system',
        targetPeerId: localPeerId,
        timestamp: Date.now(),
        crossNode: true,
        sourcePort
      });
    });

    console.log(`📡 Sent cross-node peer discovery for ${peerId?.substring(0, 8)}... to ${activePeers.length} local peers`);
  }

  /**
   * Announce WebSocket peer to the mesh network
   */
  announcePeerToMesh(peerId, data) {
    if (!this.meshGateway) return;

    try {
      console.log(`🌐 CRITICAL: Adding WebSocket peer ${peerId.substring(0, 8)}... directly to mesh network!`);
      
      // STEP 1: Add the WebSocket peer directly to the mesh's peer list
      // This allows the mesh to know about this peer for direct communication
      if (this.meshGateway.addKnownPeer) {
        this.meshGateway.addKnownPeer(peerId, {
          ...data,
          isWebSocketPeer: true,
          gateway: this.options.port,
          timestamp: Date.now()
        });
        console.log(`✅ Added WebSocket peer ${peerId.substring(0, 8)}... to mesh known peers`);
      }

      // STEP 2: Announce this peer to other mesh nodes for cross-network discovery
      const meshMessage = {
        type: 'websocket-peer-announcement',
        peerId,
        data: {
          ...data,
          isWebSocketPeer: true,
          gateway: this.options.port
        },
        gateway: this.options.port,
        timestamp: Date.now()
      };

      // Use sendMessage to broadcast to all mesh peers
      const messageId = this.meshGateway.sendMessage(meshMessage);
      console.log(`🌐 Broadcasted WebSocket peer ${peerId.substring(0, 8)}... to mesh network (message ID: ${messageId})`);

      // STEP 3: Trigger peer discovery event so other components know about this peer
      if (this.meshGateway.dispatchEvent) {
        this.meshGateway.dispatchEvent(new CustomEvent('peerDiscovered', {
          detail: { peerId, ...data, isWebSocketPeer: true, gateway: this.options.port }
        }));
        console.log(`🌐 Dispatched peerDiscovered event for WebSocket peer ${peerId.substring(0, 8)}...`);
      }

    } catch (error) {
      console.error(`❌ Error announcing peer to mesh:`, error);
    }
  }

  /**
   * Relay mesh peers to a WebSocket client
   */
  relayMeshPeersToWebSocketClient(clientPeerId, ws) {
    if (!this.meshGateway) return;

    try {
      console.log(`🌐 CRITICAL: Relaying ALL mesh peers to new WebSocket client ${clientPeerId.substring(0, 8)}...`);
      
      // Method 1: Try getConnectedPeers first
      let meshPeers = [];
      if (this.meshGateway.getConnectedPeers) {
        const connectedPeers = this.meshGateway.getConnectedPeers();
        meshPeers = Array.isArray(connectedPeers) ? connectedPeers : [];
        console.log(`🌐 Found ${meshPeers.length} connected mesh peers via getConnectedPeers()`);
      }
      
      // Method 2: Try getDiscoveredPeers if no connected peers
      if (meshPeers.length === 0 && this.meshGateway.getDiscoveredPeers) {
        const discoveredPeers = this.meshGateway.getDiscoveredPeers();
        // Handle both array of strings and array of objects
        if (Array.isArray(discoveredPeers)) {
          meshPeers = discoveredPeers.map(peer => {
            if (typeof peer === 'string') {
              return peer;
            } else if (peer && peer.peerId) {
              return peer.peerId;
            } else if (peer && peer.id) {
              return peer.id;
            } else {
              console.log(`🔍 Unknown peer format:`, peer);
              return null;
            }
          }).filter(Boolean);
        }
        console.log(`🌐 Found ${meshPeers.length} discovered mesh peers via getDiscoveredPeers()`);
      }
      
      // Method 3: Try getting peer info from mesh status
      if (meshPeers.length === 0 && this.meshGateway.getStatus) {
        const status = this.meshGateway.getStatus();
        console.log(`🌐 Mesh status:`, status);
        if (status.peers) {
          meshPeers = Array.isArray(status.peers) ? status.peers : Object.keys(status.peers);
          console.log(`🌐 Found ${meshPeers.length} mesh peers from status`);
        }
      }

      // Ensure all peers are strings and log details
      console.log(`🌐 Raw mesh peers:`, meshPeers);
      const validMeshPeers = meshPeers.filter(peer => {
        if (typeof peer === 'string' && peer.length > 0) {
          return true;
        }
        console.log(`🔍 Filtering out invalid peer:`, peer, typeof peer);
        return false;
      });

      // Filter out bootstrap node peer IDs - browsers shouldn't connect to bootstrap nodes
      const bootstrapNodeIds = this.getBootstrapNodeIds();
      const browserPeers = validMeshPeers.filter(peerId => {
        // Don't send peer to itself
        if (peerId === clientPeerId) return false;
        // Don't send bootstrap node IDs to browsers
        if (bootstrapNodeIds.includes(peerId)) {
          console.log(`🚫 Filtering out bootstrap node ${peerId.substring(0, 8)}... from browser peer discovery`);
          return false;
        }
        return true;
      });

      console.log(`🌐 Total valid browser peers to relay: ${browserPeers.length}`, browserPeers.map(p => p.substring(0, 8)));

      // Relay each browser peer to the WebSocket client
      browserPeers.forEach(meshPeerId => {
          const discoveryMessage = {
            type: 'peer-discovered',
            data: { 
              peerId: meshPeerId, 
              isMeshPeer: true,
              source: 'mesh-gateway',
              gateway: this.options.port
            },
            fromPeerId: 'mesh-gateway',
            targetPeerId: clientPeerId,
            timestamp: Date.now()
          };
          
          console.log(`🌐 Sending mesh peer ${meshPeerId.substring(0, 8)}... to WebSocket client ${clientPeerId.substring(0, 8)}...`);
          ws.send(JSON.stringify(discoveryMessage));
      });
      
      // ALSO: Force trigger peer discovery for any peers we might have missed
      if (this.meshGateway.requestPeerDiscovery) {
        console.log(`🌐 Requesting peer discovery refresh from mesh...`);
        this.meshGateway.requestPeerDiscovery();
      }
      
    } catch (error) {
      console.error(`❌ Error relaying mesh peers to WebSocket client:`, error);
    }
  }

  /**
   * Relay mesh peer discovery to WebSocket clients
   */
  relayMeshPeerToWebSocketClients(meshPeerId) {
    try {
      const activePeers = this.getActivePeers();
      console.log(`🌐 Relaying mesh peer ${meshPeerId.substring(0, 8)}... to ${activePeers.length} WebSocket clients`);

      activePeers.forEach(clientPeerId => {
        if (clientPeerId !== meshPeerId) { // Don't send peer to itself
          this.sendToConnection(clientPeerId, {
            type: 'peer-discovered',
            data: { peerId: meshPeerId, isMeshPeer: true },
            fromPeerId: 'mesh-gateway',
            targetPeerId: clientPeerId,
            timestamp: Date.now()
          });
        }
      });
    } catch (error) {
      console.error(`❌ Error relaying mesh peer to WebSocket clients:`, error);
    }
  }

  /**
   * DEBUGGING: Get mesh network status
   */
  getMeshNetworkStatus() {
    if (!this.meshGateway) {
      return { error: 'No mesh gateway configured' };
    }

    try {
      const status = this.meshGateway.getStatus();
      
      // Try multiple methods to get peer data
      let connectedPeers = [];
      let discoveredPeers = [];
      
      // Method 1: getConnectedPeers
      if (this.meshGateway.getConnectedPeers) {
        try {
          const rawConnected = this.meshGateway.getConnectedPeers();
          connectedPeers = Array.isArray(rawConnected) ? rawConnected : [];
        } catch (e) {
          console.log('Error getting connected peers:', e.message);
        }
      }
      
      // Method 2: getConnectedPeerIds  
      if (connectedPeers.length === 0 && this.meshGateway.getConnectedPeerIds) {
        try {
          const rawConnectedIds = this.meshGateway.getConnectedPeerIds();
          connectedPeers = Array.isArray(rawConnectedIds) ? rawConnectedIds : [];
        } catch (e) {
          console.log('Error getting connected peer IDs:', e.message);
        }
      }
      
      // Method 3: getDiscoveredPeers
      if (this.meshGateway.getDiscoveredPeers) {
        try {
          const rawDiscovered = this.meshGateway.getDiscoveredPeers();
          if (Array.isArray(rawDiscovered)) {
            discoveredPeers = rawDiscovered.map(peer => {
              if (typeof peer === 'string') return peer;
              if (peer && peer.peerId) return peer.peerId;
              if (peer && peer.id) return peer.id;
              return null;
            }).filter(Boolean);
          }
        } catch (e) {
          console.log('Error getting discovered peers:', e.message);
        }
      }
      
      // Method 4: Try to extract from mesh object directly
      if (connectedPeers.length === 0 && discoveredPeers.length === 0) {
        try {
          // Look for peer data in the mesh object itself
          const meshKeys = Object.keys(this.meshGateway);
          console.log('🔍 Mesh object keys:', meshKeys);
          
          // Check if there are any peer-related properties
          if (this.meshGateway.peers) {
            console.log('🔍 Found mesh.peers:', this.meshGateway.peers);
          }
          if (this.meshGateway.connections) {
            console.log('🔍 Found mesh.connections:', this.meshGateway.connections);
          }
        } catch (e) {
          console.log('Error exploring mesh object:', e.message);
        }
      }

      return {
        meshStatus: status,
        connectedPeers: connectedPeers.filter(p => typeof p === 'string').map(p => p.substring(0, 8)),
        discoveredPeers: discoveredPeers.filter(p => typeof p === 'string').map(p => p.substring(0, 8)),
        totalConnected: connectedPeers.length,
        totalDiscovered: discoveredPeers.length,
        webSocketClients: this.getActivePeers().length,
        rawConnectedPeers: connectedPeers,
        rawDiscoveredPeers: discoveredPeers
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  /**
   * DEBUGGING: Force mesh network refresh
   */
  forceMeshNetworkRefresh() {
    if (!this.meshGateway) {
      console.log(`❌ No mesh gateway to refresh`);
      return;
    }

    console.log(`🔄 Forcing mesh network refresh...`);
    
    try {
      // Try different methods to refresh the mesh
      if (this.meshGateway.requestPeerDiscovery) {
        this.meshGateway.requestPeerDiscovery();
      }
      
      if (this.meshGateway.refreshPeers) {
        this.meshGateway.refreshPeers();
      }
      
      if (this.meshGateway.updatePeerList) {
        this.meshGateway.updatePeerList();
      }
      
      // Log current status after refresh attempt
      setTimeout(() => {
        const status = this.getMeshNetworkStatus();
        console.log(`🔄 Mesh status after refresh:`, status);
      }, 1000);
      
    } catch (error) {
      console.error(`❌ Error forcing mesh refresh:`, error);
    }
  }

  /**
   * Get bootstrap node peer IDs to filter them out from browser peer discovery
   */
  getBootstrapNodeIds() {
    // TEMPORARILY DISABLED: Return empty array to allow all peers through
    // This is for debugging cross-node connectivity
    console.log(`🚫 Bootstrap filtering DISABLED - allowing all peers through`);
    return [];
  }
}

export default WebSocketServerController;
