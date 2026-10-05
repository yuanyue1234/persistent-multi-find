(() => {
  const $ = id => document.getElementById(id);
  const original = $('sourceInput').value;
  let preview = null, previous = null;
  const mode = () => document.querySelector('input[name="mode"]:checked').value;
  function render() {
    preview = null;
    $('applyButton').disabled = true;
    const source = $('sourceInput').value;
    $('output').textContent = source;
    const term = { id: 'demo', enabled: true, keyword: $('matchInput').value,
      replacement: $('replacementInput').value, regex: $('regexInput').checked,
      exclusions: $('excludeInput').value.split('\n').map(s => s.trim()).filter(Boolean),
      append: mode() === 'append' };
    try { PmfRules.compile(term, $('caseInput').checked); }
    catch { $('matchCount').textContent = '无法匹配'; $('demoStatus').textContent = '请填写匹配文字，并检查正则及排除表达式。'; return; }
    const highlights = PmfRules.transform(source, [{ ...term, append: false, deleteMatch: true }], $('caseInput').checked);
    $('matchCount').textContent = `${highlights.count} 处匹配`;
    $('outputLabel').textContent = mode() === 'highlight' ? '匹配预览' : '修改后预览';
    if (mode() === 'highlight') {
      $('output').replaceChildren();
      let cursor = 0;
      for (const hit of highlights.applied) {
        $('output').append(source.slice(cursor, hit.start));
        const mark = document.createElement('mark'); mark.textContent = hit.original;
        $('output').append(mark); cursor = hit.end;
      }
      $('output').append(source.slice(cursor));
      $('demoStatus').textContent = '仅高亮：保留原文，不执行修改。';
    } else {
      const result = PmfRules.transform(source, [term], $('caseInput').checked);
      $('output').textContent = result.value;
      preview = result.count ? result.value : null;
      $('applyButton').disabled = preview === null;
      $('demoStatus').textContent = result.count ? `将修改 ${result.count} 处；确认后应用到示例。` : '没有需要修改的内容。';
    }
  }
  function invalidate() {
    preview = null; $('applyButton').disabled = true;
    $('output').textContent = $('sourceInput').value;
    $('matchCount').textContent = '待预览'; $('demoStatus').textContent = '内容已变化，请重新预览。';
  }
  $('demoForm').addEventListener('submit', event => { event.preventDefault(); render(); });
  $('demoForm').addEventListener('input', invalidate);
  $('sourceInput').addEventListener('input', invalidate);
  $('wrapButton').onclick = () => {
    const input = $('replacementInput');
    if (!(input.value.startsWith('[') && input.value.endsWith(']'))) input.value = `[${input.value}]`;
    invalidate();
  };
  $('applyButton').onclick = () => {
    if (preview === null) return;
    previous = $('sourceInput').value; $('sourceInput').value = preview;
    invalidate(); $('undoDemoButton').disabled = false;
    $('demoStatus').textContent = '已应用到示例，可撤回本次操作。';
  };
  $('undoDemoButton').onclick = () => {
    if (previous === null) return;
    $('sourceInput').value = previous; previous = null; $('undoDemoButton').disabled = true; render();
  };
  $('resetButton').onclick = () => {
    $('demoForm').reset(); $('sourceInput').value = original;
    previous = null; $('undoDemoButton').disabled = true; render();
  };
  document.querySelectorAll('[data-preset]').forEach(button => button.onclick = () => {
    $('resetButton').click();
    const preset = button.dataset.preset;
    document.querySelector(`input[name="mode"][value="${preset === 'append' ? 'append' : 'replace'}"]`).checked = true;
    if (preset === 'append') $('replacementInput').value = '（身穿雨衣）';
    if (preset === 'exclude') {
      $('matchInput').value = '祭坛'; $('replacementInput').value = '神坛'; $('excludeInput').value = '悬崖祭坛';
    }
    if (preset === 'regex') {
      $('matchInput').value = '(张)(小乙)'; $('replacementInput').value = '$2$1'; $('regexInput').checked = true;
    }
    render();
  });
  render();
})();
