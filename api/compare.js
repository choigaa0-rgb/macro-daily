// 증권사 리포트 비교: 리포트(PDF 또는 붙여넣은 글)와 내 결론을 Gemini에 보내 비교
// 필요한 환경변수: GEMINI_API_KEY, GEMINI_MODEL(선택)

const { sendJson, checkPasscode, fetchWithTimeout, readBody } = require('./_lib');

const SYSTEM_PROMPT = `너는 한국 증권사 리서치센터의 시니어 매크로 애널리스트다.
금융권 취업을 준비하는 경영학부 학생이 매일 쓴 매크로 결론을, 같은 날 증권사 시황·매크로 리포트와 비교해 피드백한다.

원칙:
1. 리포트 내용은 요약·의역해서 전달하고, 문장을 길게 그대로 옮기지 않는다. 직접 인용은 꼭 필요할 때 15단어 미만으로 한 번만.
2. 리포트에 없는 내용, 학생 결론에 없는 내용을 지어내지 않는다.
3. 숫자는 리포트에 적힌 것만 쓴다.
4. 투자 권유는 하지 않는다.

출력 형식 (한국어, 마크다운, 전체 400단어 이내):
## 리포트 핵심 (3줄)
- 동인 / 해석 / 전망을 각각 한 줄로
## 같은 점
## 다른 점
학생과 리포트가 다르게 본 부분과, 왜 그렇게 갈렸을지(보는 지표·시간 범위·전제의 차이)
## 리포트만의 인사이트
학생 결론에 없던 지표·연결고리·수급·이벤트
## 내가 더 깊게 본 것
학생이 리포트보다 더 구체적이거나 다른 각도로 본 부분. 없으면 "없음"
## 다음에 해볼 것
학생이 다음 점검 때 추가로 확인하면 좋을 것 1~2개
학생 결론이 비어 있으면 "리포트 핵심"만 쓰고 나머지는 "결론을 먼저 써보세요"라고 쓴다.`;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST만 가능합니다' });
  if (!checkPasscode(req, res)) return;

  const key = process.env.GEMINI_API_KEY;
  if (!key) return sendJson(res, 500, { ok: false, error: 'GEMINI_API_KEY가 설정되지 않았습니다.' });

  let body;
  try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { ok: false, error: '요청 형식 오류 (PDF가 너무 크면 핵심 부분을 붙여넣어 주세요)' }); }
  if (!body.pdfBase64 && !(body.reportText || '').trim()) return sendJson(res, 400, { ok: false, error: '리포트 PDF나 내용이 없습니다' });
  if (body.pdfBase64 && body.pdfBase64.length > 4.2 * 1024 * 1024) return sendJson(res, 413, { ok: false, error: 'PDF가 너무 큽니다. 3MB 이하로 올리거나 핵심 부분을 붙여넣어 주세요.' });

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const parts = [];
  if (body.pdfBase64) parts.push({ inlineData: { mimeType: 'application/pdf', data: body.pdfBase64 } });
  parts.push({
    text: `점검 날짜: ${body.date || ''}
리포트: ${body.reportName || '(제목 미입력)'}
${body.reportText ? `\n[리포트 내용 (붙여넣기)]\n${String(body.reportText).slice(0, 20000)}\n` : '\n[리포트는 첨부한 PDF]\n'}
[대시보드 자동 신호]
${body.signalsText || '(없음)'}

[학생이 쓴 결론]
${body.conclusionText || '(비어 있음)'}`,
  });

  try {
    const r = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: 'user', parts }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
        }),
      },
      55000
    );
    const j = await r.json();
    if (!r.ok) return sendJson(res, 502, { ok: false, error: (j.error && j.error.message) || `Gemini 오류 ${r.status}` });
    const out = ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []).map((p) => p.text || '').join('').trim();
    if (!out) return sendJson(res, 502, { ok: false, error: 'AI 응답이 비어 있습니다. 잠시 후 다시 시도하세요.' });
    return sendJson(res, 200, { ok: true, model, text: out });
  } catch (e) {
    return sendJson(res, 502, { ok: false, error: `AI 호출 실패: ${e.message}` });
  }
};
