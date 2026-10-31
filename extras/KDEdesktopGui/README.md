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

```
sudo apt install python3-pyqt6 python3-pyqt6.qtwebengine
```

Nothing else. No venv: the app imports only PyQt6, so the distro interpreter
(`/usr/bin/python3`, 3.14.4 here) runs it directly.

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
ExecStart=/usr/bin/python3 %h/_GitProjects/emperorandfools-repos/tommys-hermes-acp/extras/KDEdesktopTui/hermes_desktop_gui.py
```

## Windows

PyQt6 publishes win wheels (`PyQt6`, `PyQt6-WebEngine`, `PyQt6-Qt6`,
`PyQt6-WebEngine-Qt6` — about 220 MB of downloads), `QSystemTrayIcon` works
there, and the code has no platform-specific paths. The only thing that does not
come with it is Hermes itself: the app is a shell around
`http://127.0.0.1:9119`, so the dashboard has to be running on the same machine.
