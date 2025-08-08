/**
 * @fileoverview PeerPigeon DHT adapter
 */

/**
 * DHT adapter for PeerPigeon WebDHT
 */
export class PeerPigeonDhtAdapter {
  /**
   * Create a new PeerPigeon DHT adapter
   * @param {object} options - Configuration options
   * @param {object} [options.mesh] - PeerPigeon mesh instance
   * @param {object} [options.webDHT] - WebDHT instance directly
   */
  constructor({ mesh, webDHT } = {}) {
    if (webDHT) {
      this.webDHT = webDHT;
    } else if (mesh?.webDHT) {
      this.webDHT = mesh.webDHT;
    } else {
      throw new Error('Either mesh with webDHT or webDHT directly must be provided');
    }
    
    this.mesh = mesh;
  }

  /**
   * Store a value in the DHT
   * @param {Uint8Array} key - Key to store under
   * @param {Uint8Array} value - Value to store
   * @returns {Promise<void>}
   */
  async put(key, value) {
    if (!this.webDHT) {
      throw new Error('WebDHT not initialized');
    }
    
    try {
      await this.webDHT.put(key, value);
    } catch (error) {
      console.warn('DHT put failed:', error.message);
      throw error;
    }
  }

  /**
   * Retrieve values from the DHT
   * @param {Uint8Array} key - Key to look up
   * @returns {Promise<Uint8Array[]>} Array of values found
   */
  async get(key) {
    if (!this.webDHT) {
      throw new Error('WebDHT not initialized');
    }
    
    try {
      const result = await this.webDHT.get(key);
      
      // Normalize result to array
      if (!result) {
        return [];
      }
      
      if (Array.isArray(result)) {
        return result.filter(item => item instanceof Uint8Array);
      }
      
      if (result instanceof Uint8Array) {
        return [result];
      }
      
      // Handle other result formats that PeerPigeon might return
      if (result.values && Array.isArray(result.values)) {
        return result.values.filter(item => item instanceof Uint8Array);
      }
      
      if (result.value instanceof Uint8Array) {
        return [result.value];
      }
      
      console.warn('Unexpected DHT get result format:', typeof result);
      return [];
    } catch (error) {
      console.warn('DHT get failed:', error.message);
      return [];
    }
  }

  /**
   * Get closest peers to a key (optional method)
   * @param {Uint8Array} key - Key to find peers for
   * @returns {Promise<any[]>} Array of peer information
   */
  async closestPeers(key) {
    if (!this.webDHT?.closestPeers) {
      console.warn('closestPeers not available in this DHT implementation');
      return [];
    }
    
    try {
      const peers = await this.webDHT.closestPeers(key);
      return Array.isArray(peers) ? peers : [];
    } catch (error) {
      console.warn('closestPeers failed:', error.message);
      return [];
    }
  }

  /**
   * Check if the DHT is ready for operations
   * @returns {boolean} True if DHT is ready
   */
  isReady() {
    return !!this.webDHT;
  }

  /**
   * Get DHT statistics (if available)
   * @returns {object} DHT statistics
   */
  getStats() {
    if (this.webDHT?.getStats) {
      return this.webDHT.getStats();
    }
    
    return {
      ready: this.isReady(),
      peers: this.mesh?.getPeers?.()?.length || 0
    };
  }
}
