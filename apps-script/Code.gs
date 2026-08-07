/**
 * 라쿠텐 BOH 매출 대시보드 — 시트 → GitHub 자동 동기화
 *
 * 구조: Google Sheets → (이 스크립트) → GitHub(2-KY/qoo10_dashboard_data/data.json) → Vercel 대시보드(app.js)
 *
 * 이 스크립트는 시트 소유자 권한으로 직접 실행되므로, 시트를
 * "링크가 있는 모든 사용자"로 공개할 필요가 전혀 없습니다.
 *
 * ============================================================
 * 사전 준비 (아래 "실행 순서" 문서를 그대로 따라하면 됩니다)
 * ============================================================
 *  1) 이 코드를 그대로 Apps Script 편집기에 붙여넣기
 *  2) 프로젝트 설정 → 스크립트 속성 → GITHUB_TOKEN 값 1개만 추가
 *     (owner/repo는 이미 아래 상수에 고정되어 있어 따로 입력할 필요 없음)
 *  3) syncToGitHub 함수를 한 번 실행 → 권한 승인
 *  4) installTrigger 함수를 한 번 실행 → 10분마다 자동 실행되도록 등록
 * ============================================================
 */

const DOC_ID = '1WEZxJJYUJSWscWB-Jlzk9WZ5hb45OvdwmZJ0JngqXak';
const SHEET_NAMES = {
  shop26: '26_제품 일자별',
  shop25: '25년매출',
  promo: '프로모션_항목',
  yp0001: 'yp0001',
  yp3755: 'yp3755',
  ybox_2508: 'ybox_2508',
  ys0211: 'ys0211',
  affiliate: '어필리에이트_RAW', // 신규: 어필리에이트 분석 탭 — A~N열 RAW + P~Z열 프로모션(일반/우수 요율) 설정
  coupon: '쿠폰', // 신규: 쿠폰 분석 탭 — A~O열 (프로모션명~비고)
  otherSku: '그외', // 구버전: ③탭 재구성 완료 후 제거 예정 (otherSkuV2로 대체됨)
  otherSkuV2: '그외상품', // 신규: 추가 SKU 카드 — 프로모션명/일자/상품번호/상품명/매출/주문건수/판매수량/PV/UV/전환율/신규구매건수/리피트구매건수 (평면 테이블)
};

// GitHub 저장소 정보 (공개 저장소이므로 여기 값 자체는 비밀이 아님 — 토큰만 비밀)
const GITHUB_OWNER = '2-KY';
const GITHUB_REPO = 'qoo10_dashboard_data';
const GITHUB_BRANCH = 'main';
const GITHUB_FILE_PATH = 'data.json';

/** 메인 진입점 — 트리거가 이 함수를 주기적으로 실행합니다. */
function syncToGitHub() {
  const ss = SpreadsheetApp.openById(DOC_ID);
  const tz = ss.getSpreadsheetTimeZone();
  const payload = { generatedAt: new Date().toISOString(), sheets: {} };

  Object.keys(SHEET_NAMES).forEach((key) => {
    const sheetName = SHEET_NAMES[key];
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      Logger.log(`⚠ 시트를 찾지 못함: '${sheetName}' (key=${key})`);
      payload.sheets[key] = [];
      return;
    }
    const values = sheet.getDataRange().getValues(); // 2차원 배열, 원본 타입 그대로(Date/number/string)
    // 진단용: '26_제품 일자별' 시트만, getValues()가 반환한 마지막 3행의 "가공 전" 원본 값을 그대로 로그로 남긴다.
    // (toCell() 변환 이전 단계 — 여기서 이미 빈 값이면 구글시트 API 자체가 그 시점에 해당 셀을 못 읽은 것이고,
    //  여기서는 값이 있는데 최종 data.json에서 null이라면 toCell()의 변환 로직이 원인이다)
    if (key === 'shop26' && values.length >= 3) {
      const tail = values.slice(-3);
      tail.forEach((row, i) => {
        Logger.log(`[진단:${sheetName}] 끝에서 ${tail.length - i}번째 행 원본 → B열=${JSON.stringify(row[1])} (type:${typeof row[1]}) · C열=${JSON.stringify(row[2])} (type:${typeof row[2]})`);
      });
    }
    payload.sheets[key] = values.map((row) => row.map((cell) => toCell(cell, tz)));
    Logger.log(`✅ '${sheetName}' ${values.length}행 읽음`);
  });

  // ▼▼▼ 신규: 유입 분석(traffic) 데이터 수집 — 기존 sheets 동기화 로직에는 영향을 주지 않음.
  //     실패해도 반드시 try/catch로 흡수해서, 유입 데이터 문제가 기존 매출 동기화를 절대 끊지 않도록 한다. ▼▼▼
  try {
    const existing = fetchExistingDataJson_();
    const trafficRaw = readTrafficSheets_();
    const promoId = findCurrentPromoId_(trafficRaw);
    // 그외_raw는 4개 고정 SKU/shop과 다른 시점에(다른 프로모션으로) 갱신될 수 있으므로,
    // promoId를 공유하지 않고 그외_raw 자신의 날짜로 별도 판정한다.
    const otherPromoId = findOtherPromoId_(trafficRaw);
    // SHOP유입_raw도 마찬가지로 yp0001_raw/yp3755_raw와 다른 시점에 갱신될 수 있으므로
    // (예: SHOP을 먼저 붙여넣고 SKU 시트는 나중에 붙여넣는 순서), promoId를 공유하지 않고
    // SHOP유입_raw 자신의 날짜로 별도 판정한다 — 갱신 순서와 무관하게 항상 올바른 promoId에 저장되게 함.
    const shopPromoId = findShopPromoId_(trafficRaw);
    payload.traffic = mergeTrafficIntoPayload_(existing && existing.traffic, trafficRaw, promoId, otherPromoId, shopPromoId);
  } catch (e) {
    Logger.log('⚠ [유입] traffic 동기화 실패 — 기존 매출 동기화는 계속 진행: ' + e.message);
  }
  // ▲▲▲ 신규 끝 ▲▲▲

  // ▼▼▼ 신규: 월 목표매출(monthlyGoals) — 프로모션_항목 시트의 N:P열(연도/월/월 목표매출) 설정 테이블.
  //     기존 sheets.promo 동기화와 무관하게 별도 필드로 구조화해서 담아 app.js가 바로 소비하게 한다.
  //     실패해도 try/catch로 흡수해서 기존 매출 동기화를 끊지 않는다. ▼▼▼
  try {
    payload.monthlyGoals = readMonthlyGoals_(ss);
    Logger.log(`✅ [월 목표매출] ${payload.monthlyGoals.length}건 읽음`);
  } catch (e) {
    Logger.log('⚠ [월 목표매출] 동기화 실패 — 기존 매출 동기화는 계속 진행: ' + e.message);
    payload.monthlyGoals = [];
  }
  // ▲▲▲ 신규 끝 ▲▲▲

  const json = JSON.stringify(payload);
  pushToGitHub(json);
}

/** 셀 값을 대시보드(app.js)가 바로 소비할 수 있는 {v, f} 형태로 변환합니다. */
function toCell(raw, tz) {
  if (raw === '' || raw === null || raw === undefined) return null;
  if (raw instanceof Date) {
    // 시간만 입력된 셀(예: 쿠폰 시트의 시작시간/종료시간)은 Apps Script가 날짜 부분을
    // 스프레드시트 기준일(1899-12-30)로 채운 Date 객체로 반환한다. 이를 그대로 'yyyy-MM-dd'로
    // 포맷하면 시간 정보가 통째로 사라지므로, 그런 값만 'HH:mm'으로 남겨 시간 정보를 보존한다.
    const isTimeOnly = raw.getFullYear() === 1899 && raw.getMonth() === 11 && raw.getDate() === 30;
    const iso = Utilities.formatDate(raw, tz, isTimeOnly ? 'HH:mm' : 'yyyy-MM-dd');
    return { v: iso, f: iso };
  }
  return { v: raw, f: String(raw) };
}

/**
 * 프로모션_항목 시트의 N:P열(연도/월/월 목표매출) 설정 테이블을 구조화된 배열로 추출합니다.
 * N열=연도, O열=월, P열=월 목표매출. 세 값이 모두 채워진 행만 반영하므로,
 * 향후 2027년/2028년... 행을 계속 추가해도 코드 수정 없이 자동으로 반영된다.
 */
function readMonthlyGoals_(ss) {
  const sheet = ss.getSheetByName(SHEET_NAMES.promo);
  if (!sheet) return [];
  const values = sheet.getDataRange().getValues();
  const goals = [];
  values.forEach((row) => {
    const year = Number(row[13]);  // N열
    const month = Number(row[14]); // O열
    const goal = Number(row[15]);  // P열
    if (!year || !month || !goal) return;
    goals.push({ year: Math.round(year), month: Math.round(month), goal: goal });
  });
  return goals;
}

/** GitHub Contents API로 data.json 파일을 생성/갱신합니다. */
function pushToGitHub(jsonString) {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) {
    throw new Error('스크립트 속성 GITHUB_TOKEN이 설정되지 않았습니다. 프로젝트 설정에서 추가해주세요.');
  }

  const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
  };

  // 1) 기존 파일의 sha를 조회 (없으면 새로 생성되는 것이므로 sha 없이 진행)
  let sha = null;
  try {
    const getResp = UrlFetchApp.fetch(`${apiUrl}?ref=${GITHUB_BRANCH}`, { headers, muteHttpExceptions: true });
    if (getResp.getResponseCode() === 200) {
      sha = JSON.parse(getResp.getContentText()).sha;
    }
  } catch (e) {
    Logger.log('기존 파일 조회 실패(신규 파일일 수 있음): ' + e.message);
  }

  // 2) 파일 생성/갱신 (base64 인코딩 필수)
  const body = {
    message: `data update ${new Date().toISOString()}`,
    content: Utilities.base64Encode(jsonString, Utilities.Charset.UTF_8),
    branch: GITHUB_BRANCH,
  };
  if (sha) body.sha = sha;

  const putResp = UrlFetchApp.fetch(apiUrl, {
    method: 'put',
    headers,
    contentType: 'application/json',
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });

  const code = putResp.getResponseCode();
  if (code !== 200 && code !== 201) {
    throw new Error(`GitHub 커밋 실패 (HTTP ${code}): ${putResp.getContentText()}`);
  }
  Logger.log(`✅ GitHub 커밋 완료 (HTTP ${code}) → https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/blob/${GITHUB_BRANCH}/${GITHUB_FILE_PATH}`);
}

/**
 * 트리거 설치 — 이 함수를 딱 한 번만 실행하면, 이후 10분마다
 * 자동으로 syncToGitHub()가 실행되도록 등록됩니다.
 * (이미 등록된 트리거가 있으면 중복 등록을 막기 위해 먼저 지우고 다시 등록합니다)
 */
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach((t) => {
    if (t.getHandlerFunction() === 'syncToGitHub') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncToGitHub')
    .timeBased()
    .everyMinutes(10) // 필요하면 5 / 10 / 15 / 30 중 원하는 주기로 변경 가능
    .create();
  Logger.log('✅ 10분 주기 트리거 등록 완료');
}

/* ============================================================
 * 신규: 유입 분석(traffic) 동기화
 * 별도 스프레드시트(TRAFFIC_DOC_ID)의 유입 RAW 시트를 읽어,
 * GitHub data.json의 traffic.* 아래에 "프로모션별 스냅샷 이력"으로 누적한다.
 * 원본 RAW 시트는 매번 최신 프로모션으로 덮어써지므로, 이력 보존은
 * 이 스크립트가 기존 data.json을 먼저 읽어와 병합하는 방식으로 담당한다.
 * ============================================================ */

const TRAFFIC_DOC_ID = '1VIvK1sCmSQF0m6S53NROtzMmtJsdhmvyHnHGXetm4b0';
const TRAFFIC_SHEET_NAMES = {
  shop: 'SHOP유입_raw',
  yp0001: 'yp0001_raw',
  yp3755: 'yp3755_raw',
  ys0211: 'ys0211_raw',
  ybox2508: 'ybox2508_raw',
  other: '그외_raw',
  promo: '프로모션_항목',
};

/** 유입 분석용 스프레드시트의 7개 시트를 기존 toCell()로 {v,f} 배열화해서 읽는다. */
function readTrafficSheets_() {
  const ss = SpreadsheetApp.openById(TRAFFIC_DOC_ID);
  const tz = ss.getSpreadsheetTimeZone();
  const raw = {};
  Object.keys(TRAFFIC_SHEET_NAMES).forEach((key) => {
    const sheetName = TRAFFIC_SHEET_NAMES[key];
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      Logger.log(`⚠ [유입] 시트를 찾지 못함: '${sheetName}' (key=${key})`);
      raw[key] = [];
      return;
    }
    const values = sheet.getDataRange().getValues();
    raw[key] = values.map((row) => row.map((cell) => toCell(cell, tz)));
    Logger.log(`✅ [유입] '${sheetName}' ${values.length}행 읽음`);
  });
  // 신규: 그외_raw(other) B2셀에 상품코드를 입력해두면, 그 회차의 RAW 데이터를 해당 코드 전용
  // SKU 이력으로도 별도 저장할 수 있도록 코드값을 함께 읽어 반환한다(비어 있으면 기존과 동일하게 무시).
  const otherSheet = ss.getSheetByName(TRAFFIC_SHEET_NAMES.other);
  raw.otherCode = otherSheet ? String(otherSheet.getRange('B2').getValue()).trim() : '';
  return raw;
}

/** {v,f} 셀에서 표시용 문자열을 꺼낸다 (app.js의 nstr()과 동일한 규칙). */
function trafficCellText_(cell) {
  if (!cell) return '';
  const x = cell.v != null ? cell.v : (cell.f != null ? cell.f : '');
  return String(x).trim();
}

/**
 * 현재 RAW에 붙여넣어져 있는 프로모션의 id를 "날짜 범위 매칭"으로 판정한다.
 * yp0001_raw(또는 yp3755_raw)의 "금번" 블록 첫 날짜를 찾아,
 * 프로모션_항목에서 시작일 ≤ 그 날짜 ≤ 종료일 인 행을 찾는다.
 * (마지막 행을 그대로 신뢰하지 않음 — 순서와 무관하게 항상 안전하게 매칭)
 */
function findCurrentPromoId_(trafficRaw) {
  const ref = (trafficRaw.yp0001 && trafficRaw.yp0001.length) ? trafficRaw.yp0001
    : (trafficRaw.yp3755 && trafficRaw.yp3755.length) ? trafficRaw.yp3755 : null;
  if (!ref) {
    Logger.log('⚠ [유입] 기준 시트(yp0001_raw/yp3755_raw)가 비어 있어 promoId를 판정할 수 없음');
    return null;
  }

  // 헤더 행(日付 + ユニークユーザー数가 함께 있는 행) 탐색
  let hrow = -1;
  for (let r = 0; r < Math.min(ref.length, 10); r++) {
    const texts = (ref[r] || []).map(trafficCellText_);
    if (texts.indexOf('日付') >= 0 && texts.some((t) => t.indexOf('ユニークユーザー') >= 0)) { hrow = r; break; }
  }
  if (hrow < 0) { Logger.log('⚠ [유입] 헤더 행(日付/ユニークユーザー数)을 찾지 못함'); return null; }

  // 첫 번째(=금번) 日付 컬럼 위치
  const headerRow = ref[hrow] || [];
  let dateCol = -1;
  for (let c = 0; c < headerRow.length; c++) {
    if (trafficCellText_(headerRow[c]) === '日付') { dateCol = c; break; }
  }
  if (dateCol < 0) { Logger.log('⚠ [유입] 금번 블록의 日付 컬럼을 찾지 못함'); return null; }

  // 금번 블록의 첫 날짜 데이터
  let curDate = null;
  for (let r = hrow + 1; r < ref.length; r++) {
    const cell = (ref[r] || [])[dateCol];
    const v = trafficCellText_(cell);
    if (v) { curDate = v.slice(0, 10); break; }
  }
  if (!curDate) { Logger.log('⚠ [유입] 금번 블록에서 날짜 데이터를 찾지 못함'); return null; }

  // 프로모션_항목: 시작일 ≤ curDate ≤ 종료일 인 행 탐색 (A명/B년/C월/F시작/G종료 — 기존 promo 파서와 동일 컬럼)
  const promoRows = trafficRaw.promo || [];
  for (let r = 0; r < promoRows.length; r++) {
    const row = promoRows[r] || [];
    const nm = trafficCellText_(row[0]);
    if (!nm || nm === '프로모션명') continue;
    const start = trafficCellText_(row[5]);
    if (!start) continue;
    const end = trafficCellText_(row[6]) || start;
    if (curDate >= start && curDate <= end) {
      const yy = String(Math.round(Number(trafficCellText_(row[1]) || 0))).slice(-2);
      const mm = String(Math.round(Number(trafficCellText_(row[2]) || 0)));
      const id = `${yy}-${mm}-${nm}`;
      Logger.log(`✅ [유입] promoId 판정: '${id}' (금번 시작일=${curDate})`);
      return id;
    }
  }
  Logger.log(`⚠ [유입] 프로모션_항목에서 날짜 범위 매칭 실패 (금번 시작일=${curDate}) — 이번 회차는 traffic.shop/sku/other 갱신을 건너뜀`);
  return null;
}

/**
 * 그외_raw 전용 promoId 판정 — findCurrentPromoId_()와 로직은 동일하지만 참조 시트가
 * trafficRaw.other(그외_raw)라는 점만 다르다. yp0001_raw/yp3755_raw는 그대로 두고 갱신하지
 * 않은 상태에서 그외_raw만 새 프로모션으로 먼저 갱신하는 경우가 있어, 4개 고정 SKU/shop과
 * 같은 promoId를 공유하면 서로 다른 프로모션 데이터가 한 promoId 아래 섞여 저장되는 문제가
 * 있었다. 그외_raw는 항상 자기 자신의 "금번" 첫 날짜로 독립적으로 promoId를 판정한다.
 */
function findOtherPromoId_(trafficRaw) {
  const ref = (trafficRaw.other && trafficRaw.other.length) ? trafficRaw.other : null;
  if (!ref) {
    Logger.log('⚠ [유입] 그외_raw가 비어 있어 전용 promoId를 판정할 수 없음');
    return null;
  }

  let hrow = -1;
  for (let r = 0; r < Math.min(ref.length, 10); r++) {
    const texts = (ref[r] || []).map(trafficCellText_);
    if (texts.indexOf('日付') >= 0 && texts.some((t) => t.indexOf('ユニークユーザー') >= 0)) { hrow = r; break; }
  }
  if (hrow < 0) { Logger.log('⚠ [유입] 그외_raw 헤더 행(日付/ユニークユーザー数)을 찾지 못함'); return null; }

  const headerRow = ref[hrow] || [];
  let dateCol = -1;
  for (let c = 0; c < headerRow.length; c++) {
    if (trafficCellText_(headerRow[c]) === '日付') { dateCol = c; break; }
  }
  if (dateCol < 0) { Logger.log('⚠ [유입] 그외_raw 금번 블록의 日付 컬럼을 찾지 못함'); return null; }

  let curDate = null;
  for (let r = hrow + 1; r < ref.length; r++) {
    const cell = (ref[r] || [])[dateCol];
    const v = trafficCellText_(cell);
    if (v) { curDate = v.slice(0, 10); break; }
  }
  if (!curDate) { Logger.log('⚠ [유입] 그외_raw 금번 블록에서 날짜 데이터를 찾지 못함'); return null; }

  const promoRows = trafficRaw.promo || [];
  for (let r = 0; r < promoRows.length; r++) {
    const row = promoRows[r] || [];
    const nm = trafficCellText_(row[0]);
    if (!nm || nm === '프로모션명') continue;
    const start = trafficCellText_(row[5]);
    if (!start) continue;
    const end = trafficCellText_(row[6]) || start;
    if (curDate >= start && curDate <= end) {
      const yy = String(Math.round(Number(trafficCellText_(row[1]) || 0))).slice(-2);
      const mm = String(Math.round(Number(trafficCellText_(row[2]) || 0)));
      const id = `${yy}-${mm}-${nm}`;
      Logger.log(`✅ [유입] 그외_raw 전용 promoId 판정: '${id}' (금번 시작일=${curDate})`);
      return id;
    }
  }
  Logger.log(`⚠ [유입] 그외_raw: 프로모션_항목에서 날짜 범위 매칭 실패 (금번 시작일=${curDate}) — 이번 회차는 traffic.other/동적SKU 갱신을 건너뜀`);
  return null;
}

/**
 * SHOP유입_raw 전용 promoId 판정 — findOtherPromoId_()와 목적(독립 판정)은 동일하지만, 참조
 * 시트가 SHOP유입_raw이고 그 시트 포맷이 yp0001_raw/yp3755_raw와 다르다는 점이 다르다.
 * SHOP유입_raw는 RMS 화면을 그대로 복사한 포맷이라 "日付/ユニークユーザー数" 헤더 대신
 * "금번 유입원" 제목 행 + "YY.MM.DD"(점 표기) 날짜 헤더를 쓴다(app.js의 findShopSections()/
 * parseDotDate()와 동일한 포맷 가정).
 * 기존에는 SHOP유입_raw도 4개 고정 SKU와 같은 promoId(yp0001_raw/yp3755_raw 날짜 기준)를
 * 공유했는데, SHOP유입_raw를 SKU 시트들보다 먼저(또는 나중에) 갱신하면 그 사이 동기화가 한 번
 * 끼어드는 것만으로 SHOP 데이터가 엉뚱한(SKU 시트 기준) promoId 아래 저장되는 문제가 있었다.
 * SHOP유입_raw도 그외_raw와 마찬가지로 항상 자기 자신의 "금번" 첫 날짜로 독립 판정하면,
 * 두 시트의 갱신 순서가 어긋나 있어도 각자 자기 promoId에만 정확히 저장된다.
 */
function findShopPromoId_(trafficRaw) {
  const ref = trafficRaw.shop;
  if (!ref || !ref.length) {
    Logger.log('⚠ [유입] SHOP유입_raw가 비어 있어 전용 promoId를 판정할 수 없음');
    return null;
  }

  let titleRow = -1;
  for (let r = 0; r < Math.min(ref.length, 10); r++) {
    const row = ref[r] || [];
    for (let c = 0; c < row.length; c++) {
      if (/^금번\s*유입원/.test(trafficCellText_(row[c]))) { titleRow = r; break; }
    }
    if (titleRow >= 0) break;
  }
  if (titleRow < 0) { Logger.log('⚠ [유입] SHOP유입_raw에서 "금번 유입원" 제목 행을 찾지 못함'); return null; }

  // 제목 바로 다음 행(헤더 행)의 D열(index 3)에 있는 "YY.MM.DD" 점(.) 표기 날짜가 금번 블록의 첫 날짜다.
  const hdrRow = ref[titleRow + 1] || [];
  const m = trafficCellText_(hdrRow[3]).match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  if (!m) { Logger.log('⚠ [유입] SHOP유입_raw 금번 블록의 날짜 헤더(YY.MM.DD)를 찾지 못함'); return null; }
  const curDate = '20' + m[1] + '-' + m[2] + '-' + m[3];

  const promoRows = trafficRaw.promo || [];
  for (let r = 0; r < promoRows.length; r++) {
    const row = promoRows[r] || [];
    const nm = trafficCellText_(row[0]);
    if (!nm || nm === '프로모션명') continue;
    const start = trafficCellText_(row[5]);
    if (!start) continue;
    const end = trafficCellText_(row[6]) || start;
    if (curDate >= start && curDate <= end) {
      const yy = String(Math.round(Number(trafficCellText_(row[1]) || 0))).slice(-2);
      const mm = String(Math.round(Number(trafficCellText_(row[2]) || 0)));
      const id = `${yy}-${mm}-${nm}`;
      Logger.log(`✅ [유입] SHOP유입_raw 전용 promoId 판정: '${id}' (금번 시작일=${curDate})`);
      return id;
    }
  }
  Logger.log(`⚠ [유입] SHOP유입_raw: 프로모션_항목에서 날짜 범위 매칭 실패 (금번 시작일=${curDate}) — 이번 회차는 traffic.shop 갱신을 건너뜀`);
  return null;
}

/**
 * 그외_raw B2 상품코드를 정규화한다 — "yp0216 (3D토너)"처럼 코드 뒤에 괄호로 상품명이
 * 붙어있으면 그 괄호 부분을 제거하고 순수 코드("yp0216")만 남긴다. 괄호가 없으면 trim만 적용.
 * (반각/전각 괄호 모두 처리)
 */
function normalizeSkuCode_(raw) {
  return String(raw || '').replace(/[\(（][^\)）]*[\)）]\s*$/, '').trim();
}

/**
 * store(예: traffic.shop, traffic.sku.yp0001 등) 안에서, 방금 keptPromoId에 저장한 rawContent와
 * 내용이 완전히 동일한 항목이 다른 promoId 아래에도 남아있으면 그 오래된 중복 항목을 제거한다.
 * 그외_raw(동적 SKU) 전용으로만 있던 "근본 원인 정리" 로직(예: 7월 2차마라톤 데이터가 당시
 * 프로모션_항목에 7월 항목이 없어 6월 슈퍼세일로 잘못 매칭되어 저장된 경우)과 정리 기준이
 * 완전히 동일하며, shop/고정 SKU에도 같은 상황(예: SHOP유입_raw를 SKU 시트보다 먼저 갱신해서
 * 그 사이 동기화가 한 번 끼어드는 경우)이 재현될 수 있어 재사용 가능한 형태로 뺀 것이다.
 */
function cleanupStaleDuplicates_(store, keptPromoId, rawContent) {
  const newRawJson = JSON.stringify(rawContent);
  Object.keys(store).forEach((pid) => {
    if (pid !== keptPromoId && JSON.stringify(store[pid]) === newRawJson) {
      delete store[pid];
      Logger.log(`✅ [유입] promoId='${pid}'에 잘못 분류돼 남아있던 중복 스냅샷 제거(내용이 '${keptPromoId}'와 동일)`);
    }
  });
}

/**
 * 기존 traffic 이력에 이번 promoId 스냅샷만 갱신해서 합친다.
 * promoId 판정에 실패해도 promos 목록은 항상 최신으로 갱신한다(프로모션_항목은 append형이라 안전).
 */
function mergeTrafficIntoPayload_(existingTraffic, trafficRaw, promoId, otherPromoId, shopPromoId) {
  const traffic = (existingTraffic && typeof existingTraffic === 'object')
    ? existingTraffic
    : { promos: [], shop: {}, sku: { yp0001: {}, yp3755: {}, ys0211: {}, ybox2508: {} }, other: {}, dynamicSkuCodes: [] };

  traffic.promos = trafficRaw.promo || [];
  traffic.shop = traffic.shop || {};
  traffic.sku = traffic.sku || { yp0001: {}, yp3755: {}, ys0211: {}, ybox2508: {} };
  traffic.other = traffic.other || {};
  traffic.dynamicSkuCodes = traffic.dynamicSkuCodes || [];

  // 기존에 정규화되지 않은 채 저장된 코드(예: "yp0216 (3D토너)")가 있으면, 정규화된 코드
  // (예: "yp0216")로 이력을 병합하고 옛 항목은 제거한다 — 매 실행마다 자동으로 정리되므로
  // 이번 배포분부터는 별도 수작업 없이 기존 중복도 함께 제거된다.
  traffic.dynamicSkuCodes.slice().forEach((existingCode) => {
    const norm = normalizeSkuCode_(existingCode);
    if (!norm || norm === existingCode) return;
    traffic.sku[norm] = traffic.sku[norm] || {};
    Object.keys(traffic.sku[existingCode] || {}).forEach((pid) => {
      if (!traffic.sku[norm][pid]) traffic.sku[norm][pid] = traffic.sku[existingCode][pid];
    });
    delete traffic.sku[existingCode];
    traffic.dynamicSkuCodes = traffic.dynamicSkuCodes.filter((c) => c !== existingCode);
    if (traffic.dynamicSkuCodes.indexOf(norm) < 0) traffic.dynamicSkuCodes.push(norm);
    Logger.log(`✅ [유입] 미정규화 코드 '${existingCode}' → '${norm}'로 병합 정리 완료`);
  });

  // shop은 SHOP유입_raw 자신의 날짜로 독립 판정한 shopPromoId를 사용한다 — SHOP유입_raw가
  // yp0001_raw/yp3755_raw와 다른 시점에(갱신 순서가 뒤바뀌어) 붙여넣어지더라도 항상 자기 자신의
  // 날짜를 기준으로 정확한 promoId에 저장된다. shopPromoId 판정에 실패한 경우에만(예: 두 시트가
  // 아직 갱신되지 않은 초기 상태 등) 기존 동작(SKU 기준 promoId)으로 폴백해 하위 호환을 유지한다.
  const shopKey = shopPromoId || promoId;
  if (shopKey) {
    traffic.shop[shopKey] = trafficRaw.shop;
    // 과거에 SHOP유입_raw와 SKU 시트의 갱신 순서가 어긋나 다른 promoId 아래 잘못 저장된
    // 중복 스냅샷이 남아있으면(내용이 이번 것과 완전히 동일하면) 그 오래된 항목을 제거한다.
    cleanupStaleDuplicates_(traffic.shop, shopKey, trafficRaw.shop);
  }
  // 4개 고정 SKU는 기존과 완전히 동일하게 promoId(findCurrentPromoId_ 판정값)를 사용한다.
  if (promoId) {
    ['yp0001', 'yp3755', 'ys0211', 'ybox2508'].forEach((k) => {
      traffic.sku[k] = traffic.sku[k] || {};
      traffic.sku[k][promoId] = trafficRaw[k];
      // shop과 동일한 사유(다른 원본 시트 간 갱신 순서 어긋남)로 오래된 오분류 스냅샷이
      // 남아있을 수 있어 동일한 기준으로 정리한다.
      cleanupStaleDuplicates_(traffic.sku[k], promoId, trafficRaw[k]);
    });
  }

  // 신규: 그외_raw(other)와 그 안의 동적 SKU 코드는 4개 고정 SKU/shop과 별개로, 그외_raw
  // 자신의 날짜로 독립 판정한 otherPromoId를 사용한다 — 그외_raw가 4개 고정 SKU와 다른
  // 시점에(다른 프로모션으로) 갱신되더라도 서로 다른 promoId 아래 올바르게 분리 저장된다.
  // 코드는 normalizeSkuCode_()로 정규화해 "yp0216 (3D토너)"와 "yp0216"이 서로 다른 코드로
  // 중복 등록되지 않게 한다. 'shop'/'other'는 이미 예약된 대상 키라 코드로 쓸 수 없게 제외한다.
  if (otherPromoId) {
    traffic.other[otherPromoId] = trafficRaw.other;

    const code = normalizeSkuCode_(trafficRaw.otherCode);
    const reserved = ['shop', 'other'];
    if (code && reserved.indexOf(code.toLowerCase()) < 0) {
      traffic.sku[code] = traffic.sku[code] || {};

      // 근본 원인 정리: 프로모션_항목이 나중에 수정/추가되면서, 과거 동기화 시점에는
      // curDate가 다른(잘못된) 프로모션 기간에 걸려 오분류 저장된 스냅샷이 남아있을 수 있다
      // (예: 실제로는 7월 2차마라톤 데이터인데, 당시 프로모션_항목에 7월 항목이 없어서
      // 6월 슈퍼세일로 잘못 매칭되어 저장된 경우). 이번에 새로 판정된 otherPromoId와
      // 다른 promoId 아래, 내용이 완전히 동일한(=같은 원본을 잘못 분류해 중복 저장한)
      // 스냅샷이 있으면 오래된 오분류 항목이므로 제거하고 새 promoId 것만 남긴다.
      const newRawJson = JSON.stringify(trafficRaw.other);
      Object.keys(traffic.sku[code]).forEach((pid) => {
        if (pid !== otherPromoId && JSON.stringify(traffic.sku[code][pid]) === newRawJson) {
          delete traffic.sku[code][pid];
          Logger.log(`✅ [유입] '${code}' — promoId='${pid}'에 잘못 분류돼 남아있던 중복 스냅샷 제거(내용이 '${otherPromoId}'와 동일)`);
        }
      });

      traffic.sku[code][otherPromoId] = trafficRaw.other;
      if (traffic.dynamicSkuCodes.indexOf(code) < 0) traffic.dynamicSkuCodes.push(code);
      Logger.log(`✅ [유입] 그외_raw 상품코드 '${code}' → promoId='${otherPromoId}' 전용 이력 저장 완료`);
    }
  }

  Logger.log(`✅ [유입] SKU promoId='${promoId || '없음'}' · shop promoId='${shopPromoId || '없음'}(사용값='${shopKey || '없음'}')' · 그외_raw promoId='${otherPromoId || '없음'}' 스냅샷 병합 완료 (누적 프로모션 수: ${Object.keys(traffic.shop).length})`);
  return traffic;
}

/**
 * GitHub의 현재 data.json을 읽어온다 (traffic 이력을 이어받기 위함).
 * pushToGitHub()가 이미 sha 조회를 위해 같은 파일을 한 번 더 GET하지만,
 * 기존 함수를 건드리지 않기 위해 여기서 별도로 한 번 더 조회한다(10분 주기라 무해).
 */
function fetchExistingDataJson_() {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) return null;
  /* GitHub Contents API는 파일이 1MB를 넘으면 content/encoding 필드를 아예 비워서 응답한다
     (공식 문서에 명시된 제한). data.json은 이미 1MB를 훌쩍 넘긴 상태라 기존 방식(meta.content를
     base64 디코딩)으로는 매번 null을 반환해 traffic 이력이 매 회차 새로 리셋되고 있었다.
     raw.githubusercontent.com은 이 1MB 제한이 없으므로 파일 내용을 직접 그대로 받아온다. */
  const rawUrl = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${GITHUB_FILE_PATH}`;
  try {
    const resp = UrlFetchApp.fetch(rawUrl, { headers: { Authorization: `Bearer ${token}` }, muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return null;
    return JSON.parse(resp.getContentText());
  } catch (e) {
    Logger.log('⚠ [유입] 기존 data.json 조회 실패(신규 파일이거나 일시 오류): ' + e.message);
    return null;
  }
}
