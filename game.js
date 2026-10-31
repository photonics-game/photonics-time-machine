/* 光電時光機：遊戲流程（主持人、玩家、大螢幕）。store 介面：uid、get、set、update、watchDoc、watchCol。 */
(function () {
const TM = window.TM, ui = TM.ui, esc = TM.esc;
const P = gid => ({
  game: `games/${gid}`, sum: `games/${gid}/meta/summary`, players: `games/${gid}/players`,
  me: uid => `games/${gid}/players/${uid}`, key: `games/${gid}/private/key`, host: uid => `games/${gid}/hosts/${uid}`
});
TM.paths = P;
const zeros = keys => Object.fromEntries(keys.map(k => [k, 0]));
const hashOf = v => JSON.stringify(v ?? null);
const active = (players, game) => players.filter(p => game && p.epoch === game.epoch && typeof p.name === "string");
const lockedIn = (p, r) => !!(p.locks && p.locks[r]);
TM.roundToTenths = w => {
  const raw = TM.AKEYS.map(k => [k, (w[k] || 0) * 10]); const out = Object.fromEntries(raw.map(([k, v]) => [k, Math.floor(v)]));
  let left = 10 - Object.values(out).reduce((a, b) => a + b, 0);
  raw.sort((a, b) => (b[1] - Math.floor(b[1])) - (a[1] - Math.floor(a[1]))); for (const [k] of raw) { if (left <= 0) break; out[k]++; left--; }
  return out;
};
/* 螢幕閱讀器：整頁只用一個朗讀區，避免每個數字都是獨立的朗讀區 */
TM.say = msg => { let el = document.getElementById("tm-say"); if (!el) { el = document.createElement("p"); el.id = "tm-say"; el.className = "sr-only"; el.setAttribute("role", "status"); document.body.appendChild(el); } el.textContent = ""; setTimeout(() => { el.textContent = msg; }, 30); };
/* 各區塊只在內容改變時重畫，避免圖表動畫和輸入框被打斷 */
function sections(root) {
  let ids = "", keys = {};
  /* 收合的圖表打開時才播畫線動畫 */
  root.addEventListener("toggle", e => { const d = e.target; if (d.tagName === "DETAILS" && d.open) d.querySelectorAll("path.draw").forEach(p => { p.classList.remove("draw"); void p.getBoundingClientRect(); p.classList.add("draw"); }); }, true);
  return list => {
    const nid = list.map(s => s.id).join("|");
    if (nid !== ids) { root.innerHTML = list.map(s => `<div data-sec="${s.id}"></div>`).join(""); ids = nid; keys = {}; }
    for (const s of list) {
      const k = typeof s.key === "string" ? s.key : hashOf(s.key);
      if (keys[s.id] !== k) { const el = root.querySelector(`[data-sec="${s.id}"]`); el.innerHTML = s.html(); keys[s.id] = k; TM.wireCharts(el); TM.countUp(el); TM.warp(el); }
    }
  };
}
/* 一位玩家在已結算輪次的資產歷程 */
function playerHistory(p, sum, done) {
  const eff = TM.effAllocs(p.id, sum, p.allocs, done);
  const sim = TM.simulate(eff, p.joinedRound ?? 0, done);
  return { eff, sim };
}
function computeRanking(players, sum, done) {
  return players.map(p => ({ u: p.id, n: p.name, v: Math.round(playerHistory(p, sum, done).sim.total) })).sort((a, b) => b.v - a.v);
}
const phaseText = (g) => !g ? "" : g.phase === "lobby" ? "等待開始" : g.phase === "open" ? `第 ${g.round + 1} 輪・${TM.YEAR[g.round]} 年分配中` : g.phase === "locked" ? `第 ${g.round + 1} 輪・已鎖定` : g.phase === "final" ? "遊戲結束" : "2031 預測中";

/* ===================== 主持人 ===================== */
TM.mountHost = (root, store, gid, opts = {}) => {
  const pa = P(gid), pre = opts.prefix || "h";
  const S = { game: undefined, sum: null, players: [], err: "", confirm: "", busy: false, live: null, coolUntil: 0 };
  const render = sections(root);
  const unsubs = [];
  let maintTimer = null, lastMaint = "";

  async function ensure() {
    const g = await store.get(pa.game);
    if (!g) {
      const now = Date.now();
      await store.set(pa.game, { phase: "lobby", round: 0, done: 0, epoch: 1, hostUid: store.uid, createdAt: now, updatedAt: now });
      await store.set(pa.key, { key: opts.hostKey || "" });
      await store.set(pa.sum, { epoch: 1, count: 0, sent: 0, names: [], frozen: {}, dist: {}, rankings: {}, pred: null });
    } else if (g.hostUid !== store.uid) {
      await store.set(pa.host(store.uid), { key: opts.hostKey || "" });
    }
  }
  /* 揭曉卡片（控制台可以照著唸） */
  const revealCard = (a, b) => { const d = S.sum && S.sum.dist && S.sum.dist[a];
    return ui.card(ui.head(b - a === 1 ? `${TM.ERA_DASH[a]} 揭曉` : "20 年後揭曉", "接著照著唸") + `<p class="text-base">${TM.revealLine(a, b, d)}</p><div class="mt-4">${TM.revealTable(a, b, d)}</div>`); };
  const fail = e => { S.err = "操作失敗：" + (e && e.message ? e.message : e) + "。請確認網路，或這台裝置有沒有主持權限。"; S.busy = false; draw(); };
  const setGame = patch => store.set(pa.game, { ...patch, updatedAt: Date.now() }, true);

  /* 人數、送出數、預測統計：節流更新到 summary */
  function scheduleMaint() { if (maintTimer) return; maintTimer = setTimeout(() => { maintTimer = null; maint(); }, opts.practice ? 600 : 2500); }
  function maint() {
    const g = S.game; if (!g || !S.sum) return;
    const ps = active(S.players, g);
    const patch = { count: ps.length }; if (g.phase === "lobby") patch.names = ps.slice().sort((a, b) => (b.joinedAt || 0) - (a.joinedAt || 0)).slice(0, 40).map(p => p.name);
    if (g.phase === "open") { patch.sent = ps.filter(p => p.allocs && p.allocs[g.round] !== undefined).length; patch.lockN = ps.filter(p => lockedIn(p, g.round)).length; }
    if (g.phase === "predict" || g.phase === "final") {
      const subs = ps.map(p => TM.cleanT(p.pred, TM.PKEYS)).filter(t => t && TM.sumT(t) === 10);
      const agg = Object.fromEntries(TM.PKEYS.map(k => [k, 0])); for (const t of subs) for (const k in t) agg[k] += t[k] / 10 / subs.length;
      patch.pred = { n: subs.length, agg };
    }
    const h = hashOf(patch); if (h === lastMaint) return; lastMaint = h;
    store.set(pa.sum, patch, true).catch(() => {});
  }

  const act = {
    async start() { await setGame({ phase: "open", round: 0, done: 0 }); },
    async lock() {
      const g = S.game, r = g.round;
      await setGame({ phase: "locked" });
      await new Promise(res => setTimeout(res, opts.lockDelay ?? 1500)); /* 等最後幾秒的修改送達 */
      const ps = active(S.players, S.game).filter(p => (p.joinedRound ?? 0) <= r);
      const snap = {}; for (const p of ps) snap[p.id] = p.allocs && p.allocs[r] !== undefined ? TM.cleanT(p.allocs[r]) : null;
      const sumNext = { ...S.sum, frozen: { ...(S.sum.frozen || {}), [r]: snap } };
      const ws = ps.map(p => TM.weightsOf(TM.simulate(TM.effAllocs(p.id, sumNext, p.allocs, r + 1), p.joinedRound ?? 0, r).starts[r]));
      await store.set(pa.sum, { frozen: { [r]: snap }, dist: { [r]: TM.distOf(ws) }, distN: { [r]: ws.length } }, true);
    },
    async advance() {
      const g = S.game, r = g.round, done = r + 1;
      const ranking = computeRanking(active(S.players, g), S.sum, done);
      await store.set(pa.sum, { rankings: { [done]: ranking } }, true);
      await setGame(done < TM.ROUNDS ? { phase: "open", round: done, done } : { phase: "final", round: TM.ROUNDS - 1, done });
    },
    async undo() {
      const g = S.game;
      if (g.phase === "locked") return setGame({ phase: "open" });
      if (g.phase === "open" && g.round > 0) return setGame({ phase: "locked", round: g.round - 1, done: g.round - 1 });
      if (g.phase === "open") return setGame({ phase: "lobby" });
      if (g.phase === "final") return setGame({ phase: "locked", round: TM.ROUNDS - 1, done: TM.ROUNDS - 1 });
      if (g.phase === "predict") return setGame({ phase: "final" });
    },
    async predict() { await setGame({ phase: "predict" }); },
    async reset() {
      const e = (S.game.epoch || 1) + 1;
      await store.set(pa.sum, { epoch: e, count: 0, sent: 0, names: [], frozen: {}, dist: {}, distN: {}, rankings: {}, pred: null });
      await setGame({ phase: "lobby", round: 0, done: 0, epoch: e });
    }
  };
  async function run(name) {
    if (S.busy) return; S.busy = true; S.err = ""; S.confirm = ""; draw();
    try { await act[name](); } catch (e) { return fail(e); }
    S.busy = false; draw();
  }

  function primary() {
    const g = S.game, sum = S.sum || {};
    if (g.phase === "lobby") return { label: "開始遊戲", act: "start", hint: "按下後：全班手機進入 2006 年的分配畫面。" };
    if (g.phase === "open" && S.coolUntil > Date.now()) return { label: `鎖定第 ${g.round + 1} 輪`, act: "lock", disabled: true, hint: "剛快轉，先讓同學看揭曉，幾秒後才能按鎖定。" };
    if (g.phase === "open") return { label: `鎖定第 ${g.round + 1} 輪`, act: "lock", hint: "大部分人鎖定後再按。按下後：還沒鎖定的人照目前配置定案（沒分完的算現金）。" };
    if (g.phase === "locked") { const ready = sum.frozen && sum.frozen[g.round]; return { label: g.round < 3 ? "快轉 5 年" : "快轉到 2026 年", act: "advance", hint: ready ? (g.round < 3 ? `講完這五年再按。按下後：手機和大螢幕跳到 ${TM.YEAR[g.round + 1]} 年，揭曉這五年的結果。` : "講完這五年再按。按下後：手機先揭曉 2021–2025，同學再按「看 20 年總結果」；大螢幕直接顯示 20 年總結果和頒獎台。") : "統計全班配置中，請稍候…", disabled: !ready }; }
    if (g.phase === "final") return { label: "開放 2031 預測（選用）", act: "predict", hint: "時間不夠可以不按。按下後：手機出現 2031 預測。" };
    return { label: "", act: "", hint: "這是最後一步：全班的預測會即時更新在下面，大螢幕也一樣。講完就可以結束，不需要再按任何按鈕。" };
  }
  function infoHTML() {
    const g = S.game, sum = S.sum || {}, ps = active(S.players, g);
    if (g.phase === "lobby") return joinCard() + namesCard(ps);
    if (g.phase === "open") {
      const nLock = ps.filter(p => lockedIn(p, g.round)).length;
      const ws = ps.filter(p => (p.joinedRound ?? 0) <= g.round).map(p => TM.weightsOf(TM.simulate(TM.effAllocs(p.id, sum, { ...p.allocs }, g.round), p.joinedRound ?? 0, g.round).starts[g.round]));
      const live = ui.card(ui.head(`${TM.YEAR[g.round]} 年的配置（即時）`, `${nLock} / ${ps.length} 人已鎖定`) + TM.distBar(TM.distOf(ws)));
      /* 快轉後要唸的東西（前三名、揭曉）放最上面，即時配置放後面；鎖定進度在上方狀態列 */
      return g.done > 0 ? top3Card(g.done) + revealCard(g.done - 1, g.done) + live + rankCard(g.done) : live;
    }
    if (g.phase === "locked") {
      const d = sum.dist && sum.dist[g.round];
      return ui.card(ui.head(`全班的 ${TM.YEAR[g.round]} 年配置`, d ? `${(sum.distN || {})[g.round] || 0} 人` : "統計中…") + (d ? TM.distBar(d) : `<p class="text-ink2">鎖定後約 2 秒完成統計。</p>`)) + (g.done > 0 ? rankCard(g.done) : "");
    }
    /* 結束時：前三名、最後五年的揭曉（手機上同學會先看到這段）、20 年總結果 */
    if (g.phase === "final") return top3Card(4) + revealCard(TM.ROUNDS - 1, TM.ROUNDS) + revealCard(0, 4) + rankCard(4);
    const pr = sum.pred; return predCard(pr) + rankCard(4);
  }
  /* 前三名：主持人要唸的，大字 */
  function top3Card(done) {
    const list = (S.sum && S.sum.rankings && S.sum.rankings[done]) || [];
    if (!list.length) return "";
    const top = list.slice(0, 3).map((p, i) => `<li class="flex items-end justify-between gap-4 border-b border-line py-3 last:border-0"><span class="min-w-0"><span class="block text-sm text-ink2 tnum">${TM.rankLabel(list, i)}</span><b class="block truncate text-[28px] font-black leading-tight tracking-tight">${esc(p.n)}</b></span><span class="shrink-0 text-2xl font-bold tnum">${TM.wan(p.v)}</span></li>`).join("");
    return ui.card(ui.head(done === 4 ? "最後前三名" : `${TM.ERA_DASH[done - 1]} 前三名`, "先唸這個") + `<ol>${top}</ol>`);
  }
  function rankCard(done) {
    const list = (S.sum && S.sum.rankings && S.sum.rankings[done]) || [];
    return ui.card(ui.head(done === 4 ? "最後排名" : `${TM.ERA_DASH[done - 1]} 結算排名`, `${list.length} 人`) + TM.leaderTable(list, null, 10));
  }
  function predCard(pr) {
    if (!pr || !pr.n) return ui.card(ui.head("全班的 2031 預測", "0 人送出") + `<p class="text-ink2">還沒有人送出。</p>`);
    const rows = TM.PKEYS.map(k => [k, pr.agg[k] || 0]).sort((a, b) => b[1] - a[1]), max = rows[0][1] || 1;
    return ui.card(ui.head("全班的 2031 預測", `${pr.n} 人送出`) + barsHTML(rows, max));
  }
  function joinCard() {
    const url = opts.playerUrl || "";
    const qr = url && window.qrcode ? (() => { const q = qrcode(0, "M"); q.addData(url); q.make(); return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); })() : "";
    return ui.card(ui.head("讓全班加入", opts.practice ? "練習模式" : `遊戲代碼 ${gid}`) + (opts.practice ? `<p class="text-ink2">練習模式不需要掃碼，模擬同學會自動加入。</p>` :
      `<div class="grid gap-5 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-center"><div class="mx-auto w-44 sm:w-full [&_svg]:h-auto [&_svg]:w-full">${qr}</div><div class="min-w-0"><p class="text-sm text-ink2">玩家網址（放進簡報的 QR code 也是這個）</p><p class="mt-1 break-all font-semibold">${esc(url)}</p><div class="mt-3">${ui.secondary("複製網址", `data-copy="${esc(url)}"`)}</div></div></div>`));
  }
  function namesCard(ps) {
    const names = ps.slice().sort((a, b) => (b.joinedAt || 0) - (a.joinedAt || 0)).slice(0, 60);
    return ui.card(ui.head("已加入", `${ps.length} 人`) + (names.length ? `<div class="flex flex-wrap gap-2">${names.map(p => `<span class="rounded-md bg-mist px-2.5 py-1 text-base">${esc(p.name)}</span>`).join("")}</div>` : `<p class="text-ink2">還沒有人加入。</p>`));
  }
  function stepsHTML() {
    const g = S.game; const cur = g.phase === "lobby" ? -1 : g.phase === "final" || g.phase === "predict" ? 4 : g.round;
    const items = [...TM.YEAR.slice(0, 4).map((y, i) => [String(y), `第 ${i + 1} 輪`]), ["2026", "結果"]];
    return `<ol class="flex items-center gap-1.5 overflow-x-auto" aria-label="遊戲進度">${items.map(([y, t], i) => { const st = i < cur || (i === cur && (g.phase === "final" || g.phase === "predict")) ? "done" : i === cur ? "cur" : "todo";
      return `${i ? `<li aria-hidden="true" class="h-px min-w-[8px] flex-1 ${i <= cur ? "bg-brand" : "bg-line"}"></li>` : ""}<li class="flex shrink-0 items-center gap-1.5" title="${t}" ${st === "cur" ? 'aria-current="step"' : ""}><span class="grid h-6 w-6 place-items-center rounded-full text-xs font-bold ${st === "done" ? "bg-brand text-white" : st === "cur" ? "border-2 border-brand bg-white text-brand" : "border border-line bg-white text-ink2"}">${st === "done" ? "✓" : i + 1}</span><span class="text-sm tnum ${st === "todo" ? "text-ink2" : "font-semibold"}">${y}</span></li>`; }).join("")}</ol>`;
  }
  function draw() {
    const g = S.game;
    if (g === undefined) return render([{ id: "load", key: "l", html: () => ui.card(`<p class="text-ink2">連線中…</p>`) }]);
    if (S.err && !g) return render([{ id: "err", key: S.err, html: () => ui.card(`<p class="text-up">${esc(S.err)}</p>`) }]);
    const ps = active(S.players, g), pr = primary();
    const nLock = g.phase === "open" ? ps.filter(p => lockedIn(p, g.round)).length : null;
    const undoable = g.phase !== "lobby";
    const ctl = () => ui.card(`<div class="flex flex-wrap items-center justify-between gap-3"><div><p class="text-sm text-ink2">目前狀態</p><p class="text-2xl font-black tracking-tight">${phaseText(g)}</p></div><div class="text-right"><p class="text-sm text-ink2">${nLock === null ? "已加入" : "已鎖定 / 已加入"}</p><p class="text-2xl font-black tnum">${nLock === null ? `${ps.length} 人` : `${nLock} / ${ps.length} 人`}</p></div></div>
      <div class="mt-4">${stepsHTML()}</div>
      <div class="mt-6">${pr.act ? `<button type="button" data-run="${pr.act}" class="${ui.BTN} h-14 w-full bg-brand text-lg text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-mist disabled:text-ink2" ${pr.disabled || S.busy ? "disabled" : ""}>${S.busy ? "處理中…" : pr.label}</button>` : ""}<p class="${pr.act ? "mt-2 text-ink2" : "rounded-lg bg-mist p-4 font-semibold"} text-base">${pr.hint}</p></div>
      ${S.err ? `<p class="mt-3 rounded-lg border border-up bg-white p-3 text-base text-up" role="alert">${esc(S.err)}</p>` : ""}
      <div class="mt-5 flex flex-wrap gap-3 border-t border-line pt-5">
        ${S.confirm === "undo" ? `<span class="self-center text-base">確定要回到上一步？</span>${ui.primary("確定復原", 'data-run="undo"')}${ui.secondary("取消", 'data-confirm=""')}` : ui.secondary("復原上一步", `data-confirm="undo" ${undoable ? "" : "disabled"}`)}
        <span class="ml-auto flex flex-wrap items-center gap-3">${S.confirm === "reset" ? `<span class="text-base text-up">確定重設？全班要重新加入。</span>${ui.danger("確定重設", 'data-run="reset"')}${ui.secondary("取消", 'data-confirm=""')}` : `<button type="button" data-confirm="reset" class="${ui.BTN} px-4 text-ink2 hover:bg-mist hover:text-up">重設遊戲（排練用）</button>`}</span>
      </div>`);
    render([
      { id: "ctl", key: [g, ps.length, nLock, S.busy, S.err, S.confirm, S.sum && S.sum.frozen && S.sum.frozen[g.round] ? 1 : 0, S.coolUntil > Date.now()], html: ctl },
      { id: "info", key: [g, S.sum && { d: S.sum.dist, r: S.sum.rankings, p: S.sum.pred }, g.phase === "lobby" || g.phase === "open" ? S.players.map(p => [p.id, p.name, p.epoch, p.allocs && p.allocs[g.round], lockedIn(p, g.round)]) : 0], html: () => `<div class="space-y-6">${infoHTML()}</div>` },
      ...(opts.links ? [{ id: "links", key: "links", html: () => opts.links }] : [])
    ]);
  }
  root.addEventListener("click", ev => {
    const b = ev.target.closest("button"); if (!b || !root.contains(b)) return;
    if (b.dataset.run) return run(b.dataset.run);
    if (b.dataset.confirm !== undefined) { S.confirm = b.dataset.confirm; return draw(); }
    if (b.dataset.copy) { navigator.clipboard?.writeText(b.dataset.copy).then(() => { b.textContent = "已複製"; }).catch(() => { b.textContent = "請手動複製"; }); }
  });
  const ready = ensure().then(() => {
    unsubs.push(store.watchDoc(pa.game, d => {
      const prev = S.game; S.game = d;
      /* 快轉後鎖定鍵先停用幾秒，避免手滑把下一輪提早鎖掉 */
      if (prev && d && d.phase === "open" && (d.done || 0) > (prev.done || 0)) { const ms = opts.practice ? 3000 : 8000; S.coolUntil = Date.now() + ms; setTimeout(draw, ms + 50); }
      draw(); scheduleMaint(); }, fail));
    unsubs.push(store.watchDoc(pa.sum, d => { S.sum = d; draw(); }, fail));
    unsubs.push(store.watchCol(pa.players, list => { S.players = list; draw(); scheduleMaint(); }, fail));
  }).catch(e => { S.game = null; S.err = "無法取得主持權限：" + (e.message || e) + "。請確認控制台網址（含金鑰）是否正確。"; draw(); });
  draw();
  return { state: S, ready, run, destroy: () => unsubs.forEach(u => u && u()) };
};
function barsHTML(rows, max) {
  return `<div class="space-y-2.5">${rows.map(([k, v], i) => `<div class="grid grid-cols-[84px_minmax(0,1fr)_48px] items-center gap-3 text-base"><span class="${i === 0 ? "font-semibold" : "text-ink2"}">${TM.META[k].cat}</span><span class="h-3 overflow-hidden rounded-sm bg-mist"><i class="fbar block h-full rounded-sm" style="width:${(v / max * 100).toFixed(1)}%;background:${i === 0 ? "var(--accent)" : "var(--brand)"}"></i></span><span class="text-right font-semibold tnum">${(v * 100).toFixed(0)}%</span></div>`).join("")}</div><p class="mt-4 border-t border-line pt-3 text-base">全班最看好：<b>${TM.META[rows[0][0]].cat}</b></p>`;
}
TM.barsHTML = barsHTML;

/* ===================== 玩家（手機） ===================== */
TM.mountPlayer = (root, store, gid, opts = {}) => {
  const pa = P(gid), uid = store.uid, pre = opts.prefix || "p";
  const S = { game: undefined, sum: null, me: undefined, cur: null, curKey: "", pdraft: zeros(TM.PKEYS), pinit: false, save: "", failed: null, nameDraft: "", joinErr: "", joining: false, ask: false, locking: false, lockErr: "", seen: -1, online: navigator.onLine !== false };
  const render = sections(root); const unsubs = []; let saveTimer = null, pending = null;
  const meP = pa.me(uid);

  function flush() {
    if (!pending) return; const { r, val } = pending; pending = null; clearTimeout(saveTimer);
    S.save = "saving"; drawAlloc();
    store.update(meP, { [`allocs.${r}`]: val, updatedAt: Date.now() }).then(() => { S.save = pending ? "saving" : "saved"; S.failed = null; drawAlloc(); }).catch(() => { S.save = "error"; S.failed = { r, val }; drawAlloc(); });
  }
  function queueSave(r, val) { pending = { r, val }; S.save = "saving"; clearTimeout(saveTimer); saveTimer = setTimeout(flush, 600); }
  const joined = () => (S.me && S.me.joinedRound) ?? 0;
  /* 已經看過哪一輪的揭曉（重新整理後不用再看一次） */
  const seenKey = () => `tm-seen-${gid}-${S.game ? S.game.epoch : 0}-${uid}`;
  const loadSeen = () => { try { S.seen = +(sessionStorage.getItem(seenKey()) ?? -1); } catch (e) { S.seen = Math.max(S.seen, -1); } };
  const markSeen = d => { S.seen = d; try { sessionStorage.setItem(seenKey(), String(d)); } catch (e) {} };
  const own = () => ({ ...((S.me && S.me.allocs) || {}), ...(S.cur ? { [S.cur.r]: S.cur.val } : {}) });
  function hist(done) { const eff = TM.effAllocs(uid, S.sum, own(), done); return { eff, sim: TM.simulate(eff, joined(), done) }; }
  function syncCur() {
    const g = S.game; if (!g || g.phase !== "open" || !S.me) return;
    const key = `${g.epoch}-${g.round}`; if (S.curKey === key) return;
    S.curKey = key; const a = S.me.allocs || {}, has = a[g.round] !== undefined;
    S.cur = { r: g.round, val: has ? a[g.round] : null, touched: has, fresh: !has && g.round === joined() };
    S.save = ""; S.ask = false; S.locking = false; S.lockErr = "";
  }
  const selfLocked = () => { const g = S.game; return !!(g && g.phase === "open" && S.me && lockedIn(S.me, g.round)); };
  function capital(r) { return hist(r).sim.total; }
  function heldNow(r) { /* 續抱時的持股（上一輪結束的持股） */
    const eff = { ...TM.effAllocs(uid, S.sum, own(), r) }; eff[r] = null; return TM.simulate(eff, joined(), r).starts[r] || { cash: TM.START };
  }
  function tenthsView() { const c = S.cur; if (!c) return zeros(TM.AKEYS); if (c.val) return { ...zeros(TM.AKEYS), ...c.val }; if (c.fresh || c.r === joined()) return zeros(TM.AKEYS); return TM.roundToTenths(TM.weightsOf(heldNow(c.r))); }
  const isHold = () => S.cur && !S.cur.val && S.cur.r > joined();

  const header = () => {
    const g = S.game, me = S.me;
    return `<div class="flex items-center justify-between gap-3 border-b border-line pb-3"><div><p class="text-lg font-black tracking-tight">光電時光機</p><p class="text-sm text-ink2">${me ? esc(me.name) + "・" : ""}${phaseText(g)}</p></div>${opts.practice ? `<span class="rounded-md bg-mist px-2 py-0.5 text-sm">練習模式</span>` : ""}</div>${S.online ? "" : `<p class="mt-3 rounded-lg border border-up bg-white p-3 text-base text-up" role="status">網路斷線了。畫面先停在這裡，恢復連線後會自動更新。</p>`}`;
  };
  function joinHTML() {
    const g = S.game, prev = (S.me && S.me.name) || "";
    const late = g.phase === "final" || g.phase === "predict";
    return ui.card(`<h1 class="text-[32px] font-black tracking-tight">加入光電時光機</h1>
      <p class="mt-3 text-base text-ink2">${late ? "遊戲已經結束，加入後可以看排行榜${g.phase === 'predict' ? '並參加 2031 預測' : ''}。" : g.phase === "lobby" ? "輸入暱稱，等主持人開始遊戲。" : `遊戲進行中，加入後從第 ${g.round + 1} 輪拿 10 萬元開始。`}</p>
      <form data-form="join" class="mt-5 space-y-3"><label for="${pre}-name" class="block text-base font-semibold">暱稱（排行榜會顯示）</label>
      <input id="${pre}-name" name="name" maxlength="16" autocomplete="off" value="${esc(S.nameDraft || prev)}" class="h-12 w-full rounded-lg border border-line bg-white px-4 text-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand" placeholder="例如：光速小王">
      ${S.joinErr ? `<p class="text-base text-up">${esc(S.joinErr)}</p>` : ""}
      <button type="submit" class="${ui.BTN} w-full bg-brand text-white hover:bg-brand-hover disabled:bg-mist disabled:text-ink2" ${S.joining ? "disabled" : ""}>${S.joining ? "加入中…" : "加入"}</button></form>`);
  }
  const lobbyHTML = () => ui.card(`<p class="text-base text-ink2">已加入</p><p class="text-[32px] font-black tracking-tight">${esc(S.me.name)}</p><p class="mt-4 text-lg">等待主持人開始遊戲</p><p class="mt-1 text-base text-ink2">目前 <b class="tnum text-ink">${(S.sum && S.sum.count) || 1}</b> 人加入。</p>
    <ul class="mt-5 space-y-2 border-t border-line pt-4 text-base"><li>你會回到 2006 年 1 月，拿 10 萬元分配到五個光電產業。</li><li>共 4 輪，每輪快轉 5 年，用真實股價（含股利）算出結果。</li><li>第 2 輪起不動也可以，會沿用上一輪的持股。</li></ul>`);
  function topHTML() {
    const g = S.game, r = g.round, cap = capital(Math.min(r, g.done));
    const list = (S.sum && S.sum.rankings && S.sum.rankings[g.done]) || [], rk = list.findIndex(x => x.u === uid);
    const money = ui.stat(g.phase === "locked" ? `${TM.YEAR[r]} 年投入` : "可用資金", TM.wan(cap), g.done > 0 ? TM.chgX(cap / TM.START) + " 相對起始" : "起始資金");
    /* 第一次結算前只有起始的 10 萬，不放卡 */
    if (g.done === 0) return "";
    return rk >= 0 ? `<div class="grid grid-cols-2 gap-3">${money}${ui.stat("目前名次", `<span class="whitespace-nowrap">${TM.rankLabel(list, rk)}</span>`, `共 ${list.length} 人`)}</div>` : money;
  }
  /* 剛結算那一輪的揭曉。full：快轉後第一眼的完整揭曉；否則是分配畫面下方可收合的回顧 */
  function revealHTML(full) {
    const g = S.game, r = g.done - 1, d = ((S.sum || {}).dist || {})[r], mine = r >= joined();
    const list = ((S.sum || {}).rankings || {})[g.done] || [], rk = list.findIndex(x => x.u === uid);
    let me = "", inv = null, w = null;
    if (mine) {
      const { sim } = hist(g.done), before = TM.sumH(sim.starts[r]), after = TM.sumH(sim.ends[r]); inv = sim.starts[r]; w = TM.weightsOf(inv);
      me = full
        ? `<div class="mt-5 rounded-lg bg-paper p-4"><p class="text-base text-ink2">你的 ${TM.wan(before)} 變成</p><p class="text-[32px] font-black leading-tight tracking-tight tnum"><span data-count-id="${pre}-cu${g.epoch}-${g.done}" data-count-from="${before}" data-count-to="${after}">${TM.wan(after)}</span></p><p class="mt-1 text-base">${TM.chgX(after / before)}${rk >= 0 ? `<span class="whitespace-nowrap">・${TM.rankLabel(list, rk)} / ${list.length} 人</span>` : ""}</p></div>`
        : `<p class="text-base">你的錢 <span class="whitespace-nowrap tnum">${TM.wan(before)} → <b>${TM.wan(after)}</b></span></p><p class="text-base">${TM.chgX(after / before)}${rk >= 0 ? `<span class="whitespace-nowrap">・${TM.rankLabel(list, rk)} / ${list.length} 人</span>` : ""}</p>`;
    }
    const ch = TM.eraChart(`${pre}-res${r}${full ? "f" : "c"}`, r, "sm");
    const detail = `${ch.html}${ui.legend(ch.series)}<div class="mt-4">${TM.returnsTable(r, inv)}</div>`;
    if (!full) return ui.card(ui.head(`${TM.ERA_DASH[r]} 揭曉`) + me + `<details class="mt-3 border-t border-line pt-2"><summary class="flex min-h-[44px] cursor-pointer items-center text-base font-semibold">再看一次各產業結果</summary><div class="pt-2"><p class="text-base">${TM.revealLine(r, r + 1, d)}</p><div class="mt-4">${TM.revealTable(r, r + 1, d, "base", w)}</div><div class="mt-5">${detail}</div></div></details>`);
    /* 按鈕放在揭曉和你的錢後面：先看完結果才往下一輪 */
    const next = g.phase === "open" || g.phase === "final" ? `<div class="mt-5"><button type="button" data-reveal-go class="${ui.BTN} h-14 w-full bg-brand text-lg text-white hover:bg-brand-hover">${g.phase === "final" ? "看 20 年總結果" : `開始 ${TM.YEAR[g.round]} 年分配`}</button></div>` : "";
    return ui.card(`<div data-warp-box class="flex flex-wrap items-end gap-x-3 gap-y-1"><h2 class="text-[40px] font-black leading-none tracking-tight">${TM.warpYear(`${pre}-w${g.epoch}-${g.done}`, TM.YEAR[r], TM.YEAR[r + 1])}<span class="ml-1 text-xl font-bold">年</span></h2><p class="pb-1 text-lg font-bold">${TM.ERA_DASH[r]} 揭曉</p><span class="warpline w-16 basis-full"></span></div>
      <p class="mt-4 text-lg font-semibold leading-snug">${TM.takeawayText(r, r + 1, d)}</p><div class="mt-4">${TM.revealTable(r, r + 1, d, "base", w)}</div>${me}${next}
      <details class="mt-4 border-t border-line pt-2"><summary class="flex min-h-[44px] cursor-pointer items-center text-base font-semibold">看走勢圖和每家細節</summary><div class="pt-2">${detail}</div></details>`);
  }
  function allocHTML() {
    const g = S.game, r = g.round, t = tenthsView(), sum = TM.sumT(t), hold = isHold(), held = r > joined() ? heldNow(r) : null, heldTot = held ? TM.sumH(held) : 0, cap = held ? heldTot : capital(r);
    const saveTxt = S.save === "saving" ? "儲存中…" : S.save === "saved" ? "已儲存" : S.save === "error" ? `沒有存到，可能是網路斷了。<button type="button" data-retry class="ml-1 inline-flex min-h-[44px] items-center font-semibold underline underline-offset-4">重新儲存</button>` : "";
    const rows = TM.AKEYS.map(k => { const co = TM.coOf(k), v = t[k] || 0;
      return `<div class="arow relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-b border-line py-3" data-k="${k}">
        <div class="min-w-0"><div class="flex min-w-0 items-center gap-2 text-base font-semibold"><i class="dot" style="--c:${TM.col(k)}"></i><span class="whitespace-nowrap">${TM.META[k].cat}</span><span class="truncate font-normal text-ink2">${co.name}</span></div>
        <div class="text-sm text-ink2 tnum">${hold
          ? ((held[k] || 0) > 0.5 ? `<b class="font-semibold text-ink">${TM.wan(held[k])}</b>` : "—")
          : (v ? `<b class="font-semibold text-ink">${TM.wan(cap * v / 10)}</b>` : "—") + (held && (held[k] || 0) > 0.5 ? `<span class="ml-1">（原本 ${TM.wan(held[k])}）</span>` : "")}</div></div>
        ${hold ? `<span class="w-[8.5rem] text-right text-lg font-semibold tnum">${((held[k] || 0) / (heldTot || 1) * 100).toFixed(0)}%</span>` : `<div class="flex items-center rounded-lg border border-line">
          <button type="button" data-act="dec" aria-label="${TM.META[k].cat} 減少 10%" class="grid h-11 w-11 place-items-center rounded-l-lg text-xl hover:bg-mist disabled:cursor-not-allowed disabled:text-[#A8A399] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand" ${v <= 0 ? "disabled" : ""}>${TM.MINUS}</button>
          <output class="w-14 text-center text-lg font-semibold tnum">${v * 10}%</output>
          <button type="button" data-act="inc" aria-label="${TM.META[k].cat} 增加 10%" class="grid h-11 w-11 place-items-center rounded-r-lg text-xl hover:bg-mist disabled:cursor-not-allowed disabled:text-[#A8A399] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand" ${sum >= 10 ? "disabled" : ""}>+</button></div>`}
        <span class="abar absolute -bottom-px left-0 h-0.5" style="width:${hold ? ((held[k] || 0) / (heldTot || 1) * 100).toFixed(1) : v * 10}%;background:${TM.col(k)}"></span></div>`; }).join("");
    const preset = (id, label, on = false) => `<button type="button" data-preset="${id}" class="inline-flex h-11 items-center rounded-lg border px-4 text-base transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${on ? "border-2 border-brand bg-white font-semibold text-brand" : "border-line bg-white hover:bg-mist"}" ${on ? 'aria-pressed="true"' : ""}>${label}</button>`;
    const status = hold ? "不買也不賣，這五年照上一輪的持股繼續放。想改就按「調整配置」，會從最接近的整十開始調。" : sum === 10 ? "已分配 100%。要加別的，先減少某一項。" : `已分配 <b class="tnum">${sum * 10}%</b>，剩下 <b class="tnum">${(10 - sum) * 10}%</b>（${TM.wan(cap * (10 - sum) / 10)}）算現金。`;
    const left = hold ? 0 : 10 - sum, lockLabel = left === 10 ? "全部放現金並鎖定" : left > 0 ? `鎖定（剩下 ${left * 10}% 放現金）` : "鎖定我的配置";
    const lockArea = S.ask
      ? `<div class="mt-4 rounded-lg border border-brand p-4"><p class="text-base font-semibold">確定鎖定？鎖定後這一輪就不能再改。${left > 0 ? `沒分配的 ${left * 10}% 會放現金。` : ""}</p><div class="mt-3 flex flex-wrap gap-2">${ui.primary(S.locking ? "鎖定中…" : "確定鎖定", `data-lock="yes" ${S.locking ? "disabled" : ""}`)}${ui.secondary("再想想", `data-lock="no" ${S.locking ? "disabled" : ""}`)}</div>${S.lockErr ? `<p class="mt-2 text-base text-up">${S.lockErr}</p>` : ""}</div>`
      : `<div class="mt-4 border-t border-line pt-4"><button type="button" data-lock="ask" class="${ui.BTN} w-full bg-brand text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-mist disabled:text-ink2">${lockLabel}</button><p class="mt-2 text-base text-ink2">鎖定後這一輪就不能再改。不鎖也可以，主持人鎖定時會用你目前的配置。</p></div>`;
    const first = r === joined() && !held;
    const lead = hold ? `<p class="mb-3 inline-flex items-center gap-2 rounded-md bg-mist px-3 py-1.5 text-base font-semibold"><i class="dot" style="--c:var(--brand)"></i>續抱中：維持上一輪的持股</p>`
      : first ? `<p class="mb-3 text-base text-ink2">每按一次「+」放 10% 進去。沒分配的錢算現金（年利 1%）。</p>` : "";
    return ui.card(ui.head(first ? `分配你的 ${TM.wan(capital(r))}` : `${TM.YEAR[r]} 年：要調整配置嗎？`, held ? `目前資產 ${TM.wan(heldTot)}・每格 10%` : "") + lead + `<div class="border-t border-line">${rows}</div>
      <div class="mt-4 flex flex-wrap gap-2">${hold
        ? `${preset("re", "調整配置")}${preset("even", "五家平均")}${preset("cash", "全部現金")}`
        : `${preset("even", "五家平均")}${preset("cash", "全部現金")}${preset("clear", "清空")}${held ? preset("hold", "維持上一輪") : ""}`}</div>
      <p class="mt-4 text-base">${status}</p><p class="mt-1 min-h-[1.5em] text-sm ${S.save === "error" ? "text-up" : "text-ink2"}" role="status">${saveTxt}</p>${lockArea}`);
  }
  function mineList(r) {
    const mine = r >= joined() ? (TM.simulate(TM.effAllocs(uid, S.sum, own(), r + 1), joined(), r).starts[r] || { cash: TM.START }) : { cash: TM.START }, tot = TM.sumH(mine);
    const items = TM.AKEYS.filter(k => mine[k] > 0.5).sort((a, b) => mine[b] - mine[a]);
    return { items, html: `<ul class="mt-2 divide-y divide-line border-y border-line">${items.map(k => `<li class="flex items-center gap-3 py-2.5 text-base"><i class="dot" style="--c:${TM.col(k)}"></i><span class="whitespace-nowrap font-semibold">${TM.META[k].cat}</span><span class="truncate text-ink2">${TM.coOf(k).name}</span><span class="ml-auto whitespace-nowrap tnum">${TM.wan(mine[k])}</span><span class="w-12 text-right tnum text-ink2">${(mine[k] / tot * 100).toFixed(0)}%</span></li>`).join("")}</ul>` };
  }
  function selfLockedHTML() {
    const g = S.game, r = g.round, sum = S.sum || {};
    return ui.card(`<div class="rounded-lg bg-mist p-4"><p class="text-lg font-bold">你已鎖定・${TM.YEAR[r]} 年的配置</p><p class="text-base text-ink2">等主持人鎖定全班。目前 <b class="tnum text-ink">${Math.max(sum.lockN || 0, 1)}</b> / ${sum.count || 1} 人已鎖定。</p></div>
      <h2 class="mt-5 text-xl font-bold">你的配置</h2>${mineList(r).html}`);
  }
  function lockedHTML() {
    const g = S.game, r = g.round, sum = S.sum || {};
    const { items, html: mineHTML } = mineList(r);
    const d = sum.dist && sum.dist[r];
    let line = "";
    if (d) { const topK = TM.AKEYS.slice().sort((a, b) => (d[b] || 0) - (d[a] || 0))[0];
      const m = r >= joined() ? (TM.simulate(TM.effAllocs(uid, S.sum, own(), r + 1), joined(), r).starts[r] || {}) : {}, mx = items.length ? m[items[0]] : 0;
      const bets = items.filter(k => k !== "cash"), bx = bets.length ? m[bets[0]] : 0;
      const myTop = bets.filter(k => Math.abs(m[k] - bx) < 1).map(k => `<b>${TM.META[k].cat}</b>`);
      line = `全班最多錢押在<b>${TM.META[topK].cat}</b>（${((d[topK] || 0) * 100).toFixed(0)}%）${myTop.length ? `，你押最多的是${myTop.join("和")}` : ""}。`; }
    return `<div class="space-y-5">` + ui.card(`<div class="rounded-lg bg-mist p-4"><p class="text-lg font-bold">已鎖定・${TM.YEAR[r]} 年的配置</p><p class="text-base text-ink2">五年後揭曉，先聽台上怎麼說。</p></div>
      <h2 class="mt-5 text-xl font-bold">你的配置</h2>${mineHTML}`)
      + ui.card(ui.head("全班押在哪", d ? `${(sum.distN || {})[r] || 0} 人` : "統計中…") + (d ? TM.distBar(d) + `<p class="mt-4 border-t border-line pt-3 text-base">${line}</p>` : `<p class="text-ink2">主持人鎖定後幾秒內會出現。</p>`)) + `</div>`;
  }
  function boardHTML(done) { return ui.card(ui.head("排行榜", (S.sum && S.sum.rankings && S.sum.rankings[done] ? `${S.sum.rankings[done].length} 人` : "")) + TM.leaderTable(S.sum && S.sum.rankings && S.sum.rankings[done], uid, 10)); }
  function historyHTML(done, openLatest) {
    const { sim } = hist(done); const rows = [];
    for (let r = joined(); r < done; r++) {
      const b = TM.sumH(sim.starts[r]), a = TM.sumH(sim.ends[r]); const ch = TM.eraChart(`${pre}-h${r}`, r, "sm", false);
      rows.push(`<details class="group border-b border-line py-3" ${openLatest && r === done - 1 ? "open" : ""}><summary class="flex min-h-[44px] cursor-pointer list-none flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-base"><span class="whitespace-nowrap font-semibold tnum">${TM.ERA_DASH[r]}</span><span class="whitespace-nowrap">${TM.chgX(a / b)}</span><span class="w-full tnum text-ink2">${TM.wan(b)} → <b class="text-ink">${TM.wan(a)}</b></span></summary><div class="pt-3">${ch.html}${ui.legend(ch.series)}<div class="mt-3">${TM.returnsTable(r, sim.starts[r])}</div></div></details>`);
    }
    return ui.card(ui.head("你的資產變化", "點開可以看那五年的走勢") + (rows.length ? `<div class="border-t border-line">${rows.join("")}</div>` : `<p class="text-ink2">還沒有結算的輪次。</p>`));
  }
  function finalHTML() {
    const { sim } = hist(4), fin = sim.total, list = ((S.sum || {}).rankings || {})[4] || [], rk = list.findIndex(x => x.u === uid);
    if (joined() >= 4) return ui.card(`<h1 class="text-[32px] font-black tracking-tight">遊戲已結束</h1><p class="mt-2 text-ink2">你在結束後才加入，下面是最後排名。</p>`);
    const v = c => TM.START * TM.SER[c.pick][TM.CP[4]] / TM.SER[c.pick][TM.CP[joined()]];
    const tri = TM.START * TM.SER.TRI[TM.CP[4]] / TM.SER.TRI[TM.CP[joined()]], even = TM.CATS.reduce((a, c) => a + v(c) / 5, 0);
    const opts2 = [...TM.CATS.map(c => ({ k: c.key, l: `全押${TM.COS[c.pick].name}`, v: v(c) })), { l: "買大盤", v: tri }, { l: "五家平均", v: even }, { l: "你", v: fin, me: true }].sort((a, b) => b.v - a.v);
    const vals = TM.CP.map((_, k) => k < joined() ? null : k === joined() ? TM.START : TM.sumH(sim.ends[k - 1]));
    const ch = TM.fullChart(`${pre}-full`, vals, "sm");
    const j = joined(), d0 = j === 0 && S.sum && S.sum.dist ? S.sum.dist[0] : null, w0 = sim.starts[j] ? TM.weightsOf(sim.starts[j]) : null;
    const share = o => o.k ? `${Math.round((d0[o.k] || 0) * 100)}%` : "—";
    /* 你當初押最多的產業，連回這堂課的重點 */
    let lesson = "";
    if (w0) { const span = `${(4 - j) * 5} 年後`, bets = TM.KEYS.filter(k => (w0[k] || 0) > 0.005).sort((a, b) => w0[b] - w0[a]);
      if (!bets.length) lesson = `你 ${TM.YEAR[j]} 年全部放現金，${span} ${TM.xfmt(TM.spanMult("cash", j, 4))}。`;
      else { const k = bets[0], m = TM.spanMult(k, j, 4), best = TM.reveal(j, 4, null).best.k;
        lesson = `你 ${TM.YEAR[j]} 年押最多的是<b>${TM.META[k].cat}</b>（${Math.round(w0[k] * 100)}%），${span} <b class="tnum ${m >= 1 ? "tm-up" : "tm-down"}">${TM.xfmt(m)}</b>${TM.META[k].hot ? "，它正是 2006 年的熱門產業。" : k === best ? "，剛好是最賺的。" : "。"}`; } }
    /* 先揭曉產業（核心訊息），接著「當初會這樣押嗎」，個人成績放第三 */
    return `<div class="space-y-5">` + ui.card(`<div data-warp-box><h1 class="text-[56px] font-black leading-none tracking-tight">${TM.warpYear(`${pre}-wf${S.game.epoch}`, TM.YEAR[3], TM.YEAR[4])}<span class="ml-1 text-2xl font-bold">年</span></h1><span class="warpline mt-3 w-16"></span><p class="mt-3 text-xl font-bold">${(4 - j) * 5} 年後揭曉</p></div>
      <p class="mt-4 text-lg font-semibold leading-snug">${TM.takeawayText(j, 4, d0)}</p><div class="mt-4">${TM.revealTable(j, 4, d0, "base", w0)}</div>`)
      + ui.card(ui.head(d0 ? "但 2006 年你會這樣押嗎？" : "如果當初⋯", "一次買進，之後都不動") + `<table class="w-full border-collapse text-base"><thead><tr class="border-b border-line text-sm text-ink2"><th class="py-2 pl-2 text-left font-medium">如果當初</th>${d0 ? `<th class="whitespace-nowrap py-2 pr-3 text-right font-medium">全班押</th>` : ""}<th class="py-2 pr-2 text-right font-medium">20 年後</th></tr></thead><tbody>${opts2.map(o => `<tr class="border-b border-line ${o.me ? "bg-mist font-semibold" : ""}"><td class="py-2.5 pl-2">${o.l}</td>${d0 ? `<td class="py-2.5 pr-3 text-right tnum text-ink2">${o.me ? "" : share(o)}</td>` : ""}<td class="py-2.5 pr-2 text-right tnum whitespace-nowrap">${TM.wan(o.v)}<span class="block text-sm text-ink2">${TM.xfmt(o.v / TM.START)}</span></td></tr>`).join("")}</tbody></table>`)
      + ui.card(`<p class="text-base text-ink2">${TM.YEAR[j]} 年初 → 2025 年底，你的 10 萬元變成</p>
      <p class="mt-1 text-[48px] font-black leading-none tracking-tight tnum" data-count-id="${pre}-cuf${S.game.epoch}" data-count-from="${TM.START}" data-count-to="${fin}">${TM.wan(fin)}</p>
      <p class="mt-3 text-base">${TM.chgX(fin / TM.START)}${rk >= 0 ? `<span class="whitespace-nowrap">，全班 ${list.length} 人中${TM.rankLabel(list, rk)}</span>` : ""}</p>${lesson ? `<p class="mt-4 border-t border-line pt-4 text-base">${lesson}</p>` : ""}`)
      + ui.card(ui.head("20 年全貌", "粗線是你") + ch.html + ui.legend(ch.series)) + `</div>`;
  }
  function predictHTML() {
    const t = S.pdraft, sum = TM.sumT(t), sent = S.me && S.me.pred && TM.sumT(S.me.pred) === 10, same = sent && hashOf(TM.cleanT(S.me.pred, TM.PKEYS)) === hashOf(TM.cleanT(t, TM.PKEYS));
    const rows = TM.PKEYS.map(k => { const v = t[k] || 0; return `<div class="arow relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-b border-line py-3" data-k="${k}"><div class="flex min-w-0 flex-wrap items-center gap-x-2 text-base font-semibold"><i class="dot" style="--c:${TM.col(k)}"></i><span class="whitespace-nowrap">${TM.META[k].cat}</span>${TM.KEYS.includes(k) ? "" : `<span class="font-normal text-ink2">${TM.META[k].name}</span>`}</div>
      <div class="flex items-center rounded-lg border border-line"><button type="button" data-pact="dec" aria-label="${TM.META[k].cat} 減少 10%" class="grid h-11 w-11 place-items-center rounded-l-lg text-xl hover:bg-mist disabled:cursor-not-allowed disabled:text-[#A8A399] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand" ${v <= 0 ? "disabled" : ""}>${TM.MINUS}</button><output class="w-14 text-center text-lg font-semibold tnum">${v * 10}%</output><button type="button" data-pact="inc" aria-label="${TM.META[k].cat} 增加 10%" class="grid h-11 w-11 place-items-center rounded-r-lg text-xl hover:bg-mist disabled:cursor-not-allowed disabled:text-[#A8A399] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand" ${sum >= 10 ? "disabled" : ""}>+</button></div><span class="abar absolute -bottom-px left-0 h-0.5" style="width:${v * 10}%;background:${TM.col(k)}"></span></div>`; }).join("");
    const pr = S.sum && S.sum.pred;
    return `<div class="space-y-5">` + ui.card(`<h1 class="text-2xl font-black tracking-tight">2026 → 2031，你看好哪裡？</h1><p class="mt-2 text-base text-ink2">每人重新拿 10 萬元，押產業就好，多了「光通訊」。送出後才會看到全班的預測。</p>
      <div class="mt-4 border-t border-line">${rows}</div><div class="mt-4 flex flex-wrap gap-2"><button type="button" data-ppreset="even" class="inline-flex h-11 items-center rounded-lg border border-line bg-white px-4 text-base hover:bg-mist focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">五家平均</button><button type="button" data-ppreset="clear" class="inline-flex h-11 items-center rounded-lg border border-line bg-white px-4 text-base hover:bg-mist focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">清空</button></div>
      ${S.predErr ? `<p class="mt-3 text-base text-up" role="alert">${S.predErr}</p>` : ""}<div class="mt-4 flex flex-wrap items-center gap-3">${ui.primary(S.predBusy ? "送出中…" : same ? "已送出" : sent ? "送出修改" : "送出預測", `data-submit-pred ${sum === 10 && !same && !S.predBusy ? "" : "disabled"}`)}<span class="text-base text-ink2">${sum === 10 ? "" : `已分配 ${sum * 10}%，要剛好 100% 才能送出`}</span></div>`)
      + (sent && pr && pr.n ? ui.card(ui.head("全班的 2031 預測", `${pr.n} 人送出`) + barsHTML(TM.PKEYS.map(k => [k, pr.agg[k] || 0]).sort((a, b) => b[1] - a[1]), Math.max(...TM.PKEYS.map(k => pr.agg[k] || 0)) || 1)) : "") + `</div>`;
  }

  function draw() {
    const g = S.game, sum = S.sum || {};
    if (g === undefined || S.me === undefined) return render([{ id: "h", key: "load", html: () => `<p class="py-10 text-center text-ink2">連線中…</p>` }]);
    if (g === null) return render([{ id: "h", key: "none", html: () => ui.card(`<h1 class="text-2xl font-bold">找不到這場遊戲</h1><p class="mt-2 text-ink2">請重新掃描台上的 QR code。</p>`) }]);
    syncCur();
    if (!S.me || S.me.epoch !== g.epoch) return render([{ id: "hd", key: [g.phase, g.round, S.me && S.me.name, S.online], html: header }, { id: "join", key: [g.phase, g.round, S.joinErr, S.joining], html: joinHTML }]);
    const done = g.done || 0, rk = hashOf(sum.rankings && sum.rankings[done]);
    const hd = { id: "hd", key: [g.phase, g.round, S.me.name, S.online], html: header };
    if (g.phase === "lobby") return render([hd, { id: "lobby", key: [sum.count], html: lobbyHTML }]);
    const fz = hashOf(sum.frozen);
    if (g.phase === "open") {
      const sl = selfLocked(), dk = hashOf(sum.dist && sum.dist[done - 1]);
      /* 快轉後第一眼：只看揭曉，按「開始分配」才進入下一輪 */
      if (done > 0 && !sl && S.seen < done) return render([hd, { id: "rev" + done, key: [rk, fz, dk], html: () => revealHTML(true) }]);
      const list = [hd];
      list.push(sl ? { id: "alloc", key: ["L", g.round, fz, S.me.allocs && S.me.allocs[g.round], sum.lockN, sum.count], html: selfLockedHTML } : { id: "alloc", key: [g.round, S.cur, S.save, fz, S.ask, S.locking, S.lockErr], html: allocHTML });
      if (done > 0) list.push({ id: "resc" + done, key: [rk, fz, dk], html: () => revealHTML(false) }, { id: "board", key: [rk], html: () => boardHTML(done) }, { id: "hist", key: [done, fz], html: () => historyHTML(done, false) });
      return render(list);
    }
    if (g.phase === "locked") {
      const list = [hd, { id: "top", key: [g.round, done, rk, fz], html: topHTML }, { id: "locked", key: [g.round, fz, hashOf(sum.dist && sum.dist[g.round]), S.cur && S.cur.val], html: lockedHTML }];
      if (done > 0) list.push({ id: "board", key: [rk], html: () => boardHTML(done) }, { id: "hist", key: [done, fz], html: () => historyHTML(done, false) });
      return render(list);
    }
    /* 最後一輪也先揭曉這五年，按「看 20 年總結果」才進入最終畫面 */
    if (g.phase === "final" && joined() < TM.ROUNDS && S.seen < done) return render([hd, { id: "rev" + done, key: [rk, fz, hashOf(sum.dist && sum.dist[done - 1])], html: () => revealHTML(true) }]);
    if (g.phase === "final") return render([hd, { id: "final", key: [rk, fz], html: finalHTML }, { id: "board", key: [rk], html: () => boardHTML(4) }, { id: "hist", key: [fz], html: () => historyHTML(4, false) }]);
    if (!S.pinit && S.me.pred) { S.pdraft = { ...zeros(TM.PKEYS), ...TM.cleanT(S.me.pred, TM.PKEYS) }; }
    S.pinit = true;
    return render([hd, { id: "pred", key: [S.pdraft, S.me.pred, sum.pred, S.predErr, S.predBusy], html: predictHTML }, { id: "final", key: [rk, fz], html: finalHTML }, { id: "board", key: [rk], html: () => boardHTML(4) }]);
  }
  function drawAlloc() { draw(); }

  root.addEventListener("submit", ev => {
    const f = ev.target.closest("form[data-form=join]"); if (!f) return; ev.preventDefault();
    const name = (f.elements.name.value || "").trim().slice(0, 16);
    if (!name) { S.joinErr = "請輸入暱稱。"; return draw(); }
    const g = S.game; S.joining = true; S.joinErr = ""; S.nameDraft = name; draw();
    const jr = g.phase === "lobby" ? 0 : g.phase === "open" || g.phase === "locked" ? g.round : TM.ROUNDS;
    store.set(meP, { name, epoch: g.epoch, joinedRound: jr, joinedAt: Date.now(), allocs: {}, pred: null, updatedAt: Date.now() })
      .then(() => { S.joining = false; S.curKey = ""; })
      .catch(e => { S.joining = false; S.joinErr = "加入失敗，請檢查網路後再試一次。"; draw(); });
  });
  root.addEventListener("input", ev => { if (ev.target.name === "name") S.nameDraft = ev.target.value; });
  root.addEventListener("click", ev => {
    const b = ev.target.closest("button"); if (!b || !root.contains(b)) return;
    const g = S.game; if (!g) return;
    if (b.hasAttribute("data-submit-pred")) { const t = TM.cleanT(S.pdraft, TM.PKEYS); S.predBusy = true; S.predErr = ""; draw();
      store.update(meP, { pred: t, updatedAt: Date.now() }).then(() => { S.predBusy = false; draw(); }).catch(() => { S.predBusy = false; S.predErr = "沒有送出，可能是網路斷了。請再按一次「送出預測」。"; draw(); }); return; }
    if (b.dataset.ppreset) { S.pdraft = { ...zeros(TM.PKEYS), ...(b.dataset.ppreset === "even" ? Object.fromEntries(TM.KEYS.map(k => [k, 2])) : {}) }; S.predErr = ""; return draw(); }
    if (b.dataset.pact) { const k = b.closest(".arow").dataset.k, s = TM.sumT(S.pdraft); if (b.dataset.pact === "inc" && s < 10) S.pdraft[k]++; if (b.dataset.pact === "dec" && S.pdraft[k] > 0) S.pdraft[k]--; S.pdraft = { ...S.pdraft }; draw();
      const nb = root.querySelector(`.arow[data-k="${k}"] [data-pact="${b.dataset.pact}"]:not(:disabled)`) || root.querySelector(`.arow[data-k="${k}"] [data-pact]:not(:disabled)`); if (nb) nb.focus({ preventScroll: true }); return; }
    if (b.hasAttribute("data-reveal-go")) { markSeen(g.done || 0); draw(); toTop(); return; }
    if (b.hasAttribute("data-retry")) { if (S.failed) { pending = S.failed; flush(); } return; }
    if (g.phase !== "open" || !S.cur || selfLocked()) return;
    const r = S.cur.r;
    if (b.dataset.lock) {
      if (b.dataset.lock === "ask") { S.ask = true; S.lockErr = ""; draw();
        /* 確認框可能在畫面下方，捲到看得見的地方 */
        const y = root.querySelector('[data-lock="yes"]'); if (y) { y.focus({ preventScroll: true }); y.closest("div.rounded-lg").scrollIntoView({ block: "nearest", behavior: TM.RM ? "auto" : "smooth" }); } return; }
      if (b.dataset.lock === "no") { S.ask = false; return draw(); }
      if (S.locking) return;
      const t = tenthsView();
      clearTimeout(saveTimer); pending = null; S.locking = true; S.lockErr = ""; draw();
      const val = isHold() ? null : TM.cleanT(t);
      store.update(meP, { [`allocs.${r}`]: val, [`locks.${r}`]: true, updatedAt: Date.now() })
        .then(() => { S.locking = false; S.ask = false; S.save = "saved"; S.cur = { ...S.cur, val, touched: true, fresh: false }; draw(); })
        .catch(() => { S.locking = false; S.lockErr = "鎖定失敗，請檢查網路後再按一次。"; draw(); });
      return;
    }
    if (b.dataset.preset) {
      const p = b.dataset.preset; let val;
      if (p === "hold") val = null;
      else if (p === "re") val = TM.cleanT(TM.roundToTenths(TM.weightsOf(heldNow(r)))) || {};
      else { val = {}; if (p === "even") TM.KEYS.forEach(k => val[k] = 2); if (p === "cash") val.cash = 10; }
      S.cur = { ...S.cur, val, touched: true, fresh: false }; queueSave(r, val); return draw();
    }
    const act = b.dataset.act; if (!act) return;
    const k = b.closest(".arow").dataset.k; const t = { ...tenthsView() }; const s = TM.sumT(t);
    if (act === "inc" && s < 10) t[k] = (t[k] || 0) + 1; if (act === "dec" && t[k] > 0) t[k]--;
    const val = TM.cleanT(t) || {}; S.cur = { ...S.cur, val, touched: true, fresh: false }; TM.say(`${TM.META[k].cat} ${(t[k] || 0) * 10}%，已分配 ${TM.sumT(t) * 10}%`); queueSave(r, val); draw();
    /* 重畫後把焦點放回同一顆按鈕（鍵盤操作不會跑掉）；按到底停用時改放另一顆 */
    const nb = root.querySelector(`.arow[data-k="${k}"] [data-act="${act}"]:not(:disabled)`) || root.querySelector(`.arow[data-k="${k}"] [data-act]:not(:disabled)`); if (nb) nb.focus({ preventScroll: true });
  });
  const onErr = () => { S.save = "error"; draw(); };
  const setOnline = v => { S.online = v; draw(); if (v && S.failed) { pending = S.failed; flush(); } };
  window.addEventListener("online", () => setOnline(true)); window.addEventListener("offline", () => setOnline(false));
  /* 主持人換階段時，把畫面捲回最上面，讓全班第一眼看到一樣的內容 */
  const toTop = () => { if (/(auto|scroll)/.test(getComputedStyle(root).overflowY)) root.scrollTo({ top: 0 }); window.scrollTo(0, 0); };
  unsubs.push(store.watchDoc(pa.game, d => {
    const prev = S.game; S.game = d;
    if (d && (!prev || prev.epoch !== d.epoch)) loadSeen();
    if (prev && d && prev.phase === "open" && d.phase !== "open") flush();
    draw();
    if (prev && d && (prev.phase !== d.phase || prev.round !== d.round || prev.epoch !== d.epoch)) toTop();
  }, onErr));
  unsubs.push(store.watchDoc(pa.sum, d => { S.sum = d; draw(); }, onErr));
  unsubs.push(store.watchDoc(meP, d => { S.me = d; draw(); }, onErr));
  draw();
  return { state: S, destroy: () => unsubs.forEach(u => u && u()) };
};

/* ===================== 大螢幕（選用） ===================== */
TM.mountBoard = (root, store, gid, opts = {}) => {
  const pa = P(gid), pre = opts.prefix || "b"; const S = { game: undefined, sum: null };
  const render = sections(root);
  function draw() {
    const g = S.game, sum = S.sum || {};
    if (!g) return render([{ id: "x", key: String(g), html: () => `<p class="py-20 text-center text-2xl text-ink2">${g === null ? "找不到這場遊戲" : "連線中…"}</p>` }]);
    const done = g.done || 0;
    if (g.phase === "lobby") {
      const url = opts.playerUrl || "";
      const qr = url && window.qrcode ? (() => { const q = qrcode(0, "M"); q.addData(url); q.make(); return q.createSvgTag({ cellSize: 8, margin: 2, scalable: true }); })() : "";
      return render([{ id: "lobby", key: [sum.count, sum.names], html: () => `<section class="grid grid-cols-1 items-center gap-10 py-10 lg:grid-cols-12"><div class="lg:col-span-5"><h1 class="text-5xl font-black tracking-tight lg:text-6xl">光電時光機</h1><p class="mt-5 text-xl text-ink2">掃描 QR code，輸入暱稱加入。每人 10 萬元，從 2006 年開始投資台灣光電產業。</p><p class="mt-8 text-lg text-ink2">已加入</p><p class="text-6xl font-black tnum">${sum.count || 0} 人</p></div>
        <div class="lg:col-span-7">${ui.card(`<div class="grid gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-center"><div class="mx-auto w-full max-w-[320px] [&_svg]:h-auto [&_svg]:w-full">${qr || `<p class="text-ink2">${opts.practice ? "練習模式不需要掃碼" : "（QR code）"}</p>`}</div><div><p class="break-all text-lg font-semibold">${esc(url)}</p><div class="mt-4 flex flex-wrap gap-2">${(sum.names || []).slice(0, 24).map(n => `<span class="rounded-md bg-mist px-2.5 py-1">${esc(n)}</span>`).join("")}</div></div></div>`)}</div></section>` }]);
    }
    const head = (t, s) => `<div class="flex flex-wrap items-end justify-between gap-4 py-8"><h1 class="text-5xl font-black tracking-tight">${t}</h1><p class="text-xl text-ink2">${s}</p></div>`;
    /* 揭曉標題：年份從上一站滾到這一站 */
    const revealHead = (from, to, title) => `<div class="py-8" data-warp-box><h1 class="text-7xl font-black leading-none tracking-tight">${TM.warpYear(`${pre}-wf${g.epoch}-${to}`, from, to)}<span class="ml-2 text-4xl font-bold">年</span></h1><span class="warpline mt-5 w-24"></span><p class="mt-5 text-3xl font-bold">${title}</p></div>`;
    /* 第 1 輪：投影上看得到全班的鎖定進度 */
    const lockProgress = () => { const n = sum.lockN || 0, c = sum.count || 0, pc = c ? Math.round(n / c * 100) : 0;
      return ui.card(`<div class="flex flex-wrap items-end justify-between gap-4"><p class="text-3xl font-bold">已鎖定</p><p class="text-6xl font-black tnum">${n}<span class="text-3xl font-bold text-ink2"> / ${c} 人</span></p></div><div class="mt-6 h-4 overflow-hidden rounded-sm bg-mist" role="progressbar" aria-valuenow="${pc}" aria-valuemin="0" aria-valuemax="100"><i class="fbar block h-full bg-brand" style="width:${pc}%"></i></div><p class="mt-6 text-2xl text-ink2">${TM.CATS.map(c => c.cat).join("・")}・現金</p>`); };
    /* 每輪揭曉：年份壓成一行，右邊是下一輪的鎖定進度，讓結論和表格都在投影第一屏 */
    const roundHead = (from, to, title, lock = true) => `<div class="flex flex-wrap items-end justify-between gap-x-8 gap-y-2 pb-6 pt-2" data-warp-box><div class="flex flex-wrap items-end gap-x-5"><h1 class="text-6xl font-black leading-none tracking-tight">${TM.warpYear(`${pre}-w${g.epoch}-${to}`, from, to)}<span class="ml-2 text-3xl font-bold">年</span></h1><p class="pb-1 text-3xl font-bold">${title}</p></div>${lock ? `<p class="pb-1 text-xl text-ink2">下一輪 ${TM.YEAR[g.round]} 年分配中・已鎖定 <b class="tnum text-ink">${sum.lockN || 0}</b> / ${sum.count || 0} 人</p>` : ""}</div>`;
    if (g.phase === "open") {
      if (done === 0) return render([{ id: "hd", key: [g.round], html: () => head(`${TM.YEAR[g.round]} 年：你會押在哪裡？`, "每人 10 萬元，分配好就鎖定") }, { id: "lk0", key: [sum.lockN, sum.count], html: lockProgress }]);
      return render([
        { id: "rh" + done, key: [g.epoch, done, sum.lockN, sum.count], html: () => roundHead(TM.YEAR[done - 1], TM.YEAR[done], `${TM.ERA_DASH[done - 1]} 揭曉`) },
        { id: "tk" + done, key: hashOf(sum.dist && sum.dist[done - 1]), html: () => takeaway(done - 1, done, false) },
        { id: "rv" + done, key: hashOf([sum.rankings && sum.rankings[done], sum.dist && sum.dist[done - 1]]), html: () => revealBlock(done - 1, done) }
      ]);
    }
    if (g.phase === "locked") return render([{ id: "hd", key: [g.round], html: () => head(`${TM.YEAR[g.round]} 年：已鎖定`, "五年後揭曉") }, { id: "dist", key: hashOf(sum.dist && sum.dist[g.round]), html: () => ui.card(`<div class="mb-8 flex flex-wrap items-baseline justify-between gap-4"><h2 class="text-4xl font-bold">全班押在哪</h2><p class="text-2xl text-ink2 tnum">${(sum.distN || {})[g.round] || 0} 人</p></div>` + (sum.dist && sum.dist[g.round] ? TM.distBar(sum.dist[g.round], TM.AKEYS, true) : `<p class="text-2xl text-ink2">統計中…</p>`)) + (TM.CATS.some(c => c.hot) ? `<p class="mt-10 text-3xl leading-snug">2006 年大家最看好的是 <b>${TM.CATS.filter(c => c.hot).map(c => c.cat).join("、")}</b>。<span class="text-ink2">五年後，看看它們表現如何。</span></p>` : "") }]);
    if (g.phase === "final") return render([
      { id: "rhf", key: [g.epoch], html: () => revealHead(TM.YEAR[3], TM.YEAR[4], "20 年後揭曉・2006 年初 → 2025 年底") },
      { id: "tk", key: hashOf(sum.dist && sum.dist[0]), html: () => takeaway(0, 4, true) },
      { id: "pod", key: hashOf(sum.rankings && sum.rankings[4]), html: podium },
      { id: "rv4", key: hashOf([sum.rankings && sum.rankings[4], sum.dist && sum.dist[0]]), html: () => revealBlock(0, 4) }
    ]);
    return render([{ id: "hd", key: [sum.pred && sum.pred.n], html: () => head("2026 → 2031，全班看好哪裡？", `${(sum.pred && sum.pred.n) || 0} 人送出`) }, { id: "pred", key: hashOf(sum.pred), html: () => ui.card(sum.pred && sum.pred.n ? `<div class="text-lg">${barsHTML(TM.PKEYS.map(k => [k, sum.pred.agg[k] || 0]).sort((a, b) => b[1] - a[1]), Math.max(...TM.PKEYS.map(k => sum.pred.agg[k] || 0)) || 1)}</div>` : `<p class="text-ink2">還沒有人送出。</p>`) }]);
    /* 結尾第一句：全班最愛 vs 實際贏家，投影最大字 */
    function takeaway(a, b, last) {
      const [l1, l2] = TM.takeaway(a, b, sum.dist && sum.dist[a]), big = last ? "text-5xl lg:text-6xl" : "text-4xl lg:text-5xl";
      return `<section class="border-y-2 border-ink ${last ? "py-10" : "py-6"}"><p class="${big} font-black leading-tight tracking-tight">${l1}${l2 ? "；" : "。"}</p>${l2 ? `<p class="mt-3 ${big} font-black leading-tight tracking-tight">${l2}。</p>` : ""}${last ? `<p class="mt-6 text-2xl text-ink2">2006 年看起來理所當然的選擇，20 年後不一定是贏家。</p>` : ""}</section>`;
    }
    /* 前三名頒獎台：第一名在中間、最高 */
    function podium() {
      const list = (sum.rankings && sum.rankings[4]) || []; if (!list.length) return "";
      const rs = TM.ranks(list), hs = { 1: "h-48", 2: "h-32" }, order = [1, 0, 2].filter(i => list[i]);
      return `<section class="py-10"><h2 class="mb-8 text-4xl font-bold">最後前三名</h2><ol class="grid grid-cols-3 items-end gap-6">${order.map(i => `<li class="min-w-0 text-center"><p class="truncate text-4xl font-black tracking-tight">${esc(list[i].n)}</p><p class="mt-2 text-2xl font-semibold tnum">${TM.wan(list[i].v)}</p><div class="mt-4 grid ${hs[rs[i]] || "h-24"} place-items-center rounded-t-lg ${rs[i] === 1 ? "bg-brand text-white" : "bg-mist text-ink"}"><span class="text-3xl font-black tnum">${TM.rankLabel(list, i)}</span></div></li>`).join("")}</ol></section>`;
    }
    /* 主角是「全班押注 vs 實際結果」，排名放旁邊 */
    function revealBlock(a, b) {
      const d = sum.dist && sum.dist[a], one = b - a === 1, list = (sum.rankings && sum.rankings[b]) || [];
      const ch = one ? TM.eraChart(`${pre}-e${b}`, a, "board") : TM.fullChart(`${pre}-full`, null, "board");
      /* 上排：揭曉（主角）＋排名（旁邊）；下排：全寬走勢圖。兩欄高度接近，投影時不會一邊空一大塊 */
      return `<div class="space-y-8"><div class="grid grid-cols-1 gap-8 xl:grid-cols-12"><div class="min-w-0 xl:col-span-8">
        ${ui.card(TM.revealTable(a, b, d, "lg"))}</div>
        <div class="min-w-0 xl:col-span-4">${ui.card(ui.head(one ? `${TM.ERA_DASH[a]} 結算排名` : "最後排名", `${list.length} 人`) + TM.leaderTable(list, null, 10, true))}</div></div>
        ${ui.card(ui.head(one ? `${TM.ERA_DASH[a]} 各公司走勢（含股利）` : "20 年走勢：2006 年初投入 10 萬", one ? "×1 代表本金不變" : "") + ch.html + `<div class="[&>div]:text-lg">${ui.legend(ch.series)}</div>`)}</div>`;
    }
  }
  store.watchDoc(pa.game, d => { const prev = S.game; S.game = d; draw(); if (prev && d && (prev.phase !== d.phase || prev.round !== d.round)) window.scrollTo(0, 0); }); store.watchDoc(pa.sum, d => { S.sum = d; draw(); });
  draw();
};
})();
