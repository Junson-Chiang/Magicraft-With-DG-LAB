$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot 'bridge')
try { & node main.js } finally { Pop-Location }
