/**
 * ESP32 Bridge Header for PigeonHub WASM Server
 */

#ifndef PIGEONHUB_ESP32_BRIDGE_H
#define PIGEONHUB_ESP32_BRIDGE_H

#include "esp_err.h"
#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Initialize PigeonHub WASM server on ESP32
 * 
 * @param wasm_binary Pointer to WASM binary data
 * @param wasm_size Size of WASM binary in bytes
 * @return ESP_OK on success, error code otherwise
 */
esp_err_t pigeonhub_wasm_init(const uint8_t* wasm_binary, size_t wasm_size);

#ifdef __cplusplus
}
#endif

#endif // PIGEONHUB_ESP32_BRIDGE_H
