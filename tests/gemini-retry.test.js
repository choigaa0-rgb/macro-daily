// Gemini 호출 로직 테스트 (가짜 fetch 사용): node tests/gemini-retry.test.js
const assert = require('assert');
process.env.GEMINI_API_KEY = 'test';
const lib = require('../api/_lib.js');

const LIST = { status: 200, body: { models: [
  { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-3-flash-lite', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-3.8-flash-lite-preview', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/text-embedding-9', supportedGenerationMethods: ['embedContent'] },
] } };
const busy = { status: 503, body: { error: { message: 'This model is currently experiencing high demand.' } } };
const good = { status: 200, body: { candidates: [{ content: { parts: [{ thought: true, text: '생각' }, { text: '분석 결과' }] } }] } };
const TIMEOUT = 'TIMEOUT';

// responses: 모델 생성 요청에 차례로 줄 응답 (TIMEOUT이면 시간 초과 에러)
async function run(responses) {
  let calls = 0;
  const models = [];
  global.fetch = async (url) => {
    if (/\/models\?/.test(url)) return { ok: true, status: 200, json: async () => LIST.body };
    models.push(decodeURIComponent(url.split('/models/')[1].split(':')[0]));
    const r = responses[Math.min(calls++, responses.length - 1)];
    if (r === TIMEOUT) throw new Error('The operation was aborted due to timeout');
    return { ok: r.status === 200, status: r.status, json: async () => r.body };
  };
  const out = await lib.callGemini({ system: 's', parts: [{ text: 'x' }] });
  return { out, calls, models };
}

(async () => {
  assert.strictEqual(lib.pickLight(LIST.body.models.map((m) => m.name.replace('models/', '')), 'gemini-3.8-flash'), 'gemini-3.5-flash-lite');
  console.log('ok - 가벼운 모델 자동 선택 (정식 버전 중 최신)');

  let r = await run([good]);
  assert.ok(r.out.ok); assert.strictEqual(r.out.text, '분석 결과');
  console.log('ok - 바로 성공, 생각 부분은 빼고 답만');

  r = await run([TIMEOUT, good]);
  assert.ok(r.out.ok); assert.strictEqual(r.out.model, 'gemini-3.5-flash-lite');
  console.log('ok - 기본 모델이 느리면 가벼운 모델로 성공');

  r = await run([busy, busy, good]);
  assert.ok(r.out.ok); assert.deepStrictEqual(r.models, ['gemini-3.8-flash', 'gemini-3.8-flash', 'gemini-3.5-flash-lite']);
  console.log('ok - 몰림 → 한 번 더 → 가벼운 모델');

  r = await run([TIMEOUT, TIMEOUT]);
  assert.ok(!r.out.ok); assert.ok(r.out.error.includes('시간 안에'));
  console.log('ok - 둘 다 느리면 안내');

  r = await run([{ status: 400, body: { error: { message: 'Unknown name "thinkingLevel" at generation_config.thinking_config' } } }, good]);
  assert.ok(r.out.ok); assert.strictEqual(r.calls, 2);
  console.log('ok - thinking 설정을 모르는 모델이면 빼고 다시');

  r = await run([{ status: 400, body: { error: { message: 'API key not valid' } } }]);
  assert.ok(!r.out.ok); assert.strictEqual(r.calls, 1);
  console.log('ok - 키 오류는 재시도하지 않음');
})().catch((e) => { console.error(e); process.exit(1); });
