// 증권사 리포트 목록 파싱 테스트 (네이버 리서치 HTML 모양): node tests/reports.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseNaverReports } = require('../api/_data.js');
const realNow = Date.now; Date.now = () => Date.parse('2026-11-10T03:00:00Z');
const r = parseNaverReports(fs.readFileSync(path.join(__dirname, 'fixtures/naver-research.html'), 'utf8'));
Date.now = realNow;
assert.deepStrictEqual(r.map((x) => [x.date, x.broker, x.title]), [['2026-11-09', '키움증권', 'HBM4로 열리는 새 사이클'], ['2026-10-31', '모건스탠리', '3Q26 Review: 목표주가 하향']], '60일 넘은 리포트는 제외');
assert.ok(r[0].pdf.endsWith('.pdf'));
assert.strictEqual(r[0].link, 'https://finance.naver.com/research/company_read.naver?nid=88123');
console.log('ok - 증권사 리포트: 제목·증권사·날짜·PDF, 60일 지난 것 제외');
