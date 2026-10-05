(() => {
  if (window.__PMF_LOADED__) return;
  window.__PMF_LOADED__ = true;

  const MARK_CLASS = "pmf-highlight";
  const STYLE_CLASS = "pmf-highlight-styles";
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "OPTION"]);
  const supportsNativeHighlights = Boolean(globalThis.CSS?.highlights && globalThis.Highlight);
  let config = { terms: [], enabled: true, caseSensitive: false };
  let observer;
  let refreshTimer;
  let working = false;
  let registeredHighlightNames = [];
  const replacementHistory = [];
  let pendingPlan = null;
  let lastEditor = null;
  document.addEventListener("focusin", event => {
    if (event.target.closest?.("[data-pmf-ui]")) return;
    const target = event.target.closest?.('[contenteditable="true"], textarea, input[type="text"], input:not([type])');
    if (target) lastEditor = target;
  });

  const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  function acceptedTextNode(node) {
    const parent = node.parentElement;
    if (!parent || !node.nodeValue?.trim()) return false;
    if (SKIP_TAGS.has(parent.tagName)) return false;
    if (parent.closest(`.${MARK_CLASS}, [data-pmf-ui]`)) return false;
    return true;
  }

  function activeTerms() {
    return config.enabled
      ? config.terms.filter((term) => term.enabled && term.keyword).sort((a, b) => b.keyword.length - a.keyword.length)
      : [];
  }

  function collectRoots() {
    const roots = [document];
    for (let index = 0; index < roots.length; index += 1) {
      for (const element of roots[index].querySelectorAll("*")) {
        if (element.shadowRoot && !roots.includes(element.shadowRoot)) roots.push(element.shadowRoot);
      }
    }
    return roots;
  }

  function collectTextNodes(roots = collectRoots()) {
    const nodes = [];
    for (const root of roots) {
      const target = root === document ? document.body : root;
      if (!target) continue;
      const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => acceptedTextNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
      });
      while (walker.nextNode()) nodes.push(walker.currentNode);
    }
    return nodes;
  }

  function observeAllRoots() {
    if (!document.body) return;
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    for (const root of collectRoots().slice(1)) {
      observer.observe(root, { childList: true, subtree: true, characterData: true });
    }
  }

  function clearHighlights() {
    if (supportsNativeHighlights) {
      for (const name of registeredHighlightNames) CSS.highlights.delete(name);
      registeredHighlightNames = [];
    }
    for (const root of collectRoots()) {
      root.querySelectorAll(`style.${STYLE_CLASS}`).forEach((style) => style.remove());
      root.querySelectorAll(`mark.${MARK_CLASS}`).forEach((mark) => {
        const parent = mark.parentNode;
        mark.replaceWith(document.createTextNode(mark.textContent));
        parent?.normalize();
      });
    }
  }

  function splitTermSyntax(keyword) {
    const parts = String(keyword || "").split(/\s+-/);
    const source = (parts.shift() || "").trim();
    return { source, exclusions: parts.map((part) => part.trim()).filter(Boolean) };
  }

  function compilePattern(source, useRegex) {
    try {
      return new RegExp(useRegex ? source : escapeRegExp(source), config.caseSensitive ? "g" : "gi");
    } catch {
      return null;
    }
  }

  function compileTerm(term) {
    const parsed = splitTermSyntax(term.keyword);
    const source = parsed.source;
    const exclusions = Array.isArray(term.exclusions) ? term.exclusions : parsed.exclusions;
    if (!source) return null;
    const expression = compilePattern(source, term.regex);
    if (!expression) return null;
    return {
      expression,
      exclusions: exclusions.map((item) => compilePattern(item, term.regex)).filter(Boolean)
    };
  }

  function exclusionRanges(text, spec) {
    const ranges = [];
    for (const expression of spec.exclusions) {
      expression.lastIndex = 0;
      let match;
      while ((match = expression.exec(text))) {
        if (match[0].length) ranges.push([match.index, expression.lastIndex]);
        else expression.lastIndex += 1;
      }
    }
    return ranges;
  }

  function isExcluded(ranges, start, end) {
    return ranges.some(([from, to]) => from <= start && to >= end);
  }

  function installHighlightStyles(roots, entries) {
    const css = entries.map(({ name, term }) =>
      `::highlight(${name}){background-color:${term.color || "#ffe066"};color:#111;text-decoration:none;}`
    ).join("\n");
    for (const root of roots) {
      const style = document.createElement("style");
      style.className = STYLE_CLASS;
      style.textContent = css;
      if (root === document) (document.head || document.documentElement).append(style);
      else root.append(style);
    }
  }

  function nativeHighlight(terms, roots, nodes) {
    const entries = terms.map((term, index) => ({
      term,
      name: `pmf-${index}`,
      highlight: new Highlight(),
      spec: compileTerm(term)
    })).filter((entry) => entry.spec);
    let count = 0;
    for (const node of nodes) {
      for (const entry of entries) {
        const { expression } = entry.spec;
        const excluded = exclusionRanges(node.nodeValue, entry.spec);
        expression.lastIndex = 0;
        let match;
        while ((match = expression.exec(node.nodeValue))) {
          if (match[0].length) {
            if (isExcluded(excluded, match.index, expression.lastIndex)) continue;
            const range = new Range();
            range.setStart(node, match.index);
            range.setEnd(node, expression.lastIndex);
            entry.highlight.add(range);
            count += 1;
          } else {
            expression.lastIndex += 1;
          }
        }
      }
    }
    for (const entry of entries) {
      CSS.highlights.set(entry.name, entry.highlight);
      registeredHighlightNames.push(entry.name);
    }
    installHighlightStyles(roots, entries);
    return count;
  }

  function fallbackHighlight(terms, nodes) {
    let count = 0;
    for (const node of nodes) {
      const text = node.nodeValue;
      const matches = [];
      terms.forEach((term, priority) => {
        const spec = compileTerm(term);
        if (!spec) return;
        const { expression } = spec;
        const excluded = exclusionRanges(text, spec);
        let match;
        while ((match = expression.exec(text))) {
          if (match[0].length) {
            if (!isExcluded(excluded, match.index, expression.lastIndex)) {
              matches.push({ start: match.index, end: expression.lastIndex, text: match[0], term, priority });
            }
          } else expression.lastIndex += 1;
        }
      });
      matches.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start) || a.priority - b.priority);
      let lastIndex = 0;
      const fragment = document.createDocumentFragment();
      for (const match of matches) {
        if (match.start < lastIndex) continue;
        count += 1;
        if (match.start > lastIndex) fragment.append(document.createTextNode(text.slice(lastIndex, match.start)));
        const mark = document.createElement("mark");
        mark.className = MARK_CLASS;
        mark.dataset.termId = match.term.id;
        mark.textContent = match.text;
        mark.style.cssText = `background:${match.term.color || "#ffe066"}!important;color:#111!important;border-radius:2px!important;`;
        fragment.append(mark);
        lastIndex = match.end;
      }
      if (lastIndex > 0) {
        if (lastIndex < text.length) fragment.append(document.createTextNode(text.slice(lastIndex)));
        node.replaceWith(fragment);
      }
    }
    return count;
  }

  function highlight() {
    if (!document.body || working) return 0;
    working = true;
    observer?.disconnect();
    try {
      clearHighlights();
      const terms = activeTerms();
      if (!terms.length) return 0;
      const roots = collectRoots();
      const nodes = collectTextNodes(roots);
      return supportsNativeHighlights
        ? nativeHighlight(terms, roots, nodes)
        : fallbackHighlight(terms, nodes);
    } finally {
      working = false;
      observeAllRoots();
    }
  }

  function scheduleHighlight() {
    if (working) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(highlight, 180);
  }

  async function loadAndHighlight() {
    const stored = await chrome.storage.local.get({ terms: [], schemes: null, activeSchemeId: null, enabled: true, caseSensitive: false });
    const activeScheme = Array.isArray(stored.schemes)
      ? stored.schemes.find((scheme) => scheme.id === stored.activeSchemeId) || stored.schemes[0]
      : null;
    config = { ...stored, terms: activeScheme?.terms || stored.terms || [] };
    return highlight();
  }

  function showToast(text) {
    document.querySelector("[data-pmf-ui='toast']")?.remove();
    const toast = document.createElement("div");
    toast.dataset.pmfUi = "toast";
    toast.textContent = text;
    toast.style.cssText = "position:fixed;right:18px;bottom:18px;z-index:2147483647;padding:10px 14px;border-radius:9px;background:#172033;color:#fff;font:13px/1.4 system-ui,sans-serif;box-shadow:0 8px 24px #0004;pointer-events:none;";
    document.documentElement.append(toast);
    setTimeout(() => toast.remove(), 1800);
  }

  // Only an explicit click saves the selection; selecting alone never edits data.
  let quickAddHost = null;
  function hideQuickAdd() { quickAddHost?.remove(); quickAddHost = null; }
  document.addEventListener('pointerdown', event => {
    if (!event.composedPath().includes(quickAddHost)) hideQuickAdd();
  }, true);
  document.addEventListener('pointerup', event => {
    if (event.button !== 0 || event.composedPath().includes(quickAddHost)) return;
    const target = event.target;
    if (target.closest?.('[data-pmf-ui], input[type="password"]')) return;
    setTimeout(() => {
      if (!config.enabled) return;
      let text = '', rect;
      if (target.matches?.('textarea, input[type="text"], input[type="search"], input:not([type])')) {
        text = target.value.slice(target.selectionStart || 0, target.selectionEnd || 0).trim();
        rect = { left: event.clientX, bottom: event.clientY, top: event.clientY };
      } else {
        const selection = window.getSelection();
        if (!selection?.rangeCount || selection.isCollapsed) return;
        const node = selection.anchorNode;
        if ((node?.nodeType === 1 ? node : node?.parentElement)?.closest?.('[data-pmf-ui]')) return;
        text = selection.toString().trim();
        rect = selection.getRangeAt(0).getBoundingClientRect();
      }
      if (!text || text.length > 1000) return;
      hideQuickAdd();
      const host = document.createElement('div');
      host.dataset.pmfUi = 'quick-add';
      host.style.cssText = `all:initial;position:fixed;z-index:2147483647;left:${Math.max(6, Math.min(rect.left, innerWidth - 42))}px;top:${Math.max(6, rect.bottom + 38 < innerHeight ? rect.bottom + 6 : rect.top - 38)}px;`;
      const shadow = host.attachShadow({ mode: 'open' });
      const wrapper = document.createElement('div'); wrapper.dataset.pmfUi = 'quick-add-inner';
      const button = document.createElement('button');
      button.type = 'button';
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '15'); svg.setAttribute('height', '15'); svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.8'); svg.setAttribute('stroke-linecap', 'round');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', 'M12 5v14M5 12h14');
      svg.append(path); button.append(svg);
      button.title = `添加“${text.slice(0, 30)}”到当前方案`;
      button.setAttribute('aria-label', '快速添加到当前方案');
      button.style.cssText = 'all:initial;box-sizing:border-box;display:grid;place-items:center;width:28px;height:28px;border-radius:8px;background:#fff;color:#315efb;border:1px solid #dce3f5;box-shadow:0 2px 8px #17203324;cursor:pointer;';
      button.addEventListener('pointerdown', e => e.preventDefault());
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          const result = await chrome.runtime.sendMessage({ type: 'quickAddSelection', text });
          if (!result || result.error) throw new Error(result?.error || '插件连接中断，请刷新页面');
          hideQuickAdd();
        } catch (error) { hideQuickAdd(); showToast(error.message); }
      });
      wrapper.append(button); shadow.append(wrapper); document.documentElement.append(host); quickAddHost = host;
    }, 0);
  });
  document.addEventListener('scroll', hideQuickAdd, true);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hideQuickAdd(); });
  document.addEventListener('selectionchange', () => { if (window.getSelection()?.isCollapsed && !document.activeElement?.matches('input, textarea')) hideQuickAdd(); });

  const protectedSelector = '[data-mention], .mention-chip, [contenteditable="false"], [data-pmf-ui]';
  const fieldSelector = 'textarea, input[type="text"], input:not([type])';
  const visible = element => element.isConnected && element.getClientRects().length > 0;
  const isField = element => element.matches(fieldSelector);
  const editorValue = element => isField(element) ? element.value : element.innerHTML;

  function editorFor(node) {
    return node.parentElement?.closest('[contenteditable="true"]');
  }

  function promptEditors() {
    return Array.from(document.querySelectorAll('.video-prompt-mention-editor__input[contenteditable="true"]')).filter(visible);
  }

  function readMaterials() {
    const prompts = promptEditors();
    if (prompts.length !== 1) return { error: prompts.length ? '发现多个提示词框，请先关闭多余编辑窗口' : '未找到当前提示词框，请先打开分镜编辑页面' };
    const result = PmfMaterials.scan(prompts[0]);
    return { error: result.error, signature: JSON.stringify(result.items.map(item => [item.name, item.identity, item.ambiguous])), items: result.items.map(item => ({ name: item.name, label: item.label, ambiguous: item.ambiguous,
      replacement: PmfMaterials.binding(item.name) })) };
  }

  function previewReplacement(ids, mode = "replace") {
    const append = mode === "append";
    const selection = window.getSelection();
    const selectedRange = selection?.rangeCount && !selection.isCollapsed ? selection.getRangeAt(0).cloneRange() : null;
    const selectedField = lastEditor && isField(lastEditor) && document.activeElement === lastEditor && lastEditor.selectionEnd > lastEditor.selectionStart ? lastEditor : null;
    observer?.disconnect();
    working = true;
    clearHighlights();
    try {
      pendingPlan = null;
      let selected = config.terms.filter(term => ids.includes(term.id) && term.enabled && term.keyword && !term.compact);
      const originalSelected = JSON.stringify(selected);
      const errors = selected.filter(term => { try { PmfRules.compile(term, config.caseSensitive); return false; } catch { return true; } });
      if (errors.length) return { error: `请先修正无效正则：${errors.map(t => t.keyword).join("、")}` };
      const prompts = promptEditors();
      if (prompts.length > 1) return { error: "发现多个提示词框，请先关闭多余编辑窗口" };
      const hasBindings = selected.some(term => !term.deleteMatch && PmfMaterials.boundName(term.replacement));
      const hasReferences = hasBindings || selected.some(term => !term.deleteMatch && PmfRules.references(term.replacement).length);
      const scope = prompts[0] || selectedField || (hasReferences && lastEditor && visible(lastEditor) ? lastEditor : null);
      if (hasReferences && !scope) return { error: "未找到当前提示词框。请先点击要替换的编辑框，再打开插件。不会替换网页素材名称。" };
      if (scope && selectedRange && (!scope.contains(selectedRange.startContainer) || !scope.contains(selectedRange.endContainer))) return { error: '选区不在当前提示词框内，请重新选择；没有进行替换' };
      if (selectedField && scope !== selectedField) return { error: '选中的文本框不是当前提示词框，请重新选择' };
      const catalog = prompts[0] ? PmfMaterials.scan(prompts[0]) : null;
      if (hasBindings && (!catalog || catalog.error)) return { error: catalog?.error || '页面素材绑定只能用于当前分镜提示词框' };
      const templates = new Map();
      const missing = [];
      selected = selected.map(term => {
        term = { ...term, append };
        if (term.deleteMatch) return { ...term, replacement: '' };
        const name = PmfMaterials.boundName(term.replacement);
        if (!name) return term;
        const item = catalog.items.find(item => item.name === name);
        if (!item || item.ambiguous) { missing.push(`${name}（${item ? '同名冲突' : '当前素材已移除'}）`); return term; }
        if (item.node) templates.set(term.id, PmfMaterials.cloneChip(item.node));
        return { ...term, replacement: item.token || term.replacement };
      });
      if (missing.length) return { error: `请重新读取并确认素材：${missing.join('、')}；本次未替换` };
      const plan = { id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`, url: location.href, selected: originalSelected, ids, templates, append,
        caseSensitive: config.caseSensitive, count: 0, ruleCounts: {}, changes: [], editors: new Map(), samples: [],
        scope: prompts[0] ? "当前分镜提示词（不修改左侧素材）" : scope ? "刚才选中的编辑框" : "当前页面正文与文本框", protected: 0 };
      if (catalog?.boundary >= 0) plan.scope = '当前分镜“生成段”及下方剧本（顶部素材说明不改）';
      if (selectedRange || selectedField) plan.scope = '仅选中文字' + (catalog?.boundary >= 0 ? '（仍保护顶部素材说明与已有引用）' : '（不修改选区外内容）');
      if (scope) plan.editors.set(scope, { target: scope, before: editorValue(scope) });
      const nodes = scope && isField(scope) ? [] : collectTextNodes(scope ? [scope] : collectRoots());
      const fields = scope ? (isField(scope) ? [scope] : []) : collectRoots().flatMap(root => Array.from(root.querySelectorAll(fieldSelector)));
      plan.protected = (scope || document).querySelectorAll('[data-mention], .mention-chip').length;
      // A pasted reference can be split across formatting spans. Protect its pieces too.
      const splitProtection = new Map();
      if (scope && !isField(scope)) {
        const ranges = PmfRules.references(nodes.map(node => node.nodeValue).join(""));
        plan.protected += ranges.length;
        let offset = 0;
        for (const node of nodes) {
          const end = offset + node.nodeValue.length;
          splitProtection.set(node, ranges.filter(range => range.start < end && range.end > offset)
            .map(range => ({ start: Math.max(0, range.start - offset), end: Math.min(node.nodeValue.length, range.end - offset) })));
          offset = end;
        }
      }
      if (catalog?.boundary >= 0) {
        for (const part of catalog.parts) {
          if (part.start >= catalog.boundary) continue;
          const ranges = splitProtection.get(part.node) || [];
          ranges.push({ start: 0, end: Math.min(part.end, catalog.boundary) - part.start });
          splitProtection.set(part.node, ranges);
        }
      }
      for (const target of [...nodes, ...fields]) {
        const field = target.nodeType === Node.ELEMENT_NODE;
        const parent = field ? target : target.parentElement;
        if (parent.closest(protectedSelector) || parent.closest("textarea, select, button") && !field) continue;
        if (field && (target.disabled || target.readOnly || !visible(target))) continue;
        const oldValue = field ? target.value : target.nodeValue;
        if (!scope || isField(scope)) plan.protected += PmfRules.references(oldValue).length;
        const protectedRanges = [...(splitProtection.get(target) || [])];
        if (selectedRange) {
          if (field || !selectedRange.intersectsNode(target)) continue;
          const start = target === selectedRange.startContainer ? selectedRange.startOffset : 0;
          const end = target === selectedRange.endContainer ? selectedRange.endOffset : oldValue.length;
          if (start) protectedRanges.push({ start: 0, end: start });
          if (end < oldValue.length) protectedRanges.push({ start: end, end: oldValue.length });
        }
        if (selectedField) {
          if (target !== selectedField) continue;
          protectedRanges.push({ start: 0, end: selectedField.selectionStart }, { start: selectedField.selectionEnd, end: oldValue.length });
        }
        const result = PmfRules.transform(oldValue, selected, config.caseSensitive, protectedRanges);
        if (!result.count) continue;
        const editor = field ? target : editorFor(target);
        if (editor && !plan.editors.has(editor)) plan.editors.set(editor, { target: editor, before: editorValue(editor) });
        plan.changes.push({ target, editor, type: field ? "field" : "text", oldValue, value: result.value, applied: result.applied });
        plan.count += result.count;
        for (const [id, count] of Object.entries(result.ruleCounts)) plan.ruleCounts[id] = (plan.ruleCounts[id] || 0) + count;
        for (const hit of result.applied) {
          if (plan.samples.length >= 6) break;
          plan.samples.push({ before: oldValue.slice(Math.max(0, hit.start - 14), hit.end + 14), replacement: templates.has(hit.id) ? (append ? hit.original : '') + templates.get(hit.id).textContent : hit.replacement });
        }
      }
      pendingPlan = plan;
      return { planId: plan.id, count: plan.count, ruleCounts: plan.ruleCounts, scope: plan.scope, protected: plan.protected, samples: plan.samples };
    } finally {
      working = false;
      observeAllRoots();
    }
  }

  function notifyEditor(editor, inputType) {
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType }));
    editor.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function applyReplacement(planId) {
    const plan = pendingPlan;
    pendingPlan = null;
    if (!plan || plan.id !== planId) return { error: "预览已失效，请重新预览" };
    const selected = config.terms.filter(term => plan.ids.includes(term.id) && term.enabled && term.keyword && !term.compact);
    if (plan.url !== location.href || plan.selected !== JSON.stringify(selected) || plan.caseSensitive !== config.caseSensitive) return { error: "页面或规则已变化，请重新预览" };
    if ([...plan.editors.values()].some(item => !item.target.isConnected || editorValue(item.target) !== item.before) ||
        plan.changes.some(change => !change.target.isConnected || (change.type === "field" ? change.target.value : change.target.nodeValue) !== change.oldValue)) {
      return { error: "提示词已变化，请重新预览；本次未做修改" };
    }
    observer?.disconnect();
    working = true;
    try {
      for (const change of plan.changes) {
        if (change.type === "field") {
          const prototype = change.target.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(prototype, "value").set.call(change.target, change.value);
        } else if (change.applied.some(hit => plan.templates.has(hit.id))) {
          const fragment = document.createDocumentFragment();
          let cursor = 0;
          for (const hit of change.applied) {
            fragment.append(document.createTextNode(change.oldValue.slice(cursor, hit.start)));
            if (plan.append && plan.templates.has(hit.id)) fragment.append(document.createTextNode(hit.original));
            fragment.append(plan.templates.has(hit.id) ? plan.templates.get(hit.id).cloneNode(true) : document.createTextNode(hit.replacement));
            cursor = hit.end;
          }
          fragment.append(document.createTextNode(change.oldValue.slice(cursor)));
          change.target.replaceWith(fragment);
        } else change.target.nodeValue = change.value;
      }
      for (const item of plan.editors.values()) notifyEditor(item.target, "insertReplacementText");
      // Allow framework input handlers to reconcile the edited DOM before taking the undo guard.
      await new Promise(resolve => setTimeout(resolve, 0));
      for (const item of plan.editors.values()) item.after = editorValue(item.target);
      if (plan.changes.length) {
        replacementHistory.push(plan);
        if (replacementHistory.length > 10) replacementHistory.shift();
      }
      return { count: plan.count, ruleCounts: plan.ruleCounts, scope: plan.scope };
    } finally {
      working = false;
      observeAllRoots();
      scheduleHighlight();
    }
  }

  async function undoLastReplacement() {
    const plan = replacementHistory.at(-1);
    if (!plan) return { restored: 0 };
    observer?.disconnect();
    working = true;
    clearHighlights();
    try {
      if (plan.url !== location.href || [...plan.editors.values()].some(item => !item.target.isConnected || editorValue(item.target) !== item.after) ||
          plan.changes.filter(change => !change.editor).some(change => !change.target.isConnected || change.target.nodeValue !== change.value)) {
        return { error: "内容已被编辑或已切换分镜，未覆盖你的新内容；请回到原分镜后再试" };
      }
      replacementHistory.pop();
      pendingPlan = null;
      for (const change of plan.changes.filter(change => !change.editor)) change.target.nodeValue = change.oldValue;
      for (const item of plan.editors.values()) {
        if (isField(item.target)) {
          const prototype = item.target.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(prototype, "value").set.call(item.target, item.before);
        } else item.target.innerHTML = item.before;
        notifyEditor(item.target, "historyUndo");
      }
      await new Promise(resolve => setTimeout(resolve, 0));
      return { restored: plan.count };
    } finally {
      working = false;
      observeAllRoots();
      scheduleHighlight();
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'readMaterials') {
      try { sendResponse(readMaterials()); } catch (error) { sendResponse({ error: error.message }); }
      return;
    }
    if (message.type === "refreshHighlights") {
      loadAndHighlight().then((count) => sendResponse({ ok: true, count }));
      return true;
    }
    if (message.type === "previewReplace") {
      loadAndHighlight().then(() => sendResponse(previewReplacement(message.ids || [], message.mode))).catch(error => sendResponse({ error: error.message }));
      return true;
    }
    if (message.type === "applyReplace") {
      applyReplacement(message.planId).then(sendResponse).catch(error => sendResponse({ error: error.message }));
      return true;
    }
    if (message.type === "undoReplacement") {
      undoLastReplacement().then(sendResponse).catch(error => sendResponse({ error: error.message }));
      return true;
    }
    if (message.type === "showPmfToast") {
      showToast(message.text || "已添加标注");
      sendResponse({ ok: true });
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && (changes.terms || changes.schemes || changes.activeSchemeId || changes.enabled || changes.caseSensitive)) loadAndHighlight();
  });

  observer = new MutationObserver(scheduleHighlight);
  observeAllRoots();
  loadAndHighlight();
})();
