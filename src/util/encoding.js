/**
 * @fileoverview Encoding utilities for deterministic serialization
 */

/**
 * Canonical JSON encoding with deterministic key ordering
 * @param {any} value - Value to encode
 * @returns {string} Canonical JSON string
 */
export function canonicalEncode(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  
  if (typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value);
  }
  
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  
  if (typeof value === 'bigint') {
    return JSON.stringify(value.toString());
  }
  
  if (value instanceof Uint8Array) {
    // Convert to base64 for JSON serialization
    return JSON.stringify(btoa(String.fromCharCode(...value)));
  }
  
  if (Array.isArray(value)) {
    const items = value.map(item => canonicalEncode(item));
    return '[' + items.join(',') + ']';
  }
  
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    const pairs = keys.map(key => {
      const encodedKey = JSON.stringify(key);
      const encodedValue = canonicalEncode(value[key]);
      return encodedKey + ':' + encodedValue;
    });
    return '{' + pairs.join(',') + '}';
  }
  
  throw new Error(`Cannot canonically encode value of type ${typeof value}`);
}

/**
 * Concatenate multiple Uint8Arrays
 * @param {...Uint8Array} arrays - Arrays to concatenate
 * @returns {Uint8Array} Concatenated array
 */
export function concatBytes(...arrays) {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  
  return result;
}

/**
 * Compare two Uint8Arrays for equality
 * @param {Uint8Array} a - First array
 * @param {Uint8Array} b - Second array
 * @returns {boolean} True if arrays are equal
 */
export function bufEq(a, b) {
  if (a.length !== b.length) return false;
  
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  
  return true;
}

/**
 * Hash bytes with SHA1 and return hex string
 * @param {Uint8Array} bytes - Bytes to hash
 * @returns {Promise<string>} SHA1 hash as hex string
 */
export async function sha1Hex(bytes) {
  // Get WebCrypto subtle interface
  const subtle = globalThis.crypto?.subtle || 
                (await import('crypto')).webcrypto?.subtle;
  
  if (!subtle) {
    throw new Error('WebCrypto not available');
  }
  
  const hashBuffer = await subtle.digest('SHA-1', bytes);
  const hashArray = new Uint8Array(hashBuffer);
  
  // Convert to hex string
  return Array.from(hashArray)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
