#!/bin/bash
# PigeonHub ESP32 Setup Script for Linux
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
echo "║         PigeonHub ESP32 Setup for Linux                 ║"
echo "║         Automated Installation Script                   ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Detect Linux distribution
if [ -f /etc/os-release ]; then
    . /etc/os-release
    DISTRO=$ID
else
    log_error "Cannot detect Linux distribution"
    exit 1
fi

log_info "Detected distribution: $DISTRO"

# Install system dependencies based on distro
log_info "Installing system dependencies..."

case $DISTRO in
    ubuntu|debian|linuxmint|pop)
        sudo apt-get update
        sudo apt-get install -y \
            python3 \
            python3-pip \
            git \
            curl \
            wget \
            build-essential \
            clang \
            cmake \
            ninja-build \
            libusb-1.0-0-dev \
            pkg-config
        ;;
    fedora|rhel|centos)
        sudo dnf install -y \
            python3 \
            python3-pip \
            git \
            curl \
            wget \
            gcc \
            gcc-c++ \
            clang \
            cmake \
            ninja-build \
            libusbx-devel \
            pkgconfig
        ;;
    arch|manjaro)
        sudo pacman -Sy --noconfirm \
            python \
            python-pip \
            git \
            curl \
            wget \
            base-devel \
            clang \
            cmake \
            ninja \
            libusb \
            pkgconf
        ;;
    opensuse*)
        sudo zypper install -y \
            python3 \
            python3-pip \
            git \
            curl \
            wget \
            gcc \
            gcc-c++ \
            clang \
            cmake \
            ninja \
            libusb-1_0-devel \
            pkg-config
        ;;
    *)
        log_warning "Unsupported distribution. Please install dependencies manually:"
        echo "  - python3, pip, git, curl, wget, gcc, clang, cmake, libusb-dev"
        read -p "Continue anyway? (y/n): " continue_setup
        if [[ "$continue_setup" != "y" ]]; then
            exit 1
        fi
        ;;
esac

log_success "System dependencies installed"

# Check Python version
log_info "Checking Python version..."
PYTHON_VERSION=$(python3 --version | cut -d' ' -f2)
log_success "Python3 found: $PYTHON_VERSION"

# Install Python packages
log_info "Installing Python packages..."
pip3 install --upgrade pip --break-system-packages 2>/dev/null || pip3 install --upgrade pip
pip3 install platformio esptool --break-system-packages 2>/dev/null || pip3 install platformio esptool

# Install Node.js and npm (for wasm-opt)
log_info "Checking for Node.js..."
if ! command -v node &> /dev/null; then
    log_warning "Node.js not found. Installing via NodeSource..."
    
    # Install NodeSource repo
    curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - 2>/dev/null || {
        log_warning "Could not install NodeSource repository. Trying package manager..."
        case $DISTRO in
            ubuntu|debian|linuxmint|pop)
                sudo apt-get install -y nodejs npm
                ;;
            fedora|rhel|centos)
                sudo dnf install -y nodejs npm
                ;;
            arch|manjaro)
                sudo pacman -S --noconfirm nodejs npm
                ;;
            opensuse*)
                sudo zypper install -y nodejs npm
                ;;
        esac
    }
    
    log_success "Node.js installed"
else
    log_success "Node.js found: $(node --version)"
fi

# Install wasm-opt (optional but recommended)
log_info "Installing wasm-opt for WASM optimization..."
sudo npm install -g wasm-opt || npm install -g wasm-opt
log_success "wasm-opt installed"

# Install WASI-SDK
log_info "Checking for WASI-SDK..."
WASI_SDK_PATH="/opt/wasi-sdk"
WASI_SDK_VERSION="20.0"

if [ ! -d "$WASI_SDK_PATH" ]; then
    log_warning "WASI-SDK not found. Installing WASI-SDK ${WASI_SDK_VERSION}..."
    
    # Download and install
    cd /tmp
    wget "https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-20/wasi-sdk-${WASI_SDK_VERSION}-linux.tar.gz"
    
    log_info "Extracting WASI-SDK..."
    sudo mkdir -p /opt
    sudo tar xzf "wasi-sdk-${WASI_SDK_VERSION}-linux.tar.gz" -C /opt
    sudo ln -sf "/opt/wasi-sdk-${WASI_SDK_VERSION}" "$WASI_SDK_PATH"
    
    rm "wasi-sdk-${WASI_SDK_VERSION}-linux.tar.gz"
    log_success "WASI-SDK installed to $WASI_SDK_PATH"
else
    log_success "WASI-SDK found at $WASI_SDK_PATH"
fi

# Add user to dialout group for USB access
log_info "Configuring USB permissions..."
if groups | grep -q dialout; then
    log_success "User already in 'dialout' group"
else
    log_warning "Adding user to 'dialout' group for USB access..."
    sudo usermod -a -G dialout $USER
    log_warning "You need to log out and log back in for group changes to take effect"
fi

# Create udev rules for ESP32
log_info "Creating udev rules for ESP32..."
UDEV_RULES="/etc/udev/rules.d/99-platformio-udev.rules"
if [ ! -f "$UDEV_RULES" ]; then
    sudo sh -c 'curl -fsSL https://raw.githubusercontent.com/platformio/platformio-core/master/scripts/99-platformio-udev.rules > /etc/udev/rules.d/99-platformio-udev.rules'
    sudo udevadm control --reload-rules
    sudo udevadm trigger
    log_success "Udev rules installed"
else
    log_success "Udev rules already exist"
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
        log_info "Installing Arduino IDE..."
        case $DISTRO in
            ubuntu|debian|linuxmint|pop)
                wget -O /tmp/arduino-ide.AppImage "https://downloads.arduino.cc/arduino-ide/arduino-ide_latest_Linux_64bit.AppImage"
                chmod +x /tmp/arduino-ide.AppImage
                sudo mv /tmp/arduino-ide.AppImage /usr/local/bin/arduino-ide
                log_success "Arduino IDE installed. Run with: arduino-ide"
                ;;
            *)
                log_warning "Please download Arduino IDE manually from:"
                echo "  https://www.arduino.cc/en/software"
                ;;
        esac
        
        log_warning "After starting Arduino IDE, add ESP32 board support:"
        echo "  1. Go to File → Preferences"
        echo "  2. Add this URL to 'Additional Board Manager URLs':"
        echo "     https://espressif.github.io/arduino-esp32/package_esp32_index.json"
        echo "  3. Go to Tools → Board → Boards Manager"
        echo "  4. Search for 'esp32' and install 'ESP32 by Espressif Systems'"
        echo "  5. Install libraries: WebSockets by Markus Sattler, Wasm3"
        read -p "Press Enter to continue..."
        ;;
    3)
        log_info "PlatformIO is already installed"
        log_warning "Please install Arduino IDE manually from:"
        echo "  https://www.arduino.cc/en/software"
        read -p "Press Enter when done..."
        ;;
    4)
        log_info "Skipping IDE installation"
        ;;
esac

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
echo "  IMPORTANT: If you were added to the 'dialout' group, please:"
echo "    - Log out and log back in (or run: newgrp dialout)"
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
