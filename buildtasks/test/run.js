'use strict';
// Functional test: drive the real extension.js against the real project dirs
// by redirecting require('vscode') to the mock above. Run with VS Code's own
// engine (no Node needed):
//   ELECTRON_RUN_AS_NODE=1 "/Applications/Visual Studio Code.app/Contents/MacOS/Code" test/run.js
const Module = require('module');
const path = require('path');
const fs = require('fs');
const origResolve = Module._resolveFilename;
// NB: return the REALPATH of the mock — resolving through a /tmp symlink would
// create a second module instance, and the test would read a different mock
// state than the one extension.js writes to.
const MOCK = fs.realpathSync(path.join(__dirname, 'vscode.js'));
const EXT = fs.realpathSync(path.join(__dirname, '..', 'extension.js'));
Module._resolveFilename = function (request, ...rest) {
  if (request === 'vscode') return MOCK;
  return origResolve.call(this, request, ...rest);
};

const ext = require(EXT);
const vscode = require(MOCK);
const state = vscode.__test;

let failed = 0;
function check(name, cond, detail) {
  if (!cond) { console.error('FAIL:', name, detail !== undefined ? JSON.stringify(detail) : ''); failed++; }
}

// --- Test A: parent GD32 folder open -> one button per sub-project ---
state.folders = [{ uri: vscode.Uri.file('/Users/andy/HoyeProjects/GD32'), name: 'GD32' }];
ext.activate({ subscriptions: [] });
const texts = state.items.map((i) => i.text);
check('6 items for 3 sub-projects', state.items.length === 6, texts);
check('3 distinct chip labels', new Set(texts.filter((t) => t.startsWith('$(chip) '))).size === 3, texts);
check('chip icons on labels', texts.filter((t) => t.startsWith('$(chip) ')).length === 3, texts);
check('3 chevrons', texts.filter((t) => t === '$(chevron-down)').length === 3, texts);
check('no errors', state.errors.length === 0, state.errors);
const c231fLabel = state.items.find((i) => i.tooltip && i.tooltip.includes('HEI_V_C231F_V3_R3'));
check('label tooltip names project + folder', !!c231fLabel && /E230|G230|C231F/.test(c231fLabel.text) && c231fLabel.tooltip.includes('('), c231fLabel && c231fLabel.tooltip);
const chev = state.items.find((i) => i.text === '$(chevron-down)');
check('chevron tooltip names project', !!chev && /E230|G230|C231F/.test(chev.tooltip), chev && chev.tooltip);

// --- Test B: expand + run default on C231F ---
const keyC231F = 'file:///Users/andy/HoyeProjects/GD32/HEI_V_C231F_V3_R3';
state.handlers['buildTasks.toggle'](keyC231F);
const expandedTexts = state.items.map((i) => i.text);
check('expanded to 3 task buttons (default skipped)', state.items.length === 9, expandedTexts);
check('chevron flipped up', expandedTexts.some((i) => i === '$(chevron-up)'), expandedTexts);
check('non-default tasks shown', ['$(gear) Build Release', '$(trash) Clear', '$(play) Flash Debug'].every((l) => expandedTexts.includes(l)), expandedTexts);
check('default task not duplicated in row', !expandedTexts.includes('$(gear) Build Debug'), expandedTexts);

(async () => {
  await state.handlers['buildTasks.runDefault'](keyC231F);
  const term = state.terminals.find((t) => t.name === 'C231F');
  check('terminal named C231F', !!term, state.terminals.map((t) => t.name));
  check(
    'default command is build debug in project dir',
    term && term.texts[0] === 'cd /Users/andy/HoyeProjects/GD32/HEI_V_C231F_V3_R3 && ./Tools/build.sh Debug',
    term && term.texts[0]
  );
  // running the default collapses the row again
  check('collapsed after run', state.items.length === 6, state.items.map((i) => i.text));

  // --- Test C: single project folder open (STM32 G031) ---
  ext.deactivate();
  state.items.length = 0; state.terminals.length = 0; vscode.window.terminals.length = 0;
  state.folders = [{ uri: vscode.Uri.file('/Users/andy/HoyeProjects/STM32/HEI_V_G031F8Px_V3_R3'), name: 'HEI_V_G031F8Px_V3_R3' }];
  ext.activate({ subscriptions: [] });
  const t2 = state.items.map((i) => i.text);
check('single project: 2 items', state.items.length === 2, t2);
check('single project label with icon', t2[0].startsWith('$(chip) ') && t2[0].includes('G031'), t2);

  // --- Test D: parent with one bad + one good sub config ---
  const fs = require('fs');
  const root = '/tmp/bt-mock-test/fakeroot';
  fs.mkdirSync(root + '/goodsub/.vscode', { recursive: true });
  fs.mkdirSync(root + '/badsub/.vscode', { recursive: true });
  fs.writeFileSync(root + '/goodsub/.vscode/buildtasks.json',
    '{"tasks":[{"label":"First","command":"echo 1"},{"label":"$(gear) Good","detail":"$(play) detail","command":"echo 2"}]}');
  fs.mkdirSync(root + '/singlesub/.vscode', { recursive: true });
  fs.writeFileSync(root + '/singlesub/.vscode/buildtasks.json', '{"tasks":[{"label":"Only","command":"echo x"}]}');
  fs.writeFileSync(root + '/badsub/.vscode/buildtasks.json', '{oops');
  fs.writeFileSync(root + '/emptysub-placeholder', ''); // ensure non-dir entries ignored
  ext.deactivate();
  state.items.length = 0; state.errors.length = 0; state.warnings.length = 0;
  state.folders = [{ uri: vscode.Uri.file(root), name: 'fakeroot' }];
  ext.activate({ subscriptions: [] });
  const t3 = state.items.map((i) => i.text);
  check('bad config reported', state.errors.some((m) => m.includes('badsub')), state.errors);
  check('good sub still built', t3.includes('goodsub'), t3);
  check('single-task project has no chevron', t3.length === 3 && t3.includes('singlesub') && t3.includes('$(chevron-down)'), t3); // chevron belongs to goodsub only
  check('bad sub produced no button', !t3.includes('badsub'), t3);

  // codicon task label: text keeps $(gear), tooltip strips it
  const keyGood = 'file://' + root + '/goodsub';
  state.handlers['buildTasks.toggle'](keyGood);
  const gearItem = state.items.find((i) => i.text === '$(gear) Good');
  check('codicon label kept in button text', !!gearItem, state.items.map((i) => i.text));
  check('codicon stripped from tooltip', !!gearItem && gearItem.tooltip === 'goodsub — detail', gearItem && gearItem.tooltip);
  state.handlers['buildTasks.toggle'](keyGood);

  // main button tooltip is exactly 2 lines, no arrow hint
  const goodLabel = state.items.find((i) => i.text === 'goodsub');
  check('label tooltip has 2 lines', !!goodLabel && goodLabel.tooltip.split('\n').length === 2, goodLabel && goodLabel.tooltip);
  check('label tooltip no arrow hint', !!goodLabel && !goodLabel.tooltip.includes('arrow'), goodLabel && goodLabel.tooltip);

  // --- Test E: open buildtasks.json docs get switched to jsonc ---
  state.docs = [
    { uri: vscode.Uri.file('/Users/andy/HoyeProjects/GD32/HEI_V_C231F_V3_R3/.vscode/buildtasks.json'), languageId: 'json' },
    { uri: vscode.Uri.file('/Users/andy/HoyeProjects/other/package.json'), languageId: 'json' },
    { uri: vscode.Uri.file('/Users/andy/HoyeProjects/GD32/HEI_V_G230_V3_R3/.vscode/buildtasks.json'), languageId: 'jsonc' },
  ];
  ext.deactivate();
  state.items.length = 0;
  ext.activate({ subscriptions: [] });
  check('buildtasks.json switched to jsonc', state.docs[0].languageId === 'jsonc', state.docs.map((d) => d.languageId));
  check('package.json left as json', state.docs[1].languageId === 'json', state.docs.map((d) => d.languageId));
  check('already-jsonc untouched', state.docs[2].languageId === 'jsonc', state.docs.map((d) => d.languageId));
  // and docs opened later via onDidOpenTextDocument
  const later = { uri: vscode.Uri.file('/Users/andy/HoyeProjects/CH32/HEI_V_V203C8_V3/.vscode/buildtasks.json'), languageId: 'json' };
  state.openDocHandler(later);
  check('onDidOpen switch works', later.languageId === 'jsonc', later.languageId);

  // --- Test F: Cursor fork simulation — window.onDidOpenTextDocument missing ---
  ext.deactivate();
  delete vscode.window.onDidOpenTextDocument;
  state.docs = [{ uri: vscode.Uri.file('/Users/andy/HoyeProjects/STM32/HXS_G031C8Tx_V3_R4/.vscode/buildtasks.json'), languageId: 'json' }];
  state.items.length = 0;
  ext.activate({ subscriptions: [] }); // must not throw
  check('Cursor fork: activation survives without window API', true);
  check('Cursor fork: doc switched via workspace API', state.docs[0].languageId === 'jsonc', state.docs.map((d) => d.languageId));

  // --- Test G: platform blocks (macos / windows / linux) ---
  check('darwin maps to macos', ext.platformKey('darwin') === 'macos');
  const shared = {
    label: 'Build',
    args: ['Debug'],
    options: {},
    platforms: {
      macos: { command: './Tools/build.sh' },
      windows: { command: '.\\Tools\\build.cmd' },
      linux: { command: './Tools/build.sh' },
    },
  };
  const onMac = ext.resolveTask(shared, 'darwin');
  check('macos picks macos command', onMac.command === './Tools/build.sh' && onMac.args.join(' ') === 'Debug', onMac);
  const onWin = ext.resolveTask(shared, 'win32');
  check('win32 picks windows command', onWin.command === '.\\Tools\\build.cmd' && onWin.args.join(' ') === 'Debug', onWin);
  const winOverride = {
    label: 'Build',
    args: ['Debug'],
    options: {},
    platforms: {
      windows: { command: '.\\Tools\\build.cmd', args: ['Debug', '--verbose'] },
    },
    command: './Tools/build.sh',
  };
  const winRes = ext.resolveTask(winOverride, 'win32');
  check('windows args override shared', winRes.args.join(' ') === 'Debug --verbose', winRes.args);
  const macRes = ext.resolveTask(winOverride, 'darwin');
  check('macos keeps shared command+args', macRes.command === './Tools/build.sh' && macRes.args.join(' ') === 'Debug', macRes);

  check(
    'posix cd+run',
    ext.cdAndRun('/tmp/proj', './Tools/build.sh Debug', 'darwin') ===
      'cd /tmp/proj && ./Tools/build.sh Debug'
  );
  check(
    'windows cd+run uses cd /d',
    ext.cdAndRun('C:\\proj', '.\\Tools\\build.cmd Debug', 'win32') ===
      'cd /d C:\\proj && .\\Tools\\build.cmd Debug'
  );
  check(
    'windows env prefix uses set',
    ext.buildCommandLine(
      { command: 'echo', args: ['x'], options: { env: { BOARD: 'C231F' } } },
      'win32'
    ) === 'set BOARD=C231F && echo x'
  );

  // live run with macos/windows config file
  const platRoot = '/tmp/bt-mock-test/platroot';
  fs.mkdirSync(platRoot + '/.vscode', { recursive: true });
  fs.writeFileSync(
    platRoot + '/.vscode/buildtasks.json',
    JSON.stringify({
      button: { label: 'Plat', default: 'Build' },
      tasks: [
        {
          label: 'Build',
          args: ['Debug'],
          macos: { command: './Tools/build.sh' },
          windows: { command: '.\\Tools\\build.cmd' },
          linux: { command: './Tools/build.sh' },
        },
      ],
    })
  );
  ext.deactivate();
  state.items.length = 0;
  state.terminals.length = 0;
  vscode.window.terminals.length = 0;
  state.folders = [{ uri: vscode.Uri.file(platRoot), name: 'platroot' }];
  ext.activate({ subscriptions: [] });
  await state.handlers['buildTasks.runDefault']('file://' + platRoot);
  const platTerm = state.terminals[0];
  const expectCmd =
    process.platform === 'win32'
      ? 'cd /d ' + platRoot + ' && .\\Tools\\build.cmd Debug'
      : 'cd ' + platRoot + ' && ./Tools/build.sh Debug';
  check('platform config runs OS-specific command', !!platTerm && platTerm.texts[0] === expectCmd, platTerm && platTerm.texts[0]);

  // --- Test H: button.default is an exact label; $(codicon) lives in `icon` ---
  const defRoot = '/tmp/bt-mock-test/defroot';
  fs.mkdirSync(defRoot + '/.vscode', { recursive: true });
  fs.writeFileSync(
    defRoot + '/.vscode/buildtasks.json',
    JSON.stringify({
      button: { label: 'SM2', default: 'Run SerialMonitor2' },
      tasks: [
        { label: 'Build', icon: '$(tools)', command: 'echo build' },
        { label: 'Run SerialMonitor2', icon: '$(play)', command: 'echo run' },
      ],
    })
  );
  ext.deactivate();
  state.items.length = 0;
  state.terminals.length = 0;
  vscode.window.terminals.length = 0;
  state.folders = [{ uri: vscode.Uri.file(defRoot), name: 'defroot' }];
  ext.activate({ subscriptions: [] });
  state.handlers['buildTasks.toggle']('file://' + defRoot);
  check(
    'expanded row uses icon + plain label',
    state.items.some((i) => i.text === '$(tools) Build'),
    state.items.map((i) => i.text)
  );
  await state.handlers['buildTasks.runDefault']('file://' + defRoot);
  const defTerm = state.terminals[0];
  const expectDef =
    process.platform === 'win32'
      ? 'cd /d ' + defRoot + ' && echo run'
      : 'cd ' + defRoot + ' && echo run';
  check(
    'default matches exact label when icon is a separate field',
    !!defTerm && defTerm.texts[0] === expectDef,
    defTerm && defTerm.texts[0]
  );

  // index also works, and a $(codicon) stuffed into `label` is NOT stripped to match
  const idxRoot = '/tmp/bt-mock-test/idxroot';
  fs.mkdirSync(idxRoot + '/.vscode', { recursive: true });
  fs.writeFileSync(
    idxRoot + '/.vscode/buildtasks.json',
    JSON.stringify({
      button: { default: 1 },
      tasks: [
        { label: '$(tools) Build', command: 'echo build' },
        { label: 'Run', command: 'echo run-idx' },
      ],
    })
  );
  ext.deactivate();
  state.items.length = 0;
  state.terminals.length = 0;
  vscode.window.terminals.length = 0;
  state.folders = [{ uri: vscode.Uri.file(idxRoot), name: 'idxroot' }];
  ext.activate({ subscriptions: [] });
  await state.handlers['buildTasks.runDefault']('file://' + idxRoot);
  const idxTerm = state.terminals[0];
  const expectIdx =
    process.platform === 'win32'
      ? 'cd /d ' + idxRoot + ' && echo run-idx'
      : 'cd ' + idxRoot + ' && echo run-idx';
  check('default: 1 runs the second task', !!idxTerm && idxTerm.texts[0] === expectIdx, idxTerm && idxTerm.texts[0]);

  const missRoot = '/tmp/bt-mock-test/missroot';
  fs.mkdirSync(missRoot + '/.vscode', { recursive: true });
  fs.writeFileSync(
    missRoot + '/.vscode/buildtasks.json',
    JSON.stringify({
      button: { default: 'Run' },
      tasks: [
        { label: '$(play) Run', command: 'echo first' },
        { label: 'Other', command: 'echo other' },
      ],
    })
  );
  ext.deactivate();
  state.items.length = 0;
  state.terminals.length = 0;
  vscode.window.terminals.length = 0;
  state.folders = [{ uri: vscode.Uri.file(missRoot), name: 'missroot' }];
  ext.activate({ subscriptions: [] });
  await state.handlers['buildTasks.runDefault']('file://' + missRoot);
  const missTerm = state.terminals[0];
  const expectMiss =
    process.platform === 'win32'
      ? 'cd /d ' + missRoot + ' && echo first'
      : 'cd ' + missRoot + ' && echo first';
  check(
    'default "Run" does not match label "$(play) Run"; falls back to first task',
    !!missTerm && missTerm.texts[0] === expectMiss,
    missTerm && missTerm.texts[0]
  );

  // --- Test I: parent + child both open (multi-root / worktree) → no dupes ---
  ext.deactivate();
  state.items.length = 0;
  state.errors.length = 0;
  state.folders = [
    { uri: vscode.Uri.file('/Users/andy/HoyeProjects/GD32/HEI_V_C231F_V3_R3'), name: 'HEI_V_C231F_V3_R3' },
    { uri: vscode.Uri.file('/Users/andy/HoyeProjects/GD32'), name: 'GD32' },
  ];
  ext.activate({ subscriptions: [] });
  const overlapTexts = state.items.map((i) => i.text);
  const overlapChips = overlapTexts.filter((t) => t.startsWith('$(chip) '));
  check('overlap: one C231F chip', overlapChips.filter((t) => t.includes('C231F')).length === 1, overlapTexts);
  check(
    'overlap: siblings still shown',
    overlapChips.some((t) => t.includes('E230G')) && overlapChips.some((t) => t.includes('E230K')),
    overlapTexts
  );
  check('overlap: 3 chips total', overlapChips.length === 3, overlapTexts);
  check('overlap: no leaked extras', overlapTexts.filter((t) => t === '$(chevron-down)').length === 3, overlapTexts);

  // Same folder listed twice in workspaceFolders (Cursor worktree quirk)
  ext.deactivate();
  state.items.length = 0;
  const twice = {
    uri: vscode.Uri.file('/Users/andy/HoyeProjects/GD32/HEI_V_C231F_V3_R3'),
    name: 'HEI_V_C231F_V3_R3',
  };
  state.folders = [twice, twice];
  ext.activate({ subscriptions: [] });
  const twiceTexts = state.items.map((i) => i.text);
  check(
    'duplicate workspace entry: one chip + one chevron',
    twiceTexts.filter((t) => t.startsWith('$(chip) ')).length === 1 &&
      twiceTexts.filter((t) => t === '$(chevron-down)').length === 1,
    twiceTexts
  );

  // Rebuild after overlap must not accumulate leaked items
  ext.deactivate();
  state.items.length = 0;
  state.folders = [
    { uri: vscode.Uri.file('/Users/andy/HoyeProjects/GD32/HEI_V_C231F_V3_R3'), name: 'HEI_V_C231F_V3_R3' },
    { uri: vscode.Uri.file('/Users/andy/HoyeProjects/GD32'), name: 'GD32' },
    { uri: vscode.Uri.file('/Users/andy/HoyeProjects/STM32/HEI_V_G031F8Px_V3_R3'), name: 'HEI_V_G031F8Px_V3_R3' },
  ];
  ext.activate({ subscriptions: [] });
  ext.deactivate();
  ext.activate({ subscriptions: [] });
  const rebuilt = state.items.map((i) => i.text);
  const rebuiltChips = rebuilt.filter((t) => t.startsWith('$(chip) '));
  check('rebuild overlap: still one C231F', rebuiltChips.filter((t) => t.includes('C231F')).length === 1, rebuilt);
  check('rebuild overlap: 4 chips (3 GD32 + G031)', rebuiltChips.length === 4, rebuilt);

  ext.deactivate();
  console.log(failed ? `${failed} FAILURES` : 'ALL TESTS PASSED');
  process.exit(failed ? 1 : 0);
})();
