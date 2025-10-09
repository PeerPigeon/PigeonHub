/**
 * ESP32 Bridge for PigeonHub WASM Server
 * 
 * This file provides the host environment functions that the WASM module
 * needs to run a WebSocket server on ESP32 hardware.
 * 
 * Compatible with ESP-IDF framework
 */

#include <stdio.h>
#include <string.h>
#include "esp_system.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_log.h"
#include "nvs_flash.h"
#include "esp_http_server.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"
#include "wasm3.h"
#include "m3_env.h"

static const char *TAG = "PigeonHub-ESP32";

// HTTP server handle (for WebSocket server)
static httpd_handle_t http_server = NULL;

// WebSocket connection tracking
#define MAX_WS_CONNECTIONS 20
typedef struct {
    int fd;
    int peer_id;
    int active;
} ws_connection_t;

static ws_connection_t ws_connections[MAX_WS_CONNECTIONS] = {0};
static int next_peer_id = 1;

// WASM3 runtime
static IM3Environment wasm_env = NULL;
static IM3Runtime wasm_runtime = NULL;
static IM3Module wasm_module = NULL;

// WASM function pointers
static IM3Function wasm_init = NULL;
static IM3Function wasm_start_server = NULL;
static IM3Function wasm_on_peer_connected = NULL;
static IM3Function wasm_on_peer_disconnected = NULL;
static IM3Function wasm_on_message = NULL;
static IM3Function wasm_loop = NULL;

// ============================================================================
// WebSocket Connection Management
// ============================================================================

/**
 * Find connection by file descriptor
 */
static ws_connection_t* find_connection_by_fd(int fd) {
    for (int i = 0; i < MAX_WS_CONNECTIONS; i++) {
        if (ws_connections[i].active && ws_connections[i].fd == fd) {
            return &ws_connections[i];
        }
    }
    return NULL;
}

/**
 * Find connection by peer ID
 */
static ws_connection_t* find_connection_by_peer_id(int peer_id) {
    for (int i = 0; i < MAX_WS_CONNECTIONS; i++) {
        if (ws_connections[i].active && ws_connections[i].peer_id == peer_id) {
            return &ws_connections[i];
        }
    }
    return NULL;
}

/**
 * Add new connection
 */
static ws_connection_t* add_connection(int fd) {
    for (int i = 0; i < MAX_WS_CONNECTIONS; i++) {
        if (!ws_connections[i].active) {
            ws_connections[i].fd = fd;
            ws_connections[i].peer_id = next_peer_id++;
            ws_connections[i].active = 1;
            return &ws_connections[i];
        }
    }
    return NULL;
}

/**
 * Remove connection
 */
static void remove_connection(int fd) {
    for (int i = 0; i < MAX_WS_CONNECTIONS; i++) {
        if (ws_connections[i].active && ws_connections[i].fd == fd) {
            ws_connections[i].active = 0;
            break;
        }
    }
}

// ============================================================================
// WebSocket Handler
// ============================================================================

/**
 * WebSocket handler for the HTTP server
 */
static esp_err_t ws_handler(httpd_req_t *req) {
    if (req->method == HTTP_GET) {
        ESP_LOGI(TAG, "WebSocket handshake");
        return ESP_OK;
    }
    
    httpd_ws_frame_t ws_pkt;
    memset(&ws_pkt, 0, sizeof(httpd_ws_frame_t));
    
    // First call to get frame length
    esp_err_t ret = httpd_ws_recv_frame(req, &ws_pkt, 0);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "httpd_ws_recv_frame failed: %d", ret);
        return ret;
    }
    
    if (ws_pkt.type == HTTPD_WS_TYPE_TEXT || ws_pkt.type == HTTPD_WS_TYPE_BINARY) {
        if (ws_pkt.len > 0) {
            // Allocate buffer for payload
            uint8_t *buf = malloc(ws_pkt.len + 1);
            if (buf == NULL) {
                ESP_LOGE(TAG, "Failed to allocate memory for payload");
                return ESP_ERR_NO_MEM;
            }
            ws_pkt.payload = buf;
            
            // Receive the actual frame
            ret = httpd_ws_recv_frame(req, &ws_pkt, ws_pkt.len);
            if (ret != ESP_OK) {
                ESP_LOGE(TAG, "httpd_ws_recv_frame failed: %d", ret);
                free(buf);
                return ret;
            }
            
            buf[ws_pkt.len] = '\0';
            
            // Find connection
            int fd = httpd_req_to_sockfd(req);
            ws_connection_t *conn = find_connection_by_fd(fd);
            if (conn) {
                // Forward to WASM on_message function
                if (wasm_on_message) {
                    M3Result result = m3_CallV(wasm_on_message, conn->peer_id, 
                                              (const char*)buf, (int32_t)ws_pkt.len);
                    if (result) {
                        ESP_LOGE(TAG, "Failed to call on_message: %s", result);
                    }
                }
            }
            
            free(buf);
        }
    }
    
    return ESP_OK;
}

/**
 * Open callback for WebSocket connections
 */
static void ws_open_fn(httpd_handle_t hd, int sockfd) {
    ESP_LOGI(TAG, "New WebSocket connection: fd=%d", sockfd);
    
    ws_connection_t *conn = add_connection(sockfd);
    if (conn) {
        ESP_LOGI(TAG, "Assigned peer_id=%d", conn->peer_id);
        
        // Notify WASM
        if (wasm_on_peer_connected) {
            M3Result result = m3_CallV(wasm_on_peer_connected, conn->peer_id);
            if (result) {
                ESP_LOGE(TAG, "Failed to call on_peer_connected: %s", result);
            }
        }
    } else {
        ESP_LOGE(TAG, "No available connection slots!");
    }
}

/**
 * Close callback for WebSocket connections
 */
static void ws_close_fn(httpd_handle_t hd, int sockfd) {
    ESP_LOGI(TAG, "WebSocket connection closed: fd=%d", sockfd);
    
    ws_connection_t *conn = find_connection_by_fd(sockfd);
    if (conn) {
        int peer_id = conn->peer_id;
        remove_connection(sockfd);
        
        // Notify WASM
        if (wasm_on_peer_disconnected) {
            M3Result result = m3_CallV(wasm_on_peer_disconnected, peer_id);
            if (result) {
                ESP_LOGE(TAG, "Failed to call on_peer_disconnected: %s", result);
            }
        }
    }
}

// ============================================================================
// WASM Import Functions (called by WASM module)
// ============================================================================

/**
 * Start WebSocket server
 * Called by WASM: ws_server_start(port)
 */
m3ApiRawFunction(m3_ws_server_start) {
    m3ApiReturnType(int32_t);
    m3ApiGetArg(int32_t, port);
    
    ESP_LOGI(TAG, "Starting WebSocket server on port %d", port);
    
    if (http_server != NULL) {
        ESP_LOGW(TAG, "Server already running");
        m3ApiReturn(-1);
    }
    
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.server_port = port;
    config.ctrl_port = port + 1;
    config.max_open_sockets = MAX_WS_CONNECTIONS;
    config.open_fn = ws_open_fn;
    config.close_fn = ws_close_fn;
    
    esp_err_t err = httpd_start(&http_server, &config);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to start HTTP server: %s", esp_err_to_name(err));
        m3ApiReturn(-1);
    }
    
    // Register WebSocket handler
    httpd_uri_t ws_uri = {
        .uri        = "/",
        .method     = HTTP_GET,
        .handler    = ws_handler,
        .user_ctx   = NULL,
        .is_websocket = true
    };
    
    err = httpd_register_uri_handler(http_server, &ws_uri);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to register WebSocket handler: %s", esp_err_to_name(err));
        httpd_stop(http_server);
        http_server = NULL;
        m3ApiReturn(-1);
    }
    
    ESP_LOGI(TAG, "WebSocket server started successfully");
    m3ApiReturn(0);
}

/**
 * Stop WebSocket server
 * Called by WASM: ws_server_stop()
 */
m3ApiRawFunction(m3_ws_server_stop) {
    m3ApiReturnType(void);
    
    if (http_server != NULL) {
        ESP_LOGI(TAG, "Stopping WebSocket server");
        httpd_stop(http_server);
        http_server = NULL;
        
        // Clear all connections
        for (int i = 0; i < MAX_WS_CONNECTIONS; i++) {
            ws_connections[i].active = 0;
        }
    }
    
    m3ApiSuccess();
}

/**
 * Send data to a specific peer
 * Called by WASM: ws_send_to_peer(peer_id, data, data_len)
 */
m3ApiRawFunction(m3_ws_send_to_peer) {
    m3ApiReturnType(int32_t);
    m3ApiGetArg(int32_t, peer_id);
    m3ApiGetArgMem(const char*, data);
    m3ApiGetArg(int32_t, data_len);
    
    ws_connection_t *conn = find_connection_by_peer_id(peer_id);
    if (!conn) {
        m3ApiReturn(-1);
    }
    
    httpd_ws_frame_t ws_pkt;
    memset(&ws_pkt, 0, sizeof(httpd_ws_frame_t));
    ws_pkt.payload = (uint8_t*)data;
    ws_pkt.len = data_len;
    ws_pkt.type = HTTPD_WS_TYPE_TEXT;
    
    esp_err_t ret = httpd_ws_send_frame_async(http_server, conn->fd, &ws_pkt);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to send to peer %d: %s", peer_id, esp_err_to_name(ret));
        m3ApiReturn(-1);
    }
    
    m3ApiReturn(data_len);
}

/**
 * Broadcast data to all peers except one
 * Called by WASM: ws_broadcast(data, data_len, exclude_peer_id)
 */
m3ApiRawFunction(m3_ws_broadcast) {
    m3ApiReturnType(int32_t);
    m3ApiGetArgMem(const char*, data);
    m3ApiGetArg(int32_t, data_len);
    m3ApiGetArg(int32_t, exclude_peer_id);
    
    httpd_ws_frame_t ws_pkt;
    memset(&ws_pkt, 0, sizeof(httpd_ws_frame_t));
    ws_pkt.payload = (uint8_t*)data;
    ws_pkt.len = data_len;
    ws_pkt.type = HTTPD_WS_TYPE_TEXT;
    
    int sent_count = 0;
    for (int i = 0; i < MAX_WS_CONNECTIONS; i++) {
        if (ws_connections[i].active && ws_connections[i].peer_id != exclude_peer_id) {
            esp_err_t ret = httpd_ws_send_frame_async(http_server, 
                                                     ws_connections[i].fd, &ws_pkt);
            if (ret == ESP_OK) {
                sent_count++;
            }
        }
    }
    
    m3ApiReturn(sent_count);
}

/**
 * Log message to console
 * Called by WASM: log_message(msg, msg_len)
 */
m3ApiRawFunction(m3_log_message) {
    m3ApiReturnType(void);
    m3ApiGetArgMem(const char*, msg);
    m3ApiGetArg(int32_t, msg_len);
    
    // Create a null-terminated string
    char log_buf[256];
    int len = msg_len < sizeof(log_buf) - 1 ? msg_len : sizeof(log_buf) - 1;
    memcpy(log_buf, msg, len);
    log_buf[len] = '\0';
    
    ESP_LOGI(TAG, "[WASM] %s", log_buf);
    
    m3ApiSuccess();
}

/**
 * Get unique device ID
 * Called by WASM: get_device_id(buffer, buffer_len)
 */
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

/**
 * Get milliseconds since boot
 * Called by WASM: millis()
 */
m3ApiRawFunction(m3_millis) {
    m3ApiReturnType(uint32_t);
    
    uint32_t ms = (uint32_t)(esp_timer_get_time() / 1000ULL);
    
    m3ApiReturn(ms);
}

// ============================================================================
// WASM Module Management
// ============================================================================

/**
 * Link WASM import functions
 */
M3Result link_wasm_imports(IM3Module module) {
    M3Result result = m3Err_none;
    
    // Link env module functions
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

/**
 * Load and initialize WASM module
 */
esp_err_t load_wasm_module(const uint8_t* wasm_binary, size_t wasm_size) {
    M3Result result = m3Err_none;
    
    ESP_LOGI(TAG, "Initializing WASM3 runtime...");
    
    // Create WASM environment
    wasm_env = m3_NewEnvironment();
    if (!wasm_env) {
        ESP_LOGE(TAG, "Failed to create WASM environment");
        return ESP_FAIL;
    }
    
    // Create runtime with 64KB stack
    wasm_runtime = m3_NewRuntime(wasm_env, 64 * 1024, NULL);
    if (!wasm_runtime) {
        ESP_LOGE(TAG, "Failed to create WASM runtime");
        return ESP_FAIL;
    }
    
    // Parse WASM module
    result = m3_ParseModule(wasm_env, &wasm_module, wasm_binary, wasm_size);
    if (result) {
        ESP_LOGE(TAG, "Failed to parse WASM module: %s", result);
        return ESP_FAIL;
    }
    
    // Load module into runtime
    result = m3_LoadModule(wasm_runtime, wasm_module);
    if (result) {
        ESP_LOGE(TAG, "Failed to load WASM module: %s", result);
        return ESP_FAIL;
    }
    
    // Link import functions
    result = link_wasm_imports(wasm_module);
    if (result) {
        ESP_LOGE(TAG, "Failed to link imports: %s", result);
        return ESP_FAIL;
    }
    
    // Find exported functions
    result = m3_FindFunction(&wasm_init, wasm_runtime, "init");
    if (result) {
        ESP_LOGE(TAG, "Failed to find init function: %s", result);
        return ESP_FAIL;
    }
    
    result = m3_FindFunction(&wasm_start_server, wasm_runtime, "start_server");
    if (result) {
        ESP_LOGE(TAG, "Failed to find start_server function: %s", result);
        return ESP_FAIL;
    }
    
    result = m3_FindFunction(&wasm_on_peer_connected, wasm_runtime, "on_peer_connected");
    if (result) {
        ESP_LOGE(TAG, "Failed to find on_peer_connected function: %s", result);
        return ESP_FAIL;
    }
    
    result = m3_FindFunction(&wasm_on_peer_disconnected, wasm_runtime, "on_peer_disconnected");
    if (result) {
        ESP_LOGE(TAG, "Failed to find on_peer_disconnected function: %s", result);
        return ESP_FAIL;
    }
    
    result = m3_FindFunction(&wasm_on_message, wasm_runtime, "on_message");
    if (result) {
        ESP_LOGE(TAG, "Failed to find on_message function: %s", result);
        return ESP_FAIL;
    }
    
    result = m3_FindFunction(&wasm_loop, wasm_runtime, "loop");
    if (result) {
        ESP_LOGE(TAG, "Failed to find loop function: %s", result);
        return ESP_FAIL;
    }
    
    ESP_LOGI(TAG, "WASM module loaded successfully");
    
    // Call init function
    result = m3_CallV(wasm_init);
    if (result) {
        ESP_LOGE(TAG, "Failed to call init: %s", result);
        return ESP_FAIL;
    }
    
    return ESP_OK;
}

// ============================================================================
// Main Task
// ============================================================================

/**
 * Main task - runs WASM loop periodically
 */
void pigeonhub_wasm_task(void *pvParameters) {
    ESP_LOGI(TAG, "PigeonHub WASM task started");
    
    // Start the server on port 3000
    const int port = 3000;
    M3Result result = m3_CallV(wasm_start_server, port);
    if (result) {
        ESP_LOGE(TAG, "Failed to call start_server: %s", result);
        vTaskDelete(NULL);
        return;
    }
    
    ESP_LOGI(TAG, "PigeonHub server running on port %d", port);
    
    // Main loop
    while (1) {
        // Call WASM loop function
        if (wasm_loop) {
            result = m3_CallV(wasm_loop);
            if (result) {
                ESP_LOGE(TAG, "Failed to call loop: %s", result);
            }
        }
        
        vTaskDelay(pdMS_TO_TICKS(1000));  // Run every second
    }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Initialize PigeonHub WASM server
 */
esp_err_t pigeonhub_wasm_init(const uint8_t* wasm_binary, size_t wasm_size) {
    esp_err_t err = load_wasm_module(wasm_binary, wasm_size);
    if (err != ESP_OK) {
        return err;
    }
    
    // Create main task
    xTaskCreate(pigeonhub_wasm_task, "pigeonhub_wasm", 8192, NULL, 5, NULL);
    
    return ESP_OK;
}
