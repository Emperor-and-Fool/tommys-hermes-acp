# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-10-27

What the transcript does while the agent is working, and a filter on what a
history attach may carry.

### Added

- **Role filter on the history attach bar**: User, Assistant, Thought and Tool decide which messages offer a tick. User and Assistant start on; Thought and Tool are opt-in, because they carry the most text for the least answer. Turning a role off drops the ticks it no longer allows
- **Re-render** beside the filter: the filter is applied when a card is built, so an explicit re-render is what applies a change to the transcript already on screen
- A steer replays as its sentence with a **Steer** tag, instead of the delivery wrapper it was sent in

### Changed

- **Thought and tool cards stay open while the agent writes** and squash to their five- and three-line caps when the run ends, rather than being capped from the first chunk
- A run ends with the transcript at its bottom, after the final markdown pass and the collapsing cards have settled
- The id lookup matches a steered message by its sentence, so history slices still point at exact messages
- Every webview asset URL carries its file's mtime, so a rebuilt bundle cannot be served from cache under an unchanged address

### Fixed

- The history card had no height cap: it rendered at full length and its toggles changed nothing. It now takes the thought card's five-line cap and only shows "Show more" when the body overflows
- The input mode after a run was set twice, once from a flag that had not been updated yet

### Repository

- The local ACP patch is tracked under `packaging/hermes-patches`
- Dead code removed: the unused finished-tool glyph test, and a state write that went to the card instead of the pane

## [1.0.0] - 2026-10-27

The baseline: `src/` split by runtime, session memory, approvals, steer.

### Added

- **Session memory**: pick another conversation from the composer, read it read-only in one temporary tab, tick up to fifteen messages, and send them as a quoted block above the question. The pick belongs to the tab it was staged in
- **Approval mode** on every pending permission card: Manual · Smart · Off, written through `hermes config set approvals.mode` for the active profile
- **Steer**: text in the composer turns Stop into Steer and goes into the running turn, and the steer's own reply line is kept out of the assistant's answer

### Changed

- `src/` divided by runtime — `host/`, `pane/`, `shared/` — with the webview bundled by esbuild
- Both directions of the webview protocol are typed unions in `src/shared/webview.ts`
- The model and session-memory pickers trade places while the agent works

### Removed

- The old current-tab context attach, its messages, its setting and its tests
- Both pre-split monoliths, `chat.js.old` and `HermesChatProvider.ts.old`

## [0.4.0] - 2026-10-21

First build under the fork's own name, on top of upstream 0.3.2.

### Added

- Hermes sessions adopted as tabs, with their history replayed into the panel
- An editor-panel surface beside the side bar
- Image paste and image-only send; light-theme readability and the font-size pill
- Activity-bar container entitled "Tommys Dev Chat", with the whale glyph

### Changed

- Re-identified as Tommys Hermes ACP: name, GPL-3.0-or-later, links, issue templates
- The setting namespace corrected to `tommys.*`

### Fixed

- Tabs were being re-sessioned on every switch; the composer row and the card labels were repaired

## [0.3.2] - 2026-06-22

### Added

- **Hermes initialization hint**: If a prompt produces no output for 25 seconds, the status bar shows that Hermes is still initializing (first reply may take 1–3 minutes)

### Fixed

- **Connection stuck on Connecting… / Connection error**: Stream output is accepted as soon as prompting starts; superseded or cancelled prompts no longer leave the client in a blocked state
- **Cross-session stream bleed**: Session updates whose `sessionId` does not match the active session are ignored
- **Content parsing**: Assistant and thought chunks use `extractTextFromContentBlock` for more robust text extraction from ACP content blocks

## [0.3.1] - 2026-06-22

### Added

- **Environment detection** (view title **Environment** menu): Layered Hermes discovery (L0–L5), version verification, and compact **percentage progress** in the chat toolbar with expandable step details
- **ACP readiness check**: After Hermes is found, runs `hermes acp --check`; on failure, attempts `pip install agent-client-protocol==0.9.0` and re-checks
- **Environment configuration** (wrench menu): Configure Hermes to extension settings or system PATH; always available even when already configured
- **Smart detection trigger**: Skips full detection on connect when Hermes is already configured in the extension or on system PATH and passes quick verification (including ACP)
- **Cancel detection**: Closing the progress bar aborts an in-progress environment scan

### Fixed

- **Cursor — Settings**: **More → Settings** now opens the VS Code Settings UI filtered to this extension (instead of `settings.json`, which often did nothing visible in Cursor)
- Windows user PATH writes no longer corrupt paths due to JSON/PowerShell escaping
- Detection summary and detail titles reflect completion state; completed steps show success icons instead of spinners

## [0.3.0] - 2026-06-21

### Added

- **Session memory attach**: After an agent reset (model or session switch), optionally attach prior messages as reference text to the next send — last 2, last 10, all, or custom selection with preview and token estimate
- **`hermes.contextAttachVisibility` setting**: Control when the memory picker appears — `onNewSession` (default) / `always` / `never`
- **FAQ modal** (More → FAQ): Covers session reset behavior, model/session switching, Profile changes, model list completeness, updates, and bug reporting
- **Session reset divider** in chat UI marking messages restored from local history (view-only, not carried into agent context)
- **Session switch confirmation** when switching tabs during an active reply
- Unit tests for `contextAttach` module

### Fixed

- Model list falls back to cached ACP options when a fresh fetch returns empty

## [0.2.6] - 2026-06-21

### Added

- Auto-discover Hermes profiles via `hermes profile list` when `hermes.agents` is not configured
- Profile-isolated local session history and model preference storage (`profileStorage`)
- Hermes profile CLI arguments, ACP model catalog parsing, and grouped display (`acpModelCatalog`, `hermesProfile`, `profileDiscovery`)

### Fixed

- When selecting the **Default** profile, explicitly pass `--profile default` instead of launching `hermes acp` without a profile argument (which previously followed Hermes' globally active profile and caused incorrect default model display)
- Model list is now fetched **only via ACP**: prefer Hermes `model.options`, fall back to session `models.availableModels`; no longer reads `config.yaml`
- Model dropdown displays models grouped by provider; the selected model aligns with the profile default model returned by ACP
- On reconnect and retry, preserve the current profile in the chat UI instead of relying solely on workspace settings

## [0.2.5] - 2026-06-21

### Added

- **In-chat permission approval**: Show permission request cards in the WebView (replacing `showWarningMessage`), with approve/deny and session-level/permanent options; details collapsed by default, expandable when exceeding three lines
- **Approval history persistence**: Permission cards are written to session message history for read-only recovery after refresh or session switch
- **MCP config forwarding**: Read MCP servers from `~/.cursor/mcp.json` and workspace `.cursor` / `.vscode` `mcp.json`, passed to Hermes on `session/new`
- **Smart scroll during streaming**: Follow to bottom by default; pause when the user scrolls manually, resume after 5 seconds of inactivity while still streaming
- **TOKEN ring percentage**: Display current token usage percentage in the center of the ring
- Permission options i18n (`permissionOptions.ts`) and unit tests for `mcpConfig` / `permissionOptions`
- Integration test script `scripts/test-session-new.mjs`

### Fixed

- After approval or tool calls, subsequent assistant replies no longer incorrectly append to old bubbles but start a new message segment
- `allow_session` option no longer incorrectly displays as "Always allow" (`optionId` takes priority over `kind` mapping)

[1.1.0]: https://github.com/Emperor-and-Fool/tommys-hermes-acp/releases/tag/v1.1.0
[1.0.0]: https://github.com/Emperor-and-Fool/tommys-hermes-acp/releases/tag/v1.0.0
[0.4.0]: https://github.com/Emperor-and-Fool/tommys-hermes-acp/commits/main
[0.3.2]: https://github.com/jove-rina/rina-hermes-acp/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/jove-rina/rina-hermes-acp/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/jove-rina/rina-hermes-acp/compare/v0.2.6...v0.3.0
[0.2.6]: https://github.com/jove-rina/rina-hermes-acp/compare/v0.2.5...v0.2.6
[0.2.5]: https://github.com/jove-rina/rina-hermes-acp/compare/v0.2.2...v0.2.5
