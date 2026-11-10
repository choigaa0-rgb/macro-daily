// 구글 스프레드시트에서 최근 기록 불러오기 (읽기 전용이라 비밀번호 없이 열람 가능)
// 주소: /api/history?sheet=데일리&limit=30

const { sendJson, fetchWithTimeout } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: '읽기 전용입니다.' });
  const hook = process.env.SHEET_WEBHOOK_URL;
  if (!hook) return sendJson(res, 500, { ok: false, error: 'SHEET_WEBHOOK_URL이 설정되지 않았습니다.' });

  const url = new URL(req.url, 'http://x');
  const asked = url.searchParams.get('sheet');
  const sheet = ['주간', '자동 브리핑', '산업 이슈', '기업 분석'].includes(asked) ? asked : '데일리';
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '30', 10) || 30, 1), 200);

  const target = new URL(hook);
  target.searchParams.set('secret', process.env.SHEET_SECRET || '');
  target.searchParams.set('sheet', sheet);
  target.searchParams.set('limit', String(limit));

  try {
    const r = await fetchWithTimeout(target.toString(), { redirect: 'follow' }, 20000);
    const text = await r.text();
    let j;
    try { j = JSON.parse(text); } catch (e) { return sendJson(res, 502, { ok: false, error: 'Apps Script 응답을 읽을 수 없습니다.' }); }
    return sendJson(res, j.ok ? 200 : 502, j);
  } catch (e) {
    return sendJson(res, 502, { ok: false, error: `기록 불러오기 실패: ${e.message}` });
  }
};
