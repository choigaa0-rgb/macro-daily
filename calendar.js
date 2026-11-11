// 주요 지표·통화정책 일정과 '결과별 영향 지도'
// 날짜는 각 기관의 공식 발표 일정 그대로 (미국은 동부시간, 한국은 한국시간).
// 출처: 연준 FOMC 일정(federalreserve.gov), BLS 발표 일정(bls.gov/schedule),
//       BEA 발표 일정 / 2027 주요 경제지표 발표일표(OMB PFEI), 한국은행 2027 금통위 개최 예정일(2026-10-29 의결)
// 1년에 한 번(보통 가을) 다음 해 일정을 아래에 추가하면 됩니다. FOMC 일정은 직전 회의에서 확정되는 '잠정' 일정입니다.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Calendar = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const ET = 'America/New_York';

  // tz: 'ET' 미국 동부시간 / 'KST'
  const TYPES = {
    FOMC: { name: 'FOMC 금리 결정', tz: 'ET', time: '14:00', event: 'FOMC', country: '미국' },
    CPI: { name: '미국 CPI', tz: 'ET', time: '08:30', event: 'CPI', country: '미국' },
    NFP: { name: '미국 고용(NFP)', tz: 'ET', time: '08:30', event: '고용(NFP)', country: '미국' },
    PPI: { name: '미국 PPI', tz: 'ET', time: '08:30', event: '기타', country: '미국' },
    PCE: { name: '미국 PCE 물가', tz: 'ET', time: '08:30', event: 'PCE', country: '미국' },
    BOK: { name: '한은 금통위', tz: 'KST', time: null, event: '금통위', country: '한국' },
  };

  const DATES = {
    // * = 경제전망(SEP)·점도표 발표 회의. 날짜는 결정 발표일(회의 둘째 날)
    FOMC: ['2026-12-09*', '2027-01-27', '2027-03-17*', '2027-04-28', '2027-06-09*', '2027-07-28', '2027-09-15*', '2027-10-27', '2027-12-08*', '2028-01-26'],
    CPI: ['2026-12-10', '2027-01-13', '2027-02-11', '2027-03-10', '2027-04-13', '2027-05-12', '2027-06-10', '2027-07-14', '2027-08-11', '2027-09-14', '2027-10-14', '2027-11-10', '2027-12-10'],
    NFP: ['2026-12-04', '2027-01-08', '2027-02-05', '2027-03-05', '2027-04-02', '2027-05-07', '2027-06-04', '2027-07-02', '2027-08-06', '2027-09-03', '2027-10-08', '2027-11-05', '2027-12-03'],
    PPI: ['2026-12-15', '2027-01-14', '2027-02-12', '2027-03-12', '2027-04-14', '2027-05-13', '2027-06-11', '2027-07-15', '2027-08-10', '2027-09-10', '2027-10-15', '2027-11-12', '2027-12-15'],
    PCE: ['2026-11-25', '2026-12-23', '2027-01-28', '2027-02-25', '2027-03-31', '2027-04-29', '2027-05-27', '2027-06-25', '2027-07-29', '2027-08-25', '2027-09-30', '2027-10-28', '2027-11-24', '2027-12-22'],
    BOK: ['2026-11-26', '2027-01-14', '2027-02-25', '2027-04-09', '2027-05-27', '2027-07-15', '2027-08-26', '2027-10-15', '2027-11-25'],
  };

  // 결과별 영향 지도 (교과서적 1차 반응 · 실제로는 그날 시장의 관심사에 따라 달라짐)
  const IMPACT = {
    CPI: {
      watch: '근원 CPI 전월비 (0.1%p 차이도 큰 서프라이즈), 주거비, 슈퍼코어',
      hot: '2년물↑ 달러↑ → 기술·성장주↓, 원달러↑(원화 약세), 외국인 매도 압력',
      cool: '2년물↓ 달러↓ → 기술·성장주↑, 원달러↓, 위험선호',
    },
    PPI: {
      watch: '근원 PPI 전월비 — CPI·PCE에 들어가는 항목(의료·항공·포트폴리오 관리)',
      hot: '물가 우려 → 금리↑ (보통 CPI보다 반응 작음)',
      cool: '물가 부담 완화 → 금리↓',
    },
    NFP: {
      watch: '비농업 고용 증가 vs 예상, 실업률, 평균시급, 이전 달 수정',
      hot: '긴축 우려 → 금리↑ 달러↑. 경기 자신감으로 경기민감주는 버틸 수 있음',
      cool: '금리↓ 달러↓. 너무 약하면 경기 침체 우려로 위험회피',
    },
    PCE: {
      watch: '근원 PCE 전월비·전년비 (연준이 목표로 보는 물가)',
      hot: '2년물↑ 달러↑ → 성장주↓',
      cool: '2년물↓ → 성장주↑',
    },
    FOMC: {
      watch: '결정 vs FedWatch, 성명서 문구, (*회의) 점도표 중간값, 기자회견 중 2년물',
      hot: '매파적(인상·점도표 상향) → 2년물↑ 달러↑ 기술주↓, 원달러↑',
      cool: '비둘기파적(동결·인하 시사) → 2년물↓ 달러↓ 위험선호, 원달러↓',
    },
    BOK: {
      watch: '결정과 소수의견, 3개월 금리 전망 분포, 총재 기자회견의 환율·부동산 언급',
      hot: '매파적 → 국고 3년↑ 원화 강세, 은행↑ 건설·리츠↓',
      cool: '비둘기파적 → 국고 3년↓ 원화 약세, 건설·내수↑',
    },
  };

  function tzOffsetMin(ts, tz) {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ts));
    const g = (t) => +p.find((x) => x.type === t).value;
    return Math.round((Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute')) - ts) / 60000);
  }
  // 현지 날짜·시각 → UTC ms (미국 서머타임 반영)
  function localToUtc(date, hhmm, tz) {
    const [y, m, d] = date.split('-').map(Number);
    const [h, mi] = (hhmm || '10:00').split(':').map(Number);
    const base = Date.UTC(y, m - 1, d, h, mi);
    if (tz === 'KST') return base - 9 * 3600000;
    let utc = base - tzOffsetMin(base, ET) * 60000;
    utc = base - tzOffsetMin(utc, ET) * 60000;
    return utc;
  }
  const kstParts = (utc) => {
    const k = new Date(utc + 9 * 3600000).toISOString();
    return { date: k.slice(0, 10), time: k.slice(11, 16) };
  };
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];

  function all() {
    const out = [];
    Object.entries(DATES).forEach(([type, list]) => {
      const t = TYPES[type];
      list.forEach((raw) => {
        const sep = raw.endsWith('*');
        const date = raw.replace('*', '');
        const utc = localToUtc(date, t.time, t.tz);
        const k = kstParts(utc);
        out.push({
          type, name: t.name + (sep ? ' (점도표)' : ''), country: t.country, event: t.event,
          localDate: date, localTime: t.time, tz: t.tz, utc,
          kstDate: k.date, kstTime: t.time ? k.time : '오전', dow: DOW[new Date(k.date + 'T00:00:00Z').getUTCDay()],
          impact: IMPACT[type],
        });
      });
    });
    return out.sort((a, b) => a.utc - b.utc);
  }

  // now 기준: 지난 recentHours 안에 발표된 것 + 앞으로 days일 안의 일정
  function upcoming(now, days = 14, recentHours = 36) {
    const t = now == null ? Date.now() : now;
    return all().filter((e) => e.utc >= t - recentHours * 3600000 && e.utc <= t + days * 86400000)
      .map((e) => Object.assign({}, e, { past: e.utc <= t, dday: Math.round((Date.parse(e.kstDate) - Date.parse(kstParts(t).date)) / 86400000) }));
  }
  // 이벤트일 점검 대상: 최근 발표된 것 (한국 아침에 전날 밤 미국 발표를 점검)
  function recent(now, hours = 36) {
    return upcoming(now, 0, hours).filter((e) => e.past);
  }
  function lastDate() {
    return all().slice(-1)[0].kstDate;
  }

  return { TYPES, DATES, IMPACT, all, upcoming, recent, localToUtc, kstParts, lastDate };
});
