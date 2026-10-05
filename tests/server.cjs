const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const files = new Set(['popup.html', 'popup.css', 'popup.js', 'palette.js', 'view.js', 'workspace.js', 'content.js', 'rules.js', 'materials.js', 'tests/harness.html', 'tests/harness.js', 'tests/mock-popup.js']);
for (const name of ['index.html', 'demo.css', 'demo.js', 'README.md', 'downloads/persistent-multi-find-v1.14.0.zip']) files.add(name);
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  let name = url.pathname.slice(1) || 'tests/harness.html';
  if (name === 'popup-test.html') name = 'popup.html';
  if (!files.has(name)) { res.writeHead(404); res.end('Not found'); return; }
  let body = fs.readFileSync(path.join(root, name));
  if (url.pathname === '/popup-test.html') body = body.toString().replace('<head>', '<head><script src="/tests/mock-popup.js"></script>');
  res.setHeader('Content-Type', name.endsWith('.zip') ? 'application/zip' : name.endsWith('.md') ? 'text/plain; charset=utf-8' : name.endsWith('.html') ? 'text/html; charset=utf-8' : name.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}).listen(8894, '127.0.0.1', () => console.log('Local extension fixture: http://127.0.0.1:8894/tests/harness.html'));
