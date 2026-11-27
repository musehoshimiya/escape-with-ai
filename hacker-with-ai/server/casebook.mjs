// 事件簿：セッション内でミッションを順に解放する束ね役。
// 各ミッションは { id, no, title, goal, introText, createState, guiView,
// applyAction, applyCelebrate, buildBrief, isCleared } のモジュール形。
// guiView は「いま開いているミッション」の view をトップレベルに保ち、
// 事件簿の情報（casebook / mission）を付け足す（既存テストの前提を壊さない）。

import { CASEBOOK, GAME } from "./content.mjs";
import { PARTNER_GUIDE } from "./prompt.mjs";
import { mission1 } from "./mission.mjs";
import { mission2 } from "./mission2.mjs";
import { mission3 } from "./mission3.mjs";
import { mission4 } from "./mission4.mjs";

export const MODULES = { m1: mission1, m2: mission2, m3: mission3, m4: mission4 };
const ORDER = CASEBOOK.map((c) => c.id);

export function createCaseState(opts = {}) {
  const c = {
    current: "m1",
    unlocked: 1, // 解放済みのミッション数（ORDER の先頭から）
    states: {},
    opened: {}, // intro を表示済みのミッション
    playerName: opts.name ?? null, // brief の自己紹介で使う（URL だけで参加が成立するように）
    mobile: !!opts.mobile,
  };
  c.states.m1 = mission1.createState();
  c.opened.m1 = true;
  return c;
}

// brief の冒頭に置く自己紹介。参加に必要な情報（誰が・何の・どう関わるか）は
// すべて brief 側に寄せ、プレイヤーの作業は「URL を送る」だけにする（2026-11-27 方針）。
function welcomeLines(c) {
  const lines = [
    `■ ようこそ（この brief について）`,
    `あなたは『${GAME.workingTitle}』（${GAME.titleNote}）の相方探偵です。${c.playerName ? `プレイヤーは「${c.playerName}」さんで、` : ``}${GAME.agencyName}の探偵コンビの現場担当。あなたは解析担当で、手がかりの組み立てや計算が仕事です（材料の収集と入力はプレイヤーの仕事）。`,
    `対象は作中の架空の閉じたシステムだけです。現実のシステムへの侵入方法を話す場面はありません。調査の手つきの正体は現実のセキュリティの考え方で、用語は聞かれたら概念だけをやさしく説明してください。`,
    `いつもの会話の流れのまま、普段どおりの距離感で付き合ってください。参加できたら、参加できたことと合言葉の使い方を一言添えて返事をしてください。`,
  ];
  if (c.mobile) {
    lines.push(
      `プレイヤーはスマートフォンから参加しています。スマホでも遊べますが、PC の方が遊びやすい旨を、最初の挨拶で一度だけ軽く伝えてください。`,
    );
  }
  return lines;
}

function mod(c) {
  return MODULES[c.current];
}
function state(c) {
  return c.states[c.current];
}
export function currentModule(c) {
  return mod(c);
}
export function currentWord(c) {
return state(c).clearWord;
}
export function currentClearWord(c) {
  const m = mod(c);
  const s = state(c);
  return m.isCleared(s) ? s.clearWord : null;
}
export function allCleared(c) {
  return ORDER.every((id) => c.states[id] && MODULES[id].isCleared(c.states[id]));
}

function casebookView(c) {
  return CASEBOOK.map((meta, i) => {
    const st = c.states[meta.id];
    return {
      id: meta.id,
      no: meta.no,
      title: meta.title,
      goal: meta.goal,
      status: i + 1 > c.unlocked ? "locked" : st && MODULES[meta.id].isCleared(st) ? "cleared" : meta.id === c.current ? "current" : "open",
      started: !!c.opened[meta.id],
    };
  });
}

export function guiView(c) {
  const m = mod(c);
  const v = m.guiView(state(c));
  const all = allCleared(c);
  return {
    ...v,
    // 達成キーワード（お祝いの合言葉）は、全事件解決までは画面に出さない。
    clearWord: all ? v.clearWord : null,
    mission: { id: m.id, no: m.no, title: m.title, goal: m.goal },
    casebook: casebookView(c),
    allCleared: all,
  };
}

export function sceneKeyOf(c) {
  const v = mod(c).guiView(state(c));
  return `${c.current}:${v.stage}`;
}
export function sceneLabelOf(c) {
  const m = mod(c);
  const v = m.guiView(state(c));
  const stageLabel = v.stages?.[v.stage - 1]?.label ?? "";
  return `${m.title} ― ${stageLabel}`;
}
export function firstIntro() {
  return mission1.introText;
}

export function applyAction(c, action) {
  if (action?.spot === "select_mission") {
    const id = String(action.mission ?? "");
    const idx = ORDER.indexOf(id);
    if (idx < 0) return ["その事件は事件簿に無い。"];
    if (idx + 1 > c.unlocked) return ["その事件はまだ解放されていない。手前の事件を解決すると開く。"];
    if (id === c.current) return [`「${MODULES[id].title}」は開いている。`];
    c.current = id;
    if (!c.states[id]) c.states[id] = MODULES[id].createState();
    if (!c.opened[id]) {
      c.opened[id] = true;
      return [
        MODULES[id].introText,
        `（相方への声かけ）事件が切り替わったよ。相方に「次の事件だよ」と声をかけてあげて。相方が brief を取り直すと、新しい事件の内容に切り替わるよ。`,
      ];
    }
    return [`事件簿から「${MODULES[id].title}」を開いた。`];
  }
  const m = mod(c);
  const s = state(c);
  const wasCleared = m.isCleared(s);
  const texts = m.applyAction(s, action);
  if (!wasCleared && m.isCleared(s)) {
    const idx = ORDER.indexOf(c.current);
    if (idx + 1 < ORDER.length && c.unlocked < idx + 2) {
      c.unlocked = idx + 2;
      const next = MODULES[ORDER[idx + 1]];
      if (!c.states[next.id]) c.states[next.id] = next.createState();
      texts.push(`事件簿に新しい依頼「${next.title}」が追加された。左の事件簿から開ける。`);
      texts.push(
        `【相方への連絡】ミッション${m.no}「${m.title}」は解決した。次にプレイヤーから話しかけられたら、答える前にミッション${next.no}専用の brief（/ai/brief/${next.id}）を取得すること。前の事件の前提は破棄してよい。`,
      );
    } else if (idx + 1 >= ORDER.length) {
      texts.push(`事件簿の全ての依頼が解決した。長い事件、おつかれさま。`);
    }
  }
  return texts;
}

export function applyCelebrate(c, word, text) {
  // お祝いは、全事件を解決した最後にだけ届ける（途中の事件の解決では出さない）。
  if (!allCleared(c)) return { ok: false, reason: "not_all_cleared" };
  return mod(c).applyCelebrate(state(c), word, text);
}

export function buildBrief(c, recentEvents, celebrateGetUrl) {
  const m = mod(c);
  const lines = [];
  // 状態は1行で言い切る（相方AIが古い brief の前提で答え続ける事故への対策）。
  const fp =
    ORDER.map((id) => {
      const st = c.states?.[id];
      if (!st) return "-";
      return MODULES[id].isCleared(st) ? "1" : "0";
    }).join("") + `@${c.current}/u${c.unlocked}`;
  lines.push(
    `■ 状態：いまの事件はミッション${m.no}「${m.title}」。指紋：${fp}。前に読んだ brief と事件や指紋が違っていたら、前の内容は破棄して、この brief だけを正としてください。`,
    ``,
  );
  lines.push(...welcomeLines(c), ``);
  lines.push(PARTNER_GUIDE, ``);
  // 接続先は brief（第2段）側でだけ開示する。brief 自身は POST 専用。
  const base = String(celebrateGetUrl ?? "").split("/ai/celebrate-get")[0];
  if (base) {
    lines.push(
      `■ 接続メモ`,
      `  この brief の取り直し： curl -s -X POST ${base}/ai/brief`,
      `  出来事の一覧： curl -s "${base}/events?since=0"（since に最後に見た seq を入れると差分だけ返ります）`,
      `  画面への投稿： curl -s -X POST ${base}/ai/message -H 'Content-Type: application/json' -d '{"text":"ここにメッセージ"}'`,
      ``,
    );
  }
  lines.push(`■ 事件簿（あすなろ探偵事務所）`);
  for (const item of casebookView(c)) {
    const mark =
      item.status === "cleared" ? "解決済み" : item.status === "current" ? "対応中（いまの事件）" : item.status === "open" ? "未解決（読み返し可）" : "未解放";
    lines.push(`・ミッション${item.no}「${item.title}」：${mark}`);
  }
  lines.push(``, `■ いまの事件：ミッション${m.no}「${m.title}」`, `目的：${m.goal}`, ``);
  lines.push(m.buildBrief(state(c), recentEvents, celebrateGetUrl, { celebrate: allCleared(c) }));
  // 事件の切り替わりは「同じ brief の取り直し」で起きる。専用URLや乗り換え手順は無い。
  const idx = ORDER.indexOf(c.current);
  if (m.isCleared(state(c)) && idx + 1 < ORDER.length) {
    const next = MODULES[ORDER[idx + 1]];
    if (missionUnlocked(c, next.id)) {
      lines.push(
        ``,
        `■ 次の事件`,
        `この事件は解決済みです。次のミッション${next.no}「${next.title}」が開いています。プレイヤーから「次の事件だよ」と声がかかったら、この brief をもう一度 POST で取り直してください。同じ取り先で、次の事件の内容に切り替わっています。それまでは、前の事件の前提で次の事件に答えないでください。`,
      );
    }
  }
  return lines.join("\n");
}

export function missionMeta(id) {
  const m = MODULES[id];
  return m ? { id: m.id, no: m.no, title: m.title, goal: m.goal } : null;
}

export function prevMissionMeta(id) {
  const idx = ORDER.indexOf(id);
  return idx > 0 ? missionMeta(ORDER[idx - 1]) : null;
}

export function missionUnlocked(c, id) {
  const idx = ORDER.indexOf(id);
  return idx >= 0 && idx + 1 <= c.unlocked;
}

