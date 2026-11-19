// 11/19 수정 테스트: 선택지 정리, 재시도 판단, 여러 종류 주식 수
const assert = require('assert');
process.env.SHEET_WEBHOOK_URL = 'https://sheet.example/exec';
let rows = [];
global.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true, rows }) });
const L = require('../api/_lib.js');
const { pickShares } = require('../api/_data.js');

(async () => {
  assert.strictEqual(L.cleanChoice('이야기', '성장 | 물가 | 정책 | 위험 회피·지정학 | 실적·개별 이슈 | 뚜렷한 동인 없음'), '');
  assert.strictEqual(L.cleanChoice('이야기', '물가'), '물가');
  assert.strictEqual(L.cleanChoice('국면 판단', '골디락스 쪽 | 판단 보류'), '판단 보류');
  assert.strictEqual(L.cleanChoice('뷰 변화', '강화 (위험 회피 심화)'), '강화');
  const c = L.cleanChief({ '이야기': '성장 | 물가', '뷰 변화': '유지' });
  assert.strictEqual(c['이야기'], ''); assert.strictEqual(c['뷰 변화'], '유지');
  console.log('ok - 선택지 목록을 그대로 쓴 답은 지움');

  const at = (iso) => new Date(iso);
  rows = [];
  assert.strictEqual(await L.retrySkip({ sheet: 's', field: 'f', cutoffMin: 600, now: at('2026-11-18T22:20:00Z') }), '7시 자동 실행 전'); // 목 07:20
  assert.strictEqual(await L.retrySkip({ sheet: 's', field: 'f', cutoffMin: 600, now: at('2026-11-18T22:50:00Z') }), ''); // 07:50, 줄 없음 → 만듦
  rows = [{ '날짜': '2026-11-19', f: '{}' }];
  assert.strictEqual(await L.retrySkip({ sheet: 's', field: 'f', cutoffMin: 600, now: at('2026-11-18T22:50:00Z') }), '오늘 것이 이미 있음');
  rows = [{ '날짜': '2026-11-19', f: '' }];
  assert.strictEqual(await L.retrySkip({ sheet: 's', field: 'f', cutoffMin: 600, now: at('2026-11-18T23:40:00Z') }), '');
  assert.strictEqual(await L.retrySkip({ sheet: 's', field: 'f', cutoffMin: 600, now: at('2026-11-19T01:10:00Z') }), '재시도 시간 지남'); // 10:10
  assert.strictEqual(await L.retrySkip({ sheet: 's', field: 'f', cutoffMin: 600, now: at('2026-11-21T22:50:00Z') }), '주말'); // 일 07:50
  console.log('ok - 산업·기업 재시도는 실패한 평일 아침에만');

  const multi = { units: { shares: [{ end: '2026-10-31', val: 1.7e9 }, { end: '2026-10-31', val: 8e6 }] } };
  assert.deepStrictEqual(pickShares(multi, { units: { shares: [{ frame: 'CY2025', val: 1.99e9 }] } }), { shares: 1.99e9, sharesNote: '희석 가중평균 주식수' });
  assert.strictEqual(pickShares(multi, null).shares, null);
  assert.strictEqual(pickShares({ units: { shares: [{ end: '2026-01-01', val: 5e9 }] } }, null).shares, 5e9);
  console.log('ok - 주식 종류가 여러 개면 희석 주식수로 시가총액 계산');
})().catch((e) => { console.error(e); process.exit(1); });
