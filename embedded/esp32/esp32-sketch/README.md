# PigeonHub ESP32 Sketch - Complete Build Package

This folder contains everything needed to build and flash the PigeonHub server to your ESP32!

## ✨ Features

- � **WiFi Captive Portal** - No hardcoded credentials! Easy web-based setup
- 🌐 **WebSocket Server** - Handles up to 20 concurrent peer connections
- 🧠 **WASM-Powered** - Protocol logic runs in WebAssembly
- 📱 **Mobile Friendly** - Beautiful responsive setup interface
- 💾 **Persistent Config** - WiFi settings saved to flash memory

## �📦 Contents

- `esp32-sketch.ino` - Main Arduino sketch with captive portal
- `pigeonhub_client.wasm` - Pre-compiled WASM module (7.8 KB)
- `platformio.ini` - PlatformIO configuration
- `README.md` - This file

## 🚀 Quick Start

### First Time Setup

1. **Flash the Sketch** (see installation options below)
2. **Connect to WiFi**
   - Look for WiFi network: `PigeonHub-Setup`
   - Password: `pigeonhub`
   - Open any website (browser will redirect automatically)
   - Or go to: http://192.168.4.1
3. **Configure WiFi**
   - Click "Scan Networks"
   - Select your WiFi network
   - Enter password
   - Click "Save & Connect"
4. **Done!** Device will connect and show the server URL

### Normal Operation

After initial setup:
- ESP32 automatically connects to saved WiFi
- WebSocket server starts on port 3000
- Get the server URL from Serial Monitor: `ws://YOUR_IP:3000/`

### Reset WiFi

To change WiFi settings:
- Connect to Serial Monitor
- Visit: http://YOUR_IP/api/reset
- Device will restart in setup mode

## 📥 Installation Options

### Option 1: Arduino IDE

1. **Install Arduino IDE** (2.0 or later)
   - Download from: https://www.arduino.cc/en/software

2. **Install ESP32 Board Support**
   - Open Arduino IDE
   - Go to File → Preferences
   - Add to "Additional Board Manager URLs":
     ```
     https://espressif.github.io/arduino-esp32/package_esp32_index.json
     ```
   - Go to Tools → Board → Boards Manager
   - Search for "esp32" and install "ESP32 by Espressif Systems"

3. **Install Required Libraries**
   - Go to Tools → Manage Libraries
   - Install: `WebSockets by Markus Sattler`
   - Install: `Wasm3`

4. **Open the Sketch**
   - File → Open → Select `esp32-sketch.ino`

5. **Select Your Board**
   - Tools → Board → ESP32 Arduino → Your ESP32 model

6. **Upload**
   - Connect your ESP32 via USB
   - Select the correct port: Tools → Port
   - Click Upload button

### Option 2: PlatformIO (Recommended)

1. **Install PlatformIO**
   ```bash
   # Install VS Code extension, or use CLI:
   pip install platformio
   ```

2. **Build and Upload**
   ```bash
   cd esp32-sketch
   pio run --target upload --target monitor
   ```

## 📋 Configuration

### Access Point Settings (Setup Mode)

Edit in `esp32-sketch.ino` if you want to change AP credentials:
```cpp
const char* AP_SSID = "PigeonHub-Setup";  // WiFi network name in setup mode
const char* AP_PASSWORD = "pigeonhub";    // WiFi password in setup mode
```

### Server Port

Default is 3000. To change:
```cpp
const int SERVER_PORT = 3000;  // Change this
```

### Max Connections

Default is 20 peers. To change:
```cpp
const int MAX_CONNECTIONS = 20;  // Change this
```

## 🔍 Monitoring

After upload, open Serial Monitor:
- **Arduino IDE**: Tools → Serial Monitor (115200 baud)
- **PlatformIO**: `pio device monitor`

### First Boot (Setup Mode)
```
====================================
  PigeonHub ESP32 Server
====================================
Free heap: 289234 bytes

No WiFi configuration found
Starting configuration portal...
Starting Access Point mode...
AP SSID: PigeonHub-Setup
AP Password: pigeonhub
AP IP: 192.168.4.1
Setup portal ready!
1. Connect to WiFi: PigeonHub-Setup
2. Open: http://192.168.4.1
```

### After WiFi Configuration
```
====================================
  PigeonHub ESP32 Server
====================================
Free heap: 289234 bytes

Found saved WiFi configuration
Connecting to WiFi: YourNetwork
.......
WiFi connected!
IP address: 192.168.1.100
Server URL: ws://192.168.1.100:3000/

[WASM] Initializing PigeonHub WASM server...
[WASM] Hub ID: esp32-a1b2c3d4e5f6
====================================
  PigeonHub Server Running!
  Port: 3000
  Max Peers: 20
====================================
```

## 🧪 Testing Your Server

### From Browser Console

```javascript
const ws = new WebSocket('ws://192.168.1.100:3000/');
ws.onopen = () => {
    console.log('Connected!');
    ws.send(JSON.stringify({
        type: 'join',
        peerId: 'test-client-123'
    }));
};
ws.onmessage = (e) => console.log('Message:', e.data);
```

### From Node.js

```javascript
import { PeerPigeonServer } from 'peerpigeon';

const peer = new PeerPigeonServer({
    bootstrapHubs: ['ws://192.168.1.100:3000/']
});

await peer.start();
console.log('Connected to ESP32 hub!');
```

### Using wscat

```bash
npm install -g wscat
wscat -c ws://192.168.1.100:3000/
```

## 📊 Expected Output

When peers connect:
```
WebSocket [0] connected from 192.168.1.50
Assigned peer_id: 1
[WASM] Peer connected: 1 (total: 1)
```

When messages are received:
```
[WASM] Broadcasting from test-client-123
```

## 🐛 Troubleshooting

### Upload Failed

**Error: "A fatal error occurred: Failed to connect to ESP32"**
- Hold the BOOT button while uploading
- Check USB cable (must support data, not just charging)
- Try a different USB port
- Check driver installation (CP210x or CH340)

### WiFi Connection Failed

**Error: "Failed to connect to WiFi!"**
- Double-check SSID and password
- Ensure WiFi is 2.4GHz (ESP32 doesn't support 5GHz)
- Move ESP32 closer to router

### Out of Memory

**Error: "Failed to create WASM runtime"**
- Use ESP32 with PSRAM (ESP32-WROVER, ESP32-S3)
- Reduce MAX_CONNECTIONS
- Enable PSRAM in Arduino IDE: Tools → PSRAM → Enabled

### Compilation Errors

**Error: "WebSockets.h: No such file"**
```bash
# Arduino IDE
Tools → Manage Libraries → Install "WebSockets"

# PlatformIO
pio lib install "WebSockets"
```

**Error: "wasm3.h: No such file"**
```bash
# Arduino IDE
Tools → Manage Libraries → Install "Wasm3"

# PlatformIO
pio lib install "Wasm3"
```

## 🔧 Advanced Configuration

### Using Different ESP32 Boards

**ESP32-S3:**
```ini
board = esp32-s3-devkitc-1
```

**ESP32-C3:**
```ini
board = esp32-c3-devkitm-1
```

### Enabling PSRAM

In `platformio.ini`:
```ini
build_flags = 
    -DBOARD_HAS_PSRAM
    -mfix-esp32-psram-cache-issue
```

### Custom Partition Table

For larger applications, use `huge_app.csv` partition:
```ini
board_build.partitions = huge_app.csv
```

## 📝 How It Works

1. **ESP32 boots** and connects to WiFi
2. **WASM3 runtime** initializes with 64KB stack
3. **WASM module** (`pigeonhub_client.wasm`) is loaded
4. **WebSocket server** starts on port 3000
5. **Peers connect** via WebSocket
6. **WASM handles** all protocol logic:
   - Message routing
   - Peer management
   - Broadcast/direct messaging
7. **ESP32 provides** hardware abstraction:
   - Network I/O
   - Memory management
   - System calls

## 🎯 What You Get

✅ Full PigeonHub server running on ESP32  
✅ Up to 20 concurrent peer connections  
✅ Message relaying (broadcast + direct)  
✅ Peer discovery and management  
✅ WebSocket server on port 3000  
✅ Only ~150KB RAM usage  
✅ Compatible with PeerPigeon ecosystem  

## 📚 Resources

- **PigeonHub Docs**: ../README.md
- **Build Guide**: ../BUILD.md
- **WASM Source**: ../pigeonhub_client.c
- **ESP32 Bridge**: ../esp32_bridge.c

## 🆘 Support

If you encounter issues:
1. Check the serial monitor output
2. Verify WiFi credentials
3. Ensure sufficient power supply (500mA+)
4. Try a different ESP32 board
5. Open an issue on GitHub

## ✨ Ready to Deploy!

Your ESP32 PigeonHub server is ready to go. Just:
1. Update WiFi credentials
2. Upload to your ESP32
3. Note the IP address from serial monitor
4. Connect peers to `ws://YOUR_ESP32_IP:3000/`

Happy meshing! 🚀
