/**
 * The environment a child inherits when it may end up starting Electron.
 *
 * The VS Code extension host is itself Electron, and it sets `ELECTRON_RUN_AS_NODE=1`; every child
 * we start inherits it. An Electron app started with that variable in its environment runs as plain
 * Node instead: `Hermes.exe` exits 0 immediately, with no window and no error (proven on the Windows
 * VM). Dropping the variable is the whole fix, and it lives in one function so the two spawns that
 * can reach Electron — Hermes' own Desktop build, and the tray launcher — cannot disagree about it.
 *
 * A spawn that only runs the Hermes CLI has no use for this: `hermes acp`, `hermes config set`,
 * `hermes --version`, `hermes profile list`, `hermes sessions export` and `where hermes` never start
 * Electron, and they keep our environment untouched.
 */
export function electronCapableEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    const env = { ...base };
    delete env.ELECTRON_RUN_AS_NODE;
    return env;
}
