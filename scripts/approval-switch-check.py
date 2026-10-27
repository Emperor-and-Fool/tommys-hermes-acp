#!/usr/bin/env python3
"""Drive the live permission card's approval switch over CDP and check the config follows.

    python3 scripts/approval-switch-check.py [profile]

Needs VSCodium started with the renderer's debug port:

    # close every VSCodium window first: the flag is read at launch
    codium --remote-debugging-port=9222

What it does, without touching your files:
  1. finds the pane (the only webview whose iframe has #messages),
  2. uses a pending permission card, or posts a synthetic ``permissionRequest`` into the
     pane so the card's switch exists (nothing is sent to Hermes either way),
  3. clicks one mode that is not the current one, waits for
     ``hermes --profile <p> config get approvals.mode`` to say so, checks the switch
     shows it pressed, clicks the original mode back, and waits for the CLI again,
  4. leaves the profile on the mode it found.

Exit 0 when the CLI followed both clicks, 2 when there is nothing to drive (no CDP
port, or no real permission request yet), 1 on a real mismatch. The synthetic card is
resolved at the end and disappears on the next reload.
"""
from __future__ import annotations

import asyncio
import json
import subprocess
import sys
import urllib.error
import urllib.request
from typing import Any

CDP_HTTP = "http://127.0.0.1:9222"
PROFILE = sys.argv[1] if len(sys.argv) > 1 else "dev-vsc"

PANE_PROBE = """
(() => {
    const frame = document.querySelector('iframe');
    const doc = frame && frame.contentDocument;
    return !!(doc && doc.getElementById('messages'));
})()
"""

CARD_STATE = """
(() => {
    const doc = document.querySelector('iframe').contentDocument;
    const block = doc.querySelector('.permission-approval-block');
    if (!block) {
        return { card: false };
    }
    const row = block.querySelector('.permission-approval');
    const buttons = Array.from(block.querySelectorAll('.permission-approval-btn'));
    return {
        card: true,
        pending: !!doc.querySelector('.message.permission.pending'),
        mode: row ? row.dataset.mode : null,
        labels: buttons.map(b => b.textContent),
        disabled: buttons.map(b => b.disabled),
        pressed: buttons.map(b => b.getAttribute('aria-pressed')),
        error: (() => {
            const el = block.querySelector('.permission-approval-error');
            return el && !el.hidden ? el.textContent : '';
        })(),
    };
})()
"""

POST_MODE = """
(() => {
    const frame = document.querySelector('iframe');
    frame.contentWindow.postMessage({ type: 'approvalMode', mode: '%s' }, '*');
    return true;
})()
"""

POST_CARD = """
(() => {
    const frame = document.querySelector('iframe');
    frame.contentWindow.postMessage({
        type: 'permissionRequest',
        id: 'switch-check-probe',
        title: 'Approval switch probe (test script)',
        detail: 'Synthetic card: no tool call is behind it.',
        options: [{ optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' }],
    }, '*');
    return true;
})()
"""

CLICK_MODE = """
(() => {
    const doc = document.querySelector('iframe').contentDocument;
    const btn = doc.querySelector('.permission-approval-btn[data-approval-mode="%s"]');
    if (!btn || btn.disabled) {
        return { clicked: false, disabled: btn ? true : null };
    }
    btn.click();
    return { clicked: true };
})()
"""

RESOLVE_PROBE = """
(() => {
    const doc = document.querySelector('iframe').contentDocument;
    const btn = doc.querySelector('.permission-btn');
    if (btn) {
        btn.click();
    }
    return true;
})()
"""

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {name}{('  — ' + detail) if detail else ''}")
    if not ok:
        failures.append(name)


def cli_get() -> str:
    proc = subprocess.run(
        ["hermes", "--profile", PROFILE, "config", "get", "approvals.mode"],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        sys.exit(f"hermes config get failed: {proc.stderr.strip()}")
    return proc.stdout.strip()


def cdp_targets() -> list[dict]:
    try:
        with urllib.request.urlopen(CDP_HTTP + "/json/list", timeout=3) as response:
            return json.load(response)
    except (urllib.error.URLError, TimeoutError, ConnectionError):
        return []


class Target:
    """One webview target: one socket, one id counter."""

    def __init__(self, url: str) -> None:
        self.url = url
        self._ws: Any = None
        self._next_id = 0

    async def open(self) -> None:
        self._ws = await websockets.connect(self.url, max_size=None)

    async def call(self, method: str, params: dict | None = None) -> dict:
        self._next_id += 1
        request_id = self._next_id
        await self._ws.send(json.dumps({"id": request_id, "method": method, "params": params or {}}))
        while True:
            message = json.loads(await self._ws.recv())
            if message.get("id") == request_id:
                return message

    async def js(self, expression: str):
        response = await self.call(
            "Runtime.evaluate",
            {"expression": expression, "returnByValue": True, "awaitPromise": True, "userGesture": True},
        )
        result = response.get("result", {})
        if "exceptionDetails" in result:
            raise RuntimeError(json.dumps(result["exceptionDetails"])[:400])
        return result.get("result", {}).get("value")

    async def close(self) -> None:
        if self._ws is not None:
            await self._ws.close()


async def wait_for_cli(mode: str, timeout: float = 12.0) -> bool:
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        if cli_get() == mode:
            return True
        await asyncio.sleep(0.4)
    return False


async def main() -> int:
    if not cdp_targets():
        print("No CDP on 127.0.0.1:9222 — close every VSCodium window and relaunch with:")
        print("    codium --remote-debugging-port=9222")
        return 2

    targets = [t for t in cdp_targets() if t.get("url", "").startswith("vscode-webview://")]
    pane = None
    for entry in targets:
        target = Target(entry["webSocketDebuggerUrl"])
        try:
            await target.open()
            if await target.js(PANE_PROBE):
                pane = target
                break
            await target.close()
        except Exception:
            await target.close()
    if pane is None:
        print(f"No pane found among {len(targets)} webview target(s): open the Hermes chat first.")
        return 2

    before = cli_get()
    print(f"profile {PROFILE}: CLI says {before!r}\n")
    await pane.js(POST_CARD)
    await asyncio.sleep(0.4)

    state = await pane.js(CARD_STATE)
    if not state or not state.get("card"):
        print("A permissionRequest produced no card with a switch: is the deployed build current?")
        return 1
    check("pending card shows the switch", bool(state.get("pending")), json.dumps(state.get("labels")))
    if all(state.get("disabled") or []):
        # Nothing has been approved since the reload, so the host has not posted a mode yet.
        # Seed the pane's display state with what the CLI says; everything after this is the
        # real path: button -> pane message -> host -> `hermes config set`.
        print(f"switch disabled (no real card since reload): seeding the card with {before!r}")
        await pane.js(POST_MODE % before)
        await asyncio.sleep(0.3)
        state = await pane.js(CARD_STATE)
        check("switch enabled after the CLI's mode is posted", not all(state.get("disabled") or []),
              json.dumps(state))

    wanted = "manual" if before != "manual" else "smart"
    check("switch already shows the CLI's mode", state.get("mode") == before,
          f"card {state.get('mode')!r} vs CLI {before!r}")

    clicked = await pane.js(CLICK_MODE % wanted)
    check(f"clicked {wanted!r}", bool(clicked and clicked.get("clicked")), json.dumps(clicked))
    followed = await wait_for_cli(wanted)
    check(f"CLI followed to {wanted!r}", followed, repr(cli_get()))
    state = await pane.js(CARD_STATE)
    pressed = [label for label, pressed in zip(state.get("labels") or [], state.get("pressed") or []) if pressed == "true"]
    check("switch shows it pressed", state.get("mode") == wanted and len(pressed) == 1, json.dumps(state))
    check("no error line", not state.get("error"), state.get("error") or "")

    clicked = await pane.js(CLICK_MODE % before)
    check(f"clicked {before!r} again", bool(clicked and clicked.get("clicked")), json.dumps(clicked))
    restored = await wait_for_cli(before)
    check(f"CLI back on {before!r}", restored, repr(cli_get()))

    await pane.js(RESOLVE_PROBE)
    await pane.close()

    print()
    if failures:
        print(f"{len(failures)} step(s) failed: {', '.join(failures)}")
        return 1
    print(f"all steps agree; profile left on {before!r}")
    return 0


if __name__ == "__main__":
    try:
        import websockets  # noqa: F401  (only needed for the pane half)
    except ImportError:
        sys.exit("pip install websockets — needed to talk CDP")
    sys.exit(asyncio.run(main()))
