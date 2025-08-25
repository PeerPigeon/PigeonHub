import { PigeonHubNode } from './pigeonhub-node.js';

/**
 * Example usage of PigeonHub Node
 * 
 * Shows how to create and customize a PigeonHub node
 */

async function runExample() {
  console.log('🎯 PigeonHub Node Example');
  console.log('========================');
  
  // Create a custom PigeonHub node
  const node = new PigeonHubNode({
    websocketPort: 3001,  // Custom local port
    signalingServerUrl: 'wss://a02bdof0g2.execute-api.us-east-1.amazonaws.com/dev',
    maxPeers: 5,
    sendPeriodicMessages: true,
    messageInterval: 20000,  // Send messages every 20 seconds
    statusInterval: 15000    // Status updates every 15 seconds
  });

  // Listen for events
  node.on('started', () => {
    console.log('🎉 Node started event received');
  });

  node.on('meshConnected', () => {
    console.log('🌐 Connected to remote mesh event received');
  });

  node.on('peerConnected', (data) => {
    console.log(`🤝 Peer connected event: ${data.peerId.substring(0, 8)}...`);
  });

  node.on('messageReceived', (data) => {
    console.log(`📨 Message received event from ${data.from.substring(0, 8)}...: ${data.content}`);
    
    // Only echo if this is not already an echo message to prevent infinite loops
    if (!data.content.startsWith('Echo:')) {
      node.sendToRemoteMesh(`Echo: ${data.content}`).catch(console.error);
    }
  });

  // Custom message sending example
  setTimeout(async () => {
    try {
      await node.sendToRemoteMesh('Hello from example script!');
      console.log('📤 Sent custom message to remote mesh');
    } catch (error) {
      console.error('❌ Failed to send custom message:', error);
    }
  }, 10000);

  // Start the node
  try {
    await node.start();
    console.log('✅ Example PigeonHub node is running!');
    console.log(`🌐 Local WebSocket server: ws://localhost:3001`);
    console.log('🔗 Connected to remote mesh network');
  } catch (error) {
    console.error('❌ Failed to start node:', error);
    process.exit(1);
  }

  // Graceful shutdown
  let isShuttingDown = false;
  
  const shutdown = async (signal) => {
    if (isShuttingDown) {
      console.log(`\n⚠️  Already shutting down, forcing exit...`);
      process.exit(1);
    }
    
    isShuttingDown = true;
    console.log(`\n🛑 Shutting down example (${signal})...`);
    
    try {
      await node.stop();
      console.log('👋 Example stopped cleanly');
      process.exit(0);
    } catch (error) {
      console.error('❌ Error during shutdown:', error);
      process.exit(1);
    }
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

runExample().catch(error => {
  console.error('❌ Example failed:', error);
  process.exit(1);
});
