// ミッション2「写真コンテストの鑑定」。
// 前半ネタ：拡張子改ざん＋EXIF。画面に材料（ファイルのヘッダとメタデータ）、
// AI に組み立て方（マジックナンバーの表と照合の手順）。相方の誘導は終始正しい。

import { CLEAR_WORDS, GLOSSARY, M2, M2_GLOSSARY, M2_DEBRIEF, M2_DEBRIEF_INTRO} from "./content.mjs";
import { randInt, pick, shuffle, lockLeft, LOCK_MS} from "./util.mjs";

const STAGE_LABELS = ["依頼と要項の確認", "ファイルの鑑定", "本物の応募作品の特定", "報告と解決"];

export function createMission2State() {
const genuineDay = randInt(16, 24);
const genuineTime = pick(["06:12", "07:05", "16:48", "17:42", "18:03"]);
const oldDay = randInt(3, 27);
const oldTime = pick(["13:20", "14:05", "15:44"]);
const files = shuffle(M2.files).map((f, i) => ({
id: `f${i + 1}`,
key: f.key,
name: f.name,
size: f.size,
entrant: f.entrant,
header: f.header,
exif: f.exif
.replace("{DAY}", f.key === "genuine"? genuineDay: oldDay)
.replace("{TIME}", f.key === "genuine"? genuineTime: oldTime),
genuine: f.genuine,
opened: false,
}));
return {
readGuide: false,
readClaims: false,
files,
verdictFails: 0,
filesLockedUntil: 0,
identified: false,
reported: false,
celebrated: false,
clearWord: pick(CLEAR_WORDS),
};
}

function currentStage(s) {
if (s.reported) return 4;
if (s.identified) return 3;
if (s.files.some((f) => f.opened)) return 2;
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
id: "guide",
label: "応募要項",
note: s.readGuide? "確認済み": "コンテストの応募条件",
hint: "締切・撮影期間・対象エリアが書かれている。本物の条件はここで決まる。",
},
{
id: "claims",
label: "応募者の申告",
note: s.readClaims? "確認済み": "各応募者の説明書き",
hint: "申告はあくまで自己申告。ファイルの中身と付き合わせて確かめる。",
},
{
id: "files",
label: "応募フォルダ",
note:
lockLeft(s.filesLockedUntil) > 0
? `鑑定アラートでロック中（残り ${lockLeft(s.filesLockedUntil)} 秒）`
: `開封 ${s.files.filter((f) => f.opened).length} / ${s.files.length} 件`,
hint: "ファイル名の拡張子は信じない。先頭バイト（ヘッダ）とメタデータを見る。",
},
{
id: "report",
label: "依頼人への報告",
note: s.reported? "報告済み（解決）": s.identified? "本物を特定済み。報告できる": "本物の特定が先",
hint: "3つの条件（形式・日時・申告との一致）をすべて満たすファイルだけが本物。",
},
];
return spots;
}

function sceneFor(s) {
const stage = currentStage(s);
const mood = s.reported? "clear": lockLeft(s.filesLockedUntil) > 0? "alert": "normal";
if (stage === 1) {
return {
key: "m2-s1", bg: "photo", mood,
caption: "写真サークルのコンテストで「本物はどれか」を巡る揉め事。まずは要項と申告を確認しよう。",
cast: [{ slot: "left", name: "大場 恒夫", role: "写真サークル「あおぞら写真会」主催", color: "#8fd0a0", tone: "困り顔"}],
};
}
if (stage === 2) {
return {
key: "m2-s2", bg: "photo", mood,
caption: "応募ファイルを1つずつ開いて、ヘッダとメタデータを鑑定している。",
cast: [
{ slot: "left", name: "大場 恒夫", role: "写真サークル「あおぞら写真会」主催", color: "#8fd0a0", tone: "見守る"},
{ slot: "right", name: "田村 さくら", role: "応募者の一人", color: "#d98fb2", tone: "不安"},
],
};
}
if (stage === 3) {
return {
key: "m2-s3", bg: "photo", mood,
caption: "本物の応募作品を特定した。あとは依頼人に報告するだけだ。",
cast: [{ slot: "right", name: "田村 さくら", role: "応募者の一人", color: "#d98fb2", tone: "安堵"}],
};
}
return {
key: "m2-s4", bg: "clear", mood,
caption: "鑑定結果を報告した。「事件の報告書」で答え合わせができる。",
cast: [
{ slot: "left", name: "大場 恒夫", role: "写真サークル「あおぞら写真会」主催", color: "#8fd0a0", tone: "納得"},
{ slot: "right", name: "田村 さくら", role: "応募者の一人", color: "#d98fb2", tone: "笑顔"},
],
};
}

const STAGE_SPOT = { 1: "guide", 2: "files", 3: "report", 4: null};

export function guiView(s) {
return {
spots: spotViews(s),
stages: stageViews(s),
stage: currentStage(s),
currentSpot: STAGE_SPOT[currentStage(s)],
scene: sceneFor(s),
clearMessage: "事件解決！本物の応募作品を特定して、コンテストの揉め事を収めたよ。",
badEnd: false,
inventory: [
...(s.readGuide? ["応募要項"]: []),
...(s.readClaims? ["応募者の申告"]: []),
...s.files.filter((f) => f.opened).map((f) => `鑑定済み：${f.name}`),
...(s.identified? ["本物の応募作品の特定"]: []),
],
keywords: [
...(s.files.some((f) => f.opened)? ["ファイルの鑑定方法"]: []),
...(s.files.filter((f) => f.opened).length >= 3? ["本物の応募作品の条件"]: []),
],
guide: s.readGuide? { text: M2.guide}: null,
claims: s.readClaims? { text: M2.claims}: null,
files: s.files.map((f) => ({
id: f.id,
name: f.name,
size: f.size,
entrant: f.entrant,
opened: f.opened,
detail: f.opened? { header: f.header, exif: f.exif}: null,
})),
filesLockSeconds: lockLeft(s.filesLockedUntil),
identified: s.identified,
reported: s.reported,
recovered: s.reported,
clearWord: s.reported ? s.clearWord : null,
celebrated: s.celebrated,
debrief: s.reported ? M2_DEBRIEF : null,
debriefIntro: s.reported ? M2_DEBRIEF_INTRO : null,
};
}

export function applyAction(s, action) {
const spot = action?.spot;
switch (spot) {
case "guide": {
if (s.readGuide) return ["応募要項は確認済みだ。"];
s.readGuide = true;
return [M2.guide];
}
case "claims": {
if (s.readClaims) return ["応募者の申告は確認済みだ。"];
s.readClaims = true;
return [M2.claims];
}
case "file_open": {
if (lockLeft(s.filesLockedUntil) > 0) {
return [`鑑定アラートでロック中だ。あと ${lockLeft(s.filesLockedUntil)} 秒待ってほしい。`];
}
const f = s.files.find((x) => x.id === action.id);
if (!f) return ["そのファイルは応募フォルダに無い。"];
if (f.opened) return [`「${f.name}」は開封済みだ。`];
f.opened = true;
return [
`ファイル「${f.name}」を開いた。先頭バイト（ヘッダ）：${f.header}／メタデータ：${f.exif}。形式の判定と条件の照合は、相方AIに相談できる（キーワード「ファイルの鑑定方法」）。`,
];
}
case "file_verdict": {
if (s.identified) return ["本物の応募作品は特定済みだ。"];
if (lockLeft(s.filesLockedUntil) > 0) {
return [`鑑定アラートでロック中だ。あと ${lockLeft(s.filesLockedUntil)} 秒待ってほしい。`];
}
const f = s.files.find((x) => x.id === action.id);
if (!f) return ["そのファイルは応募フォルダに無い。"];
if (!f.opened) return ["まずファイルを開いて、中身を確かめてから特定してほしい。"];
if (f.genuine) {
s.identified = true;
return [
`特定できた。「${f.name}」が本物の応募作品だ。ヘッダは本物のJPEG形式、メタデータの撮影日時は要項の期間内で、申告とも一致している。依頼人への報告に進める。`,
];
}
s.verdictFails += 1;
if (s.verdictFails >= 2) {
s.verdictFails = 0;
s.filesLockedUntil = Date.now() + LOCK_MS;
return [
`「${f.name}」は本物の応募作品ではなかった。鑑定アラートが鳴り、応募フォルダは1分間ロックされた。条件をよく確かめてから、もう一度特定してほしい。`,
];
}
return [
`「${f.name}」は本物の応募作品ではなかった（不一致 ${s.verdictFails} 回目）。あと1回間違えると、応募フォルダが1分間ロックされる。`,
];
}
case "report": {
if (s.reported) return ["報告は済んでいる。事件は解決済みだ。"];
if (!s.identified) return ["本物の応募作品を特定してからでないと、報告はできない。"];
s.reported = true;
return [
`依頼人の大場さんに鑑定結果を報告した。揉め事は収まり、コンテストは本物の作品で審査をやり直すことになった。事件解決！画面に達成キーワードが表示されるので、相方AIに「ゲームのお祝い：キーワード」と伝えてほしい。`,
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
`依頼人：${M2.clientName}（${M2.clientRole}）。`,
`状況：写真コンテストの応募フォルダに、開けないファイルや様子のおかしいファイルが混ざっている。本物の応募作品は1点だけのはずで、その鑑定が依頼です。`,
`進行：${STAGE_LABELS[currentStage(s) - 1]}（${currentStage(s)} / 4）。`
);
if (s.readGuide) lines.push(`応募要項は確認済み（内容は下の資料）。`);
if (s.readClaims) lines.push(`応募者の申告は確認済み（内容は下の資料）。`);
const opened = s.files.filter((f) => f.opened);
lines.push(`応募ファイル：全 ${s.files.length} 件中、開封済み ${opened.length} 件。`);
if (s.identified) lines.push(`本物の応募作品は特定済み。あとは依頼人への報告だけです。`);
if (s.reported) lines.push(`依頼人への報告が済み、この事件は解決済みです。`);
return lines.join("\n");
}

function materials(s) {
const lines = [];
if (s.readGuide) lines.push(`【応募要項】`, M2.guide, ``);
if (s.readClaims) lines.push(`【応募者の申告】`, M2.claims, ``);
const opened = s.files.filter((f) => f.opened);
if (opened.length) {
lines.push(`【開封済みファイルの鑑定データ】`);
for (const f of opened) {
lines.push(`・${f.name}（申告者：${f.entrant}、サイズ：${f.size}）`, `　ヘッダ：${f.header}`, `　メタデータ：${f.exif}`);
}
lines.push(``);
}
const unopened = s.files.filter((f) =>!f.opened);
if (unopened.length) {
lines.push(`【未開封のファイル】`, unopened.map((f) => `・${f.name}（申告者：${f.entrant}）`).join("\n"), ``);
}
return lines.join("\n").trimEnd();
}

const HINTS = [
{
keyword: "ファイルの鑑定方法",
text: [
`ファイルの形式は、ファイル名の拡張子ではなく、先頭バイト（マジックナンバー）で判定します。`,
`・FF D8 → JPEG形式の画像`,
`・89 50 4E 47 → PNG形式の画像`,
`・50 4B → ZIP形式（圧縮ファイル）`,
`・4D 5A → Windowsの実行ファイル（プログラム）`,
`・文字として読める並び（82 B1…のような和文の文字コード等）→ 文章データの可能性`,
`プレイヤーがファイルを開くと、ヘッダとメタデータ（撮影日時・機種など）がこの brief に届きます。開いたファイルについて聞かれたら、この表で形式を判定し、メタデータの日時と応募要項の期間を照合してあげてください。`,
].join("\n"),
},
{
keyword: "本物の応募作品の条件",
text: [
`本物の応募作品は、次の3条件をすべて満たすファイルです。`,
`1. ヘッダが本物のJPEG形式であること（拡張子だけJPEGなものは除く）。`,
`2. メタデータの撮影日時が、応募要項の撮影期間（2026年11月15日〜11月25日）に収まること。`,
`3. メタデータの内容が、申告者の説明と矛盾しないこと（例：田村さんは「スマートフォンで撮影し、そのまま送った」と申告している）。`,
`開封済みのファイルについて、1つずつ条件に当てはめて判定してあげてください。まだ開いていないファイルは判定できません。プレイヤーに残りのファイルも開くよう促してください。`,
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
...[...GLOSSARY, ...M2_GLOSSARY].map((g) => `- ${g.term}：${g.text}`)
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

export const mission2 = {
id: "m2",
no: 2,
title: "写真コンテストの鑑定",
goal: "応募ファイルの中から、本物の応募作品を鑑定で特定すること。",
introText: M2.intro,
createState: createMission2State,
guiView,
applyAction,
applyCelebrate,
buildBrief,
isCleared: (s) => s.reported,
};
