/**
 * Bootstrap Node Registry
 * 
 * High-level wrapper around KademliaDHT for bootstrap node registration and discovery.
 * This provides a simple API for managing bootstrap nodes without dealing with low-level DHT operations.
 */

import { KademliaDHT } from './KademliaDHT.js';
import { EventEmitter } from 'events';

/**
 * Bootstrap Node Registry using Kademlia DHT
 */
export class BootstrapRegistry extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.networkId = options.networkId || 'pigeonhub-default';
    this.metadata = options.metadata || {};
    
    // Initialize Kademlia DHT
    this.dht = new KademliaDHT({
      nodeId: options.nodeId,
      port: options.port || 0,
      address: options.address || '0.0.0.0',
      bootstrapNodes: options.bootstrapNodes || []
    });
    
    // Registry state
    this.isRegistered = false;
    this.discoveredBootstraps = new Map();
    
    // Setup DHT event forwarding
    this.setupEventHandlers();
    
    console.log(`🏗️  Bootstrap Registry initialized for network: ${this.networkId}`);
  }

  /**
   * Setup event handlers to forward DHT events
   */
  setupEventHandlers() {
    this.dht.on('started', () => {
      this.emit('started');
    });
    
    this.dht.on('stopped', () => {
      this.emit('stopped');
    });
    
    this.dht.on('bootstrapped', () => {
      this.emit('networkJoined');
    });
    
    this.dht.on('bootstrapRegistered', (data) => {
      this.isRegistered = true;
      this.emit('bootstrapRegistered', data);
    });
    
    this.dht.on('contactAdded', (contact) => {
      this.emit('peerDiscovered', contact);
    });
    
    this.dht.on('error', (error) => {
      this.emit('error', error);
    });
  }

  /**
   * Start the bootstrap registry
   */
  async start() {
    console.log('🚀 Starting Bootstrap Registry...');
    await this.dht.start();
    console.log(`✅ Bootstrap Registry running on ${this.dht.address}:${this.dht.port}`);
  }

  /**
   * Stop the bootstrap registry
   */
  async stop() {
    console.log('🛑 Stopping Bootstrap Registry...');
    await this.dht.stop();
    this.isRegistered = false;
    this.discoveredBootstraps.clear();
    console.log('✅ Bootstrap Registry stopped');
  }

  /**
   * Register this node as a bootstrap node
   */
  async registerAsBootstrap(capabilities = []) {
    if (this.isRegistered) {
      console.log('⚠️  Already registered as bootstrap node');
      return;
    }

    const metadata = {
      networkId: this.networkId,
      capabilities: ['bootstrap', 'dht', ...capabilities],
      version: '1.0.0',
      timestamp: Date.now(),
      ...this.metadata
    };

    console.log(`📝 Registering as bootstrap node for network: ${this.networkId}`);
    const result = await this.dht.registerBootstrapNode(metadata);
    
    console.log(`✅ Successfully registered as bootstrap node`);
    console.log(`   Node ID: ${this.dht.nodeId}`);
    console.log(`   Address: ${this.dht.address}:${this.dht.port}`);
    console.log(`   Capabilities: ${metadata.capabilities.join(', ')}`);
    
    return result;
  }

  /**
   * Discover bootstrap nodes in the network
   */
  async discoverBootstrapNodes() {
    console.log(`🔍 Discovering bootstrap nodes for network: ${this.networkId}...`);
    
    const bootstrapNodes = await this.dht.discoverBootstrapNodes();
    
    // Filter by network ID and update our discovered list
    const networkBootstraps = bootstrapNodes.filter(node => 
      node.metadata && node.metadata.networkId === this.networkId
    );

    // Update discovered nodes map
    this.discoveredBootstraps.clear();
    for (const node of networkBootstraps) {
      this.discoveredBootstraps.set(node.nodeId, {
        ...node,
        discoveredAt: Date.now()
      });
    }

    console.log(`🌐 Discovered ${networkBootstraps.length} bootstrap nodes in network`);
    this.emit('bootstrapNodesDiscovered', networkBootstraps);
    
    return networkBootstraps;
  }

  /**
   * Discover a bootstrap node by pinging a known address
   */
  async discoverBootstrapByAddress(address, port) {
    console.log(`🔍 Attempting to discover bootstrap node at ${address}:${port}...`);
    
    try {
      const contact = await this.dht.discoverNodeByAddress(address, port);
      
      if (contact && contact.id) {
        console.log(`✅ Successfully discovered bootstrap node: ${contact.id.substring(0, 8)}...`);
        
        // Add to our discovered bootstraps map
        this.discoveredBootstraps.set(contact.id, {
          nodeId: contact.id,
          address: contact.address,
          port: contact.port,
          discoveredAt: Date.now(),
          metadata: { networkId: this.networkId } // Assume same network for now
        });
        
        this.emit('peerDiscovered', {
          id: contact.id,        // Use 'id' to match expected format
          nodeId: contact.id,    // Keep nodeId for compatibility
          address: contact.address,
          port: contact.port
        });
        
        return contact;
      } else {
        throw new Error(`Invalid contact returned from discovery - contact: ${contact ? 'exists but no id' : 'null/undefined'}`);
      }
    } catch (error) {
      console.log(`❌ Failed to discover bootstrap at ${address}:${port}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get list of discovered bootstrap nodes
   */
  getDiscoveredBootstraps() {
    return Array.from(this.discoveredBootstraps.values());
  }

  /**
   * Find bootstrap nodes with specific capabilities
   */
  async findBootstrapsWithCapability(capability) {
    const allBootstraps = await this.discoverBootstrapNodes();
    
    const capableBootstraps = allBootstraps.filter(node => 
      node.metadata && 
      node.metadata.capabilities && 
      node.metadata.capabilities.includes(capability)
    );

    console.log(`🎯 Found ${capableBootstraps.length} bootstrap nodes with capability: ${capability}`);
    return capableBootstraps;
  }

  /**
   * Store arbitrary data in the DHT
   */
  async storeData(key, data) {
    const fullKey = `${this.networkId}:${key}`;
    console.log(`💾 Storing data: ${key}`);
    return await this.dht.store(fullKey, data);
  }

  /**
   * Retrieve data from the DHT
   */
  async getData(key) {
    const fullKey = `${this.networkId}:${key}`;
    console.log(`🔍 Retrieving data: ${key}`);
    return await this.dht.get(fullKey);
  }

  /**
   * Announce capabilities to the network
   */
  async announceCapabilities(capabilities) {
    const announcementKey = `capabilities:${this.dht.nodeId}`;
    const announcementData = {
      nodeId: this.dht.nodeId,
      networkId: this.networkId,
      capabilities,
      address: this.dht.address,
      port: this.dht.port,
      timestamp: Date.now()
    };

    await this.storeData(announcementKey, announcementData);
    
    console.log(`📢 Announced capabilities: ${capabilities.join(', ')}`);
    this.emit('capabilitiesAnnounced', announcementData);
    
    return announcementData;
  }

  /**
   * Find nodes with specific capabilities (broader than just bootstrap nodes)
   */
  async findNodesWithCapability(capability) {
    // This is a simplified implementation - in a real scenario you'd search the DHT
    // For now, we'll check our local data and discovered bootstraps
    
    const capableNodes = [];
    
    // Check discovered bootstrap nodes
    for (const bootstrap of this.discoveredBootstraps.values()) {
      if (bootstrap.metadata && 
          bootstrap.metadata.capabilities && 
          bootstrap.metadata.capabilities.includes(capability)) {
        capableNodes.push(bootstrap);
      }
    }

    console.log(`🎯 Found ${capableNodes.length} nodes with capability: ${capability}`);
    return capableNodes;
  }

  /**
   * Get network topology and statistics
   */
  getNetworkInfo() {
    const dhtStats = this.dht.getStats();
    const discoveredCount = this.discoveredBootstraps.size;
    
    return {
      networkId: this.networkId,
      nodeId: this.dht.nodeId,
      address: this.dht.address,
      port: this.dht.port,
      isRegistered: this.isRegistered,
      isRunning: this.dht.isRunning,
      discoveredBootstraps: discoveredCount,
      dhtStats: {
        totalContacts: dhtStats.totalContacts,
        activeBuckets: dhtStats.activeBuckets,
        storedKeys: dhtStats.storedKeys
      }
    };
  }

  /**
   * Get detailed network information including all contacts and keys
   */
  getDetailedNetworkInfo() {
    const basicInfo = this.getNetworkInfo();
    const dhtNetworkInfo = this.dht.getNetworkInfo();
    const discoveredBootstraps = this.getDiscoveredBootstraps();
    
    return {
      ...basicInfo,
      contacts: dhtNetworkInfo.contacts,
      storedKeys: dhtNetworkInfo.keys,
      discoveredBootstraps
    };
  }

  /**
   * Add bootstrap nodes to connect to
   */
  addBootstrapNodes(nodes) {
    this.dht.addBootstrapNodes(nodes);
    console.log(`➕ Added ${nodes.length} bootstrap nodes`);
  }

  /**
   * Ping all known contacts
   */
  async pingAllContacts() {
    console.log('📡 Pinging all contacts...');
    return await this.dht.pingAllContacts();
  }

  /**
   * Perform network health check
   */
  async performHealthCheck() {
    const networkInfo = this.getNetworkInfo();
    const pingResults = await this.pingAllContacts();
    
    const healthReport = {
      timestamp: Date.now(),
      networkInfo,
      pingResults: {
        total: pingResults.length,
        successful: pingResults.filter(r => r.status === 'fulfilled' && r.value.success).length,
        failed: pingResults.filter(r => r.status === 'rejected' || !r.value.success).length
      }
    };

    console.log(`💓 Health check complete - ${healthReport.pingResults.successful}/${healthReport.pingResults.total} nodes responsive`);
    this.emit('healthCheck', healthReport);
    
    return healthReport;
  }

  /**
   * Start periodic health monitoring
   */
  startHealthMonitoring(intervalMs = 300000) { // 5 minutes default
    if (this.healthTimer) {
      console.log('⚠️  Health monitoring already running');
      return;
    }

    this.healthTimer = setInterval(async () => {
      try {
        await this.performHealthCheck();
      } catch (error) {
        console.error('❌ Health check failed:', error);
        this.emit('healthCheckError', error);
      }
    }, intervalMs);

    console.log(`💓 Started health monitoring (every ${intervalMs/1000}s)`);
  }

  /**
   * Stop health monitoring
   */
  stopHealthMonitoring() {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
      console.log('🛑 Stopped health monitoring');
    }
  }
}

export default BootstrapRegistry;
