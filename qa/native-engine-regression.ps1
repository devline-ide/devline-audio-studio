$ErrorActionPreference = 'Stop'
if (-not $env:DEVLINE_NATIVE_QA_DESKTOP.StartsWith('DevLine-QA-')) { throw 'Use tools/native-qa-desktop.ps1.' }
Set-Location -LiteralPath (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
'' | & 'C:/Program Files/CMake/bin/ctest.exe' --test-dir devline-audio-engine/build/native -C Release --output-on-failure -R ^engine_start$ *> build/sound-studio-qa/ux-native-start.log
exit $LASTEXITCODE
