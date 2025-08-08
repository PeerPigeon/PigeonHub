#!/usr/bin/env node

// Simple test script for local PeerSignalDir network
import { setTimeout } from 'timers/promises';

const NODES = [
  'http://localhost:3000',
  'http://localhost:3001', 
  'http://localhost:3002',
  'http://localhost:3003'
];

async function checkNodeHealth(nodeUrl) {
  try {
    const response = await fetch(`${nodeUrl}/health`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    return { error: error.message, url: nodeUrl };
  }
}

async function publishRecord(nodeUrl, topic, data, ttl = 300) {
  try {
    const response = await fetch(`${nodeUrl}/api/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, data, ttl })
    });
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    return { error: error.message };
  }
}

async function findRecords(nodeUrl, topic) {
  try {
    const response = await fetch(`${nodeUrl}/api/find/${topic}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    return { error: error.message };
  }
}

async function testNetwork() {
  console.log('🧪 Testing PeerSignalDir Local Network');
  console.log('=====================================\n');

  // 1. Check which nodes are running
  console.log('📋 Checking node health...');
  const healthResults = await Promise.all(
    NODES.map(async (url) => {
      const health = await checkNodeHealth(url);
      const port = url.split(':')[2];
      
      if (health.error) {
        console.log(`❌ Node ${port}: ${health.error}`);
        return null;
      } else {
        console.log(`✅ Node ${port} (${health.nodeId}): ${health.peers} peers, ${Math.floor(health.uptime/1000)}s uptime`);
        return { url, health };
      }
    })
  );
  
  const runningNodes = healthResults.filter(n => n !== null);
  
  if (runningNodes.length === 0) {
    console.log('\n❌ No nodes are running!');
    console.log('💡 Start nodes with:');
    console.log('   npm run local:node1  # in terminal 1');
    console.log('   npm run local:node2  # in terminal 2');
    console.log('   npm run local:node3  # in terminal 3');
    return;
  }
  
  console.log(`\n✅ Found ${runningNodes.length} running nodes\n`);
  
  // 2. Test publishing from first node
  console.log('📤 Testing publish operation...');
  const publishNode = runningNodes[0];
  const testTopic = `test-${Date.now()}`;
  const testData = {
    message: 'Hello from local test!',
    timestamp: Date.now(),
    from: publishNode.health.nodeId
  };
  
  const publishResult = await publishRecord(publishNode.url, testTopic, testData);
  
  if (publishResult.error) {
    console.log(`❌ Publish failed: ${publishResult.error}`);
    return;
  }
  
  console.log(`✅ Published to topic "${testTopic}" from ${publishNode.health.nodeId}`);
  console.log(`   Record ID: ${publishResult.recordId}`);
  console.log(`   Expires: ${new Date(publishResult.expiresAt).toLocaleString()}\n`);
  
  // 3. Wait for DHT replication
  console.log('⏳ Waiting 3 seconds for DHT replication...\n');
  await setTimeout(3000);
  
  // 4. Test finding from all other nodes
  console.log('🔍 Testing find operations from all nodes...');
  
  for (const node of runningNodes) {
    const findResult = await findRecords(node.url, testTopic);
    const port = node.url.split(':')[2];
    
    if (findResult.error) {
      console.log(`❌ Node ${port}: Find failed - ${findResult.error}`);
    } else if (findResult.count === 0) {
      console.log(`⚠️  Node ${port}: No records found (DHT not replicated yet?)`);
    } else {
      console.log(`✅ Node ${port}: Found ${findResult.count} records`);
      findResult.records.forEach((record, i) => {
        console.log(`   Record ${i + 1}: ${record.data.message} (from ${record.data.from})`);
      });
    }
  }
  
  console.log('\n🧪 Testing multiple topics...');
  
  // 5. Test WebRTC signaling simulation
  const webrtcTests = [
    {
      topic: 'room-123-offers',
      data: {
        type: 'offer',
        sdp: 'mock-sdp-offer-data',
        from: 'alice',
        room: '123'
      }
    },
    {
      topic: 'room-123-answers', 
      data: {
        type: 'answer',
        sdp: 'mock-sdp-answer-data',
        from: 'bob',
        to: 'alice',
        room: '123'
      }
    },
    {
      topic: 'room-456-ice',
      data: {
        type: 'ice-candidate',
        candidate: 'mock-ice-candidate',
        from: 'carol',
        room: '456'
      }
    }
  ];
  
  // Publish from different nodes
  for (let i = 0; i < webrtcTests.length && i < runningNodes.length; i++) {
    const test = webrtcTests[i];
    const node = runningNodes[i];
    const port = node.url.split(':')[2];
    
    console.log(`📤 Publishing ${test.data.type} to ${test.topic} from node ${port}`);
    await publishRecord(node.url, test.topic, test.data);
  }
  
  // Wait and then find from different nodes
  await setTimeout(2000);
  console.log('\n🔍 Cross-node lookups:');
  
  for (let i = 0; i < webrtcTests.length && i < runningNodes.length; i++) {
    const test = webrtcTests[i];
    // Find from a different node than we published from
    const findNode = runningNodes[(i + 1) % runningNodes.length];
    const findPort = findNode.url.split(':')[2];
    
    const result = await findRecords(findNode.url, test.topic);
    if (result.error) {
      console.log(`❌ Node ${findPort} -> ${test.topic}: ${result.error}`);
    } else {
      console.log(`✅ Node ${findPort} -> ${test.topic}: Found ${result.count} records`);
    }
  }
  
  console.log('\n🎉 Local network test completed!');
  console.log('\n💡 Try these manual tests:');
  console.log('   curl http://localhost:3000/health');
  console.log('   curl -X POST http://localhost:3000/api/publish -H "Content-Type: application/json" \\');
  console.log('     -d \'{"topic":"my-test","data":{"msg":"hello world"}}\'');
  console.log('   curl http://localhost:3001/api/find/my-test');
}

// Run the test
testNetwork().catch(console.error);
