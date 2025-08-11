#!/usr/bin/env node

import { WebSocket } from 'ws';

console.log('🧪 Testing Cross-Node Mesh Communication');
console.log('=====================================');

// Generate peer IDs
function generatePeerId() {
  return Array.from({length: 40}, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

const peer1Id = generatePeerId();
const peer2Id = generatePeerId();

console.log(`🆔 Peer1 ID: ${peer1Id.substring(0, 8)}... (connecting to Heroku)`);
console.log(`🆔 Peer2 ID: ${peer2Id.substring(0, 8)}... (connecting to Fly.io)`);

let peer1Ws, peer2Ws;
let peer1Messages = [];
let peer2Messages = [];
let crossNodeDiscoveryWorking = false;

// Test timeout
const testTimeout = setTimeout(() => {
  console.log('\n⏰ Test finished');
  
  console.log('\n📋 Peer1 (Heroku) Messages:');
  peer1Messages.forEach(msg => console.log(`  ${msg}`));
  
  console.log('\n📋 Peer2 (Fly.io) Messages:');
  peer2Messages.forEach(msg => console.log(`  ${msg}`));
  
  console.log('\n📊 Analysis:');
  
  const peer1PeerDiscovered = peer1Messages.some(msg => msg.includes('peer-discovered') || msg.includes('peer-announced'));
  const peer2PeerDiscovered = peer2Messages.some(msg => msg.includes('peer-discovered') || msg.includes('peer-announced'));
  
  console.log(`   - Peer1 saw peer discovery: ${peer1PeerDiscovered ? '✅' : '❌'}`);
  console.log(`   - Peer2 saw peer discovery: ${peer2PeerDiscovered ? '✅' : '❌'}`);
  console.log(`   - Cross-node routing: ${crossNodeDiscoveryWorking ? '✅' : '❌'}`);
  
  if (peer1PeerDiscovered && peer2PeerDiscovered) {
    console.log('\n🎉 SUCCESS: Cross-node peer discovery is working!');
    console.log('   Peers on different nodes can discover each other.');
  } else {
    console.log('\n❌ FAILED: Cross-node peer discovery not working');
    console.log('   The PeerPigeon mesh connection may not be properly routing announcements.');
  }
  
  process.exit(0);
}, 20000); // 20 second timeout

// Connect Peer1 to Heroku
console.log('🔌 Connecting Peer1 to Heroku...');
peer1Ws = new WebSocket(`wss://pigeonhub-server-3c044110c06f.herokuapp.com?peerId=${peer1Id}`);

peer1Ws.on('open', () => {
  peer1Messages.push('✅ Connected to Heroku');
  console.log('✅ Peer1 connected to Heroku');
  
  // Announce after connection
  setTimeout(() => {
    peer1Ws.send(JSON.stringify({
      type: 'announce',
      data: { name: 'TestPeer1-Heroku', location: 'Heroku' }
    }));
    peer1Messages.push('📢 Announced on Heroku');
    console.log('📢 Peer1 announced on Heroku');
  }, 1000);
});

peer1Ws.on('message', (data) => {
  try {
    const message = JSON.parse(data);
    const logMsg = `📥 ${message.type}${message.fromPeerId ? ` from ${message.fromPeerId.substring(0, 8)}...` : ''}`;
    peer1Messages.push(logMsg);
    
    if (message.type === 'peer-discovered' || message.type === 'peer-announced') {
      console.log(`🎯 Peer1: ${logMsg}`);
      if (message.data?.peerId === peer2Id || message.peerId === peer2Id) {
        crossNodeDiscoveryWorking = true;
        console.log('🎉 Peer1 discovered Peer2 from Fly.io!');
      }
    }
  } catch (error) {
    peer1Messages.push(`❌ Parse error: ${error.message}`);
  }
});

peer1Ws.on('error', (error) => {
  peer1Messages.push(`❌ WebSocket error: ${error.message}`);
  console.log(`❌ Peer1 error: ${error.message}`);
});

// Connect Peer2 to Fly.io after a delay
setTimeout(() => {
  console.log('🔌 Connecting Peer2 to Fly.io...');
  peer2Ws = new WebSocket(`wss://pigeonhub.fly.dev?peerId=${peer2Id}`);

  peer2Ws.on('open', () => {
    peer2Messages.push('✅ Connected to Fly.io');
    console.log('✅ Peer2 connected to Fly.io');
    
    // Announce after connection
    setTimeout(() => {
      peer2Ws.send(JSON.stringify({
        type: 'announce',
        data: { name: 'TestPeer2-Fly', location: 'Fly.io' }
      }));
      peer2Messages.push('📢 Announced on Fly.io');
      console.log('📢 Peer2 announced on Fly.io');
    }, 1000);
  });

  peer2Ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      const logMsg = `📥 ${message.type}${message.fromPeerId ? ` from ${message.fromPeerId.substring(0, 8)}...` : ''}`;
      peer2Messages.push(logMsg);
      
      if (message.type === 'peer-discovered' || message.type === 'peer-announced') {
        console.log(`🎯 Peer2: ${logMsg}`);
        if (message.data?.peerId === peer1Id || message.peerId === peer1Id) {
          crossNodeDiscoveryWorking = true;
          console.log('🎉 Peer2 discovered Peer1 from Heroku!');
        }
      }
    } catch (error) {
      peer2Messages.push(`❌ Parse error: ${error.message}`);
    }
  });

  peer2Ws.on('error', (error) => {
    peer2Messages.push(`❌ WebSocket error: ${error.message}`);
    console.log(`❌ Peer2 error: ${error.message}`);
  });
}, 3000); // Connect Peer2 3 seconds after Peer1

console.log('\n⏱️  Test will run for 20 seconds...');
console.log('🔍 Watching for cross-node peer discovery messages...');
