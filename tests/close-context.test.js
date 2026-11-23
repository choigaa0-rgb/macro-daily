// 장 마감 복기: 아침 정보 넘기기 테스트
const assert = require('assert');
process.env.SHEET_WEBHOOK_URL = 'https://sheet.example/exec';
const sheets = {
  '자동 브리핑': [{ '날짜': '2026-11-23', '생성시각': '2026. 11. 23. 7시 50분 56초', '한 줄 요약': 'AI 투매', '토론 JSON': JSON.stringify({ open: { bull: { claim: '금리 하락', points: ['엔비디아 매출 +103%'], korea: '수출 호조' }, bear: { claim: 'AI 거품', points: ['SOX -10%'] } } }) }],
  '산업 이슈': [{ '날짜': '2026-11-23', '생성시각': '2026. 11. 23. 7시 5분 16초', '한 줄 요약': '정책 대응', '이슈 JSON': JSON.stringify({ issues: [{ industry: '증권', title: '정부 증안펀드 가동 준비' }] }) }],
};
global.fetch = async (url) => {
  const sheet = new URL(String(url)).searchParams.get('sheet') || '';
  return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, rows: sheets[sheet] || [] }) };
};
const { morningContext, kstMin } = require('../api/compare.js');
(async () => {
  assert.strictEqual(kstMin('2026. 11. 19. 10시 33분 15초'), 633);
  const t = await morningContext('2026-11-23');
  assert.ok(t.includes('정부 증안펀드 가동 준비'), t);
  assert.ok(t.includes('엔비디아 매출 +103%'), t);
  console.log('ok - 아침 브리핑 근거와 산업 이슈 제목을 복기 AI에 넘김');
  sheets['산업 이슈'][0]['생성시각'] = '2026. 11. 23. 10시 33분 15초';
  const t2 = await morningContext('2026-11-23');
  assert.ok(!t2.includes('증안펀드') && t2.includes('장 시작 뒤에 만들어져'), t2);
  console.log('ok - 장 시작 뒤에 만든 산업 이슈는 아침 정보로 치지 않음');
  assert.strictEqual(await morningContext('2026-11-24'), '(시트에 저장된 아침 정보 없음)');
  console.log('ok - 그날 기록이 없으면 없다고 씀');
})().catch((e) => { console.error(e); process.exit(1); });
