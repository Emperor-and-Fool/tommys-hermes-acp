# Hermes ACP patch series — changelog

What each patch in this directory adds, which Hermes release it was cut against, and what breaks
when it is missing. The series exists because the extension calls three ACP extension methods that
upstream Hermes does not ship; it stays here until they live on a hermes-agent fork branch with an
upstream PR.

Apply the set the installed Hermes version needs — *Which set a given install needs* below has the
table. The checkout is `~/.hermes/hermes-agent` on Linux and `%LOCALAPPDATA%\hermes\hermes-agent`
on Windows:

    cd <checkout>
    # 0.23.x:
    git apply --3way <path>/packaging/hermes-patches/0003-acp-023x-session-catalog-hidden-title.patch
    # 0.22.5 – 0.22.x:
    git apply --3way <path>/packaging/hermes-patches/0001-acp-session-catalog-hidden-title.patch
    git apply --3way <path>/packaging/hermes-patches/0002-acp-gateway-ext-methods.patch
    # 0.22.2 – 0.22.4:
    git apply --3way <path>/packaging/hermes-patches/0001-acp-session-catalog-hidden-title.patch

Every patch is additive and only calls Hermes' own store methods. `git checkout -- <file>` undoes
one; nothing in the extension or in `state.db` depends on it being present. All three ship inside
both VSIXes, so `<install>/packaging/hermes-patches/` is a copy a user already has.

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

**Revision 2026-10-30 — the catalog read on builds that retag `source`.**

0.22.5 stores a session's creating surface in `created_source` and rewrites `source` to `local` for
every human surface (`gateway/session_policy.py: STORED_AS_LOCAL`, minus `tool`/`oneshot`). The
original query asked for `source="acp"`, which after that retag matches only rows written before the
upgrade: the sidebar showed old conversations and silently lost every new one, and a tab whose
session vanished from the catalog was deleted on the next refresh.

`session_catalog` now asks `list_sessions_rich` whether it accepts `local_created_sources` and passes
`source="acp", local_created_sources=["acp"]` when it does — Hermes' own predicate, which emits
`(s.source IN ('acp') OR (s.source='local' AND s.created_source IN ('acp')))` and still leaves the
`unknown` placeholder unmatched. On 0.22.2 the keyword is absent, `source` still holds the surface,
and the call stays as it was. No version table: one `inspect.signature` check, both bases.

The same file therefore applies to `d923a5eb487` (0.22.2) and `bf0203a794a` (0.22.5) — verified by
applying it to a pristine checkout of each.

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

## 0003 — the 0.23.x set: catalog, hidden and title on the gateway agent

- **Date:** 2026-11-23
- **Base:** NousResearch/hermes-agent `caafe5389a` (tag `v0.23.3`)
- **Files:** `acp_adapter/catalog.py`, `acp_adapter/gateway_server.py`
- **Applies to:** 0.23.x. It is **not** applied on top of 0001/0002, and 0001/0002 are not applied on
  top of it.

**Why 0001 and 0002 stop working there.** `SessionManager._get_db()`
(`acp_adapter/session.py:392`) no longer hands out a database object: it returns the `Persistence`
handle from `persistence_assembly.open_persistence`, and that proxy forwards only the names
`PersistenceStore` declares (`persistence_assembly.py:47`, `_FORWARDED`). 0001 calls
`db.list_sessions_rich(...)` — evaluated outside its own `try` — so the call raises
`AttributeError`; `db.set_session_hidden(...)` and `db.set_session_title(...)` fail the same way.
The wire answers `Internal error` for `_session/catalog` on every connect, so no session comes back
at all.

**Why applying 0001/0002 there is worse than not applying them.** Both still apply cleanly to
0.23.3 (`git apply --check`: no output), and 0.23.3 ships no `ext_method` on either agent — so a
clean apply changes nothing reachable and the failure stays quiet. A clean `--check` is not the
test; the version is.

**What 0003 does.**

| file | what it adds |
|---|---|
| `acp_adapter/catalog.py` | `read_catalog_rows(home, include_hidden=False)` — the same query with the listing's hidden exclusion lifted — and `catalog_with_hidden(home, cwd=None)`, the panel's read: every ACP session, hidden ones included, with `session_id`, `cwd`, `title`, `hidden`, `message_count`, `updated_at`, newest first, ids projected to their logical conversation exactly as `catalog_sessions` reports them |
| `acp_adapter/gateway_server.py` | `ext_method` on `GatewayACPAgent` dispatching `session/catalog`, `session/setHidden`, `session/setTitle` into `persistence.sessions.list_sessions` / `set_hidden` / `set_title`, opening the store of the profile the agent resolved (`self._home`) |

The class matters: `HermesACPAgent.__new__` returns a `GatewayACPAgent` when no session manager is
passed, and `acp_adapter/entry.py:207` constructs `HermesACPAgent()` with none — so the gateway agent
is what answers the editor on 0.23.x.

**Symptom when missing:** `_session/catalog` answers `Internal error` (an `AttributeError` dressed
as a JSON-RPC error) on every connect; the pane shows no tabs and no closed sessions, while
`hermes -p <profile> sessions list` still prints every row.

**Verified:** `git apply --check` and a plain apply on a pristine `v0.23.3` tree, then the three
methods driven against a copy of a `state.db` (`VACUUM INTO`, never the live store): the catalog
returned 40 rows of 53 with the 17 hidden ones flagged; `setHidden` and `setTitle` wrote the row
(`hidden=1`, `title_source='user'`); an unknown session answered `Invalid params` with
`{"reason": "unknown session …"}`.

## Which patches a given install needs

The installed Hermes version decides it. What the class that answers the wire needs follows from the
version, and a clean `git apply --check` says nothing — 0001 and 0002 apply to 0.23.3 and do not run
there.

| Hermes | patches | files touched |
|---|---|---|
| 0.22.2 – 0.22.4 | `0001` | `acp_adapter/server.py`, `acp_adapter/session.py` |
| 0.22.5 – 0.22.x | `0001` + `0002` | + `acp_adapter/gateway_server.py` |
| 0.23.x | `0003` only | `acp_adapter/catalog.py`, `acp_adapter/gateway_server.py` |

A behavioural check beats both, because it survives a refactor of either file: open a pane and look
at the tab list, or send `_session/catalog` and see whether it answers `null` or an error.

## After a `hermes update`

`hermes update` runs `git pull` in that checkout. Local changes are stashed first
(`hermes-update-autostash-…`) and afterwards it asks *“Restore local changes now?”*
(`hermes_cli/update_cmd_stash.py:568-573`) — answer **y** to keep the patch; if you answer no,
re-apply it by hand. Either way, check the patch is present before opening a pane.

## Not done yet

Neither patch is upstream. Until one is, `hermes update` is free to move the class that answers these
methods again — which is exactly what 0.22.5 did to 0001. The durable fix is a PR against
NousResearch/hermes-agent; the extension detecting a `null` catalog and proposing the relevant patch
is the interim stopgap, not a substitute.
