#!/usr/bin/env node

// Test cross-node WebRTC signaling through PeerPigeon mesh
import WebSocket from 'ws';
import { setTimeout } from 'timers/promises';
import { generatePeerId } from 'peerpigeon';

const NODES = [
  'wss://pigeonhub-server-3c044110c06f.herokuapp.com',
  'wss://pigeonhub.fly.dev'
];

console.log('🧪 Testing Cross-Node PeerPigeon Mesh Signaling');
console.log('================================================');

// Generate peer IDs using PeerPigeon's method
const peer1Id = generatePeerId();
const peer2Id = generatePeerId();

console.log(`🆔 Peer1 ID: ${peer1Id.substring(0, 8)}...`);
console.log(`🆔 Peer2 ID: ${peer2Id.substring(0, 8)}...`);

// Track connection states
let peer1Connected = false;
let peer2Connected = false;
let peer1Announced = false;
let peer2Announced = false;

// Create WebSocket connections to different nodes
const peer1 = new WebSocket(`${NODES[0]}?peerId=${peer1Id}`);
const peer2 = new WebSocket(`${NODES[1]}?peerId=${peer2Id}`);

console.log('\n1️⃣ Connecting peers to different nodes...');
console.log('🔌 Connecting Peer1-Heroku to wss://pigeonhub-server-3c044110c06f.herokuapp.com...');
console.log('🔌 Connecting Peer2-Fly to wss://pigeonhub.fly.dev...');

peer1.on('open', () => {
  console.log('✅ Peer1-Heroku connected to wss://pigeonhub-server-3c044110c06f.herokuapp.com');
  peer1Connected = true;
  
  // Announce peer1
  peer1.send(JSON.stringify({
    type: 'announce',
    peerId: peer1Id,
    data: { type: 'peer', capabilities: ['webrtc'] }
  }));
  
  peer1Announced = true;
  console.log('📢 Peer1-Heroku announced');
  
  checkReadyAndStartTest();
});

peer2.on('open', () => {
  console.log('✅ Peer2-Fly connected to wss://pigeonhub.fly.dev');
  peer2Connected = true;
  
  // Announce peer2
  peer2.send(JSON.stringify({
    type: 'announce',
    peerId: peer2Id,
    data: { type: 'peer', capabilities: ['webrtc'] }
  }));
  
  peer2Announced = true;
  console.log('📢 Peer2-Fly announced');
  
  checkReadyAndStartTest();
});

function checkReadyAndStartTest() {
  if (peer1Connected && peer2Connected && peer1Announced && peer2Announced) {
    setTimeout(() => {
      console.log('\n2️⃣ Waiting for cross-node announcements to propagate...');
      
      setTimeout(() => {
        console.log('\n3️⃣ Testing mesh-based cross-node signaling...');
        console.log(`📡 Peer1-Heroku sending offer to ${peer2Id.substring(0, 8)}...`);
        
        // Send an offer from peer1 to peer2
        peer1.send(JSON.stringify({
          type: 'offer',
          fromPeerId: peer1Id,
          targetPeerId: peer2Id,
          data: {
            sdp: 'v=0\r\no=- 123456789 987654321 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n',
            type: 'offer'
          }
        }));
        
        // Send some ICE candidates
        setTimeout(() => {
          peer1.send(JSON.stringify({
            type: 'ice-candidate',
            fromPeerId: peer1Id,
            targetPeerId: peer2Id,
            data: {
              candidate: 'candidate:1 1 UDP 2113667326 192.168.1.100 54400 typ host',
              sdpMLineIndex: 0,
              sdpMid: '0'
            }
          }));
        }, 500);
        
        console.log('\n4️⃣ Waiting for mesh routing...');
        
        setTimeout(() => {
          console.log('\n5️⃣ Testing reverse direction...');
          console.log(`📡 Peer2-Fly sending answer to ${peer1Id.substring(0, 8)}...`);
          
          // Send answer back
          peer2.send(JSON.stringify({
            type: 'answer',
            fromPeerId: peer2Id,
            targetPeerId: peer1Id,
            data: {
              sdp: 'v=0\r\no=- 987654321 123456789 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n',
              type: 'answer'
            }
          }));
          
        }, 2000);
        
      }, 3000);
    }, 1000);
  }
}

// Handle peer1 messages
peer1.on('message', (data) => {
  try {
    const message = JSON.parse(data.toString());
    console.log(`📨 Peer1-Heroku received: ${message.type} ${message.fromPeerId?.substring(0, 8) || 'system'}...`);
  } catch (e) {
    console.log(`📨 Peer1-Heroku received: ${data.toString().substring(0, 50)}...`);
  }
});

// Handle peer2 messages  
peer2.on('message', (data) => {
  try {
    const message = JSON.parse(data.toString());
    console.log(`📨 Peer2-Fly received: ${message.type} ${message.fromPeerId?.substring(0, 8) || 'system'}...`);
  } catch (e) {
    console.log(`📨 Peer2-Fly received: ${data.toString().substring(0, 50)}...`);
  }
});

// Handle disconnections
peer1.on('close', (code) => {
  console.log(`🔌 Peer1-Heroku disconnected: ${code}`);
});

peer2.on('close', (code) => {
  console.log(`🔌 Peer2-Fly disconnected: ${code}`);
});

// Handle errors
peer1.on('error', (error) => {
  console.log(`❌ Peer1-Heroku error: ${error.message}`);
});

peer2.on('error', (error) => {
  console.log(`❌ Peer2-Fly error: ${error.message}`);
});

// Test completion
setTimeout(() => {
  console.log('\n✅ Cross-node mesh signaling test completed!');
  console.log('Check the logs above to see if signals routed through the mesh.');
  
  peer1.close();
  peer2.close();
  process.exit(0);
}, 15000);
