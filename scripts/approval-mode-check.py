#!/usr/bin/env python3
"""Round-trip Hermes' approvals.mode: this extension's module and the CLI, agreeing.

    python3 scripts/approval-mode-check.py [profile]

Writes ``manual``, then ``off``, then restores whatever it found first, asserting at
every step that ``hermes --profile <p> config get approvals.mode`` reports what the
extension's own ``writeApprovalMode`` said it wrote, and that ``readApprovalMode``
reads the same value back. Nothing else is touched: no config file is opened by hand.

Exit code 0 when every step agrees, 1 otherwise. The profile is left as it was found
(or on ``smart`` if it could not be read).
"""
from __future__ import annotations

import json
import pathlib
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parents[1]
PROFILE = sys.argv[1] if len(sys.argv) > 1 else "dev-vsc"
MODULE = REPO / "out" / "host" / "environment" / "approvalMode.js"

# The module pulls in profileDiscovery, which reaches for vscode at import time; a stub is
# enough for the two config calls and keeps this runnable without an extension host.
NODE_HELPER = r"""
const Module = require('module');
const orig = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'vscode') {
        return { workspace: { getConfiguration: () => ({ get: () => undefined }) } };
    }
    return orig.call(this, request, parent, isMain);
};
const mod = require(process.argv[1]);
(async () => {
    const profile = process.argv[2];
    const write = process.argv[3] || '';
    const out = { read: await mod.readApprovalMode('hermes', profile) };
    if (write) {
        out.write = await mod.writeApprovalMode('hermes', profile, write);
    }
    console.log(JSON.stringify(out));
})().catch(err => { console.error(String(err)); process.exit(1); });
"""

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {name}{('  — ' + detail) if detail else ''}")
    if not ok:
        failures.append(name)


def run_module(mode: str = "") -> dict:
    proc = subprocess.run(
        ["node", "-e", NODE_HELPER, str(MODULE), PROFILE, mode],
        capture_output=True,
        text=True,
        cwd=str(REPO),
    )
    if proc.returncode != 0:
        sys.exit(f"module call failed: {proc.stderr.strip()}")
    return json.loads(proc.stdout.strip().splitlines()[-1])


def cli_get() -> str:
    proc = subprocess.run(
        ["hermes", "--profile", PROFILE, "config", "get", "approvals.mode"],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        sys.exit(f"hermes config get failed: {proc.stderr.strip()}")
    return proc.stdout.strip()


def main() -> int:
    if not MODULE.exists():
        sys.exit(f"{MODULE} is missing: run npx tsc -p ./ first")

    original = cli_get()
    print(f"profile {PROFILE}: CLI says {original!r}\n")
    first_read = run_module()
    check("readApprovalMode agrees with the CLI", first_read["read"] == original, f"{first_read['read']!r}")

    planned = [mode for mode in ("manual", "off") if mode != original]
    for mode in planned:
        result = run_module(mode)
        check(f"writeApprovalMode({mode!r}) reports success", result.get("write") is True, str(result.get("write")))
        check(f"CLI now says {mode!r}", cli_get() == mode, repr(cli_get()))
        check(f"readApprovalMode now says {mode!r}", run_module()["read"] == mode)

    restore = original if original in ("manual", "smart", "off") else "smart"
    result = run_module(restore)
    check(f"restored to {restore!r}", result.get("write") is True and cli_get() == restore, repr(cli_get()))

    print()
    if failures:
        print(f"{len(failures)} step(s) failed: {', '.join(failures)}")
        return 1
    print("all steps agree")
    return 0


if __name__ == "__main__":
    sys.exit(main())
