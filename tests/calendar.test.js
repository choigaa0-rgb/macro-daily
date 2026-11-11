// 주요 일정: 한국시간 변환(미국 서머타임 포함)과 '최근 발표' 선별
const assert = require('assert');
const K = require('../calendar.js');
const f = (t, d) => K.all().find((e) => e.type === t && e.localDate === d);
assert.deepStrictEqual([f('CPI', '2026-12-10').kstDate, f('CPI', '2026-12-10').kstTime], ['2026-12-10', '22:30']); // 겨울: ET+14h
assert.deepStrictEqual([f('CPI', '2027-06-10').kstDate, f('CPI', '2027-06-10').kstTime], ['2027-06-10', '21:30']); // 서머타임: ET+13h
assert.deepStrictEqual([f('FOMC', '2026-12-09').kstDate, f('FOMC', '2026-12-09').kstTime], ['2026-12-10', '04:00']); // 한국은 다음 날 새벽
assert.ok(f('FOMC', '2026-12-09').name.includes('점도표'));
assert.strictEqual(f('BOK', '2026-11-26').kstTime, '오전');
// 12/11 아침(한국): 전날 밤 CPI와 새벽 FOMC가 '최근 발표'
assert.deepStrictEqual(K.recent(Date.parse('2026-12-10T22:30:00Z')).map((e) => e.type).sort(), ['CPI', 'FOMC']);
// 정렬 · 모든 일정에 영향 지도
const all = K.all();
assert.ok(all.every((e, i) => i === 0 || all[i - 1].utc <= e.utc));
assert.ok(all.every((e) => e.impact && e.impact.hot && e.impact.cool && e.impact.watch));
console.log('ok - 주요 일정: 한국시간 변환(서머타임)·최근 발표·영향 지도');
