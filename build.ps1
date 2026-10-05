param([string]$GamePath = 'E:\SteamLibrary\steamapps\common\Magicraft')
$ErrorActionPreference = 'Stop'
$managed = Join-Path $GamePath 'Magicraft_Data\Managed'
$core = Join-Path $PSScriptRoot 'tools\bepinex\BepInEx\core'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
New-Item -ItemType Directory -Force (Join-Path $PSScriptRoot 'dist') | Out-Null
$references = @(
    "$core\BepInEx.dll", "$core\0Harmony.dll",
    "$managed\mscorlib.dll", "$managed\System.dll", "$managed\System.Core.dll", "$managed\netstandard.dll",
    "$managed\UnityEngine.dll", "$managed\UnityEngine.CoreModule.dll", "$managed\Newtonsoft.Json.dll"
)
foreach ($reference in $references) { if (!(Test-Path -LiteralPath $reference)) { throw "Missing dependency: $reference" } }
$arguments = @('/nologo', '/noconfig', '/target:library', '/optimize+', '/nostdlib+', "/out:$PSScriptRoot\dist\MagicraftEventCollector.dll")
$arguments += $references | ForEach-Object { "/reference:$_" }
$arguments += Get-ChildItem "$PSScriptRoot\src\*.cs" | ForEach-Object FullName
& $compiler @arguments
if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
Write-Host 'Built dist\MagicraftEventCollector.dll'
