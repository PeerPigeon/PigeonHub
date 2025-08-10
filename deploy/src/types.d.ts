/**
 * @fileoverview Type definitions for PeerSignalDir
 */

export interface SignalRecord {
  /** Protocol version */
  v: 1;
  /** Record type */
  kind: 'signal';
  /** Topic key (SHA1 of signal:${appId} or signal:${appId}:region:${region}) */
  topic: Uint8Array;
  /** Record ID (SHA1 of public key) */
  id: Uint8Array;
  /** Monotonic sequence number */
  seq: bigint;
  /** Timestamp in milliseconds */
  ts: number;
  /** Time-to-live in seconds */
  ttl: number;
  /** Signaling endpoint URLs */
  urls: Array<{ t: 'ws' | 'http'; u: string }>;
  /** Optional ICE configuration hints */
  ice?: {
    turn?: string[];
    policy?: string;
  };
  /** Optional capability tags */
  caps?: string[];
  /** Random salt for uniqueness */
  salt: Uint8Array;
  /** Ed25519 public key (32 bytes) */
  pk: Uint8Array;
  /** Ed25519 signature (64 bytes) */
  sig: Uint8Array;
}

export interface SeedBundle {
  /** Protocol version */
  v: 1;
  /** Application identifier */
  app: string;
  /** Timestamp in milliseconds */
  ts: number;
  /** Expiration time in seconds */
  expires: number;
  /** Seed peer addresses */
  seeds: Array<{ t: string; u: string }>;
  /** Publisher public key (base64) */
  pk: string;
  /** Signature over canonical JSON (base64) */
  sig: string;
}

export interface DhtAdapter {
  /** Store a value at the given key */
  put(key: Uint8Array, value: Uint8Array): Promise<void>;
  /** Retrieve values for the given key */
  get(key: Uint8Array): Promise<Uint8Array[]>;
  /** Get closest peers to a key (optional) */
  closestPeers?(key: Uint8Array): Promise<any[]>;
}

export interface CryptoAdapter {
  /** Hash data with SHA1 */
  sha1(data: Uint8Array): Promise<Uint8Array>;
  /** Sign data with Ed25519 private key */
  signEd25519(message: Uint8Array, privateKey: CryptoKey): Promise<Uint8Array>;
  /** Verify Ed25519 signature */
  verifyEd25519(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): Promise<boolean>;
  /** Export raw public key from CryptoKey */
  exportRawPublicKey(cryptoKey: CryptoKey): Promise<Uint8Array>;
  /** Encode object to CBOR or JSON */
  cborEncode(obj: any, fallbackToJson?: boolean): Promise<Uint8Array>;
  /** Decode CBOR or JSON bytes */
  cborDecode(bytes: Uint8Array): Promise<any>;
}

export interface PublishOptions {
  /** Application identifier */
  appId: string;
  /** Optional region identifier */
  region?: string;
  /** Ed25519 public key (32 bytes) */
  publicKey: Uint8Array;
  /** Ed25519 private key for signing */
  privateKey: CryptoKey;
  /** Signaling endpoint URLs */
  urls: Array<{ t: 'ws' | 'http'; u: string }>;
  /** Optional capability tags */
  caps?: string[];
  /** Time-to-live in seconds */
  ttlSec?: number;
  /** Sequence number */
  seq?: bigint;
  /** Number of additional storage shards */
  extraShards?: number;
}

export interface BootstrapOptions {
  /** Application identifier */
  appId: string;
  /** Fallback seed addresses */
  hardcodedSeeds?: Array<{ t: string; u: string }>;
  /** Trusted publisher key for seed bundles (base64) */
  pinnedPublisherKeyBase64?: string;
  /** Additional PeerPigeon mesh options */
  meshOpts?: any;
}

export interface BootstrapResult {
  /** PeerPigeon mesh instance */
  mesh: any;
  /** DHT adapter instance */
  dht: DhtAdapter;
}

export declare class SignalDirectory {
  constructor(dht: DhtAdapter, crypto?: CryptoAdapter);
  
  /** Generate topic key for app and optional region */
  topicKey(appId: string, region?: string): Promise<Uint8Array>;
  
  /** Publish a signaling record */
  publish(options: PublishOptions): Promise<SignalRecord>;
  
  /** Find signaling records */
  find(appId: string, region?: string, limit?: number): Promise<SignalRecord[]>;
}

export declare class PeerPigeonDhtAdapter implements DhtAdapter {
  constructor(options: { mesh?: any; webDHT?: any });
  put(key: Uint8Array, value: Uint8Array): Promise<void>;
  get(key: Uint8Array): Promise<Uint8Array[]>;
  closestPeers?(key: Uint8Array): Promise<any[]>;
}

export declare function verifySeedBundle(
  bundleJsonString: string, 
  pinnedPublisherKeyBase64: string
): Promise<{ seeds: Array<{ t: string; u: string }>; ts: number; expires: number }>;

export declare function bootstrapPeerPigeon(options: BootstrapOptions): Promise<BootstrapResult>;

// Utility functions
export declare function canonicalEncode(value: any): string;
export declare function concatBytes(...arrays: Uint8Array[]): Uint8Array;
export declare function bufEq(a: Uint8Array, b: Uint8Array): boolean;
export declare function sha1Hex(bytes: Uint8Array): Promise<string>;
