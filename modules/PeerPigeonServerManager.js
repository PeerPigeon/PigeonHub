/**
 * PeerPigeon Server Manager
 * 
 * This module manages the WebSocket signaling server alongside the bootstrap nodes.
 * It provides cross-node signaling relay functionality for the PigeonHub network.
 */

import { WebSocketServerController } from './WebSocketServerController.js';

export class PeerPigeonServerManager {
  constructor(options = {}) {
    this.options = {
      port: options.port || 3001,
      host: options.host || 'localhost',
      maxPeers: options.maxPeers || 100,
      ...options
    };

    this.webSocketServer = new WebSocketServerController(this.options);
    this.bootstrapNode = null; // Reference to associated bootstrap node
    this.isRunning = false;
    this.stats = {
      startTime: null,
      totalConnections: 0,
      messagesProcessed: 0,
      peersEvicted: 0,
      signalingRelays: 0
    };
  }

  /**
   * Start the integrated PeerPigeon server
   */
  async start() {
    try {
      console.log(`🚀 Starting PeerPigeon Server Manager on ${this.options.host}:${this.options.port}`);

      // Start the WebSocket server
      await this.webSocketServer.start();

      this.isRunning = true;
      this.stats.startTime = Date.now();

      console.log(`✅ PeerPigeon Server Manager started successfully`);

      return true;

    } catch (error) {
      console.error(`❌ Failed to start PeerPigeon Server Manager:`, error);
      throw error;
    }
  }

  /**
   * Stop the PeerPigeon server
   */
  async stop() {
    try {
      console.log(`🛑 Stopping PeerPigeon Server Manager...`);

      if (this.webSocketServer) {
        await this.webSocketServer.stop();
      }

      this.isRunning = false;
      console.log(`✅ PeerPigeon Server Manager stopped`);

    } catch (error) {
      console.error(`❌ Error stopping PeerPigeon Server Manager:`, error);
      throw error;
    }
  }

  /**
   * Get server statistics
   */
  getStats() {
    const serverStats = this.webSocketServer ? this.webSocketServer.getStats() : {};
    
    return {
      ...this.stats,
      uptime: this.stats.startTime ? Date.now() - this.stats.startTime : 0,
      isRunning: this.isRunning,
      serverStats
    };
  }

  /**
   * Health check
   */
  healthCheck() {
    return {
      healthy: this.isRunning && this.webSocketServer?.healthCheck()?.healthy,
      stats: this.getStats(),
      timestamp: Date.now()
    };
  }

  /**
   * Set the associated bootstrap node for cross-node signaling relay
   */
  setBootstrapNode(bootstrapNode) {
    this.bootstrapNode = bootstrapNode;
    console.log(`🔗 Bootstrap node linked to ServerManager for cross-node signaling`);
    
    // Register the cross-node relay function with the WebSocket server
    if (this.webSocketServer) {
      this.webSocketServer.setCrossNodeRelay((targetPeerId, message) => {
        console.log(`🔍 CROSS-NODE RELAY HANDLER: Received relay request for peer ${targetPeerId?.substring(0, 8)}...`);
        console.log(`🔍 CROSS-NODE RELAY HANDLER: Message type: ${message.type}, from: ${message.fromPeerId?.substring(0, 8)}`);
        console.log(`🔍 CROSS-NODE RELAY HANDLER: Full message:`, JSON.stringify(message, null, 2));
        
        // Handle both signaling relay and peer announcement relay
        if (message.type === 'peer-announce-relay') {
          console.log(`🔍 CROSS-NODE RELAY: Handling peer announcement relay`);
          return this.handleCrossNodePeerAnnounce(message);
        } else {
          console.log(`🔍 CROSS-NODE RELAY: Handling signaling message relay`);
          const result = this.handleIncomingSignaling(message.fromPeerId, targetPeerId, message);
          console.log(`🔍 CROSS-NODE RELAY: Signaling relay result:`, result);
          return result;
        }
      });

      // NEW: Set up mesh gateway functionality
      if (this.bootstrapNode && this.bootstrapNode.mesh) {
        console.log(`🌐 Setting up mesh gateway for WebSocket server on port ${this.options.port}`);
        this.webSocketServer.setMeshGateway(this.bootstrapNode.mesh);
        
        // Debug mesh connectivity
        const meshStatus = this.bootstrapNode.mesh.getStatus();
        console.log(`🔍 MESH DEBUG: Current mesh status:`, {
          peerId: meshStatus.peerId?.substring(0, 8),
          connected: meshStatus.connected,
          connectedCount: this.bootstrapNode.mesh.getConnectedPeerCount(),
          discoveredCount: this.bootstrapNode.mesh.getDiscoveredPeers().length,
          connectedPeers: this.bootstrapNode.mesh.getConnectedPeers ? this.bootstrapNode.mesh.getConnectedPeers().map(p => p.substring(0, 8)) : 'N/A',
          discoveredPeers: this.bootstrapNode.mesh.getDiscoveredPeers().map(p => p.substring(0, 8))
        });
      }
    }
  }

  /**
   * Handle cross-node peer announcement
   */
  handleCrossNodePeerAnnounce(message) {
    if (this.bootstrapNode && this.bootstrapNode.mesh) {
      console.log(`🌐 Relaying peer announcement to other bootstrap nodes via mesh`);
      console.log(`🔍 DEBUGGING: Sending message: ${JSON.stringify(message).substring(0, 200)}`);
      console.log(`🔍 DEBUGGING: Mesh status: connected=${this.bootstrapNode.mesh.getConnectedPeerCount()}, discovered=${this.bootstrapNode.mesh.getDiscoveredPeers().length}`);
      
      // Clean the message to avoid serialization issues
      const cleanMessage = JSON.parse(JSON.stringify(message, (key, value) => {
        // Convert BigInt to string if present
        if (typeof value === 'bigint') {
          return value.toString();
        }
        return value;
      }));
      
      // Try different approaches to send the message
      console.log(`🔍 DEBUGGING: Mesh object type: ${typeof this.bootstrapNode.mesh}`);
      console.log(`🔍 DEBUGGING: Mesh constructor: ${this.bootstrapNode.mesh.constructor.name}`);
      console.log(`🔍 DEBUGGING: sendMessage method exists: ${typeof this.bootstrapNode.mesh.sendMessage}`);
      console.log(`🔍 DEBUGGING: sendDirectMessage method exists: ${typeof this.bootstrapNode.mesh.sendDirectMessage}`);
      console.log(`🔍 DEBUGGING: broadcast method exists: ${typeof this.bootstrapNode.mesh.broadcast}`);
      
      // Get mesh status to understand the issue
      let meshStatus = null;
      try {
        meshStatus = this.bootstrapNode.mesh.getStatus();
        console.log(`🔍 DEBUGGING: Mesh status object: ${JSON.stringify(meshStatus)}`);
      } catch (err) {
        console.log(`🔍 DEBUGGING: Error getting mesh status: ${err.message}`);
      }
      
      let messageId = null;
      
      // Try different messaging approaches
      if (meshStatus && meshStatus.connectedCount > 0) {
        try {
          // First try regular sendMessage
          messageId = this.bootstrapNode.mesh.sendMessage(cleanMessage);
          console.log(`🔍 DEBUGGING: sendMessage result: ${messageId}`);
        } catch (sendError) {
          console.log(`🔍 DEBUGGING: sendMessage failed: ${sendError.message}`);
        }
        
        // If sendMessage failed, try getting connected peer IDs manually
        if (!messageId) {
          console.log(`🔍 DEBUGGING: Trying manual direct messaging...`);
          try {
            // Try different ways to get connected peers
            let connectedPeerIds = [];
            
            if (this.bootstrapNode.mesh.getConnectedPeerIds) {
              connectedPeerIds = this.bootstrapNode.mesh.getConnectedPeerIds();
              console.log(`🔍 DEBUGGING: getConnectedPeerIds(): ${JSON.stringify(connectedPeerIds)}`);
            } else if (this.bootstrapNode.mesh.getConnectedPeers) {
              const connectedPeers = this.bootstrapNode.mesh.getConnectedPeers();
              connectedPeerIds = Array.isArray(connectedPeers) ? connectedPeers : [];
              console.log(`🔍 DEBUGGING: getConnectedPeers(): ${JSON.stringify(connectedPeerIds)}`);
            }
            
            console.log(`🔍 DEBUGGING: Final peer IDs for direct messaging: ${JSON.stringify(connectedPeerIds)}`);
            
            if (Array.isArray(connectedPeerIds) && connectedPeerIds.length > 0) {
              for (const peerId of connectedPeerIds) {
                if (typeof peerId === 'string' && peerId !== meshStatus.peerId) { // Don't send to ourselves
                  try {
                    const directResult = this.bootstrapNode.mesh.sendDirectMessage(peerId, cleanMessage);
                    console.log(`🔍 DEBUGGING: Direct message to ${peerId.substring(0, 8)}... result: ${directResult}`);
                    if (directResult) messageId = directResult;
                  } catch (directError) {
                    console.log(`🔍 DEBUGGING: Direct message to ${peerId.substring(0, 8)}... failed: ${directError.message}`);
                  }
                }
              }
            } else {
              console.log(`🔍 DEBUGGING: No valid connected peer IDs found for direct messaging`);
            }
          } catch (err) {
            console.log(`🔍 DEBUGGING: Manual direct messaging failed: ${err.message}`);
          }
        }
      } else {
        console.log(`🔍 DEBUGGING: Not enough connected peers (${meshStatus?.connectedCount || 0}) to send message`);
      }
      
      if (!messageId) {
        console.log(`❌ DEBUGGING: All messaging methods failed! Message could not be sent.`);
        console.log(`🔍 DEBUGGING: This indicates a fundamental issue with the mesh network messaging`);
        console.log(`🔍 DEBUGGING: Mesh may not be properly connected or message format is incompatible`);
      } else {
        console.log(`✅ DEBUGGING: Message sent successfully with ID: ${messageId}`);
      }
      
      return true;
    } else {
      console.log(`❌ No bootstrap node available for cross-node relay`);
      console.log(`🔍 DEBUGGING: bootstrapNode=${!!this.bootstrapNode}, mesh=${!!this.bootstrapNode?.mesh}`);
    }
    return false;
  }

  /**
   * Relay signaling message to local peer or request cross-node relay
   */
  relaySignalingMessage(targetPeerId, signalingMessage) {
    try {
      console.log(`🔍 RELAY DEBUG: Attempting to relay ${signalingMessage.type} message to ${targetPeerId?.substring(0, 8)}... on port ${this.options.port}`);
      
      // First try to send to local peer through our WebSocket server
      if (this.webSocketServer && this.webSocketServer.sendSignalingMessage) {
        const success = this.webSocketServer.sendSignalingMessage(targetPeerId, signalingMessage);
        if (success) {
          this.stats.signalingRelays++;
          console.log(`📡 ✅ RELAY SUCCESS: Relayed ${signalingMessage.type} to local peer ${targetPeerId?.substring(0, 8)}... on port ${this.options.port}`);
          return true;
        } else {
          console.log(`🔍 RELAY DEBUG: Local peer ${targetPeerId?.substring(0, 8)}... not found on port ${this.options.port}, trying cross-node relay`);
        }
      }

      // If local peer not found, try cross-node relay through bootstrap mesh
      if (this.bootstrapNode && this.bootstrapNode.requestSignalingRelay) {
        console.log(`🌐 CROSS-NODE REQUEST: Peer ${targetPeerId?.substring(0, 8)}... not found locally on port ${this.options.port}, requesting cross-node relay`);
        console.log(`🔍 CROSS-NODE REQUEST: Sending ${signalingMessage.type} via mesh to other bootstrap nodes`);
        
        const relayResult = this.bootstrapNode.requestSignalingRelay(targetPeerId, signalingMessage);
        console.log(`🔍 CROSS-NODE REQUEST: Bootstrap relay result:`, relayResult);
        
        return true; // Consider it successful as we made the attempt
      }

      console.log(`❌ RELAY FAILED: Unable to relay signaling message - peer ${targetPeerId?.substring(0, 8)}... not found and no cross-node relay available`);
      return false;

    } catch (error) {
      console.error(`❌ Error in signaling relay:`, error);
      return false;
    }
  }

  /**
   * Handle incoming signaling message that needs potential cross-node relay
   */
  handleIncomingSignaling(fromPeerId, targetPeerId, signalingMessage) {
    // This method can be called from the WebSocket server to handle cross-node routing
    return this.relaySignalingMessage(targetPeerId, {
      ...signalingMessage,
      fromPeerId,
      relayedBy: this.options.port // Track which server relayed it
    });
  }
}

export default PeerPigeonServerManager;
