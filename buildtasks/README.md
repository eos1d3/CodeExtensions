# Build Buttons (VS Code / Cursor)

Run your project's build, flash, test — any shell command or VS Code
command — straight from the status bar. You define the tasks in a small
per-project JSON file (`buildtasks.json`), and each project shows up as
**one compact button** instead of a cluttered row of per-task status bar
items.

Works with **multiple projects** at once: open a multi-root workspace
(or a parent folder full of sub-projects) and each project still gets
just its single collapsed button — `G031 ▾ G230 ▾ CH32 ▾` — so the
status bar stays clean no matter how many projects or tasks you have.

**`G031 ▾`**

- **Click the name** → runs the default task (e.g. Build Debug).
- **Click the arrow `▾`** → expands all buttons inline on the status bar:
  `G031 ▾  Build Debug  Build Release  Clear  Flash Debug ▴`
  The row collapses when you run a task, click the arrow again, or after
  `buildTasks.autoCollapseSeconds` (default 10 s, `0` disables).
- **Multiple projects open** → one button pair per project, instead of one
  status bar button per task. (Right-click on status bar items stays reserved
  by VS Code itself, so the arrow click is the expand trigger.)
- **Parent folders work too**: if an open folder has no `buildtasks.json` of
  its own, the extension scans its immediate sub-folders and shows one button
  per sub-project that has one (e.g. open `~/Projects/GD32` and get a
  button per project inside it). Only one level is scanned. If that same
  sub-project is also open as its own workspace folder (typical in a
  multi-root / worktree window), it is shown once.

Written in plain JavaScript — no Node/npm, no compile step. Each project
defines its own buttons in its own file, so it never conflicts with
`.vscode/tasks.json` or the Tasks extension.

## Install

Open the Extensions panel, search for **Build Buttons**, click Install.
(You're already on the Marketplace page — the button works too.)

Or from the terminal:

```sh
code --install-extension eos1d3.build-buttons
```

### Cursor

Cursor uses the Open VSX registry, where this extension is not (yet)
published — install the packaged VSIX there:

```sh
./make-vsix.sh
cursor --install-extension eos1d3.build-buttons-<version>.vsix
```

### Development install

Copies straight into the VS Code and Cursor extensions folders:

```sh
./install.sh
```

then run **Developer: Reload Window** in VS Code / Cursor.

Uninstall:

```sh
code --uninstall-extension eos1d3.build-buttons
# or, for older local copies (previous IDs):
rm -rf ~/.vscode/extensions/{andy.buildtasks,eos1d3.buildtasks,eos1d3.build-tasks,eos1d3.build-buttons}-* ~/.cursor/extensions/{andy.buildtasks,eos1d3.buildtasks,eos1d3.build-tasks,eos1d3.build-buttons}-*
```

## Project configuration

Create `.vscode/buildtasks.json` in each project (JSON with `//` comments
and trailing commas allowed):

```jsonc
{
  "version": "2.0.0",
  "button": {
    "label": "G031",             // optional; default = workspace folder name
    "icon": "$(chip)",           // optional codicon shown before the label
    "default": "Build Debug",    // optional: exact task label, or 0-based index; default = first task
    "alignment": "left",         // optional: "left" | "right"
    "priority": 100              // optional: status bar ordering
  },
  "tasks": [
    // Same command on every OS:
    { "label": "Build Debug", "detail": "debug build", "command": "scons", "args": ["debug"] },

    // Different launchers per OS (shared args). Put the codicon in `icon`,
    // not in `label` — `button.default` matches the label exactly.
    {
      "label": "Build Debug",
      "icon": "$(gear)",
      "detail": "Build — Debug",
      "args": ["Debug"],
      "macos":   { "command": "./Tools/build.sh" },
      "windows": { "command": ".\\Tools\\build.cmd" },
      "linux":   { "command": "./Tools/build.sh" }
    },

    // Platform block can also override args / options:
    {
      "label": "Flash Debug",
      "macos":   { "command": "./Tools/build.sh Debug && ./Tools/flash-pyocd.sh Debug" },
      "windows": {
        "command": ".\\Tools\\build.cmd Debug && .\\Tools\\flash-pyocd.cmd Debug",
        "options": { "env": { "BOARD": "G031" } }
      }
    }
  ]
}
```

Task fields:

| Field | Meaning |
| --- | --- |
| `label` | Button text (required). This is what `button.default` matches. |
| `icon` | Optional `$(codicon)` shown before the label. Keep this out of `label`. |
| `detail` | Shown as the button's tooltip. |
| `command` | Shared shell command (all OSes). Use when the line is the same everywhere. |
| `args` | Shared args appended to `command` (quoted when needed). |
| `macos` / `windows` / `linux` | Per-OS object: `{ "command", "args"?, "options"?, "vscommand"? }`. Overrides shared fields when present. |
| `options.cwd` | Working directory, relative to the project root. |
| `options.env` | Extra environment variables for this command. |
| `vscommand` | Instead of a shell command: a VS Code command id, executed with `args`. |

Tasks run in the integrated terminal named after the project (one per
project, reused; opened without stealing focus). On macOS/Linux the line is
`cd <dir> && <command>` (POSIX). On Windows the extension uses `cmd.exe` and
sends `cd /d <dir> && <command>`.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `buildTasks.filePath` | `.vscode/buildtasks.json` | Per-project definition file (rename without conflict if you like). |
| `buildTasks.autoCollapseSeconds` | `10` | Auto-collapse delay for the expanded row; `0` = stay open. |

Edits to `buildtasks.json` are picked up automatically (file watcher).

## Replacing the Tasks extension buttons

This extension is independent of actboy168's Tasks extension. To stop the old
per-task buttons from cluttering the status bar, either disable that extension
or set in your settings:

```json
{ "tasks.statusbar.default.hide": true }
```

## How it works

Plain-JS extension host code (`extension.js`): one pair of status bar items
per project — the label item runs the default task, the chevron item toggles
a row of per-task items between them. No dependencies, no build tooling;
edits take effect after a window reload.

## Development

A functional test drives the real `extension.js` against a mocked `vscode`
API (and the real project directories) using VS Code's own engine — no Node
needed:

```sh
ELECTRON_RUN_AS_NODE=1 "/Applications/Visual Studio Code.app/Contents/MacOS/Code" test/run.js
```
