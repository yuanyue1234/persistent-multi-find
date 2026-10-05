const test = require('node:test');
const assert = require('node:assert/strict');
const { references, transform, compile } = require('../rules.js');
const ref = '[@罗温-作战服05#2100561479451070464]';
const rule = (keyword, replacement, extra = {}) => ({ id: keyword, keyword, replacement, enabled: true, regex: false, exclusions: [], ...extra });

test('reference IDs retain all digits; multiple refs and invalid refs', () => {
  assert.equal(references(ref)[0].id, '2100561479451070464');
  assert.equal(references(ref)[0].token, ref);
  assert.equal(references(ref + ref).length, 2);
  assert.equal(references('[@罗温#] [@罗温#abc] [@罗温]').length, 0);
});
test('literal keyword replaces every original occurrence', () => {
  const result = transform('罗温背着罗温', [rule('罗温', ref)]);
  assert.equal(result.value, `${ref}背着${ref}`);
  assert.equal(result.count, 2);
});
test('existing reference stays untouched and a second application is idempotent', () => {
  const rules = [rule('罗温', ref), rule('作战服05', '别的版本')];
  const result = transform(`罗温 ${ref}`, rules);
  assert.equal(result.value, `${ref} ${ref}`);
  assert.equal(transform(result.value, rules).count, 0);
});
test('references cannot be matched across either boundary', () => {
  assert.equal(transform(`前${ref}后`, [rule('前.*后', '破坏', { regex: true })]).count, 0);
});
test('replacement output is never processed by subsequent rules', () => {
  assert.equal(transform('A B', [rule('A', 'B'), rule('B', 'C')]).value, 'B C');
});
test('longest overlap wins at the same start', () => {
  assert.equal(transform('塞拉-腿部包扎 塞拉', [rule('塞拉', '短'), rule('塞拉-腿部包扎', '长')]).value, '长 短');
});
test('exclusion preserves full excluded phrase', () => {
  const result = transform('祭坛 悬崖祭坛 祭坛', [rule('祭坛', '神坛', { exclusions: ['悬崖祭坛'] })]);
  assert.equal(result.value, '神坛 悬崖祭坛 神坛');
  assert.equal(result.count, 2);
});
test('legacy exclusion syntax and empty dash', () => {
  assert.equal(transform('祭坛 悬崖祭坛', [rule('祭坛 -悬崖祭坛', '新', { exclusions: undefined })]).value, '新 悬崖祭坛');
  assert.equal(transform('罗温', [rule('罗温 -', ref)]).value, ref);
});
test('regex captures, groups and replacement semantics', () => {
  assert.equal(transform('角色12', [rule('角色(\\d+)', '$1 / $& / $$', { regex: true })]).value, '12 / 角色12 / $');
  assert.equal(transform('ABC', [rule('(?<name>ABC)', '$<name>-$<missing>', { regex: true })]).value, 'ABC-');
  assert.equal(transform('AB', [rule('(A)(B)', '$12-$0', { regex: true })]).value, 'A2-$0');
});
test('literal replacement dollar symbols are not interpreted', () => {
  assert.equal(transform('A', [rule('A', '$1 $$ $&')]).value, '$1 $$ $&');
});
test('regex punctuation stays literal unless enabled', () => {
  assert.equal(transform('学生若. 学生若风', [rule('学生若.', '新')]).count, 1);
  assert.equal(transform('学生若. 学生若风', [rule('学生若.', '新', { regex: true })]).count, 2);
});
test('invalid regex is reported; zero length matches terminate', () => {
  assert.deepEqual(transform('A', [rule('[', '', { regex: true })]).errors, ['[']);
  assert.equal(transform('AAA', [rule('(?=A)', 'B', { regex: true })]).count, 0);
  assert.throws(() => compile(rule('A', 'B', { regex: true, exclusions: ['['] })));
});
test('case, disabled and no-op behavior', () => {
  assert.equal(transform('A a', [rule('A', 'B')]).count, 2);
  assert.equal(transform('A a', [rule('A', 'B')], true).count, 1);
  assert.equal(transform('A', [rule('A', 'B', { enabled: false })]).count, 0);
  assert.equal(transform('A', [rule('A', 'A')]).count, 0);
});
test('empty replacement deletes and highlight-only rules never replace', () => {
  assert.equal(transform('AABB', [rule('A', ''), rule('B', 'C')]).value, 'CC');
  assert.equal(transform('AABB', [rule('A', '', { compact: true }), rule('B', 'C')]).value, 'AACC');
  assert.equal(transform('A', [rule('A', 'Z', { compact: true, deleteMatch: true })]).value, 'A');
  const result = transform('AABB', [rule('A', '', { deleteMatch: true }), rule('B', 'C')]);
  assert.equal(result.value, 'CC');
  assert.deepEqual(result.ruleCounts, { A: 2, B: 2 });
});

test('append keeps original text, expands regex captures and does nothing for empty content', () => {
  assert.equal(transform('AA BB', [rule('AA','!',{append:true})]).value,'AA! BB');
  assert.equal(transform('A12', [rule('A(\\d+)','[$1]',{regex:true,append:true})]).value,'A12[12]');
  assert.equal(transform('AA', [rule('AA','',{append:true})]).count,0);
  assert.equal(transform('AA', [rule('AA','!',{append:true,compact:true})]).count,0);
});
