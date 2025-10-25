#!/bin/bash
# Quick rebuild script for PigeonHub WASM module
# Run this after making changes to pigeonhub_client.c

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}Rebuilding PigeonHub WASM module...${NC}"

# Navigate to ESP32 directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ESP32_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ESP32_DIR"

# Clean previous build
echo "Cleaning..."
make clean

# Build WASM
echo "Building WASM..."
make wasm

# Optimize if wasm-opt is available
if command -v wasm-opt &> /dev/null; then
    echo "Optimizing..."
    make wasm-opt
fi

# Install to esp32-sketch
echo "Installing to esp32-sketch..."
make install

# Show file size
WASM_SIZE=$(du -h pigeonhub_client.wasm | cut -f1)
echo -e "${GREEN}✓ Build complete!${NC}"
echo "  WASM module: $WASM_SIZE"
echo ""
echo "To flash to ESP32:"
echo "  cd esp32-sketch"
echo "  pio run --target upload --target monitor"
