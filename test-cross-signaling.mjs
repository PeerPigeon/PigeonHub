#!/usr/bin/env node

// Test cross-node signaling between Heroku and Fly.io
import WebSocket from 'ws';

console.log('🧪 Testing cross-node WebRTC signaling...');

const HEROKU_URL = 'wss://pigeonhub-server-3c044110c06f.herokuapp.com';
const FLY_URL = 'wss://pigeonhub.fly.dev';

// Generate valid 40-character hex peer IDs
function generateValidPeerId(prefix) {
    const randomHex = Math.random().toString(16).substr(2, 8) + 
                     Math.random().toString(16).substr(2, 8) + 
                     Math.random().toString(16).substr(2, 8) + 
                     Math.random().toString(16).substr(2, 8) + 
                     Math.random().toString(16).substr(2, 8);
    return randomHex.padEnd(40, '0').substring(0, 40);
}

const peer1Id = generateValidPeerId('heroku');
const peer2Id = generateValidPeerId('fly');

console.log(`👤 Peer 1 (Heroku): ${peer1Id}`);
console.log(`👤 Peer 2 (Fly.io): ${peer2Id}`);

let peer1Ready = false;
let peer2Ready = false;
let testStarted = false;

// Connect to Heroku as peer1
const ws1 = new WebSocket(`${HEROKU_URL}?peerId=${peer1Id}`);
ws1.on('open', () => {
    console.log('✅ Peer 1 connected to Heroku');
    peer1Ready = true;
    startTestIfReady();
});

ws1.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    console.log(`📨 Peer 1 received:`, msg);
    
    // Handle keepalive messages
    if (msg.type === 'keepalive') {
        ws1.send(JSON.stringify({
            type: 'keepalive-ack',
            timestamp: Date.now()
        }));
        return;
    }
    
    if (msg.type === 'offer' && msg.fromPeerId === peer2Id) {
        console.log('🎯 SUCCESS: Cross-node WebRTC offer received by Peer 1!');
        console.log('   Offer from Fly.io peer reached Heroku peer');
        
        // Send answer back
        ws1.send(JSON.stringify({
            type: 'answer',
            targetPeerId: peer2Id,
            data: { 
                type: 'answer', 
                sdp: 'v=0\r\no=- 789012 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n' // Minimal fake SDP for testing
            }
        }));
        console.log('📤 Peer 1 sent answer back');
    }
});

// Connect to Fly.io as peer2
const ws2 = new WebSocket(`${FLY_URL}?peerId=${peer2Id}`);
ws2.on('open', () => {
    console.log('✅ Peer 2 connected to Fly.io');
    peer2Ready = true;
    startTestIfReady();
});

ws2.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    console.log(`📨 Peer 2 received:`, msg);
    
    // Handle keepalive messages
    if (msg.type === 'keepalive') {
        ws2.send(JSON.stringify({
            type: 'keepalive-ack',
            timestamp: Date.now()
        }));
        return;
    }
    
    if (msg.type === 'answer' && msg.fromPeerId === peer1Id) {
        console.log('🎯 SUCCESS: Cross-node WebRTC answer received by Peer 2!');
        console.log('   Answer from Heroku peer reached Fly.io peer');
        console.log('✨ CROSS-NODE WEBRTC SIGNALING WORKING!');
        process.exit(0);
    }
});

function startTestIfReady() {
    if (peer1Ready && peer2Ready && !testStarted) {
        testStarted = true;
        console.log('\n🚀 Starting cross-node signaling test...');
        
        // Wait a moment for mesh announcements to propagate
        setTimeout(() => {
            console.log('📤 Peer 2 sending WebRTC offer to Peer 1...');
            ws2.send(JSON.stringify({
                type: 'offer',
                targetPeerId: peer1Id,
                data: { 
                    type: 'offer', 
                    sdp: 'v=0\r\no=- 123456 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n' // Minimal fake SDP for testing
                }
            }));
        }, 2000);
    }
}

// Timeout after 15 seconds
setTimeout(() => {
    console.log('⏰ Test timeout - checking what we got...');
    if (peer1Ready && peer2Ready) {
        console.log('✅ Both peers connected successfully');
        console.log('❓ May need to check mesh announcement propagation');
    } else {
        console.log('❌ Connection issues');
    }
    process.exit(1);
}, 15000);
