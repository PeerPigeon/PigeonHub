#!/usr/bin/env node

// Test cross-node WebRTC signaling through PeerPigeon mesh
import WebSocket from 'ws';
import { setTimeout } from 'timers/promises';

const NODES = [
  'wss://pigeonhub-server-3c044110c06f.herokuapp.com',
  'wss://pigeonhub.fly.dev'
];

// Generate a simple peer ID for testing
function generatePeerId() {
  return Array.from({length: 40}, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

async function connectPeer(nodeUrl, peerId, name) {
  return new Promise((resolve, reject) => {
    const wsUrl = `${nodeUrl}?peerId=${peerId}`;
    console.log(`🔌 Connecting ${name} to ${nodeUrl}...`);
    
    const ws = new WebSocket(wsUrl);
    
    const peerState = {
      ws,
      peerId,
      name,
      nodeUrl,
      connected: false,
      announced: false
    };
    
    ws.on('open', () => {
      console.log(`✅ ${name} connected to ${nodeUrl}`);
      peerState.connected = true;
      
      // Send announce message
      ws.send(JSON.stringify({
        type: 'announce',
        data: { name },
        timestamp: Date.now()
      }));
      
      console.log(`📢 ${name} announced`);
      peerState.announced = true;
      resolve(peerState);
    });
    
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log(`📨 ${name} received:`, message.type, message.fromPeerId?.substring(0, 8) + '...');
      } catch (error) {
        console.log(`❌ ${name} parse error:`, error.message);
      }
    });
    
    ws.on('close', (code, reason) => {
      console.log(`🔌 ${name} disconnected: ${code} ${reason}`);
      peerState.connected = false;
    });
    
    ws.on('error', (error) => {
      console.log(`❌ ${name} error:`, error.message);
      reject(error);
    });
    
    // Timeout after 10 seconds
    setTimeout(10000).then(() => {
      if (!peerState.connected) {
        reject(new Error(`Connection timeout for ${name}`));
      }
    });
  });
}

async function sendSignal(fromPeer, targetPeerId, signalType, signalData) {
  const message = {
    type: signalType,
    data: signalData,
    targetPeerId,
    timestamp: Date.now()
  };
  
  console.log(`📡 ${fromPeer.name} sending ${signalType} to ${targetPeerId.substring(0, 8)}...`);
  fromPeer.ws.send(JSON.stringify(message));
}

async function testCrossNodeSignaling() {
  console.log('🧪 Testing Cross-Node PeerPigeon Mesh Signaling');
  console.log('================================================\n');
  
  // Generate peer IDs
  const peer1Id = generatePeerId();
  const peer2Id = generatePeerId();
  
  console.log(`🆔 Peer1 ID: ${peer1Id.substring(0, 8)}...`);
  console.log(`🆔 Peer2 ID: ${peer2Id.substring(0, 8)}...`);
  console.log();
  
  try {
    // Connect peer1 to Heroku, peer2 to Fly.io
    console.log('1️⃣ Connecting peers to different nodes...');
    const [peer1, peer2] = await Promise.all([
      connectPeer(NODES[0], peer1Id, 'Peer1-Heroku'),
      connectPeer(NODES[1], peer2Id, 'Peer2-Fly')
    ]);
    
    // Wait for announcements to propagate
    console.log('\n2️⃣ Waiting for cross-node announcements to propagate...');
    await setTimeout(3000);
    
    // Test mesh-based signaling: send offer from peer1 to peer2
    console.log('\n3️⃣ Testing mesh-based cross-node signaling...');
    
    const testOffer = {
      type: 'offer',
      sdp: 'v=0\r\no=- 123456789 987654321 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n'
    };
    
    await sendSignal(peer1, peer2Id, 'offer', testOffer);
    
    // Wait to see if the offer routes through the mesh
    console.log('\n4️⃣ Waiting for mesh routing...');
    await setTimeout(5000);
    
    // Test the other direction
    console.log('\n5️⃣ Testing reverse direction...');
    const testAnswer = {
      type: 'answer', 
      sdp: 'v=0\r\no=- 987654321 123456789 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n'
    };
    
    await sendSignal(peer2, peer1Id, 'answer', testAnswer);
    
    // Wait for mesh routing
    await setTimeout(5000);
    
    console.log('\n✅ Cross-node mesh signaling test completed!');
    console.log('Check the logs above to see if signals routed through the mesh.');
    
    // Clean up
    peer1.ws.close();
    peer2.ws.close();
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

// Run the test
testCrossNodeSignaling();
