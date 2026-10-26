$ErrorActionPreference = 'Stop'
if (-not $env:DEVLINE_NATIVE_QA_DESKTOP.StartsWith('DevLine-QA-')) { throw 'Use tools/native-qa-desktop.ps1.' }
Set-Location -LiteralPath (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
& node ./devline-audio-studio/qa/native-vst.mjs
exit $LASTEXITCODE
