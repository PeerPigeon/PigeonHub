/**
 * @fileoverview CBOR encoding/decoding utilities with fallback to JSON
 */

let cborg = null;
let cborgLoading = null;
let cborgFailed = false;

/**
 * Lazy load cborg module
 * @returns {Promise<object|null>} CBOR module or null if unavailable
 */
async function loadCborg() {
  if (cborg) return cborg;
  if (cborgFailed) return null;
  if (cborgLoading) return cborgLoading;
  
  cborgLoading = (async () => {
    try {
      // Try to import cborg from npm first (if available)
      try {
        cborg = await import('cborg');
        return cborg;
      } catch (npmError) {
        // Try CDN as fallback (browser only)
        if (typeof window !== 'undefined') {
          cborg = await import('https://esm.sh/cborg@4.2.4');
          return cborg;
        }
        throw npmError;
      }
    } catch (error) {
      // Silently fail and use JSON fallback
      cborgFailed = true;
      cborg = null;
      return null;
    }
  })();
  
  return cborgLoading;
}

/**
 * Encode object to CBOR bytes
 * @param {any} obj - Object to encode
 * @returns {Promise<Uint8Array>} CBOR-encoded bytes
 */
export async function encode(obj) {
  const cbor = await loadCborg();
  
  if (cbor && cbor.encode) {
    try {
      return cbor.encode(obj);
    } catch (error) {
      // Silently fall back to JSON
    }
  }
  
  // JSON fallback
  const jsonStr = JSON.stringify(obj);
  return new TextEncoder().encode(jsonStr);
}

/**
 * Decode CBOR bytes to object
 * @param {Uint8Array} bytes - CBOR-encoded bytes
 * @returns {Promise<any>} Decoded object
 */
export async function decode(bytes) {
  const cbor = await loadCborg();
  
  if (cbor && cbor.decode) {
    try {
      return cbor.decode(bytes);
    } catch (error) {
      // Silently try JSON fallback
    }
  }
  
  // JSON fallback
  try {
    const jsonStr = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(jsonStr);
    
    // Convert base64 strings back to Uint8Arrays for known fields
    return reconstructUint8Arrays(parsed);
  } catch (error) {
    throw new Error(`Failed to decode bytes as both CBOR and JSON: ${error.message}`);
  }
}

/**
 * Reconstruct Uint8Arrays from base64 strings in a SignalRecord
 * @param {any} obj - Parsed JSON object
 * @returns {any} Object with Uint8Arrays reconstructed
 */
function reconstructUint8Arrays(obj) {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => reconstructUint8Arrays(item));
  }
  
  const result = { ...obj };
  
  // Known fields that should be Uint8Arrays in SignalRecord
  const uint8ArrayFields = ['topic', 'id', 'salt', 'pk', 'sig'];
  
  for (const field of uint8ArrayFields) {
    if (typeof result[field] === 'string') {
      try {
        // Convert base64 back to Uint8Array
        result[field] = Uint8Array.from(atob(result[field]), c => c.charCodeAt(0));
      } catch (error) {
        console.warn(`Failed to convert ${field} from base64:`, error.message);
      }
    }
  }
  
  return result;
}
