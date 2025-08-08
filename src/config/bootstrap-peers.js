/**
 * @fileoverview Bootstrap peer configuration for PigeonHub
 * 
 * Bootstrap peers are essential for new nodes to join the distributed mesh.
 * They provide initial connectivity and peer discovery capabilities.
 */

/**
 * Production bootstrap peers - These are maintained by the PigeonHub project
 * and should be highly available across different cloud providers
 */
export const PRODUCTION_BOOTSTRAP_PEERS = [
  // Vercel deployment (Global Edge Network)
  { 
    t: 'wss', 
    u: 'wss://pigeonhub.vercel.app',
    region: 'global',
    priority: 1,
    description: 'Vercel Global Edge - Primary bootstrap'
  },
  
  // Heroku deployment (US East)  
  { 
    t: 'wss', 
    u: 'wss://pigeonhub.herokuapp.com',
    region: 'us-east',
    priority: 2,
    description: 'Heroku US East - Secondary bootstrap'
  },
  
  // Railway deployment (US West)
  { 
    t: 'wss', 
    u: 'wss://pigeonhub.railway.app',
    region: 'us-west', 
    priority: 2,
    description: 'Railway US West - Regional bootstrap'
  },
  
  // Fly.io deployment (Global anycast)
  { 
    t: 'wss', 
    u: 'wss://pigeonhub.fly.dev',
    region: 'global',
    priority: 2,
    description: 'Fly.io Global - Regional bootstrap'
  }
];

/**
 * Community bootstrap peers - Maintained by the community
 * These provide additional resilience and geographic distribution
 */
export const COMMUNITY_BOOTSTRAP_PEERS = [
  // Add community-maintained bootstrap peers here
  // Format: { t: 'wss', u: 'wss://your-domain.com', region: 'region', priority: 3 }
];

/**
 * Local development bootstrap peers
 * Used for local testing and development
 */
export const LOCAL_BOOTSTRAP_PEERS = [
  { t: 'ws', u: 'ws://localhost:3000', region: 'local', priority: 10 },
  { t: 'ws', u: 'ws://localhost:3001', region: 'local', priority: 10 },
  { t: 'ws', u: 'ws://localhost:3002', region: 'local', priority: 10 },
  { t: 'ws', u: 'ws://localhost:3003', region: 'local', priority: 10 },
  { t: 'ws', u: 'ws://127.0.0.1:3000', region: 'local', priority: 10 },
  { t: 'ws', u: 'ws://127.0.0.1:3001', region: 'local', priority: 10 }
];

/**
 * Get bootstrap peers based on environment and configuration
 * @param {Object} options - Configuration options
 * @param {string} [options.environment='production'] - Environment (production, development, local)
 * @param {string} [options.region] - Preferred region for regional peers
 * @param {Array} [options.customPeers=[]] - Custom bootstrap peers to include
 * @param {boolean} [options.includeLocal=false] - Whether to include local peers
 * @returns {Array} Array of bootstrap peer configurations
 */
export function getBootstrapPeers({
  environment = 'production',
  region = null,
  customPeers = [],
  includeLocal = false
} = {}) {
  let peers = [];
  
  // Always include custom peers first (highest priority)
  peers.push(...customPeers);
  
  // Add environment-specific peers
  if (environment === 'production') {
    peers.push(...PRODUCTION_BOOTSTRAP_PEERS);
    peers.push(...COMMUNITY_BOOTSTRAP_PEERS);
  } else if (environment === 'development' || environment === 'local') {
    includeLocal = true;
  }
  
  // Add local peers if requested or in development
  if (includeLocal) {
    peers.push(...LOCAL_BOOTSTRAP_PEERS);
  }
  
  // Filter by region if specified
  if (region) {
    const regionPeers = peers.filter(peer => 
      peer.region === region || peer.region === 'global'
    );
    
    // If we have regional peers, prefer them, but keep some global ones
    if (regionPeers.length > 0) {
      const globalPeers = peers.filter(peer => peer.region === 'global');
      peers = [...regionPeers, ...globalPeers.slice(0, 2)];
    }
  }
  
  // Sort by priority (lower number = higher priority)
  peers.sort((a, b) => (a.priority || 99) - (b.priority || 99));
  
  // Deduplicate by URL
  const uniquePeers = [];
  const seenUrls = new Set();
  
  for (const peer of peers) {
    if (!seenUrls.has(peer.u)) {
      seenUrls.add(peer.u);
      uniquePeers.push(peer);
    }
  }
  
  return uniquePeers;
}

/**
 * Parse bootstrap peers from environment variable
 * @param {string} envString - Comma-separated list of peer URLs
 * @returns {Array} Array of bootstrap peer configurations
 */
export function parseBootstrapPeersFromEnv(envString) {
  if (!envString) return [];
  
  return envString.split(',').map(peer => {
    const trimmed = peer.trim();
    const [protocol, rest] = trimmed.split('://');
    
    return {
      t: protocol,
      u: trimmed,
      region: 'custom',
      priority: 1,
      description: 'Environment configured peer'
    };
  });
}

/**
 * Validate bootstrap peer configuration
 * @param {Object} peer - Peer configuration to validate
 * @returns {boolean} True if valid, false otherwise
 */
export function validateBootstrapPeer(peer) {
  if (!peer || typeof peer !== 'object') return false;
  if (!peer.t || !peer.u) return false;
  if (!['ws', 'wss'].includes(peer.t)) return false;
  
  try {
    new URL(peer.u);
    return true;
  } catch {
    return false;
  }
}

/**
 * Filter bootstrap peers to only include valid ones
 * @param {Array} peers - Array of peer configurations
 * @returns {Array} Array of valid peer configurations
 */
export function filterValidBootstrapPeers(peers) {
  return peers.filter(validateBootstrapPeer);
}

/**
 * Default configuration for different environments
 */
export const DEFAULT_BOOTSTRAP_CONFIG = {
  production: {
    environment: 'production',
    includeLocal: false,
    maxPeers: 10
  },
  
  development: {
    environment: 'development', 
    includeLocal: true,
    maxPeers: 5
  },
  
  local: {
    environment: 'local',
    includeLocal: true,
    maxPeers: 4
  }
};
