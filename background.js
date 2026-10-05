importScripts('palette.js');
const ROOT_ID = "pmf-root";
const ADD_ID = "pmf-add-selection";
const SCHEMES_ID = "pmf-schemes";
const NEW_SCHEME_ID = "pmf-new-scheme";
const SWITCH_PREFIX = "pmf-switch:";

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function nextAutoColor(terms) { return PmfColors.next(terms); }

async function readSchemes() {
  const data = await chrome.storage.local.get({ terms: [], schemes: null, activeSchemeId: null, activeProjectId: null });
  let schemes = Array.isArray(data.schemes) && data.schemes.length ? data.schemes : null;
  if (!schemes) schemes = [{ id: uid(), name: "方案1", projectId: "default", terms: data.terms || [] }];
  let activeSchemeId = schemes.some((scheme) => scheme.id === data.activeSchemeId)
    ? data.activeSchemeId
    : schemes[0].id;
  const activeProjectId = data.activeProjectId || schemes.find(s => s.id === activeSchemeId)?.projectId || "default";
  return { schemes, activeProjectId, activeSchemeId, active: schemes.find((scheme) => scheme.id === activeSchemeId) };
}

async function rebuildContextMenu() {
  const { schemes, activeSchemeId, active, activeProjectId } = await readSchemes();
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: ROOT_ID, title: "多词高亮", contexts: ["all"] });
  chrome.contextMenus.create({
    id: ADD_ID,
    parentId: ROOT_ID,
    title: `快速标注到「${active.name}」：%s`,
    contexts: ["selection"]
  });
  chrome.contextMenus.create({ id: "pmf-separator-1", parentId: ROOT_ID, type: "separator", contexts: ["all"] });
  chrome.contextMenus.create({ id: SCHEMES_ID, parentId: ROOT_ID, title: `切换方案（${active.name}）`, contexts: ["all"] });
  for (const scheme of schemes.filter(s => (s.projectId || "default") === activeProjectId)) {
    chrome.contextMenus.create({
      id: `${SWITCH_PREFIX}${scheme.id}`,
      parentId: SCHEMES_ID,
      title: scheme.name,
      type: "radio",
      checked: scheme.id === activeSchemeId,
      contexts: ["all"]
    });
  }
  chrome.contextMenus.create({ id: "pmf-separator-2", parentId: ROOT_ID, type: "separator", contexts: ["all"] });
  chrome.contextMenus.create({ id: NEW_SCHEME_ID, parentId: ROOT_ID, title: "＋ 新建并切换方案", contexts: ["all"] });
}

let menuRebuildQueue = Promise.resolve();
function scheduleMenuRebuild() {
  menuRebuildQueue = menuRebuildQueue.catch(() => {}).then(rebuildContextMenu);
  return menuRebuildQueue;
}

chrome.runtime.onInstalled.addListener(scheduleMenuRebuild);
chrome.runtime.onStartup.addListener(scheduleMenuRebuild);
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && (changes.schemes || changes.activeSchemeId)) scheduleMenuRebuild();
});

async function addSelectionToActive(selectionText, tabId, frameId = 0) {
  const keyword = String(selectionText || "").trim();
  if (!keyword || keyword.length > 1000) return { error: '请选择 1—1000 字的关键词' };
  let replacement = keyword;
  if (tabId) {
    try {
      const catalog = await chrome.tabs.sendMessage(tabId, { type: 'readMaterials' }, { frameId });
      replacement = catalog?.items?.find(item => item.name === keyword && !item.ambiguous)?.replacement || keyword;
    } catch { /* Quick highlighting also works on ordinary pages. */ }
  }
  const { schemes, activeSchemeId, active } = await readSchemes();
  const exists = active.terms.some((term) => term.keyword === keyword);
  if (!exists) {
    active.terms.push({
      id: uid(), keyword, replacement, color: nextAutoColor(active.terms), enabled: true, regex: false, exclusions: []
    });
    await chrome.storage.local.set({ schemes, activeSchemeId, terms: active.terms });
  }
  if (tabId) {
    chrome.tabs.sendMessage(tabId, {
      type: "showPmfToast",
      text: exists ? `「${keyword}」已在 ${active.name}` : `已标注到 ${active.name}`
    }).catch(() => {});
  }
  return { added: !exists, schemeName: active.name, keyword, replacement };
}

let quickAddQueue = Promise.resolve();
function queueSelection(text, tabId, frameId = 0) {
  const next = quickAddQueue.catch(() => {}).then(() => addSelectionToActive(text, tabId, frameId));
  quickAddQueue = next;
  return next;
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type !== 'quickAddSelection' || !sender.tab?.id) return;
  queueSelection(message.text, sender.tab.id, sender.frameId || 0).then(respond).catch(error => respond({ error: error.message }));
  return true;
});

async function switchActiveScheme(schemeId, tabId) {
  const { schemes, activeProjectId } = await readSchemes();
  const scheme = schemes.find((item) => item.id === schemeId);
  if (!scheme || (scheme.projectId || "default") !== activeProjectId) return null;
  await chrome.storage.local.set({ schemes, activeSchemeId: scheme.id, terms: scheme.terms });
  if (tabId) {
    chrome.tabs.sendMessage(tabId, { type: "showPmfToast", text: `已切换到 ${scheme.name}` }).catch(() => {});
  }
  return { schemeId: scheme.id, schemeName: scheme.name };
}

async function createAndSwitchScheme(tabId) {
  const { schemes, activeProjectId } = await readSchemes();
  const names = new Set(schemes.filter(s => (s.projectId || "default") === activeProjectId).map((scheme) => scheme.name));
  let index = 1;
  while (names.has(`方案${index}`)) index += 1;
  const scheme = { id: uid(), name: `方案${index}`, projectId: activeProjectId, terms: [] };
  schemes.push(scheme);
  await chrome.storage.local.set({ schemes, activeSchemeId: scheme.id, terms: [] });
  if (tabId) {
    chrome.tabs.sendMessage(tabId, { type: "showPmfToast", text: `已新建并切换到 ${scheme.name}` }).catch(() => {});
  }
  return scheme;
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const id = String(info.menuItemId);
  if (id === ADD_ID) await queueSelection(info.selectionText, tab?.id, info.frameId || 0);
  else if (id === NEW_SCHEME_ID) await createAndSwitchScheme(tab?.id);
  else if (id.startsWith(SWITCH_PREFIX)) await switchActiveScheme(id.slice(SWITCH_PREFIX.length), tab?.id);
});

scheduleMenuRebuild();
