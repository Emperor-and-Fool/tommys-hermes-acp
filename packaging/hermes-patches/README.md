# Hermes ACP patch (temporary home)

`0001-acp-session-catalog-hidden-title.patch` adds three `_`-prefixed ACP extension methods to
Hermes's ACP adapter, which this extension uses:

- `_session/catalog`: every ACP session, hidden ones included, with its `hidden` flag
- `_session/setHidden`: hide or unhide a session
- `_session/setTitle`: rename a session as a user title

It only touches `acp_adapter/server.py` and `acp_adapter/session.py`, and only calls Hermes's own
db methods.

Base: NousResearch/hermes-agent `d923a5eb487a17c0a68801bba9ef0f56c81040a8` (Release 0.22.2).

Kept here until it lives on a hermes-agent fork branch with an upstream PR.

Apply after a `hermes update` that dropped it:

    cd ~/.hermes/hermes-agent && git apply --3way /path/to/0001-acp-session-catalog-hidden-title.patch
