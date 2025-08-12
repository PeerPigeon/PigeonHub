#!/usr/bin/env node

import { spawn } from 'child_process';
import { WebSocket } from 'ws';

console.log('🧪 Bootstrap Mesh Connection Test');
console.log('==================================');
console.log('Testing if Node1 and Node2 can connect as PeerPigeon mesh peers FIRST');
console.log('');

// Test timeout
const testTimeout = setTimeout(() => {
  console.log('\n⏰ Test timeout reached - killing all processes');
  cleanup();
  process.exit(1);
}, 60000); // 60 second timeout

let node1Process, node2Process;

function cleanup() {
  if (node1Process) {
    console.log('🔪 Killing Node1 process...');
    node1Process.kill();
  }
  if (node2Process) {
    console.log('🔪 Killing Node2 process...');
    node2Process.kill();
  }
  clearTimeout(testTimeout);
}

// Handle process cleanup
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

async function testBootstrapMeshConnection() {
  console.log('🚀 Step 1: Starting Node1 (Fly.io simulation) on port 3001...');
  
  // Start Node1 (simulating Fly.io - primary bootstrap node)
  node1Process = spawn('node', ['local-node.mjs', '3001', 'node1-fly'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'development',
      REGION: 'fly-io',
      BOOTSTRAP_PEERS: '' // Empty - this will be the primary bootstrap node
    }
  });
  
  node1Process.stdout.on('data', (data) => {
    console.log(`[Node1] ${data.toString().trim()}`);
  });
  
  node1Process.stderr.on('data', (data) => {
    console.log(`[Node1-ERR] ${data.toString().trim()}`);
  });

  // Wait for Node1 to start
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  console.log('\n🚀 Step 2: Starting Node2 (Heroku simulation) on port 3002...');
  console.log('   Node2 should connect to Node1 as a PeerPigeon mesh peer');
  
  // Start Node2 (simulating Heroku - should connect to Node1)
  node2Process = spawn('node', ['local-node.mjs', '3002', 'node2-heroku'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'development', 
      REGION: 'heroku',
      BOOTSTRAP_PEERS: 'ws://localhost:3001' // Connect to Node1
    }
  });
  
  node2Process.stdout.on('data', (data) => {
    console.log(`[Node2] ${data.toString().trim()}`);
  });
  
  node2Process.stderr.on('data', (data) => {
    console.log(`[Node2-ERR] ${data.toString().trim()}`);
  });

  // Wait for Node2 to start and potentially connect
  await new Promise(resolve => setTimeout(resolve, 10000));
  
  console.log('\n📊 Step 3: Checking if nodes connected as mesh peers...');
  
  // Check Node1 health/status
  try {
    const response1 = await fetch('http://localhost:3001/health');
    const health1 = await response1.json();
    console.log(`\n🏥 Node1 Health:`, health1);
  } catch (error) {
    console.log(`❌ Node1 health check failed: ${error.message}`);
  }
  
  // Check Node2 health/status  
  try {
    const response2 = await fetch('http://localhost:3002/health');
    const health2 = await response2.json();
    console.log(`\n🏥 Node2 Health:`, health2);
  } catch (error) {
    console.log(`❌ Node2 health check failed: ${error.message}`);
  }
  
  console.log('\n📊 Step 4: Final Assessment...');
  console.log('Look for messages indicating mesh peer connections in the logs above.');
  console.log('Success indicators:');
  console.log('  ✅ "PeerPigeon mesh initialized" on both nodes');  
  console.log('  ✅ "DHT connection established" on Node2');
  console.log('  ✅ "Mesh peers: X connected peers" showing > 0');
  console.log('');
  console.log('If you see connection failures or "Failed to establish DHT connection to any seed",');
  console.log('then the bootstrap mesh connection is NOT working and needs to be fixed first.');
  
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  console.log('\n🔪 Cleaning up...');
  cleanup();
  console.log('✅ Test completed');
}

// Start the test
testBootstrapMeshConnection().catch(error => {
  console.error('❌ Test failed:', error);
  cleanup();
  process.exit(1);
});
