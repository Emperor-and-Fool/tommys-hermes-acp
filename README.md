<div align="center">

<img src="media/icon.png" alt="Tommys Hermes ACP icon" width="128" />

# Tommys Hermes ACP

**Hermes in your editor, with the three moves you won't find in most agent clients:
steer a run while it is running, pull context out of any of your other conversations,
and run a second independent agent beside the first.**

</div>

---

## What this is

A VS Code / VSCodium extension that runs your local
[Hermes Agent](https://hermes-agent.nousresearch.com) inside the editor. It spawns
`hermes acp --profile <profile>` and speaks the
[Agent Client Protocol](https://agentclientprotocol.com) over stdio, so the agent you
already trust is the one doing the work — the extension is the client, not another model.

Most agent clients give you one chat, one turn at a time, and one way to react when the
agent goes sideways: cancel and start over.

## Two agents in one window

Install the companion from the primary — **Install secondant** — and a second, independent
agent appears in the same editor: its own extension id, its own sidebar, its own tabs, its
own Hermes profile. One install for you, two extensions on disk, nothing to configure twice.

- **They cannot share a profile.** Pointed at the profile the primary is using, the
  secondant drops its connection, opens its picker and says why. Two agents means two
  profiles, enforced rather than hoped for.
- **You can tell them apart at a glance.** The secondant carries an orange rule across its
  toolbar and a badge row beneath it; in the editor-panel surface each pane's frame is
  drawn in its own accent.
- **They can hand each other work.** Forward any message from one pane to the other: it
  arrives as a card with a sender pill and its body rendered as markdown, and nothing
  reaches the receiving agent until you press **Deliver**. Consecutive forwards stack under
  one rail with a single Deliver / Dismiss, sent as one turn in arrival order.
- **Session memory crosses too.** Forward a slice of any conversation and the receiving
  agent gets the session handle, an anchor when no message ids matched, and a note that the
  handle reads outside its own profile — along with the call that reads more of it.

The channel is a file under your Hermes home. No service, no port, no network: it carries
your own messages under your own permissions, and you sit in the middle of every hop.

## Steer a run while it runs

With a turn in flight, type into the composer and **Stop becomes Steer**. Your words go
into the turn — not as a new question, not as cancel-and-retry — as guidance the agent
folds into what it is already doing. The transcript marks it with an orange **Steer** tag
that survives reload. The turn keeps its identity, its tool calls, its context.

It is the one workflow difference you will feel every day.

> **Roadmap:** time-limited auto-approve while a steered turn runs, so you can say
> "go ahead with the next three" without clicking a card for each one.

## Pull context from another conversation

Pick any of your other sessions from the composer, read it in a throwaway tab, tick the
messages you want, and they arrive above your prompt as a quoted, attributed block.

- **Anchored, not pasted** — the block points at message ids, so the quote stays faithful
  even after the source conversation moves on.
- **Every session Hermes knows** — the viewer reads from Hermes rather than from a local
  copy, so a conversation you had in the TUI, the dashboard or the other pane opens the
  same as one from this tab.
- **A pick belongs to its tab** — context you staged for one thread cannot leak into
  another. The current session is also offered: after a model switch the agent has lost
  its context, and this tab's own earlier messages are exactly the memory worth
  re-attaching.
- **Choose the depth** — a role filter on the attach bar lets you toggle User, Assistant,
  Thought and Tool messages, so you can carry a question and its answer without dragging
  forty tool calls along, or include the reasoning when you need it.

## The rest of the client

Sidebar or editor pane, your choice · tabs with rename and reopen · streaming markdown
with syntax highlighting · image paste and image-only prompts · `@` file mentions ·
send the editor selection as a prompt · transcript search, in the chat and in the viewer ·
multi-select copy, delete and export · session export as markdown · token meter · log
viewer · environment detection that finds a Hermes install and repairs `PATH` itself ·
English and Simplified Chinese throughout, including Hermes' own permission wording.

## Quieter touches

- **Approvals carry their own mode switch** — Manual · Smart · Off on the pending card,
  written through to the profile and applied to every other waiting card.
- **The agent's structured questions render as forms**, not as dead prompts.
- **Consecutive tool calls fold into one card**, so a dozen reads do not bury the answer.
- **Thoughts and tool cards grow with the text while live**, then collapse to a readable
  cap when the turn finishes — so you can follow reasoning as it arrives without it
  pushing the answer off-screen afterwards.
- **Loading looks deliberate** — the pane's own icon, pulsing, with a live count of the
  chunks arriving from Hermes beneath it.
- **A message Hermes never received is caught** — the last few user turns live in a small
  sidecar, and the agent's replay is checked against it before the transcript is replaced.

## Who this is for

Not people shopping for an AI assistant in the abstract. People who have already chosen
Hermes, work across more than one conversation at a time, and want the
editing-while-it-runs rhythm that most clients make you fight for.

## Requirements

- VS Code 1.85+ or VSCodium (this is developed against VSCodium)
- [Hermes Agent](https://hermes-agent.nousresearch.com) installed and configured
- `hermes` on `PATH`, or `tommys.path` set in settings
- For the secondant: a **second Hermes profile**, because the two panes may not share one

## Build and install

```bash
npm install
npm run package                                     # compile + bundle the pane + vsix
codium --install-extension ./tommys-hermes-acp-2.0.0.vsix --force
```

`npm run package` bundles the secondant VSIX inside the primary. `npm run package:secondant`
builds that companion on its own; users never need it, because the primary installs it from a
command.

`npm run deploy` is the fast path while developing: it compiles, rebuilds the pane bundle
and copies everything into the installed extension directory, verifying each file by hash.

Extension ids: `emperorandfool.tommys-hermes-acp` and
`emperorandfool.tommys-hermes-secondant`.

## Use

1. Click the **Tommys Dev Chat** icon in the activity bar, or run **Hermes: Open Chat**.
2. Wait for status **Ready**, then type. **Enter** sends, **Shift+Enter** adds a line.
3. `@` references a workspace file; clicking a path in a reply opens it in the editor.
4. **+ New** starts a conversation; each tab keeps its own transcript.
5. To steer, keep typing while a turn runs — the button tells you what it will do.
6. For a second agent, run **Install secondant** from the command palette. It appears as a
   second activity-bar container with its own orange accent. **Uninstall secondant** takes
   it out again, version directories included.

> Opening a tab for a session Hermes knows resumes it over ACP (`session/load`), and the
> transcript arrives from Hermes itself — nothing is read back from a local copy.

## Settings

| Setting | Description | Default |
|---|---|---|
| `tommys.path` | Path to the Hermes executable | auto-detect |
| `tommys.cwd` | Working directory for sessions | workspace root |
| `tommys.profile` | Hermes profile name | `default` |
| `tommys.showThoughts` | Show agent reasoning | `true` |
| `tommys.showToolCalls` | Show tool-call notifications | `true` |
| `tommys.chatSurface` | `sidebar` or `editor` | `sidebar` |
| `tommys.models` | Fallback model list | `[]` |
| `tommys.defaultModel` | Default model id (fallback list only) | `""` |
| `tommys.agents` | Named agent configurations | `[]` |

The secondant exposes the same keys under `tommys2.*`.

```json
"tommys.agents": [
  { "name": "Default", "profile": "" },
  { "name": "Fast", "path": "/path/to/hermes", "profile": "fast" }
]
```

The composer's `Aa` pill sets the transcript font size (10–28 px) and remembers it.

## Troubleshooting

| Symptom | What to try |
|---|---|
| Stuck on **Connecting…** | Environment menu → detection; ensure `hermes` is on `PATH` or set `tommys.path` |
| **ACP dependencies missing** | Run `hermes acp --check` in a terminal |
| No reply on the first message | Normal — Hermes may load plugins on the first turn |
| Model not listed | Add entries under `tommys.models` |
| An activity-bar icon is missing after an upgrade | Hide, then show the container from the activity-bar context menu |
| Secondant disconnected itself | It is on the primary's profile. Pick another from its profile dropdown |
| Secondant installed but not visible | Reload the window; the registry only lists it after a reload |
| Forward button greyed out | The other pane is not running — the two panes announce themselves with a heartbeat |
| Need to see what Hermes sends over ACP | Launch the editor with `HERMES_ACP_TRACE=1`; each `session/update` goes to the OutputChannel and to `~/.hermes/pane-mail/trace-<profile>.ndjson` |

## Known issues

- **Approval-mode switch** — the Manual · Smart · Off toggle on permission cards exists
  but has not been tested end-to-end. It may not write through to the profile correctly.
- **Thought segment heuristic** — the pane uses a prefix test to decide whether a thought
  chunk continues the current card or starts a new one. If a genuinely new segment opens
  with the same text as the end of the previous one, it is treated as a continuation.
  Cannot be fixed without the host marking segment boundaries. Very rare in practice.
- **Anchor quotes are truncated** — a forwarded session slice whose message ids did not
  match is anchored on its opening words, clipped at a fixed length. A prefix search finds
  them; a strict search for the whole quote will not.
- **Long transcripts are not virtualised** — every message in a tab is a live DOM node. Fine
  for ordinary sessions, slow on transcripts of several thousand messages.

## FAQ

**Will this be maintained?** The code is split by runtime — `src/host` (VS Code, filesystem,
CLI, ACP), `src/pane` (the webview), `src/shared` (the message contract) — with both
directions of the protocol typed as unions, so a message added on one side fails to compile
on the other. The test suite covers the host side; the pane is bundled by esbuild.

**Is this the upstream project?** No. This project originated from
[Rina Hermes ACP](https://github.com/jove-rina/rina-hermes-acp) (MIT, © 2026 jove-rina)
and continues independently under its own extension identity. It is not endorsed by
upstream. Provenance is in [`NOTICE`](NOTICE).

**Does it work with plain VS Code?** Yes, 1.85 or newer. VSCodium is what it is developed
against.

**What did 2.0 actually change?** Two things that only make sense together. The extension
gained a second, independent agent beside the first, and lost the local copy of the
conversation it had been keeping since the fork. The transcript now comes from Hermes, with
a five-message sidecar for the one case Hermes cannot cover: a message you sent that the
agent never received. See [`CHANGELOG.md`](CHANGELOG.md).

**How far is this from the upstream?** v1.0.0 started with image paste, theming fixes
and a font-size pill on top of upstream 0.3.2. Since then the codebase has been restructured
into host/pane/shared runtimes, the protocol is fully typed, and the features above — the
secondant, pane mail, steer, history attach with role filter, live card sizing, transcript
reconciliation, approval mode switching, elicitation forms, environment detection, i18n —
are all new work. The upstream MIT notice is retained in full; see Licence below.

**Roadmap**

- **Time-limited approve-all** — approve the next N tool calls or approve for the next M
  minutes, so a steered turn doesn't need a click for every step.
- **Virtualised transcripts** — render a window of messages rather than all of them, so a
  session with thousands of turns scrolls as smoothly as a short one.
- **An agent-callable forward** — let an agent propose something for the other pane, with
  the same Deliver gate in front of it.
- **Hermes upstream PR** — contribute the ACP session catalog, hidden and title methods
  back to Hermes as a proper pull request.

## Licence and attribution

**This project is distributed under GPL-3.0-or-later**, © 2026 Emperor & Fool — full text in
[`LICENSE`](LICENSE). It originated from Rina Hermes ACP, received under the **MIT**
licence, © 2026 jove-rina; that notice is retained verbatim in
[`LICENSES/MIT-jove-rina.txt`](LICENSES/MIT-jove-rina.txt) as MIT requires, and the upstream
code remains available from upstream under MIT. The full split, the upstream commits this
fork is based on, and the bundled third-party licences are in [`NOTICE`](NOTICE) and
[`packaging/copyright`](packaging/copyright).

Because this is a GPL work: the complete source for every distributed build is this
repository, and anyone redistributing a modified version must do so under the same licence.

Bundled components keep their own licences: `@agentclientprotocol/sdk` and
`media/vendor/purify.min.js` (DOMPurify) Apache-2.0; `media/vendor/highlight.min.js` and
`github-dark.min.css` (highlight.js) BSD-3-Clause; `media/vendor/marked.min.js` MIT.

Neither MIT nor the GPL grant trademark rights: the upstream name "Rina Hermes ACP", the
`jove-rina` name and the upstream marketplace identity are not used by this project. The
icon and activity-bar glyph under `media/` are inherited upstream artwork — redistributable,
but they are not Emperor & Fool branding.
