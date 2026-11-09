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
    const t = v(items, 't10y2y');
    if (t != null && t < 0) out.push(`장단기 금리차 역전 (${t}%p): 경기 둔화 신호 점검`);
    const jpy = c(items, 'usdjpy');
    if (jpy != null && jpy < -1) out.push(`엔화 급강세 (달러엔 ${fmt(jpy)}%): 엔캐리 청산 가능성 점검`);
    return out;
  }

  // 날짜 맞추기: 미국 자산 신호는 금리(2년·10년)와 S&P500이 모두 있는 마지막 날짜 기준으로 계산
  // (출처마다 업데이트 시점이 달라, 금리는 11/05인데 주식은 11/06인 식으로 어긋나는 것을 막음)
  const US_IDS = ['us2y', 'us10y', 't10y2y', 'real10y', 'bei10y', 'hy', 'dow', 'spx', 'ndx', 'rut', 'sox', 'dxy', 'usdjpy', 'usdcny', 'wti', 'gold', 'copper', 'vix'];
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
      if (prev != null) chg = it.chgUnit === 'bp' ? Math.round((val - prev) * 1000) / 10 : Math.round(((val - prev) / prev) * 10000) / 100;
      out[id] = Object.assign({}, it, { value: val, prev, chg, date: it.pts[idx][0] });
    });
    return { date, latest, mismatch: date !== latest, items: out };
  }

  function all(items) {
    const A = align(items);
    const us = A.items;
    // 한국 전이: 미국은 기준일(전날 뉴욕 종가), 한국은 최신(그 뒤 열린 서울 장)으로 비교
    const kr = Object.assign({}, us, { kospi: items.kospi, kosdaq: items.kosdaq, usdkrw: items.usdkrw });
    const pct = (id) => c(us, id);
    return {
      signalDate: A.date,
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
  }

  return { curve, stockRate, alignment, decompose, vixRegime, hyRegime, dollar, korea, phase, flags, align, all };
});
