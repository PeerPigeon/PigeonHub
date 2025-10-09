/**
 * PigeonHub WASM Server for ESP32
 * 
 * A lightweight WebSocket server implementation that can be compiled to WASM
 * and run on ESP32 devices using WASM3 runtime.
 * 
 * This server accepts peer connections and relays messages between them,
 * functioning as a full PigeonHub node.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>

// WASM imports - these will be provided by the ESP32 host environment
__attribute__((import_module("env"), import_name("ws_server_start")))
extern int ws_server_start(int port);

__attribute__((import_module("env"), import_name("ws_server_stop")))
extern void ws_server_stop();

__attribute__((import_module("env"), import_name("ws_send_to_peer")))
extern int ws_send_to_peer(int peer_id, const char* data, int data_len);

__attribute__((import_module("env"), import_name("ws_broadcast")))
extern int ws_broadcast(const char* data, int data_len, int exclude_peer_id);

__attribute__((import_module("env"), import_name("log_message")))
extern void log_message(const char* msg, int msg_len);

__attribute__((import_module("env"), import_name("get_device_id")))
extern void get_device_id(char* buffer, int buffer_len);

__attribute__((import_module("env"), import_name("millis")))
extern uint32_t millis();

// Configuration
#define MAX_MESSAGE_SIZE 2048
#define MAX_PEERS 20
#define HEARTBEAT_INTERVAL 30000  // 30 seconds
#define PEER_TIMEOUT 60000        // 60 seconds

// Peer connection state
typedef struct {
    int peer_id;              // Unique connection ID from ESP32
    char client_peer_id[64];  // Client's self-reported peer ID
    uint32_t last_seen;       // Last activity timestamp
    int connected;            // Is this slot active
} PeerConnection;

// Server state management
typedef struct {
    char hub_id[64];
    int server_running;
    int port;
    uint32_t start_time;
    int peer_count;
    PeerConnection peers[MAX_PEERS];
    uint64_t messages_received;
    uint64_t messages_sent;
} ServerState;

static ServerState state = {0};
static char message_buffer[MAX_MESSAGE_SIZE];

// Helper function to log messages
void log_str(const char* msg) {
    log_message(msg, strlen(msg));
}

// Generate a unique hub ID for this server
void generate_hub_id() {
    get_device_id(state.hub_id, sizeof(state.hub_id));
}

// Find a peer by connection ID
PeerConnection* find_peer(int peer_id) {
    for (int i = 0; i < MAX_PEERS; i++) {
        if (state.peers[i].connected && state.peers[i].peer_id == peer_id) {
            return &state.peers[i];
        }
    }
    return NULL;
}

// Find an empty peer slot
PeerConnection* find_empty_slot() {
    for (int i = 0; i < MAX_PEERS; i++) {
        if (!state.peers[i].connected) {
            return &state.peers[i];
        }
    }
    return NULL;
}

// Count active peers
int count_active_peers() {
    int count = 0;
    for (int i = 0; i < MAX_PEERS; i++) {
        if (state.peers[i].connected) {
            count++;
        }
    }
    return count;
}

// Create a JSON message
int create_json_message(char* buffer, int buffer_size, const char* type, const char* data) {
    int len = snprintf(buffer, buffer_size,
        "{\"type\":\"%s\",\"hubId\":\"%s\",\"timestamp\":%u%s%s}",
        type, state.hub_id, millis(),
        data && strlen(data) > 0 ? "," : "",
        data ? data : "");
    return len;
}

// Send peer list to a specific peer
void send_peer_list(int peer_id) {
    char peers_json[1024] = {0};
    char* p = peers_json;
    int remaining = sizeof(peers_json);
    
    int written = snprintf(p, remaining, "\"peers\":[");
    p += written;
    remaining -= written;
    
    int first = 1;
    for (int i = 0; i < MAX_PEERS && remaining > 0; i++) {
        if (state.peers[i].connected && state.peers[i].peer_id != peer_id) {
            written = snprintf(p, remaining, "%s\"%s\"", 
                             first ? "" : ",", 
                             state.peers[i].client_peer_id);
            p += written;
            remaining -= written;
            first = 0;
        }
    }
    
    snprintf(p, remaining, "]");
    
    create_json_message(message_buffer, sizeof(message_buffer), "peers", peers_json);
    ws_send_to_peer(peer_id, message_buffer, strlen(message_buffer));
}

// Notify all peers about a peer event
void broadcast_peer_event(const char* event_type, const char* peer_id_str, int exclude_peer_id) {
    char event_json[256];
    snprintf(event_json, sizeof(event_json), "\"peerId\":\"%s\"", peer_id_str);
    
    create_json_message(message_buffer, sizeof(message_buffer), event_type, event_json);
    ws_broadcast(message_buffer, strlen(message_buffer), exclude_peer_id);
}

// Initialize the server
__attribute__((export_name("init")))
int init() {
    log_str("Initializing PigeonHub WASM server...");
    
    // Generate unique hub ID
    generate_hub_id();
    
    state.server_running = 0;
    state.port = 0;
    state.peer_count = 0;
    state.start_time = millis();
    state.messages_received = 0;
    state.messages_sent = 0;
    
    // Initialize peer slots
    for (int i = 0; i < MAX_PEERS; i++) {
        state.peers[i].connected = 0;
        state.peers[i].peer_id = -1;
    }
    
    char log_buf[128];
    snprintf(log_buf, sizeof(log_buf), "Hub ID: %s", state.hub_id);
    log_str(log_buf);
    
    return 0;
}

// Start the WebSocket server
__attribute__((export_name("start_server")))
int start_server(int port) {
    if (state.server_running) {
        log_str("Server already running!");
        return -1;
    }
    
    char log_buf[128];
    snprintf(log_buf, sizeof(log_buf), "Starting PigeonHub server on port %d...", port);
    log_str(log_buf);
    
    int result = ws_server_start(port);
    if (result == 0) {
        state.server_running = 1;
        state.port = port;
        state.start_time = millis();
        
        snprintf(log_buf, sizeof(log_buf), "Server started successfully on port %d", port);
        log_str(log_buf);
        return 0;
    }
    
    log_str("Failed to start server!");
    return -1;
}

// Stop the server
__attribute__((export_name("stop_server")))
void stop_server() {
    if (state.server_running) {
        log_str("Stopping PigeonHub server...");
        ws_server_stop();
        state.server_running = 0;
        
        // Clear all peer connections
        for (int i = 0; i < MAX_PEERS; i++) {
            state.peers[i].connected = 0;
        }
        state.peer_count = 0;
    }
}

// Handle new peer connection
__attribute__((export_name("on_peer_connected")))
void on_peer_connected(int peer_id) {
    PeerConnection* peer = find_empty_slot();
    if (!peer) {
        log_str("No available peer slots!");
        return;
    }
    
    peer->peer_id = peer_id;
    peer->connected = 1;
    peer->last_seen = millis();
    snprintf(peer->client_peer_id, sizeof(peer->client_peer_id), "peer-%d", peer_id);
    
    state.peer_count = count_active_peers();
    
    char log_buf[128];
    snprintf(log_buf, sizeof(log_buf), "Peer connected: %d (total: %d)", peer_id, state.peer_count);
    log_str(log_buf);
    
    // Send peer list to new peer
    send_peer_list(peer_id);
}

// Handle peer disconnection
__attribute__((export_name("on_peer_disconnected")))
void on_peer_disconnected(int peer_id) {
    PeerConnection* peer = find_peer(peer_id);
    if (!peer) {
        return;
    }
    
    char log_buf[128];
    snprintf(log_buf, sizeof(log_buf), "Peer disconnected: %d (%s)", peer_id, peer->client_peer_id);
    log_str(log_buf);
    
    // Notify other peers
    broadcast_peer_event("peer-disconnected", peer->client_peer_id, peer_id);
    
    peer->connected = 0;
    state.peer_count = count_active_peers();
    
    snprintf(log_buf, sizeof(log_buf), "Total peers: %d", state.peer_count);
    log_str(log_buf);
}

// Process incoming message from a peer
__attribute__((export_name("on_message")))
void on_message(int peer_id, const char* message, int message_len) {
    state.messages_received++;
    
    PeerConnection* peer = find_peer(peer_id);
    if (!peer) {
        log_str("Message from unknown peer!");
        return;
    }
    
    peer->last_seen = millis();
    
    // Parse message type (simple JSON parsing)
    char type[32] = {0};
    const char* type_start = strstr(message, "\"type\":\"");
    if (type_start) {
        type_start += 8;  // Skip "type":"
        const char* type_end = strchr(type_start, '"');
        if (type_end) {
            int type_len = type_end - type_start;
            if (type_len < sizeof(type)) {
                strncpy(type, type_start, type_len);
            }
        }
    }
    
    // Parse peerId if present
    const char* peer_id_start = strstr(message, "\"peerId\":\"");
    if (peer_id_start) {
        peer_id_start += 10;  // Skip "peerId":"
        const char* peer_id_end = strchr(peer_id_start, '"');
        if (peer_id_end) {
            int len = peer_id_end - peer_id_start;
            if (len < sizeof(peer->client_peer_id)) {
                strncpy(peer->client_peer_id, peer_id_start, len);
                peer->client_peer_id[len] = '\0';
            }
        }
    }
    
    // Handle different message types
    if (strcmp(type, "join") == 0 || strcmp(type, "handshake") == 0) {
        // Send peer list and notify others
        send_peer_list(peer_id);
        broadcast_peer_event("peer-connected", peer->client_peer_id, peer_id);
        
    } else if (strcmp(type, "broadcast") == 0) {
        // Relay broadcast to all other peers
        char log_buf[128];
        snprintf(log_buf, sizeof(log_buf), "Broadcasting from %s", peer->client_peer_id);
        log_str(log_buf);
        
        ws_broadcast(message, message_len, peer_id);
        state.messages_sent += (state.peer_count - 1);
        
    } else if (strcmp(type, "message") == 0) {
        // Direct message to specific peer
        const char* target_start = strstr(message, "\"targetPeer\":\"");
        if (target_start) {
            target_start += 14;
            const char* target_end = strchr(target_start, '"');
            if (target_end) {
                char target_peer_id[64];
                int len = target_end - target_start;
                if (len < sizeof(target_peer_id)) {
                    strncpy(target_peer_id, target_start, len);
                    target_peer_id[len] = '\0';
                    
                    // Find target peer and forward message
                    for (int i = 0; i < MAX_PEERS; i++) {
                        if (state.peers[i].connected && 
                            strcmp(state.peers[i].client_peer_id, target_peer_id) == 0) {
                            ws_send_to_peer(state.peers[i].peer_id, message, message_len);
                            state.messages_sent++;
                            break;
                        }
                    }
                }
            }
        }
        
    } else if (strcmp(type, "heartbeat") == 0) {
        // Just update last_seen (already done above)
        
    } else if (strcmp(type, "get-peers") == 0) {
        send_peer_list(peer_id);
    }
}

// Main loop - check for timeouts and maintenance
__attribute__((export_name("loop")))
void loop() {
    if (!state.server_running) {
        return;
    }
    
    uint32_t now = millis();
    
    // Check for timed out peers
    for (int i = 0; i < MAX_PEERS; i++) {
        if (state.peers[i].connected) {
            uint32_t idle_time = now - state.peers[i].last_seen;
            if (idle_time > PEER_TIMEOUT) {
                char log_buf[128];
                snprintf(log_buf, sizeof(log_buf), "Peer timeout: %d", state.peers[i].peer_id);
                log_str(log_buf);
                
                on_peer_disconnected(state.peers[i].peer_id);
            }
        }
    }
}

// Get server status
__attribute__((export_name("is_running")))
int is_running() {
    return state.server_running;
}

// Get peer count
__attribute__((export_name("get_peer_count")))
int get_peer_count() {
    return state.peer_count;
}

// Get server stats
__attribute__((export_name("get_stats")))
void get_stats(char* buffer, int buffer_size) {
    uint32_t uptime = (millis() - state.start_time) / 1000;
    snprintf(buffer, buffer_size,
            "{\"hubId\":\"%s\",\"port\":%d,\"peers\":%d,\"uptime\":%u,"
            "\"messagesReceived\":%llu,\"messagesSent\":%llu}",
            state.hub_id, state.port, state.peer_count, uptime,
            state.messages_received, state.messages_sent);
}

// Get hub ID
__attribute__((export_name("get_hub_id")))
const char* get_hub_id() {
    return state.hub_id;
}

// Memory allocation exports (required for WASM)
__attribute__((export_name("malloc")))
void* wasm_malloc(size_t size) {
    return malloc(size);
}

__attribute__((export_name("free")))
void wasm_free(void* ptr) {
    free(ptr);
}
