param(
    [ValidateSet("enable", "disable")][string]$Action = "enable",
    [string]$ScriptPath = "",
    [string]$Startup = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup",
    [string]$Log = "$env:TEMP\hermes-tray-setup.log"
)

# Put — or take away — the one Startup shortcut this extension owns.
#
# It points at Start-HermesInTray.vbs, which this extension copied into its own data folder first, so
# an extension update (a new version folder) cannot leave the login item pointing at nothing.
# "disable" removes that shortcut and nothing else: no other entry in the Startup folder is touched,
# and nothing of Hermes' is written.

function Write-SetupLog([string]$m) {
    try { Add-Content $Log ("{0:yyyy-MM-dd HH:mm:ss.fff} {1}" -f (Get-Date), $m) -Encoding utf8 } catch {}
}

$linkName = "Hermes Desktop (tray).lnk"
$link = Join-Path $Startup $linkName

if (-not (Test-Path $Startup)) { Write-SetupLog "no Startup folder: $Startup"; Write-Output "no Startup folder: $Startup"; exit 2 }

if ($Action -eq "disable") {
    if (Test-Path $link) {
        Remove-Item $link -Force -EA Stop
        Write-SetupLog "removed $link"
        Write-Output "removed $link"
    } else {
        Write-SetupLog "no shortcut to remove at $link"
        Write-Output "no shortcut at $link"
    }
    exit 0
}

if (-not $ScriptPath -or -not (Test-Path $ScriptPath)) {
    Write-SetupLog "the launcher script is missing: $ScriptPath"
    Write-Output "the launcher script is missing: $ScriptPath"
    exit 2
}

try {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($link)
    $shortcut.TargetPath = $ScriptPath
    $shortcut.WorkingDirectory = (Split-Path -Parent $ScriptPath)
    $shortcut.Description = "Start Hermes Desktop in the tray"
    $shortcut.WindowStyle = 7
    $shortcut.Save()
} catch {
    Write-SetupLog ("could not write the shortcut: {0}" -f $_.Exception.Message)
    Write-Output ("could not write the shortcut: {0}" -f $_.Exception.Message)
    exit 1
}

Write-SetupLog "wrote $link -> $ScriptPath"
Write-Output "wrote $link"
exit 0
