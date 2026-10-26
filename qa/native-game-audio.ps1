$ErrorActionPreference = 'Stop'
if (-not $env:DEVLINE_NATIVE_QA_DESKTOP.StartsWith('DevLine-QA-')) { throw 'Use tools/native-qa-desktop.ps1.' }
$audioRepo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
Set-Location -LiteralPath $audioRepo
$env:JAVA_HOME = Join-Path $audioRepo 'devline-toolchain/build/install/application-toolchain/runtime'
$audioQaLog = Join-Path $audioRepo 'devline-audio-studio/build/native-game-audio.log'
& ./gradlew.bat :devline-game-jphp:gameAudioCheck --console=plain *> $audioQaLog
$audioQaExit = $LASTEXITCODE
Get-Content -Encoding UTF8 -LiteralPath $audioQaLog | Select-String 'PASS|FAILED|Exception|error:|e: '
$audioTemporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
foreach ($audioQaLine in Get-Content -Encoding UTF8 -LiteralPath $audioQaLog) {
    if ($audioQaLine.StartsWith('AUDIO_QA_RESOURCE_ROOT=')) {
        $audioOwnedFixture = [IO.Path]::GetFullPath($audioQaLine.Substring('AUDIO_QA_RESOURCE_ROOT='.Length).Trim())
        if (-not $audioOwnedFixture.StartsWith($audioTemporaryRoot, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($audioOwnedFixture) -notlike 'native-game-audio-*') { throw 'Unexpected QA fixture path.' }
        if (Test-Path -LiteralPath $audioOwnedFixture -PathType Container) { Remove-Item -LiteralPath $audioOwnedFixture -Recurse -Force }
    }
}
exit $audioQaExit
