#!/bin/bash
# PigeonHub ESP32 Setup Script for macOS
# This script automates the installation of all dependencies needed to build and flash PigeonHub to ESP32

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Banner
echo -e "${BLUE}"
echo "╔══════════════════════════════════════════════════════════╗"
echo "║         PigeonHub ESP32 Setup for macOS                 ║"
echo "║         Automated Installation Script                   ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Check if running on macOS
if [[ "$OSTYPE" != "darwin"* ]]; then
    log_error "This script is for macOS only!"
    exit 1
fi

# Check for Homebrew
log_info "Checking for Homebrew..."
if ! command -v brew &> /dev/null; then
    log_warning "Homebrew not found. Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    log_success "Homebrew installed"
else
    log_success "Homebrew found"
fi

# Update Homebrew
log_info "Updating Homebrew..."
brew update

# Install Python3 if not present
log_info "Checking for Python3..."
if ! command -v python3 &> /dev/null; then
    log_warning "Python3 not found. Installing..."
    brew install python3
    log_success "Python3 installed"
else
    log_success "Python3 found: $(python3 --version)"
fi

# Install pip packages
log_info "Installing Python packages..."
pip3 install --upgrade pip
pip3 install platformio esptool

# Install Node.js and npm (for wasm-opt)
log_info "Checking for Node.js..."
if ! command -v node &> /dev/null; then
    log_warning "Node.js not found. Installing..."
    brew install node
    log_success "Node.js installed"
else
    log_success "Node.js found: $(node --version)"
fi

# Install wasm-opt (optional but recommended)
log_info "Installing wasm-opt for WASM optimization..."
npm install -g wasm-opt
log_success "wasm-opt installed"

# Install WASI-SDK
log_info "Checking for WASI-SDK..."
WASI_SDK_PATH="/opt/wasi-sdk"
WASI_SDK_VERSION="20.0"

if [ ! -d "$WASI_SDK_PATH" ]; then
    log_warning "WASI-SDK not found. Installing WASI-SDK ${WASI_SDK_VERSION}..."
    
    # Download and install
    cd /tmp
    curl -L "https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-20/wasi-sdk-${WASI_SDK_VERSION}-macos.tar.gz" -o wasi-sdk.tar.gz
    
    log_info "Extracting WASI-SDK..."
    sudo mkdir -p /opt
    sudo tar xzf wasi-sdk.tar.gz -C /opt
    sudo ln -sf "/opt/wasi-sdk-${WASI_SDK_VERSION}" "$WASI_SDK_PATH"
    
    rm wasi-sdk.tar.gz
    log_success "WASI-SDK installed to $WASI_SDK_PATH"
else
    log_success "WASI-SDK found at $WASI_SDK_PATH"
fi

# Check for clang
log_info "Checking for clang..."
if ! command -v clang &> /dev/null; then
    log_warning "clang not found. Installing..."
    brew install llvm
    log_success "clang installed"
else
    log_success "clang found: $(clang --version | head -n1)"
fi

# Ask user about Arduino IDE or PlatformIO
echo ""
log_info "Choose your development environment:"
echo "  1) PlatformIO (Recommended - CLI and VS Code)"
echo "  2) Arduino IDE"
echo "  3) Both"
echo "  4) Skip (I'll install manually)"
read -p "Enter choice [1-4]: " dev_choice

case $dev_choice in
    1)
        log_info "PlatformIO is already installed via pip above"
        ;;
    2)
        log_info "Opening Arduino IDE download page..."
        open "https://www.arduino.cc/en/software"
        log_warning "Please download and install Arduino IDE manually"
        log_warning "After installation, add ESP32 board support:"
        echo "  1. Open Arduino IDE"
        echo "  2. Go to Arduino → Preferences"
        echo "  3. Add this URL to 'Additional Board Manager URLs':"
        echo "     https://espressif.github.io/arduino-esp32/package_esp32_index.json"
        echo "  4. Go to Tools → Board → Boards Manager"
        echo "  5. Search for 'esp32' and install 'ESP32 by Espressif Systems'"
        echo "  6. Install libraries: WebSockets by Markus Sattler, Wasm3"
        read -p "Press Enter when done..."
        ;;
    3)
        log_info "PlatformIO is already installed"
        log_info "Opening Arduino IDE download page..."
        open "https://www.arduino.cc/en/software"
        log_warning "Please follow Arduino IDE setup instructions above"
        read -p "Press Enter when done..."
        ;;
    4)
        log_info "Skipping IDE installation"
        ;;
esac

# Install USB drivers (if needed)
log_info "Checking for USB serial drivers..."
if ! ls /dev/cu.usbserial* &> /dev/null && ! ls /dev/cu.usbmodem* &> /dev/null; then
    log_warning "USB serial devices not detected. You may need to install drivers:"
    log_info "Common drivers:"
    echo "  - CH340/CH341: https://github.com/adrianmihalko/ch340g-ch34g-ch34x-mac-os-x-driver"
    echo "  - CP210x: https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers"
    echo "  - FTDI: https://ftdichip.com/drivers/vcp-drivers/"
    read -p "Install drivers now? (y/n): " install_drivers
    if [[ "$install_drivers" == "y" ]]; then
        open "https://github.com/adrianmihalko/ch340g-ch34g-ch34x-mac-os-x-driver"
    fi
else
    log_success "USB serial devices found"
fi

# Build the WASM module
echo ""
log_info "Building PigeonHub WASM module..."
cd "$(dirname "$0")/.."

if make wasm; then
    log_success "WASM module built successfully!"
    
    # Optimize if wasm-opt is available
    if command -v wasm-opt &> /dev/null; then
        log_info "Optimizing WASM module..."
        make wasm-opt
        log_success "WASM module optimized"
    fi
else
    log_error "WASM build failed. Please check the error messages above."
    exit 1
fi

# Copy WASM to esp32-sketch
log_info "Installing WASM module to esp32-sketch..."
make install
log_success "WASM module installed"

# Setup complete
echo ""
echo -e "${GREEN}"
echo "╔══════════════════════════════════════════════════════════╗"
echo "║              Setup Complete! 🎉                          ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

log_info "Next steps:"
echo ""
echo "  For PlatformIO:"
echo "    cd esp32-sketch"
echo "    pio run --target upload --target monitor"
echo ""
echo "  For Arduino IDE:"
echo "    1. Open esp32-sketch/esp32-sketch.ino"
echo "    2. Select your board: Tools → Board → ESP32"
echo "    3. Select your port: Tools → Port"
echo "    4. Click Upload"
echo ""
echo "  Connect your ESP32 via USB and flash the firmware!"
echo ""
log_info "For troubleshooting, see: embedded/esp32/README.md"
