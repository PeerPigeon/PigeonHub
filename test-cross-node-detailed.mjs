#!/usr/bin/env node

import { WebSocket } from 'ws';

console.log('🧪 Detailed Cross-Node Peer Connection Test');
console.log('===========================================');

// Generate peer IDs
function generatePeerId() {
  return Array.from({length: 40}, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

const peer1Id = generatePeerId();
const peer2Id = generatePeerId();

console.log(`🆔 Peer1 ID: ${peer1Id.substring(0, 8)}...`);
console.log(`🆔 Peer2 ID: ${peer2Id.substring(0, 8)}...`);

let peer1Ws, peer2Ws;
let peer1Connected = false, peer2Connected = false;
let peer1Announced = false, peer2Announced = false;
let peer1DiscoveredPeer2 = false, peer2DiscoveredPeer1 = false;
let offerSent = false, answerReceived = false;
let peer1IceCandidates = 0, peer2IceCandidates = 0;

// Track all events
const events = [];
function logEvent(event) {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  events.push(`[${timestamp}] ${event}`);
  console.log(`[${timestamp}] ${event}`);
}

// Test timeout
const testTimeout = setTimeout(() => {
  console.log('\n⏰ Test timeout reached');
  console.log('\n📋 Event Summary:');
  events.forEach(event => console.log(event));
  
  console.log('\n📊 Final Results:');
  console.log(`   - Peer1 connected to Heroku: ${peer1Connected ? '✅' : '❌'}`);
  console.log(`   - Peer2 connected to Fly: ${peer2Connected ? '✅' : '❌'}`);
  console.log(`   - Peer1 announced: ${peer1Announced ? '✅' : '❌'}`);
  console.log(`   - Peer2 announced: ${peer2Announced ? '✅' : '❌'}`);
  console.log(`   - Peer1 discovered Peer2: ${peer1DiscoveredPeer2 ? '✅' : '❌'}`);
  console.log(`   - Peer2 discovered Peer1: ${peer2DiscoveredPeer1 ? '✅' : '❌'}`);
  console.log(`   - WebRTC offer sent: ${offerSent ? '✅' : '❌'}`);
  console.log(`   - WebRTC answer received: ${answerReceived ? '✅' : '❌'}`);
  console.log(`   - ICE candidates exchanged: ${peer1IceCandidates + peer2IceCandidates}`);
  
  if (peer1DiscoveredPeer2 && peer2DiscoveredPeer1) {
    console.log('\n🎉 SUCCESS: Cross-node peer discovery working!');
  } else {
    console.log('\n❌ FAILED: Cross-node peer discovery not working');
  }
  
  process.exit(0);
}, 30000); // 30 second timeout

// Connect Peer1 to Heroku
logEvent('🔌 Connecting Peer1 to Heroku...');
peer1Ws = new WebSocket(`wss://pigeonhub-server-3c044110c06f.herokuapp.com?peerId=${peer1Id}`);

peer1Ws.on('open', () => {
  peer1Connected = true;
  logEvent('✅ Peer1 connected to Heroku');
  
  // Announce Peer1
  setTimeout(() => {
    peer1Ws.send(JSON.stringify({
      type: 'announce',
      data: { name: 'Test-Peer1-Heroku' }
    }));
    peer1Announced = true;
    logEvent('📢 Peer1 announced on Heroku');
  }, 1000);
});

peer1Ws.on('message', (data) => {
  try {
    const message = JSON.parse(data);
    logEvent(`📥 Peer1 received: ${message.type}`);
    
    if (message.type === 'peer-discovered' && message.data?.peerId === peer2Id) {
      peer1DiscoveredPeer2 = true;
      logEvent('🎯 Peer1 discovered Peer2 via cross-node routing!');
      
      // Send WebRTC offer after discovery
      setTimeout(() => {
        const offer = {
          type: 'offer',
          data: { 
            sdp: 'v=0\r\no=- 123456789 1 IN IP4 127.0.0.1\r\n...',
            type: 'offer'
          },
          targetPeerId: peer2Id
        };
        peer1Ws.send(JSON.stringify(offer));
        offerSent = true;
        logEvent('📡 Peer1 sent WebRTC offer to Peer2');
      }, 2000);
    }
    
    if (message.type === 'answer' && message.fromPeerId === peer2Id) {
      answerReceived = true;
      logEvent('✅ Peer1 received WebRTC answer from Peer2!');
    }
    
    if (message.type === 'ice-candidate' && message.fromPeerId === peer2Id) {
      peer1IceCandidates++;
      logEvent(`❄️  Peer1 received ICE candidate from Peer2 (${peer1IceCandidates} total)`);
    }
    
    if (message.type === 'peer-announced') {
      logEvent(`📡 Peer1 notified of remote peer: ${message.peerId?.substring(0, 8)}... from ${message.sourceNode}`);
    }
  } catch (error) {
    logEvent(`❌ Peer1 message parse error: ${error.message}`);
  }
});

peer1Ws.on('error', (error) => {
  logEvent(`❌ Peer1 WebSocket error: ${error.message}`);
});

peer1Ws.on('close', () => {
  logEvent('🔌 Peer1 connection closed');
});

// Connect Peer2 to Fly.io after a delay
setTimeout(() => {
  logEvent('🔌 Connecting Peer2 to Fly.io...');
  peer2Ws = new WebSocket(`wss://pigeonhub.fly.dev?peerId=${peer2Id}`);

  peer2Ws.on('open', () => {
    peer2Connected = true;
    logEvent('✅ Peer2 connected to Fly.io');
    
    // Announce Peer2
    setTimeout(() => {
      peer2Ws.send(JSON.stringify({
        type: 'announce',
        data: { name: 'Test-Peer2-Fly' }
      }));
      peer2Announced = true;
      logEvent('📢 Peer2 announced on Fly.io');
    }, 1000);
  });

  peer2Ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      logEvent(`📥 Peer2 received: ${message.type}`);
      
      if (message.type === 'peer-discovered' && message.data?.peerId === peer1Id) {
        peer2DiscoveredPeer1 = true;
        logEvent('🎯 Peer2 discovered Peer1 via cross-node routing!');
      }
      
      if (message.type === 'offer' && message.fromPeerId === peer1Id) {
        logEvent('📡 Peer2 received WebRTC offer from Peer1!');
        
        // Send answer back
        setTimeout(() => {
          const answer = {
            type: 'answer',
            data: { 
              sdp: 'v=0\r\no=- 987654321 1 IN IP4 127.0.0.1\r\n...',
              type: 'answer'
            },
            targetPeerId: peer1Id
          };
          peer2Ws.send(JSON.stringify(answer));
          logEvent('📡 Peer2 sent WebRTC answer to Peer1');
          
          // Send ICE candidates
          setTimeout(() => {
            for (let i = 0; i < 3; i++) {
              const iceCandidate = {
                type: 'ice-candidate',
                data: { 
                  candidate: `candidate:${i} 1 UDP 2113667326 192.168.1.${100 + i} 54400 typ host`,
                  sdpMid: '0',
                  sdpMLineIndex: 0
                },
                targetPeerId: peer1Id
              };
              peer2Ws.send(JSON.stringify(iceCandidate));
              peer2IceCandidates++;
              logEvent(`❄️  Peer2 sent ICE candidate ${i + 1} to Peer1`);
            }
          }, 1000);
        }, 1000);
      }
      
      if (message.type === 'peer-announced') {
        logEvent(`📡 Peer2 notified of remote peer: ${message.peerId?.substring(0, 8)}... from ${message.sourceNode}`);
      }
    } catch (error) {
      logEvent(`❌ Peer2 message parse error: ${error.message}`);
    }
  });

  peer2Ws.on('error', (error) => {
    logEvent(`❌ Peer2 WebSocket error: ${error.message}`);
  });

  peer2Ws.on('close', () => {
    logEvent('🔌 Peer2 connection closed');
  });
}, 3000); // Connect Peer2 3 seconds after Peer1

// Check results after 25 seconds
setTimeout(() => {
  console.log('\n📊 Checking results...');
  
  if (peer1DiscoveredPeer2 && peer2DiscoveredPeer1 && offerSent && answerReceived) {
    console.log('🎉 SUCCESS: Full cross-node WebRTC signaling working!');
    clearTimeout(testTimeout);
    process.exit(0);
  } else {
    console.log('⚠️  Partial success - some signaling may still be in progress...');
  }
}, 25000);
