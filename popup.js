const DEFAULTS = { terms: [], schemes: null, activeSchemeId: null, projects: null, activeProjectId: null, enabled: true, caseSensitive: false, darkMode: true, wrapSettings: { prefix: '[', suffix: ']', pattern: '', flags: 'g', template: '[$&]' } };
const PALETTE = [
  "#ffe066", "#8ce99a", "#74c0fc", "#b197fc", "#ffa8a8", "#ffc078",
  "#63e6be", "#f783ac", "#a9e34b", "#e599f7", "#66d9e8", "#ff922b"
];

const els = {
  master: document.querySelector("#masterEnabled"),
  schemeTabs: document.querySelector("#schemeTabs"),
  addScheme: document.querySelector("#addSchemeButton"),
  keyword: document.querySelector("#keywordInput"),
  color: document.querySelector("#colorInput"),
  add: document.querySelector("#addButton"),
  toggleImport: document.querySelector("#toggleImportButton"),
  importPanel: document.querySelector("#importPanel"),
  batchInput: document.querySelector("#batchInput"),
  importAsRegex: document.querySelector("#importAsRegex"),
  importButton: document.querySelector("#importButton"),
  copyExport: document.querySelector("#copyExportButton"),
  caseSensitive: document.querySelector("#caseSensitive"),
  list: document.querySelector("#termList"),
  empty: document.querySelector("#emptyState"),
  summary: document.querySelector("#summary"),
  undo: document.querySelector("#undoButton"),
  clear: document.querySelector("#clearButton"),
  replaceAll: document.querySelector("#replaceAllButton"),
  status: document.querySelector("#status"),
  excludePanel: document.querySelector("#excludePanel"),
  excludeTermLabel: document.querySelector("#excludeTermLabel"),
  excludeInput: document.querySelector("#excludeInput"),
  saveExclude: document.querySelector("#saveExcludeButton"),
  clearExclude: document.querySelector("#clearExcludeButton"),
  closeExclude: document.querySelector("#closeExcludeButton"),
  resultToast: document.querySelector("#resultToast"),
  resultTitle: document.querySelector("#resultTitle"),
  resultRules: document.querySelector("#resultRules"),
  closeResult: document.querySelector("#closeResultButton")
};

let state = { enabled: true, caseSensitive: false, schemes: [], activeSchemeId: null };
let refreshTimer;
let editRevision = 0;
let editingExcludeTermId = null;
let previewPlan = null;
let previewTerms = [];
let materialDraft = new Map();
let pageMaterials = [];
let pageDraft = new Map();
let pageSignature = '';
let materialReadSequence = 0;
const extra = Object.fromEntries([
  "copySchemeButton", "materialButton", "materialPanel", "closeMaterialButton", "materialInput", "materialCandidates",
  "materialHistoryList", "materialHint", "saveMaterialButton", "previewPanel", "previewTitle", "previewScope",
  "previewRules", "previewSamples", "applyPreviewButton", "closePreviewButton", "cancelPreviewButton",
  "readMaterialsButton", "readMaterialsStatus", "pageMaterialCandidates", "manualMaterials"
].map(id => [id, document.getElementById(id)]));

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeTerm(term) {
  const normalized = { regex: false, enabled: true, replacement: term.keyword || "", deleteMatch: false, color: PALETTE[0], exclusions: [], ...term };
  if (!Array.isArray(term.exclusions)) {
    const parsed = parsePatternText(term.keyword);
    normalized.keyword = parsed.keyword;
    normalized.exclusions = parsed.exclusions;
  }
  normalized.exclusions = [...new Set(normalized.exclusions.map((item) => String(item).trim()).filter(Boolean))];
  return normalized;
}

function parsePatternText(text) {
  const parts = String(text || "").split(/\s+-/);
  return {
    keyword: (parts.shift() || "").trim(),
    exclusions: parts.map((part) => part.trim()).filter(Boolean)
  };
}

function formatPattern(term, includeEmptyDash = true) {
  const exclusions = Array.isArray(term.exclusions) ? term.exclusions.filter(Boolean) : [];
  if (exclusions.length) return `${term.keyword} ${exclusions.map((item) => `-${item}`).join(" ")}`;
  return includeEmptyDash ? `${term.keyword} -` : term.keyword;
}

function exportText() {
  return terms().map((term) => `${formatPattern(term, true)} | ${term.compact ? '{{仅高亮}}' : ''}${term.deleteMatch ? '{{删除}}' : term.replacement || ""}`).join("\n");
}

function activeScheme() {
  return state.schemes.find((scheme) => scheme.id === state.activeSchemeId) || state.schemes[0];
}

function terms() {
  return activeScheme()?.terms || [];
}

async function load(persist = true) {
  const revision = editRevision;
  const stored = await chrome.storage.local.get(DEFAULTS);
  if (!persist && (revision !== editRevision || Object.entries(storagePayload()).every(([key, value]) => sameData(stored[key], value)))) return;
  const projects = stored.projects?.length ? stored.projects : [{ id: 'default', name: '项目1' }];
  const activeProjectId = projects.some(p => p.id === stored.activeProjectId) ? stored.activeProjectId : projects[0].id;
  const storedSchemes = Array.isArray(stored.schemes) && stored.schemes.length ? stored.schemes : null;
  const schemes = (storedSchemes || [{ id: uid(), name: "方案1", terms: stored.terms || [] }]).map((scheme, index) => ({
    id: scheme.id || uid(),
    name: !scheme.name || scheme.name === '默认方案' ? `方案${index + 1}` : scheme.name,
    projectId: scheme.projectId || projects[0].id,
    terms: Array.isArray(scheme.terms) ? scheme.terms.map(normalizeTerm) : []
  }));
  state = {
    projects, activeProjectId,
    darkMode: stored.darkMode,
    wrapSettings: stored.wrapSettings,
    enabled: stored.enabled,
    caseSensitive: stored.caseSensitive,
    schemes,
    activeSchemeId: schemes.find(s => s.id === stored.activeSchemeId && s.projectId === activeProjectId)?.id || schemes.find(s => s.projectId === activeProjectId)?.id || schemes[0].id
  };
  els.master.checked = state.enabled;
  document.documentElement.classList.toggle('dark', state.darkMode);
  document.getElementById('themeButton').setAttribute('aria-pressed', String(state.darkMode));
  els.caseSensitive.checked = state.caseSensitive;
  els.color.value = nextAutoColor();
  render();
  if (persist) save();
}

function nextAutoColor(targetTerms = terms()) { return PmfColors.next(targetTerms); }

function storagePayload() {
  if (state.projects) state.projects.find(p => p.id === state.activeProjectId).activeSchemeId = state.activeSchemeId;
  return {
    projects: state.projects, activeProjectId: state.activeProjectId,
    darkMode: state.darkMode,
    wrapSettings: state.wrapSettings,
    enabled: state.enabled,
    caseSensitive: state.caseSensitive,
    schemes: state.schemes,
    activeSchemeId: state.activeSchemeId,
    terms: terms()
  };
}

function save(immediate = false) {
  editRevision += 1;
  const stored = chrome.storage.local.set(structuredClone(storagePayload()));
  clearTimeout(refreshTimer);
  if (immediate) return stored.then(() => send({ type: "refreshHighlights" }));
  refreshTimer = setTimeout(() => send({ type: "refreshHighlights" }), 140);
  return stored;
}

async function send(message, fixedTabId = null) {
  try {
    const tab = fixedTabId !== null ? { id: fixedTabId } : globalThis.PmfWorkspace ? await PmfWorkspace.target() : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (!tab?.id) return null;
    try {
      const response = await chrome.tabs.sendMessage(tab.id, message, { frameId: 0 });
      return response ? { ...response, sourceTabId: tab.id } : null;
    } catch {
      await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["rules.js", "materials.js", "content.js"] });
      const response = await chrome.tabs.sendMessage(tab.id, message, { frameId: 0 });
      return response ? { ...response, sourceTabId: tab.id } : null;
    }
  } catch {
    return null;
  }
}

function renderSchemes() {
  els.schemeTabs.replaceChildren();
  for (const scheme of projectSchemes()) {
    const button = document.createElement("button");
    button.className = `scheme-tab${scheme.id === state.activeSchemeId ? " active" : ""}`;
    button.dataset.id = scheme.id;
    button.textContent = scheme.name;
    button.title = "单击切换 · 双击重命名 · 右键删除";
    els.schemeTabs.append(button);
  }
  const selected = els.schemeTabs.querySelector(".active");
  if (selected) els.schemeTabs.scrollLeft = Math.max(0, selected.offsetLeft - 20);
}

function render() {
  document.getElementById('wrapPanel').hidden = true;
  els.resultToast.hidden = true;
  els.excludePanel.hidden = true;
  extra.materialPanel.hidden = true;
  extra.previewPanel.hidden = true;
  previewPlan = null;
  renderProjects();
  renderSchemes();
  els.list.replaceChildren();
  els.empty.hidden = terms().length > 0;
  els.summary.textContent = `${terms().length} 项`;

  for (const term of terms()) {
    const row = document.createElement("article");
    row.className = `term${term.enabled ? "" : " off"}${term.deleteMatch ? ' delete-mode' : ''}${term.compact ? ' compact' : ''}`;
    row.dataset.id = term.id;
    row.innerHTML = `
      <div class="term-rail">
      <button class="drag-handle" title="拖动排序；也可按 Alt＋↑ / ↓" aria-label="拖动排序">${icon('grip')}</button>
      <button class="term-toggle" aria-expanded="${!term.compact}">${icon(term.compact ? 'highlight' : 'replace')}</button>
      </div>
      <div class="filter-line">
      <input class="term-enabled" type="checkbox" title="启用" aria-label="启用此词条" ${term.enabled ? "checked" : ""}>
      <input class="term-color" type="color" title="高亮颜色" aria-label="高亮颜色">
      <input class="term-keyword" type="text" aria-label="匹配词" placeholder="匹配词">
      <button class="term-wrap" title="添加一层括号；已有括号不重复添加" aria-label="包裹替换文字">${icon('brackets')}</button>
      <button class="wrap-config" title="自定义包裹 / 正则" aria-label="自定义包裹规则">${icon('settings')}</button>
      </div>
      <div class="replacement-line">
      <input class="term-replacement" type="text" aria-label="替换为" placeholder="替换为">
      <button class="term-exclude${term.exclusions?.length || term.deleteMatch ? " active" : ""}" title="设置不替换的排除词">${icon('filter')}<span>排除</span></button>
      <button class="append-one" title="在每处匹配文字后追加替换框内容">追加</button>
      <button class="replace-one" title="仅替换此项">替换</button>
      </div>
      <button class="delete" title="移除此词条" aria-label="删除词条">${icon('close')}</button>`;
    row.querySelector(".term-keyword").value = term.keyword;
    row.querySelector(".term-color").value = /^#[0-9a-f]{6}$/i.test(term.color) ? term.color : PALETTE[0];
    row.querySelector(".term-replacement").value = term.deleteMatch ? '' : term.replacement;
    updateTermControls(row, term);
    els.list.append(row);
  }
  if (!els.importPanel.hidden) els.batchInput.value = exportText();
}
function icon(name) {
  const paths = {
    grip: '<circle cx="8" cy="5" r="1"/><circle cx="16" cy="5" r="1"/><circle cx="8" cy="12" r="1"/><circle cx="16" cy="12" r="1"/><circle cx="8" cy="19" r="1"/><circle cx="16" cy="19" r="1"/>',
    highlight: '<path d="m9 15 7-11 5 4-9 10-4 1-3-3 4-1ZM3 21h10"/>',
    replace: '<path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4"/>',
    brackets: '<path d="M8 4H4v16h4M16 4h4v16h-4"/>',
    settings: '<path d="M4 7h6m4 0h6M4 17h10m4 0h2"/><circle cx="12" cy="7" r="2"/><circle cx="16" cy="17" r="2"/>',
    filter: '<path d="M3 4h18l-7 8v7l-4 2v-9L3 4Z"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
    theme: '<path d="M20.5 13A9 9 0 0 1 11 3.5 9 9 0 1 0 20.5 13Z"/>',
    window: '<path d="M14 3h7v7m0-7L11 13M10 5H3v16h16v-7"/>',
    sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
    left: '<path d="m15 5-7 7 7 7"/>',
    right: '<path d="m9 5 7 7-7 7"/>'
  };
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}
function updateTermControls(row, term) {
  const deletion = term.deleteMatch || term.replacement === '';
  row.classList.toggle('delete-mode', !term.compact && deletion);
  const toggle = row.querySelector('.term-toggle');
  toggle.innerHTML = icon(term.compact ? 'highlight' : 'replace');
  toggle.title = term.compact ? '仅高亮：点击开启替换' : '替换模式：点击改为仅高亮';
  toggle.setAttribute('aria-label', toggle.title);
  toggle.setAttribute('aria-expanded', String(!term.compact));
  const input = row.querySelector('.term-replacement');
  input.placeholder = '留空则删除匹配文字';
  input.title = `${deletion ? '将删除匹配文字，预览后确认' : term.replacement}`;
  row.querySelector('.replace-one').innerHTML = `${icon(deletion ? 'trash' : 'replace')}<span>${deletion ? '删除' : '替换'}</span>`;
  row.querySelector('.term-wrap').disabled = Boolean(term.compact);
}
const schemesLeft = document.getElementById('schemesLeft'), schemesRight = document.getElementById('schemesRight');
schemesLeft.addEventListener('click', () => els.schemeTabs.scrollBy({ left: -180, behavior: 'smooth' }));
schemesRight.addEventListener('click', () => els.schemeTabs.scrollBy({ left: 180, behavior: 'smooth' }));
schemesLeft.addEventListener('dblclick', () => { els.schemeTabs.scrollLeft = 0; });
schemesRight.addEventListener('dblclick', () => { els.schemeTabs.scrollLeft = els.schemeTabs.scrollWidth; });
els.schemeTabs.addEventListener('wheel', event => {
  if (els.schemeTabs.scrollWidth <= els.schemeTabs.clientWidth) return;
  event.preventDefault(); els.schemeTabs.scrollLeft += event.deltaY || event.deltaX;
}, { passive: false });

async function addTerm() {
  const keyword = els.keyword.value.trim();
  if (!keyword) return;
  if (terms().some((term) => term.keyword === keyword)) return showStatus("当前方案已存在该词条");
  const schemeId = state.activeSchemeId;
  const catalog = await send({ type: 'readMaterials' });
  if (state.activeSchemeId !== schemeId || terms().some(term => term.keyword === keyword)) return;
  const material = catalog?.items?.find(item => item.name === keyword && !item.ambiguous);
  terms().push({ id: uid(), keyword, replacement: material?.replacement || keyword, color: els.color.value, enabled: true, regex: false, exclusions: [] });
  els.keyword.value = "";
  els.color.value = nextAutoColor();
  render();
  const result = await save(true);
  showStatus(material ? `已绑定图片“${keyword}”；预览后确认替换` : result ? `已高亮 ${result.count} 处（未绑定素材）` : `已添加到 ${activeScheme().name}`);
  els.keyword.focus();
}

function setImportOpen(open) {
  if (open) {
    els.batchInput.value = exportText();
    els.excludePanel.hidden = true;
    els.resultToast.hidden = true;
    extra.materialPanel.hidden = true;
    extra.previewPanel.hidden = true;
    previewPlan = null;
  }
  els.importPanel.hidden = !open;
  els.toggleImport.classList.toggle("active", open);
  if (open) els.batchInput.focus();
}
document.getElementById('closeImportButton').addEventListener('click', () => setImportOpen(false));
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  setImportOpen(false);
  els.excludePanel.hidden = true;
  els.resultToast.hidden = true;
  extra.materialPanel.hidden = true;
  extra.previewPanel.hidden = true;
  previewPlan = null;
});

function commitOrder() {
  const ordered = Array.from(els.list.children, row => terms().find(term => term.id === row.dataset.id)).filter(Boolean);
  if (ordered.length !== terms().length) return;
  activeScheme().terms = ordered;
  previewPlan = null;
  save();
  showStatus('已保存词条顺序');
}
let dragState = null;
els.list.addEventListener('pointerdown', event => {
  const handle = event.target.closest('.drag-handle');
  if (!handle || event.button !== 0) return;
  event.preventDefault();
  const row = handle.closest('.term');
  dragState = { row, handle, pointerId: event.pointerId, changed: false };
  row.classList.add('dragging');
  handle.setPointerCapture(event.pointerId);
});
els.list.addEventListener('pointermove', event => {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  const rect = els.list.getBoundingClientRect();
  if (event.clientY < rect.top + 24) els.list.scrollTop -= 18;
  if (event.clientY > rect.bottom - 24) els.list.scrollTop += 18;
  const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest('.term');
  if (!hit || hit === dragState.row || !els.list.contains(hit)) return;
  const box = hit.getBoundingClientRect();
  els.list.insertBefore(dragState.row, event.clientY < box.top + box.height / 2 ? hit : hit.nextSibling);
  dragState.changed = true;
});
function finishDrag(cancel = false) {
  if (!dragState) return;
  const { row, handle, pointerId, changed } = dragState;
  dragState = null;
  row.classList.remove('dragging');
  if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);
  if (cancel) render();
  else if (changed) commitOrder();
}
els.list.addEventListener('pointerup', () => finishDrag());
els.list.addEventListener('pointercancel', () => finishDrag(true));
els.list.addEventListener('keydown', event => {
  const handle = event.target.closest('.drag-handle');
  if (!handle || !event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  const row = handle.closest('.term');
  if (event.key === 'ArrowUp' && row.previousElementSibling) els.list.insertBefore(row, row.previousElementSibling);
  else if (event.key === 'ArrowDown' && row.nextElementSibling) els.list.insertBefore(row.nextElementSibling, row);
  else return;
  commitOrder(); handle.focus();
});

els.add.addEventListener("click", addTerm);
els.keyword.addEventListener("keydown", (event) => { if (event.key === "Enter") addTerm(); });

els.addScheme.addEventListener("click", async () => {
  const scheme = { id: uid(), name: nextSchemeName(), projectId: state.activeProjectId, terms: [] };
  state.schemes.push(scheme);
  state.activeSchemeId = scheme.id;
  els.color.value = nextAutoColor();
  render();
  await save(true);
  showStatus(`已新建 ${scheme.name}`);
});

els.schemeTabs.addEventListener("click", async (event) => {
  const tab = event.target.closest(".scheme-tab");
  if (!tab || tab.dataset.id === state.activeSchemeId) return;
  state.activeSchemeId = tab.dataset.id;
  els.color.value = nextAutoColor();
  render();
  await save(true);
});

els.schemeTabs.addEventListener("dblclick", async (event) => {
  const tab = event.target.closest(".scheme-tab");
  if (!tab) return;
  const scheme = state.schemes.find((item) => item.id === tab.dataset.id);
  const name = prompt("重命名方案", scheme.name)?.trim();
  if (!name) return;
  scheme.name = name;
  renderSchemes();
  await save();
});

els.schemeTabs.addEventListener("contextmenu", async (event) => {
  const tab = event.target.closest(".scheme-tab");
  if (!tab) return;
  event.preventDefault();
  if (projectSchemes().length === 1) return showStatus("至少保留一个方案");
  const scheme = state.schemes.find((item) => item.id === tab.dataset.id);
  if (!confirm(`删除方案“${scheme.name}”？`)) return;
  state.schemes = state.schemes.filter((item) => item.id !== scheme.id);
  if (state.activeSchemeId === scheme.id) state.activeSchemeId = projectSchemes()[0].id;
  els.color.value = nextAutoColor();
  render();
  await save(true);
});

els.toggleImport.addEventListener("click", () => setImportOpen(els.importPanel.hidden));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    extra.materialPanel.hidden = true;
    extra.previewPanel.hidden = true;
    previewPlan = null;
    if (!els.excludePanel.hidden) {
      els.excludePanel.hidden = true;
      editingExcludeTermId = null;
    } else if (!els.importPanel.hidden) setImportOpen(false);
    els.keyword.focus();
  }
});

els.importButton.addEventListener("click", async () => {
  const rawLines = els.batchInput.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const parsedByKeyword = new Map();
  for (const line of rawLines) {
    const separator = line.match(/\s+\|\s*/);
    const pattern = parsePatternText((separator ? line.slice(0, separator.index) : line).trim());
    const keyword = pattern.keyword;
    const rawReplacement = separator ? line.slice(separator.index + separator[0].length).trim() : keyword;
    const compact = !separator || rawReplacement.startsWith('{{仅高亮}}');
    const replacement = rawReplacement.replace(/^\{\{仅高亮\}\}/, '');
    if (keyword) parsedByKeyword.set(keyword, { keyword, compact, replacement: replacement === '{{删除}}' ? '' : replacement, deleteMatch: replacement === '{{删除}}', exclusions: pattern.exclusions });
  }
  let added = 0;
  let updated = 0;
  let invalid = 0;
  for (const { keyword, replacement, exclusions, deleteMatch, compact } of parsedByKeyword.values()) {
    if (els.importAsRegex.checked) {
      try {
        new RegExp(keyword);
        exclusions.forEach((item) => new RegExp(item));
      } catch { invalid += 1; continue; }
    }
    const existing = terms().find((term) => term.keyword === keyword);
    if (existing) {
      const exclusionsChanged = JSON.stringify(existing.exclusions || []) !== JSON.stringify(exclusions);
      if (existing.replacement !== replacement || Boolean(existing.compact) !== compact || Boolean(existing.deleteMatch) !== deleteMatch || existing.regex !== els.importAsRegex.checked || exclusionsChanged) updated += 1;
      existing.compact = compact;
      existing.replacement = replacement;
      existing.deleteMatch = deleteMatch;
      existing.regex = els.importAsRegex.checked;
      existing.exclusions = exclusions;
    } else {
      terms().push({
        id: uid(), keyword, replacement, deleteMatch, compact, color: nextAutoColor(), enabled: true, regex: els.importAsRegex.checked, exclusions
      });
      added += 1;
    }
  }
  render();
  const result = await save(true);
  showStatus(`新增 ${added} · 更新 ${updated}${invalid ? ` · 无效正则 ${invalid}` : ""}${result ? ` · 高亮 ${result.count}` : ""}`);
  if (added || updated) {
    els.batchInput.value = "";
    setImportOpen(false);
    els.color.value = nextAutoColor();
  }
});

els.copyExport.addEventListener("click", async () => {
  const text = exportText();
  if (!text) return showStatus("当前方案没有可导出的词条");
  els.batchInput.value = text;
  els.batchInput.focus();
  els.batchInput.select();
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch {
    copied = document.execCommand("copy");
  }
  showStatus(copied ? `已复制 ${terms().length} 项` : "导出文本已生成，请手动复制");
});

els.master.addEventListener("change", () => {
  state.enabled = els.master.checked;
  save(true);
});
els.caseSensitive.addEventListener("change", () => {
  state.caseSensitive = els.caseSensitive.checked;
  save(true);
});

els.list.addEventListener("input", (event) => {
  const row = event.target.closest(".term");
  if (!row) return;
  const term = terms().find((item) => item.id === row.dataset.id);
  if (!term) return;
  if (event.target.classList.contains("term-keyword")) term.keyword = event.target.value;
  if (event.target.classList.contains("term-replacement")) {
    if (!event.isComposing && event.target.value !== term.replacement) rememberReplacement(term);
    term.replacement = event.target.value; term.deleteMatch = false;
    updateTermControls(row, term);
  }
  if (event.target.classList.contains("term-color")) term.color = event.target.value;
  if (event.target.classList.contains("term-enabled")) {
    term.enabled = event.target.checked;
    row.classList.toggle("off", !term.enabled);
  }
  save();
});

els.list.addEventListener("click", async (event) => {
  const row = event.target.closest(".term");
  if (!row) return;
  const term = terms().find((item) => item.id === row.dataset.id);
  if (event.target.closest('.term-toggle')) {
    term.compact = !term.compact;
    row.classList.toggle('compact', term.compact);
    updateTermControls(row, term);
    save();
  } else if (event.target.closest('.term-wrap')) {
    try {
      const { prefix, suffix, pattern, flags, template } = state.wrapSettings;
      if (!pattern && term.replacement.startsWith(prefix) && term.replacement.endsWith(suffix)) return showStatus('已添加括号，不重复包裹');
      if (pattern && row.dataset.wrapResult === term.replacement && row.dataset.wrapRule === JSON.stringify(state.wrapSettings)) return showStatus('已应用该规则，不重复添加');
      rememberReplacement(term);
      term.replacement = pattern ? term.replacement.replace(new RegExp(pattern, flags), template) : prefix + term.replacement + suffix;
      row.dataset.wrapResult = term.replacement;
      row.dataset.wrapRule = JSON.stringify(state.wrapSettings);
      term.deleteMatch = false;
      const input = row.querySelector('.term-replacement');
      input.value = term.replacement;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      showStatus('已更新替换文字；预览后执行替换');
    } catch (error) { showStatus(`正则无效：${error.message}`); }
  } else if (event.target.closest('.wrap-config')) {
    for (const key of ['prefix', 'suffix', 'pattern', 'flags', 'template']) document.getElementById(`wrap-${key}`).value = state.wrapSettings[key];
    document.getElementById('wrapPanel').hidden = false;
  } else if (event.target.closest(".delete")) {
    activeScheme().terms = terms().filter((item) => item.id !== row.dataset.id);
    render();
    els.color.value = nextAutoColor();
    save(true);
  } else if (event.target.closest(".term-exclude")) {
    extra.materialPanel.hidden = true;
    extra.previewPanel.hidden = true;
    previewPlan = null;
    editingExcludeTermId = term.id;
    els.excludeTermLabel.textContent = term.keyword;
    els.excludeInput.value = (term.exclusions || []).join("\n");
    document.getElementById('deleteMatchInput').checked = Boolean(term.deleteMatch);
    els.importPanel.hidden = true;
    els.resultToast.hidden = true;
    els.excludePanel.hidden = false;
    els.excludeInput.focus();
  } else if (event.target.closest(".append-one")) {
    await previewReplacement([term], "append");
  } else if (event.target.closest(".replace-one")) {
    await previewReplacement([term]);
  }
});

els.closeExclude.addEventListener("click", () => {
  els.excludePanel.hidden = true;
  editingExcludeTermId = null;
});

els.saveExclude.addEventListener("click", async () => {
  const term = terms().find((item) => item.id === editingExcludeTermId);
  if (!term) return;
  term.exclusions = [...new Set(els.excludeInput.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean))];
  term.deleteMatch = document.getElementById('deleteMatchInput').checked;
  editingExcludeTermId = null;
  render();
  await save(true);
  showStatus(`已保存设置${term.deleteMatch ? ' · 删除模式，需预览确认' : ''}`);
});

els.clearExclude.addEventListener("click", async () => {
  const term = terms().find((item) => item.id === editingExcludeTermId);
  if (!term) return;
  term.exclusions = [];
  editingExcludeTermId = null;
  render();
  await save(true);
  showStatus("已清空排除项");
});

els.undo.addEventListener("click", async () => {
  const result = await send({ type: "undoReplacement" });
  els.resultToast.hidden = true;
  extra.previewPanel.hidden = true;
  previewPlan = null;
  if (result?.error) return showStatus(result.error);
  showStatus(result?.restored ? `已恢复上次修改（${result.restored} 个文本位置）` : "没有可恢复的替换记录");
});

els.clear.addEventListener("click", () => {
  activeScheme().terms = [];
  render();
  els.color.value = nextAutoColor();
  save(true);
});

els.replaceAll.addEventListener("click", async () => {
  const eligible = terms().filter((term) => term.enabled && term.keyword && !term.compact);
  if (!eligible.length) return showStatus("当前词条均为仅高亮或未启用，无需替换");
  await previewReplacement(eligible);
});

els.closeResult.addEventListener("click", () => { els.resultToast.hidden = true; });

function showReplacementResult(selectedTerms, result, mode = "replace") {
  els.resultTitle.textContent = `${mode === "append" ? "追加" : "替换"}成功 · 共 ${result.count} 处`;
  els.resultRules.replaceChildren();
  for (const term of selectedTerms) {
    const count = result.ruleCounts?.[term.id] || 0;
    if (!count) continue;
    const line = document.createElement("div");
    line.className = "result-rule";
    line.textContent = `${formatPattern(term, true)} → ${term.deleteMatch || !term.replacement ? '（删除文字）' : term.replacement} · ${count} 处`;
    els.resultRules.append(line);
  }
  els.resultToast.hidden = false;
}

function showStatus(text) {
  els.status.textContent = text;
  els.status.title = text;
  setTimeout(() => { if (els.status.textContent === text) els.status.textContent = ""; }, 3000);
}

extra.copySchemeButton.addEventListener("click", async () => {
  const original = activeScheme();
  const clone = { id: uid(), name: nextSchemeName(), projectId: state.activeProjectId, terms: structuredClone(original.terms).map(term => ({ ...term, id: uid() })) };
  state.schemes.push(clone);
  state.activeSchemeId = clone.id;
  render();
  els.color.value = nextAutoColor();
  await save(true);
  showStatus("已复制方案，只需调整变化的素材；双击标签可改名");
});

function savedMaterials() {
  const found = new Map();
  for (const scheme of projectSchemes()) for (const term of scheme.terms) {
    for (const ref of PmfRules.references(term.replacement)) found.set(ref.token, ref);
  }
  return [...found.values()];
}

function openMaterials(term = null) {
  setImportOpen(false);
  els.excludePanel.hidden = true;
  els.resultToast.hidden = true;
  extra.previewPanel.hidden = true;
  previewPlan = null;
  materialDraft = new Map();
  pageDraft = new Map();
  pageMaterials = [];
  pageSignature = '';
  extra.pageMaterialCandidates.replaceChildren();
  if (term && PmfMaterials.boundName(term.replacement)) pageDraft.set(PmfMaterials.boundName(term.replacement), term.keyword);
  const refs = PmfRules.references(term?.replacement);
  extra.materialInput.value = refs.map(ref => ref.token).join("\n");
  if (term) for (const ref of refs) materialDraft.set(ref.token, term.keyword);
  extra.materialPanel.dataset.keyword = term?.keyword || els.keyword.value.trim();
  extra.materialHistoryList.replaceChildren();
  for (const ref of savedMaterials()) {
    const button = document.createElement("button");
    button.textContent = ref.name;
    button.title = ref.token;
    button.addEventListener("click", () => {
      const tokens = new Set(PmfRules.references(extra.materialInput.value).map(item => item.token));
      tokens.add(ref.token);
      extra.materialInput.value = [...tokens].join("\n");
      renderMaterialCandidates();
    });
    extra.materialHistoryList.append(button);
  }
  renderMaterialCandidates();
  extra.materialPanel.hidden = false;
  extra.manualMaterials.open = Boolean(refs.length);
  readPageMaterials();
}

async function readPageMaterials() {
  const sequence = ++materialReadSequence;
  extra.readMaterialsButton.disabled = true;
  extra.readMaterialsStatus.textContent = '正在读取当前分镜…';
  const result = await send({ type: 'readMaterials' });
  if (sequence !== materialReadSequence) return;
  extra.readMaterialsButton.disabled = false;
  pageMaterials = result?.items || [];
  pageSignature = result?.signature || '';
  extra.pageMaterialCandidates.replaceChildren();
  extra.readMaterialsStatus.textContent = result?.error || (!result ? '页面未连接，请刷新工作台后重试' : `读到 ${pageMaterials.length} 个图片素材；左侧修改原词，留空跳过`);
  for (const item of pageMaterials) {
    const row = document.createElement('div');
    row.className = `material-candidate${item.ambiguous ? ' conflict' : ''}`;
    const input = document.createElement('input');
    input.setAttribute('aria-label', `剧本原词：${item.name}`);
    input.placeholder = '留空跳过';
    const existing = terms().find(term => term.replacement === item.replacement);
    input.value = item.ambiguous ? '' : pageDraft.get(item.name) ?? existing?.keyword ?? item.name;
    input.disabled = item.ambiguous;
    pageDraft.set(item.name, input.value);
    input.addEventListener('input', () => pageDraft.set(item.name, input.value));
    const arrow = document.createElement('span'); arrow.textContent = '→';
    const label = document.createElement('div'); label.className = 'material-name'; label.textContent = item.name;
    const note = document.createElement('small'); note.textContent = item.ambiguous ? '同名冲突，请在平台改名或手动粘贴引用' : `${item.label} · 自动解析当前图片`;
    label.append(note); row.append(input, arrow, label); extra.pageMaterialCandidates.append(row);
  }
  renderMaterialCandidates();
}
extra.readMaterialsButton.addEventListener('click', readPageMaterials);

function renderMaterialCandidates() {
  const refs = [...new Map(PmfRules.references(extra.materialInput.value).map(ref => [ref.token, ref])).values()];
  extra.materialCandidates.replaceChildren();
  for (const ref of refs) {
    const row = document.createElement("div");
    row.className = "material-candidate";
    const keyword = document.createElement("input");
    keyword.placeholder = "原词，如：塞拉";
    keyword.setAttribute("aria-label", `匹配词：${ref.name}`);
    const existing = terms().find(term => term.replacement === ref.token);
    keyword.value = materialDraft.get(ref.token) ?? (refs.length === 1 && extra.materialPanel.dataset.keyword ? extra.materialPanel.dataset.keyword : existing?.keyword || "");
    materialDraft.set(ref.token, keyword.value);
    keyword.addEventListener("input", () => materialDraft.set(ref.token, keyword.value));
    const arrow = document.createElement("span"); arrow.textContent = "→";
    const label = document.createElement("div"); label.className = "material-name"; label.textContent = ref.name;
    const id = document.createElement("small"); id.textContent = `#${ref.id}`; label.append(id);
    row.append(keyword, arrow, label);
    extra.materialCandidates.append(row);
  }
  extra.saveMaterialButton.disabled = refs.length === 0 && !pageMaterials.some(item => !item.ambiguous);
  extra.materialHint.textContent = pageMaterials.length ? '保存到当前方案，不立即修改剧本' : refs.length ? `${refs.length} 个素材；原词留空的行不导入` : "读取页面或手动粘贴完整引用";
}

extra.materialButton.addEventListener("click", () => openMaterials());
extra.closeMaterialButton.addEventListener("click", () => { extra.materialPanel.hidden = true; });
extra.materialInput.addEventListener("input", renderMaterialCandidates);

extra.saveMaterialButton.addEventListener("click", async () => {
  const schemeId = state.activeSchemeId;
  const refs = [...new Map(PmfRules.references(extra.materialInput.value).map(ref => [ref.token, ref])).values()];
  const mappings = [
    ...pageMaterials.filter(item => !item.ambiguous).map(item => ({ ref: { token: item.replacement }, keyword: pageDraft.get(item.name)?.trim() })),
    ...refs.map(ref => ({ ref, keyword: materialDraft.get(ref.token)?.trim() }))
  ].filter(item => item.keyword);
  if (!mappings.length) { extra.materialHint.textContent = "请填写至少一个提示词原词"; return; }
  if (new Set(mappings.map(item => item.keyword)).size !== mappings.length) {
    extra.materialHint.textContent = "同一个原词绑定了多个素材，请保留一个版本或使用不同方案"; return;
  }
  if (pageMaterials.length) {
    const fresh = await send({ type: 'readMaterials' });
    if (!fresh || fresh.error || fresh.signature !== pageSignature) {
      await readPageMaterials();
      extra.materialHint.textContent = '顶部素材有变化，已重新读取，请检查后再保存'; return;
    }
  }
  if (schemeId !== state.activeSchemeId || extra.materialPanel.hidden) return;
  const conflicts = mappings.filter(({ ref, keyword }) => terms().some(term => term.keyword === keyword && term.replacement && term.replacement !== ref.token));
  if (conflicts.length && !confirm(`以下原词已有其他绑定，确认更新？\n${conflicts.map(item => item.keyword).join('、')}`)) return;
  for (const { ref, keyword } of mappings) {
    const existing = terms().find(term => term.keyword === keyword);
    if (existing) { existing.replacement = ref.token; existing.deleteMatch = false; } // Preserve color / exclusions.
    else terms().push({ id: uid(), keyword, replacement: ref.token, color: nextAutoColor(), enabled: true, regex: false, exclusions: [] });
  }
  render();
  els.color.value = nextAutoColor();
  await save(true);
  showStatus(`已保存 ${mappings.length} 个绑定；点击“预览全部替换”应用`);
});

async function previewReplacement(selectedTerms, mode = "replace") {
  const action = mode === "append" ? "追加" : "替换";
  const schemeId = state.activeSchemeId;
  const selectedSnapshot = JSON.stringify(selectedTerms);
  await save();
  const result = await send({ type: "previewReplace", mode, ids: selectedTerms.map(term => term.id) });
  if (schemeId !== state.activeSchemeId || selectedSnapshot !== JSON.stringify(selectedTerms)) return showStatus("规则已变化，请重新预览");
  if (!result || result.error) return showStatus(result?.error || "无法读取页面，请刷新网页后重试");
  previewPlan = { ...result, mode };
  previewTerms = structuredClone(selectedTerms);
  setImportOpen(false);
  extra.materialPanel.hidden = true;
  els.excludePanel.hidden = true;
  els.resultToast.hidden = true;
  extra.previewTitle.textContent = `${action}预览 · ${result.count} 处`;
  extra.previewScope.textContent = `${result.scope}；保护 ${result.protected} 个已有引用。`;
  extra.previewRules.replaceChildren();
  for (const term of previewTerms) {
    const count = result.ruleCounts?.[term.id] || 0;
    const line = document.createElement("div");
    line.className = `preview-rule${count ? "" : " zero"}`;
    line.textContent = `${formatPattern(term)} → ${mode === 'append' ? (term.deleteMatch || !term.replacement ? '（空内容，不追加）' : '保留原文 ＋ ' + term.replacement) : term.deleteMatch || !term.replacement ? '（删除文字）' : term.replacement} · ${count} 处${count ? "" : "（未匹配、已引用或跳过）"}`;
    extra.previewRules.append(line);
  }
  extra.previewSamples.replaceChildren();
  for (const sample of result.samples || []) {
    const line = document.createElement("div");
    line.textContent = `${sample.before} → ${sample.replacement || "（删除）"}`;
    extra.previewSamples.append(line);
  }
  extra.applyPreviewButton.disabled = !result.count;
  extra.applyPreviewButton.textContent =  `确认${action} ${result.count} 处`;
  extra.previewPanel.hidden = false;
}

for (const button of [extra.closePreviewButton, extra.cancelPreviewButton]) button.addEventListener("click", () => {
  extra.previewPanel.hidden = true;
  previewPlan = null;
});
extra.applyPreviewButton.addEventListener("click", async () => {
  if (!previewPlan) return;
  extra.applyPreviewButton.disabled = true;
  const sourceTabId = previewPlan.sourceTabId;
  if (globalThis.PmfWorkspace && (await PmfWorkspace.target().catch(() => null))?.id !== sourceTabId) {
    previewPlan = null;
    extra.previewTitle.textContent = '未执行替换';
    extra.previewScope.textContent = '操作网页已切换或关闭，请在目标网页重新预览';
    return;
  }
  if (!previewPlan) return;
  const mode = previewPlan.mode;
  const result = await send({ type: "applyReplace", planId: previewPlan.planId }, previewPlan.sourceTabId);
  previewPlan = null;
  if (!result || result.error) {
    extra.previewTitle.textContent = "未执行替换";
    extra.previewScope.textContent = result?.error || "页面连接中断，请检查内容后重新预览";
    return;
  }
  extra.previewPanel.hidden = true;
  showReplacementResult(previewTerms, result, mode);
});

// Persistent views must receive changes made by another view or quick-add.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const current = storagePayload();
  const changed = Object.keys(current).some(key => changes[key] && !sameData(changes[key].newValue, current[key]));
  if (changed) load(false).then(() => showStatus('已同步其他窗口 / 快速添加的修改'));
});
load();
for (const [id, name] of Object.entries({ themeButton: 'theme', detachButton: 'window', sidePanelButton: 'sidebar', copySchemeButton: 'copy', schemesLeft: 'left', schemesRight: 'right' })) document.getElementById(id).innerHTML = icon(name);

// Select once on entry; later clicks can position the caret normally.
els.list.addEventListener('focusin', event => {
  if (event.target.matches('.term-replacement')) event.target.select();
});
document.getElementById('themeButton').addEventListener('click', () => {
  state.darkMode = !state.darkMode;
  document.documentElement.classList.toggle('dark', state.darkMode);
  document.getElementById('themeButton').setAttribute('aria-pressed', String(state.darkMode));
  save();
});
document.getElementById('closeWrapButton').addEventListener('click', () => { document.getElementById('wrapPanel').hidden = true; });
document.addEventListener('keydown', event => { if (event.key === 'Escape') document.getElementById('wrapPanel').hidden = true; });
document.getElementById('saveWrapButton').addEventListener('click', () => {
  const settings = Object.fromEntries(['prefix', 'suffix', 'pattern', 'flags', 'template'].map(key => [key, document.getElementById(`wrap-${key}`).value]));
  try { if (settings.pattern) new RegExp(settings.pattern, settings.flags); }
  catch (error) { showStatus(`正则无效：${error.message}`); return; }
  state.wrapSettings = settings;
  save();
  document.getElementById('wrapPanel').hidden = true;
  showStatus('已保存；点击词条右侧 [] 应用');
});

// Storage may reorder object properties. Compare values, not serialization order.
function sameData(a, b) {
  const stable = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a],[b]) => a.localeCompare(b))) : v);
  return stable(a) === stable(b);
}
function projectSchemes() { return state.schemes.filter(s => s.projectId === state.activeProjectId); }
function nextSchemeName() {
  const names = new Set(projectSchemes().map(s => s.name));
  let n = 1; while (names.has(`方案${n}`)) n++;
  return `方案${n}`;
}
function renderProjects() {
  const select = document.getElementById('projectSelect');
  select.replaceChildren(...state.projects.map(p => new Option(p.name, p.id)));
  select.value = state.activeProjectId;
}
document.getElementById('projectSelect').addEventListener('change', async event => {
  state.projects.find(p => p.id === state.activeProjectId).activeSchemeId = state.activeSchemeId;
  state.activeProjectId = event.target.value;
  const project = state.projects.find(p => p.id === state.activeProjectId);
  state.activeSchemeId = projectSchemes().find(s => s.id === project.activeSchemeId)?.id || projectSchemes()[0].id;
  render(); els.color.value = nextAutoColor(); await save(true);
});
document.getElementById('addProjectButton').addEventListener('click', async () => {
  const name = prompt('新项目名称', `项目${state.projects.length + 1}`)?.trim();
  if (!name) return;
  const project = { id: uid(), name };
  const scheme = { id: uid(), projectId: project.id, name: '方案1', terms: [] };
  state.projects.push(project); state.schemes.push(scheme);
  state.activeProjectId = project.id; state.activeSchemeId = scheme.id;
  render(); els.color.value = nextAutoColor(); await save(true);
});
document.getElementById('renameProjectButton').addEventListener('click', async () => {
  const project = state.projects.find(p => p.id === state.activeProjectId);
  const name = prompt('项目名称', project.name)?.trim();
  if (!name) return;
  project.name = name; renderProjects(); await save();
});
document.getElementById('appendAllButton').addEventListener('click', () => {
  const selected = terms().filter(t => t.enabled && t.keyword && !t.compact);
  if (!selected.length) return showStatus('当前没有可追加的词条');
  previewReplacement(selected, 'append');
});

// Keep edit history per rule, including programmatic bracket edits.
const replacementHistory = new Map();
function rememberReplacement(term) {
  let history = replacementHistory.get(term.id);
  if (!history) replacementHistory.set(term.id, history = { undo: [], redo: [] });
  history.undo.push(term.replacement); history.redo.length = 0;
  if (history.undo.length > 100) history.undo.shift();
}
els.list.addEventListener('compositionstart', event => {
  if (!event.target.matches('.term-replacement')) return;
  const term = terms().find(t => t.id === event.target.closest('.term').dataset.id);
  rememberReplacement(term);
});
els.list.addEventListener('keydown', event => {
  if (!event.target.matches('.term-replacement') || event.isComposing || !(event.ctrlKey || event.metaKey) || !['z','y'].includes(event.key.toLowerCase())) return;
  event.preventDefault();
  const row = event.target.closest('.term');
  const term = terms().find(t => t.id === row.dataset.id);
  const history = replacementHistory.get(term.id);
  const redo = event.shiftKey || event.key.toLowerCase() === 'y';
  const source = history?.[redo ? 'redo' : 'undo'];
  if (!source?.length) return;
  history[redo ? 'undo' : 'redo'].push(term.replacement);
  term.replacement = source.pop(); term.deleteMatch = false;
  event.target.value = term.replacement;
  event.target.setSelectionRange(term.replacement.length, term.replacement.length);
  updateTermControls(row, term); save();
});
