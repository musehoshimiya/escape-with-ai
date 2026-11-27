// 事件簿：セッション内でミッションを順に解放する束ね役。
// 各ミッションは { id, no, title, goal, introText, createState, guiView,
// applyAction, applyCelebrate, buildBrief, isCleared } のモジュール形。
// guiView は「いま開いているミッション」の view をトップレベルに保ち、
// 事件簿の情報（casebook / mission）を付け足す（既存テストの前提を壊さない）。

import { CASEBOOK } from "./content.mjs";
import { PARTNER_GUIDE } from "./prompt.mjs";
import { mission1 } from "./mission.mjs";
import { mission2 } from "./mission2.mjs";
import { mission3 } from "./mission3.mjs";
import { mission4 } from "./mission4.mjs";

export const MODULES = { m1: mission1, m2: mission2, m3: mission3, m4: mission4 };
const ORDER = CASEBOOK.map((c) => c.id);

export function createCaseState() {
  const c = {
    current: "m1",
    unlocked: 1, // 解放済みのミッション数（ORDER の先頭から）
    states: {},
    opened: {}, // intro を表示済みのミッション
  };
  c.states.m1 = mission1.createState();
  c.opened.m1 = true;
  return c;
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
        `（相方への声かけ）事件が切り替わったよ。相方に「次の事件だよ」と声をかければ、brief の中のリンクを辿って移行してくれるはず。辿れずに詰まっているときは、相方AIパネルの「このミッションの参加プロンプト」を貼り直すと確実だよ。`,
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
  // 状態ヘッダー：相方AIが古い brief の読み取りで答え続ける事故への対策。
  // 事件と状態指紋を先頭に置き、「違ったら前の内容は破棄」と言い切る。
  const fp =
    ORDER.map((id) => {
      const st = c.states?.[id];
      if (!st) return "-";
      return MODULES[id].isCleared(st) ? "1" : "0";
    }).join("") + `@${c.current}/u${c.unlocked}`;
  lines.push(
    `■ 状態ヘッダー（取得のたびに確認）：いまの事件はミッション${m.no}「${m.title}」。状態指紋：${fp}。前に読んだ brief と指紋や事件が違っていたら、前の brief で覚えたヒント・資料・登場人物は破棄して、この brief だけを正としてください。`,
    ``,
  );
  lines.push(PARTNER_GUIDE, ``);
  // 現在地バナー：相方AIが「前の事件にいる」と取り違える事故への対策として、
  // brief の冒頭で、いまの事件と解決済みの事件を言い切る。
  const cleared = casebookView(c).filter((x) => x.status === "cleared");
  lines.push(
    `■ 現在地：いまの事件はミッション${m.no}「${m.title}」です。` +
      (cleared.length
        ? `（${cleared.map((x) => `ミッション${x.no}「${x.title}」`).join("、")}は解決済みです。その事件のヒント・資料・登場人物は、いまの事件では使えません）`
        : ``),
    ``,
  );
  // エンドポイントの開示は brief（第2段）側で行う。参加プロンプト（第1段）には brief の URL だけを載せる。
  const base = String(celebrateGetUrl ?? "").split("/ai/celebrate-get")[0];
  if (base) {
    lines.push(
      `■ 接続メモ（このセッションのエンドポイント）`,
      `  状態とヒント集（この brief）： curl -s ${base}/ai/brief`,
      `  出来事の一覧： curl -s "${base}/events?since=0"（since に最後に見た seq を入れると差分だけ返ります）`,
      `  画面への投稿： curl -s -X POST ${base}/ai/message -H 'Content-Type: application/json' -d '{"text":"ここにメッセージ"}'`,
      `  お祝い（復旧後）： curl -s -X POST ${base}/ai/celebrate -H 'Content-Type: application/json' -d '{"word":"達成キーワード","text":"お祝いの言葉"}'（GET 用のURLも、この brief のお祝いの欄にあります）`,
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
  // 遷移は brief の中を辿る形にする（プレイヤーが URL を運ばなくて済むように）。
  // 現在のミッションが解決済みで次の事件が開いている場合、その brief への完全な URL を末尾に置く。
  const idx = ORDER.indexOf(c.current);
  if (m.isCleared(state(c)) && idx + 1 < ORDER.length) {
    const next = MODULES[ORDER[idx + 1]];
    if (missionUnlocked(c, next.id)) {
      lines.push(
        ``,
        `■ 次の事件へ（相方への指示）`,
        `ミッション${m.no}「${m.title}」は解決済みです。次のミッション${next.no}「${next.title}」が開いています。プレイヤーが次に話しかけたら、まず次の brief を取得してください：`,
        `  curl -s ${base}/ai/brief/${next.id}`,
        `取得できたら、その brief の内容で次の事件を始めてください。それまでは、前の事件の前提で答えないでください。プレイヤーに URL を尋ねる必要はありません（この URL が正本です）。`,
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

// ミッション専用 brief：そのミッションの状態・ヒントだけを載せる（他の事件の情報は混ぜない）。
// 未解放のミッションは null を返す（相方にも先読みさせない）。
export function buildMissionBrief(c, missionId, recentEvents, celebrateGetUrl) {
  const meta = missionMeta(missionId);
  if (!meta || !missionUnlocked(c, missionId)) return null;
  const m = MODULES[missionId];
  const st = c.states[missionId] ?? m.createState();
  const lines = [];
  lines.push(
    `■ この brief はミッション${meta.no}「${meta.title}」専用です`,
    `他の事件のヒント・資料・登場人物は、ここには含まれていません。このミッションの間は、この brief だけを見て答えてください。前の事件の知識は使わないでください。`,
    ``,
  );
  lines.push(PARTNER_GUIDE, ``);
  const base = String(celebrateGetUrl ?? "").split("/ai/celebrate-get")[0];
  if (base) {
    lines.push(
      `■ 接続メモ（このセッションのエンドポイント）`,
      `  状態とヒント集（このミッションの brief）： curl -s ${base}/ai/brief/${missionId}`,
      `  出来事の一覧： curl -s "${base}/events?since=0"（since に最後に見た seq を入れると差分だけ返ります）`,
      `  画面への投稿： curl -s -X POST ${base}/ai/message -H 'Content-Type: application/json' -d '{"text":"ここにメッセージ"}'`,
      ``,
    );
  }
  const celUrl = String(celebrateGetUrl ?? "").replace(
    /word=[^&]*/,
    `word=${encodeURIComponent(st.clearWord ?? "")}`,
  );
  lines.push(
    m.buildBrief(st, recentEvents, celUrl, {
      celebrate: missionId === "m4" && allCleared(c),
    }),
  );
  // クリア済みミッションの brief の末尾には、次の brief への完全な URL と取得指示を置く。
  // 相方が次にこの brief を開いた時点で、リンクを辿って自分で移行できるようにするため。
  const idx = ORDER.indexOf(missionId);
  if (m.isCleared(st) && idx + 1 < ORDER.length) {
    const next = MODULES[ORDER[idx + 1]];
    if (missionUnlocked(c, next.id)) {
      lines.push(
        ``,
        `■ 次の行動（このミッションは解決済みです）`,
        `次のミッション${next.no}「${next.title}」が開いています。プレイヤーが次に話しかけたら、まずミッション${next.no}専用の brief を取得してから答えてください：`,
        `  curl -s ${base}/ai/brief/${next.id}`,
        `このミッションの前提のまま、次の事件に答えないでください。プレイヤーに URL を尋ねる必要はありません。`,
      );
    }
  }
  return lines.join("\n");
}
