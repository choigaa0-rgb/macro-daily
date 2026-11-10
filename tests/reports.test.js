// 증권사 리포트 (네이버 리서치 API 응답 모양) 테스트: node tests/reports.test.js
const assert = require('assert');
const { parseNaverResearch, reportSummary } = require('../api/_data.js');
const realNow = Date.now; Date.now = () => Date.parse('2026-11-10T03:00:00Z');
const json = { hasNext: true, totalCount: '233', items: [
  { nid: '97937', title: '핵심은 수익성', brokerName: 'SK증권', writeDate: '2026-11-10', itemCode: '240810', itemName: '원익IPS', goalPrice: '120000', opinion: '매수' },
  { nid: '97500', title: '3Q26 Review 사상 최대 실적', brokerName: '교보증권', writeDate: '2026-10-30', itemCode: '005930', itemName: '삼성전자', goalPrice: '500000', opinion: 'Buy' },
  { nid: '97499', title: '2027년 영업이익 전망 상향', brokerName: '하나증권', writeDate: '2026-10-30', itemCode: '005930', itemName: '삼성전자', goalPrice: '480,000', opinion: 'Buy' },
  { nid: '90000', title: '옛날 리포트', brokerName: 'A증권', writeDate: '2026-06-01', itemCode: '005930', goalPrice: '300000' },
] };
const r = parseNaverResearch(json, '005930');
Date.now = realNow;
assert.deepStrictEqual(r.map((x) => [x.broker, x.goal, x.opinion]), [['교보증권', 500000, 'Buy'], ['하나증권', 480000, 'Buy']], '다른 종목·90일 지난 리포트 제외');
assert.strictEqual(r[0].link, 'https://stock.naver.com/research/company/97500');
const s = reportSummary(r, 200000);
assert.deepStrictEqual([s.min, s.max, s.median, s.gap, s.opinions.Buy], [480000, 500000, 490000, 145, 2]);
console.log('ok - 증권사 리포트: 같은 종목만, 목표주가 범위·중간값·현재가 대비, 투자의견 개수');
