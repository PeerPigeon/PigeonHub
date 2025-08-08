/**
 * @fileoverview Seed bundle verification and loading utilities
 */

import * as crypto from '../util/crypto.js';
import { canonicalEncode } from '../util/encoding.js';

/**
 * Verify a seed bundle's signature and content
 * @param {string} bundleJsonString - JSON string of the seed bundle
 * @param {string} pinnedPublisherKeyBase64 - Expected publisher public key (base64)
 * @returns {Promise<{seeds: Array<{t: string, u: string}>, ts: number, expires: number}>}
 */
export async function verifySeedBundle(bundleJsonString, pinnedPublisherKeyBase64) {
  let bundle;
  try {
    bundle = JSON.parse(bundleJsonString);
  } catch (error) {
    throw new Error(`Invalid JSON in seed bundle: ${error.message}`);
  }

  // Validate bundle structure
  if (bundle.v !== 1) {
    throw new Error(`Unsupported seed bundle version: ${bundle.v}`);
  }

  if (typeof bundle.app !== 'string' || !bundle.app) {
    throw new Error('Seed bundle missing valid app field');
  }

  if (typeof bundle.ts !== 'number' || bundle.ts <= 0) {
    throw new Error('Seed bundle missing valid timestamp');
  }

  if (typeof bundle.expires !== 'number' || bundle.expires <= 0) {
    throw new Error('Seed bundle missing valid expires field');
  }

  if (!Array.isArray(bundle.seeds)) {
    throw new Error('Seed bundle missing valid seeds array');
  }

  if (typeof bundle.pk !== 'string') {
    throw new Error('Seed bundle missing valid public key');
  }

  if (typeof bundle.sig !== 'string') {
    throw new Error('Seed bundle missing valid signature');
  }

  // Validate seeds format
  for (const seed of bundle.seeds) {
    if (typeof seed.t !== 'string' || typeof seed.u !== 'string') {
      throw new Error('Invalid seed format in bundle');
    }
  }

  // Check if publisher key matches expected key
  if (pinnedPublisherKeyBase64 && bundle.pk !== pinnedPublisherKeyBase64) {
    throw new Error('Seed bundle publisher key does not match pinned key');
  }

  // Check timestamp freshness (within 10 minutes)
  const now = Date.now();
  const timeDiff = Math.abs(now - bundle.ts);
  if (timeDiff > 10 * 60 * 1000) { // 10 minutes
    throw new Error(`Seed bundle timestamp too far from current time: ${timeDiff}ms`);
  }

  // Check if bundle has expired
  const expiryTime = bundle.ts + (bundle.expires * 1000);
  if (now > expiryTime) {
    throw new Error('Seed bundle has expired');
  }

  // Verify signature
  try {
    // Create a copy without signature for verification
    const bundleForSig = { ...bundle };
    delete bundleForSig.sig;
    
    const messageString = canonicalEncode(bundleForSig);
    const messageBytes = new TextEncoder().encode(messageString);
    
    // Decode public key and signature from base64
    const publicKeyBytes = Uint8Array.from(atob(bundle.pk), c => c.charCodeAt(0));
    const signatureBytes = Uint8Array.from(atob(bundle.sig), c => c.charCodeAt(0));
    
    const isValid = await crypto.verifyEd25519(messageBytes, signatureBytes, publicKeyBytes);
    if (!isValid) {
      throw new Error('Seed bundle signature verification failed');
    }
  } catch (error) {
    throw new Error(`Seed bundle signature verification error: ${error.message}`);
  }

  return {
    seeds: bundle.seeds,
    ts: bundle.ts,
    expires: bundle.expires
  };
}

/**
 * Load seeds from DNS TXT records (stub implementation)
 * @param {string} appId - Application identifier
 * @param {string} domain - Domain to query
 * @returns {Promise<string|null>} Seed bundle JSON or null
 */
export async function loadSeedsFromDns(appId, domain) {
  // TODO: Implement DNS TXT record lookup
  // In production, this would query TXT records for _peerpigeon.${domain}
  // and look for records containing seed bundles for the specified appId
  
  console.warn('DNS seed loading not implemented in development environment');
  return null;
  
  // Production implementation would look like:
  // const txtRecords = await dns.resolveTxt(`_peerpigeon.${domain}`);
  // for (const record of txtRecords) {
  //   const recordText = record.join('');
  //   try {
  //     const bundle = JSON.parse(recordText);
  //     if (bundle.app === appId) {
  //       return recordText;
  //     }
  //   } catch (e) {
  //     continue;
  //   }
  // }
  // return null;
}

/**
 * Load seeds from .well-known endpoints
 * @param {string[]} urls - Array of base URLs to check
 * @returns {Promise<string[]>} Array of seed bundle JSON strings
 */
export async function loadSeedsFromWellKnown(urls) {
  const bundles = [];
  
  for (const baseUrl of urls) {
    try {
      const wellKnownUrl = new URL('/.well-known/peerpigeon.json', baseUrl).toString();
      
      // Handle CORS in browser environments
      const response = await fetch(wellKnownUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        },
        // Note: In browser, this will only work for same-origin or CORS-enabled endpoints
        mode: 'cors'
      });
      
      if (!response.ok) {
        console.warn(`Failed to fetch .well-known from ${wellKnownUrl}: ${response.status}`);
        continue;
      }
      
      const bundleText = await response.text();
      
      // Validate it's valid JSON
      try {
        JSON.parse(bundleText);
        bundles.push(bundleText);
      } catch (error) {
        console.warn(`Invalid JSON from ${wellKnownUrl}:`, error.message);
      }
    } catch (error) {
      console.warn(`Error loading .well-known from ${baseUrl}:`, error.message);
    }
  }
  
  return bundles;
}

/**
 * Load cached seeds from local storage
 * @param {string} appId - Application identifier
 * @returns {Array<{t: string, u: string}>} Array of cached seed addresses
 */
export function loadCachedSeeds(appId) {
  try {
    // Try browser localStorage first
    if (typeof localStorage !== 'undefined') {
      const cacheKey = `peerpigeon-seeds-${appId}`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const seeds = JSON.parse(cached);
        if (Array.isArray(seeds)) {
          return seeds;
        }
      }
    }
    
    // Try Node.js file system (synchronous for simplicity)
    if (typeof process !== 'undefined' && process.versions?.node) {
      try {
        // Use dynamic import but catch sync for this function
        const cacheFile = `${process.env.HOME || process.env.USERPROFILE}/.peerpigeon-seeds.json`;
        
        // Try to read file synchronously if possible
        try {
          const fs = require('fs');
          if (fs.existsSync(cacheFile)) {
            const cacheData = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
            if (cacheData[appId] && Array.isArray(cacheData[appId])) {
              return cacheData[appId];
            }
          }
        } catch (requireError) {
          // ESM environment, skip file system for now
          console.warn('File system cache not available in ESM environment');
        }
      } catch (error) {
        console.warn('Failed to load cached seeds from file:', error.message);
      }
    }
  } catch (error) {
    console.warn('Failed to load cached seeds:', error.message);
  }
  
  return [];
}

/**
 * Store seeds in local cache
 * @param {string} appId - Application identifier
 * @param {Array<{t: string, u: string}>} seeds - Seed addresses to cache
 */
export function storeCachedSeeds(appId, seeds) {
  if (!Array.isArray(seeds) || seeds.length === 0) {
    return;
  }
  
  try {
    // Try browser localStorage first
    if (typeof localStorage !== 'undefined') {
      const cacheKey = `peerpigeon-seeds-${appId}`;
      localStorage.setItem(cacheKey, JSON.stringify(seeds));
      return;
    }
    
    // Try Node.js file system
    if (typeof process !== 'undefined' && process.versions?.node) {
      try {
        const cacheFile = `${process.env.HOME || process.env.USERPROFILE}/.peerpigeon-seeds.json`;
        
        try {
          const fs = require('fs');
          
          let cacheData = {};
          if (fs.existsSync(cacheFile)) {
            try {
              cacheData = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
            } catch (error) {
              console.warn('Failed to parse existing cache file, creating new one');
            }
          }
          
          cacheData[appId] = seeds;
          fs.writeFileSync(cacheFile, JSON.stringify(cacheData, null, 2));
        } catch (requireError) {
          // ESM environment, skip file system for now
          console.warn('File system cache not available in ESM environment');
        }
      } catch (error) {
        console.warn('Failed to store cached seeds to file:', error.message);
      }
    }
  } catch (error) {
    console.warn('Failed to store cached seeds:', error.message);
  }
}
