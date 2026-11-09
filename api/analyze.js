// AI 종합분석: 오늘의 데이터 + 자동 해석 + 내가 쓴 결론을 Gemini에 보내
// "AI의 종합 해석"과 "내 결론과의 비교 피드백"을 받아옵니다.
// 필요한 환경변수: GEMINI_API_KEY (Google AI Studio에서 무료 발급), GEMINI_MODEL(선택)

const { sendJson, checkPasscode, readBody, callGemini } = require('./_lib');

const SYSTEM_PROMPT = `너는 한국 증권사 리서치센터의 시니어 매크로 애널리스트다.
금융권 취업을 준비하는 경영학부 학생이 매일 수행하는 데일리 매크로 점검 결과를 검토한다.

분석 원칙:
1. 금리 → 달러 → 주식 → 원자재 → 위험·심리 → 정책 기대 → 경제 데이터 → 한국 순서로 연결해서 해석한다.
2. 절대 수치보다 변화와 컨센서스 대비 서프라이즈를 중시한다.
3. 모든 움직임을 성장 / 물가 / 정책 중 어떤 이야기인지로 분류한다.
4. 2년물은 정책 기대, 10년물은 성장·물가·기간 프리미엄을 반영한다. 10년물 ≈ 실질금리 + 기대인플레이션.
5. 주식-금리 조합(좋은 금리 상승 / 나쁜 금리 상승 / 골디락스 / 위험 회피)으로 해석을 교차 검증한다.
6. 한국은 금리·달러 경로(원달러, 외국인 수급)와 반도체·수출 경로로 전이된다.
7. 데이터에 없는 사실(뉴스, 발언, 지표 결과)을 지어내지 않는다. 원인을 모르면 "확인 필요"라고 쓴다.
8. 투자 권유나 매수·매도 추천은 하지 않는다.

출력 형식 (한국어, 마크다운, 전체 450단어 이내):
## 오늘의 동인
한두 문장.
## 해석
성장/물가/정책 중 어떤 이야기인지, 근거가 되는 자산 움직임 3~4개를 bullet로.
## 한국 전이
두세 문장.
## 국면 신호와 뷰
골디락스/리플레이션/침체·디스인플레이션/스태그플레이션 중 어느 쪽으로 기울었는지와 이유, 기존 뷰 유지/강화/약화/수정 판단.
## 다음 체크포인트
bullet 2~3개.
## 섹터 시사점
주어진 섹터 연결을 참고해 유리·불리 섹터 한두 줄 (종목 추천 금지).
## 내 결론에 대한 피드백
학생이 쓴 결론과 비교해서 (1) 잘 짚은 점 (2) 놓친 연결고리나 근거가 약한 부분 (3) 더 깊게 볼 질문 하나. 토론 내용이 함께 주어지면, 학생이 BULL·BEAR 중 어느 쪽 논거를 받아들였고 반대편의 어떤 점을 놓쳤는지도 짚는다. 학생이 결론을 비워두었으면 "결론을 먼저 써보세요"라고만 쓴다.`;

// 빠른 브리핑: 학생 결론 없이 AI가 결론 칸을 채울 JSON을 만듦
const BRIEF_PROMPT = `너는 한국 증권사 리서치센터의 시니어 매크로 애널리스트다.
주어진 데이터와 자동 해석 신호만으로 오늘의 데일리 매크로 결론을 작성한다.

원칙:
1. 금리 → 달러 → 주식 → 원자재 → 위험 → 정책 → 데이터 → 한국 순서로 연결해 해석한다.
2. 데이터에 없는 사실(뉴스, 발언, 수급 수치)을 지어내지 않는다. 원인을 모르면 "원인 확인 필요"라고 쓴다.
3. 숫자는 주어진 데이터에 있는 것만 쓴다.
4. 투자 권유는 하지 않는다. 전망은 학습용 방향 판단일 뿐이다.

아래 JSON 하나만 출력한다. 값은 모두 한국어.
{
  "오늘의 동인": "[무엇이] [얼마나] — [왜] 형식 한 문장",
  "이야기": "성장 | 물가 | 정책 | 위험 회피·지정학 | 실적·개별 이슈 | 뚜렷한 동인 없음 중 하나",
  "한국 영향": "한국 시장 움직임, 경로(금리·달러 / 반도체), 다르면 이유 — 한 문장",
  "국면 판단": "골디락스 쪽 | 리플레이션 쪽 | 침체·디스인플레이션 쪽 | 스태그플레이션 우려 쪽 | 판단 보류 중 하나",
  "뷰 변화": "유지 | 강화 | 약화 | 수정 중 하나 (지난 결론이 없으면 유지)",
  "다음 체크포인트": "[이벤트] — [이렇게 나오면 강화 / 저렇게 나오면 수정]",
  "투자 시사점": "오늘 매크로로 유리·불리한 섹터와 이유 한 문장 (섹터 연결 참고, 종목 추천 금지)",
  "종합 해석": "3~5문장",
  "전망": { "미국10년물": "상승|보합|하락", "S&P500": "상승|보합|하락", "원달러": "상승|보합|하락", "KOSPI": "상승|보합|하락" }
}
전망은 다음 5거래일 뒤 방향이다. 보합 범위: 미국 10년물 ±3bp, S&P500 ±0.5%, 원달러 ±0.5%, KOSPI ±0.7%.`;

function parseJson(text) {
  const t = String(text).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(t); } catch (e) {
    const m = t.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch (e2) { /* 아래에서 처리 */ } }
    return null;
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST만 가능합니다' });
  if (!checkPasscode(req, res)) return;

  let body;
  try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { ok: false, error: '요청 형식 오류' }); }

  const userText = `점검 날짜: ${body.date || ''}

[자동 수집 데이터]
${body.dataText || '(없음)'}

[자동 해석 신호]
${body.signalsText || '(없음)'}

[직접 확인·입력한 내용]
${body.manualText || '(없음)'}

[학생이 쓴 결론]
${body.conclusionText || '(비어 있음)'}${body.debateText ? `\n\n[AI 리서치센터 토론 (학생이 결론 전에 본 내용)]\n${body.debateText}` : ''}`;

  if (body.mode === 'brief') {
    const briefText = `점검 날짜: ${body.date || ''}

[자동 수집 데이터]
${body.dataText || '(없음)'}

[자동 해석 신호]
${body.signalsText || '(없음)'}

[직접 확인·입력한 내용]
${body.manualText || '(없음)'}

[지난 결론]
${body.previousText || '(없음)'}`;
    const b = await callGemini({ system: BRIEF_PROMPT, parts: [{ text: briefText }], temperature: 0.3, json: true });
    if (!b.ok) return sendJson(res, b.status, { ok: false, error: b.error });
    const data = parseJson(b.text);
    if (!data) return sendJson(res, 502, { ok: false, error: 'AI 브리핑 형식을 읽지 못했습니다. 다시 눌러주세요.' });
    return sendJson(res, 200, { ok: true, model: b.model, brief: data });
  }

  const r = await callGemini({ system: SYSTEM_PROMPT, parts: [{ text: userText }], temperature: 0.4 });
  if (!r.ok) return sendJson(res, r.status, { ok: false, error: r.error });
  return sendJson(res, 200, { ok: true, model: r.model, text: r.text });
};
