  /**
   * Find closest contacts in routing table
   */
  findClosestContacts(targetId, count = K) {
    const allContacts = [];
    
    // Collect all contacts from all buckets
    for (const bucket of this.routingTable) {
      allContacts.push(...bucket.getAllContacts());
    }
    
    // Sort by distance to target
    return allContacts
      .map(contact => ({
        contact,
        distance: contact.distanceTo(targetId)
      }))
      .sort((a, b) => {
        if (a.distance < b.distance) return -1;
        if (a.distance > b.distance) return 1;
        return 0;
      })
      .slice(0, count)
      .map(item => item.contact);
  }

  /**
   * Add contact to routing table
   */
  addContact(contact) {
    if (contact.id === this.nodeId) {
      return false; // Don't add ourselves
    }

    const bucketIndex = this.getBucketIndex(contact.id);
    const bucket = this.routingTable[bucketIndex];
    
    const added = bucket.addContact(contact);
    if (added) {
      console.log(`➕ Added contact to bucket ${bucketIndex}: ${contact.id.substring(0, 8)}...`);
      this.emit('contactAdded', contact);
    }
    
    return added;
  }

  /**
   * Remove contact from routing table
   */
  removeContact(contactId) {
    const bucketIndex = this.getBucketIndex(contactId);
    const bucket = this.routingTable[bucketIndex];
    
    const removed = bucket.removeContact(contactId);
    if (removed) {
      console.log(`➖ Removed contact from bucket ${bucketIndex}: ${contactId.substring(0, 8)}...`);
      this.emit('contactRemoved', contactId);
    }
    
    return removed;
  }

  /**
   * Handle incoming UDP messages
   */
  handleMessage(buffer, rinfo) {
    try {
      const message = JSON.parse(buffer.toString());
      
      // Update contact info for sender
      if (message.senderId && message.senderId !== this.nodeId) {
        const contact = new KademliaContact(message.senderId, rinfo.address, rinfo.port);
        this.addContact(contact);
      }
      
      if (message.type === 'response' && message.requestId) {
        // Handle response to our request
        this.handleResponse(message);
      } else {
        // Handle incoming request
        this.handleRequest(message, rinfo);
      }
      
    } catch (error) {
      console.error('❌ Error parsing message:', error);
    }
  }

  /**
   * Handle incoming requests
   */
  async handleRequest(message, rinfo) {
    const response = {
      type: 'response',
      requestId: message.requestId,
      senderId: this.nodeId
    };

    try {
      switch (message.method) {
        case 'ping':
          response.result = { pong: true };
          break;

        case 'find_node':
          const targetId = message.params.targetId;
          const closestContacts = this.findClosestContacts(targetId, K);
          response.result = {
            contacts: closestContacts.map(c => ({
              id: c.id,
              address: c.address,
              port: c.port
            }))
          };
          break;

        case 'store':
          const { key, value } = message.params;
          const kademliaValue = new KademliaValue(key, value, message.senderId);
          this.dataStore.set(key, kademliaValue);
          response.result = { stored: true };
          console.log(`📥 Stored key from ${message.senderId.substring(0, 8)}...: ${key.substring(0, 8)}...`);
          break;

        case 'get':
          const requestedKey = message.params.key;
          const storedValue = this.dataStore.get(requestedKey);
          if (storedValue && !storedValue.isExpired()) {
            response.result = { value: storedValue.value };
          } else {
            response.result = { value: null };
          }
          break;

        default:
          response.error = { message: `Unknown method: ${message.method}` };
      }
    } catch (error) {
      response.error = { message: error.message };
    }

    // Send response
    const responseBuffer = Buffer.from(JSON.stringify(response));
    this.socket.send(responseBuffer, rinfo.port, rinfo.address);
  }

  /**
   * Handle responses to our requests
   */
  handleResponse(message) {
    const pending = this.pendingRequests.get(message.requestId);
    if (!pending) {
      return; // Unknown request ID
    }

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(message.requestId);

    if (message.error) {
      pending.reject(new Error(message.error.message));
    } else {
      pending.resolve(message.result);
    }
  }

  /**
   * Send a request and wait for response
   */
  sendRequest(contact, method, params, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const requestId = `req_${++this.requestCounter}_${Date.now()}`;
      
      const message = {
        type: 'request',
        requestId,
        method,
        params,
        senderId: this.nodeId
      };

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Request timeout'));
      }, timeoutMs);

      this.pendingRequests.set(requestId, { resolve, reject, timeout });

      const buffer = Buffer.from(JSON.stringify(message));
      this.socket.send(buffer, contact.port, contact.address, (err) => {
        if (err) {
          clearTimeout(timeout);
          this.pendingRequests.delete(requestId);
          reject(err);
        }
      });
    });
  }

  /**
   * Send PING request
   */
  async sendPing(contact) {
    const startTime = Date.now();
    await this.sendRequest(contact, 'ping', {});
    const rtt = Date.now() - startTime;
    contact.rtt = rtt;
    contact.touch();
    return rtt;
  }

  /**
   * Send FIND_NODE request
   */
  async sendFindNode(contact, targetId) {
    const result = await this.sendRequest(contact, 'find_node', { targetId });
    
    // Convert response to KademliaContact objects
    return result.contacts.map(c => new KademliaContact(c.id, c.address, c.port));
  }

  /**
   * Send STORE request
   */
  async sendStore(contact, key, value) {
    return await this.sendRequest(contact, 'store', { key, value });
  }

  /**
   * Send GET request
   */
  async sendGet(contact, key) {
    const result = await this.sendRequest(contact, 'get', { key });
    return result.value;
  }

  /**
   * Start maintenance tasks
   */
  startMaintenance() {
    // Bucket refresh - periodically refresh stale buckets
    this.bucketRefreshTimer = setInterval(() => {
      this.refreshBuckets();
    }, BUCKET_REFRESH_INTERVAL);

    // Key republishing - republish keys we're responsible for
    this.republishTimer = setInterval(() => {
      this.republishKeys();
    }, KEY_REPUBLISH_INTERVAL);

    // Expire old keys
    this.expireTimer = setInterval(() => {
      this.expireKeys();
    }, KEY_EXPIRE_TIME / 10); // Check every 2.4 hours

    console.log('🔧 Started Kademlia maintenance tasks');
  }

  /**
   * Stop maintenance tasks
   */
  stopMaintenance() {
    if (this.bucketRefreshTimer) {
      clearInterval(this.bucketRefreshTimer);
      this.bucketRefreshTimer = null;
    }

    if (this.republishTimer) {
      clearInterval(this.republishTimer);
      this.republishTimer = null;
    }

    if (this.expireTimer) {
      clearInterval(this.expireTimer);
      this.expireTimer = null;
    }

    console.log('🛑 Stopped Kademlia maintenance tasks');
  }

  /**
   * Refresh stale buckets
   */
  async refreshBuckets() {
    for (let i = 0; i < this.routingTable.length; i++) {
      const bucket = this.routingTable[i];
      
      if (bucket.needsRefresh() && bucket.size() > 0) {
        // Generate a random ID in this bucket's range and do a lookup
        const randomId = this.generateRandomIdForBucket(i);
        try {
          await this.findNode(randomId);
          console.log(`🔄 Refreshed bucket ${i}`);
        } catch (error) {
          console.error(`❌ Failed to refresh bucket ${i}:`, error);
        }
      }
    }
  }

  /**
   * Republish keys that need republishing
   */
  async republishKeys() {
    const keysToRepublish = [];
    
    for (const [keyHash, value] of this.dataStore.entries()) {
      if (value.needsRepublish() && !value.isExpired()) {
        keysToRepublish.push({ keyHash, value });
      }
    }

    for (const { keyHash, value } of keysToRepublish) {
      try {
        // Find closest nodes to the key
        const closestNodes = await this.findNode(keyHash);
        
        // Republish to closest nodes
        const promises = closestNodes.slice(0, K).map(contact =>
          this.sendStore(contact, keyHash, value.value)
        );
        
        await Promise.allSettled(promises);
        value.updateRepublishTime();
        
        console.log(`🔄 Republished key: ${value.key}`);
      } catch (error) {
        console.error(`❌ Failed to republish key ${value.key}:`, error);
      }
    }
  }

  /**
   * Remove expired keys
   */
  expireKeys() {
    const expiredKeys = [];
    
    for (const [keyHash, value] of this.dataStore.entries()) {
      if (value.isExpired()) {
        expiredKeys.push(keyHash);
      }
    }

    for (const keyHash of expiredKeys) {
      const value = this.dataStore.get(keyHash);
      this.dataStore.delete(keyHash);
      console.log(`🗑️  Expired key: ${value.key}`);
      this.emit('keyExpired', { key: value.key, keyHash });
    }
  }

  /**
   * Generate random ID for bucket refresh
   */
  generateRandomIdForBucket(bucketIndex) {
    // Generate a random ID that falls within the bucket's range
    const nodeIdBuffer = Buffer.from(this.nodeId, 'hex');
    const randomBuffer = crypto.randomBytes(20);
    
    // Flip the bit at position bucketIndex to ensure it's in the right bucket
    const byteIndex = Math.floor(bucketIndex / 8);
    const bitIndex = bucketIndex % 8;
    
    if (byteIndex < 20) {
      // Copy our node ID and flip the appropriate bit
      for (let i = 0; i < 20; i++) {
        randomBuffer[i] = nodeIdBuffer[i];
      }
      
      // Flip the bit to put it in the target bucket
      randomBuffer[byteIndex] ^= (1 << (7 - bitIndex));
      
      // Randomize the remaining bits
      for (let i = byteIndex; i < 20; i++) {
        if (i === byteIndex) {
          // Only randomize the lower bits
          const mask = (1 << (7 - bitIndex)) - 1;
          randomBuffer[i] = (randomBuffer[i] & ~mask) | (crypto.randomBytes(1)[0] & mask);
        } else {
          randomBuffer[i] = crypto.randomBytes(1)[0];
        }
      }
    }
    
    return randomBuffer.toString('hex');
  }

  /**
   * Get DHT statistics
   */
  getStats() {
    const totalContacts = this.routingTable.reduce((sum, bucket) => sum + bucket.size(), 0);
    const activeBuckets = this.routingTable.filter(bucket => bucket.size() > 0).length;
    const storedKeys = this.dataStore.size;
    
    return {
      nodeId: this.nodeId,
      address: this.address,
      port: this.port,
      isRunning: this.isRunning,
      totalContacts,
      activeBuckets,
      storedKeys,
      buckets: this.routingTable.map((bucket, index) => ({
        index,
        size: bucket.size(),
        lastChanged: bucket.lastChanged,
        needsRefresh: bucket.needsRefresh()
      }))
    };
  }

  /**
   * Get detailed network information
   */
  getNetworkInfo() {
    const stats = this.getStats();
    const contacts = [];
    
    for (const bucket of this.routingTable) {
      for (const contact of bucket.getAllContacts()) {
        contacts.push({
          id: contact.id,
          address: contact.address,
          port: contact.port,
          lastSeen: contact.lastSeen,
          rtt: contact.rtt,
          failureCount: contact.failureCount,
          isStale: contact.isStale()
        });
      }
    }
    
    const keys = Array.from(this.dataStore.entries()).map(([keyHash, value]) => ({
      keyHash,
      key: value.key,
      publisher: value.publisher,
      timestamp: value.timestamp,
      isExpired: value.isExpired(),
      needsRepublish: value.needsRepublish()
    }));
    
    return {
      ...stats,
      contacts,
      keys
    };
  }

  /**
   * Manually add bootstrap nodes
   */
  addBootstrapNodes(nodes) {
    this.bootstrapNodes.push(...nodes);
    
    if (this.isRunning) {
      // Add them to routing table immediately
      for (const node of nodes) {
        const contact = new KademliaContact(node.nodeId, node.address, node.port);
        this.addContact(contact);
      }
    }
  }

  /**
   * Ping all contacts to check liveness
   */
  async pingAllContacts() {
    const allContacts = [];
    for (const bucket of this.routingTable) {
      allContacts.push(...bucket.getAllContacts());
    }

    const pingPromises = allContacts.map(async (contact) => {
      try {
        const rtt = await this.sendPing(contact);
        return { contact, success: true, rtt };
      } catch (error) {
        contact.recordFailure();
        return { contact, success: false, error: error.message };
      }
    });

    const results = await Promise.allSettled(pingPromises);
    const successCount = results.filter(r => 
      r.status === 'fulfilled' && r.value.success
    ).length;

    console.log(`📡 Pinged ${allContacts.length} contacts, ${successCount} responded`);
    return results;
  }
}

export default KademliaDHT;
