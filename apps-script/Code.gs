/**
 * 데일리 매크로 대시보드 → 구글 스프레드시트 기록용 Apps Script
 *
 * 사용법 (README 3단계 참고)
 * 1. 기록할 구글 스프레드시트를 만들고 [확장 프로그램] → [Apps Script]를 엽니다.
 * 2. 이 파일 내용을 전부 붙여넣고, 아래 SECRET 값을 나만 아는 문자열로 바꿉니다.
 * 3. [배포] → [새 배포] → 유형 "웹 앱", 실행 계정 "나", 액세스 권한 "모든 사용자"로 배포합니다.
 * 4. 나온 웹 앱 URL을 Vercel 환경변수 SHEET_WEBHOOK_URL에, SECRET 값을 SHEET_SECRET에 넣습니다.
 *
 * 같은 날짜로 다시 저장하면 새 줄을 만들지 않고 그날 줄을 덮어씁니다.
 * 아침 자동 브리핑 메일도 이 스크립트가 내 Gmail로 보냅니다 (처음 배포할 때 메일 보내기 권한을 허용).
 * 코드를 바꾼 뒤에는 [배포] → [배포 관리] → 연필(수정) → 버전: 새 버전 → [배포] 해야 같은 URL에 반영됩니다.
 */

const SECRET = 'CHANGE_ME_TO_YOUR_OWN_SECRET';
const KEY_COLUMN = '날짜';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.secret !== SECRET) return json_({ ok: false, error: 'SHEET_SECRET이 Apps Script의 SECRET과 다릅니다.' });

    // 아침 자동 브리핑 메일 (내 Gmail로 발송)
    if (body.action === 'mail') {
      if (!body.to) return json_({ ok: false, error: '받는 주소가 없습니다.' });
      MailApp.sendEmail({ to: body.to, subject: body.subject || 'Macro Daily', htmlBody: body.html || '', name: 'Macro Daily' });
      return json_({ ok: true, mailed: body.to });
    }
    const res = upsert_(sheetOf_(body.sheet), body.record || {});
    try { buildOverview_(); } catch (e) { res.overviewError = String(e); }
    return json_(res);
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

// 날짜가 같은 줄이 있으면 덮어쓰고, 없으면 새 줄 추가
function upsert_(sheetName, record) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = getSheet_(sheetName);
    const headers = ensureHeaders_(sh, Object.keys(record));
    const row = headers.map(function (h) { return clean_(record[h]); });
    const keyIdx = headers.indexOf(KEY_COLUMN);
    let target = -1;
    if (keyIdx >= 0 && sh.getLastRow() > 1) {
      const keys = sh.getRange(2, keyIdx + 1, sh.getLastRow() - 1, 1).getDisplayValues();
      for (let i = 0; i < keys.length; i++) {
        if (String(keys[i][0]) === String(record[KEY_COLUMN])) { target = i + 2; break; }
      }
    }
    const existed = target > 0;
    if (existed) {
      sh.getRange(target, 1, 1, headers.length).setValues([row]);
    } else {
      sh.appendRow(row);
      target = sh.getLastRow();
    }
    formatSheet_(sh);
    return { ok: true, sheet: sheetName, row: target, updated: existed };
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  try {
    const p = e.parameter || {};
    if (p.secret !== SECRET) return json_({ ok: false, error: 'SHEET_SECRET이 Apps Script의 SECRET과 다릅니다.' });
    const sheetName = sheetOf_(p.sheet);
    const limit = Math.min(parseInt(p.limit || '30', 10) || 30, 200);
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
    if (!sh || sh.getLastRow() < 2) return json_({ ok: true, sheet: sheetName, rows: [] });

    const values = sh.getDataRange().getDisplayValues();
    const headers = values[0];
    const rows = values.slice(1).map(function (r) {
      const o = {};
      headers.forEach(function (h, i) { o[h] = r[i]; });
      return o;
    });
    rows.sort(function (a, b) { return String(b[KEY_COLUMN]).localeCompare(String(a[KEY_COLUMN])); });
    return json_({ ok: true, sheet: sheetName, rows: rows.slice(0, limit) });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

// 쓸 수 있는 시트 탭: 데일리, 주간, 자동 브리핑
const SHEETS = ['데일리', '주간', '자동 브리핑', '산업 이슈', '기업 분석'];
function sheetOf_(name) {
  return SHEETS.indexOf(name) >= 0 ? name : '데일리';
}

/**
 * ===== 아침 자동 브리핑 (평일) =====
 * 매크로 → 산업 이슈 → 오늘의 기업을 순서대로 만들고 메일 한 통으로 보냅니다.
 * 설정: 왼쪽 톱니바퀴(프로젝트 설정) → 스크립트 속성에 아래 3개 추가
 *   DASHBOARD_URL  예) https://macro-daily-swart.vercel.app
 *   APP_PASSCODE   Vercel에 넣은 앱 비밀번호와 같은 값
 *   MAIL_TO        브리핑 받을 메일 주소
 * 그다음 왼쪽 시계(트리거) → 트리거 추가 → 함수 morningRun, 시간 기반, 일 단위 타이머, 오전 7시~8시
 * 바로 시험하려면 위쪽 함수 선택에서 morningRun을 고르고 [실행] (주말에도 실행하려면 morningRunNow)
 */
function morningRun() {
  const day = Number(Utilities.formatDate(new Date(), 'Asia/Seoul', 'u')); // 1=월 … 7=일
  if (day >= 6) return; // 주말은 쉼
  morningRunNow();
}

function morningRunNow() {
  const p = PropertiesService.getScriptProperties();
  const base = String(p.getProperty('DASHBOARD_URL') || '').replace(/\/$/, '');
  const pass = p.getProperty('APP_PASSCODE') || '';
  const to = p.getProperty('MAIL_TO') || Session.getActiveUser().getEmail();
  if (!base) throw new Error('스크립트 속성 DASHBOARD_URL이 없습니다.');
  const date = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  const call = function (path, method) {
    try {
      const r = UrlFetchApp.fetch(base + path, { method: method || 'get', headers: { 'x-app-passcode': pass }, muteHttpExceptions: true, contentType: 'application/json', payload: method === 'post' ? '{}' : undefined });
      const j = JSON.parse(r.getContentText());
      return j.ok ? j : { ok: false, error: j.error || ('HTTP ' + r.getResponseCode()) };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  };
  const macro = call('/api/morning?part=1');
  const industry = call('/api/industry?part=1');
  const company = call('/api/company?part=1', 'post');
  const fail = function (name, x) { return '<p style="color:#b23a30;font-size:13px">' + name + '을(를) 만들지 못했습니다: ' + String(x.error || '').replace(/</g, '&lt;') + '</p>'; };
  const html = '<div style="font-family:-apple-system,\'Apple SD Gothic Neo\',\'Malgun Gothic\',sans-serif;color:#16202e;max-width:680px;line-height:1.55;font-size:14px">' +
    (macro.ok ? macro.mailHtml : fail('매크로 브리핑', macro)) +
    (industry.ok ? industry.mailHtml : fail('산업 이슈', industry)) +
    (company.ok ? company.mailHtml : fail('오늘의 기업', company)) +
    '<p style="margin:20px 0"><a href="' + base + '/" style="background:#00462a;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700">대시보드에서 전체 보기</a></p>' +
    '<p style="font-size:11.5px;color:#888">자동 생성 · AI 분석은 틀릴 수 있습니다 · 투자 권유가 아닌 학습용</p></div>';
  try { buildOverview_(); } catch (e) { console.log('한눈에 정리 실패: ' + e); }
  const tail = [macro.ok && macro.subjectTail, company.ok && company.result && company.result.data && ('오늘의 기업 ' + company.result.data.company.name)].filter(Boolean).join(' · ');
  MailApp.sendEmail({ to: to, subject: ('[Macro Daily] ' + date.slice(5).replace('-', '/') + ' 아침 브리핑' + (tail ? ' — ' + tail : '')).slice(0, 150), htmlBody: html, name: 'Macro Daily' });
}

function getSheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
  }
  return sh;
}

// 새 항목이 생기면 맨 오른쪽에 열을 추가합니다.
function ensureHeaders_(sh, keys) {
  let headers = [];
  if (sh.getLastRow() >= 1 && sh.getLastColumn() >= 1) {
    headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  }
  let changed = false;
  keys.forEach(function (k) {
    if (headers.indexOf(k) === -1) { headers.push(k); changed = true; }
  });
  if (changed) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#eef2f7');
    sh.setFrozenRows(1);
    sh.setFrozenColumns(1);
  }
  return headers;
}

// =, +, -, @ 로 시작하는 글자는 수식으로 실행되지 않도록 앞에 ' 를 붙입니다.
function clean_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  const s = String(v);
  if (/^[=+\-@]/.test(s)) return "'" + s;
  return s;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}


/**
 * ===== 보기 좋게 정리 =====
 * 원본 탭(데일리·자동 브리핑·산업 이슈·기업 분석)은 대시보드가 읽는 '창고'라 열이 많습니다.
 * 사람이 읽는 탭 '한눈에'를 맨 앞에 만들어, 하루 한 줄로 핵심만 최신순으로 보여 줍니다.
 * 저장할 때마다 자동으로 다시 만들어지고, 처음 한 번은 함수 '정리하기'를 실행하면 기존 탭까지 정리됩니다.
 */
function 정리하기() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  SHEETS.forEach(function (n) { const sh = ss.getSheetByName(n); if (sh && sh.getLastRow() >= 1) formatSheet_(sh); });
  buildOverview_();
}

// 원본 탭: 머리줄 색·고정, 줄바꿈 대신 자르기, 열 너비, JSON 열 숨기기
function formatSheet_(sh) {
  const lastCol = sh.getLastColumn(), lastRow = Math.max(sh.getLastRow(), 1);
  if (lastCol < 1) return;
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  sh.setFrozenRows(1);
  sh.setFrozenColumns(Math.min(1, lastCol));
  sh.getRange(1, 1, 1, lastCol).setFontWeight('bold').setBackground('#00462a').setFontColor('#ffffff').setVerticalAlignment('middle');
  sh.setRowHeight(1, 30);
  sh.getRange(1, 1, lastRow, lastCol).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP).setVerticalAlignment('top');
  headers.forEach(function (h, i) {
    const col = i + 1;
    if (/JSON/.test(h)) { sh.hideColumns(col); return; }
    const long = /요약|해석|주장|결론|쟁점|이유|BULL|BEAR|메모|시사점|발표지표|피드백|비교/.test(h);
    sh.setColumnWidth(col, h === '날짜' ? 95 : long ? 280 : 110);
  });
}

function rowsOf_(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return {};
  const v = sh.getDataRange().getDisplayValues(), h = v[0], out = {};
  v.slice(1).forEach(function (r) { const o = {}; h.forEach(function (k, i) { o[k] = r[i]; }); if (o['날짜']) out[o['날짜']] = o; });
  return out;
}
function pick_(objs, keys) {
  for (let i = 0; i < objs.length; i++) {
    const o = objs[i]; if (!o) continue;
    for (let j = 0; j < keys.length; j++) if (o[keys[j]]) return o[keys[j]];
  }
  return '';
}
// 지표 값 + 변화를 한 칸에: 4.88 (+2.0bp)
function level_(d, label) {
  if (!d || d[label] === undefined || d[label] === '') return '';
  const ck = Object.keys(d).filter(function (k) { return k.indexOf(label + ' 변화(') === 0; })[0];
  const unit = ck ? ck.slice(label.length + 4, -1) : '';
  const c = ck ? d[ck] : '';
  return d[label] + (c !== '' && c !== undefined ? ' (' + (Number(c) > 0 ? '+' : '') + c + unit + ')' : '');
}

function buildOverview_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const daily = rowsOf_('데일리'), auto = rowsOf_('자동 브리핑'), ind = rowsOf_('산업 이슈'), co = rowsOf_('기업 분석');
  const dates = Object.keys(Object.assign({}, daily, auto, ind, co)).sort().reverse();
  if (!dates.length) return;
  const arrow = { 상승: '▲', 하락: '▼', 보합: '–' };
  const head = ['날짜', '한 줄 요약', '오늘의 결론 (AI 센터장)', '5거래일 전망 (AI)', '국면', '미국 10년물', 'S&P500', '원달러', 'KOSPI', 'VIX', '섹터 시사점', '산업 이슈', '오늘의 기업', '기업 숫자 검증', '브리핑 교차검증', '내 결론'];
  const rows = dates.map(function (dt) {
    const d = daily[dt], a = auto[dt], i = ind[dt], c = co[dt];
    const fc = ['미국10년물', 'S&P500', '원달러', 'KOSPI'].map(function (k) {
      const v = pick_([d, a], ['AI전망_' + k]); return v ? k.replace('미국10년물', '10년물') + ' ' + (arrow[v] || '') + v : '';
    }).filter(String).join(' · ');
    return [dt,
      pick_([a, d], ['한 줄 요약']),
      pick_([d, a], ['AI 종합 해석']),
      fc,
      pick_([d, a], ['자동_국면 신호', '자동_국면']),
      level_(d, '미국 10년물'), level_(d, 'S&P500'), level_(d, '원달러'), level_(d, 'KOSPI'), level_(d, 'VIX'),
      pick_([d, a], ['자동_섹터 시사점']),
      i ? i['한 줄 요약'] || '' : '',
      c ? (c['기업'] || '') + (c['한 줄 요약'] ? ' — ' + c['한 줄 요약'] : '') : '',
      c ? c['숫자 검증'] || '' : '',
      d ? [d['교차검증_데이터'] ? '데이터 ' + d['교차검증_데이터'] : '', d['교차검증_리포트 일치도'] ? '리포트 일치도 ' + d['교차검증_리포트 일치도'] : ''].filter(String).join(' / ') : '',
      d && (!/^AI/.test(d['작성 방식'] || '') || /수정/.test(d['작성 방식'])) ? d['종합 해석'] || '' : ''];
  }).map(function (r) { return r.map(clean_); });

  let sh = ss.getSheetByName('한눈에');
  if (!sh) sh = ss.insertSheet('한눈에', 0);
  sh.clear();
  sh.getRange(1, 1, 1, head.length).setValues([head]);
  sh.getRange(2, 1, rows.length, head.length).setValues(rows);
  sh.setFrozenRows(1); sh.setFrozenColumns(2);
  sh.getRange(1, 1, 1, head.length).setFontWeight('bold').setBackground('#00462a').setFontColor('#ffffff').setVerticalAlignment('middle');
  sh.setRowHeight(1, 32);
  const body = sh.getRange(2, 1, rows.length, head.length);
  body.setVerticalAlignment('top').setWrap(true).setFontSize(10);
  [95, 260, 380, 230, 110, 110, 110, 110, 110, 90, 260, 260, 260, 110, 200, 260].forEach(function (w, k) { sh.setColumnWidth(k + 1, w); });
  for (let r = 2; r <= rows.length + 1; r++) sh.getRange(r, 1, 1, head.length).setBackground(r % 2 ? '#f6f8f7' : '#ffffff');
  sh.getRange(2, 1, rows.length, 1).setFontWeight('bold');
  if (ss.getSheets()[0].getName() !== '한눈에') { ss.setActiveSheet(sh); ss.moveActiveSheet(1); }
}
