#!/usr/bin/env node

/**
 * @fileoverview Command-line interface for PeerSignalDir
 */

import { bootstrapPeerPigeon, SignalDirectory, exportRawPublicKey } from '../src/index.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const DEFAULT_SEEDS = [
  { t: 'ws', u: 'ws://localhost:3000' }
];

/**
 * Generate or load Ed25519 keypair
 * @param {string} [keyFile] - Optional key file path
 * @returns {Promise<{publicKey: CryptoKey, privateKey: CryptoKey}>} Keypair
 */
async function getOrCreateKeypair(keyFile) {
  if (keyFile && existsSync(keyFile)) {
    try {
      const keyData = JSON.parse(readFileSync(keyFile, 'utf8'));
      
      // Import the keys
      const subtle = globalThis.crypto?.subtle || (await import('crypto')).webcrypto.subtle;
      
      const privateKey = await subtle.importKey(
        'pkcs8',
        new Uint8Array(keyData.privateKey),
        { name: 'Ed25519' },
        true,
        ['sign']
      );
      
      const publicKey = await subtle.importKey(
        'spki',
        new Uint8Array(keyData.publicKey),
        { name: 'Ed25519' },
        true,
        ['verify']
      );
      
      console.log(`Loaded keypair from ${keyFile}`);
      return { publicKey, privateKey };
    } catch (error) {
      console.error(`Failed to load keypair from ${keyFile}:`, error.message);
      process.exit(1);
    }
  }
  
  // Generate new keypair
  const subtle = globalThis.crypto?.subtle || (await import('crypto')).webcrypto.subtle;
  const keypair = await subtle.generateKey(
    { name: 'Ed25519' },
    true,
    ['sign', 'verify']
  );
  
  // Save keypair if file path provided
  if (keyFile) {
    try {
      const privateKeyBytes = await subtle.exportKey('pkcs8', keypair.privateKey);
      const publicKeyBytes = await subtle.exportKey('spki', keypair.publicKey);
      
      const keyData = {
        privateKey: Array.from(new Uint8Array(privateKeyBytes)),
        publicKey: Array.from(new Uint8Array(publicKeyBytes))
      };
      
      writeFileSync(keyFile, JSON.stringify(keyData, null, 2));
      console.log(`Saved new keypair to ${keyFile}`);
    } catch (error) {
      console.warn(`Failed to save keypair to ${keyFile}:`, error.message);
    }
  } else {
    console.log('Generated temporary keypair (not saved)');
  }
  
  return keypair;
}

/**
 * Parse command line arguments
 * @param {string[]} args - Command line arguments
 * @returns {object} Parsed options
 */
function parseArgs(args) {
  const options = {};
  const positional = [];
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const nextArg = args[i + 1];
      
      if (nextArg && !nextArg.startsWith('--')) {
        options[key] = nextArg;
        i++; // Skip next arg since we consumed it
      } else {
        options[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  
  return { options, positional };
}

/**
 * Publish command
 */
async function publishCommand(args) {
  const { options } = parseArgs(args);
  
  // Required options
  if (!options.app) {
    console.error('--app option is required');
    process.exit(1);
  }
  
  // Collect URLs
  const urls = [];
  if (options.ws) {
    urls.push({ t: 'ws', u: options.ws });
  }
  if (options.http) {
    urls.push({ t: 'http', u: options.http });
  }
  
  if (urls.length === 0) {
    console.error('At least one URL (--ws or --http) is required');
    process.exit(1);
  }
  
  try {
    // Bootstrap DHT
    console.log('Bootstrapping PeerPigeon...');
    const { mesh, dht } = await bootstrapPeerPigeon({
      appId: options.app,
      hardcodedSeeds: DEFAULT_SEEDS
    });
    
    // Get or create keypair
    const defaultKeyFile = join(homedir(), '.pp-sig-key.json');
    const keyFile = options.key || defaultKeyFile;
    const keypair = await getOrCreateKeypair(keyFile);
    
    // Create directory and publish
    const dir = new SignalDirectory(dht);
    const publicKeyRaw = await exportRawPublicKey(keypair.publicKey);
    
    const record = await dir.publish({
      appId: options.app,
      region: options.region,
      publicKey: publicKeyRaw,
      privateKey: keypair.privateKey,
      urls,
      ttlSec: options.ttl ? parseInt(options.ttl) : 600
    });
    
    console.log('Published signaling record:');
    console.log({
      id: Array.from(record.id, b => b.toString(16).padStart(2, '0')).join(''),
      seq: record.seq.toString(),
      urls: record.urls,
      ttl: record.ttl
    });
    
    // Keep running for a bit to ensure propagation
    console.log('Waiting for DHT propagation...');
    setTimeout(() => {
      console.log('Publication complete');
      process.exit(0);
    }, 5000);
    
  } catch (error) {
    console.error('Publish failed:', error.message);
    process.exit(1);
  }
}

/**
 * Find command
 */
async function findCommand(args) {
  const { options } = parseArgs(args);
  
  // Required options
  if (!options.app) {
    console.error('--app option is required');
    process.exit(1);
  }
  
  try {
    // Bootstrap DHT
    console.log('Bootstrapping PeerPigeon...');
    const { mesh, dht } = await bootstrapPeerPigeon({
      appId: options.app,
      hardcodedSeeds: DEFAULT_SEEDS
    });
    
    // Create directory and find
    const dir = new SignalDirectory(dht);
    const records = await dir.find(options.app, options.region);
    
    // Format output
    const results = records.map(record => ({
      id: Array.from(record.id, b => b.toString(16).padStart(2, '0')).join(''),
      seq: record.seq.toString(),
      ts: record.ts,
      ttl: record.ttl,
      urls: record.urls,
      caps: record.caps
    }));
    
    console.log(JSON.stringify(results, null, 2));
    
    setTimeout(() => {
      process.exit(0);
    }, 1000);
    
  } catch (error) {
    console.error('Find failed:', error.message);
    process.exit(1);
  }
}

/**
 * Seed publish command (optional)
 */
async function seedPublishCommand(args) {
  console.log('Seed publishing not yet implemented');
  process.exit(1);
}

/**
 * Show help
 */
function showHelp() {
  console.log(`
pp-sig - PeerSignalDir CLI

Usage:
  pp-sig publish --app <appId> [options]
  pp-sig find --app <appId> [options]
  pp-sig seed-publish --app <appId> [options]

Commands:
  publish     Publish a signaling endpoint
  find        Find signaling endpoints
  seed-publish Publish seed records (not implemented)

Options for publish:
  --app <appId>       Application identifier (required)
  --region <region>   Optional region identifier
  --ws <url>          WebSocket signaling URL
  --http <url>        HTTP signaling URL
  --ttl <seconds>     Time-to-live in seconds (default: 600)
  --key <file>        Ed25519 key file (default: ~/.pp-sig-key.json)

Options for find:
  --app <appId>       Application identifier (required)
  --region <region>   Optional region identifier

Examples:
  pp-sig publish --app my-app --ws wss://signal.example.com/ws
  pp-sig publish --app my-app --region us-west --http https://signal.example.com/sdp --ttl 1200
  pp-sig find --app my-app
  pp-sig find --app my-app --region us-west
`);
}

/**
 * Main CLI entry point
 */
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    showHelp();
    process.exit(1);
  }
  
  const command = args[0];
  const commandArgs = args.slice(1);
  
  switch (command) {
    case 'publish':
      await publishCommand(commandArgs);
      break;
      
    case 'find':
      await findCommand(commandArgs);
      break;
      
    case 'seed-publish':
      await seedPublishCommand(commandArgs);
      break;
      
    case 'help':
    case '--help':
    case '-h':
      showHelp();
      break;
      
    default:
      console.error(`Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error.message);
  process.exit(1);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error.message);
  process.exit(1);
});

// Run main function
main().catch((error) => {
  console.error('CLI error:', error.message);
  process.exit(1);
});
