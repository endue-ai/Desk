# Expose the packaged CLI for this PowerShell session.
$ErrorActionPreference = 'Stop'
foreach ($name in 'endue', 'desk') {
    $owned = Join-Path $PSScriptRoot "$name.exe"
    if (-not (Test-Path -LiteralPath $owned -PathType Leaf)) {
        throw "Missing packaged command: $owned"
    }
    $active = Get-Command $name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($active -and ($active.CommandType -ne 'Application' -or $active.Path -ne $owned)) {
        throw "$name already resolves to $($active.Definition). Run $owned directly."
    }
}
if (($env:PATH -split ';') -notcontains $PSScriptRoot) {
    $env:PATH = "$PSScriptRoot;$env:PATH"
}
