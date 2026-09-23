$ErrorActionPreference = 'Stop'

$build = Join-Path $env:RUNNER_TEMP 'auto-music-lvh-bridge'
cmake -S native/libvirtualhid-bridge -B $build -G 'Visual Studio 17 2022' -A x64
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
cmake --build $build --config Release --target auto-music-lvh-bridge
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Copy-Item (Join-Path $build 'Release/auto-music-lvh-bridge.exe') 'src-tauri/driver/auto-music-lvh-bridge.exe' -Force
