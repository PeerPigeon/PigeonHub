# PigeonHub ESP32 - Complete Setup Scripts

This directory contains automated setup and utility scripts for ESP32 development with PigeonHub.

## 📦 What's Included

### Setup Scripts (Automated Installation)
- **`setup-macos.sh`** - Complete setup for macOS (Homebrew, Python, PlatformIO, WASI-SDK)
- **`setup-linux.sh`** - Complete setup for Linux (apt/dnf/pacman, Python, PlatformIO, WASI-SDK)
- **`setup-windows.ps1`** - Complete setup for Windows (Chocolatey, Python, PlatformIO, WASI-SDK)

### Verification Scripts
- **`verify-setup.sh`** - Verify installation on macOS/Linux
- **`verify-setup.ps1`** - Verify installation on Windows

### Build Scripts
- **`rebuild.sh`** - Quick WASM rebuild for macOS/Linux
- **`rebuild.ps1`** - Quick WASM rebuild for Windows

### Flash Scripts
- **`flash.sh`** - Interactive ESP32 flasher for macOS/Linux
- **`flash.ps1`** - Interactive ESP32 flasher for Windows

### Documentation
- **`README.md`** - Full script documentation
- **`QUICK_START.md`** - Quick reference guide

## 🚀 Quick Start

### 1. Run Setup (First Time)
```bash
# macOS
./setup-macos.sh

# Linux
./setup-linux.sh

# Windows (PowerShell as Admin)
powershell -ExecutionPolicy Bypass -File setup-windows.ps1
```

### 2. Verify Installation
```bash
# macOS/Linux
./verify-setup.sh

# Windows
powershell -ExecutionPolicy Bypass -File verify-setup.ps1
```

### 3. Flash to ESP32
```bash
# macOS/Linux
./flash.sh

# Windows
powershell -ExecutionPolicy Bypass -File flash.ps1
```

## 🔄 Daily Workflow

When developing, you'll typically:

1. **Edit code** - Modify `pigeonhub_client.c`
2. **Rebuild** - Run `./rebuild.sh` (or `rebuild.ps1`)
3. **Flash** - Run `./flash.sh` (or `flash.ps1`)
4. **Test** - Monitor serial output

## 📖 Documentation

- **Start here**: [QUICK_START.md](QUICK_START.md)
- **Detailed guide**: [README.md](README.md)
- **Getting started**: [../GETTING_STARTED.md](../GETTING_STARTED.md)

## 🎯 Script Features

### Setup Scripts
- ✅ Detect OS/distribution automatically
- ✅ Install all dependencies
- ✅ Configure system permissions (Linux)
- ✅ Build WASM module
- ✅ Interactive IDE selection
- ✅ Verify installation

### Flash Scripts
- ✅ Auto-detect ESP32 port
- ✅ Select board type (ESP32/S3/C3)
- ✅ Choose upload/monitor mode
- ✅ Handle all PlatformIO commands

### Rebuild Scripts
- ✅ Clean previous builds
- ✅ Build WASM module
- ✅ Optimize with wasm-opt
- ✅ Install to esp32-sketch

### Verification Scripts
- ✅ Check all dependencies
- ✅ Verify WASI-SDK installation
- ✅ Confirm WASM build
- ✅ Detect USB devices
- ✅ Check permissions

## 🛠️ Requirements

### All Platforms
- Internet connection (for downloads)
- ~2-3 GB free disk space
- USB port for ESP32

### Platform-Specific
- **macOS**: Xcode Command Line Tools (auto-installed)
- **Linux**: sudo access, dialout group membership
- **Windows**: Administrator access (recommended)

## ⏱️ Time Requirements

- **Setup**: 10-25 minutes (one-time)
- **Rebuild**: 10-30 seconds
- **Flash**: 30-60 seconds
- **Verification**: 5-10 seconds

## 🐛 Troubleshooting

See the full [README.md](README.md) for comprehensive troubleshooting.

Common fixes:

```bash
# Linux: USB permission
sudo usermod -a -G dialout $USER

# macOS: Make scripts executable
chmod +x *.sh

# Windows: Enable script execution
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser

# All: Re-run setup
./setup-macos.sh    # or setup-linux.sh / setup-windows.ps1
```

## 📝 Notes

- All scripts are idempotent (safe to run multiple times)
- Setup scripts won't reinstall existing dependencies
- Scripts are designed to be beginner-friendly
- Error messages include helpful hints

## 🤝 Contributing

Found a bug or want to improve a script? PRs welcome!

---

**New to ESP32 development?** Start with [../GETTING_STARTED.md](../GETTING_STARTED.md) for a gentle introduction! 🎓
