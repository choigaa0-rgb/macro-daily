// 공통 도우미: 비밀번호 확인, JSON 응답, 시간 제한이 있는 fetch
// 파일 이름이 _ 로 시작하면 Vercel이 API 주소로 만들지 않습니다.

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

// APP_PASSCODE 환경변수가 설정돼 있으면, 요청 헤더의 비밀번호와 같아야 통과
function checkPasscode(req, res) {
  const expected = process.env.APP_PASSCODE;
  if (!expected) return true; // 비밀번호를 설정하지 않았으면 누구나 사용 가능
  const given = req.headers['x-app-passcode'];
  if (given && given === expected) return true;
  sendJson(res, 401, { ok: false, error: '비밀번호가 맞지 않습니다. 화면 오른쪽 위 설정에서 비밀번호를 입력하세요.' });
  return false;
}

async function fetchWithTimeout(url, options = {}, ms = 9000) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(ms) });
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

// Gemini 호출: 사용량 몰림(429/503)이면 잠시 쉬었다가 다시 시도하고,
// 그래도 안 되면 GEMINI_FALLBACK_MODEL(설정했을 때)로 한 번 더 시도합니다.
// Vercel 함수 제한(60초) 안에 끝나도록 시도마다 시간을 나눠 씁니다.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callGemini({ system, parts, temperature = 0.4, maxOutputTokens = 2048 }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, status: 500, error: 'GEMINI_API_KEY가 설정되지 않았습니다.' };
  const primary = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  const fallback = process.env.GEMINI_FALLBACK_MODEL;
  const plan = [
    { model: primary, wait: 0 },
    { model: primary, wait: 2500 },
    { model: fallback || primary, wait: 5000 },
  ];
  const started = Date.now();
  let lastErr = '';
  for (const step of plan) {
    if (step.wait) await sleep(step.wait);
    const left = 55000 - (Date.now() - started);
    if (left < 8000) break;
    try {
      const r = await fetchWithTimeout(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(step.model)}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts }],
            generationConfig: { temperature, maxOutputTokens },
          }),
        },
        Math.min(left - 2000, 40000)
      );
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        const out = ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []).map((p) => p.text || '').join('').trim();
        if (out) return { ok: true, model: step.model, text: out };
        lastErr = 'AI 응답이 비어 있습니다.';
        continue;
      }
      lastErr = (j.error && j.error.message) || `Gemini 오류 ${r.status}`;
      if (r.status !== 429 && r.status !== 503 && r.status !== 500) return { ok: false, status: 502, error: lastErr };
    } catch (e) {
      lastErr = e.message;
    }
  }
  const busy = /high demand|overloaded|unavailable|429|503|quota|rate/i.test(lastErr);
  return {
    ok: false,
    status: 503,
    error: busy
      ? 'Gemini에 사용자가 몰려 여러 번 시도했지만 응답을 받지 못했습니다. 몇 분 뒤 다시 눌러주세요. (자주 그러면 README의 GEMINI_FALLBACK_MODEL 설정 참고)'
      : `AI 호출 실패: ${lastErr}`,
  };
}

module.exports = { sendJson, checkPasscode, fetchWithTimeout, readBody, callGemini };
