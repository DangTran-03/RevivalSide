param(
  [string]$CaptureDir = (Join-Path (Split-Path -Parent $PSScriptRoot) "captures"),
  [string]$DumpcapPath = "C:\Program Files\Wireshark\dumpcap.exe",
  [string]$Interfaces = "all",
  [string]$CaptureFilter = "",
  [int]$PollSeconds = 2
)

$ErrorActionPreference = "Stop"

function New-CaptureDirectory {
  if (-not (Test-Path -LiteralPath $CaptureDir)) {
    New-Item -ItemType Directory -Path $CaptureDir | Out-Null
  }
}

function Start-Capture {
  New-CaptureDirectory

  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $interfaceList = Resolve-Interfaces
  $captures = @()

  foreach ($iface in $interfaceList) {
    $safeName = ($iface.Name -replace '[^A-Za-z0-9._-]+', '_').Trim('_')
    if ([string]::IsNullOrWhiteSpace($safeName)) {
      $safeName = "interface_$($iface.Id)"
    }
    $pcapFile = Join-Path $CaptureDir "counterside-all-$($iface.Id)-$safeName-$stamp.pcapng"
    $logFile = Join-Path $CaptureDir "dumpcap-$($iface.Id)-$safeName-$stamp.log"
    $args = "-i $($iface.Id) -s 0 -w `"$pcapFile`""
    if (-not [string]::IsNullOrWhiteSpace($CaptureFilter)) {
      $args = "-i $($iface.Id) -f `"$CaptureFilter`" -s 0 -w `"$pcapFile`""
    }
    $proc = Start-Process -FilePath $DumpcapPath -ArgumentList $args -RedirectStandardError $logFile -PassThru -WindowStyle Hidden
    $captures += [pscustomobject]@{
      Id = $iface.Id
      Name = $iface.Name
      Pid = $proc.Id
      File = $pcapFile
      Log = $logFile
    }
  }

  [pscustomobject]@{
    StartedAt = Get-Date
    Captures = $captures
  }
}

function Stop-Capture($capture) {
  foreach ($pidValue in @($capture.Captures | ForEach-Object { $_.Pid })) {
    $proc = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
    if ($proc) {
      Stop-Process -Id $pidValue -Force
    }
  }

  Start-Sleep -Seconds 1
  Write-Host "[capture] stopped"
  foreach ($item in $capture.Captures) {
    Write-Host "  $($item.Id) $($item.Name): $($item.File)"
  }
}

function Resolve-Interfaces {
  $raw = & $DumpcapPath -D
  $all = @()
  foreach ($line in $raw) {
    if ($line -match '^(\d+)\.\s+.+?\s+\((.+)\)\s*$') {
      $all += [pscustomobject]@{ Id = $matches[1]; Name = $matches[2] }
    }
  }

  if ($Interfaces -eq "all") {
    return $all
  }

  $requested = $Interfaces.Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ }
  return $all | Where-Object { $requested -contains $_.Id -or $requested -contains $_.Name }
}

if (-not (Test-Path -LiteralPath $DumpcapPath)) {
  throw "dumpcap not found at: $DumpcapPath"
}

$filterText = if ([string]::IsNullOrWhiteSpace($CaptureFilter)) { "<none>" } else { '"' + $CaptureFilter + '"' }
Write-Host "[capture] mode=manual-continuous filter=$filterText"
Write-Host "[capture] interfaces=$Interfaces"
Write-Host "[capture] captureDir=$CaptureDir"
Write-Host "[capture] running until this PowerShell process is stopped"

$capture = Start-Capture
Write-Host "[capture] started count=$($capture.Captures.Count) pids=$(($capture.Captures | ForEach-Object { $_.Pid }) -join ',')"

try {
  while ($true) {
    $dead = @($capture.Captures | Where-Object { $null -eq (Get-Process -Id $_.Pid -ErrorAction SilentlyContinue) })
    if ($dead.Count -gt 0) {
      Write-Host "[capture] dumpcap exited unexpectedly; restarting capture"
      Stop-Capture $capture
      $capture = Start-Capture
      Write-Host "[capture] restarted count=$($capture.Captures.Count) pids=$(($capture.Captures | ForEach-Object { $_.Pid }) -join ',')"
    }

    Start-Sleep -Seconds $PollSeconds
  }
} finally {
  if ($capture) {
    Stop-Capture $capture
  }
}
