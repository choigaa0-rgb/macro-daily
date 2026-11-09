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
 */

const SECRET = 'CHANGE_ME_TO_YOUR_OWN_SECRET';
const KEY_COLUMN = '날짜';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.secret !== SECRET) return json_({ ok: false, error: 'SHEET_SECRET이 Apps Script의 SECRET과 다릅니다.' });

    const sheetName = body.sheet === '주간' ? '주간' : '데일리';
    const record = body.record || {};
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
      return json_({ ok: true, sheet: sheetName, row: target, updated: existed });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doGet(e) {
  try {
    const p = e.parameter || {};
    if (p.secret !== SECRET) return json_({ ok: false, error: 'SHEET_SECRET이 Apps Script의 SECRET과 다릅니다.' });
    const sheetName = p.sheet === '주간' ? '주간' : '데일리';
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
