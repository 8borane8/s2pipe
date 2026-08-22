# Stop Compose, then detach usbipd. Ctrl+C / compose down while FFmpeg holds
# /dev/video0 can freeze UVC in WSL until reboot. Always stop this way on Windows.
#
#   .\scripts\stop.ps1
#   .\scripts\stop.ps1 -WslShutdown   # last resort instead of rebooting Windows

param(
	[switch]$WslShutdown
)

$ErrorActionPreference = "Continue"
Set-Location (Split-Path -Parent $PSScriptRoot)

$gpu = Join-Path (Get-Location) "docker-compose.gpu.yml"
if (Test-Path $gpu) {
	docker compose -f docker-compose.yml -f docker-compose.gpu.yml --profile all stop
} else {
	docker compose --profile all stop
}

Start-Sleep -Seconds 2

if (Get-Command usbipd -ErrorAction SilentlyContinue) {
	usbipd detach --all
	usbipd list
} else {
	Write-Host "usbipd not found; skipped USB detach."
}

if ($WslShutdown) {
	Write-Host "Shutting down WSL (Docker Desktop will restart it next launch)."
	wsl --shutdown
	return
}

Write-Host "If USB/GPU is still stuck:  .\scripts\stop.ps1 -WslShutdown"
Write-Host "That restarts WSL, not Windows."
