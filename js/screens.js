/**
 * screens.js — 6개 화면의 렌더링 로직
 * 모든 함수는 (data, ...params)를 받아 이미 index.html에 존재하는 DOM에
 * 결과를 채워 넣습니다. 화면별 내부 상호작용(탭/필/추가상품 등)은 모듈
 * 스코프의 지역 상태로 관리합니다.
 */
import {
  fmtYen, fmtNum, fmtPct, pctDelta, ppDelta, deltaChipHTML, deltaInlineHTML,
  aggregateRange, aggregateMonth, aggregateYear, aggregateRows,
  rowsForDayOffset, daysBetween, buildPromoDayLabels, resolveMainSkus,
} from "./utils.js";
import {
  kpiCardHTML, triCompareBarHTML, renderTabs, renderPills, renderAccordion,
  skuBadgeHTML, estimateBadgeHTML,
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
  const mainSkus = resolveMainSkus(data);
  const skuRows = mainSkus.map((sku) => {
    const arr = data.skuDaily[sku.code];
    const agg = arr ? aggregateYear(arr, year) : null;
    const share = agg && shopYear.sales ? (agg.sales / shopYear.sales) * 100 : null;
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
  const mainSkus = promo ? resolveMainSkus(data, promo.id) : resolveMainSkus(data);
  const rows = mainSkus.map((sku) => {
    const arr = data.skuDaily[sku.code];
    if (!arr) {
      return `<tr><td class="name">${sku.name}${skuBadgeHTML(sku.code)}</td><td colspan="7" class="num tbd">데이터 없음</td></tr>`;
    }
    const c = aggregateMonth(arr, year, month);
    const p = promo
      ? aggregateRange(arr, promo.previous.start, promo.previous.end)
      : aggregateMonth(arr, fallbackPrevY, fallbackPrevM);
    const y = promo
      ? aggregateRange(arr, promo.yoy.start, promo.yoy.end)
      : aggregateMonth(arr, fallbackYoyY, month);
    return `<tr>
      <td class="name">${sku.name}${skuBadgeHTML(sku.code)}</td>
      <td class="num">${fmtYen(c.sales)}</td>
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

const PROMO_METRICS = [
  { key: "sales", label: "매출", type: "currency", pctType: "pct" },
  { key: "orders", label: "주문건수", type: "count", pctType: "pct" },
  { key: "qty", label: "판매수량", type: "count", pctType: "pct" },
  { key: "totalInflow", label: "유입", type: "count", pctType: "pct" },
  { key: "cvr", label: "전환율", type: "percent", pctType: "pp" },
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
      { key: "totalInflow", label: "전체유입" },
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
        const mgmt = row.shop || row.base ? '<span class="sub">-</span>' : mgmtButtons(row);
        return `<tr><td class="name">${row.shop ? "<b>숍 전체</b>" : row.name}${skuBadgeHTML(row.code)}</td><td colspan="5" class="num tbd">데이터 없음</td><td>${mgmt}</td></tr>`;
      }
      let curTxt, prevTxt, yoyTxt, prevDelta, yoyDelta;
      if (m.key === "newRatio") {
        const exist = (v) => 100 - v;
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
      const estTag = m.key === "totalInflow" || m.key === "cvr" ? estimateBadgeHTML(row.shop) : "";
      const mgmt = row.shop || row.base ? '<span class="sub">-</span>' : mgmtButtons(row);
      return `<tr ${!row.shop && !row.base ? 'style="background:#FFFDF5;"' : ""}>
        <td class="name">${row.shop ? "<b>숍 전체</b>" : row.name}${skuBadgeHTML(row.code)}${estTag}</td>
        <td class="num" style="color:var(--cur); font-weight:700;">${curTxt}</td>
        <td class="num sub">${prevTxt}</td>
        <td class="num sub">${yoyTxt}</td>
        <td class="num">${m.pctType === "pp" ? deltaInlineHTML(prevDelta, true) : deltaInlineHTML(prevDelta)}</td>
        <td class="num">${m.pctType === "pp" ? deltaInlineHTML(yoyDelta, true) : deltaInlineHTML(yoyDelta)}</td>
        <td>${mgmt}</td>
      </tr>`;
    })
    .join("");

  bindMgmtButtons(data, promo, () => {
    renderPromoTable(data, promo);
    renderPromoFlowTable(data, promo);
  });
}

function mgmtButtons(row) {
  return `<button class="pin-btn ${row.pinned ? "pinned" : ""}" data-code="${row.code}">${row.pinned ? "📌 고정됨" : "📌 고정"}</button><button class="del-btn" data-code="${row.code}">삭제</button>`;
}
function bindMgmtButtons(data, promo, onChange) {
  const list = promoAddedProductsByPromo[promo.id];
  document.querySelectorAll("#promo-table .pin-btn").forEach((b) => {
    b.onclick = () => {
      const p = list.find((x) => x.code === b.dataset.code);
      if (p) { p.pinned = !p.pinned; onChange(); }
    };
  });
  document.querySelectorAll("#promo-table .del-btn").forEach((b) => {
    b.onclick = () => {
      promoAddedProductsByPromo[promo.id] = list.filter((x) => x.code !== b.dataset.code);
      onChange();
    };
  });
}

function renderPromoFlowTable(data, promo) {
  const thead = $("promo-flow-thead");
  const body = $("promo-flow-table").querySelector("tbody");
  const rows = promoAllRows(data, promo);

  if (curPromoFlowTab === "all") {
    thead.innerHTML = `<tr><th>구분</th><th>전체유입</th><th>내부유입</th><th>내부유입비중</th><th>외부유입</th><th>외부유입비중</th><th>구매전환율(CVR)</th></tr>`;
    body.innerHTML = rows
      .map((row) => {
        const s = promoRowSeries(data, row, promo);
        if (!s) return `<tr><td class="name">${row.shop ? "<b>숍 전체</b>" : row.name}${skuBadgeHTML(row.code)}</td><td colspan="6" class="num tbd">데이터 없음</td></tr>`;
        const c = s.cur;
        return `<tr>
          <td class="name">${row.shop ? "<b>숍 전체</b>" : row.name}${skuBadgeHTML(row.code)}${estimateBadgeHTML(row.shop)}</td>
          <td class="num">${fmtNum(c.totalInflow)}</td>
          <td class="num">${fmtNum(c.internalInflow)}</td>
          <td class="num">${fmtPct(c.internalRatio, 0)}</td>
          <td class="num">${fmtNum(c.externalInflow)}</td>
          <td class="num">${fmtPct(c.externalRatio, 0)}</td>
          <td class="num" style="color:var(--cur); font-weight:700;">${fmtPct(c.cvr, 2)}</td>
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
          <td class="name">${row.shop ? "<b>숍 전체</b>" : row.name}${skuBadgeHTML(row.code)}${estimateBadgeHTML(row.shop)}</td>
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
   ================================================================ */
let curDailyOffsetIndex = {}; // promoId -> selected pill index (0=누계)

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
    hint.innerHTML = `※ ${promo.name}는 첫날 17시부터 진행되어 <b>0.5일차</b>로 카운트합니다 (다른 프로모션은 1일차부터 정상 카운트)`;
  } else {
    hint.style.display = "none";
  }

  const dayLabels = buildPromoDayLabels(promo); // ["누계","1일차"/"0.5일차",...]
  if (curDailyOffsetIndex[promo.id] === undefined) {
    curDailyOffsetIndex[promo.id] = dayLabels.length > 1 ? 1 : 0;
  }

  const mainSkus = resolveMainSkus(data, promo.id);

  function draw() {
    const selected = curDailyOffsetIndex[promo.id];
    renderPills($("day-pills"), dayLabels, selected, (i) => {
      curDailyOffsetIndex[promo.id] = i;
      draw();
    });

    const shopSel = seriesForOffset(data.shopDaily, promo, selected);
    $("daily-kpi").innerHTML = [
      kpiCardHTML({ label: "매출", value: fmtYen(shopSel.sales), sizeSmall: true }),
      kpiCardHTML({ label: "주문건수", value: fmtNum(shopSel.orders) + "건", sizeSmall: true }),
      kpiCardHTML({ label: "판매수량", value: fmtNum(shopSel.qty) + "개", sizeSmall: true }),
      kpiCardHTML({ label: "UV", value: fmtNum(shopSel.uv), sizeSmall: true }),
      kpiCardHTML({ label: "객단가", value: fmtYen(shopSel.aov), sizeSmall: true }),
      kpiCardHTML({ label: "신규비중", value: fmtPct(shopSel.newRatio, 0), sizeSmall: true }),
      kpiCardHTML({ label: "기존비중", value: fmtPct(shopSel.existingRatio, 0), sizeSmall: true }),
      kpiCardHTML({ label: "전체유입", value: fmtNum(shopSel.totalInflow), sizeSmall: true }),
      kpiCardHTML({ label: "내부유입", value: fmtNum(shopSel.internalInflow), sizeSmall: true }),
      kpiCardHTML({ label: "내부유입비중", value: fmtPct(shopSel.internalRatio, 0), sizeSmall: true }),
      kpiCardHTML({ label: "외부유입", value: fmtNum(shopSel.externalInflow), sizeSmall: true }),
      kpiCardHTML({ label: "외부유입비중", value: fmtPct(shopSel.externalRatio, 0), sizeSmall: true }),
      kpiCardHTML({ label: "구매전환율", value: fmtPct(shopSel.cvr, 2), sizeSmall: true }),
    ].join("");

    // 추이 차트 (일자별 매출, 누계 제외)
    const perDaySales = dayLabels.slice(1).map((_, i) => seriesForOffset(data.shopDaily, promo, i + 1).sales);
    const maxV = Math.max(...perDaySales, 1);
    $("trend-chart").innerHTML = dayLabels
      .slice(1)
      .map((lbl, i) => {
        const h = Math.max(2, Math.round((perDaySales[i] / maxV) * 100));
        const isSel = selected === i + 1;
        return `<div class="bar-wrap"><div class="bar ${isSel ? "sel" : ""}" style="height:${h}px;"></div><div class="lbl">${lbl.replace("일차", "")}</div></div>`;
      })
      .join("");

    // 숍전체 + 메인 SKU 표
    const rows = [{ name: "숍 전체", code: null, shop: true }, ...mainSkus.map((s) => ({ name: s.name, code: s.code, shop: false }))];
    $("daily-table").querySelector("tbody").innerHTML = rows
      .map((row) => {
        const arr = row.shop ? data.shopDaily : data.skuDaily[row.code];
        const s = seriesForOffset(arr, promo, selected);
        if (!s) return `<tr><td class="name">${row.shop ? "<b>숍 전체</b>" : row.name}${skuBadgeHTML(row.code)}</td><td colspan="11" class="num tbd">데이터 없음</td></tr>`;
        return `<tr>
          <td class="name">${row.shop ? "<b>숍 전체</b>" : row.name}${skuBadgeHTML(row.code)}</td>
          <td class="num">${fmtYen(s.sales)}</td>
          <td class="num">${fmtNum(s.orders)}</td>
          <td class="num">${fmtNum(s.qty)}</td>
          <td class="num">${fmtNum(s.uv)}</td>
          <td class="num">${fmtYen(s.aov)}</td>
          <td class="num">${fmtNum(s.totalInflow)}</td>
          <td class="num">${fmtNum(s.internalInflow)}</td>
          <td class="num">${fmtPct(s.internalRatio, 0)}</td>
          <td class="num">${fmtNum(s.externalInflow)}</td>
          <td class="num">${fmtPct(s.externalRatio, 0)}</td>
          <td class="num" style="color:var(--cur); font-weight:700;">${fmtPct(s.cvr, 2)}</td>
        </tr>`;
      })
      .join("");
  }
  draw();
}

/* ================================================================
   5. 유입 분석 (숍 전체 / 메인 SKU / 추가 상품 선택 가능)
   ================================================================ */
const CHANNEL_DIST = {
  internal: [
    { name: "검색결과", r: 0.312 }, { name: "프로모션페이지", r: 0.241 }, { name: "상품상세페이지", r: 0.196 },
    { name: "홈(메인페이지)", r: 0.141 }, { name: "셀러샵 / 기획전", r: 0.070 },
    { name: "위시리스트 / 최근본상품", r: 0.026 }, { name: "기타 (베스트셀러/카테고리 등)", r: 0.014 },
  ],
  external: [
    { name: "Google", r: 0.350 }, { name: "Instagram", r: 0.283 }, { name: "YouTube 연동 / 기타 SNS", r: 0.153 },
    { name: "URL 직접입력", r: 0.113 }, { name: "야후 (Yahoo)", r: 0.068 },
    { name: "카카쿠 (가격비교)", r: 0.022 }, { name: "X (트위터) / LINE / 기타", r: 0.012 },
  ],
};
function buildChannelBreakdown(internalTotal, externalTotal) {
  return {
    internal: CHANNEL_DIST.internal.map((c) => ({ name: c.name, val: Math.round(internalTotal * c.r) })),
    external: CHANNEL_DIST.external.map((c) => ({ name: c.name, val: Math.round(externalTotal * c.r) })),
  };
}

let inflowState = { promoId: null, target: "shop", addedTargets: {}, flowCat: "totalInflow" };

function inflowTargets(data, promo) {
  const mainSkus = resolveMainSkus(data, promo.id);
  const added = inflowState.addedTargets[promo.id] || [];
  return [
    { key: "shop", name: "숍 전체", shop: true },
    ...mainSkus.map((s) => ({ key: s.code, code: s.code, name: s.name, shop: false })),
    ...added.map((t) => ({ key: t.code, code: t.code, name: t.name, shop: false, added: true })),
  ];
}

export function renderInflow(data, promoId) {
  const promo = data.promotions.find((p) => p.id === promoId);
  if (!promo) return;
  if (inflowState.promoId !== promoId) {
    inflowState.promoId = promoId;
    inflowState.target = "shop";
    inflowState.flowCat = "totalInflow";
  }
  if (!inflowState.addedTargets[promo.id]) inflowState.addedTargets[promo.id] = [];

  $("inflow-title").textContent = `유입 분석 — ${promo.year}년 ${promo.month}월 ${promo.name}`;

  function drawTargetTabs() {
    const targets = inflowTargets(data, promo);
    renderTabs(
      $("inflow-target-tabs"),
      targets.map((t) => ({ key: t.key, label: (t.shop ? "숍 전체" : t.name) + (t.added ? " ✕" : "") })),
      inflowState.target,
      (key) => { inflowState.target = key; drawBody(); }
    );
  }

  function drawBody() {
    const targets = inflowTargets(data, promo);
    const t = targets.find((x) => x.key === inflowState.target) || targets[0];
    const arr = t.shop ? data.shopDaily : data.skuDaily[t.code];

    if (!arr) {
      $("inflow-flow-top").innerHTML = `<div class="panel" style="grid-column:1/-1;">이 상품코드(${t.code})에 대한 유입 데이터가 없습니다.</div>`;
      $("inflow-accordion").innerHTML = "";
      $("flow-daily-table").querySelector("tbody").innerHTML = "";
      return;
    }

    const cur = aggregateRange(arr, promo.current.start, promo.current.end);
    const estTag = t.shop ? "" : ` <span class="badge-sku" style="color:var(--cur); background:var(--cur-bg);">SKU 실측 · 26)SHOP_유입현황 기준</span>`;

    $("inflow-flow-top").innerHTML = `
      <div class="flow-card total">
        <div class="fl">전체 유입 (PV) — ${t.shop ? "숍 전체" : t.name}${estTag}</div>
        <div class="fv num">${fmtNum(cur.totalInflow)}</div>
        <div class="fshare">전체유입 = 내부 + 외부</div>
      </div>
      <div class="flow-card">
        <div class="fl" style="color:var(--cur)">내부 유입</div>
        <div class="fv num">${fmtNum(cur.internalInflow)}</div>
        <div class="fshare">전체의 ${fmtPct(cur.internalRatio, 0)}</div>
        <div class="flow-bar-outer"><div class="flow-bar-in" style="width:${cur.internalRatio}%"></div></div>
      </div>
      <div class="flow-card">
        <div class="fl" style="color:var(--prev)">외부 유입</div>
        <div class="fv num">${fmtNum(cur.externalInflow)}</div>
        <div class="fshare">전체의 ${fmtPct(cur.externalRatio, 0)}</div>
        <div class="flow-bar-outer"><div class="flow-bar-ex" style="width:${cur.externalRatio}%"></div></div>
      </div>`;

    const breakdown = buildChannelBreakdown(cur.internalInflow, cur.externalInflow);
    renderAccordion($("inflow-accordion"), [
      { key: "internal", name: "내부 유입", color: "var(--cur)", val: cur.internalInflow, share: Math.round(cur.internalRatio), children: breakdown.internal },
      { key: "external", name: "외부 유입", color: "var(--prev)", val: cur.externalInflow, share: Math.round(cur.externalRatio), children: breakdown.external },
    ]);

    drawFlowDaily(arr);
  }

  function drawFlowDaily(arr) {
    const catField = inflowState.flowCat; // totalInflow | internalInflow | externalInflow
    const perDay = (rangeStart, rangeEnd) => {
      const n = daysBetween(rangeStart, rangeEnd);
      const out = [];
      for (let i = 0; i < n; i++) out.push(aggregateRows(rowsForDayOffset(arr, rangeStart, i))[catField]);
      return out;
    };
    const curDaily = perDay(promo.current.start, promo.current.end);
    const prevDaily = perDay(promo.previous.start, promo.previous.end);
    const yoyDaily = perDay(promo.yoy.start, promo.yoy.end);
    const dayLabels = buildPromoDayLabels(promo);
    const maxLen = Math.max(curDaily.length, prevDaily.length, yoyDaily.length);

    const sum = (arr2) => arr2.reduce((a, b) => a + (b || 0), 0);
    const rows = [{ label: "누계", c: sum(curDaily), p: sum(prevDaily), y: sum(yoyDaily) }];
    for (let i = 0; i < maxLen; i++) {
      rows.push({ label: dayLabels[i + 1] || `${i + 1}일차`, c: curDaily[i] ?? null, p: prevDaily[i] ?? null, y: yoyDaily[i] ?? null });
    }

    $("flow-daily-table").querySelector("tbody").innerHTML = rows
      .map((r, i) => {
        const prevDiff = r.c !== null && r.p !== null ? r.c - r.p : null;
        const yoyDiff = r.c !== null && r.y !== null ? r.c - r.y : null;
        const prevPct = prevDiff !== null ? pctDelta(r.c, r.p) : null;
        const yoyPct = yoyDiff !== null ? pctDelta(r.c, r.y) : null;
        return `<tr>
          <td class="name">${i === 0 ? `<b>${r.label}</b>` : r.label}</td>
          <td class="num">${r.c !== null ? fmtNum(r.c) : "—"}</td>
          <td class="num sub">${r.p !== null ? fmtNum(r.p) : "—"}</td>
          <td class="num sub">${r.y !== null ? fmtNum(r.y) : "—"}</td>
          <td class="num">${prevDiff !== null ? (prevDiff >= 0 ? "+" : "") + fmtNum(prevDiff) : "—"}</td>
          <td class="num">${deltaInlineHTML(prevPct)}</td>
          <td class="num">${yoyDiff !== null ? (yoyDiff >= 0 ? "+" : "") + fmtNum(yoyDiff) : "—"}</td>
          <td class="num">${deltaInlineHTML(yoyPct)}</td>
        </tr>`;
      })
      .join("");
  }

  renderTabs(
    $("flow-tabs"),
    [
      { key: "totalInflow", label: "전체유입" },
      { key: "internalInflow", label: "내부유입" },
      { key: "externalInflow", label: "외부유입" },
    ],
    inflowState.flowCat,
    (key) => { inflowState.flowCat = key; drawBody(); }
  );

  $("inflow-add-btn").onclick = () => {
    const input = $("inflow-add-input");
    const code = input.value.trim();
    if (!code) return;
    const list = inflowState.addedTargets[promo.id];
    if (!list.find((t) => t.code === code)) list.push({ name: "추가상품", code });
    inflowState.target = code;
    input.value = "";
    drawTargetTabs();
    drawBody();
  };

  drawTargetTabs();
  drawBody();
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
