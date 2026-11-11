// 아침 자동 브리핑
// 평일 아침 Vercel 크론이 호출 → 데이터 수집 → 자동 신호 → AI 리서치센터 토론(한 번에) → 시트 '자동 브리핑' 저장 → 메일 발송
// 수동 실행(테스트): /api/morning?pass=앱비밀번호   (메일 없이: &nomail=1)
//
// 필요한 환경변수: CRON_SECRET(크론 인증), MORNING_MAIL_TO(받는 주소), SHEET_WEBHOOK_URL, SHEET_SECRET, GEMINI_API_KEY
// 선택: DASHBOARD_URL(메일 속 링크. 없으면 요청 주소로 만듦)

const { sendJson, fetchWithTimeout, callGemini } = require('./_lib');
const { collectMarket } = require('./market');
const { fetchNews, marketHeadlines, headlinesText } = require('./_data');
const S = require('../signals.js');

const LABELS = {
  us2y: ['미국 2년물', 2], us10y: ['미국 10년물', 2], t10y2y: ['장단기 금리차', 2], real10y: ['10년 실질금리', 2], bei10y: ['10년 BEI', 2],
  dxy: ['달러인덱스', 2], usdkrw: ['원달러', 1], usdjpy: ['달러엔', 2], dow: ['다우', 2], spx: ['S&P500', 2], ndx: ['나스닥', 2], rut: ['러셀2000', 2],
  sox: ['필라델피아 반도체', 2], wti: ['WTI', 2], brent: ['브렌트', 2], wtibrent: ['WTI−브렌트', 2], gold: ['금', 2], copper: ['구리', 3], vix: ['VIX', 2], hy: ['하이일드 스프레드', 2],
  kospi: ['KOSPI', 2], kosdaq: ['KOSDAQ', 2], kr3y: ['국고채 3년', 3], kr10y: ['국고채 10년', 3],
};
const TITLES = { curve: '커브 패턴', stockRate: '주식 × 금리 조합', alignment: '지수 배열', dollar: '달러 움직임의 원인', vix: 'VIX 구간', korea: '한국 전이', decompose: '10년물 분해', hy: '신용시장', phase: '국면 신호' };

const PROMPT = `너는 한국 증권사 리서치센터의 아침 매크로 토론을 한 번에 정리한다.
TradingAgents 구조: 애널리스트 보고서(주어짐) → BULL(낙관)·BEAR(비관) 연구원 토론 → 리스크 팀 중립 평가 → 리서치센터장 결론.
원칙: 주어진 숫자·사실만 쓴다. 뉴스·발언·수급 수치를 지어내지 않는다. 원인을 모르면 "원인 확인 필요". 한국(원달러, KOSPI, 국고채) 전이를 꼭 다룬다.
날짜: 숫자마다 기준일이 다르다. [한국 데이터 시점]의 안내를 반드시 따른다. 한국 숫자를 '오늘 서울 장'처럼 쓰지 말고, 쓸 때는 "11/10 KOSPI"처럼 날짜를 붙인다.
뉴스: [시장 헤드라인]은 제목뿐이다. 원인·업종 이슈(실적, 수출, 수급, 정책)를 설명할 때 근거로 쓰되 제목에 있는 사실만 쓰고, 쓴 곳에는 "(헤드라인)"을 붙인다. 규칙 기반 섹터 연결(환율·금리로 유불리 판단)과 헤드라인이 다르면 둘 다 적고, 헤드라인 쪽 이슈를 무시하지 않는다. 투자 권유 금지, 종목 추천 금지. 한국어, 짧은 문장. JSON 하나만 출력.
전망은 다음 5거래일 뒤 방향(상승|보합|하락). 보합 범위: 미국 10년물 ±3bp, S&P500 ±0.5%, 원달러 ±0.5%, KOSPI ±0.7%.
출력:
{ "headline": "오늘 아침 한 줄 요약",
  "bull": { "claim": "핵심 주장", "points": ["근거", "근거", "근거"], "korea": "한국 견해", "forecast": { "미국10년물": "", "S&P500": "", "원달러": "", "KOSPI": "" } },
  "bear": { "claim": "", "points": ["", "", ""], "korea": "", "forecast": { "미국10년물": "", "S&P500": "", "원달러": "", "KOSPI": "" } },
  "rebut": { "bull": { "rebuttal": "BEAR 반박 한 문장", "concede": "인정하는 점" }, "bear": { "rebuttal": "BULL 반박 한 문장", "concede": "인정하는 점" } },
  "risk": { "balance": "BULL 우세 | BEAR 우세 | 팽팽", "reason": "", "key_issue": "", "bull_wrong_if": "", "bear_wrong_if": "", "scenarios": [ { "name": "", "trigger": "", "reaction": "" } ], "checkpoints": ["", ""] },
  "chief": { "오늘의 동인": "[무엇이] [얼마나] — [왜]", "이야기": "성장 | 물가 | 정책 | 위험 회피·지정학 | 실적·개별 이슈 | 뚜렷한 동인 없음",
    "한국 영향": "", "국면 판단": "골디락스 쪽 | 리플레이션 쪽 | 침체·디스인플레이션 쪽 | 스태그플레이션 우려 쪽 | 판단 보류",
    "뷰 변화": "유지 | 강화 | 약화 | 수정", "다음 체크포인트": "", "투자 시사점": "유리·불리 섹터와 이유 (종목 추천 금지)",
    "종합 해석": "3~5문장. BULL과 BEAR 중 무엇을 받아들이고 무엇을 남겨두는지 포함",
    "전망": { "미국10년물": "", "S&P500": "", "원달러": "", "KOSPI": "" } } }`;

function kstDate() { return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); }
const sgn = (x, d, u) => (x == null ? '-' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(d)}${u}`);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

function line(src, id) {
  const x = src[id];
  if (!x || !x.ok || !LABELS[id]) return null;
  const [label, digits] = LABELS[id];
  const u = x.chgUnit === 'bp' ? 'bp' : x.chgUnit === '%' ? '%' : x.chgUnit;
  return `${label} ${Number(x.value).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })} (${sgn(x.chg, x.chgUnit === 'bp' ? 1 : 2, u)})`;
}

const dd = (d) => (d ? d.slice(5).replace('-', '/') : '-');
function lineD(src, id) {
  const l = line(src, id);
  return l && src[id].date ? `${l} [${dd(src[id].date)} 종가]` : l;
}

// 한국 데이터가 어느 서울 장인지 AI에 알려줌 (아침 7시에는 미국 장의 영향이 아직 서울 장에 반영되지 않음)
function koreaNote(sig) {
  const f = sig.krFresh || {};
  const us = dd(sig.signalDate);
  if (f.state === 'after') return { warn: '', text: `한국 숫자(${dd(f.date)} 서울 장)는 미국 ${us} 장 뒤에 열린 장이다. 미국 영향이 한국에 어떻게 전이됐는지 판단할 수 있다.` };
  if (f.state === 'same') return { warn: '', text: `한국 숫자(${dd(f.date)} 서울 장)는 미국 ${us} 장보다 먼저 끝난 장이다. 미국 ${us} 장의 영향은 아직 서울 장에 나타나지 않았다. 한국 전이는 '오늘 서울 장 전망'으로만 다룬다.` };
  if (f.state === 'stale') {
    const warn = `한국 데이터가 오래됨: KOSPI가 ${dd(f.date)} 종가까지만 들어왔다 (미국 기준일 ${us}). 그 뒤 서울 장이 빠졌을 수 있다.`;
    return { warn, text: `${warn} 한국 숫자를 최근 흐름으로 단정하지 말고 "데이터 확인 필요"라고 적는다. 한국 전이는 전망으로만 다룬다.` };
  }
  return { warn: '', text: '한국 데이터 기준일을 알 수 없다. 한국 숫자는 참고만 한다.' };
}

function buildTexts(items, sig, headlines) {
  const A = S.align(items).items;
  const sl = (k) => (sig[k] ? `${TITLES[k]}: ${sig[k].name} — ${sig[k].meaning}` : null);
  const kn = koreaNote(sig);
  const groups = {
    'RATE · 금리': [line(A, 'us2y'), line(A, 'us10y'), line(A, 't10y2y'), sl('curve'), sl('decompose')],
    'FX · 달러·원자재': [line(A, 'dxy'), lineD(items, 'usdkrw'), sl('dollar'), line(A, 'wti'), line(A, 'brent'), line(A, 'gold'), line(A, 'copper')],
    'EQUITY · 주식·심리': [line(A, 'dow'), line(A, 'spx'), line(A, 'ndx'), line(A, 'rut'), line(A, 'sox'), sl('alignment'), sl('stockRate'), line(A, 'vix'), sl('hy')],
    // 서울 장이 미국 장 뒤에 열렸을 때만 '한국 전이' 신호를 줌 (아니면 같은 날 숫자끼리 비교해 잘못된 전이가 나옴)
    'KOREA · 한국': [lineD(items, 'kospi'), lineD(items, 'kosdaq'), lineD(items, 'kr3y'), lineD(items, 'kr10y'), sig.krFresh && sig.krFresh.state === 'after' ? sl('korea') : null],
  };
  const flags = (sig.flags || []).concat(kn.warn ? [kn.warn] : []);
  const analyst = `신호 기준일: 미국 ${sig.signalDate || '-'} 종가\n` +
    `\n[한국 데이터 시점]\n${kn.text}\n\n` +
    Object.entries(groups).map(([k, v]) => `[${k}]\n${v.filter(Boolean).map((l) => `- ${l}`).join('\n')}`).join('\n\n') +
    (flags.length ? `\n\n[주의 신호]\n${flags.map((f) => `- ${f}`).join('\n')}` : '') +
    (sig.sectors ? `\n\n[섹터 연결 (규칙 기반 · 환율·금리만 본 것)]\n${S.sectorText(sig.sectors)}` : '') +
    (headlines ? `\n\n[시장 헤드라인 (언론사 RSS 제목, 최근 30시간)]\n${headlines}` : '\n\n[시장 헤드라인]\n(가져오지 못함 — 원인은 "원인 확인 필요"로)');
  return { analyst, groups, krWarn: kn.warn };
}

function parseJson(text) {
  const t = String(text).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(t); } catch (e) { const m = t.match(/\{[\s\S]*\}/); try { return m ? JSON.parse(m[0]) : null; } catch (e2) { return null; } }
}

async function postSheet(payload) {
  const hook = process.env.SHEET_WEBHOOK_URL;
  if (!hook) throw new Error('SHEET_WEBHOOK_URL 미설정');
  const r = await fetchWithTimeout(hook, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ secret: process.env.SHEET_SECRET || '' }, payload)), redirect: 'follow' }, 15000);
  const j = JSON.parse(await r.text());
  if (!j.ok) throw new Error(j.error || '시트 응답 오류');
  return j;
}

function mailHtml({ date, sig, groups, D, chief, aiError, link }) {
  const chip = (k) => (sig[k] ? `<span style="display:inline-block;margin:2px 4px 2px 0;padding:3px 9px;border-radius:12px;background:#eef2f7;font-size:12px"><b>${esc(TITLES[k])}</b> ${esc(sig[k].name)}</span>` : '');
  const fc = (f) => (f ? Object.entries(f).map(([k, v]) => `${esc(k)} ${esc(v)}`).join(' · ') : '');
  const side = (name, color, x) => (x ? `<td style="vertical-align:top;width:50%;padding:10px;border-top:3px solid ${color};background:#fafafa">
      <b style="color:${color}">${name}</b><p style="margin:6px 0;font-weight:600">${esc(x.claim)}</p>
      <ol style="margin:0 0 6px;padding-left:18px">${(x.points || []).map((p) => `<li>${esc(p)}</li>`).join('')}</ol>
      ${x.korea ? `<p style="margin:4px 0"><b>한국</b> ${esc(x.korea)}</p>` : ''}<p style="margin:4px 0;color:#555;font-size:12px">5거래일 전망: ${fc(x.forecast)}</p></td>` : '<td></td>');
  return `<div style="font-family:-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#16202e;max-width:680px;line-height:1.55;font-size:14px">
    <h2 style="margin:0 0 4px">Macro Daily 아침 브리핑 · ${esc(date)}</h2>
    <p style="margin:0 0 12px;color:#666;font-size:12px">미국 ${esc(sig.signalDate || '-')} 종가 기준 · 자동 생성 · 투자 권유가 아닌 학습용</p>
    ${D && D.headline ? `<p style="font-size:16px;font-weight:700;margin:8px 0 12px">${esc(D.headline)}</p>` : ''}
    ${chief ? `<div style="border:1px solid #d9e3ee;border-radius:10px;padding:12px 14px;margin:8px 0 12px;background:#f6f9fc">
      <b>오늘의 결론 (AI 센터장)</b>
      <p style="margin:6px 0">${esc(chief['종합 해석'] || '')}</p>
      <p style="margin:4px 0;font-size:13px"><b>이야기</b> ${esc(chief['이야기'] || '-')} · <b>국면</b> ${esc(chief['국면 판단'] || '-')} · <b>뷰</b> ${esc(chief['뷰 변화'] || '-')}</p>
      ${chief['투자 시사점'] ? `<p style="margin:4px 0;font-size:13px"><b>투자 시사점</b> ${esc(chief['투자 시사점'])}</p>` : ''}
      ${chief['다음 체크포인트'] ? `<p style="margin:4px 0;font-size:13px"><b>다음 체크포인트</b> ${esc(chief['다음 체크포인트'])}</p>` : ''}
      <p style="margin:4px 0;font-size:12px;color:#555">5거래일 전망: ${fc(chief['전망'])}</p>
      <p style="margin:6px 0 0;font-size:11.5px;color:#888">AI 분석은 틀릴 수 있습니다. 대시보드의 교차검증(데이터 대조·증권사 리포트·적중률)으로 확인하세요.</p></div>` : ''}
    <div>${['curve', 'stockRate', 'alignment', 'dollar', 'korea', 'phase'].map(chip).join('')}</div>
    ${sig.flags && sig.flags.length ? `<ul style="color:#a2620b;font-size:13px">${sig.flags.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
    <h3 style="margin:16px 0 6px">애널리스트 팀</h3>
    ${Object.entries(groups).map(([k, v]) => `<p style="margin:4px 0;font-size:13px"><b>${esc(k)}</b><br>${v.filter((l) => l && !l.includes(' — ')).map(esc).join('<br>')}</p>`).join('')}
    <h3 style="margin:16px 0 6px">BULL vs BEAR</h3>
    ${D ? `<table style="width:100%;border-collapse:separate;border-spacing:8px 0;font-size:13px"><tr>${side('BULL', '#1e7a52', D.bull)}${side('BEAR', '#b23a30', D.bear)}</tr></table>
      ${D.risk ? `<h3 style="margin:16px 0 6px">리스크 팀 · ${esc(D.risk.balance)}</h3><p style="margin:4px 0">${esc(D.risk.reason)}</p>
        <p style="margin:4px 0"><b>핵심 쟁점</b> ${esc(D.risk.key_issue)}</p>
        <p style="margin:4px 0"><b>BULL이 틀렸다고 볼 신호</b> ${esc(D.risk.bull_wrong_if)}<br><b>BEAR가 틀렸다고 볼 신호</b> ${esc(D.risk.bear_wrong_if)}</p>
        ${(D.risk.checkpoints || []).length ? `<p style="margin:4px 0"><b>다음 확인</b> ${D.risk.checkpoints.map(esc).join(' · ')}</p>` : ''}` : ''}`
      : `<p style="color:#b23a30">AI 토론을 만들지 못했습니다: ${esc(aiError || '')}<br>대시보드의 AI 리서치센터에서 직접 시작할 수 있어요.</p>`}
    ${sig.sectors ? `<h3 style="margin:16px 0 6px">섹터 연결 (규칙 기반)</h3><p style="margin:4px 0;font-size:13px">${esc(S.sectorText(sig.sectors)).replace(/\n/g, '<br>')}</p>` : ''}
    <p style="margin:20px 0"><a href="${esc(link)}" style="background:#00462a;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700">대시보드에서 토론 전체 보기</a></p>
  </div>`;
}

module.exports = async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url, 'http://x');
  const cron = process.env.CRON_SECRET && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
  const pass = process.env.APP_PASSCODE && (url.searchParams.get('pass') === process.env.APP_PASSCODE || req.headers['x-app-passcode'] === process.env.APP_PASSCODE);
  if (!cron && !pass) return sendJson(res, 401, { ok: false, error: '크론 인증(CRON_SECRET) 또는 ?pass=앱비밀번호 가 필요합니다.' });

  const date = url.searchParams.get('date') || kstDate();
  const steps = [];
  try {
    const mock = url.searchParams.get('mock') === '1';
    const [market, news] = await Promise.all([
      mock ? require('./_mock.js') : collectMarket(),
      mock ? { items: [] } : fetchNews({ hours: 30, max: 160 }).catch(() => ({ items: [] })),
    ]);
    const sig = S.all(market.items);
    const heads = marketHeadlines(news.items, 25);
    const { analyst, groups, krWarn } = buildTexts(market.items, sig, headlinesText(heads));
    if (krWarn) sig.flags = (sig.flags || []).concat(krWarn); // 메일에도 경고 표시
    steps.push(`데이터 수집 (${Math.round((Date.now() - started) / 1000)}초 · 헤드라인 ${heads.length}개)`);

    // AI 토론: 시트 저장·메일 발송 시간을 남겨두고 한 번에
    let D = null, model = '', aiError = '';
    const budget = 50000 - (Date.now() - started);
    if (budget > 10000) {
      const r = await callGemini({ system: PROMPT, parts: [{ text: `날짜: ${date}\n\n${analyst}` }], temperature: 0.5, json: true, maxOutputTokens: 3500, budgetMs: budget, primaryMs: Math.min(28000, budget - 12000) });
      if (r.ok) { D = parseJson(r.text); model = r.model; if (!D) aiError = 'AI 응답 형식 오류'; } else aiError = r.error;
    } else aiError = '데이터 수집이 오래 걸려 AI 토론을 건너뜀';
    steps.push(D ? `AI 토론 (${model})` : `AI 토론 실패: ${aiError}`);

    const debate = D ? { open: { bull: D.bull, bear: D.bear }, rebut: D.rebut || null, risk: D.risk || null, headline: D.headline || '', models: { morning: model }, analystAt: new Date().toISOString(), auto: true } : null;
    const chief = D && D.chief ? D.chief : null;
    const record = {
      '날짜': date, '생성시각': new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }), '신호 기준일': sig.signalDate || '',
      '한 줄 요약': D ? D.headline || '' : '', 'BULL 주장': D && D.bull ? D.bull.claim || '' : '', 'BEAR 주장': D && D.bear ? D.bear.claim || '' : '',
      '리스크팀 판단': D && D.risk ? D.risk.balance || '' : '', '핵심 쟁점': D && D.risk ? D.risk.key_issue || '' : '',
      '자동_섹터 시사점': sig.sectors ? S.sectorText(sig.sectors) : '', '모델': model, 'AI 오류': aiError,
      '토론 JSON': debate ? JSON.stringify(debate) : '',
      'AI 결론 JSON': chief ? JSON.stringify(chief) : '',
      'AI 종합 해석': chief ? chief['종합 해석'] || '' : '',
      '한국 기준일': (sig.krFresh && sig.krFresh.date) || '',
      '한국 데이터 경고': krWarn || '',
      '헤드라인 수': heads.length,
      // AI가 이때 본 숫자: 대시보드의 데이터 대조가 '나중 데이터'가 아니라 이것과 비교함
      '데이터 스냅샷': JSON.stringify(S.snapshot(market.items)),
    };
    // 출처별 5거래일 전망 (나중에 자동 채점)
    ['미국10년물', 'S&P500', '원달러', 'KOSPI'].forEach((k) => {
      record[`AI전망_${k}`] = chief && chief['전망'] ? chief['전망'][k] || '' : '';
      record[`BULL전망_${k}`] = D && D.bull && D.bull.forecast ? D.bull.forecast[k] || '' : '';
      record[`BEAR전망_${k}`] = D && D.bear && D.bear.forecast ? D.bear.forecast[k] || '' : '';
    });
    ['curve', 'stockRate', 'alignment', 'dollar', 'korea', 'phase'].forEach((k) => { record[`자동_${TITLES[k]}`] = sig[k] ? sig[k].name : ''; });
    await postSheet({ sheet: '자동 브리핑', record });
    steps.push('시트 저장');

    const host0 = req.headers['x-forwarded-host'] || req.headers.host || '';
    const link0 = process.env.DASHBOARD_URL || (host0 ? `https://${host0}/` : '');
    if (url.searchParams.get('part') === '1') {
      // 아침 자동화(Apps Script)가 산업·기업 결과와 합쳐서 메일 한 통으로 보냄
      return sendJson(res, 200, { ok: true, date, steps, seconds: Math.round((Date.now() - started) / 1000),
        subjectTail: D && D.risk ? `${D.risk.balance}${D.headline ? ` · ${D.headline}` : ''}` : '',
        mailHtml: mailHtml({ date, sig, groups, D, chief, aiError, link: link0 }) });
    }
    const to = process.env.MORNING_MAIL_TO;
    if (to && url.searchParams.get('nomail') !== '1') {
      const host = req.headers['x-forwarded-host'] || req.headers.host || '';
      const link = process.env.DASHBOARD_URL || (host ? `https://${host}/` : '');
      const subject = `[Macro Daily] ${date.slice(5).replace('-', '/')} 아침 브리핑${D && D.risk ? ` — ${D.risk.balance}` : ''}${D && D.headline ? ` · ${D.headline}` : ''}`.slice(0, 120);
      await postSheet({ action: 'mail', to, subject, html: mailHtml({ date, sig, groups, D, chief, aiError, link }) });
      steps.push(`메일 발송 → ${to}`);
    }
    return sendJson(res, 200, { ok: true, date, steps, seconds: Math.round((Date.now() - started) / 1000) });
  } catch (e) {
    return sendJson(res, 500, { ok: false, date, steps, error: e.message });
  }
};
module.exports.mailHtml = mailHtml;
module.exports.buildTexts = buildTexts;
