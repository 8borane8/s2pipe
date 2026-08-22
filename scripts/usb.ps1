# Attach a Windows USB device to WSL so Docker can see it.
# bind (share) is not enough. Never attach to docker-desktop — it has no usbip client.
# https://learn.microsoft.com/windows/wsl/connect-usb
#
#   .\scripts\usb.ps1 -List
#   .\scripts\usb.ps1 -BusId 2-4

param(
	[switch]$List,
	[string]$BusId
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

function Get-WslNames {
	& wsl.exe -l -q 2>$null |
		ForEach-Object { ($_ -replace "\u0000", "").Trim() } |
		Where-Object { $_ -and $_ -notmatch "^docker-desktop" }
}

function Invoke-WslSh([string]$Distro, [string]$Command) {
	& wsl.exe -d $Distro -u root -- sh -c $Command
	return $LASTEXITCODE -eq 0
}

if (-not (Get-Command usbipd -ErrorAction SilentlyContinue)) {
	Write-Error "usbipd not found. Install:  winget install --interactive --exact dorssel.usbipd-win"
}

if ($List) {
	usbipd list
	Write-Host ""
	Write-Host "Need Shared + Attached, not only Shared. Then:"
	Write-Host "  .\scripts\usb.ps1 -BusId <BUSID>"
	Write-Host "Attach uses a real WSL distro (Ubuntu), never docker-desktop."
	exit 0
}

if (-not $BusId) {
	Write-Error "Usage:  .\scripts\usb.ps1 -List   or   .\scripts\usb.ps1 -BusId 2-4"
}

$bindOut = & usbipd bind --busid $BusId 2>&1 | Out-String
if ($LASTEXITCODE -ne 0 -and $bindOut -notmatch "(?i)already") {
	Write-Error "bind failed. Open PowerShell as Administrator and run this once.`n$bindOut"
}

# usbipd attaches to a real distro; the device is then in every WSL 2 distro
# (one kernel), including Docker Desktop containers with /dev:/dev.
$attachOut = & usbipd attach --wsl --busid $BusId 2>&1 | Out-String
if ($attachOut.Trim()) { Write-Host $attachOut.TrimEnd() }

if ($LASTEXITCODE -ne 0 -and $attachOut -notmatch "(?i)already") {
	$ok = $false
	foreach ($name in @(Get-WslNames)) {
		Write-Host "retry: attach --distribution $name"
		$retry = & usbipd attach --wsl --distribution $name --busid $BusId 2>&1 | Out-String
		if ($retry.Trim()) { Write-Host $retry.TrimEnd() }
		if ($LASTEXITCODE -eq 0 -or $retry -match "(?i)already") {
			$ok = $true
			break
		}
	}
	if (-not $ok) {
		Write-Error @"
attach failed. docker-desktop cannot attach USB.
Install a real distro once, then retry (Docker Desktop must be running):
  wsl --install -d Ubuntu
  .\scripts\usb.ps1 -BusId $BusId
"@
	}
}

Start-Sleep -Seconds 2
usbipd list

$probe = @'
modprobe uvcvideo 2>/dev/null || true
echo "--- /dev/video* ---"
ls -l /dev/video* 2>/dev/null || echo "(none)"
echo "--- /dev/ttyUSB* /dev/ttyACM* ---"
ls -l /dev/ttyUSB* /dev/ttyACM* 2>/dev/null || echo "(none)"
echo "--- USB ---"
lsusb 2>/dev/null || echo "(lsusb not installed)"
'@

Write-Host ""
Write-Host "Linux nodes (FFmpeg: /dev/video*  Pico: /dev/ttyUSB* or /dev/ttyACM*):"

foreach ($name in @(Get-WslNames)) {
	Write-Host ""
	Write-Host "=== $name ==="
	[void](Invoke-WslSh $name $probe)
}

Write-Host ""
Write-Host "=== docker-desktop ==="
if (-not (Invoke-WslSh "docker-desktop" $probe)) {
	Write-Host "(not running — start Docker Desktop)"
}

Write-Host ""
Write-Host "If USB is listed but /dev/video* is none: the WSL kernel has no camera driver (UVC)."
Write-Host "Serial adapters still get /dev/ttyUSB0. HDMI capture on Windows needs Linux or a custom WSL kernel."
Write-Host "Detach later:  usbipd detach --busid $BusId"
