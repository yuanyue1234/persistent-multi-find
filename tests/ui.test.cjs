const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
const terms = () => ['A','B','C'].map((keyword, index) => ({ id: keyword, keyword, replacement: 'X', color: ['#ffe066','#74c0fc','#8ce99a'][index], enabled: true, regex: false, exclusions: [] }));
async function popup(t, query = '') {
  const dom = new JSDOM(read('popup.html'), { url: 'https://extension.test/popup.html' + query, runScripts: 'outside-only' });
  const w = dom.window; t.after(() => w.close()); w.structuredClone = structuredClone;
  let data = { schemes: [{ id: 'one', name: '方案一', terms: terms() }], activeSchemeId: 'one', enabled: true, caseSensitive: false };
  const listeners = [], calls = [];
  const set = async value => {
    const changes = Object.fromEntries(Object.entries(value).map(([key, val]) => [key, { newValue: structuredClone(val) }]));
    data = { ...data, ...structuredClone(value) };
    listeners.forEach(fn => fn(changes, 'local'));
  };
  w.chrome = {
    runtime: { getURL: name => 'chrome-extension://test/' + name },
    storage: { local: { get: async defaults => ({ ...defaults, ...structuredClone(data) }), set }, onChanged: { addListener: fn => listeners.push(fn), testEmit: (changes, area) => listeners.forEach(fn => fn(changes, area)) } },
    tabs: { query: async () => [{ id: 99, windowId: 2 }], get: async id => ({ id, windowId: 1 }), sendMessage: async (id, message) => { calls.push({ id, message }); return { count: 0 }; } },
    windows: { create: async options => { calls.push({ window: options }); } },
    sidePanel: { setOptions: async () => {}, open: async options => { calls.push({ side: options }); } }
  };
  w.close = dom.window.close.bind(w);
  for (const name of ['view.js','palette.js','rules.js','materials.js','popup.js','workspace.js']) w.eval(read(name));
  await tick();
  return { w, doc: w.document, data: () => data, calls, set };
}
test('import panel has close and escape', async t => {
  const e = await popup(t);
  e.doc.getElementById('toggleImportButton').click();
  assert.equal(e.doc.getElementById('importPanel').hidden, false);
  e.doc.getElementById('closeImportButton').click();
  assert.equal(e.doc.getElementById('importPanel').hidden, true);
  e.doc.getElementById('toggleImportButton').click();
  e.doc.dispatchEvent(new e.w.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(e.doc.getElementById('importPanel').hidden, true);
});
test('keyboard ordering saves full rule objects including colors', async t => {
  const e = await popup(t);
  e.doc.querySelector('.drag-handle').dispatchEvent(new e.w.KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }));
  await tick();
  assert.deepEqual(e.data().schemes[0].terms.map(term => term.id), ['B','A','C']);
  assert.equal(e.data().schemes[0].terms[1].color, '#ffe066');
});
test('pointer handle reorders without making inputs draggable', async t => {
  const e = await popup(t);
  const rows = e.doc.querySelectorAll('.term'), handle = rows[0].querySelector('.drag-handle');
  handle.setPointerCapture = () => {}; handle.hasPointerCapture = () => false;
  e.doc.elementFromPoint = () => rows[1];
  rows[1].getBoundingClientRect = () => ({ top: 10, height: 30 });
  handle.dispatchEvent(new e.w.MouseEvent('pointerdown', { bubbles: true, button: 0 }));
  handle.dispatchEvent(new e.w.MouseEvent('pointermove', { bubbles: true, clientY: 35 }));
  handle.dispatchEvent(new e.w.MouseEvent('pointerup', { bubbles: true }));
  await tick();
  assert.deepEqual(e.data().schemes[0].terms.map(term => term.id), ['B','A','C']);
  assert.equal(rows[0].querySelector('.term-keyword').draggable, false);
});
test('persistent view receives externally added terms without overwriting storage', async t => {
  const e = await popup(t);
  const changed = structuredClone(e.data().schemes); changed[0].terms.push({ ...terms()[0], id: 'new', keyword: '新词' });
  await e.set({ schemes: changed }); await tick();
  assert.equal(e.doc.querySelectorAll('.term').length, 4);
  assert.equal(e.data().schemes[0].terms.length, 4);
});
test('detached view messages its original tab, not its own active tab', async t => {
  const e = await popup(t, '?view=window&tabId=42');
  await e.w.eval('send({type:"readMaterials"})');
  assert.equal(e.calls.at(-1).id, 42);
  assert.equal(e.doc.documentElement.classList.contains('persistent-view'), true);
  assert.equal(e.doc.getElementById('detachButton').disabled, true);
});
test('native window and sidebar calls use the originating browser context', async t => {
  const e = await popup(t, '?view=side');
  e.doc.getElementById('detachButton').click(); await tick();
  assert.match(e.calls.find(call => call.window).window.url, /tabId=99/);
  e.doc.getElementById('sidePanelButton').click(); await tick();
  assert.equal(e.calls.find(call => call.side).side.windowId, 2);
});
test('explicit deletion setting is visible and round trips through text export', async t => {
  const e = await popup(t);
  e.doc.querySelector('.term-exclude').click();
  e.doc.getElementById('deleteMatchInput').checked = true;
  e.doc.getElementById('saveExcludeButton').click(); await tick();
  assert.equal(e.data().schemes[0].terms[0].deleteMatch, true);
  assert.equal(e.doc.querySelector('.replace-one').textContent, '删除');
  e.doc.getElementById('toggleImportButton').click();
  assert.match(e.doc.getElementById('batchInput').value, /A - \| \{\{删除\}\}/);
  e.doc.getElementById('batchInput').value = 'A - | ';
  e.doc.getElementById('importButton').click(); await tick();
  assert.equal(e.data().schemes[0].terms[0].deleteMatch, false);
  assert.equal(e.data().schemes[0].terms[0].replacement, '');
});
test('scheme arrows and wheel can navigate back to beginning', async t => {
  const e = await popup(t); const tabs = e.doc.getElementById('schemeTabs');
  tabs.scrollBy = ({ left }) => { tabs.scrollLeft += left; };
  e.doc.getElementById('schemesRight').click(); assert.equal(tabs.scrollLeft, 180);
  e.doc.getElementById('schemesLeft').dispatchEvent(new e.w.MouseEvent('dblclick'));
  assert.equal(tabs.scrollLeft, 0);
  Object.defineProperty(tabs, 'scrollWidth', { value: 1000 });
  tabs.dispatchEvent(new e.w.WheelEvent('wheel', { deltaY: 70, cancelable: true }));
  assert.equal(tabs.scrollLeft, 70);
});
test('background quick add uses current scheme, auto-binds exact material, deduplicates', async () => {
  let data = { schemes: [{ id: 'one', name: '方案一', terms: [] }], activeSchemeId: 'one' };
  let receive;
  const chrome = {
    runtime: { onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onMessage: { addListener: fn => { receive = fn; } } },
    contextMenus: { removeAll: async () => {}, create() {}, onClicked: { addListener() {} } },
    storage: { local: { get: async defaults => ({ ...defaults, ...data }), set: async val => { data = { ...data, ...val }; } }, onChanged: { addListener() {} } },
    tabs: { sendMessage: async (_id, message) => message.type === 'readMaterials' ? { items: [{ name: '凯尔-9', replacement: '{{图片:凯尔-9}}' }] } : {} }
  };
  vm.runInNewContext(read('palette.js') + read('background.js'), { chrome, importScripts() {} });
  const send = () => new Promise(resolve => receive({ type: 'quickAddSelection', text: '凯尔-9' }, { tab: { id: 42 }, frameId: 0 }, resolve));
  await Promise.all([send(), send()]);
  assert.equal(data.schemes[0].terms.length, 1);
  assert.equal(data.schemes[0].terms[0].replacement, '{{图片:凯尔-9}}');
});

test('typing retains the input node, focus and caret after delayed storage notifications', async t => {
  const e = await popup(t);
  const input = e.doc.querySelector('.term-replacement');
  input.focus();
  const stale = structuredClone(e.data().schemes);
  for (const value of ['张', '张小', '张小乙']) {
    input.value = value;
    input.dispatchEvent(new e.w.Event('input', { bubbles: true }));
  }
  input.setSelectionRange(2, 2);
  e.w.eval(`chrome.storage.onChanged.testEmit({ schemes: { newValue: ${JSON.stringify(stale)} } }, 'local')`);
  await tick();
  assert.equal(e.doc.querySelector('.term-replacement'), input);
  assert.equal(e.doc.activeElement, input);
  assert.equal(input.selectionStart, 2);
  assert.equal(input.value, '张小乙');
});

test('default replacement, select on entry, compact mode, wrapping and theme persist', async t => {
  const e = await popup(t);
  e.doc.getElementById('keywordInput').value = '张小乙';
  e.doc.getElementById('addButton').click(); await tick();
  const row = e.doc.querySelector('.term:last-child');
  const input = row.querySelector('.term-replacement');
  assert.equal(input.value, '张小乙');
  input.focus();
  assert.equal(input.selectionStart, 0);
  assert.equal(input.selectionEnd, 3);
  row.querySelector('.term-wrap').click();
  assert.equal(input.value, '[张小乙]');
  row.querySelector('.term-toggle').click();
  assert.equal(row.classList.contains('compact'), true);
  assert.equal(e.data().schemes[0].terms.at(-1).compact, true);
  row.querySelector('.term-toggle').click();
  assert.equal(input.value, '[张小乙]');
  assert.equal(e.doc.documentElement.classList.contains('dark'), true);
  e.doc.getElementById('themeButton').click();
  assert.equal(e.data().darkMode, false);
});

test('custom wrappers and regex transform replacement text; invalid regex preserves settings', async t => {
  const e = await popup(t);
  const row = e.doc.querySelector('.term');
  row.querySelector('.wrap-config').click();
  e.doc.getElementById('wrap-prefix').value = '【';
  e.doc.getElementById('wrap-suffix').value = '】';
  e.doc.getElementById('saveWrapButton').click();
  row.querySelector('.term-wrap').click();
  assert.equal(row.querySelector('.term-replacement').value, '【X】');
  row.querySelector('.wrap-config').click();
  e.doc.getElementById('wrap-pattern').value = '(X)';
  e.doc.getElementById('wrap-template').value = '[$1]';
  e.doc.getElementById('saveWrapButton').click();
  row.querySelector('.term-wrap').click();
  assert.equal(row.querySelector('.term-replacement').value, '【[X]】');
  row.querySelector('.wrap-config').click();
  e.doc.getElementById('wrap-pattern').value = '[';
  e.doc.getElementById('saveWrapButton').click();
  assert.equal(e.doc.getElementById('wrapPanel').hidden, false);
  assert.equal(e.data().wrapSettings.pattern, '(X)');
});


test('Chinese composition and an in-flight sync do not replace the focused input', async t => {
  const e = await popup(t);
  const input = e.doc.querySelector('.term-replacement');
  input.focus();
  input.dispatchEvent(new e.w.CompositionEvent('compositionstart', { bubbles: true }));
  const pendingLoad = e.w.eval('load(false)');
  input.value = '小晴';
  input.dispatchEvent(new e.w.InputEvent('input', { bubbles: true, isComposing: true }));
  await pendingLoad;
  input.dispatchEvent(new e.w.CompositionEvent('compositionend', { bubbles: true, data: '小晴' }));
  assert.equal(e.doc.activeElement, input);
  assert.equal(e.data().schemes[0].terms[0].replacement, '小晴');
});

test('brackets apply once even after a re-render; empty input is visibly deletion', async t => {
  const e = await popup(t);
  const clickWrap = () => e.doc.querySelector('.term-wrap').click();
  clickWrap(); clickWrap();
  assert.equal(e.doc.querySelector('.term-replacement').value, '[X]');
  e.w.eval('render()'); clickWrap();
  assert.equal(e.doc.querySelector('.term-replacement').value, '[X]');
  const input = e.doc.querySelector('.term-replacement');
  input.value = ''; input.dispatchEvent(new e.w.Event('input', { bubbles:true }));
  assert.equal(e.doc.querySelector('.replace-one').textContent, '删除');
  assert.equal(e.doc.querySelector('.term').classList.contains('delete-mode'), true);
});

test('highlight-only mode is excluded from batch preview and survives export/import', async t => {
  const e = await popup(t);
  e.doc.querySelector('.term-toggle svg path').dispatchEvent(new e.w.MouseEvent('click', { bubbles:true }));
  assert.equal(e.doc.querySelector('.term-toggle').getAttribute('aria-expanded'), 'false');
  e.doc.getElementById('replaceAllButton').click(); await tick();
  assert.deepEqual(Array.from(e.calls.find(call => call.message?.type === 'previewReplace').message.ids), ['B','C']);
  e.doc.getElementById('toggleImportButton').click();
  assert.match(e.doc.getElementById('batchInput').value, /A - \| \{\{仅高亮\}\}X/);
  e.doc.getElementById('importButton').click(); await tick();
  assert.equal(e.data().schemes[0].terms[0].compact, true);
  assert.equal(e.data().schemes[0].terms[0].replacement, 'X');
});

test('storage key reordering never rebuilds the active replacement input', async t => {
  const e = await popup(t); const input = e.doc.querySelector('.term-replacement'); input.focus();
  const reorder = value => Array.isArray(value) ? value.map(reorder) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([k,v])=>[k,reorder(v)])) : value;
  input.value='连续'; input.dispatchEvent(new e.w.Event('input',{bubbles:true}));
  input.setSelectionRange(1,1);
  await e.set(reorder(e.data())); await tick();
  assert.equal(e.doc.querySelector('.term-replacement'),input);
  assert.equal(e.doc.activeElement,input); assert.equal(input.selectionStart,1);
  input.dispatchEvent(new e.w.MouseEvent('dblclick',{bubbles:true}));
  assert.equal(e.doc.getElementById('materialPanel').hidden,true);
});

test('replacement Ctrl+Z/Ctrl+Y restores typing and bracket edits without losing focus', async t => {
  const e=await popup(t);const input=e.doc.querySelector('.term-replacement');input.focus();
  for (const value of ['甲','甲乙']) {input.value=value;input.dispatchEvent(new e.w.Event('input',{bubbles:true}));}
  const key = (k, shift=false) => input.dispatchEvent(new e.w.KeyboardEvent('keydown',{key:k,ctrlKey:true,shiftKey:shift,bubbles:true}));
  key('z'); assert.equal(input.value,'甲'); key('y'); assert.equal(input.value,'甲乙');
  e.doc.querySelector('.term-wrap').click(); key('z'); assert.equal(input.value,'甲乙');
  key('z',true); assert.equal(input.value,'[甲乙]');
  assert.equal(e.data().schemes[0].terms[0].replacement,'[甲乙]');
});

test('project migration, switching and segment numbering preserve all original terms', async t => {
  const e=await popup(t); const first=e.data().activeProjectId;
  e.w.prompt=()=> '新项目';e.doc.getElementById('addProjectButton').click();await tick();
  assert.equal(e.doc.querySelector('.scheme-tab').textContent,'方案1');
  assert.equal(e.doc.querySelectorAll('.term').length,0);
  e.doc.getElementById('addSchemeButton').click();await tick();
  assert.deepEqual(Array.from(e.doc.querySelectorAll('.scheme-tab'),x=>x.textContent),['方案1','方案2']);
  const second=e.data().activeProjectId;
  const select=e.doc.getElementById('projectSelect');select.value=first;select.dispatchEvent(new e.w.Event('change'));await tick();
  assert.equal(e.doc.querySelectorAll('.term').length,3);
  select.value=second;select.dispatchEvent(new e.w.Event('change'));await tick();
  assert.equal(e.doc.querySelector('.scheme-tab.active').textContent,'方案2');
});

test('single and batch append use the append preview mode', async t => {
  const e=await popup(t);e.doc.querySelector('.append-one').click();await tick();
  let call=e.calls.find(c=>c.message?.type==='previewReplace'); assert.equal(call.message.mode,'append');
  assert.match(e.doc.getElementById('previewTitle').textContent,/追加/);
  e.doc.getElementById('cancelPreviewButton').click();e.doc.getElementById('appendAllButton').click();await tick();
  call=e.calls.filter(c=>c.message?.type==='previewReplace').at(-1);assert.equal(call.message.ids.length,3);
  assert.equal(e.doc.getElementById('clearButton').parentElement.className,'count-tools');
});

test('automatic colors stay unique beyond 20 items and preserve existing choices', async t => {
  const e=await popup(t); const items=[];
  for(let i=0;i<40;i++) items.push({color:e.w.PmfColors.next(items)});
  assert.equal(new Set(items.map(t=>t.color)).size,40);
  assert.equal(items[0].color,'#ffe066');
});
