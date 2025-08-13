# PigeonHub

PigeonHub is a decentralized mesh network built on top of PeerPigeon, featuring WebSocket signaling servers and bootstrap nodes for peer discovery and mesh network formation. It provides a standalone library for building censorship-resistant peer-to-peer networks.

## 🚀 Quick Start

### Installation

```bash
# Install as a dependency
npm install pigeonhub
```

### Usage

```bash
# Start a primary bootstrap node on port 8080 (cloud deployment)
npm start

# Start primary bootstrap node on port 3001 (local development)
npm run start:bootstrap1

# Start secondary bootstrap node on port 3002 (local development)
npm run start:bootstrap2

# Start both nodes for full local mesh
npm run start:dev
```

## 🌐 Production Bootstrap Nodes

PigeonHub maintains public bootstrap nodes for immediate network access:

### Primary Bootstrap Node (Fly.io)
- **WebSocket URL**: `wss://pigeonhub.fly.dev`
- **HTTP Health Check**: `https://pigeonhub.fly.dev/health`
- **Role**: Primary network entry point
- **Location**: Global edge deployment

### Secondary Bootstrap Node (Heroku)
- **WebSocket URL**: `wss://pigeonhub-server-3c044110c06f.herokuapp.com`
- **HTTP Health Check**: `https://pigeonhub-server-3c044110c06f.herokuapp.com/health`
- **Role**: Network redundancy and load balancing
- **Location**: US region

These bootstrap nodes are interconnected and provide automatic failover. Connect to either endpoint to join the PigeonHub mesh network.

## 📦 Library Structure

```
pigeonhub/
├── package.json                    # NPM package configuration
├── bootstrap-node.js               # Main entry point
├── config/
│   └── bootstrap-config.js         # Bootstrap node configuration
├── modules/
│   ├── BootstrapNode.js            # PeerPigeon bootstrap node implementation
│   ├── PeerPigeonServerManager.js  # Server manager integration
│   └── WebSocketServerController.js # WebSocket server controller
└── README.md                       # This file
```

## ✨ Features

- 🌐 **Decentralized Mesh Network**: Built on PeerPigeon for true peer-to-peer networking
- 🔧 **Bootstrap Nodes**: Always-on nodes that help peers discover the network
- 📡 **WebSocket Signaling**: Dedicated signaling server for WebRTC peer connections
- 🔒 **Encryption Ready**: Optional end-to-end encryption support
- 🛡️ **Censorship Resistant**: Distributed architecture with no single point of failure
- ⚡ **High Performance**: Optimized for Node.js 18+ environments
- 🐳 **Cloud Ready**: Configured for Heroku, Fly.io, Railway, and other platforms
- 📚 **Module Support**: Use as library in your Node.js applications

## 🏗️ Architecture

### Bootstrap Node Types

1. **Primary Bootstrap Node**
   - Acts as the initial network entry point
   - Runs WebSocket signaling server
   - Other nodes connect to it for initial peer discovery
   - Default ports: 8080 (cloud), 3001 (local)

2. **Secondary Bootstrap Node**
   - Provides network redundancy and load distribution
   - Connects to primary bootstrap node's mesh
   - Helps scale the network horizontally
   - Default port: 3002 (local)

### Network Topology

```
     [Primary Bootstrap]     [Secondary Bootstrap]
         (Port 8080)    ←→        (Port 3002)
              ↕                      ↕
        [Regular Peers]      [Regular Peers]
             ↕                      ↕
       [More Peers...]      [More Peers...]
```

## 🔧 Configuration

Bootstrap nodes are configured via `config/bootstrap-config.js`:

```javascript
export const BOOTSTRAP_CONFIG = {
  // Bootstrap node definitions
  BOOTSTRAP_NODES: [
    {
      id: 'bootstrap-primary',
      role: 'primary',
      port: 3001,
      host: 'localhost',
      isSignalingServer: true,
      connectsTo: 'ws://localhost:3001'
    },
    {
      id: 'bootstrap-secondary',
      role: 'secondary', 
      port: 3002,
      host: 'localhost',
      isSignalingServer: true,
      connectsTo: 'ws://localhost:3001'
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

## 🔌 API Integration

PigeonHub provides full access to PeerPigeon's comprehensive API:

- **Mesh Networking**: Automatic peer discovery and connection management
- **WebRTC**: Direct peer-to-peer data and media channels
- **WebDHT**: Distributed hash table for decentralized storage
- **Encryption**: End-to-end encryption for secure communication
- **Media Streaming**: Audio/video streaming between peers

## 📊 Monitoring & Events

Bootstrap nodes provide comprehensive monitoring:

```javascript
import { BootstrapNode } from 'pigeonhub';

const bootstrap = new BootstrapNode(nodeConfig);

// Listen for network events
bootstrap.mesh.addEventListener('peerConnected', (data) => {
  console.log('Peer connected:', data.peerId);
});

bootstrap.mesh.addEventListener('messageReceived', (data) => {
  console.log('Message from:', data.from);
});

// Get network statistics
const stats = bootstrap.getStats();
console.log('Connected peers:', stats.connectedPeers);
console.log('Messages handled:', stats.messagesHandled);
console.log('Network uptime:', stats.uptime);
```

## 🚀 Deployment

### Cloud Platforms

PigeonHub is ready for deployment on major cloud platforms:

```bash
# Fly.io
cp fly.toml.example fly.toml  # Customize app name and settings
fly deploy

# Heroku
git push heroku main

# Railway
railway up

# Render
# Connect your repo and deploy
```

The `npm start` script automatically uses port 8080 for cloud compatibility.

### Docker Deployment

PigeonHub includes a production-ready Dockerfile:

```bash
# Build the Docker image
docker build -t pigeonhub .

# Run locally
docker run -p 8080:8080 pigeonhub

# Run with custom port
docker run -p 3001:8080 -e PORT=8080 pigeonhub
```

The Docker image:
- Uses Node.js 18 Alpine for minimal size
- Installs only production dependencies
- Exposes port 8080 by default
- Supports environment variable configuration

### Environment Variables

```bash
PORT=8080          # Server port (auto-detected by most platforms)
NODE_ENV=production # Environment mode
HOST=0.0.0.0       # Bind to all interfaces
```

## 🛠️ Development

### Local Development Setup

```bash
# Clone the repository
git clone https://github.com/draeder/pigeonhub.git
cd pigeonhub

# Install dependencies
npm install

# Start development environment (both nodes)
npm run start:dev
```

### Module Usage

```javascript
// Use as a library in your project
import { BootstrapNode, BOOTSTRAP_CONFIG } from 'pigeonhub';
import { PeerPigeonServerManager } from 'pigeonhub/modules/PeerPigeonServerManager.js';

// Create and start a bootstrap node
const nodeConfig = BOOTSTRAP_CONFIG.BOOTSTRAP_NODES[0];
const bootstrap = new BootstrapNode(nodeConfig);

await bootstrap.init();
await bootstrap.connect();
```

### Key Components

- **`BootstrapNode`**: Core bootstrap node functionality and mesh integration
- **`PeerPigeonServerManager`**: Coordinates WebSocket server with mesh network
- **`WebSocketServerController`**: Manages WebSocket signaling server
- **`BOOTSTRAP_CONFIG`**: Configuration management and node definitions

## 🔒 Security

- ✅ **Hardcoded Peer IDs**: Bootstrap nodes use consistent IDs for network stability
- ✅ **Connection Validation**: WebSocket connections validated with proper peer ID format
- ✅ **Automatic Cleanup**: Stale connections automatically removed
- ✅ **Encryption Support**: Optional end-to-end encryption available
- 🔜 **Secure Node Registration**: Coming in next release

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/secure-registration`
3. Maintain the modular architecture
4. Keep existing WebSocket server functionality intact
5. Follow PeerPigeon API patterns
6. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details.

## 🔗 Related Projects

- [PeerPigeon](https://github.com/draeder/peerpigeon) - The underlying mesh networking library
