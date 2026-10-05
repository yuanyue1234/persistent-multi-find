/* Public editor DOM only. Never read application stores or guess asset IDs. */
(() => {
  const chipSelector = '.mention-chip, [data-mention], [contenteditable="false"]';
  const binding = name => `{{图片:${name}}}`;
  const boundName = value => /^\{\{图片:([^\r\n{}]+)\}\}$/.exec(String(value || ''))?.[1] || null;
  function boundary(text) {
    const match = /(?:^|\n)[\t \u200b#*]*生成段\s*[0-9０-９一二三四五六七八九十]+(?=[\s｜|:：])/m.exec(text);
    return match ? match.index + (match[0].startsWith('\n') ? 1 : 0) : -1;
  }
  function pictureName(tail) {
    return /^\s*是\s*([^，,；;\n]+)/.exec(tail)?.[1].trim() || '';
  }
  function flatten(root) {
    let text = '';
    const parts = [], chips = [];
    function visit(node) {
      if (node.nodeType === 3) {
        const start = text.length; text += node.nodeValue;
        parts.push({ node, start, end: text.length }); return;
      }
      if (node.nodeType !== 1) return;
      if (node.matches('script, style, [data-pmf-ui]')) return;
      if (node.tagName === 'BR') { text += '\n'; return; }
      if (node !== root && node.matches(chipSelector)) {
        const start = text.length; text += node.textContent;
        chips.push({ node, start, end: text.length }); return;
      }
      const block = /^(DIV|P|LI|H[1-6])$/.test(node.tagName);
      if (block && text && !text.endsWith('\n')) text += '\n';
      for (const child of node.childNodes) visit(child);
      if (block && !text.endsWith('\n')) text += '\n';
    }
    visit(root);
    return { text, parts, chips, boundary: boundary(text) };
  }
  function scan(root) {
    const flat = flatten(root);
    if (flat.boundary < 0) return { ...flat, items: [], error: '未找到独立的“生成段1 / 生成段2…”标题；为保护正文，没有读取或替换。' };
    const header = flat.text.slice(0, flat.boundary);
    const candidates = [];
    for (const chip of flat.chips.filter(item => item.end <= flat.boundary)) {
      const imageLabel = /@图片\s*\d+/.exec(chip.node.textContent);
      if (!imageLabel) continue;
      const name = pictureName(chip.node.textContent.slice(imageLabel.index + imageLabel[0].length)) || pictureName(header.slice(chip.end));
      if (name) candidates.push({ name, node: chip.node, identity: chip.node.outerHTML, label: chip.node.textContent.trim() });
    }
    for (const ref of PmfRules.references(header)) {
      // Explicit raw references are usable even without a rendered mention chip.
      if (/^(音频|视频)\s*\d+$/.test(ref.name) || /(?:声音|音频|视频)参考\s*$/.test(header.slice(Math.max(0, ref.start - 40), ref.start))) continue;
      const name = /^图片\s*\d+$/.test(ref.name) ? pictureName(header.slice(ref.end)) : ref.name;
      if (name) candidates.push({ name, token: ref.token, identity: ref.token, label: ref.name });
    }
    const names = new Map();
    for (const item of candidates) {
      if (!names.has(item.name)) names.set(item.name, new Map());
      names.get(item.name).set(item.identity, item);
    }
    const items = [...names].map(([name, values]) => ({ ...values.values().next().value, ambiguous: values.size > 1 }));
    return { ...flat, items, error: items.length ? null : '顶部未找到可复用的图片标签或完整引用。可继续使用“手动粘贴引用”，请勿只粘贴 @图片编号。' };
  }
  function cloneChip(node) {
    const copy = node.cloneNode(true);
    for (const element of [copy, ...copy.querySelectorAll('*')]) {
      if (element.matches('script, iframe, object, embed, style, link')) { element.remove(); continue; }
      for (const attr of [...element.attributes]) {
        if (/^on/i.test(attr.name) || attr.name === 'id' || attr.name === 'srcdoc' ||
            /^(href|src|xlink:href|action|formaction)$/i.test(attr.name) && /^\s*javascript:/i.test(attr.value)) element.removeAttribute(attr.name);
      }
    }
    copy.setAttribute('contenteditable', 'false');
    return copy;
  }
  const api = { binding, boundName, boundary, pictureName, flatten, scan, cloneChip };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.PmfMaterials = api;
})();
