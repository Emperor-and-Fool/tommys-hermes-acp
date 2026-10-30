# Hermes ACP patch (temporary home)

`0001-acp-session-catalog-hidden-title.patch` adds three `_`-prefixed ACP extension methods to
Hermes's ACP adapter, which this extension uses:

- `_session/catalog`: every ACP session, hidden ones included, with its `hidden` flag
- `_session/setHidden`: hide or unhide a session
- `_session/setTitle`: rename a session as a user title

It only touches `acp_adapter/server.py` and `acp_adapter/session.py`, and only calls Hermes's own
db methods.

Bases: `d923a5eb487` (Release 0.22.2) for `0001`, `bf0203a794a` (0.22.5) for `0002`. `0001` applies
cleanly to both and reads the session table in whichever layout the build uses — `source` on 0.22.2,
`created_source` alongside it on 0.22.5, where `source` is rewritten to `local`.

Kept here until they live on a hermes-agent fork branch with an upstream PR.

`0002-acp-gateway-ext-methods.patch` carries the same three methods onto `GatewayACPAgent`, which
is the class 0.22.5 actually answers from: `HermesACPAgent.__new__` returns a `GatewayACPAgent`, so
`0001`'s handlers stop being reachable while the patch itself still applies cleanly. On 0.22.5 and
later both are needed; `0001` alone fails silently.

Which one an install needs, the symptom when it is missing, and the release each was cut against are
in [`CHANGELOG.md`](CHANGELOG.md).

Apply after a `hermes update` that dropped them:

    cd ~/.hermes/hermes-agent
    git apply --3way /path/to/0001-acp-session-catalog-hidden-title.patch
    git apply --3way /path/to/0002-acp-gateway-ext-methods.patch
