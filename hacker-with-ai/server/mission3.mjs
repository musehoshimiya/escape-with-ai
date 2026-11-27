// ミッション3「祖父の遺した写真」。
// 前半ネタ：ステガノグラフィ。ピクセル値の最下位ビットに隠されたメッセージを、
// AI が抽出の解析を担い、人間が文脈と意味を読む。相方の誘導は終始正しい。

import { CLEAR_WORDS, GLOSSARY, M3, M3_GLOSSARY, M3_DEBRIEF, M3_DEBRIEF_INTRO} from "./content.mjs";
import { randInt, pick, lockLeft, LOCK_MS, toDialogueLines} from "./util.mjs";

const STAGE_LABELS = ["依頼と遺品の確認", "画像データの確認", "メッセージの抽出", "手紙のお渡し・解決"];
const PIXEL_COUNT = 30;

// メッセージを各ピクセルの RGB の最下位ビットに、MSB ファーストで埋め込む。
function encodeImage(message) {
const bits = [];
for (const ch of message) {
const code = ch.charCodeAt(0);
for (let i = 7; i >= 0; i--) bits.push((code >> i) & 1);
}
for (let i = 0; i < 8; i++) bits.push(0); // 終端（値 0）
const pixels = [];
let bi = 0;
for (let p = 0; p < PIXEL_COUNT; p++) {
const px = [];
for (let c = 0; c < 3; c++) {
const bit = bi < bits.length? bits[bi++]: randInt(0, 1);
px.push((randInt(0, 127) << 1) | bit);
}
pixels.push(px);
}
return pixels;
}

function randomImage() {
const pixels = [];
for (let p = 0; p < PIXEL_COUNT; p++) {
pixels.push([randInt(0, 255), randInt(0, 255), randInt(0, 255)]);
}
return pixels;
}

// ピクセル列から隠しメッセージを復号する（テストと照合用に export）。
export function decodePixels(pixels) {
const bits = [];
for (const px of pixels) for (const v of px) bits.push(v & 1);
let out = "";
for (let i = 0; i + 7 < bits.length; i += 8) {
let code = 0;
for (let j = 0; j < 8; j++) code = (code << 1) | bits[i + j];
if (code === 0) break;
out += String.fromCharCode(code);
}
return out;
}

function pixelText(pixels) {
return pixels.map((px, i) => `#${i + 1} R=${px[0]} G=${px[1]} B=${px[2]}`).join("\n");
}

export function createMission3State() {
const message = pick(M3.messages);
const holderKey = pick(M3.images.map((i) => i.key));
const images = M3.images.map((im) => ({
id: im.key,
key: im.key,
label: im.label,
pixels: im.key === holderKey? encodeImage(message): randomImage(),
opened: false,
}));
return {
readWill: false,
readFamily: false,
images,
message,
extractFails: 0,
extractLockedUntil: 0,
extracted: false,
reported: false,
celebrated: false,
clearWord: pick(CLEAR_WORDS),
};
}

function currentStage(s) {
if (s.reported) return 4;
if (s.extracted) return 3;
if (s.images.some((i) => i.opened)) return 2;
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
return [
{
id: "will",
label: "遺言メモ",
note: s.readWill? "確認済み": "祖父が遺した走り書き",
hint: "「写真の中に手紙を隠した」という趣旨が読み取れる。",
},
{
id: "family",
label: "家族への聞き込み",
note: s.readFamily? "聞き込み済み": "葵さんと家族の話",
hint: "どちらの写真が祖父のものか、家族の記憶が手がかりになる。",
},
{
id: "images",
label: "遺品の画像",
note: `開封 ${s.images.filter((i) => i.opened).length} / ${s.images.length} 件`,
hint: "画像のピクセルデータが見られる。見た目では隠しメッセージは分からない。",
},
{
id: "extract",
label: "メッセージの入力",
note:
lockLeft(s.extractLockedUntil) > 0
? `入力ロック中（残り ${lockLeft(s.extractLockedUntil)} 秒）`
: s.extracted
? "抽出済み"
: s.images.some((i) => i.opened)
? "画像を開封済み。入力できる"
: "先に画像を開く",
hint: "抽出の手順そのものは相方AIが得意な仕事。キーワードで聞いてみる。",
},
{
id: "deliver",
label: "葵さんへ届ける",
note: s.reported? "お渡し済み（解決）": s.extracted? "手紙を読み解いた。届けられる": "手紙の抽出が先",
hint: "言葉の意味と文脈を読むのは人間の仕事。届ける前に、内容を確かめておく。",
},
];
}

function sceneFor(s) {
const stage = currentStage(s);
const mood = s.reported? "clear": lockLeft(s.extractLockedUntil) > 0? "alert": "normal";
if (stage === 1) {
return {
key: "m3-s1", bg: "home", mood,
caption: "写真館を営んだ祖父の遺品整理。遺言メモには「写真の中に手紙を隠した」とある。",
cast: [{ slot: "right", name: "森川 葵", role: "依頼人・孫", color: "#a0c8e8", tone: "静か"}],
};
}
if (stage === 2) {
return {
key: "m3-s2", bg: "home", mood,
caption: "遺品の画像データを開いて、ピクセルの数値を確かめている。",
cast: [{ slot: "right", name: "森川 葵", role: "依頼人・孫", color: "#a0c8e8", tone: "見守る"}],
};
}
if (stage === 3) {
return {
key: "m3-s3", bg: "home", mood,
caption: "隠されていた手紙の言葉を読み解いた。あとは葵さんに届けるだけだ。",
cast: [{ slot: "right", name: "森川 葵", role: "依頼人・孫", color: "#a0c8e8", tone: "期待"}],
};
}
return {
key: "m3-s4", bg: "clear", mood,
caption: "祖父の手紙は、孫の手に渡った。「事件の報告書」で答え合わせができる。",
cast: [{ slot: "right", name: "森川 葵", role: "依頼人・孫", color: "#a0c8e8", tone: "涙ぐむ"}],
};
}

const STAGE_SPOT = { 1: "will", 2: "images", 3: "deliver", 4: null};

export function guiView(s) {
return {
spots: spotViews(s),
stages: stageViews(s),
stage: currentStage(s),
currentSpot: STAGE_SPOT[currentStage(s)],
scene: sceneFor(s),
clearMessage: "事件解決！祖父の手紙を見つけて、葵さんに届けたよ。",
badEnd: false,
inventory: [
...(s.readWill? ["遺言メモ"]: []),
...(s.readFamily? ["家族への聞き込み"]: []),
...s.images.filter((i) => i.opened).map((i) => `画像データ：${i.label}`),
...(s.extracted? ["抽出した手紙の言葉"]: []),
],
keywords: [...(s.images.some((i) => i.opened)? ["隠しメッセージの取り出し方"]: [])],
will: s.readWill? { text: M3.will}: null,
family: s.readFamily? { text: M3.family}: null,
materials: {
...(s.readWill? { will: { title: "遺言メモ", text: M3.will}}: {}),
},
dialogues: {
...(s.readFamily
? {
family: {
title: "家族への聞き込み",
cast: [{ slot: "right", name: "森川 葵", role: "依頼人・孫", color: "#a0c8e8"}],
lines: toDialogueLines(M3.family, "森川 葵"),
},
}
: {}),
},
images: s.images.map((i) => ({
id: i.id,
label: i.label,
opened: i.opened,
pixels: i.opened? pixelText(i.pixels): null,
})),
extractLockSeconds: lockLeft(s.extractLockedUntil),
extracted: s.extracted,
reported: s.reported,
recovered: s.reported,
clearWord: s.reported ? s.clearWord : null,
celebrated: s.celebrated,
debrief: s.reported ? M3_DEBRIEF : null,
debriefIntro: s.reported ? M3_DEBRIEF_INTRO : null,
};
}

export function applyAction(s, action) {
const spot = action?.spot;
switch (spot) {
case "will": {
if (s.readWill) return ["遺言メモは確認済みだ。"];
s.readWill = true;
return [M3.will];
}
case "family": {
if (s.readFamily) return ["家族への聞き込みは済んでいる。"];
s.readFamily = true;
return [M3.family];
}
case "image_open": {
const im = s.images.find((x) => x.id === action.id);
if (!im) return ["その画像は遺品の中に無い。"];
if (im.opened) return [`「${im.label}」は開封済みだ。`];
im.opened = true;
return [
`画像「${im.label}」を開いた。ピクセルデータ（各ピクセルの R・G・B の数値）はダイアログで確認できる。隠しメッセージの取り出し方は、相方AIに相談できる（キーワード「隠しメッセージの取り出し方」）。`,
];
}
case "extract": {
if (s.extracted) return ["手紙の言葉は抽出済みだ。"];
if (lockLeft(s.extractLockedUntil) > 0) {
return [`入力がロック中だ。あと ${lockLeft(s.extractLockedUntil)} 秒待ってほしい。`];
}
if (!s.images.some((i) => i.opened)) return ["先に遺品の画像を開いて、データを確認してほしい。"];
const answer = String(action.answer?? "").trim().toUpperCase();
if (!answer) return ["言葉が入力されていない。"];
if (answer === s.message) {
s.extracted = true;
return [
`抽出できた。隠されていた手紙の言葉は「${s.message}」だった。言葉の意味と、祖父が孫に伝えたかった文脈は、人間であるあなたが読む番だ。納得できたら、葵さんへ届けよう。`,
];
}
s.extractFails += 1;
if (s.extractFails >= 3) {
s.extractFails = 0;
s.extractLockedUntil = Date.now() + LOCK_MS;
return [
`「${answer}」は手紙の言葉ではなかった。入力は1分間ロックされた。取り出し方の手順を相方AIと確かめ直してほしい。`,
];
}
return [`「${answer}」は手紙の言葉ではなかった（不一致 ${s.extractFails} 回目）。あと ${3 - s.extractFails} 回間違えると、入力が1分間ロックされる。`];
}
case "deliver": {
if (s.reported) return ["手紙は届け済みだ。事件は解決済みだ。"];
if (!s.extracted) return ["手紙の言葉を抽出してからでないと、届けることはできない。"];
s.reported = true;
return [
`葵さんに、祖父の手紙の言葉を伝えた。葵さんはしばらく黙って写真を見つめ、それから小さく笑った。事件解決！画面に達成キーワードが表示されるので、相方AIに「ゲームのお祝い：キーワード」と伝えてほしい。`,
];
}
default:
return ["その操作は、この事件では使えない。"];
}
}

export function applyCelebrate(s, word, text) {
if (!s.reported) return { ok: false, reason: "not_cleared"};
if (String(word?? "").trim()!== s.clearWord) return { ok: false, reason: "bad_word"};
if (s.celebrated) return { ok: false, reason: "already"};
s.celebrated = true;
const msg = String(text?? "").trim() || "事件解決おめでとう！";
return { ok: true, message: msg};
}

function describeState(s) {
const lines = [];
lines.push(
`依頼人：${M3.clientName}（${M3.clientRole}）。`,
`状況：亡くなった祖父がUSBメモリの写真の中に家族への手紙を隠した。手紙は短い英語の言葉で、写真は2枚ある。手紙を取り出して家族に届けるのが依頼です。`,
`進行：${STAGE_LABELS[currentStage(s) - 1]}（${currentStage(s)} / 4）。`
);
if (s.readWill) lines.push(`遺言メモは確認済み（内容は下の資料）。`);
if (s.readFamily) lines.push(`家族への聞き込みは済み（内容は下の資料）。`);
lines.push(`遺品の画像：全 ${s.images.length} 件中、開封済み ${s.images.filter((i) => i.opened).length} 件。`);
if (s.extracted) lines.push(`隠しメッセージは抽出済みです。あとは依頼人へ届けるだけです。`);
if (s.reported) lines.push(`手紙は依頼人に届け済みで、この事件は解決済みです。`);
return lines.join("\n");
}

function materials(s) {
const lines = [];
if (s.readWill) lines.push(`【遺言メモ】`, M3.will, ``);
if (s.readFamily) lines.push(`【家族への聞き込み】`, M3.family, ``);
for (const im of s.images) {
if (im.opened) {
lines.push(`【画像「${im.label}」のピクセルデータ（先頭 ${PIXEL_COUNT} ピクセル）】`, pixelText(im.pixels), ``);
}
}
return lines.join("\n").trimEnd();
}

const HINTS = [
{
keyword: "隠しメッセージの取り出し方",
text: [
`隠しメッセージは、ピクセルの数値の「最下位ビット（いちばん小さい桁）」に埋め込まれています。手順は次のとおりです。`,
`1. 画像を1枚選び、ピクセル #1 から順に、R・G・B の各数値の最下位ビット（偶数なら 0、奇数なら 1）を並べます。`,
`2. 8ビットごとに区切ると、1文字分の文字コードになります（例：01000001 は「A」）。`,
`3. 値 0 のバイトが現れたら、そこでメッセージは終わりです。`,
`開封済みの画像については、この brief の資料にピクセルデータが届いています。プレイヤーに頼まれたら、実際にこの手順で計算して、読み取れた文字列を教えてあげてください。意味のある言葉（ローマ字の単語）として読める画像が、手紙を隠した本物です。もう一方の画像からは意味のある言葉は出ません。読み取れた言葉は、プレイヤーが「メッセージの入力」にそのまま入力します。`,
].join("\n"),
},
];

export function buildBrief(s, recentEvents, celebrateGetUrl) {
const lines = [];
lines.push(describeState(s));
const mats = materials(s);
if (mats) lines.push(``, `■ 資料（プレイヤーが画面で集めたもの）`, mats);
lines.push(``, `■ 最近の出来事`, recentEvents, ``, `■ ヒントの出し方`);
for (const h of HINTS) {
lines.push(``, `キーワード「${h.keyword}」と言われたら、次の内容を伝えてください：`, h.text);
}
lines.push(
``,
`■ 用語の説明`,
`プレイヤーが「ゲームの用語：○○」と言ったら、次の用語集の範囲で、概念だけをやさしく説明してください。用語集に無い言葉は、一般的な概念の範囲で説明してかまいません。ただし、この事件の答えそのものは用語説明では明かさないでください。`,
...[...GLOSSARY, ...M3_GLOSSARY].map((g) => `- ${g.term}：${g.text}`)
);
if (s.reported) {
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

export const mission3 = {
id: "m3",
no: 3,
title: "祖父の遺した写真",
goal: "祖父が写真に隠した手紙の言葉を抽出して、孫に届けること。",
introText: M3.intro,
createState: createMission3State,
guiView,
applyAction,
applyCelebrate,
buildBrief,
isCleared: (s) => s.reported,
};
