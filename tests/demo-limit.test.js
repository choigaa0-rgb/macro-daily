// 체험 모드 AI 사용 제한: 무거운 생성은 막고, 가벼운 것은 횟수 제한. 관리자는 제한 없음
const assert = require('assert');
process.env.APP_PASSCODE = 'admin-pass';
delete process.env.DEMO_HEAVY; delete process.env.DEMO_AI;
process.env.DEMO_IP_PER_HOUR = '3';
const L = require('../api/_lib.js');
const req = (headers = {}) => ({ url: '/api/x', headers: Object.assign({ 'x-forwarded-for': '1.2.3.4' }, headers) });
const res = () => { const r = { statusCode: 0, body: null, setHeader() {}, end(x) { r.body = JSON.parse(x); } }; return r; };

let r = res();
assert.strictEqual(L.demoGate(req(), r, 'heavy'), false);
assert.strictEqual(r.statusCode, 403);
for (let i = 0; i < 3; i++) assert.strictEqual(L.demoGate(req(), res(), 'light'), true);
r = res();
assert.strictEqual(L.demoGate(req(), r, 'light'), false);
assert.strictEqual(r.statusCode, 429);
assert.strictEqual(L.demoGate(req({ 'x-forwarded-for': '5.6.7.8' }), res(), 'light'), true); // 다른 사람은 따로 셈
assert.strictEqual(L.demoGate(req({ 'x-app-passcode': 'admin-pass' }), res(), 'heavy'), true); // 관리자는 통과
console.log('ok - 체험 모드 AI 사용 제한');
