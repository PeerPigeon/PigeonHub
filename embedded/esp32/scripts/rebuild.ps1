# Quick rebuild script for PigeonHub WASM module (Windows)
# Run this after making changes to pigeonhub_client.c

Write-Host "Rebuilding PigeonHub WASM module..." -ForegroundColor Cyan

# Navigate to ESP32 directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$esp32Dir = Split-Path -Parent $scriptDir
Set-Location $esp32Dir

# Set WASI_SDK_PATH
$env:WASI_SDK_PATH = "C:\wasi-sdk"

# Clean previous build
Write-Host "Cleaning..." -ForegroundColor Gray
make clean

# Build WASM
Write-Host "Building WASM..." -ForegroundColor Gray
make wasm

# Optimize if wasm-opt is available
if (Get-Command wasm-opt -ErrorAction SilentlyContinue) {
    Write-Host "Optimizing..." -ForegroundColor Gray
    make wasm-opt
}

# Install to esp32-sketch
Write-Host "Installing to esp32-sketch..." -ForegroundColor Gray
make install

# Show file size
$wasmSize = (Get-Item "pigeonhub_client.wasm").Length
$wasmSizeKB = [math]::Round($wasmSize / 1KB, 2)

Write-Host ""
Write-Host "✓ Build complete!" -ForegroundColor Green
Write-Host "  WASM module: $wasmSizeKB KB"
Write-Host ""
Write-Host "To flash to ESP32:"
Write-Host "  cd esp32-sketch"
Write-Host "  pio run --target upload --target monitor"
