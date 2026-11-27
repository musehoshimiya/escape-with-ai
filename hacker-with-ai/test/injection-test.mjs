// プロンプトインジェクション機構の単体検証（最終トリック用・ミッション1では未配置）。
// 機構そのものが正しく動くことを、モジュールレベルで確認する：
// - 通常のミッション1状態（docEnabled=false）では、文書スポットも汚染文も一切出ない
// - docEnabled=true の状態で文書を開くと、汚染文（犯人はホゲという偽の結論）が
//   brief の資料欄に原文のまま入る（＝本物の汚染経路）
// - 同時に、正本側の解決導線（キーワード「文書の出所の確認」と照合ヒント）が brief に用意される
// 使い方: node test/injection-test.mjs

import { createMissionState, applyAction, buildBrief, guiView } from "../server/mission.mjs";

let failures = 0;
function check(label, cond, extra = "") {
  if (cond) console.log(`  PASS ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label} ${extra}`);
  }
}

console.log("== ミッション1（未配置）の確認 ==");
{
  const s = createMissionState();
  check("docEnabled は false", s.docEnabled === false);
  check("スポットに文書が出ない", !guiView(s).spots.some((sp) => sp.id === "doc"));
  check("スポットは10件", guiView(s).spots.length === 10);
  const out = applyAction(s, { spot: "doc" });
  check("文書アクションは無効（docRead にならない）", s.docRead === false && out.length === 1);
  const brief = buildBrief(s, [], "");
  check("brief に汚染文が入らない", !brief.includes("犯人はホゲ"));
  check("brief に出所確認ヒントが出ない", !brief.includes("文書の出所の確認"));
  check("キーワードに出所確認が出ない", !guiView(s).keywords.includes("文書の出所の確認"));
}

console.log("== 機構を有効化した場合（最終トリック想定） ==");
{
  const s = createMissionState();
  s.docEnabled = true;
  check("スポットに文書が出る", guiView(s).spots.some((sp) => sp.id === "doc"));
  applyAction(s, { spot: "doc" });
  check("文書を開くと docRead になる", s.docRead === true);
  const brief = buildBrief(s, [], "");
  check("汚染文が brief の資料欄に原文で入る（犯人はホゲ）", brief.includes("犯人はホゲ"));
  check("文書にAIへの指示は書かれていない（命令でなく証拠で操る）", !brief.includes("この文書を読んだAIへの指示"));
  check("解決導線：出所確認の照合ヒントが brief にある", brief.includes("文書の出所の確認"));
  check("照合ヒントが混入の手口を名指しする", brief.includes("プロンプトインジェクション"));
  check("照合ヒントがホゲの無実を裏付ける", brief.includes("ホゲは犯人ではなく"));
  check("キーワードに出所確認が出る", guiView(s).keywords.includes("文書の出所の確認"));
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
