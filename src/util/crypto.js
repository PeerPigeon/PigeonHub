/**
 * @fileoverview Cryptographic utilities using WebCrypto API
 */

import { canonicalEncode } from './encoding.js';
import * as cbor from './cbor.js';

/**
 * Get WebCrypto subtle interface
 * @returns {SubtleCrypto} WebCrypto subtle interface
 */
function getSubtle() {
  // Try global crypto first (browser)
  if (globalThis.crypto?.subtle) {
    return globalThis.crypto.subtle;
  }
  
  // Try Node.js webcrypto
  if (typeof process !== 'undefined' && process.versions?.node) {
    try {
      // Try dynamic import for Node.js ESM
      const crypto = globalThis.crypto;
      if (crypto?.subtle) {
        return crypto.subtle;
      }
    } catch (e) {
      // Ignore
    }
  }
  
  throw new Error('WebCrypto SubtleCrypto not available');
}

/**
 * Hash data with SHA-1
 * @param {Uint8Array} data - Data to hash
 * @returns {Promise<Uint8Array>} SHA-1 hash
 */
export async function sha1(data) {
  const subtle = getSubtle();
  const hashBuffer = await subtle.digest('SHA-1', data);
  return new Uint8Array(hashBuffer);
}

/**
 * Sign message with Ed25519 private key
 * @param {Uint8Array} message - Message to sign
 * @param {CryptoKey} privateKey - Ed25519 private key
 * @returns {Promise<Uint8Array>} Signature bytes
 */
export async function signEd25519(message, privateKey) {
  const subtle = getSubtle();
  const signatureBuffer = await subtle.sign('Ed25519', privateKey, message);
  return new Uint8Array(signatureBuffer);
}

/**
 * Verify Ed25519 signature
 * @param {Uint8Array} message - Original message
 * @param {Uint8Array} signature - Signature to verify
 * @param {Uint8Array} publicKeyRaw - Raw public key bytes (32 bytes)
 * @returns {Promise<boolean>} True if signature is valid
 */
export async function verifyEd25519(message, signature, publicKeyRaw) {
  const subtle = getSubtle();
  
  try {
    // Import the raw public key
    const publicKey = await subtle.importKey(
      'raw',
      publicKeyRaw,
      {
        name: 'Ed25519',
        namedCurve: 'Ed25519'
      },
      false,
      ['verify']
    );
    
    return await subtle.verify('Ed25519', publicKey, signature, message);
  } catch (error) {
    console.warn('Ed25519 verification failed:', error.message);
    return false;
  }
}

/**
 * Export raw public key from CryptoKey
 * @param {CryptoKey} cryptoKey - Public key to export
 * @returns {Promise<Uint8Array>} Raw public key bytes
 */
export async function exportRawPublicKey(cryptoKey) {
  const subtle = getSubtle();
  const keyBuffer = await subtle.exportKey('raw', cryptoKey);
  return new Uint8Array(keyBuffer);
}

/**
 * Encode object using CBOR with JSON fallback
 * @param {any} obj - Object to encode
 * @param {boolean} [fallbackToJson=true] - Whether to fallback to JSON
 * @returns {Promise<Uint8Array>} Encoded bytes
 */
export async function cborEncode(obj, fallbackToJson = true) {
  try {
    return await cbor.encode(obj);
  } catch (error) {
    if (fallbackToJson) {
      const jsonStr = canonicalEncode(obj);
      return new TextEncoder().encode(jsonStr);
    }
    throw error;
  }
}

/**
 * Decode CBOR bytes with JSON fallback
 * @param {Uint8Array} bytes - Bytes to decode
 * @returns {Promise<any>} Decoded object
 */
export async function cborDecode(bytes) {
  return await cbor.decode(bytes);
}
