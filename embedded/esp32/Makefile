# Makefile for PigeonHub WASM Client
# Supports both WASI-SDK and Emscripten toolchains

# Compiler selection
# Use WASI-SDK for ESP32 (recommended)
# Use Emscripten for web browsers
WASI_SDK_PATH ?= /opt/wasi-sdk
CC = $(WASI_SDK_PATH)/bin/clang

# Alternative: Use Emscripten
# CC = emcc

# Source files
SRC = pigeonhub_client.c
OUT = pigeonhub_client.wasm

# Compiler flags
CFLAGS = -O3 \
         -flto \
         --target=wasm32-wasi \
         -nostdlib \
         -Wl,--no-entry \
         -Wl,--export-all \
         -Wl,--allow-undefined \
         -Wl,--strip-all \
         -mbulk-memory \
         -mmutable-globals

# Memory configuration for ESP32
MEMORY_FLAGS = -Wl,--initial-memory=131072 \
               -Wl,--max-memory=262144

# Build targets
.PHONY: all clean wasm wasm-opt install

all: wasm

wasm: $(SRC)
	@echo "Building WASM module for ESP32..."
	$(CC) $(CFLAGS) $(MEMORY_FLAGS) -o $(OUT) $(SRC)
	@echo "Build complete: $(OUT)"
	@ls -lh $(OUT)

wasm-opt: wasm
	@echo "Optimizing WASM module..."
	@which wasm-opt > /dev/null || (echo "wasm-opt not found. Install with: npm install -g wasm-opt" && exit 1)
	wasm-opt -O3 --strip-debug --strip-dwarf -o $(OUT).opt $(OUT)
	mv $(OUT).opt $(OUT)
	@echo "Optimization complete"
	@ls -lh $(OUT)

# Build with Emscripten (alternative)
emscripten:
	@echo "Building with Emscripten..."
	emcc $(SRC) \
		-O3 \
		-s WASM=1 \
		-s EXPORTED_FUNCTIONS='["_init","_connect","_disconnect","_broadcast","_send_to_peer","_on_message","_loop","_is_connected","_get_peer_count","_malloc","_free"]' \
		-s ALLOW_MEMORY_GROWTH=1 \
		-s INITIAL_MEMORY=64KB \
		-s MAXIMUM_MEMORY=128KB \
		-o pigeonhub_client_em.wasm
	@echo "Emscripten build complete"

install: wasm
	@echo "Installing WASM module..."
	mkdir -p ./esp32-sketch/data
	cp $(OUT) ./esp32-sketch/data/
	@echo "Installation complete"

clean:
	rm -f $(OUT) $(OUT).opt pigeonhub_client_em.wasm *.o

# Help target
help:
	@echo "PigeonHub WASM Client Build System"
	@echo ""
	@echo "Targets:"
	@echo "  all        - Build WASM module (default)"
	@echo "  wasm       - Build WASM module with WASI-SDK"
	@echo "  wasm-opt   - Build and optimize WASM module"
	@echo "  emscripten - Build with Emscripten toolchain"
	@echo "  install    - Install to examples directory"
	@echo "  clean      - Remove build artifacts"
	@echo "  help       - Show this help message"
	@echo ""
	@echo "Environment Variables:"
	@echo "  WASI_SDK_PATH - Path to WASI-SDK (default: /opt/wasi-sdk)"
	@echo ""
	@echo "Requirements:"
	@echo "  - WASI-SDK: https://github.com/WebAssembly/wasi-sdk"
	@echo "  - wasm-opt (optional): npm install -g wasm-opt"
