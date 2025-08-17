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
    
    // Default mesh options
    const defaultMeshOptions = {
      maxPeers: 5,
      minPeers: 1,
      autoDiscovery: true,
      enableWebDHT: true,
      enableCrypto: true,
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
   * Check if we're running in a cloud environment
   */
  isCloudEnvironment() {
    return process.env.NODE_ENV === 'production' || 
           process.env.PORT || 
           process.env.HEROKU_APP_NAME || 
           process.env.FLY_APP_NAME;
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
   * Initialize the PeerPigeon mesh
   */
  async initializeMesh() {
    try {
      // Use shared mesh if provided, otherwise create new mesh
      if (this.sharedMesh) {
        console.log("🔗 Using global shared mesh...");
        this.mesh = this.sharedMesh;
        console.log("✅ Using global shared mesh with peer ID:", this.mesh.peerId);
      } else {
        // Initialize WebRTC first
        await initializeWebRTC();
        
        this.mesh = new PeerPigeonMesh(this.meshOptions);
        
        // Apply CLI pattern: Add timeout to mesh initialization to prevent hanging
        console.log("🔄 Initializing PeerPigeon mesh with timeout...");
        const initPromise = this.mesh.init();
        const timeoutPromise = new Promise((resolve, reject) => {
          setTimeout(() => reject(new Error('Mesh initialization timeout')), 30000);
        });
        
        await Promise.race([initPromise, timeoutPromise]);
        console.log("✅ Initialized PeerPigeon with peer ID:", this.mesh.peerId);
      }
      
      // Set up mesh event listeners to debug peer connections
      this.mesh.addEventListener('peerConnected', (data) => {
        console.log(`🎯 MESH DEBUG: Peer connected: ${data.peerId.substring(0, 8)}...`);
        console.log(`🎯 MESH DEBUG: Total connected peers: ${this.mesh.getConnectedPeerCount()}`);
      });
      
      this.mesh.addEventListener('peerDisconnected', (data) => {
        console.log(`🎯 MESH DEBUG: Peer disconnected: ${data.peerId.substring(0, 8)}...`);
        console.log(`🎯 MESH DEBUG: Total connected peers: ${this.mesh.getConnectedPeerCount()}`);
      });
      
      this.mesh.addEventListener('peerDiscovered', (data) => {
        console.log(`🎯 MESH DEBUG: Peer discovered: ${data.peerId.substring(0, 8)}...`);
        console.log(`🎯 MESH DEBUG: Attempting to connect to discovered peer...`);
      });
      
      // Handle messages from other bootstrap nodes
      this.mesh.addEventListener('messageReceived', (data) => {
        // Try to parse the content as JSON
        let messageContent;
        try {
          messageContent = JSON.parse(data.content);
        } catch (error) {
          // If it's not JSON, it's likely a peer-to-peer message - ignore it silently
          return;
        }
        
        // Only log and process bootstrap infrastructure messages
        if (messageContent && messageContent.type === 'client-peer-announcement') {
          // Another bootstrap node is announcing a client peer
          const clientPeerId = messageContent.clientPeerId;
          const clientData = messageContent.clientData;
          
          console.log(`🔗 MESH RELAY: Announcing client ${clientPeerId.substring(0, 8)}... from bootstrap ${data.from.substring(0, 8)}... to local clients`);
          
          // Announce this client peer to all our local WebSocket connections
          for (const [localPeerId, connection] of this.connections) {
            if (connection.readyState === WebSocket.OPEN && this.isConnectionAlive(connection)) {
              this.sendToConnection(localPeerId, {
                type: 'peer-discovered',
                data: { peerId: clientPeerId, ...clientData },
                fromPeerId: 'system',
                targetPeerId: localPeerId,
                timestamp: Date.now()
              });
            }
          }
        } else if (messageContent && messageContent.type === 'cross-bootstrap-signaling') {
          console.log(`🌐 CROSS-BOOTSTRAP RECEIVE: Routing ${messageContent.originalMessage.type} from ${messageContent.originalMessage.fromPeerId.substring(0, 8)} to ${messageContent.targetPeerId.substring(0, 8)}`);
          
          // Another bootstrap node is requesting signaling routing
          const targetPeerId = messageContent.targetPeerId;
          const originalMessage = messageContent.originalMessage;
          
          // Try to route to the target peer if it's connected locally
          const success = this.sendToSpecificPeer(targetPeerId, originalMessage);
          if (success) {
            console.log(`✅ CROSS-BOOTSTRAP SUCCESS: ${originalMessage.type} routed to local peer ${targetPeerId.substring(0, 8)}...`);
          } else {
            console.log(`❌ CROSS-BOOTSTRAP FAILED: Target peer ${targetPeerId.substring(0, 8)} not found locally`);
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
   * Clean up a peer connection and notify others
   */
  cleanupPeer(peerId) {
    const wasConnected = this.connections.has(peerId);
    this.connections.delete(peerId);
    this.peerData.delete(peerId);

    if (wasConnected) {
      console.log(`🧹 Cleaned up peer: ${peerId.substring(0, 8)}...`);

      // Notify other peers about disconnection
      const activePeers = this.getActivePeers();
      activePeers.forEach(otherPeerId => {
        this.sendToConnection(otherPeerId, {
          type: 'peer-disconnected',
          data: { peerId },
          fromPeerId: 'system',
          targetPeerId: otherPeerId,
          timestamp: Date.now()
        });
      });
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
    }, 30000); // Clean up every 30 seconds
  }

  /**
   * Handle WebSocket connection
   */
  handleConnection(ws, req) {
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

    // Check if peerId is already connected
    if (this.connections.has(peerId)) {
      const existingConnection = this.connections.get(peerId);
      if (existingConnection.readyState === WebSocket.OPEN) {
        console.log(`⚠️  Peer ${peerId.substring(0, 8)}... already connected, closing duplicate`);
        ws.close(1008, 'Peer already connected');
        return;
      } else {
        // Clean up stale connection
        console.log(`🔄 Replacing stale connection for ${peerId.substring(0, 8)}...`);
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

    // Set up connection metadata
    ws.connectedAt = Date.now();

    console.log(`✅ Peer ${peerId.substring(0, 8)}... connected (${this.connections.size} total)`);

    // Send connection confirmation
    ws.send(JSON.stringify({
      type: 'connected',
      peerId,
      timestamp: Date.now()
    }));

    // Handle incoming messages
    ws.on('message', (data) => this.handleMessage(ws, peerId, data));

    // Handle connection close
    ws.on('close', (code, reason) => {
      console.log(`🔌 Peer ${peerId?.substring(0, 8)}... disconnected (${code}: ${reason})`);

      if (peerId) {
        this.cleanupPeer(peerId);
      }

      console.log(`📊 Active connections: ${this.connections.size}`);
    });

    // Handle connection errors
    ws.on('error', (error) => {
      // Use less severe logging for localhost-related errors when running in cloud
      if (this.isLocalhostRelated(error) && this.isCloudEnvironment()) {
        console.log(`ℹ️  Localhost peer connection issue for ${peerId?.substring(0, 8)}...: ${error.message}`);
      } else {
        console.error(`❌ WebSocket error for ${peerId?.substring(0, 8)}...:`, error);
      }

      // Clean up errored connection
      if (peerId && (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING)) {
        this.cleanupPeer(peerId);
      }
    });
  }
  /**
   * Handle incoming WebSocket messages
   */
  handleMessage(ws, peerId, data) {
    try {
      const message = JSON.parse(data);
      const { type, data: messageData, targetPeerId } = message;

      // Only log signaling messages, not regular peer messages
      const isSignalingMessage = ['announce', 'offer', 'answer', 'ice-candidate'].includes(type);
      if (isSignalingMessage) {
        console.log(`📨 Received ${type} from ${peerId.substring(0, 8)}...`);
      }

      const responseMessage = {
        type,
        data: messageData,
        fromPeerId: peerId,
        targetPeerId,
        timestamp: Date.now()
      };

      // Handle different message types - SIGNALING ONLY
      switch (type) {
        case 'announce': {
          // Handle peer announcement
          this.peerData.set(peerId, {
            peerId,
            timestamp: Date.now(),
            data: messageData,
            connected: true
          });

          // Get active peers (both local and mesh)
          const localPeers = this.getLocalPeers(peerId);
          const meshPeers = this.getMeshPeers(peerId);

          // Validate local connections
          const validatedLocalPeers = [];
          for (const otherPeerId of localPeers) {
            const connection = this.connections.get(otherPeerId);
            if (connection && this.isConnectionAlive(connection)) {
              validatedLocalPeers.push(otherPeerId);
            } else {
              console.log(`🧹 Found dead connection during announce: ${otherPeerId.substring(0, 8)}...`);
              this.cleanupPeer(otherPeerId);
            }
          }

          const totalValidatedPeers = validatedLocalPeers.length + meshPeers.length;
          console.log(`📢 Announcing ${peerId.substring(0, 8)}... to ${totalValidatedPeers} validated peers (${validatedLocalPeers.length} local, ${meshPeers.length} mesh)`);

          // Send peer-discovered messages to local WebSocket connections
          validatedLocalPeers.forEach(otherPeerId => {
            this.sendToConnection(otherPeerId, {
              type: 'peer-discovered',
              data: { peerId, ...messageData },
              fromPeerId: 'system',
              targetPeerId: otherPeerId,
              timestamp: Date.now()
            });
          });

          // Send peer-discovered messages to mesh peers through the mesh network
          if (meshPeers.length > 0) {
            console.log(`📢 Announcing ${peerId.substring(0, 8)}... to ${meshPeers.length} mesh peer(s)`);
            meshPeers.forEach(meshPeerId => {
              if (this.mesh) {
                const message = {
                  type: 'client-peer-announcement',
                  clientPeerId: peerId,
                  clientData: messageData,
                  fromBootstrapNode: this.mesh.peerId,
                  timestamp: Date.now()
                };
                this.mesh.sendDirectMessage(meshPeerId, JSON.stringify(message));
              }
            });
          }

          // Send existing validated peers to the new peer (both local and mesh)
          [...validatedLocalPeers, ...meshPeers].forEach(existingPeerId => {
            const existingPeerData = this.peerData.get(existingPeerId);
            ws.send(JSON.stringify({
              type: 'peer-discovered',
              data: { peerId: existingPeerId, ...existingPeerData?.data },
              fromPeerId: 'system',
              targetPeerId: peerId,
              timestamp: Date.now()
            }));
          });
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
            console.log(`🚨 SIGNALING CRITICAL: ${type} from ${peerId.substring(0, 8)} to ${targetPeerId?.substring(0, 8)}`);
          } else if (type === 'answer') {
            console.log(`🚨 SIGNALING CRITICAL: ${type} from ${peerId.substring(0, 8)} to ${targetPeerId?.substring(0, 8)}`);
            console.log('🔍 WEBSOCKET DEBUG: Received answer message:', {
              type,
              fromPeerId: peerId?.substring(0, 8) + '...',
              targetPeerId: targetPeerId?.substring(0, 8) + '...',
              hasTargetPeerId: !!targetPeerId,
              hasData: !!messageData
            });
          } else if (type === 'ice-candidate') {
            console.log(`🧊 ICE CANDIDATE: from ${peerId.substring(0, 8)} to ${targetPeerId?.substring(0, 8)}`);
          }

          console.log(`🚨 SWITCH: Reached ${type} case for ${peerId.substring(0, 8)}`);

          // Handle WebRTC signaling - this is the server's primary purpose
          if (targetPeerId) {
            // Try to send to local peer first
            const success = this.sendToSpecificPeer(targetPeerId, responseMessage);
            if (!success) {
              console.log(`⚠️  Failed to send ${type} to ${targetPeerId.substring(0, 8)}... (peer not found locally)`);
              
              // If target peer is not local, route through mesh to other bootstrap nodes
              const meshPeers = this.getMeshPeers();
              if (this.mesh && meshPeers.length > 0) {
                console.log(`🌐 CROSS-BOOTSTRAP ROUTING: Sending ${type} from ${peerId.substring(0, 8)} to ${targetPeerId.substring(0, 8)} via mesh`);
                
                // Send to all mesh peers to find the one that has the target peer
                let routedSuccessfully = false;
                meshPeers.forEach(meshPeerId => {
                  try {
                    const message = {
                      type: 'cross-bootstrap-signaling',
                      originalMessage: responseMessage,
                      targetPeerId: targetPeerId,
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
      console.error(`❌ Error handling message from ${peerId?.substring(0, 8)}...:`, error);
      ws.send(JSON.stringify({
        type: 'error',
        error: 'Invalid message format',
        timestamp: Date.now()
      }));
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
      // Initialize PeerPigeon mesh
      await this.initializeMesh();

      // Always find available port for local development
      console.log(`🔍 Finding available port starting from ${this.port}`);
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

      // Connect to other signaling servers if specified
      await this.connectToSignalingServers();

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
    
    for (const serverUrl of signalingServers) {
      try {
        console.log(`🔗 Connecting to signaling server: ${serverUrl}`);
        
        // Use CLI pattern - simple connect with timeout, no event waiting
        const connectPromise = this.mesh.connect(serverUrl);
        const timeoutPromise = new Promise((resolve, reject) => {
          setTimeout(() => reject(new Error(`Connection timeout to ${serverUrl}`)), 15000);
        });
        
        await Promise.race([connectPromise, timeoutPromise]);
        console.log(`✅ Connected to signaling server: ${serverUrl}`);
        
        // After connecting to signaling server, trigger peer discovery
        console.log(`🔍 Triggering peer discovery after connecting to ${serverUrl}...`);
        
        // Let the mesh handle peer discovery automatically
        // Apply CLI pattern - just wait a moment for discovery to happen
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        // Use less severe logging for localhost connection failures
        if (this.isLocalhostRelated(serverUrl)) {
          console.log(`ℹ️  Localhost signaling server not available: ${serverUrl} (${error.message})`);
        } else {
          console.warn(`⚠️  Failed to connect to signaling server ${serverUrl}: ${error.message}`);
        }
        // Continue with other servers
      }
    }
    
    console.log('🌐 Mesh discovery connections completed');
  }  /**
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
}

// Example usage for testing
async function main() {
  const hub = new PigeonHub({
    port: 3000,
    host: 'localhost',
    meshOptions: {
      maxPeers: 5,
      minPeers: 1,
      autoDiscovery: true,
      autoConnect: true,
      enableWebDHT: true,
      enableCrypto: true,
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
