/**
 * utils.js — 날짜 계산, 구간 집계, 포맷팅 유틸리티
 * 모든 "금번/직전/전년" 비교는 프로모션_항목에 정의된 기간을 기준으로만 계산합니다.
 * (달력상 지난달/작년 동월을 임의로 사용하지 않음 — KY 요구사항)
 */

// ---------------------------------------------------------------
// 포맷터
// ---------------------------------------------------------------
export function fmtYen(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return "¥" + Math.round(n).toLocaleString("en-US");
}
export function fmtNum(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return Math.round(n).toLocaleString("en-US");
}
export function fmtPct(n, digits = 1) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return n.toFixed(digits) + "%";
}

// (현재 - 직전) / 직전 * 100  — KY 표준 비율 계산 공식
export function pctDelta(cur, base) {
  if (!base) return null;
  return ((cur - base) / base) * 100;
}
// %p 차이 (전환율, 신규/기존 비중 등 "비율의 비율"에는 상대% 대신 %p 사용)
export function ppDelta(cur, base) {
  if (cur === null || base === null || cur === undefined || base === undefined) return null;
  return cur - base;
}

export function deltaChipHTML(pct, isPP = false) {
  if (pct === null || pct === undefined || isNaN(pct)) {
    return `<span class="delta-chip"><span class="lbl"></span>—</span>`;
  }
  const pos = pct >= 0;
  const suffix = isPP ? "%p" : "%";
  return `<span class="delta-chip ${pos ? "pos" : "neg"}"><span class="lbl"></span>${pos ? "▲" : "▼"} ${Math.abs(pct).toFixed(1)}${suffix}</span>`;
}
export function deltaInlineHTML(pct, isPP = false) {
  if (pct === null || pct === undefined || isNaN(pct)) {
    return `<span class="delta-inline sub">—</span>`;
  }
  const pos = pct >= 0;
  const suffix = isPP ? "%p" : "%";
  return `<span class="delta-inline ${pos ? "pos" : "neg"}">${pos ? "▲" : "▼"} ${Math.abs(pct).toFixed(1)}${suffix}</span>`;
}

// ---------------------------------------------------------------
// 날짜 유틸
// ---------------------------------------------------------------
export function parseDate(str) {
  // "YYYY-MM-DD" -> Date (로컬 자정 기준)
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}
export function toDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
export function addDays(date, n) {
  const r = new Date(date);
  r.setDate(r.getDate() + n);
  return r;
}
export function daysBetween(startStr, endStr) {
  const s = parseDate(startStr), e = parseDate(endStr);
  return Math.round((e - s) / 86400000) + 1;
}
export function isDateInRange(dateStr, startStr, endStr) {
  return dateStr >= startStr && dateStr <= endStr;
}

// ---------------------------------------------------------------
// 구간 집계 (숍 전체 또는 특정 SKU의 daily 배열에서 사용)
// ---------------------------------------------------------------
export function filterRange(dailyArr, startStr, endStr) {
  return dailyArr.filter((r) => isDateInRange(r.date, startStr, endStr));
}

export function aggregateRows(rows) {
  if (!rows || rows.length === 0) {
    return {
      sales: 0, orders: 0, qty: 0, uv: 0, aov: 0,
      newCustomers: 0, existingCustomers: 0, newRatio: null, existingRatio: null,
      totalInflow: 0, internalInflow: 0, externalInflow: 0,
      externalUrlDirect: 0, externalEtc: 0,
      internalRatio: null, externalRatio: null, cvr: 0,
    };
  }
  const sum = (key) => rows.reduce((a, r) => a + (r[key] || 0), 0);
  const sales = sum("sales");
  const orders = sum("orders");
  const qty = sum("qty");
  const uv = sum("uv");
  const newCustomers = sum("newCustomers");
  const existingCustomers = sum("existingCustomers");
  const totalInflow = sum("totalInflow");
  const internalInflow = sum("internalInflow");
  const externalInflow = sum("externalInflow");
  const externalUrlDirect = sum("externalUrlDirect");
  const externalEtc = sum("externalEtc");
  const totalCustomers = newCustomers + existingCustomers;
  return {
    sales, orders, qty, uv,
    aov: orders ? sales / orders : 0,
    newCustomers, existingCustomers,
    // 분모(신규+기존)가 0이면 "0%"가 아니라 데이터 없음(null) — fmtPct(null)은 "—"로 표시됨
    newRatio: totalCustomers ? (newCustomers / totalCustomers) * 100 : null,
    existingRatio: totalCustomers ? (existingCustomers / totalCustomers) * 100 : null,
    totalInflow, internalInflow, externalInflow, externalUrlDirect, externalEtc,
    // totalPV(분모)가 0이면 비중은 null(데이터 없음) — KY 확정 기준
    internalRatio: totalInflow ? (internalInflow / totalInflow) * 100 : null,
    externalRatio: totalInflow ? (externalInflow / totalInflow) * 100 : null,
    cvr: totalInflow ? (orders / totalInflow) * 100 : 0,
  };
}

export function aggregateRange(dailyArr, startStr, endStr) {
  return aggregateRows(filterRange(dailyArr, startStr, endStr));
}

export function aggregateMonth(dailyArr, year, month) {
  const mm = String(month).padStart(2, "0");
  const prefix = `${year}-${mm}`;
  return aggregateRows(dailyArr.filter((r) => r.date.startsWith(prefix)));
}

export function aggregateYear(dailyArr, year) {
  const prefix = `${year}-`;
  return aggregateRows(dailyArr.filter((r) => r.date.startsWith(prefix)));
}

// ---------------------------------------------------------------
// 프로모션 일자 인덱스 (메가와리 0.5일차 특수 규칙 반영)
// ---------------------------------------------------------------
// offset 0 -> isHalfDayFirst ? "0.5일차" : "1일차"
// offset n -> isHalfDayFirst ? `${n}일차` : `${n + 1}일차`
export function dayIndexLabel(offset, isHalfDayFirst) {
  if (isHalfDayFirst) {
    return offset === 0 ? "0.5일차" : `${offset}일차`;
  }
  return `${offset + 1}일차`;
}

export function buildPromoDayLabels(promo) {
  const totalDays = daysBetween(promo.current.start, promo.current.end);
  const labels = ["누계"];
  for (let i = 0; i < totalDays; i++) {
    labels.push(dayIndexLabel(i, promo.isHalfDayFirst));
  }
  return labels;
}

// 프로모션 기간의 특정 offset(0-indexed) 날짜의 daily row 집합 반환
export function rowsForDayOffset(dailyArr, promoRangeStart, offset) {
  const targetDate = toDateStr(addDays(parseDate(promoRangeStart), offset));
  return dailyArr.filter((r) => r.date === targetDate);
}

// 프로모션 기간 전체를 offset 배열([누계, day0, day1, ...])로 나눠 각각 집계
export function aggregateByDayOffset(dailyArr, rangeStart, rangeEnd) {
  const totalDays = daysBetween(rangeStart, rangeEnd);
  const perDay = [];
  for (let i = 0; i < totalDays; i++) {
    perDay.push(aggregateRows(rowsForDayOffset(dailyArr, rangeStart, i)));
  }
  const cumulative = aggregateRange(dailyArr, rangeStart, rangeEnd);
  return [cumulative, ...perDay];
}

// ---------------------------------------------------------------
// 기간 유효성 검사 — 프로모션_항목에 직전/전년 기간이 입력되지 않은 경우
// Code.gs가 "-" 또는 빈 문자열을 내려보낸다(실측 확인됨: public-data/data.json에서
// 39개 프로모션 중 21개가 직전 기간 "-"). 이 경우 "기간 자체가 없음"이며,
// 이를 날짜 범위로 잘못 해석해 0으로 집계하면 "실제 0"과 구분이 안 되므로
// 반드시 무효 기간으로 먼저 걸러낸다.
// ---------------------------------------------------------------
export function isValidPeriod(period) {
  if (!period) return false;
  const { start, end } = period;
  return !!start && !!end && start !== "-" && end !== "-";
}

// 유효한 기간이면서 실제로 매칭되는 daily 행이 1개 이상 있을 때만 집계 결과를 반환.
// 무효 기간이거나(직전/전년 미정의) 유효 기간이지만 원본 daily 배열에 해당 날짜
// 범위 자체가 없는 경우(수집 이전/이후) 둘 다 null을 반환해 "데이터 없음"과
// "값이 0"을 프론트에서 구분할 수 있게 한다.
export function aggregateRangeOrNull(dailyArr, period) {
  if (!isValidPeriod(period)) return null;
  const rows = filterRange(dailyArr, period.start, period.end);
  if (rows.length === 0) return null;
  return aggregateRows(rows);
}

// 프로모션 경과일(offset) 기준 금번/직전/전년 공통 조회.
// offsetIndex 0 = 누계(기간 전체), offsetIndex n(>=1) = 그 기간의 시작일로부터
// (n-1)일째 되는 날의 daily 행. 각 기간(period)은 자기 자신의 start를 기준으로
// 오프셋을 셈 — 달력상 같은 날짜가 아니라 "같은 경과일"을 비교하기 위함
// (KY 요구사항: 프로모션_항목의 실제 날짜만 사용, 임의 계산 금지).
export function seriesForOffsetOrNull(dailyArr, period, offsetIndex) {
  if (!dailyArr || !isValidPeriod(period)) return null;
  if (offsetIndex === 0) return aggregateRangeOrNull(dailyArr, period);
  const rows = rowsForDayOffset(dailyArr, period.start, offsetIndex - 1);
  if (rows.length === 0) return null;
  return aggregateRows(rows);
}

// ---------------------------------------------------------------
// 유입 채널 상세(E~BC) 집계 — 상품/숍전체마다 채널별 PV가 배열(row.channels,
// 원본 컬럼 순서 그대로)로 들어있는 daily 행을 다룬다. aggregateRows는 필드를
// 이름으로만 합산하므로 배열 필드는 별도 함수가 필요하다.
// ---------------------------------------------------------------

// data.inflowCatalog[code](컬럼형: {dates, totalInflow, ..., channels:[[]]})를
// 기존 aggregateRange/rowsForDayOffset 등이 기대하는 "날짜별 행 배열"로 변환.
// 실제 데이터에 없는 상품코드(직접 추가했지만 원본에 없는 경우)는 빈 배열 반환
// — 이후 모든 집계가 자연스럽게 null("데이터 없음")로 이어진다.
export function rowifyInflowProduct(entry) {
  if (!entry) return [];
  return entry.dates.map((date, i) => ({
    date,
    totalInflow: entry.totalInflow[i],
    internalInflow: entry.internalInflow[i],
    externalInflow: entry.externalInflow[i],
    externalUrlDirect: entry.externalUrlDirect[i],
    externalEtc: entry.externalEtc[i],
    channels: entry.channels[i],
  }));
}

// rows(각 행에 channels 배열이 있는 daily 배열)에서 채널별 합계를 구한다.
function sumChannelsOverRows(rows, channelCount) {
  const totals = new Array(channelCount).fill(0);
  rows.forEach((r) => {
    if (!r.channels) return;
    for (let i = 0; i < channelCount; i++) totals[i] += r.channels[i] || 0;
  });
  return totals;
}

// seriesForOffsetOrNull과 동일한 규칙(경과일 오프셋, 무효 기간/데이터 없음은 null)을
// 채널 배열 51개 전체에 적용한 버전. 반환값은 channelCount 길이의 숫자 배열이거나 null.
export function channelSeriesForOffsetOrNull(rows, period, offsetIndex, channelCount) {
  if (!rows || !isValidPeriod(period)) return null;
  const matched = offsetIndex === 0
    ? filterRange(rows, period.start, period.end)
    : rowsForDayOffset(rows, period.start, offsetIndex - 1);
  if (matched.length === 0) return null;
  return sumChannelsOverRows(matched, channelCount);
}

// ---------------------------------------------------------------
// "누계 = 프로모션 시작일부터 현재까지 경과한 기간" (KY 요구사항: 진행 중인
// 프로모션은 아직 끝나지 않았으므로 period.start~period.end 전체를 누계로 쓰면
// 안 되고, 실제 데이터가 존재하는 만큼만 금번/직전/전년에 "동일 경과일수"로
// 적용해야 한다). 기준 시계는 항상 dailyArr(보통 data.shopDaily — 상품/채널별로
// 들쭉날쭉하지 않은 가장 완전한 데이터셋)로 고정하고, promo.current.start부터
// 연속으로 실측 데이터(0이 아닌 날)가 있는 날 수를 센다. 이미 끝난 프로모션은
// 모든 날짜에 실측치가 있으므로 결과적으로 totalDays와 같아져 기존 동작과 동일.
export function computeElapsedDayCount(dailyArr, promo) {
  if (!dailyArr || !promo || !isValidPeriod(promo.current)) return 0;
  const totalDays = daysBetween(promo.current.start, promo.current.end);
  let count = 0;
  for (let i = 0; i < totalDays; i++) {
    const rows = rowsForDayOffset(dailyArr, promo.current.start, i);
    if (rows.length === 0) break;
    // 유입(PV) 데이터 자체의 존재 여부만 기준으로 한다 — 매출(sales)은 유입과 별도
    // 시트/주기로 갱신되어 유입보다 하루 먼저 채워지는 경우가 있으므로(실측 확인됨)
    // sales를 함께 보면 아직 유입 집계가 안 된 날을 "경과함"으로 잘못 셀 수 있다.
    const dayTotal = rows.reduce((sum, r) => sum + (r.totalInflow || 0), 0);
    if (dayTotal === 0) break; // 행은 있지만 유입 데이터가 아직 채워지지 않은(진행 중인 오늘) 날
    count = i + 1;
  }
  return count;
}

// computeElapsedDayCount로 구한 dayCount를 period(자기 자신의 start 기준)에 그대로
// 적용해 집계한다. dayCount가 0이거나 기간이 무효면 null("데이터 없음").
export function aggregateElapsedOrNull(dailyArr, period, dayCount) {
  if (!dailyArr || !isValidPeriod(period) || dayCount <= 0) return null;
  let rows = [];
  for (let i = 0; i < dayCount; i++) {
    rows = rows.concat(rowsForDayOffset(dailyArr, period.start, i));
  }
  if (rows.length === 0) return null;
  return aggregateRows(rows);
}

// aggregateElapsedOrNull의 채널(51개 배열) 버전.
export function channelElapsedOrNull(dailyArr, period, dayCount, channelCount) {
  if (!dailyArr || !isValidPeriod(period) || dayCount <= 0) return null;
  let rows = [];
  for (let i = 0; i < dayCount; i++) {
    rows = rows.concat(rowsForDayOffset(dailyArr, period.start, i));
  }
  if (rows.length === 0) return null;
  return sumChannelsOverRows(rows, channelCount);
}

// ---------------------------------------------------------------
// SKU 매출비중 공통 분모 — "메인 SKU 전체 합계 매출" (연간 화면은 연간 합계,
// 월별 화면은 월 합계로 각각 호출). 화면마다 따로 계산하면 나중에 한쪽만 고치고
// 다른 쪽을 놓치는 문제가 생기므로 하나의 함수로 통일한다.
// aggregateFn: (skuDailyArr) => aggregateRows 결과 (예: (arr) => aggregateYear(arr, year))
// ---------------------------------------------------------------
export function sumMainSkuSales(data, mainSkus, aggregateFn) {
  return mainSkus.reduce((sum, sku) => {
    const arr = data.skuDaily[sku.code];
    if (!arr) return sum;
    return sum + aggregateFn(arr).sales;
  }, 0);
}

// ---------------------------------------------------------------
// 메인 SKU 마스터 목록 산출
// 결정: "연간/월별" 화면처럼 특정 프로모션에 종속되지 않는 화면에서는
// 전체 프로모션의 P~Q열 SKU 목록의 합집합을 사용합니다.
// (KY 확인 필요 — README 참고)
// ---------------------------------------------------------------
export function resolveMainSkus(data, promoId = null) {
  if (promoId) {
    const promo = data.promotions.find((p) => p.id === promoId);
    if (promo) {
      return promo.mainSkus
        .map((code) => data.meta.mainSkus.find((s) => s.code === code))
        .filter(Boolean);
    }
  }
  // 프로모션 미지정 시: meta.mainSkus 전체(=전체 프로모션 합집합, Code.gs에서 생성)
  return data.meta.mainSkus;
}
