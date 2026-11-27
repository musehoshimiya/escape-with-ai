// フロントエンドの実ブラウザ検証。
// chrome-headless-shell を CDP で操作し、参加フロー→コンソール表示→スポット操作→
// メールダイアログまでを実際にクリックして確認する（構文チェックの代わりにはしない）。
// 使い方: node test/browser-test.mjs

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { mkdtempSync, existsSync, readdirSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

// chrome-headless-shell の実体を探す（PATH → puppeteer キャッシュの順）
function findChrome() {
  if (process.env.CHROME_BIN && existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  const cacheRoot = join(homedir(), ".cache", "puppeteer", "chrome-headless-shell");
  try {
    for (const ver of readdirSync(cacheRoot)) {
      const p = join(cacheRoot, ver, "chrome-headless-shell-linux64", "chrome-headless-shell");
      if (existsSync(p)) return p;
    }
  } catch { /* fall through */ }
  return "chrome-headless-shell";
}

const PORT = 18903;
const CDP_PORT = 19223;
const BASE = `http://localhost:${PORT}`;

let failures = 0;
function check(label, cond, extra = "") {
  if (cond) console.log(`  PASS ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label} ${extra}`);
  }
}

const server = spawn("node", ["server/server.mjs"], {
  cwd: new URL("..", import.meta.url).pathname,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));

const profile = mkdtempSync(join(tmpdir(), "hwa-chrome-"));
const chrome = spawn(findChrome(), [
  `--remote-debugging-port=${CDP_PORT}`,
  "--no-sandbox",
  `--user-data-dir=${profile}`,
  "about:blank",
], { stdio: ["ignore", "pipe", "pipe"] });
chrome.stderr.on("data", () => {});

let ws;
let msgId = 0;
const pending = new Map();
const exceptions = [];

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const res = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (res.exceptionDetails) {
    throw new Error(`evaluate failed: ${res.exceptionDetails.text} ${JSON.stringify(res.exceptionDetails.exception?.description ?? "").slice(0, 300)}`);
  }
  return res.result?.value;
}

async function waitFor(expression, label, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if (await evaluate(expression)) return true;
    } catch { /* retry */ }
    await sleep(200);
  }
  throw new Error(`timeout waiting for: ${label}`);
}

try {
  // サーバー起動待ち
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${BASE}/`);
      if (r.ok) break;
    } catch { /* not yet */ }
    await sleep(100);
  }

  // CDP 接続
  let version = null;
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://localhost:${CDP_PORT}/json/version`);
      if (r.ok) { version = await r.json(); break; }
    } catch { /* not yet */ }
    await sleep(200);
  }
  if (!version) throw new Error("chrome CDP did not start");
  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    } else if (msg.method === "Runtime.exceptionThrown") {
      exceptions.push(msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text ?? "unknown");
    }
  });

  // ページターゲットを作って接続し直す（browser WS では Page が使えないため）
  const target = await send("Target.createTarget", { url: "about:blank" });
  const session = await send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  const sessionId = session.sessionId;
  const sendS = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++msgId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  // 以後の send をセッション付きに差し替える
  const origSend = send;
  void origSend;

  async function evalS(expression) {
    const res = await sendS("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (res.exceptionDetails) {
      throw new Error(`evaluate failed: ${res.exceptionDetails.text}`);
    }
    return res.result?.value;
  }
  async function waitS(expression, label, timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        if (await evalS(expression)) return true;
      } catch { /* retry */ }
      await sleep(200);
    }
    throw new Error(`timeout waiting for: ${label}`);
  }

  await sendS("Page.enable");
  await sendS("Runtime.enable");
  await sendS("Page.navigate", { url: `${BASE}/` });

  console.log("== 参加画面 ==");
  await waitS(`!!document.querySelector('#name-input')`, "参加画面の表示");
  check("参加画面が表示される", true);
  check("タイトルが探偵事務所になっている", await evalS(`document.title.includes('探偵事務所')`));
  await evalS(`document.querySelector('#name-input').value = '検証探偵'`);
  await evalS(`document.querySelector('#join-form').requestSubmit()`);
  await waitS(`document.querySelector('#prompt-text').value.length > 100`, "プロンプト生成");
  const promptVal = await evalS(`document.querySelector('#prompt-text').value`);
  check("プロンプトに用語の合言葉が含まれる", promptVal.includes("ゲームの用語："));
  check("プロンプトに探偵の枠組みが含まれる", promptVal.includes("探偵"));

  console.log("== 調査コンソール ==");
  await evalS(`document.querySelector('#go-room-btn').click()`);
  await waitS(`!document.querySelector('#view-room').hidden`, "コンソール表示");
  await waitS(`document.querySelectorAll('.spot').length === 10`, "スポット10件");
  check("調べられる場所が10件表示される（聞き込み・公開情報を含む）", true);
  check("ストーリーに場面区切りが入る", await evalS(`document.querySelectorAll('#log .scene-divider').length >= 1`));
  check("手順ステッパーが6件描画される", await evalS(`document.querySelectorAll('#stages li').length === 6`));

  console.log("== スポット操作 ==");
  await evalS(`document.querySelector('[data-spot="roster"]').click()`);
  await waitS(`document.querySelector('#log').textContent.includes('職員名簿を開いた')`, "名簿イベント");
  check("職員名簿を開くとストーリーに記録される", true);
  await evalS(`document.querySelector('[data-spot="interview"]').click()`);
  await waitS(`document.querySelector('#log').textContent.includes('聞き込み')`, "聞き込みイベント");
  check("聞き込みの証言がストーリーに記録される", true);
  await evalS(`document.querySelector('[data-spot="sns"]').click()`);
  await waitS(`document.querySelector('#log').textContent.includes('公開情報')`, "公開情報イベント");
  check("公開情報の調査がストーリーに記録される", true);
  check("キーワードに照合が増える", await evalS(`document.querySelector('#keywords').textContent.includes('聞き込みと公開情報の照合')`));

  console.log("== メールダイアログ ==");
  await evalS(`document.querySelector('[data-spot="mail"]').click()`);
  await waitS(`!document.querySelector('#mail-dialog').hidden`, "メールダイアログ表示");
  await waitS(`document.querySelectorAll('.mail-item').length >= 6`, "メール一覧");
  check("メール一覧が6通以上表示される", true);
  await evalS(`document.querySelector('.mail-item').click()`);
  await waitS(`document.querySelector('#mail-body').textContent.length > 10`, "メール本文");
  check("メールを選ぶと本文が表示される", true);
  await evalS(`document.querySelector('#mail-close').click()`);
  check("ダイアログが閉じる", await evalS(`document.querySelector('#mail-dialog').hidden`));

  console.log("== 例外チェック ==");
  check("ページ内で未捕捉例外が出ていない", exceptions.length === 0, exceptions.join(" | ").slice(0, 400));

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  chrome.kill();
  server.kill();
}
process.exit(failures === 0 ? 0 : 1);
