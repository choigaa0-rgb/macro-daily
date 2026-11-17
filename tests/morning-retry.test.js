// 아침 브리핑 재시도 테스트: node tests/morning-retry.test.js
const assert = require('assert');
process.env.GEMINI_API_KEY = 'test';
process.env.CRON_SECRET = 'cron';
process.env.SHEET_WEBHOOK_URL = 'https://sheet.example/exec';
process.env.SHEET_SECRET = 's';
delete process.env.MORNING_MAIL_TO;

const posted = [];
let todayRow = null;
global.fetch = async (url, opts) => {
  if (String(url).includes('generativelanguage')) return { ok: false, status: 503, json: async () => ({ error: { message: 'overloaded' } }) };
  if (String(url).startsWith('https://sheet.example')) {
    if (!opts || !opts.body) return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, rows: todayRow ? [todayRow] : [] }) };
    posted.push(JSON.parse(opts.body));
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true }) };
  }
  throw new Error('unexpected ' + url);
};
const handler = require('../api/morning.js');
const call = (query) => new Promise((resolve) => {
  const req = { url: `/api/morning?${query}`, headers: { host: 'macro.test', authorization: 'Bearer cron' } };
  const res = { statusCode: 200, setHeader() {}, end(b) { resolve({ status: this.statusCode, body: JSON.parse(b) }); } };
  handler(req, res);
});
const at = (iso) => new Date(iso); // UTC 시각

(async () => {
  const { retryGate } = handler;
  assert.strictEqual(retryGate(at('2026-11-17T22:40:00Z')), ''); // 수 07:40 KST
  assert.strictEqual(retryGate(at('2026-11-17T23:50:00Z')), ''); // 수 08:50
  assert.ok(retryGate(at('2026-11-17T23:56:00Z')).includes('개장')); // 수 08:56
  assert.ok(retryGate(at('2026-11-20T22:40:00Z')).includes('주말')); // 토 07:40
  console.log('ok - 재시도는 평일 08:55 전까지만');

  // 오늘 성공한 브리핑이 있으면 AI가 실패한 실행이 덮어쓰지 않음
  const kst = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  todayRow = { '날짜': kst, 'AI 결론 JSON': '{"종합 해석":"좋은 결론"}' };
  const r = await call('mock=1');
  assert.ok(r.body.kept, JSON.stringify(r.body));
  assert.strictEqual(posted.filter((p) => p.sheet === '자동 브리핑').length, 0);
  console.log('ok - 성공한 오늘 브리핑을 실패본으로 덮어쓰지 않음');

  // 오늘 줄이 없거나 실패본이면 평소처럼 저장
  todayRow = { '날짜': kst, 'AI 오류': '혼잡' };
  const r2 = await call('mock=1');
  assert.ok(r2.body.ok && !r2.body.kept);
  assert.strictEqual(posted.filter((p) => p.sheet === '자동 브리핑').length, 1);
  console.log('ok - 실패본은 다시 저장');
})().catch((e) => { console.error(e); process.exit(1); });
