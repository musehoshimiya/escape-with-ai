// hacker-with-ai フロントエンド
// 参加：3ステップ（名前を入れる → プロンプトをコピーしてAIに貼る → コンソールへ）。
// コンソール：システム一覧のタイルを操作し、状態とログはポーリング（1.5秒）で反映。
// キーワードはタップで「ゲームのヒント：○○」をコピーできる。

const $ = (id) => document.getElementById(id);

let sessionId = null;
let lastSeq = 0;
let pollTimer = null;
let prevNotes = {};
let latestState = null;
let selectedMailId = null;

const STAGE_SPOTS = { 1: "mail", 2: "terminal", 3: "backup", 4: "twofa", 5: "recover" };

function setStep(n, mode) {
  const el = $(`step${n}`);
  el.classList.remove("active", "locked", "done");
  el.classList.add(mode);
}

$("join-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("name-input").value.trim() || "プレイヤー";
  const errEl = $("join-error");
  errEl.hidden = true;
  try {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error("create failed");
    const data = await res.json();
    sessionId = data.sessionId;
    history.replaceState(null, "", `?session=${sessionId}`);
    $("prompt-text").value = data.joinPrompt;
    $("copy-btn").disabled = false;
    $("go-room-btn").disabled = false;
    setStep(1, "done");
    setStep(2, "active");
    $("step2").scrollIntoView({ behavior: "smooth", block: "center" });
  } catch {
    errEl.textContent = "セッションの作成に失敗しました。通信環境を確認して、もう一度試してください。";
    errEl.hidden = false;
  }
});

$("copy-btn").addEventListener("click", async () => {
  const t = $("prompt-text");
  try {
    await navigator.clipboard.writeText(t.value);
  } catch {
    t.select();
    document.execCommand("copy");
  }
  $("copy-btn").textContent = "コピーしました";
  setStep(2, "done");
  setStep(3, "active");
  setTimeout(() => ($("copy-btn").textContent = "プロンプトをコピー"), 2500);
});

$("go-room-btn").addEventListener("click", () => {
  if (!sessionId) return;
  enterRoom();
});

function enterRoom() {
  $("view-join").hidden = true;
  $("view-room").hidden = false;
  window.scrollTo(0, 0);
  startPolling();
}

// URL の ?session=<id> があれば、そのセッションに直接入る（リロードしても続きから遊べる）
(async () => {
  const sid = new URLSearchParams(location.search).get("session");
  if (!sid || !/^[a-f0-9]+$/.test(sid)) return;
  sessionId = sid;
  const state = await fetchState().catch(() => null);
  if (!state) {
    sessionId = null;
    return;
  }
  enterRoom();
})();

$("rejoin-btn").addEventListener("click", async () => {
  if (!sessionId) return;
  const res = await fetch(`/api/sessions/${sessionId}/rejoin-prompt`);
  if (!res.ok) return;
  const data = await res.json();
  try {
    await navigator.clipboard.writeText(data.prompt);
    $("rejoin-btn").textContent = "コピーしました";
    setTimeout(() => ($("rejoin-btn").textContent = "再参加プロンプトをコピー"), 2500);
  } catch {
    /* コピーできない環境では何もしない */
  }
});

async function fetchState() {
  const res = await fetch(`/api/sessions/${sessionId}/state`);
  if (!res.ok) return null;
  return res.json();
}

async function fetchEvents() {
  const res = await fetch(`/api/sessions/${sessionId}/events?since=${lastSeq}`);
  if (!res.ok) return null;
  const data = await res.json();
  let newest = null;
  for (const ev of data.events) {
    // ポーリングとアクション後の取得が重なると同じイベントが二重に届くため、seq で弾く
    if (ev.seq <= lastSeq) continue;
    lastSeq = ev.seq;
    appendLog(ev, ev === data.events[data.events.length - 1]);
    newest = ev;
  }
  if (data.lastSeq > lastSeq) lastSeq = data.lastSeq;
  return newest;
}

function appendLog(ev, isNewest) {
  const li = document.createElement("li");
  if (ev.kind === "ai") li.className = "ai";
  if (ev.kind === "celebration") li.className = "celebration";
  if (isNewest) li.classList.add("new");
  li.textContent = ev.text;
  // ノベル的な読み：時系列に下へ積み、読み返せるようにする
  const log = $("log");
  log.appendChild(li);
  log.scrollTop = log.scrollHeight;
}

function appendSceneDivider(label) {
  const li = document.createElement("li");
  li.className = "scene-divider";
  li.textContent = `―― ${label} ――`;
  $("log").appendChild(li);
}

function render(state) {
  latestState = state;
  $("player-line").textContent = `探偵：${state.name} ／ 進行 ${state.stage} / 6`;

  $("recovered-banner").hidden = !state.recovered;
  if (state.recovered && state.clearWord) {
    $("clear-word-line").textContent = state.celebrated
      ? ""
      : `達成キーワードは「${state.clearWord}」。AIに「ゲームのお祝い：${state.clearWord}」と話しかけてみよう。`;
    $("celebrated-line").textContent = state.celebrated ? "🎉 AIからお祝いが届いたよ" : "";
    $("epilogue-line").textContent = state.epilogue ?? "";
  }

  // 場面の切り替わり：ステージが進んだらストーリーに区切りを入れる
  if (render.prevStage == null) {
    appendSceneDivider(state.stages[state.stage - 1].label);
    render.prevStage = state.stage;
  } else if (state.stage > render.prevStage) {
    appendSceneDivider(state.stages[state.stage - 1].label);
    render.prevStage = state.stage;
  }

  // 対応手順（ステッパー）
  const stagesSig = state.stages.map((x) => x.state).join("|");
  if (stagesSig !== render.prevStagesSig) {
    render.prevStagesSig = stagesSig;
    const ol = $("stages");
    ol.innerHTML = "";
    state.stages.forEach((st, i) => {
      const li = document.createElement("li");
      li.className = st.state;
      const num = document.createElement("span");
      num.className = "st-num";
      num.textContent = `STEP ${i + 1}`;
      const label = document.createElement("span");
      label.textContent = st.label;
      const mark = document.createElement("span");
      mark.className = "st-state";
      mark.textContent = st.state === "done" ? "完了" : st.state === "current" ? "対応中" : "";
      li.append(num, label, mark);
      ol.appendChild(li);
    });
  }

  // システム一覧（スポット）。状態が変わった時だけ作り直す（クリック中の差し替え防止）。
  const spotsSig = state.spots
    .map((sp) => [sp.id, sp.note, sp.badge, sp.done].join(":"))
    .join("|") + `#${state.stage}`;
  const stage = $("spots");
  if (spotsSig !== render.prevSpotsSig) {
    render.prevSpotsSig = spotsSig;
    stage.innerHTML = "";
    for (const sp of state.spots) {
      const b = document.createElement("button");
      b.className = "spot" + (sp.done ? " is-done" : STAGE_SPOTS[state.stage] === sp.id ? " is-current" : "");
      b.dataset.spot = sp.id;
      const label = document.createElement("span");
      label.className = "spot-label";
      label.textContent = sp.label;
      const note = document.createElement("span");
      note.className = "spot-note";
      note.textContent = sp.note;
      b.append(label, note);
      if (sp.badge) {
        const badge = document.createElement("span");
        badge.className = "badge" + (sp.done ? " done" : "");
        badge.textContent = sp.done ? `✓ ${sp.badge}` : sp.badge;
        b.appendChild(badge);
      }
      if (prevNotes[sp.id] !== undefined && prevNotes[sp.id] !== sp.note) {
        b.classList.add("flash");
      }
      prevNotes[sp.id] = sp.note;
      b.addEventListener("click", () => onSpot(sp.id));
      stage.appendChild(b);
    }
  }

  $("inventory").textContent =
    state.inventory.length > 0 ? state.inventory.join("、") : "（なし）";

  // 報告書パネル（クリア後のみ）
  if (state.debrief) {
    const sig = "shown";
    if (render.prevDebriefSig !== sig) {
      render.prevDebriefSig = sig;
      $("debrief-panel").hidden = false;
      const wrap = $("debrief");
      wrap.innerHTML = "";
      if (state.debriefIntro) {
        const intro = document.createElement("p");
        intro.className = "note";
        intro.textContent = state.debriefIntro;
        wrap.appendChild(intro);
      }
      for (const d of state.debrief) {
        const div = document.createElement("div");
        div.className = "debrief-item";
        const h = document.createElement("h3");
        h.textContent = d.title;
        const p1 = document.createElement("p");
        p1.textContent = d.learned;
        const p2 = document.createElement("p");
        p2.className = "defense";
        p2.textContent = d.defense;
        div.append(h, p1, p2);
        wrap.appendChild(div);
      }
    }
  }

  renderMailDialog(state);
  renderDialogFields(state);

  // キーワード
  const kw = $("keywords");
  const kwSig = state.keywords.join("|");
  if (kwSig === render.prevKwSig) return;
  render.prevKwSig = kwSig;
  kw.innerHTML = "";
  if (state.keywords.length === 0) {
    const li = document.createElement("li");
    li.textContent = "いまは特にないみたい。";
    kw.appendChild(li);
  }
  for (const k of state.keywords) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.className = "kw-chip";
    btn.innerHTML = `AIに <span class="kw"></span> と聞いてみよう（タップでコピー）`;
    btn.querySelector(".kw").textContent = `「ゲームのヒント：${k}」`;
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(`ゲームのヒント：${k}`);
        const sp = document.createElement("span");
        sp.className = "copied";
        sp.textContent = "コピーしました";
        btn.appendChild(sp);
        setTimeout(() => sp.remove(), 2000);
      } catch {
        /* コピーできない環境では何もしない（文面は画面で読める） */
      }
    });
    li.appendChild(btn);
    kw.appendChild(li);
  }
}

// ---- ダイアログの表示内容 ----

function renderMailDialog(state) {
  if ($("mail-dialog").hidden) return;
  $("mail-lock-note").hidden = !(state.mailLockSeconds > 0);
  if (state.mailLockSeconds > 0) {
    $("mail-lock-note").textContent = `セキュリティ部門がメール確認を一時停止しています（あと約${state.mailLockSeconds}秒）。`;
  }
  const sig = state.mails.map((m) => `${m.id}:${m.read ? 1 : 0}`).join("|") + `#${state.judged}`;
  if (sig === render.prevMailSig) return;
  render.prevMailSig = sig;
  const list = $("mail-list");
  list.innerHTML = "";
  for (const mail of state.mails) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.className = "mail-item" + (mail.read ? "" : " unread") + (mail.id === selectedMailId ? " selected" : "");
    const from = document.createElement("span");
    from.className = "m-from";
    from.textContent = mail.from;
    const subj = document.createElement("span");
    subj.className = "m-subject";
    subj.textContent = mail.subject;
    b.append(from, subj);
    b.addEventListener("click", () => selectMail(mail.id));
    li.appendChild(b);
    list.appendChild(li);
  }
  showSelectedMail(state);
}

function showSelectedMail(state) {
  const mail = state.mails.find((m) => m.id === selectedMailId);
  if (!mail) {
    $("mail-meta").textContent = "左の一覧からメールを選んでください。";
    $("mail-body").textContent = "";
    $("mail-judge-btn").disabled = true;
    return;
  }
  $("mail-meta").textContent = `差出人：${mail.from}\n件名：${mail.subject}`;
  $("mail-body").textContent = mail.body;
  $("mail-judge-btn").disabled = state.judged || state.mailLockSeconds > 0;
  $("mail-judge-btn").textContent = state.judged ? "本物の通知は特定済み" : "この通知を本物として採用";
}

async function selectMail(id) {
  selectedMailId = id;
  await postAction({ spot: "mail_open", id });
  if (latestState) showSelectedMail(latestState);
}

function renderDialogFields(state) {
  if (state.loginId) $("terminal-login-id").textContent = state.loginId;
  if (state.backup) {
    $("backup-gen").textContent = state.backup.gen;
    $("backup-cipher").textContent = state.backup.ciphertext;
  }
  if (state.challenge != null) $("twofa-challenge").textContent = state.challenge;
}

// ---- スポット操作 ----

async function onSpot(spotId) {
  const st = latestState;
  if (!st) return;
  if (spotId === "mail") {
    $("mail-message").textContent = "";
    $("mail-dialog").hidden = false;
    render.prevMailSig = null;
    renderMailDialog(st);
    return;
  }
  if (spotId === "terminal" && st.judged && !st.loggedIn) {
    $("terminal-message").textContent = "";
    $("terminal-dialog").hidden = false;
    $("terminal-password").value = "";
    setTimeout(() => $("terminal-password").focus(), 50);
    return;
  }
  if (spotId === "backup" && st.loggedIn && !st.backup?.decrypted) {
    $("backup-message").textContent = "";
    $("backup-dialog").hidden = false;
    $("backup-answer").value = "";
    // 暗号文をログにも残す（相方へ伝える材料）
    await postAction({ spot: "backup" });
    return;
  }
  if (spotId === "twofa" && st.decrypted && !st.authDone) {
    $("twofa-message").textContent = "";
    $("twofa-dialog").hidden = false;
    $("twofa-code").value = "";
    setTimeout(() => $("twofa-code").focus(), 50);
    return;
  }
  await postAction({ spot: spotId });
}

function closeDialog(id) {
  $(id).hidden = true;
}
for (const [btn, dlg] of [
  ["mail-close", "mail-dialog"],
  ["terminal-close", "terminal-dialog"],
  ["backup-close", "backup-dialog"],
  ["twofa-close", "twofa-dialog"],
]) {
  $(btn).addEventListener("click", () => closeDialog(dlg));
  $(dlg).addEventListener("click", (e) => {
    if (e.target === $(dlg)) closeDialog(dlg);
  });
}

$("mail-judge-btn").addEventListener("click", async () => {
  if (!selectedMailId) return;
  const { state, newest } = await postAction({ spot: "mail_judge", id: selectedMailId });
  $("mail-message").textContent = newest ? newest.text : "";
  if (state && state.judged) {
    setTimeout(() => closeDialog("mail-dialog"), 1200);
  }
});

$("terminal-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const password = $("terminal-password").value;
  if (!password) {
    $("terminal-message").textContent = "パスワードを入力してね。";
    return;
  }
  const { state, newest } = await postAction({ spot: "terminal", password });
  if (state && state.loggedIn) {
    closeDialog("terminal-dialog");
  } else {
    $("terminal-message").textContent = newest ? newest.text : "ログインできなかった。";
    $("terminal-password").select();
  }
});

$("backup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const answer = $("backup-answer").value.trim();
  if (!answer) {
    $("backup-message").textContent = "復号した言葉を入力してね。";
    return;
  }
  const { state, newest } = await postAction({ spot: "backup", answer });
  if (state && state.backup?.decrypted) {
    closeDialog("backup-dialog");
  } else {
    $("backup-message").textContent = newest ? newest.text : "復号できなかった。";
    $("backup-answer").select();
  }
});

$("twofa-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = $("twofa-code").value.trim();
  if (!/^\d{6}$/.test(code)) {
    $("twofa-message").textContent = "6桁の数字を入力してね。";
    return;
  }
  const { state, newest } = await postAction({ spot: "twofa", code });
  if (state && state.authDone) {
    closeDialog("twofa-dialog");
  } else {
    $("twofa-message").textContent = newest ? newest.text : "認証できなかった。";
    $("twofa-code").select();
  }
});

// ---- 共通 ----

async function postAction(action) {
  const res = await fetch(`/api/sessions/${sessionId}/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(action),
  });
  const state = res.ok ? await res.json() : null;
  const newest = await refresh(state);
  return { state, newest };
}

async function refresh(knownState) {
  const state = knownState ?? (await fetchState());
  if (state) render(state);
  return fetchEvents();
}

function startPolling() {
  refresh();
  pollTimer = setInterval(refresh, 1500);
}
