// 아침 자동 브리핑 흐름 테스트 (가짜 Gemini·가짜 시트): node tests/morning.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
process.env.GEMINI_API_KEY = 'test';
process.env.APP_PASSCODE = 'pw';
process.env.CRON_SECRET = 'cron';
process.env.SHEET_WEBHOOK_URL = 'https://sheet.example/exec';
process.env.SHEET_SECRET = 's';
process.env.MORNING_MAIL_TO = 'me@example.com';

const posted = [];
const debate = {
  headline: '(테스트) 금리 상승 속 반도체 강세, 한국은 디커플링',
  bull: { claim: '성장 이야기 유효', points: ['a', 'b', 'c'], korea: 'k', forecast: { '미국10년물': '상승', 'S&P500': '상승', '원달러': '하락', 'KOSPI': '상승' } },
  bear: { claim: '긴축 경계', points: ['a', 'b', 'c'], korea: 'k', forecast: { '미국10년물': '상승', 'S&P500': '하락', '원달러': '상승', 'KOSPI': '하락' } },
  rebut: { bull: { rebuttal: 'r', concede: 'c' }, bear: { rebuttal: 'r', concede: 'c' } },
  risk: { balance: '팽팽', reason: 'x', key_issue: 'y', bull_wrong_if: 'p', bear_wrong_if: 'q', scenarios: [], checkpoints: ['CPI'] },
  chief: { '오늘의 동인': '동인', '이야기': '정책', '국면 판단': '판단 보류', '뷰 변화': '유지', '투자 시사점': '유리: 금융', '종합 해석': '(테스트) AI 센터장 결론', '전망': { '미국10년물': '상승', 'S&P500': '보합', '원달러': '상승', 'KOSPI': '하락' } },
};
let geminiFails = false;
global.fetch = async (url, opts) => {
  if (String(url).includes('generativelanguage')) {
    if (geminiFails) return { ok: false, status: 400, json: async () => ({ error: { message: 'bad key' } }) };
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(debate) }] } }] }) };
  }
  if (String(url).startsWith('https://sheet.example')) {
    posted.push(JSON.parse(opts.body));
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true }) };
  }
  throw new Error('unexpected ' + url);
};

const handler = require('../api/morning.js');
function call(query, headers = {}) {
  return new Promise((resolve) => {
    const req = { url: `/api/morning?${query}`, headers: Object.assign({ host: 'macro.test' }, headers) };
    const res = { statusCode: 200, setHeader() {}, end(b) { resolve({ status: this.statusCode, body: JSON.parse(b) }); } };
    handler(req, res);
  });
}

(async () => {
  let r = await call('mock=1');
  assert.strictEqual(r.status, 401);
  console.log('ok - 인증 없으면 거절');

  r = await call('mock=1&date=2026-11-10', { authorization: 'Bearer cron' });
  assert.ok(r.body.ok, JSON.stringify(r.body));
  const rec = posted.find((p) => p.sheet === '자동 브리핑').record;
  const mail = posted.find((p) => p.action === 'mail');
  assert.strictEqual(rec['날짜'], '2026-11-10');
  assert.strictEqual(rec['리스크팀 판단'], '팽팽');
  assert.ok(JSON.parse(rec['토론 JSON']).auto);
  assert.strictEqual(JSON.parse(rec['AI 결론 JSON'])['종합 해석'], '(테스트) AI 센터장 결론');
  assert.strictEqual(rec['AI전망_KOSPI'], '하락'); assert.strictEqual(rec['BULL전망_KOSPI'], '상승');
  assert.ok(mail.html.includes('오늘의 결론 (AI 센터장)'));
  assert.strictEqual(mail.to, 'me@example.com');
  assert.ok(mail.subject.includes('11/10') && mail.subject.includes('팽팽'));
  assert.ok(mail.html.includes('https://macro.test/'));
  fs.writeFileSync(path.join(process.argv[2] || '/tmp', 'morning-mail.html'), mail.html);
  console.log('ok - 크론 실행: 시트 저장 + 메일 발송', r.body.steps.join(' → '));

  posted.length = 0;
  geminiFails = true;
  r = await call('mock=1&pass=pw&nomail=1');
  assert.ok(r.body.ok);
  assert.ok(!posted.some((p) => p.action === 'mail'));
  assert.ok(posted[0].record['AI 오류']);
  console.log('ok - AI 실패해도 데이터·신호는 저장, nomail이면 메일 안 보냄');
})().catch((e) => { console.error(e); process.exit(1); });
