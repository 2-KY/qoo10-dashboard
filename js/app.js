/**
 * app.js — 앱 진입점
 * 데이터 로딩 → 좌측 네비게이션 / 상단 필터 바 구성 → 화면별 렌더 함수 호출
 */
import { CONFIG } from "./config.js";
import { loadData } from "./data.js";
import { renderAnnual, renderMonthly, renderPromo, renderDaily, renderInflow, renderCoupon, renderReport } from "./screens.js";

const $ = (id) => document.getElementById(id);

let DATA = null;
let currentScreen = "annual";

// 화면별 선택 상태
const state = {
  annualYear: null,
  monthlyYear: null,
  monthlyMonth: null,
  promoId: null,
  dailyPromoId: null,
  inflowPromoId: null,
  couponPromoId: null,
  reportPromoId: null,
};

function availableYears() {
  const years = new Set(DATA.shopDaily.map((r) => r.date.slice(0, 4)));
  return [...years].map(Number).sort((a, b) => b - a);
}

function promoOptions() {
  return DATA.promotions
    .slice()
    .sort((a, b) => (a.current.start < b.current.start ? 1 : -1))
    .map((p) => ({ value: p.id, label: `${p.year}년 ${p.month}월 · ${p.name}` }));
}

/* ---------------------------------------------------------------
   상단 필터 바 구성 (화면별로 다름)
   --------------------------------------------------------------- */
function buildTopbar() {
  const topbar = $("topbar");
  const titles = {
    annual: "연간 대시보드",
    monthly: "월별 대시보드",
    promo: "프로모션 비교",
    daily: "프로모션 일별 분석",
    inflow: "유입 분석",
    coupon: "쿠폰 분석",
    report: "프로모션 보고",
  };
  let filtersHTML = "";

  if (currentScreen === "annual") {
    filtersHTML = `<select class="dd-select" id="f-annual-year">${availableYears()
      .map((y) => `<option value="${y}" ${y === state.annualYear ? "selected" : ""}>${y}</option>`)
      .join("")}</select>`;
  } else if (currentScreen === "monthly") {
    const months = Array.from({ length: 12 }, (_, i) => i + 1);
    filtersHTML = `
      <select class="dd-select" id="f-monthly-year">${availableYears()
        .map((y) => `<option value="${y}" ${y === state.monthlyYear ? "selected" : ""}>${y}</option>`)
        .join("")}</select>
      <select class="dd-select" id="f-monthly-month">${months
        .map((m) => `<option value="${m}" ${m === state.monthlyMonth ? "selected" : ""}>${String(m).padStart(2, "0")}월</option>`)
        .join("")}</select>`;
  } else if (currentScreen === "promo") {
    filtersHTML = `<select class="dd-select" id="f-promo">${promoOptions()
      .map((o) => `<option value="${o.value}" ${o.value === state.promoId ? "selected" : ""}>${o.label}</option>`)
      .join("")}</select>`;
  } else if (currentScreen === "daily") {
    filtersHTML = `<select class="dd-select" id="f-daily-promo">${promoOptions()
      .map((o) => `<option value="${o.value}" ${o.value === state.dailyPromoId ? "selected" : ""}>${o.label}</option>`)
      .join("")}</select>`;
  } else if (currentScreen === "inflow") {
    filtersHTML = `<select class="dd-select" id="f-inflow-promo">${promoOptions()
      .map((o) => `<option value="${o.value}" ${o.value === state.inflowPromoId ? "selected" : ""}>${o.label}</option>`)
      .join("")}</select>`;
  } else if (currentScreen === "coupon") {
    filtersHTML = `<select class="dd-select" id="f-coupon-promo">${promoOptions()
      .map((o) => `<option value="${o.value}" ${o.value === state.couponPromoId ? "selected" : ""}>${o.label}</option>`)
      .join("")}</select>`;
  } else if (currentScreen === "report") {
    filtersHTML = `<select class="dd-select" id="f-report-promo">${promoOptions()
      .map((o) => `<option value="${o.value}" ${o.value === state.reportPromoId ? "selected" : ""}>${o.label}</option>`)
      .join("")}</select>`;
  }

  const isSample = DATA.__source === "sample";
  const badge = isSample
    ? `<div class="mockbadge sample"><span class="pulse"></span>샘플 데이터 (GitHub 미연결)</div>`
    : `<div class="mockbadge"><span class="pulse"></span>실데이터 연동됨</div>`;

  topbar.innerHTML = `<h1>${titles[currentScreen]}</h1><div class="filters">${filtersHTML}</div><div class="spacer"></div>${badge}`;

  // 이벤트 바인딩
  const bind = (id, handler) => { const el = $(id); if (el) el.addEventListener("change", handler); };
  bind("f-annual-year", (e) => { state.annualYear = Number(e.target.value); renderAnnual(DATA, state.annualYear); });
  bind("f-monthly-year", (e) => { state.monthlyYear = Number(e.target.value); renderMonthly(DATA, state.monthlyYear, state.monthlyMonth); });
  bind("f-monthly-month", (e) => { state.monthlyMonth = Number(e.target.value); renderMonthly(DATA, state.monthlyYear, state.monthlyMonth); });
  bind("f-promo", (e) => { state.promoId = e.target.value; renderPromo(DATA, state.promoId); });
  bind("f-daily-promo", (e) => { state.dailyPromoId = e.target.value; renderDaily(DATA, state.dailyPromoId); });
  bind("f-inflow-promo", (e) => { state.inflowPromoId = e.target.value; renderInflow(DATA, state.inflowPromoId); });
  bind("f-coupon-promo", (e) => { state.couponPromoId = e.target.value; renderCoupon(DATA, state.couponPromoId); });
  bind("f-report-promo", (e) => { state.reportPromoId = e.target.value; renderReport(DATA, state.reportPromoId); });
}

/* ---------------------------------------------------------------
   네비게이션
   --------------------------------------------------------------- */
function switchScreen(key) {
  currentScreen = key;
  document.querySelectorAll(".navitem").forEach((n) => n.classList.toggle("active", n.dataset.nav === key));
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.dataset.screen === key));
  buildTopbar();
  window.scrollTo(0, 0);
}

document.querySelectorAll(".navitem").forEach((el) => {
  el.addEventListener("click", () => switchScreen(el.dataset.nav));
});

/* ---------------------------------------------------------------
   초기화
   --------------------------------------------------------------- */
async function init() {
  try {
    DATA = await loadData();
  } catch (e) {
    $("loading-state").style.display = "none";
    const err = $("error-state");
    err.style.display = "block";
    err.textContent = "⚠️ " + e.message;
    return;
  }

  // 초기 상태 값 설정
  const years = availableYears();
  state.annualYear = years[0];
  state.monthlyYear = years[0];
  state.monthlyMonth = new Date().getMonth() + 1;
  const promos = promoOptions();
  state.promoId = promos[0] ? promos[0].value : null;
  state.dailyPromoId = state.promoId;
  state.inflowPromoId = state.promoId;
  state.couponPromoId = state.promoId;
  state.reportPromoId = state.promoId;

  // 사이드바 데이터 소스 배지
  $("data-source-badge").textContent =
    DATA.__source === "sample"
      ? `샘플 데이터 · ${new Date(DATA.generatedAt).toLocaleDateString("ko-KR")} 생성`
      : `실데이터 · ${new Date(DATA.generatedAt).toLocaleString("ko-KR")} 갱신`;

  // 모든 화면 렌더 (사이드바 전환 시 재계산 없이 즉시 표시되도록 최초 1회 전체 렌더)
  renderAnnual(DATA, state.annualYear);
  renderMonthly(DATA, state.monthlyYear, state.monthlyMonth);
  if (state.promoId) {
    renderPromo(DATA, state.promoId);
    renderDaily(DATA, state.dailyPromoId);
    renderInflow(DATA, state.inflowPromoId);
    renderCoupon(DATA, state.couponPromoId);
    renderReport(DATA, state.reportPromoId);
  }

  buildTopbar();
  $("loading-state").style.display = "none";
  $("content").style.display = "block";
}

init();
