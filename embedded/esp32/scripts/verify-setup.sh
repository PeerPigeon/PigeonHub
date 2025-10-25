#!/bin/bash
# PigeonHub ESP32 Installation Verification Script
# Run this to verify all dependencies are installed correctly

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

PASS=0
FAIL=0

check_command() {
    local cmd=$1
    local name=$2
    local optional=${3:-false}
    
    if command -v "$cmd" &> /dev/null; then
        version=$($cmd --version 2>&1 | head -n1)
        echo -e "${GREEN}✓${NC} $name: $version"
        ((PASS++))
        return 0
    else
        if [ "$optional" = true ]; then
            echo -e "${YELLOW}⚠${NC} $name: Not found (optional)"
        else
            echo -e "${RED}✗${NC} $name: Not found"
            ((FAIL++))
        fi
        return 1
    fi
}

check_path() {
    local path=$1
    local name=$2
    
    if [ -d "$path" ] || [ -f "$path" ]; then
        echo -e "${GREEN}✓${NC} $name: $path"
        ((PASS++))
        return 0
    else
        echo -e "${RED}✗${NC} $name: Not found at $path"
        ((FAIL++))
        return 1
    fi
}

check_file() {
    local file=$1
    local name=$2
    
    if [ -f "$file" ]; then
        size=$(du -h "$file" | cut -f1)
        echo -e "${GREEN}✓${NC} $name: $file ($size)"
        ((PASS++))
        return 0
    else
        echo -e "${RED}✗${NC} $name: Not found at $file"
        ((FAIL++))
        return 1
    fi
}

# Banner
echo -e "${BLUE}"
echo "╔══════════════════════════════════════════════════════════╗"
echo "║         PigeonHub ESP32 Verification                    ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo ""

# Check OS
echo -e "${BLUE}System Information:${NC}"
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "OS: macOS $(sw_vers -productVersion)"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    echo "OS: Linux ($(uname -r))"
else
    echo "OS: $OSTYPE"
fi
echo ""

# Check core tools
echo -e "${BLUE}Core Tools:${NC}"
check_command python3 "Python3"
check_command pip3 "pip3"
check_command git "Git"
check_command make "Make"
echo ""

# Check ESP32 tools
echo -e "${BLUE}ESP32 Tools:${NC}"
check_command pio "PlatformIO"
check_command esptool.py "esptool"
echo ""

# Check WASM tools
echo -e "${BLUE}WebAssembly Tools:${NC}"
check_command clang "clang"
check_command node "Node.js"
check_command npm "npm"
check_command wasm-opt "wasm-opt" true
echo ""

# Check WASI-SDK
echo -e "${BLUE}WASI-SDK:${NC}"
if [[ "$OSTYPE" == "darwin"* ]] || [[ "$OSTYPE" == "linux-gnu"* ]]; then
    check_path "/opt/wasi-sdk" "WASI-SDK"
    check_command /opt/wasi-sdk/bin/clang "WASI clang"
fi
echo ""

# Check WASM files
echo -e "${BLUE}Build Artifacts:${NC}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ESP32_DIR="$(dirname "$SCRIPT_DIR")"

check_file "$ESP32_DIR/pigeonhub_client.wasm" "WASM module"
check_file "$ESP32_DIR/esp32-sketch/data/pigeonhub_client.wasm" "WASM in sketch" true
echo ""

# Check USB devices
echo -e "${BLUE}USB Devices:${NC}"
if [[ "$OSTYPE" == "darwin"* ]]; then
    DEVICES=$(ls /dev/cu.* 2>/dev/null | grep -E "usbserial|usbmodem|SLAB" || echo "")
    if [ -n "$DEVICES" ]; then
        echo -e "${GREEN}✓${NC} USB serial devices found:"
        echo "$DEVICES" | while read device; do
            echo "  - $device"
        done
        ((PASS++))
    else
        echo -e "${YELLOW}⚠${NC} No USB serial devices found (connect ESP32 to verify)"
    fi
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    DEVICES=$(ls /dev/ttyUSB* /dev/ttyACM* 2>/dev/null || echo "")
    if [ -n "$DEVICES" ]; then
        echo -e "${GREEN}✓${NC} USB serial devices found:"
        echo "$DEVICES" | while read device; do
            echo "  - $device"
        done
        ((PASS++))
    else
        echo -e "${YELLOW}⚠${NC} No USB serial devices found (connect ESP32 to verify)"
    fi
    
    # Check dialout group
    if groups | grep -q dialout; then
        echo -e "${GREEN}✓${NC} User in 'dialout' group"
        ((PASS++))
    else
        echo -e "${RED}✗${NC} User NOT in 'dialout' group"
        echo "  Run: sudo usermod -a -G dialout $USER"
        ((FAIL++))
    fi
fi
echo ""

# Summary
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}Passed: $PASS${NC}  ${RED}Failed: $FAIL${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""

if [ $FAIL -eq 0 ]; then
    echo -e "${GREEN}✓ All checks passed! You're ready to build and flash ESP32!${NC}"
    echo ""
    echo "Next steps:"
    echo "  cd $ESP32_DIR/esp32-sketch"
    echo "  pio run --target upload --target monitor"
    exit 0
else
    echo -e "${RED}✗ Some checks failed. Please review the errors above.${NC}"
    echo ""
    echo "To fix issues, re-run the setup script:"
    echo "  cd $SCRIPT_DIR"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "  ./setup-macos.sh"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        echo "  ./setup-linux.sh"
    fi
    exit 1
fi
