/**
 * components.js — 재사용 가능한 UI 빌더
 * 모든 화면(screens.js)에서 공통으로 사용하는 시그니처 요소(트리플 비교 바),
 * 탭, 필/아코디언 등을 이곳에 모아 중복을 줄입니다.
 */
import { deltaChipHTML } from "./utils.js";

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
export function triCompareBarHTML({ label, cur, prev, yoy, fmt, prevPct, yoyPct, isPP = false }) {
  const max = Math.max(cur, prev, yoy, 1);
  return `<div class="kpi-card">
    <div class="kpi-label">${label}</div>
    <div class="kpi-value num">${fmt(cur)}</div>
    <div class="kpi-sub">${deltaChipHTML(prevPct, isPP)}${deltaChipHTML(yoyPct, isPP)}</div>
    <div class="tri">
      <div class="tri-row"><span class="tri-tag">금번</span><div class="tri-track"><div class="tri-fill cur" style="width:${(cur / max) * 100}%"></div></div><span class="tri-val num">${fmt(cur)}</span></div>
      <div class="tri-row"><span class="tri-tag">직전</span><div class="tri-track"><div class="tri-fill prev" style="width:${(prev / max) * 100}%"></div></div><span class="tri-val num">${fmt(prev)}</span></div>
      <div class="tri-row"><span class="tri-tag">전년</span><div class="tri-track"><div class="tri-fill yoy" style="width:${(yoy / max) * 100}%"></div></div><span class="tri-val num">${fmt(yoy)}</span></div>
    </div>
  </div>`;
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
