/*
 * PigeonHub ESP32 Server
 * 
 * A complete WebAssembly-powered PigeonHub server running on ESP32.
 * This sketch turns your ESP32 into a mesh network hub that accepts
 * peer connections and relays messages.
 * 
 * Features:
 * - WiFi Captive Portal for easy setup (no hardcoded credentials!)
 * - WebSocket server for peer connections
 * - WASM-powered protocol logic
 * 
 * Hardware: ESP32, ESP32-S2, ESP32-S3, ESP32-C3
 * Framework: Arduino/ESP-IDF
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <WebSocketsServer.h>
#include <WebSocketsClient.h>
#include <Preferences.h>
#include <DNSServer.h>
#include <ESPmDNS.h>
#include <esp_efuse.h>
#include <mbedtls/sha1.h>
#include "wasm3.h"
#include "m3_env.h"
#include "wasm_data.h"

// WASM3 Error Handling Macro
#define _(call) { M3Result res = call; if (res) { result = res; goto _catch; } }

// ============================================================================
// Configuration
// ============================================================================

// Access Point Configuration (ALWAYS AVAILABLE)
const char* AP_SSID = "PigeonHub-Setup";
const char* AP_PASSWORD = "pigeonhub123";  // At least 8 characters

// Server Configuration
const int SERVER_PORT = 3000;
const int MAX_CONNECTIONS = 20;
const int DNS_PORT = 53;

// PigeonHub Configuration - THIS IS A HUB SERVER!
const char* HUB_MESH_NAMESPACE = "pigeonhub-mesh";
const char* BOOTSTRAP_HUB = "wss://pigeonhub.fly.dev/";
String hubPeerId = "";  // Generated on startup
bool isHub = true;  // This device IS a hub

// WiFi credentials storage
Preferences preferences;
String stored_ssid = "";
String stored_password = "";
bool wifi_configured = false;
bool is_sta_connected = false;

// ============================================================================
// WebSocket Server & Web Server
// ============================================================================

WebSocketsServer webSocket = WebSocketsServer(SERVER_PORT);
WebSocketsClient bootstrapHub;  // Connection to bootstrap hub
WebServer webServer(80);
DNSServer dnsServer;

// Bootstrap hub state
bool bootstrapConnected = false;
unsigned long lastBootstrapAttempt = 0;
const unsigned long BOOTSTRAP_RETRY_INTERVAL = 10000;  // 10 seconds

// Connection tracking
struct Connection {
    uint8_t num;
    int peer_id;  // Internal numeric ID
    String clientPeerId;  // Client's 40-char hex peer ID
    String networkName;  // Client's network namespace from announce
    bool active;
    unsigned long last_seen;
};

Connection connections[MAX_CONNECTIONS];
int next_peer_id = 1;

// ============================================================================
// WASM3 Runtime
// ============================================================================

IM3Environment wasm_env = NULL;
IM3Runtime wasm_runtime = NULL;
IM3Module wasm_module = NULL;

// WASM function pointers
IM3Function wasm_init = NULL;
IM3Function wasm_start_server = NULL;
IM3Function wasm_on_peer_connected = NULL;
IM3Function wasm_on_peer_disconnected = NULL;
IM3Function wasm_on_message = NULL;
IM3Function wasm_loop = NULL;

// WASM binary is included from wasm_data.h
extern const uint8_t pigeonhub_wasm_data[];
extern const size_t pigeonhub_wasm_size;

// ============================================================================
// Connection Management
// ============================================================================

Connection* findConnectionByNum(uint8_t num) {
    for (int i = 0; i < MAX_CONNECTIONS; i++) {
        if (connections[i].active && connections[i].num == num) {
            return &connections[i];
        }
    }
    return NULL;
}

Connection* findConnectionByPeerId(int peer_id) {
    for (int i = 0; i < MAX_CONNECTIONS; i++) {
        if (connections[i].active && connections[i].peer_id == peer_id) {
            return &connections[i];
        }
    }
    return NULL;
}

Connection* addConnection(uint8_t num, String clientPeerId = "") {
    for (int i = 0; i < MAX_CONNECTIONS; i++) {
        if (!connections[i].active) {
            connections[i].num = num;
            connections[i].peer_id = next_peer_id++;
            connections[i].clientPeerId = clientPeerId;
            connections[i].active = true;
            connections[i].last_seen = millis();
            return &connections[i];
        }
    }
    return NULL;
}

void removeConnection(uint8_t num) {
    for (int i = 0; i < MAX_CONNECTIONS; i++) {
        if (connections[i].active && connections[i].num == num) {
            connections[i].active = false;
            break;
        }
    }
}

// ============================================================================
// WiFi Configuration Web Pages (Minimal versions to save memory)
// ============================================================================

const char SETUP_HTML[] PROGMEM = R"=====(
<html><head><meta name="viewport" content="width=device-width"><title>PigeonHub Setup</title>
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
<meta http-equiv="Pragma" content="no-cache">
<meta http-equiv="Expires" content="0">
</head>
<body><h1>PigeonHub WiFi Setup</h1>
<p>MAC: <span id="m"></span></p>
<div id="s" style="display:none"><p>Connected: <span id="n"></span> (<span id="i"></span>)</p></div>
<button onclick="scan()">Scan Networks</button>
<form onsubmit="return save(event)">
<label>Network: <select id="ssid" required><option value="">Select...</option></select></label><br>
<label>Password: <input type="password" id="pwd" required></label><br>
<div id="cp" style="display:none"><label>Current Password: <input type="password" id="cpwd"></label><br></div>
<button type="submit">Save & Connect</button>
</form>
<div id="status"></div>
<script>
let conn=false,curr='';
// Keep portal alive by periodically checking captive portal detection
setInterval(()=>{
fetch('/hotspot-detect.html',{cache:'no-cache'}).catch(()=>{});
},5000);
fetch('/api/info').then(r=>r.json()).then(d=>{
document.getElementById('m').textContent=d.mac;
if(d.connected&&d.ssid){conn=true;curr=d.ssid;
document.getElementById('s').style.display='block';
document.getElementById('n').textContent=d.ssid;
document.getElementById('i').textContent=d.ip;
document.getElementById('cp').style.display='block';}
}).catch(()=>{});
function scan(){
document.getElementById('status').textContent='Scanning...';
fetch('/api/scan').then(r=>r.json()).then(d=>{
if(d.status==='scanning'){
setTimeout(scan,1000);return;
}
let s=document.getElementById('ssid');
s.innerHTML='<option value="">Select...</option>';
d.networks.forEach(n=>{
let o=document.createElement('option');
o.value=n.ssid;
o.textContent=n.ssid+(n.ssid===curr?' (Current)':'');
s.appendChild(o);
});
document.getElementById('status').textContent='';
}).catch(()=>{document.getElementById('status').textContent='Scan failed';});
}
function save(e){
e.preventDefault();
let data={ssid:document.getElementById('ssid').value,password:document.getElementById('pwd').value};
if(conn)data.currentPassword=document.getElementById('cpwd').value;
fetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})
.then(r=>r.json()).then(d=>{
if(d.success){alert('Connected! Restarting...');setTimeout(()=>window.location.href='/success',2000);}
else alert(d.error||'Failed');
}).catch(()=>alert('Network error'));
return false;
}
window.onload=()=>setTimeout(scan,500);
</script></body></html>
)=====";

const char SUCCESS_HTML[] PROGMEM = R"=====(
<html><head><meta name="viewport" content="width=device-width"><title>PigeonHub Connected</title></head>
<body><h1>Connected!</h1>
<p>Server URL: <code id="u"></code></p>
<script>fetch('/api/info').then(r=>r.json()).then(d=>document.getElementById('u').textContent='ws://'+d.ip+':'+d.port+'/');</script>
</body></html>
)=====";

// ============================================================================
// Web Server Handlers
// ============================================================================

void handleCaptivePortal() {
    // For Apple captive portal detection, we need to return HTML but NOT the success page
    // Apple expects specific behavior: if we return their success page, portal closes
    // If we return our content, portal stays open
    webServer.sendHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    webServer.sendHeader("Pragma", "no-cache");
    webServer.sendHeader("Expires", "0");
    
    // Return our setup page to keep portal open
    webServer.send(200, "text/html", SETUP_HTML);
}

void handleRoot() {
    webServer.send(200, "text/html", SETUP_HTML);
}

void handleSuccess() {
    webServer.send(200, "text/html", SUCCESS_HTML);
}

void handleInfo() {
    uint8_t mac[6];
    esp_efuse_mac_get_default(mac);
    char macStr[18];
    sprintf(macStr, "%02X:%02X:%02X:%02X:%02X:%02X", 
            mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    
    String json = "{";
    json += "\"mac\":\"" + String(macStr) + "\",";
    json += "\"ip\":\"" + WiFi.localIP().toString() + "\",";
    json += "\"port\":" + String(SERVER_PORT) + ",";
    json += "\"connected\":" + String(is_sta_connected ? "true" : "false");
    
    // Always show stored SSID if one exists
    if (stored_ssid.length() > 0) {
        json += ",\"ssid\":\"" + stored_ssid + "\"";
    }
    
    json += "}";
    
    webServer.send(200, "application/json", json);
}

void handleScan() {
    Serial.println("Scanning WiFi networks (async)...");
    
    // Use async scan to avoid blocking and disrupting AP
    int n = WiFi.scanComplete();
    
    if (n == WIFI_SCAN_RUNNING) {
        // Scan already in progress
        webServer.send(202, "application/json", "{\"status\":\"scanning\"}");
        return;
    } else if (n == WIFI_SCAN_FAILED) {
        // Scan failed, start new one
        WiFi.scanNetworks(true);  // true = async
        webServer.send(202, "application/json", "{\"status\":\"scanning\"}");
        return;
    } else if (n == 0) {
        // No results yet, start scan
        WiFi.scanNetworks(true);  // true = async
        webServer.send(202, "application/json", "{\"status\":\"scanning\"}");
        return;
    }
    
    // We have results!
    String json = "{\"networks\":[";
    for (int i = 0; i < n; i++) {
        if (i > 0) json += ",";
        json += "{";
        json += "\"ssid\":\"" + WiFi.SSID(i) + "\",";
        json += "\"rssi\":" + String(WiFi.RSSI(i)) + ",";
        json += "\"secure\":" + String(WiFi.encryptionType(i) != WIFI_AUTH_OPEN);
        json += "}";
    }
    json += "]}";
    
    // Delete scan results to free memory
    WiFi.scanDelete();
    
    webServer.send(200, "application/json", json);
}

void handleSave() {
    if (!webServer.hasArg("plain")) {
        webServer.send(400, "application/json", "{\"success\":false,\"error\":\"No data\"}");
        return;
    }
    
    String body = webServer.arg("plain");
    
    // Parse SSID
    int ssidStart = body.indexOf("\"ssid\":\"") + 8;
    int ssidEnd = body.indexOf("\"", ssidStart);
    String ssid = body.substring(ssidStart, ssidEnd);
    
    // Parse password
    int passStart = body.indexOf("\"password\":\"") + 12;
    int passEnd = body.indexOf("\"", passStart);
    String password = body.substring(passStart, passEnd);
    
    // Parse current password (if provided)
    String currentPassword = "";
    int currPassStart = body.indexOf("\"currentPassword\":\"");
    if (currPassStart != -1) {
        currPassStart += 19;
        int currPassEnd = body.indexOf("\"", currPassStart);
        currentPassword = body.substring(currPassStart, currPassEnd);
    }
    
    if (ssid.length() == 0) {
        webServer.send(400, "application/json", "{\"success\":false,\"error\":\"SSID required\"}");
        return;
    }
    
    // If already connected to WiFi, verify current password
    if (is_sta_connected && stored_password.length() > 0) {
        if (currentPassword != stored_password) {
            Serial.println("Password verification failed");
            webServer.send(403, "application/json", "{\"success\":false,\"error\":\"Current password incorrect\"}");
            return;
        }
        Serial.println("Password verified, updating WiFi config");
    }
    
    // Save new credentials
    preferences.begin("wifi", false);
    preferences.putString("ssid", ssid);
    preferences.putString("password", password);
    preferences.end();
    
    Serial.println("WiFi credentials saved: " + ssid);
    Serial.printf("SSID length: %d, Password length: %d\n", ssid.length(), password.length());
    Serial.printf("SSID hex: ");
    for(int i=0; i<ssid.length(); i++) Serial.printf("%02X ", ssid[i]);
    Serial.printf("\nPassword hex: ");
    for(int i=0; i<password.length(); i++) Serial.printf("%02X ", password[i]);
    Serial.println();
    
    // Update stored credentials
    stored_ssid = ssid;
    stored_password = password;
    
    // Ensure we stay in AP+STA mode
    WiFi.mode(WIFI_AP_STA);
    delay(100);
    
    // Try to connect to WiFi immediately (non-blocking)
    Serial.println("Attempting WiFi connection...");
    WiFi.begin(stored_ssid.c_str(), stored_password.c_str());
    
    webServer.send(200, "application/json", "{\"success\":true,\"message\":\"Connecting to WiFi...\"}");
    
    // NO RESTART - let it connect in the background
}

void handleReset() {
    Serial.println("\n⚠️ WiFi credentials reset requested");
    preferences.begin("wifi", false);
    preferences.clear();
    preferences.end();
    
    webServer.send(200, "text/html", 
        "<html><body><h1>Reset Complete</h1><p>Device restarting...</p></body></html>");
    
    Serial.println("✅ Credentials cleared, restarting...");
    delay(1000);
    ESP.restart();
}

// ============================================================================
// WiFi Management
// ============================================================================

void WiFiEvent(WiFiEvent_t event, WiFiEventInfo_t info) {
    switch(event) {
        case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
            {
                uint8_t reason = info.wifi_sta_disconnected.reason;
                // Just log disconnection, let WiFi auto-reconnect handle it
                Serial.printf("⚠️ WiFi disconnected (reason: %d)\n", reason);
            }
            break;
            
        case ARDUINO_EVENT_WIFI_STA_CONNECTED:
            Serial.println("✅ WiFi connected successfully!");
            break;
            
        default:
            break;
    }
}

bool loadWiFiConfig() {
    preferences.begin("wifi", true);
    stored_ssid = preferences.getString("ssid", "");
    stored_password = preferences.getString("password", "");
    preferences.end();
    
    return (stored_ssid.length() > 0);
}

bool connectToWiFi() {
    if (stored_ssid.length() == 0) {
        return false;
    }
    
    Serial.printf("Connecting to WiFi: %s (non-blocking)\n", stored_ssid.c_str());
    
    // Connect with stored credentials (NON-BLOCKING)
    // Connection happens in background, status checked in loop()
    WiFi.begin(stored_ssid.c_str(), stored_password.c_str());
    
    Serial.println("WiFi connection initiated in background");
    Serial.println("Captive portal remains active during connection");
    
    return false; // Not connected yet, will connect in background
}

// ============================================================================
// WASM Import Functions
// ============================================================================

m3ApiRawFunction(m3_ws_server_start) {
    m3ApiReturnType(int32_t);
    m3ApiGetArg(int32_t, port);
    
    Serial.printf("WASM: Starting server on port %d\n", port);
    // Server is already started, just return success
    m3ApiReturn(0);
}

m3ApiRawFunction(m3_ws_server_stop) {
    m3ApiReturnType(void);
    Serial.println("WASM: Server stop requested");
    m3ApiSuccess();
}

m3ApiRawFunction(m3_ws_send_to_peer) {
    m3ApiReturnType(int32_t);
    m3ApiGetArg(int32_t, peer_id);
    m3ApiGetArgMem(const char*, data);
    m3ApiGetArg(int32_t, data_len);
    
    Connection* conn = findConnectionByPeerId(peer_id);
    if (!conn) {
        m3ApiReturn(-1);
    }
    
    webSocket.sendTXT(conn->num, data, data_len);
    m3ApiReturn(data_len);
}

m3ApiRawFunction(m3_ws_broadcast) {
    m3ApiReturnType(int32_t);
    m3ApiGetArgMem(const char*, data);
    m3ApiGetArg(int32_t, data_len);
    m3ApiGetArg(int32_t, exclude_peer_id);
    
    int sent_count = 0;
    for (int i = 0; i < MAX_CONNECTIONS; i++) {
        if (connections[i].active && connections[i].peer_id != exclude_peer_id) {
            webSocket.sendTXT(connections[i].num, data, data_len);
            sent_count++;
        }
    }
    
    m3ApiReturn(sent_count);
}

m3ApiRawFunction(m3_log_message) {
    m3ApiReturnType(void);
    m3ApiGetArgMem(const char*, msg);
    m3ApiGetArg(int32_t, msg_len);
    
    char buf[256];
    int len = msg_len < 255 ? msg_len : 255;
    memcpy(buf, msg, len);
    buf[len] = '\0';
    
    Serial.printf("[WASM] %s\n", buf);
    m3ApiSuccess();
}

m3ApiRawFunction(m3_get_device_id) {
    m3ApiReturnType(void);
    m3ApiGetArgMem(char*, buffer);
    m3ApiGetArg(int32_t, buffer_len);
    
    uint8_t mac[6];
    esp_efuse_mac_get_default(mac);
    
    snprintf(buffer, buffer_len, "esp32-%02x%02x%02x%02x%02x%02x",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    
    m3ApiSuccess();
}

m3ApiRawFunction(m3_millis) {
    m3ApiReturnType(uint32_t);
    m3ApiReturn((uint32_t)millis());
}

// ============================================================================
// WASM Module Loading
// ============================================================================

M3Result linkWasmImports(IM3Module module) {
    M3Result result = m3Err_none;
    const char* env = "env";
    
    _(m3_LinkRawFunction(module, env, "ws_server_start", "i(i)", &m3_ws_server_start));
    _(m3_LinkRawFunction(module, env, "ws_server_stop", "v()", &m3_ws_server_stop));
    _(m3_LinkRawFunction(module, env, "ws_send_to_peer", "i(iii)", &m3_ws_send_to_peer));
    _(m3_LinkRawFunction(module, env, "ws_broadcast", "i(iii)", &m3_ws_broadcast));
    _(m3_LinkRawFunction(module, env, "log_message", "v(ii)", &m3_log_message));
    _(m3_LinkRawFunction(module, env, "get_device_id", "v(ii)", &m3_get_device_id));
    _(m3_LinkRawFunction(module, env, "millis", "i()", &m3_millis));
    
_catch:
    return result;
}

bool loadWasmModule() {
    M3Result result = m3Err_none;
    
    Serial.println("Initializing WASM3 runtime...");
    Serial.printf("WASM binary size: %d bytes\n", pigeonhub_wasm_size);
    
    // Create environment
    wasm_env = m3_NewEnvironment();
    if (!wasm_env) {
        Serial.println("Failed to create WASM environment");
        return false;
    }
    
    // Create runtime with 32KB stack (reduced for ESP32-C3)
    wasm_runtime = m3_NewRuntime(wasm_env, 32 * 1024, NULL);
    if (!wasm_runtime) {
        Serial.println("Failed to create WASM runtime");
        return false;
    }
    
    // Parse module
    result = m3_ParseModule(wasm_env, &wasm_module, pigeonhub_wasm_data, pigeonhub_wasm_size);
    if (result) {
        Serial.printf("Failed to parse WASM module: %s\n", result);
        return false;
    }
    
    // Load module
    result = m3_LoadModule(wasm_runtime, wasm_module);
    if (result) {
        Serial.printf("Failed to load WASM module: %s\n", result);
        return false;
    }
    
    // Link imports
    result = linkWasmImports(wasm_module);
    if (result) {
        Serial.printf("Failed to link imports: %s\n", result);
        return false;
    }
    
    // Find functions
    result = m3_FindFunction(&wasm_init, wasm_runtime, "init");
    if (result) {
        Serial.printf("Failed to find init: %s\n", result);
        return false;
    }
    
    result = m3_FindFunction(&wasm_start_server, wasm_runtime, "start_server");
    if (result) {
        Serial.printf("Failed to find start_server: %s\n", result);
        return false;
    }
    
    result = m3_FindFunction(&wasm_on_peer_connected, wasm_runtime, "on_peer_connected");
    if (result) {
        Serial.printf("Failed to find on_peer_connected: %s\n", result);
        return false;
    }
    
    result = m3_FindFunction(&wasm_on_peer_disconnected, wasm_runtime, "on_peer_disconnected");
    if (result) {
        Serial.printf("Failed to find on_peer_disconnected: %s\n", result);
        return false;
    }
    
    result = m3_FindFunction(&wasm_on_message, wasm_runtime, "on_message");
    if (result) {
        Serial.printf("Failed to find on_message: %s\n", result);
        return false;
    }
    
    result = m3_FindFunction(&wasm_loop, wasm_runtime, "loop");
    if (result) {
        Serial.printf("Failed to find loop: %s\n", result);
        return false;
    }
    
    Serial.println("WASM module loaded successfully!");
    
    // Call init
    result = m3_CallV(wasm_init);
    if (result) {
        Serial.printf("Failed to call init: %s\n", result);
        return false;
    }
    
    // Call start_server
    result = m3_CallV(wasm_start_server, SERVER_PORT);
    if (result) {
        Serial.printf("Failed to call start_server: %s\n", result);
        return false;
    }
    
    return true;
}

// ============================================================================
// WebSocket Event Handler
// ============================================================================

// Helper to send JSON message
void sendJSON(uint8_t num, String json) {
    webSocket.sendTXT(num, json);
    Serial.printf("[WS] Sent: %s\n", json.c_str());
}

// ============================================================================
// Bootstrap Hub WebSocket Event Handler
// ============================================================================

void bootstrapHubEvent(WStype_t type, uint8_t* payload, size_t length) {
    switch(type) {
        case WStype_DISCONNECTED:
            Serial.println("[BOOTSTRAP] Disconnected from bootstrap hub");
            bootstrapConnected = false;
            break;
            
        case WStype_CONNECTED:
            Serial.println("[BOOTSTRAP] ✅ Connected to bootstrap hub!");
            bootstrapConnected = true;
            
            // Announce this hub to the bootstrap hub
            {
                String announce = "{\"type\":\"announce\"," +
                                String("\"data\":{\"peerId\":\"") + hubPeerId + 
                                "\",\"isHub\":true,\"port\":" + String(SERVER_PORT) + 
                                ",\"ip\":\"" + WiFi.localIP().toString() + 
                                "\",\"capabilities\":[\"signaling\",\"relay\"]" +
                                "},\"networkName\":\"" + String(HUB_MESH_NAMESPACE) + 
                                "\",\"maxPeers\":" + String(MAX_CONNECTIONS) + "}";
                bootstrapHub.sendTXT(announce);
                Serial.printf("[BOOTSTRAP] 📢 Announced as hub with peerId: %s\n", hubPeerId.substring(0, 8).c_str());
                Serial.printf("[BOOTSTRAP] 📢 Network namespace: %s\n", HUB_MESH_NAMESPACE);
            }
            break;
            
        case WStype_TEXT:
            {
                String msg = String((char*)payload);
                Serial.printf("[BOOTSTRAP] <<< Received %d bytes\n", length);
                
                // Parse message type
                int typeStart = msg.indexOf("\"type\":\"") + 8;
                int typeEnd = msg.indexOf("\"", typeStart);
                if (typeStart < 8 || typeEnd <= typeStart) {
                    Serial.printf("[BOOTSTRAP] ⚠️ Could not parse message type: %s\n", msg.substring(0, 100).c_str());
                    return;
                }
                String msgType = msg.substring(typeStart, typeEnd);
                Serial.printf("[BOOTSTRAP] Message type: %s\n", msgType.c_str());
                
                if (msgType == "connected") {
                    Serial.println("[BOOTSTRAP] ✅ Server confirmed connection");
                    return;
                }
                
                if (msgType == "peer-discovered") {
                    // A peer on another hub was discovered
                    // Extract peerId and networkName
                    int peerIdStart = msg.indexOf("\"peerId\":\"") + 10;
                    int peerIdEnd = msg.indexOf("\"", peerIdStart);
                    int networkStart = msg.indexOf("\"networkName\":\"") + 15;
                    int networkEnd = msg.indexOf("\"", networkStart);
                    
                    if (peerIdStart > 9 && networkStart > 14) {
                        String remotePeerId = msg.substring(peerIdStart, peerIdEnd);
                        String remoteNetwork = msg.substring(networkStart, networkEnd);
                        
                        Serial.printf("[BOOTSTRAP] 📥 Remote peer discovered: %s in network: %s\n", 
                                     remotePeerId.substring(0, 8).c_str(), remoteNetwork.c_str());
                        
                        // Forward to all LOCAL peers in the same network
                        for (int i = 0; i < MAX_CONNECTIONS; i++) {
                            if (connections[i].active && connections[i].networkName == remoteNetwork) {
                                webSocket.sendTXT(connections[i].num, payload, length);
                                Serial.printf("[BOOTSTRAP] Forwarded to local peer %s\n", 
                                            connections[i].clientPeerId.substring(0, 8).c_str());
                            }
                        }
                    }
                    
                } else if (msgType == "offer" || msgType == "answer" || msgType == "ice-candidate") {
                    // WebRTC signaling from a remote peer
                    int targetStart = msg.indexOf("\"targetPeerId\":\"") + 16;
                    int targetEnd = msg.indexOf("\"", targetStart);
                    
                    if (targetStart > 15) {
                        String targetPeerId = msg.substring(targetStart, targetEnd);
                        Serial.printf("[BOOTSTRAP] 📥 Signaling %s for %s\n", 
                                     msgType.c_str(), targetPeerId.substring(0, 8).c_str());
                        
                        // Check if target is a local peer
                        for (int i = 0; i < MAX_CONNECTIONS; i++) {
                            if (connections[i].active && connections[i].clientPeerId == targetPeerId) {
                                webSocket.sendTXT(connections[i].num, payload, length);
                                Serial.printf("[BOOTSTRAP] ✅ Forwarded %s to local peer\n", msgType.c_str());
                                return;
                            }
                        }
                        Serial.printf("[BOOTSTRAP] ⚠️ Target peer %s not local\n", targetPeerId.substring(0, 8).c_str());
                    }
                } else {
                    Serial.printf("[BOOTSTRAP] ℹ️ Unhandled message type: %s\n", msgType.c_str());
                }
            }
            break;
            
        case WStype_ERROR:
            Serial.println("[BOOTSTRAP] ❌ WebSocket error");
            bootstrapConnected = false;
            break;
    }
}

// ============================================================================
// Local Peer WebSocket Event Handler
// ============================================================================

void webSocketEvent(uint8_t num, WStype_t type, uint8_t* payload, size_t length) {
    Serial.printf("[WS EVENT] Client %u, Type: %d, Length: %d\n", num, type, length);
    
    switch(type) {
        case WStype_DISCONNECTED: {
            Serial.printf("[WS] Client %u disconnected\n", num);
            Connection* conn = findConnectionByNum(num);
            if (conn) {
                Serial.printf("[WS] Peer left: %s\n", conn->clientPeerId.substring(0, 8).c_str());
                
                // Broadcast peer departure to others
                String goodbye = "{\"type\":\"peer-disconnected\",\"data\":{\"peerId\":\"" + 
                                conn->clientPeerId + "\"},\"fromPeerId\":\"system\",\"timestamp\":" + 
                                String(millis()) + "}";
                for (int i = 0; i < MAX_CONNECTIONS; i++) {
                    if (connections[i].active && connections[i].num != num) {
                        webSocket.sendTXT(connections[i].num, goodbye);
                    }
                }
                
                removeConnection(num);
            }
            break;
        }
            
        case WStype_CONNECTED: {
            IPAddress ip = webSocket.remoteIP(num);
            String url = String((char*)payload);
            Serial.printf("[WS] Client %u connected from %s, URL: %s\n", num, ip.toString().c_str(), url.c_str());
            
            // Extract peerId from URL query parameter (?peerId=...)
            String clientPeerId = "";
            int peerIdStart = url.indexOf("?peerId=");
            if (peerIdStart >= 0) {
                peerIdStart += 8; // Skip "?peerId="
                int peerIdEnd = url.indexOf("&", peerIdStart);
                if (peerIdEnd < 0) peerIdEnd = url.length();
                clientPeerId = url.substring(peerIdStart, peerIdEnd);
                Serial.printf("[WS] Client peerId: %s\n", clientPeerId.c_str());
                
                // Validate peerId format (40 hex characters)
                if (clientPeerId.length() != 40) {
                    Serial.printf("[WS] Invalid peerId length: %d (expected 40)\n", clientPeerId.length());
                    webSocket.sendTXT(num, "{\"type\":\"error\",\"error\":\"Invalid peerId format\"}");
                    webSocket.disconnect(num);
                    return;
                }
            } else {
                Serial.println("[WS] ERROR: No peerId in URL!");
                webSocket.sendTXT(num, "{\"type\":\"error\",\"error\":\"Missing peerId parameter\"}");
                webSocket.disconnect(num);
                return;
            }
            
            Connection* conn = addConnection(num, clientPeerId);
            if (conn) {
                Serial.printf("[WS] Assigned internal ID: %d for peerId: %s\n", conn->peer_id, clientPeerId.c_str());
                Serial.printf("[WS] Free heap before send: %d\n", ESP.getFreeHeap());
                
                // IMPORTANT: Don't send connected message immediately!
                // The WebSocket connection event fires BEFORE the client's onopen handler
                // Just store the connection and let the client send the first message
                Serial.println("[WS] Connection established, waiting for client to send announce");
            } else {
                Serial.println("[WS] ERROR: Could not add connection!");
                webSocket.disconnect(num);
            }
            break;
        }
            
        case WStype_TEXT: {
            Serial.printf("[WS] Received: %.*s\n", (int)length, payload);
            
            Connection* conn = findConnectionByNum(num);
            if (!conn) {
                Serial.printf("[WS] ERROR: Connection %u not found!\n", num);
                return;
            }
            
            conn->last_seen = millis();
            
            // Parse message type (PeerPigeon protocol)
            String msg = String((char*)payload);
            int typeStart = msg.indexOf("\"type\":\"") + 8;
            int typeEnd = msg.indexOf("\"", typeStart);
            if (typeStart == -1 || typeEnd == -1) {
                Serial.println("[WS] Invalid message format");
                return;
            }
            
            String msgType = msg.substring(typeStart, typeEnd);
            Serial.printf("[WS] Message type: %s\n", msgType.c_str());
            
            if (msgType == "announce") {
                // Peer announces itself
                Serial.printf("[WS] Peer %s announced\n", conn->clientPeerId.c_str());
                
                // Extract networkName from announce message
                int networkStart = msg.indexOf("\"networkName\":\"") + 15;
                int networkEnd = msg.indexOf("\"", networkStart);
                if (networkStart > 14 && networkEnd > networkStart) {
                    conn->networkName = msg.substring(networkStart, networkEnd);
                    Serial.printf("[WS] Network: %s\n", conn->networkName.c_str());
                } else {
                    conn->networkName = "global";  // Default fallback
                }
                
                // Check if this is a hub announcing (has isHub in data)
                bool peerIsHub = msg.indexOf("\"isHub\":true") > 0;
                if (peerIsHub) {
                    Serial.printf("[HUB] Hub peer detected: %s\n", conn->clientPeerId.c_str());
                }
                
                // Send peer-discovered to all other connected peers IN THE SAME NETWORK
                for (int i = 0; i < MAX_CONNECTIONS; i++) {
                    if (connections[i].active && connections[i].num != num && 
                        connections[i].networkName == conn->networkName) {
                        String discovered = "{\"type\":\"peer-discovered\",\"data\":{\"peerId\":\"" + 
                                          conn->clientPeerId + "\",\"isHub\":" + 
                                          (peerIsHub ? "true" : "false") + 
                                          "},\"networkName\":\"" + conn->networkName + 
                                          "\",\"fromPeerId\":\"system\",\"timestamp\":" + 
                                          String(millis()) + "}";
                        sendJSON(connections[i].num, discovered);
                    }
                }
                
                // Send existing peers IN THE SAME NETWORK to new peer
                for (int i = 0; i < MAX_CONNECTIONS; i++) {
                    if (connections[i].active && connections[i].num != num &&
                        connections[i].networkName == conn->networkName) {
                        String discovered = "{\"type\":\"peer-discovered\",\"data\":{\"peerId\":\"" + 
                                          connections[i].clientPeerId + "\",\"isHub\":false" +
                                          "},\"networkName\":\"" + conn->networkName + 
                                          "\",\"fromPeerId\":\"system\",\"timestamp\":" + 
                                          String(millis()) + "}";
                        sendJSON(num, discovered);
                    }
                }
                
                // If connected to bootstrap hub and this is a CLIENT peer (not another hub),
                // forward their announce to the bootstrap hub so it can relay to other hubs
                if (bootstrapConnected && !peerIsHub) {
                    // Forward the peer's announce message to bootstrap hub
                    // Bootstrap will handle sending peer-discovered to other hubs
                    bootstrapHub.sendTXT(payload, length);
                    Serial.printf("[BOOTSTRAP] 📡 Forwarded announce for peer %s to bootstrap\n", 
                                 conn->clientPeerId.substring(0, 8).c_str());
                }
                
            } else if (msgType == "offer" || msgType == "answer" || msgType == "ice-candidate") {
                // WebRTC signaling - extract targetPeerId and forward WITH fromPeerId
                Serial.printf("[SIGNAL] Received %s message\n", msgType.c_str());
                int targetStart = msg.indexOf("\"targetPeerId\":\"") + 16;
                int targetEnd = msg.indexOf("\"", targetStart);
                
                if (targetStart > 15 && targetEnd > targetStart) {
                    String targetPeerId = msg.substring(targetStart, targetEnd);
                    Serial.printf("[SIGNAL] Looking for target: %s\n", targetPeerId.c_str());
                    
                    // Find target connection by clientPeerId
                    Connection* targetConn = nullptr;
                    for (int i = 0; i < MAX_CONNECTIONS; i++) {
                        if (connections[i].active && connections[i].clientPeerId == targetPeerId) {
                            targetConn = &connections[i];
                            break;
                        }
                    }
                    
                    if (targetConn) {
                        // Target is LOCAL - forward directly
                        Serial.printf("[SIGNAL] ✅ Forwarding %s from %s to LOCAL peer %s\n", 
                                     msgType.c_str(), 
                                     conn->clientPeerId.substring(0, 8).c_str(), 
                                     targetPeerId.substring(0, 8).c_str());
                        
                        // Check if message already has fromPeerId
                        int fromPeerIdPos = msg.indexOf("\"fromPeerId\":");
                        if (fromPeerIdPos == -1) {
                            // Add fromPeerId to the message
                            int closingBrace = msg.lastIndexOf("}");
                            if (closingBrace > 0) {
                                String modifiedMsg = msg.substring(0, closingBrace) + 
                                                   ",\"fromPeerId\":\"" + conn->clientPeerId + "\"}";
                                webSocket.sendTXT(targetConn->num, modifiedMsg);
                            } else {
                                webSocket.sendTXT(targetConn->num, payload, length);
                            }
                        } else {
                            // Already has fromPeerId, send as-is
                            webSocket.sendTXT(targetConn->num, payload, length);
                        }
                    } else {
                        // Target NOT local - relay through bootstrap hub if connected
                        Serial.printf("[SIGNAL] ⚠️  Target peer %s not local\n", targetPeerId.substring(0, 8).c_str());
                        
                        if (bootstrapConnected) {
                            Serial.printf("[SIGNAL] 🔄 Relaying %s to bootstrap hub\n", msgType.c_str());
                            
                            // Ensure fromPeerId is set before relaying
                            int fromPeerIdPos = msg.indexOf("\"fromPeerId\":");
                            if (fromPeerIdPos == -1) {
                                int closingBrace = msg.lastIndexOf("}");
                                if (closingBrace > 0) {
                                    String modifiedMsg = msg.substring(0, closingBrace) + 
                                                       ",\"fromPeerId\":\"" + conn->clientPeerId + "\"}";
                                    bootstrapHub.sendTXT(modifiedMsg);
                                } else {
                                    bootstrapHub.sendTXT(payload, length);
                                }
                            } else {
                                bootstrapHub.sendTXT(payload, length);
                            }
                        } else {
                            Serial.println("[SIGNAL] ❌ Bootstrap hub not connected, cannot relay");
                            Serial.println("[SIGNAL] Active LOCAL peers:");
                            for (int i = 0; i < MAX_CONNECTIONS; i++) {
                                if (connections[i].active) {
                                    Serial.printf("  - %s\n", connections[i].clientPeerId.c_str());
                                }
                            }
                        }
                    }
                } else {
                    Serial.println("[SIGNAL] ❌ No targetPeerId in signaling message");
                    Serial.printf("[SIGNAL] Message: %s\n", msg.c_str());
                }
                
            } else if (msgType == "goodbye") {
                Serial.printf("[WS] Peer %s said goodbye\n", conn->clientPeerId.substring(0, 8).c_str());
                // Let disconnection handler take care of cleanup
                
            } else {
                Serial.printf("[WS] Unknown message type: %s\n", msgType.c_str());
            }
            break;
        }
            
        case WStype_BIN:
            Serial.printf("[WS] Binary messages not supported\n");
            break;
            
        case WStype_ERROR:
            Serial.printf("[WS] Error from %u\n", num);
            break;
            
        case WStype_PING:
        case WStype_PONG:
            break;
            
        default:
            break;
    }
}

// ============================================================================
// Setup & Loop
// ============================================================================

void setup() {
    Serial.begin(115200);
    
    // Wait for USB CDC to be ready (ESP32-C3 USB JTAG)
    unsigned long start = millis();
    while (!Serial && (millis() - start) < 5000) {
        delay(10);
    }
    delay(1000);  // Additional stabilization time
    
    Serial.println("\n\n");
    Serial.println("====================================");
    Serial.println("  🏢 PigeonHub ESP32 Server v1.0");
    Serial.println("====================================");
    Serial.printf("Free heap at start: %d bytes\n", ESP.getFreeHeap());
    Serial.printf("Chip: %s\n", ESP.getChipModel());
    Serial.printf("CPU Freq: %d MHz\n", ESP.getCpuFreqMHz());
    
    // Generate Hub Peer ID from SHA-1 hash of MAC address
    uint8_t mac[6];
    esp_efuse_mac_get_default(mac);
    
    // Compute SHA-1 hash of MAC address
    uint8_t sha1Hash[20];
    mbedtls_sha1(mac, 6, sha1Hash);
    
    // Convert hash to 40-character hex string (PeerPigeon format)
    char hashStr[41];
    for (int i = 0; i < 20; i++) {
        sprintf(&hashStr[i * 2], "%02x", sha1Hash[i]);
    }
    hashStr[40] = '\0';
    hubPeerId = String(hashStr);
    
    Serial.printf("MAC: %02x:%02x:%02x:%02x:%02x:%02x\n", 
                  mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    Serial.printf("🏢 Hub Peer ID (SHA-1): %s\n", hubPeerId.c_str());
    Serial.printf("🌐 Hub Namespace: %s\n", HUB_MESH_NAMESPACE);
    Serial.printf("🔗 Bootstrap Hub: %s\n", BOOTSTRAP_HUB);
    
    // Initialize connections array
    for (int i = 0; i < MAX_CONNECTIONS; i++) {
        connections[i].active = false;
    }
    Serial.println("Connections array initialized");
    
    // ALWAYS start Access Point (for configuration/management)
    Serial.println("\nStarting Access Point...");
    Serial.printf("Free heap before AP: %d bytes\n", ESP.getFreeHeap());
    
    // CRITICAL: Set WiFi mode FIRST before any other WiFi config
    WiFi.mode(WIFI_AP_STA);  // Enable both AP and Station mode
    delay(100);
    
    // Register WiFi event handler AFTER mode is set
    WiFi.onEvent(WiFiEvent);
    
    // NOW configure WiFi persistence (AFTER mode is set)
    Serial.println("Configuring WiFi...");
    WiFi.persistent(false);  // Don't use ESP32's flash storage for WiFi
    WiFi.setAutoConnect(false);  // Disable auto-connect to old networks
    WiFi.setAutoReconnect(false);  // We handle reconnection ourselves
    Serial.println("WiFi auto-connect disabled");
    
    bool apStarted = WiFi.softAP(AP_SSID, AP_PASSWORD);
    if (!apStarted) {
        Serial.println("ERROR: Failed to start AP!");
        delay(5000);
        ESP.restart();
    }
    
    delay(500);  // Give AP time to stabilize
    IPAddress apIP = WiFi.softAPIP();
    Serial.printf("AP Started Successfully!\n");
    Serial.printf("AP SSID: %s\n", AP_SSID);
    Serial.printf("AP Password: %s\n", AP_PASSWORD);
    Serial.printf("AP IP: %s\n", apIP.toString().c_str());
    Serial.printf("AP MAC: %s\n", WiFi.softAPmacAddress().c_str());
    Serial.printf("Free heap after AP: %d bytes\n", ESP.getFreeHeap());
    
    // Verify AP is actually running
    delay(500);
    if (WiFi.getMode() == WIFI_AP || WiFi.getMode() == WIFI_AP_STA) {
        Serial.println("✅ AP MODE CONFIRMED");
        Serial.printf("WiFi Mode: %d (2=AP, 3=AP_STA)\n", WiFi.getMode());
    } else {
        Serial.println("❌ ERROR: AP MODE NOT ACTIVE!");
        Serial.printf("Current WiFi Mode: %d\n", WiFi.getMode());
    };
    
    // Start mDNS responder
    Serial.println("\nStarting mDNS...");
    if (MDNS.begin("pigeonhub")) {
        Serial.println("mDNS responder started: pigeonhub.local");
        MDNS.addService("http", "tcp", 80);
    } else {
        Serial.println("Error setting up mDNS responder!");
    }
    
    // Try to connect to saved WiFi
    bool hasConfig = loadWiFiConfig();
    bool connected = false;
    
    if (hasConfig) {
        Serial.println("\nFound saved WiFi configuration");
        Serial.printf("Free heap before WiFi connect: %d bytes\n", ESP.getFreeHeap());
        connected = connectToWiFi();
        Serial.printf("Free heap after WiFi connect: %d bytes\n", ESP.getFreeHeap());
    } else {
        Serial.println("\nNo saved WiFi configuration - AP mode only");
    }
    
    // Start DNS server for captive portal
    Serial.println("\nStarting DNS server...");
    dnsServer.start(DNS_PORT, "*", apIP);
    Serial.printf("DNS server started on port %d\n", DNS_PORT);
    Serial.printf("Free heap after DNS: %d bytes\n", ESP.getFreeHeap());
    
    // Set up web server routes (works for both AP and STA)
    Serial.println("\nSetting up web server...");
    
    // Captive portal detection URLs - must respond to keep portal open
    webServer.on("/hotspot-detect.html", handleCaptivePortal);  // Apple
    webServer.on("/library/test/success.html", handleCaptivePortal);  // Apple
    webServer.on("/generate_204", handleCaptivePortal);  // Android
    webServer.on("/gen_204", handleCaptivePortal);  // Android
    webServer.on("/ncsi.txt", handleCaptivePortal);  // Windows
    webServer.on("/connecttest.txt", handleCaptivePortal);  // Windows
    
    // Main application routes
    webServer.on("/", handleRoot);
    webServer.on("/success", handleSuccess);
    webServer.on("/api/info", handleInfo);
    webServer.on("/api/scan", handleScan);
    webServer.on("/api/save", HTTP_POST, handleSave);
    webServer.on("/api/reset", handleReset);
    webServer.onNotFound(handleRoot);
    webServer.begin();
    Serial.println("HTTP server started on port 80");
    Serial.printf("Free heap after web server: %d bytes\n", ESP.getFreeHeap());
    
    // ALWAYS start WebSocket server (works for both AP and STA)
    Serial.println("\n====================================");
    Serial.println("  🏢 Starting PigeonHub Server");
    Serial.println("====================================");
    Serial.printf("AP IP: %s\n", apIP.toString().c_str());
    if (connected) {
        Serial.printf("WiFi IP: %s\n", WiFi.localIP().toString().c_str());
    }
    Serial.printf("WebSocket Port: %d\n", SERVER_PORT);
    Serial.printf("Hub Peer ID: %s\n", hubPeerId.substring(0, 8).c_str());
    Serial.printf("Max Peers: %d\n", MAX_CONNECTIONS);
    Serial.printf("Network: %s\n", HUB_MESH_NAMESPACE);
    Serial.printf("Free heap: %d bytes\n", ESP.getFreeHeap());
    
    // Start WebSocket server (binds to all interfaces)
    Serial.println("\n🚀 Starting WebSocket server...");
    webSocket.begin();
    webSocket.onEvent(webSocketEvent);
    Serial.printf("✅ WebSocket server started on port %d\n", SERVER_PORT);
    is_sta_connected = connected; // Track initial WiFi state
    
    Serial.println("\n====================================");
    Serial.println("  🏢 PigeonHub Server READY!");
    Serial.println("  Mode: Hub (PeerPigeon Protocol)");
    Serial.println("  Waiting for peers and hubs...");
    Serial.println("====================================");
    
    Serial.println("\nAccess Points:");
    Serial.printf("  AP Config: http://%s/ (via %s)\n", apIP.toString().c_str(), AP_SSID);
    if (connected) {
        Serial.printf("  STA Config: http://%s/ (via WiFi)\n", WiFi.localIP().toString().c_str());
        
        // Connect to bootstrap hub if we have WiFi
        Serial.println("\n🔗 Connecting to bootstrap hub...");
        Serial.printf("Bootstrap: %s\n", BOOTSTRAP_HUB);
        
        // Parse bootstrap hub URL
        String bootstrapUrl = String(BOOTSTRAP_HUB);
        String host = "pigeonhub.fly.dev";
        uint16_t port = 443;  // WSS uses 443
        String path = "/?peerId=" + hubPeerId;
        
        bootstrapHub.beginSSL(host, port, path);
        bootstrapHub.onEvent(bootstrapHubEvent);
        bootstrapHub.setReconnectInterval(BOOTSTRAP_RETRY_INTERVAL);
        Serial.println("✅ Bootstrap hub connection initiated");
    }
    Serial.printf("\nFree heap: %d bytes\n", ESP.getFreeHeap());
}

void loop() {
    // Always handle DNS and web server (for AP configuration)
    dnsServer.processNextRequest();
    webServer.handleClient();
    
    // Track WiFi connection state changes
    static bool was_connected = is_sta_connected;
    bool now_connected = (WiFi.status() == WL_CONNECTED);
    
    if (now_connected && !was_connected) {
        Serial.println("\n====================================");
        Serial.println("  📡 WiFi Connected!");
        Serial.println("====================================");
        Serial.printf("WiFi IP: %s\n", WiFi.localIP().toString().c_str());
        Serial.printf("WebSocket available on both:\n");
        Serial.printf("  - AP: ws://%s:%d/\n", WiFi.softAPIP().toString().c_str(), SERVER_PORT);
        Serial.printf("  - WiFi: ws://%s:%d/\n", WiFi.localIP().toString().c_str(), SERVER_PORT);
        Serial.println("====================================\n");
        
        // Connect to bootstrap hub when WiFi comes up
        if (!bootstrapConnected) {
            Serial.println("🔗 Initiating bootstrap hub connection...");
            String host = "pigeonhub.fly.dev";
            uint16_t port = 443;
            String path = "/?peerId=" + hubPeerId;
            bootstrapHub.beginSSL(host, port, path);
            bootstrapHub.onEvent(bootstrapHubEvent);
            bootstrapHub.setReconnectInterval(BOOTSTRAP_RETRY_INTERVAL);
        }
    } else if (!now_connected && was_connected) {
        Serial.println("\n⚠️  WiFi Disconnected! (AP still active)\n");
        bootstrapConnected = false;
    }
    
    was_connected = now_connected;
    is_sta_connected = now_connected;
    
    // Always run WebSocket server (available on both AP and WiFi)
    webSocket.loop();
    
    // Handle bootstrap hub connection if WiFi is connected
    if (is_sta_connected) {
        bootstrapHub.loop();
    }
    
    // Periodic status update with WebSocket loop confirmation
    static unsigned long lastStatus = 0;
    static unsigned long loopCount = 0;
    loopCount++;
    if (millis() - lastStatus > 30000) {  // Every 30 seconds
        int activeConns = 0;
        for (int i = 0; i < MAX_CONNECTIONS; i++) {
            if (connections[i].active) activeConns++;
        }
        
        // Detailed status with WiFi and bootstrap connection info
        Serial.println("\n========== STATUS UPDATE ==========");
        Serial.printf("Active Peers: %d\n", activeConns);
        Serial.printf("WiFi Status: %s\n", now_connected ? "CONNECTED ✅" : "DISCONNECTED ❌");
        if (now_connected) {
            Serial.printf("WiFi IP: %s\n", WiFi.localIP().toString().c_str());
        } else {
            Serial.println("WiFi: NOT CONNECTED - Bootstrap unavailable");
            Serial.printf("SSID stored: %s\n", stored_ssid.length() > 0 ? "YES" : "NO");
            if (stored_ssid.length() == 0) {
                Serial.println("⚠️  No WiFi configured!");
                Serial.printf("   Connect to AP: %s / %s\n", AP_SSID, AP_PASSWORD);
                Serial.printf("   Configure at: http://%s/\n", WiFi.softAPIP().toString().c_str());
            }
        }
        Serial.printf("Bootstrap: %s %s\n", 
                     bootstrapConnected ? "CONNECTED ✅" : "DISCONNECTED ❌",
                     !now_connected ? "(requires WiFi)" : "");
        Serial.printf("Free Heap: %d bytes\n", ESP.getFreeHeap());
        Serial.printf("WS Loops: %lu\n", loopCount);
        Serial.println("===================================\n");
        
        lastStatus = millis();
        loopCount = 0;
    }
    
    delay(10);
}
