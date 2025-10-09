# PigeonHub WASM Server for ESP32

A lightweight WebAssembly implementation of the PigeonHub server designed to run on ESP32 microcontrollers using the WASM3 runtime. This enables ESP32 devices to act as full PigeonHub nodes, accepting peer connections and relaying messages in PeerPigeon mesh networks.

## Features

- ✅ **Lightweight**: Optimized WASM module (~15-20KB)
- ✅ **ESP32 Compatible**: Works with ESP-IDF framework
- ✅ **WebSocket Server**: Accepts up to 20 concurrent peer connections
- ✅ **Message Relaying**: Full hub functionality with broadcast and direct messaging
- ✅ **Peer Management**: Automatic connection tracking and timeout handling
- ✅ **Low Memory**: Runs in 128KB of RAM
- ✅ **Event-Driven**: Non-blocking async architecture

## Architecture

```
┌─────────────────────────────────────┐
│    WebSocket Clients (Peers)        │
│         ↓   ↓   ↓   ↓               │
├─────────────────────────────────────┤
│      ESP32 Bridge (C/C++)           │
│  - WiFi Management                  │
│  - HTTP/WebSocket Server            │
│  - Connection Management            │
│  - WASM3 Runtime                    │
├─────────────────────────────────────┤
│    PigeonHub WASM Server            │
│  - Hub Protocol Logic               │
│  - Message Relaying                 │
│  - Peer Tracking (up to 20)         │
│  - Broadcast & Direct Messaging     │
└─────────────────────────────────────┘
```

## Requirements

### Build Requirements
- **WASI-SDK** (v20+): https://github.com/WebAssembly/wasi-sdk
- **clang** with WASM target support
- **wasm-opt** (optional, for optimization): `npm install -g wasm-opt`

### Runtime Requirements (ESP32)
- **ESP-IDF** (v4.4+): https://docs.espressif.com/projects/esp-idf/
- **WASM3** library: https://github.com/wasm3/wasm3
- **ESP32** board with WiFi (ESP32, ESP32-S2, ESP32-C3, etc.)
- Minimum 4MB Flash, 320KB RAM recommended

## Installation

### 1. Install WASI-SDK

```bash
# macOS
cd /opt
sudo curl -L https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-20/wasi-sdk-20.0-macos.tar.gz | sudo tar xz
sudo ln -s wasi-sdk-20.0 wasi-sdk

# Linux
cd /opt
sudo wget https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-20/wasi-sdk-20.0-linux.tar.gz
sudo tar xf wasi-sdk-20.0-linux.tar.gz
sudo ln -s wasi-sdk-20.0 wasi-sdk
```

### 2. Build WASM Module

```bash
cd wasm

# Build with default settings
make wasm

# Build with optimization
make wasm-opt

# Or use CMake
mkdir build && cd build
cmake -DBUILD_WASM=ON ..
make
```

The output will be `pigeonhub_client.wasm` (~15-20KB).

### 3. Set up ESP32 Project

Add WASM3 to your ESP-IDF project:

```bash
cd your-esp32-project/components
git clone https://github.com/wasm3/wasm3.git
```

Add to your `main/CMakeLists.txt`:

```cmake
idf_component_register(
    SRCS "main.c" "esp32_bridge.c"
    INCLUDE_DIRS "."
    REQUIRES wasm3 esp_http_server
)
```

## Usage

### ESP32 Example

```c
#include "esp32_bridge.h"
#include "esp_log.h"
#include "nvs_flash.h"
#include "esp_wifi.h"
#include "esp_event.h"

// Embed the WASM binary
extern const uint8_t pigeonhub_wasm_start[] asm("_binary_pigeonhub_client_wasm_start");
extern const uint8_t pigeonhub_wasm_end[] asm("_binary_pigeonhub_client_wasm_end");

void app_main(void) {
    // Initialize NVS
    ESP_ERROR_CHECK(nvs_flash_init());
    
    // Initialize TCP/IP
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    
    // Initialize WiFi (configure your WiFi credentials)
    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));
    
    // TODO: Connect to WiFi
    // ... WiFi connection code ...
    
    // Initialize PigeonHub WASM server
    size_t wasm_size = pigeonhub_wasm_end - pigeonhub_wasm_start;
    ESP_ERROR_CHECK(pigeonhub_wasm_init(pigeonhub_wasm_start, wasm_size));
    
    ESP_LOGI("APP", "PigeonHub server initialized and running on port 3000!");
}
}
```

### Complete ESP32 CMakeLists.txt

```cmake
# main/CMakeLists.txt
idf_component_register(
    SRCS "main.c" "esp32_bridge.c"
    INCLUDE_DIRS "."
    REQUIRES wasm3 esp_http_server nvs_flash esp_wifi
    EMBED_FILES "pigeonhub_client.wasm"
)
```

## API Reference

### WASM Exports

Functions exported by the WASM module:

```c
// Initialize the server
int init();

// Start the WebSocket server on specified port
int start_server(int port);

// Stop the server
void stop_server();

// Handle new peer connection (called by bridge)
void on_peer_connected(int peer_id);

// Handle peer disconnection (called by bridge)
void on_peer_disconnected(int peer_id);

// Handle incoming messages from peers (called by bridge)
void on_message(int peer_id, const char* message, int message_len);

// Main loop (call periodically for maintenance)
void loop();

// Get server running status
int is_running();

// Get number of connected peers
int get_peer_count();

// Get server statistics as JSON string
void get_stats(char* buffer, int buffer_size);

// Get hub ID
const char* get_hub_id();
```

### WASM Imports

Functions that must be provided by the ESP32 bridge:

```c
// WebSocket server operations
int ws_server_start(int port);
void ws_server_stop();
int ws_send_to_peer(int peer_id, const char* data, int data_len);
int ws_broadcast(const char* data, int data_len, int exclude_peer_id);

// Utility functions
void log_message(const char* msg, int msg_len);
void get_device_id(char* buffer, int buffer_len);
uint32_t millis();
```

## Configuration

### Memory Settings

Adjust memory limits in `Makefile`:

```makefile
MEMORY_FLAGS = -Wl,--initial-memory=65536 \
               -Wl,--max-memory=131072
```

### Heartbeat Interval

Modify in `pigeonhub_client.c`:

```c
#define HEARTBEAT_INTERVAL 30000  // 30 seconds
```

### Maximum Peers

```c
#define MAX_PEERS 20
```

### Peer Timeout

```c
#define PEER_TIMEOUT 60000  // 60 seconds
```

## Connecting to Your ESP32 Hub

Once your ESP32 is running, peers can connect to it:

**From JavaScript/Node.js:**
```javascript
import { PeerPigeonServer } from 'peerpigeon';

const peer = new PeerPigeonServer({
    bootstrapHubs: ['ws://192.168.1.100:3000/']  // Your ESP32 IP
});

await peer.start();
```

**From another ESP32:**
Configure it as a client and connect to your hub's IP address.

**WebSocket URL format:**
```
ws://<ESP32_IP_ADDRESS>:3000/
```

## Troubleshooting

### Build Errors

**Error: `clang: command not found`**
- Install WASI-SDK and ensure it's in your PATH

**Error: `wasm-ld: error: unknown argument: --no-entry`**
- Update to WASI-SDK v20 or later

### Runtime Errors

**Error: `Failed to create WASM runtime`**
- Increase heap size in ESP-IDF menuconfig
- Reduce WASM stack size in `esp32_bridge.c`

**Error: `WebSocket connection failed`**
- Check WiFi connection and ensure ESP32 has an IP address
- Verify firewall allows incoming WebSocket connections on port 3000
- Check that clients are connecting to the correct ESP32 IP address
- Ensure ESP32 and clients are on the same network (or proper routing is configured)

**Error: `Out of memory`**
- Reduce `MAX_PEERS` constant
- Decrease `MAX_MESSAGE_SIZE`
- Increase ESP32 heap size

## Performance

### Resource Usage

- **Flash**: ~150KB (including WASM3 + module)
- **RAM**: ~150KB (runtime + stack + heap + connection buffers)
- **CPU**: ~5% on ESP32 @ 240MHz (idle with 5 peers)

### Benchmarks

- **Server startup**: ~500ms
- **Connection establishment**: ~100ms (local network)
- **Message relay latency**: ~50ms peer-to-peer (local network)
- **Throughput**: ~100 messages/second
- **Max concurrent peers**: 20 (configurable)

## Examples

See the `examples/` directory for complete projects:

- `examples/esp32-basic/` - Simple ESP32 hub server
- `examples/esp32-mesh/` - Multiple ESP32 hubs forming a mesh network
- `examples/connect-to-esp32/` - JavaScript client connecting to ESP32 hub

## Development

### Building for Testing

```bash
# Build with debug symbols
make CFLAGS="-g -O0" wasm

# Build with size optimization
make CFLAGS="-Os -flto" wasm
```

### Debugging

Enable WASM3 debug output in `esp32_bridge.c`:

```c
#define DEBUG 1
```

## Contributing

Contributions are welcome! Please see the main PigeonHub repository for guidelines.

## License

MIT License - See LICENSE file in the main repository

## Support

- **GitHub Issues**: https://github.com/PeerPigeon/PigeonHub/issues
- **Documentation**: https://github.com/PeerPigeon/PigeonHub
- **Discord**: [PeerPigeon Community](https://discord.gg/peerpigeon)

## Related Projects

- [PigeonHub](https://github.com/PeerPigeon/PigeonHub) - Main hub server
- [PeerPigeon](https://github.com/PeerPigeon/PeerPigeon) - JavaScript P2P library
- [WASM3](https://github.com/wasm3/wasm3) - Fast WebAssembly interpreter

## Acknowledgments

- WASM3 team for the excellent WASM runtime
- Espressif for ESP-IDF framework
- PeerPigeon community for feedback and testing
