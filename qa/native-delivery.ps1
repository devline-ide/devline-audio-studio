$ErrorActionPreference = 'Stop'
if (-not $env:DEVLINE_NATIVE_QA_DESKTOP.StartsWith('DevLine-QA-')) { throw 'Use tools/native-qa-desktop.ps1.' }
Set-Location -LiteralPath (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
if (-not $env:SOUND_QA_DIST) { throw 'Choose a fresh SOUND_QA_DIST.' }
$audioDistribution = (Resolve-Path -LiteralPath $env:SOUND_QA_DIST).Path
$audioRelease = Join-Path $audioDistribution 'sound-studio-release'
$audioAgent = Join-Path (Get-Location) 'build/sound-studio-qa/native-delivery-agent'
New-Item -ItemType Directory -Force -Path (Join-Path $audioAgent 'classes') | Out-Null
& (Join-Path $audioDistribution 'runtime/bin/javac.exe') -d (Join-Path $audioAgent 'classes') (Join-Path $PSScriptRoot 'CefQaAgent.java')
if ($LASTEXITCODE -ne 0) { throw 'QA agent compile failed.' }
[System.IO.File]::WriteAllText((Join-Path $audioAgent 'MANIFEST.MF'), "Premain-Class: devline.audio.qa.CefQaAgent`n")
& (Join-Path $audioDistribution 'runtime/bin/jar.exe') --create --file (Join-Path $audioAgent 'cef-qa.jar') --manifest (Join-Path $audioAgent 'MANIFEST.MF') -C (Join-Path $audioAgent 'classes') .
if ($LASTEXITCODE -ne 0) { throw 'QA agent archive failed.' }
$audioInfo = [System.Diagnostics.ProcessStartInfo]::new()
$audioInfo.FileName = Join-Path $audioDistribution 'runtime/bin/java.exe'
$audioInfo.WorkingDirectory = $audioDistribution
$audioInfo.UseShellExecute = $false
$audioInfo.CreateNoWindow = $true
$audioInfo.RedirectStandardOutput = $true
$audioInfo.RedirectStandardError = $true
$audioInfo.ArgumentList.Add("-javaagent:$audioAgent/cef-qa.jar")
foreach ($audioFlag in @('JDK_JAVA_OPTIONS', 'JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS')) { $audioInfo.Environment.Remove($audioFlag) | Out-Null }
foreach ($audioArgument in @("-Duser.home=$audioDistribution/sound-studio-native-qa-profile", '--enable-native-access=ALL-UNNAMED', '-Dfile.encoding=UTF-8', '-cp', "$audioDistribution/lib/*", 'devline.desktop.MainKt', '--home', $audioDistribution, '--open-file', "$audioDistribution/examples/LPK25-session/src/audio/Theme.dlmusic")) { $audioInfo.ArgumentList.Add($audioArgument) }
$audioProcess = [System.Diagnostics.Process]::Start($audioInfo)
$audioStdout = $audioProcess.StandardOutput.ReadToEndAsync()
$audioStderr = $audioProcess.StandardError.ReadToEndAsync()
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class AudioDeliveryCapture {
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr window, IntPtr dc, uint flags);
    [DllImport("user32.dll")] public static extern bool RedrawWindow(IntPtr window, IntPtr rect, IntPtr region, uint flags);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr w, IntPtr l);
    private delegate bool Enumerate(IntPtr window, IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumWindows(Enumerate callback, IntPtr data);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder text, int size);
    public static IntPtr Frame(int process) {
        IntPtr frame = IntPtr.Zero;
        EnumWindows((window, data) => {
            uint owner; GetWindowThreadProcessId(window, out owner);
            if (owner != process) return true;
            var title = new StringBuilder(256); GetWindowText(window, title, title.Capacity);
            Rect rect; GetWindowRect(window, out rect);
            if (title.ToString() == "DevLine" && rect.Right - rect.Left >= 900) { frame = window; return false; }
            return true;
        }, IntPtr.Zero);
        return frame;
    }
}
'@
try {
    $audioDeadline = [DateTime]::UtcNow.AddSeconds(45)
    do {
        Start-Sleep -Milliseconds 250
        if ($audioProcess.HasExited) { throw "Native IDE exited: $($audioStderr.GetAwaiter().GetResult())" }
        $audioWindow = [AudioDeliveryCapture]::Frame($audioProcess.Id)
    } while ($audioWindow -eq [IntPtr]::Zero -and [DateTime]::UtcNow -lt $audioDeadline)
    if ($audioWindow -eq [IntPtr]::Zero) { throw 'Native IDE frame did not open on the QA desktop.' }
    [AudioDeliveryCapture]::RedrawWindow($audioWindow, [IntPtr]::Zero, [IntPtr]::Zero, 0x0385) | Out-Null
    Start-Sleep -Seconds 8
    $audioRect = [AudioDeliveryCapture+Rect]::new()
    [AudioDeliveryCapture]::GetWindowRect($audioWindow, [ref]$audioRect) | Out-Null
    $audioBitmap = [System.Drawing.Bitmap]::new($audioRect.Right - $audioRect.Left, $audioRect.Bottom - $audioRect.Top)
    $audioGraphics = [System.Drawing.Graphics]::FromImage($audioBitmap)
    $audioDc = $audioGraphics.GetHdc()
    try { [AudioDeliveryCapture]::PrintWindow($audioWindow, $audioDc, 2) | Out-Null }
    finally { $audioGraphics.ReleaseHdc($audioDc) }
    $audioBitmap.Save((Join-Path $audioRelease 'native-delivery.png'), [System.Drawing.Imaging.ImageFormat]::Png)
    $audioGraphics.Dispose(); $audioBitmap.Dispose()
    if (-not [AudioDeliveryCapture]::PostMessage($audioWindow, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)) { throw 'Native IDE frame could not receive close.' }
    if (-not $audioProcess.WaitForExit(20000)) { throw 'Native IDE did not finish graceful close.' }
    if ($audioProcess.ExitCode -ne 0) { throw "Native IDE failed: $($audioProcess.ExitCode)" }
    $audioText = $audioStdout.GetAwaiter().GetResult()
    if (-not $audioText.Contains('DevLine JCEF UI ready:')) { throw 'Native JCEF startup was not confirmed.' }
    [System.IO.File]::Delete((Join-Path $audioRelease 'native-delivery-error.log'))
    [System.IO.File]::WriteAllText((Join-Path $audioRelease 'native-delivery-proof.txt'), "NATIVE_IDE_ISOLATED_JCEF_OPEN_AND_GRACEFUL_CLOSE_PASS`nDesktop=$env:DEVLINE_NATIVE_QA_DESKTOP`nBundledJava=true`nIsolatedProfileAndCache=true`n")
} catch {
    [System.IO.File]::WriteAllText((Join-Path $audioRelease 'native-delivery-error.log'), $_.ToString())
    throw
} finally {
    if (-not $audioProcess.HasExited) { $audioProcess.Kill($true); $audioProcess.WaitForExit() }
    [System.IO.File]::WriteAllText((Join-Path $audioRelease 'native-delivery-stdout.log'), $audioStdout.GetAwaiter().GetResult())
    [System.IO.File]::WriteAllText((Join-Path $audioRelease 'native-delivery-stderr.log'), $audioStderr.GetAwaiter().GetResult())
    $audioProcess.Dispose()
}
