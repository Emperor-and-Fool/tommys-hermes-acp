# Secondant activation — done, one live check left

**Symptom (before).** The secondant pane sat on "Loading profile & session…" and the first send
opened a new Hermes session instead of using the tab's bound one.

**Cause.** Two predicates asked the local mirror whether the tab had content
(`messages.length > 0`) instead of asking Hermes whether the session still exists. With the
transcript cache stripped those are always false, so a catalog settle no longer kept the tab's link
and `resumeOrAdopt` had nothing to resume.

**What changed (all five steps, done).**

1. `messageCount` and `agentEngaged` are gone from the tab record (`SessionInfo`), so `sessions.json`
   holds ids, titles and view flags only. `markAgentEngaged` / `backfillAgentEngaged` / `markEngaged`
   were deleted with them.
2. One predicate replaces both: `Sessions.activeIsLinked()` — the tab has a `hermesSessionId` **and**
   the catalog row for it exists. `applyCatalogRows` now takes `activeLinked`; `resumeOrAdopt` and
   its adopt branch use the same method, and a pointer at a session Hermes no longer lists is logged
   and not resumed.
3. `restoreMessages` stays: it repaints from the in-memory transcript after a reconnect or profile
   switch and reads no file. `handleHistoryReplay` no longer writes a count back into the catalog.
4. `AcpClient.onReplayProgress(received, total)` fires from `_collectReplayUpdate` on a throttle
   (`replayProgress.ts`: every 25 rows, plus the first). Rows are counted **excluding
   `role === 'thought'`** — Hermes keeps reasoning on the assistant row, so raw replay rows overshoot
   `message_count`. `total` comes from the catalog row, passed as `loadSession(cwd, id, total)`; the
   host posts `{type:'loadProgress'}` and the pane shows "Loading conversation… n of m" while
   connecting. Display only: the gate is `session/load` resolving.
5. Tests: 208 passing (was 205), `check` and `check:pane` clean, deploy verified 218/218 for both
   extensions.

**Where the count lives now.** `Sessions.catalogRows` (in memory, refreshed by `applyCatalog`) for
display; `sessions.json` for ids and titles. Nothing content-shaped is persisted.

**The loading block (added after activation).** While `connecting`, the pane shows its own identity's
icon (`media/icon_fullcolor.png` for the primary, `media/icon_orange.svg` for the secondant, wired
through `{{LOADING_ICON_URI}}` in `html.ts`), the status as a 15 px bold heading, and a counter. It
replaces the italic placeholder and is hidden again by the first non-connecting status.

The counter says **"Message chunks: n"** and counts every content chunk the replay sends — thoughts
included, a tool call's two updates counted twice. That is honest to the word, and it is why there is
no "of m": Hermes' `message_count` counts DB rows the pane never renders (~98 empty-content assistant
rows in session `9f02b95d`), so a denominator would report a finished load as incomplete. `received`
is display only; the gate stays `session/load` resolving. `countsTowardMessageCount` still exists, but
only for the one comparison against `message_count` (the disagreement log line), never for display.

**The history viewer's three states.** It fetches now, so an empty list at open means "not yet". The
block shows from `surfaceRole: viewer` (no counter — an export is one call); an empty `restoreHistory`
leaves it alone; `historyFetchEmpty` gives the neutral line and `historyFetchFailed` the honest one,
with the reason on the tooltip and in the log. `historyViewerUnavailable` is retired, and
`loadRemote` throws instead of returning `[]`, which is what made a failed fetch look like an empty
conversation.

**Left to prove (needs a window reload, so it is his to trigger).** Reload with
`HERMES_ACP_TRACE=1` in the editor's environment: the secondant's tab should keep its session,
the loading block should climb from 0, and `~/.hermes/pane-mail/trace-<profile>.ndjson` should gain
`session/load` replay lines on that reload. The block itself was exercised outside the editor
(pane harness: connecting → 0, progress → 431/732, ready → hidden, error → placeholder back,
reconnect → 0 again); see the skill's `restore-replay-and-cache.md`.
