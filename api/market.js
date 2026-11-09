// 시장 데이터 자동 수집
//  - Yahoo Finance: 지수, 환율, 원자재, VIX (API 키 필요 없음, 비공식 주소라 가끔 막힐 수 있음)
//  - FRED: 미국 금리, 장단기 금리차, 실질금리, 기대인플레이션, 하이일드 스프레드 (FRED_API_KEY 필요)
//  - 한국은행 ECOS: 국고채 3년·10년 (ECOS_API_KEY가 있을 때만)
// 주소: /api/market   (목업 데이터: /api/market?mock=1)

const { sendJson, fetchWithTimeout } = require('./_lib');

const YAHOO = {
  dow: '^DJI', spx: '^GSPC', ndx: '^IXIC', rut: '^RUT', sox: '^SOX',
  dxy: 'DX-Y.NYB', usdkrw: 'KRW=X', usdjpy: 'JPY=X', usdcny: 'CNY=X',
  wti: 'CL=F', gold: 'GC=F', copper: 'HG=F', vix: '^VIX',
  kospi: '^KS11', kosdaq: '^KQ11',
};

const FRED = {
  us2y: 'DGS2', us10y: 'DGS10', t10y2y: 'T10Y2Y',
  real10y: 'DFII10', bei10y: 'T10YIE', hy: 'BAMLH0A0HYM2',
};

// 한국은행 ECOS 통계표 817Y002(시장금리, 일별) 항목 코드
const ECOS = { kr3y: '010200000', kr10y: '010210000' };

// 금리처럼 %로 표시되는 값은 변화를 bp(0.01%p)로 계산
const RATE_IDS = new Set([...Object.keys(FRED), ...Object.keys(ECOS)]);

function summarize(id, points, source) {
  // points: [{date, value}] 오래된 것 → 최신 순
  const n = points.length;
  if (n === 0) return { ok: false, source, error: '데이터 없음' };
  const last = points[n - 1];
  const prev = n >= 2 ? points[n - 2] : null;
  const week = n >= 6 ? points[n - 6] : points[0];
  const isRate = RATE_IDS.has(id);
  const diff = (a, b) => {
    if (a == null || b == null) return null;
    if (isRate) return round((a - b) * 100, 1); // bp
    return round(((a - b) / b) * 100, 2); // %
  };
  return {
    ok: true,
    source,
    date: last.date,
    value: last.value,
    prev: prev ? prev.value : null,
    chg: prev ? diff(last.value, prev.value) : null,
    chg5: week && week !== last ? diff(last.value, week.value) : null,
    chgUnit: isRate ? 'bp' : '%',
    spark: points.slice(-20).map((p) => p.value),
  };
}

function round(x, d) {
  const m = Math.pow(10, d);
  return Math.round(x * m) / m;
}

async function getYahoo(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2mo&interval=1d`;
  const r = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0 (macro-dashboard)' } });
  if (!r.ok) throw new Error(`Yahoo ${r.status}`);
  const j = await r.json();
  const res = j && j.chart && j.chart.result && j.chart.result[0];
  if (!res) throw new Error('Yahoo 응답 형식 오류');
  const ts = res.timestamp || [];
  const close = (res.indicators.quote[0] || {}).close || [];
  const pts = [];
  for (let i = 0; i < ts.length; i++) {
    if (close[i] == null) continue;
    pts.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), value: round(close[i], 4) });
  }
  return pts;
}

async function getFred(series, key) {
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${series}&api_key=${key}&file_type=json&sort_order=desc&limit=40`;
  const r = await fetchWithTimeout(url);
  if (!r.ok) throw new Error(`FRED ${r.status}`);
  const j = await r.json();
  return (j.observations || [])
    .filter((o) => o.value !== '.')
    .map((o) => ({ date: o.date, value: Number(o.value) }))
    .reverse();
}

async function getEcos(item, key) {
  const end = new Date();
  const start = new Date(end.getTime() - 60 * 86400000);
  const f = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const url = `https://ecos.bok.or.kr/api/StatisticSearch/${key}/json/kr/1/100/817Y002/D/${f(start)}/${f(end)}/${item}`;
  const r = await fetchWithTimeout(url);
  if (!r.ok) throw new Error(`ECOS ${r.status}`);
  const j = await r.json();
  const rows = (j.StatisticSearch && j.StatisticSearch.row) || [];
  if (!rows.length) throw new Error((j.RESULT && j.RESULT.MESSAGE) || 'ECOS 데이터 없음');
  return rows.map((x) => ({
    date: `${x.TIME.slice(0, 4)}-${x.TIME.slice(4, 6)}-${x.TIME.slice(6, 8)}`,
    value: Number(x.DATA_VALUE),
  }));
}

module.exports = async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.searchParams.get('mock') === '1' || process.env.MOCK_DATA === '1') {
    return sendJson(res, 200, require('./_mock.js'));
  }

  const items = {};
  const errors = [];
  const tasks = [];

  for (const [id, sym] of Object.entries(YAHOO)) {
    tasks.push(
      getYahoo(sym)
        .then((pts) => { items[id] = summarize(id, pts, 'Yahoo Finance'); })
        .catch((e) => { items[id] = { ok: false, source: 'Yahoo Finance', error: e.message }; errors.push(`${id}: ${e.message}`); })
    );
  }

  const fredKey = process.env.FRED_API_KEY;
  for (const [id, series] of Object.entries(FRED)) {
    if (!fredKey) { items[id] = { ok: false, source: 'FRED', error: 'FRED_API_KEY 미설정' }; continue; }
    tasks.push(
      getFred(series, fredKey)
        .then((pts) => { items[id] = summarize(id, pts, 'FRED'); })
        .catch((e) => { items[id] = { ok: false, source: 'FRED', error: e.message }; errors.push(`${id}: ${e.message}`); })
    );
  }

  const ecosKey = process.env.ECOS_API_KEY;
  for (const [id, item] of Object.entries(ECOS)) {
    if (!ecosKey) { items[id] = { ok: false, source: '한국은행 ECOS', error: 'ECOS_API_KEY 미설정 (직접 입력)' }; continue; }
    tasks.push(
      getEcos(item, ecosKey)
        .then((pts) => { items[id] = summarize(id, pts, '한국은행 ECOS'); })
        .catch((e) => { items[id] = { ok: false, source: '한국은행 ECOS', error: e.message }; errors.push(`${id}: ${e.message}`); })
    );
  }

  await Promise.all(tasks);

  // 한미 10년물 금리차 (한국 − 미국, bp)
  if (items.kr10y && items.kr10y.ok && items.us10y && items.us10y.ok) {
    items.krus10y = {
      ok: true, source: '계산', date: items.kr10y.date,
      value: round((items.kr10y.value - items.us10y.value) * 100, 0), chg: null, chgUnit: 'bp',
    };
  }
  // 구리/금 비율 (구리 $/lb ÷ 금 $/oz × 1000)
  if (items.copper && items.copper.ok && items.gold && items.gold.ok) {
    const now = (items.copper.value / items.gold.value) * 1000;
    const prev5 = items.copper.spark && items.gold.spark && items.copper.spark.length >= 6 && items.gold.spark.length >= 6
      ? (items.copper.spark[items.copper.spark.length - 6] / items.gold.spark[items.gold.spark.length - 6]) * 1000
      : null;
    items.cuau = { ok: true, source: '계산', date: items.copper.date, value: round(now, 3), chg: null, chg5: prev5 ? round(((now - prev5) / prev5) * 100, 2) : null, chgUnit: '%' };
  }

  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1800');
  sendJson(res, 200, { ok: true, fetchedAt: new Date().toISOString(), items, errors });
};
