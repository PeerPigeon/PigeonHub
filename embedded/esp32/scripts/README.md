# PigeonHub ESP32 Setup Scripts

Automated setup scripts to install all dependencies and build tools for ESP32 development with PigeonHub.

## 🚀 Quick Start

Choose your operating system and run the appropriate script:

### macOS
```bash
cd embedded/esp32/scripts
chmod +x setup-macos.sh
./setup-macos.sh
```

### Linux
```bash
cd embedded/esp32/scripts
chmod +x setup-linux.sh
./setup-linux.sh
```

### Windows
```powershell
cd embedded\esp32\scripts
powershell -ExecutionPolicy Bypass -File setup-windows.ps1
```

**Note**: On Windows, run PowerShell as Administrator for best results.

## 📜 Available Scripts

| Script | Purpose | Platforms |
|--------|---------|-----------|
| `setup-macos.sh` | Complete automated setup | macOS |
| `setup-linux.sh` | Complete automated setup | Linux |
| `setup-windows.ps1` | Complete automated setup | Windows |
| `verify-setup.sh` | Verify installation | macOS, Linux |
| `verify-setup.ps1` | Verify installation | Windows |
| `rebuild.sh` | Quick WASM rebuild | macOS, Linux |
| `rebuild.ps1` | Quick WASM rebuild | Windows |
| `flash.sh` | Interactive ESP32 flasher | macOS, Linux |
| `flash.ps1` | Interactive ESP32 flasher | Windows |

### Rebuild Script

After making changes to `pigeonhub_client.c`, quickly rebuild the WASM module:

**macOS/Linux:**
```bash
cd embedded/esp32/scripts
./rebuild.sh
```

**Windows:**
```powershell
cd embedded\esp32\scripts
powershell -ExecutionPolicy Bypass -File rebuild.ps1
```

### Flash Script

Interactive script to flash ESP32 with automatic port detection:

**macOS/Linux:**
```bash
cd embedded/esp32/scripts
./flash.sh
```

**Windows:**
```powershell
cd embedded\esp32\scripts
powershell -ExecutionPolicy Bypass -File flash.ps1
```

The flash script will:
- Auto-detect your ESP32 board
- Let you select your board type (ESP32/ESP32-S3/ESP32-C3)
- Choose between upload, monitor, or both
- Handle all PlatformIO commands for you

## 📦 What Gets Installed

All scripts automatically install:

### Core Build Tools
- **Python 3** - Required for PlatformIO and ESP-IDF tools
- **pip** - Python package manager
- **Git** - Version control (Windows only, usually pre-installed on macOS/Linux)
- **Make** - Build automation tool

### ESP32 Development Tools
- **PlatformIO** - Recommended ESP32 development platform
- **esptool** - ESP32 firmware flashing tool
- USB serial drivers (CH340, CP210x, FTDI)

### WebAssembly Build Tools
- **WASI-SDK 20.0** - WebAssembly System Interface SDK
- **clang** - C/C++ compiler with WASM target support
- **Node.js & npm** - JavaScript runtime for wasm-opt
- **wasm-opt** - WebAssembly optimizer (optional but recommended)

### IDE Options (Interactive)
During setup, you can choose to install:
- **PlatformIO** (CLI + VS Code extension) - Recommended
- **Arduino IDE** - Traditional Arduino development
- **Both** - Install both environments
- **Skip** - Manual installation later

## 🔧 What the Scripts Do

1. **Detect OS/Distribution** - Auto-configures for your system
2. **Install System Dependencies** - Package managers (apt, dnf, pacman, brew, choco)
3. **Install Build Tools** - Compilers, build systems, USB drivers
4. **Install WASI-SDK** - Downloads and installs to `/opt/wasi-sdk` (macOS/Linux) or `C:\wasi-sdk` (Windows)
5. **Configure Permissions** - Adds user to dialout group (Linux), sets up udev rules
6. **Build WASM Module** - Compiles `pigeonhub_client.wasm`
7. **Install to ESP32 Sketch** - Copies WASM to `esp32-sketch/data/`

## 📋 System Requirements

### macOS
- macOS 10.15+ (Catalina or later)
- Xcode Command Line Tools (installed automatically)
- 2GB free disk space

### Linux
Supported distributions:
- **Ubuntu/Debian** (18.04+)
- **Fedora/RHEL/CentOS** (8+)
- **Arch/Manjaro**
- **openSUSE**

Requirements:
- 2GB free disk space
- sudo access for package installation

### Windows
- Windows 10/11
- PowerShell 5.0+ (pre-installed on Windows 10+)
- Administrator access (recommended)
- 3GB free disk space

## 🎯 Post-Installation

After running the setup script:

### Using PlatformIO (Recommended)

```bash
cd embedded/esp32/esp32-sketch
pio run --target upload --target monitor
```

### Using Arduino IDE

1. Open `esp32-sketch/esp32-sketch.ino`
2. Configure ESP32 board support:
   - File → Preferences
   - Add URL to "Additional Board Manager URLs":
     ```
     https://espressif.github.io/arduino-esp32/package_esp32_index.json
     ```
   - Tools → Board → Boards Manager
   - Search "esp32" and install "ESP32 by Espressif Systems"
3. Install libraries:
   - Tools → Manage Libraries
   - Install "WebSockets by Markus Sattler"
   - Install "Wasm3"
4. Select your board: Tools → Board → ESP32
5. Select your port: Tools → Port
6. Click Upload

## 🔍 Verification

After setup completes, verify your installation with our automated verification script:

### macOS/Linux
```bash
cd embedded/esp32/scripts
./verify-setup.sh
```

### Windows
```powershell
cd embedded\esp32\scripts
powershell -ExecutionPolicy Bypass -File verify-setup.ps1
```

The verification script will check:
- ✅ All required tools are installed
- ✅ WASI-SDK is properly configured
- ✅ WASM module was built successfully
- ✅ USB devices are detected
- ✅ Permissions are configured (Linux)

### Manual Verification

You can also manually verify:

```bash
# Check Python
python3 --version

# Check PlatformIO
pio --version

# Check WASI-SDK
ls /opt/wasi-sdk/bin/clang         # macOS/Linux
dir C:\wasi-sdk\bin\clang.exe      # Windows

# Check wasm-opt
wasm-opt --version

# Check WASM module
ls embedded/esp32/pigeonhub_client.wasm
ls embedded/esp32/esp32-sketch/data/pigeonhub_client.wasm
```

## 🐛 Troubleshooting

### Permission Issues (Linux)

If you can't access USB devices:
```bash
# Add user to dialout group
sudo usermod -a -G dialout $USER

# Log out and log back in, or run:
newgrp dialout
```

### USB Drivers (Windows)

If ESP32 is not detected:
1. Check Device Manager for unknown devices
2. Install appropriate driver:
   - CH340: http://www.wch-ic.com/downloads/CH341SER_ZIP.html
   - CP210x: https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers
   - FTDI: https://ftdichip.com/drivers/vcp-drivers/

### WASM Build Fails

If WASM compilation fails:
```bash
# Verify WASI-SDK installation
export WASI_SDK_PATH=/opt/wasi-sdk  # macOS/Linux
$env:WASI_SDK_PATH = "C:\wasi-sdk"  # Windows

# Try manual build
cd embedded/esp32
make clean
make wasm
```

### PATH Not Updated (Windows)

After installation, close and reopen PowerShell/Terminal, or restart your computer.

### Homebrew Installation Fails (macOS)

If Homebrew installation prompts for password or fails:
```bash
# Install Homebrew manually
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Then re-run the setup script
./setup-macos.sh
```

## 🔄 Updating

To update dependencies:

```bash
# Re-run the setup script
cd embedded/esp32/scripts
./setup-macos.sh    # or setup-linux.sh
```

On Windows:
```powershell
powershell -ExecutionPolicy Bypass -File setup-windows.ps1
```

## 📚 Manual Installation

If you prefer manual installation, see the main [ESP32 README](../README.md) for detailed instructions.

## 💡 Tips

- **VS Code Users**: Install the PlatformIO IDE extension for best experience
- **Arduino IDE Users**: Enable verbose output in Preferences for better debugging
- **First Flash**: Some boards require holding BOOT button during first flash
- **Serial Monitor**: Use 115200 baud rate to view ESP32 output

## 🆘 Getting Help

- Check the [main ESP32 README](../README.md) for detailed documentation
- Visit [PigeonHub Issues](https://github.com/PeerPigeon/PigeonHub/issues)
- Join our community chat

## 📄 License

These scripts are part of the PigeonHub project and follow the same license.
