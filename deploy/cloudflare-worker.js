// Cloudflare Worker deployment for PigeonHub
import { PeerPigeonMesh } from 'peerpigeon';

// Global mesh instance (persists across requests)
let mesh = null;
let initPromise = null;

// Configuration - replace with your values
const CONFIG = {
  appId: 'pigeonhub-mesh',
  maxPeers: 50,
  region: 'us-east', // or 'eu-west', 'asia-pacific', etc.
  seedTTL: 86400, // 24 hours
};

// Bootstrap peer configuration for production  
const BOOTSTRAP_PEERS = [
  { t: 'wss', u: 'wss://pigeonhub.herokuapp.com' },
  { t: 'wss', u: 'wss://pigeonhub.railway.app' },  
  { t: 'wss', u: 'wss://pigeonhub.fly.dev' }
];

// Your signed seed bundle - generate with the CLI
const SEED_BUNDLE = {
  "v": 1,
  "app": CONFIG.appId,
  "ts": Date.now(),
  "expires": CONFIG.seedTTL,
  "region": CONFIG.region,
  "seeds": [
    { "t": "wss", "u": "wss://your-worker.your-subdomain.workers.dev/ws" },
    ...BOOTSTRAP_PEERS, // Include bootstrap peers in seed bundle
    { "t": "ws", "u": "wss://backup.herokuapp.com/ws" },
    { "t": "ws", "u": "wss://fallback.railway.app/ws" }
  ],
  "pk": "BASE64_ED25519_PUBLIC_KEY", // Replace with your public key
  "sig": "BASE64_SIGNATURE" // Replace with signature
};

async function initMesh() {
  if (mesh) return mesh;
  if (initPromise) return initPromise;
  
  initPromise = (async () => {
    mesh = new PeerPigeonMesh({
      enableWebDHT: true,
      maxPeers: CONFIG.maxPeers,
      region: CONFIG.region
    });
    await mesh.init();
    console.log(`DHT node initialized in region: ${CONFIG.region}`);
    return mesh;
  })();
  
  return initPromise;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        }
      });
    }
    
    // Initialize mesh if needed
    await initMesh();
    
    // Handle WebSocket upgrade for DHT connections
    if (request.headers.get('Upgrade') === 'websocket') {
      const [client, server] = Object.values(new WebSocketPair());
      
      try {
        // Connect WebSocket to mesh
        mesh.handleWebSocket(server);
        
        return new Response(null, {
          status: 101,
          webSocket: client,
        });
      } catch (error) {
        console.error('WebSocket connection failed:', error);
        return new Response('WebSocket connection failed', { status: 500 });
      }
    }
    
    // Serve seed bundle at /.well-known/peerpigeon.json
    if (url.pathname === '/.well-known/peerpigeon.json') {
      return new Response(JSON.stringify(SEED_BUNDLE), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=300', // 5 minute cache
          'X-Region': CONFIG.region,
          'X-Node-Type': 'cloudflare-worker'
        }
      });
    }
    
    // Health check endpoint
    if (url.pathname === '/health') {
      const stats = {
        status: 'healthy',
        region: CONFIG.region,
        platform: 'cloudflare-workers',
        uptime: Date.now() - mesh?.startTime || 0,
        peers: mesh?.getPeerCount() || 0,
        timestamp: new Date().toISOString()
      };
      
      return new Response(JSON.stringify(stats), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    
    // CORS proxy for fetching other seed bundles
    if (url.pathname.startsWith('/proxy/')) {
      const targetUrl = decodeURIComponent(url.pathname.slice(7));
      
      try {
        const response = await fetch(targetUrl, {
          headers: {
            'User-Agent': 'PigeonHub-Proxy/1.0'
          }
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.text();
        
        return new Response(data, {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=60',
            'X-Proxied-From': targetUrl
          }
        });
      } catch (error) {
        return new Response(JSON.stringify({
          error: 'Proxy request failed',
          target: targetUrl,
          message: error.message
        }), {
          status: 502,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
    }
    
    // Default response
    return new Response(`
      <html>
        <head><title>PigeonHub Node</title></head>
        <body>
          <h1>PigeonHub Signaling Node</h1>
          <p>Region: ${CONFIG.region}</p>
          <p>Platform: Cloudflare Workers</p>
          <p>Endpoints:</p>
          <ul>
            <li><a href="/.well-known/peerpigeon.json">Seed Bundle</a></li>
            <li><a href="/health">Health Check</a></li>
            <li><code>/ws</code> - WebSocket DHT connection</li>
            <li><code>/proxy/[url]</code> - CORS proxy</li>
          </ul>
        </body>
      </html>
    `, {
      headers: {
        'Content-Type': 'text/html',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
};
