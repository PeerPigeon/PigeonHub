/**
 * @fileoverview Main module exports for PeerSignalDir
 */

// Core classes
export { SignalDirectory } from './signal-directory.js';
export { PeerPigeonDhtAdapter } from './substrates/peerpigeon-adapter.js';

// Bootstrap functions
export { bootstrapPeerPigeon } from './bootstrap/bootstrap.js';

// Bootstrap peer configuration
export { 
  getBootstrapPeers, 
  parseBootstrapPeersFromEnv,
  validateBootstrapPeer,
  filterValidBootstrapPeers,
  PRODUCTION_BOOTSTRAP_PEERS,
  COMMUNITY_BOOTSTRAP_PEERS,
  LOCAL_BOOTSTRAP_PEERS,
  DEFAULT_BOOTSTRAP_CONFIG
} from './config/bootstrap-peers.js';
export { 
  verifySeedBundle, 
  loadSeedsFromDns, 
  loadSeedsFromWellKnown, 
  loadCachedSeeds, 
  storeCachedSeeds 
} from './bootstrap/seed-bundle.js';

// Utility functions
export { 
  canonicalEncode, 
  concatBytes, 
  bufEq, 
  sha1Hex 
} from './util/encoding.js';

export { 
  sha1, 
  signEd25519, 
  verifyEd25519, 
  exportRawPublicKey, 
  cborEncode, 
  cborDecode 
} from './util/crypto.js';

export { encode as cborEncodeUtil, decode as cborDecodeUtil } from './util/cbor.js';
