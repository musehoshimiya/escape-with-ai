// ミッション共通の小さな道具（乱数・ロック時間）。
// ミッション1（mission.mjs）は従来どおり自前で持っている。こちらはミッション2以降用。

export const LOCK_MS = (() => {
  try {
    const v = typeof process !== "undefined" ? Number(process.env?.GAME_LOCK_MS) : NaN;
    return Number.isFinite(v) && v > 0 ? v : 60_000;
  } catch {
    return 60_000;
  }
})();

export function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}
export function pick(arr) {
  return arr[randInt(0, arr.length - 1)];
}
export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export function lockLeft(until) {
  return Math.max(0, Math.ceil((until - Date.now()) / 1000));
}

// 聞き込みテキスト（「・」始まりの台詞行＋地の文）を、ノベルパート用の
// { speaker, text } 行配列に構造化する。地の文（見出し・注記）は speaker: null。
// バックログに出る全文テキストは元の定数のまま使う（こちらは表示用）。
export function toDialogueLines(text, speaker) {
  return String(text)
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) =>
      line.startsWith("・")
        ? { speaker, text: line.replace(/^・/, "") }
        : { speaker: null, text: line }
    );
}
