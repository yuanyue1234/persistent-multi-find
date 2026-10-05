/* Shared, DOM-free rules. Asset IDs deliberately stay strings (larger than 2^53). */
(() => {
  const referenceSource = String.raw`\[@([^\[\]#\r\n]+)#(\d+)\]`;
  const escape = text => String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  function references(text) {
    return Array.from(String(text || "").matchAll(new RegExp(referenceSource, "g")), match => ({
      token: match[0], name: match[1], id: match[2], start: match.index, end: match.index + match[0].length
    }));
  }
  function compile(term, caseSensitive) {
    const parts = String(term.keyword || "").split(/\s+-/);
    const source = parts.shift().trim();
    if (!source) throw new Error("匹配词不能为空");
    const exclusions = Array.isArray(term.exclusions) ? term.exclusions : parts.map(p => p.trim()).filter(Boolean);
    const pattern = value => new RegExp(term.regex ? value : escape(value), caseSensitive ? "g" : "gi");
    return { expression: pattern(source), exclusions: exclusions.map(pattern) };
  }
  function matches(expression, text) {
    const result = [];
    let match;
    expression.lastIndex = 0;
    while ((match = expression.exec(text))) {
      if (match[0].length) result.push(match);
      else expression.lastIndex += 1;
    }
    return result;
  }
  function expand(template, match, input) {
    return String(template).replace(/\$(\$|&|`|'|<([^>]+)>|(\d{1,2}))/g, (whole, token, name, number) => {
      if (token === "$") return "$";
      if (token === "&") return match[0];
      if (token === "`") return input.slice(0, match.index);
      if (token === "'") return input.slice(match.index + match[0].length);
      if (name !== undefined) return match.groups ? match.groups[name] ?? "" : whole;
      const index = Number(number);
      if (index > 0 && index < match.length) return match[index] ?? "";
      if (number?.length === 2 && Number(number[0]) > 0 && Number(number[0]) < match.length) return (match[Number(number[0])] ?? "") + number[1];
      return whole;
    });
  }
  function transform(text, terms, caseSensitive = false, additionalProtectedRanges = []) {
    text = String(text);
    const protectedRanges = [...references(text), ...additionalProtectedRanges];
    const candidates = [];
    const errors = [];
    for (const [priority, term] of terms.entries()) {
      if (!term.enabled || !term.keyword || term.compact) continue;
      let spec;
      try { spec = compile(term, caseSensitive); } catch { errors.push(term.keyword); continue; }
      const excluded = spec.exclusions.flatMap(re => matches(re, text).map(m => ({ start: m.index, end: m.index + m[0].length })));
      for (const match of matches(spec.expression, text)) {
        const start = match.index, end = start + match[0].length;
        if (protectedRanges.some(r => start < r.end && end > r.start)) continue;
        if (excluded.some(r => r.start <= start && r.end >= end)) continue;
        const suffix = term.deleteMatch ? '' : term.regex ? expand(term.replacement ?? "", match, text) : String(term.replacement ?? "");
        const replacement = term.append ? match[0] + suffix : suffix;
        if (replacement !== match[0]) candidates.push({ start, end, original: match[0], replacement, id: term.id, priority });
      }
    }
    candidates.sort((a, b) => a.start - b.start || b.end - a.end || a.priority - b.priority);
    let cursor = 0, output = "";
    const applied = [], ruleCounts = {};
    for (const hit of candidates) {
      if (hit.start < cursor) continue;
      output += text.slice(cursor, hit.start) + hit.replacement;
      cursor = hit.end;
      applied.push(hit);
      ruleCounts[hit.id] = (ruleCounts[hit.id] || 0) + 1;
    }
    return { value: output + text.slice(cursor), count: applied.length, applied, ruleCounts, errors };
  }
  const api = { references, compile, transform };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else globalThis.PmfRules = api;
})();
