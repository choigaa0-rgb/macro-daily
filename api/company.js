// 오늘의 기업 (스톡피치 형식 분석 카드)
// GET  /api/company?rank=1           주목도 상위 20 + 오늘 자동 선정 후보
// POST /api/company { ticker? }      카드 만들기 (ticker 없으면 자동 선정) → 시트 '기업 분석' 저장
// GET  /api/company?part=1           아침 자동화용: 자동 선정 → 카드 → 저장 → 메일용 HTML
//
// 숫자는 코드가 DART·SEC·Yahoo에서 직접 계산하고(표), AI는 그 숫자만 근거로 해석한다.
// 교차검증: AI 문장에 나온 숫자가 제공한 데이터에 있는지 자동 대조, 관련 뉴스·공시 링크로 사실 확인 가능하게 함.
// 투자 권유가 아닌 분석 카드: BULL·BEAR 논거와 체크포인트를 나란히 보여줌.

const { NEED_PASS, sendJson, isAuthorized, readBody, callGemini, sheetPost, sheetRows, parseJsonLoose, kstDate } = require('./_lib');
const D = require('./_data');

const PROMPT = `너는 한국 증권사 리서치센터의 기업 애널리스트다. 주어진 데이터로 기업 1곳의 '스톡피치 형식 분석 카드'를 만든다.
원칙:
1. 숫자(매출, 이익, 증가율, 시가총액, PER, PBR, 수익률, 주가)는 [데이터]에 있는 것만 쓴다. 새로 계산하거나 지어내지 않는다.
2. 사업 구조·매출 구성·경쟁사는 공개된 일반 지식으로 써도 되지만, 그 부분은 "일반 정보"로 보고 구체적 수치(비중 %)를 만들지 않는다.
3. 뉴스·공시·증권사 리포트는 주어진 목록만 근거로 쓴다. 리포트는 제목·목표주가·의견만 있으니 본문 내용을 지어내지 않는다. 증권사 목표주가는 증권사 의견으로만 인용하고 우리 의견처럼 쓰지 않는다.
4. 투자 권유·목표주가·매수/매도 의견은 쓰지 않는다. BULL과 BEAR를 균형 있게 쓴다.
5. 한국어, 짧은 문장. JSON 하나만 출력한다.
출력:
{ "one_liner": "이 기업을 한 문장으로",
  "why_today": "오늘 주목받는 이유 (주목도 데이터·뉴스 근거)",
  "business": "무엇으로 돈을 버는지 2~3문장",
  "segments": ["주요 사업·제품 (비중 수치 없이)"],
  "competitors": ["주요 경쟁사"],
  "results": "최근 실적 요약 2문장 (데이터 숫자만)",
  "valuation": "밸류에이션·주가 위치 해석 1~2문장 (데이터 숫자만)",
  "macro_link": "오늘 매크로·산업 이슈와의 연결 한 문장 (정보 없으면 빈 문자열)",
  "street_view": "최근 증권사 리포트에 드러난 시각 한 문장. 위 분석과 같은 점·다른 점을 짚고, 의견이 갈리면 갈린다고 (리포트 없으면 빈 문자열)",
  "bull": ["투자 포인트 1", "2", "3"],
  "bear": ["리스크 1", "2", "3"],
  "kill_scenario": "이 기업이 크게 무너지는 시나리오 한 문장",
  "checkpoints": ["다음에 확인할 것 (실적 발표, 지표, 이벤트)", "..."] }`;

const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const growth = (a, b) => (a == null || b == null || b === 0 ? null : r1(((a - b) / Math.abs(b)) * 100));
function money(v, market) {
  if (v == null) return '-';
  if (market === 'KR') { const jo = v / 1e12; return Math.abs(jo) >= 1 ? `${r1(jo)}조원` : `${Math.round(v / 1e8).toLocaleString('ko-KR')}억원`; }
  const b = v / 1e9; return Math.abs(b) >= 1 ? `$${r1(b)}B` : `$${r1(v / 1e6)}M`;
}

async function pickToday({ news, issuesRow }) {
  // 산업 이슈에 나온 기업에 가산점, 최근 10일 안에 분석한 기업은 제외
  const bonus = {};
  if (issuesRow && issuesRow['관련 기업']) {
    const names = issuesRow['관련 기업'].split(/,\s*/);
    D.UNIVERSE.forEach((c) => { if (names.some((n) => c.aliases.some((a) => n.includes(a.trim())) || n.includes(c.name))) bonus[c.ticker] = 1.5; });
  }
  const [rank, past] = await Promise.all([D.rankAttention(news, { extraBonus: bonus }), sheetRows('기업 분석', 30)]);
  const cutoff = new Date(Date.now() + 9 * 3600000 - 14 * 86400000).toISOString().slice(0, 10);
  const recent = new Set(past.filter((r) => r['날짜'] >= cutoff).map((r) => r['티커']));
  const pick = rank.find((x) => !recent.has(x.ticker)) || rank[0];
  return { rank: rank.slice(0, 20), pick, recent: [...recent] };
}

async function gather(company, news) {
  const errors = [];
  const out = { company: { ticker: company.ticker, name: company.name, market: company.market } };
  const chart = await D.yahooChart(company.ticker, '1y').catch((e) => { errors.push(`주가: ${e.message}`); return null; });
  out.price = chart ? D.priceStats(chart.rows) : null;
  out.currency = chart ? chart.currency : null;
  out.news = D.newsFor(company, news).slice(0, 6).map((n) => ({ source: n.source, title: n.title, link: n.link }));
  let fin = null, shares = null, filings = [];
  if (company.market === 'KR') {
    try {
      const corp = await D.dartCorpCode(company.ticker.slice(0, 6));
      if (!corp) throw new Error('DART 기업코드를 찾지 못함');
      const [f, disc, info, reps] = await Promise.all([D.dartFinancials(corp.corp_code), D.dartDisclosures(corp.corp_code), D.dartCompany(corp.corp_code),
        D.brokerReports(company.ticker.slice(0, 6), company.name).catch((e) => { errors.push(`증권사 리포트: ${e.message}`); return null; })]);
      fin = f; filings = disc; out.profile = info; out.hiddenFilings = disc.hiddenRoutine || 0;
      if (reps) { out.reports = reps; out.reportSummary = D.reportSummary(reps, out.price && out.price.close); }
      if (f.annual) shares = await D.dartShares(corp.corp_code, f.annual.year).catch(() => null);
      out.source = 'DART';
    } catch (e) { errors.push(`DART: ${e.message}`); }
  } else {
    try {
      const cik = await D.secCik(company.ticker);
      if (!cik) throw new Error('SEC CIK를 찾지 못함');
      const [f, fl] = await Promise.all([D.secFinancials(cik.cik), D.secFilings(cik.cik)]);
      if (f) { fin = { annual: f.annual, latest: null }; shares = f.shares; } else errors.push('SEC: 미국 회계 기준 재무 데이터 없음 (해외 상장사일 수 있음)');
      filings = fl; out.profile = { name: cik.title };
      out.source = 'SEC';
    } catch (e) { errors.push(`SEC: ${e.message}`); }
  }
  out.filings = filings;
  // 코드가 직접 계산하는 숫자 (AI는 이것만 씀)
  const m = company.market;
  const a = fin && fin.annual, l = fin && fin.latest;
  const metrics = [];
  const push = (label, value, raw) => metrics.push({ label, value, raw });
  if (a) {
    push(`${a.year} 매출`, money(a.rev, m), a.rev); push(`${a.year} 매출 증가율`, growth(a.rev, a.revPrev) == null ? '-' : `${growth(a.rev, a.revPrev)}%`, growth(a.rev, a.revPrev));
    push(`${a.year} 영업이익`, money(a.op, m), a.op); push(`${a.year} 영업이익 증가율`, growth(a.op, a.opPrev) == null ? '-' : `${growth(a.op, a.opPrev)}%`, growth(a.op, a.opPrev));
    push(`${a.year} 영업이익률`, a.rev && a.op != null ? `${r1((a.op / a.rev) * 100)}%` : '-', a.rev && a.op != null ? r1((a.op / a.rev) * 100) : null);
    push(`${a.year} 순이익`, money(a.ni, m), a.ni);
  }
  if (l) {
    push(`${l.year} ${l.period} 누적 매출`, money(l.rev, m), l.rev); push(`${l.period} 누적 매출 전년비`, growth(l.rev, l.revPrev) == null ? '-' : `${growth(l.rev, l.revPrev)}%`, growth(l.rev, l.revPrev));
    push(`${l.year} ${l.period} 누적 영업이익`, money(l.op, m), l.op); push(`${l.period} 누적 영업이익 전년비`, growth(l.op, l.opPrev) == null ? '-' : `${growth(l.op, l.opPrev)}%`, growth(l.op, l.opPrev));
  }
  const p = out.price;
  if (p && shares) {
    const cap = p.close * shares * (m === 'KR' ? 1 : 1);
    push('시가총액 (간이)', money(cap, m), cap);
    if (a && a.ni > 0) push('PER (간이, 최근 연간 순이익)', `${r1(cap / a.ni)}배`, r1(cap / a.ni));
    // 최근 4분기 순이익 = 작년 연간 + 올해 누적 − 작년 같은 기간 누적 (이익이 급변할 때 연간 PER보다 현재에 가까움)
    if (a && l && a.year === l.year - 1 && [a.ni, l.ni, l.niPrev].every((x) => typeof x === 'number')) {
      const ttm = a.ni + l.ni - l.niPrev;
      if (ttm > 0) push(`PER (간이, 최근 4분기 순이익 ${money(ttm, m)})`, `${r1(cap / ttm)}배`, r1(cap / ttm));
    }
    if (a && a.equity > 0) push('PBR (간이, 최근 자본총계)', `${r1(cap / a.equity)}배`, r1(cap / a.equity));
  }
  if (p) {
    const cur = m === 'KR' ? '원' : '$';
    push('주가', m === 'KR' ? `${Math.round(p.close).toLocaleString('ko-KR')}원` : `$${p.close}`, p.close);
    push('1일 수익률', `${p.chg1d}%`, p.chg1d); push('1개월 수익률', `${p.ret1m}%`, p.ret1m); push('3개월 수익률', `${p.ret3m}%`, p.ret3m);
    push('연초 대비', `${p.retYtd}%`, p.retYtd); push('52주 고점 대비', `${p.fromHigh}%`, p.fromHigh);
    push('52주 범위', m === 'KR' ? `${Math.round(p.low52).toLocaleString('ko-KR')}~${Math.round(p.high52).toLocaleString('ko-KR')}원` : `$${p.low52}~$${p.high52}`, null);
    void cur;
  }
  out.metrics = metrics;
  out.errors = errors;
  return out;
}

// 교차검증: AI 문장 속 숫자가 제공한 데이터(지표·주목도)에 있는지
// 숫자 뽑기: 1,212,000처럼 천 단위 쉼표가 있는 숫자도 하나로 (예전엔 212,000으로 잘려 '없는 숫자'로 오인)
const NUM_RE = /-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?/g;
const nums = (s) => (String(s || '').match(NUM_RE) || []).map((n) => Number(n.replace(/,/g, '')));
function verifyNumbers(card, data, attention) {
  const pool = [];
  data.metrics.forEach((x) => {
    if (typeof x.raw === 'number') pool.push(x.raw);
    nums(x.value).forEach((n) => pool.push(n));
  });
  if (data.reportSummary) { const r = data.reportSummary; [r.min, r.max, r.median, r.gap, r.n].forEach((v) => v != null && pool.push(v)); }
  if (attention) [attention.chg, attention.volx, attention.news, attention.score].forEach((v) => v != null && pool.push(Number(v)));
  (data.news || []).concat(data.filings || [], data.reports || []).forEach((n) => nums(n.title).forEach((v) => pool.push(v)));
  const text = ['why_today', 'results', 'valuation', 'macro_link', 'street_view', 'kill_scenario'].map((k) => card[k] || '')
    .concat(card.bull || [], card.bear || [], card.checkpoints || []).join(' ');
  const found = [];
  const re = /(-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?)\s*(%|배|조원|조|억원|억|원|달러|\$B|B|bp|만주|배수)/g;
  let mm;
  while ((mm = re.exec(text))) {
    const n = Number(mm[1].replace(/,/g, ''));
    const ok = pool.some((v) => Math.abs(v - n) <= Math.max(0.15, Math.abs(v) * 0.02) || Math.abs(Math.abs(v) - Math.abs(n)) <= 0.15);
    found.push({ text: mm[0], ok });
  }
  return { total: found.length, bad: found.filter((x) => !x.ok).map((x) => x.text), ok: found.filter((x) => x.ok).length };
}

function mailSection(c) {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  const k = c.card || {};
  return `<h3 style="margin:20px 0 6px">오늘의 기업 · ${esc(c.data.company.name)} <span style="font-size:12px;color:#666">${esc(c.data.company.ticker)}</span></h3>
    <p style="margin:4px 0;font-weight:600">${esc(k.one_liner)}</p>
    <p style="margin:4px 0;font-size:13px"><b>오늘 주목 이유</b> ${esc(k.why_today)}</p>
    ${k.street_view ? `<p style="margin:4px 0;font-size:13px"><b>증권사 시각</b> ${esc(k.street_view)}</p>` : ''}
    <p style="margin:4px 0;font-size:13px">${c.data.metrics.filter((m) => /매출|영업이익|PER|PBR|시가총액|1개월|연초/.test(m.label)).slice(0, 8).map((m) => `${esc(m.label)} <b>${esc(m.value)}</b>`).join(' · ')}</p>
    <table style="width:100%;border-collapse:separate;border-spacing:8px 0;font-size:13px"><tr>
      <td style="vertical-align:top;width:50%;padding:8px;border-top:3px solid #1e7a52;background:#fafafa"><b style="color:#1e7a52">BULL</b><ul style="margin:4px 0;padding-left:16px">${(k.bull || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></td>
      <td style="vertical-align:top;width:50%;padding:8px;border-top:3px solid #b23a30;background:#fafafa"><b style="color:#b23a30">BEAR</b><ul style="margin:4px 0;padding-left:16px">${(k.bear || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></td></tr></table>
    ${c.verify && c.verify.bad.length ? `<p style="margin:4px 0;font-size:12px;color:#a2620b">숫자 근거 확인 필요: ${c.verify.bad.map(esc).join(', ')}</p>` : ''}`;
}

async function buildCard({ ticker, auto }) {
  const started = Date.now();
  const date = kstDate();
  const [news, issues, briefs] = await Promise.all([D.fetchNews({ hours: 48, max: 200 }), sheetRows('산업 이슈', 3), sheetRows('자동 브리핑', 3)]);
  const issuesRow = issues.find((r) => r['날짜'] === date);
  let company, attention = null, reason = '직접 선택';
  if (ticker) {
    company = D.UNIVERSE.find((c) => c.ticker.toUpperCase() === String(ticker).toUpperCase());
    if (!company) {
      const t = String(ticker).toUpperCase();
      company = { ticker: t, name: t, aliases: [t], market: /^\d{6}\.(KS|KQ)$/.test(t) ? 'KR' : 'US' };
    }
  } else {
    const sel = await pickToday({ news: news.items, issuesRow });
    if (!sel.pick) throw new Error('주목도 순위를 계산하지 못했습니다 (주가 데이터 오류)');
    company = D.UNIVERSE.find((c) => c.ticker === sel.pick.ticker);
    attention = sel.pick;
    reason = `주목도 1위${sel.recent.length ? ' (최근 2주 분석 종목 제외)' : ''}${sel.pick.bonus ? ' · 오늘 산업 이슈에 등장' : ''}`;
  }
  const data = await gather(company, news.items);
  if (!data.price && !data.metrics.length) throw new Error(`데이터를 가져오지 못했습니다: ${data.errors.join(' / ')}`);
  const brief = briefs.find((r) => r['날짜'] === date) || briefs[0];
  const macro = [brief && brief['한 줄 요약'], brief && brief['자동_섹터 시사점'], issuesRow && `산업 이슈: ${issuesRow['한 줄 요약'] || ''} (${issuesRow['산업'] || ''})`].filter(Boolean).join('\n');
  const dataText = `[기업] ${company.name} (${company.ticker}, ${company.market === 'KR' ? '한국' : '미국'})${data.profile && data.profile.ceo ? ` · 대표 ${data.profile.ceo}` : ''}
[선정 이유] ${reason}${attention ? ` · 1일 ${attention.chg}% · 평소 변동성 대비 ${attention.move}배 · 거래량 20일 평균 대비 ${attention.volx}배 · 관련 뉴스 ${attention.news}건` : ''}
[데이터 · 출처 ${data.source || '-'}·Yahoo]
${data.metrics.map((x) => `- ${x.label}: ${x.value}`).join('\n') || '(재무 데이터 없음)'}
[관련 뉴스]
${data.news.map((n, i) => `${i + 1}. [${n.source}] ${n.title}`).join('\n') || '(없음)'}
[최근 증권사 리포트 (제목·목표주가·투자의견만)]
${(data.reports || []).map((x) => `- ${x.date} ${x.broker}: ${x.title}${x.goal ? ` · 목표주가 ${x.goal.toLocaleString('ko-KR')}원` : ''}${x.opinion ? ` · ${x.opinion}` : ''}`).join('\n') || '(없음)'}
[최근 공시]
${data.filings.map((f) => `- ${f.date} ${f.title}`).join('\n') || '(없음)'}
[오늘의 매크로·산업]
${macro || '(없음)'}`;
  const budget = 53000 - (Date.now() - started);
  if (budget < 9000) throw new Error('데이터 수집이 오래 걸려 AI 분석 시간이 부족합니다. 다시 시도해 주세요.');
  const r = await callGemini({ system: PROMPT, parts: [{ text: dataText }], temperature: 0.4, json: true, maxOutputTokens: 2500, budgetMs: budget, primaryMs: Math.min(28000, budget - 9000) });
  if (!r.ok) throw new Error(r.error);
  const card = parseJsonLoose(r.text);
  if (!card) throw new Error('AI 응답 형식을 읽지 못했습니다');
  const verify = verifyNumbers(card, data, attention);
  const result = { date, reason, attention, data, card, verify, model: r.model };
  const saved = await sheetPost({ sheet: '기업 분석', record: {
    '날짜': date, '생성시각': new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }), '티커': company.ticker, '기업': company.name,
    '시장': company.market, '선정 이유': reason, '주목도 점수': attention ? attention.score : '', '한 줄 요약': card.one_liner || '',
    'BULL': (card.bull || []).join(' / '), 'BEAR': (card.bear || []).join(' / '), '숫자 검증': `근거 확인 ${verify.ok}/${verify.total}${verify.bad.length ? ` · 확인 필요: ${verify.bad.join(', ')}` : ''}`,
    '모델': r.model, '카드 JSON': JSON.stringify(result),
  } }).catch((e) => ({ error: e.message }));
  if (saved && saved.error) result.saveError = saved.error;
  void auto;
  return result;
}

module.exports = async (req, res) => {
  const url = new URL(req.url, 'http://x');
  // 주목도 순위는 AI를 쓰지 않는 읽기라 비밀번호 없이, 카드 만들기(AI)는 비밀번호 필요
  if (url.searchParams.get('rank') !== '1' && !isAuthorized(req)) return sendJson(res, 401, { ok: false, error: NEED_PASS });
  try {
    if (url.searchParams.get('rank') === '1') {
      const date = kstDate();
      const [news, issues] = await Promise.all([D.fetchNews({ hours: 48, max: 200 }), sheetRows('산업 이슈', 3)]);
      const sel = await pickToday({ news: news.items, issuesRow: issues.find((r) => r['날짜'] === date) });
      return sendJson(res, 200, { ok: true, rank: sel.rank, pick: sel.pick, recent: sel.recent, universe: D.UNIVERSE.map((c) => ({ ticker: c.ticker, name: c.name, market: c.market })) });
    }
    let body = {};
    if (req.method === 'POST') { try { body = await readBody(req); } catch (e) { body = {}; } }
    const result = await buildCard({ ticker: body.ticker || url.searchParams.get('ticker'), auto: !body.ticker });
    const out = { ok: true, result };
    if (url.searchParams.get('part') === '1') out.mailHtml = mailSection(result);
    return sendJson(res, 200, out);
  } catch (e) {
    return sendJson(res, 502, { ok: false, error: e.message });
  }
};
module.exports.verifyNumbers = verifyNumbers;
module.exports.mailSection = mailSection;
module.exports.gather = gather;
