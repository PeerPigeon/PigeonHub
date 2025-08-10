import WebSocket from 'ws';

const HEROKU_URL = 'wss://pigeonhub-server-3c044110c06f.herokuapp.com';
const FLY_URL = 'wss://pigeonhub.fly.dev';

// Test cross-node offer/answer flow
async function testCrossNodeAnswers() {
  console.log('🧪 Testing cross-node offer/answer flow...');
  
  // Connect two peers to different nodes
  const peer1Id = 'a123456789012345678901234567890123456789'; // 40 chars
  const peer2Id = 'b123456789012345678901234567890123456789'; // 40 chars
  
  console.log(`👤 Peer 1 (${peer1Id.substring(0, 8)}...) connecting to Heroku...`);
  const peer1 = new WebSocket(`${HEROKU_URL}/?peerId=${peer1Id}`);
  
  console.log(`👤 Peer 2 (${peer2Id.substring(0, 8)}...) connecting to Fly.io...`);
  const peer2 = new WebSocket(`${FLY_URL}/?peerId=${peer2Id}`);
  
  let peer1Ready = false;
  let peer2Ready = false;
  
  peer1.on('open', () => {
    console.log('✅ Peer 1 connected to Heroku');
    peer1Ready = true;
    checkReady();
  });
  
  peer2.on('open', () => {
    console.log('✅ Peer 2 connected to Fly.io');
    peer2Ready = true;
    checkReady();
  });
  
  peer1.on('message', (data) => {
    const message = JSON.parse(data.toString());
    console.log('📥 Peer 1 received:', message.type, message.fromPeerId?.substring(0, 8));
  });
  
  peer2.on('message', (data) => {
    const message = JSON.parse(data.toString());
    console.log('📥 Peer 2 received:', message.type, message.fromPeerId?.substring(0, 8));
    
    // If Peer 2 gets an offer, send back an answer
    if (message.type === 'offer' && message.fromPeerId === peer1Id) {
      console.log('📤 Peer 2 sending answer back to Peer 1...');
      peer2.send(JSON.stringify({
        type: 'answer',
        targetPeerId: peer1Id,
        data: {
          type: 'answer',
          sdp: 'test-answer-sdp'
        }
      }));
    }
  });
  
  function checkReady() {
    if (peer1Ready && peer2Ready) {
      console.log('🚀 Both peers ready, waiting 2 seconds for announcements...');
      setTimeout(() => {
        console.log('📤 Peer 1 sending offer to Peer 2...');
        peer1.send(JSON.stringify({
          type: 'offer',
          targetPeerId: peer2Id,
          data: {
            type: 'offer',
            sdp: 'test-offer-sdp'
          }
        }));
        
        // Wait for answer
        setTimeout(() => {
          console.log('⏰ Test complete, disconnecting...');
          peer1.close();
          peer2.close();
        }, 5000);
      }, 2000);
    }
  }
}

testCrossNodeAnswers().catch(console.error);
