# Quick flash script for ESP32 (Windows)
# Automatically detects port and flashes the firmware

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║         PigeonHub ESP32 Flash Tool                      ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Navigate to esp32-sketch directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$esp32Dir = Split-Path -Parent $scriptDir
$sketchDir = Join-Path $esp32Dir "esp32-sketch"

if (!(Test-Path $sketchDir)) {
    Write-Host "Error: esp32-sketch directory not found!" -ForegroundColor Red
    exit 1
}

Set-Location $sketchDir

# Check if PlatformIO is installed
if (!(Get-Command pio -ErrorAction SilentlyContinue)) {
    Write-Host "Error: PlatformIO not found!" -ForegroundColor Red
    Write-Host "Please install PlatformIO first:"
    Write-Host "  pip install platformio"
    exit 1
}

# Detect COM port
Write-Host "Detecting ESP32..." -ForegroundColor Cyan

$comPorts = Get-CimInstance Win32_PnPEntity | Where-Object { $_.Name -match "COM\d+" }
$espPorts = $comPorts | Where-Object { $_.Name -match "CH340|CP210|FTDI|USB" }

$port = $null
if ($espPorts) {
    $portMatch = [regex]::Match($espPorts[0].Name, "\(COM(\d+)\)")
    if ($portMatch.Success) {
        $port = "COM" + $portMatch.Groups[1].Value
        Write-Host "✓ Found ESP32 at: $port" -ForegroundColor Green
    }
} 

if (!$port) {
    Write-Host "⚠ Could not auto-detect ESP32 port" -ForegroundColor Yellow
    Write-Host "Available ports:"
    if ($comPorts) {
        $comPorts | ForEach-Object {
            $portMatch = [regex]::Match($_.Name, "\(COM(\d+)\)")
            if ($portMatch.Success) {
                Write-Host "  - COM$($portMatch.Groups[1].Value) : $($_.Name)"
            }
        }
    } else {
        Write-Host "  (none)"
    }
    Write-Host ""
    $manualPort = Read-Host "Enter port manually (or press Enter to continue without specifying)"
    if ($manualPort) {
        $port = $manualPort
    }
}

# Ask for board type
Write-Host ""
Write-Host "Select your ESP32 board:"
Write-Host "  1) ESP32 Dev Module (default)"
Write-Host "  2) ESP32-S3"
Write-Host "  3) ESP32-C3"
$boardChoice = Read-Host "Enter choice [1-3] (default: 1)"

switch ($boardChoice) {
    "2" { $env = "esp32-s3" }
    "3" { $env = "esp32-c3" }
    default { $env = "esp32dev" }
}

# Build command
$buildCmd = "pio run -e $env"
if ($port) {
    $buildCmd += " --upload-port $port"
}

# Ask what to do
Write-Host ""
Write-Host "What would you like to do?"
Write-Host "  1) Upload only"
Write-Host "  2) Upload and monitor"
Write-Host "  3) Monitor only"
$actionChoice = Read-Host "Enter choice [1-3] (default: 2)"

switch ($actionChoice) {
    "1" { $target = "upload" }
    "3" { $target = "monitor" }
    default { $target = "upload monitor" }
}

# Execute
Write-Host ""
Write-Host "Executing: pio run -e $env --target $target" -ForegroundColor Cyan
Write-Host ""

$targetArgs = $target -split " "
$pioArgs = @("-e", $env)
foreach ($t in $targetArgs) {
    $pioArgs += @("--target", $t)
}
if ($port) {
    $pioArgs += @("--upload-port", $port)
}

& pio run @pioArgs

Write-Host ""
Write-Host "✓ Done!" -ForegroundColor Green
