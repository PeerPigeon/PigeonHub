/**
 * PigeonHub - Main orchestrator class
 * 
 * Integrates WebSocket signaling and Kademlia DHT bootstrap discovery
 * into a unified mesh network infrastructure.
 */

import { BootstrapRegistry } from '../kademlia/BootstrapRegistry.js';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import crypto from 'crypto';
import { URL } from 'url';
import { EventEmitter } from 'events';

export class PigeonHub extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.config = {
      // WebSocket server configuration
      websocket: {
        port: options.websocketPort || parseInt(process.env.PORT) || 3000,
        host: options.websocketHost || process.env.HOST || 'localhost',
        ...options.websocket
      },
      
      // Kademlia DHT configuration  
      kademlia: {
        port: options.kademliaPort || 9000,
        address: options.kademliaAddress || 'localhost',
        networkId: options.networkId || 'pigeonhub-network',
        bootstrapNodes: options.bootstrapNodes || [],
        ...options.kademlia
      },
      
      // General configuration
      role: options.role || 'node', // 'bootstrap', 'node', 'relay'
      capabilities: options.capabilities || ['websocket-signaling'],
      metadata: options.metadata || {}
    };
    
    // Generate unique WebSocket server instance ID (different from Kademlia node ID)
    this.instanceId = null; // Will be generated during start()
    
    // Component instances
    this.bootstrapRegistry = null;
    this.websocketServer = null;
    this.httpServer = null;
    
    // State
    this.isRunning = false;
    this.connections = new Map(); // peerId -> WebSocket connection
    this.peerData = new Map(); // peerId -> peer metadata
    this.crossNodeRoutes = new Map(); // peerId -> reverse route info for bidirectional signaling
  }

  /**
   * Generate a unique instance ID for this WebSocket server
   */
  async generateInstanceId() {
    const crypto = await import('crypto');
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2);
    const input = `pigeonhub_${this.config.websocket.host}_${this.config.websocket.port}_${timestamp}_${random}`;
    return crypto.createHash('sha1').update(input).digest('hex').substring(0, 16);
  }

  /**
   * Start the PigeonHub instance
   */
  async start() {
    if (this.isRunning) {
      throw new Error('PigeonHub is already running');
    }

    try {
      console.log('🚀 Starting PigeonHub...');
      
      // Generate unique instance ID for this WebSocket server
      this.instanceId = await this.generateInstanceId();
      
      // Start Kademlia DHT / Bootstrap Registry
      await this.startKademlia();
      
      // Start WebSocket server
      await this.startWebSocketServer();
      
      // Register this node in the network
      await this.registerInNetwork();
      
      this.isRunning = true;
      this.emit('started', this.getNetworkInfo());
      
      console.log('✅ PigeonHub started successfully');
      console.log(`📡 WebSocket server: ws://${this.config.websocket.host}:${this.config.websocket.port}`);
      console.log(`🔍 Kademlia DHT: udp://${this.config.kademlia.address}:${this.bootstrapRegistry.dht.port}`);
      console.log(`🆔 WebSocket Instance ID: ${this.instanceId}`);
      
    } catch (error) {
      console.error('❌ Failed to start PigeonHub:', error);
      await this.stop();
      throw error;
    }
  }

  /**
   * Stop the PigeonHub instance
   */
  async stop() {
    console.log('🔄 Stopping PigeonHub...');
    
    this.isRunning = false;
    
    // Close WebSocket connections
    if (this.websocketServer) {
      for (const [peerId, ws] of this.connections) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      }
      this.connections.clear();
      this.websocketServer.close();
    }
    
    // Close HTTP server
    if (this.httpServer) {
      this.httpServer.close();
    }
    
    // Stop Kademlia DHT
    if (this.bootstrapRegistry) {
      await this.bootstrapRegistry.stop();
    }
    
    this.emit('stopped');
    console.log('✅ PigeonHub stopped');
  }

  /**
   * Start the Kademlia DHT / Bootstrap Registry
   */
  async startKademlia() {
    console.log('🔍 Starting Kademlia DHT...');
    
    // Start the DHT first without bootstrap nodes
    this.bootstrapRegistry = new BootstrapRegistry({
      networkId: this.config.kademlia.networkId,
      port: this.config.kademlia.port,
      address: this.config.kademlia.address,
      bootstrapNodes: [], // Start empty, discover through signaling
      metadata: {
        role: this.config.role,
        capabilities: this.config.capabilities,
        websocketPort: this.config.websocket.port,
        kademliaPort: this.config.kademlia.port, // Include actual port used
        ...this.config.metadata
      }
    });

    // Forward events
    this.bootstrapRegistry.on('started', () => {
      this.emit('kademliaStarted');
    });
    
    this.bootstrapRegistry.on('bootstrapRegistered', (data) => {
      this.emit('bootstrapRegistered', data);
    });
    
    this.bootstrapRegistry.on('peerDiscovered', (peer) => {
      this.emit('peerDiscovered', peer);
    });

    await this.bootstrapRegistry.start();
    
    // Try to connect to configured bootstrap nodes first
    if (this.config.kademlia.bootstrapNodes && this.config.kademlia.bootstrapNodes.length > 0) {
      console.log(`🔗 Attempting to connect to ${this.config.kademlia.bootstrapNodes.length} configured bootstrap nodes...`);
      
      for (const bootstrap of this.config.kademlia.bootstrapNodes) {
        if (bootstrap.address && bootstrap.port) {
          try {
            await this.bootstrapRegistry.discoverBootstrapByAddress(bootstrap.address, bootstrap.port);
          } catch (error) {
            console.log(`⚠️  Failed to connect to bootstrap ${bootstrap.address}:${bootstrap.port}`);
          }
        }
      }
    } else if (this.config.role !== 'bootstrap') {
      // If no bootstrap nodes configured and we're not a bootstrap, scan common ports
      console.log('🔍 No bootstrap nodes configured, scanning common ports...');
      const commonPorts = [9000, 9001, 9002, 9003, 9004];
      
      for (const port of commonPorts) {
        if (port !== this.bootstrapRegistry.dht.port) { // Don't try to connect to ourselves
          try {
            console.log(`🔍 Scanning localhost:${port} for bootstrap node...`);
            await this.bootstrapRegistry.discoverBootstrapByAddress('127.0.0.1', port);
            console.log(`✅ Found bootstrap node at localhost:${port}!`);
            break; // Found one, that's enough
          } catch (error) {
            // Silent failure, keep scanning
          }
        }
      }
    }
    
    // After starting, use WebSocket signaling to discover other Kademlia nodes
    console.log('🌐 Discovering Kademlia peers through signaling server...');
    await this.discoverKademliaPeersViaSignaling();
  }

  /**
   * Discover other Kademlia DHT nodes using the WebSocket signaling server
   */
  async discoverKademliaPeersViaSignaling() {
    const signalingUrl = process.env.AWS_SIGNAL || 'wss://a02bdof0g2.execute-api.us-east-1.amazonaws.com/dev';
    
    try {
      console.log(`🔗 Connecting to signaling server: ${signalingUrl}`);
      
      // Import WebSocket client
      const { WebSocket } = await import('ws');
      
      // Generate a proper SHA1-based peerId for signaling connection
      const crypto = await import('crypto');
      const kademliaInput = `kademlia_${this.bootstrapRegistry.dht.nodeId}`;
      const tempPeerId = crypto.createHash('sha1').update(kademliaInput).digest('hex');
      
      // Add peerId as query parameter for AWS API Gateway
      const connectionUrl = `${signalingUrl}?peerId=${tempPeerId}`;
      
      console.log(`🔗 Connecting to signaling server: ${signalingUrl}`);
      console.log(`🔗 Connecting with peerId: ${tempPeerId}`);
      console.log(`🔗 Connection URL: ${connectionUrl}`);
      console.log(`🔗 Headers:`, {
        'Origin': 'https://pigeonhub.local',
        'User-Agent': 'PigeonHub-Kademlia/1.0'
      });
      
      const ws = new WebSocket(connectionUrl, {
        headers: {
          'Origin': 'https://pigeonhub.local',
          'User-Agent': 'PigeonHub-Kademlia/1.0'
        }
      });

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          ws.close();
          console.log(`⚠️  AWS Signaling server discovery timeout (${signalingUrl}), continuing without peers`);
          resolve();
        }, 15000); // 15 second timeout
        
        ws.on('open', () => {
          console.log(`✅ Connected to AWS signaling server for Kademlia discovery (${signalingUrl})`);
          
          // Announce ourselves as a Kademlia node looking for peers
          const announceMessage = {
            type: 'announce',
            data: {
              nodeId: this.bootstrapRegistry.dht.nodeId,
              address: this.config.kademlia.address,
              port: this.bootstrapRegistry.dht.port,
              networkId: this.config.kademlia.networkId,
              capabilities: this.config.capabilities,
              role: this.config.role,
              kademlia: true // Flag to indicate this is a Kademlia node
            },
            fromPeerId: tempPeerId,
            timestamp: Date.now()
          };
          
          console.log(`📢 Announcing Kademlia node to AWS signaling server (${signalingUrl})`);
          ws.send(JSON.stringify(announceMessage));
        });
        
        ws.on('message', async (data) => {
          try {
            const message = JSON.parse(data.toString());
            console.log(`📨 Received signaling message: ${message.type}`);
            
            if (message.type === 'connected') {
              console.log('✅ Signaling server connection confirmed');
              return;
            }
            
            if (message.type === 'peer-discovered' && message.data) {
              const peerData = message.data;
              
              // Check if this peer has Kademlia info
              if (peerData.kademliaNodeId && peerData.kademliaPort && 
                  peerData.kademliaNodeId !== this.bootstrapRegistry.dht.nodeId) {
                
                console.log(`🔍 Found Kademlia peer via signaling: ${peerData.kademliaNodeId.substring(0, 8)}... at port ${peerData.kademliaPort}`);
                
                // Try to ping this Kademlia peer directly
                try {
                  await this.pingKademliaPeer(peerData.kademliaNodeId, 'localhost', peerData.kademliaPort);
                  console.log(`✅ Successfully connected to Kademlia peer: ${peerData.kademliaNodeId.substring(0, 8)}...`);
                } catch (error) {
                  console.log(`⚠️  Failed to ping Kademlia peer ${peerData.kademliaNodeId.substring(0, 8)}...: ${error.message}`);
                }
              }
            }
            
            if (message.type === 'kademlia-peer-discovered') {
              const { nodeId, address, port, networkId } = message.data || message;
              
              // Only connect to nodes in the same network
              if (networkId === this.config.kademlia.networkId && nodeId !== this.bootstrapRegistry.dht.nodeId) {
                console.log(`🔍 Found direct Kademlia peer: ${nodeId.substring(0, 8)}... at ${address}:${port}`);
                
                // Add this peer to our DHT
                try {
                  await this.pingKademliaPeer(nodeId, address, port);
                  console.log(`✅ Successfully connected to Kademlia peer: ${nodeId.substring(0, 8)}...`);
                } catch (error) {
                  console.log(`⚠️  Failed to ping Kademlia peer ${nodeId.substring(0, 8)}...: ${error.message}`);
                }
              }
            }
          } catch (error) {
            console.error('Error handling signaling message:', error);
          }
        });
        
        ws.on('close', (code, reason) => {
          clearTimeout(timeout);
          const reasonText = reason ? reason.toString() : 'no reason provided';
          console.log(`🔌 AWS SIGNALING SERVER (${signalingUrl}) connection closed (${code}: ${reasonText})`);
          
          // Log standard WebSocket close codes for debugging
          switch (code) {
            case 1000:
              console.log(`   ✅ Normal closure (AWS signaling server: ${signalingUrl})`);
              break;
            case 1001:
              console.log(`   ⚠️  Endpoint going away (AWS signaling server: ${signalingUrl})`);
              break;
            case 1002:
              console.log(`   ❌ Protocol error (AWS signaling server: ${signalingUrl})`);
              break;
            case 1003:
              console.log(`   ❌ Unsupported data type (AWS signaling server: ${signalingUrl})`);
              break;
            case 1005:
              console.log(`   ❌ No status code (abnormal closure) (AWS signaling server: ${signalingUrl})`);
              break;
            case 1006:
              console.log(`   ❌ Connection lost (abnormal closure) (AWS signaling server: ${signalingUrl})`);
              break;
            case 1007:
              console.log(`   ❌ Invalid data (AWS signaling server: ${signalingUrl})`);
              break;
            case 1008:
              console.log(`   ❌ Policy violation (AWS signaling server: ${signalingUrl})`);
              break;
            case 1009:
              console.log(`   ❌ Message too large (AWS signaling server: ${signalingUrl})`);
              break;
            case 1010:
              console.log(`   ❌ Extension negotiation failed (AWS signaling server: ${signalingUrl})`);
              break;
            case 1011:
              console.log(`   ❌ Server error (AWS signaling server: ${signalingUrl})`);
              break;
            default:
              console.log(`   ❓ Unknown code: ${code} (AWS signaling server: ${signalingUrl})`);
          }
          resolve();
        });
        
        ws.on('error', (error) => {
          clearTimeout(timeout);
          console.error(`⚠️  AWS SIGNALING SERVER (${signalingUrl}) error:`, {
            message: error.message,
            code: error.code,
            errno: error.errno,
            syscall: error.syscall,
            hostname: error.hostname,
            port: error.port,
            stack: error.stack
          });
          resolve(); // Don't fail startup, just continue without signaling
        });
      });
      
    } catch (error) {
      console.error('⚠️  Failed to use signaling for Kademlia discovery:', error.message);
      // Don't fail startup, just continue without signaling discovery
    }
  }

  /**
   * Ping a Kademlia peer and add to routing table if successful
   */
  async pingKademliaPeer(nodeId, address, port) {
    try {
      // Use discoverNodeByAddress since we have the address/port but need to verify the nodeId
      const response = await this.bootstrapRegistry.dht.discoverNodeByAddress(address, port);
      console.log(`🏓 Ping successful to ${nodeId.substring(0, 8)}... at ${address}:${port}`);
      return response;
    } catch (error) {
      throw new Error(`Ping failed: ${error.message}`);
    }
  }

  /**
   * Start the WebSocket signaling server with auto-incrementing port
   */
  async startWebSocketServer() {
    console.log('📡 Starting WebSocket server...');
    
    const maxRetries = 20;
    let currentPort = this.config.websocket.port;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Create HTTP server
        this.httpServer = createServer();
        
        // Add health check endpoint
        this.httpServer.on('request', (req, res) => {
          const url = new URL(req.url, `http://${req.headers.host}`);
          
          if (url.pathname === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              status: 'healthy',
              timestamp: Date.now(),
              network: this.getNetworkInfo()
            }));
          } else {
            res.writeHead(404);
            res.end('Not Found');
          }
        });
        
        // Create WebSocket server
        this.websocketServer = new WebSocketServer({ 
          server: this.httpServer,
          path: '/ws'
        });
        
        this.websocketServer.on('connection', (ws, req) => {
          this.handleWebSocketConnection(ws, req);
        });
        
        // Try to start listening on current port
        await new Promise((resolve, reject) => {
          const handleError = (error) => {
            reject(error);
          };
          
          // Set up error handlers before starting to listen
          this.httpServer.once('error', handleError);
          this.websocketServer.once('error', handleError);
          
          this.httpServer.listen(currentPort, this.config.websocket.host, (error) => {
            if (error) {
              reject(error);
            } else {
              // Remove the error handlers on success
              this.httpServer.removeListener('error', handleError);
              this.websocketServer.removeListener('error', handleError);
              resolve();
            }
          });
        });
        
        // Success! Update the config with the actual port used
        if (currentPort !== this.config.websocket.port) {
          console.log(`⚡ WebSocket port ${this.config.websocket.port} was in use, incremented to ${currentPort}`);
        }
        this.config.websocket.port = currentPort;
        return;
        
      } catch (error) {
        if (error.code === 'EADDRINUSE') {
          console.log(`🔄 WebSocket port ${currentPort} in use, trying ${currentPort + 1}`);
          currentPort++;
          
          // Clean up the failed server
          if (this.httpServer) {
            try {
              this.httpServer.close();
            } catch (e) {
              // Ignore cleanup errors
            }
            this.httpServer = null;
          }
          if (this.websocketServer) {
            try {
              this.websocketServer.close();
            } catch (e) {
              // Ignore cleanup errors
            }
            this.websocketServer = null;
          }
          
          continue;
        } else {
          throw error;
        }
      }
    }
    
    throw new Error(`Unable to find available WebSocket port after trying ${maxRetries} ports starting from ${this.config.websocket.port}`);
  }

  /**
   * Handle new WebSocket connections
   */
  handleWebSocketConnection(ws, req) {
    console.log('🔌 New WebSocket connection');
    
    let peerId = null;
    
    // Extract peerId from query parameters if present
    if (req.url) {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const queryPeerId = url.searchParams.get('peerId');
        if (queryPeerId) {
          // Check if this is a system connection for forwarding
          if (queryPeerId.startsWith('system_')) {
            console.log(`🔧 System connection established for forwarding`);
            // Don't store system connections as regular peers
            ws.on('message', async (data) => {
              try {
                const message = JSON.parse(data.toString());
                if (message.type === 'forward') {
                  await this.handleForwardedMessage(ws, message);
                }
              } catch (error) {
                console.error('❌ Error handling system message:', error);
              }
            });
            
            ws.on('close', () => {
              console.log('🔧 System connection closed');
            });
            return;
          }
          
          if (this.validatePeerId(queryPeerId)) {
            // Use the peer ID as-is from the browser
            peerId = queryPeerId;
            console.log(`✅ Extracted peerId from query: ${peerId.substring(0, 8)}...`);
          }
        }
      } catch (error) {
        console.log('⚠️  Failed to parse query parameters:', error.message);
      }
    }
    
    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        await this.handleWebSocketMessage(ws, message, peerId);
        
        // Update peerId if this was a register message
        if (message.type === 'register' && message.peerId) {
          peerId = message.peerId;
          this.connections.set(peerId, ws);
        } else if (message.type === 'announce' && peerId) {
          // For announce messages, use the peerId from query params
          this.connections.set(peerId, ws);
        }
        
      } catch (error) {
        console.error('Error handling WebSocket message:', error);
        ws.send(JSON.stringify({
          type: 'error',
          error: error.message
        }));
      }
    });
    
    ws.on('close', () => {
      console.log('🔌 WebSocket connection closed');
      if (peerId) {
        this.connections.delete(peerId);
        this.peerData.delete(peerId);
        
        // Clean up any reverse routes involving this peer
        this.crossNodeRoutes.delete(peerId);
        
        // Also clean up any reverse routes where this peer is the remote target
        for (const [localPeerId, route] of this.crossNodeRoutes.entries()) {
          if (route.remotePeerId === peerId) {
            this.crossNodeRoutes.delete(localPeerId);
            console.log(`🧹 Cleaned up reverse route: ${localPeerId?.substring(0, 8)}... -> ${peerId?.substring(0, 8)}...`);
          }
        }
      }
    });
    
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  }

  /**
   * Handle WebSocket messages
   */
  async handleWebSocketMessage(ws, message, peerId) {
    const { type, data, targetPeerId, maxPeers } = message;
    
    if (type === 'ping') {
      // Handle ping messages (heartbeat) - respond with pong and refresh announcement TTL
      console.log(`Received ping from ${peerId}`);
      
      // Send pong response back to the sender
      ws.send(JSON.stringify({
        type: 'pong',
        timestamp: Date.now(),
        originalTimestamp: data?.timestamp
      }));
      
      // Refresh the peer's data TTL to keep it alive
      if (peerId && this.peerData.has(peerId)) {
        const peerData = this.peerData.get(peerId);
        peerData.timestamp = Date.now(); // Refresh timestamp
        this.peerData.set(peerId, peerData);
      }
      
      return;
      
    } else if (type === 'register') {
      await this.handleRegister(ws, message);
      
    } else if (type === 'discover') {
      await this.handleDiscover(ws, message);
      
    } else if (type === 'signal') {
      await this.handleSignal(ws, message);
      
    } else if (type === 'announce') {
      await this.handleAnnounce(ws, message, peerId);
      
    } else if (type === 'offer' || type === 'answer' || type === 'ice-candidate') {
      await this.handleWebRTCSignaling(ws, message, peerId);
      
    } else if (type === 'forward') {
      await this.handleForwardedMessage(ws, message);
      
    } else if (type === 'goodbye') {
      await this.handleGoodbye(ws, message, peerId);
      
    } else if (targetPeerId) {
      // Direct message to specific peer (offer, answer, ice-candidate, etc.)
      const success = await this.sendToSpecificPeer(targetPeerId, message);
      
      if (!success) {
        // Store in signaling fallback (if implemented)
        console.log(`Failed to send direct message to ${targetPeerId}, message stored for fallback`);
      }
      
    } else {
      // Broadcast message
      await this.broadcastToClosestPeers(peerId, message, maxPeers || 10);
    }
    
    // Handle cleanup messages
    if (type === 'cleanup' || type === 'cleanup-all') {
      await this.handleCleanup(peerId, targetPeerId, type === 'cleanup-all');
    }
  }

  /**
   * Handle peer registration
   */
  async handleRegister(ws, message) {
    const { peerId, metadata } = message;
    
    if (!this.validatePeerId(peerId)) {
      throw new Error('Invalid peerId format');
    }
    
    // Store peer data
    this.peerData.set(peerId, {
      peerId,
      timestamp: Date.now(),
      metadata: metadata || {}
    });
    
    this.connections.set(peerId, ws);
    
    // Respond with network information
    ws.send(JSON.stringify({
      type: 'registered',
      peerId,
      network: this.getNetworkInfo(),
      bootstrapNodes: await this.getBootstrapNodes()
    }));
    
    this.emit('peerRegistered', { peerId, metadata });
  }

  /**
   * Handle peer discovery requests
   */
  async handleDiscover(ws, message) {
    const { targetPeerId, maxPeers = 3 } = message;
    
    // Get peers from local connections
    const localPeers = Array.from(this.peerData.keys());
    const closestPeers = this.findClosestPeers(targetPeerId, localPeers, maxPeers);
    
    // Also discover from Kademlia network
    const bootstrapNodes = await this.bootstrapRegistry.discoverBootstrapNodes();
    
    ws.send(JSON.stringify({
      type: 'discovered',
      peers: closestPeers.map(peerId => this.peerData.get(peerId)),
      bootstrapNodes: bootstrapNodes.slice(0, maxPeers)
    }));
  }

  /**
   * Handle signaling messages between peers
   */
  async handleSignal(ws, message) {
    const { targetPeerId, signalData } = message;
    const targetWs = this.connections.get(targetPeerId);
    
    if (targetWs && targetWs.readyState === WebSocket.OPEN) {
      targetWs.send(JSON.stringify({
        type: 'signal',
        signalData,
        fromPeerId: message.fromPeerId
      }));
    } else {
      ws.send(JSON.stringify({
        type: 'error',
        error: `Peer ${targetPeerId} not found or not connected`
      }));
    }
  }

  /**
   * Handle peer announcement (similar to register but with peer discovery)
   */
  async handleAnnounce(ws, message, peerId) {
    const { data: messageData } = message;
    
    if (!this.validatePeerId(peerId)) {
      throw new Error('Invalid peerId format');
    }
    
    // Store peer data
    this.peerData.set(peerId, {
      peerId,
      timestamp: Date.now(),
      data: messageData,
      connected: true
    });
    
    this.connections.set(peerId, ws);
    
    // Get active peers (excluding the announcing peer)
    const activePeers = Array.from(this.connections.keys()).filter(id => id !== peerId);
    
    console.log(`📢 Peer ${peerId.substring(0, 8)}... announced to ${activePeers.length} local peers`);
    
    // Store peer announcement in the Kademlia DHT for cross-node discovery
    try {
      const peerAnnouncement = {
        peerId,
        nodeId: this.instanceId, // Use WebSocket server instance ID, not Kademlia node ID
        websocketUrl: `ws://${this.config.websocket.host}:${this.config.websocket.port}?peerId=${peerId}`,
        data: messageData,
        timestamp: Date.now()
      };
      
      await this.bootstrapRegistry.storeData(`peer:${peerId}`, peerAnnouncement);
      console.log(`🌐 Stored peer ${peerId.substring(0, 8)}... in DHT for cross-node discovery`);
      
      // Add peer to searchable index
      await this.addPeerToIndex(peerId);
      
      // Also discover other peers from the DHT
      const networkPeers = await this.discoverNetworkPeers(peerId);
      console.log(`🔍 Found ${networkPeers.length} peers in the network DHT`);
      
      // Send network peers to the announcing peer
      networkPeers.forEach(networkPeer => {
        if (networkPeer.peerId !== peerId) {
          ws.send(JSON.stringify({
            type: 'peer-discovered',
            data: networkPeer,
            fromPeerId: 'system',
            targetPeerId: peerId,
            timestamp: Date.now()
          }));
        }
      });
      
    } catch (error) {
      console.error(`❌ Failed to store peer in DHT:`, error);
    }
    
    // Notify other LOCAL peers about the new peer
    activePeers.forEach(otherPeerId => {
      const otherWs = this.connections.get(otherPeerId);
      if (otherWs && otherWs.readyState === WebSocket.OPEN) {
        otherWs.send(JSON.stringify({
          type: 'peer-discovered',
          data: { peerId, ...messageData },
          fromPeerId: 'system',
          targetPeerId: otherPeerId,
          timestamp: Date.now()
        }));
      }
    });
    
    // Send existing LOCAL peers to the new peer
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
    
    this.emit('peerAnnounced', { peerId, data: messageData });
  }

  /**
   * Discover peers across the entire network via DHT
   */
  async discoverNetworkPeers(excludePeerId = null) {
    const networkPeers = [];
    
    try {
      // Search for peer announcements in the DHT
      // First get the peer index to find all peer keys
      const peerIndex = await this.bootstrapRegistry.getData('peer-index');
      console.log(`🔍 Retrieved peer index:`, peerIndex);
      
      if (peerIndex && Array.isArray(peerIndex)) {
        for (const peerKey of peerIndex) {
          try {
            const peerData = await this.bootstrapRegistry.getData(peerKey);
            console.log(`🔍 Retrieved peer data for ${peerKey}:`, peerData);
            
            if (peerData && peerData.peerId !== excludePeerId && !peerData.disconnected) {
              // Filter out stale announcements (older than 5 minutes)
              const ageMs = Date.now() - (peerData.timestamp || 0);
              if (ageMs < 5 * 60 * 1000) {
                networkPeers.push(peerData);
              } else {
                console.log(`⏰ Peer ${peerData.peerId?.substring(0, 8)}... is stale (${Math.round(ageMs/1000)}s old)`);
              }
            }
          } catch (error) {
            console.log(`⚠️  Could not retrieve peer data for ${peerKey}: ${error.message}`);
          }
        }
      } else {
        console.log(`📂 Peer index is empty or invalid:`, peerIndex);
      }
    } catch (error) {
      console.error(`❌ Failed to discover network peers:`, error.message);
    }
    
    console.log(`🌐 Found ${networkPeers.length} network peers`);
    return networkPeers;
  }

  /**
   * Search for peer keys in the DHT
   * Note: This is a simplified implementation. In a real system,
   * you might want to use a more efficient discovery mechanism.
   */
  async searchPeerKeys() {
    // For now, we'll maintain a simple index of peer keys
    // In a production system, you might use a different approach
    try {
      const peerIndex = await this.bootstrapRegistry.getData('peer-index') || [];
      return peerIndex;
    } catch (error) {
      return [];
    }
  }

  /**
   * Add a peer key to the searchable index
   */
  async addPeerToIndex(peerId) {
    try {
      // Get current peer index from DHT
      let peerIndex = [];
      try {
        peerIndex = await this.bootstrapRegistry.getData('peer-index') || [];
      } catch (error) {
        console.log(`📂 Creating new peer index (previous not found)`);
        peerIndex = [];
      }
      
      const peerKey = `peer:${peerId}`;
      
      if (!peerIndex.includes(peerKey)) {
        peerIndex.push(peerKey);
        await this.bootstrapRegistry.storeData('peer-index', peerIndex);
        console.log(`📇 Added ${peerKey} to peer index (total: ${peerIndex.length})`);
      } else {
        console.log(`📇 Peer ${peerKey} already in index`);
      }
    } catch (error) {
      console.error(`❌ Failed to add peer to index:`, error.message);
    }
  }

  /**
   * Handle WebRTC signaling messages (offer, answer, ice-candidate)
   */
  async handleWebRTCSignaling(ws, message, fromPeerId) {
    const { targetPeerId } = message;
    
    // First check if this peer has a stored reverse route (for return signaling)
    const reverseRoute = this.crossNodeRoutes?.get(fromPeerId);
    if (reverseRoute && targetPeerId === reverseRoute.remotePeerId) {
      console.log(`🔄 Using reverse route for ${message.type} from ${fromPeerId?.substring(0, 8)}... to ${targetPeerId.substring(0, 8)}... on node ${reverseRoute.nodeId?.substring(0, 8)}...`);
      
      try {
        const success = await this.forwardSignalingMessage(reverseRoute, {
          ...message,
          fromPeerId: fromPeerId,
          timestamp: Date.now()
        });
        
        if (success) {
          console.log(`✅ Successfully used reverse route for ${message.type}`);
          return;
        } else {
          console.log(`⚠️  Reverse route failed, falling back to normal routing`);
        }
      } catch (error) {
        console.log(`⚠️  Reverse route error: ${error.message}, falling back to normal routing`);
      }
    }
    
    const targetWs = this.connections.get(targetPeerId);
    
    if (targetWs && targetWs.readyState === WebSocket.OPEN) {
      // Target peer is on this node - direct routing
      targetWs.send(JSON.stringify({
        ...message,
        fromPeerId: fromPeerId,
        timestamp: Date.now()
      }));
      
      console.log(`🔄 Routed ${message.type} from ${fromPeerId?.substring(0, 8)}... to ${targetPeerId.substring(0, 8)}... (local)`);
    } else {
      // Target peer is not on this node - try cross-node routing
      console.log(`🌐 Attempting cross-node routing for ${message.type} to ${targetPeerId.substring(0, 8)}...`);
      
      try {
        // First try to get the peer data immediately
        let targetPeerData = await this.bootstrapRegistry.getData(`peer:${targetPeerId}`);
        
        // If not found, wait a bit and try again (DHT eventual consistency)
        if (!targetPeerData) {
          console.log(`🔄 Peer not found immediately, retrying in 500ms...`);
          await new Promise(resolve => setTimeout(resolve, 500));
          targetPeerData = await this.bootstrapRegistry.getData(`peer:${targetPeerId}`);
        }
        
        console.log(`🔍 Cross-node routing debug:`, {
          targetPeerId: targetPeerId.substring(0, 8) + '...',
          peerDataFound: !!targetPeerData,
          peerNodeId: targetPeerData?.nodeId?.substring(0, 8) + '...',
          currentNodeId: this.instanceId?.substring(0, 8) + '...',
          nodeIdsDifferent: targetPeerData?.nodeId !== this.instanceId,
          isDisconnected: targetPeerData?.disconnected
        });
        
        if (targetPeerData && !targetPeerData.disconnected && targetPeerData.nodeId !== this.instanceId) {
          // Forward the signaling message to the target node
          const success = await this.forwardSignalingMessage(targetPeerData, {
            ...message,
            fromPeerId: fromPeerId,
            timestamp: Date.now()
          });
          
          if (success) {
            console.log(`✅ Successfully forwarded ${message.type} to node ${targetPeerData.nodeId.substring(0, 8)}...`);
          } else {
            throw new Error('Failed to forward message');
          }
        } else {
          throw new Error('Target peer not found in DHT or on same node');
        }
      } catch (error) {
        console.log(`❌ Cross-node routing failed: ${error.message}`);
        ws.send(JSON.stringify({
          type: 'error',
          error: `Peer ${targetPeerId.substring(0, 8)}... not found or unreachable`,
          timestamp: Date.now()
        }));
      }
    }
  }

  /**
   * Forward a signaling message to another node
   */
  async forwardSignalingMessage(targetPeerData, message) {
    // Forward messages to other nodes via WebSocket connection
    
    try {
      // Extract the target node's address from the websocketUrl
      const url = new URL(targetPeerData.websocketUrl);
      const targetHost = url.hostname;
      const targetPort = parseInt(url.port);
      
      // Create a forwarding URL with a system peerId
      const forwardingPeerId = `system_${this.bootstrapRegistry.dht.nodeId.substring(0, 16)}`;
      const forwardingUrl = `ws://${targetHost}:${targetPort}/ws?peerId=${forwardingPeerId}`;
      
      // Create a temporary WebSocket connection to forward the message
      const WebSocket = (await import('ws')).default;
      const forwardWs = new WebSocket(forwardingUrl);
      
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          forwardWs.close();
          reject(new Error('Forwarding timeout'));
        }, 5000);
        
        forwardWs.on('open', () => {
          clearTimeout(timeout);
          // Send the message directly to be routed to the target peer
          forwardWs.send(JSON.stringify({
            ...message,
            type: 'forward',
            originalTargetPeerId: targetPeerData.peerId
          }));
          
          console.log(`🔍 Forwarding message structure:`, {
            originalType: message.type,
            originalMessage: message,
            forwardedStructure: {
              ...message,
              type: 'forward',
              originalTargetPeerId: targetPeerData.peerId
            }
          });
          forwardWs.close();
          resolve(true);
        });
        
        forwardWs.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
    } catch (error) {
      console.error(`❌ Failed to forward signaling message:`, error);
      return false;
    }
  }

  /**
   * Handle forwarded messages from other nodes
   */
  async handleForwardedMessage(ws, message) {
    const { originalTargetPeerId, type: originalType, ...originalMessage } = message;
    
    // Find the target peer on this node
    const targetConnection = this.connections.get(originalTargetPeerId);
    
    if (targetConnection) {
      console.log(`🔄 Forwarded ${originalType} from ${originalMessage.fromPeerId?.substring(0, 8)}... to ${originalTargetPeerId?.substring(0, 8)}... (cross-node)`);
      
      // Store reverse routing information for return messages
      if (originalMessage.fromPeerId && originalTargetPeerId) {
        // Get the source peer data to enable return routing
        try {
          const sourcePeerKey = `${this.networkId}:peer:${originalMessage.fromPeerId}`;
          const sourcePeerData = await this.bootstrapRegistry.getData('peer:' + originalMessage.fromPeerId);
          
          if (sourcePeerData) {
            // Store that this target peer should route responses back to the source peer on another node
            this.crossNodeRoutes = this.crossNodeRoutes || new Map();
            this.crossNodeRoutes.set(originalTargetPeerId, {
              remotePeerId: originalMessage.fromPeerId,
              nodeId: sourcePeerData.nodeId,
              websocketUrl: sourcePeerData.websocketUrl,
              timestamp: Date.now()
            });
            console.log(`🔄 Stored reverse route: ${originalTargetPeerId?.substring(0, 8)}... -> ${originalMessage.fromPeerId?.substring(0, 8)}... on node ${sourcePeerData.nodeId?.substring(0, 8)}...`);
          }
        } catch (error) {
          console.log(`⚠️  Could not store reverse route: ${error.message}`);
        }
      }
      
      // Reconstruct the original message exactly as it was sent
      const reconstructedMessage = {
        type: originalType,
        targetPeerId: originalTargetPeerId,
        fromPeerId: originalMessage.fromPeerId,
        timestamp: Date.now(),
        // Preserve all WebRTC-specific data (sdp, candidate, etc.)
        ...originalMessage
      };
      
      // Remove the forwarding metadata
      delete reconstructedMessage.originalTargetPeerId;
      
      console.log(`🔍 Reconstructed message for target:`, reconstructedMessage);
      
      targetConnection.send(JSON.stringify(reconstructedMessage));
    } else {
      console.log(`❌ Forward target ${originalTargetPeerId?.substring(0, 8)}... not found on this node`);
    }
  }

  /**
   * Handle peer disconnect messages
   */
  async handleGoodbye(ws, message, peerId) {
    console.log(`👋 Peer ${peerId?.substring(0, 8)}... said goodbye`);
    
    // Clean up local peer data
    this.peerData.delete(peerId);
    this.connections.delete(peerId);
    
    // Clean up peer data from DHT
    try {
      await this.removePeerFromDHT(peerId);
    } catch (error) {
      console.error(`❌ Failed to remove peer from DHT:`, error);
    }
    
    // Notify other LOCAL peers
    const activePeers = Array.from(this.connections.keys());
    activePeers.forEach(otherPeerId => {
      const otherWs = this.connections.get(otherPeerId);
      if (otherWs && otherWs.readyState === WebSocket.OPEN) {
        otherWs.send(JSON.stringify({
          type: 'peer-disconnected',
          data: { peerId },
          fromPeerId: 'system',
          targetPeerId: otherPeerId,
          timestamp: Date.now()
        }));
      }
    });
    
    this.emit('peerDisconnected', { peerId });
  }

  /**
   * Remove peer from DHT and index
   */
  async removePeerFromDHT(peerId) {
    try {
      // Mark peer as disconnected (we can't delete, so we'll store null or mark as expired)
      await this.bootstrapRegistry.storeData(`peer:${peerId}`, {
        peerId,
        disconnected: true,
        timestamp: Date.now()
      });
      
      // Remove from index
      const peerIndex = await this.bootstrapRegistry.getData('peer-index') || [];
      const peerKey = `peer:${peerId}`;
      const updatedIndex = peerIndex.filter(key => key !== peerKey);
      
      if (updatedIndex.length !== peerIndex.length) {
        await this.bootstrapRegistry.storeData('peer-index', updatedIndex);
      }
      
      console.log(`🧹 Marked peer ${peerId.substring(0, 8)}... as disconnected in DHT`);
    } catch (error) {
      console.error(`❌ Failed to remove peer from DHT:`, error);
    }
  }

  /**
   * Register this node in the Kademlia network
   */
  async registerInNetwork() {
    if (this.config.role === 'bootstrap') {
      await this.bootstrapRegistry.registerAsBootstrap(this.config.capabilities);
    }
    
    // Store network configuration
    await this.bootstrapRegistry.storeData('network-config', {
      websocketPort: this.config.websocket.port,
      capabilities: this.config.capabilities,
      role: this.config.role,
      timestamp: Date.now()
    });
  }

  /**
   * Get bootstrap nodes for WebSocket clients
   */
  async getBootstrapNodes() {
    const bootstraps = await this.bootstrapRegistry.discoverBootstrapNodes();
    return bootstraps.map(node => ({
      nodeId: node.nodeId,
      websocketUrl: `ws://${node.address}:${node.metadata?.websocketPort || 3000}/ws`,
      capabilities: node.metadata?.capabilities || []
    }));
  }

  /**
   * Get current network information
   */
  getNetworkInfo() {
    const kademliaInfo = this.bootstrapRegistry ? this.bootstrapRegistry.getNetworkInfo() : {};
    
    return {
      nodeId: kademliaInfo.nodeId,
      networkId: this.config.kademlia.networkId,
      role: this.config.role,
      capabilities: this.config.capabilities,
      websocket: {
        host: this.config.websocket.host,
        port: this.config.websocket.port,
        connectedPeers: this.connections.size
      },
      kademlia: {
        address: this.config.kademlia.address,
        port: kademliaInfo.dhtStats?.port || this.config.kademlia.port,
        stats: kademliaInfo.dhtStats
      },
      isRunning: this.isRunning
    };
  }

  /**
   * Utility functions
   */
  validatePeerId(peerId) {
    // Accept both Kademlia format (40 hex chars) and PeerPigeon format
    if (typeof peerId !== 'string' || peerId.length === 0) {
      return false;
    }
    
    // Kademlia format: 40 character hex string
    if (/^[a-fA-F0-9]{40}$/.test(peerId)) {
      return true;
    }
    
    // PeerPigeon format: more flexible, just check it's a reasonable string
    if (peerId.length >= 8 && peerId.length <= 100) {
      return true;
    }
    
    return false;
  }

  findClosestPeers(targetPeerId, allPeerIds, maxPeers = 3) {
    if (!targetPeerId || !allPeerIds || allPeerIds.length === 0) {
      return [];
    }
    
    // For Kademlia peers, use XOR distance
    if (this.validatePeerId(targetPeerId) && /^[a-fA-F0-9]{40}$/.test(targetPeerId)) {
      return this.calculateKademliaClosestPeers(targetPeerId, allPeerIds, maxPeers);
    }
    
    // For other peers, use simple filtering
    return allPeerIds
      .filter(peerId => peerId !== targetPeerId)
      .slice(0, maxPeers);
  }

  calculateKademliaClosestPeers(targetPeerId, allPeerIds, maxPeers) {
    const distances = allPeerIds
      .filter(peerId => peerId !== targetPeerId)
      .map(peerId => ({
        peerId,
        distance: this.calculateXORDistance(targetPeerId, peerId)
      }))
      .sort((a, b) => {
        if (a.distance < b.distance) return -1;
        if (a.distance > b.distance) return 1;
        return 0;
      });
    
    return distances.slice(0, maxPeers).map(item => item.peerId);
  }

  calculateXORDistance(peerId1, peerId2) {
    try {
      const id1 = BigInt('0x' + peerId1);
      const id2 = BigInt('0x' + peerId2);
      return id1 ^ id2;
    } catch (error) {
      // Fallback for non-hex peer IDs
      return Math.abs(peerId1.localeCompare(peerId2));
    }
  }

  /**
   * Send message to specific peer
   */
  async sendToSpecificPeer(targetPeerId, message) {
    try {
      const ws = this.connections.get(targetPeerId);
      if (ws && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(message));
        console.log(`Direct message sent to ${targetPeerId}: ${message.type}`);
        return true;
      } else {
        console.log(`No active connection found for peer: ${targetPeerId}`);
        return false;
      }
    } catch (error) {
      console.error(`Error sending to peer ${targetPeerId}:`, error);
      return false;
    }
  }

  /**
   * Broadcast message to closest peers
   */
  async broadcastToClosestPeers(fromPeerId, message, maxPeers = 5) {
    try {
      const allPeerIds = Array.from(this.connections.keys());
      const closestPeerIds = this.findClosestPeers(fromPeerId, allPeerIds, maxPeers);
      
      console.log(`Broadcasting to ${closestPeerIds.length} closest peers for ${fromPeerId}:`, closestPeerIds.map(p => p.substring(0, 8)));
      
      const broadcastPromises = closestPeerIds.map(async (peerId) => {
        return this.sendToSpecificPeer(peerId, message);
      });
      
      const results = await Promise.all(broadcastPromises);
      const successCount = results.filter(Boolean).length;
      
      console.log(`Successfully broadcast to ${successCount}/${closestPeerIds.length} peers`);
      return successCount;
    } catch (error) {
      console.error('Error broadcasting to closest peers:', error);
      return 0;
    }
  }

  /**
   * Handle cleanup messages
   */
  async handleCleanup(peerId, targetPeerId = null, cleanupAll = false) {
    try {
      let totalCleaned = 0;
      
      if (cleanupAll) {
        // Clean up all data for this peer
        this.peerData.delete(peerId);
        this.connections.delete(peerId);
        
        // Clean up any reverse routes involving this peer
        this.crossNodeRoutes.delete(peerId);
        for (const [localPeerId, route] of this.crossNodeRoutes.entries()) {
          if (route.remotePeerId === peerId) {
            this.crossNodeRoutes.delete(localPeerId);
            totalCleaned++;
          }
        }
        
        totalCleaned++;
        console.log(`Cleanup completed: removed all data for peer ${peerId}`);
        
      } else if (targetPeerId) {
        // Clean up data between two specific peers
        for (const [localPeerId, route] of this.crossNodeRoutes.entries()) {
          if ((localPeerId === peerId && route.remotePeerId === targetPeerId) ||
              (localPeerId === targetPeerId && route.remotePeerId === peerId)) {
            this.crossNodeRoutes.delete(localPeerId);
            totalCleaned++;
          }
        }
        
        console.log(`Cleanup completed: removed ${totalCleaned} items between ${peerId} and ${targetPeerId}`);
      }
      
      return totalCleaned;
    } catch (error) {
      console.error('Error in handleCleanup:', error);
      return 0;
    }
  }
}

export default PigeonHub;
