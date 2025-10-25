# PigeonHub ESP32 Installation Verification Script for Windows
# Run this to verify all dependencies are installed correctly

# Color output functions
function Write-Pass {
    param([string]$Message)
    Write-Host "✓ $Message" -ForegroundColor Green
}

function Write-Fail {
    param([string]$Message)
    Write-Host "✗ $Message" -ForegroundColor Red
}

function Write-Warn {
    param([string]$Message)
    Write-Host "⚠ $Message" -ForegroundColor Yellow
}

function Write-Section {
    param([string]$Message)
    Write-Host "`n$Message" -ForegroundColor Cyan
}

$script:PASS = 0
$script:FAIL = 0

function Test-Command {
    param(
        [string]$Command,
        [string]$Name,
        [bool]$Optional = $false
    )
    
    if (Get-Command $Command -ErrorAction SilentlyContinue) {
        try {
            $version = & $Command --version 2>&1 | Select-Object -First 1
            Write-Pass "$Name : $version"
            $script:PASS++
            return $true
        } catch {
            Write-Pass "$Name : Found"
            $script:PASS++
            return $true
        }
    } else {
        if ($Optional) {
            Write-Warn "$Name : Not found (optional)"
        } else {
            Write-Fail "$Name : Not found"
            $script:FAIL++
        }
        return $false
    }
}

function Test-PathExists {
    param(
        [string]$Path,
        [string]$Name
    )
    
    if (Test-Path $Path) {
        Write-Pass "$Name : $Path"
        $script:PASS++
        return $true
    } else {
        Write-Fail "$Name : Not found at $Path"
        $script:FAIL++
        return $false
    }
}

function Test-FileExists {
    param(
        [string]$FilePath,
        [string]$Name
    )
    
    if (Test-Path $FilePath -PathType Leaf) {
        $size = (Get-Item $FilePath).Length
        $sizeKB = [math]::Round($size / 1KB, 2)
        Write-Pass "$Name : $FilePath ($sizeKB KB)"
        $script:PASS++
        return $true
    } else {
        Write-Fail "$Name : Not found at $FilePath"
        $script:FAIL++
        return $false
    }
}

# Banner
Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║         PigeonHub ESP32 Verification                    ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# System Information
Write-Section "System Information:"
$osInfo = Get-CimInstance Win32_OperatingSystem
Write-Host "OS: $($osInfo.Caption) $($osInfo.Version)"
Write-Host ""

# Check core tools
Write-Section "Core Tools:"
Test-Command "python" "Python"
Test-Command "pip" "pip"
Test-Command "git" "Git"
Test-Command "make" "Make"

# Check ESP32 tools
Write-Section "ESP32 Tools:"
Test-Command "pio" "PlatformIO"
Test-Command "esptool.py" "esptool"

# Check WASM tools
Write-Section "WebAssembly Tools:"
Test-Command "clang" "clang"
Test-Command "node" "Node.js"
Test-Command "npm" "npm"
Test-Command "wasm-opt" "wasm-opt" -Optional $true

# Check WASI-SDK
Write-Section "WASI-SDK:"
Test-PathExists "C:\wasi-sdk" "WASI-SDK"
Test-PathExists "C:\wasi-sdk\bin\clang.exe" "WASI clang"

# Check WASM files
Write-Section "Build Artifacts:"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$esp32Dir = Split-Path -Parent $scriptDir

Test-FileExists "$esp32Dir\pigeonhub_client.wasm" "WASM module"
Test-FileExists "$esp32Dir\esp32-sketch\data\pigeonhub_client.wasm" "WASM in sketch"

# Check USB devices
Write-Section "USB Devices:"
$comPorts = Get-CimInstance Win32_PnPEntity | Where-Object { $_.Name -match "COM\d+" }
if ($comPorts) {
    Write-Pass "USB serial devices found:"
    $comPorts | ForEach-Object {
        $portMatch = [regex]::Match($_.Name, "\(COM(\d+)\)")
        if ($portMatch.Success) {
            $portName = "COM" + $portMatch.Groups[1].Value
            Write-Host "  - $portName : $($_.Name)" -ForegroundColor Gray
        }
    }
    $script:PASS++
} else {
    Write-Warn "No COM ports found (connect ESP32 to verify)"
}

# Check PATH
Write-Section "Environment Variables:"
$pathDirs = $env:Path -split ";"
$hasWasiSdk = $pathDirs | Where-Object { $_ -like "*wasi-sdk*" }
if ($hasWasiSdk) {
    Write-Pass "WASI-SDK in PATH"
    $script:PASS++
} else {
    Write-Warn "WASI-SDK not in PATH (may need to restart terminal)"
}

# Summary
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "Passed: $script:PASS  Failed: $script:FAIL"
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

if ($script:FAIL -eq 0) {
    Write-Host "✓ All checks passed! You're ready to build and flash ESP32!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:"
    Write-Host "  cd $esp32Dir\esp32-sketch"
    Write-Host "  pio run --target upload --target monitor"
    exit 0
} else {
    Write-Host "✗ Some checks failed. Please review the errors above." -ForegroundColor Red
    Write-Host ""
    Write-Host "To fix issues, re-run the setup script:"
    Write-Host "  cd $scriptDir"
    Write-Host "  powershell -ExecutionPolicy Bypass -File setup-windows.ps1"
    Write-Host ""
    Write-Host "Note: You may need to restart your terminal or computer for PATH changes to take effect."
    exit 1
}
