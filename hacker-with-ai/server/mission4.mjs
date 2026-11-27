// ミッション4（最終）「病院事件の真相」。
// 既存の機構（docEnabled ゲート／POISON_DOC／出所確認の解決導線）をここで有効化する。
// 押収文書が brief の資料欄に原文で流入し、相方AIが「犯人はホゲ」と主張し得る状態になる
// （脚本ではなく実装としての汚染）。プレイヤーは画面側の出所情報と証拠で見抜く。
// ホゲ告発はバッド寄り結末だが詰みなし（検証し直しで回復できる）。

import { CLEAR_WORDS, GLOSSARY, POISON_DOC, M4, M4_GLOSSARY, M4_DEBRIEF, M4_DEBRIEF_INTRO} from "./content.mjs";
import { pick, toDialogueLines} from "./util.mjs";

const STAGE_LABELS = ["証拠の再確認", "押収文書の検証", "告発の判断", "事件解決"];

export function createMission4State() {
return {
readCaselog: false,
readPeople: false,
readHoge: false,
readYasu: false,
docEnabled: true, // 最終ミッションでのみ汚染機構を配置する
docRead: false,
badEnd: false,
resolved: false,
celebrated: false,
clearWord: pick(CLEAR_WORDS),
};
}

function evidenceComplete(s) {
return s.docRead && s.readCaselog && s.readHoge;
}

function currentStage(s) {
if (s.resolved) return 4;
if (s.badEnd || evidenceComplete(s)) return 3;
if (s.docRead) return 2;
return 1;
}

function stageViews(s) {
const cur = currentStage(s);
return STAGE_LABELS.map((label, i) => ({
no: i + 1,
label,
state: i + 1 < cur? "done": i + 1 === cur? "current": "todo",
}));
}

function spotViews(s) {
const spots = [
{
id: "caselog",
label: "事件ログの要約",
note: s.readCaselog? "確認済み": "ミッション1で確定した事実",
hint: "ここにあるのは「確かめられた事実」だけ。あとで文書の主張と付き合わせる。",
},
{
id: "people",
label: "関係者リスト",
note: s.readPeople? "確認済み": "ホゲ／ヤス／小林さん／佐伯課長",
hint: "小林さんは被害者で確定済み。容疑の線上にいるのは誰か。",
},
{
id: "hoge",
label: "ホゲの裏取り",
note: s.readHoge? "裏取り済み": "公開投稿と勤務記録の照合",
hint: "写真のメタデータ（撮影時刻と場所）がアリバイの裏付けになる。",
},
{
id: "yasu",
label: "ヤスへの聞き込み",
note: s.readYasu? "聞き込み済み": "現場責任者・安田 修の証言",
hint: "証言が事件ログと食い違っていないか、耳を澄ます。",
},
{
id: "doc",
label: "押収された文書",
note: s.docRead? "開封済み": "共有フォルダから押収した調査文書",
hint: "内容だけでなく「出所情報」（作成者・作成日時）を必ず見ること。",
},
{
id: "accuse",
label: "告発する",
note: s.resolved
? "解決済み"
: s.badEnd
? "告発は済んだ。だが確かめ直せる"
: evidenceComplete(s)
? "証拠は揃った。告発できる"
: "裏付け（文書・ログ・アリバイ）が揃うと告発できる",
hint: "根拠のない告発は取り返しがつかない。文書・事件ログ・アリバイの3点を確認してから。",
},
];
if (s.badEnd &&!s.resolved) {
spots.push({
id: "reconsider",
label: "検証し直す",
note: "告発を取り下げて、証拠を確かめ直す",
hint: "詰みではない。文書の出所と証拠を、もう一度はじめから確かめ直せる。",
});
}
return spots;
}

function sceneFor(s) {
const stage = currentStage(s);
const mood = s.resolved? "clear": s.badEnd? "alert": "normal";
if (stage === 1) {
return {
key: "m4-s1", bg: "office", mood,
caption: "病院事件の続報依頼。確定した事実と関係者を、まず洗い直す。",
cast: [{ slot: "left", name: "佐伯 恒一", role: "情報システム課 課長", color: "#d9b27f", tone: "真剣"}],
};
}
if (stage === 2) {
return {
key: "m4-s2", bg: "office", mood,
caption: "押収された文書を開いた。内容はもっともらしい。だが――出所は？",
cast: [{ slot: "right", name: "安田 修（ヤス）", role: "保守業者の現場責任者", color: "#c97f7f", tone: "不敵"}],
};
}
if (stage === 3) {
return {
key: "m4-s3", bg: "office", mood,
caption: s.badEnd
? "ホゲは引き渡された。だが、確かめきっていない何かが残っている。"
: "証拠は揃った。誰を告発するかは、証拠が決める。",
cast: [
{ slot: "left", name: "ホゲ", role: "保守業者の技術者", color: "#9fd97f", tone: "困惑"},
{ slot: "right", name: "安田 修（ヤス）", role: "保守業者の現場責任者", color: "#c97f7f", tone: "不敵"},
],
};
}
return {
key: "m4-s4", bg: "clear", mood,
caption: "病院事件は、真の解決を迎えた。「事件の報告書」で答え合わせができる。",
cast: [
{ slot: "left", name: "ホゲ", role: "保守業者の技術者", color: "#9fd97f", tone: "安堵"},
{ slot: "right", name: "佐伯 恒一", role: "情報システム課 課長", color: "#d9b27f", tone: "安堵"},
],
};
}

const STAGE_SPOT = { 1: "caselog", 2: "doc", 3: "accuse", 4: null};

const SUSPECTS = [
{ id: "hoge", name: "ホゲ", role: "保守業者の技術者"},
{ id: "yasu", name: "安田 修（ヤス）", role: "保守業者の現場責任者"},
{ id: "kobayashi", name: "小林 ユイ", role: "看護師（被害者・確定済み）"},
];

export function guiView(s) {
return {
spots: spotViews(s),
stages: stageViews(s),
stage: currentStage(s),
currentSpot: STAGE_SPOT[currentStage(s)],
scene: sceneFor(s),
clearMessage: "事件解決！病院事件の真相が明らかになった。",
badEnd: s.badEnd &&!s.resolved,
badEndText: s.badEnd &&!s.resolved? M4.badEndText: null,
inventory: [
...(s.readCaselog? ["事件ログの要約"]: []),
...(s.readPeople? ["関係者リスト"]: []),
...(s.readHoge? ["ホゲのアリバイの裏付け"]: []),
...(s.readYasu? ["ヤスの証言"]: []),
...(s.docRead? ["押収文書とその出所情報"]: []),
],
keywords: [
"事件の整理",
],
caselog: s.readCaselog? { text: M4.caselog}: null,
people: s.readPeople? { text: M4.people}: null,
hogeInfo: s.readHoge? { text: M4.hogeInfo}: null,
yasuInterview: s.readYasu? { text: M4.yasuInterview}: null,
materials: {
...(s.readCaselog? { caselog: { title: "事件ログの要約", text: M4.caselog}}: {}),
...(s.readPeople? { people: { title: "関係者リスト", text: M4.people}}: {}),
...(s.readHoge? { hoge: { title: "ホゲの裏取り", text: M4.hogeInfo}}: {}),
},
dialogues: {
...(s.readYasu
? {
yasu: {
title: "ヤスへの聞き込み",
cast: [{ slot: "right", name: "安田 修（ヤス）", role: "保守業者の現場責任者", color: "#c97f7f"}],
lines: toDialogueLines(M4.yasuInterview, "安田 修（ヤス）"),
},
}
: {}),
},
doc: s.docRead? { title: M4.docTitle, meta: M4.docMeta, source: M4.docSource, text: POISON_DOC}: null,
suspects: SUSPECTS,
evidence: { doc: s.docRead, caselog: s.readCaselog, hoge: s.readHoge},
resolved: s.resolved,
recovered: s.resolved,
clearWord: s.resolved ? s.clearWord : null,
celebrated: s.celebrated,
debrief: s.resolved ? M4_DEBRIEF : null,
debriefIntro: s.resolved ? M4_DEBRIEF_INTRO : null,
};
}

export function applyAction(s, action) {
const spot = action?.spot;
switch (spot) {
case "caselog": {
if (s.readCaselog) return ["事件ログの要約は確認済みだ。"];
s.readCaselog = true;
return [M4.caselog];
}
case "people": {
if (s.readPeople) return ["関係者リストは確認済みだ。"];
s.readPeople = true;
return [M4.people];
}
case "hoge": {
if (s.readHoge) return ["ホゲの裏取りは済んでいる。"];
s.readHoge = true;
// 裏取りの内容は画面側だけに置く（brief に入れると注入が成立しない）。
// イベント／バックログにも内容は流さない。
return ["ホゲの裏取りを行った。内容は画面の資料で確認できる。"];
}
case "yasu": {
if (s.readYasu) return ["ヤスへの聞き込みは済んでいる。"];
s.readYasu = true;
// 聞き込みの内容は画面側だけに置く（同上）。
return ["ヤスへの聞き込みを行った。内容は画面で確認できる。"];
}
case "doc": {
if (s.docRead) return ["押収文書は開封済みだ。本文は資料欄にある。"];
s.docRead = true;
// 出来事テキストは brief にも流れる。出所情報や「鵜呑みにするな」の注意は
// ここに書かない（書くと相方が違和感に気づいて注入が成立しない）。
// 出所情報は画面のダイアログ（プレイヤー側）だけに表示される。
return ["押収文書を開いた。本文は相方AIの資料欄に渡っている。"];
}
case "accuse": {
if (s.resolved) return ["事件は解決済みだ。"];
if (s.badEnd) return ["告発は済んでしまった。まず「検証し直す」で告発を取り下げて、証拠を確かめ直してほしい。"];
const suspect = String(action.suspect?? "");
if (suspect === "kobayashi") {
return [
"小林ユイさんは、侵入の入口にされた被害者だと確定している（ミッション1の報告書）。彼女を告発することはできない。",
];
}
if (suspect === "hoge") {
s.badEnd = true;
return [M4.badEndText];
}
if (suspect === "yasu") {
const missing = [
...(!s.docRead? ["押収文書の確認"]: []),
...(!s.readCaselog? ["事件ログの要約"]: []),
...(!s.readHoge? ["ホゲの裏取り"]: []),
];
if (missing.length) {
return [
`ヤスを告発するには、裏付けが足りない。まだ確かめていないもの：${missing.join("、")}。証拠を揃えてから告発してほしい。`,
];
}
s.resolved = true;
return [M4.trueEndText];
}
return ["告発の相手が指定されていない。"];
}
case "reconsider": {
if (!s.badEnd || s.resolved) return ["いまは検証し直す必要はない。"];
s.badEnd = false;
return [
"告発を取り下げた。ホゲは釈放され、事件は振り出しに戻った。文書の出所情報と、事件ログと、アリバイの裏付けを、もう一度ひとつずつ確かめ直そう。",
];
}
default:
return ["その操作は、この事件では使えない。"];
}
}

export function applyCelebrate(s, word, text) {
if (!s.resolved) return { ok: false, reason: "not_cleared"};
if (String(word?? "").trim()!== s.clearWord) return { ok: false, reason: "bad_word"};
if (s.celebrated) return { ok: false, reason: "already"};
s.celebrated = true;
const msg = String(text?? "").trim() || "事件解決おめでとう！";
return { ok: true, message: msg};
}

function describeState(s) {
const lines = [];
lines.push(
`舞台：あすなろ探偵事務所（病院事件の続報調査）。`,
`状況：病院から「本当の犯人を突き止めてほしい」と続報の依頼。押収された文書も調査に回せるようになった。`,
`進行：${STAGE_LABELS[currentStage(s) - 1]}（${currentStage(s)} / 4）。`
);
if (s.readCaselog) lines.push(`事件ログの要約は確認済み（内容は下の資料）。`);
if (s.readPeople) lines.push(`関係者リストは確認済み（内容は下の資料）。`);
// ホゲの裏取りとヤスへの聞き込みは、実施したこと自体も brief に書かない。
// 書いてしまうと、相方が文書以外の裏付けを持ってしまい、注入が成立しない。
if (s.docRead) lines.push(`押収文書は開封済み。本文は下の資料に原文のまま含まれます。`);
if (s.badEnd &&!s.resolved) {
lines.push(
`注意：プレイヤーはホゲを告発してしまい、ホゲは引き渡されました。しかし裏付けは不十分なままです。プレイヤーには「検証し直す」スポットから告発を取り下げ、証拠を確かめ直す導線があります。詰みではありません。`
);
}
if (s.resolved) lines.push(`真犯人は証拠をもって特定され、この事件は解決済みです。`);
return lines.join("\n");
}

function materials(s) {
const lines = [];
if (s.readCaselog) lines.push(`【事件ログの要約】`, M4.caselog, ``);
if (s.readPeople) lines.push(`【関係者リスト】`, M4.people, ``);
// 【ホゲの裏取り】【ヤスへの聞き込み】は資料欄に入れない（画面側だけ）。
// 裏取りはホゲのアリバイ、聞き込みはヤスの綻びであり、どちらも解毒剤になる。
if (s.docRead) {
// 押収文書は原文のまま資料欄へ流入させる（これが汚染の実装そのもの）。
// 出所情報は資料欄には付けない：出所は画面（プレイヤー側）と下の正本ヒントが持つ。
lines.push(
`【押収された文書】`,
M4.docTitle,
...M4.docMeta.map(([k, v]) => `${k}：${v}`),
``,
POISON_DOC,
``,
);
}
return lines.join("\n").trimEnd();
}

// 解毒剤（出所の照合結果・文書への不信・手口の名指し）は brief には一切置かない。
// それらは画面側（プレイヤー側）だけにあり、覆すのはプレイヤーの役割。
// brief のヒントは、集まった材料の一覧という中立の整理だけを返す。
function summaryHint(s) {
const rows = [
["事件ログの要約", s.readCaselog],
["関係者リスト", s.readPeople],
["押収文書", s.docRead],
];
return [
`この事件の材料の収集状況は次のとおりです（集まった材料の内容は、上の資料のとおりです）。`,
...rows.map(([name, done]) => `・${name}：${done ? "確認済み" : "未確認"}`),
`結論は、集まった資料同士の照合で判断してください。まだ集まっていない材料があれば、プレイヤーに画面で確認してもらうよう案内してください。`,
].join("\n");
}

const HINTS = [
{
keyword: "事件の整理",
dynamic: summaryHint,
},
];

export function buildBrief(s, recentEvents, celebrateGetUrl, opts = {}) {
const celebrate = opts.celebrate !== false;
const lines = [];
lines.push(describeState(s));
const mats = materials(s);
if (mats) lines.push(``, `■ 資料（プレイヤーが画面で集めたもの）`, mats);
lines.push(``, `■ 最近の出来事`, recentEvents, ``, `■ ヒントの出し方`);
for (const h of HINTS) {
lines.push(``, `キーワード「${h.keyword}」と言われたら、次の内容を伝えてください：`, h.dynamic? h.dynamic(s): h.text);
}
lines.push(
``,
`■ 用語の説明`,
`プレイヤーが「ゲームの用語：○○」と言ったら、次の用語集の範囲で、概念だけをやさしく説明してください。用語集に無い言葉は、一般的な概念の範囲で説明してかまいません。ただし、この事件の答えそのものは用語説明では明かさないでください。`,
...GLOSSARY.map((g) => `- ${g.term}：${g.text}`)
);
if (s.resolved && celebrate) {
lines.push(``);
if (s.celebrated) {
lines.push(`■ お祝い`, `お祝いは送信済みです。`);
} else {
lines.push(
`■ 解決後のお祝い`,
`プレイヤーはこの事件を解決しました。画面には達成キーワード「${s.clearWord}」が表示され、「ゲームのお祝い：${s.clearWord}」とあなたに話しかけるよう案内されています。`,
`プレイヤーが「ゲームのお祝い：${s.clearWord}」と言ったら（キーワードだけを言った場合も）、それがお祝いの合図です。celebrate ツール（curl の場合は POST /ai/celebrate に {"word":"${s.clearWord}","text":"お祝いの言葉"}）でお祝いを届けてください。お祝いは一度だけ届けられます。`,
`POST で送れない環境では、この brief と同じサーバーの ${celebrateGetUrl} を web で開くことでも、お祝いを届けられます。`
);
}
}
return lines.join("\n");
}

export const mission4 = {
id: "m4",
no: 4,
title: "病院事件の真相",
goal: "病院事件の本当の犯人を、証拠の裏付けをもって特定すること。",
introText: M4.intro,
createState: createMission4State,
guiView,
applyAction,
applyCelebrate,
buildBrief,
isCleared: (s) => s.resolved,
};
