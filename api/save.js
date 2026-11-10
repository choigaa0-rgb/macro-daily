// 구글 스프레드시트에 기록 저장
// 필요한 환경변수: SHEET_WEBHOOK_URL (Apps Script 웹앱 주소), SHEET_SECRET (Apps Script에 적은 비밀 문자열)

const { sendJson, checkPasscode, fetchWithTimeout, readBody } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST만 가능합니다' });
  if (!checkPasscode(req, res, { allowDemo: false })) return; // 체험용 비밀번호는 저장 불가

  const hook = process.env.SHEET_WEBHOOK_URL;
  if (!hook) return sendJson(res, 500, { ok: false, error: 'SHEET_WEBHOOK_URL이 설정되지 않았습니다. README의 3단계를 참고하세요.' });

  let body;
  try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { ok: false, error: '요청 형식 오류' }); }
  if (!body.record || typeof body.record !== 'object') return sendJson(res, 400, { ok: false, error: '저장할 기록이 없습니다' });

  const sheet = body.sheet === '주간' ? '주간' : '데일리';
  try {
    const r = await fetchWithTimeout(hook, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ secret: process.env.SHEET_SECRET || '', sheet, record: body.record }),
      redirect: 'follow',
    }, 20000);
    const text = await r.text();
    let j;
    try { j = JSON.parse(text); } catch (e) { return sendJson(res, 502, { ok: false, error: 'Apps Script 응답을 읽을 수 없습니다. 웹앱 배포 설정(액세스 권한: 모든 사용자)을 확인하세요.' }); }
    if (!j.ok) return sendJson(res, 502, { ok: false, error: j.error || '시트 저장 실패' });
    return sendJson(res, 200, j);
  } catch (e) {
    return sendJson(res, 502, { ok: false, error: `시트 저장 실패: ${e.message}` });
  }
};
