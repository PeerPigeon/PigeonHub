# PigeonHub Node

A complete PigeonHub node implementation that combines local WebSocket signaling with remote PeerPigeon mesh connectivity.

## Features

- **Dual Connectivity**: Runs its own WebSocket signaling server while connecting to remote PeerPigeon mesh networks
- **Auto Port Discovery**: Automatically finds available ports for the local WebSocket server
- **Event-Driven Architecture**: Emits events for mesh connections, peer discovery, and message handling
- **Graceful Shutdown**: Handles SIGINT for clean disconnection from both local and remote networks
- **Status Monitoring**: Regular status updates showing local and remote peer connections
- **Message Broadcasting**: Can send messages to both local WebSocket clients and remote mesh peers

## Quick Start

### Basic Usage

```bash
# Start a PigeonHub node with default settings
node pigeonhub-node.js

# Start with custom signaling server and port
node pigeonhub-node.js wss://your-signaling-server.com/ws 3005
```

### Using npm scripts

```bash
# Start basic node
npm run start:node

# Run the example with custom configuration
npm run node:example
```

## How It Works

1. **Local WebSocket Server**: Starts on an available port (default: 3000+) to accept local peer connections
2. **Remote Mesh Connection**: Connects to the AWS PeerPigeon signaling server as a mesh peer
3. **Bidirectional Bridge**: Acts as a bridge between local peers and the remote mesh network
4. **Automatic Discovery**: Discovers and connects to other peers in the remote mesh
5. **Message Relay**: Can relay messages between local and remote networks

## Configuration Options

```javascript
const node = new PigeonHubNode({
  // Local WebSocket server
  websocketPort: 3000,           // Starting port to try
  websocketHost: 'localhost',    // Host to bind to
  
  // Remote mesh connection
  signalingServerUrl: 'wss://...',  // PeerPigeon signaling server
  maxPeers: 10,                  // Max remote peers to connect to
  enableCrypto: false,           // Enable encryption
  
  // Node identity
  peerId: 'custom-peer-id',      // Auto-generated if not provided
  
  // Behavior
  sendPeriodicMessages: true,    // Send test messages
  messageInterval: 30000,        // Message interval (ms)
  statusInterval: 10000          // Status update interval (ms)
});
```

## Events

The PigeonHub node emits the following events:

- `started` - Node has started successfully
- `stopped` - Node has stopped
- `meshConnected` - Connected to remote mesh
- `peerDiscovered` - New peer discovered in remote mesh
- `peerConnected` - Connected to a remote peer
- `peerDisconnected` - Remote peer disconnected
- `messageReceived` - Message received from remote peer

## API Methods

### `start()`
Start the PigeonHub node (both local server and remote mesh connection).

### `stop()`
Stop the PigeonHub node and clean up all connections.

### `sendToRemoteMesh(message)`
Send a message to all connected remote mesh peers.

### `broadcastToLocalConnections(message)`
Broadcast a message to all local WebSocket connections.

## Example Usage

```javascript
import { PigeonHubNode } from './pigeonhub-node.js';

const node = new PigeonHubNode({
  websocketPort: 3001,
  sendPeriodicMessages: false
});

// Listen for events
node.on('peerConnected', (data) => {
  console.log(`New peer: ${data.peerId}`);
});

node.on('messageReceived', async (data) => {
  console.log(`Message: ${data.content}`);
  // Echo back
  await node.sendToRemoteMesh(`Echo: ${data.content}`);
});

// Start the node
await node.start();
```

## Connection Flow

1. **Startup**: Node initializes and finds an available port for local WebSocket server
2. **Local Server**: WebSocket server starts listening for local peer connections
3. **Remote Connection**: Node connects to the PeerPigeon signaling server
4. **Peer Discovery**: Node discovers other peers in the mesh network
5. **P2P Connections**: Direct WebRTC connections are established with remote peers
6. **Message Flow**: Messages can flow between local clients and remote mesh peers

## Use Cases

- **Mesh Network Gateway**: Connect local applications to a global mesh network
- **Development Hub**: Local signaling server for testing while connected to production mesh
- **Bridge Node**: Connect different network segments or protocols
- **Relay Node**: Forward messages between different mesh networks

## Status Output

The node provides regular status updates showing:
- Node ID and local WebSocket URL
- Number of local WebSocket connections
- Remote mesh connection status
- Number of discovered and connected remote peers
- List of connected peer IDs

## Graceful Shutdown

The node handles SIGINT (Ctrl+C) gracefully:
1. Stops sending periodic messages
2. Disconnects from remote mesh
3. Closes all local WebSocket connections
4. Shuts down the local WebSocket server
5. Exits cleanly

This ensures no hanging connections or resources when stopping the node.
