# PigeonHub ESP32 Setup Script for Windows
# This script automates the installation of all dependencies needed to build and flash PigeonHub to ESP32
# Run this script in PowerShell as Administrator

# Requires PowerShell 5.0 or later
#Requires -Version 5.0

# Color output functions
function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "[SUCCESS] $Message" -ForegroundColor Green
}

function Write-Warning {
    param([string]$Message)
    Write-Host "[WARNING] $Message" -ForegroundColor Yellow
}

function Write-Error {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

# Banner
Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║         PigeonHub ESP32 Setup for Windows               ║" -ForegroundColor Cyan
Write-Host "║         Automated Installation Script                   ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Check if running as Administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Warning "This script should be run as Administrator for best results."
    $continue = Read-Host "Continue anyway? (y/n)"
    if ($continue -ne "y") {
        exit 1
    }
}

# Check for Chocolatey
Write-Info "Checking for Chocolatey package manager..."
if (!(Get-Command choco -ErrorAction SilentlyContinue)) {
    Write-Warning "Chocolatey not found. Installing Chocolatey..."
    Set-ExecutionPolicy Bypass -Scope Process -Force
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
    Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
    Write-Success "Chocolatey installed"
    
    # Refresh environment
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
} else {
    Write-Success "Chocolatey found"
}

# Install Python
Write-Info "Checking for Python..."
if (!(Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Warning "Python not found. Installing Python..."
    choco install python -y
    Write-Success "Python installed"
    
    # Refresh environment
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
} else {
    $pythonVersion = python --version
    Write-Success "Python found: $pythonVersion"
}

# Install Git
Write-Info "Checking for Git..."
if (!(Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Warning "Git not found. Installing Git..."
    choco install git -y
    Write-Success "Git installed"
    
    # Refresh environment
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
} else {
    Write-Success "Git found"
}

# Install Python packages
Write-Info "Installing Python packages..."
python -m pip install --upgrade pip
pip install platformio esptool
Write-Success "Python packages installed"

# Install Node.js (for wasm-opt)
Write-Info "Checking for Node.js..."
if (!(Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Warning "Node.js not found. Installing Node.js..."
    choco install nodejs -y
    Write-Success "Node.js installed"
    
    # Refresh environment
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
} else {
    $nodeVersion = node --version
    Write-Success "Node.js found: $nodeVersion"
}

# Install wasm-opt
Write-Info "Installing wasm-opt for WASM optimization..."
npm install -g wasm-opt
Write-Success "wasm-opt installed"

# Install LLVM (includes clang)
Write-Info "Checking for LLVM/clang..."
if (!(Get-Command clang -ErrorAction SilentlyContinue)) {
    Write-Warning "LLVM/clang not found. Installing LLVM..."
    choco install llvm -y
    Write-Success "LLVM installed"
    
    # Refresh environment
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
} else {
    Write-Success "clang found"
}

# Install Make
Write-Info "Checking for Make..."
if (!(Get-Command make -ErrorAction SilentlyContinue)) {
    Write-Warning "Make not found. Installing Make..."
    choco install make -y
    Write-Success "Make installed"
    
    # Refresh environment
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
} else {
    Write-Success "Make found"
}

# Install WASI-SDK
Write-Info "Checking for WASI-SDK..."
$wasiSdkPath = "C:\wasi-sdk"
$wasiSdkVersion = "20.0"

if (!(Test-Path $wasiSdkPath)) {
    Write-Warning "WASI-SDK not found. Installing WASI-SDK $wasiSdkVersion..."
    
    $downloadUrl = "https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-20/wasi-sdk-$wasiSdkVersion-mingw.tar.gz"
    $tempFile = "$env:TEMP\wasi-sdk.tar.gz"
    
    Write-Info "Downloading WASI-SDK..."
    Invoke-WebRequest -Uri $downloadUrl -OutFile $tempFile
    
    Write-Info "Extracting WASI-SDK..."
    # Install 7-Zip if not present
    if (!(Get-Command 7z -ErrorAction SilentlyContinue)) {
        choco install 7zip -y
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    }
    
    7z x $tempFile -o"$env:TEMP" -y
    $extractedPath = "$env:TEMP\wasi-sdk-$wasiSdkVersion"
    Move-Item -Path $extractedPath -Destination $wasiSdkPath -Force
    
    # Add to PATH
    $currentPath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    if ($currentPath -notlike "*$wasiSdkPath\bin*") {
        [Environment]::SetEnvironmentVariable("Path", "$currentPath;$wasiSdkPath\bin", "Machine")
    }
    
    Remove-Item $tempFile
    Write-Success "WASI-SDK installed to $wasiSdkPath"
} else {
    Write-Success "WASI-SDK found at $wasiSdkPath"
}

# Install USB drivers
Write-Info "Checking for USB drivers..."
Write-Warning "ESP32 may require USB-to-Serial drivers:"
Write-Host "  - CH340/CH341: http://www.wch-ic.com/downloads/CH341SER_ZIP.html"
Write-Host "  - CP210x: https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers"
Write-Host "  - FTDI: https://ftdichip.com/drivers/vcp-drivers/"
Write-Host ""
$installDrivers = Read-Host "Open driver download pages? (y/n)"
if ($installDrivers -eq "y") {
    Start-Process "http://www.wch-ic.com/downloads/CH341SER_ZIP.html"
    Start-Process "https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers"
}

# Ask user about Arduino IDE or PlatformIO
Write-Host ""
Write-Info "Choose your development environment:"
Write-Host "  1) PlatformIO (Recommended - CLI and VS Code)"
Write-Host "  2) Arduino IDE"
Write-Host "  3) Both"
Write-Host "  4) Skip (I'll install manually)"
$devChoice = Read-Host "Enter choice [1-4]"

switch ($devChoice) {
    "1" {
        Write-Info "PlatformIO is already installed via pip above"
    }
    "2" {
        Write-Info "Installing Arduino IDE..."
        choco install arduino -y
        Write-Success "Arduino IDE installed"
        Write-Warning "After starting Arduino IDE, add ESP32 board support:"
        Write-Host "  1. Go to File → Preferences"
        Write-Host "  2. Add this URL to 'Additional Board Manager URLs':"
        Write-Host "     https://espressif.github.io/arduino-esp32/package_esp32_index.json"
        Write-Host "  3. Go to Tools → Board → Boards Manager"
        Write-Host "  4. Search for 'esp32' and install 'ESP32 by Espressif Systems'"
        Write-Host "  5. Install libraries: WebSockets by Markus Sattler, Wasm3"
        Read-Host "Press Enter to continue..."
    }
    "3" {
        Write-Info "PlatformIO is already installed"
        Write-Info "Installing Arduino IDE..."
        choco install arduino -y
        Write-Success "Arduino IDE installed"
        Write-Warning "Please follow Arduino IDE setup instructions above"
        Read-Host "Press Enter to continue..."
    }
    "4" {
        Write-Info "Skipping IDE installation"
    }
}

# Refresh environment one more time
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

# Build the WASM module
Write-Host ""
Write-Info "Building PigeonHub WASM module..."

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$esp32Dir = Split-Path -Parent $scriptDir
Set-Location $esp32Dir

# Set WASI_SDK_PATH environment variable for make
$env:WASI_SDK_PATH = $wasiSdkPath

try {
    make wasm
    Write-Success "WASM module built successfully!"
    
    # Optimize if wasm-opt is available
    if (Get-Command wasm-opt -ErrorAction SilentlyContinue) {
        Write-Info "Optimizing WASM module..."
        make wasm-opt
        Write-Success "WASM module optimized"
    }
} catch {
    Write-Error "WASM build failed. Please check the error messages above."
    Write-Warning "You may need to close and reopen PowerShell for PATH changes to take effect."
    exit 1
}

# Copy WASM to esp32-sketch
Write-Info "Installing WASM module to esp32-sketch..."
make install
Write-Success "WASM module installed"

# Setup complete
Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║              Setup Complete! 🎉                          ║" -ForegroundColor Green
Write-Host "╚══════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""

Write-Info "Next steps:"
Write-Host ""
Write-Host "  IMPORTANT: Close and reopen PowerShell/Terminal for PATH changes to take effect."
Write-Host ""
Write-Host "  For PlatformIO:"
Write-Host "    cd esp32-sketch"
Write-Host "    pio run --target upload --target monitor"
Write-Host ""
Write-Host "  For Arduino IDE:"
Write-Host "    1. Open esp32-sketch\esp32-sketch.ino"
Write-Host "    2. Select your board: Tools → Board → ESP32"
Write-Host "    3. Select your port: Tools → Port"
Write-Host "    4. Click Upload"
Write-Host ""
Write-Host "  Connect your ESP32 via USB and flash the firmware!"
Write-Host ""
Write-Info "For troubleshooting, see: embedded/esp32/README.md"
Write-Host ""
Write-Warning "Note: You may need to restart your computer for all changes to take effect."
