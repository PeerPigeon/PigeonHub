#!/usr/bin/env node

/**
 * Generate Ed25519 keypair for PigeonHub deployment
 * This script uses Node.js webcrypto APIs to generate keys
 */

import { webcrypto } from 'node:crypto';

// Set up crypto for Node.js
if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

/**
 * Convert ArrayBuffer to base64 string
 * @param {ArrayBuffer} buffer 
 * @returns {string}
 */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Generate Ed25519 signing key pair
 * @returns {Promise<{privateKey: CryptoKey, publicKey: CryptoKey}>}
 */
async function generateSigningKeyPair() {
  return await crypto.subtle.generateKey(
    {
      name: 'Ed25519',
      namedCurve: 'Ed25519'
    },
    true, // extractable
    ['sign', 'verify']
  );
}

async function main() {
  try {
    console.log('Generating Ed25519 keypair...');
    
    const { privateKey, publicKey } = await generateSigningKeyPair();
    
    // Export keys to raw format
    const privateKeyBuffer = await crypto.subtle.exportKey('pkcs8', privateKey);
    const publicKeyBuffer = await crypto.subtle.exportKey('spki', publicKey);
    
    // Convert to base64
    const privateKeyBase64 = arrayBufferToBase64(privateKeyBuffer);
    const publicKeyBase64 = arrayBufferToBase64(publicKeyBuffer);
    
    // Output as environment variable format
    console.log('SEED_PRIVATE_KEY=' + privateKeyBase64);
    console.log('SEED_PUBLIC_KEY=' + publicKeyBase64);
    
  } catch (error) {
    console.error('Failed to generate keypair:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
