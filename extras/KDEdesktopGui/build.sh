#!/usr/bin/env bash
# Freeze the tray app into a per-platform bundle under dist/<platform>/.
#
# A dedicated build venv matters: PyInstaller walks whatever the interpreter can
# import, so a venv with --system-site-packages drags in every system package it
# can see (numpy -> libopenblas, distro Qt -> KF6BreezeIcons) and the bundle grows
# from ~550 MB to ~900 MB. Wheels only, system site-packages off.
set -euo pipefail
cd "$(dirname "$0")"

PLATFORM="${1:-linux-x86_64}"
VENV="${BUILD_VENV:-.build-venv}"
# /usr/bin/python3, not whatever python3 happens to be first in PATH.
PYTHON="${PYTHON:-/usr/bin/python3}"

if [ ! -x "$VENV/bin/python" ]; then
  "$PYTHON" -m venv "$VENV"
fi
"$VENV/bin/pip" install --quiet --upgrade pyinstaller PyQt6 PyQt6-WebEngine

"$VENV/bin/pyinstaller" \
  --noconfirm --clean --windowed \
  --name hermesdesktopgui \
  --distpath "dist/$PLATFORM" \
  --workpath build/work \
  --specpath build \
  --add-data "$PWD/icons:icons" \
  hermes_desktop_gui.py

if command -v zip >/dev/null 2>&1; then
  ( cd "dist/$PLATFORM" && zip -qr -9 "../hermesdesktopgui-$PLATFORM.zip" hermesdesktopgui )
fi

echo
echo "bundle:  dist/$PLATFORM/hermesdesktopgui"
du -sh "dist/$PLATFORM/hermesdesktopgui"
[ -f "dist/hermesdesktopgui-$PLATFORM.zip" ] && ls -lh "dist/hermesdesktopgui-$PLATFORM.zip" | awk '{print "zip:    ", $5, $9}'
echo
echo "smoke test:"
QT_QPA_PLATFORM=offscreen QTWEBENGINE_CHROMIUM_FLAGS='--no-sandbox --disable-gpu' \
  "dist/$PLATFORM/hermesdesktopgui/hermesdesktopgui" --self-test
