// 진단용: 내 Gemini 키로 쓸 수 있는 모델 목록과, 자동으로 고른 가벼운 모델 확인
// 주소: /api/models?pass=앱비밀번호   (APP_PASSCODE를 설정했을 때)

const { sendJson, listModels, pickLight } = require('./_lib');

module.exports = async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const expected = process.env.APP_PASSCODE;
  const given = req.headers['x-app-passcode'] || url.searchParams.get('pass');
  if (expected && given !== expected) return sendJson(res, 401, { ok: false, error: '주소 끝에 ?pass=앱비밀번호 를 붙여주세요.' });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return sendJson(res, 500, { ok: false, error: 'GEMINI_API_KEY가 설정되지 않았습니다.' });
  try {
    const names = await listModels(key);
    const primary = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
    sendJson(res, 200, {
      ok: true,
      기본모델: primary,
      기본모델_목록에_있음: names.includes(primary),
      자동선택_가벼운모델: process.env.GEMINI_FALLBACK_MODEL || pickLight(names, primary),
      flash_계열: names.filter((n) => /flash/.test(n)),
      전체: names,
    });
  } catch (e) {
    sendJson(res, 502, { ok: false, error: e.message });
  }
};
