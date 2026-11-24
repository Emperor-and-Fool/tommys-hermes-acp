param(
    [ValidateSet("enable", "disable")][string]$Action = "enable",
    [Parameter(Mandatory = $true)][string]$Name,
    [string]$Target = "",
    [string]$Arguments = "",
    [int]$WindowStyle = 1,
    [string]$Startup = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup",
    [string]$Log = "$env:TEMP\hermes-startup-shortcut.log"
)

# Write — or take away — one named shortcut in the user's Startup folder, and nothing else.
#
# That folder holds every program the user starts at login, so this script names one file, writes it,
# and a "disable" removes exactly that file (or succeeds and changes nothing when it is not there).
# Both of this extension's login entries go through it: the tray app, and the hidden command that
# starts the dashboard.

function Write-ShortcutLog([string]$m) {
    try { Add-Content $Log ("{0:yyyy-MM-dd HH:mm:ss.fff} {1}" -f (Get-Date), $m) -Encoding utf8 } catch {}
}

$link = Join-Path $Startup $Name

if (-not (Test-Path $Startup)) {
    Write-ShortcutLog "no Startup folder: $Startup"
    Write-Output "no Startup folder: $Startup"
    exit 2
}

if ($Action -eq "disable") {
    if (Test-Path $link) {
        Remove-Item $link -Force -EA Stop
        Write-ShortcutLog "removed $link"
        Write-Output "removed $link"
    } else {
        Write-ShortcutLog "no shortcut at $link"
        Write-Output "no shortcut at $link"
    }
    exit 0
}

if (-not $Target -or -not (Test-Path $Target)) {
    Write-ShortcutLog "the target is missing: $Target"
    Write-Output "the target is missing: $Target"
    exit 2
}

try {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($link)
    $shortcut.TargetPath = $Target
    if ($Arguments) { $shortcut.Arguments = $Arguments }
    $shortcut.WorkingDirectory = (Split-Path -Parent $Target)
    $shortcut.Description = "Hermes: $Name"
    $shortcut.WindowStyle = $WindowStyle
    $shortcut.Save()
} catch {
    Write-ShortcutLog ("could not write the shortcut: {0}" -f $_.Exception.Message)
    Write-Output ("could not write the shortcut: {0}" -f $_.Exception.Message)
    exit 1
}

Write-ShortcutLog "wrote $link -> $Target $Arguments"
Write-Output "wrote $link"
exit 0
