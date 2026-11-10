// 산업 이슈·오늘의 기업 흐름 테스트 (가짜 RSS·Yahoo·DART·SEC·Gemini·시트): node tests/research.test.js [출력폴더]
const assert = require('assert');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
Object.assign(process.env, { GEMINI_API_KEY: 'g', APP_PASSCODE: 'pw', SHEET_WEBHOOK_URL: 'https://sheet.test/exec', SHEET_SECRET: 's', DART_API_KEY: 'd', SEC_CONTACT_EMAIL: 'me@example.com' });

const now = new Date().toUTCString();
const RSS = `<rss><channel>
<item><title><![CDATA[삼성전자, HBM4 엔비디아 공급 확대]]></title><link>https://n.test/1</link><description>삼성전자가 HBM4 공급을 늘린다</description><pubDate>${now}</pubDate></item>
<item><title>현대차, 美 관세 영향에 3분기 이익 감소</title><link>https://n.test/2</link><pubDate>${now}</pubDate></item>
<item><title>엔비디아 실적 기대에 반도체 강세</title><link>https://n.test/3</link><pubDate>${now}</pubDate></item>
<item><title>한화오션 대규모 LNG선 수주</title><link>https://n.test/4</link><pubDate>${now}</pubDate></item>
</channel></rss>`;

function makeZip(content) {
  const comp = zlib.deflateRawSync(Buffer.from(content)); const name = Buffer.from('CORPCODE.xml');
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(comp.length, 18); lh.writeUInt16LE(name.length, 26);
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(comp.length, 20); cd.writeUInt16LE(name.length, 28);
  const eo = Buffer.alloc(22); eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt32LE(lh.length + name.length + comp.length, 16);
  return Buffer.concat([lh, name, comp, cd, name, eo]);
}
const ZIP = makeZip('<result>' + ['00126380|삼성전자|005930', '00164742|현대자동차|005380', '01390344|한화오션|042660'].map((x) => { const [c, n, s] = x.split('|'); return `<list><corp_code>${c}</corp_code><corp_name>${n}</corp_name><corp_eng_name>E</corp_eng_name><stock_code>${s}</stock_code><modify_date>x</modify_date></list>`; }).join('') + '</result>');

function chart(sym) {
  const n = 250, ts = [], close = [], volume = [];
  const base = sym === '005930.KS' ? 70000 : 100;
  for (let i = 0; i < n; i++) {
    ts.push(Math.floor(Date.now() / 1000) - (n - i) * 86400);
    let c = base * (1 + 0.001 * Math.sin(i));
    if (i === n - 1 && sym === '005930.KS') c = base * 1.06; // 삼성전자 마지막 날 급등
    close.push(c); volume.push(i === n - 1 && sym === '005930.KS' ? 5e7 : 1e7);
  }
  return { chart: { result: [{ meta: { gmtoffset: 32400, currency: sym.includes('.K') ? 'KRW' : 'USD' }, timestamp: ts, indicators: { quote: [{ close, volume }] } }] } };
}
const DART_FIN = { status: '000', list: [
  { fs_div: 'CFS', account_nm: '매출액', thstrm_amount: '300,000,000,000,000', frmtrm_amount: '260,000,000,000,000', thstrm_add_amount: '230,000,000,000,000', frmtrm_add_amount: '200,000,000,000,000' },
  { fs_div: 'CFS', account_nm: '영업이익', thstrm_amount: '35,000,000,000,000', frmtrm_amount: '6,500,000,000,000', thstrm_add_amount: '30,000,000,000,000', frmtrm_add_amount: '25,000,000,000,000' },
  { fs_div: 'CFS', account_nm: '당기순이익', thstrm_amount: '34,000,000,000,000', frmtrm_amount: '15,000,000,000,000' },
  { fs_div: 'CFS', account_nm: '자본총계', thstrm_amount: '400,000,000,000,000' },
] };
let geminiMode = 'industry';
const posted = [];
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const json = (j, status = 200) => ({ ok: status < 400, status, json: async () => j, text: async () => JSON.stringify(j), arrayBuffer: async () => new ArrayBuffer(0) });
  if (/yna|mk\.co|businesspost/.test(u)) return { ok: true, status: 200, text: async () => RSS };
  if (u.includes('finance.yahoo.com')) return json(chart(decodeURIComponent(u.split('/chart/')[1].split('?')[0])));
  if (u.includes('corpCode.xml')) return { ok: true, status: 200, arrayBuffer: async () => ZIP.buffer.slice(ZIP.byteOffset, ZIP.byteOffset + ZIP.length) };
  if (u.includes('fnlttSinglAcnt')) return json(DART_FIN);
  if (u.includes('stockTotqySttus')) return json({ status: '000', list: [{ se: '보통주', distb_stock_co: '5,900,000,000' }] });
  if (u.includes('/list.json')) return json({ status: '000', list: [{ rcept_dt: '20261105', report_nm: '분기보고서 (2026.09)', rcept_no: '20261105000001' }] });
  if (u.includes('company.json')) return json({ status: '000', corp_name: '삼성전자', ceo_nm: '대표이사' });
  if (u.includes('sec.gov/files/company_tickers')) return json({ 0: { cik_str: 1045810, ticker: 'NVDA', title: 'NVIDIA CORP' } });
  if (u.includes('companyconcept')) {
    if (!opts.headers || !/me@example.com/.test(opts.headers['User-Agent'])) throw new Error('SEC 연락처 없음');
    if (u.includes('Revenues.json')) return json({}, 404);
    return json({ units: { USD: [{ frame: 'CY2024', val: 60e9, form: '10-K', end: '2025-01-26' }, { frame: 'CY2025', val: 130e9, form: '10-K', end: '2026-01-25' }], shares: [{ end: '2026-08-20', val: 24.3e9 }] } });
  }
  if (u.includes('data.sec.gov/submissions')) return json({ filings: { recent: { form: ['8-K'], filingDate: [new Date().toISOString().slice(0, 10)], primaryDocDescription: ['Earnings'], accessionNumber: ['0001045810-26-000001'], primaryDocument: ['a.htm'] } } });
  if (u.includes('generativelanguage')) {
    const out = geminiMode === 'industry'
      ? { headline: '반도체 강세, 자동차 관세 부담', issues: [
        { sector: 'IT', industry: '반도체', region: '공통', kospi_sector: '전기전자', title: 'HBM 공급 확대', summary: 's', why: 'w', impact: '긍정', macro_link: '복사된 문장', companies: ['삼성전자', 'SK하이닉스'], sources: [1, 3] },
        { sector: '경기소비재', industry: '자동차', region: '이상한값', kospi_sector: '운송장비·부품', title: '관세 영향', summary: 's', why: 'w', impact: '부정', macro_link: '복사된 문장', companies: ['현대차'], sources: [2] },
        { industry: '가짜', title: '근거 없음', summary: 's', why: 'w', impact: '중립', companies: [], sources: [99] }] }
      : { one_liner: '메모리 반도체 1위', why_today: '1일 6% 상승, 거래량 5배', business: 'b', segments: ['메모리'], competitors: ['SK하이닉스'],
        results: '2025 매출 300조원, 영업이익 증가율 438.5%', valuation: 'PER 12.1배, PBR 1.0배 수준이며 영업이익률 25%', macro_link: '', bull: ['HBM'], bear: ['가격'], kill_scenario: 'k', checkpoints: ['실적'] };
    return json({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] });
  }
  if (u.startsWith('https://sheet.test')) {
    if (opts.method === 'POST') { posted.push(JSON.parse(opts.body)); return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, row: 2 }) }; }
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, rows: [] }) };
  }
  throw new Error('unexpected ' + u);
};

function call(handler, url, method = 'GET', body) {
  return new Promise((resolve) => {
    const req = { url, method, headers: { 'x-app-passcode': 'pw', host: 'x.test' }, body };
    const res = { statusCode: 200, setHeader() {}, end(b) { resolve({ status: this.statusCode, body: JSON.parse(b) }); } };
    handler(req, res);
  });
}

(async () => {
  const outDir = process.argv[2] || '/tmp';
  const industry = require('../api/industry.js');
  let r = await call(industry, '/api/industry?part=1');
  assert.ok(r.body.ok, JSON.stringify(r.body));
  const iss = r.body.data.issues;
  assert.strictEqual(iss.length, 2, '근거 기사 없는 이슈는 빠져야 함');
  assert.strictEqual(iss[0].check, '관련 기업 일부 기사에 없음'); // SK하이닉스는 기사에 없음
  assert.strictEqual(iss[1].check, '근거 확인');
  assert.deepStrictEqual([iss[0].sector, iss[0].region, iss[0].kospi_sector], ['기술', '공통', '전기·전자'], '목록 밖 태그는 목록 안으로 맞춤');
  assert.deepStrictEqual([iss[1].sector, iss[1].region], ['경기소비재', '국내']);
  assert.strictEqual(iss[0].macro_link, '', '여러 이슈에 같은 매크로 문장을 붙이면 비움');
  const { fixTags } = require('../api/industry.js');
  assert.strictEqual(fixTags({ sector: '기술', industry: '전력', region: '국내' }, []).sector, '유틸리티', '세부 산업이 전력이면 유틸리티');
  assert.strictEqual(fixTags({ sector: '산업재', industry: '항공·해운', region: '국내' }, []).sector, '산업재');
  assert.ok(posted.find((p) => p.sheet === '산업 이슈'));
  fs.writeFileSync(path.join(outDir, 'industry-mail.html'), r.body.mailHtml);
  console.log('ok - 산업 이슈: 근거 없는 이슈 제거, 관련 기업 대조, 시트 저장');

  geminiMode = 'company';
  const company = require('../api/company.js');
  r = await call(company, '/api/company?rank=1');
  assert.ok(r.body.ok);
  assert.strictEqual(r.body.pick.ticker, '005930.KS', '급등·거래량·뉴스로 삼성전자가 1위여야 함');
  assert.ok(r.body.rank.length <= 20);
  console.log('ok - 주목도 1위:', r.body.pick.name, r.body.pick.score);

  r = await call(company, '/api/company?part=1', 'POST', {});
  assert.ok(r.body.ok, JSON.stringify(r.body));
  const c = r.body.result;
  assert.strictEqual(c.data.source, 'DART');
  const m = (label) => c.data.metrics.find((x) => x.label.includes(label));
  assert.strictEqual(m('매출 증가율').value, '15.4%');
  assert.ok(m('PER').value.endsWith('배'));
  assert.ok(c.verify.total >= 4);
  assert.ok(c.verify.bad.includes('25%'), '데이터에 없는 영업이익률 25%는 확인 필요로 잡혀야 함 (실제 11.7%)');
  fs.writeFileSync(path.join(outDir, 'company-result.json'), JSON.stringify(c, null, 2));
  console.log('ok - 기업 카드(DART):', c.data.metrics.map((x) => `${x.label} ${x.value}`).slice(0, 6).join(' / '), '| 확인 필요:', c.verify.bad.join(', '));

  r = await call(company, '/api/company', 'POST', { ticker: 'NVDA' });
  assert.ok(r.body.ok, JSON.stringify(r.body));
  assert.strictEqual(r.body.result.data.source, 'SEC');
  assert.ok(r.body.result.data.metrics.find((x) => x.label.includes('매출 증가율')).value === '116.7%');
  console.log('ok - 기업 카드(SEC, 직접 선택): NVDA 매출 증가율', r.body.result.data.metrics.find((x) => x.label.includes('매출 증가율')).value);
})().catch((e) => { console.error(e); process.exit(1); });
