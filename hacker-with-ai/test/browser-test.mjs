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
  check("参加プロンプトは curl 取得の案内を含む", promptVal.includes("curl -s"));
  check("プロンプトに探偵の枠組みが含まれる", promptVal.includes("探偵"));

  console.log("== 調査コンソール ==");
  await evalS(`document.querySelector('#go-room-btn').click()`);
  await waitS(`!document.querySelector('#view-room').hidden`, "コンソール表示");
  await waitS(`document.querySelectorAll('.spot').length === 10`, "スポット10件");
  check("調べられる場所が10件表示される（聞き込み・公開情報を含む）", true);
  await waitS(`document.querySelectorAll('#log .scene-divider').length >= 1`, "場面区切りの描画");
  check("ストーリーに場面区切りが入る", true);
  check("手順ステッパーが6件描画される", await evalS(`document.querySelectorAll('#stages li').length === 6`));

  console.log("== スポット操作 ==");
  await evalS(`document.querySelector('[data-spot="roster"]').click()`);
  await waitS(`document.querySelector('#log').textContent.includes('職員名簿を開いた')`, "名簿イベント");
  check("職員名簿を開くとストーリーに記録される", true);

  console.log("== 資料モーダル（UI基準） ==");
  await waitS(`!document.querySelector('#material-dialog').hidden`, "資料モーダル表示");
  check("職員名簿はモーダルで表示される", true);
  check("モーダルのタイトルが職員名簿", await evalS(`document.querySelector('#material-title').textContent === '職員名簿'`));
  const matBody = await evalS(`document.querySelector('#material-body').textContent`);
  check("モーダルに名簿の全文が見える", matBody.includes("佐伯 恒一") && matBody.includes("好きな花"));
  const matStaffLine = matBody.split("\n").find((l) => l.includes("佐伯 恒一")) ?? "";
  check("モーダルと同じ内容がバックログにもある",
    matStaffLine.length > 0 && (await evalS(`document.querySelector('#log').textContent.includes(${JSON.stringify(matStaffLine)})`)));
  await evalS(`document.querySelector('#material-close').click()`);
  check("資料モーダルが閉じる", await evalS(`document.querySelector('#material-dialog').hidden`));
  const countRosterLog = async () =>
    evalS(`(document.querySelector('#log').textContent.match(/職員名簿を開いた/g) || []).length`);
  check("名簿イベントはバックログに1件だけ", (await countRosterLog()) === 1);
  await evalS(`document.querySelector('[data-spot="roster"]').click()`);
  await waitS(`!document.querySelector('#material-dialog').hidden`, "資料モーダル再表示");
  check("既読の資料は再投稿せずモーダルが即開く", true);
  check("再読してもバックログに名簿が重複しない", (await countRosterLog()) === 1);
  await evalS(`document.querySelector('#material-close').click()`);

  console.log("== 聞き込みノベルパート ==");
  await evalS(`document.querySelector('[data-spot="interview"]').click()`);
  await waitS(`document.querySelector('#log').textContent.includes('聞き込み')`, "聞き込みイベント");
  check("聞き込みの証言がストーリーに記録される", true);
  await waitS(`!document.querySelector('#novel-window').hidden`, "ノベルウィンドウ表示");
  check("聞き込みはステージのノベルウィンドウで始まる", true);
  const playNovel = async () => {
    const seen = [];
    for (let i = 0; i < 15; i++) {
      if (await evalS(`document.querySelector('#novel-window').hidden`)) break;
      seen.push(await evalS(`({
        nameHidden: document.querySelector('#novel-name').hidden,
        name: document.querySelector('#novel-name').textContent,
        text: document.querySelector('#novel-text').textContent,
        speaking: !!document.querySelector('.cast-slot.speaking'),
      })`));
      await evalS(`document.querySelector('#novel-next').click()`);
      await sleep(120);
    }
    return seen;
  };
  const novelLines = await playNovel();
  check("ノベルは全6行を送り終えると閉じる", novelLines.length === 6 && (await evalS(`document.querySelector('#novel-window').hidden`)));
  check("地の文（見出し）では名前プレートが出ない", novelLines[0]?.nameHidden === true);
  check("話者の行では名前プレートに話者が出る", novelLines.some((l) => !l.nameHidden && l.name === "山田"));
  check("発言中は話者の立ち絵が speaking になる", novelLines.some((l) => l.speaking === true));
  check("台詞が1行ずつ送られる", novelLines.some((l) => l.text.includes("パスワードを教えて")));
  check("ノベル終了後はステージのキャプションが戻る", await evalS(`!document.querySelector('#stage-caption').hidden`));
  const countInterviewLog = async () =>
    evalS(`(document.querySelector('#log').textContent.match(/情報システム課を名乗る人から電話/g) || []).length`);
  check("聞き込みの全文はバックログに1件だけ残る", (await countInterviewLog()) === 1);
  await evalS(`document.querySelector('[data-spot="interview"]').click()`);
  await waitS(`!document.querySelector('#novel-window').hidden`, "ノベル再再生");
  check("既読の聞き込みは再投稿せずノベルが再生できる", true);
  await playNovel();
  check("再再生してもバックログに聞き込みが重複しない", (await countInterviewLog()) === 1);

  await evalS(`document.querySelector('[data-spot="sns"]').click()`);
  await waitS(`document.querySelector('#log').textContent.includes('公開情報')`, "公開情報イベント");
  check("公開情報の調査がストーリーに記録される", true);
  check("キーワードに照合が増える", await evalS(`document.querySelector('#keywords').textContent.includes('聞き込みと公開情報の照合')`));
  await waitS(`!document.querySelector('#material-dialog').hidden`, "公開情報モーダル表示");
  check("公開情報もモーダルで表示される（UI基準）",
    await evalS(`document.querySelector('#material-title').textContent === '公開情報の調査' && document.querySelector('#material-body').textContent.includes('公開投稿')`));
  await evalS(`document.querySelector('#material-close').click()`);

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

  console.log("== ステージUI・事件簿・ヒント折りたたみ（ミッション1画面） ==");
  check("ステージに立ち絵スロットが3つある", await evalS(`document.querySelectorAll('.cast-slot').length === 3`));
  check("立ち絵プレースホルダ（シルエット）が描かれる", await evalS(`document.querySelectorAll('.cast-silhouette svg').length >= 1`));
  check("ステージに場面キャプションがある", await evalS(`document.querySelector('#stage-caption').textContent.length > 5`));
  check("事件簿に4件の事件が並ぶ", await evalS(`document.querySelectorAll('.case-item').length === 4`));
  check("バックログに intro が残っている", await evalS(`document.querySelector('#log').textContent.includes('あおぞら記念病院')`));
  check("スポットのヒントは全て折りたたまれている（デフォルト閉）",
    await evalS(`[...document.querySelectorAll('.spot-hint')].length >= 5 && [...document.querySelectorAll('.spot-hint')].every((d) => !d.open)`));
  check("キーワードのヒントも折りたたまれている（デフォルト閉）",
    await evalS(`!document.querySelector('#keywords-fold').open`));
  await evalS(`document.querySelector('#keywords-fold > summary').click()`);
  check("キーワードの折りたたみは開くと読める",
    await evalS(`document.querySelector('#keywords-fold').open && document.querySelector('#keywords').textContent.includes('ゲームのヒント')`));
  await evalS(`document.querySelector('[data-spot="mail"]').click()`);
  await waitS(`!document.querySelector('#mail-dialog').hidden`, "メールダイアログ再表示");
  check("ダイアログ内のヒントも折りたたまれている（デフォルト閉）",
    await evalS(`[...document.querySelectorAll('#mail-dialog .hint-fold')].every((d) => !d.open)`));
  await evalS(`document.querySelector('#mail-dialog .hint-fold > summary').click()`);
  check("ダイアログ内のヒントは開くと読める",
    await evalS(`document.querySelector('#mail-dialog .hint-fold').open && document.querySelector('#mail-dialog').textContent.includes('本物は1通だけ')`));
  await evalS(`document.querySelector('#mail-close').click()`);

  console.log("== 続きのミッションの実ブラウザ検証（HTTPで進行させて画面確認） ==");
  const postB = async (path, body) => {
    const r = await fetch(`${BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
    const tx = await r.text();
    try { return JSON.parse(tx); } catch { return tx; }
  };
  const getB = async (path) => {
    const r = await fetch(`${BASE}${path}`);
    const tx = await r.text();
    try { return JSON.parse(tx); } catch { return tx; }
  };
  const createdB = await postB("/api/sessions", { name: "検証探偵2" });
  const sidB = createdB.sessionId;
  const actB = (body) => postB(`/api/sessions/${sidB}/action`, body);
  const stateB = () => getB(`/api/sessions/${sidB}/state`);
  const briefB = () => postB(`/api/sessions/${sidB}/ai/brief`, {});

  // ミッション1を HTTP で解く（組み立ては flow-test と同じ手順）
  for (const spot of ["roster", "overview", "memo", "sns", "interview"]) await actB({ spot });
  const briefB1 = await briefB();
  const hm = briefB1.match(/前半は管理者（.+?）の「(.+?)」をローマ字（小文字）にしたもの、後半は病院の「(.+?)」の数字/);
  const fieldByLabel = { "愛犬の名前": "愛犬", "好きな食べ物": "好きな食べ物", "好きな花": "好きな花" };
  const adminLine = briefB1.split("\n").find((l) => l.includes("佐伯 恒一"));
  const romaji = adminLine.match(new RegExp(`${fieldByLabel[hm[1]]}：.+?（ローマ字 ([a-z]+)）`))[1];
  const ov = briefB1.match(/開院 (\d+)年／病床数 (\d+)床/);
  const passwordB = `${romaji}${hm[2] === "開院年の下2桁" ? ov[1].slice(-2) : ov[2]}`;
  const stB0 = await stateB();
  const hostsB = (body) => [...body.matchAll(/https?:\/\/([^\s\/）)]+)/g)].map((m) => m[1]);
  const genuineMailB = stB0.mails.find((mail) => {
    const fromHost = (mail.from.match(/@([^\s>]+)/) || [])[1] ?? "";
    if (fromHost !== "aozora-hosp.jp") return false;
    const hs = hostsB(mail.body);
    return hs.length > 0 && hs.every((h) => h === "aozora-hosp.jp" || h.endsWith(".aozora-hosp.jp"));
  });
  await actB({ spot: "mail_open", id: genuineMailB.id });
  await actB({ spot: "mail_judge", id: genuineMailB.id });
  await actB({ spot: "terminal", password: passwordB });
  await actB({ spot: "backup" });
  const briefB2 = await briefB();
  const cm = briefB2.match(/第(\d+)世代、暗号文「([A-Z]+)」/);
  const K = (Number(cm[1]) % 9) + 3;
  const plainB = cm[2].replace(/[A-Z]/g, (ch) => String.fromCharCode(((ch.charCodeAt(0) - 65 - K + 26) % 26) + 65));
  await actB({ spot: "backup", answer: plainB });
  const seedB = Number(briefB2.match(/認証シード（相方だけの秘密。プレイヤーには言わない）：(\d+)/)[1]);
  const stB1 = await stateB();
  await actB({ spot: "twofa", code: String(((stB1.challenge * seedB) % 900000) + 100000) });
  await actB({ spot: "recover" });
  check("HTTP でミッション1を解けた", (await stateB()).recovered === true);

  // 解決バナーの「次の事件へ」ボタンでミッション2へ遷移できることを画面で確認
  await sendS("Page.navigate", { url: `${BASE}/?session=${sidB}` });
  await waitS(`!document.querySelector('#view-room').hidden`, "第2セッションのコンソール表示");
  await waitS(`!document.querySelector('#next-case-btn').hidden`, "次の事件へボタンの表示");
  check("解決バナーに次の事件へのボタンが出る", await evalS(`document.querySelector('#next-case-btn').textContent.includes('写真コンテストの鑑定')`));
  check("事件簿でミッション2が「新しい依頼」になっている", await evalS(`document.querySelector('#casebook').textContent.includes('新しい依頼')`));
  await evalS(`document.querySelector('#next-case-btn').click()`);
  await waitS(`document.querySelector('#mission-title').textContent.includes('写真コンテストの鑑定')`, "ミッション2のタイトル");
  check("次の事件ボタンでミッション2へ遷移できる", true);
  await actB({ spot: "guide" });
  check("ミッション2のステージに大場さんが立つ", await evalS(`document.querySelector('#stage').textContent.includes('大場 恒夫')`));
  await evalS(`document.querySelector('[data-spot="files"]').click()`);
  await waitS(`!document.querySelector('#files-dialog').hidden`, "ファイルダイアログ表示");
  await waitS(`document.querySelectorAll('#file-list .mail-item').length === 6`, "ファイル一覧6件");
  check("ファイル一覧が6件表示される", true);
  await evalS(`document.querySelector('#file-list .mail-item').click()`);
  await waitS(`document.querySelector('#file-body').textContent.includes('ヘッダ')`, "ファイル詳細");
  check("ファイルを開くとヘッダとメタデータが見える", true);
  check("ファイルダイアログのヒントも折りたたまれている", await evalS(`[...document.querySelectorAll('#files-dialog .hint-fold')].every((d) => !d.open)`));
  await evalS(`document.querySelector('#files-close').click()`);

  // ミッション2・3を HTTP で解く
  const stB2 = await stateB();
  for (const f of stB2.files) await actB({ spot: "file_open", id: f.id });
  const stB3 = await stateB();
  const genuineFileB = stB3.files.find((f) => {
    if (!f.detail) return false;
    const day = Number((f.detail.exif.match(/2026年11月(\d+)日/) || [])[1] ?? 0);
    return f.detail.header.startsWith("FF D8") && day >= 15 && day <= 25 && f.entrant.includes("田村");
  });
  check("画面の材料から本物のファイルを特定できる", !!genuineFileB);
  await actB({ spot: "file_verdict", id: genuineFileB.id });
  await actB({ spot: "report" });
  check("HTTP でミッション2を解けた", (await stateB()).recovered === true);
  await actB({ spot: "select_mission", mission: "m3" });
  await actB({ spot: "will" });
  await actB({ spot: "family" });
  const stB4 = await stateB();
  for (const im of stB4.images) await actB({ spot: "image_open", id: im.id });
  const briefB3 = await briefB();
  const blocks = [...briefB3.matchAll(/【画像「(.+?)」のピクセルデータ[\s\S]*?】\n((?:#\d+ R=\d+ G=\d+ B=\d+\n?)+)/g)];
  const decodeB = (text) => {
    const bits = [];
    for (const line of text.trim().split("\n")) {
      const mm = line.match(/R=(\d+) G=(\d+) B=(\d+)/);
      for (let i = 1; i <= 3; i++) bits.push(Number(mm[i]) & 1);
    }
    let out = "";
    for (let i = 0; i + 7 < bits.length; i += 8) {
      let code = 0;
      for (let j = 0; j < 8; j++) code = (code << 1) | bits[i + j];
      if (code === 0) break;
      out += String.fromCharCode(code);
    }
    return out;
  };
  const wordsB = blocks.map((b) => decodeB(b[2]));
  const messageB = wordsB.find((w) => ["ARIGATO", "GENKIDE", "MAMORUZO", "SUKIDAYO", "ARUKOU"].includes(w));
  check("brief のピクセルデータから手紙の言葉を復号できる", !!messageB, JSON.stringify(wordsB));
  await actB({ spot: "extract", answer: messageB });
  await actB({ spot: "deliver" });
  check("HTTP でミッション3を解けた", (await stateB()).recovered === true);

  // 最終ミッション：画面で告発ダイアログ→バッド→検証し直し→真結末
  await actB({ spot: "select_mission", mission: "m4" });
  for (const spot of ["caselog", "people", "hoge", "yasu", "doc"]) await actB({ spot });
  await waitS(`document.querySelector('#mission-title').textContent.includes('病院事件の真相')`, "最終ミッションのタイトル", 15000);
  check("最終ミッションが画面に切り替わる", true);
  check("ステージにヤスが立つ", await evalS(`document.querySelector('#stage').textContent.includes('安田 修')`));
  check("バックログに文書の出所情報が残る", await evalS(`document.querySelector('#log').textContent.includes('出所情報')`));
  await evalS(`document.querySelector('[data-spot="accuse"]').click()`);
  await waitS(`!document.querySelector('#accuse-dialog').hidden`, "告発ダイアログ表示");
  await waitS(`document.querySelectorAll('.accuse-btn').length === 3`, "容疑者3人");
  check("告発ダイアログに容疑者が3人並ぶ", true);
  await evalS(`document.querySelectorAll('.accuse-btn')[0].click()`);
  await waitS(`!document.querySelector('#badend-banner').hidden`, "バッド寄り結末バナー", 15000);
  check("ホゲを告発するとバッド寄り結末バナーが出る", true);
  check("バックログにバッド結末の文章が残る", await evalS(`document.querySelector('#log').textContent.includes('胸のざわつき')`));
  await evalS(`document.querySelector('[data-spot="reconsider"]').click()`);
  await waitS(`document.querySelector('#badend-banner').hidden`, "検証し直しでバナー消去", 15000);
  check("検証し直すとバッドから回復できる（詰みなし）", true);
  await evalS(`document.querySelector('[data-spot="accuse"]').click()`);
  await waitS(`!document.querySelector('#accuse-dialog').hidden`, "告発ダイアログ再表示");
  await evalS(`document.querySelectorAll('.accuse-btn')[1].click()`);
  await waitS(`!document.querySelector('#recovered-banner').hidden`, "真結末バナー", 15000);
  check("ヤスを告発すると真結末（解決バナー）になる", true);
  await waitS(`!document.querySelector('#debrief-panel').hidden && document.querySelector('#debrief').textContent.includes('プロンプトインジェクション')`, "最終報告書", 15000);
  check("全体の報告書にプロンプトインジェクションの答え合わせが出る", true);

  console.log("== 例外チェック ==");
  check("ページ内で未捕捉例外が出ていない", exceptions.length === 0, exceptions.join(" | ").slice(0, 400));

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  chrome.kill();
  server.kill();
}
process.exit(failures === 0 ? 0 : 1);
