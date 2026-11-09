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

// ---------- Gemini ----------
// 흐름
// 1) 기본 모델(GEMINI_MODEL, 기본 gemini-3.8-flash)에 최대 약 28초까지 기다림
// 2) 느리거나(시간 초과) 사용자가 몰려 거절되면, 남은 시간 동안 '가벼운 모델'로 다시 시도
//    가벼운 모델은 GEMINI_FALLBACK_MODEL이 있으면 그것, 없으면 Gemini 모델 목록에서 이름에 flash-lite가 들어간 최신 모델을 자동 선택
// 3) 생각(thinking) 단계는 짧게 요청 (GEMINI_THINKING, 기본 low). 모델이 이 설정을 모르면 빼고 바로 다시 보냄
// Vercel 함수 제한(60초) 안에 끝나도록 남은 시간을 계산해서 씁니다.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
let modelCache = null; // { at, names }

async function listModels(key) {
  if (modelCache && Date.now() - modelCache.at < 6 * 3600 * 1000) return modelCache.names;
  const r = await fetchWithTimeout(`${GEMINI}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } }, 6000);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || `모델 목록 오류 ${r.status}`);
  const names = (j.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => String(m.name || '').replace(/^models\//, ''))
    .filter(Boolean);
  modelCache = { at: Date.now(), names };
  return names;
}

// 이름 속 버전 숫자로 정렬 (gemini-3.8-flash-lite > gemini-3-flash-lite)
function version(name) {
  const m = /gemini-(\d+(?:\.\d+)?)/.exec(name);
  return m ? Number(m[1]) : 0;
}
function pickLight(names, primary) {
  const ok = names.filter((n) => n !== primary && /flash-lite/.test(n) && !/(tts|image|audio|live|embedding)/.test(n));
  const stable = ok.filter((n) => !/(preview|exp)/.test(n));
  const pool = stable.length ? stable : ok;
  pool.sort((a, b) => version(b) - version(a) || a.length - b.length);
  return pool[0] || null;
}

async function requestOnce({ key, model, system, parts, temperature, maxOutputTokens, thinking, timeoutMs }) {
  const generationConfig = { temperature, maxOutputTokens };
  if (thinking) generationConfig.thinkingConfig = { thinkingLevel: thinking };
  const r = await fetchWithTimeout(
    `${GEMINI}/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts }], generationConfig }),
    },
    timeoutMs
  );
  const j = await r.json().catch(() => ({}));
  if (r.ok) {
    const out = ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [])
      .filter((p) => !p.thought).map((p) => p.text || '').join('').trim();
    return out ? { ok: true, text: out } : { ok: false, status: 200, error: 'AI 응답이 비어 있습니다.' };
  }
  return { ok: false, status: r.status, error: (j.error && j.error.message) || `Gemini 오류 ${r.status}` };
}

async function callGemini({ system, parts, temperature = 0.4, maxOutputTokens = 2048 }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, status: 500, error: 'GEMINI_API_KEY가 설정되지 않았습니다.' };
  const primary = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  const thinkingSetting = process.env.GEMINI_THINKING || 'low';
  let thinking = thinkingSetting === 'off' ? null : thinkingSetting;
  const started = Date.now();
  const left = () => 56000 - (Date.now() - started);
  const tried = [];
  let lastErr = '';

  // 가벼운 모델 이름은 기본 모델 요청과 동시에 미리 찾아둠
  const lightPromise = process.env.GEMINI_FALLBACK_MODEL
    ? Promise.resolve(process.env.GEMINI_FALLBACK_MODEL)
    : listModels(key).then((n) => pickLight(n, primary)).catch(() => null);

  const attempt = async (model, timeoutMs) => {
    tried.push(model);
    try {
      let r = await requestOnce({ key, model, system, parts, temperature, maxOutputTokens, thinking, timeoutMs });
      if (!r.ok && r.status === 400 && thinking && /think/i.test(r.error)) {
        thinking = null; // 이 모델은 thinking 설정을 모름 → 빼고 다시
        r = await requestOnce({ key, model, system, parts, temperature, maxOutputTokens, thinking, timeoutMs: Math.max(left() - 1500, 3000) });
      }
      return r;
    } catch (e) {
      return { ok: false, status: /abort|timeout/i.test(e.message) ? 504 : 502, error: e.message };
    }
  };

  // 1) 기본 모델
  let r = await attempt(primary, 28000);
  if (r.ok) return { ok: true, model: primary, text: r.text };
  lastErr = r.error;
  const retryable = (x) => x.status === 504 || x.status === 429 || x.status === 503 || x.status === 500 || x.status === 200;
  if (!retryable(r)) return { ok: false, status: 502, error: r.error };

  // 2) 사용자 몰림이면 잠깐 쉬고 기본 모델 한 번 더 (시간이 충분할 때만)
  if ((r.status === 429 || r.status === 503) && left() > 40000) {
    await sleep(2000);
    r = await attempt(primary, Math.min(left() - 22000, 20000));
    if (r.ok) return { ok: true, model: primary, text: r.text };
    lastErr = r.error;
  }

  // 3) 가벼운 모델로 남은 시간 동안
  const light = await lightPromise;
  if (light && left() > 5000) {
    r = await attempt(light, left() - 1500);
    if (r.ok) return { ok: true, model: light, text: r.text };
    lastErr = r.error;
  }

  const tryList = tried.join(' → ');
  if (/abort|timeout/i.test(lastErr)) {
    return { ok: false, status: 504, error: `AI가 시간 안에 답하지 못했습니다 (시도: ${tryList}). 잠시 뒤 다시 눌러주세요.` };
  }
  if (/high demand|overloaded|unavailable|429|503|quota|rate/i.test(lastErr)) {
    return { ok: false, status: 503, error: `Gemini에 사용자가 몰려 응답을 받지 못했습니다 (시도: ${tryList}). 몇 분 뒤 다시 눌러주세요.` };
  }
  return { ok: false, status: 502, error: `AI 호출 실패 (시도: ${tryList}): ${lastErr}` };
}

module.exports = { sendJson, checkPasscode, fetchWithTimeout, readBody, callGemini, listModels, pickLight };
