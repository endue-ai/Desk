# Install smoke, Windows: install the NSIS setup silently, start the installed app, wait for the
# runtime's ready line, then stop it (the app stays resident without frames, ADR 0019).
#
# usage: pwsh e2e/smoke/launch.ps1 -Setup <path to -setup.exe> [-Seconds 90]
param(
  [Parameter(Mandatory = $true)][string]$Setup,
  [int]$Seconds = 90
)
$ErrorActionPreference = "Stop"

Start-Process -FilePath $Setup -ArgumentList "/S" -Wait
$exe = Join-Path $env:LOCALAPPDATA "endue Desk\endue-desk.exe"
if (-not (Test-Path $exe)) { throw "launch: $exe was not installed" }

$out = New-TemporaryFile
$err = New-TemporaryFile
$app = Start-Process -FilePath $exe -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
for ($i = 0; $i -lt $Seconds; $i++) {
  $ready = Select-String -Path $out -Pattern "^desk ready" -ErrorAction SilentlyContinue
  if ($ready) {
    Write-Output $ready.Line
    Stop-Process -Id $app.Id -Force
    exit 0
  }
  if ($app.HasExited) {
    Get-Content $out, $err
    throw "launch: the app exited before it was ready"
  }
  Start-Sleep -Seconds 1
}
Get-Content $out, $err
Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue
throw "launch: no ready line after $Seconds s"
