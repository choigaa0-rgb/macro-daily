// AI 종합분석: 오늘의 데이터 + 자동 해석 + 내가 쓴 결론을 Gemini에 보내
// "AI의 종합 해석"과 "내 결론과의 비교 피드백"을 받아옵니다.
// 필요한 환경변수: GEMINI_API_KEY (Google AI Studio에서 무료 발급), GEMINI_MODEL(선택)

const { sendJson, checkPasscode, fetchWithTimeout, readBody } = require('./_lib');

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
## 내 결론에 대한 피드백
학생이 쓴 결론과 비교해서 (1) 잘 짚은 점 (2) 놓친 연결고리나 근거가 약한 부분 (3) 더 깊게 볼 질문 하나. 학생이 결론을 비워두었으면 "결론을 먼저 써보세요"라고만 쓴다.`;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST만 가능합니다' });
  if (!checkPasscode(req, res)) return;

  const key = process.env.GEMINI_API_KEY;
  if (!key) return sendJson(res, 500, { ok: false, error: 'GEMINI_API_KEY가 설정되지 않았습니다. README의 4단계를 참고하세요.' });

  let body;
  try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { ok: false, error: '요청 형식 오류' }); }

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const userText = `점검 날짜: ${body.date || ''}

[자동 수집 데이터]
${body.dataText || '(없음)'}

[자동 해석 신호]
${body.signalsText || '(없음)'}

[직접 확인·입력한 내용]
${body.manualText || '(없음)'}

[학생이 쓴 결론]
${body.conclusionText || '(비어 있음)'}`;

  try {
    const r = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: userText }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 2048 },
        }),
      },
      45000
    );
    const j = await r.json();
    if (!r.ok) {
      const msg = (j.error && j.error.message) || `Gemini 오류 ${r.status}`;
      return sendJson(res, 502, { ok: false, error: msg });
    }
    const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
    const text = parts.map((p) => p.text || '').join('').trim();
    if (!text) return sendJson(res, 502, { ok: false, error: 'AI 응답이 비어 있습니다. 잠시 후 다시 시도하세요.' });
    return sendJson(res, 200, { ok: true, model, text });
  } catch (e) {
    return sendJson(res, 502, { ok: false, error: `AI 호출 실패: ${e.message}` });
  }
};
