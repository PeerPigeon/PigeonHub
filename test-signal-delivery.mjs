#!/usr/bin/env node

import WebSocket from 'ws';
import crypto from 'crypto';

console.log('🧪 Testing Cross-Node Signal Delivery (Validation Focus)');
console.log('========================================================');

const peer1Id = crypto.randomBytes(16).toString('hex').substring(0, 8);
const peer2Id = crypto.randomBytes(16).toString('hex').substring(0, 8);

console.log(`🆔 Peer1 ID: ${peer1Id}...`);
console.log(`🆔 Peer2 ID: ${peer2Id}...`);

let signalsReceived = 0;
let expectedSignals = ['offer', 'answer', 'ice-candidate'];
let receivedSignals = [];

const peer1 = new WebSocket(`wss://pigeonhub-server-3c044110c06f.herokuapp.com?peerId=${peer1Id}${crypto.randomBytes(20).toString('hex')}`);
const peer2 = new WebSocket(`wss://pigeonhub.fly.dev?peerId=${peer2Id}${crypto.randomBytes(20).toString('hex')}`);

peer1.on('open', () => {
    console.log('✅ Peer1-Heroku connected');
    
    // Announce peer1
    peer1.send(JSON.stringify({
        type: 'announce',
        peerId: peer1Id,
        data: { type: 'peer', capabilities: ['webrtc'] }
    }));
    
    console.log('📢 Peer1-Heroku announced');
    checkReady();
});

peer2.on('open', () => {
    console.log('✅ Peer2-Fly connected');
    
    // Announce peer2  
    peer2.send(JSON.stringify({
        type: 'announce',
        peerId: peer2Id,
        data: { type: 'peer', capabilities: ['webrtc'] }
    }));
    
    console.log('📢 Peer2-Fly announced');
    checkReady();
});

let ready = 0;
function checkReady() {
    ready++;
    if (ready === 2) {
        setTimeout(startTest, 1000);
    }
}

function startTest() {
    console.log('\n📡 Starting signal delivery test...\n');
    
    // Test 1: Send offer from peer1 to peer2
    setTimeout(() => {
        console.log('1️⃣ Sending offer from Peer1-Heroku to Peer2-Fly...');
        peer1.send(JSON.stringify({
            type: 'signal',
            fromPeerId: peer1Id,
            targetPeerId: peer2Id,
            signalType: 'offer',
            signalData: { type: 'offer', sdp: 'test-offer-sdp' }
        }));
    }, 500);
    
    // Test 2: Send answer from peer2 back to peer1
    setTimeout(() => {
        console.log('2️⃣ Sending answer from Peer2-Fly to Peer1-Heroku...');
        peer2.send(JSON.stringify({
            type: 'signal',
            fromPeerId: peer2Id,
            targetPeerId: peer1Id,
            signalType: 'answer',
            signalData: { type: 'answer', sdp: 'test-answer-sdp' }
        }));
    }, 1500);
    
    // Test 3: Send ICE candidate
    setTimeout(() => {
        console.log('3️⃣ Sending ICE candidate from Peer1-Heroku to Peer2-Fly...');
        peer1.send(JSON.stringify({
            type: 'signal',
            fromPeerId: peer1Id,
            targetPeerId: peer2Id,
            signalType: 'ice-candidate',
            signalData: { candidate: 'test-candidate', sdpMLineIndex: 0 }
        }));
    }, 2500);
}

peer1.on('message', (data) => {
    try {
        const message = JSON.parse(data.toString());
        
        if (message.type === 'signal') {
            signalsReceived++;
            receivedSignals.push(message.signalType);
            console.log(`✅ Peer1-Heroku received ${message.signalType} from ${message.fromPeerId?.substring(0, 8)}...`);
        } else {
            console.log(`📨 Peer1-Heroku: ${message.type}`);
        }
    } catch (e) {
        console.log(`📨 Peer1-Heroku: ${data.toString().substring(0, 50)}...`);
    }
});

peer2.on('message', (data) => {
    try {
        const message = JSON.parse(data.toString());
        
        if (message.type === 'signal') {
            signalsReceived++;
            receivedSignals.push(message.signalType);
            console.log(`✅ Peer2-Fly received ${message.signalType} from ${message.fromPeerId?.substring(0, 8)}...`);
        } else {
            console.log(`📨 Peer2-Fly: ${message.type}`);
        }
    } catch (e) {
        console.log(`📨 Peer2-Fly: ${data.toString().substring(0, 50)}...`);
    }
});

setTimeout(() => {
    console.log('\n🏁 Test completed!');
    console.log('===================');
    console.log(`📊 Signals received: ${signalsReceived}/3`);
    console.log(`📝 Signal types: ${receivedSignals.join(', ')}`);
    
    const allReceived = expectedSignals.every(signal => receivedSignals.includes(signal));
    
    if (allReceived) {
        console.log('\n🎉 SUCCESS! Cross-node mesh signaling is working perfectly!');
        console.log('   ✅ Offers route from Heroku → Fly.io');
        console.log('   ✅ Answers route from Fly.io → Heroku');  
        console.log('   ✅ ICE candidates route between nodes');
        console.log('   ✅ PeerPigeon mesh routing is fully operational');
    } else {
        console.log('\n⚠️  Some signals may be missing. Check server logs for details.');
    }
    
    peer1.close();
    peer2.close();
    process.exit(0);
}, 5000);
