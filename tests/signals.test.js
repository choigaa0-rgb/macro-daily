// 자동 해석 규칙 테스트: node tests/signals.test.js
const assert = require('assert');
const S = require('../signals.js');

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok -', name); }

t('커브: 2년물이 더 오르면 베어 플래트닝', () => assert.strictEqual(S.curve(10, 5).name, '베어 플래트닝'));
t('커브: 10년물이 더 오르면 베어 스티프닝', () => assert.strictEqual(S.curve(3, 9).name, '베어 스티프닝'));
t('커브: 2년물이 더 내리면 불 스티프닝', () => assert.strictEqual(S.curve(-12, -4).name, '불 스티프닝'));
t('커브: 10년물이 더 내리면 불 플래트닝', () => assert.strictEqual(S.curve(-3, -8).name, '불 플래트닝'));
t('커브: 작은 변화는 보합', () => assert.strictEqual(S.curve(1, -1).name, '보합'));
t('커브: 엇갈림은 트위스트', () => assert.strictEqual(S.curve(5, -4).name, '트위스트 플래트닝'));

t('조합: 금리↑ 주식↑ = 좋은 금리 상승', () => assert.strictEqual(S.stockRate(6, 0.8).name, '좋은 금리 상승'));
t('조합: 금리↑ 주식↓ = 나쁜 금리 상승', () => assert.strictEqual(S.stockRate(6, -0.8).name, '나쁜 금리 상승'));
t('조합: 금리↓ 주식↑ = 골디락스', () => assert.strictEqual(S.stockRate(-6, 0.8).name, '골디락스'));
t('조합: 금리↓ 주식↓ = 위험 회피', () => assert.strictEqual(S.stockRate(-6, -0.8).name, '위험 회피'));

t('배열: 상승장 정배열', () => assert.ok(S.alignment({ dow: 0.2, spx: 0.5, ndx: 0.9, rut: 1.4 }).name.startsWith('정배열')));
t('배열: 상승장 역배열 감지', () => assert.strictEqual(S.alignment({ dow: 0.2, spx: 0.5, ndx: 1.9, rut: 0.3 }).name, '역배열'));
t('배열: 빅테크 쏠림 메모', () => assert.ok(S.alignment({ dow: 0.2, spx: 0.5, ndx: 1.9, rut: 0.3 }).notes.some((x) => x.includes('빅테크'))));
t('배열: 하락장 정배열', () => assert.ok(S.alignment({ dow: -0.2, spx: -0.5, ndx: -0.9, rut: -1.4 }).name.startsWith('정배열')));

t('분해: 기대인플레 주도 상승', () => assert.strictEqual(S.decompose(1, 6, 7).name, '기대인플레 주도 상승'));
t('분해: 실질금리 주도 하락', () => assert.strictEqual(S.decompose(-8, -1, -9).name, '실질금리 주도 하락'));

t('VIX 구간', () => {
  assert.strictEqual(S.vixRegime(14).name, '안정');
  assert.strictEqual(S.vixRegime(21).name, '변동성 확대');
  assert.strictEqual(S.vixRegime(27).name, '위험 회피 심화');
});

t('달러: VIX 급등 + 주가 하락 = 위험 회피형 강세', () => assert.strictEqual(S.dollar(0.6, 1, 12, -1.2).name, '위험 회피형 강세'));
t('달러: 2년물 상승 동반 = 금리형 강세', () => assert.strictEqual(S.dollar(0.5, 8, -2, 0.3).name, '금리형 강세'));

const mock = require('../api/_mock.js');
t('목업 전체 신호 계산', () => {
  const all = S.all(mock.items);
  assert.strictEqual(all.curve.name, '베어 플래트닝');
  assert.strictEqual(all.stockRate.name, '나쁜 금리 상승');
  assert.ok(all.korea);
  assert.ok(all.phase);
});

t('한국: 미국 상승인데 KOSPI 하락', () => {
  const items = { spx: { ok: true, chg: 0.8 }, sox: { ok: true, chg: 1.2 }, kospi: { ok: true, chg: -0.9 }, usdkrw: { ok: true, chg: 0.5, value: 1420, prev: 1408 } };
  const k = S.korea(items);
  assert.strictEqual(k.name, '미국과 반대로 약세');
  assert.ok(k.notes.some((x) => x.includes('10원')));
});

console.log(`\n${n}개 테스트 통과`);
