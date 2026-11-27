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
    };
  });
}

export function guiView(c) {
  const m = mod(c);
  const v = m.guiView(state(c));
  return {
    ...v,
    mission: { id: m.id, no: m.no, title: m.title, goal: m.goal },
    casebook: casebookView(c),
    allCleared: allCleared(c),
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
      return [MODULES[id].introText];
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
    } else if (idx + 1 >= ORDER.length) {
      texts.push(`事件簿の全ての依頼が解決した。長い事件、おつかれさま。`);
    }
  }
  return texts;
}

export function applyCelebrate(c, word, text) {
  return mod(c).applyCelebrate(state(c), word, text);
}

export function buildBrief(c, recentEvents, celebrateGetUrl) {
  const m = mod(c);
  const lines = [];
  lines.push(PARTNER_GUIDE, ``);
  lines.push(`■ 事件簿（あすなろ探偵事務所）`);
  for (const item of casebookView(c)) {
    const mark =
      item.status === "cleared" ? "解決済み" : item.status === "current" ? "対応中（いまの事件）" : item.status === "open" ? "未解決（読み返し可）" : "未解放";
    lines.push(`・ミッション${item.no}「${item.title}」：${mark}`);
  }
  lines.push(``, `■ いまの事件：ミッション${m.no}「${m.title}」`, `目的：${m.goal}`, ``);
  lines.push(m.buildBrief(state(c), recentEvents, celebrateGetUrl));
  return lines.join("\n");
}
