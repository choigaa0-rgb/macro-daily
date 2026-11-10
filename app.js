/* Macro Daily — 데일리 매크로 점검 대시보드 */
(function () {
  'use strict';

  const C = window.CONFIG;
  const S = window.Signals;
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

  const state = {
    market: null, // /api/market 결과
    signals: null,
    date: todayKST(),
    aiText: '',
  };

  // ---------- 저장소 (브라우저) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 불가 환경 */ } },
  };
  const settings = () => store.get('md-settings', { passcode: '', sheetUrl: '', mock: false });

  // ---------- 유틸 ----------
  function todayKST() {
    const d = new Date(Date.now() + 9 * 3600000);
    return d.toISOString().slice(0, 10);
  }  // 오늘 결과가 아직 없으면(주말·이른 아침) 가장 최근 결과를 보여줌. 날짜를 직접 고른 경우엔 그날 것만
  function pickRow(rows, need) {
    const ok = (rows || []).filter((r) => r['날짜'] && (!need || r[need]));
    const exact = ok.find((r) => r['날짜'] === state.date);
    if (exact || state.date !== todayKST()) return exact || null;
    return ok.filter((r) => r['날짜'] < state.date).sort((a, b) => (a['날짜'] < b['날짜'] ? 1 : -1))[0] || null;
  }
  const fromNote = (row) => (row && row['날짜'] !== state.date ? ` · ${row['날짜']} 결과 (오늘 것은 아직 없음)` : '');

  function weekStart(dateStr) {
    const d = new Date(dateStr + 'T00:00:00Z');
    const day = (d.getUTCDay() + 6) % 7; // 월요일=0
    d.setUTCDate(d.getUTCDate() - day);
    return d.toISOString().slice(0, 10);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }
  function num(x, d) {
    if (x == null || isNaN(x)) return '–';
    return Number(x).toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function signed(x, d, unit) {
    if (x == null || isNaN(x)) return '–';
    const s = x > 0 ? '+' : x < 0 ? '−' : '';
    return s + Math.abs(x).toFixed(d) + (unit || '');
  }
  function toast(msg, kind) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show ' + (kind || '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.className = 'toast'), 3200);
  }
  async function api(path, opts = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    const pass = settings().passcode;
    if (pass) headers['x-app-passcode'] = pass;
    const r = await fetch(path, Object.assign({}, opts, { headers }));
    let j;
    try { j = await r.json(); } catch (e) { throw new Error(`서버 응답 오류 (${r.status})`); }
    if (!r.ok || j.ok === false) throw new Error(j.error || `오류 ${r.status}`);
    return j;
  }

  // ---------- 폼 값 (초안 자동 저장) ----------
  const draftKey = () => 'md-draft-' + state.date;
  const weekKey = () => 'md-week-' + weekStart(state.date);

  function collect(scope) {
    const out = {};
    $$('[data-key]', scope).forEach((el) => {
      if (el.type === 'checkbox') out[el.dataset.key] = el.checked;
      else out[el.dataset.key] = el.value;
    });
    return out;
  }
  function restore(scope, data) {
    if (!data) return;
    $$('[data-key]', scope).forEach((el) => {
      const v = data[el.dataset.key];
      if (v === undefined) return;
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v;
    });
  }
  function saveDraft() {
    const d = collect($('#view-daily'));
    Object.assign(d, collect($('#view-event')), collect($('#view-brief')));
    d.__aiConcl = state.aiConcl || null;
    d.__aiSrc = state.aiSrc || null;
    d.__cmpMatch = state.cmpMatch || '';
    d.__ai = state.aiText;
    d.__cmp = state.cmpText || '';
    d.__mode = state.authorMode || '';
    d.__debate = state.debate || null;
    d.__snap = state.briefSnap || '';
    store.set(draftKey(), d);
    store.set(weekKey(), collect($('#view-weekly')));
    updateProgress();
    updateModeTag();
  }

  // 배경 테마: 초록 그라데이션(기본) 또는 연한 회색
  // 색 테마: 설정에서 고름. grey·green은 예전(연두 포인트) 디자인
  const THEMES = ['pro', 'navy', 'plum', 'ocean', 'charcoal', 'wine'];
  function setTheme(t) {
    const v = THEMES.includes(t) ? t : 'pro';
    document.documentElement.dataset.bg = v;
    document.documentElement.classList.toggle('themed', v !== 'grey' && v !== 'green');
  }
  function applyBg() { setTheme(settings().bg || 'pro'); }

  // ---------- 그리기 도우미 ----------
  function sparkline(arr) {
    if (!arr || arr.length < 3) return '';
    const w = 84, h = 24;
    const min = Math.min(...arr), max = Math.max(...arr);
    const span = max - min || 1;
    const pts = arr.map((v, i) => `${((i / (arr.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`).join(' ');
    const up = arr[arr.length - 1] >= arr[0];
    return `<svg class="spark ${up ? 'up' : 'down'}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" /></svg>`;
  }

  function tile(id, mode) {
    const def = C.indicators[id];
    const it = state.market && state.market.items[id];
    if (!def) return '';
    if (!it || !it.ok) {
      const why = it ? it.error : '불러오는 중';
      return `<div class="tile empty"><div class="t-label">${esc(def.label)}</div><div class="t-value">–</div><div class="t-sub" title="${esc(why)}">${esc(why)}</div></div>`;
    }
    const isWeekly = mode === 'weekly';
    const chg = isWeekly ? it.chg5 : it.chg;
    const d = it.chgUnit === 'bp' ? 1 : 2;
    const suf = it.chgUnit === 'bp' ? 'bp' : it.chgUnit === '%' ? '%' : it.chgUnit;
    const dir = chg == null ? '' : chg > 0 ? 'up' : chg < 0 ? 'down' : '';
    const unit = def.unit && def.unit !== '%' ? ` <small>${esc(def.unit)}</small>` : def.unit === '%' ? '<small>%</small>' : '';
    return `<div class="tile" title="${esc(def.desc)}&#10;${esc(it.source)} · ${esc(it.date || '')}">
      <div class="t-label">${esc(def.label)}</div>
      <div class="t-row"><div class="t-value">${num(it.value, def.digits)}${unit}</div>${sparkline(it.spark)}</div>
      <div class="t-chg ${dir}">${signed(chg, d, suf)} <span class="t-period">${isWeekly ? '5일' : '전일 대비'}</span></div>
      <div class="t-sub">${esc(def.desc)}</div>
      <div class="t-src">${esc(it.source)} · ${esc(it.date || '')}</div>
    </div>`;
  }

  function signalBox(title, sig) {
    if (!sig) return `<div class="signal neutral"><div class="s-head"><span class="s-title">${esc(title)}</span><span class="badge neutral">데이터 부족</span></div></div>`;
    const notes = (sig.notes || []).map((n) => `<li>${esc(n)}</li>`).join('');
    return `<div class="signal ${sig.tone}">
      <div class="s-head"><span class="s-title">${esc(title)}</span><span class="badge ${sig.tone}">${esc(sig.name)}</span></div>
      <div class="s-meaning">${esc(sig.meaning)}</div>
      ${sig.detail ? `<div class="s-detail">${esc(sig.detail)}</div>` : ''}
      ${notes ? `<ul class="s-notes">${notes}</ul>` : ''}
    </div>`;
  }
  const SIGNAL_TITLES = { curve: '커브 패턴', stockRate: '주식 × 금리 조합', alignment: '지수 배열', dollar: '달러 움직임의 원인', vix: 'VIX 구간', korea: '한국 전이', decompose: '10년물 분해', hy: '신용시장', phase: '국면 신호' };

  function field(f) {
    const key = f.key;
    if (f.type === 'select') {
      return `<label class="fld"><span>${esc(key)}</span><select data-key="${esc(key)}">${f.options.map((o) => `<option value="${esc(o)}">${esc(o || '선택')}</option>`).join('')}</select></label>`;
    }
    if (f.type === 'textarea') {
      return `<label class="fld wide"><span>${esc(key)}</span><textarea data-key="${esc(key)}" rows="${f.rows || 3}" placeholder="${esc(f.placeholder || '')}"></textarea></label>`;
    }
    return `<label class="fld"><span>${esc(key)}</span><input type="${f.type === 'number' ? 'number' : 'text'}" step="any" data-key="${esc(key)}" placeholder="${esc(f.placeholder || '')}" /></label>`;
  }

  // ---------- 매일 점검 ----------
  // ---------- 섹터 등락 (시장 데이터 03 주식) ----------
  async function loadSectors() {
    state.sectorBusy = true; renderSectors();
    try { state.sectors = await api('/api/sectors' + (settings().mock ? '?mock=1' : '')); }
    catch (e) { state.sectors = { us: { ok: false, error: e.message, rows: [] }, kr: { ok: false, error: e.message, rows: [] } }; }
    state.sectorBusy = false; renderSectors(); renderIndustry();
  }
  function sectorBars(rows, key, label) {
    const list = rows.filter((r) => r[key] != null).slice().sort((a, b) => b[key] - a[key]);
    if (!list.length) return '<p class="muted small">1주 비교 자료가 없습니다.</p>';
    const max = Math.max(...list.map((r) => Math.abs(r[key])), 0.5);
    return `<ul class="sbar">${list.map((r) => {
      const v = r[key], w = (Math.abs(v) / max) * 50;
      const dir = v > 0 ? 'up' : v < 0 ? 'down' : '';
      return `<li><span class="sb-n">${esc(label(r))}</span><span class="sb-t"><i class="sb-z"></i><i class="sb-b ${dir}" style="${v >= 0 ? 'left' : 'right'}:50%;width:${w.toFixed(1)}%"></i></span><span class="sb-v ${dir}">${signed(v, 2, '%')}</span></li>`;
    }).join('')}</ul>`;
  }
  function sectorPanel(kind) {
    const S0 = state.sectors && state.sectors[kind];
    const key = state.secPeriod || 'd1';
    const title = kind === 'us' ? '미국 섹터' : '한국 코스피 업종';
    const link = kind === 'us'
      ? '<a href="https://finviz.com/groups.ashx?g=sector&v=140&o=name" target="_blank" rel="noopener">Finviz Groups</a>'
      : '<a href="https://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC0201020103" target="_blank" rel="noopener">KRX 전체지수 시세</a>';
    let body;
    if (!S0) body = `<p class="muted small">${state.sectorBusy ? '불러오는 중…' : '데이터를 불러오면 나옵니다.'}</p>`;
    else if (!S0.ok) body = S0.needKey
      ? `<p class="muted small">한국 업종 등락은 KRX Open API 키가 있어야 자동으로 나옵니다. <b>openapi.krx.co.kr</b>에서 인증키를 받고 '코스피 시리즈 일별시세정보' 이용 신청을 한 뒤, Vercel 환경변수 <code>KRX_API_KEY</code>에 넣으세요. 그 전에는 ${link}에서 직접 확인하세요.</p>`
      : `<p class="err small">${esc(S0.error || '불러오지 못했습니다')}</p>`;
    else body = sectorBars(S0.rows, key, kind === 'us' ? (r) => r.ko : (r) => r.name);
    const meta = S0 && S0.ok ? `${esc(S0.date || '')}${S0.date ? `(${'일월화수목금토'[new Date(S0.date + 'T00:00:00Z').getUTCDay()]})` : ''} ${S0.live ? '장중' : '종가'}${key === 'w1' && S0.weekBase ? ` · ${esc(S0.weekBase)} 종가 대비 5거래일` : ''}` : '';
    return `<div class="sec-panel"><div class="sp-head"><b>${title}</b><span class="muted small">${meta}</span></div>${body}
      <div class="sp-foot muted small">${S0 && S0.ok ? esc(S0.source) + ' · ' : ''}원자료 ${link}${kind === 'us' ? '<br>미국 장이 열려 있으면 장중 가격, 닫혀 있으면 종가 기준이에요. Finviz는 장 전에도 실시간 등락을 보여주고 섹터 안 모든 종목으로 계산해서 숫자가 조금 다를 수 있어요.' : ''}</div></div>`;
  }
  function renderSectors() {
    const box = $('#sectorBox');
    if (!box) return;
    const key = state.secPeriod || 'd1';
    box.innerHTML = `<div class="sec-bar-head"><h3>섹터 등락</h3>
      <div class="pillseg" role="group" aria-label="기간"><button type="button" class="${key === 'd1' ? 'on' : ''}" data-act="sec-period" data-val="d1">1일</button><button type="button" class="${key === 'w1' ? 'on' : ''}" data-act="sec-period" data-val="w1">1주</button></div>
      <button class="btn mini" type="button" data-act="sec-fill" ${state.sectors ? '' : 'disabled'}>상위·하위 섹터를 아래 칸에 넣기</button></div>
      <div class="sec-panels">${sectorPanel('us')}${sectorPanel('kr')}</div>`;
  }
  function sectorFill() {
    const key = state.secPeriod || 'd1';
    const pick = (kind, label) => {
      const S0 = state.sectors && state.sectors[kind];
      if (!S0 || !S0.ok) return null;
      const l = S0.rows.filter((r) => r[key] != null).slice().sort((a, b) => b[key] - a[key]);
      const f = (r) => `${label(r)} ${signed(r[key], 1, '%')}`;
      return { top: l.slice(0, 3).filter((r) => r[key] > 0).map(f).join(', '), bot: l.slice(-3).reverse().filter((r) => r[key] < 0).map(f).join(', ') };
    };
    const us = pick('us', (r) => r.ko), kr = pick('kr', (r) => r.name);
    const tag = key === 'w1' ? '(1주) ' : '';
    const join = (k) => [us && us[k] ? `미국 ${us[k]}` : '', kr && kr[k] ? `한국 ${kr[k]}` : ''].filter(Boolean).join(' / ');
    if (join('top')) setField('초과 상승 섹터', tag + join('top'));
    if (join('bot')) setField('초과 하락 섹터', tag + join('bot'));
    toast('섹터를 칸에 넣었습니다', 'ok');
  }

  function renderDaily() {
    const sig = state.signals || {};
    $('#dailySections').innerHTML = C.daily.map((sec) => {
      const tiles = sec.items.map((id) => tile(id, 'daily')).join('');
      const sigs = sec.signals.map((k) => signalBox(SIGNAL_TITLES[k], sig[k])).join('');
      const manual = (sec.manual || []).map(field).join('');
      let releases = '';
      if (sec.releases) {
        const rows = [];
        for (let i = 1; i <= sec.releases; i++) {
          rows.push(`<div class="rel-row" data-rel="${i}">
            <input type="text" data-key="발표지표${i}_이름" placeholder="지표명 (예: 미국 10월 CPI 전월비)" />
            <input type="number" step="any" data-key="발표지표${i}_예상" placeholder="예상" />
            <input type="number" step="any" data-key="발표지표${i}_실제" placeholder="실제" />
            <input type="number" step="any" data-key="발표지표${i}_이전" placeholder="이전" />
            <span class="rel-surprise" data-surprise="${i}">–</span>
          </div>`);
        }
        releases = `<div class="releases"><div class="rel-head"><span>지표</span><span>예상</span><span>실제</span><span>이전</span><span>서프라이즈</span></div>${rows.join('')}</div>
          <div class="fields">${field({ key: 'GDPNow 추정치(%)', type: 'number', placeholder: '예: 2.4' })}${field({ key: 'GDPNow 이전(%)', type: 'number', placeholder: '예: 2.1' })}</div>`;
      }
      const qs = sec.questions.map((q) => `<li>${esc(q)}</li>`).join('');
      const links = sec.links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('');
      return `<article class="card sec" id="sec-${sec.id}">
        <header class="sec-head">
          <span class="sec-no">${String(sec.no).padStart(2, '0')}</span>
          <div class="sec-titles"><h2>${esc(sec.title)}</h2><p>${esc(sec.lead)}</p></div>
        </header>
        ${tiles ? `<div class="tiles">${tiles}</div>` : ''}
        ${sec.id === 'equity' ? '<div class="sector-box" id="sectorBox"></div>' : ''}
        ${sigs ? `<div class="signals">${sigs}</div>` : ''}
        <div class="links">${links}</div>
        <details class="qs"><summary>생각할 질문</summary><ul>${qs}</ul></details>
        ${releases || manual ? `<details class="qs manual-box"><summary>직접 기록 (선택)</summary>${releases}${manual ? `<div class="fields">${manual}</div>` : ''}
          <label class="check"><input type="checkbox" data-key="확인_${esc(sec.title)}" /> 이 섹션 확인함</label></details>` : ''}
      </article>`;
    }).join('');
  }

  function renderOverview() {
    const sig = state.signals || {};
    const flags = (sig.flags || []).map((f) => `<li>${esc(f)}</li>`).join('');
    const chips = ['curve', 'stockRate', 'alignment', 'dollar', 'korea'].map((k) => {
      const s = sig[k];
      return s ? `<span class="chip ${s.tone}"><b>${esc(SIGNAL_TITLES[k])}</b> ${esc(s.name)}</span>` : '';
    }).join('');
    $('#overview').innerHTML = `
      <div class="ov-left">
        <div class="ov-label">오늘의 자동 신호${sig.signalDate ? ` <span class="sig-date">미국 ${esc(sig.signalDate)} 종가 기준</span>` : ''}</div>
        ${sig.dateMismatch ? `<div class="sig-warn">금리와 주식의 최신 날짜가 달라 신호는 둘 다 있는 ${esc(sig.signalDate)} 기준으로 계산했습니다. 카드에는 각 지표의 최신 값이 표시됩니다.</div>` : ''}
        <div class="chips">${chips || '<span class="muted">데이터를 불러오면 표시됩니다</span>'}</div>
        ${flags ? `<ul class="flags">${flags}</ul>` : ''}
      </div>
      <div class="ov-right" hidden>
        <div class="progress"><div class="bar" id="progBar"></div></div>
        <div class="prog-text" id="progText">0 / ${C.daily.length}</div>
      </div>`;
    updateProgress();
  }

  function updateProgress() {
    const boxes = $$('#dailySections .check input');
    const done = boxes.filter((b) => b.checked).length;
    const bar = $('#progBar');
    if (bar) bar.style.width = (boxes.length ? (done / boxes.length) * 100 : 0) + '%';
    const t = $('#progText');
    if (t) t.textContent = `${done} / ${boxes.length} 섹션 확인`;
  }

  function updateSurprises() {
    $$('[data-surprise]').forEach((el) => {
      const i = el.dataset.surprise;
      const e = parseFloat(($(`[data-key="발표지표${i}_예상"]`) || {}).value);
      const a = parseFloat(($(`[data-key="발표지표${i}_실제"]`) || {}).value);
      if (isNaN(e) || isNaN(a)) { el.textContent = '–'; el.className = 'rel-surprise'; return; }
      const d = a - e;
      el.textContent = d === 0 ? '예상 부합' : `${d > 0 ? '+' : '−'}${Math.abs(+d.toFixed(3))} (${d > 0 ? '상회' : '하회'})`;
      el.className = 'rel-surprise ' + (d > 0 ? 'up' : d < 0 ? 'down' : '');
    });
  }

  // ---------- 결론 패널 ----------
  const STORY_OPTS = ['', '성장', '물가', '정책', '위험 회피·지정학', '실적·개별 이슈', '뚜렷한 동인 없음'];
  const PHASE_OPTS = ['', '골디락스 쪽', '리플레이션 쪽', '침체·디스인플레이션 쪽', '스태그플레이션 우려 쪽', '판단 보류'];
  const guidesOpen = () => store.get('md-guides-open', true);
  const guide = (id, title) => `<details class="guide"${guidesOpen() ? ' open' : ''}><summary>${title}</summary><div class="g-body" id="${id}"></div></details>`;

  function renderConclusion() {
    $('#conclusionPanel').innerHTML = `
      <details class="card concl my-concl" id="myConcl">
        <summary><div class="my-sum"><div><h2>내 결론 직접 쓰기 <span class="muted">선택</span></h2><span class="muted small">쓰고 싶은 날만 펼치세요. 쓴 날은 '나'의 적중률도 채점돼요.</span></div><span class="my-toggle"></span></div></summary>
        <div class="concl-head"><span></span><button class="btn mini ghost" id="toggleGuides" type="button">${guidesOpen() ? '가이드 모두 접기' : '가이드 모두 펴기'}</button></div>
        <p class="hint">AI 결론을 보기 전에 내 생각을 먼저 써 보면 비교가 더 잘 돼요. 각 칸의 가이드는 오늘 데이터에 맞춰 바뀝니다.</p>
        <div class="brief-box">
          <div><b>바쁜 날은 빠른 브리핑</b> <span class="mode-tag" id="modeTag"></span>
            <div class="muted">AI가 결론 칸과 전망을 채웁니다. 시트에 'AI 브리핑'으로 기록돼 직접 쓴 날과 따로 집계됩니다.</div></div>
          <button class="btn" id="briefBtn" type="button">⚡ AI 빠른 브리핑</button>
        </div>
        <div id="debateSummary"></div>

        <div class="fld wide"><span>① 오늘의 동인 — 무엇이 시장을 움직였나</span>
          ${guide('g1', '가이드: 가장 크게 움직인 것 찾기')}
          <textarea data-key="오늘의 동인" rows="2" placeholder="[무엇이] [얼마나] — [왜]"></textarea></div>

        <div class="fld wide"><span>② 어떤 이야기인가</span>
          ${guide('g2', '가이드: 성장 / 물가 / 정책 구분하기')}
          <select data-key="이야기">${STORY_OPTS.map((o) => `<option value="${o}">${o || '선택'}</option>`).join('')}</select></div>

        <div class="fld wide"><span>③ 한국 전이</span>
          ${guide('g3', '가이드: 한국으로 어떻게 넘어왔나')}
          <input type="text" data-key="한국 영향" placeholder="[한국 시장 움직임] — [경로: 금리·달러 / 반도체] — [다르다면 이유]" /></div>

        <div class="fld wide"><span>④ 국면 신호 <em class="auto-phase" id="autoPhase"></em></span>
          ${guide('g4', '가이드: 어느 국면으로 기울었나')}
          <select data-key="국면 판단">${PHASE_OPTS.map((o) => `<option value="${o}">${o || '선택'}</option>`).join('')}</select></div>

        <div class="fld wide"><span>⑤ 기존 뷰 대비</span>
          ${guide('g5', '가이드: 지난 결론과 비교하기')}
          <div class="seg" title="고른 버튼을 한 번 더 누르면 선택이 취소됩니다">${['유지', '강화', '약화', '수정'].map((o) => `<label><input type="radio" name="view" value="${o}" /><span>${o}</span></label>`).join('')}</div>
          <input type="hidden" data-key="뷰 변화" id="viewHidden" />
          <span class="seg-hint">고른 버튼을 한 번 더 누르면 선택이 취소됩니다.</span></div>

        <div class="fld wide"><span>⑥ 다음 체크포인트</span>
          ${guide('g6', '가이드: 내 해석을 확인해줄 다음 이벤트')}
          <input type="text" data-key="다음 체크포인트" placeholder="[이벤트] — [이렇게 나오면 뷰 강화 / 저렇게 나오면 수정]" /></div>

        <div class="fld wide"><span>⑦ 다음 5거래일 전망</span>
          ${guide('g8', '가이드: 전망 쓰는 법과 채점 기준')}
          <div class="fc-grid">${S.FORECASTS.map((f) => `<label class="fld"><span>${esc(f.label)} <em class="muted">보합 ${esc(f.unitText)}</em></span>
            <select data-key="${esc(f.key)}">${['', '상승', '보합', '하락'].map((o) => `<option value="${o}">${o || '전망 안 함'}</option>`).join('')}</select></label>`).join('')}</div>
          <input type="text" data-key="전망 근거" placeholder="전망 근거 한 줄 (예: 인하 기대 후퇴로 금리 상방, 원화 약세 지속)" /></div>

        <div class="fld wide"><span>⑧ 투자 시사점</span>
          ${guide('g9', '가이드: 오늘 매크로가 유리·불리하게 만든 섹터')}
          <input type="text" data-key="투자 시사점" placeholder="[유리한 섹터] — [이유] / [불리한 섹터] — [이유]" /></div>

        <div class="fld wide"><span>종합 해석 (3~5문장)</span>
          ${guide('g7', '가이드: ①~⑥을 문장으로 잇기')}
          <textarea data-key="종합 해석" rows="6" placeholder="동인 → 해석 → 한국 영향 → 국면 신호 → 뷰 변화와 다음 확인 포인트"></textarea></div>

        <div class="ai-block">
          <div class="ai-head"><h3>AI 종합분석</h3><button class="btn" id="aiBtn">AI 분석 받기</button></div>
          <p class="hint">오늘의 데이터·자동 신호·내 결론을 보내, AI 해석과 내 결론에 대한 피드백을 받습니다.</p>
          <div class="ai-out" id="aiOut"><span class="muted">아직 분석하지 않았습니다.</span></div>
        </div>

        <p class="hint">증권사 리포트와의 교차검증은 <a href="#" data-act="goto-brief">오늘의 브리핑</a>에서 합니다.</p>

        <button class="btn primary block" id="saveDaily">구글 시트에 저장</button>
        <div class="save-note" id="saveNote">같은 날짜로 다시 저장하면 그날 기록을 덮어씁니다.</div>
      </details>`;
  }

  // ---------- 결론 가이드 (데이터가 바뀔 때마다 다시 그림) ----------
  function label(id) { return (C.indicators[id] || { label: id }).label; }
  function moveText(m) {
    const d = m.unit === 'bp' ? 1 : 2;
    const u = m.unit === 'bp' ? 'bp' : m.unit === '%' ? '%' : m.unit || '%';
    return `${label(m.id)} ${signed(m.chg, d, u)}`;
  }
  function fieldVal(key) { const el = $(`[data-key="${key}"]`); return el ? el.value.trim() : ''; }
  function setField(key, val, mode) {
    const el = $(`[data-key="${key}"]`);
    if (!el) return;
    if (mode === 'append' && el.value.trim()) el.value = el.value.trim() + '\n' + val;
    else el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.focus();
  }
  function previousRecord() {
    // 이 브라우저에 남은 이전 날짜 초안 중 가장 최근 것 (없으면 시트 기록)
    let best = null;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith('md-draft-')) continue;
        const d = k.slice(9);
        if (d >= state.date) continue;
        const v = store.get(k, {});
        if (!v['종합 해석'] && !v['뷰 변화'] && !v['오늘의 동인']) continue;
        if (!best || d > best.date) best = { date: d, rec: v };
      }
    } catch (e) { /* 저장소 사용 불가 */ }
    if (!best && state.records) {
      const r = state.records.find((x) => x['날짜'] < state.date);
      if (r) best = { date: r['날짜'], rec: r };
    }
    return best;
  }

  function renderGuides() {
    if (!$('#g1')) return;
    const items = state.market ? state.market.items : null;
    const sig = state.signals || {};
    const noData = '<p class="muted">데이터를 불러오면 오늘 기준 가이드가 나옵니다.</p>';

    // ①
    const movers = items ? S.topMovers(items) : [];
    $('#g1').innerHTML = `
      <p><b>1단계. 오늘 평소보다 크게 움직인 것</b> <span class="muted">(평소 하루 변동폭 대비 큰 순서)</span></p>
      ${movers.length ? `<div class="chips">${movers.map((m) => `<span class="chip ${m.chg > 0 ? 'bad' : 'info'}">${esc(moveText(m))}</span>`).join('')}</div>
        <button class="btn mini" data-act="fill-movers" type="button">동인 칸에 넣기</button>` : (items ? '<p class="muted">평소보다 크게 움직인 자산이 없습니다. "뚜렷한 동인 없이 기존 흐름 연장"도 좋은 결론입니다.</p>' : noData)}
      <p><b>2단계. 왜 움직였는지 찾기</b> (위에서부터 순서대로)</p>
      <ol>
        <li>07 발표 지표: 예상보다 높거나 낮게 나온 지표가 있었나?</li>
        <li>06 통화정책: 연준 위원 발언이나 FedWatch 확률 변화가 있었나?</li>
        <li>03 주식 섹터·대형주: 특정 기업 실적이나 업종 이슈인가?</li>
        <li>뉴스 검색: "<i>${movers[0] ? esc(label(movers[0].id)) : '자산명'} 급등(급락) 이유</i>" 처럼 찾아보기</li>
      </ol>
      <p><b>3단계. 쓰는 형식</b> [무엇이] [얼마나] — [왜]. 원인을 못 찾았으면 "원인 확인 필요"라고 남겨도 됩니다.</p>`;

    // ②
    const rec = state.signals ? S.recommendStory(sig) : null;
    $('#g2').innerHTML = `
      ${rec ? `<p class="rec">자동 추천: <b>${esc(rec.pick)}</b> <span class="muted">근거: ${esc(rec.why.join(' · '))}</span>
        <button class="btn mini" data-act="apply-story" data-val="${esc(rec.pick)}" type="button">추천 적용</button></p>` : noData}
      <table class="g-table">
        <tr><th>성장</th><td>금리↑·주가↑(좋은 금리 상승), 구리·러셀 강세, 경기 지표 서프라이즈</td></tr>
        <tr><th>물가</th><td>기대인플레(BEI)·유가가 금리 상승을 주도, 물가 지표 서프라이즈</td></tr>
        <tr><th>정책</th><td>2년물이 주도(플래트닝·불 스티프닝), FedWatch 확률 변화, 연준 발언</td></tr>
        <tr><th>위험 회피</th><td>VIX 20↑, 금·엔화 강세, 하이일드 스프레드 확대</td></tr>
      </table>
      <p class="muted">추천은 규칙에 따른 참고입니다. 뉴스로 확인한 원인이 다르면 내 판단을 고르세요.</p>`;

    // ③
    const it = (id) => (items && items[id] && items[id].ok ? items[id] : null);
    const kospi = it('kospi'), krw = it('usdkrw'), kr10 = it('kr10y'), us10 = it('us10y');
    const soxA = state.signals && items ? S.align(items).items.sox : null;
    const foreign = fieldVal('외국인 순매수 KOSPI(억원)');
    if (items) {
      const krwWon = krw && krw.prev != null ? krw.value - krw.prev : null;
      const facts = [];
      if (kospi) facts.push(`KOSPI ${signed(kospi.chg, 2, '%')}`);
      if (soxA && soxA.ok) facts.push(`미국 반도체 ${signed(soxA.chg, 2, '%')}`);
      if (krwWon != null) facts.push(`원달러 ${signed(krwWon, 1, '원')} (${krwWon > 0 ? '원화 약세' : krwWon < 0 ? '원화 강세' : '보합'})`);
      facts.push(`외국인 ${foreign ? `${Number(foreign).toLocaleString('ko-KR')}억원` : '(08에서 입력)'}`);
      if (kr10 && us10) facts.push(`국고채 10년 ${signed(kr10.chg, 1, 'bp')} vs 미국 10년 ${signed(us10.chg, 1, 'bp')}`);
      state.krFacts = facts.join(', ');
      $('#g3').innerHTML = `
        <p><b>오늘의 사실</b> ${sig.korea ? `<span class="badge ${sig.korea.tone}">${esc(sig.korea.name)}</span>` : ''}</p>
        <p class="mono-sm">${esc(state.krFacts)}</p>
        <button class="btn mini" data-act="fill-korea" type="button">사실 넣기</button>
        <p><b>확인할 질문</b></p>
        <ol>
          <li>금리·달러 경로: 원화가 약해졌나? 외국인이 팔았나?</li>
          <li>반도체 경로: 미국 반도체 방향과 KOSPI 방향이 같았나?</li>
          <li>다르다면: 반도체 말고 어떤 업종이 지수를 끌어내렸나(올렸나)? 국내 정책·정치·중국 이슈는?</li>
        </ol>`;
    } else $('#g3').innerHTML = noData;

    // ④
    const ph = sig.phase;
    $('#g4').innerHTML = ph ? `
      <p class="rec">자동 참고: <b>${esc(ph.name)}</b> <span class="muted">${esc(ph.detail || ph.meaning)}</span>
        ${PHASE_OPTS.includes(ph.name) ? `<button class="btn mini" data-act="apply-phase" data-val="${esc(ph.name)}" type="button">추천 적용</button>` : ''}</p>
      <table class="g-table quad">
        <tr><th></th><th>물가↓</th><th>물가↑</th></tr>
        <tr><th>성장↑</th><td>골디락스</td><td>리플레이션</td></tr>
        <tr><th>성장↓</th><td>침체·디스인플레이션</td><td>스태그플레이션</td></tr>
      </table>
      <p class="muted">하루 데이터로 국면이 바뀌지는 않습니다. "오늘은 어느 쪽으로 기울었나"만 고르고, 3일 이상 같은 쪽이 나오면 의미 있는 변화로 봅니다.</p>` : noData;

    // ⑤
    const prev = previousRecord();
    $('#g5').innerHTML = `
      ${prev ? `<div class="prev"><b>지난 결론 (${esc(prev.date)})</b> ${prev.rec['뷰 변화'] ? `· ${esc(prev.rec['뷰 변화'])}` : ''} ${prev.rec['국면 판단'] ? `· ${esc(prev.rec['국면 판단'])}` : ''}
        <div class="muted">${esc((prev.rec['종합 해석'] || prev.rec['오늘의 동인'] || '').slice(0, 160))}</div></div>`
        : '<p class="muted">비교할 지난 결론이 없습니다. 오늘은 <b>유지</b>를 고르고, 종합 해석에 "내 기본 뷰"를 한 줄 적어 두세요. 그게 내일의 기준이 됩니다.</p>'}
      <table class="g-table">
        <tr><th>유지</th><td>오늘 데이터가 기존 뷰와 맞거나 의미 있는 변화가 없음</td></tr>
        <tr><th>강화</th><td>기존 뷰를 뒷받침하는 근거가 하나 더 생김</td></tr>
        <tr><th>약화</th><td>기존 뷰와 다른 신호가 나왔지만 아직 하나뿐</td></tr>
        <tr><th>수정</th><td>여러 지표가 같은 방향으로 기존 뷰와 반대를 가리킴</td></tr>
      </table>`;

    // ⑥
    const story = fieldVal('이야기') || (rec && rec.pick) || '';
    const nextMap = {
      성장: '고용(NFP·신규실업수당청구), ISM, 소매판매, GDPNow 변화',
      물가: 'CPI·PPI·PCE, 기대인플레(BEI), 유가',
      정책: 'FOMC, 연준 위원 발언, FedWatch 확률 변화, 2년물',
      '위험 회피·지정학': 'VIX, 하이일드 스프레드, 관련 뉴스 후속 보도',
    };
    $('#g6').innerHTML = `
      <p>내 해석이 <b>맞는지 확인하거나 뒤집을 수 있는</b> 이벤트를 고릅니다.</p>
      ${story && nextMap[story] ? `<p class="rec">"${esc(story)}" 이야기라면: <b>${esc(nextMap[story])}</b></p>` : ''}
      <p>한국은 <b>외국인 순매수 지속 여부</b>, <b>수출 데이터(매월 1일·11일·21일경)</b>, 금통위를 함께 봅니다.</p>
      <p>형식: [이벤트] — [이렇게 나오면 뷰 강화 / 저렇게 나오면 수정] · <a href="https://kr.investing.com/economic-calendar/" target="_blank" rel="noopener">경제 캘린더</a></p>`;

    // ⑦ 전망
    const mine = state.scored ? state.scored.sum : null;
    $('#g8').innerHTML = `
      <p>지금 정보로 <b>5거래일 뒤</b> 각 지표가 오를지, 내릴지, 비슷할지 고릅니다. 모르면 "전망 안 함"으로 두세요.</p>
      <table class="g-table">
        <tr><th>채점</th><td>점검일 <b>직전 거래일 종가</b> → 그로부터 <b>5거래일 뒤 종가</b> 변화로 자동 채점 ('기록과 적중률' 메뉴)</td></tr>
        <tr><th>보합</th><td>${S.FORECASTS.map((f) => `${esc(f.label)} ${esc(f.unitText)}`).join(' · ')} 안이면 보합</td></tr>
      </table>
      ${items ? `<p class="muted">참고: 지난 5거래일 변화 — ${S.FORECASTS.map((f) => { const x = items[f.id]; return x && x.ok && x.chg5 != null ? `${esc(f.label)} ${signed(x.chg5, x.chgUnit === 'bp' ? 1 : 2, x.chgUnit === 'bp' ? 'bp' : '%')}` : null; }).filter(Boolean).join(' · ')}</p>` : ''}
      ${mine && mine.all.total ? `<p>내 적중률: <b>${pct(mine.all)}</b> (${mine.all.hit}/${mine.all.total}) ${S.FORECASTS.map((f) => mine.byAsset[f.key].total ? `· ${esc(f.label)} ${pct(mine.byAsset[f.key])}` : '').join(' ')}</p>` : '<p class="muted">\'기록과 적중률\' 메뉴를 한 번 열면 내 적중률이 여기 보입니다.</p>'}
      <p>근거는 ①~④에서 쓴 이야기와 이어지게 씁니다. 예: "물가 이야기 → 금리 상승·원화 약세".</p>`;

    // ⑧ 투자 시사점
    const sv = sig.sectors;
    const krSect = fieldVal('업종 상위·하위');
    const row = (x) => `<tr><th>${esc(x.sector)}</th><td>${esc(x.why.join(' · '))}</td></tr>`;
    $('#g9').innerHTML = sv ? `
      <p>오늘 신호로 본 <b>교과서적 연결</b>입니다. 실제 업종 움직임과 비교해서 맞는지 확인하세요.</p>
      ${sv.fav.length ? `<p><b class="t-bull">유리</b></p><table class="g-table">${sv.fav.map(row).join('')}</table>` : ''}
      ${sv.unfav.length ? `<p><b class="t-bear">불리</b></p><table class="g-table">${sv.unfav.map(row).join('')}</table>` : ''}
      ${sv.mixed.length ? `<p class="muted">엇갈림: ${sv.mixed.map((x) => `${esc(x.sector)} (유리: ${esc(x.fav.join(', '))} / 불리: ${esc(x.unfav.join(', '))})`).join(' · ')}</p>` : ''}
      ${!sv.fav.length && !sv.unfav.length ? '<p class="muted">오늘은 섹터로 이어질 만큼 뚜렷한 신호가 없습니다.</p>' : ''}
      <p><b>실제 한국 업종</b> ${krSect ? esc(krSect) : '<span class="muted">08 한국 전이의 "업종 상위·하위"를 입력하면 여기서 비교합니다.</span>'}</p>
      <p>매크로대로 움직였으면 "매크로 주도", 다르게 움직였으면 "업종 고유 이슈"일 가능성이 큽니다. 이 차이가 좋은 분석 포인트예요.</p>
      <button class="btn mini" data-act="fill-sector" type="button">유리·불리 섹터 넣기</button>` : noData;

    // 종합 해석
    $('#g7').innerHTML = `
      <ol>
        <li><b>동인</b>: 오늘 무엇이 시장을 움직였나 (①)</li>
        <li><b>해석</b>: 그건 어떤 이야기이고, 근거가 된 자산 움직임은 (②)</li>
        <li><b>한국</b>: 한국에는 어떻게 넘어왔나 (③)</li>
        <li><b>국면·뷰</b>: 어느 쪽으로 기울었고, 내 뷰는 어떻게 되나 (④⑤)</li>
        <li><b>다음</b>: 무엇으로 확인할 건가 (⑥)</li>
      </ol>
      <button class="btn mini" data-act="fill-summary" type="button">내가 쓴 ①~⑥으로 틀 만들기</button>
      <span class="muted">틀을 만든 뒤 내 말로 다듬으세요.</span>`;
  }

  function guideAction(act, val) {
    if (act === 'fill-movers') {
      const movers = S.topMovers(state.market.items);
      setField('오늘의 동인', `${movers.map(moveText).join(', ')} — 원인: `, 'append');
    } else if (act === 'apply-story') { setField('이야기', val); renderGuides(); }
    else if (act === 'apply-phase') setField('국면 판단', val);
    else if (act === 'fill-korea') setField('한국 영향', `${state.krFacts} — 이유: `);
    else if (act === 'fill-sector') {
      const sv = (state.signals || {}).sectors;
      if (!sv) return;
      const f = sv.fav.slice(0, 2).map((x) => x.sector).join(', ');
      const u = sv.unfav.slice(0, 2).map((x) => x.sector).join(', ');
      setField('투자 시사점', [f && `유리: ${f}`, u && `불리: ${u}`].filter(Boolean).join(' / ') + ' — 이유: ');
    }
    else if (act === 'fill-summary') {
      // 아직 안 채운 '— 원인:' 같은 꼬리표와 끝 마침표는 빼고 문장으로 잇기
      const f = (k, d) => (fieldVal(k).replace(/\s*—\s*(원인|이유):\s*$/, '').replace(/[.\s]+$/, '')) || d;
      const sig = state.signals || {};
      const basis = [sig.stockRate && sig.stockRate.name, sig.curve && sig.curve.name].filter(Boolean).join(', ');
      const text = `${f('오늘의 동인', '[오늘의 동인]')}. ` +
        `이는 ${f('이야기', '[이야기]')} 쪽 이야기로 보이며, 근거는 ${basis || '[자산 움직임]'}이다. ` +
        `한국은 ${f('한국 영향', '[한국 전이]')}. ` +
        `국면은 ${f('국면 판단', '[국면]')}으로 기울었고, 기존 뷰는 ${f('뷰 변화', '[유지/강화/약화/수정]')}한다. ` +
        (fieldVal('투자 시사점') ? `투자 측면에서는 ${f('투자 시사점', '')}. ` : '') +
        `다음은 ${f('다음 체크포인트', '[체크포인트]')}로 확인한다.`;
      if (fieldVal('종합 해석') && !confirm('종합 해석에 이미 쓴 내용이 있어요. 틀로 바꿀까요?')) return;
      setField('종합 해석', text);
    }
  }


  // ---------- AI 리서치센터 (TradingAgents 구조를 매크로에 적용) ----------
  const STAGES = [
    { id: 'analyst', name: '애널리스트 팀' },
    { id: 'open', name: '첫 발언' },
    { id: 'rebut', name: '반박' },
    { id: 'risk', name: '리스크 팀' },
    { id: 'chief', name: '센터장' },
  ];
  const ANALYSTS = [
    { id: 'rate', mark: '금', name: 'RATE', role: '금리 애널리스트' },
    { id: 'fx', mark: '환', name: 'FX', role: '달러·원자재 애널리스트' },
    { id: 'eq', mark: '주', name: 'EQUITY', role: '주식·심리 애널리스트' },
    { id: 'kr', mark: '한', name: 'KOREA', role: '한국 애널리스트' },
  ];

  function analystReports() {
    if (!state.market) return null;
    const items = state.market.items;
    const A = S.align(items).items;
    const sig = state.signals || {};
    const one = (src, id) => {
      const x = src[id];
      if (!x || !x.ok) return null;
      const def = C.indicators[id] || { label: id, digits: 2 };
      const u = x.chgUnit === 'bp' ? 'bp' : x.chgUnit === '%' ? '%' : x.chgUnit;
      return `${def.label} ${num(x.value, def.digits)} (${signed(x.chg, x.chgUnit === 'bp' ? 1 : 2, u)})`;
    };
    const sigLine = (k) => (sig[k] ? `${SIGNAL_TITLES[k]}: ${sig[k].name} — ${sig[k].meaning}` : null);
    const d = collect($('#view-daily'));
    const manual = (k) => (d[k] ? `${k}: ${d[k]}` : null);
    const reps = {
      rate: [one(A, 'us2y'), one(A, 'us10y'), one(A, 't10y2y'), sigLine('curve'), sigLine('decompose'), manual('다음 FOMC 인하 확률(%)'), manual('인하 확률 전일 대비(%p)')],
      fx: [one(A, 'dxy'), one(items, 'usdkrw'), sigLine('dollar'), one(A, 'wti'), one(A, 'brent'), one(A, 'wtibrent'), one(A, 'gold'), one(A, 'copper')],
      eq: [one(A, 'dow'), one(A, 'spx'), one(A, 'ndx'), one(A, 'rut'), one(A, 'sox'), sigLine('alignment'), sigLine('stockRate'), one(A, 'vix'), sigLine('hy'), manual('초과 상승 섹터'), manual('초과 하락 섹터')],
      kr: [one(items, 'kospi'), one(items, 'kosdaq'), one(items, 'kr3y'), one(items, 'kr10y'), items.krus10y && items.krus10y.ok ? `한미 10년물 금리차 ${items.krus10y.value}bp` : null, sigLine('korea'), manual('외국인 순매수 KOSPI(억원)'), manual('업종 상위·하위')],
    };
    Object.keys(reps).forEach((k) => { reps[k] = reps[k].filter(Boolean); });
    return reps;
  }
  function analystText() {
    const r = analystReports();
    if (!r) return '';
    const sig = state.signals || {};
    return (sig.signalDate ? `신호 기준일: 미국 ${sig.signalDate} 종가\n` : '') +
      ANALYSTS.map((a) => `[${a.name} · ${a.role}]\n${r[a.id].map((l) => `- ${l}`).join('\n')}`).join('\n\n') +
      (sig.sectors && S.sectorText(sig.sectors) ? `\n\n[섹터 연결 (규칙 기반)]\n${S.sectorText(sig.sectors)}` : '');
  }
  function debateSummaryText(d) {
    if (!d || !d.open) return '';
    const L = [];
    const side = (n, x) => { if (x) L.push(`${n}: ${x.claim || ''}`); };
    side('BULL', d.open.bull); side('BEAR', d.open.bear);
    if (d.rebut) {
      if (d.rebut.bull) L.push(`BULL 반박: ${d.rebut.bull.rebuttal || ''}`);
      if (d.rebut.bear) L.push(`BEAR 반박: ${d.rebut.bear.rebuttal || ''}`);
    }
    if (d.risk) L.push(`리스크 팀: ${d.risk.balance || ''} — ${d.risk.reason || ''} (쟁점: ${d.risk.key_issue || ''})`);
    return L.join('\n');
  }
  const fcChips = (fc) => (fc ? `<div class="fc-chips">${S.FORECASTS.map((f) => {
    const v = fc[f.key.replace('전망_', '')];
    return v ? `<span class="chip ${v === '상승' ? 'bad' : v === '하락' ? 'info' : ''}">${esc(f.label)} ${esc(v)}</span>` : '';
  }).join('')}</div>` : '');

  function renderCenter() {
    const box = $('#centerPanel');
    if (!box) return;
    const D = state.debate || {};
    const reps = analystReports();
    const run = state.debateRun || {};
    const stageDone = { analyst: !!D.analystAt, open: !!D.open, rebut: !!D.rebut, risk: !!D.risk, chief: !!D.chiefAt };
    const status = (id) => (run.stage === id ? 'run' : stageDone[id] ? 'done' : 'wait');
    const chip = (st, run, done) => `<span class="st st-${st}">${st === 'run' ? run : st === 'done' ? done : '대기'}</span>`;
    const model = (k) => (D.models && D.models[k] ? `<span class="model-tag">${esc(D.models[k])}</span>` : '');
    const err = run.error ? `<div class="err">${esc(run.error)} <button class="btn mini" data-act="debate-resume" type="button">이 단계부터 다시</button></div>` : '';

    const side = (who, cls, o, rb) => `
      <div class="agent debater ${cls}">
        <div class="ag-head"><span class="ag-mark">${who === 'BULL' ? '↑' : '↓'}</span><div><b>${who}</b><div class="muted">${who === 'BULL' ? '낙관론 연구원' : '비관론 연구원'}</div></div>${chip(run.stage === 'open' || (run.stage === 'rebut' && o) ? 'run' : o ? 'done' : 'wait', run.stage === 'rebut' ? '반박 준비 중…' : '발언 준비 중…', rb ? '반박 완료' : '발언 완료')}</div>
        ${o ? `<p class="claim">${esc(o.claim || '')}</p>
          <ol class="pts">${(o.points || []).map((p) => `<li>${esc(p)}</li>`).join('')}</ol>
          ${o.korea ? `<p class="kr"><b>한국</b> ${esc(o.korea)}</p>` : ''}
          ${fcChips(o.forecast)}` : '<p class="muted">토론을 시작하면 발언합니다.</p>'}
        ${rb ? `<div class="bubble"><b>반박</b> ${esc(rb.rebuttal || '')}</div><div class="bubble soft"><b>인정</b> ${esc(rb.concede || '')}</div>` : ''}
      </div>`;

    box.innerHTML = `
      <div class="card center-hero">
        <div class="wk-head"><div><h2>AI 리서치센터</h2>
          <p class="hint">TradingAgents(Xiao et al., 2024)의 조직 구조를 데일리 매크로에 맞게 옮겼습니다. 애널리스트 보고서 → 강세·약세 토론 → 리스크 팀 평가를 본 뒤, <b>센터장인 내가</b> 결론을 씁니다.</p></div>
          <div class="rec-actions"><button class="btn primary" id="debateStart" type="button" ${run.stage ? 'disabled' : ''}>${D.open ? '처음부터 다시' : '토론 시작'}</button></div></div>
        <ol class="stage-bar">${STAGES.map((st) => `<li class="${status(st.id)}">${esc(st.name)}</li>`).join('')}</ol>
        ${D.auto ? `<p class="auto-note">아침 자동 브리핑에서 불러온 토론입니다${D.models && D.models.morning ? ` (${esc(D.models.morning)})` : ''}. 바로 센터장 결론으로 넘어가면 됩니다.</p>` : ''}
        ${!D.open && !run.stage ? `<div class="auto-load"><span>${state.morningMsg ? esc(state.morningMsg) : '평일 아침 7~8시에 자동으로 토론이 만들어집니다.'}</span><button class="btn" data-act="load-morning" type="button">오늘 아침 자동 토론 불러오기</button></div>` : ''}
        ${err}
      </div>

      <h3 class="center-h">1. 애널리스트 팀 <span class="muted">규칙 기반 자동 신호 · AI 호출 없음</span></h3>
      <div class="agents4">${ANALYSTS.map((a, i) => {
        const shown = D.analystAt || (run.stage === 'analyst' && (run.shown || 0) > i);
        const st = run.stage === 'analyst' ? ((run.shown || 0) > i ? 'done' : 'run') : D.analystAt ? 'done' : 'wait';
        return `<div class="agent">
          <div class="ag-head"><span class="ag-mark">${a.mark}</span><div><b>${a.name}</b><div class="muted">${a.role}</div></div>${chip(st, '분석 중…', '보고서 완료')}</div>
          ${shown && reps ? `<ul class="rep">${reps[a.id].map((l) => `<li>${esc(l)}</li>`).join('') || '<li class="muted">데이터 없음</li>'}</ul>` : '<p class="muted">대기 중</p>'}
        </div>`; }).join('')}</div>

      <h3 class="center-h">2. 리서치 팀 토론 ${model('open')} ${model('rebut')}</h3>
      <div class="debate">
        ${side('BULL', 'bull', D.open && D.open.bull, D.rebut && D.rebut.bull)}
        <div class="vs">VS</div>
        ${side('BEAR', 'bear', D.open && D.open.bear, D.rebut && D.rebut.bear)}
      </div>

      <h3 class="center-h">3. 리스크 팀 ${model('risk')}</h3>
      <div class="agent risk">
        <div class="ag-head"><span class="ag-mark">R</span><div><b>RISK</b><div class="muted">중립 평가 · 판단이 뒤집힐 조건</div></div>${chip(status('risk'), '평가 중…', '평가 완료')}</div>
        ${D.risk ? `
          <p class="claim"><span class="badge ${D.risk.balance === 'BULL 우세' ? 'good' : D.risk.balance === 'BEAR 우세' ? 'bad' : 'neutral'}">${esc(D.risk.balance || '')}</span> ${esc(D.risk.reason || '')}</p>
          <p><b>핵심 쟁점</b> ${esc(D.risk.key_issue || '')}</p>
          <div class="wrong2"><div><b>BULL이 틀렸다고 볼 신호</b><p>${esc(D.risk.bull_wrong_if || '')}</p></div><div><b>BEAR가 틀렸다고 볼 신호</b><p>${esc(D.risk.bear_wrong_if || '')}</p></div></div>
          ${(D.risk.scenarios || []).length ? `<table class="g-table"><tr><th>시나리오</th><th>계기</th><th>예상 반응</th></tr>${D.risk.scenarios.map((x) => `<tr><td><b>${esc(x.name || '')}</b></td><td>${esc(x.trigger || '')}</td><td>${esc(x.reaction || '')}</td></tr>`).join('')}</table>` : ''}
          ${(D.risk.checkpoints || []).length ? `<p><b>다음 확인</b> ${D.risk.checkpoints.map(esc).join(' · ')}</p>` : ''}` : '<p class="muted">토론이 끝나면 평가합니다.</p>'}
      </div>

      <h3 class="center-h">4. 센터장</h3>
      <div class="agent chief">
        <p>토론을 다 들었으면 이제 <b>내가 센터장</b>으로 결론을 씁니다. BULL과 BEAR 중 무엇을 받아들이고 무엇을 남겨둘지 정하세요.</p>
        <div class="chief-actions">
          <button class="btn primary" data-act="goto-conclusion" type="button" ${D.risk ? '' : 'disabled'}>내가 결론 쓰기</button>
          <button class="btn" data-act="ai-chief" type="button" ${D.risk && !run.stage ? '' : 'disabled'}>${run.stage === 'chief' ? 'AI 센터장 작성 중…' : 'AI 센터장 결론 만들기'}</button>
        </div>
        <p class="muted">AI 센터장 결론은 '오늘의 브리핑' 탭에 표시되고, 내 결론과는 따로 저장돼 출처별 적중률로 비교됩니다.</p>
      </div>`;
    renderDebateSummary();
  }

  function renderDebateSummary() {
    const box = $('#debateSummary');
    if (!box) return;
    const D = state.debate || {};
    if (!D.open) { box.innerHTML = ''; return; }
    box.innerHTML = `<details class="guide debate-sum" open><summary>AI 리서치센터 토론 요약</summary><div class="g-body">
      <p><b class="t-bull">BULL</b> ${esc(D.open.bull ? D.open.bull.claim : '')}</p>
      <p><b class="t-bear">BEAR</b> ${esc(D.open.bear ? D.open.bear.claim : '')}</p>
      ${D.risk ? `<p><b>리스크 팀</b> ${esc(D.risk.balance || '')} · 쟁점: ${esc(D.risk.key_issue || '')}</p>` : ''}
      <button class="btn mini" data-act="goto-center" type="button">토론 전체 보기</button></div></details>`;
  }

  async function debateCall(stage) {
    const d = collect($('#view-daily'));
    const prev = previousRecord();
    const j = await api('/api/debate', { method: 'POST', body: JSON.stringify({
      stage, date: state.date, analystText: analystText(), dataText: dataText(), manualText: manualText(d),
      previousText: prev ? `${prev.date}: 뷰 ${prev.rec['뷰 변화'] || '-'}, ${prev.rec['종합 해석'] || prev.rec['오늘의 동인'] || ''}` : '',
      debate: state.debate,
    }) });
    state.debate.models = Object.assign({}, state.debate.models, { [stage]: j.model });
    return j.data;
  }

  async function runDebate(fromStage) {
    if (!state.market) { toast('시장 데이터를 먼저 불러와 주세요', 'err'); return; }
    const order = ['analyst', 'open', 'rebut', 'risk'];
    let start = fromStage ? order.indexOf(fromStage) : 0;
    if (start < 0) start = 0;
    if (start === 0) state.debate = { models: {} };
    state.debateRun = {};
    try {
      for (let i = start; i < order.length; i++) {
        const st = order[i];
        state.debateRun = { stage: st, shown: 0 };
        renderCenter(); renderBrief();
        if (st === 'analyst') {
          for (let k = 1; k <= ANALYSTS.length; k++) {
            await new Promise((r) => setTimeout(r, 350));
            state.debateRun.shown = k;
            renderCenter();
          }
          state.debate.analystAt = new Date().toISOString();
        } else {
          state.debate[st] = await debateCall(st);
        }
        saveDraft();
      }
      state.debateRun = {};
      toast('토론이 끝났습니다. 이제 센터장으로 결론을 쓰세요', 'ok');
    } catch (e) {
      state.debateRun = { error: `${STAGES.find((x) => x.id === state.debateRun.stage).name} 단계 실패: ${e.message}`, failed: state.debateRun.stage };
    }
    renderCenter(); renderBrief();
  }

  async function runChief() {
    state.debateRun = { stage: 'chief' };
    renderCenter(); renderBrief();
    try {
      const b = await debateCall('chief');
      state.debate.chiefAt = new Date().toISOString();
      state.debateRun = {};
      state.aiConcl = b || {};
      state.aiSrc = { source: '지금 생성', at: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }), model: (state.debate.models || {}).chief || '' };
      saveDraft();
      toast('AI 센터장 결론이 나왔습니다. 오늘의 브리핑에서 확인하세요', 'ok');
    } catch (e) {
      state.debateRun = { error: `센터장 단계 실패: ${e.message}`, failed: 'chief' };
    }
    renderCenter(); renderBrief();
  }

  // 아침 자동 브리핑(시트 '자동 브리핑' 탭)에서 오늘 토론 불러오기
  async function loadMorning(silent) {
    try {
      const j = await api('/api/history?sheet=' + encodeURIComponent('자동 브리핑') + '&limit=10');
      const row = pickRow(j.rows, '토론 JSON') || (j.rows || []).find((r) => r['날짜'] === state.date);
      if (!row || !row['토론 JSON']) {
        state.morningMsg = row ? `오늘 아침 브리핑은 있지만 AI 토론이 없습니다 (${row['AI 오류'] || '오류'}). 토론 시작을 눌러 직접 만들 수 있어요.` : `${state.date} 아침 자동 브리핑이 아직 없습니다.`;
        if (!silent) toast(state.morningMsg, 'err');
      } else {
        state.debate = JSON.parse(row['토론 JSON']);
        if (row['AI 결론 JSON']) {
          state.aiConcl = JSON.parse(row['AI 결론 JSON']);
          state.aiSrc = { source: '아침 자동' + fromNote(row), at: row['생성시각'] || '', model: row['모델'] || '' };
        }
        state.morningMsg = '';
        if (row['날짜'] === state.date) saveDraft(); // 지난 결과를 보여줄 때는 오늘 기록으로 저장하지 않음
        if (!silent) toast('오늘 아침 자동 토론을 불러왔습니다', 'ok');
      }
    } catch (e) {
      state.morningMsg = '';
      if (!silent) toast(e.message, 'err');
    }
    renderCenter(); renderBrief();
  }

  // 메뉴에 없는 화면(리서치센터·이벤트일·주간 점검)은 부모 메뉴를 켠 채로 보여줌
  const NAV_PARENT = { center: 'brief', event: 'daily', weekly: 'daily' };
  function showView(name) {
    const nav = NAV_PARENT[name] || name;
    $$('.tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === nav));
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
    if (name === 'records' && !state.records) loadRecords();
    if (name === 'industry' && state.industryTried !== state.date) { state.industryTried = state.date; loadIndustry(true); }
    if (name === 'company' && state.companyTried !== state.date) { state.companyTried = state.date; loadCompany(true); }
    if (name === 'center' && !(state.debate && state.debate.open) && state.morningTried !== state.date) { state.morningTried = state.date; loadMorning(true); }
    window.scrollTo(0, 0);
  }
  function gotoTab(name) { showView(name); }


  // ---------- 오늘의 브리핑 (읽기 중심 + 교차검증) ----------
  const CONCL_ROWS = ['오늘의 동인', '이야기', '한국 영향', '국면 판단', '뷰 변화', '다음 체크포인트', '투자 시사점'];
  function aiConclText() {
    const b = state.aiConcl;
    if (!b) return '';
    const L = CONCL_ROWS.concat(['종합 해석']).filter((k) => b[k]).map((k) => `${k}: ${b[k]}`);
    if (b['전망']) L.push(`5거래일 전망: ${Object.entries(b['전망']).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    return L.join('\n');
  }
  // AI가 쓴 모든 문장 (결론 + 토론) — 숫자 대조용
  function aiAllText() {
    const parts = [aiConclText()];
    const D = state.debate || {};
    ['bull', 'bear'].forEach((k) => { const x = D.open && D.open[k]; if (x) parts.push(x.claim, ...(x.points || []), x.korea); });
    if (D.rebut) ['bull', 'bear'].forEach((k) => { const x = D.rebut[k]; if (x) parts.push(x.rebuttal, x.concede); });
    if (D.risk) parts.push(D.risk.reason, D.risk.key_issue, D.risk.bull_wrong_if, D.risk.bear_wrong_if);
    return parts.filter(Boolean).join('\n');
  }
  function verifyNow() {
    if (!state.market) return null;
    const list = S.verifyClaims(aiAllText(), state.market.items);
    const n = (st) => list.filter((x) => x.status === st).length;
    return { list, ok: n('일치'), bad: n('불일치'), na: list.length - n('일치') - n('불일치') };
  }

  function renderBriefShell() {
    $('#briefPanel').innerHTML = `
      <div id="briefBody"></div>
      <div class="card" id="crossCard">
        <h2>교차검증 <span class="muted">AI 분석이 맞는지 세 가지로 확인</span></h2>
        <div class="x-sum" id="crossSum"></div>
        <details class="x-det" id="xData"><summary><b>① 데이터 대조</b><span class="muted">AI 문장 속 숫자를 실제 데이터와 비교 (자동)</span></summary><div id="crossAuto"></div></details>
        <details class="x-det" id="xReport"><summary><b>② 증권사 리포트 대조</b><span class="muted">오늘 시황 리포트 PDF를 올려 AI 결론과 비교</span></summary>
          <div class="report-block cross-report">
          <ol class="steps">
            <li><a href="https://consensus.hankyung.com/analysis/list?skinType=market" target="_blank" rel="noopener">한경컨센서스 시장 리포트</a>에서 오늘 날짜의 데일리·시황 리포트를 하나 고릅니다.</li>
            <li>PDF를 올리거나 핵심 부분을 붙여넣고 <b>AI로 교차검증</b>을 누르면, 오늘의 결론과 일치도·다른 점·숫자 차이·보완 제안을 정리합니다.</li>
          </ol>
          <label class="fld wide"><span>참고 리포트</span><input type="text" data-key="참고 리포트" placeholder="증권사 · 리포트 제목" /></label>
          <div class="fld wide"><span>리포트 PDF (3MB 이하)</span>
            <div class="file-row"><input type="file" id="reportFile" accept="application/pdf" /><button class="btn ghost" id="clearFile" type="button">지우기</button></div></div>
          <label class="fld wide"><span>또는 리포트 내용 붙여넣기</span><textarea id="reportText" rows="3" placeholder="리포트의 결론·전망 부분 (원문은 저장하지 않습니다)"></textarea></label>
          <button class="btn block-soft" id="compareBtn" type="button">AI로 교차검증</button>
          <div class="ai-out" id="cmpOut"><span class="muted">리포트를 올리고 교차검증을 누르세요.</span></div>
          <label class="fld wide"><span>교차검증 메모</span><textarea data-key="리포트 비교 메모" rows="2" placeholder="받아들일 점 / 고칠 점"></textarea></label>
        </div>
        </details>
        <details class="x-det" id="xScore"><summary><b>③ 사후 채점</b><span class="muted">출처별 5거래일 전망 적중률</span></summary>
        <div id="crossScore"></div></details>
        <button class="btn primary block" id="saveBrief" type="button">오늘 브리핑 시트에 저장</button>
        <div class="save-note" id="saveNoteBrief">AI 결론·전망·교차검증 결과가 그날 기록에 함께 저장돼 나중에 적중률이 채점됩니다.</div>
      </div>`;
  }

  // 브리핑 맨 위: 오늘 꼭 보는 숫자 6개 (한국식 등락색)
  function areaSpark(arr) {
    if (!arr || arr.length < 3) return '';
    const a = arr.slice(-40);
    const w = 120, h = 36;
    const min = Math.min(...a), max = Math.max(...a), span = max - min || 1;
    const xy = a.map((v, i) => [(i / (a.length - 1)) * w, h - 3 - ((v - min) / span) * (h - 8)]);
    const line = xy.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ');
    return `<svg class="kpi-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polygon points="0,${h} ${line} ${w},${h}" /><polyline points="${line}" /></svg>`;
  }
  function keyStrip() {
    if (!state.market) return '';
    const items = state.market.items;
    const pick = [['us10y', '미국 10년물'], ['us2y', '미국 2년물'], ['usdkrw', '원달러'], ['spx', 'S&P500'], ['kospi', 'KOSPI'], ['vix', 'VIX']];
    const cells = pick.map(([id, label]) => {
      const it = items[id];
      if (!it || !it.ok) return '';
      const def = C.indicators[id] || { digits: 2 };
      const u = it.chgUnit === 'bp' ? 'bp' : '%';
      const dir = it.chg > 0 ? 'up' : it.chg < 0 ? 'down' : '';
      return `<div class="kpi"><div class="kpi-top"><span class="kpi-l">${esc(label)}</span><span class="pill ${dir}">${signed(it.chg, u === 'bp' ? 1 : 2, u)}</span></div>
        <div class="kpi-v">${num(it.value, def.digits)}${def.unit === '%' ? '<small>%</small>' : ''}</div>${areaSpark(it.spark)}</div>`;
    }).join('');
    return cells ? `<div class="kpi-grid">${cells}</div>` : '';
  }
  function niceDate(d) {
    const t = new Date(d + 'T00:00:00+09:00');
    if (isNaN(t)) return d;
    return `${t.getMonth() + 1}월 ${t.getDate()}일 ${'일월화수목금토'[t.getDay()]}요일`;
  }

  function renderBrief() {
    const body = $('#briefBody');
    if (!body) return;
    const b = state.aiConcl;
    const D = state.debate || {};
    const sig = state.signals || {};
    const run = state.debateRun || {};
    const busy = !!run.stage;
    const stageName = busy ? (STAGES.find((x) => x.id === run.stage) || {}).name : '';
    const src = state.aiSrc;
    const fc = b && b['전망'] ? `<div class="fc-grid">${S.FORECASTS.map((f) => { const v = b['전망'][f.key.replace('전망_', '')]; return v ? `<div class="fc-cell"><span>${esc(f.label)}</span><b class="${v === '상승' ? 'up' : v === '하락' ? 'down' : ''}">${v === '상승' ? '▲ ' : v === '하락' ? '▼ ' : ''}${esc(v)}</b></div>` : ''; }).join('')}</div>` : '';
    const sigRows = ['curve', 'stockRate', 'alignment', 'dollar', 'korea', 'phase'].map((k) => sig[k] ? `<li><span class="sg-l">${esc(SIGNAL_TITLES[k])}</span><span class="sg-v ${sig[k].tone}">${esc(sig[k].name)}</span></li>` : '').join('');
    const sv = sig.sectors;
    const meta = `${src ? `${esc(src.source)}${src.at ? ` · ${esc(src.at)}` : ''}${src.model ? ` · ${esc(src.model)}` : ''}` : '아직 오늘 브리핑이 없습니다'}${sig.signalDate ? ` · 미국 ${esc(sig.signalDate)} 종가 기준` : ''}`;
    body.innerHTML = `
      <header class="page-head">
        <div>
          <div class="ph-kicker">아침 브리핑</div>
          <h1 class="ph-title">${esc(niceDate(state.date))}</h1>
          <div class="ph-meta">${meta}</div>
        </div>
        <div class="rec-actions">
          <button class="btn" data-act="load-morning" type="button" ${busy ? 'disabled' : ''}>아침 브리핑 불러오기</button>
          <button class="btn primary" id="briefMake" type="button" ${busy ? 'disabled' : ''}>${busy ? `${esc(stageName)} 진행 중…` : b ? '다시 만들기' : '지금 브리핑 만들기'}</button>
        </div>
      </header>
      ${run.error ? `<div class="err">${esc(run.error)} <button class="btn mini" data-act="debate-resume" type="button">이 단계부터 다시</button></div>` : ''}
      ${keyStrip()}

      <div class="bento">
        ${b ? `<section class="card concl-hero span-8">
          <div class="ch-top"><span class="ch-l">오늘의 결론 · AI 센터장</span><span class="ch-warn">교차검증 필요</span></div>
          ${D.headline ? `<p class="ch-head">${esc(D.headline)}</p>` : ''}
          <p class="ch-text">${esc(b['종합 해석'] || '')}</p>
          <div class="ch-fc"><span class="ch-l">5거래일 뒤 전망</span>${fc}</div>
          <div class="ch-links"><a href="#" data-act="goto-center">토론 전체 보기</a><a href="#" data-act="copy-ai-concl">내 결론 칸에 복사해서 고치기</a></div>
        </section>` : `<section class="card concl-hero empty span-8">
          <span class="ch-l">오늘의 결론</span>
          ${D.headline ? `<p class="ch-head">${esc(D.headline)}</p>` : ''}
          <p class="ch-text">${state.morningMsg ? esc(state.morningMsg) + ' ' : ''}평일 아침 7~8시에 자동으로 만들어집니다. 지금 보려면 <b>지금 브리핑 만들기</b>를 누르세요. 데이터 수집, 토론, 결론까지 1~2분 걸립니다.</p>
        </section>`}

        <section class="card span-4">
          <h2>자동 신호 <span class="muted">규칙 기반</span></h2>
          ${sigRows ? `<ul class="sig-list">${sigRows}</ul>` : '<p class="muted">데이터를 불러오면 나옵니다.</p>'}
        </section>

        ${b ? `<section class="card span-7">
          <h2>결론 세부</h2>
          <table class="g-table concl-tbl">${CONCL_ROWS.filter((k) => b[k]).map((k) => `<tr><th>${esc(k)}</th><td>${esc(b[k])}</td></tr>`).join('')}</table>
        </section>` : ''}

        ${D.open ? `<section class="card ${b ? 'span-5' : 'span-12'}">
          <h2>BULL vs BEAR ${D.risk ? `<span class="muted">리스크 팀: ${esc(D.risk.balance || '')}</span>` : ''}</h2>
          <div class="duel"><div class="duel-b"><span class="duel-tag bull">BULL</span>${esc(D.open.bull ? D.open.bull.claim : '')}</div>
          <div class="duel-b"><span class="duel-tag bear">BEAR</span>${esc(D.open.bear ? D.open.bear.claim : '')}</div></div>
          ${D.risk ? `<p class="duel-key"><b>핵심 쟁점</b> ${esc(D.risk.key_issue || '')}</p><p class="muted small">BULL이 틀렸다고 볼 신호: ${esc(D.risk.bull_wrong_if || '')}<br>BEAR가 틀렸다고 볼 신호: ${esc(D.risk.bear_wrong_if || '')}</p>` : ''}
        </section>` : ''}

        ${state.industry ? `<section class="card span-6"><div class="wk-head"><h2>산업 이슈</h2><a href="#" data-act="goto-industry">전체 보기</a></div>
          ${state.industry.headline ? `<p class="muted small">${esc(state.industry.headline)}</p>` : ''}
          <ul class="mini-list">${state.industry.issues.slice(0, 4).map((it) => `<li><span class="ind-tag">${esc(it.industry || it.sector || '')}</span><span class="ml-t">${esc(it.title)}</span><span class="badge ${IMPACT_TONE[it.impact] || 'neutral'}">${esc(it.impact || '')}</span></li>`).join('')}</ul></section>` : ''}
        ${state.company ? `<section class="card co-mini ${state.industry ? 'span-6' : 'span-12'}"><div class="wk-head"><h2>오늘의 기업</h2><a href="#" data-act="goto-company">카드 보기</a></div>
          <div class="co-mini-name">${esc(state.company.data.company.name)}</div>
          <p>${esc((state.company.card || {}).one_liner || '')}</p><p class="muted small">${esc(state.company.reason || '')}</p></section>` : ''}

        ${sv && (sv.fav.length || sv.unfav.length) ? `<section class="card span-12"><h2>섹터 시사점 <span class="muted">규칙 기반</span></h2>
          <div class="sector2">
            <div><div class="sec-h bull">유리</div>${sv.fav.length ? `<ul>${sv.fav.map((x) => `<li><b>${esc(x.sector)}</b> <span class="muted">${esc(x.why.join(', '))}</span></li>`).join('')}</ul>` : '<p class="muted">없음</p>'}</div>
            <div><div class="sec-h bear">불리</div>${sv.unfav.length ? `<ul>${sv.unfav.map((x) => `<li><b>${esc(x.sector)}</b> <span class="muted">${esc(x.why.join(', '))}</span></li>`).join('')}</ul>` : '<p class="muted">없음</p>'}</div>
          </div>
        </section>` : ''}
      </div>`;
    renderCross();
  }

  function renderCross() {
    const box = $('#crossAuto');
    if (!box) return;
    const v = state.aiConcl || (state.debate && state.debate.open) ? verifyNow() : null;
    box.innerHTML = `${!v ? '<p class="muted">AI 브리핑이 나오면 자동으로 대조합니다.</p>' : !v.list.length ? '<p class="muted">대조할 숫자를 찾지 못했습니다.</p>' : `
        <p><span class="badge ${v.bad ? 'bad' : 'good'}">${v.bad ? `불일치 ${v.bad}건` : '모두 일치'}</span> 숫자 ${v.list.length}개 중 일치 ${v.ok} · 불일치 ${v.bad}${v.na ? ` · 확인 불가 ${v.na}` : ''}</p>
        ${v.bad ? `<table class="g-table">${v.list.filter((x) => x.status === '불일치').map((x) => `<tr><th class="miss">✗</th><td>AI: ${esc(x.text)}</td><td>실제: ${esc(x.actual || '-')}</td></tr>`).join('')}</table>` : ''}
        <details class="qs"><summary>대조한 숫자 전체</summary><table class="g-table">${v.list.map((x) => `<tr><th class="${x.status === '일치' ? 'hit' : x.status === '불일치' ? 'miss' : 'muted'}">${x.status === '일치' ? '✓' : x.status === '불일치' ? '✗' : '?'}</th><td>${esc(x.text)}</td><td>${esc(x.actual || x.status)}</td></tr>`).join('')}</table></details>`}`;
    if (state.cmpText && $('#cmpOut') && !$('#cmpOut').dataset.filled) { $('#cmpOut').innerHTML = renderMarkdown(state.cmpText); $('#cmpOut').dataset.filled = '1'; }
    const sc = $('#crossScore');
    if (!sc) return;
    const a = state.scored && state.actorScores;
    sc.innerHTML = `${a ? `<table class="g-table score-tbl"><tr>${S.ACTORS.map((x) => `<th>${esc(x.label)}</th>`).join('')}</tr>
        <tr>${S.ACTORS.map((x) => `<td>${pct(a.byActor[x.name])} <span class="muted">(${a.byActor[x.name].hit}/${a.byActor[x.name].total}${a.byActor[x.name].pending ? `, 대기 ${a.byActor[x.name].pending}` : ''})</span></td>`).join('')}</tr></table>
        <p class="muted">AI 결론을 얼마나 믿을지 판단하는 근거입니다. 채점이 쌓일수록 정확해집니다.</p>`
        : '<p class="muted"><a href="#" data-act="load-scores">기록 불러와서 적중률 보기</a></p>'}
      ${state.cmpMatch ? `<p>증권사 리포트 일치도: <span class="badge ${state.cmpMatch === '일치' ? 'good' : state.cmpMatch === '불일치' ? 'bad' : 'warn'}">${esc(state.cmpMatch)}</span></p>` : ''}`;
    renderCrossSum(v, a);
  }
  // 교차검증 요약 3칸 (항상 보임). 자세한 내용은 아래 접이식에서
  function renderCrossSum(v, a) {
    const box = $('#crossSum');
    if (!box) return;
    const tone = (t) => (t === 'good' ? 'good' : t === 'bad' ? 'bad' : t === 'warn' ? 'warn' : '');
    const d = !v ? ['대기', 'AI 브리핑이 나오면 자동 대조', ''] : !v.list.length ? ['-', '대조할 숫자 없음', ''] : v.bad ? [`불일치 ${v.bad}건`, `숫자 ${v.list.length}개 중 일치 ${v.ok}`, 'bad'] : [`모두 일치`, `숫자 ${v.list.length}개 확인`, 'good'];
    const m = state.cmpMatch;
    const r = m ? [m, '오늘 리포트와 비교함', m === '일치' ? 'good' : m === '불일치' ? 'bad' : 'warn'] : ['아직 안 함', 'PDF를 올려 비교하기', ''];
    const ai = a && a.byActor && a.byActor.AI;
    const sc = ai && ai.total ? [pct(ai), `AI 전망 ${ai.hit}/${ai.total} 적중${ai.pending ? ` · 대기 ${ai.pending}` : ''}`, ''] : ['-', a ? '채점할 기록이 아직 없음' : '눌러서 적중률 보기', ''];
    const cell = (no, label, [val, sub, t], target) => `<button type="button" class="x-cell ${tone(t)}" data-act="x-open" data-val="${target}">
      <span class="x-l">${no} ${label}</span><span class="x-v">${esc(val)}</span><span class="x-s">${esc(sub)}</span></button>`;
    box.innerHTML = cell('①', '데이터 대조', d, 'xData') + cell('②', '증권사 리포트', r, 'xReport') + cell('③', '사후 적중률 (AI)', sc, 'xScore');
    if (v && v.bad && !state.xDataAutoOpened) { state.xDataAutoOpened = true; const el = $('#xData'); if (el) el.open = true; }
  }

  async function makeBriefNow() {
    if (state.aiConcl && !confirm('지금 브리핑을 새로 만들까요? (기존 AI 결론은 바뀝니다)')) return;
    await runDebate();
    if (state.debate && state.debate.risk && !(state.debateRun || {}).error) await runChief();
  }


  // ---------- 산업 이슈 ----------
  const IMPACT_TONE = { 긍정: 'good', 부정: 'bad', 혼재: 'warn', 중립: 'neutral' };
  async function loadIndustry(silent) {
    try {
      const j = await api('/api/history?sheet=' + encodeURIComponent('산업 이슈') + '&limit=10');
      const row = pickRow(j.rows, '이슈 JSON');
      state.industry = row ? JSON.parse(row['이슈 JSON']) : null;
      state.industryFrom = fromNote(row);
      state.industryMsg = state.industry ? '' : `${state.date} 산업 이슈가 아직 없습니다.`;
    } catch (e) { state.industryMsg = e.message; if (!silent) toast(e.message, 'err'); }
    renderIndustry(); renderBrief();
  }
  async function makeIndustry() {
    state.industryBusy = true; renderIndustry();
    try {
      const j = await api('/api/industry', { method: 'POST', body: '{}' });
      state.industry = j.data; state.industryMsg = ''; state.industryFrom = j.data.demo ? ' · 체험 모드 (기록에는 저장되지 않음)' : '';
      toast(`산업 이슈 ${j.data.issues.length}개를 정리했습니다${j.data.demo ? ' (체험 모드: 기록에는 저장되지 않음)' : ''}`, 'ok');
    } catch (e) { toast(e.message, 'err'); state.industryMsg = e.message; }
    state.industryBusy = false; renderIndustry(); renderBrief();
  }
  // 지역 필터: '국내'에는 공통도, '해외'에도 공통을 함께 보여줌
  function inRegion(it, r) {
    if (r === '전체' || !it.region) return true;
    return it.region === r || it.region === '공통';
  }
  // 이슈 섹터의 그날 등락 (미국 섹터 ETF / 코스피 업종) — 뉴스와 가격이 같은 방향인지 보는 용도
  function sectorMove(it) {
    const S0 = state.sectors;
    if (!S0) return '';
    const nm = (x) => String(x || '').replace(/[\s·.,]/g, '').replace(/업$/, '');
    const out = [];
    if (it.region !== '국내' && it.sector && S0.us && S0.us.ok) {
      const r = S0.us.rows.find((x) => x.ko === it.sector);
      if (r && r.d1 != null) out.push(['미국 ' + r.ko, r.d1, S0.us.date, S0.us.live]);
    }
    if (it.region !== '해외' && it.kospi_sector && S0.kr && S0.kr.ok) {
      const r = S0.kr.rows.find((x) => nm(x.name) === nm(it.kospi_sector));
      if (r && r.d1 != null) out.push(['코스피 ' + r.name, r.d1, S0.kr.date]);
    }
    const md = (d) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : '');
    return out.map(([l, v, d, live]) => `<span class="mv-tag ${v > 0 ? 'up' : v < 0 ? 'down' : ''}" title="${live ? `${esc(d || '')} 미국 장중 가격 기준 (아직 종가 아님)` : `${esc(d || '')} 종가 기준. 뉴스보다 앞선 날일 수 있어요`}">${esc(l)} ${md(d)}${live ? ' 장중' : ''} ${signed(v, 2, '%')}</span>`).join('');
  }
  function renderIndustry() {
    const box = $('#industryPanel');
    if (!box) return;
    const I = state.industry;
    const busy = state.industryBusy;
    box.innerHTML = `
      <div class="card brief-hero"><div class="wk-head"><div>
        <div class="ph-kicker">산업 이슈</div><h1 class="ph-title">${esc(niceDate(state.date))}</h1>
        <div class="muted">${I ? `${state.industryFrom ? esc(state.industryFrom.slice(3)) + ' · ' : ''}뉴스 ${I.newsCount}건 중 ${I.issues.length}개 이슈 · ${esc(I.model || '')}${I.macroUsed ? ' · 오늘 매크로 반영' : ''}` : esc(state.industryMsg || '불러오는 중…')}</div></div>
        <div class="rec-actions"><button class="btn" data-act="load-industry" type="button" ${busy ? 'disabled' : ''}>불러오기</button>
        <button class="btn primary" data-act="make-industry" type="button" ${busy ? 'disabled' : ''}>${busy ? '정리 중… (최대 1분)' : I ? '다시 만들기' : '지금 만들기'}</button></div></div>
        ${I && I.headline ? `<p class="headline">${esc(I.headline)}</p>` : ''}
        <p class="hint">연합뉴스·매일경제·비즈니스포스트 RSS(제목·짧은 요약)에서 AI가 전 산업 이슈를 골라 정리합니다. 근거 기사가 없는 이슈는 자동으로 뺍니다. 원문은 링크로 확인하세요.</p>
      </div>
      ${I ? `<div class="ind-filter pillseg" role="group" aria-label="지역">${['전체', '국내', '해외'].map((r) => `<button type="button" class="${(state.indRegion || '전체') === r ? 'on' : ''}" data-act="ind-region" data-val="${r}">${r} <span class="muted">${r === '전체' ? I.issues.length : I.issues.filter((x) => inRegion(x, r)).length}</span></button>`).join('')}</div>` : ''}
      ${I ? I.issues.filter((it) => inRegion(it, state.indRegion || '전체')).map((it) => `<div class="card issue">
        <div class="wk-head"><div class="issue-tags">${it.region ? `<span class="rg-tag">${esc(it.region)}</span>` : ''}<span class="ind-tag">${esc([it.sector, it.industry].filter((x, i, a) => x && a.indexOf(x) === i).join(' · ') || it.industry || '')}</span>${sectorMove(it)}</div>
          <span class="badge ${IMPACT_TONE[it.impact] || 'neutral'}">${esc(it.impact || '')}</span></div>
        <b class="issue-t">${esc(it.title)}</b>
        <p>${esc(it.summary)}</p>
        ${it.why ? `<p class="muted"><b>왜 중요한가</b> ${esc(it.why)}</p>` : ''}
        ${it.macro_link ? `<p class="macro-l"><b>매크로 연결</b> ${esc(it.macro_link)}</p>` : ''}
        ${it.companies && it.companies.length ? `<p><b>관련 기업</b> ${it.companies.map((c) => `<span class="chip ${c.inSource ? '' : 'warn'}" title="${c.inSource ? '근거 기사에 나옴' : '근거 기사에 없음 — 확인 필요'}">${esc(c.name)}${c.inSource ? '' : ' ?'}</span>`).join(' ')}</p>` : ''}
        <div class="src-row"><span class="badge ${it.check === '근거 확인' ? 'good' : 'warn'}">${esc(it.check)}</span> ${it.links.map((l) => `<a href="${esc(l.link)}" target="_blank" rel="noopener">${esc(l.source)}: ${esc(l.title.slice(0, 40))}</a>`).join('')}</div>
      </div>`).join('') : ''}
      ${I && I.feedErrors && I.feedErrors.length ? `<p class="muted">일부 RSS를 읽지 못했습니다: ${esc(I.feedErrors.join(' · '))}</p>` : ''}`;
  }

  // ---------- 오늘의 기업 ----------
  async function loadCompany(silent) {
    try {
      const j = await api('/api/history?sheet=' + encodeURIComponent('기업 분석') + '&limit=30');
      state.companyRows = j.rows || [];
      const row = pickRow(state.companyRows, '카드 JSON');
      state.companyFrom = fromNote(row);
      state.company = row && row['카드 JSON'] ? JSON.parse(row['카드 JSON']) : null;
      state.companyMsg = state.company ? '' : `${state.date} 기업 분석이 아직 없습니다.`;
    } catch (e) { state.companyMsg = e.message; if (!silent) toast(e.message, 'err'); }
    renderCompany(); renderBrief();
  }
  async function loadRank() {
    state.rankBusy = true; renderCompany();
    try { const j = await api('/api/company?rank=1'); state.rank = j; }
    catch (e) { toast(e.message, 'err'); }
    state.rankBusy = false; renderCompany();
  }
  async function makeCompany(ticker) {
    state.companyBusy = ticker || 'auto'; renderCompany();
    try {
      const j = await api('/api/company', { method: 'POST', body: JSON.stringify(ticker ? { ticker } : {}) });
      state.company = j.result; state.companyMsg = ''; state.companyFrom = j.result.demo ? ' · 체험 모드 (기록에는 저장되지 않음)' : '';
      if (!j.result.demo) state.companyRows = null;
      toast(`${j.result.data.company.name} 분석 카드를 만들었습니다${j.result.demo ? ' (체험 모드: 기록에는 저장되지 않음)' : ''}`, 'ok');
      setTimeout(() => $('#companyCard') && $('#companyCard').scrollIntoView({ behavior: 'smooth' }), 50);
    } catch (e) { toast(e.message, 'err'); }
    state.companyBusy = null; renderCompany(); renderBrief();
  }
  // 증권사 리포트는 자동으로 가져오지 않고, 직접 확인할 링크만 (네이버·한경 리서치는 화면을 브라우저에서 그려서 서버가 읽을 수 없음)

  // ---------- 기업 카드 (섹션별 카드로 나눠 배치) ----------
  function metricGroups(metrics) {
    // PER 이름에 '순이익'이 들어가므로 밸류에이션을 먼저 판별
    const groupOf = (m) => (/시가총액|PER|PBR/.test(m.label) ? '밸류에이션' : /매출|영업이익|순이익/.test(m.label) ? '실적' : /주가|수익률|연초|52주/.test(m.label) ? '주가' : '기타');
    return ['실적', '밸류에이션', '주가', '기타'].map((g) => [g, metrics.filter((m) => groupOf(m) === g)]).filter(([, it]) => it.length);
  }
  function metricCell(m) {
    const v = String(m.value);
    const tone = /수익률|대비|증가율|전년비/.test(m.label) && /^-?\d/.test(v) ? (v.startsWith('-') ? 'down' : 'up') : '';
    const label = m.label.replace(/\s*\((간이[^)]*)\)/, '<small>$1</small>');
    return `<div class="mt"><div class="mt-l">${label}</div><div class="mt-v ${tone}">${esc(v)}</div></div>`;
  }
  function companyCardHtml(c, k, list) {
    const co = c.data.company, kr = co.market === 'KR';
    const v = c.verify || { ok: 0, total: 0, bad: [] };
    const news = c.data.news || [], filings = c.data.filings || [];
    return `<div class="co-wrap" id="companyCard">
      <section class="card co-head">
        <div class="co-top">
          <div><div class="co-name">${esc(co.name)}</div>
            <div class="co-tags"><span class="tag">${esc(co.ticker)}</span><span class="tag">${kr ? '한국' : '미국'}</span>${c.data.source ? `<span class="tag">${esc(c.data.source)} 재무</span>` : ''}</div></div>
          <div class="co-badges"><span class="badge ${v.bad.length ? 'warn' : 'good'}" title="AI 문장 속 숫자가 데이터에 있는지">숫자 검증 ${v.ok}/${v.total}</span><span class="ai-warn">AI 분석 · 투자 권유 아님</span></div>
        </div>
        ${k.one_liner ? `<p class="co-one">${esc(k.one_liner)}</p>` : ''}
        ${k.why_today ? `<p class="co-why"><b>오늘 주목받는 이유</b>${esc(k.why_today)}</p>` : ''}
        ${v.bad.length ? `<p class="co-alert">AI 문장에 데이터에 없는 숫자가 있어요: <b>${v.bad.map(esc).join(', ')}</b> — 아래 핵심 숫자와 비교해 확인하세요.</p>` : ''}
        ${c.data.errors && c.data.errors.length ? `<p class="muted small">일부 데이터를 가져오지 못했습니다: ${esc(c.data.errors.join(' · '))}</p>` : ''}
      </section>

      <section class="card">
        <h2>핵심 숫자 <span class="muted">${esc(c.data.source || '')}·Yahoo에서 직접 계산</span></h2>
        ${c.data.metrics.length ? metricGroups(c.data.metrics).map(([g, it]) => `<div class="mt-group"><div class="mt-gname">${g}</div><div class="mt-grid">${it.map(metricCell).join('')}</div></div>`).join('') : '<p class="muted">재무 데이터 없음</p>'}
      </section>

      <div class="co-2col">
        <section class="card"><h2>무엇으로 돈을 버나</h2>
          <p>${esc(k.business || '')}</p>
          ${k.segments && k.segments.length ? `<div class="kv"><span>주요 사업</span><div>${k.segments.map((x) => `<span class="chip">${esc(x)}</span>`).join(' ')}</div></div>` : ''}
          ${k.competitors && k.competitors.length ? `<div class="kv"><span>경쟁사</span><div>${k.competitors.map((x) => `<span class="chip">${esc(x)}</span>`).join(' ')}</div></div>` : ''}
          <p class="muted small">사업 구조·경쟁사는 AI의 일반 정보예요. 사업보고서로 확인하세요.</p></section>
        <section class="card"><h2>실적과 밸류에이션</h2>
          <p>${esc(k.results || '')}</p><p>${esc(k.valuation || '')}</p>
          ${k.macro_link ? `<p class="macro-l"><b>매크로·산업 연결</b> ${esc(k.macro_link)}</p>` : ''}</section>
      </div>

      <section class="card"><h2>투자 논리 <span class="muted">BULL과 BEAR를 같이 보기</span></h2>
        <div class="bb2"><div class="bull-box"><b class="t-bull">BULL · 투자 포인트</b>${list(k.bull)}</div><div class="bear-box"><b class="t-bear">BEAR · 리스크</b>${list(k.bear)}</div></div>
        ${k.kill_scenario ? `<p class="kill"><b>망하는 시나리오</b> ${esc(k.kill_scenario)}</p>` : ''}
        ${k.checkpoints && k.checkpoints.length ? `<div class="kv"><span>체크포인트</span><div>${list(k.checkpoints)}</div></div>` : ''}
      </section>

      <section class="card"><h2>증권사 시각과 비교 <span class="muted">교차검증</span></h2>
        ${reportBlock(c, k) || '<p class="muted small">미국 종목은 증권사 리포트를 자동으로 가져오지 않아요. 아래 링크에서 확인하세요.</p>'}
        <div class="rl-foot">${researchLinks(co)}</div>
      </section>

      <div class="co-2col">
        <section class="card"><h2>관련 뉴스 <span class="muted">${news.length}건</span></h2>
          ${news.length ? `<ul class="link-list">${news.map((n) => `<li><a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a><span class="muted">${esc(n.source)}</span></li>`).join('')}</ul>` : '<p class="muted">최근 기사 없음</p>'}</section>
        <section class="card"><h2>최근 공시 <span class="muted">${filings.length}건</span></h2>
          ${filings.length ? `<ul class="link-list">${filings.map((f) => `<li><a href="${esc(f.link)}" target="_blank" rel="noopener">${esc(f.title)}</a><span class="muted">${esc(f.date)}</span></li>`).join('')}</ul>` : '<p class="muted">최근 공시 없음</p>'}
          ${c.data.hiddenFilings ? `<p class="muted small">임원·주요주주 지분 변동 보고 ${c.data.hiddenFilings}건은 숨겼어요.</p>` : ''}</section>
      </div>
    </div>`;
  }
  function reportBlock(c, k) {
    if (c.data.company.market !== 'KR' || !c.data.reports) return '';
    const R = c.data.reports, S0 = c.data.reportSummary;
    const won = (v) => `${Math.round(v).toLocaleString('ko-KR')}원`;
    const ops = S0 ? Object.entries(S0.opinions).map(([o, n]) => `${o} ${n}`).join(' · ') : '';
    return `<p class="muted small">네이버 증권 리서치 최근 90일 · 증권사 의견이며 우리 의견이 아니에요.</p>
      ${S0 ? `<p class="street">목표주가 ${S0.n}건${S0.from ? ` (${esc(S0.from.slice(5))}~${esc(S0.to.slice(5))} 발표)` : ''}: ${won(S0.min)}~${won(S0.max)}, 중간값 ${won(S0.median)}${S0.gap != null ? ` (현재가 대비 ${S0.gap > 0 ? '+' : ''}${S0.gap}%)` : ''}${ops ? `<br>투자의견 ${esc(ops)}` : ''}</p>` : ''}
      ${k.street_view ? `<p class="street"><b>증권사 시각</b> ${esc(k.street_view)}</p>` : ''}
      ${R.length ? `<table class="rep-tbl"><thead><tr><th>날짜</th><th>증권사</th><th>제목</th><th class="r">목표주가</th><th>의견</th></tr></thead><tbody>${R.map((x) => `<tr><td class="muted">${esc(x.date.slice(5))}</td><td>${esc(x.broker)}</td><td><a href="${esc(x.link)}" target="_blank" rel="noopener">${esc(x.title)}</a></td><td class="r">${x.goal ? won(x.goal) : '-'}</td><td>${esc(x.opinion || '-')}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">최근 90일 리포트 없음</p>'}`;
  }
  function researchLinks(co) {
    const kr = co.market === 'KR';
    const code = String(co.ticker || '').slice(0, 6);
    const links = kr
      ? [['네이버 증권 리서치', `https://stock.naver.com/research/company?searchText=${encodeURIComponent(co.name)}`], ['네이버 종목 (컨센서스)', `https://finance.naver.com/item/coinfo.naver?code=${code}`], ['한경컨센서스', 'https://markets.hankyung.com/consensus']]
      : [['Finviz (애널리스트 의견·목표가)', `https://finviz.com/quote.ashx?t=${encodeURIComponent(co.ticker)}`], ['Yahoo Finance 애널리스트', `https://finance.yahoo.com/quote/${encodeURIComponent(co.ticker)}/analysis`]];
    return `<div class="rlinks"><span class="muted small">원문 보기${kr ? ' (한경컨센서스는 종목명으로 검색)' : ''}</span>${links.map(([l, u]) => `<a class="btn mini" href="${esc(u)}" target="_blank" rel="noopener">${esc(l)}</a>`).join('')}</div>`;
  }
  function renderCompany() {
    const box = $('#companyPanel');
    if (!box) return;
    const c = state.company;
    const busy = state.companyBusy;
    const R = state.rank;
    const k = c ? c.card || {} : {};
    const list = (arr) => `<ul>${(arr || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
    const past = (state.companyRows || []).filter((r) => r['날짜'] !== state.date).slice(0, 12);
    box.innerHTML = `
      <div class="card brief-hero"><div class="wk-head"><div>
        <div class="ph-kicker">오늘의 기업</div><h1 class="ph-title">${esc(niceDate(state.date))}</h1>
        <div class="muted">${c ? `${state.companyFrom ? esc(state.companyFrom.slice(3)) + ' · ' : ''}${esc(c.reason)} · ${esc(c.model || '')}` : esc(state.companyMsg || '불러오는 중…')}</div></div>
        <div class="rec-actions"><button class="btn" data-act="load-rank" type="button" ${state.rankBusy ? 'disabled' : ''}>${state.rankBusy ? '계산 중…' : '주목도 상위 20 보기'}</button>
        <button class="btn primary" data-act="make-company" type="button" ${busy ? 'disabled' : ''}>${busy === 'auto' ? '분석 중… (최대 1분)' : c ? '자동 선정으로 다시 만들기' : '자동 선정해서 분석'}</button></div></div>
        <p class="hint">주가 변동·거래량·뉴스 언급으로 고른 오늘 가장 주목받는 기업 1곳. 숫자는 DART·SEC·Yahoo에서 직접 계산하고 AI는 해석만 합니다. 투자 권유가 아닌 분석 카드예요.</p>
      </div>

      ${c ? companyCardHtml(c, k, list) : ''}

      ${R ? `<details class="card rank-box" ${c ? '' : 'open'}><summary><h2>주목도 상위 20 <span class="muted">${esc((R.rank[0] || {}).date || '')} 종가 기준 · 다른 기업도 눌러서 분석</span></h2></summary>
        <table class="rec rank"><thead><tr><th>#</th><th>기업</th><th>1일</th><th>변동/평소</th><th>거래량 배수</th><th>뉴스</th><th>점수</th><th></th></tr></thead><tbody>
        ${R.rank.map((x, i) => `<tr class="${R.pick && R.pick.ticker === x.ticker ? 'pick' : ''}"><td class="mono">${i + 1}</td><td><b>${esc(x.name)}</b> <span class="muted mono">${esc(x.ticker)}</span>${R.recent.includes(x.ticker) ? ' <span class="muted">(최근 분석)</span>' : ''}${x.bonus ? ' <span class="chip info">산업 이슈</span>' : ''}</td>
          <td class="mono ${x.chg > 0 ? 'up' : x.chg < 0 ? 'down' : ''}">${signed(x.chg, 2, '%')}</td><td class="mono">${x.move}배</td><td class="mono">${x.volx}배</td><td class="mono">${x.news}</td><td class="mono"><b>${x.score}</b></td>
          <td><button class="btn mini" data-act="analyze" data-val="${esc(x.ticker)}" type="button" ${busy ? 'disabled' : ''}>${busy === x.ticker ? '분석 중…' : '분석'}</button></td></tr>`).join('')}</tbody></table>
        <div class="pick-row"><span class="muted">후보군 밖 종목:</span> <input type="text" id="customTicker" placeholder="예: 005490.KS 또는 AAPL" /> <button class="btn mini" data-act="analyze-custom" type="button" ${busy ? 'disabled' : ''}>분석</button></div></details>` : ''}

      ${past.length ? `<div class="card"><h2>지난 기업 카드 <span class="muted">면접 준비 자료로 쌓입니다</span></h2>
        <table class="rec"><thead><tr><th>날짜</th><th>기업</th><th>한 줄 요약</th><th>숫자 검증</th></tr></thead><tbody>
        ${past.map((r) => `<tr data-act="open-card" data-val="${esc(r['날짜'])}|${esc(r['티커'])}"><td class="mono">${esc(r['날짜'])}</td><td><b>${esc(r['기업'])}</b></td><td>${esc(r['한 줄 요약'])}</td><td class="muted">${esc(r['숫자 검증'])}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
  }
  function openPastCard(val) {
    const [d, t] = String(val).split('|');
    const row = (state.companyRows || []).find((r) => r['날짜'] === d && r['티커'] === t);
    if (row && row['카드 JSON']) { state.company = JSON.parse(row['카드 JSON']); renderCompany(); setTimeout(() => $('#companyCard') && $('#companyCard').scrollIntoView({ behavior: 'smooth' }), 50); }
  }

  // ---------- 리포트 비교 ----------
  async function runCompare() {
    const d = Object.assign(collect($('#view-daily')), collect($('#view-brief')));
    const mine = conclusionText(collect($('#view-daily')));
    const ai = aiConclText();
    const concl = [ai && `[AI 센터장 결론]\n${ai}`, mine && `[사용자 결론]\n${mine}`].filter(Boolean).join('\n\n');
    const text = $('#reportText').value.trim();
    const file = $('#reportFile').files[0];
    if (!file && !text) { toast('리포트 PDF를 올리거나 내용을 붙여넣어 주세요', 'err'); return; }
    if (!concl && !confirm('비교할 결론이 아직 없어요. 리포트 요약만 받을까요?')) return;
    let pdf = null;
    if (file) {
      if (file.size > 3 * 1024 * 1024) { toast('PDF가 3MB를 넘어요. 핵심 부분을 붙여넣어 주세요', 'err'); return; }
      pdf = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(',')[1]);
        r.onerror = () => rej(new Error('파일을 읽지 못했습니다'));
        r.readAsDataURL(file);
      });
    }
    const btn = $('#compareBtn');
    btn.disabled = true; btn.textContent = '비교 중…';
    $('#cmpOut').innerHTML = '<span class="muted">AI가 리포트를 읽고 내 결론과 비교하고 있습니다…</span>';
    try {
      const j = await api('/api/compare', { method: 'POST', body: JSON.stringify({ date: state.date, reportName: d['참고 리포트'] || '', reportText: text, pdfBase64: pdf, conclusionText: concl, signalsText: signalsText() }) });
      state.cmpText = j.text;
      const mm = /일치도\s*[:：]\s*(부분 일치|불일치|일치)/.exec(j.text);
      state.cmpMatch = mm ? mm[1] : '';
      $('#cmpOut').innerHTML = renderMarkdown(j.text) + `<div class="ai-meta">모델: ${esc(j.model)} · 리포트 원문은 저장하지 않고 비교 결과만 저장합니다. <button class="btn mini" data-act="cmp-to-memo" type="button">비교 메모에 옮기기</button></div>`;
      saveDraft();
      renderBrief();
    } catch (e) {
      $('#cmpOut').innerHTML = `<div class="err">${esc(e.message)}</div>`;
    } finally {
      btn.disabled = false; btn.textContent = 'AI로 다시 비교하기';
    }
  }

  // ---------- 이벤트일 ----------
  function renderEvent() {
    const opts = ['', ...Object.keys(C.events)];
    $('#eventPanel').innerHTML = `
      <div class="card">
        <h2>이벤트일 심화 점검</h2>
        <p class="hint">시장 기대 vs 실제 결과의 괴리, 그리고 발표 직후 반응이 장 마감까지 이어지는지를 봅니다. 기록은 그날 데일리 기록과 함께 저장됩니다.</p>
        <div class="fields">
          <label class="fld"><span>이벤트</span><select data-key="이벤트_종류" id="eventType">${opts.map((o) => `<option value="${o}">${o || '오늘 이벤트 없음'}</option>`).join('')}</select></label>
          <label class="fld"><span>시장 기대 (컨센서스)</span><input type="text" data-key="이벤트_시장기대" placeholder="예: 근원 CPI 전월비 0.3%" /></label>
          <label class="fld"><span>실제 결과</span><input type="text" data-key="이벤트_실제결과" placeholder="예: 0.4%" /></label>
          <label class="fld"><span>2년물 반응 (bp)</span><input type="number" step="any" data-key="이벤트_2년물반응" /></label>
          <label class="fld"><span>10년물 반응 (bp)</span><input type="number" step="any" data-key="이벤트_10년물반응" /></label>
          <label class="fld"><span>FedWatch 확률 변화 (%p)</span><input type="number" step="any" data-key="이벤트_FedWatch변화" /></label>
          <label class="fld"><span>달러 반응</span><input type="text" data-key="이벤트_달러반응" placeholder="예: DXY +0.6%" /></label>
          <label class="fld"><span>섹터 반응</span><input type="text" data-key="이벤트_섹터반응" placeholder="금리 민감(기술·부동산) vs 금융" /></label>
          <label class="fld"><span>장 마감까지 반응</span><select data-key="이벤트_반응유지">${['', '유지', '일부 되돌림', '반전'].map((o) => `<option value="${o}">${o || '선택'}</option>`).join('')}</select></label>
        </div>
        <div id="eventChecklist"></div>
        <label class="fld wide"><span>해석 메모</span><textarea data-key="이벤트_해석" rows="4" placeholder="기대와 결과의 괴리가 정책 기대를 어떻게 바꿨나? 처음 반응이 뒤집혔다면 시장이 무엇을 다시 해석했나?"></textarea></label>
        <p class="hint">저장은 <b>오늘의 브리핑</b>의 '오늘 브리핑 시트에 저장' 버튼으로 함께 됩니다.</p>
      </div>`;
    renderEventChecklist();
  }
  function renderEventChecklist() {
    const type = ($('#eventType') || {}).value;
    const box = $('#eventChecklist');
    if (!type) { box.innerHTML = ''; return; }
    const items = C.events[type] || [];
    box.innerHTML = `<h3>${esc(type)} 체크리스트</h3><div class="checklist">${items.map((t, i) => `
      <div class="cl-row"><label class="check"><input type="checkbox" data-key="이벤트_체크_${i}" /> ${esc(t)}</label>
      <input type="text" data-key="이벤트_메모_${i}" placeholder="확인한 내용" /></div>`).join('')}</div>`;
    restore(box, store.get(draftKey(), {}));
  }

  // ---------- 주간 ----------
  function renderWeekly() {
    const ws = weekStart(state.date);
    const items5 = {};
    if (state.market) {
      for (const [k, it] of Object.entries(state.market.items)) items5[k] = it && it.ok ? Object.assign({}, it, { chg: it.chg5 }) : it;
    }
    const dec = state.market ? S.decompose(items5.real10y && items5.real10y.chg, items5.bei10y && items5.bei10y.chg, items5.us10y && items5.us10y.chg) : null;
    const hy = state.signals ? state.signals.hy : null;
    const tiles = C.weeklyItems.map((id) => tile(id, 'weekly')).join('');
    const qs = C.weeklyItems.map((id) => `<li><b>${esc(C.indicators[id].label)}</b> ${esc(C.weeklyQuestions[id] || '')}</li>`).join('');
    const scraps = [1, 2, 3].map((i) => `<div class="scrap">
        <input type="text" data-key="기사${i}_제목" placeholder="기사 제목" />
        <input type="url" data-key="기사${i}_링크" placeholder="링크" />
        <input type="text" data-key="기사${i}_한줄" placeholder="이번 주 동인과 어떤 관련?" /></div>`).join('');

    $('#weeklyPanel').innerHTML = `
      <div class="card">
        <div class="wk-head"><h2>주간 점검 <span class="muted">· ${ws} 주</span></h2><span class="hint">주말 또는 주초 30분</span></div>
        <p class="hint">하루 단위로는 노이즈가 많은 지표를 5거래일 변화로 봅니다.</p>
        <div class="tiles">${tiles}</div>
        <div class="signals">${signalBox('10년물 분해 (5일)', dec)}${signalBox('신용시장 (하이일드)', hy)}</div>
        <details class="qs" open><summary>생각할 질문</summary><ul>${qs}</ul></details>
        <div class="links"><a href="https://fred.stlouisfed.org/series/BAMLH0A0HYM2" target="_blank" rel="noopener">FRED 하이일드</a><a href="https://fred.stlouisfed.org/series/T10YIE" target="_blank" rel="noopener">FRED BEI</a><a href="https://fred.stlouisfed.org/series/DFII10" target="_blank" rel="noopener">FRED 실질금리</a><a href="https://www.thebell.co.kr/" target="_blank" rel="noopener">더벨</a></div>
      </div>

      <div class="layout">
        <div class="col-main">
          <div class="card">
            <h2>이번 주 데일리 기록</h2>
            <div id="weekDailyList"><span class="muted">'기록과 적중률' 메뉴를 한 번 열면 이번 주 기록이 여기에 모입니다.</span></div>
          </div>
          <div class="card">
            <h2>글로벌 10년물</h2>
            <p class="hint">미국만 움직였는지, 글로벌 금리가 같이 움직였는지 비교합니다. <a href="https://stock.naver.com/market/marketindex" target="_blank" rel="noopener">네이버 시장지표</a>에서 확인해 입력하세요.</p>
            <div class="fields global10">
              ${['독일', '일본', '중국', '한국'].map((c) => `<label class="fld"><span>${c} 10년(%)</span><input type="number" step="any" data-key="${c} 10년(%)" /><em class="vs-us" data-vs="${c} 10년(%)"></em></label>`).join('')}
            </div>
            <label class="fld wide"><span>글로벌 금리 메모</span><input type="text" data-key="글로벌 금리 메모" placeholder="예: 미국만 상승, 독일·일본은 보합 → 미국 고유 요인(물가·재정)" /></label>
          </div>
          <div class="card">
            <h2>기사 스크랩</h2>
            <p class="hint">4건 고정보다, 이번 주 핵심 동인과 관련된 1~3건.</p>
            ${scraps}
          </div>
          <div class="card">
            <h2>IB Deal Follow-up</h2>
            <label class="fld wide"><span>이번 주 주요 딜과 시장 환경의 영향</span><textarea data-key="IB 딜 메모" rows="4" placeholder="딜 · 구조 · 금리·시장 환경이 준 영향"></textarea></label>
          </div>
        </div>
        <aside class="col-side">
          <div class="card concl">
            <h2>주간 정리</h2>
            <label class="fld wide"><span>이번 주 시장의 진짜 이야기</span><textarea data-key="이번 주 핵심 동인" rows="3"></textarea></label>
            <label class="fld wide"><span>지난주 내 뷰는 맞았나</span><select data-key="뷰 검증">${['', '맞음', '부분적으로 맞음', '틀림'].map((o) => `<option value="${o}">${o || '선택'}</option>`).join('')}</select></label>
            <label class="fld wide"><span>무엇을 놓쳤나 / 무엇을 배웠나</span><textarea data-key="배운 점" rows="3"></textarea></label>
            <label class="fld wide"><span>다음 주 뷰</span><textarea data-key="다음 주 뷰" rows="3"></textarea></label>
            <label class="fld wide"><span>다음 주 이벤트 캘린더</span><textarea data-key="다음 주 이벤트" rows="3" placeholder="월: … / 수: FOMC 의사록 / 금: 고용"></textarea></label>
            <button class="btn primary block" id="saveWeekly">주간 기록 저장</button>
          </div>
        </aside>
      </div>`;
    restore($('#view-weekly'), store.get(weekKey(), {}));
    updateVsUs();
  }
  // 글로벌 10년물 입력값을 미국 10년물과 비교 (bp)
  function updateVsUs() {
    const us = state.market && state.market.items.us10y && state.market.items.us10y.ok ? state.market.items.us10y.value : null;
    $$('[data-vs]').forEach((el) => {
      const inp = $(`[data-key="${el.dataset.vs}"]`);
      const x = inp ? parseFloat(inp.value) : NaN;
      el.textContent = us != null && !isNaN(x) ? `미국 대비 ${signed(Math.round((x - us) * 100), 0, 'bp')}` : '';
    });
  }

  // ---------- 기록 ----------
  function renderRecordsShell() {
    const url = settings().sheetUrl;
    $('#recordsPanel').innerHTML = `
      <header class="page-head">
        <div><div class="ph-kicker">기록과 적중률</div><h1 class="ph-title">AI 전망, 얼마나 맞았나</h1>
          <div class="ph-meta">매일 아침 AI 센터장·BULL·BEAR가 낸 5거래일 뒤 방향을 실제 결과로 자동 채점해요.</div></div>
        <div class="rec-actions">${url ? `<a class="btn" href="${esc(url)}" target="_blank" rel="noopener">구글 시트 열기</a>` : ''}<button class="btn primary" id="loadRecords" type="button">다시 불러오기</button></div>
      </header>
      <div id="scoreBody"><div class="card"><span class="muted">기록을 불러오는 중…</span></div></div>
      <div class="card"><h2>저장된 기록 <span class="muted">눌러서 그날 결론 보기</span></h2><div id="recordsTable"><span class="muted">불러오는 중…</span></div></div>`;
  }
  async function loadRecords() {
    const box = $('#recordsTable');
    box.innerHTML = '<span class="muted">불러오는 중…</span>';
    try {
      const [j, wk, auto] = await Promise.all([
        api('/api/history?sheet=데일리&limit=200'),
        api('/api/history?sheet=주간&limit=60').catch(() => ({ rows: [] })),
        api('/api/history?sheet=' + encodeURIComponent('자동 브리핑') + '&limit=200').catch(() => ({ rows: [] })),
      ]);
      state.records = mergeRecords(j.rows || [], auto.rows || []);
      state.weeklyRecords = wk.rows || [];
      renderScores();
      if (!state.records.length) { box.innerHTML = '<span class="muted">아직 저장된 기록이 없습니다.</span>'; return; }
      box.innerHTML = `<table class="rec rec-list"><thead><tr><th>날짜</th><th>한 줄 요약</th><th>국면</th><th>AI 전망</th><th>내 결론</th></tr></thead><tbody>${state.records.map((r, i) => {
        const fc = S.FORECASTS.map((f) => { const v = r[f.key.replace('전망_', 'AI전망_')]; return v ? `<span class="fc-mini ${v === '상승' ? 'up' : v === '하락' ? 'down' : ''}">${esc(f.label.replace('미국 ', ''))} ${v === '상승' ? '▲' : v === '하락' ? '▼' : '–'}</span>` : ''; }).join('');
        const mine = r['종합 해석'] && !/^AI/.test(r['작성 방식'] || '') ? '작성' : r['종합 해석'] ? 'AI 결론 수정' : '';
        return `<tr data-i="${i}" class="rec-row"><td class="mono">${esc(r['날짜'])}</td><td>${esc(r['한 줄 요약'] || (r['AI 종합 해석'] || '').slice(0, 60))}</td><td>${esc(r['국면 판단'] || r['자동_국면 신호'] || '')}</td><td class="fc-cell-mini">${fc || '<span class="muted">–</span>'}</td><td>${mine ? `<span class="badge good">${mine}</span>` : '<span class="muted">–</span>'}</td></tr>
        <tr class="rec-detail" hidden><td colspan="5"><div class="rec-body"><b>AI 센터장</b> ${esc(r['AI 종합 해석'] || '(없음)')}${r['종합 해석'] ? `<br><br><b>내 결론</b> ${esc(r['종합 해석'])}` : ''}</div></td></tr>`;
      }).join('')}</tbody></table>`;
      renderWeekDaily();
      renderGuides();
    } catch (e) {
      box.innerHTML = `<div class="err">${esc(e.message)}</div>`;
    }
  }
  // 데일리 기록에 아침 자동 브리핑의 AI·BULL·BEAR 전망을 날짜별로 합침 (빈 칸만 채움)
  function mergeRecords(daily, auto) {
    const map = new Map();
    daily.forEach((r) => map.set(r['날짜'], Object.assign({}, r)));
    auto.forEach((a) => {
      const r = map.get(a['날짜']) || { '날짜': a['날짜'], '작성 방식': 'AI 자동' };
      Object.keys(a).forEach((k) => { if (/^(AI|BULL|BEAR)전망_/.test(k) && !r[k] && a[k]) r[k] = a[k]; });
      if (!r['AI 종합 해석'] && a['AI 종합 해석']) r['AI 종합 해석'] = a['AI 종합 해석'];
      map.set(a['날짜'], r);
    });
    return [...map.values()].sort((x, y) => String(y['날짜']).localeCompare(String(x['날짜'])));
  }
  function renderScores() {
    const box = $('#scoreBody');
    if (!box) return;
    if (!state.records || !state.market) { box.innerHTML = '<div class="card"><span class="muted">기록과 시장 데이터를 불러오면 채점합니다.</span></div>'; return; }
    state.scored = S.scoreRecords(state.records, state.market.items);
    const actors = S.scoreActors(state.records, state.market.items);
    state.actorScores = actors;
    setTimeout(renderCross, 0);
    const items = state.market.items;
    const one = (r, f, prefix) => S.scoreOne(items[f.id] && items[f.id].pts, r['날짜'], r[f.key.replace('전망_', prefix)], f);
    // 출처별 × 지표별 적중
    const grid = {};
    S.ACTORS.forEach((a) => { grid[a.name] = {}; S.FORECASTS.forEach((f) => { const t = { hit: 0, total: 0 }; state.records.forEach((r) => { const x = one(r, f, a.prefix); if (x.status === '채점') { t.total++; if (x.hit) t.hit++; } }); grid[a.name][f.key] = t; }); });
    const shown = S.ACTORS.filter((a) => actors.byActor[a.name].total || actors.byActor[a.name].pending);
    const anyScored = shown.some((a) => actors.byActor[a.name].total);
    const best = anyScored ? shown.slice().sort((x, y) => (actors.byActor[y.name].hit / (actors.byActor[y.name].total || 1)) - (actors.byActor[x.name].hit / (actors.byActor[x.name].total || 1)))[0] : null;
    const rows = state.records.filter((r) => S.FORECASTS.some((f) => r[f.key.replace('전망_', 'AI전망_')])).slice(0, 30);
    const mark = (x, call) => {
      if (!call) return '<span class="muted">–</span>';
      const arrow = call === '상승' ? '▲' : call === '하락' ? '▼' : '–';
      if (x.status === '채점') return `<span class="sc ${x.hit ? 'hit' : 'miss'}" title="전망 ${esc(call)} → 실제 ${esc(x.actual)}">${arrow} ${x.hit ? '적중' : '빗나감'}</span>`;
      if (x.status === '대기') return `<span class="sc wait" title="${x.remaining}거래일 뒤 채점">${arrow} 대기 ${x.remaining}일</span>`;
      return `<span class="muted">${arrow} ${esc(x.status)}</span>`;
    };
    box.innerHTML = !shown.length ? `<div class="card"><p class="muted">아직 채점할 전망이 없어요. 아침 자동 브리핑이 쌓이면 여기에 적중률이 나와요.</p></div>` : `
      <div class="actor-grid">${shown.map((a) => { const t = actors.byActor[a.name]; return `<div class="actor ${best && best.name === a.name ? 'best' : ''}">
        <div class="ac-l">${esc(a.label)}${best && best.name === a.name ? ' <span class="badge good">가장 정확</span>' : ''}</div>
        <div class="ac-v">${t.total ? pct(t) : '–'}</div>
        <div class="ac-s">${t.total ? `${t.hit}/${t.total} 적중 · ${t.days}일` : '아직 채점 전'}${t.pending ? ` · 대기 ${t.pending}` : ''}</div>
        <div class="ac-bars">${S.FORECASTS.map((f) => { const g = grid[a.name][f.key]; const w = g.total ? Math.round((g.hit / g.total) * 100) : 0; return `<div class="ac-bar"><span>${esc(f.label.replace('미국 ', ''))}</span><i><b style="width:${w}%"></b></i><em>${g.total ? `${w}%` : '–'}</em></div>`; }).join('')}</div>
      </div>`; }).join('')}</div>
      ${!anyScored ? '<p class="muted small pending-note">전망은 5거래일이 지나야 채점돼요. 첫 결과는 다음 주에 나와요.</p>' : ''}
      <div class="card"><h2>날짜별 AI 센터장 전망과 결과 <span class="muted">5거래일 뒤 방향 · 보합 기준 ${S.FORECASTS.map((f) => `${esc(f.label.replace('미국 ', ''))} ${esc(f.unitText)}`).join(' · ')}</span></h2>
        <table class="rec score-list"><thead><tr><th>날짜</th>${S.FORECASTS.map((f) => `<th>${esc(f.label)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((r) => `<tr><td class="mono">${esc(r['날짜'])}</td>${S.FORECASTS.map((f) => { const c = r[f.key.replace('전망_', 'AI전망_')]; return `<td>${mark(one(r, f, 'AI전망_'), c)}</td>`; }).join('')}</tr>`).join('')}</tbody></table>
        <p class="muted small">기준: 기록한 날 직전 거래일 종가 → 5거래일 뒤 종가. 약 6개월보다 오래된 기록은 '기간 지남'으로 표시돼요.</p></div>`;
    renderGuides();
  }
  function renderWeekDaily() {
    const box = $('#weekDailyList');
    if (!box || !state.records) return;
    const ws = weekStart(state.date);
    const end = new Date(ws + 'T00:00:00Z'); end.setUTCDate(end.getUTCDate() + 7);
    const we = end.toISOString().slice(0, 10);
    const rows = state.records.filter((r) => r['날짜'] >= ws && r['날짜'] < we).sort((a, b) => a['날짜'].localeCompare(b['날짜']));
    box.innerHTML = rows.length
      ? `<ol class="week-list">${rows.map((r) => `<li><span class="mono">${esc(r['날짜'])}</span> <b>${esc(r['뷰 변화'] || '')}</b> ${esc(r['오늘의 동인'] || '')}<div class="muted">${esc(r['종합 해석'] || '')}</div></li>`).join('')}</ol>`
      : '<span class="muted">이번 주 저장된 데일리 기록이 없습니다.</span>';
  }

  // ---------- 데이터 ----------
  async function loadMarket() {
    const mock = settings().mock;
    setStatus('시장 데이터를 불러오는 중…', 'info');
    try {
      const j = await api('/api/market' + (mock ? '?mock=1' : ''));
      state.market = j;
      state.signals = S.all(j.items);
      const missing = Object.entries(j.items).filter(([, v]) => !v.ok).map(([k]) => (C.indicators[k] || { label: k }).label);
      const when = new Date(j.fetchedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false });
      if (j.mock) setStatus(`목업 데이터로 표시 중입니다 (실제 시장 데이터 아님). 설정에서 끄면 실제 데이터를 불러옵니다.`, 'warn');
      else if (missing.length) setStatus(`${when} 기준 · 일부 항목을 불러오지 못했습니다: ${missing.join(', ')}`, 'warn');
      else setStatus(`${when} 기준 · 각 지표의 최근 거래일 종가`, 'ok');
    } catch (e) {
      state.market = null;
      state.signals = null;
      setStatus(`데이터를 불러오지 못했습니다: ${e.message} — 설정에서 '목업 데이터'로 화면을 확인할 수 있습니다.`, 'err');
    }
    rerenderData(true);
    loadSectors();
  }
  function setStatus(msg, kind) {
    const b = $('#statusBar');
    b.textContent = msg;
    b.className = 'status-bar ' + (kind || '');
  }
  function rerenderData(keepDom = true) {
    const draft = keepDom ? Object.assign({}, store.get(draftKey(), {}), collect($('#view-daily'))) : store.get(draftKey(), {});
    renderDaily();
    renderSectors();
    renderOverview();
    restore($('#dailySections'), draft);
    updateSurprises();
    updateProgress();
    const ph = state.signals && state.signals.phase;
    const ap = $('#autoPhase');
    if (ap) ap.textContent = ph ? `자동 참고: ${ph.name}` : '';
    renderGuides();
    renderCenter();
    renderBrief();
    if (state.records) renderScores();
    const weekDraft = keepDom ? Object.assign({}, store.get(weekKey(), {}), collect($('#view-weekly'))) : store.get(weekKey(), {});
    renderWeekly();
    restore($('#view-weekly'), weekDraft);
    renderWeekDaily();
  }

  // ---------- AI 분석 ----------
  function dataText() {
    if (!state.market) return '';
    return Object.entries(state.market.items).filter(([, it]) => it && it.ok).map(([id, it]) => {
      const def = C.indicators[id] || { label: id, digits: 2 };
      const u = it.chgUnit || '%';
      return `${def.label}: ${num(it.value, def.digits)} (전일 ${signed(it.chg, 2, u)}, 5일 ${signed(it.chg5, 2, u)}, ${it.date})`;
    }).join('\n');
  }
  function signalsText() {
    const s = state.signals;
    if (!s) return '';
    const head = s.signalDate ? [`신호 기준일: 미국 ${s.signalDate} 종가`] : [];
    const lines = head.concat(Object.entries(SIGNAL_TITLES).map(([k, t]) => (s[k] ? `${t}: ${s[k].name} — ${s[k].meaning}${s[k].detail ? ` (${s[k].detail})` : ''}` : null)).filter(Boolean));
    if (s.flags && s.flags.length) lines.push('주의 신호: ' + s.flags.join(' / '));
    if (s.sectors) { const st = S.sectorText(s.sectors); if (st) lines.push('섹터 연결(규칙 기반): ' + st.replace(/\n/g, ' | ')); }
    return lines.join('\n');
  }
  function manualText(d) {
    const skip = new Set(['오늘의 동인', '이야기', '한국 영향', '국면 판단', '뷰 변화', '다음 체크포인트', '투자 시사점', '종합 해석', '참고 리포트', '리포트 비교 메모', '전망 근거']);
    return Object.entries(d).filter(([k, v]) => !k.startsWith('확인_') && !k.startsWith('__') && !k.startsWith('전망_') && !skip.has(k) && v !== '' && v !== false && v != null)
      .map(([k, v]) => `${k}: ${v === true ? '확인' : v}`).join('\n');
  }
  function conclusionText(d) {
    const lines = ['오늘의 동인', '이야기', '한국 영향', '국면 판단', '뷰 변화', '다음 체크포인트', '투자 시사점', '종합 해석']
      .filter((k) => d[k]).map((k) => `${k}: ${d[k]}`);
    const fc = S.FORECASTS.filter((f) => d[f.key]).map((f) => `${f.label} ${d[f.key]}`);
    if (fc.length) lines.push(`5거래일 전망: ${fc.join(', ')}${d['전망 근거'] ? ` (근거: ${d['전망 근거']})` : ''}`);
    return lines.join('\n');
  }
  const pct = (t) => (t && t.total ? `${Math.round((t.hit / t.total) * 100)}%` : '–');

  // ---------- 작성 방식 (직접 / AI 브리핑 / AI 브리핑+수정) ----------
  const CONCL_KEYS = ['오늘의 동인', '이야기', '한국 영향', '국면 판단', '뷰 변화', '다음 체크포인트', '투자 시사점', '종합 해석'].concat(S.FORECASTS.map((f) => f.key));
  const snapshotOf = (d) => JSON.stringify(CONCL_KEYS.map((k) => d[k] || ''));
  function authorMode() {
    const m = state.authorMode || '';
    if (!m.startsWith('AI')) return '직접';
    return snapshotOf(collect($('#view-daily'))) === state.briefSnap ? m : `${m}+수정`;
  }
  // AI가 만든 결론(JSON)을 결론 칸에 채우기
  function applyConclusion(b, mode) {
    const pick = (v, opts) => (opts.includes(v) ? v : '');
    setField('오늘의 동인', b['오늘의 동인'] || '');
    setField('이야기', pick(b['이야기'], STORY_OPTS));
    setField('한국 영향', b['한국 영향'] || '');
    setField('국면 판단', pick(b['국면 판단'], PHASE_OPTS));
    setField('다음 체크포인트', b['다음 체크포인트'] || '');
    setField('투자 시사점', b['투자 시사점'] || '');
    setField('종합 해석', b['종합 해석'] || '');
    const view = pick(b['뷰 변화'], ['유지', '강화', '약화', '수정']);
    $$('input[name="view"]').forEach((r) => { r.checked = r.value === view; });
    $('#viewHidden').value = view;
    const fc = b['전망'] || {};
    S.FORECASTS.forEach((f) => setField(f.key, pick(fc[f.key.replace('전망_', '')], ['상승', '보합', '하락'])));
    state.authorMode = mode;
    state.briefSnap = snapshotOf(collect($('#view-daily')));
    saveDraft();
    updateModeTag();
    renderGuides();
  }
  function updateModeTag() {
    const t = $('#modeTag');
    if (!t) return;
    const m = authorMode();
    t.textContent = m === '직접' ? '' : m;
    t.className = 'mode-tag' + (m === '직접' ? '' : ' on');
  }

  async function runBrief() {
    const cur = collect($('#view-daily'));
    if (conclusionText(cur) && !confirm('이미 쓴 결론이 있어요. AI 브리핑으로 덮어쓸까요?')) return;
    const btn = $('#briefBtn');
    btn.disabled = true; btn.textContent = '브리핑 만드는 중…';
    try {
      const prev = previousRecord();
      const previousText = prev ? `${prev.date}: 뷰 ${prev.rec['뷰 변화'] || '-'}, 국면 ${prev.rec['국면 판단'] || '-'}, ${prev.rec['종합 해석'] || prev.rec['오늘의 동인'] || ''}` : '';
      const j = await api('/api/analyze', { method: 'POST', body: JSON.stringify({ mode: 'brief', date: state.date, dataText: dataText(), signalsText: signalsText(), manualText: manualText(cur), previousText }) });
      applyConclusion(j.brief || {}, 'AI 브리핑');
      toast(`AI 브리핑을 채웠습니다 (${j.model}). 확인하고 고쳐서 저장하세요`, 'ok');
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      btn.disabled = false; btn.textContent = '⚡ AI 빠른 브리핑';
    }
  }
  function renderMarkdown(md) {
    const lines = esc(md).split('\n');
    let html = '', inList = false;
    for (const raw of lines) {
      const line = raw.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
      if (/^#{1,4}\s/.test(line)) { if (inList) { html += '</ul>'; inList = false; } html += `<h4>${line.replace(/^#{1,4}\s/, '')}</h4>`; }
      else if (/^\s*[-*]\s/.test(line)) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${line.replace(/^\s*[-*]\s/, '')}</li>`; }
      else if (line.trim() === '') { if (inList) { html += '</ul>'; inList = false; } }
      else { if (inList) { html += '</ul>'; inList = false; } html += `<p>${line}</p>`; }
    }
    if (inList) html += '</ul>';
    return html;
  }
  async function runAI() {
    const d = Object.assign(collect($('#view-daily')), collect($('#view-event')));
    if (!conclusionText(d)) {
      if (!confirm('아직 내 결론이 비어 있어요. 결론을 먼저 쓰면 AI 피드백을 받을 수 있습니다. 그래도 분석할까요?')) return;
    }
    const btn = $('#aiBtn');
    btn.disabled = true; btn.textContent = '분석 중…';
    $('#aiOut').innerHTML = '<span class="muted">AI가 오늘의 데이터와 결론을 검토하고 있습니다…</span>';
    try {
      const j = await api('/api/analyze', { method: 'POST', body: JSON.stringify({ date: state.date, dataText: dataText(), signalsText: signalsText(), manualText: manualText(d), conclusionText: conclusionText(d), debateText: debateSummaryText(state.debate) }) });
      state.aiText = j.text;
      $('#aiOut').innerHTML = renderMarkdown(j.text) + `<div class="ai-meta">모델: ${esc(j.model)} · AI 해석은 참고용이며 사실 확인이 필요합니다.</div>`;
      saveDraft();
    } catch (e) {
      $('#aiOut').innerHTML = `<div class="err">${esc(e.message)}</div>`;
    } finally {
      btn.disabled = false; btn.textContent = 'AI 분석 다시 받기';
    }
  }

  // ---------- 시트 저장 ----------
  function buildDailyRecord() {
    const d = Object.assign(collect($('#view-daily')), collect($('#view-brief')));
    const ev = collect($('#view-event'));
    const rec = { '날짜': state.date, '저장시각': new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }) };
    const ids = new Set();
    C.daily.forEach((s) => s.items.forEach((id) => ids.add(id)));
    C.weeklyItems.forEach((id) => ids.add(id));
    if (state.market) {
      ids.forEach((id) => {
        const it = state.market.items[id];
        const def = C.indicators[id];
        if (!def) return;
        rec[`${def.label}`] = it && it.ok ? Number(Number(it.value).toFixed(def.digits != null ? def.digits : 2)) : '';
        rec[`${def.label} 변화(${(it && it.chgUnit) || '%'})`] = it && it.ok && it.chg != null ? it.chg : '';
      });
      rec['데이터 기준'] = state.market.mock ? '목업' : '자동수집';
    }
    const s = state.signals || {};
    ['curve', 'stockRate', 'alignment', 'dollar', 'vix', 'korea', 'phase'].forEach((k) => { rec[`자동_${SIGNAL_TITLES[k]}`] = s[k] ? s[k].name : ''; });
    rec['자동_주의 신호'] = (s.flags || []).join(' / ');
    rec['신호 기준일'] = s.signalDate || '';
    rec['자동_섹터 시사점'] = s.sectors ? S.sectorText(s.sectors) : '';
    const checks = C.daily.filter((sec) => d[`확인_${sec.title}`]).length;
    rec['확인한 섹션'] = `${checks}/${C.daily.length}`;
    for (let i = 1; i <= 3; i++) {
      const n = d[`발표지표${i}_이름`];
      if (n) rec[`발표지표${i}`] = `${n} | 예상 ${d[`발표지표${i}_예상`] || '-'} | 실제 ${d[`발표지표${i}_실제`] || '-'} | 이전 ${d[`발표지표${i}_이전`] || '-'}`;
      else rec[`발표지표${i}`] = '';
    }
    Object.entries(d).forEach(([k, v]) => {
      if (k.startsWith('확인_') || k.startsWith('발표지표')) return;
      rec[k] = v === true ? 'O' : v === false ? '' : v;
    });
    // 이벤트
    const type = ev['이벤트_종류'];
    rec['이벤트_종류'] = type || '';
    if (type) {
      const items = C.events[type] || [];
      rec['이벤트_체크리스트'] = items.map((t, i) => `${ev[`이벤트_체크_${i}`] ? '[v]' : '[ ]'} ${t}${ev[`이벤트_메모_${i}`] ? ': ' + ev[`이벤트_메모_${i}`] : ''}`).join('\n');
      Object.entries(ev).forEach(([k, v]) => { if (!/^이벤트_(체크|메모)_/.test(k) && k !== '이벤트_종류') rec[k] = v; });
    }
    rec['AI 종합분석'] = state.aiText || '';
    rec['AI 리포트 비교'] = state.cmpText || '';
    rec['작성 방식'] = authorMode();
    const AC = state.aiConcl;
    rec['AI 결론 JSON'] = AC ? JSON.stringify(AC) : '';
    rec['AI 종합 해석'] = AC ? AC['종합 해석'] || '' : '';
    rec['AI 결론 출처'] = state.aiSrc ? `${state.aiSrc.source} ${state.aiSrc.model || ''}`.trim() : '';
    S.FORECASTS.forEach((f) => { const k = f.key.replace('전망_', ''); rec[`AI전망_${k}`] = AC && AC['전망'] ? AC['전망'][k] || '' : ''; });
    const vv = verifyNow();
    rec['교차검증_데이터'] = vv && vv.list.length ? `일치 ${vv.ok} · 불일치 ${vv.bad}${vv.bad ? ` (${vv.list.filter((x) => x.status === '불일치').map((x) => x.text).join(', ')})` : ''}` : '';
    rec['교차검증_리포트 일치도'] = state.cmpMatch || '';
    const D = state.debate || {};
    rec['한 줄 요약'] = D.headline || '';
    rec['AI 토론'] = debateSummaryText(D);
    rec['리스크팀 판단'] = D.risk ? D.risk.balance || '' : '';
    S.FORECASTS.forEach((f) => {
      const k = f.key.replace('전망_', '');
      rec[`BULL전망_${k}`] = D.open && D.open.bull && D.open.bull.forecast ? D.open.bull.forecast[k] || '' : '';
      rec[`BEAR전망_${k}`] = D.open && D.open.bear && D.open.bear.forecast ? D.open.bear.forecast[k] || '' : '';
    });
    return rec;
  }
  async function saveDaily() {
    const btn = $('#saveDaily');
    btn.disabled = true; btn.textContent = '저장 중…';
    try {
      const j = await api('/api/save', { method: 'POST', body: JSON.stringify({ sheet: '데일리', record: buildDailyRecord() }) });
      $('#saveNote').textContent = `${state.date} 기록을 시트 ${j.row}행에 ${j.updated ? '덮어썼습니다' : '추가했습니다'}.`;
      if ($('#saveNoteBrief')) $('#saveNoteBrief').textContent = $('#saveNote').textContent;
      toast('구글 시트에 저장했습니다', 'ok');
    } catch (e) {
      toast(e.message, 'err');
      $('#saveNote').textContent = e.message;
    } finally {
      btn.disabled = false; btn.textContent = '구글 시트에 저장';
    }
  }
  async function saveWeekly() {
    const w = collect($('#view-weekly'));
    const rec = { '날짜': weekStart(state.date), '저장시각': new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }) };
    if (state.market) {
      C.weeklyItems.forEach((id) => {
        const it = state.market.items[id];
        const def = C.indicators[id];
        rec[def.label] = it && it.ok ? it.value : '';
        rec[`${def.label} 5일 변화(${(it && it.chgUnit) || '%'})`] = it && it.ok && it.chg5 != null ? it.chg5 : '';
      });
    }
    Object.assign(rec, w);
    const us10 = state.market && state.market.items.us10y && state.market.items.us10y.ok ? state.market.items.us10y.value : null;
    ['독일', '일본', '중국', '한국'].forEach((c) => {
      const x = parseFloat(w[`${c} 10년(%)`]);
      rec[`${c}−미국 10년(bp)`] = us10 != null && !isNaN(x) ? Math.round((x - us10) * 100) : '';
    });
    try {
      await api('/api/save', { method: 'POST', body: JSON.stringify({ sheet: '주간', record: rec }) });
      toast('주간 기록을 저장했습니다', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  }

  // ---------- 이벤트 연결 ----------
  function bind() {
    $$('.tab').forEach((t) => t.addEventListener('click', () => showView(t.dataset.tab)));
    $('#checkDate').value = state.date;
    $('#checkDate').addEventListener('change', (e) => {
      saveDraft();
      state.date = e.target.value || todayKST();
      state.aiText = '';
      renderAll(false);
    });
    $('#refreshBtn').addEventListener('click', loadMarket);
    applyBg();
    document.addEventListener('change', (e) => { if (e.target.name === 'setBg') setTheme(e.target.value); });
    $('#settingsBtn').addEventListener('click', () => {
      const s = settings();
      $('#setPasscode').value = s.passcode || '';
      $('#setSheetUrl').value = s.sheetUrl || '';
      $('#setMock').checked = !!s.mock;
      const bg = $(`input[name="setBg"][value="${s.bg || 'pro'}"]`); if (bg) bg.checked = true;
      $('#settingsDialog').showModal();
    });
    $('#settingsDialog').addEventListener('close', () => {
      if ($('#settingsDialog').returnValue !== 'save') { applyBg(); return; }
      const prev = settings();
      const s = { passcode: $('#setPasscode').value.trim(), sheetUrl: $('#setSheetUrl').value.trim(), mock: $('#setMock').checked, bg: ($('input[name="setBg"]:checked') || {}).value || 'pro' };
      store.set('md-settings', s);
      applyBg();
      renderRecordsShell();
      if (prev.mock !== s.mock) loadMarket();
      toast('설정을 저장했습니다', 'ok');
    });

    document.addEventListener('input', (e) => {
      if (e.target.closest('[data-key]') || e.target.matches('[data-key]')) {
        if (e.target.dataset.key && e.target.dataset.key.startsWith('발표지표')) updateSurprises();
        if (e.target.dataset.key && e.target.dataset.key.endsWith('10년(%)')) updateVsUs();
        saveDraft();
      }
    });
    document.addEventListener('change', (e) => {
      if (e.target.name === 'view') { $('#viewHidden').value = e.target.value; saveDraft(); }
      else if (e.target.id === 'eventType') { renderEventChecklist(); saveDraft(); }
      else if (e.target.matches('[data-key]')) {
        saveDraft();
        if (e.target.dataset.key === '이야기' || e.target.dataset.key.startsWith('외국인') || e.target.dataset.key === '업종 상위·하위') renderGuides();
      }
    });
    // 뷰 버튼: 이미 고른 버튼을 다시 누르면 선택 해제
    document.addEventListener('pointerdown', (e) => {
      const lab = e.target.closest('.seg label');
      if (lab) lab.dataset.was = lab.querySelector('input').checked ? '1' : '';
    });
    document.addEventListener('click', (e) => {
      const segLab = e.target.closest('.seg label');
      if (segLab && segLab.dataset.was === '1') {
        e.preventDefault();
        segLab.querySelector('input').checked = false;
        segLab.dataset.was = '';
        $('#viewHidden').value = '';
        saveDraft();
        renderGuides();
        return;
      }
      const act = e.target.closest('[data-act]');
      if (act) {
        const a = act.dataset.act;
        if (a === 'goto-conclusion') { gotoTab('daily'); if ($('#myConcl')) $('#myConcl').open = true; setTimeout(() => $('#conclusionPanel').scrollIntoView({ behavior: 'smooth' }), 50); return; }
        if (a === 'goto-center') { e.preventDefault(); gotoTab('center'); return; }
        if (a === 'goto') { e.preventDefault(); gotoTab(act.dataset.val); return; }
        if (a === 'x-open') { const el = $('#' + act.dataset.val); if (el) { el.open = true; el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } if (act.dataset.val === 'xScore' && !state.scored && $('[data-act="load-scores"]')) $('[data-act="load-scores"]').click(); return; }
        if (a === 'ind-region') { state.indRegion = act.dataset.val; renderIndustry(); return; }
        if (a === 'sec-period') { state.secPeriod = act.dataset.val; renderSectors(); return; }
        if (a === 'sec-fill') { sectorFill(); return; }
        if (a === 'ai-chief') { runChief(); return; }
        if (a === 'load-morning') { loadMorning(false); return; }
        if (a === 'load-industry') { loadIndustry(false); return; }
        if (a === 'make-industry') { makeIndustry(); return; }
        if (a === 'load-rank') { loadRank(); return; }
        if (a === 'make-company') { if (state.company && !confirm('오늘 기업 카드를 새로 만들까요?')) return; makeCompany(); return; }
        if (a === 'analyze') { makeCompany(act.dataset.val); return; }
        if (a === 'analyze-custom') { const t = ($('#customTicker') || {}).value; if (t && t.trim()) makeCompany(t.trim()); return; }
        if (a === 'open-card') { openPastCard(act.dataset.val); return; }
        if (a === 'goto-industry') { e.preventDefault(); gotoTab('industry'); return; }
        if (a === 'goto-company') { e.preventDefault(); gotoTab('company'); return; }
        if (a === 'goto-brief') { e.preventDefault(); gotoTab('brief'); return; }
        if (a === 'load-scores') { e.preventDefault(); loadRecords(); return; }
        if (a === 'copy-ai-concl') { e.preventDefault(); if (conclusionText(collect($('#view-daily'))) && !confirm('내 결론 칸을 AI 결론으로 바꿀까요?')) return; applyConclusion(state.aiConcl || {}, 'AI 리서치센터'); gotoTab('daily'); if ($('#myConcl')) $('#myConcl').open = true; setTimeout(() => $('#conclusionPanel').scrollIntoView({ behavior: 'smooth' }), 50); return; }
        if (a === 'debate-resume') { const f = (state.debateRun || {}).failed; f === 'chief' ? runChief() : runDebate(f); return; }
        if (act.dataset.act === 'cmp-to-memo') {
          const plain = (state.cmpText || '').replace(/^#+\s*/gm, '').replace(/\*\*/g, '');
          setField('리포트 비교 메모', plain, 'append');
        } else guideAction(act.dataset.act, act.dataset.val);
        return;
      }
      if (e.target.id === 'aiBtn') runAI();
      else if (e.target.id === 'compareBtn') runCompare();
      else if (e.target.id === 'briefBtn') runBrief();
      else if (e.target.id === 'briefMake') makeBriefNow();
      else if (e.target.id === 'saveBrief') saveDaily();
      else if (e.target.id === 'debateStart') {
        if (state.debate && state.debate.open && !confirm('지금 토론을 지우고 처음부터 다시 할까요?')) return;
        runDebate();
      }
      else if (e.target.id === 'toggleGuides') {
        const open = !guidesOpen();
        store.set('md-guides-open', open);
        $$('#conclusionPanel details.guide').forEach((d) => { d.open = open; });
        e.target.textContent = open ? '가이드 모두 접기' : '가이드 모두 펴기';
      }
      else if (e.target.id === 'clearFile') { $('#reportFile').value = ''; }
      else if (e.target.id === 'saveDaily') saveDaily();
      else if (e.target.id === 'saveWeekly') saveWeekly();
      else if (e.target.id === 'loadRecords') loadRecords();
      const tr = e.target.closest('table.rec tbody tr[data-i]');
      if (tr) { const det = tr.nextElementSibling; det.hidden = !det.hidden; tr.classList.toggle('open', !det.hidden); }
    });
  }

  function renderAll(fetchData) {
    renderBriefShell();
    renderConclusion();
    renderEvent();
    renderRecordsShell();
    const draft = store.get(draftKey(), {});
    restore($('#conclusionPanel'), draft);
    restore($('#eventPanel'), draft);
    restore($('#briefPanel'), draft);
    renderEventChecklist();
    if (draft['뷰 변화']) { const r = $(`input[name="view"][value="${draft['뷰 변화']}"]`); if (r) r.checked = true; }
    state.aiText = draft.__ai || '';
    $('#aiOut').innerHTML = state.aiText ? renderMarkdown(state.aiText) : '<span class="muted">아직 분석하지 않았습니다.</span>';
    state.cmpText = draft.__cmp || '';
    state.authorMode = draft.__mode || '';
    state.debate = draft.__debate || null;
    state.debateRun = {};
    state.briefSnap = draft.__snap || '';
    state.aiConcl = draft.__aiConcl || null;
    state.aiSrc = draft.__aiSrc || null;
    state.cmpMatch = draft.__cmpMatch || '';
    state.morningMsg = '';
    if (!state.aiConcl && state.morningTried !== state.date) { state.morningTried = state.date; setTimeout(() => loadMorning(true), 0); }
    state.industry = null; state.company = null; state.rank = null; state.companyRows = null;
    state.industryTried = state.date; state.companyTried = state.date;
    setTimeout(() => { loadIndustry(true); loadCompany(true); }, 0);
    setTimeout(updateModeTag, 0);
    if (state.cmpText) $('#cmpOut').innerHTML = renderMarkdown(state.cmpText);
    if (fetchData) loadMarket(); else rerenderData(false);
  }

  bind();
  renderAll(true);
})();
