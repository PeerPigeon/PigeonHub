import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { URL } from 'url';
import net from 'net';

/**
 * Local WebSocket Server for PeerPigeon Development
 *
 * This server provides WebSocket signaling functionality
 * for local development and testing of the PeerPigeon mesh network.
 */

let PORT = parseInt(process.env.PORT) || 3000;
const HOST = process.env.HOST || 'localhost';

// Function to check if a port is available
function isPortAvailable(port, host = 'localhost') {
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

// Function to find an available port starting from the given port
async function findAvailablePort(startPort, host = 'localhost', maxTries = 10) {
  for (let port = startPort; port < startPort + maxTries; port++) {
    if (await isPortAvailable(port, host)) {
      return port;
    }
  }
  throw new Error(`No available port found in range ${startPort}-${startPort + maxTries - 1}`);
}

// In-memory storage for connections and peer data
const connections = new Map(); // peerId -> WebSocket connection
const peerData = new Map(); // peerId -> { peerId, timestamp, data }

// Utility functions
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
      if (connection.readyState === WebSocket.OPEN && isConnectionAlive(connection)) {
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
  if (!connection || connection.readyState !== WebSocket.OPEN) {
    return false;
  }

  // Simple alive check - if connection is open, it's considered alive
  // Detailed health monitoring is handled by the peer mesh itself
  return true;
}

function sendToConnection(peerId, data) {
  const connection = connections.get(peerId);
  if (connection && connection.readyState === WebSocket.OPEN) {
    try {
      connection.send(JSON.stringify(data));
      return true;
    } catch (error) {
      console.error(`Error sending to ${peerId}:`, error);
      // Clean up failed connection
      cleanupPeer(peerId);
      return false;
    }
  } else if (connection && (connection.readyState === WebSocket.CLOSED || connection.readyState === WebSocket.CLOSING)) {
    // Clean up closed connection
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

function broadcastToClosestPeers(fromPeerId, message, maxPeers = 5) {
  const activePeers = getActivePeers(fromPeerId);
  const closestPeers = findClosestPeers(fromPeerId, activePeers, maxPeers);

  console.log(`Broadcasting from ${fromPeerId} to ${closestPeers.length} closest peers`);

  closestPeers.forEach(peerId => {
    sendToConnection(peerId, message);
  });
}

function sendToSpecificPeer(targetPeerId, message) {
  return sendToConnection(targetPeerId, message);
}

// Create HTTP server
const server = createServer();

// Create WebSocket server
const wss = new WebSocketServer({ server });

console.log('🚀 Starting PeerPigeon WebSocket server...');

// Periodic cleanup of stale connections
setInterval(() => {
  const totalConnections = connections.size;
  getActivePeers(); // This will clean up stale connections
  const cleanedUp = totalConnections - connections.size;

  if (cleanedUp > 0) {
    console.log(`🧹 Periodic cleanup: removed ${cleanedUp} stale connections, ${connections.size} active`);
  }
}, 30000); // Clean up every 30 seconds

// Note: Signaling servers should NOT initiate pings to peers
// Health monitoring is the responsibility of the peer mesh network itself

wss.on('connection', (ws, req) => {
    let peerId = null;

    // Extract peerId from query parameters
    const url = new URL(req.url, `http://${req.headers.host}`);
    const queryPeerId = url.searchParams.get('peerId');

    if (!queryPeerId || !validatePeerId(queryPeerId)) {
      console.log(`❌ Invalid peerId: ${queryPeerId}`);
      ws.close(1008, 'Invalid peerId');
      return;
    }

    peerId = queryPeerId;

    // Check if peerId is already connected
    if (connections.has(peerId)) {
      const existingConnection = connections.get(peerId);
      if (existingConnection.readyState === WebSocket.OPEN) {
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

    console.log(`✅ Peer ${peerId.substring(0, 8)}... connected (${connections.size} total)`);

    // Send connection confirmation
    ws.send(JSON.stringify({
      type: 'connected',
      peerId,
      timestamp: Date.now()
    }));

    // Handle incoming messages
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        const { type, data: messageData, targetPeerId } = message;

        console.log(`📨 Received ${type} from ${peerId.substring(0, 8)}...`);

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
            break;
          }

          case 'goodbye': {
            // Handle peer disconnect
            peerData.delete(peerId);
            broadcastToClosestPeers(peerId, responseMessage);
            break;
          }

          case 'offer':
          case 'answer':
          case 'ice-candidate': {
            // CRITICAL DEBUG: Log answer routing details
            if (type === 'answer') {
              console.log('🔍 WEBSOCKET DEBUG: Received answer message:', {
                type,
                fromPeerId: peerId?.substring(0, 8) + '...',
                targetPeerId: targetPeerId?.substring(0, 8) + '...',
                hasTargetPeerId: !!targetPeerId,
                hasData: !!messageData
              });
            }

            // Handle WebRTC signaling - this is the server's primary purpose
            if (targetPeerId) {
              const success = sendToSpecificPeer(targetPeerId, responseMessage);
              if (!success) {
                console.log(`⚠️  Failed to send ${type} to ${targetPeerId.substring(0, 8)}... (peer not found)`);
              } else if (type === 'answer') {
                console.log(`✅ WEBSOCKET DEBUG: Answer successfully routed to ${targetPeerId.substring(0, 8)}...`);
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
    });

    // Handle connection close
    ws.on('close', (code, reason) => {
      console.log(`🔌 Peer ${peerId?.substring(0, 8)}... disconnected (${code}: ${reason})`);

      if (peerId) {
        cleanupPeer(peerId);
      }

      console.log(`📊 Active connections: ${connections.size}`);
    });

    // Handle connection errors
    ws.on('error', (error) => {
      console.error(`❌ WebSocket error for ${peerId?.substring(0, 8)}...:`, error);

      // Clean up errored connection
      if (peerId && (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING)) {
        cleanupPeer(peerId);
      }
    });
  });

// Start the server with automatic port detection
async function startServer() {
  try {
    const availablePort = await findAvailablePort(PORT, HOST);
    PORT = availablePort; // Update the PORT variable
    
    server.listen(PORT, HOST, () => {
      console.log(`🌐 PeerPigeon WebSocket server running on ws://${HOST}:${PORT}`);
      if (availablePort !== (parseInt(process.env.PORT) || 3000)) {
        console.log(`⚠️  Original port was busy, using port ${PORT} instead`);
      }
      console.log('📝 Usage: Connect with ?peerId=<40-char-hex-id>');
      console.log('📊 Ready to handle peer connections...');
    });
  } catch (error) {
    console.error(`❌ Failed to start server: ${error.message}`);
    process.exit(1);
  }
}

// Start the server
startServer();

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down WebSocket server...');

  // Close all connections
  for (const [, connection] of connections) {
    connection.close(1001, 'Server shutting down');
  }

  // Close server
  server.close(() => {
    console.log('✅ WebSocket server closed');
    process.exit(0);
  });
});

// Export for programmatic use
export { server, wss, connections, peerData };
