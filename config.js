// 대시보드 구성: 루틴 가이드의 점검 순서와 주기(매일 / 이벤트일 / 주간)를 그대로 옮긴 설정
// 항목을 추가·삭제하고 싶으면 이 파일만 고치면 됩니다.

window.CONFIG = {
  // 자동 수집 지표 정의 (id는 /api/market 결과의 키)
  indicators: {
    us2y: { label: '미국 2년물', unit: '%', digits: 2, desc: '연준 정책 기대를 가장 직접 반영' },
    us10y: { label: '미국 10년물', unit: '%', digits: 2, desc: '장기 성장·물가 기대 + 기간 프리미엄' },
    t10y2y: { label: '장단기 금리차 (10Y−2Y)', unit: '%p', digits: 2, desc: '경기 사이클 지표. 음수면 역전' },
    real10y: { label: '10년 실질금리 (TIPS)', unit: '%', digits: 2, desc: '물가를 뺀 금리. 금·성장주와 반대 방향' },
    bei10y: { label: '10년 기대인플레이션 (BEI)', unit: '%', digits: 2, desc: '채권시장이 보는 향후 10년 평균 물가' },
    dxy: { label: '달러인덱스', unit: '', digits: 2, desc: '주요 6개 통화 대비 달러 (유로 비중 절반 이상)' },
    usdkrw: { label: '원달러', unit: '원', digits: 1, desc: '오르면 원화 약세' },
    usdjpy: { label: '달러엔', unit: '엔', digits: 2, desc: '내리면 엔화 강세 (안전자산·엔캐리 청산)' },
    jpykrw: { label: '원/100엔', unit: '원', digits: 2, desc: '원화가 달러에만 약한지, 엔화 대비로도 약한지' },
    usdcny: { label: '달러위안', unit: '위안', digits: 4, desc: '중국 경기·미중 관계. 원화와 같은 방향이 많음' },
    dow: { label: '다우', unit: '', digits: 2, desc: '대형 가치·경기민감주' },
    spx: { label: 'S&P500', unit: '', digits: 2, desc: '미국 시장 전체의 기준' },
    ndx: { label: '나스닥', unit: '', digits: 2, desc: '기술·성장주, 금리에 민감' },
    rut: { label: '러셀2000', unit: '', digits: 2, desc: '중소형주, 경기·인하 기대에 가장 민감' },
    sox: { label: '필라델피아 반도체', unit: '', digits: 2, desc: '한국 반도체·KOSPI와 직결' },
    wti: { label: 'WTI 유가', unit: '$', digits: 2, desc: '물가와 경기 기대를 동시에 반영' },
    brent: { label: '브렌트유', unit: '$', digits: 2, desc: '국제 유가 기준. 중동·유럽 공급 이슈에 민감' },
    wtibrent: { label: 'WTI − 브렌트', unit: '$', digits: 2, desc: '차이가 급변하면 미국 밖 공급 이슈 가능성' },
    gold: { label: '금', unit: '$', digits: 2, desc: '실질금리와 반대, 불안 심리에 상승' },
    copper: { label: '구리', unit: '$/lb', digits: 3, desc: '경기를 보는 금속, 중국 경기에 민감' },
    cuau: { label: '구리/금 비율 (×1000)', unit: '', digits: 3, desc: '성장 기대 ÷ 불안 심리. 10년물과 같은 방향 경향' },
    vix: { label: 'VIX', unit: '', digits: 2, desc: '15↓ 안정 · 20↑ 변동성 확대 · 25↑ 위험 회피 심화' },
    hy: { label: '하이일드 스프레드', unit: '%', digits: 2, desc: '부도 위험 평가. 4%↑ 경계 · 5%↑ 스트레스' },
    kospi: { label: 'KOSPI', unit: '', digits: 2, desc: '반도체·대형 수출주 중심' },
    kosdaq: { label: 'KOSDAQ', unit: '', digits: 2, desc: '바이오·2차전지·중소형 성장주 중심' },
    kr3y: { label: '국고채 3년', unit: '%', digits: 3, desc: '한은 금리 기대를 가장 직접 반영' },
    kr10y: { label: '국고채 10년', unit: '%', digits: 3, desc: '대체로 미국 10년물을 따라감' },
    krus10y: { label: '한미 10년물 금리차', unit: 'bp', digits: 0, desc: '한국−미국. 마이너스가 클수록 원화 약세 압력' },
  },

  // 매일 점검 (10~15분)
  daily: [
    {
      id: 'rates', no: 1, title: '금리', lead: '가장 먼저 본다. 모든 자산 가격의 기준.',
      items: ['us2y', 'us10y', 't10y2y'],
      signals: ['curve'],
      links: [{ label: '미국 재무부 수익률 곡선', url: 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve' }, { label: '네이버 미국 10년물 (실시간)', url: 'https://stock.naver.com/marketindex/bond/US10YT=RR/price' }, { label: '네이버 시장지표 (글로벌 금리·기준금리)', url: 'https://stock.naver.com/market/marketindex' }, { label: 'CNBC Markets', url: 'https://www.cnbc.com/markets/' }],
      questions: ['10bp 이상 움직였나?', '2년물과 10년물 중 누가 더 움직였나? (커브 패턴)', '10년물 앞자리가 바뀌었나?'],
    },
    {
      id: 'fx', no: 2, title: '달러와 환율', lead: '금리 변화가 통화로 어떻게 전달됐나.',
      items: ['dxy', 'usdkrw'],
      signals: ['dollar'],
      links: [{ label: 'Investing.com 달러인덱스', url: 'https://www.investing.com/indices/usdollar' }, { label: '네이버 환율', url: 'https://finance.naver.com/marketindex/' }],
      questions: ['달러 강세의 원인이 금리인가, 위험 회피인가, 상대 통화 약세인가?', '원달러가 달러인덱스와 다르게 움직였다면 한국 고유 요인은?'],
    },
    {
      id: 'equity', no: 3, title: '주식', lead: '위험 선호의 크기와 자금 이동 방향.',
      items: ['dow', 'spx', 'ndx', 'rut', 'sox'],
      signals: ['alignment', 'stockRate'],
      links: [{ label: 'Finviz 섹터 그룹', url: 'https://finviz.com/groups.ashx?g=sector&v=140&o=name' }, { label: 'Finviz 히트맵', url: 'https://finviz.com/map.ashx' }, { label: 'KRX 전체지수 시세', url: 'https://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC0201020103' }, { label: 'CNBC Markets', url: 'https://www.cnbc.com/markets/' }],
      questions: ['지수 배열이 깨졌나? 깨졌다면 왜?', '주식-금리 조합은 어느 칸인가?', '섹터 흐름이 금리·달러·유가와 일치하나?'],
      manual: [
        { key: '초과 상승 섹터', type: 'text', placeholder: '예: 에너지, 금융' },
        { key: '초과 하락 섹터', type: 'text', placeholder: '예: 기술, 부동산' },
        { key: '대형주 특이사항', type: 'text', placeholder: '예: 엔비디아 -4% (실적 가이던스)' },
      ],
    },
    {
      id: 'commodity', no: 4, title: '유가', lead: '물가와 경기 기대. 3% 이상이면 원인 구분.',
      items: ['wti', 'brent', 'wtibrent'],
      signals: [],
      links: [{ label: '네이버 에너지', url: 'https://stock.naver.com/market/marketindex' }, { label: 'CNBC 원자재', url: 'https://www.cnbc.com/commodities/' }],
      questions: ['수요 요인(주가·구리 동반)인가, 공급 요인(지정학·OPEC+)인가?', 'WTI−브렌트 차이가 벌어졌나? (벌어지면 미국 밖 공급 이슈)'],
    },
    {
      id: 'risk', no: 5, title: '위험·심리', lead: '시장이 얼마나 불안한가.',
      items: ['vix'],
      signals: ['vix'],
      links: [{ label: 'Investing.com VIX', url: 'https://www.investing.com/indices/volatility-s-p-500' }, { label: 'CNN Fear & Greed', url: 'https://edition.cnn.com/markets/fear-and-greed' }],
      questions: ['VIX 20 이상이면 지수 배열·금리 구조와 연결해 원인은?'],
      manual: [
        { key: 'Fear&Greed 구간', type: 'select', options: ['', '극단적 공포', '공포', '중립', '탐욕', '극단적 탐욕'] },
        { key: 'Fear&Greed 구간 변화', type: 'select', options: ['', '변화 없음', '구간 이동'] },
      ],
    },
    {
      id: 'policy', no: 6, title: '통화정책 기대', lead: '시장이 연준 경로를 어떻게 보나. 2년물과 같이 본다.',
      items: [],
      signals: [],
      links: [{ label: 'CME FedWatch', url: 'https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html' }],
      questions: ['확률을 바꾼 원인은? (지표·연준 발언)', '인하 확률과 2년물이 같은 방향인가?'],
      manual: [
        { key: '다음 FOMC 인하 확률(%)', type: 'number', placeholder: '예: 62' },
        { key: '인하 확률 전일 대비(%p)', type: 'number', placeholder: '예: -8' },
        { key: '연준 발언 메모', type: 'text', placeholder: '누가, 매파/비둘기파, 핵심 한 줄' },
      ],
    },
    {
      id: 'data', no: 7, title: '오늘 발표 지표', lead: '가격 움직임의 원인. 절대치보다 예상 대비 서프라이즈.',
      items: [],
      signals: [],
      links: [{ label: 'Investing.com 경제 캘린더', url: 'https://kr.investing.com/economic-calendar/' }, { label: 'Atlanta Fed GDPNow', url: 'https://www.atlantafed.org/cqer/research/gdpnow' }],
      questions: ['서프라이즈 방향과 시장 반응이 정상인가? (물가↑ → 2년물↑·달러↑)', '이전치가 크게 수정됐나?'],
      releases: 3,
    },
    {
      id: 'korea', no: 8, title: '한국 전이', lead: '미국 움직임이 한국으로 어떻게 넘어왔나.',
      items: ['kospi', 'kosdaq', 'kr3y', 'kr10y', 'krus10y'],
      signals: ['korea'],
      links: [{ label: '네이버 증권', url: 'https://finance.naver.com/sise/' }, { label: '네이버 시장지표 (한국 10년물 실시간)', url: 'https://stock.naver.com/market/marketindex' }, { label: '투자자별 매매동향', url: 'https://finance.naver.com/sise/sise_trans_style.naver' }, { label: '한국은행 ECOS', url: 'https://ecos.bok.or.kr/' }],
      questions: ['미국과 같은 방향인가? 다르면 왜?', '외국인 수급과 원달러가 같이 움직였나?', '국고채가 미국 금리를 따라갔나?'],
      manual: [
        { key: '외국인 순매수 KOSPI(억원)', type: 'number', placeholder: '예: -4200' },
        { key: '기관 순매수 KOSPI(억원)', type: 'number', placeholder: '예: 1800' },
        { key: '국고채 3년(직접입력,%)', type: 'number', placeholder: 'ECOS 키가 없을 때' },
        { key: '국고채 10년(직접입력,%)', type: 'number', placeholder: 'ECOS 키가 없을 때' },
        { key: '업종 상위·하위', type: 'text', placeholder: '예: 상위 조선·방산 / 하위 반도체' },
      ],
    },
  ],

  // 이벤트일 심화 점검
  events: {
    FOMC: ['성명서 문구 변화', '점도표 중간값 vs FedWatch 경로', '기자회견 중 2년물 반응', '결정 자체는 예상대로였나'],
    CPI: ['근원 CPI 전월비 (0.1%p 차이도 큰 서프라이즈)', '주거비', '주거비 제외 서비스 물가(슈퍼코어)', '근원 상품 물가'],
    '고용(NFP)': ['비농업 고용 증가 vs 예상', '실업률 방향', '평균시급', '이전 두 달 수정 폭'],
    PCE: ['근원 PCE 전년비 vs 2% 목표', '서비스 물가', '개인소득·소비'],
    금통위: ['기준금리 결정과 소수의견', '향후 3개월 금리 전망 (위원별 분포)', '국고채 3년 반응', '원달러 반응', '가계부채·부동산·환율 중 강조점'],
    기타: ['이벤트 내용', '시장 기대', '실제 결과'],
  },

  // 주간 점검 (주 1~2회)
  weeklyItems: ['hy', 'real10y', 'bei10y', 'gold', 'copper', 'cuau', 'usdjpy', 'jpykrw', 'usdcny'],
  weeklyQuestions: {
    hy: '벌어지는 추세인가? 주가와 반대로 가나?',
    real10y: '한 주 동안 10년물 변화를 실질금리가 주도했나?',
    bei10y: '물가 이야기가 강해졌나? 유가와 같이 갔나?',
    gold: '실질금리와 반대로 움직였나? 아니면 다른 요인(지정학·중앙은행 매입)?',
    copper: '중국·글로벌 경기 기대는?',
    cuau: '10년물 금리 방향과 일치하나?',
    usdjpy: '엔화 급강세(엔캐리 청산) 신호는?',
    jpykrw: '원화가 엔화 대비로도 약해졌나? (달러 강세 때문만인지 원화 자체 약세인지)',
    usdcny: '위안화 약세가 원화에 부담을 줬나?',
  },
};
