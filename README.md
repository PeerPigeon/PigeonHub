# PigeonHub

PigeonHub is a simple, production-ready PeerPigeon hub server that provides WebSocket signaling for peer-to-peer mesh networks. It serves as both a standalone bootstrap node and an npm package for building decentralized applications.

## Quick Start

### Installation

```bash
# Install as a dependency
npm install pigeonhub

# Or clone and run locally
git clone https://github.com/draeder/pigeonhub.git
cd pigeonhub
npm install
```

### Usage

```bash
# Start hub on default port (3000)
npm start

# Start hub on custom port
PORT=8080 npm start

# Start with development configuration
npm run start:dev

# Start with custom bootstrap hubs
BOOTSTRAP_HUBS=wss://hub1.example.com,wss://hub2.example.com PORT=3001 npm start
```

### Programmatic Usage

```javascript
import { PeerPigeonServer } from 'peerpigeon';

// Create a hub server
const hub = new PeerPigeonServer({
    port: 3000,
    host: '0.0.0.0',
    isHub: true,
    autoConnect: true,
    bootstrapHubs: ['wss://pigeonhub.fly.dev/']
});

// Start the hub
await hub.start();
```

## Production Bootstrap Nodes

PigeonHub maintains public bootstrap nodes for immediate network access:

### Primary Bootstrap Node
- **WebSocket URL**: `wss://pigeonhub.fly.dev/`
- **HTTP Health Check**: `https://pigeonhub.fly.dev/health`
- **Location**: Global edge deployment (Fly.io)

### Secondary Bootstrap Node  
- **WebSocket URL**: `wss://pigeonhub-c.fly.dev/`
- **HTTP Health Check**: `https://pigeonhub-c.fly.dev/health`
- **Location**: US West deployment (Fly.io LAX)

These bootstrap nodes are interconnected through PeerPigeon's mesh network and provide:
- **Hub-to-hub connectivity**: Bootstrap nodes automatically discover and connect to each other
- **Peer discovery**: Help new peers find and connect to the mesh network
- **Signaling relay**: Relay WebRTC signaling messages between peers
- **Network resilience**: Multiple entry points ensure network availability

## Features

- 🌐 **PeerPigeon Integration**: Built on the robust PeerPigeon mesh networking library
- 🔧 **Bootstrap Hub**: Acts as a network entry point for peer discovery
- 📡 **Hub Discovery**: Automatically discovers and connects to other hubs
- 🌉 **WebSocket Signaling**: Provides WebSocket server for peer connections
- 🔄 **Auto-Connect**: Automatically connects to configured bootstrap hubs
- 🔒 **Production Ready**: Optimized for cloud deployment and high availability
- 🛡️ **Censorship Resistant**: Decentralized architecture with multiple connection paths
- ⚡ **High Performance**: Optimized for Node.js 18+ with ES modules
- 🐳 **Cloud Ready**: Production configurations for Fly.io, Heroku, and Docker
- 📊 **Health Monitoring**: Built-in health check endpoints
- 🔍 **Event Logging**: Comprehensive event logging for monitoring and debugging

## Configuration

### Environment Variables

```bash
PORT=3000                    # Server port (default: 3000)
HOST=0.0.0.0                # Bind address (default: 0.0.0.0)  
BOOTSTRAP_HUBS=wss://hub1.com,wss://hub2.com  # Comma-separated list of bootstrap hubs
NODE_ENV=production         # Environment mode
```

### Default Configuration

- **Port**: 3000 (or from `PORT` environment variable)
- **Host**: 0.0.0.0 (binds to all interfaces)
- **Bootstrap Hubs**: `wss://pigeonhub.fly.dev/` (public bootstrap node)
- **Hub Mode**: Enabled (`isHub: true`)
- **Auto-Connect**: Enabled for automatic bootstrap connection

## Events & Monitoring

### Hub Events

PigeonHub provides comprehensive event logging for monitoring network activity:

```javascript
import { PeerPigeonServer } from 'peerpigeon';

const hub = new PeerPigeonServer({
    port: 3000,
    host: '0.0.0.0',
    isHub: true,
    autoConnect: true,
    bootstrapHubs: ['wss://pigeonhub.fly.dev/']
});

// Hub lifecycle events
hub.on('started', ({ host, port }) => {
    console.log(`✅ Hub running on ws://${host}:${port}`);
    console.log(`   Health: http://${host}:${port}/health`);
    console.log(`   Hubs:   http://${host}:${port}/hubs`);
});

// Peer connection events
hub.on('peerConnected', ({ peerId, totalConnections }) => {
    console.log(`✅ Peer: ${peerId.substring(0, 8)}... (${totalConnections} total)`);
});

hub.on('peerDisconnected', ({ peerId, totalConnections }) => {
    console.log(`❌ Peer: ${peerId.substring(0, 8)}... (${totalConnections} remaining)`);
});

// Hub discovery events
hub.on('hubRegistered', ({ peerId, totalHubs }) => {
    console.log(`🏢 Hub: ${peerId.substring(0, 8)}... (${totalHubs} total)`);
});

hub.on('hubDiscovered', ({ peerId }) => {
    console.log(`🔍 Discovered hub: ${peerId.substring(0, 8)}...`);
});

// Bootstrap connection events
hub.on('bootstrapConnected', ({ uri }) => {
    console.log(`🔗 Connected to bootstrap: ${uri}`);
});

// Error handling
hub.on('error', (error) => {
    console.error('❌ Error:', error.message);
});

// Start the hub
await hub.start();
```

### Health Check Endpoints

Each hub provides HTTP health check endpoints:

```bash
# Check hub health
curl http://localhost:3000/health

# List connected hubs  
curl http://localhost:3000/hubs
```

## Deployment

### Cloud Platform Support

PigeonHub is production-ready for major cloud platforms:

```bash
# Fly.io deployment
cp fly.toml.example fly.toml  # Customize app name and region
flyctl deploy

# Heroku deployment  
git push heroku main

# Docker deployment
docker build -t pigeonhub .
docker run -p 3000:3000 pigeonhub
```

### Docker Deployment

Production-optimized Docker configuration:

```dockerfile
# Dockerfile
FROM node:18
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 8080
CMD ["npm", "start"]
```

```bash
# Build and run locally
docker build -t pigeonhub .
docker run -p 3000:3000 pigeonhub

# Run with custom configuration
docker run -p 3000:3000 -e PORT=3000 -e BOOTSTRAP_HUBS=wss://custom-hub.com pigeonhub
```

### Environment Configuration

```bash
# Essential environment variables
PORT=3000                      # Server port
NODE_ENV=production           # Enables production optimizations
HOST=0.0.0.0                 # Binds to all interfaces
BOOTSTRAP_HUBS=wss://hub1.com,wss://hub2.com  # Custom bootstrap hubs

# Optional PeerPigeon configuration
DEBUG=PeerPigeonMesh         # Enable debug logging
```

## Development

### Local Development Setup

```bash
# Clone and setup
git clone https://github.com/draeder/pigeonhub.git
cd pigeonhub
npm install

# Development commands
npm start                    # Start hub on default port (3000)
npm run start:dev           # Start hub on port 3001 for development
PORT=8080 npm start         # Start hub on custom port
```

### Testing Your Hub

```bash
# Test health endpoint
curl http://localhost:3000/health

# Test with WebSocket client
npm install ws
node -e "
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3000');
ws.on('open', () => console.log('Connected to hub'));
ws.on('message', (data) => console.log('Received:', data.toString()));
"
```

## Architecture

PigeonHub serves as a **bootstrap node** in the PeerPigeon mesh network:

1. **Hub Server**: Runs a PeerPigeonServer configured as a hub (`isHub: true`)
2. **Bootstrap Connection**: Automatically connects to other bootstrap hubs for mesh formation
3. **Peer Discovery**: Helps new peers discover and join the mesh network
4. **Signaling Relay**: Provides WebSocket signaling for WebRTC peer connections

### Network Topology

```
    [Hub A]  ←→  [Hub B]  ←→  [Hub C]
       ↕           ↕           ↕
   [Peer 1]   [Peer 2]   [Peer 3]
       ↕           ↕           ↕
   [Peer 4]   [Peer 5]   [Peer 6]
```

### Key Components

- **PeerPigeonServer**: The core mesh networking server from the PeerPigeon library
- **Bootstrap Configuration**: Automatic connection to other hubs for network formation
- **Event Handling**: Comprehensive event logging for monitoring network activity
- **Graceful Shutdown**: Proper cleanup on process termination signals

## Package Structure

```
pigeonhub/
├── package.json          # NPM package configuration
├── index.js              # Main hub server implementation
├── Dockerfile            # Production Docker configuration
├── fly.toml.example      # Fly.io deployment template
├── heroku.yml            # Heroku deployment configuration
├── Procfile              # Process configuration for cloud deployment
└── README.md             # This documentation
```

## Contributing

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
   git checkout -b feature/enhanced-logging
   git checkout -b fix/connection-handling
   ```

3. **Follow Best Practices**
   - Maintain the simple, focused architecture
   - Keep the single-file approach for core functionality
   - Follow PeerPigeon API patterns and conventions
   - Use ES modules and maintain Node.js 18+ compatibility

4. **Test Your Changes**
   ```bash
   # Test locally
   npm start
   
   # Test with custom configuration
   PORT=3001 BOOTSTRAP_HUBS=wss://test-hub.com npm start
   
   # Test health endpoints
   curl http://localhost:3000/health
   ```

5. **Documentation**
   - Update README.md for new features
   - Add clear examples for new functionality
   - Include relevant environment variables

### Areas for Contribution

- 🔐 **Enhanced Security**: Authentication, rate limiting, DDoS protection
- 🌍 **Geographic Distribution**: Location-aware bootstrap node selection
- 📊 **Advanced Monitoring**: Metrics collection, performance dashboards
- 🔧 **Configuration Management**: Dynamic configuration updates
- 🧪 **Testing Framework**: Automated testing for hub scenarios
- 📱 **Client Libraries**: Browser and mobile client implementations

### Pull Request Process

1. Ensure your changes don't break existing functionality
2. Test with both local and production configurations
3. Update documentation and examples
4. Submit PR with clear description of changes
5. Respond to review feedback promptly

## License

MIT License - see LICENSE file for details.

## Related Projects

- **[PeerPigeon](https://github.com/PeerPigeon/PeerPigeon)** - The underlying mesh networking library powering PigeonHub
- **[PeerPigeon Documentation](https://github.com/PeerPigeon/PeerPigeon)** - Complete API documentation and examples

---

**Built with ❤️ using PeerPigeon**  
*PigeonHub - Simple, production-ready bootstrap nodes for decentralized mesh networks*
