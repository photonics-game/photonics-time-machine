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
/* 各區塊只在內容改變時重畫，避免圖表動畫和輸入框被打斷 */
function sections(root) {
  let ids = "", keys = {};
  return list => {
    const nid = list.map(s => s.id).join("|");
    if (nid !== ids) { root.innerHTML = list.map(s => `<div data-sec="${s.id}"></div>`).join(""); ids = nid; keys = {}; }
    for (const s of list) {
      const k = typeof s.key === "string" ? s.key : hashOf(s.key);
      if (keys[s.id] !== k) { const el = root.querySelector(`[data-sec="${s.id}"]`); el.innerHTML = s.html(); keys[s.id] = k; TM.wireCharts(el); TM.countUp(el); }
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
  const S = { game: undefined, sum: null, players: [], err: "", confirm: "", busy: false, live: null };
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
    if (g.phase === "open") return { label: `鎖定第 ${g.round + 1} 輪`, act: "lock", hint: "背景講完、大部分人鎖定後再按。按下後：還沒鎖定的人也一起定案（沒分完的算現金），手機顯示全班押在哪。" };
    if (g.phase === "locked") { const ready = sum.frozen && sum.frozen[g.round]; return { label: g.round < 3 ? "快轉 5 年" : "快轉到 2026 年", act: "advance", hint: ready ? `這五年講完再按。按下後：手機跳到 ${g.round < 3 ? TM.YEAR[g.round + 1] + " 年，顯示走勢、成績、名次，並開放下一輪分配" : "最後結果"}。` : "統計全班配置中，請稍候…", disabled: !ready }; }
    if (g.phase === "final") return { label: "開放 2031 預測（選用）", act: "predict", hint: "時間不夠可以不按。按下後：手機出現 2031 預測。" };
    return { label: "預測進行中", act: "", hint: "全班的預測會即時更新在下面。", disabled: true };
  }
  function infoHTML() {
    const g = S.game, sum = S.sum || {}, ps = active(S.players, g);
    if (g.phase === "lobby") return joinCard() + namesCard(ps);
    if (g.phase === "open") {
      const nLock = ps.filter(p => lockedIn(p, g.round)).length;
      const ws = ps.filter(p => (p.joinedRound ?? 0) <= g.round).map(p => TM.weightsOf(TM.simulate(TM.effAllocs(p.id, sum, { ...p.allocs }, g.round), p.joinedRound ?? 0, g.round).starts[g.round]));
      return (g.done > 0 ? rankCard(g.done) : "") + ui.card(ui.head("目前的配置（即時）", `${nLock} / ${ps.length} 人已鎖定`) + TM.distBar(TM.distOf(ws)));
    }
    if (g.phase === "locked") {
      const d = sum.dist && sum.dist[g.round];
      return ui.card(ui.head(`全班的 ${TM.YEAR[g.round]} 年配置`, d ? `${(sum.distN || {})[g.round] || 0} 人` : "統計中…") + (d ? TM.distBar(d) : `<p class="text-ink2">鎖定後約 2 秒完成統計。</p>`)) + (g.done > 0 ? rankCard(g.done) : "");
    }
    if (g.phase === "final") return rankCard(4);
    const pr = sum.pred; return predCard(pr) + rankCard(4);
  }
  function rankCard(done) {
    const list = (S.sum && S.sum.rankings && S.sum.rankings[done]) || [];
    const top = list.slice(0, 3).map((p, i) => `<li class="flex items-baseline justify-between gap-3"><span><span class="tnum text-ink2">第 ${i + 1} 名</span>　<b class="text-lg">${esc(p.n)}</b></span><span class="tnum font-semibold">${TM.wan(p.v)}</span></li>`).join("");
    return ui.card(ui.head(done === 4 ? "最後排名" : `${TM.ERA_DASH[done - 1]} 結算排名`, `${list.length} 人`) + (top ? `<ol class="mb-4 space-y-1 rounded-lg bg-mist p-4">${top}</ol>` : "") + TM.leaderTable(list, null, 10));
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
    return `<ol class="flex flex-wrap items-center gap-2">${items.map(([y, t], i) => { const st = i < cur || (i === cur && g.phase === "final") ? "done" : i === cur ? "cur" : "todo";
      return `${i ? `<li aria-hidden="true" class="h-px w-4 ${i <= cur ? "bg-brand" : "bg-line"}"></li>` : ""}<li class="flex items-center gap-2"><span class="grid h-7 w-7 place-items-center rounded-full text-sm font-bold ${st === "done" ? "bg-brand text-white" : st === "cur" ? "border-2 border-brand bg-white text-brand" : "border border-line bg-white text-ink2"}">${st === "done" ? "✓" : i + 1}</span><span class="text-sm leading-tight ${st === "todo" ? "text-ink2" : "font-semibold"}">${y}<span class="block text-xs font-normal text-ink2">${t}</span></span></li>`; }).join("")}</ol>`;
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
      <div class="mt-6">${pr.act ? `<button type="button" data-run="${pr.act}" class="${ui.BTN} h-14 w-full bg-brand text-lg text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-mist disabled:text-ink2" ${pr.disabled || S.busy ? "disabled" : ""}>${S.busy ? "處理中…" : pr.label}</button>` : ""}<p class="mt-2 text-base text-ink2">${pr.hint}</p></div>
      ${S.err ? `<p class="mt-3 rounded-lg bg-mist p-3 text-base text-up">${esc(S.err)}</p>` : ""}
      <div class="mt-5 flex flex-wrap gap-3 border-t border-line pt-5">
        ${S.confirm === "undo" ? `<span class="self-center text-base">確定要回到上一步？</span>${ui.primary("確定復原", 'data-run="undo"')}${ui.secondary("取消", 'data-confirm=""')}` : ui.secondary("復原上一步", `data-confirm="undo" ${undoable ? "" : "disabled"}`)}
        ${S.confirm === "reset" ? `<span class="self-center text-base">確定重設？全班要重新加入。</span>${ui.danger("確定重設", 'data-run="reset"')}${ui.secondary("取消", 'data-confirm=""')}` : ui.secondary("重設遊戲", 'data-confirm="reset"')}
      </div>`);
    render([
      { id: "ctl", key: [g, ps.length, nLock, S.busy, S.err, S.confirm, S.sum && S.sum.frozen && S.sum.frozen[g.round] ? 1 : 0], html: ctl },
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
    unsubs.push(store.watchDoc(pa.game, d => { S.game = d; draw(); scheduleMaint(); }, fail));
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
  const S = { game: undefined, sum: null, me: undefined, cur: null, curKey: "", pdraft: zeros(TM.PKEYS), pinit: false, save: "", nameDraft: "", joinErr: "", joining: false, ask: false, locking: false, lockErr: "" };
  const render = sections(root); const unsubs = []; let saveTimer = null, pending = null;
  const meP = pa.me(uid);

  function flush() {
    if (!pending) return; const { r, val } = pending; pending = null; clearTimeout(saveTimer);
    S.save = "saving"; drawAlloc();
    store.update(meP, { [`allocs.${r}`]: val, updatedAt: Date.now() }).then(() => { S.save = pending ? "saving" : "saved"; drawAlloc(); }).catch(() => { S.save = "error"; drawAlloc(); });
  }
  function queueSave(r, val) { pending = { r, val }; S.save = "saving"; clearTimeout(saveTimer); saveTimer = setTimeout(flush, 600); }
  const joined = () => (S.me && S.me.joinedRound) ?? 0;
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
    return `<div class="flex items-center justify-between gap-3 border-b border-line pb-3"><div><p class="text-lg font-black tracking-tight">光電時光機</p><p class="text-sm text-ink2">${me ? esc(me.name) + "・" : ""}${phaseText(g)}</p></div>${opts.practice ? `<span class="rounded-md bg-mist px-2 py-0.5 text-sm">練習模式</span>` : ""}</div>`;
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
  const lobbyHTML = () => ui.card(`<p class="text-base text-ink2">已加入</p><p class="text-[32px] font-black tracking-tight">${esc(S.me.name)}</p><p class="mt-4 text-lg">等待主持人開始遊戲</p><p class="mt-1 text-base text-ink2">目前 <b class="tnum text-ink">${(S.sum && S.sum.count) || 1}</b> 人加入。開始後會直接進入 2006 年的分配畫面。</p>`);
  function topHTML() {
    const g = S.game, r = g.round, cap = capital(Math.min(r, g.done));
    const list = (S.sum && S.sum.rankings && S.sum.rankings[g.done]) || [], rk = list.findIndex(x => x.u === uid);
    return `<div class="grid grid-cols-2 gap-3">${ui.stat(g.phase === "locked" ? `${TM.YEAR[r]} 年投入` : "可用資金", TM.wan(cap), g.done > 0 ? TM.chg(cap / TM.START) + " 相對起始" : "起始資金")}${ui.stat("目前名次", rk >= 0 ? `第 ${rk + 1} 名` : "—", rk >= 0 ? `共 ${list.length} 人` : "第一輪結算後公布")}</div>`;
  }
  function resultHTML() { /* 剛結算的那一輪 */
    const g = S.game, r = g.done - 1; if (r < joined()) return "";
    const { sim } = hist(g.done), before = TM.sumH(sim.starts[r]), after = TM.sumH(sim.ends[r]);
    const list = ((S.sum || {}).rankings || {})[g.done] || [], rk = list.findIndex(x => x.u === uid);
    const ch = TM.eraChart(`${pre}-res${r}`, r, "sm");
    return ui.card(`<p class="text-base font-semibold text-ink2">${TM.ERA[r]} 結算</p>
      <p class="mt-1 text-[32px] font-black leading-tight tracking-tight tnum"><span data-count-from="${before}" data-count-to="${after}">${TM.wan(after)}</span></p>
      <p class="mt-1 text-base">${TM.chg(after / before)} 這五年${rk >= 0 ? `，第 <b class="tnum">${rk + 1}</b> 名 / ${list.length} 人` : ""}</p>
      <div class="mt-4">${ch.html}</div>${ui.legend(ch.series)}<div class="mt-4">${TM.returnsTable(r, sim.starts[r])}</div>`);
  }
  function allocHTML() {
    const g = S.game, r = g.round, t = tenthsView(), sum = TM.sumT(t), hold = isHold(), held = r > joined() ? heldNow(r) : null, heldTot = held ? TM.sumH(held) : 0, cap = held ? heldTot : capital(r);
    const saveTxt = S.save === "saving" ? "儲存中…" : S.save === "saved" ? "已儲存" : S.save === "error" ? "儲存失敗，請檢查網路後再按一次" : "";
    const rows = TM.AKEYS.map(k => { const co = TM.coOf(k), v = t[k] || 0;
      return `<div class="arow relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-b border-line py-3" data-k="${k}">
        <div class="min-w-0"><div class="flex items-center gap-2 text-base font-semibold"><i class="dot" style="--c:${TM.col(k)}"></i>${TM.META[k].cat}<span class="font-normal text-ink2">${co.name}</span></div>
        <div class="text-sm text-ink2 tnum">${hold
          ? ((held[k] || 0) > 0.5 ? `<b class="font-semibold text-ink">${TM.wan(held[k])}</b>・${((held[k] || 0) / heldTot * 100).toFixed(0)}%` : "—")
          : (v ? `<b class="font-semibold text-ink">${TM.wan(cap * v / 10)}</b>` : "—") + (held && (held[k] || 0) > 0.5 ? `<span class="ml-1">（原本 ${TM.wan(held[k])}）</span>` : "")}</div></div>
        <div class="flex items-center rounded-lg border border-line">
          <button type="button" data-act="dec" aria-label="${TM.META[k].cat} 減少 10%" class="grid h-11 w-11 place-items-center rounded-l-lg text-xl hover:bg-mist disabled:cursor-not-allowed disabled:text-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand" ${v <= 0 ? "disabled" : ""}>${TM.MINUS}</button>
          <output class="w-14 text-center text-lg font-semibold tnum">${v * 10}%</output>
          <button type="button" data-act="inc" aria-label="${TM.META[k].cat} 增加 10%" class="grid h-11 w-11 place-items-center rounded-r-lg text-xl hover:bg-mist disabled:cursor-not-allowed disabled:text-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand" ${sum >= 10 ? "disabled" : ""}>+</button></div>
        <span class="abar absolute -bottom-px left-0 h-0.5" style="width:${v * 10}%;background:${TM.col(k)}"></span></div>`; }).join("");
    const preset = (id, label, on = false) => `<button type="button" data-preset="${id}" class="inline-flex h-11 items-center rounded-lg border px-4 text-base transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${on ? "border-brand bg-brand text-white" : "border-line bg-white hover:bg-mist"}">${label}</button>`;
    const status = hold ? "目前：續抱不動，沿用上一輪的持股。" : sum === 10 ? "已分配 100%。" : `已分配 <b class="tnum">${sum * 10}%</b>，剩下 <b class="tnum">${(10 - sum) * 10}%</b>（${TM.wan(cap * (10 - sum) / 10)}）算現金。`;
    const can = hold || sum === 10;
    const lockArea = S.ask
      ? `<div class="mt-4 rounded-lg border border-brand p-4"><p class="text-base font-semibold">確定鎖定？鎖定後這一輪就不能再改。</p><div class="mt-3 flex flex-wrap gap-2">${ui.primary(S.locking ? "鎖定中…" : "確定鎖定", `data-lock="yes" ${S.locking ? "disabled" : ""}`)}${ui.secondary("再想想", `data-lock="no" ${S.locking ? "disabled" : ""}`)}</div>${S.lockErr ? `<p class="mt-2 text-base text-up">${S.lockErr}</p>` : ""}</div>`
      : `<div class="mt-4 border-t border-line pt-4"><button type="button" data-lock="ask" class="${ui.BTN} w-full bg-brand text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-mist disabled:text-ink2" ${can ? "" : "disabled"}>鎖定我的配置</button><p class="mt-2 text-base text-ink2">${can ? "鎖定後這一輪就不能再改。" : "分配到 100% 才能鎖定；不想投的部分可以放「現金」。"}</p></div>`;
    return ui.card(ui.head(r === joined() && !held ? `分配你的 ${TM.wan(capital(r))}` : `${TM.YEAR[r]} 年：要調整配置嗎？`, "每格 10%，投滿 100% 就能鎖定") + `<div class="border-t border-line">${rows}</div>
      <div class="mt-4 flex flex-wrap gap-2">${preset("even", "五家平均")}${preset("cash", "全部現金")}${preset("clear", "清空")}${held ? preset("hold", "續抱不動", hold) : ""}</div>
      <p class="mt-4 text-base">${status}</p><p class="mt-1 min-h-[1.5em] text-sm ${S.save === "error" ? "text-up" : "text-ink2"}">${saveTxt}</p>${lockArea}`);
  }
  function mineList(r) {
    const mine = r >= joined() ? (TM.simulate(TM.effAllocs(uid, S.sum, own(), r + 1), joined(), r).starts[r] || { cash: TM.START }) : { cash: TM.START }, tot = TM.sumH(mine);
    const items = TM.AKEYS.filter(k => mine[k] > 0.5).sort((a, b) => mine[b] - mine[a]);
    return { items, html: `<ul class="mt-2 divide-y divide-line border-y border-line">${items.map(k => `<li class="flex items-center gap-3 py-2.5 text-base"><i class="dot" style="--c:${TM.col(k)}"></i><span class="font-semibold">${TM.META[k].cat}</span><span class="text-ink2">${TM.coOf(k).name}</span><span class="ml-auto tnum">${TM.wan(mine[k])}</span><span class="w-12 text-right tnum text-ink2">${(mine[k] / tot * 100).toFixed(0)}%</span></li>`).join("")}</ul>` };
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
    if (d) { const topK = TM.AKEYS.slice().sort((a, b) => (d[b] || 0) - (d[a] || 0))[0], myK = items[0];
      line = `全班最多錢押在<b>${TM.META[topK].cat}</b>（${((d[topK] || 0) * 100).toFixed(0)}%）${myK ? `，你押最多的是<b>${TM.META[myK].cat}</b>` : ""}。`; }
    return ui.card(`<div class="rounded-lg bg-mist p-4"><p class="text-lg font-bold">已鎖定・${TM.YEAR[r]} 年的配置</p><p class="text-base text-ink2">五年後揭曉，先聽台上怎麼說。</p></div>
      <h2 class="mt-5 text-xl font-bold">你的配置</h2>${mineHTML}`)
      + ui.card(ui.head("全班押在哪", d ? `${(sum.distN || {})[r] || 0} 人` : "統計中…") + (d ? TM.distBar(d) + `<p class="mt-4 border-t border-line pt-3 text-base">${line}</p>` : `<p class="text-ink2">主持人鎖定後幾秒內會出現。</p>`));
  }
  function boardHTML(done) { return ui.card(ui.head("排行榜", (S.sum && S.sum.rankings && S.sum.rankings[done] ? `${S.sum.rankings[done].length} 人` : "")) + TM.leaderTable(S.sum && S.sum.rankings && S.sum.rankings[done], uid, 10)); }
  function historyHTML(done, openLatest) {
    const { sim } = hist(done); const rows = [];
    for (let r = joined(); r < done; r++) {
      const b = TM.sumH(sim.starts[r]), a = TM.sumH(sim.ends[r]); const ch = TM.eraChart(`${pre}-h${r}`, r, "sm", false);
      rows.push(`<details class="group border-b border-line py-3" ${openLatest && r === done - 1 ? "open" : ""}><summary class="flex min-h-[44px] cursor-pointer list-none flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-base"><span class="whitespace-nowrap font-semibold tnum">${TM.ERA_DASH[r]}</span><span class="whitespace-nowrap">${TM.chg(a / b)}</span><span class="w-full tnum text-ink2">${TM.wan(b)} → <b class="text-ink">${TM.wan(a)}</b></span></summary><div class="pt-3">${ch.html}${ui.legend(ch.series)}<div class="mt-3">${TM.returnsTable(r, sim.starts[r])}</div></div></details>`);
    }
    return ui.card(ui.head("你的資產變化", "點開可以看那五年的走勢") + (rows.length ? `<div class="border-t border-line">${rows.join("")}</div>` : `<p class="text-ink2">還沒有結算的輪次。</p>`));
  }
  function finalHTML() {
    const { sim } = hist(4), fin = sim.total, list = ((S.sum || {}).rankings || {})[4] || [], rk = list.findIndex(x => x.u === uid);
    if (joined() >= 4) return ui.card(`<h1 class="text-[32px] font-black tracking-tight">遊戲已結束</h1><p class="mt-2 text-ink2">你在結束後才加入，下面是最後排名。</p>`);
    const v = c => TM.START * TM.SER[c.pick][TM.CP[4]] / TM.SER[c.pick][TM.CP[joined()]];
    const tri = TM.START * TM.SER.TRI[TM.CP[4]] / TM.SER.TRI[TM.CP[joined()]], even = TM.CATS.reduce((a, c) => a + v(c) / 5, 0);
    const opts2 = [...TM.CATS.map(c => ({ l: `全押${TM.COS[c.pick].name}`, v: v(c) })), { l: "買大盤", v: tri }, { l: "五家平均，不調整", v: even }, { l: "你", v: fin, me: true }].sort((a, b) => b.v - a.v);
    const vals = TM.CP.map((_, k) => k < joined() ? null : k === joined() ? TM.START : TM.sumH(sim.ends[k - 1]));
    const ch = TM.fullChart(`${pre}-full`, vals, "sm");
    return ui.card(`<p class="text-base font-semibold text-ink2">最後結果・${TM.YEAR[joined()]} 年初 → 2025 年底</p><h1 class="mt-1 text-2xl font-black tracking-tight">你的 10 萬元變成</h1>
      <p class="mt-2 text-[48px] font-black leading-none tracking-tight tnum" data-count-from="${TM.START}" data-count-to="${fin}">${TM.wan(fin)}</p>
      <p class="mt-3 text-base">${TM.chg(fin / TM.START)}${rk >= 0 ? `，全班 ${list.length} 人中第 <b class="tnum">${rk + 1}</b> 名` : ""}</p>`)
      + ui.card(ui.head("如果當初⋯", "一次買進，之後都不動") + `<table class="w-full border-collapse text-base"><tbody>${opts2.map(o => `<tr class="border-b border-line ${o.me ? "bg-mist font-semibold" : ""}"><td class="py-2.5 pl-2">${o.l}</td><td class="py-2.5 text-right tnum">${TM.wan(o.v)}</td><td class="py-2.5 pr-2 text-right tnum text-ink2">${TM.xfmt(o.v / TM.START)}</td></tr>`).join("")}</tbody></table>`)
      + ui.card(ui.head("20 年全貌", "粗線是你") + ch.html + ui.legend(ch.series));
  }
  function predictHTML() {
    const t = S.pdraft, sum = TM.sumT(t), sent = S.me && S.me.pred && TM.sumT(S.me.pred) === 10, same = sent && hashOf(TM.cleanT(S.me.pred, TM.PKEYS)) === hashOf(TM.cleanT(t, TM.PKEYS));
    const rows = TM.PKEYS.map(k => { const v = t[k] || 0; return `<div class="arow relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-b border-line py-3" data-k="${k}"><div class="flex items-center gap-2 text-base font-semibold"><i class="dot" style="--c:${TM.col(k)}"></i>${TM.META[k].cat}<span class="font-normal text-ink2">${TM.coOf(k).name}</span></div>
      <div class="flex items-center rounded-lg border border-line"><button type="button" data-pact="dec" aria-label="${TM.META[k].cat} 減少 10%" class="grid h-11 w-11 place-items-center rounded-l-lg text-xl hover:bg-mist disabled:text-line" ${v <= 0 ? "disabled" : ""}>${TM.MINUS}</button><output class="w-14 text-center text-lg font-semibold tnum">${v * 10}%</output><button type="button" data-pact="inc" aria-label="${TM.META[k].cat} 增加 10%" class="grid h-11 w-11 place-items-center rounded-r-lg text-xl hover:bg-mist disabled:text-line" ${sum >= 10 ? "disabled" : ""}>+</button></div><span class="abar absolute -bottom-px left-0 h-0.5" style="width:${v * 10}%;background:${TM.col(k)}"></span></div>`; }).join("");
    const pr = S.sum && S.sum.pred;
    return ui.card(`<h1 class="text-2xl font-black tracking-tight">2026 → 2031，你看好哪裡？</h1><p class="mt-2 text-base text-ink2">每人重新拿 10 萬元，多了「光通訊」。送出後會加入全班的預測。</p>
      <div class="mt-4 border-t border-line">${rows}</div><div class="mt-4 flex flex-wrap items-center gap-3">${ui.primary(same ? "已送出" : sent ? "送出修改" : "送出預測", `data-submit-pred ${sum === 10 && !same ? "" : "disabled"}`)}<span class="text-base text-ink2">${sum === 10 ? "" : `已分配 ${sum * 10}%，要剛好 100% 才能送出`}</span></div>`)
      + (pr && pr.n ? ui.card(ui.head("全班的 2031 預測", `${pr.n} 人送出`) + barsHTML(TM.PKEYS.map(k => [k, pr.agg[k] || 0]).sort((a, b) => b[1] - a[1]), Math.max(...TM.PKEYS.map(k => pr.agg[k] || 0)) || 1)) : "");
  }

  function draw() {
    const g = S.game, sum = S.sum || {};
    if (g === undefined || S.me === undefined) return render([{ id: "h", key: "load", html: () => `<p class="py-10 text-center text-ink2">連線中…</p>` }]);
    if (g === null) return render([{ id: "h", key: "none", html: () => ui.card(`<h1 class="text-2xl font-bold">找不到這場遊戲</h1><p class="mt-2 text-ink2">請重新掃描台上的 QR code。</p>`) }]);
    syncCur();
    if (!S.me || S.me.epoch !== g.epoch) return render([{ id: "hd", key: [g.phase, g.round, S.me && S.me.name], html: header }, { id: "join", key: [g.phase, g.round, S.joinErr, S.joining], html: joinHTML }]);
    const done = g.done || 0, rk = hashOf(sum.rankings && sum.rankings[done]);
    const hd = { id: "hd", key: [g.phase, g.round, S.me.name], html: header };
    if (g.phase === "lobby") return render([hd, { id: "lobby", key: [sum.count], html: lobbyHTML }]);
    const fz = hashOf(sum.frozen);
    if (g.phase === "open") {
      const list = [hd, { id: "top", key: [g.round, done, rk, fz, S.cur && S.cur.val, joined()], html: topHTML }];
      if (done > 0 && done - 1 >= joined()) list.push({ id: "res" + done, key: [rk, fz], html: resultHTML });
      const sl = selfLocked();
      list.push(sl ? { id: "alloc", key: ["L", g.round, fz, S.me.allocs && S.me.allocs[g.round], sum.lockN, sum.count], html: selfLockedHTML } : { id: "alloc", key: [g.round, S.cur, S.save, fz, S.ask, S.locking, S.lockErr], html: allocHTML });
      if (done > 0) list.push({ id: "board", key: [rk], html: () => boardHTML(done) }, { id: "hist", key: [done, fz], html: () => historyHTML(done, false) });
      return render(list);
    }
    if (g.phase === "locked") {
      const list = [hd, { id: "top", key: [g.round, done, rk, fz], html: topHTML }, { id: "locked", key: [g.round, fz, hashOf(sum.dist && sum.dist[g.round]), S.cur && S.cur.val], html: lockedHTML }];
      if (done > 0) list.push({ id: "board", key: [rk], html: () => boardHTML(done) }, { id: "hist", key: [done, fz], html: () => historyHTML(done, false) });
      return render(list);
    }
    if (g.phase === "final") return render([hd, { id: "final", key: [rk, fz], html: finalHTML }, { id: "board", key: [rk], html: () => boardHTML(4) }, { id: "hist", key: [fz], html: () => historyHTML(4, false) }]);
    if (!S.pinit && S.me.pred) { S.pdraft = { ...zeros(TM.PKEYS), ...TM.cleanT(S.me.pred, TM.PKEYS) }; }
    S.pinit = true;
    return render([hd, { id: "pred", key: [S.pdraft, S.me.pred, sum.pred], html: predictHTML }, { id: "final", key: [rk, fz], html: finalHTML }, { id: "board", key: [rk], html: () => boardHTML(4) }]);
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
    if (b.hasAttribute("data-submit-pred")) { const t = TM.cleanT(S.pdraft, TM.PKEYS); store.update(meP, { pred: t, updatedAt: Date.now() }).then(draw).catch(() => {}); return; }
    if (b.dataset.pact) { const k = b.closest(".arow").dataset.k, s = TM.sumT(S.pdraft); if (b.dataset.pact === "inc" && s < 10) S.pdraft[k]++; if (b.dataset.pact === "dec" && S.pdraft[k] > 0) S.pdraft[k]--; S.pdraft = { ...S.pdraft }; return draw(); }
    if (g.phase !== "open" || !S.cur || selfLocked()) return;
    const r = S.cur.r;
    if (b.dataset.lock) {
      if (b.dataset.lock === "ask") { S.ask = true; S.lockErr = ""; return draw(); }
      if (b.dataset.lock === "no") { S.ask = false; return draw(); }
      if (S.locking) return;
      const t = tenthsView(); if (!(isHold() || TM.sumT(t) === 10)) { S.ask = false; return draw(); }
      clearTimeout(saveTimer); pending = null; S.locking = true; S.lockErr = ""; draw();
      const val = isHold() ? null : TM.cleanT(t);
      store.update(meP, { [`allocs.${r}`]: val, [`locks.${r}`]: true, updatedAt: Date.now() })
        .then(() => { S.locking = false; S.ask = false; S.save = "saved"; S.cur = { ...S.cur, val, touched: true, fresh: false }; draw(); })
        .catch(() => { S.locking = false; S.lockErr = "鎖定失敗，請檢查網路後再按一次。"; draw(); });
      return;
    }
    if (b.dataset.preset) {
      const p = b.dataset.preset; let val;
      if (p === "hold") val = null; else { val = {}; if (p === "even") TM.KEYS.forEach(k => val[k] = 2); if (p === "cash") val.cash = 10; }
      S.cur = { ...S.cur, val, touched: true, fresh: false }; queueSave(r, val); return draw();
    }
    const act = b.dataset.act; if (!act) return;
    const k = b.closest(".arow").dataset.k; const t = { ...tenthsView() }; const s = TM.sumT(t);
    if (act === "inc" && s < 10) t[k] = (t[k] || 0) + 1; if (act === "dec" && t[k] > 0) t[k]--;
    const val = TM.cleanT(t) || {}; S.cur = { ...S.cur, val, touched: true, fresh: false }; queueSave(r, val); draw();
  });
  const onErr = () => { S.save = "error"; draw(); };
  /* 主持人換階段時，把畫面捲回最上面，讓全班第一眼看到一樣的內容 */
  const toTop = () => { if (/(auto|scroll)/.test(getComputedStyle(root).overflowY)) root.scrollTo({ top: 0 }); window.scrollTo(0, 0); };
  unsubs.push(store.watchDoc(pa.game, d => {
    const prev = S.game; S.game = d;
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
    if (g.phase === "open") {
      const list = [{ id: "hd", key: [g.round, sum.lockN, sum.count], html: () => head(`${TM.YEAR[g.round]} 年：分配中`, `已鎖定 <b class="tnum text-ink">${sum.lockN || 0}</b> / ${sum.count || 0} 人`) }];
      if (done > 0) list.push({ id: "rk" + done, key: hashOf(sum.rankings && sum.rankings[done]), html: () => rankBlock(done) });
      return render(list);
    }
    if (g.phase === "locked") return render([{ id: "hd", key: [g.round], html: () => head(`${TM.YEAR[g.round]} 年：已鎖定`, "五年後揭曉") }, { id: "dist", key: hashOf(sum.dist && sum.dist[g.round]), html: () => ui.card(ui.head("全班押在哪", `${(sum.distN || {})[g.round] || 0} 人`) + (sum.dist && sum.dist[g.round] ? `<div class="text-lg">${TM.distBar(sum.dist[g.round])}</div>` : `<p class="text-ink2">統計中…</p>`)) }]);
    if (g.phase === "final") return render([{ id: "hd", key: "f", html: () => head("20 年後，最後排名", "2006 年初 → 2025 年底") }, { id: "rk4", key: hashOf(sum.rankings && sum.rankings[4]), html: () => rankBlock(4) }]);
    return render([{ id: "hd", key: [sum.pred && sum.pred.n], html: () => head("2026 → 2031，全班看好哪裡？", `${(sum.pred && sum.pred.n) || 0} 人送出`) }, { id: "pred", key: hashOf(sum.pred), html: () => ui.card(sum.pred && sum.pred.n ? `<div class="text-lg">${barsHTML(TM.PKEYS.map(k => [k, sum.pred.agg[k] || 0]).sort((a, b) => b[1] - a[1]), Math.max(...TM.PKEYS.map(k => sum.pred.agg[k] || 0)) || 1)}</div>` : `<p class="text-ink2">還沒有人送出。</p>`) }]);
    function rankBlock(d) {
      const list = (sum.rankings && sum.rankings[d]) || []; const ch = d < 5 ? TM.eraChart(`${pre}-e${d}`, d - 1, "lg") : null;
      return `<div class="grid grid-cols-1 gap-8 lg:grid-cols-12"><div class="lg:col-span-5">${ui.card(ui.head(d === 4 ? "最後排名" : `${TM.ERA_DASH[d - 1]} 結算排名`, `${list.length} 人`) + TM.leaderTable(list, null, 10))}</div><div class="min-w-0 lg:col-span-7">${ui.card(ui.head(`${TM.ERA_DASH[d - 1]} 各公司漲跌（含股利）`, "×1 代表本金不變；對數刻度") + ch.html + ui.legend(ch.series))}</div></div>`;
    }
  }
  store.watchDoc(pa.game, d => { const prev = S.game; S.game = d; draw(); if (prev && d && (prev.phase !== d.phase || prev.round !== d.round)) window.scrollTo(0, 0); }); store.watchDoc(pa.sum, d => { S.sum = d; draw(); });
  draw();
};
})();
