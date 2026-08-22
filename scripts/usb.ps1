# Attach a Windows USB device (capture card, UART adapter) to Docker Desktop / WSL2.
# Docker cannot see USB by itself. Microsoft's path: usbipd-win.
# https://learn.microsoft.com/windows/wsl/connect-usb
#
#   .\scripts\usb.ps1 -List
#   .\scripts\usb.ps1 -BusId 2-4     # elevated PowerShell the first time (bind)

param(
	[switch]$List,
	[string]$BusId
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command usbipd -ErrorAction SilentlyContinue)) {
	Write-Error "usbipd not found. Install:  winget install --interactive --exact dorssel.usbipd-win"
}

if ($List) {
	usbipd list
	Write-Host ""
	Write-Host "Pick the capture card (or UART adapter) BUSID, then:"
	Write-Host "  .\scripts\usb.ps1 -BusId <BUSID>"
	exit 0
}

if (-not $BusId) {
	Write-Error "Usage:  .\scripts\usb.ps1 -List   or   .\scripts\usb.ps1 -BusId 2-4"
}

usbipd bind --busid $BusId
if ($LASTEXITCODE -ne 0) {
	Write-Error "bind failed. Open PowerShell as Administrator and run this once."
}

usbipd attach --wsl --busid $BusId
if ($LASTEXITCODE -ne 0) {
	Write-Error "attach failed. Run  wsl --update   then retry. Keep a WSL window open."
}

Write-Host "Attached $BusId to WSL. Capture card -> CAPTURE_DEVICE=/dev/video0. UART -> PICO_SERIAL=/dev/ttyUSB0"
Write-Host "Windows cannot use this USB until you detach:  usbipd detach --busid $BusId"
