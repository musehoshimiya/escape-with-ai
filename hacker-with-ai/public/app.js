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
let selectedFileId = null;
let selectedImageId = null;

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

$("brief-copy-btn").addEventListener("click", async () => {
  if (!sessionId || !state?.mission?.id) return;
  const res = await fetch(`/api/sessions/${sessionId}/ai/brief/${state.mission.id}`);
  if (!res.ok) return;
  const text = await res.text();
  try {
    await navigator.clipboard.writeText(text);
    $("brief-copy-btn").textContent = "コピーしました";
    setTimeout(
      () => ($("brief-copy-btn").textContent = "このミッションの brief 本文をコピー"),
      2500,
    );
  } catch {
    /* コピーできない環境では何もしない */
  }
});

$("mission-prompt-btn").addEventListener("click", async () => {
  if (!sessionId || !state?.mission?.id) return;
  const res = await fetch(`/api/sessions/${sessionId}/mission-prompt/${state.mission.id}`);
  if (!res.ok) return;
  const data = await res.json();
  try {
    await navigator.clipboard.writeText(data.prompt);
    $("mission-prompt-btn").textContent = "コピーしました";
    setTimeout(
      () => ($("mission-prompt-btn").textContent = "このミッションの参加プロンプトをコピー"),
      2500,
    );
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
  if (ev.kind === "scene") {
    li.className = "scene-divider";
    li.textContent = `―― ${ev.text} ――`;
    const log0 = $("log");
    log0.appendChild(li);
    log0.scrollTop = log0.scrollHeight;
    return;
  }
  if (isNewest) li.classList.add("new");
  li.textContent = ev.text;
  // ノベル的な読み：時系列に下へ積み、読み返せるようにする
  const log = $("log");
  log.appendChild(li);
  log.scrollTop = log.scrollHeight;
}

function render(state) {
  latestState = state;
  if (state.mission) {
    $("mission-title").textContent = `ミッション${state.mission.no}：${state.mission.title}`;
    $("mission-goal").textContent = `依頼内容：${state.mission.goal} 手がかりは画面の中、組み立て方と照合は相方のAIが知っている。`;
  }
  $("player-line").textContent = `探偵：${state.name} ／ 事件 ${state.mission ? state.mission.no : 1} ・ 進行 ${state.stage} / ${state.stages.length}`;

  $("badend-banner").hidden = !state.badEnd;
  if (state.badEnd) $("badend-line").textContent = state.badEndText ?? "";

  renderCasebook(state);
  renderStage(state);

  $("recovered-banner").hidden = !state.recovered;
  if (state.recovered && state.clearMessage) $("banner-main").textContent = state.clearMessage;
  if (state.recovered && state.clearWord) {
    $("clear-word-line").textContent = state.celebrated
      ? ""
      : `達成キーワードは「${state.clearWord}」。AIに「ゲームのお祝い：${state.clearWord}」と話しかけてみよう。`;
    $("celebrated-line").textContent = state.celebrated ? "🎉 AIからお祝いが届いたよ" : "";
    $("epilogue-line").textContent = state.epilogue ?? "";
  }

  // 次の事件への導線（解決バナーの中に明示する）
  const nextBtn = $("next-case-btn");
  const nextLine = $("next-case-line");
  if (state.recovered && state.casebook) {
    const next = state.casebook.find((c) => c.status === "open" && !c.started) ?? state.casebook.find((c) => c.status === "open");
    if (next) {
      nextLine.textContent = "事件簿に、新しい依頼が届いています。";
      nextBtn.hidden = false;
      nextBtn.textContent = `次の事件へ進む：ミッション${next.no}「${next.title}」`;
      nextBtn.onclick = async () => { await postAction({ spot: "select_mission", mission: next.id }); };
      const noteBtn = $("partner-note-btn");
      noteBtn.hidden = false;
      noteBtn.onclick = async () => {
        const cur = state.mission;
        const briefUrl = `${location.origin}/api/sessions/${sessionId}/ai/brief/${next.id}`;
        const note = `ミッション${cur.no}「${cur.title}」を解決したよ。次のミッション${next.no}「${next.title}」が開いたから、次に答える前に、このミッション専用の brief を読んで：${briefUrl} （URLが開けない環境なら言って。本文を貼るから）`;
        try {
          await navigator.clipboard.writeText(note);
          noteBtn.textContent = "コピーしました";
          setTimeout(() => (noteBtn.textContent = "相方への連絡をコピー（次の brief を読ませる）"), 2500);
        } catch {
          /* コピーできない環境では何もしない */
        }
      };
    } else if (state.allCleared) {
      nextLine.textContent = "事件簿の依頼は、すべて解決済みです。おつかれさま！";
      nextBtn.hidden = true;
      $("partner-note-btn").hidden = true;
    } else {
      nextLine.textContent = "";
      nextBtn.hidden = true;
      $("partner-note-btn").hidden = true;
    }
  } else {
    nextLine.textContent = "";
    nextBtn.hidden = true;
    $("partner-note-btn").hidden = true;
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
    .map((sp) => [sp.id, sp.note, sp.badge, sp.done, sp.hint ?? ""].join(":"))
    .join("|") + `#${state.stage}`;
  const stage = $("spots");
  if (spotsSig !== render.prevSpotsSig) {
    render.prevSpotsSig = spotsSig;
    stage.innerHTML = "";
    for (const sp of state.spots) {
      const cell = document.createElement("div");
      cell.className = "spot-cell";
      const b = document.createElement("button");
      b.className = "spot" + (sp.done ? " is-done" : state.currentSpot === sp.id ? " is-current" : "");
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
      cell.appendChild(b);
      // ヒント文は折りたたみ（デフォルト閉）。見たい人だけが開く。
      if (sp.hint) {
        const fold = document.createElement("details");
        fold.className = "hint-fold spot-hint";
        const sum = document.createElement("summary");
        sum.textContent = "ヒント";
        const hp = document.createElement("p");
        hp.className = "note";
        hp.textContent = sp.hint;
        fold.append(sum, hp);
        cell.appendChild(fold);
      }
      stage.appendChild(cell);
    }
  }

  $("inventory").textContent =
    state.inventory.length > 0 ? state.inventory.join("、") : "（なし）";

  // 報告書パネル（クリア後のみ）。ミッションごとに内容が違うので、署名は内容で作る
  if (state.debrief) {
    const sig = (state.mission?.id ?? "") + ":" + state.debrief.map((d) => d.title).join("|");
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
  } else if (!$("debrief-panel").hidden) {
    $("debrief-panel").hidden = true;
    render.prevDebriefSig = null;
  }

  renderMailDialog(state);
  renderFilesDialog(state);
  renderImagesDialog(state);
  renderDocDialog(state);
  renderAccuseDialog(state);
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


// ---- 事件簿 ----

function renderCasebook(state) {
  if (!state.casebook) return;
  const sig = state.casebook.map((c) => `${c.id}:${c.status}`).join("|");
  if (sig === render.prevCaseSig) return;
  render.prevCaseSig = sig;
  const ul = $("casebook");
  ul.innerHTML = "";
  for (const c of state.casebook) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.className = "case-item" + (c.status === "current" ? " is-current" : c.status === "cleared" ? " is-cleared" : c.status === "locked" ? " is-locked" : c.started ? "" : " is-new");
    b.disabled = c.status === "locked" || c.status === "current";
    const title = document.createElement("span");
    title.className = "case-title";
    title.textContent = `${c.no}. ${c.title}`;
    const st = document.createElement("span");
    st.className = "case-status";
    st.textContent = c.status === "cleared" ? "解決済み" : c.status === "current" ? "対応中" : c.status === "locked" ? "未解放" : c.started ? "進行中" : "新しい依頼";
    b.append(title, st);
    b.addEventListener("click", async () => {
      for (const d of ["mail-dialog", "files-dialog", "images-dialog", "doc-dialog", "accuse-dialog", "material-dialog"]) closeDialog(d);
      if (novel) endNovel();
      await postAction({ spot: "select_mission", mission: c.id });
    });
    li.appendChild(b);
    ul.appendChild(li);
  }
}

// ---- ステージ（ノベルUI） ----
// 立ち絵はプレースホルダのシルエット。cast に img があれば実素材の <img> に差し替わる。

function silhouetteSVG(color) {
  return `<svg viewBox="0 0 100 140" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle cx="50" cy="34" r="20" fill="${color}"/><path d="M14 140c2-34 16-52 36-52s34 18 36 52z" fill="${color}"/></svg>`;
}

function fillCastSlot(div, member) {
  if (member.img) {
    const img = document.createElement("img");
    img.src = member.img;
    img.alt = member.name;
    img.className = "cast-img";
    div.appendChild(img);
  } else {
    const ph = document.createElement("div");
    ph.className = "cast-silhouette";
    ph.innerHTML = silhouetteSVG(member.color ?? "#8a93a6");
    div.appendChild(ph);
  }
  const name = document.createElement("div");
  name.className = "cast-name";
  name.textContent = member.name;
  const role = document.createElement("div");
  role.className = "cast-role";
  role.textContent = member.tone ? `${member.role}（${member.tone}）` : member.role;
  div.append(name, role);
}

function renderStage(state) {
  if (!state.scene) return;
  if (novel) return; // ノベルパート再生中はステージをノベル側が管理する
  const sc = state.scene;
  const sig = [sc.key, sc.mood, (sc.cast ?? []).map((c) => `${c.slot}:${c.name}:${c.tone}:${c.img ?? ""}`).join(","), sc.caption].join("|");
  if (sig === render.prevSceneSig) return;
  render.prevSceneSig = sig;
  const stage = $("stage");
  stage.className = `stage bg-${sc.bg} mood-${sc.mood}`;
  const cast = $("stage-cast");
  cast.innerHTML = "";
  for (const slot of ["left", "center", "right"]) {
    const member = (sc.cast ?? []).find((c) => c.slot === slot);
    const div = document.createElement("div");
    div.className = `cast-slot slot-${slot}` + (member ? "" : " empty");
    if (member) fillCastSlot(div, member);
    cast.appendChild(div);
  }
  $("stage-caption").textContent = sc.caption ?? "";
}

// ---- ノベルパート（聞き込み） ----
// ステージ上に立ち絵＋名前プレート＋テキストウィンドウを出し、1行ずつ送る。
// 発言中の話者は明るく（speaking）、他の話者は落とす（dimmed）。地の文は名前プレートなし。

let novel = null; // { spotId, title, cast, lines, idx }

function startNovel(spotId, dlg) {
  if (!dlg || !Array.isArray(dlg.lines) || dlg.lines.length === 0) return;
  novel = { spotId, title: dlg.title ?? "", cast: dlg.cast ?? [], lines: dlg.lines, idx: 0 };
  $("novel-window").hidden = false;
  $("stage-caption").hidden = true;
  showNovelLine();
}

function renderNovelCast() {
  const line = novel.lines[novel.idx];
  const cast = $("stage-cast");
  cast.innerHTML = "";
  for (const slot of ["left", "center", "right"]) {
    const member = novel.cast.find((c) => c.slot === slot);
    const div = document.createElement("div");
    div.className = `cast-slot slot-${slot}` + (member ? "" : " empty");
    if (member) {
      div.classList.add(line.speaker && member.name === line.speaker ? "speaking" : "dimmed");
      fillCastSlot(div, member);
    }
    cast.appendChild(div);
  }
}

function showNovelLine() {
  const line = novel.lines[novel.idx];
  renderNovelCast();
  const nameEl = $("novel-name");
  if (line.speaker) {
    nameEl.textContent = line.speaker;
    nameEl.hidden = false;
  } else {
    nameEl.hidden = true;
  }
  $("novel-text").textContent = line.text;
  $("novel-progress").textContent = `${novel.title}　${novel.idx + 1} / ${novel.lines.length}`;
  $("novel-next").textContent = novel.idx >= novel.lines.length - 1 ? "閉じる" : "▼ 次へ";
}

function advanceNovel() {
  if (!novel) return;
  if (novel.idx >= novel.lines.length - 1) {
    endNovel();
    return;
  }
  novel.idx += 1;
  showNovelLine();
}

function endNovel() {
  novel = null;
  $("novel-window").hidden = true;
  $("stage-caption").hidden = false;
  render.prevSceneSig = null;
  if (latestState) renderStage(latestState);
}

$("novel-window").addEventListener("click", advanceNovel);

// ---- 資料ダイアログ（汎用モーダル） ----

function openMaterialDialog(mat) {
  if (!mat) return;
  $("material-title").textContent = mat.title ?? "資料";
  $("material-body").textContent = mat.text ?? "";
  $("material-dialog").hidden = false;
}

// ---- ファイル鑑定ダイアログ（ミッション2） ----

function renderFilesDialog(state) {
  if ($("files-dialog").hidden || !state.files) return;
  $("files-lock-note").hidden = !(state.filesLockSeconds > 0);
  if (state.filesLockSeconds > 0) {
    $("files-lock-note").textContent = `鑑定アラートのため、応募フォルダは一時ロックされています（あと約${state.filesLockSeconds}秒）。`;
  }
  const sig = state.files.map((f) => `${f.id}:${f.opened ? 1 : 0}`).join("|") + `#${state.identified}`;
  if (sig === render.prevFilesSig) return;
  render.prevFilesSig = sig;
  const list = $("file-list");
  list.innerHTML = "";
  for (const f of state.files) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.className = "mail-item" + (f.opened ? "" : " unread") + (f.id === selectedFileId ? " selected" : "");
    const nm = document.createElement("span");
    nm.className = "m-from";
    nm.textContent = f.name;
    const meta = document.createElement("span");
    meta.className = "m-subject";
    meta.textContent = `申告者：${f.entrant}／${f.size}${f.opened ? "／開封済み" : ""}`;
    b.append(nm, meta);
    b.addEventListener("click", () => selectFile(f.id));
    li.appendChild(b);
    list.appendChild(li);
  }
  showSelectedFile(state);
}

function showSelectedFile(state) {
  const f = (state.files ?? []).find((x) => x.id === selectedFileId);
  if (!f) {
    $("file-meta").textContent = "左の一覧からファイルを選んでください。";
    $("file-body").textContent = "";
    $("file-verdict-btn").disabled = true;
    return;
  }
  $("file-meta").textContent = `${f.name}（申告者：${f.entrant}、サイズ：${f.size}）`;
  $("file-body").textContent = f.detail
    ? `先頭バイト（ヘッダ）：${f.detail.header}
メタデータ：${f.detail.exif}`
    : "（未開封です。選ぶと開封します）";
  $("file-verdict-btn").disabled = !f.opened || state.identified || state.filesLockSeconds > 0;
  $("file-verdict-btn").textContent = state.identified ? "本物の応募作品は特定済み" : "これが本物の応募作品だと特定する";
}

async function selectFile(id) {
  selectedFileId = id;
  const st = latestState;
  const f = st?.files?.find((x) => x.id === id);
  if (f && !f.opened) await postAction({ spot: "file_open", id });
  if (latestState) showSelectedFile(latestState);
}

// ---- 画像データダイアログ（ミッション3） ----

function renderImagesDialog(state) {
  if ($("images-dialog").hidden || !state.images) return;
  const sig = state.images.map((i) => `${i.id}:${i.opened ? 1 : 0}`).join("|");
  if (sig === render.prevImagesSig) return;
  render.prevImagesSig = sig;
  const list = $("image-list");
  list.innerHTML = "";
  for (const im of state.images) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.className = "mail-item" + (im.opened ? "" : " unread") + (im.id === selectedImageId ? " selected" : "");
    const nm = document.createElement("span");
    nm.className = "m-from";
    nm.textContent = im.label;
    const meta = document.createElement("span");
    meta.className = "m-subject";
    meta.textContent = im.opened ? "開封済み（ピクセルデータ表示中）" : "未開封";
    b.append(nm, meta);
    b.addEventListener("click", () => selectImage(im.id));
    li.appendChild(b);
    list.appendChild(li);
  }
  showSelectedImage(state);
}

function showSelectedImage(state) {
  const im = (state.images ?? []).find((x) => x.id === selectedImageId);
  if (!im) {
    $("image-meta").textContent = "左の一覧から画像を選んでください。";
    $("image-body").textContent = "";
    return;
  }
  $("image-meta").textContent = im.label;
  $("image-body").textContent = im.pixels ?? "（未開封です。選ぶと開封します）";
}

async function selectImage(id) {
  selectedImageId = id;
  const st = latestState;
  const im = st?.images?.find((x) => x.id === id);
  if (im && !im.opened) await postAction({ spot: "image_open", id });
  if (latestState) showSelectedImage(latestState);
}

// ---- 押収文書ダイアログ（ミッション4） ----

function renderDocDialog(state) {
  if ($("doc-dialog").hidden || !state.doc) return;
  $("doc-title").textContent = state.doc.title ?? "";
  $("doc-meta").innerHTML = "";
  for (const [k, v] of state.doc.meta ?? []) {
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = v;
    $("doc-meta").append(dt, dd);
  }
  $("doc-source").textContent = state.doc.source;
  $("doc-body").textContent = state.doc.text;
}

// ---- 告発ダイアログ（ミッション4） ----

function renderAccuseDialog(state) {
  if ($("accuse-dialog").hidden || !state.suspects) return;
  const sig = state.suspects.map((x) => x.id).join("|") + `#${state.resolved}`;
  if (sig === render.prevAccuseSig) return;
  render.prevAccuseSig = sig;
  const list = $("accuse-list");
  list.innerHTML = "";
  for (const su of state.suspects) {
    const b = document.createElement("button");
    b.className = "accuse-btn";
    const nm = document.createElement("span");
    nm.className = "spot-label";
    nm.textContent = su.name;
    const role = document.createElement("span");
    role.className = "spot-note";
    role.textContent = su.role;
    b.append(nm, role);
    b.addEventListener("click", async () => {
      const { state: st2, newest } = await postAction({ spot: "accuse", suspect: su.id });
      $("accuse-message").textContent = newest ? newest.text : "";
      if (st2 && (st2.resolved || st2.badEnd)) {
        setTimeout(() => closeDialog("accuse-dialog"), 1500);
      }
    });
    list.appendChild(b);
  }
}

// ---- スポット操作 ----

async function onSpot(spotId) {
  const st = latestState;
  if (!st) return;
  // ノベルパート再生中に別のスポットを押したら、ノベルを畳んで通常表示に戻す
  if (novel && spotId !== novel.spotId) endNovel();
  // 資料スポット（UI基準）：既読なら再投稿せず、汎用モーダルで即表示する。
  // バックログには初回表示時にイベントとして全文が残っている。
  if (st.materials?.[spotId]) {
    openMaterialDialog(st.materials[spotId]);
    return;
  }
  // 聞き込みスポット：既読なら再投稿せず、dialogues からノベルパートを再生する。
  if (st.dialogues?.[spotId]) {
    startNovel(spotId, st.dialogues[spotId]);
    return;
  }
  closeDialog("material-dialog");
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
  if (spotId === "twofa" && st.backup?.decrypted && !st.authDone) {
    $("twofa-message").textContent = "";
    $("twofa-dialog").hidden = false;
    $("twofa-code").value = "";
    setTimeout(() => $("twofa-code").focus(), 50);
    return;
  }
  if (spotId === "files") {
    $("file-message").textContent = "";
    $("files-dialog").hidden = false;
    render.prevFilesSig = null;
    renderFilesDialog(st);
    return;
  }
  if (spotId === "images") {
    $("image-message").textContent = "";
    $("images-dialog").hidden = false;
    render.prevImagesSig = null;
    renderImagesDialog(st);
    return;
  }
  if (spotId === "extract") {
    if (st.images?.some((i) => i.opened) && !st.extracted) {
      $("extract-message").textContent = "";
      $("extract-dialog").hidden = false;
      $("extract-answer").value = "";
      setTimeout(() => $("extract-answer").focus(), 50);
      return;
    }
    await postAction({ spot: spotId });
    return;
  }
  if (spotId === "doc") {
    const { state } = await postAction({ spot: "doc" });
    if (state?.doc) {
      $("doc-message").textContent = "";
      $("doc-dialog").hidden = false;
      renderDocDialog(state);
    }
    return;
  }
  if (spotId === "accuse") {
    if (st.resolved) return;
    $("accuse-message").textContent = "";
    $("accuse-dialog").hidden = false;
    render.prevAccuseSig = null;
    renderAccuseDialog(st);
    return;
  }
  const { state: afterState } = await postAction({ spot: spotId });
  // 初回表示：資料ならモーダル、聞き込みならノベルパートを開く（全文はイベントとしてバックログにも残る）
  if (afterState?.materials?.[spotId]) {
    openMaterialDialog(afterState.materials[spotId]);
    return;
  }
  if (afterState?.dialogues?.[spotId]) {
    startNovel(spotId, afterState.dialogues[spotId]);
    return;
  }
}

function closeDialog(id) {
  $(id).hidden = true;
}
for (const [btn, dlg] of [
  ["mail-close", "mail-dialog"],
  ["terminal-close", "terminal-dialog"],
  ["backup-close", "backup-dialog"],
  ["twofa-close", "twofa-dialog"],
  ["files-close", "files-dialog"],
  ["images-close", "images-dialog"],
  ["extract-close", "extract-dialog"],
  ["doc-close", "doc-dialog"],
  ["accuse-close", "accuse-dialog"],
  ["material-close", "material-dialog"],
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

$("file-verdict-btn").addEventListener("click", async () => {
  if (!selectedFileId) return;
  const { state, newest } = await postAction({ spot: "file_verdict", id: selectedFileId });
  $("file-message").textContent = newest ? newest.text : "";
  if (state && state.identified) {
    setTimeout(() => closeDialog("files-dialog"), 1200);
  }
});

$("extract-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const answer = $("extract-answer").value.trim();
  if (!answer) {
    $("extract-message").textContent = "言葉を入力してね。";
    return;
  }
  const { state, newest } = await postAction({ spot: "extract", answer });
  if (state && state.extracted) {
    closeDialog("extract-dialog");
  } else {
    $("extract-message").textContent = newest ? newest.text : "照合できなかった。";
    $("extract-answer").select();
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
