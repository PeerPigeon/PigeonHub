cmake_minimum_required(VERSION 3.10)
project(pigeonhub_wasm C)

set(CMAKE_C_STANDARD 11)

# Set output directory
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/bin)

# WASM build configuration
if(BUILD_WASM)
    set(CMAKE_C_COMPILER "clang")
    set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} --target=wasm32-wasi")
    set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -nostdlib -Wl,--no-entry")
    set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -Wl,--export-all -Wl,--allow-undefined")
    set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -O3 -flto")
    set(CMAKE_EXECUTABLE_SUFFIX ".wasm")
endif()

# Source files
set(SOURCES
    pigeonhub_client.c
)

# Create WASM module
add_executable(pigeonhub_client ${SOURCES})

# Optional: Enable optimizations
if(CMAKE_BUILD_TYPE STREQUAL "Release")
    target_compile_options(pigeonhub_client PRIVATE -O3 -flto)
endif()

# Installation
install(TARGETS pigeonhub_client 
        RUNTIME DESTINATION bin
        LIBRARY DESTINATION lib)
