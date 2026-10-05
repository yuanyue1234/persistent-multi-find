/* Keep the source tab distinct from the extension's own detached window. */
(() => {
  const params = new URLSearchParams(location.search);
  const view = params.get('view') || 'popup';
  const rawTab = params.get('tabId');
  const pinnedTabId = rawTab && /^\d+$/.test(rawTab) ? Number(rawTab) : null;
  let initialTab = null;
  async function target() {
    if (pinnedTabId !== null) return chrome.tabs.get(pinnedTabId);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url?.startsWith(chrome.runtime?.getURL?.('') || 'chrome-extension://')) return null;
    return tab || null;
  }
  async function prepare() {
    initialTab = await target().catch(() => null);
    const label = document.getElementById('targetLabel');
    label.hidden = view === 'popup';
    label.textContent = view === 'window' ? `固定关联原网页 · 标签 ${initialTab?.id ?? '已关闭'}` : '侧边栏 · 操作当前网页';
    document.getElementById('detachButton').disabled = view === 'window';
    const side = document.getElementById('sidePanelButton');
    side.disabled = !chrome.sidePanel?.open || !initialTab;
    if (chrome.sidePanel?.setOptions && initialTab && view === 'popup') {
      // Preconfigure before the click; open() must run directly in a user gesture.
      await chrome.sidePanel.setOptions({ path: 'popup.html?view=side', enabled: true });
    }
  }
  document.getElementById('detachButton').addEventListener('click', async () => {
    try {
      const tab = await target();
      if (!tab) throw new Error('请先打开要操作的网页');
      await chrome.windows.create({ url: chrome.runtime.getURL(`popup.html?view=window&tabId=${tab.id}`), type: 'popup', width: 480, height: 680, focused: true });
      if (view === 'popup') window.close();
    } catch (error) { showStatus(`无法打开独立窗口：${error.message}`); }
  });
  document.getElementById('sidePanelButton').addEventListener('click', () => {
    if (!initialTab || !chrome.sidePanel?.open) return showStatus('浏览器不支持侧边栏，请使用独立窗口');
    chrome.sidePanel.open({ windowId: initialTab.windowId }).then(() => {
      if (view === 'popup') window.close();
    }).catch(error => showStatus(`侧边栏未打开：${error.message}`));
  });
  globalThis.PmfWorkspace = { target, prepare, view };
  prepare().catch(error => showStatus(error.message));
})();
