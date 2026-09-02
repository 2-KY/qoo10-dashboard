/**
 * api/report.js — Vercel Serverless Function (Node runtime, CommonJS).
 *
 * "프로모션 보고" 화면의 AI 문안 생성을 위한 서버사이드 프록시.
 * 브라우저는 절대 LLM API 키를 갖지 않는다 — 이 함수만 process.env에서
 * 키를 읽어 LLM을 호출하고, 결과 텍스트만 프론트에 돌려준다.
 *
 * 현재 기본 provider는 Anthropic Claude로 구현했다(제안 — 확정 아님).
 * 다른 provider를 쓰려면 이 파일만 교체하면 되고, 프론트(js/report.js,
 * js/screens.js)는 전혀 수정할 필요가 없다.
 *
 * 필요한 설정 (Vercel 프로젝트 > Settings > Environment Variables):
 *   - ANTHROPIC_API_KEY (필수) — 없으면 501을 반환하고, 프론트는 이를 감지해
 *     규칙기반 자동 요약(js/report.js의 generateReportNarrative)으로 폴백한다.
 *   - ANTHROPIC_MODEL (선택, 기본값 아래 DEFAULT_MODEL) — 실제 사용 가능한
 *     모델 ID로 반드시 확인 후 설정할 것.
 */
const DEFAULT_MODEL = "claude-3-5-sonnet-latest";
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "METHOD_NOT_ALLOWED", message: "POST만 지원합니다." });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(501).json({
      error: "AI_NOT_CONFIGURED",
      message: "ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다. Vercel 프로젝트 설정에서 추가한 뒤 재배포하세요.",
    });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const systemPrompt = body && body.systemPrompt;
  const userPrompt = body && body.userPrompt;
  if (!userPrompt) {
    res.status(400).json({ error: "BAD_REQUEST", message: "userPrompt가 필요합니다." });
    return;
  }

  try {
    const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
    const upstream = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 1200,
        system: systemPrompt || undefined,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!upstream.ok) {
      const detail = await upstream.text();
      res.status(502).json({ error: "LLM_REQUEST_FAILED", status: upstream.status, detail: detail.slice(0, 500) });
      return;
    }

    const json = await upstream.json();
    const text = Array.isArray(json.content)
      ? json.content.map((block) => block.text || "").join("\n").trim()
      : "";
    if (!text) {
      res.status(502).json({ error: "EMPTY_RESPONSE", message: "LLM 응답에서 텍스트를 추출하지 못했습니다." });
      return;
    }
    res.status(200).json({ text: text, model: model });
  } catch (err) {
    res.status(500).json({ error: "INTERNAL_ERROR", message: String((err && err.message) || err) });
  }
};
