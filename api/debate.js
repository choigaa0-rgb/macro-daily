// AI 리서치센터: TradingAgents(Xiao et al., 2024)의 '애널리스트 → 강세·약세 토론 → 리스크 팀 → 최종 결정' 구조를
// 데일리 매크로 분석에 맞게 옮긴 것. 애널리스트 보고서는 화면의 규칙 기반 자동 신호가 맡고,
// 여기서는 토론 단계만 AI가 수행합니다. 단계마다 따로 호출해 Vercel 60초 제한을 넘지 않게 합니다.
//
// POST /api/debate { stage: 'open' | 'rebut' | 'risk' | 'chief', date, analystText, dataText, manualText, previousText, debate }

const { sendJson, checkPasscode, demoGate, readBody, callGemini } = require('./_lib');
const { fetchNews, marketHeadlines, headlinesText } = require('./_data');

const COMMON = `너는 한국 증권사 리서치센터의 데일리 매크로 토론을 진행한다.
원칙:
1. 주어진 데이터·애널리스트 보고서에 있는 숫자와 사실만 쓴다. 뉴스·발언·수급 수치를 지어내지 않는다. 원인을 모르면 "원인 확인 필요"라고 쓴다.
2. 성장 / 물가 / 정책 / 위험 회피 중 어떤 이야기인지 연결해서 말한다.
3. 한국(원달러, KOSPI, 외국인, 국고채)으로의 전이를 꼭 다룬다.
4. 투자 권유는 하지 않는다. 전망은 학습용 방향 판단이다.
5. 한국어로, 문장은 짧게. JSON 하나만 출력한다.
6. 숫자마다 기준일이 다르다. [한국 데이터 시점]이 있으면 따른다. 한국 숫자를 쓸 때는 날짜를 붙인다.
7. [시장 헤드라인]은 제목뿐이다. 원인·업종 이슈(실적, 수출, 수급, 정책)의 근거로 쓰되 제목에 있는 사실만 쓰고 "(헤드라인)"을 붙인다. 규칙 기반 섹터 연결과 헤드라인이 다르면 헤드라인 쪽 이슈를 무시하지 않는다.
전망은 다음 5거래일 뒤 방향(상승|보합|하락)이며 보합 범위는 미국 10년물 ±3bp, S&P500 ±0.5%, 원달러 ±0.5%, KOSPI ±0.7%이다.`;

const FC = `{ "미국10년물": "상승|보합|하락", "S&P500": "상승|보합|하락", "원달러": "상승|보합|하락", "KOSPI": "상승|보합|하락" }`;

const PROMPTS = {
  open: `${COMMON}
이번 단계: 두 연구원의 첫 발언.
- BULL: 위험자산과 경기에 낙관적으로 해석하는 연구원
- BEAR: 비관적으로 해석하는 연구원
둘 다 같은 데이터를 보되, 각자 가장 강한 논거를 고른다.
출력:
{ "bull": { "claim": "핵심 주장 한 문장", "points": ["근거(숫자 포함)", "근거", "근거"], "korea": "한국 시장에 대한 견해 한 문장", "forecast": ${FC} },
  "bear": { "claim": "...", "points": ["...", "...", "..."], "korea": "...", "forecast": ${FC} } }`,

  rebut: `${COMMON}
이번 단계: 서로 반박. 상대 발언에서 가장 약한 근거를 하나 골라 데이터로 반박하고, 상대 논거 중 인정할 부분도 하나 말한다.
출력:
{ "bull": { "rebuttal": "BEAR에 대한 반박 2문장 이내", "concede": "BEAR 논거 중 인정하는 점 한 문장" },
  "bear": { "rebuttal": "BULL에 대한 반박 2문장 이내", "concede": "BULL 논거 중 인정하는 점 한 문장" } }`,

  risk: `${COMMON}
이번 단계: 리스크 팀. 토론을 중립적으로 평가한다. 어느 쪽 편도 들지 않고, 판단이 뒤집힐 조건을 정리한다.
출력:
{ "balance": "BULL 우세 | BEAR 우세 | 팽팽 중 하나",
  "reason": "판단 이유 2문장 이내",
  "key_issue": "두 연구원이 갈린 핵심 쟁점 한 문장",
  "bull_wrong_if": "BULL이 틀렸다고 볼 신호 (지표와 방향)",
  "bear_wrong_if": "BEAR가 틀렸다고 볼 신호 (지표와 방향)",
  "scenarios": [ { "name": "시나리오 이름", "trigger": "계기", "reaction": "2년물·달러·KOSPI 등 예상 반응" } ],
  "checkpoints": ["다음에 확인할 이벤트나 지표", "..."] }
scenarios는 2~3개.`,

  chief: `${COMMON}
이번 단계: 리서치센터장. 애널리스트 보고서, 토론, 리스크 팀 평가를 모두 듣고 오늘의 결론을 쓴다.
출력:
{ "오늘의 동인": "[무엇이] [얼마나] — [왜] 한 문장",
  "이야기": "성장 | 물가 | 정책 | 위험 회피·지정학 | 실적·개별 이슈 | 뚜렷한 동인 없음 중 하나",
  "한국 영향": "한 문장",
  "국면 판단": "골디락스 쪽 | 리플레이션 쪽 | 침체·디스인플레이션 쪽 | 스태그플레이션 우려 쪽 | 판단 보류 중 하나",
  "뷰 변화": "유지 | 강화 | 약화 | 수정 중 하나 (지난 결론이 없으면 유지)",
  "다음 체크포인트": "[이벤트] — [이렇게 나오면 강화 / 저렇게 나오면 수정]",
  "투자 시사점": "오늘 매크로로 유리·불리한 섹터와 이유 한 문장 (섹터 연결 참고, 종목 추천 금지)",
  "종합 해석": "3~5문장. BULL과 BEAR 중 무엇을 받아들이고 무엇을 남겨두는지 포함",
  "전망": ${FC} }`,
};

function parseJson(text) {
  const t = String(text).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(t); } catch (e) {
    const m = t.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch (e2) { /* 아래 처리 */ } }
    return null;
  }
}

function debateText(d) {
  if (!d) return '(없음)';
  const lines = [];
  const side = (name, x) => {
    if (!x) return;
    lines.push(`[${name}] ${x.claim || ''}`);
    (x.points || []).forEach((p) => lines.push(`- ${p}`));
    if (x.korea) lines.push(`- 한국: ${x.korea}`);
    if (x.forecast) lines.push(`- 전망: ${Object.entries(x.forecast).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  };
  if (d.open) { side('BULL', d.open.bull); side('BEAR', d.open.bear); }
  if (d.rebut) {
    if (d.rebut.bull) lines.push(`[BULL 반박] ${d.rebut.bull.rebuttal || ''} / 인정: ${d.rebut.bull.concede || ''}`);
    if (d.rebut.bear) lines.push(`[BEAR 반박] ${d.rebut.bear.rebuttal || ''} / 인정: ${d.rebut.bear.concede || ''}`);
  }
  if (d.risk) {
    lines.push(`[리스크 팀] ${d.risk.balance || ''}: ${d.risk.reason || ''}`);
    if (d.risk.key_issue) lines.push(`- 핵심 쟁점: ${d.risk.key_issue}`);
    if (d.risk.bull_wrong_if) lines.push(`- BULL이 틀렸다고 볼 신호: ${d.risk.bull_wrong_if}`);
    if (d.risk.bear_wrong_if) lines.push(`- BEAR가 틀렸다고 볼 신호: ${d.risk.bear_wrong_if}`);
  }
  return lines.join('\n') || '(없음)';
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST만 가능합니다' });
  if (!checkPasscode(req, res)) return;
  if (!demoGate(req, res, 'heavy')) return;
  let body;
  try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { ok: false, error: '요청 형식 오류' }); }
  const stage = body.stage;
  if (!PROMPTS[stage]) return sendJson(res, 400, { ok: false, error: '알 수 없는 단계' });

  // 첫 발언·센터장 단계에는 언론사 헤드라인을 함께 넣음 (규칙만으로 한국장을 해석하지 않도록)
  let heads = '';
  if (stage === 'open' || stage === 'chief') {
    const news = await fetchNews({ hours: 30, max: 160 }).catch(() => ({ items: [] }));
    heads = headlinesText(marketHeadlines(news.items, 20));
  }
  const text = `점검 날짜: ${body.date || ''}
${body.krNote ? `\n[한국 데이터 시점]\n${body.krNote}\n` : ''}
[애널리스트 팀 보고서 (규칙 기반 자동 신호)]
${body.analystText || '(없음)'}

[자동 수집 데이터]
${body.dataText || '(없음)'}

[직접 확인·입력한 내용]
${body.manualText || '(없음)'}

[지난 결론]
${body.previousText || '(없음)'}

[지금까지의 토론]
${debateText(body.debate)}${heads ? `\n\n[시장 헤드라인 (언론사 RSS 제목, 최근 30시간)]\n${heads}` : ''}`;

  const r = await callGemini({ system: PROMPTS[stage], parts: [{ text }], temperature: stage === 'open' ? 0.6 : 0.4, json: true, maxOutputTokens: 1800 });
  if (!r.ok) return sendJson(res, r.status, { ok: false, error: r.error });
  const data = parseJson(r.text);
  if (!data) return sendJson(res, 502, { ok: false, error: 'AI 응답 형식을 읽지 못했습니다. 다시 눌러주세요.' });
  return sendJson(res, 200, { ok: true, model: r.model, stage, data });
};

module.exports.debateText = debateText;
