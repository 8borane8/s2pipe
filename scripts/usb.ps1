# Bind + attach a USB device to WSL so Docker can see it. Bind is not enough.
# Do not attach to docker-desktop: use Ubuntu (or any real distro).
# https://learn.microsoft.com/windows/wsl/connect-usb
#
#   .\scripts\usb.ps1 -List
#   .\scripts\usb.ps1 -BusId 2-4
#   .\scripts\usb.ps1 -Detach
#   .\scripts\usb.ps1 -Detach -BusId 2-4

param(
	[switch]$List,
	[switch]$Detach,
	[string]$BusId
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command usbipd -ErrorAction SilentlyContinue)) {
	Write-Error "usbipd not found. Install:  winget install --interactive --exact dorssel.usbipd-win"
}

if ($List) {
	usbipd list
	exit 0
}

if ($Detach) {
	if ($BusId) {
		usbipd detach --busid $BusId
	} else {
		usbipd detach --all
	}
	usbipd list
	exit 0
}

if (-not $BusId) {
	Write-Error "Usage:  .\scripts\usb.ps1 -List   or   .\scripts\usb.ps1 -BusId 2-4   or   .\scripts\usb.ps1 -Detach"
}

usbipd bind --busid $BusId
if ($LASTEXITCODE -ne 0) {
	Write-Error "bind failed. Open PowerShell as Administrator and run this once."
}

usbipd attach --wsl --busid $BusId
if ($LASTEXITCODE -ne 0) {
	Write-Error "attach failed. Install Ubuntu (wsl --install -d Ubuntu), start Docker Desktop, retry."
}

usbipd list
Write-Host "Stop stack + detach:  .\scripts\stop.ps1"
