import { randomBytes } from 'crypto';
import { PeerPigeonMesh } from 'peerpigeon';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import net from 'net';
import { EventEmitter } from 'events';
import { URL } from 'url';

/**
 * PigeonHub Node
 * 
 * A complete PigeonHub node that:
 * 1. Runs its own WebSocket signaling server for other peers
 * 2. Connects to the AWS signaling server as a PeerPigeon peer
 * 3. Acts as a bridge between local and remote mesh networks
 */

export class PigeonHubNode extends EventEmitter {
  constructor(options = {}) {
    super();
    this.setMaxListeners(20); // Prevent EventEmitter memory leak warnings
    
    this.config = {
      // Local WebSocket server config
      websocketPort: options.websocketPort || 3000,
      websocketHost: options.websocketHost || 'localhost',
      
      // PeerPigeon mesh config
      signalingServerUrl: options.signalingServerUrl || 'wss://a02bdof0g2.execute-api.us-east-1.amazonaws.com/dev',
      maxPeers: options.maxPeers || 10,
      enableCrypto: options.enableCrypto || false,
      
      // Node identity
      peerId: options.peerId || this.generatePeerId(),
      
      // Behavior config
      sendPeriodicMessages: options.sendPeriodicMessages || true,
      messageInterval: options.messageInterval || 30000,
      statusInterval: options.statusInterval || 10000
    };
    
    // Components
    this.httpServer = null;
    this.websocketServer = null;
    this.peerPigeonMesh = null;
    
    // State
    this.isRunning = false;
    this.localConnections = new Map(); // Local WebSocket connections
  this.remoteLocalPeers = new Map(); // remote bridge-announced local peers
    this.intervals = [];
    
    console.log(`🏗️  PigeonHub Node created with ID: ${this.config.peerId.substring(0, 8)}...`);
  }

  /**
   * Generate a random 40-character hex peer ID
   */
  generatePeerId() {
    return randomBytes(20).toString('hex');
  }

  /**
   * Check if a port is available
   */
  async isPortAvailable(port, host = 'localhost') {
    return new Promise((resolve) => {
      const server = net.createServer();
      
      server.listen(port, host, () => {
        server.once('close', () => {
          resolve(true);
        });
        server.close();
      });
      
      server.on('error', () => {
        resolve(false);
      });
    });
  }

  /**
   * Find an available port starting from the given port
   */
  async findAvailablePort(startPort, host = 'localhost', maxTries = 10) {
    for (let port = startPort; port < startPort + maxTries; port++) {
      if (await this.isPortAvailable(port, host)) {
        return port;
      }
    }
    throw new Error(`No available port found in range ${startPort}-${startPort + maxTries - 1}`);
  }

  /**
   * Start the local WebSocket signaling server
   */
  async startWebSocketServer() {
    try {
      // Find available port
      const port = await this.findAvailablePort(this.config.websocketPort, this.config.websocketHost);
      this.config.websocketPort = port;

      // Create HTTP server with error handling
      this.httpServer = createServer();
      this.httpServer.setMaxListeners(20); // Increase max listeners to prevent warning
      
      this.httpServer.on('error', (error) => {
        console.error('❌ HTTP server error:', error.message);
        this.emit('error', error);
      });
      
      // Create WebSocket server with error handling
      this.websocketServer = new WebSocketServer({ 
        server: this.httpServer,
        perMessageDeflate: false 
      });

      this.websocketServer.on('error', (error) => {
        console.error('❌ WebSocket server error:', error.message);
        this.emit('error', error);
      });

      // Handle WebSocket connections
      this.websocketServer.on('connection', (ws, request) => {
        try {
          this.handleLocalWebSocketConnection(ws, request);
        } catch (error) {
          console.error('❌ Error handling WebSocket connection:', error.message);
          try {
            ws.close(1011, 'Server error');
          } catch (closeError) {
            console.error('❌ Error closing WebSocket:', closeError.message);
          }
        }
      });

      // Start listening with timeout
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('WebSocket server start timeout'));
        }, 10000);

        this.httpServer.listen(port, this.config.websocketHost, (error) => {
          clearTimeout(timeout);
          if (error) {
            console.error('❌ Failed to start WebSocket server:', error.message);
            reject(error);
          } else {
            console.log(`🌐 Local WebSocket server listening on ws://${this.config.websocketHost}:${port}`);
            resolve();
          }
        });
      });
    } catch (error) {
      console.error('❌ Error starting WebSocket server:', error.message);
      throw error;
    }
  }

  /**
   * Handle incoming local WebSocket connections
   */
  handleLocalWebSocketConnection(ws, request) {
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const queryPeerId = url.searchParams.get('peerId');
      
      if (!queryPeerId || !this.validatePeerId(queryPeerId)) {
        console.log(`❌ Invalid or missing peerId in connection`);
        ws.close(1008, 'Invalid peerId');
        return;
      }
      
      console.log(`🔗 New local WebSocket connection from peer: ${queryPeerId.substring(0, 8)}...`);
      
      let peerId = queryPeerId;
      
      // Check if peerId is already connected
      if (this.localConnections.has(peerId)) {
        const existingConnection = this.localConnections.get(peerId);
        if (existingConnection.readyState === WebSocket.OPEN) {
          console.log(`⚠️  Peer ${peerId.substring(0, 8)}... already connected, closing duplicate`);
          ws.close(1008, 'Peer already connected');
          return;
        } else {
          // Clean up stale connection
          console.log(`🔄 Replacing stale connection for ${peerId.substring(0, 8)}...`);
          this.localConnections.delete(peerId);
        }
      }
      
      // Store connection
      this.localConnections.set(peerId, ws);
      ws.peerId = peerId;
      ws.connectedAt = Date.now();
      
      // Set connection timeout
      const connectionTimeout = setTimeout(() => {
        console.log(`⏰ Connection timeout for peer ${peerId.substring(0, 8)}...`);
        try {
          if (ws.readyState === WebSocket.OPEN) {
            ws.close(1000, 'Connection timeout');
          }
        } catch (e) {
          try {
            ws.terminate();
          } catch (e2) {
            // Ignore
          }
        }
      }, 30000); // 30 second timeout
      
      // Add ping/pong for connection health  
      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.ping();
          } catch (e) {
            clearInterval(pingInterval);
            clearTimeout(connectionTimeout);
            this.cleanupLocalConnection(peerId);
          }
        } else {
          clearInterval(pingInterval);
          clearTimeout(connectionTimeout);
        }
      }, 15000); // Ping every 15 seconds
      
      console.log(`✅ Local peer ${peerId.substring(0, 8)}... connected (${this.localConnections.size} total)`);
      
      // Add error handling for the WebSocket
      ws.on('error', (error) => {
        clearInterval(pingInterval);
        clearTimeout(connectionTimeout);
        console.error(`❌ WebSocket error for peer ${peerId.substring(0, 8)}...:`, error.message);
        this.cleanupLocalConnection(peerId);
      });
      
      // Handle pong responses to reset timeout
      ws.on('pong', () => {
        // Connection is healthy, reset timeout
        clearTimeout(connectionTimeout);
      });
      
      // Send connection confirmation with error handling
      try {
        ws.send(JSON.stringify({
          type: 'connected',
          peerId,
          timestamp: Date.now()
        }));
      } catch (error) {
        console.error(`❌ Error sending connection confirmation to ${peerId.substring(0, 8)}...:`, error.message);
      }

      // Send existing remote peers to the new local connection
      if (this.peerPigeonMesh) {
        try {
          // Sanitize remote peer lists before sending to avoid BigInt or non-serializable fields
          const remotePeers = this.peerPigeonMesh.getPeers ? this.peerPigeonMesh.getPeers() : [];
          const discoveredPeers = this.peerPigeonMesh.getDiscoveredPeers ? this.peerPigeonMesh.getDiscoveredPeers() : [];

          const sanitizePeer = (p) => {
            try {
              return {
                peerId: String(p.peerId || p),
                metadata: p.metadata || {},
              };
            } catch (e) {
              return { peerId: String(p.peerId || p) };
            }
          };

          // Send discovered remote peers (sanitized)
          discoveredPeers.forEach(remotePeer => {
            try {
              ws.send(JSON.stringify({
                type: 'peer-discovered',
                data: Object.assign({ isRemote: true }, sanitizePeer(remotePeer)),
                fromPeerId: 'mesh-bridge',
                targetPeerId: peerId,
                timestamp: Date.now()
              }));
            } catch (error) {
              console.error(`❌ Error sending remote peer info to ${peerId.substring(0, 8)}...:`, error.message);
            }
          });

          // Send connected remote peers (sanitized)
          remotePeers.forEach(remotePeer => {
            try {
              ws.send(JSON.stringify({
                type: 'peer-connected',
                data: Object.assign({ isRemote: true }, sanitizePeer(remotePeer)),
                fromPeerId: 'mesh-bridge',
                targetPeerId: peerId,
                timestamp: Date.now()
              }));
            } catch (error) {
              console.error(`❌ Error sending remote peer connection info to ${peerId.substring(0, 8)}...:`, error.message);
            }
          });

          // Also send any remote-local peers (announced by other bridges)
          this.remoteLocalPeers.forEach((info, announcedPeerId) => {
            try {
              ws.send(JSON.stringify({
                type: 'peer-discovered',
                data: Object.assign({ isRemoteLocal: true }, { peerId: announcedPeerId }, info.metadata || {}),
                fromPeerId: 'remote-bridge',
                targetPeerId: peerId,
                timestamp: Date.now()
              }));
            } catch (error) {
              console.error(`❌ Error sending remote-local peer info to ${peerId.substring(0, 8)}...:`, error.message);
            }
          });
        } catch (error) {
          console.error(`❌ Error getting remote peers for ${peerId.substring(0, 8)}...:`, error.message);
        }
      }
    
      ws.on('message', (data) => {
        clearTimeout(connectionTimeout); // Reset timeout on activity
        
        // Use setImmediate to avoid blocking the event loop
        setImmediate(async () => {
          try {
            const message = JSON.parse(data.toString());
            await this.handleLocalWebSocketMessage(ws, message, peerId);
          } catch (error) {
            console.error('❌ Error parsing local WebSocket message:', error.message);
          }
        });
      });

      ws.on('close', () => {
        clearInterval(pingInterval);
        clearTimeout(connectionTimeout);
        try {
          this.cleanupLocalConnection(peerId);
          console.log(`👋 Local peer disconnected: ${peerId.substring(0, 8)}...`);
          
          // Notify other local peers about disconnection
          this.broadcastToLocalPeers({
            type: 'peer-disconnected',
            data: { peerId },
            fromPeerId: 'system',
            timestamp: Date.now()
          }, peerId);
        } catch (error) {
          console.error(`❌ Error handling peer disconnection for ${peerId.substring(0, 8)}...:`, error.message);
        }
      });

    } catch (error) {
      console.error(`❌ Error in handleLocalWebSocketConnection for ${queryPeerId?.substring(0, 8) || 'unknown'}...:`, error.message);
      try {
        ws.close(1011, 'Server error');
      } catch (closeError) {
        console.error('❌ Error closing WebSocket after error:', closeError.message);
      }
    }
  }

  /**
   * Clean up a local connection
   */
  cleanupLocalConnection(peerId) {
    try {
      if (this.localConnections.has(peerId)) {
        const ws = this.localConnections.get(peerId);
        this.localConnections.delete(peerId);
        
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      }
    } catch (error) {
      console.error(`❌ Error cleaning up connection for ${peerId.substring(0, 8)}...:`, error.message);
    }
  }

  /**
   * Validate peer ID format
   */
  validatePeerId(peerId) {
    return typeof peerId === 'string' && /^[a-fA-F0-9]{40}$/.test(peerId);
  }

  /**
   * Handle messages from local WebSocket connections (async)
   */
  async handleLocalWebSocketMessage(ws, message, peerId) {
    return new Promise((resolve) => {
      setImmediate(async () => {
        try {
          const { type, data: messageData, targetPeerId } = message;
          
          console.log(`📨 Local ${type} from ${peerId.substring(0, 8)}...`);
          
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
              console.log(`📢 Local peer ${peerId.substring(0, 8)}... announcing to ${this.localConnections.size - 1} other local peers`);
              
              // Get other active local peers (exclude sender)
              const otherPeers = Array.from(this.localConnections.keys()).filter(id => id !== peerId);
              
              // Send peer-discovered messages to other local peers asynchronously
              setImmediate(async () => {
                for (const otherPeerId of otherPeers) {
                  await this.sendToLocalPeer(otherPeerId, {
                    type: 'peer-discovered',
                    data: { peerId },
                    fromPeerId: 'system',
                    timestamp: Date.now()
                  });
                  // Yield control between sends
                  await new Promise(r => setImmediate(r));
                }
              });
              
              // Send existing peers to the new peer asynchronously
              setImmediate(async () => {
                for (const existingPeerId of otherPeers) {
                  try {
                    const message = JSON.stringify({
                      type: 'peer-discovered',
                      data: { peerId: existingPeerId },
                      fromPeerId: 'system',
                      targetPeerId: peerId,
                      timestamp: Date.now()
                    });
                    
                    if (ws.readyState === WebSocket.OPEN) {
                      ws.send(message);
                    }
                  } catch (error) {
                    console.error(`❌ Error sending existing peer info:`, error.message);
                  }
                  // Yield control
                  await new Promise(r => setImmediate(r));
                }
              });

              // Announce this local peer to remote mesh
              setImmediate(() => {
                this.announceLocalPeerToRemote(peerId, messageData);
              });
              break;
            }
            
            case 'offer':
            case 'answer':
            case 'ice-candidate': {
              // Forward signaling messages to target peer
              if (targetPeerId) {
                console.log(`🔄 Forwarding ${type} from ${peerId.substring(0, 8)}... to ${targetPeerId.substring(0, 8)}...`);
                
                if (type === 'answer') {
                  console.log('🚨 SIGNALING CRITICAL: Signaling forwarding:', {
                    from: peerId.substring(0, 8),
                    to: targetPeerId.substring(0, 8),
                    type: type,
                    isLocalTarget: this.localConnections.has(targetPeerId),
                    isRemoteTarget: this.isRemotePeer(targetPeerId)
                  });
                }
                
                // Try to send to local peer first
                setImmediate(async () => {
                  const sent = await this.sendToLocalPeer(targetPeerId, responseMessage);
                  if (sent) {
                    console.log(`📨 Forwarded ${type} to local peer ${targetPeerId.substring(0, 8)}...`);
                  }
                  // If not local, try to bridge to remote mesh
                  else if (this.isRemotePeer(targetPeerId)) {
                    console.log(`🌐 Bridging ${type} to remote peer ${targetPeerId.substring(0, 8)}...`);
                    this.bridgeSignalingToRemote(responseMessage);
                  }
                  else {
                    console.log(`⚠️  Target peer ${targetPeerId.substring(0, 8)}... not found (local or remote)`);
                  }
                });
              } else {
                console.log(`❌ Missing targetPeerId for ${type} message`);
              }
              break;
            }
            
            case 'goodbye': {
              // Handle peer disconnect
              console.log(`👋 Goodbye from ${peerId.substring(0, 8)}...`);
              setImmediate(() => {
                this.broadcastToLocalPeers(responseMessage, peerId);
              });
              break;
            }
            
            default: {
              console.log(`❓ Unknown message type: ${type}`);
              break;
            }
          }
          
          resolve();
        } catch (error) {
          console.error('❌ Error in handleLocalWebSocketMessage:', error.message);
          resolve();
        }
      });
    });
  }

  /**
   * Send message to a specific local peer (async)
   */
  async sendToLocalPeer(peerId, data) {
    return new Promise((resolve) => {
      setImmediate(() => {
        const connection = this.localConnections.get(peerId);
        if (connection && connection.readyState === WebSocket.OPEN) {
          try {
            const message = JSON.stringify(data);
            connection.send(message);
            resolve(true);
          } catch (error) {
            console.error(`❌ Error sending to local peer ${peerId.substring(0, 8)}...:`, error.message);
            this.localConnections.delete(peerId);
            resolve(false);
          }
        } else {
          resolve(false);
        }
      });
    });
  }

  /**
   * Broadcast message to all local peers except excluded one (async)
   */
  async broadcastToLocalPeers(message, excludePeerId = null) {
    return new Promise((resolve) => {
      // Use setImmediate to avoid blocking the event loop
      setImmediate(async () => {
        let sentCount = 0;
        let messageStr;
        
        try {
          messageStr = JSON.stringify(message);
        } catch (error) {
          console.error('❌ Error stringifying broadcast message:', error.message);
          resolve(0);
          return;
        }
        
        const connections = Array.from(this.localConnections.entries());
        
        // Process connections in batches to avoid blocking
        const batchSize = 10;
        for (let i = 0; i < connections.length; i += batchSize) {
          const batch = connections.slice(i, i + batchSize);
          
          for (const [peerId, ws] of batch) {
            if (peerId !== excludePeerId) {
              try {
                if (ws.readyState === WebSocket.OPEN) {
                  // Use setImmediate for each send to avoid blocking
                  setImmediate(() => {
                    try {
                      ws.send(messageStr);
                    } catch (error) {
                      console.error(`❌ Error sending to local peer ${peerId.substring(0, 8)}...:`, error.message);
                      this.localConnections.delete(peerId);
                    }
                  });
                  sentCount++;
                }
              } catch (error) {
                console.error(`❌ Error broadcasting to local peer ${peerId.substring(0, 8)}...:`, error.message);
                this.localConnections.delete(peerId);
              }
            }
          }
          
          // Yield control after each batch
          if (i + batchSize < connections.length) {
            await new Promise(resolve => setImmediate(resolve));
          }
        }
        
        resolve(sentCount);
      });
    });
  }

  /**
   * Check if a peer ID belongs to a remote mesh peer
   */
  isRemotePeer(peerId) {
    if (!this.peerPigeonMesh) return false;
    
    try {
      const remotePeers = this.peerPigeonMesh.getPeers ? this.peerPigeonMesh.getPeers() : [];
      const discoveredPeers = this.peerPigeonMesh.getDiscoveredPeers ? this.peerPigeonMesh.getDiscoveredPeers() : [];
  // Also consider remote-local peers announced by other bridges
  const knownRemoteLocal = this.remoteLocalPeers.has(peerId);

  return remotePeers.some(peer => peer.peerId === peerId) || 
     discoveredPeers.some(peer => peer.peerId === peerId) ||
     knownRemoteLocal;
    } catch (error) {
      console.error('❌ Error checking if peer is remote:', error.message);
      return false;
    }
  }

  /**
   * Bridge signaling messages to remote mesh
   */
  async bridgeSignalingToRemote(message) {
    try {
      if (!this.peerPigeonMesh || !this.peerPigeonMesh.connected) {
        console.log('⚠️  Cannot bridge to remote mesh - not connected');
        return false;
      }

      // Create a special signaling message for the remote mesh
      const bridgeMessage = {
        type: 'cross-network-signaling',
        originalMessage: message,
        bridgeNodeId: this.config.peerId,
        timestamp: Date.now()
      };

      console.log(`🌉 Bridging signaling message to remote mesh:`, {
        type: message.type,
        from: message.fromPeerId.substring(0, 8),
        to: message.targetPeerId.substring(0, 8)
      });

      await this.peerPigeonMesh.sendMessage(JSON.stringify(bridgeMessage));
      return true;
    } catch (error) {
      console.error('❌ Error bridging signaling to remote mesh:', error.message);
      return false;
    }
  }

  /**
   * Handle cross-network signaling messages from remote mesh
   */
  handleCrossNetworkSignaling(bridgeMessage, fromRemotePeer) {
    try {
      const { originalMessage, bridgeNodeId } = bridgeMessage;
      
      console.log(`🌉 Processing cross-network signaling:`, {
        type: originalMessage.type,
        from: originalMessage.fromPeerId.substring(0, 8),
        to: originalMessage.targetPeerId.substring(0, 8),
        bridge: bridgeNodeId.substring(0, 8),
        remoteSource: fromRemotePeer.substring(0, 8)
      });

      // If the target is a local peer, forward the message
      if (this.localConnections.has(originalMessage.targetPeerId)) {
        console.log(`📨 Forwarding cross-network ${originalMessage.type} to local peer ${originalMessage.targetPeerId.substring(0, 8)}...`);
        
        const forwardedMessage = {
          ...originalMessage,
          isCrossNetwork: true,
          bridgeNodeId,
          remoteSource: fromRemotePeer
        };
        
        this.sendToLocalPeer(originalMessage.targetPeerId, forwardedMessage);
      } else {
        console.log(`⚠️  Cross-network signaling target ${originalMessage.targetPeerId.substring(0, 8)}... not found locally`);
      }
    } catch (error) {
      console.error('❌ Error handling cross-network signaling:', error.message);
    }
  }

  /**
   * Announce a local peer to the remote mesh
   */
  async announceLocalPeerToRemote(peerId, metadata = {}) {
    try {
      if (!this.peerPigeonMesh || !this.peerPigeonMesh.connected) {
        console.log('⚠️  Cannot announce local peer to remote mesh - not connected');
        return false;
      }

      const announcement = {
        type: 'local-peer-announcement',
        localPeerId: peerId,
        bridgeNodeId: this.config.peerId,
        metadata,
        timestamp: Date.now()
      };

      console.log(`🌉 Announcing local peer ${peerId.substring(0, 8)}... to remote mesh`);
      await this.peerPigeonMesh.sendMessage(JSON.stringify(announcement));
      return true;
    } catch (error) {
      console.error('❌ Error announcing local peer to remote mesh:', error.message);
      return false;
    }
  }

  /**
   * Handle local peer announcements from remote bridges
   */
  handleRemoteLocalPeerAnnouncement(announcement, fromRemotePeer) {
    try {
      const { localPeerId, bridgeNodeId, metadata } = announcement;
      
      console.log(`🌉 Remote bridge ${bridgeNodeId.substring(0, 8)}... announced local peer ${localPeerId.substring(0, 8)}...`);

      // Store the announced remote-local peer so we can bridge signaling later
      this.remoteLocalPeers.set(localPeerId, {
        bridgeNodeId,
        remoteBridge: fromRemotePeer,
        metadata: metadata || {},
        announcedAt: Date.now()
      });

      // Notify all local peers about this remote local peer
      this.broadcastToLocalPeers({
        type: 'peer-discovered',
        data: { 
          peerId: localPeerId,
          isRemoteLocal: true,
          bridgeNodeId,
          remoteBridge: fromRemotePeer,
          ...metadata 
        },
        fromPeerId: 'remote-bridge',
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('❌ Error handling remote local peer announcement:', error.message);
    }
  }

  /**
   * Start the PeerPigeon mesh connection
   */
  async startPeerPigeonMesh() {
    try {
      console.log('🚀 Starting PeerPigeon mesh connection...');
      
      // Create PeerPigeon mesh with restored settings
      this.peerPigeonMesh = new PeerPigeonMesh({
        peerId: this.config.peerId,
        signalingServerUrl: this.config.signalingServerUrl,
        maxPeers: this.config.maxPeers,
        enableCrypto: this.config.enableCrypto
      });

      // Set up aggressive event loop monitoring
      let eventLoopBlocked = false;
      const eventLoopMonitor = setInterval(() => {
        const start = Date.now();
        setImmediate(() => {
          const delay = Date.now() - start;
          if (delay > 100) { // Event loop blocked for more than 100ms
            if (!eventLoopBlocked) {
              console.log(`⚠️  Event loop blocked for ${delay}ms - forcing yield`);
              eventLoopBlocked = true;
              // Force garbage collection if available
              if (global.gc) {
                global.gc();
              }
              // Force event loop to yield
              process.nextTick(() => {
                eventLoopBlocked = false;
              });
            }
          } else {
            eventLoopBlocked = false;
          }
        });
      }, 50); // Check every 50ms

      // Set up PeerPigeon event listeners with protection
      this.setupPeerPigeonEventListeners();

      // Initialize with aggressive timeout and yield protection
      const initTimeout = setTimeout(() => {
        clearInterval(eventLoopMonitor);
        throw new Error('PeerPigeon initialization timeout');
      }, 15000);

      try {
        // Yield before init
        await new Promise(resolve => setImmediate(resolve));
        await this.peerPigeonMesh.init();
        clearTimeout(initTimeout);
        console.log('🔧 PeerPigeon mesh initialized successfully');
      } catch (error) {
        clearInterval(eventLoopMonitor);
        clearTimeout(initTimeout);
        throw new Error(`PeerPigeon initialization failed: ${error.message}`);
      }
      
      const connectTimeout = setTimeout(() => {
        clearInterval(eventLoopMonitor);
        throw new Error('PeerPigeon connection timeout');
      }, 15000);

      try {
        // Yield before connect
        await new Promise(resolve => setImmediate(resolve));
        await this.peerPigeonMesh.connect(this.config.signalingServerUrl);
        clearTimeout(connectTimeout);
        console.log('🎉 Successfully joined remote mesh network');
        
        // Keep monitoring event loop after connection
        setTimeout(() => clearInterval(eventLoopMonitor), 30000); // Monitor for 30 more seconds
      } catch (error) {
        clearInterval(eventLoopMonitor);
        clearTimeout(connectTimeout);
        throw new Error(`PeerPigeon connection failed: ${error.message}`);
      }
    } catch (error) {
      console.error('❌ Error starting PeerPigeon mesh:', error.message);
      // Don't throw here - allow the node to continue with just local functionality
      console.log('⚠️  Continuing with local-only functionality');
    }
  }

  /**
   * Set up PeerPigeon event listeners with event loop protection
   */
  setupPeerPigeonEventListeners() {
    try {
      this.peerPigeonMesh.on('connected', () => {
        console.log('✅ Connected to remote mesh network');
      });

      this.peerPigeonMesh.on('peerDiscovered', (data) => {
        // Use setImmediate to ensure event loop isn't blocked
        setImmediate(() => {
          console.log(`👋 Discovered remote peer: ${data.peerId.substring(0, 8)}...`);
        });
      });

      this.peerPigeonMesh.on('peerConnected', (data) => {
        setImmediate(() => {
          console.log(`🤝 Connected to remote peer: ${data.peerId.substring(0, 8)}...`);
        });
      });

      this.peerPigeonMesh.on('peerDisconnected', (data) => {
        setImmediate(() => {
          console.log(`👋 Remote peer disconnected: ${data.peerId.substring(0, 8)}...`);
        });
      });

      this.peerPigeonMesh.on('messageReceived', (data) => {
        setImmediate(async () => {
          try {
            console.log(`💬 Message from remote peer ${data.from.substring(0, 8)}...: ${data.content}`);
            
            // Handle special cross-network messages
            try {
              const parsedContent = JSON.parse(data.content);
              if (parsedContent.type === 'cross-network-signaling') {
                console.log(`🌉 Received cross-network signaling from ${data.from.substring(0, 8)}...`);
                await this.handleCrossNetworkSignaling(parsedContent, data.from);
              } else if (parsedContent.type === 'local-peer-announcement') {
                console.log(`🌉 Received local peer announcement from bridge ${parsedContent.bridgeNodeId.substring(0, 8)}...`);
                this.handleRemoteLocalPeerAnnouncement(parsedContent, data.from);
              }
            } catch (parseError) {
              // Not JSON or not a special message, ignore
            }
          } catch (error) {
            console.error('❌ Error handling message received event:', error.message);
          }
        });
      });
      
      this.peerPigeonMesh.on('error', (error) => {
        setImmediate(() => {
          console.error('❌ PeerPigeon mesh error:', error.message);
        });
      });
    } catch (error) {
      console.error('❌ Error setting up PeerPigeon event listeners:', error.message);
    }
  }

  /**
   * Start periodic behaviors
   */
  startPeriodicBehaviors() {
    // Send periodic test messages to remote mesh
    if (this.config.sendPeriodicMessages) {
      const messageInterval = setInterval(async () => {
        if (this.peerPigeonMesh && this.peerPigeonMesh.connected) {
          const message = `Hello from PigeonHub node ${this.config.peerId.substring(0, 8)} at ${new Date().toLocaleTimeString()}`;
          try {
            await this.peerPigeonMesh.sendMessage(message);
            console.log(`📤 Sent to remote mesh: ${message}`);
          } catch (error) {
            console.error('❌ Failed to send message to remote mesh:', error);
          }
        }
      }, this.config.messageInterval);
      
      this.intervals.push(messageInterval);
    }

    // Status updates
    const statusInterval = setInterval(() => {
      this.printStatus();
    }, this.config.statusInterval);
    
    this.intervals.push(statusInterval);
  }

  /**
   * Print current status
   */
  printStatus() {
    const remotePeers = this.peerPigeonMesh ? this.peerPigeonMesh.getPeers() : [];
    const discoveredPeers = this.peerPigeonMesh ? this.peerPigeonMesh.getDiscoveredPeers() : [];
    
    console.log('📊 PigeonHub Node Status:');
    console.log(`   Node ID: ${this.config.peerId.substring(0, 8)}...`);
    console.log(`   Local WebSocket: ws://${this.config.websocketHost}:${this.config.websocketPort}`);
    console.log(`   Local connections: ${this.localConnections.size}`);
    console.log(`   Remote mesh connected: ${this.peerPigeonMesh ? this.peerPigeonMesh.connected : false}`);
    console.log(`   Remote discovered: ${discoveredPeers.length} peers`);
    console.log(`   Remote connected: ${remotePeers.length} peers`);
    
    if (remotePeers.length > 0) {
      remotePeers.forEach(peer => {
        console.log(`     ✅ Remote: ${peer.peerId.substring(0, 8)}...`);
      });
    }
    
    if (this.localConnections.size > 0) {
      this.localConnections.forEach((ws, peerId) => {
        console.log(`     🏠 Local: ${peerId.substring(0, 8)}...`);
      });
    }
  }

  /**
   * Start the complete PigeonHub node
   */
  async start() {
    if (this.isRunning) {
      console.log('⚠️  PigeonHub node is already running');
      return;
    }

    try {
      console.log('🚀 Starting PigeonHub node...');
      
      // Start local WebSocket server
      await this.startWebSocketServer();
      
      // Start PeerPigeon mesh connection
      await this.startPeerPigeonMesh();
      
      // Start periodic behaviors
      this.startPeriodicBehaviors();
      
      this.isRunning = true;
      console.log('✅ PigeonHub node started successfully!');
      this.emit('started');
      
    } catch (error) {
      console.error('❌ Failed to start PigeonHub node:', error);
      await this.stop();
      throw error;
    }
  }

  /**
   * Stop the PigeonHub node
   */
  async stop() {
    if (!this.isRunning) {
      return;
    }

    console.log('🛑 Stopping PigeonHub node...');
    this.isRunning = false;
    
    // Clear intervals first to stop any ongoing operations
    this.intervals.forEach(interval => {
      try {
        clearInterval(interval);
      } catch (e) {
        // Ignore errors
      }
    });
    this.intervals = [];
    
    // Close local WebSocket connections immediately
    this.localConnections.forEach((ws, peerId) => {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.terminate(); // Use terminate() for immediate close
        }
      } catch (error) {
        // Ignore errors during forced close
      }
    });
    this.localConnections.clear();
    
    // Close WebSocket server immediately
    if (this.websocketServer) {
      try {
        this.websocketServer.close();
        // Force close all connections
        this.websocketServer.clients?.forEach(ws => {
          try {
            ws.terminate();
          } catch (e) {
            // Ignore
          }
        });
      } catch (error) {
        // Ignore errors
      }
      this.websocketServer = null;
    }
    
    // Close HTTP server with timeout
    if (this.httpServer) {
      try {
        // Force close all connections first
        if (this.httpServer.closeAllConnections) {
          this.httpServer.closeAllConnections();
        }
        
        await Promise.race([
          new Promise((resolve, reject) => {
            this.httpServer.close((error) => {
              if (error) reject(error);
              else resolve();
            });
          }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('HTTP server close timeout')), 1000)
          )
        ]);
      } catch (error) {
        // Force destroy if close hangs
        try {
          this.httpServer.closeAllConnections?.();
        } catch (e) {
          // Ignore
        }
      }
      this.httpServer = null;
    }
    
    // Disconnect from remote mesh with timeout
    if (this.peerPigeonMesh) {
      try {
        await Promise.race([
          this.peerPigeonMesh.disconnect(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('PeerPigeon disconnect timeout')), 1000)
          )
        ]);
        console.log('👋 Disconnected from remote mesh');
      } catch (error) {
        console.log('⚠️  Force disconnecting from remote mesh...');
        // Force cleanup of PeerPigeon
        try {
          if (this.peerPigeonMesh.signalingClient) {
            this.peerPigeonMesh.signalingClient.close?.();
          }
          if (this.peerPigeonMesh.peers) {
            this.peerPigeonMesh.peers.forEach(peer => {
              try {
                peer.destroy?.();
              } catch (e) {
                // Ignore
              }
            });
          }
        } catch (e) {
          // Ignore cleanup errors
        }
      }
      this.peerPigeonMesh = null;
    }
    
    console.log('✅ PigeonHub node stopped');
    this.emit('stopped');
  }

  /**
   * Send a message to the remote mesh
   */
  async sendToRemoteMesh(message) {
    if (!this.peerPigeonMesh || !this.peerPigeonMesh.connected) {
      throw new Error('Not connected to remote mesh');
    }
    
    return await this.peerPigeonMesh.sendMessage(message);
  }

  /**
   * Broadcast a message to local connections
   */
  broadcastToLocalConnections(message) {
    return this.broadcastToLocalPeers(message);
  }
}

  /**
   * Main execution function when run directly
   */
  async function main() {
    console.log('🏗️  Creating PigeonHub node...');
    
    const node = new PigeonHubNode({
      sendPeriodicMessages: true
    });

    let isShuttingDown = false;
    let sigintCount = 0;

    // Simplified graceful shutdown with immediate response
    const shutdown = (signal) => {
      if (isShuttingDown) {
        console.log(`\n⚠️  Already shutting down, FORCE EXIT!`);
        process.exit(1);
      }
      
      isShuttingDown = true;
      console.log(`\n🛑 Shutting down from ${signal}...`);
      
      // VERY aggressive timeout
      const forceExitTimeout = setTimeout(() => {
        console.log('💥 FORCE EXIT NOW!');
        process.exit(1);
      }, 300); // Only 300ms to shutdown
      
      // Try to stop but don't wait
      setImmediate(async () => {
        try {
          if (node && typeof node.stop === 'function') {
            // Race against timeout
            Promise.race([
              node.stop(),
              new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 200))
            ]).then(() => {
              clearTimeout(forceExitTimeout);
              process.exit(0);
            }).catch(() => {
              clearTimeout(forceExitTimeout);
              process.exit(1);
            });
          } else {
            clearTimeout(forceExitTimeout);
            process.exit(0);
          }
        } catch (error) {
          clearTimeout(forceExitTimeout);
          process.exit(1);
        }
      });
    };

    // Single SIGINT handler with immediate response
    process.on('SIGINT', () => {
      sigintCount++;
      // IMMEDIATE forced output - don't wait for anything
      process.stdout.write(`\n🛑 SIGINT received (${sigintCount}) - FORCING EXIT!\n`);
      
      if (sigintCount === 1) {
        // First SIGINT - try graceful but force exit quickly
        setTimeout(() => {
          console.log('⚡ Force exit timeout reached!');
          process.exit(1);
        }, 500); // Very short timeout
        
        setImmediate(() => {
          shutdown('SIGINT');
        });
      } else {
        // Multiple SIGINTs - immediate exit
        process.exit(1);
      }
    });
    
    process.once('SIGTERM', () => shutdown('SIGTERM'));

    // Handle uncaught exceptions
    process.once('uncaughtException', (error) => {
      console.error('❌ Uncaught exception:', error);
      process.exit(1);
    });

    // Handle unhandled promise rejections
    process.once('unhandledRejection', (reason, promise) => {
      console.error('❌ Unhandled rejection at:', promise, 'reason:', reason);
      process.exit(1);
    });

    // Start the node
    try {
      await node.start();
      console.log('💡 PigeonHub node is running!');
      console.log('💡 Other peers can connect to your local WebSocket server');
      console.log('💡 This node is also connected to the remote mesh network');
      console.log('💡 Press Ctrl+C to stop (press twice for force exit)');
      
      // Event loop monitoring to detect freezes
      let lastHeartbeat = Date.now();
      const heartbeatInterval = setInterval(() => {
        const now = Date.now();
        const timeSinceLastHeartbeat = now - lastHeartbeat;
        
        if (timeSinceLastHeartbeat > 2000) {
          console.log(`⚠️  Event loop blocked for ${timeSinceLastHeartbeat}ms`);
        }
        
        lastHeartbeat = now;
      }, 1000);
      
      // Cleanup heartbeat on shutdown
      process.once('exit', () => {
        clearInterval(heartbeatInterval);
      });
      
    } catch (error) {
      console.error('❌ Failed to start PigeonHub node:', error);
      process.exit(1);
    }
  }// Start the application if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  // Add global error handlers to prevent crashes
  process.on('uncaughtException', (error) => {
    console.error('🚨 Uncaught Exception:', error.message);
    console.error('🚨 Stack:', error.stack);
    console.log('🛑 Forcing shutdown due to uncaught exception...');
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('🚨 Unhandled Rejection at:', promise);
    console.error('🚨 Reason:', reason);
    console.log('🛑 Forcing shutdown due to unhandled rejection...');
    process.exit(1);
  });

  main().catch(error => {
    console.error('❌ Failed to start:', error.message);
    console.error('❌ Stack:', error.stack);
    process.exit(1);
  });
}
