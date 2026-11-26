# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [2.6.3] - 2026-11-26

The store pages catch up with the README. A marketplace listing only takes new text with a new
version, so the rewritten README — and the tray it describes — ship in one release.

### Changed

- **The README is rewritten for the store pages**, with a new screenshot: what the extension does,
  how to start, and where the dashboard and the second chat fit, in fewer words.
- **The tray menu entries are named after what they install**: **Install Dashboard** and
  **Uninstall Dashboard**, in English and Simplified Chinese. The command ids and behaviour are
  unchanged — only the labels, which still said "Hermes systray app" and "Desktop GUI".

### Fixed

- **The highlight.js light theme is listed** in [`packaging/copyright`](packaging/copyright) beside
  the dark one; `media/vendor/github-light.min.css` ships and is used for light editor themes.
- **The README's links to `NOTICE`, `CHANGELOG.md`, `LICENSE`, `LICENSES/MIT-jove-rina.txt` and
  `packaging/copyright` were absolute and broken**; they are relative now.

## [2.6.2] - 2026-11-25

The patch a Hermes update can break is now the extension's business: it reads the checkout, says when
Hermes changed under it, and fixes the set in one click.

### New

- **The window checks the ACP patch set when it connects**, and after an update it says so: *Hermes was
  updated from X to Y* with **Test patch**. The answer is one of four — the right set is in place,
  it is missing, the wrong set is in its place, or it cannot be decided — and only the two fixable
  ones offer **Patch**, which reverses the patches that do not belong and applies the one that does.
- **The catalog notice gained the same Patch button**: a Hermes that stops answering the catalog
  without a version change is the same failure, and the notice is where it is seen.
- **The approval note is read from the line Hermes already sends** (`- **approval:** …`), so no local
  lines in `acp_adapter/tools.py` are needed for it. The tagged-block path stays for a Hermes that
  sends the note as its own block.

### Fixed

- **One fixer.** The secondant no longer reads the patch state, shows the dialog or offers the button,
  and the fix re-reads the checkout under a lock in the data home — two windows can no longer act on
  the same stale picture and leave the machine with no patch at all.
- **Nothing is staged.** Applying uses `git apply` without `--3way`, which implied `--index` and left
  the patch staged in Hermes' own index.
- **The clean check looks only at the files the patch set touches**, read from the patch files' own
  headers; an edit elsewhere in `acp_adapter/` is reported in the output channel and kept.

### Repository

- `environment/patchState.ts` (the state rules and the fix), `patches/patchSetup.ts` (the dialog, the
  lock, the version memory), `store/paths.ts` gains `patchVersionPathFor` and `patchLockPathFor`.
- Tests: 712 → 716 passing; `app.ts` 1466 → 1470.

## [2.6.1] - 2026-11-24

The Windows round. A Hermes 0.23 install shows its sessions again — the patch that answers the
catalog ships with the extension — and a catalog Hermes does not answer says so instead of looking
empty. The tray app that puts the dashboard one click away now installs on Windows too.

### Windows

- **The tray app installs on Windows the way it does on Linux: from our own sources.** No prebuilt
  binary and no download route: the same `extras/KDEdesktopGui` runs here, with a venv of our own at
  `%LOCALAPPDATA%\hermesdesktopgui\venv` built from Hermes' Python with Hermes' `uv` (`PyQt6 6.12.1`,
  `PyQt6-WebEngine 6.140.1`; about 220 MB), and a venv whose base Python left with a Hermes update is
  rebuilt. The installer owns the same three screens on both platforms.
- **Nothing about the Qt bindings is silent any more.** The installer imports PyQt6 at import time,
  so on a machine without it the menu used to open nothing at all. The menu now checks first — the
  two apt packages on Linux (`pkexec apt-get install -y` when missing), the venv on Windows — behind
  one notification, with the full output in the **Hermes systray** channel. A window that dies is
  reported with its exit code and the last lines of its stderr.
- **The dashboard starts at login, once and only when it is missing, on both platforms.** Linux: a
  `hermes-dashboard.service` in the user's own unit folder, in the shape of a hand-written one
  (`--no-open`, port 9119, `graphical-session.target`) and marked as ours. Windows: two Startup
  shortcuts — the app, and a hidden `hermes dashboard --no-open`. Uninstall removes only a unit
  carrying that marker and only those two `.lnk` files; a unit you wrote yourself is left byte for
  byte.
- **Hermes' Electron Desktop is not the extension's business any more.** No build step, no
  start-in-tray question, no menu entries for it. A machine that answered the 2.6.1-eve question has
  that one shortcut and the copied launcher scripts removed at the next start, and nothing else.

### New

- **A status-bar item for the agent and its budget.** Bottom right: the agent of the pane you are
  talking to, whether it is connected, and what the DeepSeek balance is — *$(dashboard) dev-vsc ·
  $58.93* — with a $(flame)/$(moon) badge for DeepSeek's peak hours in the tooltip. It refreshes on
  a click, on an agent switch, and once a minute. The secondant has no item of its own; it reports
  through the primary's.
- **The item turns red when the provider cannot be reached**, whichever call found out — a failed
  turn or a failed balance read — with Hermes' own message in the tooltip.
- **The tray app runs on Windows too**, from these sources and the same installer (*Windows*, below).

### Fixed

- **A send whose session Hermes would not resume is no longer swallowed.** The typed text goes back
  into the composer, and the notice names Hermes' own reason.
- **A session catalog Hermes does not answer is said out loud**, once per connect, naming the patch
  the installed version needs and where the patches are, instead of leaving the window with no
  sessions and no explanation. While it is unanswered, no tab loses its link.
- **A pane rebuilt mid-turn shows its open permission card again**, instead of an empty space where
  the question was.
- **The test suite is green again**: seven failures that predated 2.6.0 (locale leakage between
  tests, three stale inputs and assertions) are fixed at their causes.

### Windows

- **Hermes 0.23 needs its own patch, and it ships in the VSIX.** `0003` answers
  `_session/catalog`, `_session/setHidden` and `_session/setTitle` from Hermes 0.23's own store; the
  README's table says which set each Hermes version needs (0.22.2–0.22.4: `0001`; 0.22.5–0.22.x:
  `0001` + `0002`; 0.23.x: `0003`, alone — remove the 0.22 set first). The patches are inside both
  VSIXes under `packaging/hermes-patches/`, so an installed extension always carries its own copy.

### Repository

- New: `host/desktop/` (the store, and the one migration that removes what the 2.6.1-eve build
  left), `environment/trayPreflight.ts` (the Qt bindings and the venv, checked before the installer
  window opens), `environment/startupShortcut.ts` (where Windows' Startup folder is),
  `environment/dashboardUnit.ts` (the Linux dashboard unit), `packaging/windows/` with
  `Set-HermesTrayShortcut.ps1` (one named shortcut, written or removed), and
  `extras/KDEdesktopGui/test_installer.py` (the installer's rules as Python tests).
- Removed with Hermes' Desktop: `environment/desktopBuild.ts`, `environment/desktopTray.ts`,
  `host/desktop/desktop.ts`, `host/desktop/tray.ts`, `environment/childEnv.ts`,
  `editor/progress.ts`, `packaging/windows/Start-HermesInTray.ps1` and `.vbs` — and, with the
  download route, `environment/trayApp.ts` and `environment/dashboard.ts`.
- The catalog read answers `{ answered: true, sessions }` or `{ answered: false, reason }`, so an
  unanswered catalog cannot be mistaken for an empty one by a `?? []`.
- Tests: 653 → 687 passing; `app.ts` 1470 → 1444.

## [2.6.0] - 2026-11-23

Every agent now has a home for what it needs to keep: a notes folder of its own, beside its session
tabs, with an index in it. The user reads along through a mirror of links in their own vault, and
each agent's memory cap is shown and raised from the ⋯ menu — by Hermes' own CLI, on a click.

### What changed along the way

| First | Later | Why |
|---|---|---|
| Notes an agent wanted to keep went into its memory, which Hermes caps at 2200 characters. | Each agent has `profiles/<uuid>/notes/`, one level under the folder that holds its sessions, with an index that lists what is there. | What only the agent needs stays out of the memory, so the memory stays small. |
| Where that memory ended was written by hand into each agent's `MEMORY.md`, and nothing told the agent where its notes are. | The repeating notice names the notes folder and its index, and asks once for a protected section in `MEMORY.md` that holds the pointer. | A pointer the software never mentions rots; a section the user controls survives the agent's own judgement. |
| A turn's blocks were composed in `app.ts`, the tree's agent from the project feature and its tabs from the session feature. | The blocks are composed in the turn's own runner, and the tree reads its agent and its tabs from one owner. | During a profile change the two disagreed for a moment, and the tree file was written under the wrong agent. |
| The memory cap was invisible: 2200 characters, and raising it meant editing `config.yaml`. | The ⋯ agent group shows what `MEMORY.md` holds against the limit, and raises it through `hermes config set`. | The cap costs tokens in every session of that agent; the user decides that, with the numbers in front of them. |

### Added

- **An agent's notes folder.** Every agent has a `notes/` folder beside its session tabs, and an
  index (`00 Index.md`) that names the agent and lists the files there, rewritten when they change.
  The notice sent with every session names the folder and the index. The material that older memory
  entries pointed at is moved in by hand, once.
- **A protected section in the agent's memory.** While an agent's `MEMORY.md` has no section opening
  with `== Protected section` and naming its notes folder, the notice asks once for it: the agent
  creates it, or renames the markers of the one it has and adds the `Notes:` line. The extension never
  writes a Hermes file; it reads the memory to know whether the ask is still needed. The section is
  the agent's one place the user controls: the agent may not change it on its own.
- **The notes mirror.** Set up a folder `PAs - AgentsProfileInfo` in a location you choose — an
  Obsidian vault, your Documents folder, or any folder — with one link per agent, named after the
  agent, pointing at its notes. Symlinks on Linux and macOS, junctions on Windows. The ⋯ menu opens
  the current agent's notes in your file manager, sets the mirror up, repairs it, and changes its
  location; a repair recreates a missing link, renames a renamed agent's link, and reports a link
  whose target is gone. A real file or folder in the mirror with an agent's name is never touched.
- **A first-run question, once per install:** *Your agents have their own notes. Mirror them where
  you can read along? Obsidian is recommended.* **Let's do it** runs the setup; **Remind me in 2
  weeks** asks again then; **Don't ask again** settles it. Closing the notice writes nothing, so it is
  asked again at the next start. Both extensions share the answer, so it is asked once.
- **"Agent memory size…" in the ⋯ agent group.** For the current agent it shows its name, what
  `MEMORY.md` holds and the limit it is under — *kitt — memory 2,210 / 2,200 (100%)*. Three answers:
  **Recommended: 4,400** (twice Hermes' default, offered while the agent is under it), **Keep**
  (nothing is written), or a number of your own, never below what the file already holds; lowering
  the limit asks once more. The cost is said before it is applied: *About +800 tokens in every
  session of kitt.* The write is Hermes' own — `hermes -p <agent> config set
  memory.memory_char_limit <n>` — and its answer, error included, is what the notice shows. `USER.md`
  has its own limit and it is not touched.

### Changed

- **The ⋯ menu leads with the agent group:** open notes location, set up or repair the mirror, change
  its location, agent memory size.
- **The notice that opens every session** names the notes folder and its index, and, while the
  protected section is missing, how to write it. It closes with one line: *Repeats each session;
  don't save to memory.*

### Fixed

- **Tree files were written under the wrong agent's folder** while a profile change was landing: the
  tree took the agent from one feature and the tabs from another, and in the moment between them they
  disagreed.
- **The name in a tree file now comes from the id the file is written under**, so a renamed agent no
  longer leaves its old name in a file that describes another.

### Removed

- **The `tommys.agents` setting.** A hand-written agent list that switched Hermes' own profile
  discovery off; `profiles.json`, filled by discovery, already does that job, and the setting was
  the one place an agent's folder was not `profiles/<uuid>/`. Nothing set it. Agents configured
  through it are gone; use the Profile picker, which lists what Hermes has.

### Repository

- The blocks a turn sends are composed in the turn's runner, in one order (history, tree and notes,
  the user's text, images) instead of in `app.ts`, and the tree's agent and tabs come from one owner.
- The notes feature is four files under `host/notes/` (the notes themselves, the store, the mirror,
  the memory dialog) with one port in the composition root; `environment/` reads Hermes' memory and
  config and runs the one CLI call.
- `app.ts` did not grow across the six orders that built this: 1507 lines at the first order, 1470 at
  the last.
- Tests the removed agent list had left behind now read the profiles Hermes discovers, and the new
  work is covered as it was written: the tree's scope, the prompt blocks, the notes and their index,
  the mirror's links and refusals, the protected section's detection, and the memory dialog's rows.

## [2.5.1] - 2026-11-22

### What changed along the way

| First | Later | Why |
|---|---|---|
| The active tab's project was the only thing the tree knew: a new chat opened in it, and every project was open after a start. | The tree has an active project — a project, or none — that you choose, and at most two projects are open. | A new chat could not be opened outside a project, and the tree opened fully on every start. |
| The agent last picked in any window was the one every window started on. | Each workspace and pane remembers its own agent, saved on every connect. A start takes that agent, then the configured agent, then the first agent no other window runs. | A reload could start a window on another window's agent, which the agent guard then refused. |

### Added

- **An active project.** Click a project header to make it the project a new chat opens in; click the
  empty space of the tab list to choose none. The active project is outlined and shaded.
- **The project holding the chat on screen stays outlined**, also when it is folded, so the chat is
  never hidden behind a closed project.
- **At most two projects are open:** the active project and the one before it. Having no active
  project counts as one of the two.
- **Ctrl-click a project header** to open or fold it without choosing it — a quick look across several
  projects, undone by the next normal click.
- **A reload brings the tree back as you left it:** the active project and the one before it, per
  workspace and agent.

### Changed

- **A click on a project header chooses it; a click on the active project folds it.**
- **Each window starts on its own agent.** The agent is remembered per workspace and pane, and saved
  whenever a connect lands. Before, only a switch saved it: a window that started and stayed was
  never remembered, and the secondant had no memory at all. The start takes this workspace's agent,
  then the configured agent (`tommys.profile`, `default` when unset), then the first agent no other
  window runs. The last pick made in any window is no longer a start.
- **A refused agent names its holder:** the primary or the secondant, in this window or another one.

### Fixed

- **A new chat in a window without tabs could not be sent** ("No chat is open…" on every send).
- **A new chat could not be opened outside a project.**
- **A reload could land on another window's agent**, which the guard then refused.
- **A window's own row from before a reload read as another window running its agent** for the 45
  seconds a presence row stays believable, so the start skipped the window's own pick.
- **A failed turn showed only "Internal error".** It now adds Hermes' reason, for example a missing
  API key.

### Repository

- One setter for the active tab; the tab restore at start and on a profile rebind is quiet, so it
  does not overwrite the saved project pair
- Tree markup and rules in `pane/components/workspace/projectTree.ts`, DOM-free and tested as such
- The stored workspace row stays out of the shared `Workspace` contract (`publicWorkspace()`); the
  profile ports are required, so a missing wiring fails compilation instead of silently dropping the
  agent guard
- Presence id from workspace and role (`presenceInstanceId`), so a reload overwrites its own row;
  rows left by windows that are gone are swept at start, never while fresh
- One per-workspace row table per window, shared by the cwd and the project pair

## [2.5.0] - 2026-11-20

2.4.0 was skipped: this release collects two weeks of changes.

### What changed along the way

| First | Later | Why |
|---|---|---|
| One Hermes cwd per window: every Hermes session worked in the same workspace folder (17 Nov). | Each Hermes session keeps its own Hermes cwd, chosen from the workspace folders (19 Nov). | Two Hermes sessions (tabs) in one chat panel could not work in two different folders. |
| The row with the workspace folder settings opened at every start and every change of the workspace directories. | It opens at two moments: when an agent becomes active (its Hermes sessions appear with their message counts), and when the side panel comes into view after a workspace folder was added. | It interrupted at moments that meant nothing. |
| We built an "Allow for session" answer on the permission card ourselves (removed 16 Nov). | The card shows only Hermes' own answers. Flagged commands under Manual (and Smart, when it passes them to you) get "Allow for session": valid while the Hermes session is active, confirmed again when it's reactivated. File edits never show it (Hermes #29410). | Our version was a work-around that never met the expectation. |
| Clicking our chat tab in the editor switched the side panel with a general VS Code command. | Clicking our chat tab in the editor brings up that extension's own side panel, for the primary and the secondant, and keeps the focus in the editor. | The side panel's own documented call reaches both extensions reliably. |
| We expected a file reached through a symlink to be outside the Hermes cwd. | Hermes follows a symlink to the real file before it checks a file edit, so a file counts as inside or outside the Hermes cwd by where it really lives. | Tests of the permission modes now use files whose real location is outside the Hermes cwd. |
| Each extension had its own data home on top of the single agent guard. | Both extensions share one data home, centralizing projects, tabs and tags for every agent. | An improved agent guard prevents simultaneous agent use, even across multiple windows. |

### Added

- **Each Hermes session keeps its own Hermes cwd.** A workspace can hold several workspace folders;
  Hermes works in one. The row with the workspace folder settings marks it with a green chip, and a
  new Hermes session starts in the agent's default folder for that workspace.
- **A newly added workspace folder is marked.** Its chip flashes orange, with the word "New" in
  orange behind the folder name, for 30 seconds of viewing time shared by both extensions.
- **The row says what happened to the Hermes cwd.** A move Hermes refused (the Hermes cwd stays), a
  workspace folder missing on disk (shown, not choosable), the Hermes cwd's folder removed from the
  workspace.
- **The side panel follows the chat.** Opening the chat, sending a selection, or clicking our chat
  tab in the editor brings up that extension's side panel.
- **An improved agent guard.** An agent running in one window is not offered in another, and
  connecting to it is refused.
- **An agent keeps its projects, tabs, tags and images after a profile rename**, and a profile
  renamed outside the extension is found again.

### Changed

- **The permission card shows only what Hermes offers, and says why when it is about an edit.** The
  Manual/Smart/None/ALL switch no longer sits inside the card — the permission mode is a setting,
  and it has its own control in the toolbar. Edit cards carry one plain line naming the three things
  that can make an edit ask (the mode, the Hermes cwd, a protected file) and telling the reader which
  to change; the hint applies from the next run, as the permission mode does. Command cards get no
  hint.
- **The permission modes now govern edits as well as commands.** Manual asks for both; Smart and
  None run commands as before and free file edits inside the Hermes cwd, asking outside it; ALL frees
  edits everywhere and clears the deny rules. Sensitive files — `.git`, `.ssh`, `.env`, keys,
  instruction files — always ask, and no permission mode changes that. A change made while a run is
  in flight applies when that run ends instead of being lost, and each mode's tooltip now says what
  it does to commands and edits separately, replacing the one sentence that claimed None only asked
  about Hermes itself.
- **The control that shows the Hermes cwd opens and closes its row**, the same as ✕.
- **The active Hermes session (tab) is remembered per agent per workspace.**
- **A window with no workspace folder open does not start Hermes.**

### Improved

- **A new chat works with the permission mode you see, from its first request.**
- **After switching agents, the permission mode you see is the one in use.**
- **Developer: before converting data from an older layout**, the data home is copied to
  `<home>.backup-<yyyymmdd>`, and only one window converts at a time.
- **Developer, learned from Hermes:** `profile.yaml` is optional. For an agent Hermes starts,
  `HERMES_HOME` is that agent's own profile folder (`~/.hermes/profiles/<name>`). Hermes' home folder
  (`~/.hermes`: the application, the default configuration and all profiles) is found one level above
  `profiles/`. `state.db` is read with `node:sqlite` from the runtime, and a fallback folder is chosen
  by when it was added, not by its position.

### Fixed

- **The extension survives Windows.** Five suspects were fixed before release, each with a test that
  runs here by passing the platform in: one folder has one identity (`C:\Repo` and `c:\repo\` used to
  make two rows, and a session's Hermes cwd could not be found again), a rename is retried while
  another process holds the file (four windows share `folders.json`), a migration stops at the first
  folder it cannot move instead of leaving the data split over two folders, `HERMES_HOME` is expanded
  the way Hermes expands it (`~`, `%VAR%` on Windows, `$VAR` / `${VAR}` elsewhere) and
  `HERMES_DATA_DIR_SUFFIX` is applied, and `state.db` is opened read-only so a lock while Hermes
  writes is logged and skipped instead of thrown. **This release has not been run on Windows yet**:
  the code paths are covered by tests here, the platform is not.
- **A permission press made during a run now says what it did.** Commands follow at once, but Hermes
  freezes the session's edit mode for the run in flight, so the edit half waited in silence. The pane
  says "Applies from the next run." beside the answers — the same words the Hermes cwd uses, from one
  string — and clears it when the run ends and the mode lands.
- **A Hermes session is no longer claimed for a window because its folder happens to be inside one.**
  Once ownership was decided by containment, an untagged Hermes session — written before tags
  existed, or made by the TUI, the CLI or Desktop — was tagged to whichever window had that folder,
  and opening it then moved it to that window's Hermes cwd. Nothing claims a Hermes session now: it
  reaches a window only by being opened from Closed Sessions, which is also where such sessions are
  now listed, beside the ones Hermes was told to hide.
- **The Hermes cwd stays on your choice after a window reload.** Before, Hermes went back to the
  workspace's first folder while the green chip still showed your choice.

### Removed

- **Four pieces of extension-side code that decided permissions nobody saw, and two ACP
  capabilities Hermes never asks for.** The permission card drew its own "Allow for session"
  button on gates where Hermes had deliberately withheld that scope, and pressed it answered the
  next request unseen; the ACP client fell back to answering "allow" when no handler was passed;
  and the client advertised `fs` and `terminal` capabilities that Hermes never calls, the terminal
  side spawning processes inside the extension, outside every approval gate. All four are gone
  rather than replaced: the card shows only the options Hermes sends, a permission handler is now
  required, and `clientCapabilities` advertises nothing. The workspace path guard stays — the
  chat preview still uses it.
- **The editor's own `mcp.json` is no longer a second source of MCP servers.** The session request
  used to be built from `mcp.json` in the session folder and in `~/.cursor` / `~/.vscode`, and Hermes
  added those servers to the session next to the profile's own — a hidden source next to the one
  place servers are meant to live. The field is still sent, always empty, because ACP requires it;
  MCP servers are configured in the Hermes profile (`config.yaml` → `mcp_servers`) only. The reader
  that parsed that file, and `fsRead`, whose only caller went with the fs capability, are removed
  rather than left unused.

## [2.3.1] - 2026-11-12

The rail shows and sets the permission mode, and an approval granted on your behalf is drawn as a
card of its own instead of a line inside a tool result. Tabs belong to projects. A message that
never reached the agent is offered back rather than appearing as a draft.

### Added

- **The rail shows and sets the permission mode.** The closed-session picker in the rail is now a
  button reading `Permissions: Man | Smart | None | ALL`, coloured by the mode in force — Manual
  blue, Smart green, None orange, ALL red. Its balloon says how to reach session permissions.
  Pressing it opens a row under the toolbar with the same three-position switch the permission
  card carries, drawn once and mounted twice, so the two can never disagree about the mode.
- **The red ALL action, and what it costs.** The row's red button turns approvals off and clears
  `approvals.deny` — the patterns are saved to JSON first, and nothing is cleared if that write
  fails, because those patterns are the only copy. It glows from the press, inverts when Hermes
  confirms, stops on a second press even mid-flight, and leaves a *Restore deny rules* link beside
  itself while a backup exists. Its balloon reads `DANGER! (only critical actions blocked)`.
- **An approved command says why, in a card of its own.** When a command passed an approval gate,
  the reason arrived as a line buried in the tool result. It is now a near-black card with the
  reason in orange, one per tool call, kept in the transcript and across a reload.
- **Tabs belong to projects.** Tabs are grouped by the work they came from, a new session is born
  in the project of the tab that was in use, and a workspace carries an id that cannot change, so
  a project points at the same space however its folders move.

### Changed

- **A sent reply keeps the quote panel it was composed with.** The reply is text —
  `[replying-to]` … `[/replying-to]` around the quoted messages — so after sending, the message
  showed the markers verbatim. The transcript now reads the block back and draws the panel the
  composer showed: the title with the count, one row per quoted message, and the caret that
  collapses it. The markers still travel to the agent unchanged.
- **An attached history slice reads as a conversation.** The history card used to sit flat on the
  pane background — no surface, and one monospace block for every message — so the next card's
  surface ran straight into its text. It now has a card of its own and one bubble per attached
  message, each tagged with its sender; the bubble is the same `tagged-msg` template a forwarded
  draft draws with. Bodies that are not attaches keep the quoted-text form.
- **Session tabs share the strip before it scrolls.** The 300px is a ceiling for a long title,
  not a fixed width: a tab may now shrink to 72px, so several conversations stay visible in a
  narrow sidebar instead of the strip scrolling after the second one. Titles still ellipsise,
  and the editor-panel rail keeps its full-width rows.
- **A message that never reached the agent is offered, not filled in.** The undelivered notice
  used to put the text back into the composer when the composer was empty, which made a recovered
  message indistinguishable from a draft — and the only way to send it was to send it. The notice
  now offers the text and leaves the composer alone.

### Fixed

- **Choosing None no longer reports ALL.** Both are `approvals.mode: off`, so the pane used to
  infer the wider state from an empty `approvals.deny` and any profile without rules read as ALL.
  None asks nothing but the profile's own rules still default-block; ALL means those rules were
  cleared. The state is now recorded when the red action engages and cleared by any deliberate
  mode choice, including None.
- **The permission mode is read, not remembered.** The rail button showed a dash on every window
  load, and a mode changed in a terminal could be contradicted by the pane. It is now read when
  the window loads, when the row opens, and when a card appears — with the pending state shown for
  the second that read takes, and a guard so a mute host cannot leave it rolling.
- **A prompt the agent took is no longer offered back as undelivered.** The record that marks a
  send which may never have arrived was cleared by comparing text against the next replay, so a
  message that had in fact arrived could be offered again, and a replay that reworded anything
  left the record in place. The record now carries its own id and is deleted the moment the
  agent starts answering; what a replay can still prove is dropped by time, never by text.
- **The tray window retries once when its first load failed.** At autostart the window loads the
  dashboard before `hermes-dashboard.service` may be listening, and QtWebEngine then kept its
  error page until *Reload* was pressed. The window now tracks `loadFinished` and reloads once on
  being shown — only when that load failed and the status probe says the dashboard answers, so a
  page that loaded fine is never reloaded.

## [2.2.0] - 2026-11-05

Peer cards say who forwarded them and who wrote each message, and expire when nobody answers. Copy
works in the pane again on VSCodium 1.143.

### Added

- **Peer cards name the forwarder and tag each message with its sender.** One bubble per forwarded
  message, tagged `you@host`; the envelope carries `forwarderProfile`, `forwarderHost`,
  `forwarderRole` and a `messages` array, each entry recording its own `sentBy`.
- **An unanswered peer card expires**, like a permission card. A dismissed or expired card is
  shortened to a note, and a pane re-show or tab switch sweeps timed-out cards. Local peer cards are
  not part of Hermes' transcript, so a reload rebuilds the transcript without them and the
  inbox re-injects the undecided ones from its cursor.
- **`tommys.debugTabSwitch`** (off by default): logs each tab switch and flags a tab bound to a
  Hermes session that has nothing to show.

### Changed

- **Envelope fields renamed:** `fromProfile`, `fromHost` and `senderRole` become `forwarderProfile`,
  `forwarderHost` and `forwarderRole`.
- **One copy of the environment-detection progress formatting**, in `src/shared/detectProgress.ts`.
  The host's copy was never read and is gone; every branch is pinned by tests in English and
  Chinese. No change to what the panel shows.
- Unused imports removed; `noUnusedLocals` is on for the host and the pane.
- The Chinese README and changelog now say they stop at 1.1.0; the English files are current.

### Fixed

- **Ctrl+C keeps a selection made in the pane.** VSCodium 1.143's webview host re-focuses the element
  that last fired `focusin` before it runs `execCommand('copy')`, and only while
  `document.activeElement` is `<body>`. In this pane that element is the composer, so the refocus
  collapsed the selection and the copy came back empty. A primary-button `pointerup` listener now
  focuses a `tabindex="-1"` fallback root for clicks on content, so `activeElement` is never `<body>`
  when the host copies: transcript, code blocks, aux cards, log/history viewer and the info modals
  alike. Non-primary buttons are ignored, so the editor's context menu is no longer dismissed by a
  focus change on right-button release.

## [2.1.1] - 2026-10-31

The systray app becomes something the extension can install for you, and the Qt program behind it
ships inside the bundle.

### Added

- **A systray app, installable from the menu — Linux only.** A KDE tray app: `.desktop` entry,
  icons, Python/Qt installer. Two entries — *Install Hermes systray app* and
  *Uninstall Desktop GUI* — each shown only in the state it applies to (`tommysSystrayInstalled`,
  refreshed by a 10 s watch so the menu follows an install done outside the editor). The installer
  is launched from the extension's own folder, so a fresh install needs no separate download.
  The commands are not gated by platform yet, so on Windows and macOS the entries appear and
  the install cannot work
- **`extras/KDEdesktopGui/`** — the Qt program behind that entry: `hermes_desktop_gui.py` (the
  tray), `installer_gui.py` (the install flow), its icons, a `.desktop` entry, and build scripts
  for Linux and Windows. It is a separate program, not part of the extension's runtime; the
  extension only launches the installer — which is why the folder ships in the VSIX rather than
  living beside it (`systrayInstall.ts` resolves it under `extensionUri`)

## [2.1.0] - 2026-10-30

The release where the pane stops keeping its own copy of facts the agent already owns, and the
week of cleanup that followed it. Two claims were deleted outright — the local model catalog and
the per-card draft file — and the rest is what those deletions exposed: a path check that was a
string prefix, a terminal command that ran twice, a sidecar that was never written, a refused
`session/new` that read as ready.

### Added

- **Four ACP fields the client had been dropping**: a terminal's `env` arrives as name/value pairs
  and was spread as an object, so requested variables were lost; `outputByteLimit` belongs to the
  create call and was read from every output request; `fs/read_text_file` ignored `line` and
  `limit`; and a structured permission request produced no detail, so an approval could be granted
  without seeing the command. A terminal whose executable did not exist now resolves its exit
  promise instead of raising an unhandled error
- **One handover vocabulary** for a session slice, whichever route it takes: `shared/historyHandover.ts`
  writes the session handle, the anchor, the permission note and the hint to read on. The note
  appears only when the reader's profile differs from the slice's, and the hint now reaches the
  attach path as well as the forwarded one
- **A control stack in the transcript**, so a long conversation is not a scroll hunt: jump to now
  centres the current turn, back to the start appears on hover, and search scrolls a match into
  view instead of only counting it

### Changed

- **The model list is Hermes' again.** `profileModels.ts` parsed `config.yaml` into a catalog and
  `providerModelFetch.ts` asked a provider's `/v1/models`; production imported neither. Models a
  chat can use arrive over ACP in the `session/new` response, and a second, local claim on that
  fact is how the list drifts from the agent's
- **An undecided forward is inbox state, not a transcript row.** The cursor stops before the first
  envelope addressed here that no decision has been made on, and only Deliver/Dismiss moves it;
  the pane redraws the open cards from the cursor after a reload or a tab switch. The per-tab
  `pending_peers_<tab>.json` written one commit earlier is gone — one source, one restore path
- **The primary withholds the secondant's profile too.** The exclusion ran one way, so switching
  the primary onto a shared profile evicted the secondant retroactively; the secondant now
  registers its profile up and the picker withholds it
- **A terminal mirror is a log line, not a second execution** — the full argv and the cwd, instead
  of `sendText()` into a VS Code terminal
- **The secondant's artwork is chosen in one place**: `identityArtwork()` in `webview/html.ts`, so
  the About panel no longer falls back to the primary's icon
- **The follow state belongs to the reader.** The pane no longer re-pins itself to the bottom a
  few seconds after a scroll, so reading back through history during a run stays where it was put
- **An unanswered permission card expires after 120 s** rather than holding the ACP request open
  for as long as the agent waits; the turn continues as refused

### Fixed

- **Every `terminal/create` command ran twice.** The handler spawned the process *and* a mirror
  callback typed the same command into an editor terminal, where `args.join(' ')` lost the argument
  boundaries — so an install or a migration could happen twice, differently
- **Path containment was a string prefix.** `/work/repo-secrets` passed for `/work/repo`,
  `/work/repo/../secrets` passed, and a relative path was not checked at all. `pathWithin()`
  resolves and then requires the path to sit inside a workspace folder
- **The pending-user sidecar was never written**: `persistMessages()` appended only for a `user`
  role, and every caller passed nothing, so `findUndelivered` always read an empty list and the
  "offered back to the composer" path could not fire
- **A refused `session/new` was treated as ready**: the failure lives in the client's status, so
  the blank-tab branch fell through, bound the tab and sent the turn against a session that was
  never created. It now refuses on anything but `ready`
- **A send that cannot bind no longer goes, and says why once** — the non-composer entry awaited
  `ensureSessionReady()` and discarded the answer, while the composer path added its generic line
  on top of the specific one
- **A failed `session/new` no longer drops the connection.** It was reported as a lost connection
  with a retry that could not help, and the JSON-RPC data carrying the cause was discarded
- **The profile guard compared display labels**, so an agent named "Main" resolved to `default`
  and passed against a pane on `default` labelled "Default". It compares the CLI profile now, and
  every connect path enforces it
- **The history viewer showed a failed export as an empty conversation**: `exportSessionMessages`
  swallowed failures into `[]`. It throws a typed error, and the viewer posts the reason
- **Closing a tab hid the tab's id, not its Hermes session**, so a session the strip had opened
  stayed visible in the catalog
- **A stale session pointer blocked adoption**, leaving the throwaway session from `session/new`
  bound to the tab; a failed load no longer reaches the connection's catch
- **A tab holding only an undecided forward could not start a session** — `ensureSessionReady`
  refused any unbound tab with a message in it, and a peer card is a message
- **Attachment matches spanned conversations**: the index key was the message text alone, so an
  identical message elsewhere could pick up the wrong picture. Entries carry their session and
  profile, and the replay fallback stays inside that conversation
- **Forwarded mail was addressed by a sanitized name** compared against the raw profile from
  settings, so any profile with a space or a non-ASCII character never received mail
- **Two profiles whose names sanitize alike shared one presence file**, then one comparison: the
  file name now carries a fingerprint of the raw name, and the pane recognises itself by that name
- **A connect overtaken by a drop carried on** when its await resolved, and a later connect
  returned without connecting at all. `Connection` carries a generation now
- **`npx` could not start on Windows**, so deploy and package failed before compiling; `tsc`,
  `vsce` and the pane bundle run through this Node instead
- **A `.obsolete` entry was dropped while its folder was still there**, after a `rmSync` failed on a
  directory another process held open
- **A PATH test could write to the real shell profile** — `addHermesDirectoryToSystemPath` takes an
  injected PATH and an apply flag now
- **An interrupted package run left the secondant's identity in the manifest**; a signal handler
  restores it
- Failed catalog and MCP-config writes are logged instead of silently dropped, and a malformed
  `mcp.json` is no longer indistinguishable from a missing one
- **Sessions created after a `hermes update` to 0.22.5 disappeared from Open, and renaming one
  deleted its tab.** Hermes now keeps the creating surface in `created_source` and rewrites
  `source` to `local`; the catalog still asked for `source="acp"`, so every session made since the
  update was invisible while its rows sat in the store. Patch `0001` reads either table layout —
  and the VSIX alone does not fix this: re-apply the patch after a `hermes update`
- **Switching tabs replayed nothing.** The active-session id was set after the load rather than
  before it, so the replay was addressed to the session being left; a tab that was already active
  was never replayed at all, which is how a session with hundreds of rows could open empty

### Repository

- Dead: the three pane formatters, five exported helpers, five exported types, a second
  permission-detail parser, the `parseModelsFromConfigYaml` parser, and the unwired elicitation
  bridge (136 lines, wired to nothing)
- Collapsed to one copy: the grouped-model flattener, the tool-aggregation rules (now
  `shared/toolAggregate.ts`), `which`/`where` lookup, detection progress, the three picker handlers,
  the three replay chunk cases, the copy button, turn quiescing, client reset, the tab title, and
  the venv path
- Five orphaned style rules, 25 unread locale keys and five stale comments removed; the three
  locale lists stay in sync at 263
- `packaging/hermes-patches/0002-acp-gateway-ext-methods.patch` carries the three `_session/*`
  methods onto `GatewayACPAgent`, with a patch changelog recording each base commit and the symptom
  when a patch is missing

## [2.0.0] - 2026-10-29

A second agent in the same window, and a transcript that belongs to Hermes again.

Two things happened at once here, and they are the same thing seen from opposite ends. The
extension gained a companion — a second, independent agent beside the first — and lost the
local copy of the conversation it had been keeping since the fork. Neither works without the
other: two panes sharing one stale mirror would have been worse than one pane with a stale
one.

### Added

- **Secondant**: a second Hermes agent in the same editor window — own extension id, own
  sidebar, own tabs, own profile. It ships as a VSIX inside the primary and is installed
  from a command (`Install secondant`), so it is one install for the user and two extensions
  on disk. Uninstalling it takes the version directories with it
- **The pane says which one it is**: the secondant carries an orange rule on its toolbar and
  a badge row below it; in the editor-panel surface each pane's frame is drawn in its own
  accent. Two chats side by side no longer look identical
- **The profile guard**: the secondant may not run on the profile the primary is using. When
  they collide it drops the connection, opens its picker and says why. Two agents means two
  profiles, enforced rather than assumed
- **Pane mail**: forward any message from one pane to the other. It arrives as a card with a
  sender pill and its body rendered as markdown, and nothing is sent to the receiving agent
  until you press **Deliver**. The log is append-only NDJSON under the Hermes home, with a
  presence heartbeat per pane, a byte cursor, and taken ids remembered in global state so a
  reload or a log roll cannot deliver the same card twice
- **One decision per stack**: consecutive pending forwards share a rail and a single
  Deliver / Dismiss on the last card, sent as one turn in arrival order
- **Session memory crosses the channel**: a session-memory slice can be forwarded too, and
  the receiving agent gets the session handle, an anchor when no message ids matched, and a
  note that the handle reads outside its own profile — with the call that reads more of it
- **A loading state worth looking at**: the pane's own icon, pulsing, with the live chunk
  count beneath it. Under `prefers-reduced-motion` it keeps breathing as an opacity-only pulse —
  slower, without the scale — because a still indicator reads as a broken one; the preference
  picks the gentler motion, not silence
- **Replay progress** streamed from the ACP updates as they arrive
- **Search in the history viewer**: the same in-conversation search the chat has
- **A wire trace** for ACP `session/update` traffic (`HERMES_ACP_TRACE=1`), written to the
  output channel and to `pane-mail/trace-<profile>.ndjson`

### Changed

- **The history viewer reads from Hermes**, so any session Hermes knows can be opened — not
  only the ones this pane happened to have rendered before
- **The transcript mirror is gone.** What remains on disk is a five-user-message sidecar
  whose only job is holding a message Hermes never received. Everything the pane shows now
  comes from Hermes
- **The tab's link to its session is proven from the catalog** — a bound `hermesSessionId`
  and a catalog row for it — instead of from whether a cached transcript loaded
- The message count is Hermes' own; the pane no longer writes a replay length back into the
  tab record
- The composer grows to ten lines and returns to its resting height when emptied

### Fixed

- **The tab could lose its session** when the cached paint was removed: `messages.length`
  was answering "did the cache load?" while being read as "is this tab new?" — the same
  shape in `applyCatalog` and in `resumeOrAdopt`
- **"This conversation is not available locally"** is replaced by three honest states:
  fetching, empty, and failed — with the failure logged instead of swallowed
- The mail log's cursor counts **bytes**, so an envelope carrying multi-byte text no longer
  pushes every later line out of reach
- Peer cards rendered their markdown as literal characters, because the card was built live
  and the sweep that renders markdown only runs after a restore

### Repository

- `sessionPrune`, `removeMessages`, `dropTranscript`, the `createBlankTab` unlink and the
  `hideSessions` purge are gone. Each was a local `fs.unlink`; Hermes kept every row, so
  "delete" was never a delete
- The transcript cache's 100-message cap went with them — a size policy for a store that was
  never the authority
- `ReplayMessage` carries the metadata ACP already sends: `messageId`, tool
  `title`/`kind`/`status`/`locations`, and `_meta`

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
