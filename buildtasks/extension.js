'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const jsonc = require('./jsonc');

const CMD_RUN_DEFAULT = 'buildTasks.runDefault';
const CMD_TOGGLE = 'buildTasks.toggle';
const CMD_RUN = 'buildTasks.run';
const DEFAULT_FILE_PATH = '.vscode/buildtasks.json';

// folder URI string -> group state
const groups = new Map();

let configWatcher = undefined;
let rebuildTimer = undefined;

// ---------- config file ----------

function configRelPath(folder) {
  return vscode.workspace
    .getConfiguration('buildTasks', folder.uri)
    .get('filePath', DEFAULT_FILE_PATH);
}

const PLATFORM_KEYS = ['macos', 'windows', 'linux'];

function platformKey(platform) {
  const p = platform || process.platform;
  if (p === 'darwin') return 'macos';
  if (p === 'win32') return 'windows';
  return 'linux';
}

function normalizePlatformBlock(block) {
  if (!block || typeof block !== 'object' || Array.isArray(block)) return undefined;
  const out = {};
  if (typeof block.command === 'string' && block.command.trim()) {
    out.command = block.command.trim();
  }
  if (typeof block.vscommand === 'string' && block.vscommand.trim()) {
    out.vscommand = block.vscommand.trim();
  }
  if (Array.isArray(block.args)) out.args = block.args.map(String);
  if (block.options && typeof block.options === 'object') out.options = block.options;
  if (!out.command && !out.vscommand) return undefined;
  return out;
}

// Merge shared task fields with the block for the current OS. Platform fields
// win when present; shared args/options apply when the platform omits them.
function resolveTask(t, platform) {
  const overlay = t.platforms && t.platforms[platformKey(platform)];
  const args =
    overlay && overlay.args !== undefined
      ? overlay.args
      : t.args;
  const baseOpts = t.options && typeof t.options === 'object' ? t.options : {};
  const overOpts = overlay && overlay.options ? overlay.options : {};
  const options = {
    ...baseOpts,
    ...overOpts,
    env: {
      ...(baseOpts.env && typeof baseOpts.env === 'object' ? baseOpts.env : {}),
      ...(overOpts.env && typeof overOpts.env === 'object' ? overOpts.env : {}),
    },
  };
  return {
    label: t.label,
    detail: t.detail,
    vscommand: (overlay && overlay.vscommand) || t.vscommand,
    command: (overlay && overlay.command) || t.command,
    args: Array.isArray(args) ? args : [],
    options,
  };
}

function normalizeTask(t, index, warnings) {
  if (!t || typeof t !== 'object') {
    warnings.push(`task #${index + 1} is not an object, skipped.`);
    return undefined;
  }
  const label =
    typeof t.label === 'string' && t.label.trim()
      ? t.label.trim()
      : `Task ${index + 1}`;
  const icon =
    typeof t.icon === 'string' && t.icon.trim() ? t.icon.trim() : undefined;
  const detail = typeof t.detail === 'string' ? t.detail : undefined;
  const args = Array.isArray(t.args) ? t.args.map(String) : [];
  const options = t.options && typeof t.options === 'object' ? t.options : {};

  const platforms = {};
  for (const key of PLATFORM_KEYS) {
    const block = normalizePlatformBlock(t[key]);
    if (block) platforms[key] = block;
  }
  const hasPlatforms = Object.keys(platforms).length > 0;

  const base = {
    label,
    icon,
    detail,
    args,
    options,
    platforms: hasPlatforms ? platforms : undefined,
  };
  if (typeof t.vscommand === 'string' && t.vscommand.trim()) {
    base.vscommand = t.vscommand.trim();
  }
  if (typeof t.command === 'string' && t.command.trim()) {
    base.command = t.command.trim();
  }

  const resolved = resolveTask(base);
  if (!resolved.command && !resolved.vscommand) {
    if (hasPlatforms) {
      warnings.push(
        `"${label}" has no command for ${platformKey()} (define "${platformKey()}" or a shared "command"/"vscommand"), skipped.`
      );
    } else {
      warnings.push(`"${label}" has no "command" or "vscommand", skipped.`);
    }
    return undefined;
  }
  return base;
}

function readConfig(folder) {
  const file = path.resolve(folder.uri.fsPath, configRelPath(folder));
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return { missing: true };
  }

  let json;
  try {
    json = jsonc.parse(text);
  } catch (e) {
    return { file, error: `invalid JSON (${e.message})` };
  }

  const warnings = [];
  if (!Array.isArray(json.tasks)) {
    warnings.push('no "tasks" array found.');
  }
  const tasks = [];
  (Array.isArray(json.tasks) ? json.tasks : []).forEach((t, i) => {
    const n = normalizeTask(t, i, warnings);
    if (n) tasks.push(n);
  });

  return {
    file,
    button: json.button && typeof json.button === 'object' ? json.button : {},
    tasks,
    warnings,
  };
}

function resolveDefaultIndex(button, tasks) {
  const d = button ? button.default : undefined;
  if (typeof d === 'number' && Number.isInteger(d) && d >= 0 && d < tasks.length) return d;
  // Exact label only — do not parse $(codicon) out of the display text.
  if (typeof d === 'string') {
    const i = tasks.findIndex((t) => t.label === d);
    if (i >= 0) return i;
  }
  return 0;
}

function taskButtonText(t) {
  return t.icon ? `${t.icon} ${t.label}` : t.label;
}

// ---------- status bar building ----------

function reportConfig(cfg) {
  if (cfg.error) {
    vscode.window.showErrorMessage(`Build Tasks: ${cfg.file}: ${cfg.error}`);
  } else if (cfg.warnings.length) {
    vscode.window.showWarningMessage(`Build Tasks: ${cfg.file}: ${cfg.warnings.join(' ')}`);
  }
}

// When a workspace folder has no config of its own, look one level down and
// treat each immediate sub-folder that has a config as a project of its own
// (e.g. a parent folder holding several firmware projects).
function findSubGroups(folder) {
  const rel = configRelPath(folder);
  let entries;
  try {
    entries = fs.readdirSync(folder.uri.fsPath, { withFileTypes: true });
  } catch (e) {
    return [];
  }
  const found = [];
  for (const ent of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
    const sub = { uri: vscode.Uri.file(path.join(folder.uri.fsPath, ent.name)), name: ent.name };
    const cfg = readConfig(sub);
    if (cfg.missing) continue;
    found.push({ folder: sub, cfg });
  }
  return found;
}

// Same directory can show up twice: as its own workspace folder and again
// as a child of an open parent (multi-root / worktree windows). realpath
// folds trailing slashes, aliases, and URI-string differences.
function normalizePath(fsPath) {
  if (!fsPath) return '';
  try {
    return fs.realpathSync(fsPath);
  } catch (e) {
    return path.resolve(fsPath);
  }
}

function rebuild() {
  for (const g of groups.values()) disposeGroup(g);
  groups.clear();

  const folders = vscode.workspace.workspaceFolders || [];
  const seen = new Set();
  const parents = [];
  let groupIndex = 0;

  // Workspace roots with their own config first — those are the folders the
  // user opened on purpose. Parent scans fill in the rest afterward.
  for (const folder of folders) {
    const cfg = readConfig(folder);
    if (cfg.missing) {
      parents.push(folder);
      continue;
    }
    reportConfig(cfg);
    if (!cfg.tasks || !cfg.tasks.length) continue;
    const norm = normalizePath(folder.uri.fsPath);
    if (seen.has(norm)) continue;
    seen.add(norm);
    createGroup(folder, cfg, groupIndex++);
  }

  for (const folder of parents) {
    for (const sub of findSubGroups(folder)) {
      reportConfig(sub.cfg);
      if (!sub.cfg.tasks || !sub.cfg.tasks.length) continue;
      const norm = normalizePath(sub.folder.uri.fsPath);
      if (seen.has(norm)) continue;
      seen.add(norm);
      createGroup(sub.folder, sub.cfg, groupIndex++);
    }
  }
}

// Higher priority = further left. Each group gets a band of 100 priority slots:
// band = label, band-1.. = expanded task buttons, band-tasks-1 = chevron.
function createGroup(folder, cfg, groupIndex) {
  const button = cfg.button;
  const label =
    typeof button.label === 'string' && button.label.trim()
      ? button.label.trim()
      : folder.name;
  const alignment =
    button.alignment === 'right'
      ? vscode.StatusBarAlignment.Right
      : vscode.StatusBarAlignment.Left;
  const band = 10000 - groupIndex * 100;
  const defaultIndex = resolveDefaultIndex(button, cfg.tasks);
  const key = folder.uri.toString();
  // Same URI twice (duplicate workspace folder entries) would otherwise
  // overwrite the map and leak the first pair of status bar items.
  if (groups.has(key)) return;

  const g = {
    key,
    folder,
    tasks: cfg.tasks,
    defaultIndex,
    label,
    // Shown in every tooltip so hovering always identifies the project,
    // including the real folder name when a custom label is used.
    tag: '',
    termName: '',
    alignment,
    band,
    expanded: false,
    labelItem: undefined,
    chevronItem: undefined,
    expandedItems: [],
    timer: undefined,
    terminal: undefined,
  };
  const plain = stripCodicons(label) || label;
  g.tag = plain === folder.name ? plain : `${plain} (${folder.name})`;
  g.termName = plain;

  const labelItem = vscode.window.createStatusBarItem(alignment, band);
  const icon = typeof button.icon === 'string' && button.icon.trim() ? button.icon.trim() : '';
  labelItem.text = icon ? `${icon} ${label}` : label;
  labelItem.tooltip = `${g.tag}\nClick: run "${stripCodicons(cfg.tasks[defaultIndex].label) || cfg.tasks[defaultIndex].label}"`;
  labelItem.command = { command: CMD_RUN_DEFAULT, title: 'Run default task', arguments: [key] };
  labelItem.show();
  g.labelItem = labelItem;

  if (cfg.tasks.length > 1) {
    const chevronItem = vscode.window.createStatusBarItem(alignment, band - (cfg.tasks.length + 1));
    chevronItem.text = '$(chevron-down)';
    chevronItem.tooltip = `Other tasks — ${g.tag}`;
    chevronItem.command = { command: CMD_TOGGLE, title: 'Toggle task buttons', arguments: [key] };
    chevronItem.show();
    g.chevronItem = chevronItem;
  }

  groups.set(key, g);
}

function expand(g) {
  if (g.expanded) return;
  g.tasks.forEach((t, i) => {
    if (i === g.defaultIndex) return; // the default runs from the main button
    const item = vscode.window.createStatusBarItem(g.alignment, g.band - 1 - i);
    item.text = taskButtonText(t); // "$(name)" in icon or label renders as a codicon
    item.tooltip = `${g.tag} — ${stripCodicons(t.detail || t.label) || t.label}`;
    item.command = { command: CMD_RUN, title: 'Run task', arguments: [g.key, i] };
    item.show();
    g.expandedItems.push(item);
  });
  if (g.chevronItem) {
    g.chevronItem.text = '$(chevron-up)';
    g.chevronItem.tooltip = 'Hide';
  }
  g.expanded = true;

  const seconds = vscode.workspace
    .getConfiguration('buildTasks', g.folder.uri)
    .get('autoCollapseSeconds', 10);
  if (seconds > 0) {
    g.timer = setTimeout(() => {
      g.timer = undefined;
      collapse(g);
    }, seconds * 1000);
  }
}

function collapse(g) {
  if (g.timer) {
    clearTimeout(g.timer);
    g.timer = undefined;
  }
  for (const item of g.expandedItems) item.dispose();
  g.expandedItems = [];
  if (g.chevronItem) {
    g.chevronItem.text = '$(chevron-down)';
    g.chevronItem.tooltip = `Other tasks — ${g.tag}`;
  }
  g.expanded = false;
}

function toggleGroup(key) {
  const g = groups.get(key);
  if (!g) return;
  if (g.expanded) collapse(g);
  else expand(g);
}

// ---------- running tasks ----------

// "$(name)" codicon sequences render in status bar text but are plain noise
// in tooltips and terminal names — strip them there.
function stripCodicons(s) {
  return typeof s === 'string' ? s.replace(/\$\([a-z0-9-]+\)/gi, ' ').replace(/\s+/g, ' ').trim() : s;
}

function isWindows(platform) {
  return (platform || process.platform) === 'win32';
}

// POSIX / bash-style quoting (macOS, Linux, Git Bash).
function shellQuotePosix(s) {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

// cmd.exe quoting — double quotes; escape embedded quotes as "".
function shellQuoteCmd(s) {
  return /^[A-Za-z0-9_@%+=:,.\\/-]+$/.test(s) ? s : `"${String(s).replace(/"/g, '""')}"`;
}

function shellQuote(s, platform) {
  return isWindows(platform) ? shellQuoteCmd(s) : shellQuotePosix(s);
}

function buildCommandLine(t, platform) {
  let line = t.command;
  if (t.args.length) line += ' ' + t.args.map((a) => shellQuote(a, platform)).join(' ');
  const env = t.options && t.options.env && typeof t.options.env === 'object' ? t.options.env : undefined;
  if (env) {
    const entries = Object.entries(env);
    if (entries.length) {
      if (isWindows(platform)) {
        const prefix = entries
          .map(([k, v]) => `set ${shellQuoteCmd(k + '=' + String(v))}`)
          .join(' && ');
        line = `${prefix} && ${line}`;
      } else {
        const prefix = entries
          .map(([k, v]) => `${k}=${shellQuotePosix(String(v))}`)
          .join(' ');
        line = `${prefix} ${line}`;
      }
    }
  }
  return line;
}

function cdAndRun(cwd, commandLine, platform) {
  if (isWindows(platform)) {
    return `cd /d ${shellQuoteCmd(cwd)} && ${commandLine}`;
  }
  return `cd ${shellQuotePosix(cwd)} && ${commandLine}`;
}

function getTerminal(g) {
  if (g.terminal && vscode.window.terminals.indexOf(g.terminal) >= 0) return g.terminal;
  const opts = { name: g.termName, cwd: g.folder.uri };
  // Pin cmd.exe on Windows so cd /d + set + && match the lines we send.
  if (isWindows()) {
    opts.shellPath = process.env.ComSpec || 'cmd.exe';
  }
  g.terminal = vscode.window.createTerminal(opts);
  return g.terminal;
}

async function runTask(g, index) {
  const raw = g.tasks[index];
  if (!raw) return;
  const t = resolveTask(raw);
  collapse(g);
  try {
    if (t.vscommand) {
      await vscode.commands.executeCommand(t.vscommand, ...t.args);
      return;
    }
    const cwdOpt = t.options && typeof t.options.cwd === 'string' ? t.options.cwd : '.';
    const cwd = path.resolve(g.folder.uri.fsPath, cwdOpt);
    const term = getTerminal(g);
    term.show(true); // reveal without stealing focus
    term.sendText(cdAndRun(cwd, buildCommandLine(t), process.platform), true);
  } catch (e) {
    vscode.window.showErrorMessage(
      `Build Tasks: failed to run "${t.label}": ${e && e.message ? e.message : e}`
    );
  }
}

// ---------- lifecycle ----------

function disposeGroup(g) {
  if (g.timer) clearTimeout(g.timer);
  for (const item of g.expandedItems) item.dispose();
  if (g.labelItem) g.labelItem.dispose();
  if (g.chevronItem) g.chevronItem.dispose();
}

function scheduleRebuild() {
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    rebuildTimer = undefined;
    rebuild();
  }, 250);
}

function watchPattern() {
  let rel = DEFAULT_FILE_PATH;
  try {
    rel = vscode.workspace.getConfiguration('buildTasks').get('filePath', DEFAULT_FILE_PATH);
  } catch (e) {
    // fall back to the default path
  }
  return '**/' + rel.replace(/^\.\//, '').replace(/^\/+/, '');
}

// buildtasks.json allows comments, so open editors of it should use the
// jsonc language mode — otherwise the strict JSON validator flags every
// comment with "Comments are not permitted in JSON".
function openAsJsonc(doc) {
  try {
    if (!doc || !doc.uri || doc.uri.scheme !== 'file' || doc.languageId !== 'json') return;
    if (typeof vscode.languages.setTextDocumentLanguage !== 'function') return;
    const rel = vscode.workspace
      .getConfiguration('buildTasks', doc.uri)
      .get('filePath', DEFAULT_FILE_PATH);
    if (path.basename(doc.uri.fsPath) !== path.basename(rel)) return;
    const p = vscode.languages.setTextDocumentLanguage(doc, 'jsonc');
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (e) {
    // cosmetic only — never fail because of language switching
  }
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD_RUN_DEFAULT, (key) => {
      const g = groups.get(key);
      if (g) runTask(g, g.defaultIndex);
    }),
    vscode.commands.registerCommand(CMD_TOGGLE, toggleGroup),
    vscode.commands.registerCommand(CMD_RUN, (key, index) => {
      const g = groups.get(key);
      if (g) runTask(g, index);
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(scheduleRebuild),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('buildTasks')) scheduleRebuild();
    }),
    vscode.window.onDidCloseTerminal((t) => {
      for (const g of groups.values()) {
        if (g.terminal === t) g.terminal = undefined;
      }
    })
  );

  // Some VS Code forks (Cursor) lack window.onDidOpenTextDocument; prefer the
  // workspace variant and degrade gracefully if both are missing.
  const onOpen =
    typeof vscode.workspace.onDidOpenTextDocument === 'function'
      ? vscode.workspace.onDidOpenTextDocument
      : typeof vscode.window.onDidOpenTextDocument === 'function'
        ? vscode.window.onDidOpenTextDocument
        : undefined;
  if (onOpen) context.subscriptions.push(onOpen(openAsJsonc));

  if (Array.isArray(vscode.workspace.textDocuments)) {
    for (const doc of vscode.workspace.textDocuments) openAsJsonc(doc);
  }

  configWatcher = vscode.workspace.createFileSystemWatcher(watchPattern());
  configWatcher.onDidChange(scheduleRebuild);
  configWatcher.onDidCreate(scheduleRebuild);
  configWatcher.onDidDelete(scheduleRebuild);
  context.subscriptions.push(configWatcher);

  rebuild();
}

function deactivate() {
  if (rebuildTimer) clearTimeout(rebuildTimer);
  for (const g of groups.values()) disposeGroup(g);
  groups.clear();
  if (configWatcher) {
    configWatcher.dispose();
    configWatcher = undefined;
  }
}

module.exports = {
  activate,
  deactivate,
  // exported for tests
  resolveTask,
  platformKey,
  buildCommandLine,
  cdAndRun,
};
