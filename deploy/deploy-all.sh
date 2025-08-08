#!/bin/bash

# PigeonHub Multi-Platform Deployment Script
# This script deploys signaling nodes across multiple cloud platforms

set -e

echo "🚀 PigeonHub Multi-Platform Deployment"
echo "====================================="

# Configuration
APP_ID=${APP_ID:-"your-app-id"}
REGION=${REGION:-"us-east"}
MAX_PEERS=${MAX_PEERS:-100}

# Check required tools
check_tool() {
    if ! command -v $1 &> /dev/null; then
        echo "❌ $1 is required but not installed."
        echo "   Install from: $2"
        exit 1
    else
        echo "✅ $1 is available"
    fi
}

echo "📋 Checking deployment tools..."
check_tool "node" "https://nodejs.org/"
check_tool "npm" "https://nodejs.org/"

# Optional tools (will warn but not fail)
warn_tool() {
    if ! command -v $1 &> /dev/null; then
        echo "⚠️  $1 not available - $2 deployment will be skipped"
        return 1
    else
        echo "✅ $1 is available"
        return 0
    fi
}

echo ""
echo "🔧 Checking optional deployment tools..."
CLOUDFLARE_AVAILABLE=$(warn_tool "wrangler" "Cloudflare Workers" && echo "1" || echo "0")
HEROKU_AVAILABLE=$(warn_tool "heroku" "Heroku" && echo "1" || echo "0")
RAILWAY_AVAILABLE=$(warn_tool "railway" "Railway" && echo "1" || echo "0")
FLY_AVAILABLE=$(warn_tool "flyctl" "Fly.io" && echo "1" || echo "0")
VERCEL_AVAILABLE=$(warn_tool "vercel" "Vercel" && echo "1" || echo "0")

echo ""
echo "🔑 Setting up environment variables..."

# Generate Ed25519 keypair if not provided
if [ -z "$SEED_PRIVATE_KEY" ] || [ -z "$SEED_PUBLIC_KEY" ]; then
    echo "📝 Generating new Ed25519 keypair for seed signing..."
    node -e "
        import { generateSigningKeyPair, bytesToBase64 } from '../src/util/crypto.js';
        const { privateKey, publicKey } = await generateSigningKeyPair();
        const privateBytes = await window.crypto.subtle.exportKey('pkcs8', privateKey);
        const publicBytes = await window.crypto.subtle.exportKey('spki', publicKey);
        console.log('SEED_PRIVATE_KEY=' + bytesToBase64(new Uint8Array(privateBytes)));
        console.log('SEED_PUBLIC_KEY=' + bytesToBase64(new Uint8Array(publicBytes)));
    "
    echo "⚠️  Please save these keys securely and set them as environment variables"
fi

# Deploy to Cloudflare Workers
deploy_cloudflare() {
    echo ""
    echo "☁️  Deploying to Cloudflare Workers..."
    
    cd deploy
    
    # Update worker with current config
    sed -i.bak "s/your-app-id/$APP_ID/g" cloudflare-worker.js
    sed -i.bak "s/us-east/$REGION/g" cloudflare-worker.js
    
    # Deploy
    wrangler deploy --name "peersignal-$REGION-$(date +%s)"
    
    echo "✅ Cloudflare Workers deployment complete"
    cd ..
}

# Deploy to Heroku
deploy_heroku() {
    echo ""
    echo "🟣 Deploying to Heroku..."
    
    # Create temporary deployment directory
    TEMP_DIR=$(mktemp -d)
    cd $TEMP_DIR
    
    # Copy files
    cp ../deploy/heroku-server.js ./server.js
    cp ../deploy/heroku-package.json ./package.json
    cp ../deploy/Procfile ./Procfile
    
    # Initialize git repo
    git init
    git add .
    git commit -m "Initial deployment"
    
    # Create Heroku app
    APP_NAME="peersignal-$REGION-$(date +%s)"
    heroku create $APP_NAME --region us
    
    # Set environment variables
    heroku config:set APP_ID=$APP_ID --app $APP_NAME
    heroku config:set REGION=$REGION --app $APP_NAME
    heroku config:set MAX_PEERS=$MAX_PEERS --app $APP_NAME
    heroku config:set SEED_PUBLIC_KEY="$SEED_PUBLIC_KEY" --app $APP_NAME
    heroku config:set SEED_SIGNATURE="$SEED_SIGNATURE" --app $APP_NAME
    
    # Deploy
    git push heroku main
    
    echo "✅ Heroku deployment complete: https://$APP_NAME.herokuapp.com"
    cd ..
    rm -rf $TEMP_DIR
}

# Deploy to Railway
deploy_railway() {
    echo ""
    echo "🚂 Deploying to Railway..."
    
    cd deploy
    
    # Create railway.json if it doesn't exist
    cat > railway.json << EOF
{
  "build": {
    "builder": "nixpacks"
  },
  "deploy": {
    "startCommand": "node heroku-server.js",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 30
  }
}
EOF
    
    # Deploy
    railway up
    
    echo "✅ Railway deployment complete"
    cd ..
}

# Deploy to Fly.io
deploy_fly() {
    echo ""
    echo "🪰 Deploying to Fly.io..."
    
    cd deploy
    
    # Create fly.toml if it doesn't exist
    cat > fly.toml << EOF
app = "peersignal-$REGION-$(date +%s)"
primary_region = "iad"

[build]
  builder = "heroku/buildpacks:20"

[env]
  PORT = "8080"
  APP_ID = "$APP_ID"
  REGION = "$REGION"
  MAX_PEERS = "$MAX_PEERS"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = false
  auto_start_machines = true

[[http_service.checks]]
  grace_period = "10s"
  interval = "30s"
  method = "GET"
  path = "/health"
  timeout = "5s"

[http_service.concurrency]
  type = "connections"
  hard_limit = 1000
  soft_limit = 500

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 512
EOF
    
    # Deploy
    fly launch --no-deploy
    fly deploy
    
    echo "✅ Fly.io deployment complete"
    cd ..
}

# Deploy to Vercel
deploy_vercel() {
    echo ""
    echo "▲ Deploying to Vercel..."
    
    cd deploy
    
    # Create vercel.json for static hosting + edge functions
    cat > vercel.json << EOF
{
  "functions": {
    "api/seeds.js": {
      "runtime": "edge"
    }
  },
  "headers": [
    {
      "source": "/.well-known/peerpigeon.json",
      "headers": [
        { "key": "Access-Control-Allow-Origin", "value": "*" },
        { "key": "Cache-Control", "value": "max-age=300" }
      ]
    }
  ]
}
EOF
    
    # Deploy
    vercel deploy --prod
    
    echo "✅ Vercel deployment complete"
    cd ..
}

# Main deployment logic
echo ""
echo "🎯 Starting deployments..."

DEPLOYED_COUNT=0

if [ "$CLOUDFLARE_AVAILABLE" = "1" ]; then
    deploy_cloudflare
    DEPLOYED_COUNT=$((DEPLOYED_COUNT + 1))
fi

if [ "$HEROKU_AVAILABLE" = "1" ]; then
    deploy_heroku
    DEPLOYED_COUNT=$((DEPLOYED_COUNT + 1))
fi

if [ "$RAILWAY_AVAILABLE" = "1" ]; then
    deploy_railway
    DEPLOYED_COUNT=$((DEPLOYED_COUNT + 1))
fi

if [ "$FLY_AVAILABLE" = "1" ]; then
    deploy_fly
    DEPLOYED_COUNT=$((DEPLOYED_COUNT + 1))
fi

if [ "$VERCEL_AVAILABLE" = "1" ]; then
    deploy_vercel
    DEPLOYED_COUNT=$((DEPLOYED_COUNT + 1))
fi

echo ""
echo "🎉 Deployment Summary"
echo "===================="
echo "✅ Successfully deployed to $DEPLOYED_COUNT platforms"
echo "📱 App ID: $APP_ID"
echo "🌍 Region: $REGION"
echo ""
echo "🔗 Your censorship-resistant network is now live!"
echo "   Each platform acts as an independent DHT node"
echo "   If one goes down, others continue operating"
echo ""
echo "📚 Next steps:"
echo "   1. Update your client code with the new node URLs"
echo "   2. Set up monitoring with the /health endpoints"
echo "   3. Configure DNS TXT records for additional discovery"
echo "   4. Test the network with the examples/ directory"
echo ""
echo "🛡️  Your network is now resistant to single-point failures!"
