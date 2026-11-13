// 증권사 리포트 비교: 리포트(PDF 여러 개 또는 붙여넣은 글)와 내 결론을 Gemini에 보내 비교
// mode: 'extract' → PDF 1개에서 비교용 핵심만 뽑음 (PDF가 많아 한 번에 못 보낼 때 앞 단계로 사용)
// mode: 'close' → 장 마감 복기 (아침 결론을 국내 마감 리포트·실제 종가와 맞춰 봄)
// 필요한 환경변수: GEMINI_API_KEY, GEMINI_MODEL(선택)

const { sendJson, checkPasscode, demoGate, readBody, callGemini } = require('./_lib');

const SYSTEM_PROMPT = `너는 한국 증권사 리서치센터의 시니어 매크로 애널리스트다.
대시보드가 만든 오늘의 매크로 결론(AI 센터장 결론, 사용자 결론이 있으면 함께)을 같은 날 증권사 시황·매크로 리포트와 교차검증한다.
목적은 AI 분석이 틀렸거나 증권사와 다른 부분을 찾아 결론의 정확도를 높이는 것이다.

원칙:
1. 리포트 내용은 요약·의역해서 전달하고, 문장을 길게 그대로 옮기지 않는다. 직접 인용은 꼭 필요할 때 15단어 미만으로 한 번만.
2. 리포트에 없는 내용, 결론에 없는 내용을 지어내지 않는다. 숫자는 리포트나 결론에 적힌 것만 쓴다.
3. 리포트와 결론이 숫자(지수·금리·환율 수준이나 변화)를 다르게 적었으면 반드시 짚는다.
4. 투자 권유·종목 추천은 하지 않는다.

출력 형식 (한국어, 마크다운, 전체 400단어 이내):
## 일치도: 일치 | 부분 일치 | 불일치 중 하나
이유 한 줄
## 리포트 핵심 (3줄)
- 동인 / 해석 / 전망을 각각 한 줄로
## 같은 점
## 다른 점
대시보드 결론과 리포트가 다르게 본 부분과, 왜 갈렸을지(보는 지표·시간 범위·전제 차이)
## 숫자 확인
리포트와 결론의 숫자가 다른 곳. 없으면 "없음"
## 리포트만의 인사이트
결론에 없던 지표·연결고리·수급·이벤트
## 결론 보완 제안
대시보드 결론을 어떻게 고치면 더 정확해지는지 1~2개
결론이 비어 있으면 "리포트 핵심"만 쓰고 나머지는 "비교할 결론이 없습니다"라고 쓴다.

리포트가 2개 이상이면:
- "리포트 핵심"을 리포트(증권사)별로 1~2줄씩 쓴다.
- "## 리포트 간 합의·이견" 섹션을 "다른 점" 앞에 추가해, 증권사들이 함께 본 것과 서로 갈린 것을 짚는다.
- 일치도는 리포트 전체와 비교한 종합 판단으로 쓴다. 전체 분량은 600단어 이내.`;

// 장 마감 복기: 아침 AI 결론(오늘 한국장 전망)을 국내 마감 시황 리포트·실제 종가와 맞춰 봄
const CLOSE_PROMPT = `너는 한국 증권사 리서치센터의 시니어 매크로 애널리스트다.
아침(한국장 시작 전)에 대시보드 AI가 낸 결론과 전망을, 오늘 한국장이 끝난 뒤의 국내 마감 시황 리포트와 실제 종가로 복기한다.
목적은 AI가 한국장을 맞혔는지, 틀렸다면 무엇을 놓쳤는지 찾아 다음 분석을 개선하는 것이다.
아침 결론은 장 시작 전 정보로 쓴 것이므로, 장중에 새로 나온 뉴스를 몰랐던 것은 '놓친 정보'로 구분해 공정하게 평가한다.

원칙:
1. 리포트는 요약·의역한다. 직접 인용은 꼭 필요할 때 15단어 미만으로 한 번만.
2. 리포트·결론·실제 데이터에 없는 내용을 지어내지 않는다. 숫자는 주어진 것만 쓴다.
3. 판단 기준은 아침 결론의 '한국 영향'·'국면'·한국 관련 서술이 오늘 KOSPI·원달러·업종 흐름과 방향이 맞았는지다. 5거래일 전망은 아직 채점 전이므로 '참고'로만 언급한다.
4. 투자 권유·종목 추천은 하지 않는다.

출력 형식 (한국어, 마크다운, 400단어 이내):
## 한국장 판단: 맞음 | 부분 | 틀림 중 하나
이유 한 줄 (예: 아침엔 KOSPI 약세를 봤지만 실제 +2.6%)
## 오늘 한국장 실제 (2~3줄)
리포트 기준 동인·수급·주도 업종
## 아침 결론에서 맞은 것
## 틀린 것·놓친 것
## 왜 갈렸나
데이터 시점(오래된 데이터), 장중 새 뉴스, 수급, 규칙 기반 해석의 한계 등 중에서 근거와 함께
## 다음에 볼 것
비슷한 날 아침에 먼저 확인할 것 1~2개
아침 결론이 비어 있으면 "오늘 한국장 실제"만 쓰고 나머지는 "복기할 아침 결론이 없습니다"라고 쓴다.
리포트가 2개 이상이면 '오늘 한국장 실제'에 리포트 간 차이도 짧게 짚는다.`;

const EXTRACT_PROMPT = `너는 증권사 리포트를 교차검증용으로 정리하는 애널리스트다.
첨부한 시황·매크로 리포트 1개에서 다음만 한국어로 뽑는다. 문장을 그대로 옮기지 말고 요약·의역한다. 리포트에 없는 내용은 쓰지 않는다.
- 증권사·리포트 제목 (알 수 있으면)
- 오늘 시장의 동인 (1~2줄)
- 해석·국면 판단 (1~2줄)
- 전망·대응 (1~2줄)
- 리포트에 나온 핵심 숫자 (지수·금리·환율·수급 등, 최대 8개, "항목 값" 형식)
전체 200단어 이내.`;

const MAX_B64 = 4.2 * 1024 * 1024;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST만 가능합니다' });
  if (!checkPasscode(req, res)) return;
  if (!demoGate(req, res, 'light')) return;

  let body;
  try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { ok: false, error: '요청 형식 오류 (PDF가 너무 크면 핵심 부분을 붙여넣어 주세요)' }); }
  const pdfs = (Array.isArray(body.pdfs) ? body.pdfs : body.pdfBase64 ? [{ name: '', data: body.pdfBase64 }] : [])
    .filter((p) => p && typeof p.data === 'string' && p.data).slice(0, 5);
  const total = pdfs.reduce((a, p) => a + p.data.length, 0);
  if (total > MAX_B64) return sendJson(res, 413, { ok: false, error: 'PDF 용량이 너무 큽니다. 한 번에 합쳐 3MB 이하로 올리거나 핵심 부분을 붙여넣어 주세요.' });

  if (body.mode === 'extract') {
    if (pdfs.length !== 1) return sendJson(res, 400, { ok: false, error: '정리할 PDF 1개가 필요합니다' });
    const r = await callGemini({ system: EXTRACT_PROMPT, parts: [{ inlineData: { mimeType: 'application/pdf', data: pdfs[0].data } }, { text: `파일 이름: ${pdfs[0].name || '(없음)'}` }], temperature: 0.2 });
    if (!r.ok) return sendJson(res, r.status, { ok: false, error: r.error });
    return sendJson(res, 200, { ok: true, model: r.model, text: r.text });
  }

  if (!pdfs.length && !(body.reportText || '').trim()) return sendJson(res, 400, { ok: false, error: '리포트 PDF나 내용이 없습니다' });

  const parts = [];
  pdfs.forEach((p, i) => {
    parts.push({ text: `[첨부 리포트 ${i + 1}${p.name ? ` · ${p.name}` : ''}]` });
    parts.push({ inlineData: { mimeType: 'application/pdf', data: p.data } });
  });
  const where = [pdfs.length && `첨부한 PDF ${pdfs.length}개`, body.reportText && '아래 붙여넣은 내용'].filter(Boolean).join(' + ');
  parts.push({
    text: `점검 날짜: ${body.date || ''}
리포트: ${body.reportName || '(제목 미입력)'} (${where})
${body.reportText ? `\n[리포트 내용 (붙여넣기·요약)]\n${String(body.reportText).slice(0, 20000)}\n` : ''}
[대시보드 자동 신호]
${body.signalsText || '(없음)'}

[${body.mode === 'close' ? '아침 대시보드 결론 (장 시작 전 작성)' : '대시보드 결론'}]
${body.conclusionText || '(비어 있음)'}`,
  });

  const close = body.mode === 'close';
  if (close && body.actualText) parts.push({ text: `\n[실제 데이터 (대시보드 수집, 날짜는 종가 기준일)]\n${String(body.actualText).slice(0, 2000)}` });
  const r = await callGemini({ system: close ? CLOSE_PROMPT : SYSTEM_PROMPT, parts, temperature: 0.3 });
  if (!r.ok) return sendJson(res, r.status, { ok: false, error: r.error });
  return sendJson(res, 200, { ok: true, model: r.model, text: r.text });
};
