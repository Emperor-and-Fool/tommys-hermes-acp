# Hermes Desktop TUI

A tray icon that tells you whether the local Hermes dashboard is up, and one
click away from it. 200 lines of PyQt6, no venv, no build step.

## What it does

- **Tray icon** — `icons/hermes-nousresearch-sec.svg` in the secondant orange: full colour
  when `http://127.0.0.1:9119` answers, flat grey when it does not, faint grey for the
  first second until the first poll lands. Polls every 5 s. Tooltip and menu show the
  host and exact state.
- **Window** — a `QWebEngineView` on the dashboard. Closing it hides it; the tray
  keeps running. Click the icon to show/hide, or use *Open dashboard* in the menu.
- It never starts Hermes. The dashboard is the `hermes-dashboard.service` user
  unit — if that is down the dot goes red and the window shows the browser error.

## Requirements

**Linux** — two packages:

```
sudo apt install python3-pyqt6 python3-pyqt6.qtwebengine
```

No venv: the app imports only PyQt6, so the distro interpreter
(`/usr/bin/python3`, 3.14.4 here) runs it directly.

**Windows** — a venv of our own, `%LOCALAPPDATA%\hermesdesktopgui\venv`, holding
`PyQt6 6.12.1` and `PyQt6-WebEngine 6.140.1` (about 220 MB to download, and the
two Qt6 wheels are the bulk of it). It is built from Hermes' own Python with
Hermes' own `uv`; a venv whose base Python left with a Hermes update is rebuilt.

Both platforms: `installer_gui.py` sits in the ⋯ menu behind **Install Desktop
GUI**, and it is the menu — not this window — that does the work above. That is
deliberate: this file imports PyQt6 at import time, so it cannot install PyQt6.
Without the pre-flight, a machine lacking it shows nothing at all.

At the moment — 2.6.1 — both platforms are handled by `src/host/systrayInstall.ts`
(pre-flight, then the window) and this installer (the three screens, the copy,
the read-back, and the login entries).

## Run

```
/usr/bin/python3 hermes_desktop_gui.py           # tray only
/usr/bin/python3 hermes_desktop_gui.py --show    # tray plus window
```

| flag | meaning |
|---|---|
| `--url URL` | dashboard URL, default `http://127.0.0.1:9119/` (also `$HERMES_DASHBOARD_URL`) |
| `--show` | open the window at startup instead of starting in the tray |
| `--self-test` | headless check: polls the health URL and loads the page, exits 0/1 |

`--self-test` is the smoke test used while building this:

```
QT_QPA_PLATFORM=offscreen QTWEBENGINE_CHROMIUM_FLAGS='--no-sandbox --disable-gpu' \
  /usr/bin/python3 hermes_desktop_gui.py --self-test
# health poll -> up
# page loaded -> True title='Hermes Agent - Dashboard'
```

## Frozen packages

`dist/` holds one directory per target (`linux-x86_64/`, `windows-x86_64/`, …) plus a
zip of each. Build with `./build.sh` (Linux/macOS) or `.\build.ps1` (Windows); each
bundle carries its own Qt and Chromium, so ~550 MB unpacked / 352 MB zipped per
platform and no runtime dependencies on the user's machine. Details and the
why-not-`--system-site-packages` build rule: `dist/README.md`.

## Install into the menu

```
cp hermes-desktopgui.desktop ~/.local/share/applications/
```

The `Exec=` and `Icon=` paths in that file are absolute and point at this
checkout; adjust them if the repo moves.

## Turn off the dashboard's own browser-open

The dashboard opens a browser tab on every start (systemd unit → `hermes dashboard`).
With this app installed that is a duplicate: the tray already is the entry point, and
on login you get both a Firefox tab and this window. Add the flag to the unit:

```
ExecStart=/home/<user>/.local/bin/hermes dashboard --no-open
```

then `systemctl --user daemon-reload && systemctl --user restart hermes-dashboard.service`.
`--no-open` suppresses only the `webbrowser.open()` call — the server binds and serves
exactly as before, so nothing else changes.

## Autostart

Autostart the *server* with the systemd unit (see the `hermes-agent` skill), and
this app either from the menu entry or a second user unit:

```
ExecStart=/usr/bin/python3 %h/_GitProjects/emperorandfools-repos/tommys-hermes-acp/extras/KDEdesktopGui/hermes_desktop_gui.py
```

## Windows

The same sources, run by the venv's `pythonw.exe`. Python 3.10.5 with PyQt6
6.12.1 and PyQt6-WebEngine 6.140.1 was run on a Windows VM: tray icon, the
dashboard window with its sessions, close hides and a click restores, the menu as
on Linux, no Qt warnings.

What differs from Linux, in the installer (`IS_WINDOWS` in `installer_gui.py`):

| | Linux | Windows |
|---|---|---|
| app copy | `~/.local/share/hermes-desktopgui` | `%LOCALAPPDATA%\hermesdesktopgui` |
| interpreter | `/usr/bin/python3` | `venv\Scripts\pythonw.exe` |
| check screen | the two apt packages | whether the venv imports QtWebEngine |
| install screen | apt through pkexec | copy only; the menu built the venv |
| start at login | `~/.config/autostart/*.desktop` | two Startup `.lnk`: the app, and a hidden `hermes dashboard --no-open` |
| uninstall | app, menu entry, autostart, our unit | app folder and the two `.lnk` files |

The two `.lnk` files are written through
`packaging/windows/Set-HermesTrayShortcut.ps1` (`-Action enable|disable -Name …`),
so one script owns both the write and the removal; the dashboard launcher is a
generated `.vbs` beside the app, which needs the `hermes` path this machine
actually has.

The one thing that does not come with the wheels is Hermes itself: the app is a
shell around `http://127.0.0.1:9119`, so the dashboard has to run on the same
machine — the installer's dashboard entry starts it, hidden, at login.
