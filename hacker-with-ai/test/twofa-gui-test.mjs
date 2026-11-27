// 認証ゲート（二要素認証ダイアログ）の GUI 回帰テスト。
// 復号済み状態まで API で進めたセッションを実ブラウザで開き、
// 認証ゲートのスポットをクリックしてダイアログが開くこと、
// コードを入力して送信できること（誤コード→エラー表示／正コード→認証完了）を実際に確認する。
// 使い方: node test/twofa-gui-test.mjs

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { mkdtempSync, existsSync, readdirSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

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

const PORT = 18904;
const CDP_PORT = 19224;
const BASE = `http://localhost:${PORT}`;

let failures = 0;
function check(label, cond, extra = "") {
  if (cond) console.log(`  PASS ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label} ${extra}`);
  }
}

async function api(path, body) {
  const res = await fetch(`${BASE}${path}`, body ? {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  } : {});
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* text のまま */ }
  return { status: res.status, json, text };
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

try {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${BASE}/`);
      if (r.ok) break;
    } catch { /* not yet */ }
    await sleep(100);
  }

  console.log("== API で復号済みまで進める ==");
  const created = await api("/api/sessions", { name: "検証探偵" });
  const sid = created.json.sessionId;
  check("セッション作成", !!sid);
  for (const spot of ["roster", "overview", "memo", "sns", "interview"]) {
    await api(`/api/sessions/${sid}/action`, { spot });
  }
  const brief1 = await api(`/api/sessions/${sid}/ai/brief`, {});
  const hintMatch = brief1.text.match(/前半は管理者（.+?）の「(.+?)」をローマ字（小文字）にしたもの、後半は病院の「(.+?)」の数字/);
  const wordLabel = hintMatch[1];
  const numLabel = hintMatch[2];
  const adminLine = brief1.text.split("\n").find((l) => l.includes("佐伯 恒一") && l.includes("ローマ字"));
  const fieldByLabel = { "愛犬の名前": "愛犬", "好きな食べ物": "好きな食べ物", "好きな花": "好きな花" };
  const romajiMatch = adminLine.match(new RegExp(`${fieldByLabel[wordLabel]}：.+?（ローマ字 ([a-z]+)）`));
  const overviewMatch = brief1.text.match(/開院 (\d+)年／病床数 (\d+)床/);
  const numPart = numLabel === "開院年の下2桁" ? overviewMatch[1].slice(-2) : overviewMatch[2];
  const password = `${romajiMatch[1]}${numPart}`;

  const state0 = await api(`/api/sessions/${sid}/state`);
  const hosts = (body) => [...body.matchAll(/https?:\/\/([^\s\/）)]+)/g)].map((m) => m[1]);
  const isGenuine = (mail) => {
    const fromHost = (mail.from.match(/@([^\s>]+)/) || [])[1] ?? "";
    if (fromHost !== "aozora-hosp.jp") return false;
    const hs = hosts(mail.body);
    return hs.length > 0 && hs.every((h) => h === "aozora-hosp.jp" || h.endsWith(".aozora-hosp.jp"));
  };
  const genuine = state0.json.mails.find(isGenuine);
  await api(`/api/sessions/${sid}/action`, { spot: "mail_judge", id: genuine.id });
  const login = await api(`/api/sessions/${sid}/action`, { spot: "terminal", password });
  check("端末ログイン", login.json.loggedIn === true);
  await api(`/api/sessions/${sid}/action`, { spot: "backup" });
  const brief2 = await api(`/api/sessions/${sid}/ai/brief`, {});
  const cipherMatch = brief2.text.match(/第(\d+)世代、暗号文「([A-Z]+)」/);
  const K = (Number(cipherMatch[1]) % 9) + 3;
  const plain = cipherMatch[2].replace(/[A-Z]/g, (c) =>
    String.fromCharCode(((c.charCodeAt(0) - 65 - K + 26) % 26) + 65));
  const decrypted = await api(`/api/sessions/${sid}/action`, { spot: "backup", answer: plain });
  check("バックアップ復号", decrypted.json.backup.decrypted === true);
  check("チャレンジ発行", /^\d{4}$/.test(String(decrypted.json.challenge)));
  const seed = Number(brief2.text.match(/認証シード（相方だけの秘密。プレイヤーには言わない）：(\d+)/)[1]);
  const code = String(((decrypted.json.challenge * seed) % 900000) + 100000);
  console.log(`  正しい認証コード（検証用）: ${code}`);

  console.log("== 実ブラウザで認証ゲートを開く ==");
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

  const target = await send("Target.createTarget", { url: "about:blank" });
  const session = await send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  const sessId = session.sessionId;
  const sendS = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++msgId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, sessionId: sessId }));
    });
  async function evalS(expression) {
    const res = await sendS("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (res.exceptionDetails) throw new Error(`evaluate failed: ${res.exceptionDetails.text}`);
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
  await sendS("Page.navigate", { url: `${BASE}/?session=${sid}` });
  await waitS(`!document.querySelector('#view-room').hidden`, "コンソール表示（セッション再開）");
  await waitS(`document.querySelectorAll('.spot').length === 10`, "スポット10件");
  check("セッション再開でコンソールが開く", true);

  await evalS(`document.querySelector('[data-spot="twofa"]').click()`);
  await waitS(`!document.querySelector('#twofa-dialog').hidden`, "認証ゲートのダイアログ表示");
  check("認証ゲートを押すとダイアログが開く", true);
  check("チャレンジがダイアログに表示される", await evalS(`document.querySelector('#twofa-challenge').textContent.trim().length >= 4`));
  check("シードは相方AIだけが知る旨と声かけの案内が明示される", await evalS(`document.querySelector('#twofa-dialog').textContent.includes('認証シード') && document.querySelector('#twofa-dialog').textContent.includes('声をかけて')`));

  await evalS(`document.querySelector('#twofa-code').value = '000000'`);
  await evalS(`document.querySelector('#twofa-form').requestSubmit()`);
  await waitS(`document.querySelector('#twofa-message').textContent.length > 0`, "誤コードのエラー表示");
  check("誤コードでエラーが表示される", true);
  check("誤コードではダイアログが開いたまま", await evalS(`!document.querySelector('#twofa-dialog').hidden`));

  await evalS(`document.querySelector('#twofa-code').value = '${code}'`);
  await evalS(`document.querySelector('#twofa-form').requestSubmit()`);
  await waitS(`document.querySelector('#twofa-dialog').hidden`, "正コードでダイアログが閉じる");
  check("正しいコードで認証が通る（ダイアログが閉じる）", true);
  const stateAfter = await api(`/api/sessions/${sid}/state`);
  check("サーバー側でも認証完了になっている", stateAfter.json.authDone === true);
  check("未捕捉例外なし", exceptions.length === 0, exceptions.join(" / "));
} finally {
  try { chrome.kill(); } catch { /* noop */ }
  try { server.kill(); } catch { /* noop */ }
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
