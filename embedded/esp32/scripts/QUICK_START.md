# Quick Reference - ESP32 Setup Scripts

## 🎯 One-Command Setup

### macOS
```bash
cd embedded/esp32/scripts && ./setup-macos.sh
```

### Linux
```bash
cd embedded/esp32/scripts && ./setup-linux.sh
```

### Windows (PowerShell as Admin)
```powershell
cd embedded\esp32\scripts; powershell -ExecutionPolicy Bypass -File setup-windows.ps1
```

## ✅ Verify Installation

### macOS/Linux
```bash
cd embedded/esp32/scripts && ./verify-setup.sh
```

### Windows
```powershell
cd embedded\esp32\scripts; powershell -ExecutionPolicy Bypass -File verify-setup.ps1
```

## 🔥 Flash to ESP32

### Easy Way (Interactive Script)

**macOS/Linux:**
```bash
cd embedded/esp32/scripts && ./flash.sh
```

**Windows:**
```powershell
cd embedded\esp32\scripts; powershell -ExecutionPolicy Bypass -File flash.ps1
```

### Manual Way (PlatformIO)
```bash
cd embedded/esp32/esp32-sketch
pio run --target upload --target monitor
```

### Using Arduino IDE
1. Open `esp32-sketch/esp32-sketch.ino`
2. Select board and port
3. Click Upload

## 🔨 Rebuild WASM

After editing `pigeonhub_client.c`:

**macOS/Linux:**
```bash
cd embedded/esp32/scripts && ./rebuild.sh
```

**Windows:**
```powershell
cd embedded\esp32\scripts; powershell -ExecutionPolicy Bypass -File rebuild.ps1
```

## 📁 Script Files

| Script | Purpose |
|--------|---------|
| `setup-macos.sh` | Automated setup for macOS |
| `setup-linux.sh` | Automated setup for Linux |
| `setup-windows.ps1` | Automated setup for Windows |
| `verify-setup.sh` | Verify installation (macOS/Linux) |
| `verify-setup.ps1` | Verify installation (Windows) |
| `rebuild.sh` | Quick WASM rebuild (macOS/Linux) |
| `rebuild.ps1` | Quick WASM rebuild (Windows) |
| `flash.sh` | Interactive flasher (macOS/Linux) |
| `flash.ps1` | Interactive flasher (Windows) |

## 🆘 Troubleshooting

### Linux: Permission denied on USB
```bash
sudo usermod -a -G dialout $USER
# Log out and back in
```

### Windows: ESP32 not detected
Install USB drivers from Device Manager or manufacturer website

### Build fails: WASI-SDK not found
```bash
# macOS/Linux
export WASI_SDK_PATH=/opt/wasi-sdk

# Windows
$env:WASI_SDK_PATH = "C:\wasi-sdk"
```

### Windows: PATH not updated
Close and reopen PowerShell, or restart computer

## 📚 Documentation

- Full setup guide: [scripts/README.md](README.md)
- ESP32 documentation: [embedded/esp32/README.md](../README.md)
- ESP32 sketch guide: [embedded/esp32/esp32-sketch/README.md](../esp32-sketch/README.md)

## ⏱️ Estimated Setup Time

- **macOS**: 10-15 minutes
- **Linux**: 10-20 minutes (depends on package manager)
- **Windows**: 15-25 minutes (includes driver installation)

## 💾 Disk Space Required

- **macOS**: ~2GB
- **Linux**: ~2GB
- **Windows**: ~3GB
