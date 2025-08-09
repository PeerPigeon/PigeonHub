// Heroku Node.js server for PigeonHub
import { PeerPigeonServer } from 'peerpigeon';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

const app = express();
const server = createServer(app);

// Configuration from environment variables
const CONFIG = {
  port: process.env.PORT || 3000,
  appId: process.env.APP_ID || 'pigeonhub-mesh',
  region: process.env.REGION || 'us-east',
  maxPeers: parseInt(process.env.MAX_PEERS) || 100,
  seedPublicKey: process.env.SEED_PUBLIC_KEY,
  seedSignature: process.env.SEED_SIGNATURE
};

// Bootstrap peer configuration for production
const BOOTSTRAP_PEERS = process.env.BOOTSTRAP_PEERS ? 
  process.env.BOOTSTRAP_PEERS.split(',').map(peer => {
    const [protocol, url] = peer.split('://');
    return { t: protocol, u: peer };
  }) : [];

// Production bootstrap peers (other PigeonHub instances)  
const DEFAULT_BOOTSTRAP_PEERS = [
  { t: 'wss', u: 'wss://pigeonhub-production.up.railway.app' }, // Live Railway
  { t: 'wss', u: 'wss://pigeonhub.vercel.app' }, // Community/fallback
  { t: 'wss', u: 'wss://pigeonhub.fly.dev' } // Community/fallback
];

const nodeId = process.env.DYNO || process.env.NODE_ID || `heroku-${Math.random().toString(36).substring(7)}`;

console.log(`🚀 Starting PigeonHub Heroku node: ${nodeId} on port ${CONFIG.port}`);
console.log(`📡 Bootstrap peers configured: ${BOOTSTRAP_PEERS.length + DEFAULT_BOOTSTRAP_PEERS.length} total`);

// Middleware
app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Initialize PeerPigeon server
const peerServer = new PeerPigeonServer({
  server: server,
  enableWebDHT: true,
  maxPeers: CONFIG.maxPeers,
  region: CONFIG.region
});

// Track startup time for uptime calculation
const startTime = Date.now();

// Generate seed bundle
function generateSeedBundle(req) {
  const protocol = req.get('x-forwarded-proto') || 'https';
  const host = req.get('host');
  const wsUrl = `wss://${host}/ws`;
  
  return {
    "v": 1,
    "app": CONFIG.appId,
    "ts": Date.now(),
    "expires": 86400, // 24 hours
    "region": CONFIG.region,
    "seeds": [
      { "t": "ws", "u": wsUrl },
      // Add backup nodes from environment
      ...(process.env.BACKUP_NODES ? JSON.parse(process.env.BACKUP_NODES) : [])
    ],
    "pk": CONFIG.seedPublicKey,
    "sig": CONFIG.seedSignature
  };
}

// Seed bundle endpoint
app.get('/.well-known/peerpigeon.json', (req, res) => {
  const bundle = generateSeedBundle(req);
  res.set({
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=300',
    'X-Region': CONFIG.region,
    'X-Node-Type': 'heroku-dyno'
  });
  res.json(bundle);
});

// Health check endpoint
app.get('/health', (req, res) => {
  const stats = {
    status: 'healthy',
    region: CONFIG.region,
    platform: 'heroku',
    uptime: Date.now() - startTime,
    peers: peerServer.getPeerCount ? peerServer.getPeerCount() : 0,
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0'
  };
  
  res.json(stats);
});

// Metrics endpoint for monitoring
app.get('/metrics', (req, res) => {
  const metrics = {
    nodejs_version: process.version,
    uptime_seconds: process.uptime(),
    memory_usage_bytes: process.memoryUsage(),
    peer_count: peerServer.getPeerCount ? peerServer.getPeerCount() : 0,
    cpu_usage: process.cpuUsage()
  };
  
  res.json(metrics);
});

// CORS proxy endpoint
app.get('/proxy/*', async (req, res) => {
  const targetUrl = req.path.slice(7); // Remove '/proxy/'
  
  try {
    const response = await fetch(decodeURIComponent(targetUrl), {
      headers: {
        'User-Agent': 'PigeonHub-Heroku/1.0'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.text();
    
    res.set({
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60',
      'X-Proxied-From': targetUrl
    });
    res.send(data);
  } catch (error) {
    res.status(502).json({
      error: 'Proxy request failed',
      target: targetUrl,
      message: error.message
    });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head><title>PigeonHub Node</title></head>
      <body>
        <h1>PigeonHub Signaling Node</h1>
        <p>Region: ${CONFIG.region}</p>
        <p>Platform: Heroku</p>
        <p>Uptime: ${Math.floor((Date.now() - startTime) / 1000)} seconds</p>
        <p>Endpoints:</p>
        <ul>
          <li><a href="/.well-known/peerpigeon.json">Seed Bundle</a></li>
          <li><a href="/health">Health Check</a></li>
          <li><a href="/metrics">Metrics</a></li>
          <li><code>/ws</code> - WebSocket DHT connection</li>
          <li><code>/proxy/[url]</code> - CORS proxy</li>
        </ul>
      </body>
    </html>
  `);
});

// Error handling
app.use((error, req, res, next) => {
  console.error('Express error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: error.message
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(async () => {
    if (peerServer.stop) {
      await peerServer.stop();
    }
    process.exit(0);
  });
});

// Start server
server.listen(CONFIG.port, async () => {
  console.log(`🚀 PigeonHub node running on port ${CONFIG.port}`);
  console.log(`📍 Region: ${CONFIG.region}`);
  console.log(`🔧 Max peers: ${CONFIG.maxPeers}`);
  
  try {
    await peerServer.start();
    console.log('✅ PeerPigeon server started');
  } catch (error) {
    console.error('❌ Failed to start PeerPigeon server:', error);
    process.exit(1);
  }
});

export default app;
