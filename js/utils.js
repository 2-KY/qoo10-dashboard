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
      newCustomers: 0, existingCustomers: 0, newRatio: 0, existingRatio: 0,
      totalInflow: 0, internalInflow: 0, externalInflow: 0,
      externalUrlDirect: 0, externalEtc: 0,
      internalRatio: 0, externalRatio: 0, cvr: 0,
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
    newRatio: totalCustomers ? (newCustomers / totalCustomers) * 100 : 0,
    existingRatio: totalCustomers ? (existingCustomers / totalCustomers) * 100 : 0,
    totalInflow, internalInflow, externalInflow, externalUrlDirect, externalEtc,
    internalRatio: totalInflow ? (internalInflow / totalInflow) * 100 : 0,
    externalRatio: totalInflow ? (externalInflow / totalInflow) * 100 : 0,
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
