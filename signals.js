// 자동 해석 로직: 가이드 문서의 해석 방법을 규칙으로 옮긴 것
// 브라우저(window.Signals)와 테스트(Node require) 양쪽에서 씁니다.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Signals = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const v = (items, id) => (items[id] && items[id].ok ? items[id].value : null);
  const c = (items, id) => (items[id] && items[id].ok ? items[id].chg : null);
  const sign = (x, dead) => (x == null ? 0 : x > dead ? 1 : x < -dead ? -1 : 0);
  const fmt = (x, d = 2) => (x == null ? '-' : (x > 0 ? '+' : '') + Number(x).toFixed(d));

  // 1. 금리 커브 패턴 (2년물·10년물 변화, bp)
  function curve(d2, d10) {
    if (d2 == null || d10 == null) return null;
    const base = { detail: `2년물 ${fmt(d2, 1)}bp, 10년물 ${fmt(d10, 1)}bp` };
    if (Math.abs(d2) < 2 && Math.abs(d10) < 2) return { ...base, name: '보합', tone: 'neutral', meaning: '금리 변화가 작아 뚜렷한 커브 신호 없음' };
    if (d2 >= 0 && d10 >= 0) {
      return d2 > d10
        ? { ...base, name: '베어 플래트닝', tone: 'warn', meaning: '단기금리가 더 올라 연준 긴축(인상·동결) 기대가 강해진 모습' }
        : { ...base, name: '베어 스티프닝', tone: 'warn', meaning: '장기금리가 더 올라 장기 물가·재정 우려나 기간 프리미엄 상승 가능성' };
    }
    if (d2 <= 0 && d10 <= 0) {
      return Math.abs(d2) > Math.abs(d10)
        ? { ...base, name: '불 스티프닝', tone: 'info', meaning: '단기금리가 더 내려 금리 인하 기대가 커진 모습 (경기 둔화 우려 동반 여부 확인)' }
        : { ...base, name: '불 플래트닝', tone: 'info', meaning: '장기금리가 더 내려 장기 성장 둔화 우려나 안전자산 선호 가능성' };
    }
    return d2 > 0
      ? { ...base, name: '트위스트 플래트닝', tone: 'warn', meaning: '단기는 오르고 장기는 내림: 긴축 기대 + 성장 둔화 우려가 함께 나타남' }
      : { ...base, name: '트위스트 스티프닝', tone: 'info', meaning: '단기는 내리고 장기는 오름: 인하 기대와 장기 물가·재정 우려가 함께 나타남' };
  }

  // 2. 주식 × 금리 조합 (10년물 bp, S&P500 %)
  function stockRate(d10, spx) {
    if (d10 == null || spx == null) return null;
    const r = sign(d10, 1.5), s = sign(spx, 0.15);
    const detail = `10년물 ${fmt(d10, 1)}bp, S&P500 ${fmt(spx)}%`;
    if (r === 0 || s === 0) return { name: '방향성 약함', tone: 'neutral', detail, meaning: '금리나 주식 중 하나의 움직임이 작아 조합 해석이 어려운 날' };
    if (r > 0 && s > 0) return { name: '좋은 금리 상승', tone: 'good', detail, meaning: '경기가 좋아서 금리와 주가가 함께 오름 (성장 이야기)' };
    if (r > 0 && s < 0) return { name: '나쁜 금리 상승', tone: 'bad', detail, meaning: '물가·긴축 우려로 금리가 오르고 주가는 하락 (물가·정책 이야기)' };
    if (r < 0 && s > 0) return { name: '골디락스', tone: 'good', detail, meaning: '인하 기대 속에 경기는 괜찮다고 봄 (금리 하락 + 주가 상승)' };
    return { name: '위험 회피', tone: 'bad', detail, meaning: '경기 침체 우려로 금리와 주가가 함께 하락 (성장 둔화 이야기)' };
  }

  // 3. 지수 배열 (다우 < S&P500 < 나스닥 < 러셀)
  function alignment(p) {
    const names = { dow: '다우', spx: 'S&P500', ndx: '나스닥', rut: '러셀2000' };
    const order = ['dow', 'spx', 'ndx', 'rut'];
    if (order.some((k) => p[k] == null)) return null;
    const up = p.spx >= 0;
    const breaks = [];
    for (let i = 0; i < order.length - 1; i++) {
      const a = order[i], b = order[i + 1];
      const ok = up ? p[a] <= p[b] : p[a] >= p[b];
      if (!ok) breaks.push(`${names[a]} ${fmt(p[a])}% vs ${names[b]} ${fmt(p[b])}%`);
    }
    const detail = order.map((k) => `${names[k]} ${fmt(p[k])}%`).join(' · ');
    const notes = [];
    if (up && p.ndx - p.rut > 1) notes.push('나스닥이 러셀보다 1%p 이상 강함: 빅테크 쏠림, 시장 폭이 좁음');
    if (up && p.rut - p.ndx > 1) notes.push('러셀이 나스닥보다 1%p 이상 강함: 중소형·경기민감주로 순환매');
    if (p.dow > 0 && p.ndx < 0 && p.rut < 0) notes.push('다우만 플러스: 방어적 대형 가치주로 피신');
    if (!breaks.length) {
      return { name: up ? '정배열 (상승장)' : '정배열 (하락장)', tone: 'good', detail, meaning: up ? '위험도가 높은 지수일수록 더 오름: 자연스러운 위험 선호' : '위험도가 높은 지수일수록 더 내림: 자연스러운 위험 회피', notes };
    }
    return { name: '역배열', tone: 'warn', detail, meaning: `순서가 깨진 구간: ${breaks.join(', ')}. 원인 분석 필요`, notes };
  }

  // 4. 10년물 분해 (실질금리 vs 기대인플레이션, bp)
  function decompose(dReal, dBei, d10) {
    if (dReal == null || dBei == null) return null;
    const detail = `실질금리 ${fmt(dReal, 1)}bp, 기대인플레이션 ${fmt(dBei, 1)}bp`;
    if (Math.abs(dReal) < 2 && Math.abs(dBei) < 2) return { name: '변화 작음', tone: 'neutral', detail, meaning: '10년물 변화의 주도 요인이 뚜렷하지 않음' };
    const realLead = Math.abs(dReal) >= Math.abs(dBei);
    const dir = (d10 != null ? d10 : dReal + dBei) >= 0 ? '상승' : '하락';
    if (realLead) {
      return dir === '상승'
        ? { name: '실질금리 주도 상승', tone: 'warn', detail, meaning: '성장이 좋거나 긴축 이야기. 금·성장주에 부담' }
        : { name: '실질금리 주도 하락', tone: 'info', detail, meaning: '인하 기대 또는 성장 둔화. 금·성장주에 우호적' };
    }
    return dir === '상승'
      ? { name: '기대인플레 주도 상승', tone: 'warn', detail, meaning: '물가 이야기. 유가 동반 상승 여부 확인' }
      : { name: '기대인플레 주도 하락', tone: 'info', detail, meaning: '수요 둔화·디스인플레이션 신호. 유가 하락 동반 여부 확인' };
  }

  function vixRegime(x) {
    if (x == null) return null;
    if (x <= 15) return { name: '안정', tone: 'good', meaning: 'VIX 15 이하' };
    if (x < 20) return { name: '보통', tone: 'neutral', meaning: 'VIX 15~20' };
    if (x < 25) return { name: '변동성 확대', tone: 'warn', meaning: 'VIX 20 이상: 기록하고 지수 배열·금리 구조와 연결해 해석' };
    return { name: '위험 회피 심화', tone: 'bad', meaning: 'VIX 25 이상: 하이일드 스프레드 동반 확대 여부 확인' };
  }

  function hyRegime(x) {
    if (x == null) return null;
    if (x < 4) return { name: '안정', tone: 'good', meaning: '하이일드 스프레드 4% 미만 (경험적 참고치)' };
    if (x < 5) return { name: '경계', tone: 'warn', meaning: '4~5%: 신용시장 긴장 시작' };
    return { name: '스트레스', tone: 'bad', meaning: '5% 이상: 기업 자금조달 우려' };
  }

  // 5. 달러 움직임의 원인
  function dollar(dxy, d2, vixChg, spx) {
    if (dxy == null) return null;
    const detail = `달러인덱스 ${fmt(dxy)}%`;
    if (Math.abs(dxy) < 0.2) return { name: '보합', tone: 'neutral', detail, meaning: '달러 방향성 약함' };
    if (dxy > 0) {
      if (vixChg != null && vixChg > 5 && spx != null && spx < 0) return { name: '위험 회피형 강세', tone: 'bad', detail, meaning: 'VIX 상승·주가 하락과 함께: 글로벌 스트레스, 신흥국·한국에 가장 불리' };
      if (d2 != null && d2 > 2) return { name: '금리형 강세', tone: 'warn', detail, meaning: '미국 단기금리 상승과 함께: 미국 상대 강세, 위험자산엔 꼭 나쁘지 않음' };
      return { name: '강세 (원인 확인)', tone: 'warn', detail, meaning: '금리·위험회피 신호가 약함: 유로·엔 등 상대 통화 요인 확인' };
    }
    if (spx != null && spx > 0) return { name: '위험 선호형 약세', tone: 'good', detail, meaning: '주가 상승과 함께: 글로벌 유동성 개선, 신흥국·한국에 우호적' };
    if (d2 != null && d2 < -2) return { name: '경기 우려형 약세', tone: 'warn', detail, meaning: '미국 금리 하락·주가 약세와 함께: 미국 경기 우려' };
    return { name: '약세 (원인 확인)', tone: 'info', detail, meaning: '상대 통화 강세 요인 확인' };
  }

  // 6. 한국 전이
  function korea(items) {
    const spx = c(items, 'spx'), sox = c(items, 'sox'), kospi = c(items, 'kospi'), krw = c(items, 'usdkrw');
    if (kospi == null) return null;
    const usUp = (spx != null && spx > 0.3) || (sox != null && sox > 0.5);
    const usDown = (spx != null && spx < -0.3) || (sox != null && sox < -0.5);
    const detail = `KOSPI ${fmt(kospi)}% · 미국 반도체 ${fmt(sox)}% · 원달러 ${fmt(krw)}%`;
    const notes = [];
    const krwPrev = items.usdkrw && items.usdkrw.ok ? items.usdkrw.prev : null;
    const krwMove = krwPrev != null ? items.usdkrw.value - krwPrev : null;
    if (krwMove != null && Math.abs(krwMove) >= 10) notes.push(`원달러 ${fmt(krwMove, 1)}원: 하루 10원 이상 변동, 원인 기록`);
    if (krw != null && krw > 0.3 && kospi < 0) notes.push('원화 약세 + KOSPI 하락: 외국인 매도 동반 여부 확인');
    if (usUp && kospi < -0.3) return { name: '미국과 반대로 약세', tone: 'warn', detail, meaning: '한국 고유 요인(원화, 외국인 수급, 국내 정책·정치, 중국) 점검 필요', notes };
    if (usDown && kospi > 0.3) return { name: '미국과 반대로 강세', tone: 'info', detail, meaning: '한국만의 호재(수급, 정책, 업종 이슈) 확인', notes };
    return { name: '미국과 같은 방향', tone: 'neutral', detail, meaning: '정상 전이. 금리·달러 경로와 반도체 경로 중 무엇이 컸는지 확인', notes };
  }

  // 7. 오늘 데이터가 기울게 한 국면 (참고용)
  function phase(items) {
    const g = sign(c(items, 'spx'), 0.15) + sign(c(items, 'copper'), 0.3) + sign(c(items, 'rut'), 0.3);
    const i = sign(c(items, 'bei10y'), 1) + sign(c(items, 'wti'), 0.8);
    if (g === 0 && i === 0) return { name: '판단 보류', tone: 'neutral', meaning: '성장·물가 신호 모두 약함' };
    const growthUp = g > 0, inflUp = i > 0;
    const detail = `성장 신호 ${g > 0 ? '+' : ''}${g} (주가·구리·러셀), 물가 신호 ${i > 0 ? '+' : ''}${i} (기대인플레·유가)`;
    if (growthUp && !inflUp) return { name: '골디락스 쪽', tone: 'good', detail, meaning: '성장↑ 물가↓: 주식(특히 성장주) 유리' };
    if (growthUp && inflUp) return { name: '리플레이션 쪽', tone: 'info', detail, meaning: '성장↑ 물가↑: 경기민감주·원자재·금융주 유리, 금리 상승' };
    if (!growthUp && !inflUp) return { name: '침체·디스인플레이션 쪽', tone: 'warn', detail, meaning: '성장↓ 물가↓: 채권·방어주 유리, 금리 하락' };
    return { name: '스태그플레이션 우려 쪽', tone: 'bad', detail, meaning: '성장↓ 물가↑: 대부분 자산에 불리' };
  }

  // 의미 있는 움직임 표시
  function flags(items) {
    const out = [];
    const d2 = c(items, 'us2y'), d10 = c(items, 'us10y');
    if (d2 != null && Math.abs(d2) >= 10) out.push(`미국 2년물 ${fmt(d2, 1)}bp: 10bp 이상, 원인 확인`);
    if (d10 != null && Math.abs(d10) >= 10) out.push(`미국 10년물 ${fmt(d10, 1)}bp: 10bp 이상, 원인 확인`);
    const t10 = items.us10y;
    if (t10 && t10.ok && t10.prev != null && Math.floor(t10.value) !== Math.floor(t10.prev)) out.push(`10년물 앞자리 변화 (${t10.prev}% → ${t10.value}%): 반드시 기록`);
    const wti = c(items, 'wti');
    if (wti != null && Math.abs(wti) >= 3) out.push(`WTI ${fmt(wti)}%: 3% 이상, 수요 요인인지 공급 요인인지 구분`);
    const wb = c(items, 'wtibrent');
    if (wb != null && Math.abs(wb) >= 1) out.push(`WTI−브렌트 차이 ${fmt(wb)}달러 변화: 미국 밖(중동 등) 공급 이슈인지 확인`);
    const t = v(items, 't10y2y');
    if (t != null && t < 0) out.push(`장단기 금리차 역전 (${t}%p): 경기 둔화 신호 점검`);
    const jpy = c(items, 'usdjpy');
    if (jpy != null && jpy < -1) out.push(`엔화 급강세 (달러엔 ${fmt(jpy)}%): 엔캐리 청산 가능성 점검`);
    return out;
  }

  // 날짜 맞추기: 미국 자산 신호는 금리(2년·10년)와 S&P500이 모두 있는 마지막 날짜 기준으로 계산
  // (출처마다 업데이트 시점이 달라, 금리는 11/05인데 주식은 11/06인 식으로 어긋나는 것을 막음)
  const US_IDS = ['us2y', 'us10y', 't10y2y', 'real10y', 'bei10y', 'hy', 'dow', 'spx', 'ndx', 'rut', 'sox', 'dxy', 'usdjpy', 'usdcny', 'wti', 'brent', 'wtibrent', 'gold', 'copper', 'vix'];
  const ANCHORS = ['us2y', 'us10y', 'spx'];
  const lastDate = (it) => (it && it.ok && it.pts && it.pts.length ? it.pts[it.pts.length - 1][0] : (it && it.ok ? it.date : null));

  function align(items) {
    const dates = ANCHORS.map((id) => lastDate(items[id])).filter(Boolean).sort();
    if (!dates.length) return { date: null, latest: null, mismatch: false, items };
    const date = dates[0];
    const latest = dates[dates.length - 1];
    const out = Object.assign({}, items);
    US_IDS.forEach((id) => {
      const it = items[id];
      if (!it || !it.ok || !it.pts || !it.pts.length) return;
      let idx = -1;
      for (let i = it.pts.length - 1; i >= 0; i--) { if (it.pts[i][0] <= date) { idx = i; break; } }
      if (idx < 0) return;
      const val = it.pts[idx][1];
      const prev = idx > 0 ? it.pts[idx - 1][1] : null;
      let chg = null;
      if (prev != null) {
        if (it.chgUnit === 'bp') chg = Math.round((val - prev) * 1000) / 10;
        else if (it.chgUnit === '%') chg = Math.round(((val - prev) / prev) * 10000) / 100;
        else chg = Math.round((val - prev) * 100) / 100;
      }
      out[id] = Object.assign({}, it, { value: val, prev, chg, date: it.pts[idx][0] });
    });
    return { date, latest, mismatch: date !== latest, items: out };
  }

  // ---------- 결론 가이드용 ----------
  // 평소 하루 변동폭(경험적 참고치). 변화 ÷ 평소 변동폭이 클수록 '오늘 크게 움직인 것'
  const TYPICAL = {
    us2y: 6, us10y: 6, t10y2y: 5, dxy: 0.4, usdkrw: 0.5, usdjpy: 0.6,
    dow: 0.7, spx: 0.8, ndx: 1.1, rut: 1.3, sox: 2, wti: 2, brent: 2, gold: 1, copper: 1.3, vix: 7,
    kospi: 1, kosdaq: 1.2, kr3y: 4, kr10y: 5,
  };
  function topMovers(items, n = 3) {
    const A = align(items);
    const src = Object.assign({}, A.items, { kospi: items.kospi, kosdaq: items.kosdaq, usdkrw: items.usdkrw, kr3y: items.kr3y, kr10y: items.kr10y });
    return Object.keys(TYPICAL)
      .map((id) => ({ id, chg: c(src, id), unit: src[id] && src[id].chgUnit, score: c(src, id) == null ? 0 : Math.abs(c(src, id)) / TYPICAL[id] }))
      .filter((x) => x.chg != null && x.score >= 0.8)
      .sort((a, b) => b.score - a.score)
      .slice(0, n);
  }

  // ② 어떤 이야기인가: 자동 신호로 추천
  function recommendStory(sig) {
    const sr = sig.stockRate, cv = sig.curve, dc = sig.decompose, vx = sig.vix;
    if (!sr) return null;
    const why = [`주식×금리 조합: ${sr.name}`];
    if (cv) why.push(`커브: ${cv.name}`);
    let pick;
    if (sr.name === '좋은 금리 상승') pick = '성장';
    else if (sr.name === '나쁜 금리 상승') {
      if (dc && dc.name.startsWith('기대인플레')) { pick = '물가'; why.push(`10년물 분해: ${dc.name}`); }
      else pick = cv && cv.name.includes('플래트닝') ? '정책' : '물가';
    } else if (sr.name === '골디락스') pick = '정책';
    else if (sr.name === '위험 회피') {
      if (vx && (vx.name === '변동성 확대' || vx.name === '위험 회피 심화')) { pick = '위험 회피·지정학'; why.push(`VIX: ${vx.name}`); }
      else pick = '성장';
    } else pick = '뚜렷한 동인 없음';
    return { pick, why };
  }

  // ---------- 전망 채점 ----------
  // 전망은 '다음 5거래일 뒤 방향'. 기준값 = 점검일 직전 거래일 종가 (점검 시점에 알 수 있던 값)
  // 보합 범위 안이면 '보합'으로 봅니다.
  const FORECASTS = [
    { key: '전망_미국10년물', id: 'us10y', label: '미국 10년물', dead: 3, rate: true, unitText: '±3bp' },
    { key: '전망_S&P500', id: 'spx', label: 'S&P500', dead: 0.5, rate: false, unitText: '±0.5%' },
    { key: '전망_원달러', id: 'usdkrw', label: '원달러', dead: 0.5, rate: false, unitText: '±0.5%' },
    { key: '전망_KOSPI', id: 'kospi', label: 'KOSPI', dead: 0.7, rate: false, unitText: '±0.7%' },
  ];
  const HORIZON = 5;

  function scoreOne(pts, recordDate, call, f) {
    if (!call) return { status: '없음' };
    if (!pts || !pts.length) return { status: '데이터 없음' };
    let bi = -1;
    for (let i = 0; i < pts.length; i++) { if (pts[i][0] < recordDate) bi = i; else break; }
    if (bi < 0) return { status: '기간 지남' }; // 보관 중인 이력(약 6개월)보다 오래된 기록
    const ti = bi + HORIZON;
    if (ti >= pts.length) return { status: '대기', remaining: ti - (pts.length - 1) };
    const b = pts[bi][1], t = pts[ti][1];
    const chg = f.rate ? Math.round((t - b) * 1000) / 10 : Math.round(((t - b) / b) * 10000) / 100;
    const actual = chg > f.dead ? '상승' : chg < -f.dead ? '하락' : '보합';
    return { status: '채점', call, actual, chg, hit: actual === call, baseDate: pts[bi][0], targetDate: pts[ti][0] };
  }

  // records: 시트 기록 배열, items: /api/market 결과
  function scoreRecords(records, items) {
    const rows = (records || []).map((r) => {
      const res = {};
      FORECASTS.forEach((f) => { res[f.key] = scoreOne(items[f.id] && items[f.id].pts, r['날짜'], r[f.key], f); });
      return { date: r['날짜'], mode: r['작성 방식'] || '직접', res };
    });
    const tally = () => ({ hit: 0, total: 0 });
    const sum = { all: tally(), byAsset: {}, byMode: {}, pending: 0 };
    FORECASTS.forEach((f) => { sum.byAsset[f.key] = tally(); });
    rows.forEach((row) => {
      FORECASTS.forEach((f) => {
        const x = row.res[f.key];
        if (x.status === '대기') sum.pending++;
        if (x.status !== '채점') return;
        const m = row.mode.startsWith('AI') ? 'AI 작성' : '직접';
        sum.byMode[m] = sum.byMode[m] || tally();
        [sum.all, sum.byAsset[f.key], sum.byMode[m]].forEach((t) => { t.total++; if (x.hit) t.hit++; });
      });
    });
    return { rows, sum };
  }

  // ---------- 매크로 → 섹터 시사점 (교과서적 연결, 참고용) ----------
  // 각 규칙: 조건이 맞으면 유리(fav)·불리(unfav) 섹터와 이유를 더함. 같은 섹터가 양쪽에 걸리면 '엇갈림'으로 뺌.
  function sectorView(sig, items) {
    if (!sig || !items) return null;
    const A = align(items).items;
    const ch = (src, id) => c(src, id);
    const fav = {}, unfav = {};
    const add = (bucket, sectors, why) => sectors.forEach((s) => { (bucket[s] = bucket[s] || []).push(why); });
    const sr = sig.stockRate && sig.stockRate.name;
    if (sr === '좋은 금리 상승') { add(fav, ['금융(은행)', '산업재', '소재'], '경기 개선 + 금리 상승'); add(unfav, ['유틸리티', '리츠·부동산'], '금리 상승 부담'); }
    if (sr === '나쁜 금리 상승') { add(fav, ['금융(은행)'], '금리 상승'); add(unfav, ['기술·성장주', '리츠·부동산', '중소형주'], '긴축·물가 우려로 할인율 상승'); }
    if (sr === '골디락스') { add(fav, ['기술·성장주', '반도체', '중소형주'], '인하 기대 + 경기 양호'); add(unfav, ['필수소비재', '유틸리티'], '방어주 상대 열위'); }
    if (sr === '위험 회피') { add(fav, ['필수소비재', '유틸리티', '헬스케어'], '위험 회피 시 방어주'); add(unfav, ['반도체', '중소형주', '산업재'], '경기 둔화 우려'); }
    const cv = sig.curve && sig.curve.name;
    if (cv && cv.includes('스티프닝')) add(fav, ['금융(은행)'], `커브 ${cv}: 예대마진 개선`);
    if (cv && cv.includes('플래트닝')) add(unfav, ['금융(은행)'], `커브 ${cv}: 예대마진 부담`);
    const krwP = ch(items, 'usdkrw');
    if (krwP != null && krwP >= 0.3) { add(fav, ['수출주(자동차·조선)', '반도체'], `원화 약세(원달러 +${krwP}%)`); add(unfav, ['항공·여행', '내수 소비'], '원화 약세로 원가·구매력 부담'); }
    if (krwP != null && krwP <= -0.3) { add(fav, ['항공·여행', '내수 소비'], `원화 강세(원달러 ${krwP}%)`); add(unfav, ['수출주(자동차·조선)', '반도체'], '원화 강세로 환산 이익 감소'); }
    const oil = ch(A, 'wti');
    if (oil != null && oil >= 1.5) { add(fav, ['에너지·정유'], `유가 상승(WTI +${oil}%)`); add(unfav, ['항공·여행', '화학'], '유가 상승으로 원가 부담'); }
    if (oil != null && oil <= -1.5) { add(fav, ['항공·여행', '화학'], `유가 하락(WTI ${oil}%)`); add(unfav, ['에너지·정유'], '유가 하락'); }
    const sox = ch(A, 'sox');
    if (sox != null && sox >= 1.5) add(fav, ['반도체'], `미국 반도체 강세(SOX +${sox}%)`);
    if (sox != null && sox <= -1.5) add(unfav, ['반도체'], `미국 반도체 약세(SOX ${sox}%)`);
    const kr10 = ch(items, 'kr10y');
    if (kr10 != null && kr10 >= 5) { add(fav, ['금융(은행·보험)'], `국고채 10년 +${kr10}bp`); add(unfav, ['건설', '리츠·부동산'], '국내 금리 상승'); }
    if (kr10 != null && kr10 <= -5) { add(fav, ['건설', '리츠·부동산'], `국고채 10년 ${kr10}bp`); }
    const mixed = Object.keys(fav).filter((s) => unfav[s]);
    const pack = (b) => Object.keys(b).filter((s) => !mixed.includes(s)).map((s) => ({ sector: s, why: b[s] })).sort((x, y) => y.why.length - x.why.length);
    return { fav: pack(fav), unfav: pack(unfav), mixed: mixed.map((s) => ({ sector: s, fav: fav[s], unfav: unfav[s] })) };
  }
  function sectorText(v) {
    if (!v) return '';
    const f = (arr) => arr.map((x) => `${x.sector}(${x.why.join(', ')})`).join('; ');
    const L = [];
    if (v.fav.length) L.push(`유리: ${f(v.fav)}`);
    if (v.unfav.length) L.push(`불리: ${f(v.unfav)}`);
    if (v.mixed.length) L.push(`엇갈림: ${v.mixed.map((x) => x.sector).join(', ')}`);
    return L.join('\n');
  }

  // 출처별 전망 적중률: AI 센터장 · BULL · BEAR · 나. 출처마다 전망이 있는 기록만 따로 집계
  const ACTORS = [
    { name: 'AI', prefix: 'AI전망_', label: 'AI 센터장' },
    { name: 'BULL', prefix: 'BULL전망_', label: 'BULL' },
    { name: 'BEAR', prefix: 'BEAR전망_', label: 'BEAR' },
    { name: '나', prefix: '전망_', label: '나' },
  ];
  function scoreActors(records, items) {
    const byActor = {};
    ACTORS.forEach((a) => {
      const t = { hit: 0, total: 0, pending: 0, days: 0 };
      (records || []).forEach((r) => {
        let any = false;
        FORECASTS.forEach((f) => {
          const x = scoreOne(items[f.id] && items[f.id].pts, r['날짜'], r[f.key.replace('전망_', a.prefix)], f);
          if (x.status === '대기') t.pending++;
          if (x.status !== '채점') return;
          any = true; t.total++; if (x.hit) t.hit++;
        });
        if (any) t.days++;
      });
      byActor[a.name] = t;
    });
    return { byActor };
  }

  // ---------- 교차검증 ①: AI 문장 속 숫자를 실제 데이터와 대조 ----------
  // "KOSPI −0.81%", "2년물 +5.0bp", "원달러 +10원"처럼 지표 이름 뒤에 나온 변화 수치를 찾아 데이터와 비교
  const ALIASES = [
    ['kr10y', ['국고채 10년', '국고채10년']], ['kr3y', ['국고채 3년', '국고채3년']],
    ['t10y2y', ['장단기 금리차', '2s10s']], ['us2y', ['미국 2년물', '2년물']], ['us10y', ['미국 10년물', '10년물']],
    ['dxy', ['달러인덱스', '달러 인덱스', 'DXY']], ['usdkrw', ['원달러', '원/달러', '달러/원']],
    ['sox', ['필라델피아 반도체', '필라델피아반도체', '미국 반도체', 'SOX']], ['spx', ['S&P500', 'S&P 500']],
    ['ndx', ['나스닥']], ['dow', ['다우']], ['rut', ['러셀2000', '러셀']], ['wti', ['WTI']], ['brent', ['브렌트']],
    ['copper', ['구리']], ['vix', ['VIX']], ['kosdaq', ['KOSDAQ', '코스닥']], ['kospi', ['KOSPI', '코스피']],
  ];
  function verifyClaims(text, items) {
    if (!text || !items) return [];
    const A = align(items).items;
    const out = [];
    const used = [];
    const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    ALIASES.forEach(([id, names]) => {
      names.forEach((nm) => {
        const re = new RegExp(`${esc(nm)}[^0-9+\\-−\\n]{0,10}?([+\\-−]?\\d+(?:\\.\\d+)?)\\s*(bp|%|원)(?:\\s*(상승|하락|올|내|강세|약세))?`, 'g');
        let m;
        while ((m = re.exec(text))) {
          const at = m.index;
          if (used.some(([s0, e0]) => at < e0 && at + m[0].length > s0)) continue; // 더 구체적인 이름이 이미 잡은 구간
          used.push([at, at + m[0].length]);
          let n = Number(m[1].replace('−', '-'));
          const unit = m[2];
          const signed = /^[+\-−]/.test(m[1]);
          if (!signed && m[3]) n = /하락|내|약세/.test(m[3]) ? -Math.abs(n) : Math.abs(n);
          const cands = [A[id], items[id]].filter((x) => x && x.ok);
          if (!cands.length) { out.push({ id, text: m[0], status: '데이터 없음' }); continue; }
          let status = '확인 불가', actual = null;
          for (const it of cands) {
            if (unit === 'bp' && it.chgUnit === 'bp' && it.chg != null) {
              actual = `${it.chg > 0 ? '+' : ''}${it.chg}bp`;
              status = Math.abs(it.chg - n) <= 1.05 ? '일치' : '불일치';
            } else if (unit === '원' && id === 'usdkrw' && it.prev != null) {
              const w = Math.round((it.value - it.prev) * 10) / 10;
              actual = `${w > 0 ? '+' : ''}${w}원`;
              status = Math.abs(w - n) <= 1.5 ? '일치' : '불일치';
            } else if (unit === '%' && it.chgUnit === '%' && (signed || m[3]) && it.chg != null) {
              actual = `${it.chg > 0 ? '+' : ''}${it.chg}%`;
              status = Math.abs(it.chg - n) <= 0.11 ? '일치' : '불일치';
            } else if (unit === '%' && it.chgUnit === 'bp' && !signed && !m[3]) {
              actual = `${it.value}%`; // 금리 수준
              // "5% 돌파", "4%대", "5% 부근"처럼 기준선을 말한 경우는 정확한 값이 아니라 방향·범위로 확인
              const after = text.slice(at + m[0].length, at + m[0].length + 8);
              const th = /^\s*(?:선|대)?\s*(?:을|를|에|로|이|가)?\s*(상향\s*)?(돌파|상회|넘|웃돌|위로|위에|위)/.test(after) ? 'over'
                : /^\s*(?:선|대)?\s*(?:을|를|에|로|이|가)?\s*(하향\s*)?(하회|밑돌|아래|붕괴|하향\s*돌파)/.test(after) ? 'under'
                : /^\s*(대|선|부근|근처|수준|안팎|가까이|근접)/.test(after) ? 'near' : '';
              if (th === 'over') status = it.value >= n - 0.005 ? '일치' : '불일치';
              else if (th === 'under') status = it.value <= n + 0.005 ? '일치' : '불일치';
              else if (th === 'near') status = /^\s*대/.test(after) ? (Math.floor(it.value) === Math.floor(n) ? '일치' : '불일치') : Math.abs(it.value - n) <= 0.15 ? '일치' : '불일치';
              else status = Math.abs(it.value - n) <= 0.03 ? '일치' : '불일치';
            }
            if (status === '일치') break;
          }
          out.push({ id, text: m[0].trim(), claimed: n, unit, actual, status });
        }
      });
    });
    return out;
  }

  // 미국 → 한국 전이 통계: 미국 장에서 큰 움직임이 있던 날, 그다음 서울 장은 어땠나 (보관 중인 약 6개월 이력)
  const TRANSMIT = [
    { key: 'us2y_up', label: '미국 2년물 +8bp 이상 급등', id: 'us2y', test: (c) => c >= 8, unit: 'bp' },
    { key: 'us2y_dn', label: '미국 2년물 −8bp 이하 급락', id: 'us2y', test: (c) => c <= -8, unit: 'bp' },
    { key: 'spx_dn', label: 'S&P500 −1% 이하 하락', id: 'spx', test: (c) => c <= -1, unit: '%' },
    { key: 'spx_up', label: 'S&P500 +1% 이상 상승', id: 'spx', test: (c) => c >= 1, unit: '%' },
    { key: 'sox_dn', label: '미국 반도체지수 −2% 이하', id: 'sox', test: (c) => c <= -2, unit: '%' },
    { key: 'vix_up', label: 'VIX +10% 이상 급등', id: 'vix', test: (c) => c >= 10, unit: '%' },
  ];
  function dailyChanges(pts, unit) {
    const out = [];
    for (let i = 1; i < (pts || []).length; i++) {
      const [d, v] = pts[i], p = pts[i - 1][1];
      if (v == null || p == null || !p) continue;
      out.push([d, unit === 'bp' ? Math.round((v - p) * 100) : Math.round(((v - p) / p) * 10000) / 100]);
    }
    return out;
  }
  function transmission(items) {
    const k = items && items.kospi && items.kospi.ok ? dailyChanges(items.kospi.pts, '%') : [];
    const fx = items && items.usdkrw && items.usdkrw.ok ? dailyChanges(items.usdkrw.pts, '%') : [];
    if (k.length < 20) return null;
    const nextAfter = (arr, d) => arr.find((x) => x[0] > d);
    const stat = (list) => {
      const n = list.length;
      if (!n) return { n: 0 };
      const ks = list.map((x) => x.k);
      return { n, down: Math.round((ks.filter((c) => c < 0).length / n) * 100), avg: Math.round((ks.reduce((a, b) => a + b, 0) / n) * 100) / 100,
        fxUp: Math.round((list.filter((x) => x.fx != null && x.fx > 0).length / Math.max(1, list.filter((x) => x.fx != null).length)) * 100) };
    };
    const base = stat(k.slice(1).map(([d, c]) => ({ k: c, fx: (fx.find((x) => x[0] === d) || [])[1] })));
    const rows = TRANSMIT.map((t) => {
      const it = items[t.id];
      if (!it || !it.ok) return Object.assign({}, t, { n: 0 });
      const days = dailyChanges(it.pts, t.unit).filter(([, c]) => t.test(c));
      const list = days.map(([d, c]) => { const nk = nextAfter(k, d); const nf = nextAfter(fx, d); return nk ? { d, c, k: nk[1], fx: nf ? nf[1] : null, kd: nk[0] } : null; }).filter(Boolean);
      return Object.assign({}, t, stat(list), { last: list.slice(-3) });
    });
    return { from: k[0][0], to: k[k.length - 1][0], base, rows };
  }

  // AI가 분석할 때 본 숫자 (데이터 대조를 '그때 본 숫자' 기준으로 하기 위해 저장)
  const KR_IDS = ['kospi', 'kosdaq', 'usdkrw', 'kr3y', 'kr10y'];
  function snapshot(items) {
    const A = align(items).items;
    const out = {};
    Object.keys(items || {}).forEach((id) => {
      const it = KR_IDS.includes(id) ? items[id] : A[id];
      if (!it || !it.ok) return;
      out[id] = { ok: true, date: it.date || lastDate(it), value: it.value, prev: it.prev == null ? null : it.prev, chg: it.chg == null ? null : it.chg, chgUnit: it.chgUnit };
    });
    return out;
  }
  // 한국 데이터가 미국 기준일 대비 어느 장인지
  //  after: 미국 기준일 뒤에 열린 서울 장 → 미국 영향이 반영된 '전이' 판단 가능
  //  same : 미국 기준일과 같은 날 서울 장(미국 장보다 먼저 끝남) → 전이는 아직 일어나지 않음, 전망으로만
  //  stale: 미국 기준일보다 오래된 서울 장 → 최신 서울 장이 빠졌을 수 있음
  function koreaFreshness(items, signalDate) {
    const k = items && items.kospi && items.kospi.ok ? (items.kospi.date || lastDate(items.kospi)) : null;
    if (!k || !signalDate) return { date: k, state: 'unknown' };
    return { date: k, state: k > signalDate ? 'after' : k === signalDate ? 'same' : 'stale' };
  }

  function all(items) {
    const A = align(items);
    const us = A.items;
    // 한국 전이: 미국은 기준일(전날 뉴욕 종가), 한국은 최신(그 뒤 열린 서울 장)으로 비교
    const kr = Object.assign({}, us, { kospi: items.kospi, kosdaq: items.kosdaq, usdkrw: items.usdkrw });
    const pct = (id) => c(us, id);
    const out = {
      signalDate: A.date,
      krFresh: koreaFreshness(items, A.date),
      dateMismatch: A.mismatch,
      latestDate: A.latest,
      curve: curve(c(us, 'us2y'), c(us, 'us10y')),
      stockRate: stockRate(c(us, 'us10y'), pct('spx')),
      alignment: alignment({ dow: pct('dow'), spx: pct('spx'), ndx: pct('ndx'), rut: pct('rut') }),
      decompose: decompose(c(us, 'real10y'), c(us, 'bei10y'), c(us, 'us10y')),
      dollar: dollar(pct('dxy'), c(us, 'us2y'), pct('vix'), pct('spx')),
      vix: vixRegime(v(us, 'vix')),
      hy: hyRegime(v(items, 'hy')),
      korea: korea(kr),
      phase: phase(us),
      flags: flags(us),
    };
    out.sectors = sectorView(out, items);
    return out;
  }

  return { curve, stockRate, alignment, decompose, vixRegime, hyRegime, dollar, korea, phase, flags, align, all, topMovers, recommendStory, FORECASTS, HORIZON, scoreOne, scoreRecords, ACTORS, scoreActors, sectorView, sectorText, verifyClaims, snapshot, koreaFreshness, transmission };
});
