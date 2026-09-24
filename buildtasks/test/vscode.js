'use strict';
// Mock of the vscode API used by extension.js, with test-visible state.
const state = {
  items: [],        // live status bar items
  terminals: [],    // created terminals + their sendText payloads
  errors: [],
  warnings: [],
  handlers: {},     // registered command handlers
  docs: [],         // open text documents
};

class MockUri {
  constructor(p) { this.fsPath = p; this.scheme = 'file'; }
  toString() { return 'file://' + this.fsPath; }
}

class MockItem {
  constructor(alignment, priority) {
    this.alignment = alignment;
    this.priority = priority;
    this._text = '';
    this.command = undefined;
    this.tooltip = undefined;
  }
  get text() { return this._text; }
  set text(v) { this._text = v; }
  show() { if (!state.items.includes(this)) state.items.push(this); }
  dispose() { const i = state.items.indexOf(this); if (i >= 0) state.items.splice(i, 1); }
}

module.exports = {
  Uri: { file: (p) => new MockUri(p) },
  StatusBarAlignment: { Left: 1, Right: 2 },
  commands: {
    registerCommand: (id, fn) => { state.handlers[id] = fn; return { dispose() {} }; },
    executeCommand: async () => {},
  },
  languages: {
    // sync language switch, like the real API's thenable but resolved in place
    setTextDocumentLanguage: (doc, lang) => { doc.languageId = lang; return Promise.resolve(doc); },
  },
  workspace: {
    get workspaceFolders() { return state.folders || []; },
    set workspaceFolders(v) { state.folders = v; },
    get textDocuments() { return state.docs || []; },
    getConfiguration: () => ({ get: (k, d) => d }), // always defaults
    onDidOpenTextDocument: (fn) => { state.openDocHandler = fn; return { dispose() {} }; },
    onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
    createFileSystemWatcher: () => ({ onDidChange() {}, onDidCreate() {}, onDidDelete() {}, dispose() {} }),
  },
  window: {
    terminals: [],
    createStatusBarItem: (a, p) => new MockItem(a, p),
    createTerminal: (opts) => {
      const t = { name: opts.name, cwd: opts.cwd, texts: [], show() {}, sendText(txt) { t.texts.push(txt); } };
      state.terminals.push(t);
      module.exports.window.terminals.push(t);
      return t;
    },
    onDidOpenTextDocument: (fn) => { state.openDocHandler = fn; return { dispose() {} }; },
    showErrorMessage: (m) => state.errors.push(m),
    showWarningMessage: (m) => state.warnings.push(m),
    onDidCloseTerminal: () => ({ dispose() {} }),
  },
  __test: state,
};
module.exports.window.terminals.length = 0;
