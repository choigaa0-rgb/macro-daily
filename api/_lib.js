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

module.exports = { sendJson, checkPasscode, fetchWithTimeout, readBody };
