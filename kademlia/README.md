# Kademlia DHT Module

A standalone Kademlia Distributed Hash Table implementation for PigeonHub bootstrap node registration. This is completely independent from PeerPigeon's WebDHT and uses standard Kademlia protocol over UDP.

## Overview

This module provides:

- **Pure Kademlia DHT**: Standard Kademlia implementation with 160-bit keys
- **Bootstrap Node Registration**: Register and discover bootstrap nodes 
- **UDP Protocol**: Uses UDP for fast, low-overhead communication
- **Network Separation**: Completely isolated from WebSocket infrastructure
- **High-Level API**: Simple Bootstrap Registry wrapper for easy use

## Components

### 1. KademliaDHT (`kademlia/KademliaDHT.js`)

Core Kademlia DHT implementation with full protocol support:

```javascript
import { KademliaDHT } from './kademlia/KademliaDHT.js';

const dht = new KademliaDHT({
  port: 9001,                    // UDP port (0 = random)
  address: '0.0.0.0',           // Bind address
  nodeId: 'custom-id',          // Optional: custom 160-bit node ID
  bootstrapNodes: []            // Bootstrap nodes to connect to
});

// Start the DHT
await dht.start();

// Store data
await dht.store('my-key', { data: 'value' });

// Retrieve data
const value = await dht.get('my-key');

// Register as bootstrap node
await dht.registerBootstrapNode({ 
  capabilities: ['bootstrap', 'relay'] 
});

// Discover bootstrap nodes
const bootstraps = await dht.discoverBootstrapNodes();

// Stop the DHT
await dht.stop();
```

### 2. BootstrapRegistry (`kademlia/BootstrapRegistry.js`)

High-level wrapper for bootstrap node management:

```javascript
import { BootstrapRegistry } from './kademlia/BootstrapRegistry.js';

const registry = new BootstrapRegistry({
  networkId: 'my-network',      // Network identifier
  port: 9001,                   // UDP port
  address: 'localhost',         // Bind address
  metadata: {                   // Custom metadata
    location: 'us-east',
    version: '1.0.0'
  }
});

// Start registry
await registry.start();

// Register as bootstrap node
await registry.registerAsBootstrap(['signaling', 'relay']);

// Discover other bootstrap nodes
const nodes = await registry.discoverBootstrapNodes();

// Find nodes with specific capabilities
const signalingNodes = await registry.findBootstrapsWithCapability('signaling');

// Store/retrieve network data
await registry.storeData('config', { maxPeers: 100 });
const config = await registry.getData('config');

// Stop registry
await registry.stop();
```

## Key Features

### Standard Kademlia Protocol

- **160-bit node IDs**: SHA-1 based addressing
- **XOR distance metric**: Efficient routing and lookup
- **K-buckets**: Organized contact storage (K=20)
- **Iterative lookups**: FIND_NODE, STORE, GET operations
- **Bucket refresh**: Automatic maintenance of routing table

### Bootstrap Node Registration

```javascript
// Register with custom metadata
await registry.registerAsBootstrap(['signaling', 'relay', 'storage']);

// Discover by network ID
const bootstraps = await registry.discoverBootstrapNodes();

// Find by capability
const relayNodes = await registry.findBootstrapsWithCapability('relay');
```

### Network Health Monitoring

```javascript
// Start periodic health checks
registry.startHealthMonitoring(300000); // Every 5 minutes

// Manual health check
const healthReport = await registry.performHealthCheck();

// Ping all contacts
const results = await registry.pingAllContacts();
```

### Event System

```javascript
registry.on('started', () => console.log('Registry started'));
registry.on('bootstrapRegistered', (data) => console.log('Registered:', data));
registry.on('peerDiscovered', (peer) => console.log('Found peer:', peer));
registry.on('healthCheck', (report) => console.log('Health:', report));
```

## Network Architecture

### UDP Protocol

The DHT uses UDP for communication with JSON-RPC style messages:

```javascript
// Request format
{
  type: 'request',
  requestId: 'req_123_timestamp',
  method: 'find_node',
  params: { targetId: '...' },
  senderId: 'node_id'
}

// Response format
{
  type: 'response',
  requestId: 'req_123_timestamp',
  result: { contacts: [...] },
  senderId: 'node_id'
}
```

### Supported Methods

- **PING**: Check node liveness
- **FIND_NODE**: Locate closest nodes to target ID
- **STORE**: Store key-value pair
- **GET**: Retrieve value by key

### Bootstrap Process

1. **Start DHT**: Bind to UDP port and initialize routing table
2. **Connect to Bootstrap Nodes**: Add known nodes to routing table
3. **Network Discovery**: Perform node lookup for own ID to populate routes
4. **Register Services**: Store bootstrap registration in DHT
5. **Maintenance**: Periodic bucket refresh and key republishing

## Configuration

### DHT Parameters

```javascript
const K = 20;                    // Bucket size
const ALPHA = 3;                 // Concurrency parameter
const ID_LENGTH = 160;           // Node ID length (bits)
const BUCKET_REFRESH_INTERVAL = 3600000;   // 1 hour
const KEY_REPUBLISH_INTERVAL = 86400000;   // 24 hours  
const KEY_EXPIRE_TIME = 86400000;          // 24 hours
const NODE_TIMEOUT = 900000;               // 15 minutes
```

### Network Options

```javascript
const options = {
  networkId: 'production',       // Logical network separation
  port: 9001,                   // UDP port (0 = random)
  address: '0.0.0.0',          // Bind address  
  nodeId: null,                 // Auto-generated if not provided
  bootstrapNodes: [],           // Initial peers to connect to
  metadata: {}                  // Custom node metadata
};
```

## Usage Examples

### Single Bootstrap Node

```javascript
const registry = new BootstrapRegistry({
  networkId: 'pigeonhub-production',
  port: 9001,
  address: '0.0.0.0'
});

await registry.start();
await registry.registerAsBootstrap(['primary-bootstrap']);

console.log('Bootstrap node running on port 9001');
```

### Client Discovery

```javascript
const client = new BootstrapRegistry({
  networkId: 'pigeonhub-production',
  bootstrapNodes: [
    { nodeId: 'known_id', address: 'bootstrap.example.com', port: 9001 }
  ]
});

await client.start();
const bootstraps = await client.discoverBootstrapNodes();
console.log(`Found ${bootstraps.length} bootstrap nodes`);
```

### Multi-Node Network

```javascript
// Node 1 - Primary bootstrap
const primary = new BootstrapRegistry({
  networkId: 'test-net',
  port: 9001
});
await primary.start();
await primary.registerAsBootstrap(['primary']);

// Node 2 - Secondary bootstrap
const secondary = new BootstrapRegistry({
  networkId: 'test-net', 
  port: 9002,
  bootstrapNodes: [{ 
    nodeId: primary.dht.nodeId, 
    address: 'localhost', 
    port: 9001 
  }]
});
await secondary.start();
await secondary.registerAsBootstrap(['secondary']);

// Node 3 - Regular peer
const peer = new BootstrapRegistry({
  networkId: 'test-net',
  port: 9003,
  bootstrapNodes: [
    { nodeId: primary.dht.nodeId, address: 'localhost', port: 9001 },
    { nodeId: secondary.dht.nodeId, address: 'localhost', port: 9002 }
  ]
});
await peer.start();
```

## Running the Demo

```bash
# Run interactive demo
npm run kademlia:demo

# The demo shows:
# 1. Basic DHT operations (store/get)
# 2. Bootstrap registration and discovery
# 3. Multi-node network formation
# 4. Health monitoring and statistics
```

## Integration with PigeonHub

The Kademlia DHT is designed to complement PigeonHub's existing infrastructure:

- **Bootstrap Discovery**: WebSocket servers can find each other via DHT
- **Network Coordination**: Share configuration and topology information  
- **Load Balancing**: Distribute clients across available bootstrap nodes
- **Health Monitoring**: Track network health and node availability

### Example Integration

```javascript
// WebSocket server discovers bootstrap nodes
const registry = new BootstrapRegistry({ networkId: 'pigeonhub' });
await registry.start();

const bootstraps = await registry.discoverBootstrapNodes();
const signalingNodes = bootstraps.filter(n => 
  n.metadata.capabilities.includes('websocket-signaling')
);

console.log(`Found ${signalingNodes.length} WebSocket signaling servers`);
```

## Security Considerations

- **Node ID Verification**: Ensure node IDs are properly validated
- **Rate Limiting**: Implement request rate limiting to prevent abuse
- **Network Isolation**: Use networkId to separate different deployments
- **Firewall Configuration**: Only expose necessary UDP ports

## Performance Notes

- **Memory Usage**: ~1KB per contact, ~1KB per stored key
- **Network Traffic**: Minimal overhead, UDP packets typically <1KB
- **Lookup Performance**: O(log N) hops to find any key
- **Scalability**: Tested with thousands of nodes in academic research

## Troubleshooting

### Common Issues

1. **Port Binding Errors**: Check if UDP port is available
2. **Bootstrap Connection Failures**: Verify bootstrap node addresses
3. **Network Isolation**: Ensure correct networkId configuration
4. **Firewall Blocking**: Check UDP port accessibility

### Debug Information

```javascript
// Enable detailed logging
const dht = new KademliaDHT({ /* options */ });
dht.on('contactAdded', contact => console.log('Added:', contact));
dht.on('contactRemoved', id => console.log('Removed:', id));

// Get detailed network state
const networkInfo = registry.getDetailedNetworkInfo();
console.log('Contacts:', networkInfo.contacts);
console.log('Stored Keys:', networkInfo.storedKeys);
```

## License

This module is part of PigeonHub and follows the same MIT license.
