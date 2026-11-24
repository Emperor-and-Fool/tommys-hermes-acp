/**
 * The editor itself: what it is called, what it looks like, what it may open.
 *
 * The members are exactly the ones this codebase asks of `vscode.env`, `vscode.window` and the
 * extension registry, named for the answer rather than for the call (F6).
 */
export interface EditorEnv {
    /** `Visual Studio Code`, `VSCodium`, `Cursor`: the shell this extension is running in. */
    appName(): string;
    /** `vscode.ColorThemeKind` as a number: it decides which syntax sheet the pane loads. */
    themeKind(): number;
    /** The text selected in the active editor; undefined when nothing (or nothing selected). */
    selection(): EditorSelection | undefined;
    /** Open a URL in the user's browser. The caller decides which URLs may be opened. */
    openExternal(url: string): void;
    /** This extension's own manifest, as the About panel shows it. Absent fields are ''. */
    extensionInfo(extensionId: string): EditorExtensionInfo;
    /** A channel in the Output panel, held by whoever writes to it. */
    outputChannel(name: string, id: string): EditorLog;
}

/** The text the user has selected: what "Send Selection to Hermes" hands over. */
export interface EditorSelection {
    text: string;
    /** The file's full path, as the editor knows it. */
    fileName: string;
    /** 1-based, because a person reads it. */
    line: number;
}

/** The fields of `package.json` the About panel draws. */
export interface EditorExtensionInfo {
    displayName: string;
    version: string;
    publisher: string;
    description: string;
    repository: string;
}

/** An Output-panel channel, as the log writer holds it. */
export interface EditorLog {
    appendLine(line: string): void;
    dispose(): void;
}

/**
 * The editor commands this extension runs by id.
 *
 * Each one is a named thing the user asked for, not a command string: callers say
 * "reload the window", and this file is the only one that knows VS Code calls that
 * `workbench.action.reloadWindow`.
 */
export interface EditorCommands {
    /** Open another folder in this window, which replaces what is open. */
    openFolder(folderPath: string): void;
    /** Reload the window: how a changed extension takes effect. */
    reloadWindow(): Promise<void>;
    /** Ask the Marketplace for updates, then show this extension in the list. */
    checkForUpdate(extensionId: string): Promise<void>;
    /** Open this extension's settings, in whichever editor the user has chosen for them. */
    openSettings(extensionId: string): Promise<void>;
    /**
     * A context key our `package.json` reads in a `when` clause: which menu item a pane offers.
     *
     * Set, not read: the value decides whether the ⋯ menu shows "Set up notes mirror…" or
     * "Repair notes mirror", and the caller names the key by the feature it describes.
     */
    setContext(key: string, value: unknown): void;
}

/**
 * What the user is told, in the editor's own voice.
 *
 * Not the pane's: these are the editor's notifications, and they were always `vscode.window`'s.
 * A level is all the caller chooses — the feature does not know how a notice is shown.
 */
export interface EditorNotices {
    info(message: string): void;
    warn(message: string): void;
}

/**
 * The window's folders and its workspace file: what the editor has open.
 *
 * Two features ask this: the cwd owner (`workspace/cwd.ts`, which only knows the first three
 * members) and the project group (`workspace/projectGrouped.ts`). One adapter answers both, so
 * "which workspace am I in" has one source (F6).
 */
export interface EditorFolders {
    /** The window's `.code-workspace` file, or '' when it opened plain folders. */
    workspaceFile(): string;
    /** The folders the window opened, in the editor's order. */
    folders(): string[];
    /** Told when that list changes; returns the unsubscribe. */
    onFoldersChanged(handler: () => void): () => void;
}

/**
 * One of our own settings, and the news that it changed.
 *
 * The section (`tommys` / `tommys2`) is the adapter's to know: the caller names a bare key, the
 * same key its `package.json` contribution uses. A key outside our section never reaches the
 * handler, which is what the old `affectsConfiguration(settingsSection())` guard did at each site.
 */
export interface EditorSettings {
    /** A setting by its bare key (`path`, `models`): the editor's default when it has none. */
    get<T>(key: string): T | undefined;
    /** The same, with the default this caller wants when the setting is unset. */
    get<T>(key: string, defaultValue: T): T;
    /** Told when one of our settings changed; `affects` answers for a bare key. */
    onDidChange(handler: (affects: (key: string) => boolean) => void): { dispose(): void };
}

/**
 * What the chat feature asks of the editor: the folders it may read, a file list, a file's head, a
 * file opened, text inserted at the cursor.
 *
 * Declared in `shared/` because two sides need this shape — the feature that asks (`chat/files.ts`)
 * and the adapter that answers (`editor/files.ts`) — and the architecture lets both import
 * `shared/` while a feature may not be imported by infrastructure (F5).
 */
export interface EditorFiles {
    /** The folders this window opened. The pane may read nothing outside them. */
    folders(): string[];
    /** Paths under those folders, relative to them, at most `limit`. */
    list(limit: number): Promise<string[]>;
    /** The head of a file and how long it is: the pane formats, the editor reads. */
    readHead(filePath: string, maxLines: number): Promise<{ lines: string[]; total: number; language: string }>;
    /** Show a file in an editor. */
    open(filePath: string): Promise<void>;
    /** Insert text at the cursor of the active editor; false when there is no active editor. */
    insertAtCursor(text: string): Promise<boolean>;
    /** How a path is shown to the pane: relative to its folder when it has one. */
    display(filePath: string): string;
    /** Say something to the user in the editor's own voice, as these actions always did. */
    notify(message: string, level: 'warn' | 'info'): void;
}

/**
 * The questions a feature asks the user, and the folder it shows them.
 *
 * The feature names the question — a title and its own rows — and this is the only file that knows
 * a QuickPick exists. The OS's folder dialog and the OS's file manager are here for the same
 * reason: a feature that chose its notes mirror must not know which shell it runs under (F6, §12).
 */
export interface EditorChoices {
    /** One row of a list the feature supplies: its id, or undefined when the user dismisses. */
    pick(title: string, items: EditorChoiceItem[]): Promise<string | undefined>;
    /** A typed answer with a starting value: what the user entered, or undefined when dismissed. */
    prompt(title: string, value: string): Promise<string | undefined>;
    /** The OS folder dialog: the chosen folder, or undefined. */
    pickFolder(title: string, startAt: string): Promise<string | undefined>;
    /** Show a folder in the OS file manager — the user's own browser, not the editor's explorer. */
    showInFileManager(folderPath: string): Promise<void>;
    /** A notice with buttons: the action the user took, or undefined when it was closed. */
    ask(message: string, actions: string[]): Promise<string | undefined>;
    /** The user's home folder: where Documents is, and where a folder dialog starts. */
    home(): string;
}

/** One row of a picker: what it says, and the id the caller gets back. */
export interface EditorChoiceItem {
    id: string;
    label: string;
    /** The second column: a path, a count. */
    detail?: string;
    /** The row this extension suggests, drawn as the preselected one. */
    suggested?: boolean;
}
