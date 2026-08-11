/**
 * Code.gs — Qoo10 대시보드용 Google Apps Script
 * ------------------------------------------------------------------
 * 이 스크립트는 "Qoo10 매출 대시보드 Raw" Google Sheet에 컨테이너 바인딩하여
 * 사용합니다 (스프레드시트 확장 프로그램 > Apps Script).
 *
 * 동작:
 *   1) Raw 시트들을 읽어 대시보드가 바로 소비할 수 있는 구조로 가공
 *   2) 결과 JSON을 GitHub 저장소에 커밋 (Contents API)
 *   3) 프론트엔드(js/data.js)는 그 GitHub raw URL을 fetch하여 렌더링
 *
 * 이 아키텍처는 기존 Rakuten 대시보드와 동일합니다 — 회사 보안 정책상
 * 브라우저가 Google Sheet에 직접 접근할 수 없으므로, Apps Script가 중간에서
 * 데이터를 가공해 GitHub에 올리고 프론트는 그 결과만 읽습니다.
 *
 * 실행 트리거: 시간 기반 트리거(예: 매 시간)로 syncToGitHub()를 실행하도록
 * Apps Script 편집기 > 트리거에서 등록하세요.
 * ------------------------------------------------------------------
 */

// ====================================================================
// 0. 설정 — 스크립트 속성(Project Settings > Script properties)에 저장 권장
//    GITHUB_TOKEN, GITHUB_REPO(예: "org/qoo10-dashboard"), GITHUB_BRANCH, GITHUB_DATA_PATH
// ====================================================================
function getConfig_() {
  const props = PropertiesService.getScriptProperties();
  return {
    githubToken: props.getProperty("GITHUB_TOKEN"),
    githubRepo: props.getProperty("GITHUB_REPO") || "2-KY/qoo10-dashboard",
    githubBranch: props.getProperty("GITHUB_BRANCH") || "main",
    githubDataPath: props.getProperty("GITHUB_DATA_PATH") || "public-data/data.json",
  };
}

// ====================================================================
// 1. 메인 엔트리포인트
// ====================================================================
function syncToGitHub() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const payload = buildDashboardData_(ss);
  pushToGitHub_(payload);
}

// ====================================================================
// 2. 대시보드 데이터 조립
// ====================================================================
function buildDashboardData_(ss) {
  const mainSkus = readMainSkus_(ss);          // 프로모션_항목 P~Q열
  const promotions = readPromotions_(ss);       // 프로모션_항목 A~J열
  const monthlyTargets = readMonthlyTargets_(ss); // 프로모션_항목 L~N열

  const shopDaily = buildShopDaily_(ss);
  const skuDaily = buildSkuDaily_(ss, mainSkus);
  const coupons = readCoupons_(ss);

  return {
    generatedAt: new Date().toISOString(),
    isSampleData: false,
    meta: { mainSkus: mainSkus },
    promotions: promotions,
    monthlyTargets: monthlyTargets,
    shopDaily: shopDaily,
    skuDaily: skuDaily,
    coupons: coupons,
  };
}

// --------------------------------------------------------------------
// 2-1. 메인 SKU 마스터 (프로모션_항목 P~Q열)
// ⚠️ TODO(확인 필요): 특정 프로모션에 종속되지 않는 화면(연간/월별)에서 쓸
//    "전체 메인 SKU 마스터"를 어떤 기준으로 정할지 KY 확인 필요.
//    현재 구현: 전체 프로모션 행의 P~Q열 SKU 목록 합집합(중복 제거)을 사용.
// --------------------------------------------------------------------
function readMainSkus_(ss) {
  const sheet = requireSheet_(ss, "프로모션_항목");
  const values = sheet.getDataRange().getValues();
  const header = values[0];
  const colP = requireCol_(header, "메인상품코드", "프로모션_항목");
  const colQ = requireCol_(header, "메인상품명", "프로모션_항목");

  const seen = {};
  const list = [];
  for (let i = 1; i < values.length; i++) {
    const code = values[i][colP];
    const name = values[i][colQ];
    if (!code || seen[code]) continue;
    seen[code] = true;
    list.push({ code: String(code), name: String(name) });
  }
  return list;
}

// --------------------------------------------------------------------
// 2-2. 프로모션 정의 (A~J열) — 금번/직전/전년 비교기간의 단일 출처
// ⚠️ TODO: isHalfDayFirst(예: 메가와리 0.5일차)를 시트 컬럼으로 관리할지,
//    프로모션명으로 하드코딩 매칭할지 결정 필요. 아래는 이름 매칭 예시.
// --------------------------------------------------------------------
function readPromotions_(ss) {
  const sheet = requireSheet_(ss, "프로모션_항목");
  const values = sheet.getDataRange().getValues();
  const header = values[0];
  const idx = (name) => requireCol_(header, name, "프로모션_항목");

  const cName = idx("프로모션명"), cYear = idx("연도"), cMonth = idx("월"),
    cStart = idx("시작일"), cEnd = idx("종료일"),
    cPrevStart = idx("직전 시작일"), cPrevEnd = idx("직전 종료일"),
    cYoyStart = idx("전년 시작일"), cYoyEnd = idx("전년 종료일"),
    cMainCode = idx("메인상품코드");
  const cNote = findColTrim_(header, "비고"); // 선택 항목 — 없어도 진행

  // 프로모션명 -> 해당 행들의 메인 SKU 코드 집합
  const skusByPromoRow = {};
  for (let i = 1; i < values.length; i++) {
    const key = i;
    if (!skusByPromoRow[key]) skusByPromoRow[key] = [];
    if (values[i][cMainCode]) skusByPromoRow[key].push(String(values[i][cMainCode]));
  }

  const HALF_DAY_PROMO_NAMES = ["메가와리", "メガ割"]; // TODO: 정식 목록/컬럼으로 대체

  const out = [];
  const grouped = {}; // "연도-월-프로모션명" 단위로 그룹핑 (한 프로모션이 여러 행에 SKU별로 나뉘어 있을 수 있음)
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (!row[cName]) continue;
    const key = `${row[cYear]}-${row[cMonth]}-${row[cName]}`;
    if (!grouped[key]) {
      grouped[key] = {
        id: `${row[cYear]}-${String(row[cMonth]).padStart(2, "0")}-${slugify_(row[cName])}`,
        name: String(row[cName]),
        year: Number(row[cYear]),
        month: Number(row[cMonth]),
        current: { start: fmtDate_(row[cStart]), end: fmtDate_(row[cEnd]) },
        previous: { start: fmtDate_(row[cPrevStart]), end: fmtDate_(row[cPrevEnd]) },
        yoy: { start: fmtDate_(row[cYoyStart]), end: fmtDate_(row[cYoyEnd]) },
        note: String(row[cNote] || ""),
        isHalfDayFirst: HALF_DAY_PROMO_NAMES.indexOf(String(row[cName])) !== -1,
        mainSkus: [],
      };
    }
    if (row[cMainCode]) grouped[key].mainSkus.push(String(row[cMainCode]));
  }
  Object.keys(grouped).forEach((k) => {
    const p = grouped[k];
    p.mainSkus = uniq_(p.mainSkus);
    out.push(p);
  });
  return out;
}

// --------------------------------------------------------------------
// 2-3. 월별 목표매출 (L~N열)
// --------------------------------------------------------------------
function readMonthlyTargets_(ss) {
  const sheet = requireSheet_(ss, "프로모션_항목");
  const values = sheet.getDataRange().getValues();
  const header = values[0];
  const cYear = findColTrim_(header, "연도_목표") !== -1 ? findColTrim_(header, "연도_목표") : findColTrim_(header, "연도");
  const cMonth = findColTrim_(header, "월_목표") !== -1 ? findColTrim_(header, "월_목표") : findColTrim_(header, "월");
  const cTarget = requireCol_(header, "월 목표 매출", "프로모션_항목");

  const seen = {};
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const y = values[i][cYear], m = values[i][cMonth], t = values[i][cTarget];
    if (!y || !m || !t) continue;
    const key = `${y}-${m}`;
    if (seen[key]) continue;
    seen[key] = true;
    out.push({ year: Number(y), month: Number(m), target: Number(t) });
  }
  return out;
}

// --------------------------------------------------------------------
// 2-4. 숍 전체 일별 데이터
// SHOP_매출 + 26)/25)SHOP_유입현황 을 날짜 기준으로 결합
// --------------------------------------------------------------------
function buildShopDaily_(ss) {
  const salesRows = readShopSalesSheet_(ss, "SHOP_매출"); // date -> {sales, orders, qty, uv, newCustomers, existingCustomers}
  const inflow26 = readInflowSheet_(ss, "26)SHOP_유입현황");
  const inflow25 = readInflowSheet_(ss, "25)SHOP_유입현황");
  const inflowByDate = Object.assign({}, inflow25, inflow26);

  const out = [];
  Object.keys(salesRows)
    .sort()
    .forEach((date) => {
      const s = salesRows[date];
      const inf = inflowByDate[date] || { totalInflow: 0, internalInflow: 0, externalInflow: 0 };
      const totalCustomers = s.newCustomers + s.existingCustomers;
      out.push({
        date: date,
        sales: s.sales, orders: s.orders, qty: s.qty, uv: s.uv,
        aov: s.orders ? s.sales / s.orders : 0,
        newCustomers: s.newCustomers, existingCustomers: s.existingCustomers,
        newRatio: totalCustomers ? (s.newCustomers / totalCustomers) * 100 : 0,
        existingRatio: totalCustomers ? (s.existingCustomers / totalCustomers) * 100 : 0,
        totalInflow: inf.totalInflow, internalInflow: inf.internalInflow, externalInflow: inf.externalInflow,
      });
    });
  return out;
}

// SHOP_매출 시트에서 날짜별 지표 추출
// 실제 구조 확인됨: 1행 그룹 헤더가 병합 셀 — "구매자결제일" / "[25년] 숍 전체" / "구매자결제일" / "[26년] 숍 전체"
// (병합된 셀은 시작 셀에만 값이 있고 나머지는 빈 문자열로 읽히므로, 왼쪽 값을 이어받아 채운다)
// 2행이 실제 하위 헤더(매출(GMV), 주문건수, 판매수량, UV, 신규고객, 기존고객 등) — 연도 블록마다 동일한 이름이
// 반복되므로, 반드시 각 블록의 열 범위 안에서만 헤더를 찾아야 한다(전역 탐색은 항상 첫 블록만 찾게 됨).
// 3행부터 실데이터. 시트 자체(병합/블록 구조)는 변경하지 않는다.
function readShopSalesSheet_(ss, sheetName) {
  const sheet = requireSheet_(ss, sheetName);
  const values = sheet.getDataRange().getValues();
  if (values.length < 3) {
    throw new Error('시트 "' + sheetName + '"의 행이 3행 미만입니다(1행 그룹헤더/2행 하위헤더/3행~ 데이터 구조 기대). 실제 값: ' + JSON.stringify(values));
  }
  const groupRow = values[0];
  const subRow = values[1];
  const dataRows = values.slice(2);

  // 병합 셀 carry-forward: 빈 칸은 왼쪽에서 가장 최근에 나온 값을 이어받음 (앞뒤 공백은 normHeader_로 제거)
  const filledGroup = [];
  let last = "";
  for (let c = 0; c < groupRow.length; c++) {
    const v = normHeader_(groupRow[c]);
    if (v) last = v;
    filledGroup.push(last);
  }

  // "구매자결제일" 열 = 각 연도 블록의 시작점(날짜 열)
  const blockStarts = [];
  for (let c = 0; c < groupRow.length; c++) {
    if (normHeader_(groupRow[c]) === "구매자결제일") blockStarts.push(c);
  }
  if (blockStarts.length === 0) {
    throw new Error('시트 "' + sheetName + '"에서 "구매자결제일" 열을 찾을 수 없습니다. 1행: ' + JSON.stringify(groupRow));
  }

  const out = {};
  blockStarts.forEach((dateCol, bi) => {
    const blockEnd = bi + 1 < blockStarts.length ? blockStarts[bi + 1] : groupRow.length;
    const groupLabel = filledGroup[dateCol + 1] || filledGroup[dateCol] || ("블록 " + (bi + 1));

    // 이 블록(dateCol+1 ~ blockEnd-1) 범위 안에서만 하위 헤더를 탐색 (양쪽 다 trim 후 비교)
    const findColInBlock = (name) => {
      const target = normHeader_(name);
      for (let c = dateCol + 1; c < blockEnd; c++) {
        if (normHeader_(subRow[c]) === target) return c;
      }
      throw new Error(
        '시트 "' + sheetName + '"의 "' + groupLabel + '" 블록에서 헤더 "' + name +
        '"를 찾을 수 없습니다. 실제 2행(해당 블록): ' + JSON.stringify(subRow.slice(dateCol, blockEnd))
      );
    };

    const cGmv = findColInBlock("매출(GMV)");
    const cOrders = findColInBlock("주문건수");
    const cQty = findColInBlock("판매수량");
    const cUv = findColInBlock("UV");
    const cNew = findColInBlock("신규고객");
    const cExisting = findColInBlock("기존고객");

    dataRows.forEach((row) => {
      const dateVal = row[dateCol];
      // 날짜 열에 실제 Date가 아닌 값(예: "2025.1" 같은 월 소계 행의 텍스트)이 섞여 있으므로
      // 진짜 날짜 셀만 일별 데이터로 인정하고 나머지는 건너뛴다 (실데이터에서 확인된 케이스)
      if (!(dateVal instanceof Date)) return;
      const date = fmtDate_(dateVal);
      out[date] = {
        sales: Number(row[cGmv]) || 0,
        orders: Number(row[cOrders]) || 0,
        qty: Number(row[cQty]) || 0,
        uv: Number(row[cUv]) || 0,
        newCustomers: Number(row[cNew]) || 0,
        existingCustomers: Number(row[cExisting]) || 0,
      };
    });
  });

  return out;
}

// 26)/25)SHOP_유입현황 시트에서 날짜별 전체/내부/외부 유입 계산
// 전체유입 = BD열, 외부유입 = AR+BB+BC열, 내부유입 = 전체 - 외부
function readInflowSheet_(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return {};
  const values = sheet.getDataRange().getValues();
  const header = values[0];
  const idx = (name) => findColTrim_(header, name);
  const cDate = idx("날짜");
  const cTotal = idx("유입채널(PV) : 합계(총페이지뷰)");
  const cExt1 = idx("유입채널(PV) : 외부유입_전체");
  const cExt2 = idx("유입채널(PV) : URL직접입력");
  const cExt3 = idx("유입채널(PV) : 기타");
  if (cDate === -1 || cTotal === -1) {
    Logger.log('[readInflowSheet_] "' + sheetName + '" 헤더 불일치로 유입 데이터를 건너뜁니다(0으로 폴백). 실제 헤더: ' + JSON.stringify(header));
    return {};
  }

  const out = {};
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (!(row[cDate] instanceof Date)) continue; // 월 소계 등 텍스트 날짜 행 제외
    const date = fmtDate_(row[cDate]);
    const total = Number(row[cTotal]) || 0;
    const external = (Number(row[cExt1]) || 0) + (Number(row[cExt2]) || 0) + (Number(row[cExt3]) || 0);
    out[date] = { totalInflow: total, externalInflow: external, internalInflow: total - external };
  }
  return out;
}

// --------------------------------------------------------------------
// 2-5. SKU별 일별 데이터
// 26)/25)SHOP_거래현황(매출/수량) + 상품별 고객 Raw(신규/기존) +
// 26)/25)SHOP_유입현황의 "상품번호" 컬럼(유입) 을 상품코드 기준으로 결합
// --------------------------------------------------------------------
function buildSkuDaily_(ss, mainSkus) {
  const trade26 = readTradeSheet_(ss, "26)SHOP_거래현황");
  const trade25 = readTradeSheet_(ss, "25)SHOP_거래현황");
  const customerByProduct = readCustomerByProductSheets_(ss, mainSkus);
  const inflowByProduct26 = readInflowByProduct_(ss, "26)SHOP_유입현황");
  const inflowByProduct25 = readInflowByProduct_(ss, "25)SHOP_유입현황");

  const tradeCodes = uniq_(Object.keys(trade25).concat(Object.keys(trade26)));
  const mainCodes = mainSkus.map((s) => s.code);
  const matchedCodes = mainCodes.filter((c) => tradeCodes.indexOf(c) !== -1);
  Logger.log(
    '[buildSkuDaily_] 메인 SKU ' + mainCodes.length + '개 중 거래현황에서 매칭된 코드 ' + matchedCodes.length + '개. ' +
    '메인 SKU 코드: ' + JSON.stringify(mainCodes) + ' / 거래현황 코드 샘플(최대10개): ' + JSON.stringify(tradeCodes.slice(0, 10))
  );

  const out = {};
  mainSkus.forEach((sku) => {
    const code = sku.code;
    const tradeRows = Object.assign({}, trade25[code] || {}, trade26[code] || {});
    const custRows = customerByProduct[code] || {};
    const inflowRows = Object.assign({}, inflowByProduct25[code] || {}, inflowByProduct26[code] || {});

    const dates = Object.keys(tradeRows).sort();
    out[code] = dates.map((date) => {
      const t = tradeRows[date];
      const cust = custRows[date] || { newCustomers: 0, existingCustomers: 0 };
      const inf = inflowRows[date] || { totalInflow: 0, internalInflow: 0, externalInflow: 0 };
      const totalCustomers = cust.newCustomers + cust.existingCustomers;
      return {
        date: date,
        sales: t.sales, qty: t.qty,
        orders: t.orders || totalCustomers, // 상품별 주문건수 컬럼이 없다면 고객수로 근사 (TODO 확인)
        uv: inf.uv || 0,
        newRatio: totalCustomers ? (cust.newCustomers / totalCustomers) * 100 : 0,
        existingRatio: totalCustomers ? (cust.existingCustomers / totalCustomers) * 100 : 0,
        totalInflow: inf.totalInflow, internalInflow: inf.internalInflow, externalInflow: inf.externalInflow,
      };
    });
  });
  return out;
}

// 26)/25)SHOP_거래현황: B열(상품번호, 메인 SKU와 동일한 숫자 코드) = 매칭 키,
// G열(취소분반영 거래금액) = 매출, J열(취소분반영 거래상품수량) = 판매수량
// 판매자상품코드(yp****)는 메인 SKU 코드와 스킴이 달라 매칭 키로 쓰지 않는다(확인됨).
function readTradeSheet_(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return {};
  const values = sheet.getDataRange().getValues();
  const header = values[0];
  const idx = (name) => requireCol_(header, name, sheetName);
  const cDate = idx("날짜"), cCode = idx("상품번호"), cSalesAdj = idx("취소분반영 거래금액"), cQtyAdj = idx("취소분반영 거래상품수량");

  const out = {}; // code -> date -> {sales, qty}
  let scanned = 0, matched = 0;
  const sampleCodes = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    scanned++;
    const code = String(row[cCode] || "");
    if (sampleCodes.length < 5 && code) sampleCodes.push(code);
    if (!code || !(row[cDate] instanceof Date)) continue; // 월 소계 등 텍스트 날짜 행 제외
    matched++;
    const date = fmtDate_(row[cDate]);
    if (!out[code]) out[code] = {};
    const prevSales = (out[code][date] && out[code][date].sales) || 0;
    const prevQty = (out[code][date] && out[code][date].qty) || 0;
    out[code][date] = {
      sales: prevSales + (Number(row[cSalesAdj]) || 0),
      qty: prevQty + (Number(row[cQtyAdj]) || 0),
    };
  }
  Logger.log('[readTradeSheet_] "' + sheetName + '" ' + scanned + '행 스캔, ' + matched + '행 반영. 상품번호 샘플: ' + JSON.stringify(sampleCodes));
  return out;
}

// "{SKU명}_고객" 시트들에서 B2셀 상품코드 매칭 후 날짜별 신규/기존 고객수 추출
function readCustomerByProductSheets_(ss, mainSkus) {
  const out = {};
  mainSkus.forEach((sku) => { out[sku.code] = {}; });

  ss.getSheets().forEach((sheet) => {
    const name = sheet.getName();
    if (!name.endsWith("_고객")) return;
    const productCode = String(sheet.getRange("B2").getValue());
    const matched = mainSkus.find((s) => s.code === productCode);
    if (!matched) return; // 메인 SKU 목록에 없는 고객 시트는 건너뜀

    const values = sheet.getDataRange().getValues();
    const header = values[0];
    const idx = (n) => requireCol_(header, n, name);
    const cDate = idx("날짜"), cNew = idx("거래고객_신규고객수"), cExisting = idx("거래고객_기존고객수");

    const byDate = {};
    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      if (!(row[cDate] instanceof Date)) continue; // 월 소계 등 텍스트 날짜 행 제외
      const date = fmtDate_(row[cDate]);
      byDate[date] = {
        newCustomers: Number(row[cNew]) || 0,
        existingCustomers: Number(row[cExisting]) || 0,
      };
    }
    out[matched.code] = byDate;
  });
  return out;
}

// 26)/25)SHOP_유입현황 시트에는 "상품번호" 컬럼이 실제로 존재함(확인됨) — 이 컬럼 기준으로
// SKU별 유입(PV)을 집계한다. 시트 자체가 없는 경우(예: 25년 시트 미존재)만 빈 결과로 폴백.
function readInflowByProduct_(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return {};
  const values = sheet.getDataRange().getValues();
  const header = values[0];
  const idx = (name) => requireCol_(header, name, sheetName);
  const cDate = idx("날짜");
  const cCode = idx("상품번호");
  const cTotal = idx("유입채널(PV) : 합계(총페이지뷰)");
  const cExt1 = idx("유입채널(PV) : 외부유입_전체");
  const cExt2 = idx("유입채널(PV) : URL직접입력");
  const cExt3 = idx("유입채널(PV) : 기타");

  const out = {}; // code -> date -> {...}
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const code = String(row[cCode] || "");
    if (!code || !(row[cDate] instanceof Date)) continue; // 월 소계 등 텍스트 날짜 행 제외
    const date = fmtDate_(row[cDate]);
    const total = Number(row[cTotal]) || 0;
    const external = (Number(row[cExt1]) || 0) + (Number(row[cExt2]) || 0) + (Number(row[cExt3]) || 0);
    if (!out[code]) out[code] = {};
    out[code][date] = { totalInflow: total, externalInflow: external, internalInflow: total - external };
  }
  return out;
}

// --------------------------------------------------------------------
// 2-6. 쿠폰
// ⚠️ TODO: Raw 시트 컬럼 구조 확인 후 구현. 현재는 컬럼 미확인 상태이므로
//    confirmed:false 로 표시하고, 프론트는 이 값을 보고 경고 배너를 띄웁니다.
// --------------------------------------------------------------------
function readCoupons_(ss) {
  const sheet = ss.getSheetByName("쿠폰");
  if (!sheet) {
    return { confirmed: false, note: "쿠폰 시트를 찾을 수 없습니다.", items: [] };
  }
  // TODO: 실제 컬럼 구조 확인 후 파싱 로직 작성
  return {
    confirmed: false,
    note: "쿠폰 Raw 시트 컬럼 구조가 아직 확인되지 않았습니다. 컬럼 확인 후 이 함수를 구현하세요.",
    items: [],
  };
}

// ====================================================================
// 3. GitHub 업로드 (Contents API)
// ====================================================================
function pushToGitHub_(payload) {
  const cfg = getConfig_();
  if (!cfg.githubToken) throw new Error("GITHUB_TOKEN 스크립트 속성이 설정되지 않았습니다.");

  const apiUrl = `https://api.github.com/repos/${cfg.githubRepo}/contents/${cfg.githubDataPath}`;
  const content = Utilities.base64Encode(JSON.stringify(payload), Utilities.Charset.UTF_8);

  // 기존 파일의 sha 조회 (업데이트 시 필요)
  let sha = null;
  try {
    const getRes = UrlFetchApp.fetch(`${apiUrl}?ref=${cfg.githubBranch}`, {
      headers: { Authorization: `Bearer ${cfg.githubToken}` },
      muteHttpExceptions: true,
    });
    if (getRes.getResponseCode() === 200) {
      sha = JSON.parse(getRes.getContentText()).sha;
    }
  } catch (e) {
    // 파일이 없으면 최초 생성 (sha 없이 진행)
  }

  const body = {
    message: `data: 자동 갱신 ${new Date().toISOString()}`,
    content: content,
    branch: cfg.githubBranch,
  };
  if (sha) body.sha = sha;

  const res = UrlFetchApp.fetch(apiUrl, {
    method: "put",
    contentType: "application/json",
    headers: { Authorization: `Bearer ${cfg.githubToken}` },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });

  if (res.getResponseCode() >= 300) {
    throw new Error(`GitHub 업로드 실패 (${res.getResponseCode()}): ${res.getContentText()}`);
  }
  Logger.log("GitHub 업로드 성공");
}

// ====================================================================
// 4. 유틸
// ====================================================================
// 시트가 없으면 실제 시트 목록을 담아 에러를 던짐 (구조 확인 없이 바로 실행해도
// 첫 실패 지점의 에러 메시지만으로 실제 시트명을 알 수 있게 하기 위함)
function requireSheet_(ss, name) {
  const sheet = ss.getSheetByName(name);
  if (!sheet) {
    const all = ss.getSheets().map(function (s) { return s.getName(); });
    throw new Error('시트 "' + name + '"를 찾을 수 없습니다. 실제 시트 목록: ' + JSON.stringify(all));
  }
  return sheet;
}
// 헤더 문자열 정규화 — 실제 시트 헤더에 섞여 있는 앞뒤 공백 때문에 매칭이
// 깨지지 않도록, 헤더를 찾는 모든 곳은 이 함수를 거쳐 trim 후 비교한다.
function normHeader_(v) {
  return String(v === null || v === undefined ? "" : v).trim();
}
// header 배열에서 name과 trim 후 일치하는 첫 열 인덱스 (없으면 -1)
function findColTrim_(header, name) {
  const target = normHeader_(name);
  for (let i = 0; i < header.length; i++) {
    if (normHeader_(header[i]) === target) return i;
  }
  return -1;
}
// 헤더에 컬럼이 없으면 실제 헤더 배열을 담아 에러를 던짐 (위와 같은 이유)
function requireCol_(header, name, sheetName) {
  const i = findColTrim_(header, name);
  if (i === -1) {
    throw new Error('시트 "' + sheetName + '"에서 헤더 "' + name + '"를 찾을 수 없습니다. 실제 헤더: ' + JSON.stringify(header));
  }
  return i;
}
function fmtDate_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  return String(value);
}
function uniq_(arr) {
  const seen = {};
  return arr.filter((v) => (seen[v] ? false : (seen[v] = true)));
}
function slugify_(name) {
  return String(name).replace(/[^\w가-힣]+/g, "").toLowerCase();
}
