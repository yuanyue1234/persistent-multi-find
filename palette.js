/* Shared by popup and quick-add: choose the most separated available highlight. */
(() => {
  const rgb = hex => hex.match(/[a-f\d]{2}/gi).map(v => parseInt(v, 16) / 255);
  const lab = hex => {
    const [r,g,b] = rgb(hex).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    const l = Math.cbrt(.4122214708*r + .5363325363*g + .0514459929*b);
    const m = Math.cbrt(.2119034982*r + .6806995451*g + .1073969566*b);
    const s = Math.cbrt(.0883024619*r + .2817188376*g + .6299787005*b);
    return [.2104542553*l+.793617785*m-.0040720468*s, 1.9779984951*l-2.428592205*m+.4505937099*s, .0259040371*l+.7827717662*m-.808675766*s];
  };
  const colors = [];
  for (const light of [.7,.55,.83]) for (const saturation of [.85,.5]) for (let hue=0;hue<360;hue+=15) {
    const a = saturation * Math.min(light, 1-light);
    const values = [0,8,4].map(n => { const k=(n+hue/30)%12; return light-a*Math.max(-1,Math.min(k-3,9-k,1)); });
    const hex = '#' + values.map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join('');
    // Keep sufficient luminance for the highlighter's dark foreground.
    const linear = values.map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
    if (.2126*linear[0]+.7152*linear[1]+.0722*linear[2] >= .25) colors.push(hex);
  }
  const coordinates = new Map(colors.map(color=>[color,lab(color)]));
  function next(terms) {
    const used = terms.map(t=>String(t.color || '').toLowerCase()).filter(c=>/^#[a-f\d]{6}$/.test(c));
    if (!used.length) return '#ffe066';
    const points = used.map(lab);
    const candidates = colors.filter(c=>!used.includes(c));
    // ponytail: finite palette; reuse least-used colors once every candidate is taken.
    if (!candidates.length) return colors.reduce((a,b)=>used.filter(c=>c===a).length<=used.filter(c=>c===b).length?a:b);
    const distance = c => Math.min(...points.map(p=>coordinates.get(c).reduce((sum,v,i)=>sum+(v-p[i])**2,0)));
    return candidates.reduce((a,b)=>distance(a)>=distance(b)?a:b);
  }
  globalThis.PmfColors = { next };
})();
