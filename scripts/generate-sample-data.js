#!/usr/bin/env node
/**
 * generate-sample-data.js
 * ------------------------------------------------------------------
 * 로컬 개발 / 데모용 샘플 데이터(data/sample-data.json)를 생성합니다.
 *
 * 이 파일이 만드는 JSON 구조는 실제 운영 시 Google Apps Script(Code.gs)가
 * Raw 시트를 읽어 계산한 뒤 GitHub에 커밋하는 data.json과 "동일한 스키마"를
 * 따릅니다. 즉, 이 스크립트는 실데이터 연동 전까지 대시보드를 개발/검증하기
 * 위한 목적이며, 실제 운영 데이터는 이 스크립트가 아니라 Code.gs가 생성합니다.
 *
 * 실행: node scripts/generate-sample-data.js
 * ------------------------------------------------------------------
 */
const fs = require("fs");
const path = require("path");

function rnd(min, max) { return min + Math.random() * (max - min); }
function rndInt(min, max) { return Math.round(rnd(min, max)); }
function dateStr(d) { return d.toISOString().slice(0, 10); }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }

// ------------------------------------------------------------------
// 1. 메인 SKU 마스터 (실제로는 프로모션_항목 P~Q열의 합집합으로 산출됨)
// ------------------------------------------------------------------
const MAIN_SKUS = [
  { code: "1043733766", name: "3D 리필크림" },
  { code: "1043733770", name: "3D 크림 단품" },
  { code: "1051220981", name: "세라마이드 앰플" },
  { code: "1051221055", name: "클렌징 폼" },
  { code: "1051221102", name: "토너 200ml" },
  { code: "1051221118", name: "토너 400ml" },
  { code: "1051221204", name: "에센스" },
  { code: "1051221331", name: "선크림" },
  { code: "1051221402", name: "기획 박스 세트" },
];

// ------------------------------------------------------------------
// 2. 프로모션_항목 (연간 4개 정도의 대표 프로모션 예시)
// ------------------------------------------------------------------
const PROMOTIONS = [
  {
    id: "2026-05-megawari",
    name: "메가와리",
    year: 2026, month: 5,
    current: { start: "2026-05-20", end: "2026-05-26" },
    previous: { start: "2026-03-18", end: "2026-03-24", label: "마라톤" },
    yoy: { start: "2025-05-21", end: "2025-05-27" },
    note: "메가와리는 첫날 17시부터 진행되어 0.5일차로 카운트",
    isHalfDayFirst: true,
    mainSkus: MAIN_SKUS.map(s => s.code),
  },
  {
    id: "2026-03-marathon",
    name: "마라톤",
    year: 2026, month: 3,
    current: { start: "2026-03-18", end: "2026-03-24" },
    previous: { start: "2026-01-15", end: "2026-01-21", label: "신년세일" },
    yoy: { start: "2025-03-19", end: "2025-03-25" },
    note: "",
    isHalfDayFirst: false,
    mainSkus: MAIN_SKUS.map(s => s.code),
  },
  {
    id: "2026-06-superSale",
    name: "슈퍼세일",
    year: 2026, month: 6,
    current: { start: "2026-06-10", end: "2026-06-16" },
    previous: { start: "2026-05-20", end: "2026-05-26", label: "메가와리" },
    yoy: { start: "2025-06-11", end: "2025-06-17" },
    note: "",
    isHalfDayFirst: false,
    mainSkus: MAIN_SKUS.map(s => s.code),
  },
];

// ------------------------------------------------------------------
// 3. 월별 목표매출 (프로모션_항목 L~N열)
// ------------------------------------------------------------------
const MONTHLY_TARGETS = Array.from({ length: 12 }, (_, i) => ({
  year: 2026,
  month: i + 1,
  target: 55000000 + i * 800000,
}));

// ------------------------------------------------------------------
// 4. 숍 전체 일별 데이터 (SHOP_매출 + SHOP_유입현황 + SHOP_고객현황 결합 결과)
//    실제로는 Code.gs가 세 Raw 시트를 상품코드/날짜 기준으로 조인하여 생성
// ------------------------------------------------------------------
function buildShopDaily() {
  const rows = [];
  const start = new Date("2025-01-01");
  const end = new Date("2026-08-10"); // 오늘 기준 (샘플 목적)
  let d = start;
  while (d <= end) {
    const base = 1300000 + Math.sin(d.getTime() / 8.64e7 / 30) * 300000;
    const weekendBoost = [0, 6].includes(d.getDay()) ? 1.15 : 1.0;
    const sales = Math.round(base * weekendBoost * rnd(0.85, 1.25));
    const orders = Math.round(sales / rnd(4600, 5400));
    const qty = Math.round(orders * rnd(1.35, 1.55));
    const uv = Math.round(sales / rnd(4.6, 5.6));
    const totalInflow = Math.round(uv * rnd(1.02, 1.08)); // PV >= UV
    const inRatio = rnd(0.62, 0.76);
    const internalInflow = Math.round(totalInflow * inRatio);
    const externalInflow = totalInflow - internalInflow;
    const newRatio = rnd(0.30, 0.46);
    const newCustomers = Math.round(orders * newRatio);
    const existingCustomers = orders - newCustomers;
    rows.push({
      date: dateStr(d),
      sales, orders, qty, uv,
      aov: Math.round(sales / orders),
      newCustomers, existingCustomers,
      newRatio: +(newCustomers / orders * 100).toFixed(1),
      existingRatio: +(existingCustomers / orders * 100).toFixed(1),
      totalInflow, internalInflow, externalInflow,
    });
    d = addDays(d, 1);
  }
  return rows;
}

// ------------------------------------------------------------------
// 5. SKU별 일별 데이터 (26)SHOP_거래현황 + 상품별 고객 Raw + 26)SHOP_유입현황 상품코드 기준)
// ------------------------------------------------------------------
function buildSkuDaily(shopDaily) {
  const out = {};
  MAIN_SKUS.forEach((sku) => {
    const shareBase = rnd(0.03, 0.16); // 이 SKU가 숍 전체에서 차지하는 평균 비중
    out[sku.code] = shopDaily.map((row) => {
      const share = shareBase * rnd(0.7, 1.3);
      const sales = Math.round(row.sales * share);
      const qty = Math.round(row.qty * share * rnd(0.9, 1.1));
      const orders = Math.round(row.orders * share * rnd(0.9, 1.1));
      const uv = Math.round(row.uv * share * rnd(0.8, 1.3));
      const totalInflow = Math.round(uv * rnd(1.02, 1.1));
      const inRatio = rnd(0.60, 0.78);
      const internalInflow = Math.round(totalInflow * inRatio);
      const externalInflow = totalInflow - internalInflow;
      const newRatio = rnd(0.28, 0.5);
      return {
        date: row.date,
        sales, qty, orders, uv,
        newRatio: +(newRatio * 100).toFixed(1),
        existingRatio: +((1 - newRatio) * 100).toFixed(1),
        totalInflow, internalInflow, externalInflow,
      };
    });
  });
  return out;
}

// ------------------------------------------------------------------
// 6. 쿠폰 (Raw 컬럼 미확인 — 구조만 예시로 존재, confirmed:false)
// ------------------------------------------------------------------
const COUPONS = {
  confirmed: false,
  note: "쿠폰 Raw 시트 컬럼 구조가 아직 확인되지 않았습니다. 아래 항목은 예상 레이아웃이며 실제 계산 가능한 KPI만 추후 반영됩니다.",
  items: [
    { promotionId: "2026-05-megawari", name: "메가와리 전용 10% 쿠폰", condition: "¥5,000 이상 구매시", issued: 50000, used: 12400 },
    { promotionId: "2026-05-megawari", name: "신규회원 특가 쿠폰", condition: "¥3,000 이상 구매시", issued: 20000, used: 8100 },
    { promotionId: "2026-05-megawari", name: "3D리필크림 세트 쿠폰", condition: "해당 SKU 구매시 ¥800 할인", issued: 15000, used: 5200 },
  ],
};

// ------------------------------------------------------------------
// 조립 및 저장
// ------------------------------------------------------------------
const shopDaily = buildShopDaily();
const skuDaily = buildSkuDaily(shopDaily);

const output = {
  generatedAt: new Date().toISOString(),
  isSampleData: true,
  meta: {
    mainSkus: MAIN_SKUS,
  },
  monthlyTargets: MONTHLY_TARGETS,
  promotions: PROMOTIONS,
  shopDaily,
  skuDaily,
  coupons: COUPONS,
};

const outPath = path.join(__dirname, "..", "data", "sample-data.json");
fs.writeFileSync(outPath, JSON.stringify(output));
console.log(`생성 완료: ${outPath}`);
console.log(`- shopDaily: ${shopDaily.length}행`);
console.log(`- skuDaily: ${MAIN_SKUS.length}개 SKU`);
console.log(`- promotions: ${PROMOTIONS.length}개`);
