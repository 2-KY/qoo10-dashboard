# Qoo10 매출/프로모션 분석 대시보드

BIOHEAL BOH(바이오힐보) Qoo10 스토어의 매출/프로모션/유입/쿠폰을 분석하는
내부 업무용 대시보드입니다. 승인된 UI/UX 목업을 기준으로 실제 개발된
정적 웹 애플리케이션이며, Vercel + GitHub로 배포/관리합니다.

## 1. 아키텍처

```
Google Sheet (Qoo10 매출 대시보드 Raw)
        │  (Apps Script가 주기적으로 실행)
        ▼
google-apps-script/Code.gs  ── 원본 시트를 읽어 대시보드용 JSON으로 가공
        │  (GitHub Contents API로 커밋)
        ▼
GitHub 저장소 (public-data/data.json)
        │  (raw.githubusercontent.com, CORS 허용)
        ▼
js/data.js  ── fetch로 JSON 로드 (실패 시 data/sample-data.json 폴백)
        ▼
js/screens.js + js/app.js ── 화면 렌더링 (순수 정적 HTML/CSS/JS, 빌드 불필요)
        ▼
Vercel 정적 배포
```

기존 Rakuten 대시보드(Apps Script → GitHub data.json → Vercel)와 동일한
검증된 구조를 그대로 따릅니다. 회사 보안 정책상 브라우저가 Google Sheet에
직접 접근할 수 없기 때문에, Apps Script가 중간에서 데이터를 가공해 GitHub에
커밋하고 프론트엔드는 그 결과만 읽는 방식입니다.

빌드 도구(webpack/vite 등) 없이 순수 ES 모듈만 사용하므로 Vercel은
별도 빌드 설정 없이 정적 사이트로 바로 배포됩니다.

## 2. 폴더 구조

```
qoo10-dashboard/
├── index.html                  # 앱 셸 (6개 화면의 DOM 컨테이너)
├── css/styles.css              # 전체 스타일 (승인된 목업 디자인 시스템)
├── js/
│   ├── config.js               # 데이터 소스 URL 등 환경설정
│   ├── data.js                 # GitHub → 샘플 데이터 순으로 fetch
│   ├── utils.js                # 날짜/구간 집계, 포맷팅 (금번/직전/전년 계산 핵심)
│   ├── components.js           # 재사용 UI 빌더 (KPI 카드, 트리플 비교 바, 탭 등)
│   ├── screens.js              # 6개 화면 렌더링 로직
│   └── app.js                  # 진입점 (네비게이션, 상단 필터, 초기화)
├── data/sample-data.json       # 로컬 개발/폴백용 샘플 데이터
├── scripts/generate-sample-data.js  # 샘플 데이터 생성 스크립트
├── google-apps-script/Code.gs  # Raw 시트 → GitHub JSON 업로드 스크립트
├── vercel.json
├── package.json
└── .gitignore
```

## 3. 로컬 개발

```bash
npm install -g serve   # 최초 1회 (또는 npx 사용)
npm run dev             # http://localhost:3000
```

`js/config.js`의 `GITHUB_DATA_URL`이 비어있으면 자동으로
`data/sample-data.json`을 사용합니다. 샘플 데이터를 다시 생성하려면:

```bash
npm run generate:sample
```

## 4. GitHub 연결 & Vercel 배포

```bash
git init
git add .
git commit -m "init: Qoo10 대시보드 최초 구축"
git remote add origin https://github.com/{org}/qoo10-dashboard.git
git push -u origin main
```

Vercel:
1. https://vercel.com → New Project → 방금 만든 GitHub 저장소 선택
2. Framework Preset: **Other** (빌드 명령 없음, Output Directory: `.`)
3. Deploy

배포 후 실데이터를 연결하려면 `js/config.js`의 `GITHUB_DATA_URL`을
Apps Script가 커밋할 GitHub raw JSON 경로로 채워 넣고 다시 배포하세요.
예:
```js
GITHUB_DATA_URL: "https://raw.githubusercontent.com/{org}/qoo10-dashboard/main/public-data/data.json"
```

## 5. Google Apps Script 설정 (실데이터 연동)

1. "Qoo10 매출 대시보드 Raw" 스프레드시트 열기 → 확장 프로그램 → Apps Script
2. `google-apps-script/Code.gs` 내용을 붙여넣기
3. 프로젝트 설정 → 스크립트 속성에 아래 값 추가:
   - `GITHUB_TOKEN` — repo 쓰기 권한이 있는 GitHub Personal Access Token
   - `GITHUB_REPO` — 예: `your-org/qoo10-dashboard`
   - `GITHUB_BRANCH` — 예: `main`
   - `GITHUB_DATA_PATH` — 예: `public-data/data.json`
4. `syncToGitHub` 함수 실행 권한 승인 (최초 1회 수동 실행)
5. 트리거 등록: `syncToGitHub`를 시간 기반(예: 1시간마다)으로 실행

## 6. 데이터 스키마 계약 (data.json)

```jsonc
{
  "generatedAt": "ISO 8601",
  "isSampleData": false,
  "meta": { "mainSkus": [{ "code": "...", "name": "..." }, ...] },
  "promotions": [
    {
      "id": "2026-05-megawari",
      "name": "메가와리", "year": 2026, "month": 5,
      "current":  { "start": "2026-05-20", "end": "2026-05-26" },
      "previous": { "start": "2026-03-18", "end": "2026-03-24", "label": "마라톤" },
      "yoy":      { "start": "2025-05-21", "end": "2025-05-27" },
      "isHalfDayFirst": true,
      "mainSkus": ["코드1", "코드2", ...]
    }
  ],
  "monthlyTargets": [{ "year": 2026, "month": 1, "target": 55000000 }, ...],
  "shopDaily": [
    { "date": "2026-01-01", "sales": 0, "orders": 0, "qty": 0, "uv": 0, "aov": 0,
      "newCustomers": 0, "existingCustomers": 0, "newRatio": 0, "existingRatio": 0,
      "totalInflow": 0, "internalInflow": 0, "externalInflow": 0 }
  ],
  "skuDaily": { "상품코드": [ /* shopDaily와 동일한 행 구조 */ ] },
  "coupons": { "confirmed": false, "note": "...", "items": [] }
}
```
`js/utils.js`의 모든 집계 함수(`aggregateRange`, `aggregateMonth`, `aggregateByDayOffset` 등)는
이 스키마를 전제로 동작합니다. Code.gs가 이 형태로 JSON을 생성하기만 하면
프론트엔드 코드는 수정할 필요가 없습니다.

## 7. 확인이 필요한 사항 (KY 확인 대기)

목업 단계에서 안내드렸던 항목이며, 실데이터 연동 전 확정이 필요합니다.
`Code.gs`에 `TODO(확인 필요)` 주석으로도 표시해 두었습니다.

| # | 항목 | 현재 구현 방식(임시) |
|---|---|---|
| 1 | 연간/월별 화면처럼 특정 프로모션에 종속되지 않는 화면의 "메인 SKU 마스터" 기준 | 전체 프로모션 P~Q열 SKU의 합집합 사용 |
| 2 | 신규/기존 고객 데이터 소스(SHOP_매출 vs 26)SHOP_고객현황) | SHOP_매출을 숍 전체 소스로 사용, 상품별 고객 Raw는 SKU 매칭용으로만 사용 |
| 3 | 26)SHOP_유입현황의 상품코드 컬럼명 | `Code.gs`의 `readInflowByProduct_`에 TODO로 표시 — 실제 헤더명 확인 후 한 줄만 수정하면 됨 |
| 4 | 프로모션 일별 분석의 "N일차" 정의(직전/전년 기간 길이가 다를 경우) | 각 기간 시작일 기준 상대 offset으로 정렬 (기간 길이가 짧으면 뒷부분은 데이터 없음) |
| 5 | 쿠폰 Raw 컬럼 구조 | 미확인 — `coupons.confirmed:false`로 두고 프론트에 경고 배너 표시 중 |
| 6 | 월별 대시보드에서 해당 월에 프로모션이 없을 때의 직전/전년 비교 기준 | 캘린더 기준(전월/전년 동월)으로 폴백, 화면에 "캘린더 기준" 라벨로 명시 |
| 7 | 프로모션 비교/일별 분석에서 "고정(pin)"한 추가 상품의 영구 저장 방식 | 현재는 브라우저 세션 내 메모리에만 유지(새로고침 시 초기화). 영구 저장이 필요하면 GitHub 데이터에 `pinnedProducts` 배열을 추가하거나, Vercel KV/Edge Config 등 별도 저장소 연동이 필요 — 방식 결정 후 추가 개발 필요 |
| 8 | 메가와리 "0.5일차" 같은 half-day 규칙을 시트 컬럼으로 관리할지, 프로모션명 하드코딩으로 관리할지 | 현재 `Code.gs`에 프로모션명 매칭(`HALF_DAY_PROMO_NAMES`)으로 임시 구현 |

## 8. 다음 단계 제안

1. 위 8개 항목 확인
2. `Code.gs`의 `TODO` 부분(특히 시트 헤더명)을 실제 시트에 맞게 조정
3. Apps Script 스크립트 속성에 GitHub 토큰 등록 후 `syncToGitHub` 1회 수동 실행
4. `js/config.js`의 `GITHUB_DATA_URL` 연결 후 Vercel 재배포
5. 실데이터로 6개 화면 전체 검증
