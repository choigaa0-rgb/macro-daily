// 산업 이슈: 언론사 RSS(제목·짧은 요약·링크) → AI가 전 산업에서 오늘의 이슈 6~8개를 골라 정리 → 교차검증 → 시트 '산업 이슈' 저장
// POST /api/industry           새로 만들기 (비밀번호 필요)
// GET  /api/industry?part=1     아침 자동화용: 만들고 저장한 뒤 메일용 HTML도 돌려줌
// 교차검증: AI가 단 출처 번호가 실제 기사인지, 이슈에 적은 관련 기업이 그 기사에 실제로 나오는지 확인

const { sendJson, isAuthorized, callGemini, sheetPost, sheetRows, parseJsonLoose, kstDate } = require('./_lib');
const { fetchNews } = require('./_data');

const PROMPT = `너는 한국 증권사 리서치센터의 산업 애널리스트 팀장이다.
주어진 오늘 경제·산업 뉴스 목록(번호, 출처, 제목, 짧은 요약)만 보고 '전 산업'에서 투자 관점에서 중요한 이슈 6~8개를 고른다.
원칙:
1. 목록에 있는 기사만 근거로 쓴다. 기사에 없는 사실·숫자·발언을 지어내지 않는다. 각 이슈는 근거 기사 번호를 1개 이상 단다.
2. 같은 사건을 다룬 여러 기사는 하나의 이슈로 묶는다. 정치·사건사고처럼 산업과 무관한 기사는 뺀다.
3. 산업 이름은 짧게(예: 반도체, 2차전지, 자동차, 조선, 방산, 바이오, 인터넷·플랫폼, 게임, 은행, 증권, 보험, 에너지·정유, 화학, 철강, 건설, 유통·소비재, 항공·해운, 통신, 유틸리티).
4. 관련 기업은 근거 기사에 이름이 나온 상장사만 적는다.
5. 매크로 연결은 주어진 '오늘의 매크로' 내용과 이어서 한 문장으로. 매크로 정보가 없으면 빈 문자열.
6. 투자 권유·매수 추천은 하지 않는다. 한국어, 짧은 문장. JSON 하나만 출력한다.
출력:
{ "headline": "오늘 산업 이슈 한 줄 요약",
  "issues": [ { "industry": "산업", "title": "이슈 제목", "summary": "무슨 일인지 2문장", "why": "왜 중요한지 한 문장",
    "impact": "긍정 | 부정 | 혼재 | 중립", "macro_link": "", "companies": ["기업명"], "sources": [1, 2] } ] }`;

function verifyIssues(issues, news) {
  return (issues || []).map((it) => {
    const srcs = (it.sources || []).map((n) => news[Number(n) - 1]).filter(Boolean);
    const text = srcs.map((s) => `${s.title} ${s.desc || ''}`).join(' ');
    const companies = (it.companies || []).map((c) => ({ name: c, inSource: !!c && text.includes(String(c).replace(/\s/g, '').slice(0, 4)) }));
    return Object.assign({}, it, {
      links: srcs.map((s) => ({ source: s.source, title: s.title, link: s.link })),
      companies,
      check: !srcs.length ? '근거 기사 없음' : companies.some((c) => !c.inSource) ? '관련 기업 일부 기사에 없음' : '근거 확인',
    });
  }).filter((it) => it.links.length); // 근거 기사가 없는 이슈는 버림
}

function mailSection(data) {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  const color = { 긍정: '#1e7a52', 부정: '#b23a30', 혼재: '#a2620b', 중립: '#5f6875' };
  return `<h3 style="margin:20px 0 6px">산업 이슈${data.headline ? ` · ${esc(data.headline)}` : ''}</h3>
    ${(data.issues || []).map((it) => `<div style="margin:0 0 10px;padding:8px 10px;border-left:3px solid ${color[it.impact] || '#5f6875'};background:#fafafa">
      <b>[${esc(it.industry)}] ${esc(it.title)}</b> <span style="color:${color[it.impact] || '#5f6875'};font-size:12px">${esc(it.impact || '')}</span>
      <div style="font-size:13px;margin-top:3px">${esc(it.summary)}${it.macro_link ? `<br><span style="color:#24609b">매크로: ${esc(it.macro_link)}</span>` : ''}</div>
      <div style="font-size:12px;margin-top:3px">${it.links.map((l) => `<a href="${esc(l.link)}">${esc(l.source)}</a>`).join(' · ')}</div></div>`).join('')}`;
}

async function build() {
  const started = Date.now();
  const date = kstDate();
  const [news, auto] = await Promise.all([fetchNews({ hours: 30, max: 120 }), sheetRows('자동 브리핑', 5)]);
  if (!news.items.length) throw new Error(`뉴스를 가져오지 못했습니다 (${news.errors.join(' / ')})`);
  const today = auto.find((r) => r['날짜'] === date) || auto[0];
  const macro = today ? [today['한 줄 요약'], today['자동_섹터 시사점']].filter(Boolean).join('\n') : '';
  const list = news.items.map((n, i) => `${i + 1}. [${n.source}] ${n.title}${n.desc ? ` — ${n.desc.slice(0, 90)}` : ''}`).join('\n');
  const budget = 52000 - (Date.now() - started);
  const r = await callGemini({ system: PROMPT, parts: [{ text: `날짜: ${date}\n\n[오늘의 매크로]\n${macro || '(없음)'}\n\n[뉴스 목록]\n${list}` }], temperature: 0.3, json: true, maxOutputTokens: 3000, budgetMs: budget, primaryMs: Math.min(28000, budget - 10000) });
  if (!r.ok) throw new Error(r.error);
  const j = parseJsonLoose(r.text);
  if (!j || !Array.isArray(j.issues)) throw new Error('AI 응답 형식을 읽지 못했습니다');
  const issues = verifyIssues(j.issues, news.items);
  const data = { date, headline: j.headline || '', issues, model: r.model, newsCount: news.items.length, feedErrors: news.errors, macroUsed: !!macro };
  await sheetPost({ sheet: '산업 이슈', record: {
    '날짜': date, '생성시각': new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }), '한 줄 요약': data.headline,
    '이슈 수': issues.length, '산업': issues.map((x) => x.industry).join(', '), '관련 기업': [...new Set(issues.flatMap((x) => x.companies.map((c) => c.name)))].join(', '),
    '모델': r.model, '이슈 JSON': JSON.stringify(data),
  } }).catch((e) => { data.saveError = e.message; });
  return data;
}

module.exports = async (req, res) => {
  if (!isAuthorized(req)) return sendJson(res, 401, { ok: false, error: '비밀번호가 맞지 않습니다.' });
  const url = new URL(req.url, 'http://x');
  try {
    const data = await build();
    const out = { ok: true, data };
    if (url.searchParams.get('part') === '1') out.mailHtml = mailSection(data);
    return sendJson(res, 200, out);
  } catch (e) {
    return sendJson(res, 502, { ok: false, error: e.message });
  }
};
module.exports.verifyIssues = verifyIssues;
module.exports.mailSection = mailSection;
