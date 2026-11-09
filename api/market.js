// 시장 데이터 자동 수집
//  - 미국 재무부(Treasury): 미국 2년·10년물, 10년 실질금리 → 장단기 금리차, 기대인플레이션(BEI)은 계산 (API 키 필요 없음)
//  - Yahoo Finance: 지수, 환율, 원자재, VIX (API 키 필요 없음, 비공식 주소라 가끔 막힐 수 있음)
//  - FRED: 하이일드 스프레드 + 재무부 자료를 못 받았을 때 금리 대체 (FRED_API_KEY 필요)
//  - 한국은행 ECOS: 국고채 3년·10년 (ECOS_API_KEY가 있을 때만)
// 주소: /api/market   (목업 데이터: /api/market?mock=1)

const { sendJson, fetchWithTimeout } = require('./_lib');

const YAHOO = {
  dow: '^DJI', spx: '^GSPC', ndx: '^IXIC', rut: '^RUT', sox: '^SOX',
  dxy: 'DX-Y.NYB', usdkrw: 'KRW=X', usdjpy: 'JPY=X', usdcny: 'CNY=X',
  wti: 'CL=F', brent: 'BZ=F', gold: 'GC=F', copper: 'HG=F', vix: '^VIX',
  kospi: '^KS11', kosdaq: '^KQ11',
};

// 재무부 자료를 못 받았을 때 쓰는 FRED 대체 시리즈
const FRED = {
  us2y: 'DGS2', us10y: 'DGS10', t10y2y: 'T10Y2Y',
  real10y: 'DFII10', bei10y: 'T10YIE', hy: 'BAMLH0A0HYM2',
};

// 한국은행 ECOS 통계표 817Y002(시장금리, 일별) 항목 코드
const ECOS = { kr3y: '010200000', kr10y: '010210000' };

// 금리처럼 %로 표시되는 값은 변화를 bp(0.01%p)로 계산
const RATE_IDS = new Set([...Object.keys(FRED), ...Object.keys(ECOS)]);
// 차이(스프레드)처럼 0 근처를 오가는 값은 변화를 % 대신 그대로의 차이로 계산
const DIFF_IDS = { wtibrent: '$' };

function round(x, d) {
  const m = Math.pow(10, d);
  return Math.round(x * m) / m;
}

function summarize(id, points, source) {
  // points: [{date, value}] 오래된 것 → 최신 순
  const n = points.length;
  if (n === 0) return { ok: false, source, error: '데이터 없음' };
  const last = points[n - 1];
  const prev = n >= 2 ? points[n - 2] : null;
  const week = n >= 6 ? points[n - 6] : points[0];
  const isRate = RATE_IDS.has(id);
  const diffUnit = DIFF_IDS[id];
  const diff = (a, b) => {
    if (a == null || b == null) return null;
    if (isRate) return round((a - b) * 100, 1); // bp
    if (diffUnit) return round(a - b, 2); // 그대로의 차이
    return round(((a - b) / b) * 100, 2); // %
  };
  return {
    ok: true,
    source,
    date: last.date,
    value: last.value,
    prev: prev ? prev.value : null,
    prevDate: prev ? prev.date : null,
    chg: prev ? diff(last.value, prev.value) : null,
    chg5: week && week !== last ? diff(last.value, week.value) : null,
    chgUnit: isRate ? 'bp' : diffUnit || '%',
    spark: points.slice(-20).map((p) => p.value),
    pts: points.slice(-130).map((p) => [p.date, p.value]), // 날짜 맞추기·전망 채점용 (약 6개월)
  };
}

// ---------- 미국 재무부 ----------
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const split = (l) => l.split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
  const header = split(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, ' '));
  return lines.slice(1).map((l) => {
    const c = split(l);
    const o = {};
    header.forEach((h, i) => { o[h] = c[i]; });
    return o;
  });
}

function usDate(s) {
  // "11/06/2026" → "2026-11-06"
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s || '');
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

async function getTreasuryYear(type, year) {
  const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all?type=${type}&field_tdr_date_value=${year}&page&_format=csv`;
  const r = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0 (macro-dashboard)', Accept: 'text/csv,*/*' } });
  if (!r.ok) throw new Error(`재무부 ${r.status}`);
  return parseCsv(await r.text());
}

// 재무부 수익률 곡선에서 원하는 만기 열을 [{date, value}] 로 꺼냄 (오래된 것 → 최신)
async function getTreasury(type, columns) {
  const year = new Date().getUTCFullYear();
  let rows = await getTreasuryYear(type, year);
  if (rows.length < 130) rows = rows.concat(await getTreasuryYear(type, year - 1).catch(() => []));
  const out = {};
  for (const [id, col] of Object.entries(columns)) {
    const pts = rows
      .map((r) => ({ date: usDate(r.date), value: r[col] === undefined || r[col] === '' ? NaN : Number(r[col]) }))
      .filter((p) => p.date && !isNaN(p.value))
      .sort((a, b) => a.date.localeCompare(b.date));
    if (!pts.length) throw new Error(`재무부 자료에 '${col}' 열이 없음`);
    out[id] = pts;
  }
  return out;
}

// 두 시리즈를 같은 날짜끼리 계산해 새 시리즈 만들기
function combine(a, b, fn, digits = 2) {
  const map = new Map(b.map((p) => [p.date, p.value]));
  return a.filter((p) => map.has(p.date) && map.get(p.date)).map((p) => ({ date: p.date, value: round(fn(p.value, map.get(p.date)), digits) }));
}
const subtract = (a, b, digits = 2) => combine(a, b, (x, y) => x - y, digits);

// ---------- Yahoo / FRED / ECOS ----------
async function getYahoo(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=6mo&interval=1d`;
  const r = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0 (macro-dashboard)' } });
  if (!r.ok) throw new Error(`Yahoo ${r.status}`);
  const j = await r.json();
  const res = j && j.chart && j.chart.result && j.chart.result[0];
  if (!res) throw new Error('Yahoo 응답 형식 오류');
  const ts = res.timestamp || [];
  const close = (res.indicators.quote[0] || {}).close || [];
  // 거래소 현지 날짜로 변환 (뉴욕 장 종가가 한국 날짜로 하루 밀리지 않도록)
  const offset = (res.meta && res.meta.gmtoffset) || 0;
  const pts = [];
  for (let i = 0; i < ts.length; i++) {
    if (close[i] == null) continue;
    pts.push({ date: new Date((ts[i] + offset) * 1000).toISOString().slice(0, 10), value: round(close[i], 4) });
  }
  return pts;
}

async function getFred(series, key) {
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${series}&api_key=${key}&file_type=json&sort_order=desc&limit=140`;
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
  const start = new Date(end.getTime() - 200 * 86400000);
  const f = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const url = `https://ecos.bok.or.kr/api/StatisticSearch/${key}/json/kr/1/300/817Y002/D/${f(start)}/${f(end)}/${item}`;
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

// 데이터 수집 본체 (아침 자동 브리핑에서도 씀)
async function collectMarket() {

  const items = {};
  const raw = {}; // Yahoo 원본 시리즈 (계산 지표용)
  const errors = [];
  const tasks = [];
  const fredNeeded = new Set(['hy']);
  const TRE = '미국 재무부';

  // Yahoo
  for (const [id, sym] of Object.entries(YAHOO)) {
    tasks.push(
      getYahoo(sym)
        .then((pts) => { raw[id] = pts; items[id] = summarize(id, pts, 'Yahoo Finance'); })
        .catch((e) => { items[id] = { ok: false, source: 'Yahoo Finance', error: e.message }; errors.push(`${id}: ${e.message}`); })
    );
  }

  // 미국 재무부: 명목 금리
  let nominal = null;
  let real = null;
  tasks.push(
    getTreasury('daily_treasury_yield_curve', { us2y: '2 yr', us10y: '10 yr' })
      .then((s) => { nominal = s; })
      .catch((e) => { errors.push(`재무부 명목금리: ${e.message} → FRED로 대체`); })
  );
  // 미국 재무부: 실질 금리 (TIPS)
  tasks.push(
    getTreasury('daily_treasury_real_yield_curve', { real10y: '10 yr' })
      .then((s) => { real = s; })
      .catch((e) => { errors.push(`재무부 실질금리: ${e.message} → FRED로 대체`); })
  );

  // 한국은행 ECOS
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

  // 재무부 결과 정리 (장단기 금리차, BEI는 계산)
  if (nominal) {
    items.us2y = summarize('us2y', nominal.us2y, TRE);
    items.us10y = summarize('us10y', nominal.us10y, TRE);
    items.t10y2y = summarize('t10y2y', subtract(nominal.us10y, nominal.us2y), `${TRE} (계산)`);
  } else {
    ['us2y', 'us10y', 't10y2y'].forEach((id) => fredNeeded.add(id));
  }
  if (real) {
    items.real10y = summarize('real10y', real.real10y, TRE);
    if (nominal) items.bei10y = summarize('bei10y', subtract(nominal.us10y, real.real10y), `${TRE} (계산)`);
    else fredNeeded.add('bei10y');
  } else {
    ['real10y', 'bei10y'].forEach((id) => fredNeeded.add(id));
  }

  // FRED (하이일드 + 재무부 실패분 대체)
  const fredKey = process.env.FRED_API_KEY;
  await Promise.all([...fredNeeded].map((id) => {
    if (!fredKey) { items[id] = { ok: false, source: 'FRED', error: 'FRED_API_KEY 미설정' }; return null; }
    return getFred(FRED[id], fredKey)
      .then((pts) => { items[id] = summarize(id, pts, 'FRED'); })
      .catch((e) => { items[id] = { ok: false, source: 'FRED', error: e.message }; errors.push(`${id}: ${e.message}`); });
  }));

  // 한미 10년물 금리차 (한국 − 미국, bp)
  if (items.kr10y && items.kr10y.ok && items.us10y && items.us10y.ok) {
    items.krus10y = {
      ok: true, source: '계산', date: items.kr10y.date,
      value: round((items.kr10y.value - items.us10y.value) * 100, 0), chg: null, chgUnit: 'bp',
    };
  }
  // WTI − 브렌트 차이 ($)
  if (raw.wti && raw.brent) items.wtibrent = summarize('wtibrent', subtract(raw.wti, raw.brent), '계산 (Yahoo)');
  // 원/100엔 = 원달러 ÷ 달러엔 × 100
  if (raw.usdkrw && raw.usdjpy) items.jpykrw = summarize('jpykrw', combine(raw.usdkrw, raw.usdjpy, (k, j) => (k / j) * 100), '계산 (Yahoo)');

  // 구리/금 비율 (구리 $/lb ÷ 금 $/oz × 1000)
  if (items.copper && items.copper.ok && items.gold && items.gold.ok) {
    const now = (items.copper.value / items.gold.value) * 1000;
    const cs = items.copper.spark, gs = items.gold.spark;
    const prev5 = cs && gs && cs.length >= 6 && gs.length >= 6 ? (cs[cs.length - 6] / gs[gs.length - 6]) * 1000 : null;
    items.cuau = { ok: true, source: '계산', date: items.copper.date, value: round(now, 3), chg: null, chg5: prev5 ? round(((now - prev5) / prev5) * 100, 2) : null, chgUnit: '%' };
  }

  return { ok: true, fetchedAt: new Date().toISOString(), items, errors };
}

module.exports = async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.searchParams.get('mock') === '1' || process.env.MOCK_DATA === '1') {
    return sendJson(res, 200, require('./_mock.js'));
  }
  const data = await collectMarket();
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1800');
  sendJson(res, 200, data);
};
module.exports.collectMarket = collectMarket;
