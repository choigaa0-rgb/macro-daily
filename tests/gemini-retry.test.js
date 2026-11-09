// Gemini 재시도 로직 테스트 (가짜 fetch 사용): node tests/gemini-retry.test.js
const assert = require('assert');
process.env.GEMINI_API_KEY = 'test';
const lib = require('../api/_lib.js');

async function run(responses) {
  let calls = 0;
  const models = [];
  global.fetch = async (url) => {
    models.push(decodeURIComponent(url.split('/models/')[1].split(':')[0]));
    const r = responses[Math.min(calls++, responses.length - 1)];
    return { ok: r.status === 200, status: r.status, json: async () => r.body };
  };
  const out = await lib.callGemini({ system: 's', parts: [{ text: 'x' }] });
  return { out, calls, models };
}
const busy = { status: 503, body: { error: { message: 'This model is currently experiencing high demand.' } } };
const good = { status: 200, body: { candidates: [{ content: { parts: [{ text: '분석 결과' }] } }] } };

(async () => {
  let r = await run([busy, good]);
  assert.strictEqual(r.out.ok, true); assert.strictEqual(r.calls, 2);
  console.log('ok - 한 번 몰림 후 재시도 성공');

  process.env.GEMINI_FALLBACK_MODEL = 'backup-model';
  r = await run([busy, busy, good]);
  assert.strictEqual(r.out.ok, true); assert.strictEqual(r.models[2], 'backup-model');
  console.log('ok - 두 번 몰리면 예비 모델로 성공');

  r = await run([busy, busy, busy]);
  assert.strictEqual(r.out.ok, false); assert.ok(r.out.error.includes('몇 분 뒤'));
  console.log('ok - 계속 몰리면 안내 문구');

  r = await run([{ status: 400, body: { error: { message: 'bad key' } } }]);
  assert.strictEqual(r.out.ok, false); assert.strictEqual(r.calls, 1);
  console.log('ok - 키 오류 등은 재시도하지 않음');
})();
