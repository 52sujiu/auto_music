$ErrorActionPreference = 'Stop'

$build = Join-Path $env:RUNNER_TEMP 'auto-music-interception-bridge'
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$version = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationVersion
if (-not $version) { throw '未找到带 C++ 工具链的 Visual Studio' }
$major = [int]($version.Split('.')[0])
$generator = if ($major -ge 18) { 'Visual Studio 18 2026' } else { 'Visual Studio 17 2022' }
cmake -S native/interception-bridge -B $build -G $generator -A x64
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
cmake --build $build --config Release --target auto-music-interception-bridge
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Copy-Item (Join-Path $build 'Release/auto-music-interception-bridge.exe') 'src-tauri/driver/auto-music-interception-bridge.exe' -Force
