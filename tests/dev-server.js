// 로컬 테스트용 서버 (배포에는 쓰이지 않음)
// 실행: node tests/dev-server.js  →  http://localhost:3000
// - /api/* 는 api 폴더의 함수를 그대로 실행
// - SHEET_WEBHOOK_URL이 없으면 메모리 속 가짜 시트(/__fakesheet)를 대신 씁니다.

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 3000;
const fake = { 데일리: [], 주간: [] };

if (!process.env.SHEET_WEBHOOK_URL) {
  process.env.SHEET_WEBHOOK_URL = `http://localhost:${PORT}/__fakesheet`;
  process.env.SHEET_SECRET = process.env.SHEET_SECRET || 'dev';
}

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/__fakesheet') {
    if (req.method === 'POST') {
      let raw = '';
      for await (const c of req) raw += c;
      const b = JSON.parse(raw);
      if (b.secret !== process.env.SHEET_SECRET) return end(res, { ok: false, error: 'secret 불일치' });
      const rows = fake[b.sheet] || (fake[b.sheet] = []);
      const i = rows.findIndex((r) => r['날짜'] === b.record['날짜']);
      if (i >= 0) rows[i] = b.record; else rows.push(b.record);
      return end(res, { ok: true, sheet: b.sheet, row: (i >= 0 ? i : rows.length - 1) + 2, updated: i >= 0 });
    }
    const rows = (fake[url.searchParams.get('sheet')] || []).slice().sort((a, b) => b['날짜'].localeCompare(a['날짜']));
    return end(res, { ok: true, rows });
  }

  if (url.pathname.startsWith('/api/')) {
    const name = url.pathname.slice(5).replace(/[^a-z]/g, '');
    const file = path.join(ROOT, 'api', name + '.js');
    if (!fs.existsSync(file)) return end(res, { ok: false, error: 'not found' }, 404);
    try { return await require(file)(req, res); } catch (e) { return end(res, { ok: false, error: e.message }, 500); }
  }

  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.join(ROOT, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`dev server: http://localhost:${PORT}`));

function end(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}
