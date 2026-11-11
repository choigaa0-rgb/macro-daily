// 산업 이슈·오늘의 기업용 데이터 도우미 (파일 이름이 _로 시작해 API 주소가 되지 않음)
//  - 언론사 RSS (키 필요 없음): 제목·짧은 요약·링크만 사용
//  - Yahoo Finance 주가 (키 필요 없음): 주목도 계산, 수익률·52주 범위
//  - DART (DART_API_KEY): 한국 기업 개요·재무·공시·주식수
//  - SEC (SEC_CONTACT_EMAIL): 미국 기업 재무·공시. SEC 규칙상 요청마다 연락처를 보냄

const zlib = require('zlib');
const { fetchWithTimeout } = require('./_lib');

// ---------- 후보군 (주목도 순위를 매길 대형주) ----------
const UNIVERSE = [
  // 한국: [야후 티커, 이름, 뉴스 검색용 별칭]
  ['005930.KS', '삼성전자', ['삼성전자']], ['000660.KS', 'SK하이닉스', ['SK하이닉스', '하이닉스']],
  ['373220.KS', 'LG에너지솔루션', ['LG에너지솔루션', 'LG엔솔']], ['207940.KS', '삼성바이오로직스', ['삼성바이오로직스', '삼성바이오']],
  ['005380.KS', '현대차', ['현대차', '현대자동차']], ['000270.KS', '기아', ['기아']], ['068270.KS', '셀트리온', ['셀트리온']],
  ['035420.KS', 'NAVER', ['네이버', 'NAVER']], ['035720.KS', '카카오', ['카카오']], ['105560.KS', 'KB금융', ['KB금융']],
  ['055550.KS', '신한지주', ['신한지주', '신한금융']], ['086790.KS', '하나금융지주', ['하나금융']], ['005490.KS', 'POSCO홀딩스', ['포스코홀딩스', 'POSCO홀딩스']],
  ['006400.KS', '삼성SDI', ['삼성SDI']], ['051910.KS', 'LG화학', ['LG화학']], ['012330.KS', '현대모비스', ['현대모비스']],
  ['012450.KS', '한화에어로스페이스', ['한화에어로스페이스', '한화에어로']], ['329180.KS', 'HD현대중공업', ['HD현대중공업']],
  ['009540.KS', 'HD한국조선해양', ['HD한국조선해양']], ['042660.KS', '한화오션', ['한화오션']], ['034020.KS', '두산에너빌리티', ['두산에너빌리티']],
  ['028260.KS', '삼성물산', ['삼성물산']], ['032830.KS', '삼성생명', ['삼성생명']], ['015760.KS', '한국전력', ['한국전력', '한전']],
  ['011200.KS', 'HMM', ['HMM']], ['259960.KS', '크래프톤', ['크래프톤']], ['064350.KS', '현대로템', ['현대로템']],
  ['010130.KS', '고려아연', ['고려아연']], ['003670.KS', '포스코퓨처엠', ['포스코퓨처엠']], ['018260.KS', '삼성에스디에스', ['삼성SDS', '삼성에스디에스']],
  ['247540.KQ', '에코프로비엠', ['에코프로비엠']], ['196170.KQ', '알테오젠', ['알테오젠']],
  // 미국
  ['NVDA', '엔비디아', ['엔비디아', 'NVIDIA']], ['AAPL', '애플', ['애플']], ['MSFT', '마이크로소프트', ['마이크로소프트', 'MS ']],
  ['GOOGL', '알파벳(구글)', ['구글', '알파벳']], ['AMZN', '아마존', ['아마존']], ['META', '메타', ['메타']], ['TSLA', '테슬라', ['테슬라']],
  ['AVGO', '브로드컴', ['브로드컴']], ['TSM', 'TSMC', ['TSMC']], ['JPM', 'JP모건', ['JP모건', 'JP모간']], ['BRK-B', '버크셔 해서웨이', ['버크셔']],
  ['LLY', '일라이릴리', ['일라이릴리', '릴리']], ['V', '비자', ['비자']], ['NFLX', '넷플릭스', ['넷플릭스']], ['AMD', 'AMD', ['AMD']],
  ['MU', '마이크론', ['마이크론']], ['PLTR', '팔란티어', ['팔란티어']], ['ORCL', '오라클', ['오라클']], ['COST', '코스트코', ['코스트코']],
  ['WMT', '월마트', ['월마트']], ['XOM', '엑슨모빌', ['엑슨모빌']], ['UNH', '유나이티드헬스', ['유나이티드헬스']], ['INTC', '인텔', ['인텔']], ['QCOM', '퀄컴', ['퀄컴']],
].map(([ticker, name, aliases]) => ({ ticker, name, aliases, market: /\.(KS|KQ)$/.test(ticker) ? 'KR' : 'US' }));

// ---------- RSS ----------
const FEEDS = [
  ['연합뉴스 경제', 'https://www.yna.co.kr/rss/economy.xml'],
  ['매일경제 경제·금융', 'https://www.mk.co.kr/rss/30100041/'],
  ['매일경제 증권', 'https://www.mk.co.kr/rss/50200011/'],
  ['매일경제 기업·경영', 'https://www.mk.co.kr/rss/50100032/'],
  ['매일경제 국제', 'https://www.mk.co.kr/rss/30300018/'],
  ['비즈니스포스트 기업과산업', 'https://www.businesspost.co.kr/rss/Article_3.xml'],
  ['비즈니스포스트 금융', 'https://www.businesspost.co.kr/rss/Article_4.xml'],
  ['비즈니스포스트 시장과머니', 'https://www.businesspost.co.kr/rss/Article_5.xml'],
  ['비즈니스포스트 글로벌', 'https://www.businesspost.co.kr/rss/Article_1.xml'],
  ['비즈니스포스트 기후에너지', 'https://www.businesspost.co.kr/rss/Article_2.xml'],
];

function decode(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}
function tag(block, name) {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return m ? m[1] : '';
}
function parseRss(xml, source) {
  const out = [];
  const re = /<item[\s>][\s\S]*?<\/item>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const b = m[0];
    const title = decode(tag(b, 'title'));
    let link = decode(tag(b, 'link'));
    if (!link) { const g = /<guid[^>]*>([\s\S]*?)<\/guid>/i.exec(b); link = g ? decode(g[1]) : ''; }
    const desc = decode(tag(b, 'description')).slice(0, 140);
    const ds = decode(tag(b, 'pubDate') || tag(b, 'dc:date'));
    const t = ds ? Date.parse(ds) : NaN;
    if (title) out.push({ source, title, link, desc, time: isNaN(t) ? null : t });
  }
  return out;
}
async function fetchNews({ hours = 30, max = 140 } = {}) {
  const errors = [];
  const lists = await Promise.all(FEEDS.map(([src, url]) =>
    fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0 (macro-dashboard RSS reader)', Accept: 'application/rss+xml,application/xml,text/xml,*/*' } }, 7000)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${r.status}`))))
      .then((x) => parseRss(x, src))
      .catch((e) => { errors.push(`${src}: ${e.message}`); return []; })));
  const since = Date.now() - hours * 3600000;
  const seen = new Set();
  const items = [];
  lists.flat()
    .filter((x) => !x.time || x.time >= since)
    .sort((a, b) => (b.time || 0) - (a.time || 0))
    .forEach((x) => {
      const key = x.title.replace(/[^가-힣A-Za-z0-9]/g, '').slice(0, 28);
      if (seen.has(key)) return;
      seen.add(key);
      items.push(x);
    });
  return { items: items.slice(0, max), errors, feeds: FEEDS.length };
}
// 시황 판단에 쓸 헤드라인만 고름 (제목만 · 사실 확인용). AI가 '규칙'만으로 한국장을 해석하지 않도록 아침 브리핑·토론에 함께 넣음
const MARKET_KW = ['증시', '코스피', 'KOSPI', '코스닥', '외국인', '기관', '순매수', '순매도', '반도체', 'HBM', '수출', '실적', '금리', '국채', '환율', '원달러', '달러', '연준', 'Fed', 'FOMC', 'CPI', '물가', '고용', '유가', '엔비디아', 'AI', '나스닥', '뉴욕', '월가', '관세', '한국은행', '금통위', '사이드카', 'IPO', '상장'];
function marketHeadlines(items, max = 25) {
  const score = (n) => MARKET_KW.reduce((a, k) => a + (n.title.includes(k) ? 1 : 0), 0);
  return (items || []).map((n) => ({ n, s: score(n) })).filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || (b.n.time || 0) - (a.n.time || 0)).slice(0, max)
    .sort((a, b) => (b.n.time || 0) - (a.n.time || 0)).map((x) => x.n);
}
function headlinesText(list) {
  if (!list || !list.length) return '';
  const kst = (t) => (t ? new Date(t + 9 * 3600000).toISOString().slice(5, 16).replace('T', ' ') : '');
  return list.map((n) => `- [${n.source}${n.time ? ` ${kst(n.time)}` : ''}] ${n.title}`).join('\n');
}
function newsFor(company, items) {
  return items.filter((n) => company.aliases.some((a) => n.title.includes(a.trim()) || (n.desc || '').includes(a.trim())));
}

// ---------- Yahoo ----------
async function yahooChart(symbol, range = '1y') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
  const r = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0 (macro-dashboard)' } }, 8000);
  if (!r.ok) throw new Error(`Yahoo ${r.status}`);
  const j = await r.json();
  const res = j && j.chart && j.chart.result && j.chart.result[0];
  if (!res) throw new Error('Yahoo 응답 형식 오류');
  const q = (res.indicators.quote[0] || {});
  const off = (res.meta && res.meta.gmtoffset) || 0;
  const rows = [];
  (res.timestamp || []).forEach((t, i) => {
    if (q.close[i] == null) return;
    rows.push({ date: new Date((t + off) * 1000).toISOString().slice(0, 10), close: q.close[i], volume: q.volume ? q.volume[i] || 0 : 0 });
  });
  return { rows, currency: res.meta && res.meta.currency };
}
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const r2 = (x) => Math.round(x * 100) / 100;

// 주목도 = 오늘 변동 크기(평소 변동성 대비) + 거래량 배수 + 뉴스 언급 수
async function rankAttention(newsItems, { extraBonus = {} } = {}) {
  const res = await Promise.all(UNIVERSE.map(async (c) => {
    try {
      const { rows } = await yahooChart(c.ticker, '3mo');
      if (rows.length < 25) return null;
      const last = rows[rows.length - 1], prev = rows[rows.length - 2];
      const rets = rows.slice(-21).map((r, i, a) => (i ? r.close / a[i - 1].close - 1 : null)).filter((x) => x != null);
      const vol20 = mean(rows.slice(-21, -1).map((r) => r.volume)) || 1;
      const chg = (last.close / prev.close - 1) * 100;
      const sigma = std(rets.slice(0, -1)) * 100 || 1;
      const move = Math.abs(chg) / sigma;
      const volx = last.volume / vol20;
      const news = newsFor(c, newsItems).length;
      const bonus = extraBonus[c.ticker] || 0;
      const score = Math.min(move, 4) + Math.min(Math.max(volx - 1, 0), 3) + Math.min(news, 6) * 0.5 + bonus;
      return { ticker: c.ticker, name: c.name, market: c.market, date: last.date, close: r2(last.close), chg: r2(chg), move: r2(move), volx: r2(volx), news, bonus, score: r2(score) };
    } catch (e) { return null; }
  }));
  return res.filter(Boolean).sort((a, b) => b.score - a.score);
}

function priceStats(rows) {
  if (!rows || !rows.length) return null;
  const last = rows[rows.length - 1];
  const back = (n) => (rows.length > n ? rows[rows.length - 1 - n].close : rows[0].close);
  const ret = (b) => r2((last.close / b - 1) * 100);
  const yStart = rows.find((r) => r.date.slice(0, 4) === last.date.slice(0, 4)) || rows[0];
  const closes = rows.map((r) => r.close);
  return {
    date: last.date, close: r2(last.close), chg1d: ret(back(1)), ret1m: ret(back(21)), ret3m: ret(back(63)), retYtd: ret(yStart.close),
    high52: r2(Math.max(...closes)), low52: r2(Math.min(...closes)), fromHigh: r2((last.close / Math.max(...closes) - 1) * 100),
  };
}

// ---------- DART ----------
const DART = 'https://opendart.fss.or.kr/api';
let corpMap = null; // stock_code → { corp_code, corp_name }

function unzipFirst(buf) {
  // 끝의 Central Directory에서 첫 파일 위치와 크기를 읽고 압축 해제
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('zip 형식 오류');
  const cd = buf.readUInt32LE(eocd + 16);
  const method = buf.readUInt16LE(cd + 10);
  const csize = buf.readUInt32LE(cd + 20);
  const lho = buf.readUInt32LE(cd + 42);
  const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
  const data = buf.subarray(start, start + csize);
  return method === 8 ? zlib.inflateRawSync(data) : data;
}
// 자주 쓰는 종목의 DART 고유번호. 전체 목록(corpCode.xml, 수 MB)은 해외 서버에서 받기 느려서 먼저 이걸 씀.
// 맞는지 company.json으로 종목코드를 대조하고, 틀리면 전체 목록으로 다시 찾음 (잘못된 회사 자료를 쓰지 않도록)
const KNOWN_CORP = {
  '005930': '00126380', '000660': '00164779', '005380': '00164742', '000270': '00106641', '035420': '00266961',
  '035720': '00258801', '051910': '00356361', '006400': '00126362', '005490': '00155319', '105560': '00688996',
  '055550': '00382199', '068270': '00413046', '207940': '00877059', '373220': '01515323', '012330': '00164788',
};
const fs = require('fs');
const CORP_CACHE = '/tmp/dart-corpmap.json';
async function dartCorpCode(stockCode) {
  const key = process.env.DART_API_KEY;
  if (!key) throw new Error('DART_API_KEY 미설정');
  if (corpMap && corpMap.has(stockCode)) return corpMap.get(stockCode);
  if (KNOWN_CORP[stockCode]) {
    try {
      const j = await dartGet('company.json', { corp_code: KNOWN_CORP[stockCode] });
      if (j.status === '000' && String(j.stock_code || '').trim() === stockCode) return { corp_code: KNOWN_CORP[stockCode], corp_name: j.corp_name };
    } catch (e) { /* 전체 목록으로 */ }
  }
  if (!corpMap) {
    try { corpMap = new Map(JSON.parse(fs.readFileSync(CORP_CACHE, 'utf8'))); } catch (e) { corpMap = null; }
  }
  if (!corpMap) {
    let r;
    for (let i = 0; i < 2 && !r; i++) {
      try { r = await fetchWithTimeout(`${DART}/corpCode.xml?crtfc_key=${key}`, {}, 25000); }
      catch (e) { if (i === 1) throw new Error(`DART 기업코드 목록을 받지 못했습니다 (${e.message})`); }
    }
    if (!r.ok) throw new Error(`DART 기업코드 ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error(`DART 기업코드 응답 오류: ${buf.toString('utf8', 0, 200)}`);
    const xml = unzipFirst(buf).toString('utf8');
    corpMap = new Map();
    const re = /<list>\s*<corp_code>(\d+)<\/corp_code>\s*<corp_name>([^<]*)<\/corp_name>(?:\s*<corp_eng_name>[^<]*<\/corp_eng_name>)?\s*<stock_code>\s*(\d{6})\s*<\/stock_code>/g;
    let m;
    while ((m = re.exec(xml))) corpMap.set(m[3], { corp_code: m[1], corp_name: m[2] });
    try { fs.writeFileSync(CORP_CACHE, JSON.stringify([...corpMap])); } catch (e) { /* 캐시 실패는 무시 */ }
  }
  return corpMap.get(stockCode) || null;
}
async function dartGet(path, params) {
  const q = new URLSearchParams(Object.assign({ crtfc_key: process.env.DART_API_KEY }, params));
  const r = await fetchWithTimeout(`${DART}/${path}?${q}`, {}, 8000);
  const j = await r.json();
  return j;
}
const num = (s) => { const n = Number(String(s || '').replace(/,/g, '')); return isNaN(n) || s === '' || s == null ? null : n; };
const REPORTS = [['11014', '3분기'], ['11012', '반기'], ['11013', '1분기'], ['11011', '사업보고서']];
function pickAccounts(list) {
  const cfs = list.filter((x) => x.fs_div === 'CFS');
  const use = cfs.length ? cfs : list;
  const get = (names) => use.find((x) => names.includes(String(x.account_nm).replace(/\s/g, '')));
  return {
    fs: cfs.length ? '연결' : '별도',
    rev: get(['매출액', '수익(매출액)', '영업수익', '매출']),
    op: get(['영업이익', '영업이익(손실)']),
    ni: get(['당기순이익', '당기순이익(손실)', '분기순이익', '반기순이익']),
    equity: get(['자본총계']),
    liab: get(['부채총계']),
  };
}
async function dartFinancials(corp) {
  const y = new Date().getUTCFullYear();
  const out = { annual: null, latest: null };
  // 최근 사업보고서
  for (const yy of [y - 1, y - 2]) {
    const j = await dartGet('fnlttSinglAcnt.json', { corp_code: corp, bsns_year: String(yy), reprt_code: '11011' });
    if (j.status === '000' && j.list && j.list.length) {
      const a = pickAccounts(j.list);
      out.annual = { year: yy, fs: a.fs, rev: num(a.rev && a.rev.thstrm_amount), revPrev: num(a.rev && a.rev.frmtrm_amount), op: num(a.op && a.op.thstrm_amount), opPrev: num(a.op && a.op.frmtrm_amount),
        ni: num(a.ni && a.ni.thstrm_amount), niPrev: num(a.ni && a.ni.frmtrm_amount), equity: num(a.equity && a.equity.thstrm_amount), liab: num(a.liab && a.liab.thstrm_amount) };
      break;
    }
  }
  // 올해 최근 분기 (누적)
  for (const [code, label] of REPORTS.slice(0, 3)) {
    const j = await dartGet('fnlttSinglAcnt.json', { corp_code: corp, bsns_year: String(y), reprt_code: code });
    if (j.status === '000' && j.list && j.list.length) {
      const a = pickAccounts(j.list);
      const cum = (x, k) => num(x && (x[`${k}_add_amount`] || x[`${k}_amount`]));
      out.latest = { year: y, period: label, fs: a.fs, rev: cum(a.rev, 'thstrm'), revPrev: cum(a.rev, 'frmtrm'), op: cum(a.op, 'thstrm'), opPrev: cum(a.op, 'frmtrm'), ni: cum(a.ni, 'thstrm'), niPrev: cum(a.ni, 'frmtrm') };
      break;
    }
  }
  return out;
}
async function dartShares(corp, year) {
  const j = await dartGet('stockTotqySttus.json', { corp_code: corp, bsns_year: String(year), reprt_code: '11011' });
  if (j.status !== '000' || !j.list) return null;
  const row = j.list.find((x) => /보통/.test(x.se)) || j.list.find((x) => /합계/.test(x.se));
  return row ? num(row.distb_stock_co) || num(row.istc_totqy) : null;
}
// 최근 공시: 임원·주요주주 지분 보고(소유상황보고서, 대량보유)는 거의 매일 쌓여서 숨기고 개수만 알려줌
const ROUTINE_DISC = /소유상황보고서|대량보유상황보고서/;
async function dartDisclosures(corp) {
  const end = new Date(Date.now() + 9 * 3600000);
  const bgn = new Date(end.getTime() - 60 * 86400000);
  const f = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const j = await dartGet('list.json', { corp_code: corp, bgn_de: f(bgn), end_de: f(end), page_count: '100' });
  if (j.status !== '000' || !j.list) return [];
  const all = j.list.map((x) => ({ date: `${x.rcept_dt.slice(0, 4)}-${x.rcept_dt.slice(4, 6)}-${x.rcept_dt.slice(6, 8)}`, title: x.report_nm.replace(/\s+/g, ' ').trim(), link: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${x.rcept_no}` }));
  const main = all.filter((x) => !ROUTINE_DISC.test(x.title)).slice(0, 8);
  main.hiddenRoutine = all.filter((x) => ROUTINE_DISC.test(x.title)).length;
  return main;
}

// ---------- 증권사 리포트 (네이버 증권 리서치 API · 국내종목) ----------
// 제목·증권사·날짜·목표주가·투자의견·링크만 씀 (리포트 본문 요약은 가져오지 않음). 한국 종목만.
// 검색어(종목명)가 들어간 다른 회사 리포트도 섞여 오므로 종목코드가 같은 것만 남김
function parseNaverResearch(json, stockCode, days = 90) {
  const items = (json && json.items) || [];
  const cutoff = new Date(Date.now() + 9 * 3600000 - days * 86400000).toISOString().slice(0, 10);
  const pick = (o, re) => { const k = Object.keys(o).find((x) => re.test(x)); return k ? o[k] : ''; };
  return items
    .filter((x) => String(x.itemCode) === String(stockCode) && String(x.writeDate || '') >= cutoff)
    .map((x) => {
      const goal = Number(String(x.goalPrice || '').replace(/,/g, ''));
      return { date: String(x.writeDate).slice(0, 10), title: String(x.title || '').trim(), broker: String(x.brokerName || '').trim(),
        goal: goal > 0 ? goal : null, opinion: String(pick(x, /opinion/i) || '').trim(),
        link: `https://stock.naver.com/research/company/${x.nid}` };
    })
    .slice(0, 8);
}
async function brokerReports(stockCode, name) {
  const u = `https://stock.naver.com/api/stockSecurity/researches/v2/company?index=0&size=40&query=${encodeURIComponent(name)}`;
  const r = await fetchWithTimeout(u, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36', Accept: 'application/json', Referer: 'https://stock.naver.com/research/company' } }, 7000);
  if (!r.ok) throw new Error(`네이버 리서치 ${r.status}`);
  return parseNaverResearch(await r.json(), stockCode);
}
// 목표주가 요약 (코드가 계산): 범위·중간값·현재가 대비, 투자의견 개수
function reportSummary(reports, price) {
  const goals = reports.map((x) => x.goal).filter(Boolean).sort((a, b) => a - b);
  if (!goals.length) return null;
  const mid = goals.length % 2 ? goals[(goals.length - 1) / 2] : (goals[goals.length / 2 - 1] + goals[goals.length / 2]) / 2;
  const ops = {};
  // 증권사마다 다른 표기(Buy·매수·BUY, StrongBuy·강력매수, Hold·중립·MarketPerform …)를 한국어로 묶음
  const norm = (o) => { const t = String(o).replace(/[\s_-]/g, '').toLowerCase();
    if (/strongbuy|강력매수|적극매수/.test(t)) return '강력매수';
    if (/^(buy|매수|outperform|overweight|trading ?buy)$/.test(t) || /buy|매수|outperform|overweight/.test(t)) return '매수';
    if (/hold|중립|neutral|marketperform|보유/.test(t)) return '중립';
    if (/sell|매도|underperform|reduce/.test(t)) return '매도';
    return o; };
  reports.forEach((x) => { if (x.opinion) { const k = norm(x.opinion); ops[k] = (ops[k] || 0) + 1; } });
  const dates = reports.filter((x) => x.goal).map((x) => x.date).sort();
  return { n: goals.length, from: dates[0], to: dates[dates.length - 1], min: goals[0], max: goals[goals.length - 1], median: Math.round(mid), gap: price ? Math.round((mid / price - 1) * 1000) / 10 : null, opinions: ops };
}

async function dartCompany(corp) {
  const j = await dartGet('company.json', { corp_code: corp });
  if (j.status !== '000') return null;
  return { name: j.corp_name, ceo: j.ceo_nm, industryCode: j.induty_code, est: j.est_dt, homepage: j.hm_url };
}

// ---------- SEC ----------
let secTickers = null;
function secHeaders() {
  const mail = process.env.SEC_CONTACT_EMAIL;
  if (!mail) throw new Error('SEC_CONTACT_EMAIL 미설정');
  return { 'User-Agent': `MacroDaily student-research ${mail}`, Accept: 'application/json' };
}
async function secCik(ticker) {
  if (!secTickers) {
    const r = await fetchWithTimeout('https://www.sec.gov/files/company_tickers.json', { headers: secHeaders() }, 10000);
    if (!r.ok) throw new Error(`SEC 티커 ${r.status}`);
    const j = await r.json();
    secTickers = new Map(Object.values(j).map((x) => [String(x.ticker).toUpperCase(), { cik: String(x.cik_str).padStart(10, '0'), title: x.title }]));
  }
  return secTickers.get(ticker.toUpperCase().replace('-', '.')) || secTickers.get(ticker.toUpperCase()) || null;
}
async function secConcept(cik, tagName, ns = 'us-gaap') {
  const r = await fetchWithTimeout(`https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/${ns}/${tagName}.json`, { headers: secHeaders() }, 8000);
  if (!r.ok) return null;
  return r.json();
}
function annualPair(concept) {
  if (!concept || !concept.units) return null;
  const unit = concept.units.USD || concept.units.shares || Object.values(concept.units)[0];
  const fy = (unit || []).filter((x) => x.frame && /^CY\d{4}$/.test(x.frame)).sort((a, b) => a.frame.localeCompare(b.frame));
  if (!fy.length) return null;
  const last = fy[fy.length - 1], prev = fy[fy.length - 2];
  return { year: Number(last.frame.slice(2)), val: last.val, prev: prev ? prev.val : null };
}
async function secFinancials(cik) {
  const [rev1, rev2, op, ni, eq, sh] = await Promise.all([
    secConcept(cik, 'RevenueFromContractWithCustomerExcludingAssessedTax'), secConcept(cik, 'Revenues'),
    secConcept(cik, 'OperatingIncomeLoss'), secConcept(cik, 'NetIncomeLoss'), secConcept(cik, 'StockholdersEquity'),
    secConcept(cik, 'EntityCommonStockSharesOutstanding', 'dei'),
  ]);
  const ra = annualPair(rev1), rb = annualPair(rev2);
  const rev = ra && rb ? (ra.year >= rb.year ? ra : rb) : ra || rb;
  const o = annualPair(op), n = annualPair(ni);
  let equity = null;
  if (eq && eq.units && eq.units.USD) { const e = eq.units.USD.filter((x) => x.form === '10-K' || x.form === '10-Q').sort((a, b) => a.end.localeCompare(b.end)); equity = e.length ? e[e.length - 1].val : null; }
  let shares = null;
  if (sh && sh.units && sh.units.shares) { const s = sh.units.shares.slice().sort((a, b) => a.end.localeCompare(b.end)); shares = s.length ? s[s.length - 1].val : null; }
  if (!rev && !o && !n) return null;
  return { annual: { year: (rev || o || n).year, rev: rev && rev.val, revPrev: rev && rev.prev, op: o && o.val, opPrev: o && o.prev, ni: n && n.val, niPrev: n && n.prev, equity }, shares };
}
// SEC 공시 종류를 한국어로 (8-K는 항목 번호로 무슨 일인지)
const SEC_FORM = { '10-Q': '분기보고서', '10-K': '연간보고서', '8-K': '수시공시', '6-K': '해외기업 수시공시', '20-F': '해외기업 연간보고서', 'DEF 14A': '주총 안건', 'S-1': '상장 신고서' };
const SEC_ITEM = { '1.01': '주요 계약', '2.01': '인수·매각 완료', '2.02': '실적 발표', '2.03': '차입', '3.02': '주식 발행', '5.02': '임원 변동', '5.03': '정관 변경', '5.07': '주총 결과', '7.01': '공정공시', '8.01': '기타 주요사항' };
function secTitle(form, items, desc) {
  const base = SEC_FORM[form] || (form.startsWith('424B') ? '증권 발행 설명서' : '');
  const its = String(items || '').split(',').map((x) => SEC_ITEM[x.trim()]).filter(Boolean);
  const extra = its.length ? its.join('·') : desc && desc !== form ? desc : '';
  return `${form}${base ? ` ${base}` : ''}${extra ? ` · ${extra}` : ''}`;
}
async function secFilings(cik) {
  const r = await fetchWithTimeout(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: secHeaders() }, 8000);
  if (!r.ok) return [];
  const j = await r.json();
  const f = j.filings && j.filings.recent;
  if (!f) return [];
  const since = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  const out = [];
  for (let i = 0; i < f.form.length && out.length < 8; i++) {
    if (f.filingDate[i] < since) break;
    if (!/^(8-K|10-Q|10-K|6-K|20-F|DEF 14A|S-1|424B)/.test(f.form[i])) continue;
    const acc = f.accessionNumber[i].replace(/-/g, '');
    out.push({ date: f.filingDate[i], title: secTitle(f.form[i], f.items && f.items[i], f.primaryDocDescription[i]), link: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc}/${f.primaryDocument[i]}` });
  }
  return out;
}

module.exports = { UNIVERSE, FEEDS, parseRss, fetchNews, marketHeadlines, headlinesText, newsFor, yahooChart, rankAttention, priceStats, unzipFirst, dartCorpCode, dartFinancials, dartShares, dartDisclosures, dartCompany, brokerReports, parseNaverResearch, reportSummary, secCik, secFinancials, secFilings, annualPair, pickAccounts };
