/**
 * data.js — 데이터 로딩
 *
 * 1) CONFIG.GITHUB_DATA_URL 이 설정되어 있으면 그것을 우선 시도합니다.
 * 2) 실패하거나 비어있으면 로컬 샘플 데이터(./data/sample-data.json)로 폴백합니다.
 *
 * 이 구조는 기존 Rakuten 대시보드와 동일한 "Apps Script → GitHub data.json →
 * 프론트엔드 fetch" 아키텍처를 따릅니다. Google Sheet에는 회사 보안 정책상
 * 브라우저가 직접 접근하지 못하므로, Apps Script가 중간에서 데이터를 가공해
 * GitHub에 커밋하고 프론트엔드는 그 결과만 읽습니다.
 */
import { CONFIG } from "./config.js";

function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { signal: controller.signal, cache: "no-store" }).finally(() =>
    clearTimeout(timer)
  );
}

export async function loadData() {
  // 1) 실운영 데이터 시도
  if (CONFIG.GITHUB_DATA_URL) {
    try {
      const res = await fetchWithTimeout(CONFIG.GITHUB_DATA_URL, CONFIG.FETCH_TIMEOUT_MS);
      if (res.ok) {
        const json = await res.json();
        json.__source = "github";
        return json;
      }
    } catch (e) {
      console.warn("[data.js] GitHub 데이터 로드 실패, 샘플 데이터로 폴백합니다:", e.message);
    }
  }

  // 2) 로컬 샘플 데이터 폴백
  try {
    const res = await fetchWithTimeout(CONFIG.LOCAL_SAMPLE_URL, CONFIG.FETCH_TIMEOUT_MS);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    json.__source = "sample";
    return json;
  } catch (e) {
    throw new Error("데이터를 불러오지 못했습니다 (GitHub / 샘플 데이터 모두 실패): " + e.message);
  }
}
