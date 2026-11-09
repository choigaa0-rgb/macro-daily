// 로컬 테스트용 서버 (배포에는 쓰이지 않음)
// 실행: node tests/dev-server.js  →  http://localhost:3000
// - /api/* 는 api 폴더의 함수를 그대로 실행
// - SHEET_WEBHOOK_URL이 없으면 메모리 속 가짜 시트(/__fakesheet)를 대신 씁니다.

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 3000;
const fake = { 데일리: [], 주간: [] };
if (process.env.SEED) {
  const pts = require('../api/_mock.js').items.kospi.pts.map((p) => p[0]);
  const at = (k) => pts[pts.length - k];
  const calls = ['상승', '하락', '보합'];
  for (let k = 40; k >= 3; k -= 3) {
    fake.데일리.push({ 날짜: at(k), '작성 방식': k % 2 ? 'AI 브리핑' : '직접', '오늘의 동인': `테스트 ${at(k)}`, '이야기': '정책', '국면 판단': '판단 보류', '뷰 변화': '유지',
      '전망_미국10년물': calls[k % 3], '전망_S&P500': calls[(k + 1) % 3], '전망_원달러': calls[(k + 2) % 3], '전망_KOSPI': calls[k % 3] });
  }
  fake.주간.push({ 날짜: '2026-11-02', '뷰 검증': '맞음' }, { 날짜: '2026-10-26', '뷰 검증': '틀림' });
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  fake['기업 분석'] = [{ 날짜: '2026-11-04', 티커: 'NVDA', 기업: '엔비디아', '한 줄 요약': '(테스트) AI 가속기 1위', '숫자 검증': '근거 확인 5/5', '카드 JSON': JSON.stringify(Object.assign(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'company.json'), 'utf8')), { data: Object.assign(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'company.json'), 'utf8')).data, { company: { ticker: 'NVDA', name: '엔비디아', market: 'US' } }) })) }];
  fake['자동 브리핑'] = [{ 날짜: today, '리스크팀 판단': '팽팽', '토론 JSON': JSON.stringify({ auto: true, analystAt: 'x', models: { morning: 'local-test' },
    open: { bull: { claim: '(아침) 성장 이야기', points: ['a', 'b', 'c'], forecast: { 'KOSPI': '상승' } }, bear: { claim: '(아침) 긴축 경계', points: ['a', 'b', 'c'], forecast: { 'KOSPI': '하락' } } },
    rebut: { bull: { rebuttal: 'r', concede: 'c' }, bear: { rebuttal: 'r', concede: 'c' } },
    risk: { balance: '팽팽', reason: '(아침) 이유', key_issue: '쟁점', bull_wrong_if: 'p', bear_wrong_if: 'q', scenarios: [], checkpoints: ['CPI'] } }),
    'AI 결론 JSON': JSON.stringify({ '오늘의 동인': '미국 2년물 +9.0bp 상승, KOSPI −1.48% 하락', '이야기': '정책', '한국 영향': '원달러 +0.72% 원화 약세', '국면 판단': '판단 보류', '뷰 변화': '유지', '다음 체크포인트': 'CPI', '투자 시사점': '유리: 금융 / 불리: 성장주',
      '종합 해석': '(아침 AI) 2년물이 +9.0bp 오르며 긴축 경계가 커졌고, 나스닥은 +3.5% 올랐다는 잘못된 숫자를 넣어 검증을 시험한다.', '전망': { '미국10년물': '상승', 'S&P500': '하락', '원달러': '상승', 'KOSPI': '하락' } }),
    '생성시각': '2026. 11. 9. 7:12:03', '모델': 'local-test', 'AI전망_KOSPI': '하락', 'BULL전망_KOSPI': '상승', 'BEAR전망_KOSPI': '하락' }];
  const pastDates = require('../api/_mock.js').items.kospi.pts.map((p) => p[0]);
  [25, 20, 15, 10].forEach((k) => fake['자동 브리핑'].push({ 날짜: pastDates[pastDates.length - k], 'AI전망_KOSPI': k % 10 ? '상승' : '하락', 'AI전망_미국10년물': '상승', 'BULL전망_KOSPI': '상승', 'BEAR전망_KOSPI': '하락' }));
}

if (!process.env.SHEET_WEBHOOK_URL) {
  process.env.SHEET_WEBHOOK_URL = `http://localhost:${PORT}/__fakesheet`;
  process.env.SHEET_SECRET = process.env.SHEET_SECRET || 'dev';
}

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/__fakesheet') {
    if (req.method === 'POST') {
      let raw = '';
      for await (const c of req) raw += c;
      const b = JSON.parse(raw);
      if (b.secret !== process.env.SHEET_SECRET) return end(res, { ok: false, error: 'secret 불일치' });
      if (b.action === 'mail') {
        fs.writeFileSync(path.join(process.env.MAIL_OUT || '/tmp', 'last-mail.html'), `<h1>${b.subject}</h1><p>to: ${b.to}</p>${b.html}`);
        return end(res, { ok: true, mailed: b.to });
      }
      const rows = fake[b.sheet] || (fake[b.sheet] = []);
      const i = rows.findIndex((r) => r['날짜'] === b.record['날짜']);
      if (i >= 0) rows[i] = b.record; else rows.push(b.record);
      return end(res, { ok: true, sheet: b.sheet, row: (i >= 0 ? i : rows.length - 1) + 2, updated: i >= 0 });
    }
    const rows = (fake[url.searchParams.get('sheet')] || []).slice().sort((a, b) => b['날짜'].localeCompare(a['날짜']));
    return end(res, { ok: true, rows });
  }

  // 로컬에서는 Gemini에 접속할 수 없을 때 가짜 AI 응답으로 화면만 확인
  if (!process.env.GEMINI_API_KEY && (url.pathname === '/api/analyze' || url.pathname === '/api/compare')) {
    let raw = '';
    for await (const c of req) raw += c;
    const b = JSON.parse(raw || '{}');
    if (b.mode === 'brief') {
      return end(res, { ok: true, model: 'local-test', brief: {
        '오늘의 동인': '(테스트) 미국 2년물 상승 — 원인 확인 필요', '이야기': '정책', '한국 영향': '(테스트) KOSPI 약세',
        '국면 판단': '판단 보류', '뷰 변화': '유지', '다음 체크포인트': '(테스트) CPI', '종합 해석': '(테스트) 브리핑 문장입니다.',
        '전망': { '미국10년물': '상승', 'S&P500': '보합', '원달러': '상승', 'KOSPI': '하락' } } });
    }
    const text = url.pathname === '/api/compare'
      ? `## 리포트 핵심 (3줄)\n- (테스트) PDF ${b.pdfBase64 ? '있음' : '없음'}, 붙여넣기 ${b.reportText ? b.reportText.length + '자' : '없음'}\n## 같은 점\n- 테스트 응답입니다\n## 다른 점\n- 테스트 응답입니다`
      : '## 오늘의 동인\n테스트 응답입니다.\n## 내 결론에 대한 피드백\n- 테스트';
    return end(res, { ok: true, model: 'local-test', text });
  }

  // 로컬 테스트용 가짜 산업 이슈·기업 분석
  if (!process.env.GEMINI_API_KEY && url.pathname === '/api/industry') {
    await new Promise((r) => setTimeout(r, 300));
    const data = { date: new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10), headline: '(테스트) 반도체 강세, 자동차 관세 부담', model: 'local-test', newsCount: 96, macroUsed: true, feedErrors: [],
      issues: [
        { industry: '반도체', title: 'HBM 공급 확대', summary: '(테스트) 삼성전자가 HBM4 공급을 늘린다는 보도.', why: 'AI 서버 수요와 메모리 가격에 직결', impact: '긍정', macro_link: '원화 약세는 수출 반도체에 우호적', companies: [{ name: '삼성전자', inSource: true }, { name: 'SK하이닉스', inSource: false }], links: [{ source: '매일경제 증권', title: '삼성전자, HBM4 엔비디아 공급 확대', link: 'https://example.com/1' }], check: '관련 기업 일부 기사에 없음' },
        { industry: '자동차', title: '관세 영향 이익 감소', summary: '(테스트) 현대차 3분기 이익 감소.', why: '미국 관세가 수익성에 부담', impact: '부정', macro_link: '', companies: [{ name: '현대차', inSource: true }], links: [{ source: '연합뉴스 경제', title: '현대차, 美 관세 영향에 3분기 이익 감소', link: 'https://example.com/2' }], check: '근거 확인' },
        { industry: '조선', title: 'LNG선 대규모 수주', summary: '(테스트) 한화오션 LNG선 수주.', why: '수주 잔고 확대', impact: '긍정', macro_link: '', companies: [{ name: '한화오션', inSource: true }], links: [{ source: '비즈니스포스트 기업과산업', title: '한화오션 대규모 LNG선 수주', link: 'https://example.com/4' }], check: '근거 확인' },
      ] };
    fake['산업 이슈'] = [{ 날짜: data.date, '이슈 JSON': JSON.stringify(data), '관련 기업': '삼성전자, 현대차, 한화오션' }];
    return end(res, { ok: true, data });
  }
  if (!process.env.GEMINI_API_KEY && url.pathname === '/api/company') {
    const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'company.json'), 'utf8'));
    if (url.searchParams.get('rank') === '1') {
      const names = [['005930.KS', '삼성전자', 6, 3.1, 5, 4], ['NVDA', '엔비디아', 4.2, 2.4, 1.6, 3], ['042660.KS', '한화오션', 3.5, 1.9, 2.2, 2], ['005380.KS', '현대차', -2.1, 1.4, 1.3, 2]];
      const rank = names.map(([t, n, chg, move, volx, news], i) => ({ ticker: t, name: n, market: t.includes('.K') ? 'KR' : 'US', date: '2026-11-06', chg, move, volx, news, bonus: i === 2 ? 1.5 : 0, score: Math.round((move + volx + news * 0.5 + (i === 2 ? 1.5 : 0)) * 100) / 100 })).sort((a, b) => b.score - a.score);
      return end(res, { ok: true, rank, pick: rank[0], recent: [] });
    }
    let raw = ''; for await (const c of req) raw += c;
    const b = JSON.parse(raw || '{}');
    await new Promise((r) => setTimeout(r, 400));
    if (b.ticker && b.ticker !== '005930.KS') { fx.data.company = { ticker: b.ticker, name: b.ticker, market: b.ticker.includes('.K') ? 'KR' : 'US' }; fx.reason = '직접 선택'; }
    fx.date = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    fake['기업 분석'] = (fake['기업 분석'] || []).concat([{ 날짜: fx.date, 티커: fx.data.company.ticker, 기업: fx.data.company.name, '한 줄 요약': fx.card.one_liner, '숫자 검증': `근거 확인 ${fx.verify.ok}/${fx.verify.total}`, '카드 JSON': JSON.stringify(fx) }]);
    return end(res, { ok: true, result: fx });
  }

  // 로컬 테스트용 가짜 토론
  if (!process.env.GEMINI_API_KEY && url.pathname === '/api/debate') {
    let raw = '';
    for await (const c of req) raw += c;
    const b = JSON.parse(raw || '{}');
    await new Promise((r) => setTimeout(r, 400));
    const fc = (a, b2, c, d) => ({ '미국10년물': a, 'S&P500': b2, '원달러': c, 'KOSPI': d });
    const data = {
      open: { bull: { claim: '(테스트) 반도체 주도 성장 이야기가 유효하다', points: ['미국 반도체 +4.2%', '금리·주가 동반 상승 = 좋은 금리 상승', '원화 강세'], korea: '외국인 매수 전환 시 KOSPI 반등 여지', forecast: fc('상승', '상승', '하락', '상승') },
              bear: { claim: '(테스트) 2년물 상승은 긴축 경계, 상승 폭이 좁다', points: ['2년물 +5bp 베어 플래트닝', '지수 역배열 = 빅테크 쏠림', 'VIX 20 근처'], korea: 'KOSPI는 반도체 강세에도 하락 — 수급 이탈 확인 필요', forecast: fc('상승', '하락', '상승', '하락') } },
      rebut: { bull: { rebuttal: '(테스트) 베어 플래트닝이어도 주가가 함께 올랐다.', concede: '상승 폭이 좁은 건 맞다.' }, bear: { rebuttal: '(테스트) 원화 강세에도 KOSPI가 빠졌다.', concede: '반도체 실적 기대는 인정한다.' } },
      risk: { balance: '팽팽', reason: '(테스트) 미국은 BULL, 한국은 BEAR 쪽 근거가 강하다.', key_issue: '한국 디커플링이 일시적인가', bull_wrong_if: '외국인 순매도 3일 이상 지속', bear_wrong_if: '2년물 하락 + 러셀 강세', scenarios: [{ name: '물가 서프라이즈', trigger: 'CPI 예상 상회', reaction: '2년물↑ 달러↑ KOSPI↓' }, { name: '물가 둔화', trigger: 'CPI 예상 하회', reaction: '2년물↓ 원화 강세 KOSPI↑' }], checkpoints: ['CPI', '외국인 순매수'] },
      chief: { '오늘의 동인': '(테스트) 센터장 결론', '이야기': '정책', '한국 영향': '(테스트) 디커플링', '국면 판단': '판단 보류', '뷰 변화': '유지', '다음 체크포인트': 'CPI', '투자 시사점': '(테스트) 유리: 금융 / 불리: 성장주', '종합 해석': '(테스트) BULL의 성장 논거는 받아들이되 BEAR의 한국 수급 우려를 남겨둔다.', '전망': fc('상승', '보합', '하락', '보합') },
    }[b.stage];
    return end(res, { ok: true, model: 'local-test', stage: b.stage, data });
  }

  if (url.pathname.startsWith('/api/')) {
    const name = url.pathname.slice(5).replace(/[^a-z]/g, '');
    const file = path.join(ROOT, 'api', name + '.js');
    if (!fs.existsSync(file)) return end(res, { ok: false, error: 'not found' }, 404);
    try { return await require(file)(req, res); } catch (e) { return end(res, { ok: false, error: e.message }, 500); }
  }

  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.join(ROOT, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`dev server: http://localhost:${PORT}`));

function end(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}
