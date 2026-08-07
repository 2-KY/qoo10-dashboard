# 라쿠텐 BOH 매출 대시보드

Google Sheets(gviz/JSONP)에서 데이터를 실시간으로 불러오는 정적(static) 웹 대시보드입니다.
서버/빌드 과정이 없는 순수 HTML+CSS+JS 프로젝트라 Vercel에 그대로 올리면 바로 동작합니다.

## 파일 구성

```
vercel-dashboard/
├── index.html     # 페이지 구조 (마크업만)
├── styles.css      # 전체 스타일
├── app.js          # 전체 로직 + 스냅샷 데이터(fallback) + Google Sheets 실시간 연동
└── vercel.json     # Vercel 배포 설정 (캐시/보안 헤더)
```

- **데이터 연동은 그대로입니다.** `app.js` 안의 `DOC_ID`, `SHEETS` 상수가 기존과 동일한 Google Sheets 문서/시트를 가리키고, 페이지가 열릴 때 gviz(JSONP) 방식으로 최신 값을 가져옵니다. 시트가 "링크가 있는 모든 사용자"로 공유되어 있어야 하는 조건도 동일합니다.
- 최초 로딩 시 또는 시트 접근이 실패할 때는 `app.js`에 내장된 스냅샷 데이터로 우선 표시되고, "시트에서 다시 불러오기" 버튼으로 최신값을 다시 받아옵니다.

## Vercel 배포 방법

### 방법 A. Vercel CLI로 바로 배포 (가장 빠름)

1. [Node.js](https://nodejs.org)가 설치되어 있어야 합니다 (npx 사용).
2. 터미널에서 이 폴더(`vercel-dashboard`)로 이동합니다.
3. 아래 명령을 실행합니다.

   ```bash
   npx vercel
   ```

4. 처음 실행하면 Vercel 계정 로그인(이메일 또는 GitHub)을 요청합니다. 안내에 따라 로그인합니다.
5. 이후 질문에는 기본값(Enter)으로 진행해도 됩니다.
   - "Set up and deploy?" → Y
   - "Which scope?" → 본인 계정 선택
   - "Link to existing project?" → N (처음이라면)
   - "What's your project's name?" → 원하는 이름 입력 (예: `boh-sales-dashboard`)
   - "In which directory is your code located?" → `./` (그대로 Enter)
   - 빌드 설정 관련 질문은 전부 기본값(Enter)으로 진행 (빌드 명령 없음/정적 파일이므로)
6. 배포가 끝나면 `https://프로젝트이름.vercel.app` 형태의 URL이 출력됩니다. 이 주소로 접속하면 바로 대시보드가 열립니다.
7. 이후 파일을 수정하고 다시 배포하려면 같은 폴더에서 `npx vercel --prod`를 실행하면 됩니다.

### 방법 B. GitHub 연동 (자동 배포, 팀 공유에 유리)

1. 이 폴더를 GitHub 저장소로 올립니다.
   ```bash
   git init
   git add .
   git commit -m "초기 대시보드"
   git branch -M main
   git remote add origin <본인의 GitHub 저장소 URL>
   git push -u origin main
   ```
2. [vercel.com](https://vercel.com)에 접속해 로그인 후 **"Add New… → Project"**를 클릭합니다.
3. 방금 만든 GitHub 저장소를 선택하고 **Import**합니다.
4. Framework Preset은 **"Other"**(정적 사이트)로 자동 인식됩니다. Build Command/Output Directory는 비워둔 채로 **Deploy**를 누릅니다.
5. 배포가 끝나면 `https://프로젝트이름.vercel.app` 주소가 발급됩니다.
6. 이후 GitHub에 `git push`만 하면 Vercel이 자동으로 재배포합니다.

### 방법 C. 드래그 앤 드롭 (가장 간단, Git 몰라도 가능)

1. [vercel.com](https://vercel.com) 로그인 → 대시보드 화면에서 **"Add New… → Project"**
2. 화면에 나오는 업로드 영역에 `vercel-dashboard` 폴더를 통째로 드래그 앤 드롭합니다.
3. Deploy를 누르면 끝. URL이 발급됩니다.

## 신규: 추가 SKU 카드 / 채널 설정 저장용 API 설정 (③⑥탭 재구성용)

③탭 "추가 SKU 카드"(추가/고정/삭제)와 ⑥탭 "채널 설정"은 브라우저 캐시 삭제·재배포에도 사라지지 않아야 합니다.

처음에는 Apps Script를 웹 앱으로 배포해 대시보드가 직접 호출하는 구조로 만들었지만, **회사 Google Workspace 보안 정책상 Apps Script 웹 앱을 "모든 사용자(Anyone)"로 배포할 수 없어**(선택 가능한 옵션이 "나만"/"조직 전체"뿐) 익명 방문자가 보는 이 공개 대시보드에서는 그 방식이 동작하지 않습니다. 그래서 쓰기 경로를 **이 Vercel 프로젝트 자체의 서버리스 함수(`api/cards.js`)** 로 옮겼습니다 — 대시보드가 같은 오리진(`/api/cards`)으로 호출하므로 CORS/로그인 문제가 없고, 이 함수만 `GITHUB_TOKEN`을 서버 쪽 환경변수로 들고 있다가 GitHub의 `usercards.json` 파일(Apps Script가 쓰는 `data.json`과는 분리된 별도 파일)을 직접 커밋합니다.

설정 방법(한 번만 하면 됨):

1. GitHub → Settings → Developer settings → **Fine-grained personal access token** 발급 — Repository access를 `2-KY/qoo10_dashboard_data` 저장소 **하나만** 선택하고, Permissions는 **Contents: Read and write** 만 부여합니다(그 외 권한 불필요 — 유출되더라도 이 저장소 하나만 영향받도록 최소 권한으로 발급).
2. Vercel 프로젝트(`qoo10-dashboard`) → Settings → **Environment Variables** → `GITHUB_TOKEN` 이름으로 위 토큰 값을 추가합니다(Production 환경에 최소 1개 필요).
3. 다시 배포합니다(`npx vercel --prod` 또는 GitHub push로 자동 배포) — 이후 `/api/cards`가 이 환경변수를 읽어 동작합니다.

Apps Script 쪽은 이제 이 기능과 무관합니다(기존 `GITHUB_TOKEN` 스크립트 속성·10분 트리거는 매출 데이터 동기화용으로 그대로 유지). `usercards.json` 파일은 첫 카드/채널을 추가하는 순간 저장소에 자동으로 생성됩니다.

## 배포 후 확인 사항

- 발급받은 URL로 접속했을 때 화면이 비어 보이거나 "시트 연동 실패"가 뜨면 Google Sheets 공유 설정("링크가 있는 모든 사용자" 뷰어 권한)을 다시 확인하세요.
- 커스텀 도메인을 쓰고 싶다면 Vercel 프로젝트 설정 → **Domains**에서 원하는 도메인을 연결할 수 있습니다.
- 이후 지표/탭을 추가로 수정할 때는 `app.js`(로직)와 `index.html`(마크업), `styles.css`(디자인) 중 해당하는 파일만 수정하면 됩니다.
