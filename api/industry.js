// 산업 이슈: 언론사 RSS(제목·짧은 요약·링크) → AI가 전 산업에서 오늘의 이슈 6~8개를 골라 정리 → 교차검증 → 시트 '산업 이슈' 저장
// POST /api/industry           새로 만들기 (비밀번호 필요)
// GET  /api/industry?part=1     아침 자동화용: 만들고 저장한 뒤 메일용 HTML도 돌려줌
// 교차검증: AI가 단 출처 번호가 실제 기사인지, 이슈에 적은 관련 기업이 그 기사에 실제로 나오는지 확인

const { NEED_PASS, sendJson, isAuthorized, demoGate, callGemini, sheetPost, sheetRows, parseJsonLoose, kstDate } = require('./_lib');
const { fetchNews } = require('./_data');
const { krSectors } = require('./sectors');

// 태그 기준 (날마다 들쭉날쭉하지 않게 정해진 목록에서만 고름)
// 섹터: Finviz·GICS 11개 섹터 (매일 점검 '미국 섹터' 그래프와 같은 이름)
const SECTORS = ['기술', '커뮤니케이션', '경기소비재', '필수소비재', '헬스케어', '금융', '산업재', '소재', '에너지', '유틸리티', '부동산'];
const REGIONS = ['국내', '해외', '공통'];
// 코스피 업종: KRX에서 실제 이름을 받으면 그것, 못 받으면 아래 기본 목록
const KOSPI_DEFAULT = ['음식료·담배', '섬유·의류', '종이·목재', '화학', '제약', '비금속', '금속', '기계·장비', '전기·전자', '의료·정밀기기', '운송장비·부품', '유통', '전기·가스', '건설', '운송·창고', '통신', '금융', '증권', '보험', '일반서비스', 'IT 서비스', '부동산', '오락·문화'];
const SECTOR_ALIAS = { IT: '기술', 정보기술: '기술', 테크: '기술', 반도체: '기술', 통신: '커뮤니케이션', 통신서비스: '커뮤니케이션', 미디어: '커뮤니케이션', 소비재: '경기소비재', 임의소비재: '경기소비재', 자동차: '경기소비재', 바이오: '헬스케어', 제약: '헬스케어', 헬스: '헬스케어', 은행: '금융', 증권: '금융', 보험: '금융', 산업: '산업재', 조선: '산업재', 방산: '산업재', 화학: '소재', 철강: '소재', 정유: '에너지', 전력: '유틸리티', 건설: '산업재' };
// 세부 산업이 분명하면 섹터는 이 표를 따름 (AI가 '전력'을 '기술'로 다는 식의 실수 바로잡기)
const INDUSTRY_SECTOR = [
  [/반도체|소프트웨어|IT서비스|디스플레이|전자부품|AI인프라/, '기술'],
  [/인터넷|플랫폼|게임|미디어|엔터|통신|광고/, '커뮤니케이션'],
  [/자동차|2차전지|배터리|유통|이커머스|여행|호텔|레저|의류|화장품|가전/, '경기소비재'],
  [/음식료|식품|담배|주류|생활용품/, '필수소비재'],
  [/바이오|제약|신약|의료|헬스/, '헬스케어'],
  [/은행|증권|보험|카드|금융|핀테크|자산운용/, '금융'],
  [/조선|방산|항공|해운|기계|건설|운송|물류|전선|중공업/, '산업재'],
  [/화학|철강|비철|소재|금속|종이/, '소재'],
  [/정유|석유|원유|에너지|가스전/, '에너지'],
  [/전력|발전|원전|유틸리티|가스공사|도시가스/, '유틸리티'],
  [/부동산|리츠/, '부동산'],
];
const norm = (x) => String(x || '').replace(/[\s·.,]/g, '').replace(/업$/, '');

const PROMPT = `너는 한국 증권사 리서치센터의 산업 애널리스트 팀장이다.
주어진 오늘 경제·산업 뉴스 목록(번호, 출처, 제목, 짧은 요약)만 보고 '전 산업'에서 투자 관점에서 중요한 이슈 6~8개를 고른다.
원칙:
1. 목록에 있는 기사만 근거로 쓴다. 기사에 없는 사실·숫자·발언을 지어내지 않는다. 각 이슈는 근거 기사 번호를 1개 이상 단다.
2. 같은 사건을 다룬 여러 기사는 하나의 이슈로 묶는다. 서로 다른 사건(예: 미국 FDA 경고와 국내 신약 임상)은 같은 산업이라도 한 이슈에 섞지 말고 따로 쓰거나 더 중요한 하나만 쓴다. 정치·사건사고처럼 산업과 무관한 기사는 뺀다.
3. 태그는 세 가지를 정한다.
   - sector: 반드시 다음 11개 중 하나 → {SECTORS}
   - industry: 세부 산업을 짧게 (예: 반도체, 2차전지, 자동차, 조선, 방산, 바이오, 인터넷·플랫폼, 게임, 은행, 증권, 보험, 정유, 화학, 철강, 건설, 유통, 항공·해운, 통신, 전력)
   - region: 국내(주인공이 한국 기업·한국 시장. 한국 기업의 해외 인수·수주도 국내) | 해외(주인공이 외국 기업·외국 시장이고 한국 영향이 뚜렷하지 않음) | 공통(외국 사건이 한국 기업·업종에 바로 영향, 예: 엔비디아 실적 → 국내 반도체)
   - kospi_sector: region이 국내·공통이면 다음 코스피 업종 중 가장 가까운 하나, 해외면 빈 문자열 → {KOSPI}
4. 관련 기업은 근거 기사에 이름이 나온 상장사만 적는다.
5. macro_link는 '이 이슈'와 특정 매크로 변수(금리, 환율, 유가, 물가, 경기, 수급 중 하나 이상)가 어떻게 이어지는지 한 문장으로. 이슈마다 다르게 쓰고, headline이나 '오늘의 매크로' 문장을 그대로 옮기지 않는다. 뚜렷한 연결이 없으면 빈 문자열.
6. 투자 권유·매수 추천은 하지 않는다. 한국어, 짧은 문장. JSON 하나만 출력한다.
출력:
{ "headline": "오늘 산업 이슈 한 줄 요약",
  "issues": [ { "sector": "기술", "industry": "반도체", "region": "공통", "kospi_sector": "전기·전자", "title": "이슈 제목", "summary": "무슨 일인지 2문장", "why": "왜 중요한지 한 문장",
    "impact": "긍정 | 부정 | 혼재 | 중립", "macro_link": "", "companies": ["기업명"], "sources": [1, 2] } ] }`;

// 태그를 정해진 목록에 맞춤 (목록 밖이면 비슷한 말로 바꾸고, 그래도 없으면 비움)
function fixTags(it, kospiList) {
  let sector = String(it.sector || '').trim();
  const ind = String(it.industry || '').replace(/[\s·]/g, '');
  const byInd = (INDUSTRY_SECTOR.find(([re]) => re.test(ind)) || [])[1];
  if (byInd) sector = byInd;
  else if (!SECTORS.includes(sector)) sector = SECTOR_ALIAS[sector] || SECTOR_ALIAS[String(it.industry || '').trim()] || SECTORS.find((x) => sector.includes(x)) || '';
  const region = REGIONS.includes(it.region) ? it.region : '국내';
  let ks = String(it.kospi_sector || '').trim();
  if (region === '해외') ks = '';
  else if (ks && !kospiList.includes(ks)) ks = kospiList.find((x) => norm(x) === norm(ks)) || kospiList.find((x) => norm(x).includes(norm(ks)) || norm(ks).includes(norm(x))) || '';
  return { sector, region, kospi_sector: ks, industry: String(it.industry || sector || '').trim() };
}

function verifyIssues(issues, news, kospiList = KOSPI_DEFAULT) {
  // 같은 매크로 문장을 여러 이슈에 복사해 붙인 경우는 연결이 아니므로 비움
  const mk = (x) => String(x || '').replace(/\s/g, '');
  const cnt = {};
  (issues || []).forEach((it) => { const k = mk(it.macro_link); if (k) cnt[k] = (cnt[k] || 0) + 1; });
  return (issues || []).map((raw0) => {
    const raw = cnt[mk(raw0.macro_link)] >= 2 ? Object.assign({}, raw0, { macro_link: '' }) : raw0;
    const it = Object.assign({}, raw, fixTags(raw, kospiList));
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
      <b>[${esc([it.region, it.sector, it.industry].filter((x, i, a) => x && a.indexOf(x) === i).join(' · '))}] ${esc(it.title)}</b> <span style="color:${color[it.impact] || '#5f6875'};font-size:12px">${esc(it.impact || '')}</span>
      <div style="font-size:13px;margin-top:3px">${esc(it.summary)}${it.macro_link ? `<br><span style="color:#24609b">매크로: ${esc(it.macro_link)}</span>` : ''}</div>
      <div style="font-size:12px;margin-top:3px">${it.links.map((l) => `<a href="${esc(l.link)}">${esc(l.source)}</a>`).join(' · ')}</div></div>`).join('')}`;
}

async function build({ save = true } = {}) {
  const started = Date.now();
  const date = kstDate();
  const krNames = Promise.race([krSectors().then((k) => (k.ok ? k.rows.map((r) => r.name) : null)).catch(() => null), new Promise((r) => setTimeout(() => r(null), 6000))]);
  const [news, auto, krList] = await Promise.all([fetchNews({ hours: 30, max: 120 }), sheetRows('자동 브리핑', 5), krNames]);
  const kospiList = krList && krList.length ? krList : KOSPI_DEFAULT;
  if (!news.items.length) throw new Error(`뉴스를 가져오지 못했습니다 (${news.errors.join(' / ')})`);
  const today = auto.find((r) => r['날짜'] === date) || auto[0];
  const macro = today ? [today['한 줄 요약'], today['자동_섹터 시사점']].filter(Boolean).join('\n') : '';
  const list = news.items.map((n, i) => `${i + 1}. [${n.source}] ${n.title}${n.desc ? ` — ${n.desc.slice(0, 90)}` : ''}`).join('\n');
  const budget = 52000 - (Date.now() - started);
  const system = PROMPT.replace('{SECTORS}', SECTORS.join(', ')).replace('{KOSPI}', kospiList.join(', '));
  const r = await callGemini({ system, parts: [{ text: `날짜: ${date}\n\n[오늘의 매크로]\n${macro || '(없음)'}\n\n[뉴스 목록]\n${list}` }], temperature: 0.3, json: true, maxOutputTokens: 3000, budgetMs: budget, primaryMs: Math.min(28000, budget - 10000) });
  if (!r.ok) throw new Error(r.error);
  const j = parseJsonLoose(r.text);
  if (!j || !Array.isArray(j.issues)) throw new Error('AI 응답 형식을 읽지 못했습니다');
  const issues = verifyIssues(j.issues, news.items, kospiList);
  const data = { date, headline: j.headline || '', issues, model: r.model, newsCount: news.items.length, feedErrors: news.errors, macroUsed: !!macro };
  if (!save) { data.demo = true; return data; } // 체험용: 기록을 덮어쓰지 않음
  await sheetPost({ sheet: '산업 이슈', record: {
    '날짜': date, '생성시각': new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }), '한 줄 요약': data.headline,
    '이슈 수': issues.length, '산업': issues.map((x) => [x.region, x.sector, x.industry].filter(Boolean).join('·')).join(', '), '관련 기업': [...new Set(issues.flatMap((x) => x.companies.map((c) => c.name)))].join(', '),
    '모델': r.model, '이슈 JSON': JSON.stringify(data),
  } }).catch((e) => { data.saveError = e.message; });
  return data;
}

module.exports = async (req, res) => {
  const who = isAuthorized(req);
  if (!who) return sendJson(res, 401, { ok: false, error: NEED_PASS });
  if (!demoGate(req, res, 'heavy')) return;
  const url = new URL(req.url, 'http://x');
  try {
    const data = await build({ save: who === 'admin' });
    const out = { ok: true, data };
    if (url.searchParams.get('part') === '1') out.mailHtml = mailSection(data);
    return sendJson(res, 200, out);
  } catch (e) {
    return sendJson(res, 502, { ok: false, error: e.message });
  }
};
module.exports.verifyIssues = verifyIssues;
module.exports.fixTags = fixTags;
module.exports.SECTORS = SECTORS;
module.exports.mailSection = mailSection;
