#!/bin/bash
# Quick flash script for ESP32
# Automatically detects port and flashes the firmware

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}"
echo "╔══════════════════════════════════════════════════════════╗"
echo "║         PigeonHub ESP32 Flash Tool                      ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Navigate to esp32-sketch directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ESP32_DIR="$(dirname "$SCRIPT_DIR")"
SKETCH_DIR="$ESP32_DIR/esp32-sketch"

if [ ! -d "$SKETCH_DIR" ]; then
    echo -e "${RED}Error: esp32-sketch directory not found!${NC}"
    exit 1
fi

cd "$SKETCH_DIR"

# Check if PlatformIO is installed
if ! command -v pio &> /dev/null; then
    echo -e "${RED}Error: PlatformIO not found!${NC}"
    echo "Please install PlatformIO first:"
    echo "  pip3 install platformio"
    exit 1
fi

# Detect USB port
echo -e "${BLUE}Detecting ESP32...${NC}"

if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    PORT=$(ls /dev/cu.* 2>/dev/null | grep -E "usbserial|usbmodem|SLAB" | head -n1)
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux
    PORT=$(ls /dev/ttyUSB* /dev/ttyACM* 2>/dev/null | head -n1)
fi

if [ -z "$PORT" ]; then
    echo -e "${YELLOW}⚠ Could not auto-detect ESP32 port${NC}"
    echo "Available ports:"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        ls /dev/cu.* 2>/dev/null || echo "  (none)"
    else
        ls /dev/tty* 2>/dev/null | grep -E "USB|ACM" || echo "  (none)"
    fi
    echo ""
    read -p "Enter port manually (or press Enter to continue without specifying): " MANUAL_PORT
    if [ -n "$MANUAL_PORT" ]; then
        PORT=$MANUAL_PORT
    fi
else
    echo -e "${GREEN}✓ Found ESP32 at: $PORT${NC}"
fi

# Ask for board type
echo ""
echo "Select your ESP32 board:"
echo "  1) ESP32 Dev Module (default)"
echo "  2) ESP32-S3"
echo "  3) ESP32-C3"
read -p "Enter choice [1-3] (default: 1): " board_choice

case $board_choice in
    2)
        ENV="esp32-s3"
        ;;
    3)
        ENV="esp32-c3"
        ;;
    *)
        ENV="esp32dev"
        ;;
esac

# Build command
BUILD_CMD="pio run -e $ENV"
if [ -n "$PORT" ]; then
    BUILD_CMD="$BUILD_CMD --upload-port $PORT"
fi

# Ask what to do
echo ""
echo "What would you like to do?"
echo "  1) Upload only"
echo "  2) Upload and monitor"
echo "  3) Monitor only"
read -p "Enter choice [1-3] (default: 2): " action_choice

case $action_choice in
    1)
        TARGET="upload"
        ;;
    3)
        TARGET="monitor"
        ;;
    *)
        TARGET="upload monitor"
        ;;
esac

# Execute
echo ""
echo -e "${BLUE}Executing: pio run -e $ENV --target $TARGET${NC}"
echo ""

pio run -e $ENV --target $TARGET

echo ""
echo -e "${GREEN}✓ Done!${NC}"
