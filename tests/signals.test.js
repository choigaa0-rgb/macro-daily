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

t('날짜 맞추기: 금리 11-05, 주식 11-06이면 신호는 11-05 기준', () => {
  const all = S.all(mock.items);
  assert.strictEqual(all.signalDate, '2026-11-05');
  assert.strictEqual(all.dateMismatch, true);
  // 11-05 S&P500은 하락(-0.85%) → 금리 상승과 묶여 '나쁜 금리 상승'
  assert.strictEqual(all.stockRate.name, '나쁜 금리 상승');
  // 맞추지 않았다면 최신 S&P500(+0.52%)과 묶여 '좋은 금리 상승'이 됐을 것
  assert.strictEqual(S.stockRate(mock.items.us10y.chg, mock.items.spx.chg).name, '좋은 금리 상승');
});

t('날짜 맞추기: 한국은 최신 서울 장으로 비교', () => {
  const all = S.all(mock.items);
  assert.ok(all.korea.detail.includes('-1.48'));
});

t('한국: 미국 상승인데 KOSPI 하락', () => {
  const items = { spx: { ok: true, chg: 0.8 }, sox: { ok: true, chg: 1.2 }, kospi: { ok: true, chg: -0.9 }, usdkrw: { ok: true, chg: 0.5, value: 1420, prev: 1408 } };
  const k = S.korea(items);
  assert.strictEqual(k.name, '미국과 반대로 약세');
  assert.ok(k.notes.some((x) => x.includes('10원')));
});

t('가이드: 평소보다 크게 움직인 것 Top3', () => {
  const m = S.topMovers(mock.items);
  assert.ok(m.length >= 1 && m.length <= 3);
  assert.ok(m[0].score >= m[m.length - 1].score);
});

t('가이드: 이야기 추천', () => {
  const sig = S.all(mock.items);
  const r = S.recommendStory(sig);
  assert.ok(['성장', '물가', '정책', '위험 회피·지정학', '뚜렷한 동인 없음'].includes(r.pick));
  assert.ok(r.why.length >= 1);
  assert.strictEqual(S.recommendStory({ stockRate: { name: '좋은 금리 상승' } }).pick, '성장');
  assert.strictEqual(S.recommendStory({ stockRate: { name: '나쁜 금리 상승' }, decompose: { name: '기대인플레 주도 상승' } }).pick, '물가');
  assert.strictEqual(S.recommendStory({ stockRate: { name: '위험 회피' }, vix: { name: '위험 회피 심화' } }).pick, '위험 회피·지정학');
});

t('채점: 직전 거래일 대비 5거래일 뒤 방향', () => {
  const pts = [['2026-11-02', 100], ['2026-11-03', 101], ['2026-11-04', 102], ['2026-11-05', 99], ['2026-11-06', 100], ['2026-11-09', 101], ['2026-11-10', 103], ['2026-11-11', 104]];
  const f = S.FORECASTS.find((x) => x.id === 'kospi');
  // 11-04 점검 → 기준 11-03(101), 5거래일 뒤 11-10(103) → +1.98% → 상승
  const r = S.scoreOne(pts, '2026-11-04', '상승', f);
  assert.strictEqual(r.status, '채점'); assert.strictEqual(r.actual, '상승'); assert.strictEqual(r.hit, true);
  assert.strictEqual(r.baseDate, '2026-11-03'); assert.strictEqual(r.targetDate, '2026-11-10');
  // 11-09 점검 → 아직 5거래일이 안 지남
  assert.strictEqual(S.scoreOne(pts, '2026-11-09', '하락', f).status, '대기');
  // 보관 이력보다 오래된 기록
  assert.strictEqual(S.scoreOne(pts, '2026-10-01', '하락', f).status, '기간 지남');
  // 전망 안 함
  assert.strictEqual(S.scoreOne(pts, '2026-11-04', '', f).status, '없음');
});

t('채점: 금리는 bp, 보합 범위', () => {
  const f = S.FORECASTS.find((x) => x.id === 'us10y');
  const pts = [['2026-11-02', 4.10], ['2026-11-03', 4.11], ['2026-11-04', 4.12], ['2026-11-05', 4.12], ['2026-11-06', 4.11], ['2026-11-09', 4.13]];
  // 기준 11-02(4.10) → 11-09(4.13) +3bp → 보합(±3bp)
  const r = S.scoreOne(pts, '2026-11-03', '보합', f);
  assert.strictEqual(r.chg, 3); assert.strictEqual(r.actual, '보합'); assert.ok(r.hit);
});

t('채점: 작성 방식별 집계', () => {
  const items = mock.items;
  const dates = items.kospi.pts.map((p) => p[0]);
  const d1 = dates[dates.length - 20], d2 = dates[dates.length - 15];
  const recs = [
    { '날짜': d1, '작성 방식': '직접', '전망_KOSPI': '상승', '전망_원달러': '하락' },
    { '날짜': d2, '작성 방식': 'AI 브리핑', '전망_KOSPI': '하락' },
    { '날짜': dates[dates.length - 1], '전망_KOSPI': '상승' },
  ];
  const { sum } = S.scoreRecords(recs, items);
  assert.strictEqual(sum.all.total, 3);
  assert.strictEqual(sum.byMode['직접'].total, 2);
  assert.strictEqual(sum.byMode['AI 작성'].total, 1);
  assert.strictEqual(sum.pending, 1);
});

t('채점: 출처별 (AI·BULL·BEAR·나) 따로 집계', () => {
  const items = mock.items;
  const dates = items.kospi.pts.map((p) => p[0]);
  const recs = [
    { '날짜': dates[dates.length - 20], 'AI전망_KOSPI': '상승', 'BULL전망_KOSPI': '상승', 'BEAR전망_KOSPI': '하락' },
    { '날짜': dates[dates.length - 18], '전망_KOSPI': '상승' },
    { '날짜': dates[dates.length - 1], 'AI전망_KOSPI': '하락' },
  ];
  const r = S.scoreActors(recs, items).byActor;
  assert.strictEqual(r['AI'].total, 1); assert.strictEqual(r['AI'].pending, 1);
  assert.strictEqual(r['나'].total, 1);
  assert.strictEqual(r['BULL'].hit + r['BEAR'].hit <= 1, true);
});

t('교차검증: AI 문장 숫자 ↔ 데이터', () => {
  const items = mock.items;
  const A = S.align(items).items;
  const text = `미국 2년물 ${A.us2y.chg > 0 ? '+' : ''}${A.us2y.chg}bp 상승, KOSPI ${items.kospi.chg}% 하락, 나스닥 +9.99%, 국고채 10년 +${items.kr10y.chg}bp, 10년물 ${A.us10y.value}%`;
  const v = S.verifyClaims(text, items);
  const by = (id) => v.find((x) => x.id === id);
  assert.strictEqual(by('us2y').status, '일치');
  assert.strictEqual(by('kospi').status, '일치');
  assert.strictEqual(by('ndx').status, '불일치');
  assert.strictEqual(by('kr10y').status, '일치');
  assert.ok(!v.some((x) => x.id === 'us10y' && x.text.includes('국고채')));
  assert.strictEqual(by('us10y').status, '일치'); // 금리 수준 비교
});

t('섹터: 신호에 따른 유리·불리', () => {
  const v = S.sectorView({ stockRate: { name: '나쁜 금리 상승' }, curve: { name: '베어 플래트닝' } }, { usdkrw: { ok: true, chg: 0.6 } });
  const favs = v.fav.map((x) => x.sector), unf = v.unfav.map((x) => x.sector);
  assert.ok(favs.includes('수출주(자동차·조선)'));
  assert.ok(unf.includes('기술·성장주'));
  // 금리 상승은 은행 유리, 플래트닝은 은행 불리 → 엇갈림
  assert.ok(v.mixed.some((x) => x.sector === '금융(은행)'));
  assert.ok(S.sectorText(v).includes('엇갈림'));
  const all = S.all(mock.items);
  assert.ok(all.sectors && Array.isArray(all.sectors.fav));
});

console.log(`\n${n}개 테스트 통과`);
