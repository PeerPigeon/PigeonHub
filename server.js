#!/usr/bin/env node

// Local PigeonHub node with working HTTP replication
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import fetch from 'node-fetch';

// Get port from environment variables or command line argument or use default
const port = parseInt(process.env.PORT) || parseInt(process.argv[2]) || 8080;
const nodeId = process.argv[3] || `node-${port}`;

console.log(`🚀 Starting PigeonHub node: ${nodeId} on port ${port}`);

const app = express();
const server = createServer(app);

// Set timeouts
server.timeout = 5000;
server.keepAliveTimeout = 5000;
server.headersTimeout = 6000;

// EXACT PeerPigeon signaling server implementation
const connections = new Map(); // peerId -> WebSocket connection
const peerData = new Map(); // peerId -> { peerId, timestamp, data }

// Utility functions from server.js
function validatePeerId(peerId) {
  return typeof peerId === 'string' && /^[a-fA-F0-9]{40}$/.test(peerId);
}

function findClosestPeers(targetPeerId, allPeerIds, maxPeers = 3) {
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

function getActivePeers(excludePeerId = null) {
  const peers = [];
  const stalePeers = [];

  for (const [peerId, connection] of connections) {
    if (peerId !== excludePeerId) {
      if (connection.readyState === 1 && isConnectionAlive(connection)) { // WebSocket.OPEN
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
    connections.delete(peerId);
    peerData.delete(peerId);
  });

  return peers;
}

function isConnectionAlive(connection) {
  if (!connection || connection.readyState !== 1) { // WebSocket.OPEN
    return false;
  }
  return true;
}

function sendToConnection(peerId, data) {
  const connection = connections.get(peerId);
  if (connection && connection.readyState === 1) { // WebSocket.OPEN
    try {
      connection.send(JSON.stringify(data));
      return true;
    } catch (error) {
      console.error(`Error sending to ${peerId}:`, error);
      cleanupPeer(peerId);
      return false;
    }
  } else if (connection && (connection.readyState === 3 || connection.readyState === 2)) { // CLOSED or CLOSING
    cleanupPeer(peerId);
  }
  return false;
}

function cleanupPeer(peerId) {
  const wasConnected = connections.has(peerId);
  connections.delete(peerId);
  peerData.delete(peerId);

  if (wasConnected) {
    console.log(`🧹 Cleaned up peer: ${peerId.substring(0, 8)}...`);

    // Notify other peers about disconnection
    const activePeers = getActivePeers();
    activePeers.forEach(otherPeerId => {
      sendToConnection(otherPeerId, {
        type: 'peer-disconnected',
        data: { peerId },
        fromPeerId: 'system',
        targetPeerId: otherPeerId,
        timestamp: Date.now()
      });
    });
  }
}

function sendToSpecificPeer(targetPeerId, message) {
  return sendToConnection(targetPeerId, message);
}

// Create WebSocket server using the EXACT PeerPigeon implementation
const wss = new WebSocketServer({ server });

console.log(`� Starting EXACT PeerPigeon signaling server on ${nodeId}...`);

// Periodic cleanup of stale connections
setInterval(() => {
  const totalConnections = connections.size;
  getActivePeers(); // This will clean up stale connections
  const cleanedUp = totalConnections - connections.size;

  if (cleanedUp > 0) {
    console.log(`🧹 Periodic cleanup: removed ${cleanedUp} stale connections, ${connections.size} active`);
  }
}, 30000); // Clean up every 30 seconds

// WebSocket keepalive to prevent Heroku H15 idle timeouts
setInterval(() => {
  console.log(`💓 Sending keepalive pings to ${connections.size} connections...`);
  let pingSent = 0;
  
  for (const [peerId, ws] of connections.entries()) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        // Send ping frame to keep connection alive
        ws.ping();
        
        // Also send a keepalive message
        ws.send(JSON.stringify({
          type: 'keepalive',
          timestamp: Date.now(),
          nodeId
        }));
        
        pingSent++;
      } catch (error) {
        console.log(`❌ Failed to ping ${peerId.substring(0, 8)}...: ${error.message}`);
        cleanupPeer(peerId);
      }
    }
  }
  
  console.log(`💓 Sent keepalive to ${pingSent} peers`);
}, 30000); // Send keepalive every 30 seconds (well under Heroku's 55-second timeout)

wss.on('connection', (ws, req) => {
  let peerId = null;

  // Extract peerId from query parameters
  const url = new URL(req.url, `http://${req.headers.host}`);
  const queryPeerId = url.searchParams.get('peerId');

  // Check if this is a PeerPigeon mesh connection (no peerId query param)
  if (!queryPeerId) {
    console.log(`🔗 PeerPigeon mesh peer connection detected`);
    // Let PeerPigeon handle this connection - don't close it
    return;
  }

  if (!validatePeerId(queryPeerId)) {
    console.log(`❌ Invalid peerId: ${queryPeerId}`);
    ws.close(1008, 'Invalid peerId');
    return;
  }

  peerId = queryPeerId;

  // Check if peerId is already connected
  if (connections.has(peerId)) {
    const existingConnection = connections.get(peerId);
    if (existingConnection.readyState === 1) { // WebSocket.OPEN
      console.log(`⚠️  Peer ${peerId.substring(0, 8)}... already connected, closing duplicate`);
      ws.close(1008, 'Peer already connected');
      return;
    } else {
      // Clean up stale connection
      console.log(`🔄 Replacing stale connection for ${peerId.substring(0, 8)}...`);
      cleanupPeer(peerId);
    }
  }

  // Store connection
  connections.set(peerId, ws);
  peerData.set(peerId, {
    peerId,
    timestamp: Date.now(),
    connected: true
  });

  // Set up connection metadata
  ws.connectedAt = Date.now();

  console.log(`✅ Peer ${peerId.substring(0, 8)}... connected to ${nodeId} (${connections.size} total)`);

  // Send connection confirmation
  ws.send(JSON.stringify({
    type: 'connected',
    peerId,
    timestamp: Date.now()
  }));

  // Handle WebSocket ping/pong for keepalive
  ws.on('ping', (data) => {
    ws.pong(data);
  });

  ws.on('pong', (data) => {
    // Update last pong time for connection health tracking
    ws.lastPong = Date.now();
  });

  // Handle incoming messages
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      const { type, data: messageData, targetPeerId } = message;

      console.log(`� Received ${type} from ${peerId.substring(0, 8)}...`);

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
          peerData.set(peerId, {
            peerId,
            timestamp: Date.now(),
            data: messageData,
            connected: true
          });

          // Get active peers with immediate validation
          const activePeers = getActivePeers(peerId);

          // Double-check each active peer with a quick ping test
          const validatedPeers = [];
          for (const otherPeerId of activePeers) {
            const connection = connections.get(otherPeerId);
            if (connection && isConnectionAlive(connection)) {
              validatedPeers.push(otherPeerId);
            } else {
              console.log(`🧹 Found dead connection during announce: ${otherPeerId.substring(0, 8)}...`);
              cleanupPeer(otherPeerId);
            }
          }

          console.log(`📢 Announcing ${peerId.substring(0, 8)}... to ${validatedPeers.length} validated peers`);

          // Send peer-discovered messages to validated peers only
          validatedPeers.forEach(otherPeerId => {
            sendToConnection(otherPeerId, {
              type: 'peer-discovered',
              data: { peerId, ...messageData },
              fromPeerId: 'system',
              targetPeerId: otherPeerId,
              timestamp: Date.now()
            });
          });

          // Send existing validated peers to the new peer
          validatedPeers.forEach(existingPeerId => {
            const existingPeerData = peerData.get(existingPeerId);
            ws.send(JSON.stringify({
              type: 'peer-discovered',
              data: { peerId: existingPeerId, ...existingPeerData?.data },
              fromPeerId: 'system',
              targetPeerId: peerId,
              timestamp: Date.now()
            }));
          });

          // Also send any stored remote peers from other nodes
          for (const [remotePeerId, remotePeerData] of peerData.entries()) {
            if (remotePeerData.remote && remotePeerId !== peerId) {
              try {
                ws.send(JSON.stringify({
                  type: 'peer-discovered',
                  data: remotePeerData,
                  fromPeerId: 'system',
                  targetPeerId: peerId,
                  timestamp: Date.now()
                }));
                console.log(`📡 Notified new peer ${peerId.substring(0, 8)}... about remote peer ${remotePeerId.substring(0, 8)}... from ${remotePeerData.sourceNode}`);
              } catch (error) {
                console.error(`❌ Failed to notify about remote peer: ${error.message}`);
              }
            }
          }

          // CROSS-NODE DISCOVERY: Tell other nodes about this peer
          const isProduction = process.env.NODE_ENV === 'production';
          const otherNodes = isProduction ? 
            // Production: Use deployed node URLs (exclude current node)
            [
              { url: 'https://pigeonhub-server-3c044110c06f.herokuapp.com', name: 'heroku' },
              { url: 'https://pigeonhub.fly.dev', name: 'fly' }
            ].filter(node => {
              // Filter out current node based on hostname
              const currentHost = process.env.HEROKU_APP_NAME || process.env.FLY_APP_NAME || 'unknown';
              return !node.url.includes(currentHost);
            }) :
            // Development: Use local ports
            [3000, 3001, 3002, 3003].filter(p => p !== port).map(p => ({ 
              url: `http://127.0.0.1:${p}`, 
              name: `local-${p}` 
            }));

          // REMOVED: No more HTTP announcements - use PeerPigeon mesh only
          console.log('🌐 Broadcasting peer announcement via PeerPigeon mesh...');
          
          if (mesh && connectedToMesh) {
            try {
              const meshMessage = {
                type: 'peer-announcement',
                peerId: peerId,
                name: messageData?.name || 'unnamed',
                sourceNode: nodeId,
                timestamp: Date.now()
              };
              
              console.log('📤 Sending mesh announcement:', JSON.stringify(meshMessage));
              mesh.sendMessage(JSON.stringify(meshMessage));
              console.log('✅ Sent peer announcement via PeerPigeon mesh');
            } catch (error) {
              console.error('❌ Failed to send PeerPigeon mesh announcement:', error.message);
            }
          } else {
            console.log('⚠️ PeerPigeon mesh not available for cross-node announcement');
          }
          break;
        }

        case 'goodbye': {
          // Handle peer disconnect
          peerData.delete(peerId);
          break;
        }

        case 'keepalive': {
          // Handle keepalive message - just respond to keep connection active
          console.log(`💓 Keepalive from ${peerId.substring(0, 8)}...`);
          ws.send(JSON.stringify({
            type: 'keepalive-ack',
            timestamp: Date.now(),
            nodeId
          }));
          break;
        }

        case 'offer':
        case 'answer':
        case 'ice-candidate': {
          // Handle WebRTC signaling - this is the server's primary purpose
          console.log(`🎯 Signaling ${type} from ${peerId.substring(0, 8)}... to ${targetPeerId?.substring(0, 8) || 'unknown'}`);
          
          if (targetPeerId) {
            const success = sendToSpecificPeer(targetPeerId, responseMessage);
            if (success) {
              console.log(`✅ Routed ${type} locally to ${targetPeerId.substring(0, 8)}...`);
            } else {
              console.log(`⚠️  Failed to send ${type} to ${targetPeerId.substring(0, 8)}... (peer not found locally)`);
              
              // CROSS-NODE ROUTING: Use PeerPigeon mesh to route through other nodes
              if (mesh && connectedToMesh) {
                console.log(`🌐 Trying cross-node routing via PeerPigeon mesh for ${type}...`);
                
                const meshMessage = {
                  messageType: 'pigeonhub-signal-route',
                  signalType: type,
                  signalData: messageData,
                  fromPeerId: peerId,
                  targetPeerId,
                  routingNode: nodeId,
                  timestamp: Date.now()
                };
                
                try {
                  // Send direct message to the other PigeonHub node
                  // Use broadcast since we don't know the specific peer ID of the other node
                  const messageId = mesh.sendMessage(JSON.stringify(meshMessage));
                  console.log(`📡 Sent ${type} routing request via mesh broadcast (ID: ${messageId})`);
                  
                  // Note: We use broadcast because both nodes are part of the same mesh network
                  // The receiving node will filter for pigeonhub-signal-route messages
                  
                } catch (error) {
                  console.log(`❌ Failed to route ${type} via mesh: ${error.message}`);
                  
                  // Send error to sender since mesh routing failed
                  ws.send(JSON.stringify({
                    type: 'error',
                    error: `Target peer ${targetPeerId.substring(0, 8)}... not found and mesh routing failed`,
                    originalType: type,
                    timestamp: Date.now()
                  }));
                }
              } else {
                console.log(`❌ Mesh not available for cross-node routing`);
                
                // Send error to sender since no mesh available
                ws.send(JSON.stringify({
                  type: 'error',
                  error: `Target peer ${targetPeerId.substring(0, 8)}... not found on this node and mesh unavailable`,
                  originalType: type,
                  timestamp: Date.now()
                }));
              }
            }
          } else {
            console.log(`⚠️  ${type} message missing targetPeerId`);
          }
          break;
        }

        default:
          // Signaling server should NOT route regular peer messages
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
  });

  // Handle connection close
  ws.on('close', (code, reason) => {
    console.log(`🔌 Peer ${peerId?.substring(0, 8)}... disconnected from ${nodeId} (${code}: ${reason})`);

    if (peerId) {
      cleanupPeer(peerId);
    }

    console.log(`📊 Active connections: ${connections.size}`);
  });

  // Handle connection errors
  ws.on('error', (error) => {
    console.error(`❌ WebSocket error for ${peerId?.substring(0, 8)}...:`, error);

    // Clean up errored connection
    if (peerId && (ws.readyState === 3 || ws.readyState === 2)) { // CLOSED or CLOSING
      cleanupPeer(peerId);
    }
  });
});

// Enable CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

app.use(express.json());

// Initialize state
let signalDir = null;
let dht = null;
let mesh = null;
let isBootstrapping = false;

// Track startup time
const startTime = Date.now();
let connectedToMesh = false;

// Working health endpoint
app.get('/health', (req, res) => {
  console.log(`📥 Health check from ${req.ip}`);
  res.json({
    status: 'healthy',
    nodeId,
    port,
    uptime: Date.now() - startTime,
    connected: connectedToMesh,
    isBootstrapping,
    dhtReady: !!dht,
    signalDirReady: !!signalDir,
    timestamp: new Date().toISOString()
  });
  console.log(`✅ Health response sent`);
});

// Get signaling server status
app.get('/signaling', async (req, res) => {
  const connectedPeers = Array.from(peerData.entries()).map(([peerId, data]) => ({
    peerId: peerId.substring(0, 8) + '...',
    fullPeerId: peerId,
    nodeId: data.nodeId,
    timestamp: data.timestamp,
    connected: connections.has(peerId)
  }));
  
  // Generate a sample peer ID to show in the URL
  let samplePeerId = "GENERATE_A_PEER_ID_FIRST";
  try {
    const { sha1Hex } = await import('./src/index.js');
    const randomBytes = new Uint8Array(16);
    if (globalThis.crypto?.getRandomValues) {
      globalThis.crypto.getRandomValues(randomBytes);
    } else {
      const crypto = await import('crypto');
      const randomBuffer = crypto.randomBytes(16);
      randomBytes.set(randomBuffer);
    }
    samplePeerId = await sha1Hex(randomBytes);
  } catch (e) {
    // Keep placeholder if generation fails
  }
  
  res.json({
    nodeId,
    signalingPort: port,
    wsUrl: `ws://localhost:${port}`,
    webrtcUrl: `ws://localhost:${port}?peerId=${samplePeerId}`,
    generatePeerIdUrl: `http://localhost:${port}/generate-peer-id`,
    connectedPeers,
    totalConnections: connections.size,
    peerDataEntries: peerData.size,
    instructions: "Use /generate-peer-id to create a proper SHA1 peer ID",
    alternativeUrls: {
      wsUrl127: `ws://127.0.0.1:${port}`,
      webrtcUrl127: `ws://127.0.0.1:${port}?peerId=${samplePeerId}`
    },
    timestamp: new Date().toISOString()
  });
});

// Generate a proper peer ID using PeerPigeon's sha1Hex utility
app.get('/generate-peer-id', async (req, res) => {
  try {
    // Import PeerPigeon's sha1Hex utility
    const { sha1Hex } = await import('./src/index.js');
    
    // Generate random bytes for the peer ID
    const randomBytes = new Uint8Array(32);
    if (globalThis.crypto?.getRandomValues) {
      globalThis.crypto.getRandomValues(randomBytes);
    } else {
      // Fallback for Node.js
      const crypto = await import('crypto');
      const randomBuffer = crypto.randomBytes(32);
      randomBytes.set(randomBuffer);
    }
    
    // Create SHA1 hash (40 hex characters)
    const peerId = await sha1Hex(randomBytes);
    
    res.json({
      peerId,
      length: peerId.length,
      wsUrl: `ws://localhost:${port}?peerId=${peerId}`,
      usage: {
        description: "Use this peerId to connect via WebSocket for WebRTC signaling",
        example: `const ws = new WebSocket('ws://localhost:${port}?peerId=${peerId}');`,
        alternativeExample: `const ws = new WebSocket('ws://127.0.0.1:${port}?peerId=${peerId}');`
      },
      nodeId,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Failed to generate peer ID:', error);
    res.status(500).json({
      error: 'Failed to generate peer ID',
      message: error.message,
      fallback: "Use any 40-character hex string as peerId",
      nodeId
    });
  }
});

// Accept signal routing from other nodes
app.post('/api/route-signal', (req, res) => {
  const { type, data, fromPeerId, targetPeerId, routingNode } = req.body;
  
  console.log(`🌐 Cross-node routing request: ${type} from ${routingNode} (${fromPeerId?.substring(0, 8)}...) to ${targetPeerId?.substring(0, 8) || 'unknown'}`);
  
  if (!targetPeerId || !type) {
    console.log(`❌ Invalid routing request: missing targetPeerId or type`);
    return res.status(400).json({ error: 'targetPeerId and type required' });
  }
  
  // Check if target peer is connected to this node
  const isTargetConnected = connections.has(targetPeerId);
  console.log(`🔍 Target peer ${targetPeerId.substring(0, 8)}... ${isTargetConnected ? 'IS' : 'NOT'} connected to ${nodeId}`);
  
  // Try to route to the target peer if connected to this node
  const success = sendToConnection(targetPeerId, {
    type,
    data,
    fromPeerId,
    targetPeerId,
    timestamp: Date.now()
  });
  
  if (success) {
    console.log(`✅ Cross-node routed ${type} to ${targetPeerId.substring(0, 8)}... on ${nodeId}`);
  } else {
    console.log(`❌ Failed to route ${type} to ${targetPeerId.substring(0, 8)}... on ${nodeId}`);
  }
  
  res.json({
    routed: success,
    nodeId,
    targetFound: connections.has(targetPeerId),
    connectionCount: connections.size
  });
});

// Accept peer announcements from other nodes
// REMOVED: HTTP announce-peer endpoint - using PeerPigeon mesh only

// WebRTC peer list endpoint
app.get('/peers', (req, res) => {
  const peers = [];
  
  for (const [peerId, data] of peerData.entries()) {
    peers.push({
      peerId: peerId.substring(0, 8) + '...',
      fullPeerId: peerId,
      nodeId: data.nodeId,
      connected: connections.has(peerId),
      timestamp: data.timestamp,
      data: data.data || {}
    });
  }
  
  res.json({
    nodeId,
    peers,
    count: peers.length,
    timestamp: new Date().toISOString()
  });
});

// Publish with HTTP replication
app.post('/api/publish', async (req, res) => {
  console.log(`📥 Publish request on ${nodeId}:`, req.body);
  
  try {
    const { topic, data, ttl = 300 } = req.body;
    
    if (!topic || !data) {
      return res.status(400).json({ error: 'topic and data required' });
    }
    
    // Create record
    const record = {
      id: `${nodeId}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      topic,
      data,
      nodeId,
      timestamp: Date.now(),
      expiresAt: Date.now() + (ttl * 1000)
    };
    
    // Store locally if DHT available
    if (mesh && mesh.dhtPut) {
      try {
        await mesh.dhtPut(topic, record);
        console.log(`✅ Stored locally: ${topic}`);
      } catch (e) {
        console.log(`⚠️ Local storage failed: ${e.message}`);
      }
    }
    
    // Replicate to other nodes via HTTP
    const otherPorts = [3000, 3001, 3002, 3003].filter(p => p !== port);
    let replicationCount = 0;
    
    for (const otherPort of otherPorts) {
      try {
        const replicationPayload = {
          topic,
          data,
          fromNode: nodeId,
          recordId: record.id
        };
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        
        const response = await fetch(`http://127.0.0.1:${otherPort}/api/replicate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(replicationPayload),
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
          replicationCount++;
          console.log(`✅ Replicated to port ${otherPort}`);
        }
      } catch (error) {
        console.log(`⚠️ Replication to port ${otherPort} failed: ${error.message}`);
      }
    }
    
    res.json({
      success: true,
      topic,
      recordId: record.id,
      nodeId,
      method: 'http-replication',
      replicatedTo: replicationCount,
      totalNodes: otherPorts.length + 1
    });
    
  } catch (error) {
    console.error('❌ Publish failed:', error);
    res.status(500).json({ 
      error: 'Publish failed', 
      message: error.message,
      nodeId 
    });
  }
});

// Accept replication from other nodes
app.post('/api/replicate', async (req, res) => {
  console.log(`📥 Replication from another node:`, req.body);
  
  const { topic, data, fromNode, recordId } = req.body;
  
  if (!topic || !data) {
    return res.status(400).json({ error: 'topic and data required' });
  }
  
  // Store the replicated data
  const record = {
    id: recordId || `replicated-${Date.now()}`,
    topic,
    data,
    nodeId: fromNode || 'unknown',
    timestamp: Date.now(),
    expiresAt: Date.now() + (300 * 1000),
    replicated: true
  };
  
  // Store in local DHT if available
  if (mesh && mesh.dhtPut) {
    try {
      await mesh.dhtPut(topic, record);
      console.log(`✅ Replicated data stored: ${topic}`);
    } catch (e) {
      console.log(`⚠️ Failed to store replicated data: ${e.message}`);
    }
  }
  
  res.json({
    success: true,
    topic,
    recordId: record.id,
    nodeId
  });
});

// Find data (checks local DHT)
app.get('/api/find/:topic', async (req, res) => {
  console.log(`📥 Find request on ${nodeId} for: ${req.params.topic}`);
  
  try {
    const { topic } = req.params;
    
    let record = null;
    if (mesh && mesh.dhtGet) {
      try {
        record = await mesh.dhtGet(topic);
        console.log(`🔍 DHT get result:`, record ? 'found' : 'not found');
      } catch (e) {
        console.log(`⚠️ DHT get failed: ${e.message}`);
      }
    }
    
    let records = [];
    if (record && (!record.expiresAt || record.expiresAt > Date.now())) {
      records = [record];
    }
    
    res.json({
      topic,
      count: records.length,
      records,
      nodeId,
      source: 'local-dht',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Find failed:', error);
    res.status(500).json({ 
      error: 'Find failed', 
      message: error.message,
      nodeId 
    });
  }
});

// Bootstrap by connecting to Fly.io as a PeerPigeon peer
async function bootstrap() {
  if (isBootstrapping) return;
  isBootstrapping = true;
  
  try {
    console.log('🔗 Loading PeerPigeon modules...');
    const { PeerPigeonMesh } = await import('./src/index.js');
    
    console.log('🌱 Heroku hub starting as PeerPigeon mesh node...');
    console.log('📡 Architecture: peer ↔ heroku hub ↔ [mesh] ↔ fly hub ↔ peer');
    console.log(`🆔 This node ID: ${nodeId}`);
    
    // Create Heroku mesh node that connects to Fly.io signaling server
    mesh = new PeerPigeonMesh({
      peerId: nodeId,
      enableWebDHT: true,
      maxPeers: 50,
      minPeers: 1,
      autoDiscovery: true
    });
    
    await mesh.init();
    console.log('✅ Heroku mesh initialized');
    
    // Connect to Fly.io signaling server to join the mesh
    await mesh.connect('wss://pigeonhub.fly.dev');
    console.log('✅ Connected to Fly.io signaling server');
    
    dht = mesh; // Use mesh for DHT operations
    connectedToMesh = true;    // Create PeerPigeon instance for Heroku
    // Use Fly.io as the signaling server
    mesh = new PeerPigeon({
      signalingServerUrl: 'wss://pigeonhub.fly.dev',
      enableWebDHT: true,
      timeout: 15000,
      maxPeers: 50,
      nodeId: nodeId
    });
    
    // Initialize the mesh
    await mesh.init();
    console.log('✅ PeerPigeon mesh initialized');
    
    // Connect to Fly.io server as mesh peer
    // Heroku mesh connects to Fly.io signaling server
    console.log('🔗 Heroku connecting to Fly.io as PeerPigeon signaling server...');
    console.log('🎯 Fly.io will act as signaling server for both nodes');
    console.log('💡 Both nodes will join the same PeerPigeon mesh');
    
    // Join the mesh - this will use Fly.io as signaling server
    await mesh.joinMesh();
    console.log('🎯 Mesh connection established: Heroku ↔ Fly.io');
    console.log('� Relying on PeerPigeon mesh discovery for inter-node connections...');
    
    // WebDHT is now available inside the mesh
    if (mesh.webDHT) {
      console.log('✅ Internal WebDHT ready');
    console.log('🎯 Fly.io will act as signaling server for both nodes');
    console.log('💡 Both nodes will join the same PeerPigeon mesh');
    
    // No manual connectToPeer - let PeerPigeon discovery handle mesh connections
    console.log('🎯 Mesh connection established: Heroku ↔ Fly.io');
    console.log('� Relying on PeerPigeon mesh discovery for inter-node connections...');
    
    // WebDHT is now available inside the mesh
    if (mesh.webDHT) {
      console.log('✅ Internal WebDHT ready');
      dht = new PeerPigeonDhtAdapter({ mesh });
      dht = mesh.webDHT;
      signalDir = new SignalDirectory(dht);
    } else {
      console.log('⚠️  WebDHT not available in mesh');
    }
    
    connectedToMesh = true;
    
    console.log('✅ Mesh connected and ready');
    console.log(`🌐 Connected to PeerPigeon mesh`);
    console.log(`🔗 Mesh peer count: ${mesh.getConnectedPeerCount()} peers`);
    console.log(`🆔 This node mesh ID: ${mesh.nodeId || 'unknown'}`);
    
    // Set up health monitoring to detect disconnections and retry
    startMeshHealthMonitor();
    
    // Set up mesh message handler for cross-node signal routing
    mesh.addEventListener('messageReceived', (messageEvent) => {
      try {
        console.log(`🔍 Raw mesh message event:`, JSON.stringify(messageEvent, null, 2));
        
        // PeerPigeon uses 'content' field for message data
        let rawMessage = messageEvent.content || messageEvent.data || messageEvent.message || messageEvent;
        
        if (typeof rawMessage === 'string') {
          console.log(`📝 Raw message string:`, rawMessage);
        } else {
          console.log(`📦 Raw message object:`, JSON.stringify(rawMessage, null, 2));
          rawMessage = JSON.stringify(rawMessage);
        }
        
        // Try to parse as JSON, but handle errors gracefully
        let messageData;
        try {
          messageData = JSON.parse(rawMessage);
        } catch (parseError) {
          console.log(`⚠️  Failed to parse mesh message as JSON:`, parseError.message);
          console.log(`🔍 Raw message was:`, rawMessage);
          return; // Skip this message if we can't parse it
        }
        
        // Handle different types of mesh messages
        if (messageData.messageType === 'pigeonhub-signal-route') {
          console.log(`📨 Received mesh signal routing request for ${messageData.signalType} to peer ${messageData.targetPeerId?.substring(0, 8)}...`);
          
          // Try to find the target peer locally
          const success = sendToSpecificPeer(messageData.targetPeerId, {
            type: messageData.signalType,
            data: messageData.signalData,
            fromPeerId: messageData.fromPeerId,
            targetPeerId: messageData.targetPeerId,
            timestamp: Date.now()
          });
          
          if (success) {
            console.log(`✅ Successfully routed mesh ${messageData.signalType} to local peer ${messageData.targetPeerId?.substring(0, 8)}...`);
          } else {
            console.log(`⚠️  Target peer ${messageData.targetPeerId?.substring(0, 8)}... not found on this node`);
          }
        } else if (messageData.type === 'peer-announcement') {
          console.log(`� Received peer announcement via PeerPigeon mesh from ${messageData.sourceNode}: peer ${messageData.peerId?.substring(0, 8)}...`);
          
          // Store remote peer for future discovery even if no local peers currently
          const remotePeerData = {
            peerId: messageData.peerId,
            name: messageData.name || 'unnamed',
            sourceNode: messageData.sourceNode,
            timestamp: messageData.timestamp || Date.now(),
            remote: true // Mark as remote peer
          };
          
          // Store in peerData for future discovery
          peerData.set(messageData.peerId, remotePeerData);
          console.log(`💾 Stored remote peer ${messageData.peerId?.substring(0, 8)}... from ${messageData.sourceNode}`);
          
          // Notify all local peers about the remote peer
          let notifiedCount = 0;
          for (const [localPeerId, peerConnection] of connections.entries()) {
            if (localPeerId !== messageData.peerId && peerConnection && peerConnection.readyState === WebSocket.OPEN) {
              try {
                peerConnection.send(JSON.stringify({
                  type: 'peer-discovered',
                  data: remotePeerData,
                  fromPeerId: 'system',
                  targetPeerId: localPeerId,
                  timestamp: Date.now()
                }));
                notifiedCount++;
                console.log(`✅ Notified local peer ${localPeerId.substring(0, 8)}... about remote peer from ${messageData.sourceNode}`);
              } catch (error) {
                console.error(`❌ Failed to notify peer ${localPeerId}:`, error.message);
              }
            }
          }
          console.log(`📊 Notified ${notifiedCount} local peers, stored remote peer for future discovery`);
        } else {
          console.log(`🔄 Ignoring unknown mesh message type:`, messageData?.type || messageData?.messageType || 'unknown');
        }
      } catch (error) {
        console.log(`❌ Error processing mesh message: ${error.message}`);
        console.log(`🔍 Message event structure:`, Object.keys(messageEvent || {}));
      }
    });
    
    console.log('🎯 Mesh signal routing handler configured');
        } else {
          console.log(`📦 Raw message object:`, JSON.stringify(rawMessage, null, 2));
          rawMessage = JSON.stringify(rawMessage);
        }
        
        // Try to parse as JSON, but handle errors gracefully
        let messageData;
        try {
          messageData = JSON.parse(rawMessage);
        } catch (parseError) {
          console.log(`⚠️  Failed to parse mesh message as JSON:`, parseError.message);
          console.log(`🔍 Raw message was:`, rawMessage);
          return; // Skip this message if we can't parse it
        }
        
        // Handle different types of mesh messages
        if (messageData.messageType === 'pigeonhub-signal-route') {
          console.log(`📨 Received mesh signal routing request for ${messageData.signalType} to peer ${messageData.targetPeerId?.substring(0, 8)}...`);
          
          // Try to find the target peer locally
          const success = sendToSpecificPeer(messageData.targetPeerId, {
            type: messageData.signalType,
            data: messageData.signalData,
            fromPeerId: messageData.fromPeerId,
            targetPeerId: messageData.targetPeerId,
            timestamp: Date.now()
          });
          
          if (success) {
            console.log(`✅ Successfully routed mesh ${messageData.signalType} to local peer ${messageData.targetPeerId?.substring(0, 8)}...`);
          } else {
            console.log(`⚠️  Target peer ${messageData.targetPeerId?.substring(0, 8)}... not found on this node`);
          }
        } else if (messageData.type === 'peer-announcement') {
          console.log(`� Received peer announcement via PeerPigeon mesh from ${messageData.sourceNode}: peer ${messageData.peerId?.substring(0, 8)}...`);
          
          // Store remote peer for future discovery even if no local peers currently
          const remotePeerData = {
            peerId: messageData.peerId,
            name: messageData.name || 'unnamed',
            sourceNode: messageData.sourceNode,
            timestamp: messageData.timestamp || Date.now(),
            remote: true // Mark as remote peer
          };
          
          // Store in peerData for future discovery
          peerData.set(messageData.peerId, remotePeerData);
          console.log(`💾 Stored remote peer ${messageData.peerId?.substring(0, 8)}... from ${messageData.sourceNode}`);
          
          // Notify all local peers about the remote peer
          let notifiedCount = 0;
          for (const [localPeerId, peerConnection] of connections.entries()) {
            if (localPeerId !== messageData.peerId && peerConnection && peerConnection.readyState === WebSocket.OPEN) {
              try {
                peerConnection.send(JSON.stringify({
                  type: 'peer-discovered',
                  data: remotePeerData,
                  fromPeerId: 'system',
                  targetPeerId: localPeerId,
                  timestamp: Date.now()
                }));
                notifiedCount++;
                console.log(`✅ Notified local peer ${localPeerId.substring(0, 8)}... about remote peer from ${messageData.sourceNode}`);
              } catch (error) {
                console.error(`❌ Failed to notify peer ${localPeerId}:`, error.message);
              }
            }
          }
          console.log(`📊 Notified ${notifiedCount} local peers, stored remote peer for future discovery`);
        } else {
          console.log(`🔄 Ignoring unknown mesh message type:`, messageData?.type || messageData?.messageType || 'unknown');
        }
      } catch (error) {
        console.log(`❌ Error processing mesh message: ${error.message}`);
        console.log(`🔍 Message event structure:`, Object.keys(messageEvent || {}));
      }
    });
    
    console.log('🎯 Mesh signal routing handler configured');
    
  } catch (error) {
    console.log(`❌ Bootstrap failed: ${error.message}`);
    console.log(`🔄 Will retry connecting to Fly.io...`);
    
    // Schedule retry of bootstrap process
    scheduleBootstrapRetry();
  } finally {
    isBootstrapping = false;
  }
}

// Retry bootstrap connection with exponential backoff
let bootstrapRetryCount = 0;
const maxBootstrapRetries = 10;
let bootstrapRetryTimeout = null;

function scheduleBootstrapRetry() {
  if (bootstrapRetryCount >= maxBootstrapRetries) {
    console.log(`❌ Maximum bootstrap retries (${maxBootstrapRetries}) reached. Giving up.`);
    return;
  }
  
  // Don't schedule if already connected
  if (connectedToMesh && mesh && mesh.getConnectedPeerCount() > 0) {
    console.log(`✅ Already connected to mesh, canceling retry`);
    bootstrapRetryCount = 0; // Reset counter on success
    return;
  }
  
  bootstrapRetryCount++;
  const retryDelay = Math.min(1000 * Math.pow(2, bootstrapRetryCount - 1), 30000); // Exponential backoff, max 30s
  
  console.log(`🔄 Scheduling bootstrap retry #${bootstrapRetryCount} in ${retryDelay}ms...`);
  
  bootstrapRetryTimeout = setTimeout(() => {
    console.log(`🔄 Attempting bootstrap retry #${bootstrapRetryCount}/${maxBootstrapRetries}...`);
    bootstrap();
  }, retryDelay);
}

// Monitor mesh connection health and retry if needed
function startMeshHealthMonitor() {
  setInterval(() => {
    if (!connectedToMesh || !mesh) {
      console.log(`⚠️ Mesh not connected, scheduling retry...`);
      scheduleBootstrapRetry();
      return;
    }
    
    const peerCount = mesh.getConnectedPeerCount();
    if (peerCount === 0) {
      console.log(`⚠️ Mesh connected but 0 peers, scheduling retry...`);
      // Reset connection status to trigger retry
      connectedToMesh = false;
      scheduleBootstrapRetry();
    } else {
      // Reset retry counter on successful connection
      if (bootstrapRetryCount > 0) {
        console.log(`✅ Mesh connection healthy, resetting retry counter`);
        bootstrapRetryCount = 0;
        if (bootstrapRetryTimeout) {
          clearTimeout(bootstrapRetryTimeout);
          bootstrapRetryTimeout = null;
        }
      }
    }
  }, 15000); // Check every 15 seconds
}

// Fallback peer discovery via HTTP when DHT bootstrap fails
async function discoverPeersViaHttp() {
  console.log('🔍 Attempting HTTP-based peer discovery...');
  
  const localPorts = [3000, 3001, 3002, 3003].filter(p => p !== port);
  
  for (const targetPort of localPorts) {
    try {
      const response = await fetch(`http://localhost:${targetPort}/health`, {
        timeout: 2000
      });
      
      if (response.ok) {
        const health = await response.json();
        console.log(`✅ Found peer via HTTP: ${health.nodeId} on port ${targetPort}`);
        
        // Add to known peers for cross-node communication
        knownNodes.add(`http://localhost:${targetPort}`);
      }
    } catch (error) {
      // Ignore connection errors - peer may not be running
    }
  }
  
  console.log(`📋 Known peers: ${knownNodes.size} nodes discovered`);
}

// Start server
server.listen(port, '0.0.0.0', () => {
  console.log(`✅ FIXED node ${nodeId} listening on http://0.0.0.0:${port}`);
  console.log(`   Also available on: http://localhost:${port} and http://127.0.0.1:${port}`);
  console.log(`   Health: curl http://localhost:${port}/health`);
  console.log(`   Publish: curl -X POST http://localhost:${port}/api/publish -H "Content-Type: application/json" -d '{"topic":"test","data":{"msg":"hello"}}'`);
  console.log(`   Find: curl http://localhost:${port}/api/find/test`);
  console.log(`   Signaling: curl http://localhost:${port}/signaling`);
  console.log(`   Generate PeerID: curl http://localhost:${port}/generate-peer-id`);
  
  // Start DHT in background
  setTimeout(bootstrap, 500);
  
  // Start mesh health monitoring
  setTimeout(startMeshHealthMonitor, 2000);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log(`\n🛑 Shutting down ${nodeId}...`);
  server.close(() => {
    console.log('✅ Server stopped');
    process.exit(0);
  });
});

console.log(`Starting clean ${nodeId}...`);
