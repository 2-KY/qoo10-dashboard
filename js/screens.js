/**
 * screens.js — 6개 화면의 렌더링 로직
 * 모든 함수는 (data, ...params)를 받아 이미 index.html에 존재하는 DOM에
 * 결과를 채워 넣습니다. 화면별 내부 상호작용(탭/필/추가상품 등)은 모듈
 * 스코프의 지역 상태로 관리합니다.
 */
import {
  fmtYen, fmtNum, fmtPct, pctDelta, ppDelta, deltaChipHTML, deltaInlineHTML,
  aggregateRange, aggregateMonth, aggregateYear, aggregateRows,
  rowsForDayOffset, buildPromoDayLabels, resolveMainSkus, sumMainSkuSales,
  isValidPeriod, aggregateRangeOrNull, seriesForOffsetOrNull,
  rowifyInflowProduct, channelSeriesForOffsetOrNull,
} from "./utils.js";
import {
  kpiCardHTML, triCompareBarHTML, renderTabs, renderPills,
  skuBadgeHTML, renderMetricCompareRows, metricRowHTML,
} from "./components.js";

const $ = (id) => document.getElementById(id);

/* ================================================================
   1. 연간 대시보드
   ================================================================ */
export function renderAnnual(data, year) {
  $("annual-kpi-title").textContent = `연간 총합 KPI · ${year}년`;
  const shopYear = aggregateYear(data.shopDaily, year);

  $("annual-kpi").innerHTML = [
    kpiCardHTML({ label: "매출 (GMV)", value: fmtYen(shopYear.sales) }),
    kpiCardHTML({ label: "주문건수", value: fmtNum(shopYear.orders) + "건" }),
    kpiCardHTML({ label: "판매수량", value: fmtNum(shopYear.qty) + "개" }),
    kpiCardHTML({ label: "UV", value: fmtNum(shopYear.uv) }),
    kpiCardHTML({ label: "객단가", value: fmtYen(shopYear.aov) }),
    kpiCardHTML({ label: "신규고객 비중", value: fmtPct(shopYear.newRatio, 0) }),
    kpiCardHTML({ label: "기존고객 비중", value: fmtPct(shopYear.existingRatio, 0) }),
  ].join("");

  // 월별 실적 테이블
  const targets = data.monthlyTargets.filter((t) => t.year === year);
  const monthRows = [];
  for (let m = 1; m <= 12; m++) {
    const agg = aggregateMonth(data.shopDaily, year, m);
    const hasData = agg.orders > 0;
    const target = targets.find((t) => t.month === m);
    const rate = target && hasData ? (agg.sales / target.target) * 100 : null;
    monthRows.push(`<tr>
      <td class="name">${m}월</td>
      <td class="num">${hasData ? fmtYen(agg.sales) : '<span class="tbd">—</span>'}</td>
      <td class="num">${target ? fmtYen(target.target) : '<span class="tbd">—</span>'}</td>
      <td class="num">${rate !== null ? fmtPct(rate, 1) : '<span class="tbd">—</span>'}</td>
      <td class="num">${hasData ? fmtNum(agg.orders) : '<span class="tbd">—</span>'}</td>
      <td class="num">${hasData ? fmtNum(agg.qty) : '<span class="tbd">—</span>'}</td>
      <td class="num">${hasData ? fmtNum(agg.uv) : '<span class="tbd">—</span>'}</td>
      <td class="num">${hasData ? fmtYen(agg.aov) : '<span class="tbd">—</span>'}</td>
      <td class="num">${hasData ? fmtPct(agg.newRatio, 0) : '<span class="tbd">—</span>'}</td>
      <td class="num">${hasData ? fmtPct(agg.existingRatio, 0) : '<span class="tbd">—</span>'}</td>
    </tr>`);
  }
  $("annual-table").querySelector("tbody").innerHTML = monthRows.join("");

  // 메인 SKU 연간 흐름
  // 매출비중 분모 확인: 예전 구현은 "SKU 연간매출 / 숍 전체 연간매출"이었음(shopYear.sales).
  // 이 표는 월 구분 없이 "연간 합계"만 한 행씩 보여주는 구조라, 분모도 그에 맞춰
  // "메인 9SKU 연간 합계 매출"로 바꿈 — 월별 화면(2-1)과 같은 기준(sumMainSkuSales)을 공유.
  const mainSkus = resolveMainSkus(data);
  const mainSkuYearTotal = sumMainSkuSales(data, mainSkus, (arr) => aggregateYear(arr, year));
  const skuRows = mainSkus.map((sku) => {
    const arr = data.skuDaily[sku.code];
    const agg = arr ? aggregateYear(arr, year) : null;
    const share = agg && mainSkuYearTotal ? (agg.sales / mainSkuYearTotal) * 100 : null;
    return `<tr>
      <td class="name">${sku.name}${skuBadgeHTML(sku.code)}</td>
      <td class="num">${agg ? fmtYen(agg.sales) : '<span class="tbd">데이터 없음</span>'}</td>
      <td class="num">${share !== null ? fmtPct(share, 1) : "—"}</td>
      <td class="num">${agg ? fmtNum(agg.qty) + "개" : "—"}</td>
      <td class="num">${agg ? fmtNum(agg.uv) : "—"}</td>
      <td class="num">${agg ? fmtPct(agg.newRatio, 0) : "—"}</td>
      <td class="num">${agg ? fmtPct(agg.existingRatio, 0) : "—"}</td>
    </tr>`;
  });
  $("annual-sku-table").querySelector("tbody").innerHTML = skuRows.join("");
}

/* ================================================================
   2. 월별 대시보드
   ================================================================ */
export function renderMonthly(data, year, month) {
  $("monthly-target-title").textContent = `${year}년 ${month}월 · 목표 달성 현황`;

  // 프로모션_항목에 정의된 해당 월의 프로모션이 있으면 그 비교기간을 사용,
  // 없으면 달력 기준(전월/전년 동월)으로 폴백
  const promo = data.promotions.find((p) => p.year === year && p.month === month);
  const cur = aggregateMonth(data.shopDaily, year, month);
  const fallbackPrevM = month === 1 ? 12 : month - 1;
  const fallbackPrevY = month === 1 ? year - 1 : year;
  const fallbackYoyY = year - 1;
  let prev, yoy, prevLabel, yoyLabel;
  if (promo) {
    prev = aggregateRange(data.shopDaily, promo.previous.start, promo.previous.end);
    yoy = aggregateRange(data.shopDaily, promo.yoy.start, promo.yoy.end);
    prevLabel = `직전 (${promo.previous.label || "프로모션 정의 기간"})`;
    yoyLabel = `전년 (${promo.yoy.start} ~ ${promo.yoy.end})`;
  } else {
    prev = aggregateMonth(data.shopDaily, fallbackPrevY, fallbackPrevM);
    yoy = aggregateMonth(data.shopDaily, fallbackYoyY, month);
    prevLabel = `직전 (${fallbackPrevY}.${String(fallbackPrevM).padStart(2, "0")}, 캘린더 기준 — 해당 월 프로모션 정의 없음)`;
    yoyLabel = `전년 (${fallbackYoyY}.${String(month).padStart(2, "0")}, 캘린더 기준)`;
  }

  const target = data.monthlyTargets.find((t) => t.year === year && t.month === month);
  const rate = target && cur.sales ? (cur.sales / target.target) * 100 : null;
  $("monthly-target").innerHTML = `
    <div class="target-nums">
      <div><div class="l">실제 매출</div><div class="v num" style="color:var(--cur)">${fmtYen(cur.sales)}</div></div>
      <div><div class="l">목표 매출</div><div class="v num">${target ? fmtYen(target.target) : "—"}</div></div>
      <div><div class="l">달성률</div><div class="v num" style="color:${rate >= 100 ? "var(--pos)" : "var(--text)"}">${rate !== null ? fmtPct(rate, 1) : "—"}</div></div>
    </div>
    <div class="target-bar-outer"><div class="target-bar-inner" style="width:${Math.min(100, rate || 0)}%"></div></div>`;

  $("monthly-legend").innerHTML = `
    <span><i class="c-cur"></i>금번 (${year}.${String(month).padStart(2, "0")})</span>
    <span><i class="c-prev"></i>${prevLabel}</span>
    <span><i class="c-yoy"></i>${yoyLabel}</span>`;

  const kpis = [
    { label: "매출", key: "sales", fmt: (v) => fmtYen(v) },
    { label: "주문건수", key: "orders", fmt: (v) => fmtNum(v) + "건" },
    { label: "판매수량", key: "qty", fmt: (v) => fmtNum(v) + "개" },
    { label: "UV", key: "uv", fmt: (v) => fmtNum(v) },
    { label: "객단가", key: "aov", fmt: (v) => fmtYen(v) },
    { label: "신규비중", key: "newRatio", fmt: (v) => fmtPct(v, 0), isPP: true },
    { label: "기존비중", key: "existingRatio", fmt: (v) => fmtPct(v, 0), isPP: true },
  ];
  $("monthly-kpi").innerHTML = kpis
    .map((k) => {
      const prevPct = k.isPP ? ppDelta(cur[k.key], prev[k.key]) : pctDelta(cur[k.key], prev[k.key]);
      const yoyPct = k.isPP ? ppDelta(cur[k.key], yoy[k.key]) : pctDelta(cur[k.key], yoy[k.key]);
      return kpiCardHTML({ label: k.label, value: k.fmt(cur[k.key]), prevPct, yoyPct, isPP: !!k.isPP });
    })
    .join("");

  // 메인 SKU 월간 성과
  // 매출비중 = 해당 SKU 월 매출 / 메인 9SKU 월 전체매출 (연간 화면과 같은 sumMainSkuSales 공유)
  const mainSkus = promo ? resolveMainSkus(data, promo.id) : resolveMainSkus(data);
  const mainSkuMonthTotal = sumMainSkuSales(data, mainSkus, (arr) => aggregateMonth(arr, year, month));
  const rows = mainSkus.map((sku) => {
    const arr = data.skuDaily[sku.code];
    if (!arr) {
      return `<tr><td class="name">${sku.name}${skuBadgeHTML(sku.code)}</td><td colspan="8" class="num tbd">데이터 없음</td></tr>`;
    }
    const c = aggregateMonth(arr, year, month);
    const p = promo
      ? aggregateRange(arr, promo.previous.start, promo.previous.end)
      : aggregateMonth(arr, fallbackPrevY, fallbackPrevM);
    const y = promo
      ? aggregateRange(arr, promo.yoy.start, promo.yoy.end)
      : aggregateMonth(arr, fallbackYoyY, month);
    const share = mainSkuMonthTotal ? (c.sales / mainSkuMonthTotal) * 100 : null;
    return `<tr>
      <td class="name">${sku.name}${skuBadgeHTML(sku.code)}</td>
      <td class="num">${fmtYen(c.sales)}</td>
      <td class="num">${share !== null ? fmtPct(share, 1) : "—"}</td>
      <td class="num">${deltaInlineHTML(pctDelta(c.sales, p.sales))}</td>
      <td class="num">${deltaInlineHTML(pctDelta(c.sales, y.sales))}</td>
      <td class="num">${fmtNum(c.qty)}개</td>
      <td class="num">${fmtNum(c.uv)}</td>
      <td class="num">${fmtPct(c.newRatio, 0)}</td>
      <td class="num">${fmtPct(c.existingRatio, 0)}</td>
    </tr>`;
  });
  $("monthly-sku-table").querySelector("tbody").innerHTML = rows.join("");
}

/* ================================================================
   3. 프로모션 비교
   ================================================================ */
// 프로모션별로 사용자가 수동 추가한 상품 목록을 기억합니다 (프로모션 전환 시 유지).
const promoAddedProductsByPromo = {};
let curPromoMetric = "sales";
let curPromoFlowTab = "all";

// 구매전환율(cvr)은 분자(SKU 주문건수)·분모(유입 PV) 둘 다 정확도가 확인되지 않아
// 임의 추정을 노출하지 않도록 탭에서 제외함 (계산 유틸 자체는 utils.js에 남겨둠 —
// 원본 데이터 신뢰도가 확보되면 다시 추가).
const PROMO_METRICS = [
  { key: "sales", label: "매출", type: "currency", pctType: "pct" },
  { key: "orders", label: "주문건수", type: "count", pctType: "pct" },
  { key: "qty", label: "판매수량", type: "count", pctType: "pct" },
  { key: "totalInflow", label: "PV", type: "count", pctType: "pct" }, // "유입"은 모호해서 실제 원본 지표명인 PV로 표기
  { key: "newRatio", label: "신규・기존비중", type: "ratio", pctType: "pp" },
];

function promoRowSeries(data, row, promo) {
  const arr = row.shop ? data.shopDaily : data.skuDaily[row.code];
  if (!arr) return null;
  return {
    cur: aggregateRange(arr, promo.current.start, promo.current.end),
    prev: aggregateRange(arr, promo.previous.start, promo.previous.end),
    yoy: aggregateRange(arr, promo.yoy.start, promo.yoy.end),
  };
}
function promoAllRows(data, promo) {
  const mainSkus = resolveMainSkus(data, promo.id);
  const added = promoAddedProductsByPromo[promo.id] || [];
  return [
    { name: "숍 전체", code: null, shop: true },
    ...mainSkus.map((s) => ({ name: s.name, code: s.code, shop: false, base: true })),
    ...added,
  ];
}

export function renderPromo(data, promoId) {
  const promo = data.promotions.find((p) => p.id === promoId);
  if (!promo) return;
  if (!promoAddedProductsByPromo[promo.id]) promoAddedProductsByPromo[promo.id] = [];

  const shopCur = aggregateRange(data.shopDaily, promo.current.start, promo.current.end);
  const shopPrev = aggregateRange(data.shopDaily, promo.previous.start, promo.previous.end);
  const shopYoy = aggregateRange(data.shopDaily, promo.yoy.start, promo.yoy.end);

  $("promo-hero").innerHTML = `
    <div class="titles">
      <div class="eyebrow">프로모션 비교</div>
      <h2>${promo.year}년 ${promo.month}월 · ${promo.name}</h2>
      <div class="periods">
        <span class="period"><i class="dotc" style="background:var(--cur)"></i>금번 <b>${promo.current.start} ~ ${promo.current.end}</b></span>
        <span class="period"><i class="dotc" style="background:var(--prev)"></i>직전${promo.previous.label ? "(" + promo.previous.label + ")" : ""} <b>${promo.previous.start} ~ ${promo.previous.end}</b></span>
        <span class="period"><i class="dotc" style="background:var(--yoy)"></i>전년 <b>${promo.yoy.start} ~ ${promo.yoy.end}</b></span>
      </div>
    </div>`;

  const kpiDefs = [
    { label: "매출", key: "sales", fmt: fmtYen },
    { label: "주문건수", key: "orders", fmt: (v) => fmtNum(v) },
    { label: "판매수량", key: "qty", fmt: (v) => fmtNum(v) },
    { label: "UV", key: "uv", fmt: (v) => fmtNum(v) },
  ];
  $("promo-kpi").innerHTML = kpiDefs
    .map((k) =>
      triCompareBarHTML({
        label: k.label,
        cur: shopCur[k.key], prev: shopPrev[k.key], yoy: shopYoy[k.key],
        fmt: k.fmt,
        prevPct: pctDelta(shopCur[k.key], shopPrev[k.key]),
        yoyPct: pctDelta(shopCur[k.key], shopYoy[k.key]),
      })
    )
    .join("");

  renderTabs($("promo-metric-tabs"), PROMO_METRICS.map((m) => ({ key: m.key, label: m.label })), curPromoMetric, (key) => {
    curPromoMetric = key;
    renderPromoTable(data, promo);
  });
  renderTabs(
    $("promo-flow-tabs"),
    [
      { key: "all", label: "전항목" },
      { key: "totalInflow", label: "전체 PV" },
      { key: "internalInflow", label: "내부유입" },
      { key: "externalInflow", label: "외부유입" },
    ],
    curPromoFlowTab,
    (key) => {
      curPromoFlowTab = key;
      renderPromoFlowTable(data, promo);
    }
  );

  renderPromoTable(data, promo);
  renderPromoFlowTable(data, promo);

  $("promo-add-btn").onclick = () => {
    const input = $("promo-add-input");
    const code = input.value.trim();
    if (!code) return;
    const list = promoAddedProductsByPromo[promo.id];
    if (!list.find((p) => p.code === code)) {
      list.push({ name: "추가상품", code, shop: false, pinned: false });
    }
    input.value = "";
    renderPromoTable(data, promo);
    renderPromoFlowTable(data, promo);
  };
}

function renderPromoTable(data, promo) {
  const m = PROMO_METRICS.find((x) => x.key === curPromoMetric);
  const rows = promoAllRows(data, promo);
  const body = $("promo-table").querySelector("tbody");

  body.innerHTML = rows
    .map((row) => {
      const s = promoRowSeries(data, row, promo);
      if (!s) {
        return `<tr><td class="name">${row.shop ? "<b>숍 전체</b>" : row.name}${skuBadgeHTML(row.code)}</td><td colspan="5" class="num tbd">데이터 없음</td></tr>`;
      }
      let curTxt, prevTxt, yoyTxt, prevDelta, yoyDelta;
      if (m.key === "newRatio") {
        const exist = (v) => (v === null || v === undefined ? null : 100 - v); // null(데이터 없음)을 100%로 잘못 표시하지 않도록 가드
        curTxt = `${fmtPct(s.cur.newRatio, 0)} (기존 ${fmtPct(exist(s.cur.newRatio), 0)})`;
        prevTxt = `${fmtPct(s.prev.newRatio, 0)} (기존 ${fmtPct(exist(s.prev.newRatio), 0)})`;
        yoyTxt = `${fmtPct(s.yoy.newRatio, 0)} (기존 ${fmtPct(exist(s.yoy.newRatio), 0)})`;
        prevDelta = ppDelta(s.cur.newRatio, s.prev.newRatio);
        yoyDelta = ppDelta(s.cur.newRatio, s.yoy.newRatio);
      } else if (m.pctType === "pp") {
        curTxt = fmtPct(s.cur[m.key], 2); prevTxt = fmtPct(s.prev[m.key], 2); yoyTxt = fmtPct(s.yoy[m.key], 2);
        prevDelta = ppDelta(s.cur[m.key], s.prev[m.key]);
        yoyDelta = ppDelta(s.cur[m.key], s.yoy[m.key]);
      } else {
        const fmt = m.type === "currency" ? fmtYen : (v) => fmtNum(v);
        curTxt = fmt(s.cur[m.key]); prevTxt = fmt(s.prev[m.key]); yoyTxt = fmt(s.yoy[m.key]);
        prevDelta = pctDelta(s.cur[m.key], s.prev[m.key]);
        yoyDelta = pctDelta(s.cur[m.key], s.yoy[m.key]);
      }
      // PV(totalInflow)는 25)/26)SHOP_유입현황 BD열 기준 확정값이므로 "추정" 배지를 달지 않는다.
      return `<tr ${!row.shop && !row.base ? 'style="background:#FFFDF5;"' : ""}>
        <td class="name">${row.shop ? "<b>숍 전체</b>" : row.name}${skuBadgeHTML(row.code)}</td>
        <td class="num" style="color:var(--cur); font-weight:700;">${curTxt}</td>
        <td class="num sub">${prevTxt}</td>
        <td class="num sub">${yoyTxt}</td>
        <td class="num">${m.pctType === "pp" ? deltaInlineHTML(prevDelta, true) : deltaInlineHTML(prevDelta)}</td>
        <td class="num">${m.pctType === "pp" ? deltaInlineHTML(yoyDelta, true) : deltaInlineHTML(yoyDelta)}</td>
      </tr>`;
    })
    .join("");
}

function renderPromoFlowTable(data, promo) {
  const thead = $("promo-flow-thead");
  const body = $("promo-flow-table").querySelector("tbody");
  const rows = promoAllRows(data, promo);

  if (curPromoFlowTab === "all") {
    thead.innerHTML = `<tr><th>구분</th><th>전체 PV</th><th>내부유입</th><th>내부유입비중</th><th>외부유입</th><th>외부유입비중</th></tr>`;
    body.innerHTML = rows
      .map((row) => {
        const s = promoRowSeries(data, row, promo);
        if (!s) return `<tr><td class="name">${row.shop ? "<b>숍 전체</b>" : row.name}${skuBadgeHTML(row.code)}</td><td colspan="5" class="num tbd">데이터 없음</td></tr>`;
        const c = s.cur;
        return `<tr>
          <td class="name">${row.shop ? "<b>숍 전체</b>" : row.name}${skuBadgeHTML(row.code)}</td>
          <td class="num">${fmtNum(c.totalInflow)}</td>
          <td class="num">${fmtNum(c.internalInflow)}</td>
          <td class="num">${fmtPct(c.internalRatio, 0)}</td>
          <td class="num">${fmtNum(c.externalInflow)}</td>
          <td class="num">${fmtPct(c.externalRatio, 0)}</td>
        </tr>`;
      })
      .join("");
  } else {
    thead.innerHTML = `<tr><th>구분</th><th>금번</th><th>직전</th><th>전년</th><th>직전차</th><th>직전비</th><th>전년비</th></tr>`;
    body.innerHTML = rows
      .map((row) => {
        const s = promoRowSeries(data, row, promo);
        if (!s) return `<tr><td class="name">${row.shop ? "<b>숍 전체</b>" : row.name}${skuBadgeHTML(row.code)}</td><td colspan="6" class="num tbd">데이터 없음</td></tr>`;
        const cur = s.cur[curPromoFlowTab], prev = s.prev[curPromoFlowTab], yoy = s.yoy[curPromoFlowTab];
        const diff = cur - prev;
        return `<tr>
          <td class="name">${row.shop ? "<b>숍 전체</b>" : row.name}${skuBadgeHTML(row.code)}</td>
          <td class="num">${fmtNum(cur)}</td>
          <td class="num sub">${fmtNum(prev)}</td>
          <td class="num sub">${fmtNum(yoy)}</td>
          <td class="num">${diff >= 0 ? "+" : ""}${fmtNum(diff)}</td>
          <td class="num">${deltaInlineHTML(pctDelta(cur, prev))}</td>
          <td class="num">${deltaInlineHTML(pctDelta(cur, yoy))}</td>
        </tr>`;
      })
      .join("");
  }
}

/* ================================================================
   4. 프로모션 일별 분석
   금번/직전/전년을 "동일 프로모션 경과일" 기준으로 비교한다.
   직전/전년 날짜는 반드시 프로모션_항목에 저장된 실제 값(promo.previous/.yoy)만
   사용하며, 정의되지 않은 경우("-") 임의 날짜를 만들지 않고 "—"로 표시한다.
   ================================================================ */
let curDailyOffsetIndex = {}; // promoId -> selected pill index (0=누계)
let curDailySkuCode = {}; // promoId -> selected SKU code

function hasVal(v) {
  return v !== null && v !== undefined && !isNaN(v);
}

// 금번(promo.current)은 항상 실제 선택된 프로모션 기간이므로 기존 방식 그대로
// 유지한다(기간이 짧아 해당 offset에 행이 없으면 0으로 집계 — 기존 화면과 동일한
// 값을 보장하기 위해 이 함수는 변경하지 않는다).
function seriesForOffset(dailyArr, promo, offsetIndex) {
  if (!dailyArr) return null;
  if (offsetIndex === 0) return aggregateRange(dailyArr, promo.current.start, promo.current.end);
  return aggregateRows(rowsForDayOffset(dailyArr, promo.current.start, offsetIndex - 1));
}

export function renderDaily(data, promoId) {
  const promo = data.promotions.find((p) => p.id === promoId);
  if (!promo) return;
  $("daily-title").textContent = `${promo.year}년 ${promo.month}월 ${promo.name} — 일별 분석`;

  const hint = $("daily-halfday-hint");
  if (promo.isHalfDayFirst) {
    hint.style.display = "block";
    hint.innerHTML = `※ ${promo.name}는 첫날 17시부터 진행되어 <b>0.5일차</b>로 카운트합니다 (다른 프로모션은 1일차부터 정상 카운트). 이 기준은 금번뿐 아니라 직전·전년 각 기간의 시작일에도 동일하게 적용되어, "0.5일차" 행은 세 기간 각각의 시작일 데이터를 나란히 비교합니다.`;
  } else {
    hint.style.display = "none";
  }

  // 금번/직전/전년 비교 기간 표시 — 프로모션_항목에 실제로 입력된 값만 사용
  const prevValid = isValidPeriod(promo.previous);
  const yoyValid = isValidPeriod(promo.yoy);
  $("daily-periods").innerHTML = `
    <div class="titles">
      <div class="eyebrow">비교 기간 (프로모션_항목 기준)</div>
      <h2>${promo.year}년 ${promo.month}월 · ${promo.name}</h2>
      <div class="periods">
        <span class="period"><i class="dotc" style="background:var(--cur)"></i>금번 <b>${promo.current.start} ~ ${promo.current.end}</b></span>
        <span class="period"><i class="dotc" style="background:var(--prev)"></i>직전${promo.previous.label ? "(" + promo.previous.label + ")" : ""} <b>${prevValid ? `${promo.previous.start} ~ ${promo.previous.end}` : "정의되지 않음"}</b></span>
        <span class="period"><i class="dotc" style="background:var(--yoy)"></i>전년 <b>${yoyValid ? `${promo.yoy.start} ~ ${promo.yoy.end}` : "정의되지 않음"}</b></span>
      </div>
    </div>`;

  const dayLabels = buildPromoDayLabels(promo); // ["누계","0.5일차"/"1일차",...] — 금번 기간 길이 기준(기존과 동일)
  if (curDailyOffsetIndex[promo.id] === undefined) {
    curDailyOffsetIndex[promo.id] = dayLabels.length > 1 ? 1 : 0;
  }

  const mainSkus = resolveMainSkus(data, promo.id);
  if (curDailySkuCode[promo.id] === undefined) {
    curDailySkuCode[promo.id] = mainSkus[0] ? mainSkus[0].code : null;
  }

  function draw() {
    const selected = curDailyOffsetIndex[promo.id];
    renderPills($("day-pills"), dayLabels, selected, (i) => {
      curDailyOffsetIndex[promo.id] = i;
      draw();
    });

    // ---- 선택 일차의 숍 전체 금번/직전/전년 집계 ----
    const shopCur = seriesForOffset(data.shopDaily, promo, selected);
    const shopPrev = seriesForOffsetOrNull(data.shopDaily, promo.previous, selected);
    const shopYoy = seriesForOffsetOrNull(data.shopDaily, promo.yoy, selected);

    // ---- 상단 핵심 KPI — 트리플 비교 카드 ----
    const kpiDefs = [
      { label: "매출", key: "sales", fmt: fmtYen },
      { label: "주문건수", key: "orders", fmt: (v) => fmtNum(v) + "건" },
      { label: "판매수량", key: "qty", fmt: (v) => fmtNum(v) + "개" },
      { label: "UV", key: "uv", fmt: fmtNum },
      { label: "객단가", key: "aov", fmt: fmtYen },
      { label: "신규비중", key: "newRatio", fmt: (v) => fmtPct(v, 0), isPP: true },
      { label: "기존비중", key: "existingRatio", fmt: (v) => fmtPct(v, 0), isPP: true },
      { label: "전체 PV", key: "totalInflow", fmt: fmtNum },
      { label: "내부유입", key: "internalInflow", fmt: fmtNum },
      { label: "내부유입비중", key: "internalRatio", fmt: (v) => fmtPct(v, 0), isPP: true },
      { label: "외부유입", key: "externalInflow", fmt: fmtNum },
      { label: "외부유입비중", key: "externalRatio", fmt: (v) => fmtPct(v, 0), isPP: true },
    ];
    $("daily-kpi").innerHTML = kpiDefs
      .map((k) => {
        const cur = shopCur ? shopCur[k.key] : null;
        const prev = shopPrev ? shopPrev[k.key] : null;
        const yoy = shopYoy ? shopYoy[k.key] : null;
        const prevPct = hasVal(cur) && hasVal(prev) ? (k.isPP ? ppDelta(cur, prev) : pctDelta(cur, prev)) : null;
        const yoyPct = hasVal(cur) && hasVal(yoy) ? (k.isPP ? ppDelta(cur, yoy) : pctDelta(cur, yoy)) : null;
        return triCompareBarHTML({ label: k.label, cur, prev, yoy, fmt: k.fmt, prevPct, yoyPct, isPP: !!k.isPP });
      })
      .join("");

    // ---- 일자별 매출 추이: 금번/직전/전년, 동일 경과일 기준 ----
    const perDayLabels = dayLabels.slice(1); // 누계 제외
    const curDaily = perDayLabels.map((_, i) => seriesForOffset(data.shopDaily, promo, i + 1).sales);
    const prevDaily = perDayLabels.map((_, i) => {
      const s = seriesForOffsetOrNull(data.shopDaily, promo.previous, i + 1);
      return s ? s.sales : null;
    });
    const yoyDaily = perDayLabels.map((_, i) => {
      const s = seriesForOffsetOrNull(data.shopDaily, promo.yoy, i + 1);
      return s ? s.sales : null;
    });
    const maxV = Math.max(...curDaily, ...prevDaily.filter(hasVal), ...yoyDaily.filter(hasVal), 1);
    const bar = (v, cls) => {
      if (!hasVal(v)) return `<div class="bar ${cls} empty" title="데이터 없음"></div>`;
      const h = Math.max(2, Math.round((v / maxV) * 100));
      return `<div class="bar ${cls}" style="height:${h}px;"></div>`;
    };
    $("trend-chart").innerHTML = perDayLabels
      .map((lbl, i) => {
        const isSel = selected === i + 1;
        return `<div class="bar-wrap"><div class="bar-group ${isSel ? "sel" : ""}">${bar(curDaily[i], "b-cur")}${bar(prevDaily[i], "b-prev")}${bar(yoyDaily[i], "b-yoy")}</div><div class="lbl">${lbl.replace("일차", "")}</div></div>`;
      })
      .join("");

    // ---- 숍 전체 상세 비교표 ----
    const shopMetrics = [
      { label: "매출", key: "sales", fmt: fmtYen },
      { label: "주문건수", key: "orders", fmt: (v) => fmtNum(v) + "건" },
      { label: "판매수량", key: "qty", fmt: (v) => fmtNum(v) + "개" },
      { label: "UV", key: "uv", fmt: fmtNum },
      { label: "객단가", key: "aov", fmt: fmtYen },
      { label: "전체 PV", key: "totalInflow", fmt: fmtNum },
      { label: "내부유입 PV", key: "internalInflow", fmt: fmtNum },
      { label: "외부유입 PV", key: "externalInflow", fmt: fmtNum },
      { label: "신규고객", key: "newCustomers", fmt: fmtNum },
      { label: "신규고객비중", key: "newRatio", fmt: (v) => fmtPct(v, 0), isPP: true },
      { label: "기존고객", key: "existingCustomers", fmt: fmtNum },
      { label: "기존고객비중", key: "existingRatio", fmt: (v) => fmtPct(v, 0), isPP: true },
    ];
    renderMetricCompareRows(
      $("daily-shop-table").querySelector("tbody"),
      shopMetrics.map((m) => ({
        label: m.label,
        cur: shopCur ? shopCur[m.key] : null,
        prev: shopPrev ? shopPrev[m.key] : null,
        yoy: shopYoy ? shopYoy[m.key] : null,
        fmt: m.fmt,
        isPP: !!m.isPP,
      }))
    );

    // ---- 메인 SKU 9개 선택 버튼 + 선택 SKU 상세 비교표 ----
    function drawSku() {
      const code = curDailySkuCode[promo.id];
      const sku = mainSkus.find((s) => s.code === code);
      const arr = code ? data.skuDaily[code] : null;
      const tbody = $("daily-sku-table").querySelector("tbody");

      if (!arr) {
        tbody.innerHTML = `<tr><td class="name">${sku ? sku.name : code || "-"}</td><td colspan="7" class="num tbd">이 상품에 대한 데이터가 없습니다</td></tr>`;
        return;
      }

      const skuCur = seriesForOffset(arr, promo, selected);
      const skuPrev = seriesForOffsetOrNull(arr, promo.previous, selected);
      const skuYoy = seriesForOffsetOrNull(arr, promo.yoy, selected);

      // 매출비중 = SKU 매출 ÷ 숍 전체 매출 (동일 기간, 동일 집계 함수 기준 — KY 확정)
      const shareOf = (skuAgg, shopAgg) =>
        skuAgg && shopAgg && shopAgg.sales ? (skuAgg.sales / shopAgg.sales) * 100 : null;
      const shareCur = shareOf(skuCur, shopCur);
      const sharePrev = shareOf(skuPrev, shopPrev);
      const shareYoy = shareOf(skuYoy, shopYoy);

      const g = (agg, key) => (agg && hasVal(agg[key]) ? agg[key] : null);
      const skuMetrics = [
        { label: "매출", cur: g(skuCur, "sales"), prev: g(skuPrev, "sales"), yoy: g(skuYoy, "sales"), fmt: fmtYen },
        { label: "매출비중", cur: shareCur, prev: sharePrev, yoy: shareYoy, fmt: (v) => fmtPct(v, 1), isPP: true },
        { label: "판매수량", cur: g(skuCur, "qty"), prev: g(skuPrev, "qty"), yoy: g(skuYoy, "qty"), fmt: (v) => fmtNum(v) + "개" },
        { label: "전체유입 PV", cur: g(skuCur, "totalInflow"), prev: g(skuPrev, "totalInflow"), yoy: g(skuYoy, "totalInflow"), fmt: fmtNum },
        { label: "내부유입 PV", cur: g(skuCur, "internalInflow"), prev: g(skuPrev, "internalInflow"), yoy: g(skuYoy, "internalInflow"), fmt: fmtNum },
        { label: "외부유입 PV", cur: g(skuCur, "externalInflow"), prev: g(skuPrev, "externalInflow"), yoy: g(skuYoy, "externalInflow"), fmt: fmtNum },
        { label: "신규고객", cur: g(skuCur, "newCustomers"), prev: g(skuPrev, "newCustomers"), yoy: g(skuYoy, "newCustomers"), fmt: fmtNum },
        { label: "신규고객비중", cur: g(skuCur, "newRatio"), prev: g(skuPrev, "newRatio"), yoy: g(skuYoy, "newRatio"), fmt: (v) => fmtPct(v, 0), isPP: true },
        { label: "기존고객", cur: g(skuCur, "existingCustomers"), prev: g(skuPrev, "existingCustomers"), yoy: g(skuYoy, "existingCustomers"), fmt: fmtNum },
        { label: "기존고객비중", cur: g(skuCur, "existingRatio"), prev: g(skuPrev, "existingRatio"), yoy: g(skuYoy, "existingRatio"), fmt: (v) => fmtPct(v, 0), isPP: true },
      ];
      renderMetricCompareRows(tbody, skuMetrics);
    }

    renderTabs(
      $("daily-sku-tabs"),
      mainSkus.map((s) => ({ key: s.code, label: s.name })),
      curDailySkuCode[promo.id],
      (key) => {
        curDailySkuCode[promo.id] = key;
        drawSku();
      }
    );
    drawSku();
  }
  draw();
}

/* ================================================================
   5. 유입 분석 — 실제 데이터 연동
   data.meta.inflowChannels(E~BC 51개, 원본 컬럼 순서) / data.inflowCatalog
   (전체 카탈로그 203개 상품, 컬럼형) / data.shopDaily[].channels(숍전체 합산,
   Code.gs에서 이미 전체 상품 합산 완료)를 사용한다. 전체 PV(BD)/외부유입/
   내부유입 산식은 Code.gs에서 이미 확정된 값을 그대로 쓰고, 이 화면에서
   다시 계산하지 않는다.
   ================================================================ */

// "{그룹}_{세부}" 형태만 그룹으로 묶고, 밑줄 없는 이름은 단독 채널로 둔다.
// data.meta.inflowChannels(원본 E~BC 컬럼 순서 그대로)에 그대로 적용 —
// 정렬하지 않는다(KY 확정: 원본 순서 고정).
function parseChannelList_(rawNames) {
  const items = [];
  let currentGroup = null;
  rawNames.forEach((raw) => {
    const idx = raw.indexOf("_");
    if (idx === -1) {
      currentGroup = null;
      items.push({ type: "single", key: raw, label: raw });
      return;
    }
    const prefix = raw.slice(0, idx);
    const suffix = raw.slice(idx + 1);
    if (currentGroup && currentGroup.name === prefix) {
      currentGroup.children.push({ key: raw, label: suffix });
    } else {
      currentGroup = { type: "group", name: prefix, children: [{ key: raw, label: suffix }] };
      items.push(currentGroup);
    }
  });
  return items;
}

const SHOP_ALL_CODE = "SHOP_ALL";
const SHOP_ALL_LABEL = "숍 전체";
const PINNED_KEY_ = "qoo10_inflow_pinned_products";
function loadPinned_() {
  try { return JSON.parse(localStorage.getItem(PINNED_KEY_) || "[]"); } catch (e) { return []; }
}
function savePinned_(list) {
  try { localStorage.setItem(PINNED_KEY_, JSON.stringify(list)); } catch (e) { /* localStorage 미지원 환경은 조용히 무시 */ }
}

const TOP10_METRIC_TABS = [
  { key: "totalInflow", label: "전체 PV" },
  { key: "internalInflow", label: "내부유입" },
  { key: "externalInflow", label: "외부유입" },
];
const TOP10_DIRECTION_TABS = [
  { key: "decrease", label: "감소 TOP 10" },
  { key: "increase", label: "증가 TOP 10" },
];

// 직전 대비 차이(cur-prev) 기준 정렬 — null(데이터 없음)은 항상 뒤로 보낸다.
function sortByDiff_(rows, direction) {
  const diffOf = (r) => (hasVal(r.cur) && hasVal(r.prev) ? r.cur - r.prev : null);
  return rows.slice().sort((a, b) => {
    const da = diffOf(a), db = diffOf(b);
    if (da === null && db === null) return 0;
    if (da === null) return 1;
    if (db === null) return -1;
    return direction === "increase" ? db - da : da - db;
  });
}
function sortMetricRows_(rows, sortKey) {
  if (sortKey === "name") return rows.slice().sort((a, b) => a.label.localeCompare(b.label));
  return sortByDiff_(rows, sortKey === "diffAsc" ? "increase" : "decrease");
}

const inflowState_ = {
  top10Direction: "decrease",
  top10Tab: "totalInflow",
  viewMode: "product", // product | channel
  periodMode: "cumulative", // cumulative | daily
  selectedProductCode: null,
  selectedChannel: null,
  dayIndex: 0,
  sessionAddedCodes: [], // 이번 세션에 추가했지만 아직 고정하지 않은 상품코드
  pinnedCodes: loadPinned_(), // 고정 상품코드(localStorage, 다음에 열어도 유지)
  channelSearch: "",
  productSearch: "",
  productSort: "diffDesc",
};

export function renderInflow(data, promoId) {
  const promo = data.promotions.find((p) => p.id === promoId);
  if (!promo) return;

  const CHANNELS = data.meta.inflowChannels || [];
  const CHANNEL_COUNT = CHANNELS.length;
  const CHANNEL_STRUCTURE = parseChannelList_(CHANNELS);
  const catalog = data.inflowCatalog || {};
  const catalogList = Object.keys(catalog).map((code) => ({ code, name: catalog[code].name || `상품 ${code}` }));
  const mainSkus = resolveMainSkus(data, promo.id);

  // rowify 캐시 — 이번 renderInflow 호출(=프로모션 선택/전환) 동안만 유지.
  // 숍전체는 이미 data.shopDaily가 날짜-행 배열이라 변환 없이 그대로 쓴다.
  const rowsCache = {};
  function getRows(code) {
    if (code === SHOP_ALL_CODE) return data.shopDaily;
    if (!rowsCache[code]) rowsCache[code] = rowifyInflowProduct(catalog[code]);
    return rowsCache[code];
  }

  function productLabelFor(code) {
    if (code === SHOP_ALL_CODE) return SHOP_ALL_LABEL;
    const main = mainSkus.find((s) => s.code === code);
    if (main) return main.name;
    if (catalog[code] && catalog[code].name) return catalog[code].name;
    return `추가상품 ${code}`;
  }

  if (!inflowState_.selectedProductCode) inflowState_.selectedProductCode = mainSkus[0] ? mainSkus[0].code : SHOP_ALL_CODE;
  if (!inflowState_.selectedChannel) inflowState_.selectedChannel = CHANNELS[0];

  $("inflow-title").textContent = `유입 분석 — ${promo.year}년 ${promo.month}월 ${promo.name}`;

  // ---- 비교 기간 박스 (실제 프로모션_항목 날짜 그대로 — "프로모션 일별 분석"과 동일) ----
  const prevValid = isValidPeriod(promo.previous);
  const yoyValid = isValidPeriod(promo.yoy);
  $("inflow-periods").innerHTML = `
    <div class="titles">
      <div class="eyebrow">비교 기간 (프로모션_항목 기준)</div>
      <h2>${promo.year}년 ${promo.month}월 · ${promo.name}</h2>
      <div class="periods">
        <span class="period"><i class="dotc" style="background:var(--cur)"></i>금번 <b>${promo.current.start} ~ ${promo.current.end}</b></span>
        <span class="period"><i class="dotc" style="background:var(--prev)"></i>직전${promo.previous.label ? "(" + promo.previous.label + ")" : ""} <b>${prevValid ? `${promo.previous.start} ~ ${promo.previous.end}` : "정의되지 않음"}</b></span>
        <span class="period"><i class="dotc" style="background:var(--yoy)"></i>전년 <b>${yoyValid ? `${promo.yoy.start} ~ ${promo.yoy.end}` : "정의되지 않음"}</b></span>
      </div>
    </div>`;

  // ---- 1. 유입 전체 현황 KPI — 숍 전체(data.shopDaily) 누계, 실제 데이터 ----
  // KPI 요약/TOP10은 선택한 프로모션 기간 전체(누계, offset 0) 기준으로 고정한다.
  // "누계/일별" 전환은 아래 "전체 채널 상세 분석"에만 적용된다(레이아웃 유지).
  const shopCurTotal = seriesForOffsetOrNull(data.shopDaily, promo.current, 0);
  const shopPrevTotal = seriesForOffsetOrNull(data.shopDaily, promo.previous, 0);
  const shopYoyTotal = seriesForOffsetOrNull(data.shopDaily, promo.yoy, 0);
  const summaryDefs = [
    { label: "전체 PV", key: "totalInflow" },
    { label: "내부유입", key: "internalInflow" },
    { label: "외부유입", key: "externalInflow" },
  ];
  $("inflow-summary-kpi").innerHTML = summaryDefs
    .map((k) => {
      const cur = shopCurTotal ? shopCurTotal[k.key] : null;
      const prev = shopPrevTotal ? shopPrevTotal[k.key] : null;
      const yoy = shopYoyTotal ? shopYoyTotal[k.key] : null;
      return triCompareBarHTML({
        label: k.label, cur, prev, yoy, fmt: fmtNum,
        prevPct: hasVal(cur) && hasVal(prev) ? pctDelta(cur, prev) : null,
        yoyPct: hasVal(cur) && hasVal(yoy) ? pctDelta(cur, yoy) : null,
      });
    })
    .join("");

  // ---- 2. 유입 TOP 10 (감소/증가 × 전체PV/내부/외부) — 실제 카탈로그 203개 상품 ----
  function drawTop10() {
    renderTabs($("inflow-top10-direction-tabs"), TOP10_DIRECTION_TABS, inflowState_.top10Direction, (key) => {
      inflowState_.top10Direction = key;
      drawTop10();
    });
    renderTabs($("inflow-top10-tabs"), TOP10_METRIC_TABS, inflowState_.top10Tab, (key) => {
      inflowState_.top10Tab = key;
      drawTop10();
    });

    const metricKey = inflowState_.top10Tab;
    let rows = catalogList.map((p) => {
      const r = getRows(p.code);
      const cur = seriesForOffsetOrNull(r, promo.current, 0);
      const prev = seriesForOffsetOrNull(r, promo.previous, 0);
      const yoy = seriesForOffsetOrNull(r, promo.yoy, 0);
      return {
        name: p.name, code: p.code,
        cur: cur ? cur[metricKey] : null,
        prev: prev ? prev[metricKey] : null,
        yoy: yoy ? yoy[metricKey] : null,
      };
    });
    rows = rows.filter((r) => hasVal(r.cur) && hasVal(r.prev)); // 비교 불가(데이터 없음) 상품은 순위에서 제외
    rows = sortByDiff_(rows, inflowState_.top10Direction).slice(0, 10);

    $("inflow-top10-table").querySelector("tbody").innerHTML = rows
      .map((r, i) => {
        const prevDiff = r.cur - r.prev;
        const yoyDiff = hasVal(r.yoy) ? r.cur - r.yoy : null;
        return `<tr class="inflow-top10-row" data-code="${r.code}" style="cursor:pointer;">
          <td class="name">${i + 1}</td>
          <td class="name">${r.name}</td>
          <td class="num">${fmtNum(r.cur)}</td>
          <td class="num sub">${fmtNum(r.prev)}</td>
          <td class="num sub">${hasVal(r.yoy) ? fmtNum(r.yoy) : "—"}</td>
          <td class="num">${prevDiff >= 0 ? "+" : ""}${fmtNum(prevDiff)}</td>
          <td class="num">${deltaInlineHTML(pctDelta(r.cur, r.prev))}</td>
          <td class="num">${yoyDiff !== null ? (yoyDiff >= 0 ? "+" : "") + fmtNum(yoyDiff) : "—"}</td>
          <td class="num">${yoyDiff !== null ? deltaInlineHTML(pctDelta(r.cur, r.yoy)) : "—"}</td>
        </tr>`;
      })
      .join("") || `<tr><td colspan="9" class="num tbd">비교 가능한 데이터가 있는 상품이 없습니다.</td></tr>`;

    $("inflow-top10-table").querySelectorAll(".inflow-top10-row").forEach((tr) => {
      tr.addEventListener("click", () => {
        inflowState_.viewMode = "product";
        inflowState_.selectedProductCode = tr.dataset.code;
        drawViewModeTabs();
        drawPicker();
        drawDetailArea();
        $("inflow-picker-wrap").scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  // ---- 3. 전체 채널 상세 분석: 보기 전환 / 기간 단위 / 경과일 ----
  function drawViewModeTabs() {
    renderTabs(
      $("inflow-viewmode-tabs"),
      [{ key: "product", label: "상품 기준" }, { key: "channel", label: "채널 기준" }],
      inflowState_.viewMode,
      (key) => { inflowState_.viewMode = key; drawPicker(); drawDetailArea(); }
    );
  }
  function drawPeriodModeTabs() {
    renderTabs(
      $("inflow-periodmode-tabs"),
      [{ key: "cumulative", label: "누계" }, { key: "daily", label: "일별" }],
      inflowState_.periodMode,
      (key) => { inflowState_.periodMode = key; drawDayPills(); drawDetailArea(); }
    );
  }
  function currentOffset() {
    return inflowState_.periodMode === "daily" ? inflowState_.dayIndex + 1 : 0;
  }
  function drawDayPills() {
    const labels = buildPromoDayLabels(promo); // ["누계","0.5일차"/"1일차",...] — 0.5일차(메가와리) 포함
    const dayOnly = labels.slice(1);
    const wrap = $("inflow-day-pills");
    if (inflowState_.periodMode !== "daily") {
      wrap.innerHTML = `<span class="hint" style="margin:0;">"일별" 선택 시 경과일을 고를 수 있습니다 (예: ${dayOnly.slice(0, 3).join(", ")}...)</span>`;
      return;
    }
    renderPills(wrap, dayOnly, inflowState_.dayIndex, (i) => { inflowState_.dayIndex = i; drawDetailArea(); });
  }

  // ---- 상품 기준 / 채널 기준 선택 UI ----
  function drawPicker() {
    const wrap = $("inflow-picker-wrap");
    if (inflowState_.viewMode === "product") {
      const pinned = inflowState_.pinnedCodes;
      const sessionAdded = inflowState_.sessionAddedCodes.filter((c) => !pinned.includes(c));

      wrap.innerHTML = `
        <div class="section-title" style="margin-top:0;">숍 전체 <span class="hint" style="display:inline;margin:0;">(선택 기간 내 카탈로그 전체 ${catalogList.length}개 상품의 채널별 PV 합계)</span></div>
        <div class="tabbar" id="inflow-shopall-tabs"></div>

        <div class="section-title">메인 SKU</div>
        <div class="tabbar" id="inflow-main-tabs"></div>

        <div class="section-title">고정 상품 <span class="hint" style="display:inline;margin:0;">(📌로 고정한 상품 — 다음에 다시 열어도 이 브라우저에서는 유지됩니다)</span></div>
        <div class="tabbar" id="inflow-pinned-tabs">${pinned.length === 0 ? '<span class="hint" style="margin:0;">고정된 상품이 없습니다</span>' : ""}</div>

        ${sessionAdded.length > 0 ? `
        <div class="section-title">신규 상품 <span class="hint" style="display:inline;margin:0;">(방금 추가 — 📌를 눌러 고정하지 않으면 새로고침 시 사라집니다)</span></div>
        <div class="tabbar" id="inflow-session-tabs"></div>` : ""}

        <div class="section-title">상품코드로 추가</div>
        <div class="add-sku" style="margin-top:0;">
          <input type="text" id="inflow-add-code-input" placeholder="상품코드 10자리 입력 (예: 1043733776)" maxlength="10" inputmode="numeric">
          <button class="btn" id="inflow-add-code-btn">+ 상품 추가</button>
          <span class="hint" id="inflow-add-code-hint" style="margin:0;"></span>
        </div>

        <div class="hint" id="inflow-selected-hint" style="margin-top:10px;"></div>`;

      renderTabs(
        $("inflow-shopall-tabs"),
        [{ key: SHOP_ALL_CODE, label: SHOP_ALL_LABEL }],
        inflowState_.selectedProductCode,
        (key) => { inflowState_.selectedProductCode = key; drawPicker(); drawDetailArea(); }
      );
      renderTabs(
        $("inflow-main-tabs"),
        mainSkus.map((s) => ({ key: s.code, label: s.name })),
        inflowState_.selectedProductCode,
        (key) => { inflowState_.selectedProductCode = key; drawPicker(); drawDetailArea(); }
      );

      const bindProductPillGroup = (containerEl, codes, pinnedGroup) => {
        containerEl.innerHTML = codes
          .map((code) => `
            <span class="tab${inflowState_.selectedProductCode === code ? " active" : ""}" data-code="${code}" style="display:inline-flex; align-items:center; gap:4px;">
              <span data-role="select">${productLabelFor(code)}${code.match(/^\d{10}$/) ? " " + code : ""}</span>
              <button class="pin-btn${pinnedGroup ? " pinned" : ""}" data-action="${pinnedGroup ? "unpin" : "pin"}" data-code="${code}" title="${pinnedGroup ? "고정 해제" : "고정"}">📌</button>
              <button class="del-btn" data-action="delete" data-code="${code}" title="삭제">×</button>
            </span>`)
          .join("");
        containerEl.querySelectorAll("[data-role='select']").forEach((el) => {
          el.addEventListener("click", () => {
            inflowState_.selectedProductCode = el.parentElement.dataset.code;
            drawPicker(); drawDetailArea();
          });
        });
        containerEl.querySelectorAll("[data-action='pin']").forEach((btn) => {
          btn.addEventListener("click", () => {
            const code = btn.dataset.code;
            if (!inflowState_.pinnedCodes.includes(code)) inflowState_.pinnedCodes.push(code);
            savePinned_(inflowState_.pinnedCodes);
            drawPicker(); drawDetailArea();
          });
        });
        containerEl.querySelectorAll("[data-action='unpin']").forEach((btn) => {
          btn.addEventListener("click", () => {
            const code = btn.dataset.code;
            inflowState_.pinnedCodes = inflowState_.pinnedCodes.filter((c) => c !== code);
            savePinned_(inflowState_.pinnedCodes);
            if (!inflowState_.sessionAddedCodes.includes(code)) inflowState_.sessionAddedCodes.push(code);
            drawPicker(); drawDetailArea();
          });
        });
        containerEl.querySelectorAll("[data-action='delete']").forEach((btn) => {
          btn.addEventListener("click", () => {
            const code = btn.dataset.code;
            inflowState_.pinnedCodes = inflowState_.pinnedCodes.filter((c) => c !== code);
            savePinned_(inflowState_.pinnedCodes);
            inflowState_.sessionAddedCodes = inflowState_.sessionAddedCodes.filter((c) => c !== code);
            if (inflowState_.selectedProductCode === code) inflowState_.selectedProductCode = mainSkus[0] ? mainSkus[0].code : SHOP_ALL_CODE;
            drawPicker(); drawDetailArea();
          });
        });
      };

      bindProductPillGroup($("inflow-pinned-tabs"), pinned, true);
      if (sessionAdded.length > 0) bindProductPillGroup($("inflow-session-tabs"), sessionAdded, false);

      $("inflow-add-code-btn").addEventListener("click", () => {
        const input = $("inflow-add-code-input");
        const code = input.value.trim();
        const hintEl = $("inflow-add-code-hint");
        if (!/^\d{10}$/.test(code)) {
          hintEl.textContent = "상품코드는 숫자 10자리여야 합니다.";
          hintEl.style.color = "var(--neg)";
          return;
        }
        if (mainSkus.some((s) => s.code === code) || inflowState_.pinnedCodes.includes(code) || inflowState_.sessionAddedCodes.includes(code)) {
          hintEl.textContent = "이미 목록에 있는 상품입니다.";
          hintEl.style.color = "var(--text-faint)";
        } else if (!catalog[code]) {
          hintEl.textContent = "이 상품코드는 현재 유입현황 시트에 데이터가 없습니다(추가는 되지만 값은 \"—\"로 표시됩니다).";
          hintEl.style.color = "var(--prev)";
          inflowState_.sessionAddedCodes.push(code);
        } else {
          inflowState_.sessionAddedCodes.push(code);
          hintEl.textContent = "";
        }
        inflowState_.selectedProductCode = code;
        input.value = "";
        drawPicker();
        drawDetailArea();
      });

      $("inflow-selected-hint").textContent = inflowState_.selectedProductCode
        ? `현재 선택된 상품: ${productLabelFor(inflowState_.selectedProductCode)}` +
          (inflowState_.selectedProductCode === SHOP_ALL_CODE ? "" : ` (${inflowState_.selectedProductCode})`)
        : "";
    } else {
      const blocks = [];
      let singleBuffer = [];
      const flushSingles = () => {
        if (singleBuffer.length === 0) return;
        blocks.push(`<div class="channel-group"><div class="channel-pills">${singleBuffer.join("")}</div></div>`);
        singleBuffer = [];
      };
      CHANNEL_STRUCTURE.forEach((item) => {
        if (item.type === "single") {
          singleBuffer.push(`<span class="channel-pill${item.key === inflowState_.selectedChannel ? " active" : ""}" data-channel="${item.key}">${item.label}</span>`);
        } else {
          flushSingles();
          blocks.push(`
            <div class="channel-group">
              <div class="channel-group-label">${item.name}</div>
              <div class="channel-pills">
                ${item.children.map((c) => `<span class="channel-pill${c.key === inflowState_.selectedChannel ? " active" : ""}" data-channel="${c.key}">${c.label}</span>`).join("")}
              </div>
            </div>`);
        }
      });
      flushSingles();

      wrap.innerHTML = `
        <div class="channel-picker">
          <input type="text" class="channel-search" id="inflow-channel-search" placeholder="채널 검색 (예: 검색, Google...)">
          ${blocks.join("")}
        </div>`;
      wrap.querySelectorAll(".channel-pill").forEach((el) => {
        el.addEventListener("click", () => {
          inflowState_.selectedChannel = el.dataset.channel;
          wrap.querySelectorAll(".channel-pill").forEach((x) => x.classList.remove("active"));
          el.classList.add("active");
          drawDetailArea();
        });
      });
      const searchInput = $("inflow-channel-search");
      searchInput.addEventListener("input", () => {
        const q = searchInput.value.trim().toLowerCase();
        wrap.querySelectorAll(".channel-pill").forEach((el) => {
          el.classList.toggle("hidden", q !== "" && !el.textContent.toLowerCase().includes(q));
        });
      });
    }
  }

  // ---- 상세 영역: 상품 기준(채널 51개 전체, 그룹 표시) / 채널 기준(상품 표) ----
  function drawDetailArea() {
    const wrap = $("inflow-detail-wrap");
    const offset = currentOffset();
    if (inflowState_.viewMode === "product") {
      const productLabel = productLabelFor(inflowState_.selectedProductCode);
      wrap.innerHTML = `
        <div class="panel" style="display:flex; gap:12px; flex-wrap:wrap; align-items:center; margin-bottom:14px;">
          <input type="text" class="channel-search" id="inflow-detail-search" placeholder="채널 검색..." value="${inflowState_.channelSearch}" style="margin:0;">
          <span class="hint" style="margin:0;">"${productLabel}"의 전체 채널 ${CHANNEL_COUNT}개 · 원본 컬럼(E~BC) 순서 그대로 표시. 전체 PV(BD 합계)는 위 KPI의 "전체 PV"를 참고하세요 — 아래 51개 채널의 단순 합과는 다를 수 있습니다(상위 채널의 "_전체" 항목이 하위 세부채널을 포함하는 소계이기 때문).</span>
        </div>
        <div class="panel table-wrap" style="padding:8px 12px;">
          <table>
            <thead><tr><th>유입채널</th><th>금번</th><th>직전</th><th>전년</th><th>직전차</th><th>직전비</th><th>전년차</th><th>전년비</th></tr></thead>
            <tbody id="inflow-channel-tbody"></tbody>
          </table>
        </div>`;

      const rows = getRows(inflowState_.selectedProductCode);
      const curArr = channelSeriesForOffsetOrNull(rows, promo.current, offset, CHANNEL_COUNT);
      const prevArr = channelSeriesForOffsetOrNull(rows, promo.previous, offset, CHANNEL_COUNT);
      const yoyArr = channelSeriesForOffsetOrNull(rows, promo.yoy, offset, CHANNEL_COUNT);
      const valueFor = (arr, idx) => (arr ? arr[idx] : null);

      const renderChannelRows = () => {
        const q = inflowState_.channelSearch.trim().toLowerCase();
        const rowsHtml = [];
        CHANNEL_STRUCTURE.forEach((item) => {
          if (item.type === "single") {
            if (q && !item.label.toLowerCase().includes(q)) return;
            const idx = CHANNELS.indexOf(item.key);
            rowsHtml.push(metricRowHTML({ label: item.label, cur: valueFor(curArr, idx), prev: valueFor(prevArr, idx), yoy: valueFor(yoyArr, idx), fmt: fmtNum }));
          } else {
            const groupNameMatches = !q || item.name.toLowerCase().includes(q);
            const children = groupNameMatches ? item.children : item.children.filter((c) => c.label.toLowerCase().includes(q));
            if (children.length === 0) return;
            rowsHtml.push(`<tr class="ch-group-row"><td colspan="8" class="name" style="background:#FAFAFC; font-weight:700;">${item.name}</td></tr>`);
            children.forEach((c) => {
              const idx = CHANNELS.indexOf(c.key);
              rowsHtml.push(metricRowHTML({ label: c.label, cur: valueFor(curArr, idx), prev: valueFor(prevArr, idx), yoy: valueFor(yoyArr, idx), fmt: fmtNum, indent: true }));
            });
          }
        });
        $("inflow-channel-tbody").innerHTML = rowsHtml.join("") || `<tr><td colspan="8" class="num tbd">검색 결과가 없습니다.</td></tr>`;
      };
      renderChannelRows();

      $("inflow-detail-search").addEventListener("input", (e) => {
        inflowState_.channelSearch = e.target.value;
        renderChannelRows();
      });
    } else {
      wrap.innerHTML = `
        <div class="panel" style="display:flex; gap:12px; flex-wrap:wrap; align-items:center; margin-bottom:14px;">
          <input type="text" class="channel-search" id="inflow-product-search" placeholder="상품 검색..." value="${inflowState_.productSearch}" style="margin:0;">
          <select class="dd-select" id="inflow-product-sort">
            <option value="diffDesc">직전 대비 감소 큰 순</option>
            <option value="diffAsc">직전 대비 증가 큰 순</option>
            <option value="name">상품명 순</option>
          </select>
          <span class="hint" style="margin:0;">"${channelLabelFor_(inflowState_.selectedChannel, CHANNEL_STRUCTURE)}" 채널의 숍전체 + 전체 상품 ${catalogList.length}개</span>
        </div>
        <div class="panel table-wrap" style="padding:8px 12px;">
          <table id="inflow-detail-table"><thead id="inflow-detail-thead"></thead><tbody></tbody></table>
        </div>`;
      $("inflow-product-sort").value = inflowState_.productSort;

      const channelIdx = CHANNELS.indexOf(inflowState_.selectedChannel);

      const valueForProduct = (code) => {
        const r = getRows(code);
        const curArr = channelSeriesForOffsetOrNull(r, promo.current, offset, CHANNEL_COUNT);
        const prevArr = channelSeriesForOffsetOrNull(r, promo.previous, offset, CHANNEL_COUNT);
        const yoyArr = channelSeriesForOffsetOrNull(r, promo.yoy, offset, CHANNEL_COUNT);
        return {
          cur: curArr ? curArr[channelIdx] : null,
          prev: prevArr ? prevArr[channelIdx] : null,
          yoy: yoyArr ? yoyArr[channelIdx] : null,
        };
      };

      const renderProductTable = () => {
        const thead = $("inflow-detail-thead");
        const tbody = $("inflow-detail-table").querySelector("tbody");
        thead.innerHTML = `<tr><th>상품</th><th>금번</th><th>직전</th><th>전년</th><th>직전차</th><th>직전비</th><th>전년차</th><th>전년비</th></tr>`;
        const q = inflowState_.productSearch.trim().toLowerCase();

        let rows = catalogList
          .filter((p) => !q || p.name.toLowerCase().includes(q) || p.code.includes(q))
          .map((p) => {
            const v = valueForProduct(p.code);
            return { label: p.name, cur: v.cur, prev: v.prev, yoy: v.yoy, fmt: fmtNum };
          });
        rows = sortMetricRows_(rows, inflowState_.productSort);

        if (!q || SHOP_ALL_LABEL.toLowerCase().includes(q)) {
          const v = valueForProduct(SHOP_ALL_CODE);
          rows.unshift({ label: SHOP_ALL_LABEL, cur: v.cur, prev: v.prev, yoy: v.yoy, fmt: fmtNum });
        }
        renderMetricCompareRows(tbody, rows);
      };
      renderProductTable();

      $("inflow-product-search").addEventListener("input", (e) => { inflowState_.productSearch = e.target.value; renderProductTable(); });
      $("inflow-product-sort").addEventListener("change", (e) => { inflowState_.productSort = e.target.value; renderProductTable(); });
    }
  }

  function channelLabelFor_(key, structure) {
    for (const item of structure) {
      if (item.type === "single" && item.key === key) return item.label;
      if (item.type === "group") {
        const child = item.children.find((c) => c.key === key);
        if (child) return `${item.name} > ${child.label}`;
      }
    }
    return key;
  }

  drawTop10();
  drawViewModeTabs();
  drawPeriodModeTabs();
  drawDayPills();
  drawPicker();
  drawDetailArea();
}

/* ================================================================
   6. 쿠폰 분석
   ================================================================ */
export function renderCoupon(data, promoId) {
  const promo = data.promotions.find((p) => p.id === promoId);
  $("coupon-title").textContent = promo ? `쿠폰 분석 — ${promo.year}년 ${promo.month}월 ${promo.name}` : "쿠폰 분석";

  const warn = $("coupon-warning");
  if (!data.coupons || !data.coupons.confirmed) {
    warn.style.display = "flex";
    warn.innerHTML = `<span>⚠️</span><span>${(data.coupons && data.coupons.note) || "쿠폰 Raw 시트 컬럼 구조가 아직 확인되지 않았습니다. 아래 표는 예상 레이아웃이며, 실제 계산 가능한 KPI만 추후 반영됩니다."}</span>`;
  } else {
    warn.style.display = "none";
  }

  const items = (data.coupons && data.coupons.items) ? data.coupons.items.filter((c) => c.promotionId === promoId) : [];
  const body = $("coupon-tbody");
  if (items.length === 0) {
    body.innerHTML = `<tr><td colspan="9" class="num tbd">이 프로모션에 등록된 쿠폰 데이터가 없습니다</td></tr>`;
    return;
  }
  body.innerHTML = items
    .map((c) => {
      const rate = c.issued ? (c.used / c.issued) * 100 : null;
      return `<tr>
        <td class="name">${c.name}</td>
        <td class="sub">${c.condition}</td>
        <td class="num">${fmtNum(c.issued)}</td>
        <td class="num">${fmtNum(c.used)}</td>
        <td class="num">${rate !== null ? fmtPct(rate, 1) : "—"}</td>
        <td class="num tbd">Raw 확인 필요</td>
        <td class="num tbd">Raw 확인 필요</td>
        <td class="num tbd">Raw 확인 필요</td>
        <td class="num tbd">확정 전</td>
      </tr>`;
    })
    .join("");
}
