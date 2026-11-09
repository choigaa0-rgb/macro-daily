// 화면 확인용 목업 데이터 (실제 시장 데이터가 아닙니다)
// /api/market?mock=1 로 불러옵니다.
// 금리는 11-05, 주식은 11-06까지 있는 상황을 일부러 만들어 '날짜 맞추기'를 확인할 수 있게 했습니다.

function businessDates(end, n) {
  const out = [];
  const d = new Date(end + 'T00:00:00Z');
  while (out.length < n) {
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) out.unshift(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out;
}

// steps[0]이 가장 최근 하루 변화 (금리는 bp, 나머지는 %)
function item(value, steps, unit, source, end) {
  const isRate = unit === 'bp';
  const vals = [value];
  let v = value;
  for (let i = 0; i < 24; i++) {
    const s = steps[i % steps.length];
    v = isRate ? v - s / 100 : unit === '$' ? v - s : v / (1 + s / 100);
    vals.unshift(Number(v.toFixed(4)));
  }
  const dates = businessDates(end, vals.length);
  const pts = dates.map((d, i) => [d, vals[i]]);
  const n = vals.length;
  const diff = (a, b) => (isRate ? Math.round((a - b) * 1000) / 10 : unit === '$' ? Math.round((a - b) * 100) / 100 : Math.round(((a - b) / b) * 10000) / 100);
  return {
    ok: true, source, date: dates[n - 1], value, prev: vals[n - 2], prevDate: dates[n - 2],
    chg: diff(vals[n - 1], vals[n - 2]), chg5: diff(vals[n - 1], vals[n - 6]), chgUnit: unit,
    spark: vals.slice(-20), pts,
  };
}

const Y = 'Yahoo Finance (목업)';
const T = '미국 재무부 (목업)';
const R = '2026-11-05'; // 금리 최신일
const S = '2026-11-06'; // 주식 최신일

module.exports = {
  ok: true,
  mock: true,
  fetchedAt: new Date().toISOString(),
  items: {
    us2y: item(3.62, [9, -3, 2, -1, 4, -2], 'bp', T, R),
    us10y: item(4.18, [5, -2, 1, -1, 3, -1], 'bp', T, R),
    t10y2y: item(0.56, [-4, 1, -1, 0, -1, 1], 'bp', T + ' (계산)', R),
    real10y: item(1.86, [2, -1, 1, 0, 2, -1], 'bp', T, R),
    bei10y: item(2.32, [3, -1, 0, -1, 1, 0], 'bp', T + ' (계산)', R),
    hy: item(3.12, [4, 1, 2, -1, 3, 0], 'bp', 'FRED (목업)', R),
    dow: item(46210.5, [0.35, -0.42, 0.2, 0.1, -0.3, 0.2], '%', Y, S),
    spx: item(6612.3, [0.52, -0.85, 0.3, 0.1, -0.4, 0.2], '%', Y, S),
    ndx: item(22480.1, [0.81, -1.32, 0.4, 0.2, -0.6, 0.3], '%', Y, S),
    rut: item(2391.7, [1.12, -1.75, 0.6, -0.2, -0.8, 0.3], '%', Y, S),
    sox: item(6120.4, [1.4, -2.1, 0.9, 0.3, -1.1, 0.5], '%', Y, S),
    dxy: item(100.42, [-0.3, 0.48, 0.2, -0.1, 0.3, -0.1], '%', Y, S),
    usdkrw: item(1418.6, [0.72, 0.3, -0.2, 0.1, 0.4, -0.2], '%', Y, '2026-11-09'),
    usdjpy: item(152.8, [-0.2, 0.35, 0.3, -0.1, 0.2, 0.1], '%', Y, S),
    usdcny: item(7.18, [0.05, 0.12, 0.03, -0.02, 0.04, 0.01], '%', Y, S),
    wti: item(68.9, [1.2, -0.8, 0.9, 0.4, -0.5, 0.3], '%', Y, S),
    brent: item(75.6, [0.9, -0.6, 0.7, 0.3, -0.4, 0.2], '%', Y, S),
    wtibrent: item(-6.7, [0.12, -0.08, 0.05, 0.02, -0.1, 0.04], '$', '계산 (목업)', S),
    jpykrw: item(928.4, [0.92, -0.05, -0.5, 0.2, 0.2, -0.3], '%', '계산 (목업)', S),
    gold: item(3980.2, [-0.6, 0.3, -0.2, 0.1, -0.4, 0.2], '%', Y, S),
    copper: item(4.92, [0.8, -0.8, -0.5, 0.2, -0.6, 0.1], '%', Y, S),
    vix: item(17.4, [-6.2, 9.6, -3.1, 2.2, 4.4, -2.0], '%', Y, S),
    kospi: item(3955.2, [-1.48, 0.6, -0.3, 0.2, -0.5, 0.4], '%', Y, '2026-11-09'),
    kosdaq: item(872.6, [-1.12, 0.4, -0.2, 0.1, -0.4, 0.3], '%', Y, '2026-11-09'),
    kr3y: item(2.71, [3, -1, 1, 0, 2, -1], 'bp', '한국은행 ECOS (목업)', '2026-11-09'),
    kr10y: item(3.02, [4, -1, 1, 0, 2, -1], 'bp', '한국은행 ECOS (목업)', '2026-11-09'),
    krus10y: { ok: true, source: '계산', date: '2026-11-09', value: -116, chg: null, chgUnit: 'bp' },
    cuau: { ok: true, source: '계산', date: S, value: 1.236, chg: null, chg5: -0.6, chgUnit: '%' },
  },
  errors: [],
};
