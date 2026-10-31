# Build the tray app bundle for Windows: dist\windows-x86_64\hermesdesktopgui\hermesdesktopgui.exe
#
# PyInstaller cannot cross-compile, so this has to run on Windows. A dedicated venv
# matters for the same reason as on Linux: anything importable gets pulled in.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$Platform = if ($args.Count -ge 1) { $args[0] } else { "windows-x86_64" }
$Venv = if ($env:BUILD_VENV) { $env:BUILD_VENV } else { ".build-venv" }

if (-not (Test-Path "$Venv\Scripts\python.exe")) {
    python -m venv $Venv
}
& "$Venv\Scripts\python.exe" -m pip install --quiet --upgrade pyinstaller PyQt6 PyQt6-WebEngine

& "$Venv\Scripts\pyinstaller.exe" `
    --noconfirm --clean --windowed `
    --name hermesdesktopgui `
    --distpath "dist\$Platform" `
    --workpath "build\work" `
    --specpath "build" `
    --add-data "$PSScriptRoot\icons;icons" `
    hermes_desktop_gui.py

Compress-Archive -Path "dist\$Platform\hermesdesktopgui" -DestinationPath "dist\hermesdesktopgui-$Platform.zip" -Force

Write-Host ""
Write-Host "bundle: dist\$Platform\hermesdesktopgui"
Write-Host "zip:    dist\hermesdesktopgui-$Platform.zip"
Write-Host ""
Write-Host "smoke test:"
& "dist\$Platform\hermesdesktopgui\hermesdesktopgui.exe" --self-test
