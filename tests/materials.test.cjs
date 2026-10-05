const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const chip = (number, id) => `<span class="mention-chip" contenteditable="false" data-id="${id}"><img alt="">@图片${number}</span>`;
const header = `${chip(1, '2100561479451070464')} 是 凯尔-9，${chip(2, '2100561479451070465')} 是 雪莉-8，<span class="mention-chip" contenteditable="false">@音频1</span> 是 雪莉-8<br><br>`;
const rule = (keyword, name = keyword) => ({ id: keyword, keyword, replacement: `{{图片:${name}}}`, enabled: true, regex: false, exclusions: [], color: '#ffe066' });
function setup(t, html = header + '生成段1 | 0s—22s<br>凯尔-9牵着雪莉-8。凯尔-9停下。', terms = [rule('凯尔-9'), rule('雪莉-8')]) {
  const dom = new JSDOM(`<div id="left">凯尔-9</div><div id="editor" class="video-prompt-mention-editor__input" contenteditable="true">${html}</div>`, { url: 'https://example.test/', runScripts: 'outside-only' });
  const w = dom.window;
  t.after(() => w.close());
  w.HTMLElement.prototype.getClientRects = () => [{ width: 100, height: 100 }];
  w.CSS = { highlights: new Map() }; w.Highlight = class { add() {} };
  const listeners = []; let stored = { terms, enabled: true };
  w.chrome = { runtime: { onMessage: { addListener: fn => listeners.push(fn) } }, storage: {
    local: { get: async defaults => ({ ...defaults, ...stored }) }, onChanged: { addListener() {} }
  } };
  for (const file of ['rules.js', 'materials.js', 'content.js']) w.eval(read(file));
  const send = message => new Promise(resolve => listeners[0](message, {}, resolve));
  return { w, editor: w.document.getElementById('editor'), send,
    configure: terms => { stored = { ...stored, terms }; },
    preview: () => send({ type: 'previewReplace', ids: stored.terms.map(term => term.id) }),
    apply: plan => send({ type: 'applyReplace', planId: plan.planId }),
    undo: () => send({ type: 'undoReplacement' }) };
}
test('reads only image legend above heading; preserves long ID inside original chip', async t => {
  const e = setup(t);
  const data = await e.send({ type: 'readMaterials' });
  assert.equal(data.error, null);
  assert.deepEqual(Array.from(data.items, item => item.name), ['凯尔-9', '雪莉-8']);
  assert.ok(data.signature.includes('2100561479451070464'));
  assert.equal(data.items[0].replacement, '{{图片:凯尔-9}}');
});
test('preview is read-only; replaces body with actual chips, keeps header and sidebar, idempotent and undoable', async t => {
  const e = setup(t); const before = e.editor.innerHTML;
  let inputs = 0; e.editor.addEventListener('input', () => inputs++);
  const plan = await e.preview();
  assert.equal(plan.count, 3); assert.equal(e.editor.innerHTML, before);
  assert.match(plan.scope, /顶部素材说明不改/);
  assert.equal((await e.apply(plan)).count, 3);
  assert.equal(inputs, 1);
  const html = e.editor.innerHTML;
  assert.equal(html.split('生成段1')[0], before.split('生成段1')[0]);
  assert.equal(e.editor.querySelectorAll('[data-id="2100561479451070464"]').length, 3);
  assert.equal(e.w.document.getElementById('left').textContent, '凯尔-9');
  assert.equal((await e.preview()).count, 0);
  assert.equal((await e.undo()).restored, 3); assert.equal(e.editor.innerHTML, before);
});
test('alias is explicit and does not guess version', async t => {
  const e = setup(t, header + '生成段2｜0s<br>凯尔拉着雪莉。', [rule('凯尔', '凯尔-9')]);
  const plan = await e.preview(); assert.equal(plan.count, 1);
  await e.apply(plan); assert.ok(e.editor.textContent.includes('雪莉。'));
});
test('missing heading refuses named references', async t => {
  const e = setup(t, header + '凯尔-9');
  assert.match((await e.send({ type: 'readMaterials' })).error, /未找到/);
  assert.match((await e.preview()).error, /未找到/);
});
test('heading across spans recognized, header ordinary text replacements protected', async t => {
  const e = setup(t, `${header}<div><b>### 生成</b><span>段1｜测试</span></div><p>凯尔-9</p>`, [{ ...rule('凯尔-9'), replacement: '路人' }]);
  const plan = await e.preview(); assert.equal(plan.count, 1);
  await e.apply(plan); assert.ok(e.editor.textContent.includes('是 凯尔-9')); assert.ok(e.editor.textContent.endsWith('路人'));
});
test('new assets are read live and removed bindings reject replacement', async t => {
  const e = setup(t);
  e.editor.innerHTML = header.replace('是 凯尔-9', '是 凯尔-10') + '生成段1 | 测试<br>凯尔-9';
  const data = await e.send({ type: 'readMaterials' });
  assert.equal(data.items[0].name, '凯尔-10');
  assert.match((await e.preview()).error, /已移除/);
});
test('same name with different images blocks; identical repeated mapping deduplicates', async t => {
  const e = setup(t, header + chip(3, '333') + ' 是 凯尔-9，<br>生成段1 | 测试<br>凯尔-9');
  assert.equal((await e.send({ type: 'readMaterials' })).items[0].ambiguous, true);
  assert.match((await e.preview()).error, /同名冲突/);
  e.editor.innerHTML = header + chip(1, '2100561479451070464') + ' 是 凯尔-9，<br>生成段1 | 测试<br>凯尔-9';
  assert.equal((await e.send({ type: 'readMaterials' })).items[0].ambiguous, false);
});
test('header change after preview rejects stale plan', async t => {
  const e = setup(t); const plan = await e.preview();
  e.editor.querySelector('.mention-chip').setAttribute('data-id', '999');
  assert.match((await e.apply(plan)).error, /已变化/);
});
test('body edit after replacement blocks undo', async t => {
  const e = setup(t); await e.apply(await e.preview()); e.editor.append('新内容');
  assert.ok((await e.undo()).error); assert.ok(e.editor.textContent.endsWith('新内容'));
});
test('raw references preserve complete IDs and map names', async t => {
  const token = '[@凯尔-9#2100561479451070464]';
  const e = setup(t, token + '<br>生成段1 | 测试<br>凯尔-9', [rule('凯尔-9')]);
  assert.equal((await e.send({ type: 'readMaterials' })).items[0].name, '凯尔-9');
  const plan = await e.preview(); assert.equal(plan.count, 1); await e.apply(plan);
  assert.equal(e.editor.textContent.split(token).length - 1, 2);
});
test('plain @图片 text cannot fabricate a reference', async t => {
  const e = setup(t, '@图片1 是 凯尔-9<br>生成段1 | 测试<br>凯尔-9');
  assert.match((await e.send({ type: 'readMaterials' })).error, /未找到可复用/);
});
test('image name may be inside the original chip; audio references are ignored', async t => {
  const e = setup(t, '<span class="mention-chip" data-id="123" contenteditable="false">@图片1 是 凯尔-9</span>，雪莉的声音参考 [@雪莉#999]<br>生成段1 | 测试<br>凯尔-9', [rule('凯尔-9')]);
  const data = await e.send({ type: 'readMaterials' });
  assert.equal(data.items.length, 1); assert.equal(data.items[0].name, '凯尔-9');
  assert.equal((await e.preview()).count, 1);
});
test('copies reference attributes but strips executable attributes and duplicate DOM IDs', async t => {
  const e = setup(t);
  const chip = e.editor.querySelector('.mention-chip'); chip.id = 'original-chip'; chip.setAttribute('onclick', 'evil()');
  await e.apply(await e.preview());
  const copies = Array.from(e.editor.querySelectorAll('[data-id="2100561479451070464"]')).slice(1);
  assert.equal(copies.length, 2);
  for (const copy of copies) { assert.equal(copy.id, ''); assert.equal(copy.hasAttribute('onclick'), false); }
});
test('selection restricts matches inside a single text node', async t => {
  const e = setup(t, '凯尔-9 凯尔-9 凯尔-9', [{ ...rule('凯尔-9'), replacement: '他' }]);
  const range = e.w.document.createRange(); range.setStart(e.editor.firstChild, 5); range.setEnd(e.editor.firstChild, 9);
  e.w.getSelection().addRange(range);
  const plan = await e.preview(); assert.equal(plan.count, 1); assert.match(plan.scope, /仅选中/);
  await e.apply(plan); assert.equal(e.editor.textContent, '凯尔-9 他 凯尔-9');
});
test('selection spanning formatting nodes protects both ends and restores', async t => {
  const e = setup(t, '<span>AA</span><b>AA</b><span>AA</span>', [{ ...rule('A'), replacement: 'B' }]);
  const range = e.w.document.createRange(); range.setStart(e.editor.firstChild.firstChild, 1); range.setEnd(e.editor.lastChild.firstChild, 1);
  e.w.getSelection().addRange(range);
  const plan = await e.preview(); assert.equal(plan.count, 4);
  await e.apply(plan); assert.equal(e.editor.textContent, 'ABBBBA');
  await e.undo(); assert.equal(e.editor.textContent, 'AAAAAA');
});
test('selection at element boundaries excludes adjacent text', async t => {
  const e = setup(t, '<span>AA</span><b>AA</b><span>AA</span>', [{ ...rule('A'), replacement: 'B' }]);
  const range = e.w.document.createRange(); range.setStart(e.editor, 1); range.setEnd(e.editor, 2);
  e.w.getSelection().addRange(range);
  const plan = await e.preview(); assert.equal(plan.count, 2);
  await e.apply(plan); assert.equal(e.editor.textContent, 'AABBAA');
});
test('empty replacement deletes only within selected area', async t => {
  const e = setup(t, 'AA BB AA', [{ ...rule('AA'), replacement: '' }]);
  assert.equal((await e.preview()).count, 2);
  const range = e.w.document.createRange(); range.setStart(e.editor.firstChild, 0); range.setEnd(e.editor.firstChild, 2); e.w.getSelection().addRange(range);
  await e.apply(await e.preview()); assert.equal(e.editor.textContent, ' BB AA');
});
test('quick-add is explicit, uses small icon, never changes source text', async t => {
  const e = setup(t, '凯尔-9'); const sent = [];
  e.w.chrome.runtime.sendMessage = async msg => { sent.push(msg); return { added: true }; };
  e.w.Range.prototype.getBoundingClientRect = () => ({ left: 30, top: 30, bottom: 45 });
  const range = e.w.document.createRange(); range.selectNodeContents(e.editor); e.w.getSelection().addRange(range);
  e.editor.dispatchEvent(new e.w.MouseEvent('pointerup', { bubbles: true, button: 0 }));
  await new Promise(resolve => setTimeout(resolve, 5));
  const host = e.w.document.querySelector('[data-pmf-ui="quick-add"]');
  assert.ok(host); assert.equal(sent.length, 0);
  const button = host.shadowRoot.querySelector('button'); assert.ok(button.querySelector('svg'));
  button.click(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(sent[0].text, '凯尔-9'); assert.equal(e.editor.textContent, '凯尔-9');
  assert.equal(e.w.document.querySelector('[data-pmf-ui="quick-add"]'), null);
});
test('textarea selection is honored for ordinary replacement rules', async t => {
  const e = setup(t, '', [{ ...rule('AA'), replacement: 'BB' }]);
  e.editor.classList.remove('video-prompt-mention-editor__input');
  const field = e.w.document.createElement('textarea'); field.value = 'AA AA AA'; e.w.document.body.append(field);
  field.focus(); field.setSelectionRange(3,5);
  const plan = await e.preview(); assert.equal(plan.count, 1);
  await e.apply(plan); assert.equal(field.value, 'AA BB AA');
});
test('selection outside current prompt refuses instead of replacing whole prompt', async t => {
  const e = setup(t); const left = e.w.document.getElementById('left');
  const range = e.w.document.createRange(); range.selectNodeContents(left); e.w.getSelection().addRange(range);
  assert.match((await e.preview()).error, /选区不在/);
});

test('collapsed material and empty rules only highlight; expanding restores replacement', async t => {
  const e = setup(t, 'AA BB', [{ ...rule('AA'), compact: true }, { ...rule('BB'), replacement: '', compact: true }]);
  const plan = await e.preview();
  assert.equal(plan.error, undefined);
  assert.equal(plan.count, 0);
  await e.apply(plan); assert.equal(e.editor.textContent, 'AA BB');
  e.configure([{ ...rule('BB'), replacement: '' }]);
  await e.apply(await e.preview()); assert.equal(e.editor.textContent, 'AA ');
  await e.undo(); assert.equal(e.editor.textContent, 'AA BB');
});

test('switching to highlight-only invalidates a pending destructive preview', async t => {
  const e = setup(t, 'AA', [{ ...rule('AA'), replacement: '' }]);
  const plan = await e.preview();
  e.configure([{ ...rule('AA'), replacement: '', compact: true }]);
  await e.send({ type:'refreshHighlights' });
  assert.ok((await e.apply(plan)).error);
  assert.equal(e.editor.textContent, 'AA');
});

test('append material keeps source words and inserts native chips; undo restores', async t => {
  const e=setup(t);
  const before=e.editor.innerHTML;
  const plan=await e.send({type:'previewReplace',ids:['凯尔-9','雪莉-8'],mode:'append'});
  assert.equal(plan.count,3);
  await e.apply(plan);
  assert.match(e.editor.textContent,/凯尔-9@图片1牵着雪莉-8@图片2/);
  await e.undo();assert.equal(e.editor.innerHTML,before);
});
