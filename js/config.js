/**
 * config.js — 배포 환경 설정
 *
 * 데이터 소스 우선순위:
 *   1) GITHUB_DATA_URL  — Google Apps Script(Code.gs)가 주기적으로 커밋하는
 *      실운영 data.json (raw.githubusercontent.com, CORS 허용됨)
 *   2) LOCAL_SAMPLE_URL — 이 저장소에 포함된 샘플 데이터 (로컬 개발 / 폴백)
 *
 * ⚠️ GITHUB_DATA_URL은 실제 GitHub 저장소 생성 후 아래 값을 교체해야 합니다.
 *    예: https://raw.githubusercontent.com/{org}/{repo}/main/public-data/data.json
 */
export const CONFIG = {
  GITHUB_DATA_URL: "", // TODO: 실제 데이터 저장소 연결 시 채워넣기
  LOCAL_SAMPLE_URL: "./data/sample-data.json",
  FETCH_TIMEOUT_MS: 6000,
  APP_NAME: "Qoo10 Analytics",
  APP_SUB: "BIOHEAL BOH · 바이오힐보",
};
