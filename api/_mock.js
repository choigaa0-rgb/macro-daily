// 화면 확인용 목업 데이터 (실제 시장 데이터가 아닙니다)
// /api/market?mock=1 로 불러옵니다.

function series(last, steps, isRate) {
  const out = [];
  let v = last;
  for (let i = 0; i < steps.length; i++) {
    out.unshift(Number(v.toFixed(isRate ? 2 : 2)));
    v = isRate ? v - steps[i] / 100 : v / (1 + steps[i] / 100);
  }
  return out;
}

function item(value, chg, chg5, unit, source, isRate) {
  const steps = [chg, 0.3, -0.2, 0.1, -0.4, 0.2, 0.1, -0.1, 0.3, -0.2];
  const spark = series(value, steps, isRate);
  const prev = isRate ? Number((value - chg / 100).toFixed(2)) : Number((value / (1 + chg / 100)).toFixed(2));
  return { ok: true, source, date: '2026-11-06', value, prev, chg, chg5, chgUnit: unit, spark };
}

const Y = 'Yahoo Finance (목업)';
const F = 'FRED (목업)';

module.exports = {
  ok: true,
  mock: true,
  fetchedAt: new Date().toISOString(),
  items: {
    us2y: item(3.62, 9, 14, 'bp', F, true),
    us10y: item(4.18, 5, 9, 'bp', F, true),
    t10y2y: item(0.56, -4, -5, 'bp', F, true),
    real10y: item(1.86, 2, 4, 'bp', F, true),
    bei10y: item(2.32, 3, 5, 'bp', F, true),
    hy: item(3.12, 4, 9, 'bp', F, true),
    dow: item(46210.5, -0.42, 0.6, '%', Y),
    spx: item(6612.3, -0.85, 0.2, '%', Y),
    ndx: item(22480.1, -1.32, -0.4, '%', Y),
    rut: item(2391.7, -1.75, -1.1, '%', Y),
    sox: item(6120.4, -2.1, -1.8, '%', Y),
    dxy: item(100.42, 0.48, 0.9, '%', Y),
    usdkrw: item(1418.6, 0.72, 1.1, '%', Y),
    usdjpy: item(152.8, 0.35, 0.8, '%', Y),
    usdcny: item(7.18, 0.12, 0.2, '%', Y),
    wti: item(68.9, 1.2, 2.4, '%', Y),
    gold: item(3980.2, -0.6, -0.9, '%', Y),
    copper: item(4.92, -0.8, -1.5, '%', Y),
    vix: item(19.4, 9.6, 14.2, '%', Y),
    kospi: item(3955.2, -1.48, -2.1, '%', Y),
    kosdaq: item(872.6, -1.12, -1.6, '%', Y),
    kr3y: item(2.71, 3, 6, 'bp', '한국은행 ECOS (목업)', true),
    kr10y: item(3.02, 4, 7, 'bp', '한국은행 ECOS (목업)', true),
    krus10y: { ok: true, source: '계산', date: '2026-11-06', value: -116, chg: null, chgUnit: 'bp' },
    cuau: { ok: true, source: '계산', date: '2026-11-06', value: 1.236, chg: null, chg5: -0.6, chgUnit: '%' },
  },
  errors: [],
};
