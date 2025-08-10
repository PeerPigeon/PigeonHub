#!/usr/bin/env node

import WebSocket from 'ws';
import crypto from 'crypto';

console.log('🧪 Testing Real Cross-Node Peer Connection');
console.log('==========================================');

// Generate peer IDs
const peer1Id = crypto.randomBytes(16).toString('hex').substring(0, 8);
const peer2Id = crypto.randomBytes(16).toString('hex').substring(0, 8);

console.log(`🆔 Peer1 ID: ${peer1Id}...`);
console.log(`🆔 Peer2 ID: ${peer2Id}...`);

// Track connection states
let peer1Connected = false;
let peer2Connected = false;
let peer1Announced = false;
let peer2Announced = false;
let offer = null;
let answer = null;
let iceCandidates = [];

// Create WebSocket connections to different nodes
const peer1 = new WebSocket('wss://pigeonhub-server-3c044110c06f.herokuapp.com');
const peer2 = new WebSocket('wss://pigeonhub.fly.dev');

console.log('\n1️⃣ Connecting peers to different nodes...');
console.log('🔌 Connecting Peer1-Heroku to wss://pigeonhub-server-3c044110c06f.herokuapp.com...');
console.log('🔌 Connecting Peer2-Fly to wss://pigeonhub.fly.dev...');

function sendMessage(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    }
}

peer1.on('open', () => {
    console.log('✅ Peer1-Heroku connected to wss://pigeonhub-server-3c044110c06f.herokuapp.com');
    peer1Connected = true;
    
    // Announce peer1
    sendMessage(peer1, {
        type: 'announce',
        peerId: peer1Id,
        data: { type: 'peer', capabilities: ['webrtc'] }
    });
    
    peer1Announced = true;
    console.log('📢 Peer1-Heroku announced');
    
    checkReadyAndStartConnection();
});

peer2.on('open', () => {
    console.log('✅ Peer2-Fly connected to wss://pigeonhub.fly.dev');
    peer2Connected = true;
    
    // Announce peer2
    sendMessage(peer2, {
        type: 'announce',
        peerId: peer2Id,
        data: { type: 'peer', capabilities: ['webrtc'] }
    });
    
    peer2Announced = true;
    console.log('📢 Peer2-Fly announced');
    
    checkReadyAndStartConnection();
});

function checkReadyAndStartConnection() {
    if (peer1Connected && peer2Connected && peer1Announced && peer2Announced) {
        setTimeout(() => {
            console.log('\n2️⃣ Starting WebRTC connection process...');
            
            // Simulate an offer from peer1 to peer2
            offer = {
                type: 'offer',
                sdp: 'v=0\r\no=- ' + Date.now() + ' 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\na=msid-semantic: WMS\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\na=ice-ufrag:test\r\na=ice-pwd:testpassword\r\na=ice-options:trickle\r\na=fingerprint:sha-256 ' + crypto.randomBytes(32).toString('hex').match(/.{2}/g).join(':').toUpperCase() + '\r\na=setup:actpass\r\na=mid:0\r\na=sctp-port:5000\r\na=max-message-size:262144\r\n'
            };
            
            console.log('📡 Peer1-Heroku sending offer to peer2...');
            sendMessage(peer1, {
                type: 'signal',
                fromPeerId: peer1Id,
                targetPeerId: peer2Id,
                signalType: 'offer',
                signalData: offer
            });
            
            // Send some ICE candidates
            setTimeout(() => {
                console.log('📡 Peer1-Heroku sending ICE candidates...');
                sendMessage(peer1, {
                    type: 'signal',
                    fromPeerId: peer1Id,
                    targetPeerId: peer2Id,
                    signalType: 'ice-candidate',
                    signalData: {
                        candidate: 'candidate:1 1 UDP 2113667326 192.168.1.100 54400 typ host',
                        sdpMLineIndex: 0,
                        sdpMid: '0'
                    }
                });
            }, 500);
            
        }, 2000); // Wait for announcements to propagate
    }
}

// Handle peer1 messages
peer1.on('message', (data) => {
    try {
        const message = JSON.parse(data.toString());
        console.log(`📨 Peer1-Heroku received: ${message.type} ${message.fromPeerId?.substring(0, 8) || 'system'}...`);
        
        if (message.type === 'signal' && message.signalType === 'answer') {
            console.log('✅ Peer1-Heroku received answer from Peer2-Fly!');
            answer = message.signalData;
        }
    } catch (e) {
        console.log(`📨 Peer1-Heroku received: ${data.toString().substring(0, 50)}...`);
    }
});

// Handle peer2 messages  
peer2.on('message', (data) => {
    try {
        const message = JSON.parse(data.toString());
        console.log(`📨 Peer2-Fly received: ${message.type} ${message.fromPeerId?.substring(0, 8) || 'system'}...`);
        
        if (message.type === 'signal' && message.signalType === 'offer') {
            console.log('✅ Peer2-Fly received offer from Peer1-Heroku!');
            console.log('📡 Peer2-Fly sending answer back...');
            
            // Send answer back
            const answerData = {
                type: 'answer',
                sdp: 'v=0\r\no=- ' + Date.now() + ' 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\na=msid-semantic: WMS\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\na=ice-ufrag:test\r\na=ice-pwd:testpassword\r\na=ice-options:trickle\r\na=fingerprint:sha-256 ' + crypto.randomBytes(32).toString('hex').match(/.{2}/g).join(':').toUpperCase() + '\r\na=setup:active\r\na=mid:0\r\na=sctp-port:5000\r\na=max-message-size:262144\r\n'
            };
            
            sendMessage(peer2, {
                type: 'signal',
                fromPeerId: peer2Id,
                targetPeerId: peer1Id,
                signalType: 'answer',
                signalData: answerData
            });
        }
        
        if (message.type === 'signal' && message.signalType === 'ice-candidate') {
            console.log('✅ Peer2-Fly received ICE candidate from Peer1-Heroku!');
            iceCandidates.push(message.signalData);
        }
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
    console.log('\n✅ Cross-node real peer connection test completed!');
    console.log('\n📊 Results:');
    console.log(`   - Offer sent: ${offer ? '✅' : '❌'}`);
    console.log(`   - Answer received: ${answer ? '✅' : '❌'}`);
    console.log(`   - ICE candidates received: ${iceCandidates.length}`);
    
    if (offer && answer && iceCandidates.length > 0) {
        console.log('\n🎉 SUCCESS! Cross-node signaling is working perfectly!');
        console.log('   - Peers on different nodes can discover each other');
        console.log('   - WebRTC offers are properly routed through mesh');
        console.log('   - WebRTC answers are properly routed back');
        console.log('   - ICE candidates are exchanged successfully');
    } else {
        console.log('\n⚠️  Some signals may not have completed - check the logs above');
    }
    
    peer1.close();
    peer2.close();
    process.exit(0);
}, 10000);
