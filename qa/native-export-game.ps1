$ErrorActionPreference = 'Stop'
if (-not $env:DEVLINE_NATIVE_QA_DESKTOP.StartsWith('DevLine-QA-')) { throw 'Use tools/native-qa-desktop.ps1.' }
Set-Location -LiteralPath (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$env:JAVA_HOME = Join-Path (Get-Location).Path 'devline-toolchain/build/install/application-toolchain/runtime'
& ./gradlew.bat :devline-application:soundStudioApplicationCheck -PtoolchainInstallDir=build/sound-studio-qa/toolchain-a1 -PruntimeDir=build/qa-settings-unify-20261022/r1/IDE/runtime --console=plain *> devline-audio-studio/build/export-game.log
$audioExit = $LASTEXITCODE
Get-Content -Encoding UTF8 devline-audio-studio/build/export-game.log -Tail 35
exit $audioExit
