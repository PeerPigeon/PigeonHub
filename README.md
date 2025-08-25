# PigeonHub

PigeonHub is a decentralized mesh network infrastructure that combines WebSocket signaling and Kademlia DHT bootstrap discovery into a unified library. It provides both standalone network infrastructure and components for building censorship-resistant peer-to-peer applications.

## 🚀 Quick Start

### Installation

```bash
# Install as a dependency
npm install pigeonhub

# Or clone and run locally
git clone https://github.com/draeder/pigeonhub.git
cd pigeonhub
npm install
```

### Integrated Usage (Recommended)

```javascript
import PigeonHub from 'pigeonhub';

// Start a complete bootstrap node with WebSocket + Kademlia
const hub = new PigeonHub({
  role: 'bootstrap',
  capabilities: ['websocket-signaling', 'bootstrap'],
  websocketPort: 3000,
  kademliaPort: 9000,
  networkId: 'my-network'
});

await hub.start();
// Now ready for browser connections at ws://localhost:3000/ws
```

### Individual Components

```javascript
// Use just the Kademlia DHT
import { KademliaDHT } from 'pigeonhub';
const dht = new KademliaDHT({ port: 9000 });
await dht.start();

// Use just the Bootstrap Registry  
import { BootstrapRegistry } from 'pigeonhub';
const registry = new BootstrapRegistry({ networkId: 'my-network' });
await registry.start();
```

### Running Examples

```bash
# Complete integration demo (WebSocket + Kademlia)
npm start

# Original Kademlia-only demo
npm run kademlia:demo

# Integration example
npm run example
```

## 🌐 What's New: Unified Architecture

PigeonHub now integrates two networking layers:

### 1. **WebSocket Signaling Layer** (for browsers)
- Helps web applications discover and connect to peers
- Handles WebRTC signaling for browser-to-browser connections
- Provides `/health` endpoint for monitoring

### 2. **Kademlia DHT Layer** (for infrastructure)  
- Enables servers to automatically discover each other
- Provides distributed storage for network configuration
- Creates resilient, self-organizing bootstrap networks

### 3. **Unified PigeonHub Class**
- Starts both layers together automatically  
- Handles network formation and coordination
- Provides simple API for complex networking

## 🌐 Production Bootstrap Nodes

PigeonHub maintains public bootstrap nodes for immediate network access:

### Primary Bootstrap Node (Fly.io)
- **WebSocket URL**: `wss://pigeonhub.fly.dev`
- **HTTP Health Check**: `https://pigeonhub.fly.dev/health`
- **Role**: Primary network entry point with integrated WebSocket-to-mesh gateway
- **Location**: Global edge deployment

### Secondary Bootstrap Node (Heroku)
- **WebSocket URL**: `wss://pigeonhub-server-3c044110c06f.herokuapp.com`
- **HTTP Health Check**: `https://pigeonhub-server-3c044110c06f.herokuapp.com/health`
- **Role**: Network redundancy and load balancing
- **Location**: US region

These bootstrap nodes are interconnected through PeerPigeon's mesh network and provide:
- **Cross-node signaling relay**: Messages can be relayed between nodes when direct connections aren't available
- **WebSocket gateway functionality**: Bridges WebSocket clients to the mesh network
- **Automatic failover**: Redundant infrastructure ensures network availability
- **Mesh integration**: Each bootstrap node participates in the mesh while serving WebSocket clients

## 📦 Library Structure

```
pigeonhub/
├── package.json                         # NPM package configuration with ES modules
├── bootstrap-node.js                    # Main CLI entry point and runner
├── config/
│   └── bootstrap-config.js              # Bootstrap node and mesh configuration
├── modules/
│   ├── BootstrapNode.js                 # PeerPigeon mesh node with WebRTC initialization
│   ├── PeerPigeonServerManager.js       # Coordinates WebSocket server with mesh network
│   └── WebSocketServerController.js     # WebSocket signaling server with cross-node relay
├── PEERPIGEON_API_DOCUMENTATION.md      # Complete PeerPigeon API reference
├── Dockerfile                           # Production Docker configuration
├── fly.toml.example                     # Fly.io deployment template
└── README.md                            # This documentation
```

## ✨ Features

- 🌐 **Hybrid Mesh Network**: Combines WebSocket signaling with WebRTC mesh networking
- 🔧 **Bootstrap Infrastructure**: Always-on nodes that facilitate network discovery and entry
- 📡 **Cross-Node Signaling Relay**: Messages automatically relay between bootstrap nodes when needed
- 🌉 **WebSocket-to-Mesh Gateway**: Bridges WebSocket clients with native mesh peers
- 🔄 **Automatic WebRTC Initialization**: Handles Node.js WebRTC setup with @koush/wrtc
- 🔒 **Encryption Ready**: Built-in support for PeerPigeon's encryption system
- 🛡️ **Censorship Resistant**: Decentralized architecture with multiple connection paths
- ⚡ **High Performance**: Optimized for Node.js 18+ with ES modules
- 🐳 **Cloud Ready**: Production configurations for Fly.io, Heroku, and Docker
- 📚 **Library API**: Full programmatic access to all functionality
- 🔍 **Comprehensive Debugging**: Integrated with PeerPigeon's debug logging system
- � **Anti-Loop Protection**: Smart relay logic prevents message loops in the network

## 🏗️ Architecture

### Dual-Network Design

PigeonHub operates as a **hybrid network** that bridges two connection types:

1. **WebSocket Signaling Layer**: Traditional client-server connections for initial setup and fallback
2. **WebRTC Mesh Layer**: Direct peer-to-peer connections for high-performance communication

### Bootstrap Node Types

1. **Primary Bootstrap Node**
   - Acts as the network entry point and mesh gateway
   - Runs integrated WebSocket signaling server
   - Participates in the mesh network while serving WebSocket clients
   - Handles cross-node signaling relay for network resilience
   - Default ports: 8080 (cloud), 3001 (local)

2. **Secondary Bootstrap Node**
   - Provides network redundancy and horizontal scaling
   - Connects to primary bootstrap node's mesh network
   - Offers alternative entry point for geographic distribution
   - Relays signaling messages between disconnected network segments
   - Default port: 3002 (local)

### Network Topology

```
WebSocket Clients                    WebSocket Clients
       ↕                                    ↕
[Primary Bootstrap]    ←mesh→    [Secondary Bootstrap]
   (Port 3001)                        (Port 3002)
       ↕                                    ↕
   [Mesh Peer A] ←→ [Mesh Peer B] ←→ [Mesh Peer C]
       ↕                                    ↕
   [More Peers]                      [More Peers]
```

### Key Architectural Components

- **BootstrapNode**: Manages PeerPigeon mesh integration and WebRTC initialization
- **PeerPigeonServerManager**: Coordinates WebSocket server lifecycle with mesh participation
- **WebSocketServerController**: Handles signaling, cross-node relay, and gateway functions
- **Cross-Node Relay System**: Enables message routing between disconnected network segments

## 🔧 Configuration

### Bootstrap Configuration

Bootstrap nodes are configured via `config/bootstrap-config.js`. This file defines both local development and cloud deployment configurations:

```javascript
export const BOOTSTRAP_CONFIG = {
  // Primary signaling server configuration
  PRIMARY_SIGNALING_SERVER: {
    host: 'localhost',
    port: 3001,
    url: 'ws://localhost:3001'
  },

  // Bootstrap node definitions
  BOOTSTRAP_NODES: [
    {
      id: 'bootstrap-primary',
      role: 'primary',
      port: 3001,
      host: 'localhost',
      isSignalingServer: true,
      connectsTo: 'ws://localhost:3001' // Connects to own signaling server
    },
    {
      id: 'bootstrap-secondary',
      role: 'secondary', 
      port: 3002,
      host: 'localhost',
      isSignalingServer: true,
      connectsTo: 'ws://localhost:3001' // Connects to primary for mesh integration
    },
    {
      id: 'bootstrap-cloud-primary',
      role: 'primary',
      port: 8080,
      host: '0.0.0.0',
      isSignalingServer: true,
      connectsTo: 'wss://pigeonhub.fly.dev' // Cloud self-connection
    }
  ],

  // PeerPigeon mesh configuration
  MESH_CONFIG: {
    maxPeers: 5,
    minPeers: 0,
    autoDiscovery: true,
    enableWebDHT: true,
    enableCrypto: true,
    enableDistributedStorage: true
  }
};
```

### Environment Variables

```bash
PORT=8080                    # Server port (auto-detected by cloud platforms)
NODE_ENV=production         # Environment mode  
HOST=0.0.0.0               # Bind address for cloud deployment
```

## 🔌 API Integration

### Using PigeonHub as a Library

```javascript
import { BootstrapNode, BOOTSTRAP_CONFIG } from 'pigeonhub';
import { PeerPigeonServerManager } from 'pigeonhub/modules/PeerPigeonServerManager.js';

// Create and configure a bootstrap node
const nodeConfig = BOOTSTRAP_CONFIG.BOOTSTRAP_NODES[0];
const bootstrap = new BootstrapNode(nodeConfig);

// Initialize WebRTC and PeerPigeon mesh
await bootstrap.init();

// Start the integrated server manager
const serverManager = new PeerPigeonServerManager({
  port: nodeConfig.port,
  host: nodeConfig.host
});

// Connect the bootstrap node to the server manager
bootstrap.setServerManager(serverManager);
serverManager.setBootstrapNode(bootstrap);

// Start the server and connect to mesh
await serverManager.start();
await bootstrap.connect();
```

### Accessing PeerPigeon Features

PigeonHub provides full access to PeerPigeon's comprehensive API through the bootstrap node's mesh instance:

```javascript
const mesh = bootstrap.getMesh();

// Direct peer messaging
mesh.sendDirectMessage(peerId, { type: 'chat', message: 'Hello!' });

// Broadcast to all peers
mesh.sendMessage({ type: 'announcement', data: 'Network update' });

// Distributed storage
mesh.store('user-preferences', { theme: 'dark', language: 'en' });
const data = await mesh.retrieve('user-preferences');

// WebRTC media streaming
const mediaConnection = mesh.connectMedia(targetPeerId);
mediaConnection.send(localStream);
```

### Event Handling

```javascript
// Network topology events
bootstrap.mesh.addEventListener('peerConnected', (data) => {
  console.log('New peer:', data.peerId);
  console.log('Total peers:', bootstrap.mesh.getConnectedPeerCount());
});

bootstrap.mesh.addEventListener('peerDiscovered', (data) => {
  console.log('Discovered peer:', data.peerId);
});

// Message events
bootstrap.mesh.addEventListener('messageReceived', (data) => {
  console.log('Message from:', data.from);
  console.log('Content:', data.content);
});

// Cross-node events (specific to PigeonHub)
bootstrap.mesh.addEventListener('signalingRelayReceived', (data) => {
  console.log('Received relay from another bootstrap node');
});
```

## 📊 Monitoring & Health Checks

### Built-in Health Endpoints

Each bootstrap node provides HTTP health check endpoints:

```bash
# Primary node health check
curl http://localhost:3001/health

# Response format:
{
  "status": "healthy",
  "uptime": 3600000,
  "nodeId": "bootstrap-primary",
  "meshStatus": {
    "connectedPeers": 3,
    "discoveredPeers": 5,
    "messagesHandled": 127
  },
  "webSocketClients": 12,
  "timestamp": 1692345678901
}
```

### Network Statistics

```javascript
// Get comprehensive statistics
const stats = bootstrap.getStats();
console.log('Network Statistics:', {
  uptime: stats.uptime,
  peersConnected: stats.peersConnected,
  messagesHandled: stats.messagesHandled,
  connectedPeers: stats.connectedPeers,
  discoveredPeers: stats.discoveredPeers,
  reconnections: stats.reconnections
});

// Server manager statistics
const serverStats = serverManager.getStats();
console.log('Server Statistics:', {
  totalConnections: serverStats.totalConnections,
  activeWebSocketClients: serverStats.activeConnections,
  messagesProcessed: serverStats.messagesProcessed,
  signalingRelays: serverStats.signalingRelays
});
```

### Debug Logging

PigeonHub integrates with PeerPigeon's debug logging system:

```javascript
import { DebugLogger } from 'peerpigeon';

// Enable specific debug categories
DebugLogger.enable('PeerPigeonMesh');
DebugLogger.enable('ConnectionManager'); 
DebugLogger.enable('SignalingClient');
DebugLogger.enable('BootstrapNode-primary');

// Custom debug logger for your application
const debug = DebugLogger.create('MyApp');
debug.log('Application started');
debug.error('Error occurred:', error);
```

## 🚀 Deployment

### Cloud Platform Support

PigeonHub is production-ready for major cloud platforms with zero-configuration deployment:

```bash
# Fly.io deployment
cp fly.toml.example fly.toml  # Customize app name and region
fly deploy

# Heroku deployment  
git push heroku main

# Railway deployment
railway up

# Render deployment
# Connect repository and deploy automatically
```

### Docker Deployment

Production-optimized Docker configuration included:

```dockerfile
# Dockerfile highlights:
FROM node:18                    # Node.js 18 with WebRTC support
WORKDIR /app
RUN npm ci --only=production   # Production dependencies only
EXPOSE 8080                    # Standard cloud port
CMD ["npm", "start"]           # Auto-starts primary bootstrap node
```

```bash
# Build and run locally
docker build -t pigeonhub .
docker run -p 8080:8080 pigeonhub

# Run with custom configuration
docker run -p 3001:8080 -e PORT=8080 pigeonhub

# Docker Compose (recommended for multi-node setup)
version: '3.8'
services:
  primary:
    build: .
    ports: ["3001:8080"]
    environment:
      - PORT=8080
  secondary:
    build: .
    ports: ["3002:8080"]  
    environment:
      - PORT=8080
    depends_on: [primary]
```

### Environment Configuration

```bash
# Essential environment variables
PORT=8080                      # Server port (auto-detected by platforms)
NODE_ENV=production           # Enables production optimizations
HOST=0.0.0.0                 # Binds to all interfaces for cloud deployment

# Optional configuration
MAX_PEERS=100                 # Maximum WebSocket connections
MESH_MAX_PEERS=5             # Maximum mesh network peers
DEBUG=PeerPigeonMesh         # Enable debug logging
```

## 🛠️ Development

### Local Development Setup

```bash
# Clone and setup
git clone https://github.com/draeder/pigeonhub.git
cd pigeonhub
npm install

# Install required WebRTC dependencies (automatically installed)
# - ws@^8.14.2 (WebSocket library)
# - @koush/wrtc (Node.js WebRTC implementation)
# - peerpigeon (mesh networking library)

# Development commands
npm run start:bootstrap1      # Start primary node (port 3001)
npm run start:bootstrap2      # Start secondary node (port 3002) 
npm run start:dev            # Start both nodes with concurrently
npm start                    # Start cloud-ready primary node (port 8080)
```

### Development Architecture

```
Development Environment (Local):
┌─────────────────────┐    ┌─────────────────────┐
│   Primary Node      │◄──►│  Secondary Node     │
│   localhost:3001    │    │   localhost:3002    │
│                     │    │                     │
│ ┌─────────────────┐ │    │ ┌─────────────────┐ │
│ │ WebSocket Server│ │    │ │ WebSocket Server│ │  
│ │ Mesh Gateway    │ │    │ │ Mesh Gateway    │ │
│ └─────────────────┘ │    │ └─────────────────┘ │
│ ┌─────────────────┐ │    │ ┌─────────────────┐ │
│ │ Bootstrap Node  │◄┼────┼►│ Bootstrap Node  │ │
│ │ (Mesh Peer)     │ │    │ │ (Mesh Peer)     │ │
│ └─────────────────┘ │    │ └─────────────────┘ │
└─────────────────────┘    └─────────────────────┘
           ▲                           ▲
           │                           │
    WebSocket Clients          WebSocket Clients
```

### Library Integration

```javascript
// Import individual components
import { BootstrapNode } from 'pigeonhub';
import { PeerPigeonServerManager } from 'pigeonhub/modules/PeerPigeonServerManager.js';
import { WebSocketServerController } from 'pigeonhub/modules/WebSocketServerController.js';
import { BOOTSTRAP_CONFIG } from 'pigeonhub/config/bootstrap-config.js';

// Create custom bootstrap configuration
const customConfig = {
  id: 'my-bootstrap-node',
  role: 'primary',
  port: 4000,
  host: 'localhost',
  isSignalingServer: true,
  connectsTo: 'ws://localhost:4000'
};

// Advanced usage with custom mesh configuration
const bootstrap = new BootstrapNode(customConfig);
const meshOptions = {
  maxPeers: 10,
  enableCrypto: true,
  enableWebDHT: true,
  ignoreEnvironmentErrors: true
};

// Override default mesh configuration
await bootstrap.init(meshOptions);
```

### Key Development Features

- **ES Modules**: Full ES6 module support with `"type": "module"`
- **Hot Reloading**: Restart nodes independently during development
- **Debug Logging**: Comprehensive logging system for troubleshooting
- **Cross-Node Testing**: Test signaling relay between multiple nodes
- **WebRTC Auto-Setup**: Automatic WebRTC polyfills for Node.js environment

## 🔒 Security & Network Resilience

### Built-in Security Features

- ✅ **Consistent Peer IDs**: Bootstrap nodes use deterministic IDs for network stability
- ✅ **Connection Validation**: WebSocket connections validated with proper peer ID formats
- ✅ **Automatic Cleanup**: Stale connections and peers automatically removed
- ✅ **Anti-Loop Protection**: Smart relay logic prevents infinite message loops
- ✅ **Timeout Protection**: All network operations include timeout safeguards
- ✅ **Cross-Node Relay Limits**: Maximum hop count prevents relay storms
- ✅ **WebRTC Encryption**: Native WebRTC encryption for all peer-to-peer connections
- ✅ **Internal Message Filtering**: Infrastructure messages filtered from user interfaces

### Network Resilience

- 🔄 **Automatic Reconnection**: PeerPigeon handles connection failures gracefully
- 🌐 **Multi-Path Connectivity**: Messages can route through multiple bootstrap nodes
- 📡 **Cross-Node Signaling Relay**: Bridges disconnected network segments
- 🔍 **Peer Discovery Backup**: Multiple discovery mechanisms ensure network participation
- ⚡ **Failover Support**: Secondary bootstrap nodes provide redundancy

### Optional Security Enhancements

```javascript
// Enable end-to-end encryption
const meshOptions = {
  enableCrypto: true,        // Enable PeerPigeon's crypto system
  enableWebDHT: true,        // Secure distributed storage
  maxPeers: 5               // Limit peer connections
};

// Access encryption features
const mesh = bootstrap.getMesh();
await mesh.generateKeyPair();  // Generate encryption keys
const encrypted = await mesh.encrypt(data, recipientPublicKey);
const decrypted = await mesh.decrypt(encrypted, senderPublicKey);
```

### Security Considerations

⚠️ **Development vs Production**:
- Development mode uses localhost connections (ws://)
- Production requires secure WebSocket connections (wss://)
- Consider implementing authentication for production deployments

🔜 **Planned Security Features**:
- Secure node registration and authentication
- Enhanced peer verification mechanisms
- Rate limiting and DDoS protection

## 🤝 Contributing

We welcome contributions to improve PigeonHub! Here's how to get started:

### Development Guidelines

1. **Fork and Clone**
   ```bash
   git clone https://github.com/yourusername/pigeonhub.git
   cd pigeonhub
   npm install
   ```

2. **Create Feature Branch**
   ```bash
   git checkout -b feature/cross-node-encryption
   git checkout -b fix/websocket-memory-leak
   ```

3. **Follow Architecture Patterns**
   - Maintain the modular architecture (BootstrapNode, ServerManager, WebSocketController)
   - Keep existing WebSocket server functionality intact
   - Follow PeerPigeon API patterns and conventions
   - Use ES modules and maintain Node.js 18+ compatibility

4. **Test Your Changes**
   ```bash
   # Test local multi-node setup
   npm run start:dev
   
   # Test cloud deployment
   npm start
   
   # Test library integration
   node -e "import('./modules/BootstrapNode.js').then(console.log)"
   ```

5. **Documentation**
   - Update README.md for new features
   - Add JSDoc comments to new functions
   - Include examples for new API methods

### Areas for Contribution

- 🔐 **Enhanced Security**: Authentication, rate limiting, DDoS protection
- 🌍 **Geographic Distribution**: Location-aware bootstrap node selection
- 📊 **Advanced Monitoring**: Metrics collection, performance dashboards
- 🔧 **Configuration Management**: Dynamic configuration updates
- 🧪 **Testing Framework**: Automated testing for multi-node scenarios
- 📱 **Browser Integration**: Improved browser-based client support

### Pull Request Process

1. Ensure your changes don't break existing functionality
2. Add tests for new features when possible
3. Update documentation and examples
4. Submit PR with clear description of changes
5. Respond to review feedback promptly

### Community

- 💬 **Discussions**: Use GitHub Discussions for questions and ideas
- 🐛 **Issues**: Report bugs with clear reproduction steps
- 📖 **Wiki**: Contribute to documentation and tutorials
- 🌟 **Star**: Show your support by starring the repository

## 📄 License

MIT License - see LICENSE file for details.

## 🔗 Related Projects

- **[PeerPigeon](https://github.com/draeder/peerpigeon)** - The underlying mesh networking library powering PigeonHub
- **[PeerPigeon CLI](https://github.com/draeder/peerpigeon)** - Command-line interface for PeerPigeon mesh networks
- **Complete PeerPigeon API Documentation** - Available in `PEERPIGEON_API_DOCUMENTATION.md`

## 📚 Additional Resources

- **[PeerPigeon API Reference](./PEERPIGEON_API_DOCUMENTATION.md)** - Complete API documentation for all PeerPigeon features
- **[Bootstrap Configuration Guide](./config/bootstrap-config.js)** - Detailed configuration options
- **[Deployment Examples](./fly.toml.example)** - Ready-to-use deployment configurations

---

**Built with ❤️ using PeerPigeon**  
*PigeonHub - Bridging WebSocket and WebRTC for decentralized networks*
