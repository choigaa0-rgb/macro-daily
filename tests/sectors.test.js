// 섹터 등락 테스트 (가짜 Yahoo·KRX): node tests/sectors.test.js
const assert = require('assert');
process.env.KRX_API_KEY = 'k';
const { isSector } = require('../api/sectors.js');
['코스피', '코스피 200', '코스피 100', '코스피 200 정보기술', '대형주', '중형주', '소형주', 'KRX 300', '코스피 고배당 50'].forEach((n) => assert.strictEqual(isSector(n), false, n));
['전기·전자', '금융', '증권', '운송장비·부품', 'IT 서비스', '음식료·담배', '건설'].forEach((n) => assert.strictEqual(isSector(n), true, n));
console.log('ok - 대표지수·규모별 지수 빼고 업종만 남김');

const day = (d) => ({ OutBlock_1: [
  { BAS_DD: d, IDX_NM: '코스피', CLSPRC_IDX: '3,955.20', FLUC_RT: '-1.48' },
  { BAS_DD: d, IDX_NM: '코스피 200', CLSPRC_IDX: '520.1', FLUC_RT: '-1.6' },
  { BAS_DD: d, IDX_NM: '대형주', CLSPRC_IDX: '3,900', FLUC_RT: '-1.5' },
  { BAS_DD: d, IDX_NM: '전기·전자', CLSPRC_IDX: d === '20261106' ? '1,100' : '1,000', FLUC_RT: '-2.41' },
  { BAS_DD: d, IDX_NM: '증권', CLSPRC_IDX: '2,050', FLUC_RT: '2.05' },
] });
const seen = [];
global.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('kospi_dd_trd')) {
    assert.strictEqual(opts.headers.AUTH_KEY, 'k');
    const d = u.split('basDd=')[1]; seen.push(d);
    const body = ['20261106', '20261030'].includes(d) ? day(d) : { OutBlock_1: [] }; // 주말·미게시일은 빈 목록
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  }
  if (u.includes('finance.yahoo.com')) {
    const n = 25, ts = [], close = [];
    for (let i = 0; i < n; i++) { ts.push(1760000000 + i * 86400); close.push(100 + i); }
    return { ok: true, status: 200, json: async () => ({ chart: { result: [{ meta: { gmtoffset: 0 }, timestamp: ts, indicators: { quote: [{ close, volume: close }] } }] } }) };
  }
  throw new Error('unexpected ' + u);
};
const handler = require('../api/sectors.js');
const realNow = Date.now; Date.now = () => Date.parse('2026-11-09T00:00:00Z'); // 한국 11/9(월) 아침
const res = { statusCode: 200, setHeader() {}, end(b) {
  Date.now = realNow;
  const j = JSON.parse(b);
  assert.ok(j.us.ok); assert.strictEqual(j.us.rows.length, 11);
  const xlb = j.us.rows.find((r) => r.etf === 'XLB');
  assert.strictEqual(xlb.d1, Math.round((124 / 123 - 1) * 10000) / 100);
  assert.strictEqual(xlb.w1, Math.round((124 / 119 - 1) * 10000) / 100);
  assert.ok(j.kr.ok, JSON.stringify(j.kr));
  assert.strictEqual(j.kr.date, '2026-11-06', '11/9 미게시·주말을 건너뛰고 11/6 사용');
  assert.strictEqual(j.kr.weekBase, '2026-10-30');
  assert.deepStrictEqual(j.kr.rows.map((r) => r.name), ['전기·전자', '증권']);
  assert.strictEqual(j.kr.rows[0].w1, 10);
  console.log('ok - 미국 섹터 ETF 1일·1주, 한국 업종 최신 거래일·1주 전 대비:', j.kr.rows.map((r) => `${r.name} ${r.d1}% / 1주 ${r.w1}%`).join(', '));
} };
handler({ url: '/api/sectors', headers: {} }, res);
