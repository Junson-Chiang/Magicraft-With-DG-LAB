param([string]$GamePath = 'E:\SteamLibrary\steamapps\common\Magicraft')
$ErrorActionPreference = 'Stop'
$GamePath = (Resolve-Path -LiteralPath $GamePath).Path
if (!(Test-Path -LiteralPath (Join-Path $GamePath 'Magicraft.exe'))) { throw 'Target is not a Magicraft installation.' }
if (Get-Process Magicraft -ErrorAction SilentlyContinue) { throw 'Close Magicraft before installing.' }
$loader = Join-Path $PSScriptRoot 'tools\bepinex'
$core = Join-Path $GamePath 'BepInEx\core\BepInEx.dll'
if (!(Test-Path -LiteralPath $core)) {
    foreach ($name in @('winhttp.dll', 'doorstop_config.ini', '.doorstop_version')) {
        if (Test-Path -LiteralPath (Join-Path $GamePath $name)) { throw "Existing loader file: $name. Inspect before installing BepInEx." }
    }
    Get-ChildItem -LiteralPath $loader -Force | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $GamePath -Recurse }
}
$destination = Join-Path $GamePath 'BepInEx\plugins\MagicraftEventCollector'
New-Item -ItemType Directory -Force $destination | Out-Null
$target = Join-Path $destination 'MagicraftEventCollector.dll'
if (Test-Path -LiteralPath $target) {
    Copy-Item -LiteralPath $target -Destination ($target + '.' + (Get-Date -Format 'yyyyMMddHHmmss') + '.bak')
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'dist\MagicraftEventCollector.dll') -Destination $target -Force
Write-Host "Installed: $target"
