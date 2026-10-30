# Hermes ACP patch series — changelog

What each patch in this directory adds, which Hermes release it was cut against, and what breaks
when it is missing. The series exists because the extension calls three ACP extension methods that
upstream Hermes does not ship; it stays here until they live on a hermes-agent fork branch with an
upstream PR.

Apply in order, on the install, after any `hermes update` that drops them:

    cd ~/.hermes/hermes-agent
    git apply --3way /path/to/tommys-hermes-acp/packaging/hermes-patches/0001-acp-session-catalog-hidden-title.patch
    git apply --3way /path/to/tommys-hermes-acp/packaging/hermes-patches/0002-acp-gateway-ext-methods.patch

Both are additive and only call Hermes' own database methods. `git checkout -- <file>` undoes either
one; nothing in the extension or in `state.db` depends on them being present.

## 0001 — session catalog, hidden flag, title

- **Date:** 2026-10-27
- **Base:** NousResearch/hermes-agent `d923a5eb487` (0.22.2)
- **Files:** `acp_adapter/server.py`, `acp_adapter/session.py`

Adds the three `_`-prefixed ACP extension methods the sidebar needs, and the session-manager calls
behind them:

| method | what it does | why it cannot be avoided |
|---|---|---|
| `_session/catalog` | every ACP session, hidden ones included, with its `hidden` flag | a tab in the strip *is* an unhidden session, and ACP's own `session/list` withholds hidden rows |
| `_session/setHidden` | flips `sessions.hidden` — what closing a tab writes | the strip's × must hide, never delete; hide is Hermes-side state that also removes the session from Hermes' own lists and search |
| `_session/setTitle` | writes the title as `title_source='user'` | ACP has no title method, and a non-`user` title is overwritten by the auto-titler |

## 0002 — the same methods on the gateway agent

- **Date:** 2026-10-30
- **Base:** NousResearch/hermes-agent `bf0203a794a` (0.22.5)
- **Files:** `acp_adapter/gateway_server.py`

Adds `ext_method` to `GatewayACPAgent`, dispatching the same three methods into the same
`SessionManager` calls 0001 introduced.

**Why it is needed:** 0.22.5 gives `HermesACPAgent` a `__new__` that returns a `GatewayACPAgent`
whenever no session manager is passed — which is how both `entry.py` and the editor construct it.
0001's handlers live on `HermesACPAgent`, so from the wire they become unreachable: the handler
never runs and the SDK answers `null`.

**Symptom when missing:** `_session/catalog` answers `{"result": null}`. The pane therefore shows no
open tabs and no closed sessions, and a rename silently refuses. It reads as "all my sessions are
gone" — the store is untouched and `hermes -p <profile> sessions list` still prints every row.

**0001 alone is not enough on 0.22.5 and later.** It still applies cleanly there, which is what makes
the failure quiet: the patch succeeds and changes nothing.

## Which patches a given install needs

The class that answers the wire decides it, not the patch's own base version:

    ls ~/.hermes/hermes-agent/acp_adapter/gateway_server.py      # exists → 0002 needed
    grep -c ext_method ~/.hermes/hermes-agent/acp_adapter/server.py   # 0 → 0001 needed

A behavioural check beats both, because it survives a refactor of either file: open a pane and look
at the tab list, or send `_session/catalog` and see whether it answers `null`.

## Not done yet

Neither patch is upstream. Until one is, `hermes update` is free to move the class that answers these
methods again — which is exactly what 0.22.5 did to 0001. The durable fix is a PR against
NousResearch/hermes-agent; the extension detecting a `null` catalog and proposing the relevant patch
is the interim stopgap, not a substitute.
