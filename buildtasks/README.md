# Build Buttons

One status-bar button **per project**, so many folders stay readable. Labels are **yours** — not presets — e.g. `G301` and `F103`:

```
G301 ▾  F103 ▾
```

Click the name to run that project’s default task. Click `▾` to expand its tasks:

```
G301 ▾  Build Debug  Build Release  Flash ▴  F103 ▾
```

Icons are supported (`$(codicon)` on the project button and on each task). If an open folder has no config, immediate subfolders that do are shown (one level).

## Setup

In each project, add `.vscode/buildtasks.json`:

```jsonc
{
  "version": "2.0.0",
  "button": { "label": "G301", "icon": "$(chip)", "default": "Build Debug" },
  "tasks": [
    { "label": "Build Debug", "icon": "$(gear)", "command": "scons", "args": ["debug"] },
    { "label": "Flash", "icon": "$(zap)", "command": "./Tools/flash.sh" }
  ]
}
```

`button.label` is whatever you want (`G301`, `F103`, a board name, the folder name, …). `detail` is the tooltip.

To use a different command per OS, add `macos` / `windows` / `linux` on the task (they override `command`).

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `buildTasks.filePath` | `.vscode/buildtasks.json` | Config path |
| `buildTasks.autoCollapseSeconds` | `10` | Auto-collapse; `0` = stay open |
