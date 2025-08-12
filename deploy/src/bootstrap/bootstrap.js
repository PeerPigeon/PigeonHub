/**
 * @fileoverview Bootstrap system for PeerPigeon mesh with DHT discovery
 */

import { PeerPigeonDhtAdapter } from '../substrates/peerpigeon-adapter.js';
import { 
  verifySeedBundle, 
  loadSeedsFromDns, 
  loadSeedsFromWellKnown, 
  loadCachedSeeds, 
  storeCachedSeeds 
} from './seed-bundle.js';

/**
 * Bootstrap a PeerPigeon mesh with DHT capabilities
 * @param {object} options - Bootstrap options
 * @param {string} options.appId - Application identifier
 * @param {Array<{t: string, u: string}>} [options.hardcodedSeeds] - Fallback seed addresses
 * @param {string} [options.pinnedPublisherKeyBase64] - Trusted publisher key for seed bundles
 * @param {object} [options.meshOpts] - Additional PeerPigeon mesh options
 * @returns {Promise<{mesh: any, dht: PeerPigeonDhtAdapter}>} Initialized mesh and DHT adapter
 */
export async function bootstrapPeerPigeon({ 
  appId, 
  hardcodedSeeds = [], 
  pinnedPublisherKeyBase64,
  meshOpts = {} 
}) {
  console.log(`Bootstrapping PeerPigeon for app: ${appId}`);
  
  // Collect seeds from various sources
  const allSeeds = await collectSeeds(appId, hardcodedSeeds, pinnedPublisherKeyBase64);
  
  if (allSeeds.length === 0) {
    throw new Error('No seeds available for bootstrap');
  }
  
  console.log(`Found ${allSeeds.length} seed(s) for bootstrap`);
  
  // Import PeerPigeon
  let PeerPigeonMesh;
  try {
    const peerpigeon = await import('peerpigeon');
    PeerPigeonMesh = peerpigeon.default || peerpigeon.PeerPigeonMesh || peerpigeon;
  } catch (error) {
    throw new Error(`Failed to import peerpigeon: ${error.message}`);
  }
  
  // Create mesh with WebDHT enabled
  const mesh = new PeerPigeonMesh({
    enableWebDHT: true,
    ...meshOpts
  });
  
  // Initialize mesh
  await mesh.init();
  
  // Try connecting to seeds until DHT is available
  let connected = false;
  const maxAttempts = Math.min(allSeeds.length, 10); // Try up to 10 seeds
  
  for (let i = 0; i < maxAttempts && !connected; i++) {
    const seed = allSeeds[i];
    console.log(`Trying to connect to seed: ${seed.u}`);
    
    try {
      if (seed.t === 'ws' || seed.t === 'wss') {
        await mesh.connectToPeer(seed.u);
      } else {
        console.warn(`Unsupported seed transport type: ${seed.t}`);
        continue;
      }
      
      // Wait a bit for connection to stabilize
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Check if DHT is ready
      if (mesh.webDHT) {
        console.log('DHT connection established');
        connected = true;
        break;
      }
    } catch (error) {
      console.warn(`Failed to connect to seed ${seed.u}:`, error.message);
    }
  }
  
  if (!connected || !mesh.webDHT) {
    throw new Error('Failed to establish DHT connection to any seed');
  }
  
  // Create DHT adapter
  const dht = new PeerPigeonDhtAdapter({ mesh });
  
  // Discover additional seeds via DHT and cache them
  try {
    const dhtSeeds = await discoverSeedsViaDht(dht, appId);
    if (dhtSeeds.length > 0) {
      console.log(`Discovered ${dhtSeeds.length} additional seeds via DHT`);
      
      // Merge with existing seeds and cache
      const mergedSeeds = mergeAndDedupeSeeds([...allSeeds, ...dhtSeeds]);
      storeCachedSeeds(appId, mergedSeeds.slice(0, 50)); // Cache up to 50 seeds
    }
  } catch (error) {
    console.warn('Failed to discover additional seeds via DHT:', error.message);
  }
  
  return { mesh, dht };
}

/**
 * Collect seeds from all available sources
 * @param {string} appId - Application identifier
 * @param {Array<{t: string, u: string}>} hardcodedSeeds - Fallback seeds
 * @param {string} [pinnedPublisherKeyBase64] - Trusted publisher key
 * @returns {Promise<Array<{t: string, u: string}>>} Collected and deduped seeds
 */
async function collectSeeds(appId, hardcodedSeeds, pinnedPublisherKeyBase64) {
  const allSeeds = [];
  
  // 1. Load cached seeds first (fastest)
  try {
    const cachedSeeds = loadCachedSeeds(appId);
    if (cachedSeeds.length > 0) {
      console.log(`Loaded ${cachedSeeds.length} cached seeds`);
      allSeeds.push(...cachedSeeds);
    }
  } catch (error) {
    console.warn('Failed to load cached seeds:', error.message);
  }
  
  // 2. Add hardcoded seeds as fallback
  if (hardcodedSeeds.length > 0) {
    console.log(`Adding ${hardcodedSeeds.length} hardcoded seeds`);
    allSeeds.push(...hardcodedSeeds);
  }
  
  // 3. Try DNS bundle discovery
  if (pinnedPublisherKeyBase64) {
    try {
      // Try common domains that might host seed bundles
      const domains = ['bootstrap.peerpigeon.org', 'seeds.example.com'];
      
      for (const domain of domains) {
        const bundleJson = await loadSeedsFromDns(appId, domain);
        if (bundleJson) {
          try {
            const verified = await verifySeedBundle(bundleJson, pinnedPublisherKeyBase64);
            console.log(`Loaded ${verified.seeds.length} seeds from DNS (${domain})`);
            allSeeds.push(...verified.seeds);
          } catch (error) {
            console.warn(`DNS bundle verification failed for ${domain}:`, error.message);
          }
        }
      }
    } catch (error) {
      console.warn('DNS seed discovery failed:', error.message);
    }
  }
  
  // 4. Try .well-known endpoint discovery
  if (pinnedPublisherKeyBase64) {
    try {
      const wellKnownUrls = [
        'https://bootstrap.peerpigeon.org',
        'https://api.example.com'
      ];
      
      const bundles = await loadSeedsFromWellKnown(wellKnownUrls);
      
      for (const bundleJson of bundles) {
        try {
          const verified = await verifySeedBundle(bundleJson, pinnedPublisherKeyBase64);
          console.log(`Loaded ${verified.seeds.length} seeds from .well-known`);
          allSeeds.push(...verified.seeds);
        } catch (error) {
          console.warn('Well-known bundle verification failed:', error.message);
        }
      }
    } catch (error) {
      console.warn('Well-known seed discovery failed:', error.message);
    }
  }
  
  // Deduplicate and shuffle seeds
  return mergeAndDedupeSeeds(allSeeds);
}

/**
 * Merge and deduplicate seed arrays
 * @param {Array<{t: string, u: string}>} seeds - Seeds to merge
 * @returns {Array<{t: string, u: string}>} Deduped and shuffled seeds
 */
function mergeAndDedupeSeeds(seeds) {
  const seen = new Set();
  const unique = [];
  
  for (const seed of seeds) {
    const key = `${seed.t}:${seed.u}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(seed);
    }
  }
  
  // Shuffle for random connection order
  for (let i = unique.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [unique[i], unique[j]] = [unique[j], unique[i]];
  }
  
  return unique;
}

/**
 * Discover additional seeds via DHT queries
 * @param {PeerPigeonDhtAdapter} dht - DHT adapter
 * @param {string} appId - Application identifier
 * @returns {Promise<Array<{t: string, u: string}>>} Discovered seeds
 */
async function discoverSeedsViaDht(dht, appId) {
  try {
    // Query for seed records in the DHT
    // Use a special topic for seed discovery: "seed:" + appId
    const { sha1 } = await import('../util/crypto.js');
    const topicString = `seed:${appId}`;
    const topicBytes = await sha1(new TextEncoder().encode(topicString));
    
    const values = await dht.get(topicBytes);
    const seeds = [];
    
    for (const valueBytes of values) {
      try {
        const { cborDecode } = await import('../util/crypto.js');
        const record = await cborDecode(valueBytes);
        
        // Validate it's a seed record
        if (record.kind === 'seed' && Array.isArray(record.urls)) {
          // Convert urls format to seeds format
          for (const url of record.urls) {
            if (url.t && url.u) {
              seeds.push({ t: url.t, u: url.u });
            }
          }
        }
      } catch (error) {
        console.warn('Failed to decode DHT seed record:', error.message);
      }
    }
    
    return seeds;
  } catch (error) {
    console.warn('DHT seed discovery failed:', error.message);
    return [];
  }
}
