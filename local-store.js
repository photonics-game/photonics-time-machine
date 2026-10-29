/* 光電時光機：練習模式用的本機資料庫與模擬同學（不需要網路）。 */
(function () {
const TM = window.TM;
const wait = ms => new Promise(r => setTimeout(r, ms));
const clone = v => v == null ? null : JSON.parse(JSON.stringify(v));
const parentOf = p => p.split("/").slice(0, -1).join("/");
function deepMerge(t, s) {
  for (const k in s) {
    const v = s[k];
    if (v && typeof v === "object" && !Array.isArray(v) && t[k] && typeof t[k] === "object" && !Array.isArray(t[k])) t[k] = deepMerge({ ...t[k] }, v);
    else if (v !== undefined) t[k] = clone(v);
  }
  return t;
}
TM.LocalDB = class {
  constructor() { this.docs = new Map(); this.subs = new Set(); }
  write(p, d) { this.docs.set(p, d); const par = parentOf(p); for (const s of this.subs) if ((s.type === "doc" && s.path === p) || (s.type === "col" && s.path === par)) s.fire(); }
};
TM.createLocalStore = (db, uid, latency = 40) => ({
  uid, kind: "local",
  get: async p => { await wait(latency); return clone(db.docs.get(p) ?? null); },
  set: async (p, d, merge) => { await wait(latency); const cur = db.docs.get(p); db.write(p, merge && cur ? deepMerge(clone(cur), d) : clone(d)); },
  update: async (p, patch) => {
    await wait(latency); const cur = db.docs.get(p); if (!cur) throw new Error("文件不存在");
    const next = clone(cur);
    for (const [k, v] of Object.entries(patch)) { const parts = k.split("."); let o = next; for (let i = 0; i < parts.length - 1; i++) { if (!o[parts[i]] || typeof o[parts[i]] !== "object") o[parts[i]] = {}; o = o[parts[i]]; } o[parts[parts.length - 1]] = clone(v); }
    db.write(p, next);
  },
  watchDoc: (p, cb) => { let t; const s = { type: "doc", path: p, fire: () => { clearTimeout(t); t = setTimeout(() => cb(clone(db.docs.get(p) ?? null)), latency / 2); } }; db.subs.add(s); s.fire(); return () => db.subs.delete(s); },
  watchCol: (p, cb) => { let t; const s = { type: "col", path: p, fire: () => { clearTimeout(t); t = setTimeout(() => { const out = []; for (const [k, v] of db.docs) if (parentOf(k) === p) out.push({ id: k.split("/").pop(), ...clone(v) }); cb(out); }, latency / 2); } }; db.subs.add(s); s.fire(); return () => db.subs.delete(s); }
});

/* 模擬同學：平均派、專情派、追高派、抄底派、保守派、隨機派 */
TM.startBots = (db, gid, n = 35, speed = 1) => {
  const pa = TM.paths(gid), rnd = Math.random;
  const tags = ["平均派", "專情派", "追高派", "抄底派", "保守派", "隨機派"];
  const bots = Array.from({ length: n }, (_, i) => {
    const a = TM.KEYS[Math.floor(rnd() * 5)]; let b; do { b = TM.KEYS[Math.floor(rnd() * 5)]; } while (b === a);
    return { store: TM.createLocalStore(db, "bot" + (i + 1), 30), name: `模擬同學 ${i + 1}`, tag: tags[i % tags.length], fav: TM.KEYS[Math.floor(rnd() * 5)], pair: [a, b], epoch: 0, joined: false, jr: 0, acted: {} };
  });
  const decide = (b, r) => {
    const prev = r > 0 ? TM.KEYS.map(k => [k, TM.mult(k, r - 1)]).sort((x, y) => y[1] - x[1]) : null;
    if (b.tag === "平均派") return Object.fromEntries(TM.KEYS.map(k => [k, 2]));
    if (b.tag === "專情派") return r === b.jr ? { [b.fav]: 10 } : null;
    if (b.tag === "追高派") return r === b.jr || !prev ? { [b.fav]: 10 } : { [prev[0][0]]: 10 };
    if (b.tag === "抄底派") return r === b.jr || !prev ? { [b.fav]: 10 } : { [prev[prev.length - 1][0]]: 10 };
    if (b.tag === "保守派") return { cash: 5, [b.pair[0]]: 3, [b.pair[1]]: 2 };
    const w = {}; for (let i = 0; i < 10; i++) { let k; do { k = TM.AKEYS[Math.floor(rnd() * 6)]; } while (k === "cash" && rnd() > .5); w[k] = (w[k] || 0) + 1; } return w;
  };
  const predict = () => { const bias = { opt: .5, fab: .38, panel: .18, lens: .14, led: .14, solar: .1, cash: .12 }, ks = Object.keys(bias), w = {}; for (let i = 0; i < 10; i++) { let k; do { k = ks[Math.floor(rnd() * ks.length)]; } while (rnd() > bias[k] * 1.6); w[k] = (w[k] || 0) + 1; } return w; };
  let game = null;
  const later = (ms, fn) => setTimeout(fn, ms / speed);
  function tick() {
    const g = game; if (!g) return;
    for (const b of bots) {
      if (b.epoch !== g.epoch) {
        b.epoch = g.epoch; b.joined = false; b.acted = {};
        later(800 + rnd() * 9000, () => {
          const gg = game; if (!gg || gg.epoch !== b.epoch) return;
          b.jr = gg.phase === "lobby" ? 0 : gg.phase === "open" || gg.phase === "locked" ? gg.round : TM.ROUNDS;
          b.store.set(pa.me(b.store.uid), { name: b.name, epoch: gg.epoch, joinedRound: b.jr, joinedAt: Date.now(), allocs: {}, pred: null, updatedAt: Date.now() }).then(() => { b.joined = true; tick(); });
        });
        continue;
      }
      if (!b.joined) continue;
      const key = `${g.epoch}-${g.round}`;
      if (g.phase === "open" && g.round >= b.jr && !b.acted[key]) {
        b.acted[key] = true; const r = g.round;
        later(1500 + rnd() * 9000, () => { const gg = game; if (!gg || gg.phase !== "open" || gg.round !== r || gg.epoch !== b.epoch) { b.acted[key] = false; return; } const val = decide(b, r); if (val === null && r === b.jr) return; b.store.update(pa.me(b.store.uid), { [`allocs.${r}`]: val, ...(rnd() < 0.8 ? { [`locks.${r}`]: true } : {}), updatedAt: Date.now() }); });
      }
      if (g.phase === "predict" && !b.acted["pred" + g.epoch]) {
        b.acted["pred" + g.epoch] = true;
        later(1000 + rnd() * 8000, () => { if (game && game.phase === "predict") b.store.update(pa.me(b.store.uid), { pred: predict(), updatedAt: Date.now() }); });
      }
    }
  }
  bots[0].store.watchDoc(pa.game, g => { game = g; tick(); });
  return bots;
};
})();
