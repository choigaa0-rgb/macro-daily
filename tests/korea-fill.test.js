// 한국 지수 지연 보완: Yahoo meta(최근 종가)로 빠진 마지막 장을 채움. 장중 가격은 붙이지 않음
const assert = require('assert');
const { fillFromMeta } = require('../api/market.js');
const pts = [{ date: '2026-11-10', value: 5239.13 }, { date: '2026-11-11', value: 5375.36 }];
const KST = 9 * 3600;
// 11/12 15:30 장 마감 종가, 지금은 장 끝난 뒤
const sec = (iso) => Date.parse(iso) / 1000;
const closedMeta = { gmtoffset: KST, regularMarketTime: sec('2026-11-12T06:30:00Z'), regularMarketPrice: 5331.32, currentTradingPeriod: { regular: { end: sec('2026-11-12T06:30:00Z') } } };
const out = fillFromMeta(pts, closedMeta);
assert.strictEqual(out.length, 3);
assert.deepStrictEqual(out[2], { date: '2026-11-12', value: 5331.32 });
// 이미 들어와 있으면 그대로
assert.strictEqual(fillFromMeta(out, closedMeta).length, 3);
// 장중(거래 시간 끝이 아직 미래)이면 붙이지 않음
const now = Date.now() / 1000;
const liveMeta = { gmtoffset: KST, regularMarketTime: now - 60, regularMarketPrice: 5400, currentTradingPeriod: { regular: { end: now + 3600 } } };
const p2 = [{ date: '2000-01-01', value: 1 }];
assert.strictEqual(fillFromMeta(p2, liveMeta).length, 1);
console.log('ok - 한국 지수 지연 보완 (Yahoo meta)');
