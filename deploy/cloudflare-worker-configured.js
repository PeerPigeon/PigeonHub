// Cloudflare Worker deployment for PigeonHub
// This provides HTTP-only signaling endpoints (no WebSocket server)

// Configuration - will be replaced by deploy script
const CONFIG = {
  appId: 'GLOBAL-PEERPIGEON-HUB',
  maxPeers: 50,
  region: 'us-east',
  seedTTL: 86400, // 24 hours
  publicKey: 'MCowBQYDK2VwAyEAdn9neC3tVRDmYgvHGOtP164K01xwrHEitu3HAWg403k=',
  signature: ''
};

// Bootstrap peer configuration for production  
const BOOTSTRAP_PEERS = [
  { t: 'wss', u: 'wss://peersignal-us-east-1754691772-584069971541.herokuapp.com' }, // Live Heroku
  { t: 'wss', u: 'wss://pigeonhub-production.up.railway.app' }, // Live Railway
  { t: 'wss', u: 'wss://pigeonhub.fly.dev' } // Community/fallback
];

// Generate seed bundle for HTTP endpoint
function generateSeedBundle(request) {
  const url = new URL(request.url);
  const workerUrl = `wss://${url.hostname}/ws`;
  
  return {
    "v": 1,
    "app": CONFIG.appId,
    "ts": Date.now(),
    "expires": CONFIG.seedTTL,
    "region": CONFIG.region,
    "seeds": [
      // Note: This worker doesn't provide WebSocket, so we point to other peers
      ...BOOTSTRAP_PEERS
    ],
    "pk": CONFIG.publicKey,
    "sig": CONFIG.signature
  };
}

// CORS headers for all responses
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    
    // Health check endpoint
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'healthy',
        region: CONFIG.region,
        platform: 'cloudflare-workers',
        uptime: Date.now(), // Workers don't have persistent uptime
        peers: 0, // HTTP-only, no peer tracking
        timestamp: new Date().toISOString(),
        version: '1.0.0'
      }), {
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
    
    // Seed bundle endpoint
    if (url.pathname === '/.well-known/peerpigeon.json') {
      const bundle = generateSeedBundle(request);
      return new Response(JSON.stringify(bundle), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=300',
          'X-Region': CONFIG.region,
          'X-Node-Type': 'cloudflare-worker',
          ...corsHeaders
        }
      });
    }
    
    // Root endpoint with documentation
    if (url.pathname === '/') {
      const html = `
        <html>
          <head><title>PigeonHub Cloudflare Worker</title></head>
          <body>
            <h1>PigeonHub Signaling Node</h1>
            <p>Region: ${CONFIG.region}</p>
            <p>Platform: Cloudflare Workers</p>
            <p>Type: HTTP-only signaling</p>
            <p>Endpoints:</p>
            <ul>
              <li><a href="/.well-known/peerpigeon.json">Seed Bundle</a></li>
              <li><a href="/health">Health Check</a></li>
            </ul>
            <p><strong>Note:</strong> This worker provides seed bundles but redirects WebSocket connections to other peers in the mesh.</p>
          </body>
        </html>
      `;
      
      return new Response(html, {
        headers: {
          'Content-Type': 'text/html',
          ...corsHeaders
        }
      });
    }
    
    // 404 for other paths
    return new Response('Not Found', { 
      status: 404,
      headers: corsHeaders
    });
  }
};
