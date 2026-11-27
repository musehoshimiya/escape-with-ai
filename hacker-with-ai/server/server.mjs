// hacker-with-ai サーバー（依存なし・Node標準のみ）
// 人間は GUI（public/）から、AI は curl で /api/sessions/:id/ai/* から、同じセッションに参加する。
// 状態はインメモリ。永続化はしない（Cloudflare 版は Durable Objects に保存）。

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import {
  createCaseState,
  guiView,
  applyAction,
  applyCelebrate,
  buildBrief,
  sceneKeyOf,
  sceneLabelOf,
  firstIntro,
  currentWord,
  buildMissionBrief,
  missionMeta,
  missionUnlocked,
} from "./casebook.mjs";
import { buildJoinPrompt, buildRejoinPrompt, buildMissionPrompt, isMobileUA } from "./prompt.mjs";
import { handleMcp } from "./mcp.mjs";

const PORT = process.env.PORT ?? 8788;
const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));

const sessions = new Map();

function newSession(name) {
  const id = randomBytes(6).toString("hex"); // 12桁。セッションIDそのものが参加キー
  const s = {
    id,
    name,
    case: createCaseState(),
    events: [],
    seq: 0,
    createdAt: Date.now(),
  };
  pushEvent(s, "scene", sceneLabelOf(s.case));
  pushEvent(s, "game", firstIntro());
  pushEvent(s, "game", `「${name}」さんが探偵事務所に加わった。相方のAIを待っている。`);
  sessions.set(id, s);
  return s;
}

function pushEvent(s, kind, text) {
  s.seq += 1;
  s.events.push({ seq: s.seq, ts: Date.now(), kind, text });
}

function publicBase(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  const host = req.headers["x-forwarded-host"] ?? req.headers.host ?? `localhost:${PORT}`;
  const proto = req.headers["x-forwarded-proto"] ?? "http";
  return `${proto}://${host}`;
}

function guiState(s) {
  return { sessionId: s.id, name: s.name, ...guiView(s.case), lastSeq: s.seq };
}

function aiBrief(s, baseUrl) {
  const recent = s.events
    .slice(-10)
    .map((e) => `#${e.seq} [${e.kind}] ${e.text}`)
    .join("\n");
  const celebrateGetUrl = `${baseUrl}/api/sessions/${s.id}/ai/celebrate-get?word=${currentWord(s.case)}&text=（お祝いの言葉をURLエンコードしたもの）`;
  return buildBrief(s.case, recent, celebrateGetUrl);
}

function aiMissionBrief(s, baseUrl, missionId) {
  const recent = s.events
    .slice(-10)
    .map((e) => `#${e.seq} [${e.kind}] ${e.text}`)
    .join("\n");
  const celebrateGetUrl = `${baseUrl}/api/sessions/${s.id}/ai/celebrate-get?word=${currentWord(s.case)}&text=（お祝いの言葉をURLエンコードしたもの）`;
  return buildMissionBrief(s.case, missionId, recent, celebrateGetUrl);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function sendJson(res, code, obj) {
  const body = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  } catch {
    return {};
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;

  // --- API ---
  if (path === "/api/sessions" && req.method === "POST") {
    const body = await readJson(req);
    const name = String(body.name ?? "").trim() || "プレイヤー";
    const s = newSession(name);
    const baseUrl = publicBase(req);
    const mcpRoot = `${baseUrl}/mcp`;
    const joinPrompt = buildJoinPrompt({ baseUrl, sessionId: s.id, name, mcpRoot, isMobile: isMobileUA(req.headers["user-agent"]) });
    return sendJson(res, 201, { sessionId: s.id, name, joinPrompt, mcpUrl: mcpRoot });
  }

  const m = path.match(/^\/api\/sessions\/([a-f0-9]+)(\/.*)?$/);
  if (m) {
    const s = sessions.get(m[1]);
    if (!s) return sendJson(res, 404, { error: "session not found" });
    const sub = m[2] ?? "";

    if (sub === "/state" && req.method === "GET") return sendJson(res, 200, guiState(s));

    if (sub === "/rejoin-prompt" && req.method === "GET") {
      const baseUrl = publicBase(req);
      const prompt = buildRejoinPrompt({
        baseUrl,
        sessionId: s.id,
        name: s.name,
        mcpRoot: `${baseUrl}/mcp`,
      });
      return sendJson(res, 200, { prompt });
    }

    if (sub === "/events" && req.method === "GET") {
      const since = Number(url.searchParams.get("since") ?? 0);
      return sendJson(res, 200, {
        events: s.events.filter((e) => e.seq > since),
        lastSeq: s.seq,
      });
    }

    if (sub === "/action" && req.method === "POST") {
      const body = await readJson(req);
      const before = sceneKeyOf(s.case);
      const texts = applyAction(s.case, body);
      const after = sceneKeyOf(s.case);
      if (body?.spot === "select_mission" && after !== before) {
        pushEvent(s, "scene", sceneLabelOf(s.case));
        for (const t of texts) pushEvent(s, "game", t);
      } else {
        for (const t of texts) pushEvent(s, "game", t);
        if (after !== before) pushEvent(s, "scene", sceneLabelOf(s.case));
      }
      return sendJson(res, 200, guiState(s));
    }

    if (sub === "/ai/brief" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end(aiBrief(s, publicBase(req)));
    }

    const briefMissionMatch = sub.match(/^\/ai\/brief\/(m\d)$/);
    if (briefMissionMatch && req.method === "GET") {
      const text = aiMissionBrief(s, publicBase(req), briefMissionMatch[1]);
      if (text === null) {
        res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("このミッションはまだ解放されていません。手前の事件を解決すると開きます。");
      }
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end(text);
    }

    const missionPromptMatch = sub.match(/^\/mission-prompt\/(m\d)$/);
    if (missionPromptMatch && req.method === "GET") {
      const meta = missionMeta(missionPromptMatch[1]);
      if (!meta || !missionUnlocked(s.case, meta.id)) {
        return sendJson(res, 403, { error: "mission locked" });
      }
      const baseUrl = publicBase(req);
      const prompt = buildMissionPrompt({
        baseUrl,
        sessionId: s.id,
        name: s.name,
        mission: meta,
      });
      return sendJson(res, 200, { prompt });
    }

    if (sub === "/ai/message" && req.method === "POST") {
      const body = await readJson(req);
      const text = String(body.text ?? "").trim();
      if (!text) return sendJson(res, 400, { error: "text is required" });
      pushEvent(s, "ai", text);
      return sendJson(res, 200, { ok: true, seq: s.seq });
    }

    if (sub === "/ai/celebrate" && req.method === "POST") {
      const body = await readJson(req);
      const r = applyCelebrate(s.case, body.word, body.text);
      if (!r.ok) return sendJson(res, 400, { ok: false, reason: r.reason });
      pushEvent(s, "celebration", r.message);
      return sendJson(res, 200, { ok: true, seq: s.seq });
    }

    // POST できない環境（web 閲覧のみのAI）向け：開くだけでお祝いが届く GET 版
    if (sub === "/ai/celebrate-get" && req.method === "GET") {
      const r = applyCelebrate(
        s.case,
        url.searchParams.get("word") ?? "",
        url.searchParams.get("text") ?? ""
      );
      if (r.ok) pushEvent(s, "celebration", r.message);
      res.writeHead(r.ok ? 200 : 400, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end(
        r.ok
          ? `お祝いがゲーム画面に届きました。${r.message}`
          : `お祝いを届けられませんでした（${r.reason}）`
      );
    }

    return sendJson(res, 404, { error: "unknown endpoint" });
  }

  // --- MCP（アプリ版 AI のカスタムコネクタ用） ---
  const opsFor = (s) => ({
    brief: async () => aiBrief(s, process.env.PUBLIC_BASE_URL ?? ""),
    events: async (since) =>
      s.events
        .filter((e) => e.seq > since)
        .map((e) => `#${e.seq} [${e.kind}] ${e.text}`)
        .join("\n") || "（新しい出来事はない）",
    postMessage: async (text) => {
      pushEvent(s, "ai", text);
      return true;
    },
    celebrate: async (word, text) => {
      const r = applyCelebrate(s.case, word, text);
      if (r.ok) pushEvent(s, "celebration", r.message);
      return r;
    },
  });
  const runMcp = async (req, res, resolve) => {
    const body = await readJson(req);
    const { status, payload } = await handleMcp(body, resolve);
    if (payload === null) {
      res.writeHead(status);
      return res.end();
    }
    return sendJson(res, status, payload);
  };

  // 常設エンドポイント（登録は一度だけ。セッションはツール引数で選ぶ）
  if (path === "/mcp" && req.method === "POST") {
    return runMcp(req, res, async (sid) => {
      const s = sessions.get(sid);
      return s ? opsFor(s) : null;
    });
  }

  // セッション別エンドポイント（ID が一致するセッションだけ触れる）
  const mcpMatch = path.match(/^\/mcp\/([a-f0-9]+)$/);
  if (mcpMatch && req.method === "POST") {
    const fixed = sessions.get(mcpMatch[1]);
    return runMcp(req, res, async (sid) => {
      if (!fixed || sid !== mcpMatch[1]) return null;
      return opsFor(fixed);
    });
  }

  // --- 静的ファイル ---
  if (req.method === "GET") {
    const rel = path === "/" ? "index.html" : path.slice(1);
    const file = normalize(join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end("forbidden");
    }
    try {
      const data = await readFile(file);
      res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
      return res.end(data);
    } catch {
      res.writeHead(404);
      return res.end("not found");
    }
  }

  res.writeHead(405);
  res.end("method not allowed");
});

server.listen(PORT, () => {
  console.log(`hacker-with-ai listening on http://localhost:${PORT}`);
});
