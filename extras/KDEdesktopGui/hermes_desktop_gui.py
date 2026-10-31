#!/usr/bin/env python3
# Hermes Desktop TUI — a tray shell around the local Hermes dashboard
# Copyright (C) 2026 Emperor & Fool
#
# This program is free software: you can redistribute it and/or modify it
# under the terms of the GNU General Public License as published by the Free
# Software Foundation, either version 3 of the License, or (at your option)
# any later version. See <https://www.gnu.org/licenses/>.
#
# SPDX-License-Identifier: GPL-3.0-or-later

"""A tray icon that says whether the Hermes dashboard is up, and one click away.

Two jobs, in that order:

* awareness — a status dot in the system tray, polled against the dashboard URL;
* access — a web window on http://127.0.0.1:9119, hidden instead of closed.

The app is a shell, not a server: it never starts Hermes. If the dashboard
systemd unit is down the tray says so and the window shows the error page.

Runs on the distro interpreter; needs only python3-pyqt6 and
python3-pyqt6.qtwebengine (no venv, no pip installs).
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

from PyQt6.QtCore import QObject, QSettings, QSize, QTimer, QUrl
from PyQt6.QtGui import QColor, QIcon, QImage, QPainter, QPixmap
from PyQt6.QtNetwork import QNetworkAccessManager, QNetworkReply, QNetworkRequest
from PyQt6.QtWebEngineWidgets import QWebEngineView
from PyQt6.QtWidgets import (
    QApplication,
    QMainWindow,
    QMenu,
    QSystemTrayIcon,
)

APP_ID = "hermes-desktopgui"
APP_NAME = "Hermes Desktop GUI"
DEFAULT_URL = "http://127.0.0.1:9119/"
POLL_MS = 5000
PROBE_TIMEOUT_MS = 2500
# Frozen builds (PyInstaller) unpack to sys._MEIPASS; a source run reads next to
# this file. One lookup, so the icon resolves in both.
_HERE = Path(__file__).resolve().parent
BUNDLE = Path(getattr(sys, "_MEIPASS", _HERE))
ICON_PATH = BUNDLE / "icons" / "hermes-nousresearch-sec.svg"

# State is carried by the glyph itself: brand orange when the dashboard answers,
# a flat neutral grey when it does not, faint grey while the first poll is out.
# A painted status dot was tried first and rejected — over the orange body a
# green dot measures 1.19:1 and a red one 1.87:1, i.e. invisible.
STATE_TINTS = {
    "down": QColor("#8a8a8a"),
    "unknown": QColor("#b4b4b4"),
}
UNKNOWN_ALPHA = 115
ICON_SIZES = (16, 22, 24, 32, 48, 64, 96)


def _tinted(pixmap: QPixmap, colour: QColor, alpha: int = 255) -> QPixmap:
    """Recolour a pixmap through its own alpha mask, optionally fading it."""
    image = pixmap.toImage().convertToFormat(QImage.Format.Format_ARGB32_Premultiplied)
    painter = QPainter(image)
    painter.setCompositionMode(QPainter.CompositionMode.CompositionMode_SourceIn)
    painter.fillRect(image.rect(), colour)
    if alpha < 255:
        painter.setCompositionMode(QPainter.CompositionMode.CompositionMode_DestinationIn)
        painter.fillRect(image.rect(), QColor(0, 0, 0, alpha))
    painter.end()
    return QPixmap.fromImage(image)


def status_icon(base: QIcon, state: str) -> QIcon:
    """The brand glyph, tinted to say whether the dashboard is up."""
    tinted = QIcon()
    for size in ICON_SIZES:
        pixmap = base.pixmap(QSize(size, size))
        if pixmap.isNull():
            continue
        if state in STATE_TINTS:
            pixmap = _tinted(pixmap, STATE_TINTS[state], UNKNOWN_ALPHA if state == "unknown" else 255)
        tinted.addPixmap(pixmap)
    return tinted if not tinted.isNull() else base


def health_url(dashboard_url: str) -> QUrl:
    url = QUrl(dashboard_url)
    url.setPath("/")
    url.setQuery("")
    url.setFragment("")
    return url


_EDITOR_CANDIDATES = (("codium", "VSCodium"), ("code", "VS Code"))


def editor_command() -> tuple[str, str] | None:
    """The editor to open from the tray: $HERMES_EDITOR, else the first one on PATH."""
    override = os.environ.get("HERMES_EDITOR")
    if override:
        return override, Path(override).name
    for name, label in _EDITOR_CANDIDATES:
        if shutil.which(name):
            return name, label
    return None


_EDITOR = editor_command()
EDITOR_NAME = _EDITOR[1] if _EDITOR else "editor"


def open_editor() -> None:
    """Start the editor exactly as the desktop launcher does.

    No window flags: VSCodium then restores the session you closed, which is what a tray
    entry should do. `--new-window` forces a clean window (and `--reuse-window` only makes
    sense while one is already open) — both were wrong here.
    """
    command = _EDITOR or editor_command()
    if command is None:
        return
    try:
        subprocess.Popen([command[0]], start_new_session=True)
    except OSError:
        pass


class Tray(QSystemTrayIcon):
    def __init__(self, window: "DashboardWindow", app: QApplication, dash_url: str, base_icon: QIcon):
        super().__init__(status_icon(base_icon, "unknown"), app)
        self._window = window
        self._app = app
        self._dash_url = dash_url
        self._base_icon = base_icon
        self._state = ""

        self._menu = QMenu()
        self._status_action = self._menu.addAction("Dashboard: checking…")
        self._status_action.setEnabled(False)
        self._menu.addSeparator()
        self._open_action = self._menu.addAction("Open Hermes GUI")
        self._open_action.triggered.connect(self.toggle_window)
        self._editor_action = self._menu.addAction(f"Open {EDITOR_NAME}")
        self._editor_action.triggered.connect(open_editor)
        if not editor_command():
            self._editor_action.setEnabled(False)
        reload_action = self._menu.addAction("Reload")
        reload_action.triggered.connect(window.reload_page)
        self._menu.addSeparator()
        quit_action = self._menu.addAction("Quit")
        quit_action.triggered.connect(self.quit)

        self.setContextMenu(self._menu)
        self.activated.connect(self._activated)
        self.set_state("unknown")
        self.show()

    def set_state(self, state: str) -> None:
        if state == self._state:
            return
        self._state = state
        label = {"up": "up", "down": "down"}.get(state, "checking…")
        host = QUrl(self._dash_url).authority()
        self.setIcon(status_icon(self._base_icon, state))
        self.setToolTip(f"{APP_NAME}\nDashboard {label} · {host}")
        self._status_action.setText(f"Dashboard: {label} · {host}")

    def _activated(self, reason) -> None:
        if reason in (
            QSystemTrayIcon.ActivationReason.Trigger,
            QSystemTrayIcon.ActivationReason.DoubleClick,
        ):
            self.toggle_window()

    def toggle_window(self) -> None:
        if self._window.isVisible():
            self._window.hide()
        else:
            self._window.show_and_raise()

    def quit(self) -> None:
        self._window.allow_close = True
        self.hide()
        self._app.quit()


class DashboardWindow(QMainWindow):
    def __init__(self, dash_url: str, base_icon: QIcon):
        super().__init__()
        self.base_icon = base_icon
        self.allow_close = False
        self._settings = QSettings("EandF", APP_ID)

        self.setWindowTitle("Hermes Dashboard")
        self.setWindowIcon(base_icon)
        self.resize(1280, 860)
        geometry = self._settings.value("geometry")
        if geometry is not None:
            self.restoreGeometry(geometry)

        self.view = QWebEngineView(self)
        self.view.load(QUrl(dash_url))
        self.setCentralWidget(self.view)

    def show_and_raise(self) -> None:
        self.show()
        self.raise_()
        self.activateWindow()

    def reload_page(self) -> None:
        self.view.reload()

    def closeEvent(self, event) -> None:
        if self.allow_close:
            self._settings.setValue("geometry", self.saveGeometry())
            event.accept()
            return
        self._settings.setValue("geometry", self.saveGeometry())
        self.hide()
        event.ignore()


class Prober(QObject):
    """Polls the dashboard root and reports up/down to a callback."""

    def __init__(self, url: str, on_state, parent: QObject | None = None):
        super().__init__(parent)
        self._on_state = on_state
        self._url = health_url(url)
        self._net = QNetworkAccessManager(self)
        self._timer = QTimer(self)
        self._timer.setInterval(POLL_MS)
        self._timer.timeout.connect(self.check)
        self._timer.start()
        QTimer.singleShot(0, self.check)

    def check(self) -> None:
        request = QNetworkRequest(self._url)
        request.setTransferTimeout(PROBE_TIMEOUT_MS)
        reply = self._net.get(request)

        def done() -> None:
            ok = reply.error() == QNetworkReply.NetworkError.NoError
            self._on_state("up" if ok else "down")
            reply.deleteLater()

        reply.finished.connect(done)


def run_self_test(url: str) -> int:
    """Headless smoke test: does the probe see the server, does the page load?"""
    app = QApplication(sys.argv[:1])
    icon = QIcon(str(ICON_PATH)) if ICON_PATH.exists() else QIcon()
    window = DashboardWindow(url, icon)
    seen: dict[str, object] = {}

    def loaded(ok: bool) -> None:
        seen["loaded"] = ok
        seen["title"] = window.view.title()

    window.view.loadFinished.connect(loaded)

    class _Sink:
        state: str | None = None

        def set_state(self, state: str) -> None:
            self.state = state

    sink = _Sink()
    prober = Prober(url, sink.set_state)
    prober._timer.stop()  # one shot is enough for the smoke test

    def finish() -> None:
        state = sink.state
        loaded_ok = seen.get("loaded")
        title = seen.get("title")
        print(f"health poll -> {state}")
        print(f"page loaded -> {loaded_ok!r} title={title!r}")
        app.exit(0 if state == "up" and loaded_ok is True else 1)

    QTimer.singleShot(6000, finish)
    return app.exec()


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=f"{APP_NAME} — tray status and window for the Hermes dashboard.")
    parser.add_argument(
        "--url",
        default=os.environ.get("HERMES_DASHBOARD_URL", DEFAULT_URL),
        help=f"dashboard URL (default {DEFAULT_URL}, or $HERMES_DASHBOARD_URL)",
    )
    parser.add_argument("--show", action="store_true", help="open the window at startup instead of starting in the tray")
    parser.add_argument("--self-test", action="store_true", help="headless check of the health probe and page load")
    args = parser.parse_args(argv)

    if args.self_test:
        return run_self_test(args.url)

    app = QApplication(sys.argv[:1])
    app.setApplicationName(APP_ID)
    app.setDesktopFileName(APP_ID)
    app.setQuitOnLastWindowClosed(False)

    icon = QIcon(str(ICON_PATH)) if ICON_PATH.exists() else QIcon.fromTheme("internet-web-browser")
    app.setWindowIcon(icon)

    window = DashboardWindow(args.url, icon)
    tray = Tray(window, app, args.url, icon)
    Prober(args.url, tray.set_state, parent=app)

    if args.show:
        window.show_and_raise()
    return app.exec()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
