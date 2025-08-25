/**
 * PigeonHub - Decentralized Mesh Network Infrastructure
 * 
 * Main entry point that exports all PigeonHub components:
 * - WebSocket signaling server
 * - Kademlia DHT for bootstrap node discovery
 * - Bootstrap registry for network coordination
 * - Utility functions
 */

// Core Kademlia DHT components
export { KademliaDHT } from './kademlia/KademliaDHT.js';
export { BootstrapRegistry } from './kademlia/BootstrapRegistry.js';

// Utility functions
export { default as MeshIdUtils } from './utils/MeshIdUtils.js';

// Main PigeonHub orchestrator class
import { PigeonHub } from './src/PigeonHub.js';
export { PigeonHub };
export default PigeonHub;