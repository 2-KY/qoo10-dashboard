/**
 * 추가 SKU 카드 / 채널 설정 — 쓰기 전용 API 라우트 (Vercel Serverless Function)
 *
 * 배경: 원래는 Apps Script를 웹 앱으로 배포해 대시보드가 직접 호출하는 구조로 만들었지만,
 * 회사 Google Workspace 보안 정책상 Apps Script 웹 앱을 "모든 사용자(Anyone)"로 배포할 수
 * 없어서("나만" 또는 "조직 전체"만 가능) 익명 방문자가 보는 공개 대시보드에서는 그 방식이
 * 근본적으로 동작하지 않는다(응답을 브라우저가 읽을 수 없거나, 그 전에 로그인 리다이렉트로
 * 막힘). 그래서 쓰기 경로를 이 대시보드가 이미 올라가 있는 Vercel 프로젝트 자체의 서버리스
 * 함수로 옮겼다 — app.js가 같은 오리진(/api/cards)으로 fetch()하므로 CORS/인증 문제가 전혀
 * 없고, 이 함수만 GITHUB_TOKEN을 서버 쪽 환경변수로 들고 있다가 GitHub Contents API로
 * 'usercards.json'(2-KY/qoo10_dashboard_data 저장소, Apps Script가 쓰는 data.json과는
 * 별도 파일 — 10분 주기 전체 재작성과 충돌하지 않도록 분리)을 직접 갱신한다.
 * 읽기는 지금까지와 동일하게 브라우저가 raw.githubusercontent.com에서 이 파일을 바로 받는다.
 */

const GITHUB_OWNER = '2-KY';
const GITHUB_REPO = 'qoo10_dashboard_data';
const GITHUB_BRANCH = 'main';
const GITHUB_FILE_PATH = 'usercards.json';
const API_BASE = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`;

function emptyStore() {
  return { userCards: [], channelPrefs: [], channelsSeeded: false };
}

// ⑥탭을 처음 쓰는 사용자가 채널을 하나씩 수동으로 추가하지 않아도 되도록 미리 채워두는 기본
// 채널 세트. channelName은 실제 참조원 원본 문자열(_refTotals 키)과 정확히 일치해야 유입수
// 조회가 되므로, 기존 TRAFFIC_INT_CATS/TRAFFIC_EXT_CATS(app.js)에서 실데이터로 검증된 값만
// 그대로 재사용한다. 'Twitter'만 기존 코드에 선례가 없어 확인된 원본 문자열이 아니다 — 실제
// 유입 데이터의 표기가 다르면(예: 'x.com') 0으로 보일 수 있으니, 이 항목은 실데이터 배포 후
// 반드시 확인하고 필요하면 화면에서 직접 수정(제거 후 올바른 이름으로 재추가)해야 한다.
const DEFAULT_CHANNELS = [
  { category: 'internal', channelName: '楽天市場トップ' },
  { category: 'internal', channelName: '店舗トップ' },
  { category: 'internal', channelName: '店舗商品ページ' },
  { category: 'internal', channelName: '楽天サーチ' },
  { category: 'internal', channelName: 'ランキング市場' },
  { category: 'internal', channelName: '買い物かご' },
  { category: 'external', channelName: 'Instagram' },
  { category: 'external', channelName: 'Google' },
  { category: 'external', channelName: 'www.tiktok.com' }, // 표시명은 app.js의 trafficCatLabel()이 'TikTok'으로 매핑
  { category: 'external', channelName: 'Twitter' },
  { category: 'external', channelName: 'Youtube' }, // 표시명은 trafficCatLabel()이 'YouTube'로 매핑
];

async function fetchStore(token) {
  const resp = await fetch(`${API_BASE}?ref=${GITHUB_BRANCH}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });
  if (resp.status === 404) return { store: emptyStore(), sha: null };
  if (!resp.ok) throw new Error(`GitHub 조회 실패 (HTTP ${resp.status})`);
  const meta = await resp.json();
  const text = Buffer.from(meta.content, meta.encoding || 'base64').toString('utf-8');
  let store;
  try { store = JSON.parse(text); } catch (e) { store = emptyStore(); }
  store.userCards = Array.isArray(store.userCards) ? store.userCards : [];
  store.channelPrefs = Array.isArray(store.channelPrefs) ? store.channelPrefs : [];
  store.channelsSeeded = !!store.channelsSeeded;
  return { store, sha: meta.sha };
}

async function putStore(token, store, sha) {
  const body = {
    message: `usercards update ${new Date().toISOString()}`,
    content: Buffer.from(JSON.stringify(store), 'utf-8').toString('base64'),
    branch: GITHUB_BRANCH,
  };
  if (sha) body.sha = sha;
  const resp = await fetch(API_BASE, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return resp;
}

function newId(prefix) {
  return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}

function applyAction(store, action, payload) {
  payload = payload || {};
  if (action === 'addCard') {
    if (!payload.title || !payload.cur || !payload.cur.promoId || !payload.cur.code) {
      throw new Error('title/cur.promoId/cur.code는 필수입니다.');
    }
    // slot: {year,month,promoId,code} — year/month는 4단계 캐스케이드 선택기가 넘겨준 값을 그대로
    // 보존해야, 같은 이름의 프로모션(예: 매월 반복되는 "카미토쿠")이라도 나중에 어느 회차였는지
    // 구분할 수 있다.
    const slotOf = (s) => (s ? { year: s.year || null, month: s.month || null, promoId: s.promoId, code: s.code } : null);
    const card = {
      id: newId('card'),
      title: payload.title,
      cur: slotOf(payload.cur),
      prev: slotOf(payload.prev),
      yoy: slotOf(payload.yoy),
      pinned: false,
      createdAt: new Date().toISOString(),
    };
    store.userCards.push(card);
    return { id: card.id };
  }
  if (action === 'pinCard') {
    const c = store.userCards.find((x) => x.id === payload.id);
    if (!c) throw new Error('카드를 찾을 수 없음: ' + payload.id);
    c.pinned = !!payload.pinned;
    return { id: c.id };
  }
  if (action === 'deleteCard') {
    const before = store.userCards.length;
    store.userCards = store.userCards.filter((x) => x.id !== payload.id);
    if (store.userCards.length === before) throw new Error('카드를 찾을 수 없음: ' + payload.id);
    return { id: payload.id };
  }
  if (action === 'addChannel') {
    if ((payload.category !== 'internal' && payload.category !== 'external') || !payload.channelName) {
      throw new Error("category는 'internal'/'external', channelName은 필수입니다.");
    }
    const chan = {
      id: newId('chan'),
      category: payload.category,
      channelName: payload.channelName,
      order: store.channelPrefs.filter((c) => c.category === payload.category).length,
      createdAt: new Date().toISOString(),
    };
    store.channelPrefs.push(chan);
    return { id: chan.id };
  }
  if (action === 'removeChannel') {
    const before = store.channelPrefs.length;
    store.channelPrefs = store.channelPrefs.filter((x) => x.id !== payload.id);
    if (store.channelPrefs.length === before) throw new Error('채널을 찾을 수 없음: ' + payload.id);
    return { id: payload.id };
  }
  if (action === 'seedDefaultChannels') {
    // channelsSeeded 플래그로 딱 한 번만 실제로 커밋한다 — 사용자가 나중에 채널을 전부 지워도
    // (의도적인 상태) 다음 로드에서 재시딩되지 않도록 하기 위함.
    if (store.channelsSeeded) return { seeded: false };
    const existing = new Set(store.channelPrefs.map((c) => c.category + '::' + c.channelName));
    const added = [];
    DEFAULT_CHANNELS.forEach((d) => {
      const key = d.category + '::' + d.channelName;
      if (existing.has(key)) return;
      const chan = {
        id: newId('chan'),
        category: d.category,
        channelName: d.channelName,
        order: store.channelPrefs.filter((c) => c.category === d.category).length,
        createdAt: new Date().toISOString(),
      };
      store.channelPrefs.push(chan);
      added.push(chan);
    });
    store.channelsSeeded = true;
    return { seeded: true, channels: added };
  }
  throw new Error('알 수 없는 action: ' + action);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'POST만 지원합니다.' });
    return;
  }
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    res.status(500).json({ ok: false, error: 'GITHUB_TOKEN 환경변수가 설정되지 않았습니다 (Vercel 프로젝트 설정 필요).' });
    return;
  }
  const { action, payload } = req.body || {};
  try {
    // GitHub Contents API는 sha가 최신이 아니면 409를 반환한다(동시 쓰기 충돌) — 한 번만 재조회해
    // 재시도한다. 이 도구는 소수 인원이 쓰는 내부 대시보드라 그 이상의 재시도는 과설계.
    for (let attempt = 0; attempt < 2; attempt++) {
      const { store, sha } = await fetchStore(token);
      const result = applyAction(store, action, payload);
      if (action === 'seedDefaultChannels' && !result.seeded) {
        res.status(200).json(Object.assign({ ok: true }, result));
        return;
      }
      const putResp = await putStore(token, store, sha);
      if (putResp.ok) {
        res.status(200).json(Object.assign({ ok: true }, result));
        return;
      }
      if (putResp.status !== 409 || attempt === 1) {
        const text = await putResp.text();
        throw new Error(`GitHub 저장 실패 (HTTP ${putResp.status}): ${text}`);
      }
      // 409면 다음 루프에서 sha를 다시 조회해 재시도
    }
  } catch (err) {
    res.status(400).json({ ok: false, error: String((err && err.message) || err) });
  }
};
