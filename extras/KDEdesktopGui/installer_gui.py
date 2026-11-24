#!/usr/bin/env python3
# Hermes Desktop GUI — installer
# Copyright (C) 2026 Emperor & Fool
#
# This program is free software: you can redistribute it and/or modify it
# under the terms of the GNU General Public License as published by the Free
# Software Foundation, either version 3 of the License, or (at your option)
# any later version. See <https://www.gnu.org/licenses/>.
#
# SPDX-License-Identifier: GPL-3.0-or-later

"""Installer for the Hermes systray app.

Three screens, then one question:

    1 / 3  System check    packages found → nothing to do, or install them (pkexec)
    2 / 3  App install     copy app, icon and menu entry; files only, no settings
    3 / 3  What is set now server, Desktop TUI and GUI findings, no controls
    final  Autostart       one tick, Back or Done — Done is what commits settings

Nothing but the app's own files is written before Done, so Back is a real undo, and
closing earlier leaves the Desktop TUI opening its browser as it always did.

`--dry-run` walks the detection and says what it would do, writing nothing.
`--force-packages` / `--force-browser-check` pretend those steps are still open, so
the flow can be tested on a machine that already satisfies it.
`--clean` removes what the installer puts in place (user scope only).
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

from PyQt6.QtCore import QProcess, Qt, QTimer
from PyQt6.QtGui import QFont, QIcon
from PyQt6.QtWidgets import (
    QApplication,
    QCheckBox,
    QDialog,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPlainTextEdit,
    QPushButton,
    QWidget,
    QVBoxLayout,
)

APP_ID = "hermes-desktopgui"
APP_NAME = "Hermes Desktop GUI"
DASHBOARD_URL = "http://127.0.0.1:9119/"
APT_PACKAGES = ("python3-pyqt6", "python3-pyqt6.qtwebengine")
HERE = Path(__file__).resolve().parent

# The app is the same source on both platforms; what differs is the interpreter, where it lives,
# and how a login entry is made. Linux runs it with /usr/bin/python3 and apt brings PyQt6; Windows
# runs it with a venv we own (built by the extension's pre-flight before this window opens).
IS_WINDOWS = os.name == "nt"

LOCALAPPDATA = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local"))
APPDATA = Path(os.environ.get("APPDATA") or (Path.home() / "AppData" / "Roaming"))

INSTALL_DIR = (LOCALAPPDATA / "hermesdesktopgui") if IS_WINDOWS else (Path.home() / ".local/share/hermes-desktopgui")
VENV_DIR = INSTALL_DIR / "venv"
DESKTOP_DIR = Path.home() / ".local/share/applications"
AUTOSTART_DIR = Path.home() / ".config/autostart"
STATE_DIR = (INSTALL_DIR / "logs") if IS_WINDOWS else (Path.home() / ".local/state/hermes-desktopgui")
UNIT_PATH = Path.home() / ".config/systemd/user/hermes-dashboard.service"
# The line that makes a unit ours; it must equal UNIT_MARKER in
# src/host/environment/dashboardUnit.ts, which writes the file.
UNIT_MARKER = "# Written by the Tommys Hermes ACP extension — remove this unit with the tray app."

# Windows: two Startup shortcuts, written through the script the extension ships.
STARTUP_DIR = APPDATA / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup"
APP_LINK = "Hermes Desktop GUI.lnk"
DASHBOARD_LINK = "Hermes Dashboard.lnk"
DASHBOARD_LAUNCHER = "Start-HermesDashboard.vbs"
SHORTCUT_SCRIPT = HERE.parent.parent / "packaging" / "windows" / "Set-HermesTrayShortcut.ps1"
ACCENT = "#e37d26"


# ---------------------------------------------------------------- detection


def venv_python() -> Path:
    return VENV_DIR / "Scripts" / "python.exe"


def venv_pythonw() -> Path:
    return VENV_DIR / "Scripts" / "pythonw.exe"


def _runs(argv: list[str], timeout: int = 60) -> bool:
    try:
        out = subprocess.run(argv, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.SubprocessError):
        return False
    return out.returncode == 0


def venv_runs() -> bool:
    """The venv's interpreter still starts — false when its base Python left with a Hermes update."""
    python = venv_python()
    return python.exists() and _runs([str(python), "-c", "import sys"])


def venv_ready() -> bool:
    """The venv starts and imports QtWebEngine: everything the app needs."""
    python = venv_python()
    return python.exists() and _runs([str(python), "-c", "import PyQt6.QtWebEngineWidgets"])


def login_entry(name: str) -> Path:
    return STARTUP_DIR / name


def login_written(name: str) -> bool:
    return login_entry(name).exists()


def dashboard_entry_missing() -> bool:
    """True when the dashboard's login entry has to be written.

    The file's existence decides, never whether the port answers right now: a dashboard that is up
    says nothing about the next login (Linux decides on the unit file the same way). And a second
    `hermes dashboard --no-open` does not start a second server — Hermes prints "already running"
    and exits 0 — so a written entry is harmless even when one is already up.
    """
    return not login_written(DASHBOARD_LINK)


def remove_install_dir() -> tuple[bool, str]:
    """Remove the app folder — after this window closes when we are running from inside it.

    On Windows the installer's own interpreter lives in the folder it is about to delete
    (venv/Scripts/python.exe): python.exe, its DLLs and the Qt DLLs are locked while it runs, so
    deleting the folder from here can only half-succeed. A detached PowerShell waits for our PID,
    then retries until the folder is gone (the tray app may still be letting go of it).
    """
    if not INSTALL_DIR.exists():
        return True, "nothing to remove"
    try:
        Path(sys.executable).resolve().relative_to(INSTALL_DIR.resolve())
        running_inside = True
    except (ValueError, OSError):
        running_inside = False
    if not running_inside:
        try:
            shutil.rmtree(INSTALL_DIR)
        except OSError as exc:
            return False, str(exc)
        return True, "removed"
    command = (
        f"$d = '{INSTALL_DIR}'; Wait-Process -Id {os.getpid()} -ErrorAction SilentlyContinue; "
        "for ($i = 0; $i -lt 15; $i++) { "
        "if (-not (Test-Path -LiteralPath $d)) { break }; "
        "Remove-Item -LiteralPath $d -Recurse -Force -ErrorAction SilentlyContinue; "
        "Start-Sleep -Milliseconds 800 }"
    )
    try:
        subprocess.Popen(["powershell.exe", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden",
                          "-Command", command], close_fds=True,
                         creationflags=getattr(subprocess, "DETACHED_PROCESS", 0))
    except OSError as exc:
        return False, str(exc)
    return True, "removed a moment after this window closes"


def start_dashboard_now(launcher: Path) -> bool:
    """Start the dashboard the way its login entry will: hidden, through the .vbs, not waited for."""
    try:
        subprocess.Popen(["wscript.exe", str(launcher)], close_fds=True,
                         creationflags=getattr(subprocess, "DETACHED_PROCESS", 0))
    except (OSError, ValueError):
        return False
    return True


def shortcut_script() -> Path | None:
    return SHORTCUT_SCRIPT if SHORTCUT_SCRIPT.exists() else None


def run_shortcut(action: str, name: str, target: str = "", args: str = "") -> tuple[bool, str]:
    """Write or remove one Startup shortcut, through the extension's own script."""
    script = shortcut_script()
    if script is None:
        return False, f"the shortcut script is missing: {SHORTCUT_SCRIPT}"
    command = ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
               "-File", str(script), "-Action", action, "-Name", name, "-Startup", str(STARTUP_DIR)]
    if target:
        command += ["-Target", target]
    if args:
        command += ["-Arguments", args]
    try:
        out = subprocess.run(command, capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.SubprocessError) as exc:
        return False, str(exc)
    return out.returncode == 0, (out.stdout or out.stderr).strip().splitlines()[-1:] or [f"exit {out.returncode}"]


def hermes_executable() -> str:
    """The `hermes` a login entry can run: an absolute path when one exists, else the bare command."""
    candidates = [
        LOCALAPPDATA / "hermes" / "bin" / "hermes.exe",
        Path.home() / ".local" / "bin" / "hermes",
    ]
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    return shutil.which("hermes") or "hermes"


def write_dashboard_launcher(hermes: str = "") -> Path:
    """A hidden `hermes dashboard --no-open`, so login never shows a console window."""
    hermes = hermes or hermes_executable()
    VENV_DIR.parent.mkdir(parents=True, exist_ok=True)
    launcher = INSTALL_DIR / DASHBOARD_LAUNCHER
    launcher.write_text(
        "' Start the Hermes dashboard with no console window. Written by the installer.\r\n"
        'Set shell = CreateObject("WScript.Shell")\r\n'
        f'shell.Run Chr(34) & "{hermes}" & Chr(34) & " dashboard --no-open", 0, False\r\n',
        encoding="utf-8",
    )
    return launcher


def pkg_installed(package: str) -> bool:
    try:
        out = subprocess.run(
            ["dpkg-query", "-W", "-f=${Status}", package],
            capture_output=True, text=True, timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return "install ok installed" in out.stdout


def missing_packages(force: bool = False) -> list[str]:
    """Packages apt still has to install. `force` pretends they are all missing, so the
    install step can be walked on a machine that already satisfies it.

    Windows has no apt and no packages: what it needs is the venv, which the extension's
    pre-flight builds before this window opens. The check only reads it."""
    if IS_WINDOWS:
        return [] if venv_ready() else ["PyQt6 venv"]
    if force:
        return list(APT_PACKAGES)
    return [p for p in APT_PACKAGES if not pkg_installed(p)]


def unit_execstart() -> str | None:
    if not UNIT_PATH.exists():
        return None
    for line in UNIT_PATH.read_text().splitlines():
        if line.strip().startswith("ExecStart="):
            return line.strip()
    return None


def browser_opens_at_login(force: bool = False) -> bool | None:
    """True/False for the systemd-unit case, None when there is no unit to read.
    `force` reports True even when the unit already has --no-open."""
    if force:
        return True
    execstart = unit_execstart()
    if execstart is None:
        return None
    return "--no-open" not in execstart


def service_enabled() -> str:
    """systemd's own answer for the dashboard unit: enabled / disabled / not-found."""
    try:
        out = subprocess.run(["systemctl", "--user", "is-enabled", "hermes-dashboard.service"],
                             capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return "unknown"
    answer = out.stdout.strip() or "unknown"
    return answer


def server_port() -> tuple[int, bool]:
    """Port the dashboard is started with, and whether the unit named it explicitly."""
    execstart = unit_execstart() or ""
    parts = execstart.split()
    for i, token in enumerate(parts):
        if token == "--port" and i + 1 < len(parts) and parts[i + 1].isdigit():
            return int(parts[i + 1]), True
        if token.startswith("--port=") and token.split("=", 1)[1].isdigit():
            return int(token.split("=", 1)[1]), True
    return 9119, False


def api_answers(url: str) -> bool:
    import urllib.error
    import urllib.request
    try:
        with urllib.request.urlopen(url, timeout=0.6) as response:
            return 200 <= response.status < 500
    except (urllib.error.URLError, OSError):
        return False


SYSTEM_DIR = Path("/usr/lib/hermes-desktopgui")


def system_installed() -> bool:
    """True when this copy came from the .deb, where apt owns the files and the packages."""
    try:
        return HERE.resolve() == SYSTEM_DIR.resolve()
    except OSError:
        return False


def autostart_entry() -> Path:
    return AUTOSTART_DIR / f"{APP_ID}.desktop"


def autostart_written() -> bool:
    if IS_WINDOWS:
        return login_written(APP_LINK)
    return autostart_entry().exists()


def installed_copy() -> Path:
    return INSTALL_DIR / "hermes_desktop_gui.py"


# ---------------------------------------------------------------- installer


class Installer(QDialog):
    TOTAL_STEPS = 3

    def __init__(self, dry_run: bool = False, force_packages: bool = False,
                 force_browser_check: bool = False):
        super().__init__()
        self.dry_run = dry_run
        self.force_packages = force_packages
        self.force_browser_check = force_browser_check

        self.packages_installed = False
        self.app_installed = False
        self.settings_committed = False
        self.want_autostart: bool | None = None
        self.log_lines: list[str] = []
        self.log_path = STATE_DIR / f"install-{time.strftime('%Y%m%d-%H%M%S')}.log"
        self._proc: QProcess | None = None
        self._tail: QTimer | None = None

        self.setWindowTitle(f"{APP_NAME} — setup")
        self.setMinimumSize(720, 460)
        icon = HERE / "icons/hermes-nousresearch-sec.svg"
        if icon.exists():
            self.setWindowIcon(QIcon(str(icon)))

        self.title = QLabel()
        self.title.setStyleSheet(f"font-size: 20px; font-weight: 600; color: {ACCENT};")
        self.title.setAlignment(Qt.AlignmentFlag.AlignHCenter)
        self.body = QLabel()
        self.body.setWordWrap(True)
        self.body.setTextFormat(Qt.TextFormat.RichText)
        self.body.setAlignment(Qt.AlignmentFlag.AlignHCenter)
        self.options = QVBoxLayout()
        self.log = QPlainTextEdit()
        self.log.setReadOnly(True)
        self.log.setFont(QFont("monospace", 9))
        self.log.setMaximumBlockCount(5000)
        self.log.setVisible(False)

        self.buttons = QHBoxLayout()
        self.buttons.addStretch(1)
        self.buttons.addStretch(1)

        layout = QVBoxLayout(self)
        layout.addWidget(self.title)
        layout.addWidget(self.body)
        layout.addLayout(self.options)
        layout.addWidget(self.log, 1)
        layout.addLayout(self.buttons)

        self._goto(1)

    # -- plumbing

    def showEvent(self, event) -> None:
        super().showEvent(event)
        screen = self.screen()
        if screen is not None:
            geo = screen.availableGeometry()
            frame = self.frameGeometry()
            frame.moveCenter(geo.center())
            self.move(frame.topLeft())

    def say(self, text: str) -> None:
        self.log_lines.append(text)
        self.log.appendPlainText(text)

    def _clear(self) -> None:
        while self.buttons.count():
            item = self.buttons.takeAt(0)
            if item.widget():
                item.widget().deleteLater()
        self.buttons.addStretch(1)
        self.buttons.addStretch(1)
        while self.options.count():
            item = self.options.takeAt(0)
            if item.widget():
                item.widget().deleteLater()

    def _button(self, text: str, slot, primary: bool = False) -> QPushButton:
        b = QPushButton(text)
        if primary:
            b.setStyleSheet(
                f"QPushButton {{ background: {ACCENT}; color: white; padding: 6px 16px;"
                f" border-radius: 4px; font-weight: 600; }}"
            )
        b.clicked.connect(slot)
        self.buttons.insertWidget(self.buttons.count() - 1, b)
        return b

    def _heading(self, step: int, text: str) -> None:
        self.title.setText(f"{step} / {self.TOTAL_STEPS} — {text}")

    def _goto(self, step: int) -> None:
        self._clear()
        getattr(self, f"_step{step}")()

    # -- closing mid-flow: report what was applied

    def _stage_report(self) -> str:
        """What actually happened, in the order it happened."""
        if self.settings_committed:
            return "The installation is complete."
        if self.app_installed:
            return ("Hermes Desktop GUI is installed, but nothing was configured: it will not "
                    "start at login, and the Desktop TUI still opens a browser at login.")
        if self.packages_installed:
            return ("The system packages were installed. The app itself was not, so no settings "
                    "were changed: the Desktop TUI still opens a browser at login.")
        return "Nothing was installed and no settings were changed."

    def _abort(self) -> None:
        box = QMessageBox(self)
        box.setIcon(QMessageBox.Icon.Warning)
        box.setWindowTitle("Installation not finished")
        box.setText(self._stage_report())
        box.setStandardButtons(QMessageBox.StandardButton.Ok)
        box.exec()
        self.reject()

    def _report_on_close(self) -> None:
        if self.settings_committed:
            return
        if self.app_installed or self.packages_installed:
            box = QMessageBox(self)
            box.setIcon(QMessageBox.Icon.Warning)
            box.setWindowTitle("Installation not finished")
            box.setText(self._stage_report())
            box.setStandardButtons(QMessageBox.StandardButton.Ok)
            box.exec()

    def closeEvent(self, event) -> None:
        self._report_on_close()
        event.accept()

    # -- 1 / 3: system check

    def _step1(self) -> None:
        self._heading(1, "System check")
        if IS_WINDOWS:
            ready = venv_ready()
            lines = [
                f"PyQt6 for the app lives in our own venv: <code>{VENV_DIR}</code>",
                "Found: <b>PyQt6</b>, <b>QtWebEngine</b>" if ready
                else "To create: the venv is <b>not ready</b> — the menu's install builds it before "
                     "this window opens, so this only shows its state.",
            ]
            self.body.setText("<br>".join(lines))
            self._button("Cancel", self._abort)
            self._button("Next", lambda: self._goto(2), primary=True)
            return
        if system_installed():
            self.body.setText(
                "System packages: <b>provided by the package</b> (Debian dependency)."
            )
            self._button("Cancel", self._abort)
            self._button("Next", lambda: self._goto(2), primary=True)
            return
        missing = missing_packages(self.force_packages)
        found = [p for p in APT_PACKAGES if p not in missing]
        lines: list[str] = []
        if found:
            lines.append("Found: <b>" + "</b>, <b>".join(found) + "</b>")
        if missing:
            lines.append(f"To install: <b>{'</b>, <b>'.join(missing)}</b> — about 270 MB.")
        else:
            lines.append("Nothing to install.")
        self.body.setText("<br>".join(lines))
        self._button("Cancel", self._abort)
        if missing:
            self._button("Install packages", self._install_packages, primary=True)
        else:
            self._button("Next", lambda: self._goto(2), primary=True)

    def _install_packages(self) -> None:
        if IS_WINDOWS:
            self.say("Windows: the venv is built by the extension before this window opens")
            return self._goto(2)
        if self.dry_run:
            self.say("dry run: would install the system packages with apt")
            self.packages_installed = True
            return self._goto(2)

        self._clear()
        self.body.setText("Installing packages… accept the password prompt.")
        self.log.setVisible(True)
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        self.log_path.touch(mode=0o600, exist_ok=True)
        os.chmod(self.log_path, 0o600)

        inner = (f"DEBIAN_FRONTEND=noninteractive apt-get install -y "
                 f"{' '.join(APT_PACKAGES)} >> '{self.log_path}' 2>&1")
        self.say(f"$ pkexec sh -c '{inner}'")
        self._proc = QProcess(self)
        self._proc.finished.connect(self._packages_done)
        self._proc.start("pkexec", ["sh", "-c", inner])

        tail = QTimer(self)
        tail.setInterval(400)
        tail.timeout.connect(self._read_log)
        tail.start()
        self._tail = tail
        self._button("Cancel", self._abort)

    def _read_log(self) -> None:
        try:
            text = self.log_path.read_text(errors="replace")
        except OSError:
            return
        self.log.setPlainText("\n".join(self.log_lines) + "\n" + text)
        self.log.verticalScrollBar().setValue(self.log.verticalScrollBar().maximum())

    def _packages_done(self, code: int, _status) -> None:
        if self._tail:
            self._tail.stop()
        self._read_log()
        if code == 0:
            self.packages_installed = True
            self.say("packages: installed")
            return self._goto(2)
        self.say(f"packages: not installed (exit {code})")
        self._clear()
        self.body.setText("The packages were not installed.")
        self._button("Cancel", self._abort)
        self._button("Try again", lambda: self._goto(1), primary=True)

    # -- 2 / 3: app install

    def _step2(self) -> None:
        self._heading(2, "App install")
        if system_installed():
            self.app_installed = True
            self.body.setText(
                f"Installed system-wide by the package in <code>{SYSTEM_DIR}</code>.<br>"
                "apt owns these files, so there is nothing to copy."
            )
            self._button("Cancel", self._abort)
            self._button("Next", lambda: self._goto(3), primary=True)
            return
        already = installed_copy().exists()
        self.body.setText(
            f"{'Already installed in' if already else 'Will be installed in'} "
            f"<code>{INSTALL_DIR}</code> (about 25 KB), with a menu entry."
        )
        self._button("Cancel", self._abort)
        self._button("Reinstall" if already else "Install", self._install_app, primary=True)

    def _install_app(self) -> None:
        if self.dry_run:
            self.say("dry run: would copy the app and write the menu entry")
            self.app_installed = True
            return self._goto(3)
        try:
            INSTALL_DIR.mkdir(parents=True, exist_ok=True)
            shutil.copy2(HERE / "hermes_desktop_gui.py", installed_copy())
            icons_dst = INSTALL_DIR / "icons"
            icons_dst.mkdir(exist_ok=True)
            for svg in (HERE / "icons").glob("*.svg"):
                shutil.copy2(svg, icons_dst / svg.name)
            if IS_WINDOWS:
                self.app_installed = True
                # Linux has the dashboard running before this window opens (`enable --now`), which is
                # why its read-back screen can say "answering". Same moment here: start it hidden now,
                # so screen 3 reports the state the user will actually have.
                try:
                    launcher = write_dashboard_launcher()
                    if not api_answers(DASHBOARD_URL) and start_dashboard_now(launcher):
                        self.say("dashboard: starting now (hidden)")
                except OSError as exc:
                    self.say(f"dashboard launcher: not written ({exc})")
                self.say(f"installed: {INSTALL_DIR}")
                self._clear()
                self.body.setText(f"Installed in <code>{INSTALL_DIR}</code>.")
                self._button("Cancel", self._abort)
                self._button("Next", lambda: self._goto(3), primary=True)
                return
            DESKTOP_DIR.mkdir(parents=True, exist_ok=True)
            entry = DESKTOP_DIR / f"{APP_ID}.desktop"
            entry.write_text(
                "[Desktop Entry]\n"
                "Type=Application\n"
                f"Name={APP_NAME}\n"
                "Comment=Tray status and window for the local Hermes dashboard\n"
                f"Exec=/usr/bin/python3 {INSTALL_DIR}/hermes_desktop_gui.py --show\n"
                f"Icon={INSTALL_DIR}/icons/hermes-nousresearch-sec.svg\n"
                "Terminal=false\n"
                "Categories=Development;\n"
                "StartupWMClass=hermes-desktopgui\n"
            )
            self.app_installed = True
            self.say(f"installed: {INSTALL_DIR}")
        except OSError as exc:
            QMessageBox.critical(self, APP_NAME, f"Could not install the app:\n{exc}")
            return self._abort()

        self._clear()
        self.body.setText(
            f"Installed in <code>{INSTALL_DIR}</code>, with a menu entry."
        )
        self._button("Cancel", self._abort)
        self._button("Next", lambda: self._goto(3), primary=True)

    # -- 3 / 3: autostart

    def _step3(self) -> None:
        self.setMinimumSize(720, 460)
        self.resize(720, 460)
        self._heading(3, "Currently set")
        self.body.setText(self._autostart_report())

        self.autostart_box = QCheckBox(
            "Start Hermes Desktop GUI at login (and the hidden dashboard)" if IS_WINDOWS
            else "Autostart Hermes Desktop GUI at login"
        )
        self.autostart_box.setChecked(
            self.want_autostart if self.want_autostart is not None else autostart_written()
        )
        self.options.addWidget(self.autostart_box, alignment=Qt.AlignmentFlag.AlignHCenter)

        self._button("Cancel", self._abort)
        self._button("Next", self._next_from_step3, primary=True)

    def _next_from_step3(self) -> None:
        # Keep the answer before the widget is destroyed with the screen.
        self.want_autostart = self.autostart_box.isChecked()
        self._goto(4)

    # -- 4: the one question, asked last, committable or not

    def _step4(self) -> None:
        self.setMinimumSize(380, 200)
        self.resize(460, 240)
        self.title.setText("Ready to finish")
        self.body.setText("Desktop TUI will no longer open a browser at login.")
        self._button("Back", lambda: self._goto(3))
        self._button("Done", self._commit, primary=True)

    def _autostart_report(self) -> str:
        """Server first, then the desktop app, each in words followed by where it is set."""
        if IS_WINDOWS:
            reachable = api_answers(DASHBOARD_URL)
            return "<br>".join([
                "Dashboard at <code>http://127.0.0.1:9119/</code> — "
                + ("<b>answering</b>" if reachable else "<b>not answering</b> (it starts at login)"),
                f"PyQt6 venv: <code>{VENV_DIR}</code> — "
                + ("<b>ready</b>" if venv_ready() else "<b>not ready</b>"),
                "Login: app <b>" + ("on" if login_written(APP_LINK) else "off") + "</b>, dashboard <b>"
                + ("on" if login_written(DASHBOARD_LINK) else "off") + "</b>",
                "",
            ])
        lines: list[str] = []

        enabled = service_enabled()
        if enabled == "enabled":
            lines.append("Hermes server: <b>autostarts at login</b>")
        elif enabled == "not-found":
            lines.append("Hermes server: <b>no service found</b>")
        else:
            lines.append(f"Hermes server: <b>does not autostart</b> ({enabled})")

        port, explicit = server_port()
        url = f"http://127.0.0.1:{port}/"
        reachable = api_answers(url)
        where = "" if explicit else " (default port)"
        lines.append(f"API at <code>{url}</code> — "
                     + ("answering" if reachable else "not answering") + where)

        opens = browser_opens_at_login(self.force_browser_check)
        if opens is False:
            lines.append("Desktop TUI: <b>does not open a browser at login</b>")
        elif opens:
            lines.append("Desktop TUI: <b>opens a browser at login</b>")
        else:
            lines.append("Desktop TUI: <b>unknown</b> (no systemd unit)")
        if unit_execstart():
            lines.append(f"<code>{unit_execstart()}</code>")

        lines.append("")  # server findings above, desktop app below
        return "<br>".join(lines)

    def _commit(self) -> None:
        want_autostart = bool(self.want_autostart)

        if self.dry_run:
            self.say(f"dry run: autostart={want_autostart}")
            self.settings_committed = True
            return self._done()

        if want_autostart:
            self._enable_autostart()
        elif autostart_written():
            if IS_WINDOWS:
                for name in (APP_LINK, DASHBOARD_LINK):
                    ok, said = run_shortcut("disable", name)
                    self.say(f"login {name}: {'removed' if ok else 'not removed'} ({said})")
            else:
                try:
                    autostart_entry().unlink()
                    self.say("autostart: removed")
                except OSError as exc:
                    self.say(f"autostart: could not remove ({exc})")

        # Not a choice, and only applied here: the Desktop TUI stops opening a browser
        # once the tray app exists. Backing out before Done leaves it as it was.
        if browser_opens_at_login(self.force_browser_check) is True:
            self._disable_browser_open()

        self.settings_committed = True
        self._done()

    def _enable_autostart(self) -> None:
        if IS_WINDOWS:
            target = str(venv_pythonw())
            ok, said = run_shortcut("enable", APP_LINK, target, f'"{installed_copy()}"')
            self.say(f"login {APP_LINK}: {'written' if ok else 'not written'} ({said})")
            try:
                launcher = write_dashboard_launcher()
                if dashboard_entry_missing():
                    ok, said = run_shortcut("enable", DASHBOARD_LINK, str(launcher))
                    self.say(f"login {DASHBOARD_LINK}: {'written' if ok else f'not written ({said})'}")
                else:
                    self.say(f"login {DASHBOARD_LINK}: already there")
            except OSError as exc:
                self.say(f"login {DASHBOARD_LINK}: not written ({exc})")
            return
        try:
            AUTOSTART_DIR.mkdir(parents=True, exist_ok=True)
            autostart_entry().write_text(
                "[Desktop Entry]\n"
                "Type=Application\n"
                f"Name={APP_NAME} (autostart)\n"
                f"Exec=/usr/bin/python3 {INSTALL_DIR}/hermes_desktop_gui.py\n"
                f"Icon={INSTALL_DIR}/icons/hermes-nousresearch-sec.svg\n"
                "Terminal=false\n"
                "X-GNOME-Autostart-enabled=true\n"
            )
            self.say(f"autostart: written {autostart_entry()}")
        except OSError as exc:
            self.say(f"autostart: failed ({exc})")
            QMessageBox.critical(self, APP_NAME, f"Could not write the autostart entry:\n{exc}")

    def _disable_browser_open(self) -> None:
        if IS_WINDOWS:
            self.say("dashboard login entry: runs --no-open by construction")
            return
        text = UNIT_PATH.read_text() if UNIT_PATH.exists() else ""
        if "--no-open" in text:
            self.say("dashboard unit: already runs with --no-open")
            return
        backup = UNIT_PATH.with_suffix(f".service.bak-{time.strftime('%Y%m%d-%H%M%S')}")
        try:
            shutil.copy2(UNIT_PATH, backup)
            patched = text.replace("hermes dashboard", "hermes dashboard --no-open", 1)
            UNIT_PATH.write_text(patched)
            self.say(f"dashboard unit: backup {backup}")
            self.say("dashboard unit: " + (unit_execstart() or "?"))
        except OSError as exc:
            self.say(f"dashboard unit: could not edit ({exc})")
            QMessageBox.critical(self, APP_NAME, f"Could not edit the dashboard unit:\n{exc}")
            return
        for args, label in (
            (["systemctl", "--user", "daemon-reload"], "daemon-reload"),
            (["systemctl", "--user", "restart", "hermes-dashboard.service"], "dashboard restart"),
        ):
            out = subprocess.run(args, capture_output=True, text=True, timeout=60)
            self.say(f"{label}: exit {out.returncode}")

    # -- done

    def _done(self) -> None:
        self.setMinimumSize(600, 320)
        self.resize(640, 340)
        self._clear()
        self.log.setVisible(False)
        self.title.setText("Installed")
        lines = [f"<b>{APP_NAME}</b> is installed."]
        if not self.dry_run:
            lines.append("Autostart at login is on." if autostart_written()
                         else "Autostart at login is off.")
            opens = browser_opens_at_login() if not IS_WINDOWS else None
            if opens is False:
                lines.append("The dashboard no longer opens a browser at login.")
        else:
            lines.append("Dry run: nothing was written.")
        if IS_WINDOWS:
            lines.append("Login: app " + ("on" if login_written(APP_LINK) else "off")
                         + ", dashboard " + ("on" if login_written(DASHBOARD_LINK) else "off") + ".")
        lines.append("Open it from the tray or the menu.")
        self.body.setText("<br>".join(lines))
        self._button("Launch now", self._launch, primary=True)
        self._button("Close", self.accept)

    def _launch(self) -> None:
        if self.dry_run:
            self.say("dry run: would launch the installed app")
            return self.accept()
        app_path = installed_copy()
        if not app_path.exists():
            QMessageBox.warning(self, APP_NAME, "The installed copy was not found.")
            return self.accept()
        if IS_WINDOWS:
            QProcess.startDetached(str(venv_pythonw()), [str(app_path)])
        else:
            QProcess.startDetached("/usr/bin/python3", [str(app_path)])
        self.accept()


# ---------------------------------------------------------------- entry


# ---------------------------------------------------------------- uninstall


APT_REMOVE_LINE = f"sudo apt remove {' '.join(APT_PACKAGES)}"


class Uninstaller(QDialog):
    """Removes what the installer wrote, then gets out of the way.

    Two states: the explanation with its one command, and — once the files are gone — a
    small result window with a single Close button. Leaving dead buttons on screen after
    the work is done is the part that read wrong.
    """

    def __init__(self):
        super().__init__()
        self.setWindowTitle(f"{APP_NAME} — uninstall")
        icon = HERE / "icons/hermes-nousresearch-sec.svg"
        if icon.exists():
            self.setWindowIcon(QIcon(str(icon)))

        self.panel = QWidget()
        panel = QVBoxLayout(self.panel)
        panel.setContentsMargins(0, 0, 0, 0)

        title = QLabel("Uninstall Hermes Desktop GUI")
        title.setAlignment(Qt.AlignmentFlag.AlignHCenter)
        title.setStyleSheet(f"font-size: 19px; font-weight: 600; color: {ACCENT};")

        removed = QLabel(
            "This removes:<br>"
            f"<code>{INSTALL_DIR}</code> — the app and its icon<br>"
            f"<code>{DESKTOP_DIR / f'{APP_ID}.desktop'}</code> — the menu entry<br>"
            f"<code>{autostart_entry()}</code> — if autostart was enabled"
        )
        removed.setWordWrap(True)
        removed.setAlignment(Qt.AlignmentFlag.AlignHCenter)

        if IS_WINDOWS:
            removed = QLabel(
                "This removes:<br>"
                f"<code>{INSTALL_DIR}</code> — the app, its venv and its icons<br>"
                f"<code>{login_entry(APP_LINK)}</code> — the tray app at login<br>"
                f"<code>{login_entry(DASHBOARD_LINK)}</code> — if it was written"
            )
            removed.setWordWrap(True)
            removed.setAlignment(Qt.AlignmentFlag.AlignHCenter)

        kept = QLabel(
            "<b>System packages are not removed.</b> Still installed: "
            f"<b>{'</b>, <b>'.join(APT_PACKAGES)}</b>. They are shared with other Qt "
            "applications, so removing them is your decision — this copyable line does it:"
        )
        kept.setWordWrap(True)
        kept.setAlignment(Qt.AlignmentFlag.AlignHCenter)

        self.command = QLineEdit(APT_REMOVE_LINE)
        self.command.setReadOnly(True)
        self.command.setFont(QFont("monospace", 9))
        copy_btn = QPushButton("Copy")
        copy_btn.clicked.connect(
            lambda: (QApplication.clipboard().setText(APT_REMOVE_LINE), copy_btn.setText("Copied"))
        )
        command_row = QHBoxLayout()
        command_row.addWidget(self.command, 1)
        command_row.addWidget(copy_btn)

        note = QLabel(
            "The Desktop TUI stays configured not to open a browser at login. "
            "Restore a <code>hermes-dashboard.service.bak-*</code> file if you want it back."
        )
        note.setWordWrap(True)
        note.setAlignment(Qt.AlignmentFlag.AlignHCenter)
        note.setEnabled(False)

        nothing_to_do = system_installed() or not (
            installed_copy().exists() or autostart_written()
            or (DESKTOP_DIR / f"{APP_ID}.desktop").exists()
            or (IS_WINDOWS and login_written(DASHBOARD_LINK))
        )

        if system_installed():
            removed = QLabel(
                f"Installed by the <b>{APP_ID}</b> package in <code>{SYSTEM_DIR}</code>.<br>"
                "Remove it with:<br><code>sudo apt remove hermes-desktopgui</code>"
            )
            removed.setWordWrap(True)
            removed.setAlignment(Qt.AlignmentFlag.AlignHCenter)
            kept = QLabel(
                "Uninstalling does not change your settings: the autostart entry in "
                f"<code>{AUTOSTART_DIR}</code> stays, and the Desktop TUI stays configured "
                "not to open a browser at login."
            )
            kept.setWordWrap(True)
            kept.setAlignment(Qt.AlignmentFlag.AlignHCenter)
            note.setVisible(False)

        panel.addWidget(title)
        panel.addWidget(removed)
        # Nothing is kept on Windows: the venv lives inside INSTALL_DIR and goes with it, and there
        # are no system packages to offer a removal line for.
        if not IS_WINDOWS:
            panel.addSpacing(8)
            panel.addWidget(kept)
            panel.addLayout(command_row)
            panel.addWidget(note)

        self.buttons = QWidget()
        row = QHBoxLayout(self.buttons)
        row.setContentsMargins(0, 0, 0, 0)
        row.addStretch(1)
        cancel = QPushButton("Cancel")
        cancel.clicked.connect(self.reject)
        self.remove_btn = QPushButton("Uninstall")
        self.remove_btn.setStyleSheet(
            f"QPushButton {{ background: {ACCENT}; color: white; padding: 6px 16px;"
            f" border-radius: 4px; font-weight: 600; }}"
        )
        self.remove_btn.clicked.connect(self._uninstall)
        self.remove_btn.setEnabled(not nothing_to_do)
        row.addWidget(cancel)
        row.addWidget(self.remove_btn)
        row.addStretch(1)

        self.result = QLabel()
        self.result.setWordWrap(True)
        self.result.setAlignment(Qt.AlignmentFlag.AlignHCenter)
        self.result.setVisible(False)

        self.close_only = QPushButton("Close")
        self.close_only.clicked.connect(self.accept)
        self.close_only.setVisible(False)
        close_row = QHBoxLayout()
        close_row.addStretch(1)
        close_row.addWidget(self.close_only)
        close_row.addStretch(1)

        self.setMinimumSize(560, 380)
        self.resize(620, 420)
        layout = QVBoxLayout(self)
        layout.addWidget(self.panel)
        layout.addWidget(self.buttons)
        layout.addWidget(self.result)
        layout.addLayout(close_row)

        if system_installed():
            self._show_result(
                "This copy is installed by the package. Remove it with "
                "<code>sudo apt remove hermes-desktopgui</code>."
            )
        elif nothing_to_do:
            self._show_result("Nothing is installed, so there was nothing to remove.")

    def _show_result(self, text: str) -> None:
        """Collapse to a small result window: one message, one Close."""
        self.panel.setVisible(False)
        self.buttons.setVisible(False)
        self.result.setText(text)
        self.result.setVisible(True)
        self.close_only.setVisible(True)
        self.close_only.setDefault(True)
        self.title_text = None
        self.setWindowTitle(f"{APP_NAME} — removed")
        self.setMinimumSize(380, 140)
        self.resize(440, 170)

    def _uninstall(self) -> None:
        if IS_WINDOWS:
            failed: list[str] = []
            for name in (APP_LINK, DASHBOARD_LINK):
                ok, said = run_shortcut("disable", name)
                if not ok:
                    failed.append(f"{name}: {said}")
            removed, said = remove_install_dir()
            if not removed:
                failed.append(f"{INSTALL_DIR}: {said}")
            if failed:
                self._show_result("Some files could not be removed:<br>" + "<br>".join(failed))
                return
            self._show_result(
                "<b>Removed.</b> The two login entries are gone and the app folder is "
                + ("gone." if said == "removed" else said + ".")
            )
            return
        failed = []
        said = remove_our_unit()
        if INSTALL_DIR.exists():
            try:
                shutil.rmtree(INSTALL_DIR)
            except OSError as exc:
                failed.append(f"{INSTALL_DIR}: {exc}")
        for path in (DESKTOP_DIR / f"{APP_ID}.desktop", autostart_entry()):
            if path.exists():
                try:
                    path.unlink()
                except OSError as exc:
                    failed.append(f"{path}: {exc}")
        if failed:
            self._show_result("Some files could not be removed:<br>" + "<br>".join(failed))
            return
        self._show_result(
            "<b>Removed.</b> The system packages are still installed.<br>" + said
        )


def uninstall() -> int:
    app = QApplication(sys.argv[:1])
    app.setApplicationName(APP_ID)
    dialog = Uninstaller()
    return dialog.exec()


def _systemctl(args: list[str]) -> None:
    try:
        subprocess.run(["systemctl", "--user", *args], capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.SubprocessError):
        pass


def remove_our_unit(unit_path: Path | None = None, run=_systemctl) -> str:
    """Disable and delete the dashboard unit, only when it carries our marker.

    The runner is a parameter so a test can prove the marker rule without asking this machine's
    systemd to stop the user's own dashboard."""
    if IS_WINDOWS:
        return "dashboard unit: not on this platform"
    unit_path = unit_path or UNIT_PATH
    if not unit_path.exists():
        return "dashboard unit: none"
    try:
        text = unit_path.read_text()
    except OSError as exc:
        return f"dashboard unit: could not read ({exc})"
    if not text.startswith(UNIT_MARKER):
        return f"left alone: {unit_path} (not written by us)"
    run(["disable", "--now", "hermes-dashboard.service"])
    try:
        unit_path.unlink()
    except OSError as exc:
        return f"dashboard unit: could not delete ({exc})"
    run(["daemon-reload"])
    return f"removed {unit_path}"


def clean() -> int:
    """Remove what the installer puts in place (user scope only)."""
    removed, said = remove_install_dir()
    print(f"{INSTALL_DIR}/: {said}")
    for path in (DESKTOP_DIR / f"{APP_ID}.desktop", autostart_entry()):
        if path.is_dir():
            shutil.rmtree(path)
            print(f"removed {path}/")
        elif path.exists():
            path.unlink()
            print(f"removed {path}")
        else:
            print(f"absent  {path}")
    if IS_WINDOWS:
        for name in (APP_LINK, DASHBOARD_LINK):
            link = login_entry(name)
            if link.exists():
                link.unlink()
                print(f"removed {link}")
            else:
                print(f"absent  {link}")
    print(remove_our_unit())
    return 0


def self_test() -> int:
    print(f"apt packages missing: {missing_packages() or 'none'}")
    print(f"unit ExecStart: {unit_execstart()}")
    print(f"browser opens at login: {browser_opens_at_login()}")
    print(f"autostart entry: {autostart_written()}")
    print(f"installed copy: {installed_copy().exists()}")
    return 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=f"{APP_NAME} — installer")
    parser.add_argument("--dry-run", action="store_true", help="detect and report, change nothing")
    parser.add_argument("--self-test", action="store_true", help="print the detection report and exit")
    parser.add_argument("--clean", action="store_true",
                        help="remove the app, its login entries, and a dashboard unit we wrote")
    parser.add_argument("--uninstall", action="store_true",
                        help="small dialog: remove the app, keep the system packages")
    parser.add_argument("--force-packages", action="store_true",
                        help="pretend the apt packages are missing, to walk the install step")
    parser.add_argument("--force-browser-check", action="store_true",
                        help="offer the browser-at-login option even though the unit is already fixed")
    args = parser.parse_args(argv)

    if args.self_test:
        return self_test()
    if args.clean:
        return clean()
    if args.uninstall:
        return uninstall()

    app = QApplication(sys.argv[:1])
    app.setApplicationName(APP_ID)
    installer = Installer(dry_run=args.dry_run, force_packages=args.force_packages,
                          force_browser_check=args.force_browser_check)
    return installer.exec()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
