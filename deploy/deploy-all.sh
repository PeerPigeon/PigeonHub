#!/bin/bash

# PigeonHub Multi-Platform Deployment Script
# This script deploys signaling nodes across multiple cloud platforms

set -e

echo "🚀 PigeonHub Multi-Platform Deployment"
echo "====================================="

# Configuration
APP_ID=${APP_ID:-"GLOBAL-PEERPIGEON-HUB"}
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

# Check tools and set availability flags
if warn_tool "wrangler" "Cloudflare Workers"; then
    CLOUDFLARE_AVAILABLE=1
else
    CLOUDFLARE_AVAILABLE=0
fi

if warn_tool "heroku" "Heroku"; then
    HEROKU_AVAILABLE=1
else
    HEROKU_AVAILABLE=0
fi

if warn_tool "railway" "Railway"; then
    RAILWAY_AVAILABLE=1
else
    RAILWAY_AVAILABLE=0
fi

if warn_tool "flyctl" "Fly.io"; then
    FLY_AVAILABLE=1
else
    FLY_AVAILABLE=0
fi

if warn_tool "vercel" "Vercel"; then
    VERCEL_AVAILABLE=1
else
    VERCEL_AVAILABLE=0
fi

echo ""
echo "🔑 Setting up environment variables..."

# Generate Ed25519 keypair if not provided
if [ -z "$SEED_PRIVATE_KEY" ] || [ -z "$SEED_PUBLIC_KEY" ]; then
    echo "📝 Generating new Ed25519 keypair for seed signing..."
    
    # Run the key generation script
    KEY_OUTPUT=$(node deploy/generate-keys.mjs)
    
    if [ $? -eq 0 ]; then
        echo "$KEY_OUTPUT"
        echo ""
        echo "⚠️  Please save these keys securely and set them as environment variables"
        echo "   For this deployment session, you can run:"
        echo "   export SEED_PRIVATE_KEY='<private_key_value>'"
        echo "   export SEED_PUBLIC_KEY='<public_key_value>'"
        echo ""
        echo "💡 Or save them to a .env file (don't commit to git!):"
        echo "   echo 'SEED_PRIVATE_KEY=<private_key_value>' >> .env"
        echo "   echo 'SEED_PUBLIC_KEY=<public_key_value>' >> .env"
        echo ""
        
        # Extract keys from output for this session
        SEED_PRIVATE_KEY=$(echo "$KEY_OUTPUT" | grep "SEED_PRIVATE_KEY=" | cut -d'=' -f2)
        SEED_PUBLIC_KEY=$(echo "$KEY_OUTPUT" | grep "SEED_PUBLIC_KEY=" | cut -d'=' -f2)
        
        export SEED_PRIVATE_KEY
        export SEED_PUBLIC_KEY
        
        echo "🔑 Keys have been set for this deployment session"
    else
        echo "❌ Failed to generate keys. Please set SEED_PRIVATE_KEY and SEED_PUBLIC_KEY manually."
        exit 1
    fi
fi

# Deploy to Cloudflare Workers
deploy_cloudflare() {
    echo ""
    echo "☁️  Deploying to Cloudflare Workers..."
    
    cd deploy
    
    # Create a copy of the worker and update configuration
    cp cloudflare-worker.js cloudflare-worker-configured.js
    
    # Update worker with current config
    sed -i.bak "s/your-app-id/$APP_ID/g" cloudflare-worker-configured.js
    sed -i.bak "s/us-east/$REGION/g" cloudflare-worker-configured.js
    sed -i.bak "s/BASE64_ED25519_PUBLIC_KEY/$SEED_PUBLIC_KEY/g" cloudflare-worker-configured.js
    sed -i.bak "s/BASE64_SIGNATURE/$SEED_SIGNATURE/g" cloudflare-worker-configured.js
    
    # Deploy with unique name
    WORKER_NAME="pigeonhub-$REGION-$(date +%s)"
    wrangler deploy cloudflare-worker-configured.js --name "$WORKER_NAME"
    
    echo "✅ Cloudflare Workers deployment complete: https://$WORKER_NAME.workers.dev"
    cd ..
}

# Deploy to Heroku
deploy_heroku() {
    echo ""
    echo "🟣 Deploying to Heroku..."
    
    # Store original directory
    ORIGINAL_DIR=$(pwd)
    
    # Create temporary deployment directory
    TEMP_DIR=$(mktemp -d)
    cd $TEMP_DIR
    
    # Copy files (use absolute paths)
    cp "$ORIGINAL_DIR/deploy/heroku-server.js" ./server.js
    cp "$ORIGINAL_DIR/deploy/heroku-package.json" ./package.json
    cp "$ORIGINAL_DIR/deploy/Procfile" ./Procfile
    
    # Initialize git repo with automation
    git init -q
    git checkout -b main -q
    git config user.email "deploy@pigeonhub.io"
    git config user.name "PigeonHub Deploy"
    git add . -A
    git commit -m "Automated deployment" -q
    
    # Create Heroku app with automation
    APP_NAME="peersignal-$REGION-$(date +%s)"
    heroku create $APP_NAME --region us --json > /dev/null
    
    # Set environment variables (batch mode)
    heroku config:set \
        APP_ID="$APP_ID" \
        REGION="$REGION" \
        MAX_PEERS="$MAX_PEERS" \
        SEED_PUBLIC_KEY="$SEED_PUBLIC_KEY" \
        SEED_SIGNATURE="$SEED_SIGNATURE" \
        --app $APP_NAME > /dev/null
    
    # Deploy with quiet mode
    echo "🚀 Pushing to Heroku..."
    git push heroku main -q
    
    echo "✅ Heroku deployment complete: https://$APP_NAME.herokuapp.com"
    cd "$ORIGINAL_DIR"
    rm -rf $TEMP_DIR
}

# Deploy to Railway
deploy_railway() {
    echo ""
    echo "🚂 Deploying to Railway..."
    
    # Check if already logged in
    if ! railway whoami &> /dev/null; then
        echo "🔑 Not logged into Railway. Attempting browserless login..."
        echo "   Please follow the instructions to authenticate"
        railway login --browserless
        
        # Wait a moment for authentication to settle
        sleep 2
        
        # Verify login was successful
        if ! railway whoami &> /dev/null; then
            echo "❌ Railway login failed. Skipping Railway deployment."
            return 1
        fi
        echo "✅ Railway authentication successful"
    else
        echo "✅ Already logged into Railway"
    fi
    
    cd deploy
    
    # Create unique project name
    PROJECT_NAME="pigeonhub-$REGION-$(date +%s)"
    
    # Initialize project if not already linked
    if ! railway status &> /dev/null; then
        echo "🚂 Creating new Railway project: $PROJECT_NAME"
        railway init --name "$PROJECT_NAME"
    else
        echo "✅ Railway project already linked"
    fi
    
    # Ensure service is linked
    if ! railway status | grep -q "Service:"; then
        echo "🔗 Linking Railway service..."
        echo "pigeonhub" | railway service
    fi
    
    # Create railway.json if it doesn't exist
    cat > railway.json << EOF
{
  "build": {
    "builder": "nixpacks"
  },
  "deploy": {
    "startCommand": "node server.js",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 30
  },
  "variables": {
    "APP_ID": "$APP_ID",
    "REGION": "$REGION",
    "MAX_PEERS": "$MAX_PEERS",
    "SEED_PUBLIC_KEY": "$SEED_PUBLIC_KEY",
    "SEED_SIGNATURE": "$SEED_SIGNATURE"
  }
}
EOF
    
    # Deploy with CI mode and explicit service for full automation
    railway up --ci --service pigeonhub
    
    echo "✅ Railway deployment complete"
    cd ..
}

# Deploy to Fly.io
deploy_fly() {
    echo ""
    echo "🪰 Deploying to Fly.io..."
    
    # Check if already authenticated
    if ! flyctl auth whoami &> /dev/null; then
        echo "🔑 Not authenticated with Fly.io. Please login first:"
        echo "   Run: flyctl auth login"
        echo "   Or set FLY_ACCESS_TOKEN environment variable"
        echo "❌ Skipping Fly.io deployment. Please authenticate and re-run."
        return 1
    else
        echo "✅ Fly.io authentication confirmed"
    fi
    
    cd deploy
    
    # Create unique app name
    APP_NAME="peersignal-$REGION-$(date +%s)"
    
    # Create fly.toml configuration
    cat > fly.toml << EOF
app = "$APP_NAME"
primary_region = "iad"

[build]
  builder = "heroku/buildpacks:20"

[env]
  PORT = "8080"
  APP_ID = "$APP_ID"
  REGION = "$REGION"
  MAX_PEERS = "$MAX_PEERS"
  SEED_PUBLIC_KEY = "$SEED_PUBLIC_KEY"
  SEED_SIGNATURE = "$SEED_SIGNATURE"

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
    
    # Deploy with automation flags
    echo "🚀 Launching Fly.io app..."
    fly launch --now --no-deploy --ha=false --copy-config
    
    echo "🚀 Deploying to Fly.io..."
    fly deploy --wait-timeout=300
    
    echo "✅ Fly.io deployment complete: https://$APP_NAME.fly.dev"
    cd ..
}

# Deploy to Vercel
deploy_vercel() {
    echo ""
    echo "▲ Deploying to Vercel..."
    
    cd deploy
    
    # Create vercel.json for serverless functions
    cat > vercel.json << EOF
{
  "version": 2,
  "builds": [
    {
      "src": "server.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "/server.js"
    }
  ],
  "env": {
    "APP_ID": "$APP_ID",
    "REGION": "$REGION",
    "MAX_PEERS": "$MAX_PEERS",
    "SEED_PUBLIC_KEY": "$SEED_PUBLIC_KEY",
    "SEED_SIGNATURE": "$SEED_SIGNATURE"
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
    
    # Deploy with full automation
    echo "🚀 Deploying to Vercel..."
    vercel deploy --prod --yes --no-wait
    
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
