/**
 * MeshIdUtils - Utilities for generating mesh identifiers
 * 
 * This module provides utilities for generating deterministic mesh IDs
 * using SHA1 hashing with the "peerpigeon-" prefix.
 */

import crypto from 'crypto';

/**
 * Generate a mesh ID using SHA1 hash of the input string with "peerpigeon-" prefix
 * 
 * @param {string} input - The input string to hash
 * @returns {string} - The mesh ID in format "peerpigeon-<sha1_hash>"
 */
export function generateMeshId(input) {
  if (typeof input !== 'string') {
    throw new Error('Input must be a string');
  }
  
  const hash = crypto.createHash('sha1').update(input).digest('hex');
  return `peerpigeon-${hash}`;
}

/**
 * Generate a deterministic network identifier for mesh discovery
 * 
 * @param {string} networkId - The base network identifier
 * @returns {string} - The deterministic mesh network identifier
 */
export function generateNetworkMeshId(networkId) {
  return generateMeshId(`bootstrap-coordination-${networkId}`);
}

export default {
  generateMeshId,
  generateNetworkMeshId
};
