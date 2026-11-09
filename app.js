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
  }
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
    Object.assign(d, collect($('#view-event')));
    d.__ai = state.aiText;
    store.set(draftKey(), d);
    store.set(weekKey(), collect($('#view-weekly')));
    updateProgress();
  }

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
    return `<div class="tile" title="${esc(def.desc)}">
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
      const links = sec.links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`).join('');
      return `<article class="card sec" id="sec-${sec.id}">
        <header class="sec-head">
          <span class="sec-no">${String(sec.no).padStart(2, '0')}</span>
          <div class="sec-titles"><h2>${esc(sec.title)}</h2><p>${esc(sec.lead)}</p></div>
          <label class="check"><input type="checkbox" data-key="확인_${esc(sec.title)}" /> 확인</label>
        </header>
        ${tiles ? `<div class="tiles">${tiles}</div>` : ''}
        ${sigs ? `<div class="signals">${sigs}</div>` : ''}
        ${releases}
        ${manual ? `<div class="fields">${manual}</div>` : ''}
        <details class="qs"><summary>생각할 질문</summary><ul>${qs}</ul></details>
        <div class="links">${links}</div>
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
      <div class="ov-right">
        <div class="ov-label">점검 진행</div>
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
  function renderConclusion() {
    $('#conclusionPanel').innerHTML = `
      <div class="card concl">
        <h2>오늘의 결론</h2>
        <p class="hint">1~8을 확인한 뒤, AI를 보기 전에 <b>내 결론부터</b> 씁니다.</p>
        <label class="fld wide"><span>① 오늘의 동인 — 무엇이 시장을 움직였나</span><textarea data-key="오늘의 동인" rows="2" placeholder="예: 미국 CPI 서프라이즈로 2년물 급등"></textarea></label>
        <label class="fld wide"><span>② 어떤 이야기인가</span>
          <select data-key="이야기">${['', '성장', '물가', '정책', '위험 회피·지정학', '실적·개별 이슈', '뚜렷한 동인 없음'].map((o) => `<option value="${o}">${o || '선택'}</option>`).join('')}</select></label>
        <label class="fld wide"><span>③ 한국 전이</span><input type="text" data-key="한국 영향" placeholder="예: 원달러 +10원, 외국인 매도로 KOSPI 약세" /></label>
        <div class="fld wide"><span>④ 국면 신호 <em class="auto-phase" id="autoPhase"></em></span>
          <select data-key="국면 판단">${['', '골디락스 쪽', '리플레이션 쪽', '침체·디스인플레이션 쪽', '스태그플레이션 우려 쪽', '판단 보류'].map((o) => `<option value="${o}">${o || '선택'}</option>`).join('')}</select></div>
        <div class="fld wide"><span>⑤ 기존 뷰 대비</span>
          <div class="seg">${['유지', '강화', '약화', '수정'].map((o) => `<label><input type="radio" name="view" value="${o}" /><span>${o}</span></label>`).join('')}</div>
          <input type="hidden" data-key="뷰 변화" id="viewHidden" /></div>
        <label class="fld wide"><span>⑥ 다음 체크포인트</span><input type="text" data-key="다음 체크포인트" placeholder="예: 목요일 PPI, 파월 의장 발언" /></label>
        <label class="fld wide"><span>종합 해석 (3~5문장)</span><textarea data-key="종합 해석" rows="5" placeholder="동인 → 해석 → 한국 영향 → 국면 신호 → 뷰 변화와 다음 확인 포인트"></textarea></label>

        <div class="ai-block">
          <div class="ai-head"><h3>AI 종합분석</h3><button class="btn" id="aiBtn">AI 분석 받기</button></div>
          <p class="hint">오늘의 데이터·자동 신호·내 결론을 보내, AI 해석과 내 결론에 대한 피드백을 받습니다.</p>
          <div class="ai-out" id="aiOut"><span class="muted">아직 분석하지 않았습니다.</span></div>
        </div>

        <div class="report-block">
          <h3>증권사 리포트와 비교</h3>
          <p class="hint"><a href="https://consensus.hankyung.com/analysis/list?skinType=market" target="_blank" rel="noopener">한경컨센서스 시장 리포트 ↗</a>에서 데일리를 찾아 비교합니다.</p>
          <label class="fld wide"><span>참고 리포트</span><input type="text" data-key="참고 리포트" placeholder="증권사 · 리포트 제목" /></label>
          <label class="fld wide"><span>리포트 비교 메모</span><textarea data-key="리포트 비교 메모" rows="3" placeholder="같은 점 / 다른 점 / 리포트만의 인사이트 / 내가 놓친 것"></textarea></label>
        </div>

        <button class="btn primary block" id="saveDaily">구글 시트에 저장</button>
        <div class="save-note" id="saveNote">같은 날짜로 다시 저장하면 그날 기록을 덮어씁니다.</div>
      </div>`;
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
        <p class="hint">저장은 <b>매일 점검</b> 탭의 '구글 시트에 저장' 버튼으로 함께 됩니다.</p>
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
        <div class="links"><a href="https://fred.stlouisfed.org/series/BAMLH0A0HYM2" target="_blank" rel="noopener">FRED 하이일드 ↗</a><a href="https://fred.stlouisfed.org/series/T10YIE" target="_blank" rel="noopener">FRED BEI ↗</a><a href="https://fred.stlouisfed.org/series/DFII10" target="_blank" rel="noopener">FRED 실질금리 ↗</a><a href="https://www.thebell.co.kr/" target="_blank" rel="noopener">더벨 ↗</a></div>
      </div>

      <div class="layout">
        <div class="col-main">
          <div class="card">
            <h2>이번 주 데일리 기록</h2>
            <div id="weekDailyList"><span class="muted">기록 탭에서 시트를 연결하면 이번 주 결론들이 여기에 모입니다.</span></div>
          </div>
          <div class="card">
            <h2>글로벌 10년물</h2>
            <p class="hint">미국만 움직였는지, 글로벌 금리가 같이 움직였는지 비교합니다. <a href="https://stock.naver.com/market/marketindex" target="_blank" rel="noopener">네이버 시장지표 ↗</a>에서 확인해 입력하세요.</p>
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
      <div class="card">
        <div class="wk-head"><h2>저장된 데일리 기록</h2>
          <div class="rec-actions">${url ? `<a class="btn ghost" href="${esc(url)}" target="_blank" rel="noopener">시트 열기 ↗</a>` : ''}<button class="btn" id="loadRecords">불러오기</button></div></div>
        <div id="recordsTable"><span class="muted">'불러오기'를 누르면 구글 시트의 최근 30일 기록을 가져옵니다.</span></div>
      </div>`;
  }
  async function loadRecords() {
    const box = $('#recordsTable');
    box.innerHTML = '<span class="muted">불러오는 중…</span>';
    try {
      const j = await api('/api/history?sheet=데일리&limit=30');
      state.records = j.rows || [];
      if (!state.records.length) { box.innerHTML = '<span class="muted">아직 저장된 기록이 없습니다.</span>'; return; }
      box.innerHTML = `<table class="rec"><thead><tr><th>날짜</th><th>오늘의 동인</th><th>이야기</th><th>국면</th><th>뷰</th></tr></thead><tbody>${state.records.map((r, i) => `
        <tr data-i="${i}"><td class="mono">${esc(r['날짜'])}</td><td>${esc(r['오늘의 동인'])}</td><td>${esc(r['이야기'])}</td><td>${esc(r['국면 판단'])}</td><td>${esc(r['뷰 변화'])}</td></tr>
        <tr class="rec-detail" hidden><td colspan="5"><div class="rec-body">${esc(r['종합 해석'] || '(종합 해석 없음)')}</div></td></tr>`).join('')}</tbody></table>`;
      renderWeekDaily();
    } catch (e) {
      box.innerHTML = `<div class="err">${esc(e.message)}</div>`;
    }
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
  }
  function setStatus(msg, kind) {
    const b = $('#statusBar');
    b.textContent = msg;
    b.className = 'status-bar ' + (kind || '');
  }
  function rerenderData(keepDom = true) {
    const draft = keepDom ? Object.assign({}, store.get(draftKey(), {}), collect($('#view-daily'))) : store.get(draftKey(), {});
    renderDaily();
    renderOverview();
    restore($('#dailySections'), draft);
    updateSurprises();
    updateProgress();
    const ph = state.signals && state.signals.phase;
    const ap = $('#autoPhase');
    if (ap) ap.textContent = ph ? `자동 참고: ${ph.name}` : '';
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
    return lines.join('\n');
  }
  function manualText(d) {
    const skip = new Set(['오늘의 동인', '이야기', '한국 영향', '국면 판단', '뷰 변화', '다음 체크포인트', '종합 해석', '참고 리포트', '리포트 비교 메모']);
    return Object.entries(d).filter(([k, v]) => !k.startsWith('확인_') && !k.startsWith('__') && !skip.has(k) && v !== '' && v !== false && v != null)
      .map(([k, v]) => `${k}: ${v === true ? '확인' : v}`).join('\n');
  }
  function conclusionText(d) {
    return ['오늘의 동인', '이야기', '한국 영향', '국면 판단', '뷰 변화', '다음 체크포인트', '종합 해석']
      .filter((k) => d[k]).map((k) => `${k}: ${d[k]}`).join('\n');
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
      const j = await api('/api/analyze', { method: 'POST', body: JSON.stringify({ date: state.date, dataText: dataText(), signalsText: signalsText(), manualText: manualText(d), conclusionText: conclusionText(d) }) });
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
    const d = collect($('#view-daily'));
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
        rec[`${def.label}`] = it && it.ok ? it.value : '';
        rec[`${def.label} 변화(${(it && it.chgUnit) || '%'})`] = it && it.ok && it.chg != null ? it.chg : '';
      });
      rec['데이터 기준'] = state.market.mock ? '목업' : '자동수집';
    }
    const s = state.signals || {};
    ['curve', 'stockRate', 'alignment', 'dollar', 'vix', 'korea', 'phase'].forEach((k) => { rec[`자동_${SIGNAL_TITLES[k]}`] = s[k] ? s[k].name : ''; });
    rec['자동_주의 신호'] = (s.flags || []).join(' / ');
    rec['신호 기준일'] = s.signalDate || '';
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
    return rec;
  }
  async function saveDaily() {
    const btn = $('#saveDaily');
    btn.disabled = true; btn.textContent = '저장 중…';
    try {
      const j = await api('/api/save', { method: 'POST', body: JSON.stringify({ sheet: '데일리', record: buildDailyRecord() }) });
      $('#saveNote').textContent = `${state.date} 기록을 시트 ${j.row}행에 ${j.updated ? '덮어썼습니다' : '추가했습니다'}.`;
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
    $$('.tab').forEach((t) => t.addEventListener('click', () => {
      $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
      $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + t.dataset.tab));
      if (t.dataset.tab === 'records' && !state.records) loadRecords();
    }));
    $('#checkDate').value = state.date;
    $('#checkDate').addEventListener('change', (e) => {
      saveDraft();
      state.date = e.target.value || todayKST();
      state.aiText = '';
      renderAll(false);
    });
    $('#refreshBtn').addEventListener('click', loadMarket);
    $('#settingsBtn').addEventListener('click', () => {
      const s = settings();
      $('#setPasscode').value = s.passcode || '';
      $('#setSheetUrl').value = s.sheetUrl || '';
      $('#setMock').checked = !!s.mock;
      $('#settingsDialog').showModal();
    });
    $('#settingsDialog').addEventListener('close', () => {
      if ($('#settingsDialog').returnValue !== 'save') return;
      const prev = settings();
      const s = { passcode: $('#setPasscode').value.trim(), sheetUrl: $('#setSheetUrl').value.trim(), mock: $('#setMock').checked };
      store.set('md-settings', s);
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
      else if (e.target.matches('[data-key]')) saveDraft();
    });
    document.addEventListener('click', (e) => {
      if (e.target.id === 'aiBtn') runAI();
      else if (e.target.id === 'saveDaily') saveDaily();
      else if (e.target.id === 'saveWeekly') saveWeekly();
      else if (e.target.id === 'loadRecords') loadRecords();
      const tr = e.target.closest('table.rec tbody tr[data-i]');
      if (tr) { const det = tr.nextElementSibling; det.hidden = !det.hidden; tr.classList.toggle('open', !det.hidden); }
    });
  }

  function renderAll(fetchData) {
    renderConclusion();
    renderEvent();
    renderRecordsShell();
    const draft = store.get(draftKey(), {});
    restore($('#conclusionPanel'), draft);
    restore($('#eventPanel'), draft);
    renderEventChecklist();
    if (draft['뷰 변화']) { const r = $(`input[name="view"][value="${draft['뷰 변화']}"]`); if (r) r.checked = true; }
    state.aiText = draft.__ai || '';
    $('#aiOut').innerHTML = state.aiText ? renderMarkdown(state.aiText) : '<span class="muted">아직 분석하지 않았습니다.</span>';
    if (fetchData) loadMarket(); else rerenderData(false);
  }

  bind();
  renderAll(true);
})();
