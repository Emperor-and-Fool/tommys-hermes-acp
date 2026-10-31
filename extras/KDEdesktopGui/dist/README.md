# dist/ — frozen packages, one directory per target

```
dist/
├── linux-x86_64/
│   └── hermesdesktopgui/            one-dir bundle, run hermesdesktopgui/hermesdesktopgui
├── hermesdesktopgui-linux-x86_64.zip   the same bundle, 352 MB
├── windows-x86_64/                  built on Windows: ./build.ps1
└── macos-*                          built on macOS: ./build.sh macos-arm64
```

Each directory is a PyInstaller one-dir bundle: the app plus a private Qt and
Chromium (`_internal/PyQt6/Qt6/lib/libQt6WebEngineCore.so.6`, ~194 MB). Nothing
from the host is needed at runtime — no PyQt6, no Python, no distro Qt.

**These packages are per platform and each carries its own Chromium.** Roughly
550 MB unpacked / 352 MB zipped per target. Budget accordingly before committing
all three; the extension itself is ~11 KB.

## Building

```
./build.sh                 # linux-x86_64, uses /usr/bin/python3 + a local .build-venv
./build.sh macos-arm64     # any label you like; PyInstaller only builds the host OS
```

Windows:

```powershell
.\build.ps1                # dist\windows-x86_64\hermesdesktopgui\hermesdesktopgui.exe
```

PyInstaller cannot cross-compile: the Windows bundle has to be produced on
Windows (a machine, a VM, or a `windows-latest` CI job), and the macOS one on
macOS.

The build venv must not use `--system-site-packages`. PyInstaller bundles
everything the interpreter can import, so system packages leak in (numpy →
`libopenblas` 37 MB, distro Qt → `libKF6BreezeIcons` 25 MB, ffmpeg ≈ 60 MB) and
the bundle lands at ~900 MB instead of ~550 MB. `build.sh` creates a wheels-only
venv and forces `/usr/bin/python3` so PATH surprises cannot change the result.

## Verifying a bundle

Every package can be smoke-tested without a display:

```
QT_QPA_PLATFORM=offscreen QTWEBENGINE_CHROMIUM_FLAGS='--no-sandbox --disable-gpu' \
  dist/linux-x86_64/hermesdesktopgui/hermesdesktopgui --self-test
```

`health poll -> up` plus `page loaded -> True title='Hermes Agent - Dashboard'`
means the frozen Qt, the Chromium core and the dashboard all work together.
