/**
 * Bootstrap Node Configuration
 * 
 * Defines the configuration for PigeonHub bootstrap nodes
 */

import { PeerPigeonMesh } from 'peerpigeon';

export const BOOTSTRAP_CONFIG = {
  // Primary signaling server - this is what other bootstrap nodes connect to
  PRIMARY_SIGNALING_SERVER: {
    host: 'localhost',
    port: 3001,
    url: 'ws://localhost:3001'
  },

  // Bootstrap node configurations
  BOOTSTRAP_NODES: [
    {
      id: 'bootstrap-primary',
      role: 'primary',
      port: 3001,
      host: 'localhost',
      isSignalingServer: true,
      connectsTo: 'ws://localhost:3001' // Primary connects to its own signaling server!
    },
    {
      id: 'bootstrap-secondary',
      role: 'secondary', 
      port: 3002,
      host: 'localhost',
      isSignalingServer: true,
      connectsTo: 'ws://localhost:3001' // Connects to primary
    },
    {
      id: 'bootstrap-cloud-primary',
      role: 'primary',
      port: 8080,
      host: '0.0.0.0',
      isSignalingServer: true,
      connectsTo: 'wss://pigeonhub.fly.dev' // Cloud deployment connects to itself
    },
    {
      id: 'bootstrap-cloud-secondary',
      role: 'secondary',
      port: process.env.PORT || 8080,
      host: '0.0.0.0',
      isSignalingServer: true,
      connectsTo: 'wss://pigeonhub.fly.dev' // Secondary connects to primary (Fly.io)
    }
  ],

  // PeerPigeon mesh configuration for bootstrap nodes (matching CLI defaults)
  MESH_CONFIG: {
    maxPeers: 5, // Same as CLI default
    minPeers: 0, // Same as CLI default
    autoDiscovery: true, // Enable auto discovery like CLI
    enableWebDHT: true, // Enable WebDHT like CLI
    enableCrypto: false, // DISABLE crypto - PeerPigeon handles peer IDs
    enableDistributedStorage: true
  },

  // Production bootstrap servers that peers should discover
  PRODUCTION_BOOTSTRAP_SERVERS: [
    'wss://pigeonhub.fly.dev',
    'wss://pigeonhub-server-3c044110c06f.herokuapp.com'
  ]
};

// Helper function to get bootstrap node configuration by ID
export function getBootstrapNodeConfig(nodeId) {
  return BOOTSTRAP_CONFIG.BOOTSTRAP_NODES.find(node => node.id === nodeId);
}

export default BOOTSTRAP_CONFIG;
