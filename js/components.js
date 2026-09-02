/**
 * components.js — 재사용 가능한 UI 빌더
 * 모든 화면(screens.js)에서 공통으로 사용하는 시그니처 요소(트리플 비교 바),
 * 탭, 필/아코디언 등을 이곳에 모아 중복을 줄입니다.
 */
import { deltaChipHTML, deltaInlineHTML, pctDelta, ppDelta } from "./utils.js";

export function kpiCardHTML({ label, value, prevPct = null, yoyPct = null, isPP = false, sizeSmall = false }) {
  const chips =
    prevPct !== null || yoyPct !== null
      ? `<div class="kpi-sub">${deltaChipHTML(prevPct, isPP)}${deltaChipHTML(yoyPct, isPP)}</div>`
      : "";
  return `<div class="kpi-card">
    <div class="kpi-label">${label}</div>
    <div class="kpi-value num" ${sizeSmall ? 'style="font-size:16px;"' : ""}>${value}</div>
    ${chips}
  </div>`;
}

// 시그니처 요소: 금번/직전/전년 트리플 비교 바
// cur/prev/yoy는 null일 수 있음(직전·전년 기간이 프로모션_항목에 정의되지 않았거나
// 해당 구간에 실적 데이터가 없는 경우) — 이 경우 바 길이는 0으로 그리되,
// 값 텍스트는 fmt()가 그대로 "—"로 표시하도록 둔다(0과 데이터 없음을 혼동하지 않기 위함).
export function triCompareBarHTML({ label, cur, prev, yoy, fmt, prevPct, yoyPct, isPP = false }) {
  const safe = (v) => (v === null || v === undefined || isNaN(v) ? 0 : v);
  const max = Math.max(safe(cur), safe(prev), safe(yoy), 1);
  return `<div class="kpi-card">
    <div class="kpi-label">${label}</div>
    <div class="kpi-value num">${fmt(cur)}</div>
    <div class="kpi-sub">${deltaChipHTML(prevPct, isPP)}${deltaChipHTML(yoyPct, isPP)}</div>
    <div class="tri">
      <div class="tri-row"><span class="tri-tag">금번</span><div class="tri-track"><div class="tri-fill cur" style="width:${(safe(cur) / max) * 100}%"></div></div><span class="tri-val num">${fmt(cur)}</span></div>
      <div class="tri-row"><span class="tri-tag">직전</span><div class="tri-track"><div class="tri-fill prev" style="width:${(safe(prev) / max) * 100}%"></div></div><span class="tri-val num">${fmt(prev)}</span></div>
      <div class="tri-row"><span class="tri-tag">전년</span><div class="tri-track"><div class="tri-fill yoy" style="width:${(safe(yoy) / max) * 100}%"></div></div><span class="tri-val num">${fmt(yoy)}</span></div>
    </div>
  </div>`;
}

// ----------------------------------------------------------------
// 지표를 세로로, 비교 기준(금번/직전/전년/…)을 가로로 배치하는 표준 비교표.
// 열 순서 고정: 구분 | 금번 | 직전 | 전년 | 직전차 | 직전비 | 전년차 | 전년비
// (KY 확정 — 순서 변경 금지). metrics[i] = { label, cur, prev, yoy, fmt, isPP }
// cur/prev/yoy가 null이면 "데이터 없음"으로 처리하고 증감도 계산하지 않는다
// (0으로 대체하지 않음 — "프로모션 일별 분석" 화면의 금번/직전/전년 비교표 전용).
// ----------------------------------------------------------------
function hasVal(v) {
  return v !== null && v !== undefined && !isNaN(v);
}
function fmtDiff(diff, fmt, isPP) {
  if (diff === null) return "—";
  const sign = diff >= 0 ? "+" : "";
  return isPP ? `${sign}${diff.toFixed(1)}%p` : `${sign}${fmt(diff)}`;
}
// 지표 하나(한 행)만 <tr> 문자열로 만든다 — renderMetricCompareRows의 내부 로직을
// 그대로 재사용하되, 그룹 헤더 행 등 다른 행과 섞어서 렌더링해야 하는 화면(유입 분석의
// 채널 그룹 목록 등)에서 tbody 전체가 아니라 행 단위로 필요할 때 쓴다.
export function metricRowHTML(m) {
  const { label, cur, prev, yoy, fmt, isPP = false, indent = false } = m;
  const curTxt = hasVal(cur) ? fmt(cur) : "—";
  const prevTxt = hasVal(prev) ? fmt(prev) : "—";
  const yoyTxt = hasVal(yoy) ? fmt(yoy) : "—";
  const prevDiff = hasVal(cur) && hasVal(prev) ? cur - prev : null;
  const yoyDiff = hasVal(cur) && hasVal(yoy) ? cur - yoy : null;
  const prevPct = prevDiff === null ? null : isPP ? ppDelta(cur, prev) : pctDelta(cur, prev);
  const yoyPct = yoyDiff === null ? null : isPP ? ppDelta(cur, yoy) : pctDelta(cur, yoy);
  return `<tr>
    <td class="name"${indent ? ' style="padding-left:32px; color:var(--text-sub); font-weight:500;"' : ""}>${label}</td>
    <td class="num" style="color:var(--cur); font-weight:700;">${curTxt}</td>
    <td class="num sub">${prevTxt}</td>
    <td class="num sub">${yoyTxt}</td>
    <td class="num">${fmtDiff(prevDiff, fmt, isPP)}</td>
    <td class="num">${deltaInlineHTML(prevPct, isPP)}</td>
    <td class="num">${fmtDiff(yoyDiff, fmt, isPP)}</td>
    <td class="num">${deltaInlineHTML(yoyPct, isPP)}</td>
  </tr>`;
}
export function renderMetricCompareRows(tbody, metrics) {
  tbody.innerHTML = metrics.map(metricRowHTML).join("");
}

// 탭 바: container에 렌더링하고 클릭 이벤트를 바인딩
export function renderTabs(container, tabs, activeKey, onChange) {
  container.innerHTML = tabs
    .map((t) => `<div class="tab ${t.key === activeKey ? "active" : ""}" data-key="${t.key}">${t.label}</div>`)
    .join("");
  container.querySelectorAll(".tab").forEach((el) => {
    el.addEventListener("click", () => {
      container.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
      el.classList.add("active");
      onChange(el.dataset.key);
    });
  });
}

// 일자 선택 필: container에 렌더링하고 클릭 이벤트를 바인딩
export function renderPills(container, labels, selectedIndex, onSelect) {
  container.innerHTML = labels
    .map((l, i) => `<div class="pill ${i === selectedIndex ? "active" : ""}" data-i="${i}">${l}</div>`)
    .join("");
  container.querySelectorAll(".pill").forEach((el) => {
    el.addEventListener("click", () => {
      container.querySelectorAll(".pill").forEach((x) => x.classList.remove("active"));
      el.classList.add("active");
      onSelect(parseInt(el.dataset.i, 10));
    });
  });
}

// 드릴다운 아코디언 (유입 분석 화면 카테고리별 세부 채널)
export function renderAccordion(container, groups) {
  container.innerHTML = "";
  groups.forEach((group) => {
    const maxChild = Math.max(...group.children.map((c) => c.val), 1);
    const detailHTML = group.children
      .map(
        (c) => `
      <div class="detail-row">
        <div class="detail-name">${c.name}</div>
        <div class="detail-track"><div class="detail-fill" style="width:${(c.val / maxChild) * 100}%; background:${group.color};"></div></div>
        <div class="detail-val">${c.val.toLocaleString()}</div>
      </div>`
      )
      .join("");
    container.innerHTML += `
      <div class="acc-head" data-key="${group.key}">
        <div class="acc-left"><span class="acc-dot" style="background:${group.color}"></span>
          <span class="acc-title">${group.name}</span><span class="acc-meta">${group.children.length}개 세부 채널</span></div>
        <div class="acc-right"><span class="acc-val num">${group.val.toLocaleString()} <span style="color:var(--text-faint); font-weight:600;">(${group.share}%)</span></span><span class="acc-chev">▾</span></div>
      </div>
      <div class="acc-body" id="body-${group.key}"><div class="acc-body-inner">${detailHTML}</div></div>`;
  });
  container.querySelectorAll(".acc-head").forEach((h) => {
    h.addEventListener("click", () => {
      const body = document.getElementById("body-" + h.dataset.key);
      const chev = h.querySelector(".acc-chev");
      const open = body.classList.toggle("open");
      chev.style.transform = open ? "rotate(180deg)" : "rotate(0deg)";
    });
  });
}

export function skuBadgeHTML(code) {
  return code ? `<span class="badge-sku">${code}</span>` : "";
}
export function estimateBadgeHTML(isShop) {
  return isShop
    ? ` <span class="badge-sku" style="color:var(--yoy); background:var(--yoy-bg);">실측</span>`
    : ` <span class="badge-sku" style="color:var(--prev); background:var(--prev-bg);">추정</span>`;
}
