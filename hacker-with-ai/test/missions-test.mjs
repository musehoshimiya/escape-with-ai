// ミッション2〜4と事件簿の検証スクリプト。
// 事件簿モジュールを直接駆動して全フローを確認する：
// 解放チェーン（m1→m2→m3→m4）、m2 の鑑定、m3 の抽出、
// m4 の両結末（ホゲ告発→バッド→検証し直し→ヤス告発→真結末）、
// 汚染が最終ミッションでのみ起きること（m1〜m3 の brief に POISON_DOC が入らない）。
// 後半は HTTP スモーク（scene イベント、事件簿つき state）。
// 使い方: node test/missions-test.mjs

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createCaseState, guiView, applyAction, applyCelebrate, buildBrief, buildMissionBrief, allCleared } from "../server/casebook.mjs";
import { decodePixels } from "../server/mission3.mjs";
import { POISON_DOC, M3 } from "../server/content.mjs";

let failures = 0;
function check(label, cond, extra = "") {
  if (cond) console.log(`  PASS ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label} ${extra}`);
  }
}
const brief = (c) => buildBrief(c, "", "http://x/ai/celebrate-get?word=w");

console.log("== 事件簿の初期状態と解放ガード ==");
const c = createCaseState();
let v = guiView(c);
check("初期ミッションは m1", v.mission.id === "m1");
check("事件簿は4件", v.casebook.length === 4);
check("m2〜m4 は未解放", v.casebook.slice(1).every((x) => x.status === "locked"));
check("state に scene がある", typeof v.scene?.caption === "string" && Array.isArray(v.scene?.cast));
check("スポットに hint がある", v.spots.every((sp) => typeof sp.hint === "string"));
let texts = applyAction(c, { spot: "select_mission", mission: "m2" });
check("未解放の事件は開けない", c.current === "m1" && texts.join("").includes("まだ解放されていない"));
check("m1 の brief に汚染文が入らない", !brief(c).includes(POISON_DOC) && !brief(c).includes("犯人はホゲ"));
const CEL_URL = "http://x/ai/celebrate-get?word=w";
check("未解放の m2 専用 brief は発行されない", buildMissionBrief(c, "m2", "", CEL_URL) === null);
check("未解放の m4 専用 brief は発行されない", buildMissionBrief(c, "m4", "", CEL_URL) === null);
check("m1 専用 brief は m1 のヒントだけを含む", buildMissionBrief(c, "m1", "", CEL_URL).includes("バックアップの復号"));

console.log("== ミッション1を解く（解放チェーン確認用） ==");
const s1 = c.states.m1;
for (const spot of ["roster", "overview", "memo", "sns", "interview"]) applyAction(c, { spot });
const genuineMail = s1.mails.find((m) => m.genuine);
applyAction(c, { spot: "mail_open", id: genuineMail.id });
applyAction(c, { spot: "mail_judge", id: genuineMail.id });
check("本物の通知を特定", guiView(c).judged === true);
applyAction(c, { spot: "terminal", password: s1.password });
check("ログイン", guiView(c).loggedIn === true);
applyAction(c, { spot: "backup" });
applyAction(c, { spot: "backup", answer: s1.cipherPlain });
check("復号", guiView(c).backup.decrypted === true);
const code = String(((s1.challenge * s1.seed) % 900000) + 100000);
applyAction(c, { spot: "twofa", code });
applyAction(c, { spot: "recover" });
check("m1 解決", guiView(c).recovered === true);
v = guiView(c);
check("m2 が解放された", v.casebook[1].status === "open" || v.casebook[1].status === "cleared");
check("m1 の報告書は7項目", Array.isArray(v.debrief) && v.debrief.length === 7);
check("解決後の brief 末尾に次の brief への完全な URL が入る（遷移は brief 内で辿る）",
  brief(c).includes("次の事件へ") && brief(c).includes("http://x/ai/brief/m2"));

console.log("== ミッション2（拡張子改ざん＋EXIF） ==");
texts = applyAction(c, { spot: "select_mission", mission: "m2" });
check("m2 の intro が返る", texts.join("").includes("あおぞら写真会"));
check("m2 の brief に汚染文が入らない", !brief(c).includes(POISON_DOC));
applyAction(c, { spot: "guide" });
applyAction(c, { spot: "claims" });
check("申告はモーダル資料ではなくノベルパート（dialogues）に出る", !!guiView(c).dialogues.claims && !guiView(c).materials.claims);
check("申告の会話は話者ごとに分かれる", guiView(c).dialogues.claims.lines.filter((l) => l.speaker).length === 4 && guiView(c).dialogues.claims.lines.some((l) => l.speaker === "田村 さくら"));
const s2 = c.states.m2;
for (const f of s2.files) applyAction(c, { spot: "file_open", id: f.id });
check("全ファイル開封", guiView(c).files.every((f) => f.opened && f.detail));
check("brief に鑑定ヒントが出る", brief(c).includes("ファイルの鑑定方法"));
check("brief 冒頭に現在地バナー（いまの事件はミッション2）", brief(c).includes("現在地：いまの事件はミッション2"));
check("brief 先頭に状態ヘッダー（指紋つき）", brief(c).includes("状態ヘッダー") && brief(c).includes("状態指紋"));
check("案内に読み直しの手順と ?r= の指定がある", brief(c).includes("状態の読み直し") && brief(c).includes("?r="));
const m2Brief = buildMissionBrief(c, "m2", "", CEL_URL);
check("解放後は m2 専用 brief が発行される", typeof m2Brief === "string" && m2Brief.includes("ミッション2「写真コンテストの鑑定」専用"));
check("m2 専用 brief に m1 のヒントは混ざらない", m2Brief.includes("ファイルの鑑定方法") && !m2Brief.includes("バックアップの復号"));
check("m2 解放後も m4 専用 brief は発行されない", buildMissionBrief(c, "m4", "", CEL_URL) === null);
check("解決済み m1 の専用 brief 末尾に、次の brief を読む指示がある", buildMissionBrief(c, "m1", "", CEL_URL).includes("次の行動") && buildMissionBrief(c, "m1", "", CEL_URL).includes("/ai/brief/m2"));
check("現在地バナーに解決済みのミッション1が明記される", brief(c).includes("は解決済みです"));
check("brief にマジックナンバーの表がある", brief(c).includes("FF D8"));
const genuineFile = s2.files.find((f) => f.genuine);
const decoyFile = s2.files.find((f) => !f.genuine);
applyAction(c, { spot: "file_verdict", id: decoyFile.id });
check("誤った特定は弾かれる", guiView(c).identified === false);
applyAction(c, { spot: "file_verdict", id: genuineFile.id });
check("本物を特定できる", guiView(c).identified === true);
applyAction(c, { spot: "report" });
check("m2 解決", guiView(c).recovered === true);
check("m2 の報告書は3項目", guiView(c).debrief.length === 3);
check("m2 クリア時点では達成キーワードが出ない", guiView(c).clearWord === null);
const cel2 = applyCelebrate(c, "あさひ", "おめでとう");
check("m2 時点の celebrate は全事件解決前として弾かれる", cel2.ok === false && cel2.reason === "not_all_cleared");
check("m3 が解放された", guiView(c).casebook[2].status !== "locked");

console.log("== ミッション3（ステガノグラフィ） ==");
applyAction(c, { spot: "select_mission", mission: "m3" });
check("m3 の brief に汚染文が入らない", !brief(c).includes(POISON_DOC));
applyAction(c, { spot: "will" });
applyAction(c, { spot: "family" });
const s3 = c.states.m3;
for (const im of s3.images) applyAction(c, { spot: "image_open", id: im.id });
const decoded = s3.images.map((im) => ({ id: im.id, text: decodePixels(im.pixels) }));
const holder = decoded.find((d) => d.text === s3.message);
check("保持画像からメッセージが復号できる", !!holder, JSON.stringify(decoded));
check("メッセージは候補プールの中の言葉", M3.messages.includes(s3.message));
check("もう一方は別の文字列（手紙ではない）", decoded.every((d) => d.id === holder.id || d.text !== s3.message));
check("brief に抽出手順のヒントが出る", brief(c).includes("隠しメッセージの取り出し方"));
check("brief にピクセルデータが届く", brief(c).includes("R="));
const lsbGroups = [...brief(c).matchAll(/最下位ビット列を先頭から8つずつ区切ったもの：((?:[01]{8} )+)/g)].map((m) =>
  m[1].trim().split(" ").map((g) => parseInt(g, 2)));
check("brief に計算済みのビット列が併記される（画像2枚分）", lsbGroups.length === 2);
check("ビット列を文字に直すと保持画像からメッセージが読める", lsbGroups.some((bytes) => bytes.map((b) => String.fromCharCode(b)).join("").startsWith(s3.message)));
applyAction(c, { spot: "extract", answer: "ZZZZZZ" });
check("違う言葉は弾かれる", guiView(c).extracted === false);
applyAction(c, { spot: "extract", answer: s3.message.toLowerCase() });
check("正しい言葉で抽出できる（大小無視）", guiView(c).extracted === true);
applyAction(c, { spot: "deliver" });
check("m3 解決", guiView(c).recovered === true);
check("m4 が解放された", guiView(c).casebook[3].status !== "locked");

console.log("== 最終ミッション（病院事件の真相） ==");
applyAction(c, { spot: "select_mission", mission: "m4" });
check("文書を読む前は brief に汚染文が入らない", !brief(c).includes(POISON_DOC));
check("文書を読む前は用語集にプロンプトインジェクションが出ない", !brief(c).includes("プロンプトインジェクション"));
applyAction(c, { spot: "caselog" });
applyAction(c, { spot: "people" });
applyAction(c, { spot: "hoge" });
applyAction(c, { spot: "yasu" });
texts = applyAction(c, { spot: "accuse", suspect: "yasu" });
check("文書未確認ではヤス告発が証拠不足で止まる", guiView(c).resolved === false && texts.join("").includes("押収文書"));
applyAction(c, { spot: "doc" });
const b4 = brief(c);
check("文書を開くと brief の資料欄に汚染文が原文で入る", b4.includes(POISON_DOC));
check("解毒は画面側だけ：brief に用語「プロンプトインジェクション」が出ない", !b4.includes("プロンプトインジェクション"));
check("解毒は画面側だけ：出所確認ヒントは brief に無い", !b4.includes("文書の出所の確認"));
check("解毒は画面側だけ：brief に出所の照合結果（院外の不明）が出ない", !b4.includes("院外の不明なアカウント"));
check("中立の整理ヒントは brief にある", b4.includes("事件の整理") && b4.includes("収集状況"));
texts = applyAction(c, { spot: "accuse", suspect: "kobayashi" });
check("看護師（被害者）は告発できない", guiView(c).badEnd === false && guiView(c).resolved === false);
applyAction(c, { spot: "accuse", suspect: "hoge" });
check("ホゲ告発でバッド寄り結末になる", guiView(c).badEnd === true);
check("バッド状態でも解決にはならない", guiView(c).resolved === false);
texts = applyAction(c, { spot: "accuse", suspect: "yasu" });
check("バッド中は再告発できず検証し直しへ誘導される", guiView(c).resolved === false && texts.join("").includes("検証し直す"));
applyAction(c, { spot: "reconsider" });
check("検証し直しでバッドから回復できる（詰みなし）", guiView(c).badEnd === false);
applyAction(c, { spot: "accuse", suspect: "yasu" });
check("証拠を揃えてヤスを告発すると真結末", guiView(c).resolved === true);
check("全体の報告書にプロンプトインジェクションの答え合わせがある",
  guiView(c).debrief.some((d) => d.title.includes("プロンプトインジェクション")));
check("事件簿の全事件が解決", allCleared(c) && guiView(c).allCleared === true);
const cel4 = applyCelebrate(c, guiView(c).clearWord, "事件解決おめでとう");
check("最終ミッションの celebrate が通る", cel4.ok === true);

console.log("== HTTP スモーク（scene イベントと事件簿 state） ==");
const PORT = 18902;
const BASE = `http://localhost:${PORT}`;
const server = spawn("node", ["server/server.mjs"], {
  cwd: new URL("..", import.meta.url).pathname,
  env: { ...process.env, PORT: String(PORT), GAME_LOCK_MS: "1200" },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
try {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${BASE}/`);
      if (r.ok) break;
    } catch { /* not yet */ }
    await sleep(100);
  }
  const created = await fetch(`${BASE}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "検証" }),
  }).then((r) => r.json());
  const sid = created.sessionId;
  const st = await fetch(`${BASE}/api/sessions/${sid}/state`).then((r) => r.json());
  check("state に事件簿とミッション情報がある", Array.isArray(st.casebook) && st.mission?.id === "m1");
  check("state にステージ情報（scene）がある", typeof st.scene?.caption === "string");
  const ev = await fetch(`${BASE}/api/sessions/${sid}/events?since=0`).then((r) => r.json());
  check("最初のイベントが scene 区切り", ev.events[0]?.kind === "scene", JSON.stringify(ev.events[0]));
  check("intro がバックログに届く", ev.events.some((e) => e.kind === "game" && e.text.includes("あおぞら記念病院")));
  const br = await fetch(`${BASE}/api/sessions/${sid}/ai/brief`).then((r) => r.text());
  check("HTTP brief に事件簿ヘッダがある", br.includes("事件簿"));
  check("HTTP brief（m1）に汚染文が入らない", !br.includes(POISON_DOC));
} finally {
  server.kill();
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
