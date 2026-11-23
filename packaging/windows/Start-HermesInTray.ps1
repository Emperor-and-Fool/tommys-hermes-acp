param(
    [string]$Exe = "$env:LOCALAPPDATA\hermes\hermes-agent\apps\desktop\release\win-unpacked\Hermes.exe",
    [int]$TimeoutSec = 90,
    [int]$ExitWaitSec = 20,
    [string]$Log = "$env:TEMP\hermes-tray-start.log"
)

# Start Hermes Desktop and let its own close button put it in the tray.
#
# Desktop is Electron: started with ELECTRON_RUN_AS_NODE in the environment it runs as plain Node and
# exits 0 at once, silently. The editor sets that variable, so this script drops it before starting.
# Nothing is ever hidden: the window is shown, waited for, closed once through WM_CLOSE — which is
# the same path the user's own close button takes (close-to-tray) — and the app keeps running.

function Write-TrayLog([string]$m) {
    try { Add-Content $Log ("{0:yyyy-MM-dd HH:mm:ss.fff} {1}" -f (Get-Date), $m) -Encoding utf8 } catch {}
}

Add-Type -Namespace HermesTray -Name Win32 -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr w, IntPtr l);
'@

function Get-DesktopProcs {
    Get-Process -Name Hermes -EA SilentlyContinue | Where-Object { try { $_.Path -ieq $Exe } catch { $false } }
}

if (-not (Test-Path $Exe)) { Write-TrayLog "Hermes.exe not found: $Exe"; exit 2 }

# An old Desktop that is still exiting is not a running Desktop. Starting into a dying single-instance
# app loses both windows; wait for it, then start. This is the retry the first version lacked.
$waitUntil = (Get-Date).AddSeconds($ExitWaitSec)
$waited = $false
while ((Get-DesktopProcs) -and (Get-Date) -lt $waitUntil) {
    if (-not $waited) { Write-TrayLog "an old Desktop is still exiting; waiting up to ${ExitWaitSec}s"; $waited = $true }
    Start-Sleep -Milliseconds 500
}
if (Get-DesktopProcs) { Write-TrayLog "Desktop already running; leaving it alone"; exit 0 }

$trayOn = $false
try {
    $trayOn = ((Get-Content "$env:APPDATA\Hermes\minimize-to-tray.json" -Raw -EA Stop | ConvertFrom-Json).enabled -eq $true)
} catch {}

Remove-Item Env:ELECTRON_RUN_AS_NODE -EA SilentlyContinue

$t0 = Get-Date
Start-Process -FilePath $Exe | Out-Null
Write-TrayLog "started (minimize-to-tray enabled=$trayOn)"

if (-not $trayOn) {
    # With close-to-tray off, closing the window would quit the app: start normally and stop here.
    Write-TrayLog "tray setting off: normal start only"
    exit 0
}

$deadline = $t0.AddSeconds($TimeoutSec)
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 250
    foreach ($p in Get-DesktopProcs) {
        $p.Refresh()
        $h = $p.MainWindowHandle
        if ($h -ne [IntPtr]::Zero -and $p.MainWindowTitle -and [HermesTray.Win32]::IsWindowVisible($h)) {
            Start-Sleep -Milliseconds 1500
            [void][HermesTray.Win32]::PostMessage($h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
            Write-TrayLog ("WM_CLOSE sent after {0}ms" -f [int]((Get-Date) - $t0).TotalMilliseconds)
            exit 0
        }
    }
}

Write-TrayLog "timed out after ${TimeoutSec}s waiting for the main window"
exit 1
