# Hermes ACP patches (temporary home)

Three `_`-prefixed ACP extension methods this extension calls, which upstream Hermes does not ship:

- `_session/catalog`: every ACP session, hidden ones included, with its `hidden` flag
- `_session/setHidden`: hide or unhide a session (what closing a tab does)
- `_session/setTitle`: rename a session as a user title

Kept here until #160759 and #160767 are merged and shipped in a Hermes release; the release after
that drops this directory. They ship inside both
VSIXes, so an installed extension always carries its own copy:

    <installed extension>/packaging/hermes-patches/
    # Linux:   ~/.vscode-oss/extensions/emperorandfool.tommys-hermes-acp-<version>/packaging/hermes-patches/
    # Windows: %USERPROFILE%\.vscode\extensions\emperorandfool.tommys-hermes-acp-<version>\packaging\hermes-patches\

## Which set the installed Hermes needs

| Hermes | patches | base each was cut against |
|---|---|---|
| 0.22.2 – 0.22.4 | `0001` | `d923a5eb487` (0.22.2) |
| 0.22.5 – 0.22.x | `0001` + `0002` | `0002`: `bf0203a794a` (0.22.5); `0001` also verified there |
| 0.23.x | `0003` only | `caafe5389a` (tag `v0.23.3`) |

The Hermes checkout is `~/.hermes/hermes-agent` on Linux and `%LOCALAPPDATA%\hermes\hermes-agent`
on Windows; `install-stamp.json` beside it names the commit and the version.

**A clean `git apply --check` is not the test.** `0001` and `0002` both apply cleanly to 0.23.3 and
change nothing reachable there — 0.23.3 answers the wire from `GatewayACPAgent`, whose storage handle
(`Persistence`) no longer carries the methods `0001` calls. Apply the set the *version* needs.

## What each patch adds

- `0001-acp-session-catalog-hidden-title.patch`: the three methods on `HermesACPAgent`, and the
  `SessionManager` calls behind them, reading the session table in whichever layout the build uses —
  `source` on 0.22.2, `created_source` alongside it on 0.22.5, where `source` is rewritten to
  `local` (`acp_adapter/server.py`, `acp_adapter/session.py`).
- `0002-acp-gateway-ext-methods.patch`: the same three on `GatewayACPAgent`, the class 0.22.5
  actually answers from, because `HermesACPAgent.__new__` returns one (`acp_adapter/gateway_server.py`).
- `0003-acp-023x-session-catalog-hidden-title.patch`: the same three for 0.23.x — `ext_method` on
  `GatewayACPAgent` writing through `persistence.sessions.*`, and `catalog_with_hidden` beside
  Hermes' own `catalog_sessions` (`acp_adapter/catalog.py`, `acp_adapter/gateway_server.py`).

The symptom when the right set is missing, and the cause on 0.23.x, are in [`CHANGELOG.md`](CHANGELOG.md).

## Applying them

    cd ~/.hermes/hermes-agent                                                     # Windows: %LOCALAPPDATA%\hermes\hermes-agent
    git apply --3way <this folder>/0003-acp-023x-session-catalog-hidden-title.patch   # 0.23.x
    git apply --3way <this folder>/0001-acp-session-catalog-hidden-title.patch        # 0.22.x …
    git apply --3way <this folder>/0002-acp-gateway-ext-methods.patch                 # … 0.22.5 and later

### Coming from 0.22 to 0.23

The 0.22 set must be gone before `0003` goes in, and nothing on disk will tell you so: both patches
still apply cleanly to 0.23, and the result is a file where `0002`'s `ext_method` is defined *after*
the block `0003` inserts — so Python keeps `0002`'s, and that one calls
`SessionManager.session_catalog`, which is 0.22 code calling `list_sessions_rich` on a store 0.23 no
longer has. Every connect answers `Internal error`.

    cd ~/.hermes/hermes-agent                                   # Windows: %LOCALAPPDATA%\hermes\hermes-agent
    git checkout -- acp_adapter                                 # drop 0001 and 0002
    git apply --3way <this folder>/0003-acp-023x-session-catalog-hidden-title.patch
    git status --short acp_adapter                              # exactly two M lines

Exactly two — `catalog.py` and `gateway_server.py`. A third (`server.py` or `session.py`) means the
0.22 set is back.

`hermes update` stashes local changes before its pull and asks afterwards whether to restore
them. **Either answer is fine now.** The extension reads the checkout at the next connect; when the
wrong set is in place it says so and offers **Patch**, which reverses `0001`+`0002` and applies
`0003` with git. The manual steps stay as the fallback: reset the adapter with
`git checkout -- acp_adapter`, apply `0003` alone with `git apply --3way`, and check that
`git status --short acp_adapter` shows exactly two `M` lines. If `0001`+`0002` stay on top of
`0003`, their code takes over and every connect answers `Internal error` — the state the
**Patch** button reports and repairs.

Check before opening a pane: `_session/catalog` answering `null` or an error is the patch's absence.
