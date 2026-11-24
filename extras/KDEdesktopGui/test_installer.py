#!/usr/bin/env python3
"""Tests for the parts of the installer that decide something, run without a display.

The marker rule is the one that matters: a dashboard unit is removed only when it carries the line
this extension wrote. Everything else here is the Windows shape of the app's paths.

    python3 -m unittest test_installer -v
"""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

import installer_gui as gui


class TheMarkerRule(unittest.TestCase):
    def setUp(self) -> None:
        self.calls: list[list[str]] = []
        self.dir = Path(tempfile.mkdtemp(prefix="unit-test-"))
        self.unit = self.dir / "hermes-dashboard.service"

    def tearDown(self) -> None:
        for path in self.dir.glob("*"):
            path.unlink()
        self.dir.rmdir()

    def run_recording(self, args: list[str]) -> None:
        self.calls.append(list(args))

    def test_a_unit_we_wrote_is_disabled_then_removed(self) -> None:
        self.unit.write_text(gui.UNIT_MARKER + "\n[Unit]\nDescription=x\n")
        said = gui.remove_our_unit(self.unit, self.run_recording)
        self.assertIn("removed", said)
        self.assertFalse(self.unit.exists(), "the file is gone")
        self.assertEqual(self.calls, [["disable", "--now", "hermes-dashboard.service"], ["daemon-reload"]])

    def test_a_unit_the_user_wrote_is_left_alone(self) -> None:
        theirs = "[Unit]\nDescription=Hermes Dashboard\nExecStart=/usr/bin/hermes dashboard --no-open\n"
        self.unit.write_text(theirs)
        said = gui.remove_our_unit(self.unit, self.run_recording)
        self.assertIn("left alone", said)
        self.assertEqual(self.unit.read_text(), theirs, "byte for byte")
        self.assertEqual(self.calls, [], "systemd is not asked to stop it")

    def test_no_unit_is_not_an_error(self) -> None:
        said = gui.remove_our_unit(self.unit, self.run_recording)
        self.assertIn("none", said)
        self.assertEqual(self.calls, [])


class TheWindowsShape(unittest.TestCase):
    def test_the_app_and_its_venv_live_beside_the_user(self) -> None:
        # These are resolved at import time from the environment this process runs in; on Linux
        # that is the Linux layout, and the Windows branches are compile-time checked only.
        self.assertEqual(gui.INSTALL_DIR.name, "hermes-desktopgui")
        self.assertEqual(gui.VENV_DIR, gui.INSTALL_DIR / "venv")
        self.assertEqual(gui.venv_python().name, "python.exe")
        self.assertEqual(gui.venv_pythonw().name, "pythonw.exe")

    def test_the_two_login_entries_are_named(self) -> None:
        self.assertEqual(gui.APP_LINK, "Hermes Desktop GUI.lnk")
        self.assertEqual(gui.DASHBOARD_LINK, "Hermes Dashboard.lnk")
        self.assertTrue(str(gui.SHORTCUT_SCRIPT).endswith(os.path.join("packaging", "windows", "Set-HermesTrayShortcut.ps1")))


if __name__ == "__main__":
    unittest.main()
