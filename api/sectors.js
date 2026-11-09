// 섹터 등락: 미국(섹터 ETF 11개, Finviz Groups와 같은 11개 섹터) + 한국(KRX 코스피 업종 지수)
// 주소: /api/sectors   (목업: /api/sectors?mock=1)
//
// 미국: Finviz는 공개 API가 없고 서버 접속을 막아서, 같은 11개 섹터를 대표하는 SPDR 섹터 ETF를
//       Yahoo Finance에서 받아 1일·1주(5거래일) 등락률을 계산합니다. Finviz 숫자(종목 합산)와 조금 다를 수 있습니다.
// 한국: KRX Open API '코스피 시리즈 일별시세정보'(idx/kospi_dd_trd). 환경변수 KRX_API_KEY 필요.
//       data.krx.co.kr 화면(전체지수 시세 · 계열 코스피)과 같은 자료이며, '코스피 200' 같은 대표지수와 규모별 지수는 빼고 업종만 남깁니다.
//       KRX 자료는 다음 날 아침에 올라오므로, 가장 최근에 올라온 거래일을 찾아 씁니다.
const { sendJson, fetchWithTimeout, kstDate } = require('./_lib.js');
const { yahooChart } = require('./_data.js');

const US = [
  { etf: 'XLB', name: 'Basic Materials', ko: '소재' },
  { etf: 'XLC', name: 'Communication Services', ko: '커뮤니케이션' },
  { etf: 'XLI', name: 'Industrials', ko: '산업재' },
  { etf: 'XLY', name: 'Consumer Cyclical', ko: '경기소비재' },
  { etf: 'XLF', name: 'Financial', ko: '금융' },
  { etf: 'XLV', name: 'Healthcare', ko: '헬스케어' },
  { etf: 'XLU', name: 'Utilities', ko: '유틸리티' },
  { etf: 'XLK', name: 'Technology', ko: '기술' },
  { etf: 'XLRE', name: 'Real Estate', ko: '부동산' },
  { etf: 'XLP', name: 'Consumer Defensive', ko: '필수소비재' },
  { etf: 'XLE', name: 'Energy', ko: '에너지' },
];
const r2 = (x) => (x == null || !isFinite(x) ? null : Math.round(x * 100) / 100);

async function usSectors() {
  const rows = await Promise.all(US.map(async (s) => {
    try {
      const { rows: h } = await yahooChart(s.etf, '1mo');
      if (h.length < 7) throw new Error('자료 부족');
      const last = h[h.length - 1], prev = h[h.length - 2], wk = h[h.length - 6];
      return { ...s, date: last.date, weekBase: wk.date, close: r2(last.close), d1: r2((last.close / prev.close - 1) * 100), w1: r2((last.close / wk.close - 1) * 100) };
    } catch (e) { return { ...s, error: e.message }; }
  }));
  const ok = rows.filter((r) => !r.error);
  if (!ok.length) return { ok: false, error: 'Yahoo Finance에서 섹터 ETF를 받지 못했습니다', rows: [] };
  const date = ok.map((r) => r.date).sort().pop();
  const weekBase = (ok.find((r) => r.date === date) || {}).weekBase;
  return { ok: true, source: 'Yahoo Finance · SPDR 섹터 ETF', date, weekBase, rows: ok, failed: rows.filter((r) => r.error).map((r) => r.etf) };
}

// ---------- 한국: KRX Open API ----------
const KRX_HOSTS = ['https://data-dbg.krx.co.kr', 'http://data-dbg.krx.co.kr'];
const num = (v) => { if (v == null || v === '' || v === '-') return null; const n = Number(String(v).replace(/,/g, '')); return isFinite(n) ? n : null; };
// 대표지수(코스피, 코스피 200, 코스피 100 …)와 규모별·스타일 지수는 빼고 업종만
function isSector(name) {
  const n = String(name || '').trim();
  if (!n) return false;
  if (/^코스피/.test(n) || /^KOSPI/i.test(n) || /^KRX/i.test(n)) return false;
  if (/^(대형주|중형주|소형주)$/.test(n)) return false;
  if (/(배당|우량|가치|성장|레버리지|인버스|선물|커버드|고배당|저변동|동일가중|TR$)/.test(n)) return false;
  return true;
}
function ymd(d) { return d.toISOString().slice(0, 10).replace(/-/g, ''); }
function addDays(d, n) { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; }

async function krxDay(basDd, key) {
  let lastErr;
  for (const host of KRX_HOSTS) {
    try {
      const r = await fetchWithTimeout(`${host}/svc/apis/idx/kospi_dd_trd?basDd=${basDd}`, { headers: { AUTH_KEY: key, Accept: 'application/json' } }, 8000);
      const text = await r.text();
      if (r.status === 401 || r.status === 403) throw Object.assign(new Error(`KRX 인증 실패(${r.status}). openapi.krx.co.kr에서 '코스피 시리즈 일별시세정보' 이용 신청이 승인됐는지 확인하세요`), { fatal: true });
      if (!r.ok) throw new Error(`KRX ${r.status}`);
      let j; try { j = JSON.parse(text); } catch { throw new Error('KRX 응답 형식 오류'); }
      if (j.respCode && String(j.respCode) !== '200' && !j.OutBlock_1) throw Object.assign(new Error(`KRX: ${j.respMsg || j.respCode}`), { fatal: /auth|인증|key|권한/i.test(j.respMsg || '') });
      return j.OutBlock_1 || [];
    } catch (e) { lastErr = e; if (e.fatal) throw e; }
  }
  throw lastErr;
}
// 기준일부터 거꾸로 가며 자료가 있는 첫 거래일 찾기 (휴장일·미게시일 건너뜀)
async function krxLatest(from, key, tries = 6) {
  for (let i = 0; i < tries; i++) {
    const d = ymd(addDays(from, -i));
    const rows = await krxDay(d, key);
    if (rows.length) return { basDd: d, rows };
  }
  return null;
}

async function krSectors() {
  const key = process.env.KRX_API_KEY;
  if (!key) return { ok: false, needKey: true, error: 'KRX_API_KEY가 설정되지 않았습니다', rows: [] };
  const today = new Date(kstDate() + 'T00:00:00Z');
  const cur = await krxLatest(today, key);
  if (!cur) return { ok: false, error: '최근 6일 안에 KRX 자료가 없습니다', rows: [] };
  const curDate = new Date(`${cur.basDd.slice(0, 4)}-${cur.basDd.slice(4, 6)}-${cur.basDd.slice(6)}T00:00:00Z`);
  const wk = await krxLatest(addDays(curDate, -7), key, 5).catch(() => null);
  const wkMap = new Map((wk ? wk.rows : []).map((r) => [String(r.IDX_NM).trim(), num(r.CLSPRC_IDX)]));
  const rows = cur.rows
    .filter((r) => isSector(r.IDX_NM))
    .map((r) => {
      const name = String(r.IDX_NM).trim();
      const close = num(r.CLSPRC_IDX);
      const wClose = wkMap.get(name);
      return { name, close, d1: r2(num(r.FLUC_RT)), w1: close && wClose ? r2((close / wClose - 1) * 100) : null };
    })
    .filter((r) => r.d1 != null);
  const fmt = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}`;
  return { ok: rows.length > 0, source: 'KRX Open API · 코스피 시리즈', date: fmt(cur.basDd), weekBase: wk ? fmt(wk.basDd) : null, rows, error: rows.length ? undefined : '업종 지수를 찾지 못했습니다' };
}

const MOCK = {
  ok: true, mock: true, fetchedAt: new Date().toISOString(),
  us: { ok: true, source: '목업', date: '2026-11-06', rows: [
    ['XLB', 'Basic Materials', '소재', 2.17, 2.74], ['XLC', 'Communication Services', '커뮤니케이션', 1.89, 4.57], ['XLI', 'Industrials', '산업재', 1.74, -2.02],
    ['XLY', 'Consumer Cyclical', '경기소비재', 1.62, 1.96], ['XLF', 'Financial', '금융', 1.34, 0.97], ['XLV', 'Healthcare', '헬스케어', 1.0, 1.31], ['XLU', 'Utilities', '유틸리티', 0.68, -0.11],
    ['XLK', 'Technology', '기술', 0.43, -4.29], ['XLRE', 'Real Estate', '부동산', 0.38, 1.16], ['XLP', 'Consumer Defensive', '필수소비재', 0.16, -0.54], ['XLE', 'Energy', '에너지', -0.3, -8.04],
  ].map(([etf, name, ko, d1, w1]) => ({ etf, name, ko, d1, w1 })) },
  kr: { ok: true, source: '목업', date: '2026-11-06', rows: [
    ['전기·전자', -2.41, -5.1], ['금융', 1.12, 2.3], ['운송장비·부품', 0.85, 1.4], ['화학', -0.62, -1.9], ['제약', 0.33, 0.8], ['기계·장비', 1.47, 3.2], ['건설', -0.21, 0.4],
    ['통신', 0.58, 1.1], ['증권', 2.05, 4.6], ['보험', 0.94, 1.7], ['유통', -0.44, -0.9], ['전기·가스', 0.12, -0.3], ['음식료·담배', -0.08, 0.2], ['IT 서비스', -1.15, -2.6],
  ].map(([name, d1, w1]) => ({ name, d1, w1 })) },
};

module.exports = async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.searchParams.get('mock') === '1' || process.env.MOCK_DATA === '1') return sendJson(res, 200, MOCK);
  const [us, kr] = await Promise.all([
    usSectors().catch((e) => ({ ok: false, error: e.message, rows: [] })),
    krSectors().catch((e) => ({ ok: false, error: e.message, rows: [] })),
  ]);
  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
  sendJson(res, 200, { ok: true, fetchedAt: new Date().toISOString(), us, kr });
};
module.exports.isSector = isSector;
module.exports.usSectors = usSectors;
module.exports.krSectors = krSectors;
