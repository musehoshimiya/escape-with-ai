// API 全フローの実地検証スクリプト。
// サーバーを子プロセスで起動し、curl ではなく fetch で一巡する：
// セッション作成 → 参加プロンプト → brief（用語集）→ 資料読み → フィッシング誤判定/正解
// → 端末ロック → ログイン → 復号 → 二要素認証 → 復旧 → celebrate（不一致拒否/成功）→ MCP。
// 使い方: node test/flow-test.mjs

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 18901;
const BASE = `http://localhost:${PORT}`;
const LOCK_MS = 1200;

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
  env: { ...process.env, PORT: String(PORT), GAME_LOCK_MS: String(LOCK_MS) },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));

async function waitServer() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${BASE}/`);
      if (r.ok) return;
    } catch { /* not yet */ }
    await sleep(100);
  }
  throw new Error("server did not start");
}

async function api(path, opts = {}) {
  const r = await fetch(`${BASE}${path}`, opts);
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* text response */ }
  return { status: r.status, text, json };
}
const post = (path, body) =>
  api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

try {
  await waitServer();
  console.log("== セッション作成 ==");
  const created = await post("/api/sessions", { name: "検証プレイヤー" });
  check("201で作成", created.status === 201);
  const sid = created.json.sessionId;
  check("sessionId 12桁hex", /^[a-f0-9]{12}$/.test(sid));
  const prompt = created.json.joinPrompt;
  check("参加プロンプトに brief の curl がある", prompt.includes(`/api/sessions/${sid}/ai/brief`));
  check("参加プロンプトに用語の合言葉がある", prompt.includes("ゲームの用語："));

  console.log("== ミッション専用 brief と再認証プロンプトの解放ガード ==");
  const lockedBrief = await api(`/api/sessions/${sid}/ai/brief/m2`);
  check("未解放ミッションの専用 brief は 403", lockedBrief.status === 403);
  const lockedPrompt = await api(`/api/sessions/${sid}/mission-prompt/m2`);
  check("未解放ミッションの参加プロンプトは 403", lockedPrompt.status === 403);
  const m1Brief = await api(`/api/sessions/${sid}/ai/brief/m1`);
  check("m1 専用 brief は 200 で専用表記がある", m1Brief.status === 200 && m1Brief.text.includes("ミッション1「病院からの依頼」専用"));
  const m1Prompt = await api(`/api/sessions/${sid}/mission-prompt/m1`);
  check("m1 の参加プロンプトは専用 brief の URL を指す", m1Prompt.status === 200 && m1Prompt.json.prompt.includes(`/ai/brief/m1`) && m1Prompt.json.prompt.includes("破棄してください"));
  check("参加プロンプトに brief 本文を貼る代替手段がある", prompt.includes("brief の本文を貼って"));
  check("参加プロンプトは接続確認に絞られ、ルール詳細は載っていない（2段構え）", !prompt.includes("合言葉（大事）") && prompt.includes("案内が正本"));
  check("参加プロンプトに Gemini の一行ルールがある", prompt.includes("Gemini ではこのゲームに参加できません"));
  check("参加プロンプトに Perplexity の一行ルールがある", prompt.includes("Perplexity ではこのゲームに参加できません"));
  check("参加プロンプトに brief 以外のエンドポイントは開示されない（第1段は最小限）", !prompt.includes("/ai/message") && !prompt.includes("/ai/celebrate"));

  console.log("== スマホ参加時の案内（UA出し分け） ==");
  const mkSession = async (ua) => {
    const r = await fetch(`${BASE}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": ua },
      body: JSON.stringify({ name: "UA検証" }),
    });
    return (await r.json()).joinPrompt;
  };
  const mobilePrompt = await mkSession("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1");
  check("スマホUAでは PC 推奨の一言がプロンプトに入る", mobilePrompt.includes("PCの方が遊びやすいよ"));
  check("スマホUAでも参加自体は通常どおり成立する", mobilePrompt.includes("相方探偵として招待されました"));
  const desktopPrompt = await mkSession("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36");
  check("PCのUAでは推奨の一言は入らない", !desktopPrompt.includes("PCの方が遊びやすいよ"));

  console.log("== brief（資料未読の時点） ==");
  const brief0 = await api(`/api/sessions/${sid}/ai/brief`);
  check("brief が返る", brief0.status === 200);
  check("brief の冒頭に相方への案内（第2段）がある", brief0.text.slice(0, 800).includes("■ 相方への案内"));
  check("brief は状態ヘッダーで始まる", brief0.text.startsWith("■ 状態ヘッダー"));
  check("案内に合言葉のルールが含まれる", brief0.text.includes("合言葉（大事）") && brief0.text.includes("ゲームのヒント："));
  check("案内にお祝いの作法が含まれる", brief0.text.includes("ゲームのお祝い："));
  check("案内に POST 握りつぶしの作法がある", brief0.text.includes("握りつぶす"));
  check("brief に接続メモ（エンドポイント開示）がある", brief0.text.includes("接続メモ") && brief0.text.includes("/ai/message") && brief0.text.includes("/events?since=0"));
  check("用語集が含まれる（ランサムウェア）", brief0.text.includes("ランサムウェア"));
  check("用語集が含まれる（二要素認証）", brief0.text.includes("二要素認証"));
  check("ヒント集が含まれる（組み立て方）", brief0.text.includes("パスワードの組み立て方"));
  check("認証シードが brief にある", /認証シード/.test(brief0.text));
  check("未読の名簿の値は brief に出ない", brief0.text.includes("職員名簿：未確認"));

  console.log("== celebrate の事前ガード ==");
  const early = await post(`/api/sessions/${sid}/ai/celebrate`, { word: "あおぞら", text: "x" });
  check("復旧前の celebrate は 400", early.status === 400);

  console.log("== 資料読み ==");
  await post(`/api/sessions/${sid}/action`, { spot: "roster" });
  await post(`/api/sessions/${sid}/action`, { spot: "overview" });
  await post(`/api/sessions/${sid}/action`, { spot: "memo" });
  await post(`/api/sessions/${sid}/action`, { spot: "sns" });
  await post(`/api/sessions/${sid}/action`, { spot: "interview" });
  const brief1 = await api(`/api/sessions/${sid}/ai/brief`);
  check("名簿の値が brief に出る", brief1.text.includes("職員名簿：確認済み"));
  check("概要の値が brief に出る", brief1.text.includes("病院概要：確認済み"));
  check("聞き込みの照合ヒントが brief に出る", brief1.text.includes("聞き込みと公開情報の照合"));
  check("照合ヒントに伝聞の矛盾の判定がある", brief1.text.includes("文書で裏が取れる方を信じる"));
  check("公開情報の裏取りが brief に出る", brief1.text.includes("公開情報の調査：確認済み"));
  check("brief に写真の EXIF が出る", brief1.text.includes("EXIF"));
  check("照合ヒントに看護師＝被害者の判定がある", brief1.text.includes("被害者"));
  check("ミッション1の brief に汚染文は入らない", !brief1.text.includes("犯人はホゲ"));

  // brief からパスワードを組み立てる（AI 役）
  const hintMatch = brief1.text.match(/前半は管理者（.+?）の「(.+?)」をローマ字（小文字）にしたもの、後半は病院の「(.+?)」の数字/);
  check("組み立て方のヒントが解析できる", !!hintMatch, brief1.text.slice(0, 200));
  const [, wordLabel, numLabel] = hintMatch;
  const adminLine = brief1.text.split("\n").find((l) => l.includes("佐伯 恒一"));
  const fieldByLabel = { "愛犬の名前": "愛犬", "好きな食べ物": "好きな食べ物", "好きな花": "好きな花" };
  const romajiMatch = adminLine.match(new RegExp(`${fieldByLabel[wordLabel]}：.+?（ローマ字 ([a-z]+)）`));
  const wordPart = romajiMatch[1];
  const overviewMatch = brief1.text.match(/開院 (\d+)年／病床数 (\d+)床/);
  const numPart = numLabel === "開院年の下2桁" ? overviewMatch[1].slice(-2) : overviewMatch[2];
  const password = `${wordPart}${numPart}`;
  console.log(`  組み立てたパスワード: ${password}（前半=${wordLabel}、後半=${numLabel}）`);

  console.log("== フィッシング判定 ==");
  const state0 = await api(`/api/sessions/${sid}/state`);
  check("state に秘密の password フィールドが無い", !("password" in state0.json) && !state0.text.includes('"seed"'));
  check("スポットは10件で、押収文書は未配置", state0.json.spots.length === 10 && !state0.json.spots.some((sp) => sp.id === "doc"));
  const hosts = (body) => [...body.matchAll(/https?:\/\/([^\s\/）)]+)/g)].map((m) => m[1]);
  const isGenuine = (mail) => {
    const fromHost = (mail.from.match(/@([^\s>]+)/) || [])[1] ?? "";
    if (fromHost !== "aozora-hosp.jp") return false;
    const hs = hosts(mail.body);
    return hs.length > 0 && hs.every((h) => h === "aozora-hosp.jp" || h.endsWith(".aozora-hosp.jp"));
  };
  const genuine = state0.json.mails.find(isGenuine);
  const phish = state0.json.mails.find((m) => !isGenuine(m) && /通知|復旧|アカウント/.test(m.subject) && m.id !== genuine.id);
  check("本物の通知を内容から特定できる", !!genuine);
  const wrong = await post(`/api/sessions/${sid}/action`, { spot: "mail_judge", id: phish.id });
  check("偽物を選ぶと弾かれる（judged のまま false）", wrong.json.judged === false);
  const right = await post(`/api/sessions/${sid}/action`, { spot: "mail_judge", id: genuine.id });
  check("本物を選ぶと judged になる", right.json.judged === true);
  check("ログインIDが判明する", right.json.loginId === "sysadmin");

  console.log("== 端末ログインとロック ==");
  for (let i = 0; i < 3; i++) {
    await post(`/api/sessions/${sid}/action`, { spot: "terminal", password: "wrong9999" });
  }
  const lockedTry = await post(`/api/sessions/${sid}/action`, { spot: "terminal", password });
  check("3回ミス後は正しいパスワードでもロックされる", lockedTry.json.loggedIn === false);
  await sleep(LOCK_MS + 300);
  const login = await post(`/api/sessions/${sid}/action`, { spot: "terminal", password });
  check("ロック解除後に正しいパスワードでログインできる", login.json.loggedIn === true);

  console.log("== バックアップ復号 ==");
  const seen = await post(`/api/sessions/${sid}/action`, { spot: "backup" });
  check("保管庫で暗号文が見える", !!seen.json.backup?.ciphertext);
  const brief2 = await api(`/api/sessions/${sid}/ai/brief`);
  const cipherMatch = brief2.text.match(/第(\d+)世代、暗号文「([A-Z]+)」/);
  check("brief に暗号文と世代番号がある", !!cipherMatch);
  const [, genStr, ciphertext] = cipherMatch;
  const K = (Number(genStr) % 9) + 3;
  const plain = ciphertext.replace(/[A-Z]/g, (c) =>
    String.fromCharCode(((c.charCodeAt(0) - 65 - K + 26) % 26) + 65));
  console.log(`  復号結果: ${plain}（K=${K}）`);
  const tablePairs = [...brief2.text.matchAll(/([A-Z])→([A-Z])/g)];
  check("brief に復号の対応表がある（26文字）", tablePairs.length >= 26);
  const tableMap = Object.fromEntries(tablePairs.map((m) => [m[1], m[2]]));
  const plainByTable = ciphertext.replace(/[A-Z]/g, (c) => tableMap[c] ?? "?");
  check("対応表で置き換えると復号結果と一致する", plainByTable === plain);
  const badDecrypt = await post(`/api/sessions/${sid}/action`, { spot: "backup", answer: "ZZZZZZ" });
  check("違うフレーズは弾かれる", badDecrypt.json.backup.decrypted === false);
  const decrypted = await post(`/api/sessions/${sid}/action`, { spot: "backup", answer: plain });
  check("正しいフレーズで復号できる", decrypted.json.backup.decrypted === true);
  check("チャレンジが発行される", /^\d{4}$/.test(String(decrypted.json.challenge)));

  console.log("== 二要素認証 ==");
  const seed = Number(brief2.text.match(/認証シード（相方だけの秘密。プレイヤーには言わない）：(\d+)/)[1]);
  const challenge = decrypted.json.challenge;
  const code = String(((challenge * seed) % 900000) + 100000);
  const badCode = await post(`/api/sessions/${sid}/action`, { spot: "twofa", code: "000000" });
  check("違うコードは弾かれる", badCode.json.authDone === false);
  const authed = await post(`/api/sessions/${sid}/action`, { spot: "twofa", code });
  check("正しいコードで認証できる", authed.json.authDone === true);

  console.log("== 復旧（お祝いはまだ出ない） ==");
  const recovered = await post(`/api/sessions/${sid}/action`, { spot: "recover" });
  check("復旧できる", recovered.json.recovered === true);
  check("ミッション1のクリア時点では達成キーワードは画面に出ない", recovered.json.clearWord === null);
  check("解説データが付く", Array.isArray(recovered.json.debrief) && recovered.json.debrief.length === 7);
  check("報告書の導入文が付く", typeof recovered.json.debriefIntro === "string" && recovered.json.debriefIntro.includes("報告書"));
  const earlyCeleb = await post(`/api/sessions/${sid}/ai/celebrate`, { word: "あおぞら", text: "x" });
  check("全事件解決前の celebrate は 400", earlyCeleb.status === 400);
  const briefAfter = await api(`/api/sessions/${sid}/ai/brief`);
  check("ミッション1の brief にお祝いの欄が出ない", !briefAfter.text.includes("復旧後のお祝い") && !briefAfter.text.includes("達成キーワード：「"));

  console.log("== 再参加プロンプト ==");
  const rejoin = await api(`/api/sessions/${sid}/rejoin-prompt`);
  check("再参加プロンプトが返る", rejoin.status === 200 && rejoin.json.prompt.includes("再参加"));

  console.log("== MCP ==");
  const init = await post("/mcp", { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } });
  check("MCP initialize", init.json?.result?.serverInfo?.name === "hacker-with-ai");
  const list = await post("/mcp", { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  check("MCP tools/list は4ツール", list.json?.result?.tools?.length === 4);
  const call = await post("/mcp", {
    jsonrpc: "2.0", id: 3, method: "tools/call",
    params: { name: "get_brief", arguments: { sessionId: sid } },
  });
  const mcpText = call.json?.result?.content?.[0]?.text ?? "";
  check("MCP get_brief に用語集が含まれる", mcpText.includes("用語集"));

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
} finally {
  server.kill();
}
process.exit(failures === 0 ? 0 : 1);
