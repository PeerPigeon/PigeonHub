# 🚀 ESP32 Setup - Getting Started

Welcome! This guide will help you set up your development environment and flash PigeonHub to your ESP32 in just a few steps.

## ⚡ Quick Setup (Choose Your OS)

We've created automated scripts that do everything for you!

### macOS 🍎
```bash
cd embedded/esp32/scripts
./setup-macos.sh
```

### Linux 🐧
```bash
cd embedded/esp32/scripts
./setup-linux.sh
```

### Windows 🪟
```powershell
# Run PowerShell as Administrator
cd embedded\esp32\scripts
powershell -ExecutionPolicy Bypass -File setup-windows.ps1
```

**That's it!** The script will:
- ✅ Install all dependencies (Python, PlatformIO, WASI-SDK, etc.)
- ✅ Build the WASM module
- ✅ Set up your development environment
- ✅ Configure USB permissions and drivers

Takes 10-25 minutes depending on your system.

## ✅ Verify Installation

After setup, verify everything works:

```bash
# macOS/Linux
cd embedded/esp32/scripts
./verify-setup.sh

# Windows
cd embedded\esp32\scripts
powershell -ExecutionPolicy Bypass -File verify-setup.ps1
```

## 🔥 Flash to ESP32

Connect your ESP32 via USB, then run:

```bash
# macOS/Linux
cd embedded/esp32/scripts
./flash.sh

# Windows
cd embedded\esp32\scripts
powershell -ExecutionPolicy Bypass -File flash.ps1
```

The flash script will:
1. Auto-detect your ESP32 board
2. Let you select board type (ESP32/ESP32-S3/ESP32-C3)
3. Upload firmware and start serial monitor

## 🎯 Common Workflows

### First Time Setup
1. Run setup script for your OS
2. Run verification script
3. Connect ESP32 via USB
4. Run flash script
5. Done! Your ESP32 is now a PigeonHub node

### Making Changes to WASM Code
```bash
# Edit pigeonhub_client.c
nano embedded/esp32/pigeonhub_client.c

# Rebuild WASM
cd embedded/esp32/scripts
./rebuild.sh   # or rebuild.ps1 on Windows

# Flash to ESP32
./flash.sh     # or flash.ps1 on Windows
```

### Checking Serial Monitor
```bash
cd embedded/esp32/esp32-sketch
pio device monitor --baud 115200
```

## 📚 Documentation

- **[scripts/QUICK_START.md](scripts/QUICK_START.md)** - Command reference
- **[scripts/README.md](scripts/README.md)** - Detailed script documentation
- **[README.md](README.md)** - Full ESP32 technical documentation
- **[esp32-sketch/README.md](esp32-sketch/README.md)** - Arduino sketch guide

## 🛠️ Manual Setup

Prefer to install everything manually? See the full [README.md](README.md) for detailed instructions.

## 🆘 Troubleshooting

### ESP32 Not Detected

**Linux:**
```bash
sudo usermod -a -G dialout $USER
# Log out and back in
```

**Windows:**
- Check Device Manager for unknown devices
- Install CH340, CP210x, or FTDI drivers

**macOS:**
- Usually works out of the box
- Check System Report → USB for connected devices

### Build Fails

```bash
# Check if WASI-SDK is installed
ls /opt/wasi-sdk/bin/clang         # macOS/Linux
dir C:\wasi-sdk\bin\clang.exe      # Windows

# Re-run setup script if missing
```

### Permission Denied

**Linux:**
```bash
chmod +x embedded/esp32/scripts/*.sh
```

**Windows:**
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

## 💡 Tips

- **First flash may fail** - Try pressing and holding the BOOT button on ESP32
- **Serial monitor baud rate** - Always use 115200
- **Multiple ESP32 boards** - The flash script auto-detects each one
- **VS Code users** - Install PlatformIO extension for the best experience

## 🎓 What's Next?

After flashing:
1. ESP32 creates a WiFi network: `PigeonHub-Setup`
2. Connect with password: `pigeonhub`
3. Configure your WiFi in the web portal
4. Your ESP32 is now a PigeonHub node!

Server will be available at: `ws://YOUR_ESP32_IP:3000/`

## 🤝 Getting Help

- Check the detailed [README.md](README.md)
- Review [scripts/README.md](scripts/README.md) for script-specific help
- Open an issue on GitHub
- Join our community chat

---

**Ready to get started?** Scroll up and run the setup script for your OS! 🚀
