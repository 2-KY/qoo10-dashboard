/**
 * report.js — "프로모션 보고" 화면의 팩트 계산 엔진 + 규칙기반 보고 문안 생성기.
 *
 * 설계 원칙(KY 요구사항):
 *   - 숫자는 절대 AI가 계산하지 않는다. 이 파일이 먼저 구조화된 사실(facts)을
 *     만들고, AI(또는 AI가 없을 때는 아래 규칙기반 생성기)는 그 사실을 문장으로
 *     바꾸는 역할만 한다.
 *   - 비교 기준(경과일/0.5일차/직전·전년 실제 날짜)은 기존 유입 분석/일별 분석
 *     화면과 완전히 동일한 utils.js 함수를 그대로 재사용한다. 이 파일에서
 *     새로운 날짜 계산 로직을 만들지 않는다.
 *   - 상황기록(events)과 실적 변화는 "같은 기간에 함께 나타났다"는 사실만
 *     연결하고, 인과관계를 단정하지 않는다.
 */
import {
  fmtNum, fmtYen, pctDelta, ppDelta,
  parseDate, toDateStr, addDays, daysBetween,
  isValidPeriod, dayIndexLabel, aggregateRangeOrNull,
  seriesForOffsetOrNull, channelSeriesForOffsetOrNull,
  computeElapsedDayCount, aggregateElapsedOrNull, channelElapsedOrNull,
  rowifyInflowProduct, resolveMainSkus,
} from "./utils.js";

function hasVal(v) {
  return v !== null && v !== undefined && !isNaN(v);
}

function pctLabel(pct) {
  if (!hasVal(pct)) return null;
  return (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%";
}
function ppLabel(pct) {
  if (!hasVal(pct)) return null;
  return (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%p";
}
// 증감액을 부호 있는 형태로("-¥11,499,009", "+45,546") — 항상 %와 함께 실제
// 금액/PV도 병기하기 위함(KY 요구사항).
function signedYen_(diff) { return (diff >= 0 ? "+" : "-") + fmtYen(Math.abs(diff)); }
function signedNum_(diff) { return (diff >= 0 ? "+" : "-") + fmtNum(Math.abs(diff)); }

// 한글 받침 유무에 따른 조사 선택(이/가, 은/는) — 문안이 "매출이(가)"처럼
// 어색하게 나오지 않도록 실제 단어 끝 글자로 판단한다.
function hasBatchim_(word) {
  if (!word) return false;
  const ch = String(word).trim().slice(-1);
  const code = ch.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return false;
  return (code - 0xac00) % 28 !== 0;
}
function josaIGa_(word) { return hasBatchim_(word) ? "이" : "가"; }
function josaEunNeun_(word) { return hasBatchim_(word) ? "은" : "는"; }

// ---------------------------------------------------------------
// 상품 표시 라벨 — 유입 분석 화면과 동일한 우선순위(메인 SKU 한글 별칭 → 없으면
// 원본 상품명 → 없으면 fallback). 문장에는 "상품번호 N"만 쓰고, 이 값은 tooltip
// 등 UI에서만 노출한다(KY 요구사항: 문안에 일본어 상품명 노출 금지).
// ---------------------------------------------------------------
export function productTooltipFor(code, catalog, mainSkus) {
  const main = mainSkus.find((s) => s.code === code);
  if (main) return main.name;
  if (catalog[code] && catalog[code].name) return catalog[code].name;
  return `추가상품 ${code}`;
}

// period(자기 자신의 start 기준)를 periodMode/dayIndex/elapsedDays에 맞춰
// 실제 [start,end] 날짜 범위로 환산한다. 상황기록 날짜 매칭 + 화면 상단
// "비교 대상 기간" 표시(직전/전년의 실제 동일 경과기간)에 함께 쓰인다.
export function resolvePeriodRange(period, periodMode, dayIndex, elapsedDays) {
  if (!isValidPeriod(period)) return null;
  if (periodMode === "daily") {
    const d = toDateStr(addDays(parseDate(period.start), dayIndex));
    return { start: d, end: d };
  }
  if (!elapsedDays || elapsedDays <= 0) return null;
  return { start: period.start, end: toDateStr(addDays(parseDate(period.start), elapsedDays - 1)) };
}

function periodSeries(rows, promo, periodMode, dayIndex, elapsedDays) {
  if (periodMode === "daily") {
    const offset = dayIndex + 1;
    return {
      cur: seriesForOffsetOrNull(rows, promo.current, offset),
      prev: seriesForOffsetOrNull(rows, promo.previous, offset),
      yoy: seriesForOffsetOrNull(rows, promo.yoy, offset),
    };
  }
  return {
    cur: aggregateElapsedOrNull(rows, promo.current, elapsedDays),
    prev: aggregateElapsedOrNull(rows, promo.previous, elapsedDays),
    yoy: aggregateElapsedOrNull(rows, promo.yoy, elapsedDays),
  };
}
function periodChannels(rows, promo, periodMode, dayIndex, elapsedDays, channelCount) {
  if (periodMode === "daily") {
    const offset = dayIndex + 1;
    return {
      cur: channelSeriesForOffsetOrNull(rows, promo.current, offset, channelCount),
      prev: channelSeriesForOffsetOrNull(rows, promo.previous, offset, channelCount),
      yoy: channelSeriesForOffsetOrNull(rows, promo.yoy, offset, channelCount),
    };
  }
  return {
    cur: channelElapsedOrNull(rows, promo.current, elapsedDays, channelCount),
    prev: channelElapsedOrNull(rows, promo.previous, elapsedDays, channelCount),
    yoy: channelElapsedOrNull(rows, promo.yoy, elapsedDays, channelCount),
  };
}

// 외부유입 판정 — 기존 Code.gs 산식(외부유입 = 외부유입_전체+URL직접입력+기타)과
// 동일한 기준. "외부유입_" 접두어를 가진 채널(소계 포함)과 URL직접입력/기타를
// 외부로 본다. 그 외 전부(홈/검색결과/프로모션페이지/기타 내부 진입 지점)는 내부.
function isExternalChannel_(name) {
  return name.startsWith("외부유입_") || name === "URL직접입력" || name === "기타";
}

// 특정 채널 인덱스 하나만 놓고 203개 카탈로그 상품 중 그 채널 값 변화(diff)가
// 가장 큰 상품을 찾는다 — "이 채널 변화에 가장 크게 기여한 상품"을 보여주기 위함
// (KY 요구사항: 전체 PV → 내부/외부 → 세부 채널 → 주요 상품 순으로 상세화).
function topProductForChannelIndex_(catalog, mainSkus, promo, periodMode, dayIndex, elapsedDays, channelIdx, channelCount) {
  let best = null;
  Object.keys(catalog).forEach((code) => {
    const rows = rowifyInflowProduct(catalog[code]);
    const ch = periodChannels(rows, promo, periodMode, dayIndex, elapsedDays, channelCount);
    const cur = ch.cur ? ch.cur[channelIdx] : null;
    const prev = ch.prev ? ch.prev[channelIdx] : null;
    if (!hasVal(cur) || !hasVal(prev)) return;
    const diff = cur - prev;
    if (diff === 0) return;
    if (!best || Math.abs(diff) > Math.abs(best.diff)) {
      best = { code, cur, prev, diff, pct: pctDelta(cur, prev), tooltip: productTooltipFor(code, catalog, mainSkus) };
    }
  });
  return best;
}
function metricDiff(cur, prev, yoy, isPP) {
  const c = hasVal(cur) ? cur : null;
  const p = hasVal(prev) ? prev : null;
  const y = hasVal(yoy) ? yoy : null;
  return {
    cur: c, prev: p, yoy: y,
    prevPct: hasVal(c) && hasVal(p) ? (isPP ? ppDelta(c, p) : pctDelta(c, p)) : null,
    yoyPct: hasVal(c) && hasVal(y) ? (isPP ? ppDelta(c, y) : pctDelta(c, y)) : null,
    isPP: !!isPP,
  };
}

// ---------------------------------------------------------------
// 상황기록 매칭
// "프로모션 년/월" 실제 값은 "26년"(연도만) 형태 외에 "2609"처럼 4자리 YYMM
// 코드(뒤 2자리가 1~12월)로도 들어온다(실측 확인됨) — 이를 그냥 숫자로만
// 파싱하면 "2609"를 연도 2609로 잘못 읽어 전부 매칭 실패한다. 뒤 2자리가
// 유효한 월(1~12)이면 YYMM으로, 아니면 순수 연도로 해석한다.
// ---------------------------------------------------------------
function parseYearMonthCode_(s) {
  if (!s) return { year: null, month: null };
  const raw = String(s).trim();
  const yearWithSuffix = raw.match(/^(\d{2,4})\s*년/); // "26년", "2026년"
  if (yearWithSuffix) {
    let y = parseInt(yearWithSuffix[1], 10);
    if (y < 100) y += 2000;
    return { year: y, month: null };
  }
  const ymSep = raw.match(/^(\d{4})[-./](\d{1,2})$/); // "2026-09", "2026.9" 등
  if (ymSep) return { year: parseInt(ymSep[1], 10), month: parseInt(ymSep[2], 10) };
  const fourDigits = raw.match(/^(\d{4})$/); // "2609"(YYMM) vs "2026"(연도만)
  if (fourDigits) {
    const yy = parseInt(fourDigits[1].slice(0, 2), 10);
    const mm = parseInt(fourDigits[1].slice(2, 4), 10);
    if (mm >= 1 && mm <= 12) return { year: 2000 + yy, month: mm };
    return { year: parseInt(fourDigits[1], 10), month: null };
  }
  const m = raw.match(/(\d{2,4})/);
  if (!m) return { year: null, month: null };
  let y = parseInt(m[1], 10);
  if (y < 100) y += 2000;
  return { year: y, month: null };
}
function eventMatchesPromo(item, promo) {
  const { year, month } = parseYearMonthCode_(item.yearMonth);
  const nameOk = !item.promoName || item.promoName === promo.name;
  const yearOk = year === null || year === promo.year;
  const monthOk = month === null || month === promo.month;
  return nameOk && yearOk && monthOk;
}
function eventOverlapsRange(item, range) {
  if (!range) return false;
  const end = item.endDate || item.date;
  return item.date <= range.end && end >= range.start;
}

// 상황(item)이 실제로 발생한 날짜 범위([date, endDate||date])를, 금번/직전/전년
// 각각의 시작일 기준 "동일 경과일"로 그대로 옮겨 계산한다. 예: 상황이 금번
// 시작일+2일째부터 하루짜리라면, 직전/전년도 각자의 시작일+2일째 하루를 본다.
// 보고서 전체가 누계/일별 어느 모드든 상관없이 "그 상황이 실제로 일어난 날"의
// 실적만 비교한다(KY 요구사항: 전체 기간 평균이 아니라 발생일 기준).
function eventDayRange(periodStart, startOffsetDays, spanDays) {
  const start = toDateStr(addDays(parseDate(periodStart), startOffsetDays));
  const end = toDateStr(addDays(parseDate(periodStart), startOffsetDays + spanDays - 1));
  return { start, end };
}

// 두 날짜범위의 교집합. 겹치지 않으면 null.
function intersectRange_(a, b) {
  if (!a || !b) return null;
  const start = a.start > b.start ? a.start : b.start;
  const end = a.end < b.end ? a.end : b.end;
  if (start > end) return null;
  return { start, end };
}

// 상황기록 1건에 "그 상황이 발생한 날짜의 실제 실적 변화"를 붙인다.
// 인과관계는 절대 단정하지 않고, "같은 시기에 이런 값이었다"는 사실만 담는다.
function enrichEvent(item, ctx) {
  const { catalog, mainSkus, data, promo, CHANNELS, reportRange } = ctx;
  let related = null;
  let targetTooltip = null;

  // 상황의 실제 날짜범위를 "이번 보고에서 실제로 조회 중인 기간"과 교집합으로
  // 자른다 — 예: 0.5일차(08-28 하루만 조회)인데 상황기록이 08-28~08-29에
  // 걸쳐 있으면 08-28만 반영하고 08-29 실적은 절대 섞지 않는다(KY 요구사항).
  const eventRawRange = { start: item.date, end: item.endDate || item.date };
  const effectiveRange = intersectRange_(eventRawRange, reportRange);
  if (!effectiveRange) {
    return Object.assign({}, item, { related: null, targetTooltip: item.targetType === "상품" && item.target ? productTooltipFor(item.target, catalog, mainSkus) : null });
  }
  const startOffsetDays = daysBetween(promo.current.start, effectiveRange.start) - 1;
  const spanDays = daysBetween(effectiveRange.start, effectiveRange.end);
  const curRange = effectiveRange;
  const prevRange = isValidPeriod(promo.previous) ? eventDayRange(promo.previous.start, startOffsetDays, spanDays) : null;

  if (item.targetType === "상품" && item.target) {
    const code = item.target;
    targetTooltip = productTooltipFor(code, catalog, mainSkus);
    if (mainSkus.some((s) => s.code === code) && data.skuDaily[code]) {
      const cur = aggregateRangeOrNull(data.skuDaily[code], curRange);
      const prev = prevRange ? aggregateRangeOrNull(data.skuDaily[code], prevRange) : null;
      const d = metricDiff(cur && cur.sales, prev && prev.sales, null);
      if (hasVal(d.cur)) related = { label: "매출", cur: d.cur, prevPct: d.prevPct, fmt: fmtYen };
    }
    if (!related && catalog[code]) {
      const rows = rowifyInflowProduct(catalog[code]);
      const cur = aggregateRangeOrNull(rows, curRange);
      const prev = prevRange ? aggregateRangeOrNull(rows, prevRange) : null;
      const d = metricDiff(cur && cur.totalInflow, prev && prev.totalInflow, null);
      if (hasVal(d.cur)) related = { label: "PV", cur: d.cur, prevPct: d.prevPct, fmt: fmtNum };
    }
  } else if (item.targetType === "채널" && item.target) {
    const idx = CHANNELS.findIndex((c) => c === item.target || c.includes(item.target));
    if (idx >= 0) {
      const curCh = sumChannelsForRange_(data.shopDaily, curRange.start, curRange.end, CHANNELS.length);
      const prevCh = prevRange ? sumChannelsForRange_(data.shopDaily, prevRange.start, prevRange.end, CHANNELS.length) : null;
      const d = metricDiff(curCh && curCh[idx], prevCh && prevCh[idx], null);
      if (hasVal(d.cur)) related = { label: `"${CHANNELS[idx]}" PV`, cur: d.cur, prevPct: d.prevPct, fmt: fmtNum };
    }
  } else {
    // 숍전체(또는 대상 구분 미기재) — 발생일 기준 숍 전체 매출을 참고 지표로 연결
    const cur = aggregateRangeOrNull(data.shopDaily, curRange);
    const prev = prevRange ? aggregateRangeOrNull(data.shopDaily, prevRange) : null;
    const d = metricDiff(cur && cur.sales, prev && prev.sales, null);
    if (hasVal(d.cur)) related = { label: "숍 전체 매출", cur: d.cur, prevPct: d.prevPct, fmt: fmtYen };
  }

  return Object.assign({}, item, { related, targetTooltip });
}
function sumChannelsForRange_(rows, startStr, endStr, channelCount) {
  const matched = rows.filter((r) => r.date >= startStr && r.date <= endStr);
  if (matched.length === 0) return null;
  const totals = new Array(channelCount).fill(0);
  matched.forEach((r) => { if (r.channels) for (let i = 0; i < channelCount; i++) totals[i] += r.channels[i] || 0; });
  return totals;
}

// ---------------------------------------------------------------
// 메인: 팩트 계산
// ---------------------------------------------------------------
export function computeReportFacts(data, promoId, periodMode, dayIndex) {
  const promo = data.promotions.find((p) => p.id === promoId);
  if (!promo) return null;

  const elapsedDays = computeElapsedDayCount(data.shopDaily, promo);
  const CHANNELS = data.meta.inflowChannels || [];
  const catalog = data.inflowCatalog || {};
  const mainSkus = resolveMainSkus(data, promo.id);

  const shop = periodSeries(data.shopDaily, promo, periodMode, dayIndex, elapsedDays);
  const overall = {
    sales: metricDiff(shop.cur && shop.cur.sales, shop.prev && shop.prev.sales, shop.yoy && shop.yoy.sales),
    qty: metricDiff(shop.cur && shop.cur.qty, shop.prev && shop.prev.qty, shop.yoy && shop.yoy.qty),
    orders: metricDiff(shop.cur && shop.cur.orders, shop.prev && shop.prev.orders, shop.yoy && shop.yoy.orders),
    pv: metricDiff(shop.cur && shop.cur.totalInflow, shop.prev && shop.prev.totalInflow, shop.yoy && shop.yoy.totalInflow),
    uv: metricDiff(shop.cur && shop.cur.uv, shop.prev && shop.prev.uv, shop.yoy && shop.yoy.uv),
    cvr: metricDiff(shop.cur && shop.cur.cvr, shop.prev && shop.prev.cvr, shop.yoy && shop.yoy.cvr, true),
    internalInflow: metricDiff(shop.cur && shop.cur.internalInflow, shop.prev && shop.prev.internalInflow, shop.yoy && shop.yoy.internalInflow),
    externalInflow: metricDiff(shop.cur && shop.cur.externalInflow, shop.prev && shop.prev.externalInflow, shop.yoy && shop.yoy.externalInflow),
    newCustomers: metricDiff(shop.cur && shop.cur.newCustomers, shop.prev && shop.prev.newCustomers, shop.yoy && shop.yoy.newCustomers),
    existingCustomers: metricDiff(shop.cur && shop.cur.existingCustomers, shop.prev && shop.prev.existingCustomers, shop.yoy && shop.yoy.existingCustomers),
    newRatio: metricDiff(shop.cur && shop.cur.newRatio, shop.prev && shop.prev.newRatio, shop.yoy && shop.yoy.newRatio, true),
    existingRatio: metricDiff(shop.cur && shop.cur.existingRatio, shop.prev && shop.prev.existingRatio, shop.yoy && shop.yoy.existingRatio, true),
  };

  // ---- 유입 채널 51개 증감 ----
  const shopCh = periodChannels(data.shopDaily, promo, periodMode, dayIndex, elapsedDays, CHANNELS.length);
  const channelRows = CHANNELS.map((name, i) => {
    const cur = shopCh.cur ? shopCh.cur[i] : null;
    const prev = shopCh.prev ? shopCh.prev[i] : null;
    const yoy = shopCh.yoy ? shopCh.yoy[i] : null;
    const diff = hasVal(cur) && hasVal(prev) ? cur - prev : null;
    const pct = hasVal(cur) && hasVal(prev) ? pctDelta(cur, prev) : null;
    return { channel: name, cur, prev, yoy, diff, pct };
  });
  const validCh = channelRows.filter((r) => hasVal(r.diff));
  const topIncreaseChannels = validCh.filter((r) => r.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, 5);
  const topDecreaseChannels = validCh.filter((r) => r.diff < 0).sort((a, b) => a.diff - b.diff).slice(0, 5);

  // 내부/외부유입 각각의 "세부 채널" 최대 증가/감소 — 전체 → 내부/외부 → 세부채널
  // 순으로 상세화하기 위함(KY 요구사항). "_전체"로 끝나는 소계 채널은 하위
  // 채널을 이미 포함하므로 "세부 채널" 후보에서 제외한다(그렇지 않으면 소계
  // 자신이 항상 1위가 되어 정보량이 없다).
  const leafCh = validCh.filter((r) => !r.channel.endsWith("_전체"));
  const internalLeafCh = leafCh.filter((r) => !isExternalChannel_(r.channel));
  const externalLeafCh = leafCh.filter((r) => isExternalChannel_(r.channel));
  const internalTopIncreaseChannel = internalLeafCh.filter((r) => r.diff > 0).sort((a, b) => b.diff - a.diff)[0] || null;
  const internalTopDecreaseChannel = internalLeafCh.filter((r) => r.diff < 0).sort((a, b) => a.diff - b.diff)[0] || null;
  const externalTopIncreaseChannel = externalLeafCh.filter((r) => r.diff > 0).sort((a, b) => b.diff - a.diff)[0] || null;
  const externalTopDecreaseChannel = externalLeafCh.filter((r) => r.diff < 0).sort((a, b) => a.diff - b.diff)[0] || null;

  // 내부/외부 각각 "실제 유입 방향과 같은 쪽"의 세부 채널을 대표로 선정하고,
  // 그 채널의 변화에 가장 크게 기여한 상품까지 연결한다(전체→내부/외부→
  // 세부채널→상품 구조, KY 요구사항).
  const internalDown = hasVal(overall.internalInflow.prevPct) && overall.internalInflow.prevPct < 0;
  const internalNotableChannel = internalDown ? (internalTopDecreaseChannel || internalTopIncreaseChannel) : (internalTopIncreaseChannel || internalTopDecreaseChannel);
  const externalDown = hasVal(overall.externalInflow.prevPct) && overall.externalInflow.prevPct < 0;
  const externalNotableChannel = externalDown ? (externalTopDecreaseChannel || externalTopIncreaseChannel) : (externalTopIncreaseChannel || externalTopDecreaseChannel);

  function attachTopProduct(channelRow) {
    if (!channelRow) return channelRow;
    const idx = CHANNELS.indexOf(channelRow.channel);
    let topProduct = idx >= 0 ? topProductForChannelIndex_(catalog, mainSkus, promo, periodMode, dayIndex, elapsedDays, idx, CHANNELS.length) : null;
    // 이 채널 diff를 분모로 한 상품 기여도 — "해당 채널 증감분의 N%" 표현용.
    if (topProduct && channelRow.diff) {
      topProduct = Object.assign({}, topProduct, { channelContributionPct: (topProduct.diff / channelRow.diff) * 100 });
    }
    return Object.assign({}, channelRow, { topProduct });
  }
  const internalNotableChannelWithProduct = attachTopProduct(internalNotableChannel);
  const externalNotableChannelWithProduct = attachTopProduct(externalNotableChannel);

  const inflow = {
    total: overall.pv,
    internal: overall.internalInflow,
    external: overall.externalInflow,
    channels: channelRows,
    topIncreaseChannels,
    topDecreaseChannels,
    internalNotableChannel: internalNotableChannelWithProduct,
    externalNotableChannel: externalNotableChannelWithProduct,
  };

  // ---- 상품: PV는 203개 카탈로그 전체, 매출/판매수량/주문은 메인 9SKU만 ----
  // (data.skuDaily가 메인 SKU로만 구성되어 있어 실제 데이터 구조상 매출 비교는
  // 9개 상품까지만 가능하다 — 임의로 확장하지 않음)
  // contributionPct: 이 상품의 diff가 전체(숍) 동일 지표 diff에서 차지하는 비중
  // — "이 상품이 전체 변화의 몇 %를 차지했는가"를 문안에서 그대로 쓸 수 있도록
  // 미리 계산해둔다(AI/규칙기반 생성기가 나눗셈을 하지 않도록).
  const overallSalesDiff = hasVal(overall.sales.cur) && hasVal(overall.sales.prev) ? overall.sales.cur - overall.sales.prev : null;
  const overallPvDiff = hasVal(overall.pv.cur) && hasVal(overall.pv.prev) ? overall.pv.cur - overall.pv.prev : null;

  const catalogCodes = Object.keys(catalog);
  const pvRows = catalogCodes.map((code) => {
    const rows = rowifyInflowProduct(catalog[code]);
    const s = periodSeries(rows, promo, periodMode, dayIndex, elapsedDays);
    const cur = s.cur ? s.cur.totalInflow : null;
    const prev = s.prev ? s.prev.totalInflow : null;
    const diff = hasVal(cur) && hasVal(prev) ? cur - prev : null;
    return {
      code, cur, prev, diff,
      pct: hasVal(cur) && hasVal(prev) ? pctDelta(cur, prev) : null,
      contributionPct: (diff !== null && overallPvDiff) ? (diff / overallPvDiff) * 100 : null,
      tooltip: productTooltipFor(code, catalog, mainSkus),
    };
  }).filter((r) => hasVal(r.diff));
  const topPvIncrease = pvRows.filter((r) => r.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, 5);
  const topPvDecrease = pvRows.filter((r) => r.diff < 0).sort((a, b) => a.diff - b.diff).slice(0, 5);
  const pvByCode = {};
  pvRows.forEach((r) => { pvByCode[r.code] = r; });

  const salesRows = mainSkus.map((sku) => {
    const arr = data.skuDaily[sku.code];
    if (!arr) return null;
    const s = periodSeries(arr, promo, periodMode, dayIndex, elapsedDays);
    const cur = s.cur ? s.cur.sales : null;
    const prev = s.prev ? s.prev.sales : null;
    const qtyCur = s.cur ? s.cur.qty : null;
    const qtyPrev = s.prev ? s.prev.qty : null;
    const ordCur = s.cur ? s.cur.orders : null;
    const diff = hasVal(cur) && hasVal(prev) ? cur - prev : null;
    // 같은 상품의 PV 변화도 함께 붙인다 — "매출과 PV가 같은 방향인지 반대
    // 방향인지"를 문안에서 바로 쓸 수 있게(KY 요구사항). pvByCode는 이미
    // 위에서 카탈로그 203개 전체에 대해 계산해둔 값을 그대로 재사용한다.
    const pvEntry = pvByCode[sku.code] || null;
    return {
      code: sku.code, cur, prev, diff,
      pct: hasVal(cur) && hasVal(prev) ? pctDelta(cur, prev) : null,
      contributionPct: (diff !== null && overallSalesDiff) ? (diff / overallSalesDiff) * 100 : null,
      qtyCur, qtyPrev, ordCur,
      tooltip: sku.name,
      pvDiff: pvEntry ? pvEntry.diff : null,
      pvPct: pvEntry ? pvEntry.pct : null,
    };
  }).filter((r) => r && hasVal(r.diff));
  const topSalesIncrease = salesRows.filter((r) => r.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, 5);
  const topSalesDecrease = salesRows.filter((r) => r.diff < 0).sort((a, b) => a.diff - b.diff).slice(0, 5);
  const topSalesShare = salesRows
    .filter((r) => hasVal(r.cur) && hasVal(overall.sales.cur) && overall.sales.cur > 0)
    .map((r) => Object.assign({}, r, { share: (r.cur / overall.sales.cur) * 100 }))
    .sort((a, b) => b.share - a.share)
    .slice(0, 5);

  const products = {
    topPvIncrease, topPvDecrease,
    topSalesIncrease, topSalesDecrease,
    topSalesShare,
    overallSalesDiff, overallPvDiff,
  };

  // ---- 상황기록: 이번(금번) 분석 기간과 겹치는 것만 자동 필터링 ----
  // (직전/전년 기간의 상황기록은 매칭하지 않는다 — KY 예시가 항상 "금번" 기준
  // 조회만 요구했고, 대상 프로모션이 다르면 무의미하기 때문)
  const curRange = resolvePeriodRange(promo.current, periodMode, dayIndex, elapsedDays);
  const prevRange = resolvePeriodRange(promo.previous, periodMode, dayIndex, elapsedDays);
  const yoyRange = resolvePeriodRange(promo.yoy, periodMode, dayIndex, elapsedDays);
  const situationLog = data.situationLog || { confirmed: false, items: [] };
  const rawEvents = (situationLog.items || [])
    .filter((it) => eventMatchesPromo(it, promo) && eventOverlapsRange(it, curRange))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const ctx = { catalog, mainSkus, data, promo, periodMode, dayIndex, elapsedDays, CHANNELS, overall, reportRange: curRange };
  const events = rawEvents.map((it) => enrichEvent(it, ctx));

  return {
    promo: { id: promo.id, year: promo.year, month: promo.month, name: promo.name, isHalfDayFirst: !!promo.isHalfDayFirst },
    periodMode,
    dayIndex,
    elapsedDays,
    periods: {
      current: Object.assign({ valid: isValidPeriod(promo.current) }, promo.current),
      previous: Object.assign({ valid: isValidPeriod(promo.previous) }, promo.previous),
      yoy: Object.assign({ valid: isValidPeriod(promo.yoy) }, promo.yoy),
    },
    analysisRange: curRange,
    ranges: { current: curRange, previous: prevRange, yoy: yoyRange },
    overall,
    inflow,
    products,
    events,
    situationLogConfirmed: !!situationLog.confirmed,
  };
}

// ---------------------------------------------------------------
// 규칙기반 분석 문장 빌더 — 한 문단 안에서 여러 지표를 같이 다루되, 지표 간
// 인과관계("A 때문에 B", "A가 B를 상쇄/견인")는 절대 단정하지 않는다. 각
// 지표의 실제 변화를 사실대로 병기하고, 방향이 같은지/다른지 같은 "구조적
// 사실"만 서술한다. AI 프롬프트(buildAIPromptPayload)도 동일한 원칙을 따른다.
// ---------------------------------------------------------------
function dir_(pct) { return pct >= 0 ? "증가" : "감소"; }

// 전체 실적 흐름: 매출/PV/전환효율(CVR)/판매수량을 각각 사실대로 나열하되
// 하나의 문단으로 자연스럽게 엮는다. PV와 CVR을 "상쇄/견인" 같은 인과관계로
// 묶어 서술하지 않는다 — 두 지표가 함께 계산에 들어가는 것은 사실이지만,
// 실제 데이터만으로는 한쪽이 다른 쪽에 영향을 줬는지 확인할 수 없기 때문이다.
function buildSalesFlowSentence(facts) {
  const o = facts.overall;
  if (!hasVal(o.sales.cur) || o.sales.prevPct === null) return "매출 비교 데이터가 아직 없습니다.";
  let s = `매출은 직전 대비 ${pctLabel(o.sales.prevPct)} ${dir_(o.sales.prevPct)}한 ${fmtYen(o.sales.cur)}를 기록했습니다.`;
  if (hasVal(o.pv.prevPct)) {
    s += ` 같은 기간 전체 PV는 직전 대비 ${pctLabel(o.pv.prevPct)} ${dir_(o.pv.prevPct)}했습니다.`;
  }
  if (hasVal(o.cvr.prevPct)) {
    s += ` 전환 효율(CVR)은 ${o.cvr.cur.toFixed(1)}%로 직전 대비 ${ppLabel(o.cvr.prevPct)} ${dir_(o.cvr.prevPct)}했습니다.`;
  }
  if (hasVal(o.qty.prevPct)) {
    s += ` 판매수량은 ${pctLabel(o.qty.prevPct)} ${dir_(o.qty.prevPct)}했습니다.`;
  }
  return s;
}

// 고객 구성 변화 — 변화폭이 유의미할 때만 언급(사소한 등락까지 매번 언급하지 않음).
function buildCustomerMixSentence(facts) {
  const o = facts.overall;
  if (!hasVal(o.newRatio.cur) || o.newRatio.prevPct === null) return null;
  if (Math.abs(o.newRatio.prevPct) < 1) return null;
  return `신규 고객 비중은 ${o.newRatio.cur.toFixed(0)}%로 직전 대비 ${ppLabel(o.newRatio.prevPct)} ${dir_(o.newRatio.prevPct)}해 고객 구성에도 변화가 있었습니다.`;
}

// 유입 구조: 내부/외부유입 각각의 실제 변화를 사실대로 병기하고, 두 값이
// 반대 방향인지/같은 방향인지는 "구조"로만 설명한다("상쇄/견인" 등 인과관계로
// 단정하는 표현은 쓰지 않음). 절대값 비교("변화폭이 더 컸다")는 단순 크기
// 비교 사실이며 인과관계 주장이 아니다.
function buildInflowStructureSentence(facts) {
  const o = facts.overall;
  if (!hasVal(o.pv.cur) || o.pv.prevPct === null) return "전체 PV 비교 데이터가 아직 없습니다.";
  let s = `전체 PV는 직전 대비 ${pctLabel(o.pv.prevPct)} ${dir_(o.pv.prevPct)}했습니다.`;
  if (hasVal(o.internalInflow.cur) && hasVal(o.internalInflow.prev) && hasVal(o.externalInflow.cur) && hasVal(o.externalInflow.prev)) {
    const intDiff = o.internalInflow.cur - o.internalInflow.prev;
    const extDiff = o.externalInflow.cur - o.externalInflow.prev;
    const intUp = intDiff >= 0, extUp = extDiff >= 0;
    if (intUp !== extUp) {
      const biggerSide = Math.abs(intDiff) >= Math.abs(extDiff) ? "내부유입" : "외부유입";
      s += ` 내부유입은 ${pctLabel(o.internalInflow.prevPct)}, 외부유입은 ${pctLabel(o.externalInflow.prevPct)}로 서로 반대 방향으로 변화했으며, 절대값 기준으로는 ${biggerSide}의 변화 폭이 더 컸습니다.`;
    } else {
      s += ` 내부유입은 ${pctLabel(o.internalInflow.prevPct)}, 외부유입은 ${pctLabel(o.externalInflow.prevPct)}로 두 채널 모두 ${intUp ? "증가" : "감소"}했습니다.`;
    }
  }
  const notable = o.pv.prevPct < 0 ? facts.inflow.topDecreaseChannels[0] : facts.inflow.topIncreaseChannels[0];
  if (notable) {
    s += ` 세부 채널 중에서는 "${notable.channel}"${josaIGa_(notable.channel)} ${fmtNum(notable.diff)}PV로 가장 큰 ${notable.diff >= 0 ? "증가" : "감소"}폭을 나타냈습니다.`;
  }
  return s;
}

function productLabel_(entry) {
  return `${entry.code}(${entry.tooltip})`;
}

// "전체 OO분의 N%" 문구는 (1) 상품의 변화 방향이 전체 지표의 변화 방향과 같고,
// (2) 그 비율이 0~100% 범위일 때만 의미가 있다. 다른 상품들이 반대로 움직여
// 순변화를 줄인 경우 같은 방향이어도 비율이 100%를 넘을 수 있으므로(예: 전체
// -10인데 이 상품 혼자 -50이면 500%) 그 경우는 숫자를 버리고 "기여" 정도로만
// 표현한다. 방향이 반대면(예: 전체는 감소인데 이 상품은 증가) "전체 감소폭을
// 일부 상쇄"로 표현한다. (KY 요구사항 — 100% 초과·방향 불일치 contribution 금지)
export function directionalContributionClause_(entryDiff, contributionPct, overallDiff, unitLabel) {
  if (!hasVal(overallDiff) || overallDiff === 0) return "";
  const sameDir = (entryDiff >= 0) === (overallDiff >= 0);
  const overallDirWord = dir_(overallDiff);
  if (sameDir) {
    if (hasVal(contributionPct) && contributionPct > 0 && contributionPct <= 100) {
      return `, 전체 ${unitLabel} ${overallDirWord}분의 약 ${contributionPct.toFixed(0)}%를 차지`;
    }
    return `, 전체 ${unitLabel} ${overallDirWord}에 기여`;
  }
  return `, 전체 ${unitLabel} ${overallDirWord}폭을 일부 상쇄`;
}

// 상품 분석: 전체 매출 방향과 같은 방향의 최대 기여 상품을 주인공으로 삼고,
// 반대 방향 상품/PV 최대 변화 상품을 보조로 덧붙여 "전체 흐름과의 관계"를 설명.
function buildProductSentence(facts) {
  const o = facts.overall;
  const salesOverallDown = hasVal(o.sales.prevPct) ? o.sales.prevPct < 0 : null;
  const primary = salesOverallDown === true ? (facts.products.topSalesDecrease[0] || facts.products.topSalesIncrease[0])
    : salesOverallDown === false ? (facts.products.topSalesIncrease[0] || facts.products.topSalesDecrease[0])
    : (facts.products.topSalesDecrease[0] || facts.products.topSalesIncrease[0]);
  // 보조 상품은 "주인공과 반대 방향으로 움직인 상품"을 우선 찾는다(진짜 대조가
  // 있을 때만 "반면"을 쓰기 위함) — 없으면 같은 방향의 다음 순위 상품으로 대체.
  const oppositeList = primary && primary.diff >= 0 ? facts.products.topSalesDecrease : facts.products.topSalesIncrease;
  const sameList = primary && primary.diff >= 0 ? facts.products.topSalesIncrease : facts.products.topSalesDecrease;
  const secondary = (oppositeList || []).find((r) => !primary || r.code !== primary.code)
    || (sameList || []).find((r) => !primary || r.code !== primary.code);
  const secondaryIsOpposite = secondary && primary && (secondary.diff >= 0) !== (primary.diff >= 0);

  const parts = [];
  if (primary) {
    const dirWord = dir_(primary.diff);
    let s = `상품별로는 ${productLabel_(primary)}${josaIGa_(primary.tooltip)} 매출 ${fmtYen(Math.abs(primary.diff))} ${dirWord}(${pctLabel(primary.pct)})하며`;
    s += hasVal(primary.contributionPct)
      ? ` 전체 매출 ${dirWord}분의 약 ${Math.abs(primary.contributionPct).toFixed(0)}%에 해당해 가장 큰 비중을 차지했습니다.`
      : ` 상품별 매출 변화 중 가장 두드러졌습니다.`;
    parts.push(s);
  }
  if (secondary) {
    const connector = secondaryIsOpposite ? "반면" : "이어서";
    parts.push(`${connector} ${productLabel_(secondary)}${josaEunNeun_(secondary.tooltip)} 매출이 ${pctLabel(secondary.pct)} ${dir_(secondary.diff)}했습니다.`);
  }
  const pvTop = hasVal(o.pv.prevPct) && o.pv.prevPct < 0 ? facts.products.topPvDecrease[0] : facts.products.topPvIncrease[0];
  if (pvTop && (!primary || pvTop.code !== primary.code)) {
    parts.push(`PV 기준으로는 ${productLabel_(pvTop)}${josaIGa_(pvTop.tooltip)} ${fmtNum(Math.abs(pvTop.diff))} ${dir_(pvTop.diff)}해 가장 큰 변화를 보였습니다.`);
  }
  return parts.join(" ") || "메인 SKU 매출/카탈로그 PV 기준으로 뚜렷한 상품별 변화는 확인되지 않았습니다.";
}

// 상황기록 1건을 짧은 구(clause)로 만든다 — "발생일 + 대상 + 내용 + 그 날의
// 실적 변화(사실)"까지만 담고, 인과관계 문구는 여기서 넣지 않는다(여러 건을
// 자연스러운 문장으로 합칠 때 문장마다 반복되는 것을 피하기 위해 disclaimer는
// buildEventsParagraph에서 마지막에 한 번만 붙인다).
function eventClause_(ev) {
  const targetLabel = ev.targetType === "상품" && ev.target
    ? `${ev.target}(${ev.targetTooltip || ev.target})`
    : (ev.target || (ev.targetType && ev.targetType !== "상품" ? ev.targetType : "") || "");
  const contentLabel = ev.content || ev.type || "";
  let clause = targetLabel ? `${targetLabel}의 "${contentLabel}"` : `"${contentLabel}"`;
  if (ev.note) clause += `(비고: ${ev.note})`;
  if (ev.related && hasVal(ev.related.cur) && ev.related.prevPct !== null) {
    clause += `이 있었고, 해당일 ${ev.related.label}${josaEunNeun_(ev.related.label)} 직전 대비 ${pctLabel(ev.related.prevPct)} ${dir_(ev.related.prevPct)}했습니다`;
  } else {
    clause += "이 있었습니다";
  }
  return clause;
}

// 상황기록 전체를 하나의 자연스러운 문단으로 통합한다. 날짜별로 묶어 문장을
// 만들고, "같은 시기에 나타났다"는 사실과 인과관계 단정 여부는 문단 끝에
// 한 번만 명확히 구분해 밝힌다(건마다 반복하지 않음 — KY 요구사항).
function buildEventsParagraph(facts) {
  if (!facts.situationLogConfirmed) return "상황기록 시트를 아직 확인할 수 없어 자동 조회가 비활성화되어 있습니다.";
  if (facts.events.length === 0) return "확인된 특이사항 없음";

  const byDate = {};
  const order = [];
  facts.events.forEach((ev) => {
    const key = ev.endDate && ev.endDate !== ev.date ? `${ev.date}~${ev.endDate}` : ev.date;
    if (!byDate[key]) { byDate[key] = []; order.push(key); }
    byDate[key].push(ev);
  });

  // 같은 날짜에 여러 건이면 절을 쉼표로 이어붙이지 않고(각 절이 이미 "~했습니다"로
  // 끝나는 완결형이라 쉼표로 이으면 비문이 됨) 문장을 나눠 자연스럽게 반복한다.
  const sentences = order.map((key) => {
    const clauses = byDate[key].map(eventClause_);
    return clauses.map((c) => `${key}에는 ${c}.`).join(" ");
  });
  const hasAnyRelated = facts.events.some((ev) => ev.related && hasVal(ev.related.cur) && ev.related.prevPct !== null);
  const disclaimer = hasAnyRelated
    ? " 위 실적 변화는 상황 발생 시점과 같은 시기에 나타난 사실이며, 상황으로 인한 결과라고 단정할 수는 없습니다."
    : "";
  return sentences.join(" ") + disclaimer;
}

// 종합 — 앞 구획 내용을 그대로 반복하지 않고 2~4문장으로 핵심만 압축하되,
// 모든 문장에 실제 수치(%, %p, ¥, PV)를 반드시 포함한다(KY 요구사항).
// "PV·판매수량 감소로 매출이 감소했다"처럼 인과관계로 단정하지 않고, 매출/PV/
// 판매수량/CVR을 각각의 사실로 병기한다.
function buildClosingSentence(facts) {
  const o = facts.overall;
  if (!hasVal(o.sales.cur) || o.sales.prevPct === null) return "종합적으로 아직 비교 가능한 실적 데이터가 충분하지 않습니다.";
  const salesDiff = o.sales.cur - o.sales.prev;
  const salesDir = dir_(o.sales.prevPct);

  // 1) 매출·PV·판매수량·CVR 병기 — 인과관계 단어 없이 사실을 나열한다.
  const clauses = [`매출은 직전 대비 ${pctLabel(o.sales.prevPct)}(${signedYen_(salesDiff)}) ${salesDir}했으며`];
  if (hasVal(o.pv.prevPct)) clauses.push(`PV는 ${pctLabel(o.pv.prevPct)} ${dir_(o.pv.prevPct)}`);
  if (hasVal(o.qty.prevPct)) clauses.push(`판매수량은 ${pctLabel(o.qty.prevPct)} ${dir_(o.qty.prevPct)}`);
  let sentence1 = clauses.join(", ");
  if (hasVal(o.cvr.prevPct)) {
    const cvrDir = dir_(o.cvr.prevPct);
    const connector = cvrDir === salesDir ? "했고, CVR도" : "한 반면 CVR은";
    sentence1 += `${connector} ${ppLabel(o.cvr.prevPct)} ${cvrDir === "증가" ? "개선" : "하락"}되었습니다.`;
  } else {
    sentence1 += "했습니다.";
  }
  const sentences = [sentence1];

  // 2) 상품 기여 — 방향 불일치/100% 초과 시 자동으로 "상쇄/기여" 표현으로 대체됨.
  const topProduct = pickPrimarySalesProduct_(facts);
  if (topProduct) {
    const shareClause = directionalContributionClause_(topProduct.diff, topProduct.contributionPct, salesDiff, "매출");
    sentences.push(`상품별로는 ${productLabel_(topProduct)}의 매출이 ${pctLabel(topProduct.pct)}(${signedYen_(topProduct.diff)}) ${dir_(topProduct.diff)}해${shareClause}했습니다.`);
  }

  // 3) 유입(내부/외부) + 가장 영향이 컸던 세부 채널 하나.
  if (hasVal(o.internalInflow.prevPct) && hasVal(o.externalInflow.prevPct)) {
    const intDir = dir_(o.internalInflow.prevPct), extDir = dir_(o.externalInflow.prevPct);
    let s3 = `유입에서는 내부유입 ${pctLabel(o.internalInflow.prevPct)}, 외부유입 ${pctLabel(o.externalInflow.prevPct)}로 `;
    s3 += intDir === extDir ? `모두 ${intDir}했` : `서로 다른 방향을 보였`;
    const chCandidates = [facts.inflow.internalNotableChannel, facts.inflow.externalNotableChannel].filter(Boolean);
    const notableCh = chCandidates.length ? chCandidates.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))[0] : null;
    if (notableCh) {
      s3 += `으며, 주요 ${dir_(notableCh.diff)} 채널은 "${notableCh.channel}"(${signedNum_(notableCh.diff)}PV, ${pctLabel(notableCh.pct)})입니다.`;
    } else {
      s3 += "습니다.";
    }
    sentences.push(s3);
  }

  return sentences.join(" ");
}

// ---------------------------------------------------------------
// "종합 문안"(보고용 문안)의 6개 구획 — 매출/전환, 유입, 상품, 고객, 상황기록,
// 종합. 각 구획은 방향(증가/감소)만 말하지 않고 반드시 실제 수치(%, %p, PV,
// 금액, contributionPct)를 포함한다(KY 요구사항). "AI 분석 요약" 영역(짧은
// 연결형 하이라이트 3~5줄)은 기존 buildSalesFlowSentence 등을 그대로 쓴다 —
// 두 영역은 목적이 달라 서로 다른 문장 빌더를 쓴다.
// ---------------------------------------------------------------
export function pickPrimarySalesProduct_(facts) {
  const down = hasVal(facts.overall.sales.prevPct) ? facts.overall.sales.prevPct < 0 : null;
  return down === true ? (facts.products.topSalesDecrease[0] || facts.products.topSalesIncrease[0])
    : down === false ? (facts.products.topSalesIncrease[0] || facts.products.topSalesDecrease[0])
    : (facts.products.topSalesDecrease[0] || facts.products.topSalesIncrease[0]);
}

// 1. 매출/전환
function buildSalesSectionText(facts) {
  const o = facts.overall;
  if (!hasVal(o.sales.cur) || o.sales.prevPct === null) return "- 매출 비교 데이터가 아직 없습니다.";
  const lines = [];
  lines.push(`매출 ${fmtYen(o.sales.cur)} (직전 대비 ${pctLabel(o.sales.prevPct)} ${dir_(o.sales.prevPct)})`);
  if (hasVal(o.qty.prevPct)) lines.push(`판매수량 직전 대비 ${pctLabel(o.qty.prevPct)} ${dir_(o.qty.prevPct)}`);
  if (hasVal(o.cvr.prevPct)) lines.push(`CVR ${o.cvr.cur.toFixed(1)}% (직전 대비 ${ppLabel(o.cvr.prevPct)} ${dir_(o.cvr.prevPct)})`);
  const primary = pickPrimarySalesProduct_(facts);
  if (primary) {
    const shareClause = directionalContributionClause_(primary.diff, primary.contributionPct, facts.products.overallSalesDiff, "매출");
    lines.push(`매출 변화에 가장 크게 기여한 상품: ${productLabel_(primary)} — 매출 ${signedYen_(primary.diff)} (${pctLabel(primary.pct)})${shareClause}`);
  }
  return lines.map((l) => `- ${l}`).join("\n");
}

// 2. 유입 — 전체 PV → 내부/외부 → 세부 채널 → 주요 상품 순으로 상세화.
// 세부 채널의 기여 상품도 "해당 채널 증감분에서 차지하는 비중"까지 계산한다
// (KY 요구사항 — 채널 diff를 분모로 한 topProduct.channelContributionPct 사용).
function buildInflowSectionText(facts) {
  const o = facts.overall;
  if (!hasVal(o.pv.cur) || o.pv.prevPct === null) return "- 전체 PV 비교 데이터가 아직 없습니다.";
  const lines = [];
  lines.push(`전체 PV ${fmtNum(o.pv.cur)} (직전 대비 ${pctLabel(o.pv.prevPct)} ${dir_(o.pv.prevPct)})`);
  if (hasVal(o.internalInflow.prevPct)) lines.push(`내부유입 ${fmtNum(o.internalInflow.cur)} (직전 대비 ${pctLabel(o.internalInflow.prevPct)} ${dir_(o.internalInflow.prevPct)})`);
  if (hasVal(o.externalInflow.prevPct)) lines.push(`외부유입 ${fmtNum(o.externalInflow.cur)} (직전 대비 ${pctLabel(o.externalInflow.prevPct)} ${dir_(o.externalInflow.prevPct)})`);

  function channelLine(label, ch) {
    if (!ch) return null;
    let s = `${label} 세부 채널: "${ch.channel}" ${signedNum_(ch.diff)}PV (${pctLabel(ch.pct)})`;
    if (ch.topProduct) {
      const shareClause = directionalContributionClause_(ch.topProduct.diff, ch.topProduct.channelContributionPct, ch.diff, "채널");
      s += ` — 기여 상품: ${productLabel_(ch.topProduct)} ${signedNum_(ch.topProduct.diff)}PV (${pctLabel(ch.topProduct.pct)})${shareClause}`;
    }
    return s;
  }
  const intLine = channelLine("내부유입", facts.inflow.internalNotableChannel);
  const extLine = channelLine("외부유입", facts.inflow.externalNotableChannel);
  if (intLine) lines.push(intLine);
  if (extLine) lines.push(extLine);
  return lines.map((l) => `- ${l}`).join("\n");
}

// 3. 상품 — 매출/PV 기준 각각의 주요 증가·감소 상품 + 같은 상품의 매출/PV 방향 비교.
// 전체 지표와 반대 방향으로 움직인 상품(예: 전체 매출 감소인데 이 상품은 증가)은
// contributionPct를 쓰지 않고 실제 증감액만 표시한다(KY 요구사항).
function buildProductSectionText(facts) {
  const lines = [];
  const incS = facts.products.topSalesIncrease[0];
  const decS = facts.products.topSalesDecrease[0];
  const incP = facts.products.topPvIncrease[0];
  const decP = facts.products.topPvDecrease[0];
  const overallSalesDiff = facts.products.overallSalesDiff;
  const overallPvDiff = facts.products.overallPvDiff;
  if (incS) lines.push(`매출 증가 1위: ${productLabel_(incS)} ${signedYen_(incS.diff)} (${pctLabel(incS.pct)})${directionalContributionClause_(incS.diff, incS.contributionPct, overallSalesDiff, "매출")}`);
  if (decS) lines.push(`매출 감소 1위: ${productLabel_(decS)} ${signedYen_(decS.diff)} (${pctLabel(decS.pct)})${directionalContributionClause_(decS.diff, decS.contributionPct, overallSalesDiff, "매출")}`);
  if (incP) lines.push(`PV 증가 1위: ${productLabel_(incP)} ${signedNum_(incP.diff)}PV (${pctLabel(incP.pct)})${directionalContributionClause_(incP.diff, incP.contributionPct, overallPvDiff, "PV")}`);
  if (decP) lines.push(`PV 감소 1위: ${productLabel_(decP)} ${signedNum_(decP.diff)}PV (${pctLabel(decP.pct)})${directionalContributionClause_(decP.diff, decP.contributionPct, overallPvDiff, "PV")}`);

  const primary = pickPrimarySalesProduct_(facts);
  if (primary && hasVal(primary.pvDiff) && hasVal(primary.pvPct)) {
    const salesDir = dir_(primary.diff), pvDir = dir_(primary.pvDiff);
    lines.push(`${productLabel_(primary)}는 매출 ${pctLabel(primary.pct)} ${salesDir}, PV ${pctLabel(primary.pvPct)} ${pvDir}로 ${salesDir === pvDir ? "같은" : "반대"} 방향을 보였습니다.`);
  }
  if (lines.length === 0) return "- 메인 SKU 매출/카탈로그 PV 기준으로 뚜렷한 상품별 변화는 확인되지 않았습니다.";
  return lines.map((l) => `- ${l}`).join("\n");
}

// 4. 고객 — 신규/기존 고객 수·비중과 직전 대비 변화(%p).
function buildCustomerSectionText(facts) {
  const o = facts.overall;
  const lines = [];
  if (hasVal(o.newCustomers.cur)) {
    let l = `신규 고객 ${fmtNum(o.newCustomers.cur)}명`;
    if (o.newCustomers.prevPct !== null) l += ` (직전 대비 ${pctLabel(o.newCustomers.prevPct)} ${dir_(o.newCustomers.prevPct)})`;
    if (hasVal(o.newRatio.cur)) l += `, 비중 ${o.newRatio.cur.toFixed(0)}%${o.newRatio.prevPct !== null ? `(직전 대비 ${ppLabel(o.newRatio.prevPct)})` : ""}`;
    lines.push(l);
  }
  if (hasVal(o.existingCustomers.cur)) {
    let l = `기존 고객 ${fmtNum(o.existingCustomers.cur)}명`;
    if (o.existingCustomers.prevPct !== null) l += ` (직전 대비 ${pctLabel(o.existingCustomers.prevPct)} ${dir_(o.existingCustomers.prevPct)})`;
    if (hasVal(o.existingRatio.cur)) l += `, 비중 ${o.existingRatio.cur.toFixed(0)}%${o.existingRatio.prevPct !== null ? `(직전 대비 ${ppLabel(o.existingRatio.prevPct)})` : ""}`;
    lines.push(l);
  }
  if (lines.length === 0) return "- 고객 구성 비교 데이터가 아직 없습니다.";
  return lines.map((l) => `- ${l}`).join("\n");
}

export function generateReportNarrative(facts) {
  const periodLabel = facts.periodMode === "daily"
    ? dayIndexLabel(facts.dayIndex, facts.promo.isHalfDayFirst)
    : `${facts.elapsedDays}일차 누계`;

  // "AI 분석 요약"용 짧은 연결형 하이라이트(3~5줄) — 상세 수치 구획과는 별도로,
  // 여러 지표를 한 문장에 엮은 하이라이트만 모은다.
  const salesFlowText = buildSalesFlowSentence(facts);
  const customerMixText = buildCustomerMixSentence(facts);
  const inflowText = buildInflowStructureSentence(facts);
  const productText = buildProductSentence(facts);
  const summaryBullets = [salesFlowText, customerMixText, inflowText, productText]
    .filter(Boolean)
    .filter((s) => s !== "매출 비교 데이터가 아직 없습니다." && s !== "전체 PV 비교 데이터가 아직 없습니다.");
  if (summaryBullets.length === 0) summaryBullets.push("직전 기간과 비교할 수 있는 데이터가 아직 없습니다.");

  // "보고용 문안" — 매출/전환·유입·상품·고객·상황기록·종합 6개 구획으로 구분한다
  // (KY 요구사항: 하나의 긴 문단이 아니라 영역별로 명확히 구분).
  const eventsText = buildEventsParagraph(facts);
  const closingText = buildClosingSentence(facts);
  const headerLine = `[${facts.promo.year}년 ${facts.promo.month}월 ${facts.promo.name}] ${periodLabel} (${facts.ranges.current ? facts.ranges.current.start + "~" + facts.ranges.current.end : facts.periods.current.start}) 보고`;
  const sections = [
    headerLine,
    "■ 매출/전환\n" + buildSalesSectionText(facts),
    "■ 유입\n" + buildInflowSectionText(facts),
    "■ 상품\n" + buildProductSectionText(facts),
    "■ 고객\n" + buildCustomerSectionText(facts),
    "■ 상황기록\n" + eventsText,
    "■ 종합\n" + closingText,
  ];
  const reportText = sections.join("\n\n");

  return {
    periodLabel, summaryBullets,
    inflowText, productText, closingText,
    eventLines: facts.situationLogConfirmed && facts.events.length > 0 ? facts.events.map(eventClause_) : [eventsText],
    reportText,
  };
}

// ---------------------------------------------------------------
// AI(LLM)용 입력 구성 — 원본 data.json 전체가 아니라 이미 계산된 facts만 전달한다.
// 화면 구조상 AI가 실제로 담당하는 부분은 "AI 분석 요약(핵심 변화 3~5줄)"과
// "종합 보고 문안" 두 곳뿐이다(핵심 실적/유입 변화/상품 변화/상황 기록은 항상
// facts를 그대로 표/리스트로 렌더링하는 결정론적 영역) — 파싱이 어긋나지 않도록
// 정확히 두 섹션만, 고정된 구분자로 요청한다.
// ---------------------------------------------------------------
const AI_SUMMARY_MARKER = "[[SUMMARY]]";
const AI_REPORT_MARKER = "[[REPORT]]";

export function buildAIPromptPayload(facts) {
  const systemPrompt = [
    "당신은 이커머스 프로모션 실적을 상급자에게 보고하는 담당자를 돕는 보고서 작성 보조자입니다.",
    "이 보고서의 목적은 지표를 한 줄씩 나열하는 것이 아니라, 매출/판매수량/CVR/PV/내부유입/외부유입/신규·기존 고객 등 여러 지표를 서로 연결해 \"실적 흐름\"을 설명하는 것입니다.",
    "반드시 지켜야 할 규칙:",
    "1) 제공된 JSON 데이터에 없는 숫자나 사건을 절대로 만들어내지 마세요. 모든 수치는 facts에 있는 값만 사용하세요(직접 계산/추정 금지).",
    '2) 지표는 서로 다른 지표로서 각각의 실제 변화를 사실대로 나열하세요. "PV 감소를 CVR 개선이 상쇄했다", "~가 매출을 이끌었다"처럼 한 지표가 다른 지표에 영향을 줬다고 단정하는 표현은 쓰지 마세요 — 데이터만으로는 그 인과관계를 확인할 수 없습니다. CVR은 "전환 효율(CVR)"로 표현하세요. 채널 간 방향 차이(내부/외부유입 등)는 "~는 증가, ~는 감소로 서로 다른 방향"처럼 사실로만 서술하고, 절대값 비교는 "변화 폭이 더 크다"는 크기 비교로만 쓰세요("~가 전체를 견인/상쇄했다" 금지).',
    '3) 상품은 반드시 "{code}({상품명})" 형식으로 코드와 이름을 함께 쓰세요. "상품번호"라는 단어는 쓰지 마세요. contributionPct(또는 채널의 channelContributionPct)는 그 상품의 증감 방향이 분모가 되는 전체(또는 채널) 지표의 증감 방향과 "같을 때만" 쓰세요 — 예를 들어 전체 매출이 감소했는데 이 상품은 증가했다면 "전체 매출 증가분의 N%"라는 표현 자체가 성립하지 않으므로 절대 쓰지 마세요(방향이 반대인데 비중을 계산하면 100%를 넘거나 의미가 뒤집힌 숫자가 나옵니다). 방향이 반대인 경우에는 그 상품의 실제 증감액/증감률만 쓰고, 필요하면 "전체 매출/PV 감소분을 일부 상쇄했다"처럼 표현하세요. 상품별 매출/PV 언급 시 항상 증감률(%)과 실제 증감액(¥ 또는 PV) 둘 다 쓰세요.',
    '4) 상황기록(events)이 있으면 반드시 분석에 포함하되, 반드시 "상황 발생일 + 대상 + 그 발생일(들)의 실제 실적 변화" 단위로 연결하세요(전체 분석 기간 평균과 연결하지 마세요 — facts.events[].related는 이미 발생일 기준으로 계산되어 있습니다). 여러 건이 있으면 날짜별로 묶어 하나의 자연스러운 문장/문단으로 통합하고, 건마다 인과관계 disclaimer를 반복하지 말고 문단 끝에 한 번만 "같은 시기에 나타난 사실이며 인과관계로 단정할 수 없다"고 명확히 밝히세요. events가 비어 있을 때만 "확인된 특이사항 없음"이라고 쓰세요.',
    '5) "증가했다/감소했다"처럼 방향만 말하지 말고 반드시 실제 수치를 함께 쓰세요: 매출·PV·판매수량·유입은 %, CVR·고객비중은 %p, 상품 기여도는 contributionPct(예: "전체 매출 감소분의 약 83%"). %와 %p를 혼동하지 말고, +/- 부호를 일관되게 쓰세요. 특히 종합 문단에서 "가장 큰 영향을 미쳤다"처럼 정성적으로만 쓰지 말고 가능하면 항상 정량 수치를 함께 제시하세요.',
    "6) 간결한 한국어 업무 보고체(합니다/했습니다체)를 쓰고, 과장된 표현이나 이모지를 쓰지 마세요. 실제 상급자에게 그대로 보고할 수 있는 자연스러운 문장으로 쓰세요.",
    "7) 출력은 정확히 아래 형식으로만 작성하세요(다른 텍스트, 머리말, 코드블록을 추가하지 마세요):",
    AI_SUMMARY_MARKER,
    "- (지표를 서로 연결한 분석 문장 3~5줄. 각 줄이 매출/PV/CVR/유입/상품 중 최소 2개 이상을 연결해 설명해야 합니다. 한 지표만 언급하는 줄은 쓰지 마세요.)",
    AI_REPORT_MARKER,
    '(그대로 복사해서 Slack/메일/주간회의 자료에 쓸 수 있는 보고 문안. 하나의 긴 문단으로 쓰지 말고, 아래 6개 구획으로 명확히 구분하세요. 각 구획 제목은 "■ 구획명" 형식으로 쓰고, 구획 사이는 빈 줄로 구분하세요:',
    "■ 매출/전환 — 매출 금액과 직전 대비 증감률(%), 판매수량 증감률(%), CVR과 증감폭(%p), 매출 변화에 가장 크게 기여한 상품(코드+이름, 증감률, contributionPct)",
    "■ 유입 — 전체 PV와 증감률(%), 내부유입/외부유입 각각의 PV와 증감률(%), 내부/외부 각각에서 가장 크게 움직인 세부 채널(실제 PV 증감값·증감률)과 가능하면 그 채널에 가장 크게 기여한 상품까지 연결(전체→내부/외부→세부채널→상품 순). 기여 상품의 비중은 전체가 아니라 그 세부 채널 자체의 증감분(channelContributionPct)을 분모로 쓰고, 방향이 반대면 규칙 3)과 동일하게 비중 표기를 생략하세요.",
    "■ 상품 — 매출 기준 주요 증가/감소 상품, PV 기준 주요 증가/감소 상품(각각 코드+이름, 증감률/증감값, contributionPct), 매출과 PV가 같은 방향인지 반대 방향인지",
    "■ 고객 — 신규/기존 고객 수·비중과 직전 대비 변화(%, %p)",
    "■ 상황기록 — 규칙 4)의 기준대로 날짜별로 통합, 사실과 인과관계 구분",
    "■ 종합 — 위 내용을 그대로 반복하지 말고 핵심 흐름만 2~3문장으로 정리하되, 반드시 주요 수치를 포함하세요.",
  ].join("\n");
  const userPrompt = "다음은 구조화된 프로모션 실적 데이터입니다(JSON). 이 데이터에 있는 값만 근거로 보고 문안을 작성하세요:\n\n" + JSON.stringify(facts);
  return { systemPrompt, userPrompt };
}

// buildAIPromptPayload가 요청한 두 섹션 형식을 파싱한다. 형식이 어긋나면(모델이
// 마커를 지키지 않은 경우) null을 반환해 호출부가 규칙기반 폴백을 쓰도록 한다.
export function parseAIReportResponse(text) {
  if (!text || text.indexOf(AI_SUMMARY_MARKER) === -1 || text.indexOf(AI_REPORT_MARKER) === -1) return null;
  const afterSummary = text.slice(text.indexOf(AI_SUMMARY_MARKER) + AI_SUMMARY_MARKER.length);
  const summaryPart = afterSummary.slice(0, afterSummary.indexOf(AI_REPORT_MARKER)).trim();
  const reportPart = text.slice(text.indexOf(AI_REPORT_MARKER) + AI_REPORT_MARKER.length).trim();
  const summaryBullets = summaryPart
    .split("\n")
    .map((l) => l.replace(/^[-•\s]+/, "").trim())
    .filter(Boolean);
  if (summaryBullets.length === 0 || !reportPart) return null;
  return { summaryBullets, reportText: reportPart };
}
