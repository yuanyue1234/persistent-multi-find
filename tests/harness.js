const editor = document.getElementById('editor');
const output = document.getElementById('results');
window.addEventListener('error', event => { output.textContent += `\nERROR ${event.filename}:${event.lineno} ${event.message}`; });
window.addEventListener('unhandledrejection', event => { output.textContent += `\nREJECTION ${event.reason?.stack || event.reason}`; });
const listeners = [], storageListeners = [];
let fixtureData = {};
let events = 0;
const luo = '[@罗温-作战服05#2100561479451070464]';
const se = '[@塞拉-腿部包扎#2100561479451070465]';
const makeRule = (id, keyword, replacement, rest = {}) => ({ id, keyword, replacement, enabled: true, regex: false, exclusions: [], color: '#ffe066', ...rest });
const defaultTerms = () => [makeRule('se', '塞拉', se), makeRule('luo', '罗温', luo, { color: '#74c0fc' }), makeRule('altar', '祭坛', '石台', { exclusions: ['悬崖祭坛'], color: '#8ce99a' })];
window.chrome = {
  runtime: { onMessage: { addListener(fn) { listeners.push(fn); } }, async sendMessage(message) {
    if (message.type !== 'quickAddSelection') return;
    const active = fixtureData.schemes.find(item => item.id === fixtureData.activeSchemeId);
    if (!active.terms.some(term => term.keyword === message.text)) {
      const catalog = await fixtureSend({ type: 'readMaterials' });
      const material = catalog.items?.find(item => item.name === message.text && !item.ambiguous);
      active.terms.push(makeRule(`quick-${Date.now()}`, message.text, material?.replacement || ''));
      await chrome.storage.local.set({ schemes: fixtureData.schemes, terms: active.terms });
    }
    return { added: true, schemeName: active.name };
  } },
  storage: {
    local: {
      async get(defaults) { return structuredClone({ ...defaults, ...fixtureData }); },
      async set(value) {
        const changes = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, { oldValue: fixtureData[key], newValue: item }]));
        Object.assign(fixtureData, structuredClone(value));
        for (const listener of storageListeners) listener(changes, 'local');
      }
    },
    onChanged: { addListener(fn) { storageListeners.push(fn); } }
  }
};
window.fixtureSend = message => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`No response: ${message.type}`)), 5000);
  for (const listener of listeners) listener(message, {}, response => { clearTimeout(timer); resolve(response); });
});
function seed() {
  fixtureData = { enabled: true, caseSensitive: false, activeSchemeId: 'ep35', schemes: [{ id: 'ep35', name: '第35集', terms: defaultTerms() }], terms: defaultTerms() };
  editor.innerHTML = `罗温背着塞拉。祭坛旁是悬崖祭坛。<br>已经绑定：<span class="mention-chip" data-mention="1" contenteditable="false">罗温-作战服05</span><br>已有原始引用：${se}`;
}
editor.addEventListener('input', () => { events++; document.getElementById('events').textContent = `编辑器事件：${events}`; });
seed();
document.getElementById('narrow').onclick = () => {
  const frame = document.getElementById('popup');
  frame.style.width = '320px'; frame.style.height = '600px'; frame.src = '/popup-test.html?view=side';
};
document.getElementById('manySchemes').onclick = async () => {
  const schemes = Array.from({ length: 20 }, (_, index) => ({ id: `many-${index}`, name: `第${index + 1}集`, terms: defaultTerms() }));
  await chrome.storage.local.set({ schemes, activeSchemeId: 'many-19', terms: schemes[19].terms });
};
document.getElementById('legendDemo').onclick = async () => {
  editor.innerHTML = '<span class="mention-chip" contenteditable="false" data-id="2100561479451070464">@图片1</span> 是 凯尔-9，<span class="mention-chip" contenteditable="false" data-id="2100561479451070465">@图片2</span> 是 雪莉-8，<span class="mention-chip" contenteditable="false">@音频1</span> 是 雪莉-8<br><br>生成段1 | 全片 0s—22s<br>凯尔-9牵着雪莉-8。凯尔-9停步。';
  await chrome.storage.local.set({ schemes: [{ id: 'auto', name: '自动读取演示', terms: [] }], activeSchemeId: 'auto', terms: [] });
  document.getElementById('popup').src = '/popup-test.html';
};
document.getElementById('reset').onclick = () => location.reload();
document.getElementById('reloadPopup').onclick = () => { document.getElementById('popup').src = '/popup-test.html'; };
document.getElementById('small').onclick = () => { const frame = document.getElementById('popup'); frame.style.height = frame.clientHeight > 400 ? '350px' : '520px'; };
document.getElementById('layout').onclick = () => {
  const frame = document.getElementById('popup'), doc = frame.contentDocument;
  const footer = doc.querySelector('footer').getBoundingClientRect();
  const list = doc.querySelector('#termList').getBoundingClientRect();
  const result = footer.bottom <= frame.clientHeight + 1 && footer.top >= 0 && list.bottom <= footer.top + 1;
  output.textContent += `\n${result ? 'PASS' : 'FAIL'} 固定底栏：窗口${frame.clientHeight}px，底栏${footer.top}—${footer.bottom}px，列表结束${list.bottom}px`;
  const rows = [...doc.querySelectorAll('.term')];
  const fits = rows.every(row => row.scrollWidth <= row.clientWidth + 1 && row.getBoundingClientRect().right <= frame.clientWidth + 1);
  output.textContent += `\n${fits ? 'PASS' : 'FAIL'} 词条宽度：${frame.clientWidth}px 宿主内 ${rows.length} 项无横向溢出`;
};
document.getElementById('bootstrap').onclick = async () => {
  const frame = document.getElementById('popup');
  const measurements = [];
  for (const initial of [25, 100, 350, 520]) {
    frame.style.height = `${initial}px`;
    await new Promise(resolve => requestAnimationFrame(resolve));
    const doc = frame.contentDocument;
    const desired = doc.body.getBoundingClientRect().height;
    const root = doc.documentElement.getBoundingClientRect().height;
    const inner = doc.querySelector('main').getBoundingClientRect().height;
    measurements.push(`${initial}px → body ${desired}px / html ${root}px / 内容 ${inner}px`);
    if (Math.abs(desired - 520) > 1 || Math.abs(root - 520) > 1) {
      output.textContent += `\nFAIL 初始高度依赖视口：${measurements.join('；')}`;
      frame.style.height = '520px';
      return;
    }
  }
  frame.style.height = '520px';
  output.textContent += `\nPASS 初始高度独立于视口：${measurements.join('；')}`;
};

document.getElementById('run').onclick = async () => {
  const results = [];
  const assert = (value, label) => { if (!value) throw new Error(label); results.push(`PASS ${label}`); output.textContent = results.join('\n'); };
  const configure = async terms => chrome.storage.local.set({ schemes: [{ id: 'test', name: '测试', terms }], activeSchemeId: 'test', terms });
  const preview = ids => fixtureSend({ type: 'previewReplace', ids });
  const apply = plan => fixtureSend({ type: 'applyReplace', planId: plan.planId });
  const undo = () => fixtureSend({ type: 'undoReplacement' });
  try {
    await configure(defaultTerms());
    const original = editor.innerHTML, sidebar = document.getElementById('left').textContent;
    const plan = await preview(['se', 'luo', 'altar']);
    assert(plan.count === 3 && plan.protected === 2, '预览3处，保护两个已有引用');
    assert(editor.innerHTML === original, '预览不改正文');
    const applied = await apply(plan);
    assert(applied.count === 3 && editor.textContent.includes(luo) && editor.textContent.includes('悬崖祭坛'), '写入完整引用并保留排除词');
    assert(document.getElementById('left').textContent === sidebar, '左侧素材名称不受影响');
    assert(events === 1, '触发框架input事件');
    assert((await preview(['se', 'luo', 'altar'])).count === 0, '再次替换不嵌套已有引用');
    assert((await undo()).restored === 3 && editor.innerHTML === original, '一键恢复完整富文本与引用');
    const stale = await preview(['se']); editor.append('新文字');
    assert(Boolean((await apply(stale)).error) && editor.textContent.endsWith('新文字'), '预览后编辑：拒绝陈旧计划');
    editor.innerHTML = original;
    const replace = await preview(['se']); await apply(replace); editor.append('用户新增');
    assert(Boolean((await undo()).error) && editor.textContent.endsWith('用户新增'), '恢复不覆盖用户后续修改');
    editor.innerHTML = 'A B';
    await configure([makeRule('a', 'A', 'B'), makeRule('b', 'B', 'C')]);
    await apply(await preview(['a', 'b']));
    assert(editor.textContent === 'B C', '多条规则一次计算，不串联替换');
    await undo();
    editor.innerHTML = '塞拉';
    await configure([makeRule('se', '塞拉', se)]);
    const changedRule = await preview(['se']);
    await configure([makeRule('se', '塞拉', luo)]);
    assert(Boolean((await apply(changedRule)).error) && editor.textContent === '塞拉', '修改规则后必须重新预览');
    await configure([makeRule('bad', '[', 'x', { regex: true })]);
    assert(Boolean((await preview(['bad'])).error), '无效正则阻止执行');
    // Simulated framework re-render: raw references become noneditable mention chips.
    await configure([makeRule('se', '塞拉', se)]);
    const reconcile = () => { if (editor.textContent === se) editor.innerHTML = '<span data-mention="1" contenteditable="false">塞拉-腿部包扎</span>'; };
    editor.addEventListener('input', reconcile);
    await apply(await preview(['se']));
    assert(Boolean(editor.querySelector('[data-mention]')), '兼容input后框架重建DOM');
    await undo();
    assert(editor.textContent === '塞拉' && !editor.querySelector('[data-mention]'), '重建DOM后仍可恢复');
    editor.removeEventListener('input', reconcile);
    editor.innerHTML = '<span>[@塞</span><span>拉#123]</span> 塞拉';
    const split = await preview(['se']);
    assert(split.count === 1 && split.protected === 1, '保护跨格式节点的完整引用');
    await apply(split);
    assert(editor.textContent === '[@塞拉#123] ' + se, '不改坏跨节点引用');
    await undo();
    editor.classList.remove('video-prompt-mention-editor__input');
    assert(Boolean((await preview(['se'])).error), '找不到提示词时不全页替换素材引用');
    editor.classList.add('video-prompt-mention-editor__input');
    seed();
    await chrome.storage.local.set(fixtureData);
    document.getElementById('popup').src = '/popup-test.html';
    output.textContent = `${results.join('\n')}\n全部 ${results.length} 项通过`;
  } catch (error) { output.textContent = `${results.join('\n')}\nFAIL ${error.message}`; console.error(error); }
};
