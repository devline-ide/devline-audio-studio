$ErrorActionPreference = 'Stop'
if (-not $env:DEVLINE_NATIVE_QA_DESKTOP.StartsWith('DevLine-QA-')) { throw 'Use tools/native-qa-desktop.ps1.' }
Set-Location -LiteralPath (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$audioPhase = if ($env:SOUND_VST_DIAGNOSTIC_PHASE) { $env:SOUND_VST_DIAGNOSTIC_PHASE } else { 'before' }
if ($audioPhase -notmatch '^[a-z0-9-]+$') { throw 'Invalid diagnostic phase.' }
$audioQuantum = if ($env:SOUND_VST_DIAGNOSTIC_QUANTUM) { $env:SOUND_VST_DIAGNOSTIC_QUANTUM } else { '256' }
$audioCheck = Join-Path (Get-Location) 'devline-audio-engine/build/native/bin/devline-audio-plugin-check.exe'
$audioFixture = Join-Path (Get-Location) 'devline-audio-engine/build/native/vst3/Release/devline-audio-test-plugin.vst3'
& $audioCheck $audioFixture '3F4A92117DA64F1893F05911ADE0B199' $audioQuantum *> "devline-audio-studio/build/vst-audio-$audioPhase-fixture.jsonl"
if ($LASTEXITCODE -ne 0) { throw 'Fixture realtime diagnostic failed.' }
& $audioCheck 'C:/Program Files/Common Files/VST3/Serum2.vst3' '56534558667350736572756D20320000' $audioQuantum *> "devline-audio-studio/build/vst-audio-$audioPhase-serum.jsonl"
if ($LASTEXITCODE -ne 0) { throw 'Serum realtime diagnostic failed.' }
