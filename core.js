/* 光電時光機：共用核心（公司設定、報酬計算、圖表、介面元件）。需先載入 data.js。 */
(function () {
const TM = window.TM = window.TM || {};

/* ===== 公司設定：要換公司，改 pick 並在 data.js 補上該公司資料 ===== */
TM.COS = {
  "2448": { name: "晶電",   ticker: "2448", note: "2021 年起換成富采" },
  "6244": { name: "茂迪",   ticker: "6244" },
  "2409": { name: "友達",   ticker: "2409" },
  "3008": { name: "大立光", ticker: "3008" },
  "2330": { name: "台積電", ticker: "2330" }
};
TM.CATS = [
  /* hot：2006 年當時的主流熱門產業（揭曉時會拿來對照） */
  { key: "led",   cat: "LED",     c: "--s-led",   pick: "2448", hot: true },
  { key: "solar", cat: "太陽能",   c: "--s-solar", pick: "6244", hot: true },
  { key: "panel", cat: "面板",     c: "--s-panel", pick: "2409", hot: true },
  { key: "lens",  cat: "手機鏡頭", c: "--s-lens",  pick: "3008" },
  { key: "fab",   cat: "晶圓代工", c: "--s-fab",   pick: "2330" }
];
TM.CASH = { key: "cash", cat: "現金",   c: "--s-cash", name: "年利 1%", ticker: "" };
TM.OPT  = { key: "opt",  cat: "光通訊", c: "--s-opt",  name: "矽光子、CPO", ticker: "" };

TM.N = 251; TM.CP = [0, 60, 120, 180, 240]; /* 2005/12、2010/12、2015/12、2020/12、2025/12 的月底收盤 */ TM.ROUNDS = 4; TM.START = 100000;
TM.YEAR = [2006, 2011, 2016, 2021, 2026];
TM.CP_FULL = ["2006 年 1 月", "2011 年 1 月", "2016 年 1 月", "2021 年 1 月", "2026 年 1 月"];
TM.ERA = ["2006 → 2010", "2011 → 2015", "2016 → 2020", "2021 → 2025"];
TM.ERA_DASH = ["2006–2010", "2011–2015", "2016–2020", "2021–2025"];
TM.YEARS = [5, 5, 5, 5];
TM.KEYS = TM.CATS.map(c => c.key);
TM.AKEYS = [...TM.KEYS, "cash"];
TM.PKEYS = [...TM.KEYS, "opt", "cash"];
TM.META = Object.fromEntries([...TM.CATS, TM.CASH, TM.OPT].map(c => [c.key, c]));
TM.coOf = k => TM.META[k].pick ? TM.COS[TM.META[k].pick] : TM.META[k];
TM.col = k => `var(${TM.META[k].c})`;

TM.SER = {};
for (const [id, str] of Object.entries(TM.RAW)) {
  const parts = str.split(","); let last = null; const out = new Array(TM.N).fill(null);
  for (let i = 0; i < TM.N; i++) { const p = parts[i]; if (p === undefined || p === "") continue; const v = +p; if (v < 0) out[i] = last; else { out[i] = v; last = v; } }
  TM.SER[id] = out;
}
TM.mult = (k, r) => { if (k === "cash") return Math.pow(1.01, TM.YEARS[r]); const s = TM.SER[TM.META[k].pick]; return s[TM.CP[r + 1]] / s[TM.CP[r]]; };
TM.triMult = r => TM.SER.TRI[TM.CP[r + 1]] / TM.SER.TRI[TM.CP[r]];
TM.monthLabel = i => { const t = 2005 * 12 + 11 + i; return `${Math.floor(t / 12)} 年 ${t % 12 + 1} 月`; };
TM.yearOf = i => Math.floor((2005 * 12 + 11 + i) / 12);

/* ===== 格式 ===== */
const MINUS = "−"; TM.MINUS = MINUS;
TM.esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
TM.wan = x => x >= 1e4 ? `${(Math.round(x / 1e3) / 10).toLocaleString("zh-TW", { minimumFractionDigits: 0, maximumFractionDigits: 1 })} 萬` : `${Math.round(x).toLocaleString("zh-TW")} 元`;
TM.pct = m => { const p = (m - 1) * 100, a = Math.abs(p); const s = a >= 100 ? Math.round(a).toLocaleString("zh-TW") : a.toFixed(a < 10 ? 1 : 0); return (p >= 0 ? "+" : MINUS) + s + "%"; };
TM.chg = m => `<span class="${m >= 1 ? "tm-up" : "tm-down"} font-semibold tnum whitespace-nowrap">${m >= 1 ? "▲" : "▼"} ${TM.pct(m)}</span>`;
TM.xfmt = m => "×" + (m >= 10 ? m.toFixed(0) : m.toFixed(2));
/* 個人成績：和產業一樣用 ×，括號附上漲跌 % */
TM.chgX = m => `<span class="${m >= 1 ? "tm-up" : "tm-down"} font-semibold tnum whitespace-nowrap">${TM.xfmt(m)}（${m >= 1 ? "▲" : "▼"} ${TM.pct(m)}）</span>`;

/* ===== 計算 ===== */
TM.sumT = t => t ? Object.values(t).reduce((a, b) => a + (+b || 0), 0) : 0;
TM.cleanT = (t, keys = TM.AKEYS) => {
  if (!t || typeof t !== "object") return null;
  const o = {}; let s = 0;
  for (const k of keys) { const v = Math.max(0, Math.min(10, Math.round(+t[k] || 0))); if (v) { o[k] = v; s += v; } }
  return s > 10 ? null : o;
};
const sumH = h => { let s = 0; for (const k in h) s += h[k]; return s; };
TM.sumH = sumH;
TM.weightsOf = h => { const t = sumH(h) || 1, w = {}; for (const k in h) w[k] = h[k] / t; return w; };
/* allocs：{輪次: 配置(每格 1 = 10%) | null(續抱)}；joined：加入的輪次；done：已結算輪數 */
TM.simulate = (allocs, joined, done) => {
  const starts = {}, ends = {}; let hold = null;
  for (let r = joined; r < TM.ROUNDS; r++) {
    const t = hold ? sumH(hold) : TM.START;
    const a = allocs && allocs[r] != null ? TM.cleanT(allocs[r]) : null;
    if (a) { hold = {}; let s = 0; for (const k in a) { hold[k] = t * a[k] / 10; s += a[k]; } if (s < 10) hold.cash = (hold.cash || 0) + t * (10 - s) / 10; }
    else if (!hold) hold = { cash: t };
    starts[r] = { ...hold };
    if (r >= done) break;
    for (const k in hold) hold[k] *= TM.mult(k, r);
    ends[r] = { ...hold };
  }
  return { starts, ends, total: hold ? sumH(hold) : TM.START };
};
/* 已結算或已鎖定的輪次以主持人凍結的配置為準 */
TM.effAllocs = (uid, summary, own, upto) => {
  const out = {}; const fr = (summary && summary.frozen) || {};
  for (let r = 0; r < TM.ROUNDS; r++) {
    if (r < upto && fr[r]) out[r] = Object.prototype.hasOwnProperty.call(fr[r], uid) ? fr[r][uid] : null;
    else if (own && own[r] !== undefined) out[r] = own[r];
  }
  return out;
};
/* 第 a 輪開始到第 b 輪開始之間的倍數（可跨多輪） */
TM.spanMult = (k, a, b) => { let m = 1; for (let r = a; r < b; r++) m *= TM.mult(k, r); return m; };
/* 名次：同分同名次（1、1、1、4…） */
TM.ranks = list => { const out = []; list.forEach((p, i) => { out[i] = i > 0 && p.v === list[i - 1].v ? out[i - 1] : i + 1; }); return out; };
TM.rankLabel = (list, i) => { const rs = TM.ranks(list), n = rs[i], tie = list.some((p, j) => j !== i && rs[j] === n); return `${tie ? "並列" : ""}第 ${n} 名`; };
TM.distOf = list => { const agg = Object.fromEntries(TM.AKEYS.map(k => [k, 0])); if (!list.length) return agg; for (const w of list) for (const k in w) if (k in agg) agg[k] += w[k] / list.length; return agg; };

/* ===== 樣式（圖表、色票） ===== */
TM.injectCSS = () => {
  if (document.getElementById("tm-css")) return;
  const s = document.createElement("style"); s.id = "tm-css";
  s.textContent = `
:root{color-scheme:light;--paper:#F7F5F0;--line:#E2DFD7;--mist:#EAE6DF;--ink:#1C1D1B;--ink2:#64635E;--brand:#283D32;--accent:#9C6B43;--up:#B0503A;--down:#2F5D46;
/* 產業色刻意避開紅、綠：紅綠只留給漲跌 */
--s-led:#13808F;--s-solar:#A8740C;--s-panel:#3A5BA0;--s-lens:#7650A8;--s-fab:#B03A82;--s-cash:#BDB8AD;--s-opt:#1C1D1B}
html,body{background:var(--paper);color:var(--ink)}
::selection{background:#D5DDD7;color:var(--ink)}
input{caret-color:var(--brand)}
input::placeholder{color:var(--ink2);opacity:1}
body{font-family:Inter,"Noto Sans TC","PingFang TC","Microsoft JhengHei",system-ui,sans-serif;font-size:16px;line-height:1.7;margin:0}
.gutter{padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
@media (min-width:1024px){.gutter{padding-left:max(32px,env(safe-area-inset-left,0px));padding-right:max(32px,env(safe-area-inset-right,0px))}}
h1,h2,h3{line-height:1.25;text-wrap:balance}
.tnum{font-variant-numeric:tabular-nums}
.tm-up{color:var(--up)}.tm-down{color:var(--down)}
.dot{display:inline-block;width:10px;height:10px;border-radius:9999px;background:var(--c);flex:none}
.abar,.stack i,.fbar i{transition:width .25s ease-out}
.chart{position:relative;width:100%}
.chart svg{display:block;width:100%;height:auto;overflow:visible}
.chart .gl{stroke:var(--line);stroke-width:1}
.chart .ref{stroke:#BDB8AD;stroke-width:1.25}
.chart .tk{fill:var(--ink2);font-size:12px;font-variant-numeric:tabular-nums}
.chart.sm .tk,.chart.sm .el{font-size:12px}
.chart.big .tk,.chart.big .el{font-size:17px}
.chart .el{fill:var(--ink2);font-size:12px}
.chart .el tspan.v{fill:var(--ink);font-weight:600;font-variant-numeric:tabular-nums}
.chart path.ln{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round;transition:opacity .2s ease,stroke-width .2s ease}
.chart path.ln.thick{stroke-width:3}
.chart .lab,.chart circle.pt{transition:opacity .2s ease}
.chart.hl path.ln,.chart.hl .lab,.chart.hl circle.pt{opacity:.18}
.chart.hl path.ln.on,.chart.hl .lab.on,.chart.hl circle.pt.on{opacity:1}
.chart.hl path.ln.on{stroke-width:3.5}
.chart path.draw{stroke-dasharray:1;stroke-dashoffset:1;animation:tmdraw 1.4s ease-out forwards}
@keyframes tmdraw{to{stroke-dashoffset:0}}
.chart path.ln.mute{opacity:.28}
.chart .lab.mute line{opacity:.4}
.chart .lab.mute tspan.v{fill:var(--ink2);font-weight:400}
.chart.hl path.ln.mute.on,.chart.hl .lab.mute.on,.chart.hl .lab.mute.on line{opacity:1}
.warp{display:inline-block;will-change:filter,transform}
.warp.go{animation:tmwarp 1.3s cubic-bezier(.16,1,.3,1) both}
@keyframes tmwarp{0%{filter:blur(6px);transform:translateY(-.12em);opacity:.55}100%{filter:blur(0);transform:none;opacity:1}}
.warpline{display:block;height:2px;background:var(--brand);transform-origin:left;transform:scaleX(1)}
.warpline.go{animation:tmline 1.3s cubic-bezier(.16,1,.3,1) both}
@keyframes tmline{from{transform:scaleX(0)}to{transform:scaleX(1)}}
.chart .xhair{stroke:var(--ink2);stroke-width:1;stroke-dasharray:3 3;visibility:hidden}
.chart.hovering .xhair{visibility:visible}
.chart .tip{position:absolute;top:6px;pointer-events:none;background:#fff;border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:13px;line-height:1.6;min-width:150px;z-index:5;box-shadow:0 1px 2px rgba(28,29,27,.06)}
.chart .tip .t{font-weight:700;margin-bottom:2px;font-variant-numeric:tabular-nums}
.chart .tip .r{display:flex;align-items:center;justify-content:space-between;gap:12px}
.chart .tip .r span:first-child{display:flex;align-items:center;gap:6px;color:var(--ink2)}
.chart .tip .r.on span:first-child{color:var(--ink);font-weight:600}
.chart .tip .r .v{font-variant-numeric:tabular-nums;font-weight:600}
@media (prefers-reduced-motion:reduce){.chart path.draw{animation:none;stroke-dashoffset:0}.abar,.stack i,.fbar i,.chart path.ln{transition:none}.warp.go,.warpline.go{animation:none}}`;
  document.head.appendChild(s);
};
TM.RM = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ===== 折線圖（手寫 SVG） ===== */
TM.CHARTS = new Map();
TM.lineChart = (id, cfg) => {
  const W = cfg.w || 720, H = cfg.h || 380, m = { l: cfg.l || 58, r: cfg.r || 124, t: 12, b: 30 }, pw = W - m.l - m.r, ph = H - m.t - m.b, n = cfg.n;
  let lo = Infinity, hi = -Infinity;
  for (const s of cfg.series) for (const v of s.values) if (v != null && v > 0) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  lo /= 1.12; hi *= 1.12;
  const L = Math.log, y = v => m.t + ph * (1 - (L(v) - L(lo)) / (L(hi) - L(lo))), x = i => m.l + pw * (i / (n - 1));
  const kept = []; for (const t of cfg.ticks.filter(t => t >= lo && t <= hi)) if (!kept.length || y(kept[kept.length - 1]) - y(t) >= (cfg.gap || 26)) kept.push(t);
  let g = ""; for (const t of kept) g += `<line class="${t === cfg.ref ? "ref" : "gl"}" x1="${m.l}" x2="${W - m.r}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/><text class="tk" x="${m.l - 8}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end">${cfg.tickFmt(t)}</text>`;
  for (const xt of cfg.xticks) g += `<text class="tk" x="${x(xt.i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${xt.label}</text>`;
  let paths = ""; const labels = [], anim = cfg.animate && !TM.RM, step = cfg.labelStep || 16;
  cfg.series.forEach((s, si) => {
    let d = "", pen = false, lastI = -1;
    s.values.forEach((v, i) => { if (v == null || v <= 0) { if (!s.connect) pen = false; return; } d += (pen ? "L" : "M") + x(i).toFixed(1) + "," + y(v).toFixed(1); pen = true; lastI = i; });
    paths += `<path data-s="${si}" class="ln${s.thick ? " thick" : ""}${s.mute ? " mute" : ""}${anim && !s.dash ? " draw" : ""}" ${anim && !s.dash ? 'pathLength="1"' : ""} d="${d}" style="stroke:${s.color}${s.dash ? ";stroke-dasharray:6 4" : ""}"/>`;
    if (s.dots) s.values.forEach((v, i) => { if (v != null && v > 0) paths += `<circle data-s="${si}" class="pt" cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="4" style="fill:${s.color};stroke:#fff;stroke-width:2"/>`; });
    if (lastI >= 0) labels.push({ si, y: y(s.values[lastI]), text: s.label, val: cfg.endFmt(s.values[lastI]), color: s.color, dash: s.dash, mute: s.mute });
  });
  labels.sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < step) labels[i].y = labels[i - 1].y + step;
  const over = labels.length ? labels[labels.length - 1].y - (H - m.b) : 0; if (over > 0) labels.forEach(l => l.y -= over);
  let lab = ""; for (const l of labels) lab += `<g class="lab${l.mute ? " mute" : ""}" data-s="${l.si}"><line x1="${W - m.r + 6}" x2="${W - m.r + 16}" y1="${(l.y - 1).toFixed(1)}" y2="${(l.y - 1).toFixed(1)}" style="stroke:${l.color};stroke-width:2.5${l.dash ? ";stroke-dasharray:4 2" : ""}"/><text class="el" x="${W - m.r + 21}" y="${(l.y + 3.5).toFixed(1)}">${l.text} <tspan class="v">${l.val}</tspan></text></g>`;
  TM.CHARTS.set(id, { cfg, x, y, m, W, n, pw });
  return `<div class="chart${W < 500 ? " sm" : ""}${cfg.big ? " big" : ""}" id="${id}"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${cfg.aria}">${g}${paths}<line class="xhair" y1="${m.t}" y2="${H - m.b}" x1="-10" x2="-10"/><rect x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="transparent"/>${lab}</svg><div class="tip" hidden></div></div>`;
};
TM.wireCharts = (root) => {
  for (const [id, c] of TM.CHARTS) {
    const el = root.querySelector("#" + id); if (!el || el.dataset.wired) continue; el.dataset.wired = 1;
    const svg = el.querySelector("svg"), hair = el.querySelector(".xhair"), tip = el.querySelector(".tip");
    const setHL = si => { el.classList.toggle("hl", si != null); el.querySelectorAll("[data-s]").forEach(n => n.classList.toggle("on", si != null && +n.dataset.s === si)); };
    const move = ev => {
      if (ev.target.closest(".lab")) return;
      const r = svg.getBoundingClientRect(), sx = (ev.clientX - r.left) * c.W / r.width, sy = (ev.clientY - r.top) * c.W / r.width;
      let i = Math.round((sx - c.m.l) / c.pw * (c.n - 1)); i = Math.max(0, Math.min(c.n - 1, i));
      const rows = c.cfg.series.map((s, si) => ({ s, si, v: s.values[i] })).filter(o => o.v != null && o.v > 0);
      if (!rows.length) { tip.hidden = true; setHL(null); return; }
      let near = rows[0]; for (const o of rows) if (Math.abs(c.y(o.v) - sy) < Math.abs(c.y(near.v) - sy)) near = o;
      setHL(near.si); hair.setAttribute("x1", c.x(i)); hair.setAttribute("x2", c.x(i));
      rows.sort((a, b) => b.v - a.v);
      tip.innerHTML = `<div class="t">${c.cfg.tipTitle(i)}</div>` + rows.map(o => `<div class="r${o.si === near.si ? " on" : ""}"><span><i class="dot" style="--c:${o.s.color}"></i>${o.s.label}</span><span class="v">${c.cfg.tipFmt(o.v)}</span></div>`).join("");
      tip.hidden = false; el.classList.add("hovering");
      const px = c.x(i) / c.W * r.width, tw = tip.offsetWidth; tip.style.left = Math.max(0, (px + 14 + tw > r.width ? px - 14 - tw : px + 14)) + "px";
    };
    svg.addEventListener("pointermove", move); svg.addEventListener("pointerdown", move);
    svg.addEventListener("pointerleave", () => { tip.hidden = true; el.classList.remove("hovering"); setHL(null); });
    el.querySelectorAll(".lab").forEach(gr => { gr.addEventListener("pointerenter", () => { tip.hidden = true; el.classList.remove("hovering"); setHL(+gr.dataset.s); }); gr.addEventListener("pointerleave", () => setHL(null)); });
  }
};
const MULT_TICKS = [0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.7, 1, 1.5, 2, 3, 4, 5, 7, 10, 15, 20];
const MONEY_TICKS = [1e3, 3e3, 1e4, 3e4, 1e5, 3e5, 1e6, 3e6, 1e7, 3e7];
const SIZES = { sm: { w: 340, h: 250, l: 40, r: 100, gap: 22, labelStep: 15 }, lg: { w: 720, h: 380 }, board: { w: 760, h: 420, l: 76, r: 190, gap: 34, labelStep: 22, big: true } };
/* 小圖只突顯最好和最差的兩條，其他淡化（點圖例或線條仍可看） */
const muteMiddle = list => { const end = s => { for (let i = s.values.length - 1; i >= 0; i--) if (s.values[i] != null) return s.values[i]; return 1; };
  const sorted = list.slice().sort((x, y) => end(y) - end(x)); sorted.slice(1, -1).forEach(s => { s.mute = true; }); };
TM.eraChart = (id, r, size = "lg", animate = true) => {
  const a = TM.CP[r], b = TM.CP[r + 1], n = b - a + 1;
  const series = TM.CATS.map(c => { const s = TM.SER[c.pick], v0 = s[a]; return { label: TM.COS[c.pick].name, color: TM.col(c.key), values: Array.from({ length: n }, (_, i) => s[a + i] == null ? null : s[a + i] / v0) }; });
  series.push({ label: "大盤", color: "var(--ink2)", dash: true, values: Array.from({ length: n }, (_, i) => TM.SER.TRI[a + i] / TM.SER.TRI[a]) });
  if (size === "sm") muteMiddle(series.slice(0, TM.CATS.length));
  const xt = []; for (let i = 0; i < n; i += (size === "sm" ? 24 : 12)) xt.push({ i, label: String(TM.yearOf(a + i + 1)) });
  return { series, html: TM.lineChart(id, { ...SIZES[size], n, series, ticks: MULT_TICKS, ref: 1, tickFmt: TM.xfmt, endFmt: TM.xfmt, xticks: xt, animate, tipTitle: i => TM.monthLabel(a + i), tipFmt: TM.xfmt, aria: `${TM.ERA[r]} 各公司含息報酬倍數` }) };
};
TM.fullChart = (id, youVals, size = "lg") => {
  const end = TM.CP[TM.ROUNDS], n = end + 1, cut = s => s.slice(0, n);
  const series = TM.CATS.map(c => { const s = TM.SER[c.pick]; return { label: TM.COS[c.pick].name, color: TM.col(c.key), values: cut(s).map(v => v == null ? null : TM.START * v / s[0]) }; });
  series.push({ label: "大盤", color: "var(--ink2)", dash: true, values: cut(TM.SER.TRI).map(v => TM.START * v / TM.SER.TRI[0]) });
  if (size === "sm") muteMiddle(series.slice(0, TM.CATS.length));
  if (youVals) { const you = new Array(n).fill(null); TM.CP.forEach((ix, k) => { if (youVals[k] != null) you[ix] = youVals[k]; }); series.push({ label: "你", color: "var(--ink)", thick: true, connect: true, dots: true, values: you }); }
  const xt = (size === "sm" ? [0, 120, 240] : [0, 60, 120, 180, 240]).map(i => ({ i, label: String(TM.yearOf(i + 1)) }));
  const sz = size === "sm" ? { ...SIZES.sm, r: 104, h: 300, labelStep: 17 } : size === "board" ? { ...SIZES.board, r: 220 } : { ...SIZES.lg, r: 136, h: 400 };
  return { series, html: TM.lineChart(id, { ...sz, n: end + 1, series, ticks: MONEY_TICKS, ref: 1e5, tickFmt: t => t >= 1e4 ? `${t / 1e4} 萬` : `${t / 1e3} 千`, endFmt: TM.wan, xticks: xt, animate: true, tipTitle: TM.monthLabel, tipFmt: TM.wan, aria: "2006 年初投入 10 萬元到 2025 年底的價值" }) };
};

/* ===== 介面元件（Tailwind） ===== */
const BTN = "inline-flex h-12 min-w-[44px] items-center justify-center gap-2 rounded-lg px-6 text-base font-semibold transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
TM.ui = {
  BTN,
  card: (inner, cls = "") => `<div class="rounded-lg border border-line bg-white p-5 sm:p-6 ${cls}">${inner}</div>`,
  head: (title, note = "") => `<div class="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"><h2 class="text-xl font-bold">${title}</h2>${note ? `<p class="text-sm text-ink2">${note}</p>` : ""}</div>`,
  primary: (label, attrs = "") => `<button type="button" class="${BTN} bg-brand text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-mist disabled:text-ink2" ${attrs}>${label}</button>`,
  secondary: (label, attrs = "") => `<button type="button" class="${BTN} border border-line bg-white text-ink hover:bg-mist disabled:cursor-not-allowed disabled:border-mist disabled:bg-paper disabled:text-[#A8A399] disabled:hover:bg-paper" ${attrs}>${label}</button>`,
  danger: (label, attrs = "") => `<button type="button" class="${BTN} border border-up bg-white text-up hover:bg-mist" ${attrs}>${label}</button>`,
  stat: (label, value, sub = "") => `<div class="rounded-lg border border-line bg-white p-4 sm:p-5"><div class="text-sm text-ink2">${label}</div><div class="mt-1 text-[32px] font-bold leading-tight tracking-tight tnum sm:text-[36px]">${value}</div>${sub ? `<div class="mt-1 text-sm text-ink2">${sub}</div>` : ""}</div>`,
  chip: k => `<span class="inline-flex items-center gap-1.5 whitespace-nowrap"><i class="dot" style="--c:${TM.col(k)}"></i>${TM.META[k].cat}</span>`,
  legend: series => `<div class="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-ink2">${series.map(s => `<span class="inline-flex items-center gap-2 whitespace-nowrap${s.mute ? "" : " font-semibold text-ink"}">${s.dash ? `<span class="inline-block w-5 border-t-2 border-dashed" style="border-color:${s.color}"></span>` : `<span class="inline-block w-5 rounded" style="background:${s.color};height:${s.thick ? 3 : 2}px;${s.mute ? "opacity:.4" : ""}"></span>`}${s.label}</span>`).join("")}</div>`
};
/* 一輪的成績表（五家公司＋現金＋大盤） */
TM.returnsTable = (r, invested) => {
  const rows = [...TM.CATS.map(c => ({ k: c.key, label: TM.COS[c.pick].name, sub: c.cat, m: TM.mult(c.key, r) })), { k: "cash", label: "現金", sub: "現金", m: TM.mult("cash", r) }];
  const showInv = !!invested;
  const mid = o => showInv ? "" : `<td class="py-2.5 px-2 text-right tnum">${TM.xfmt(o.m)}</td>`;
  return `<div class="overflow-x-auto"><table class="w-full min-w-[280px] border-collapse text-base"><thead><tr class="border-b border-line text-sm text-ink2"><th class="py-2 pr-3 text-left font-medium">公司</th>${showInv ? "" : `<th class="py-2 px-2 text-right font-medium">5 年倍數</th>`}<th class="py-2 px-2 text-right font-medium">5 年漲跌</th>${showInv ? `<th class="py-2 pl-2 text-right font-medium">你的錢</th>` : ""}</tr></thead><tbody>
  ${rows.map(o => { const inv = showInv ? (invested[o.k] || 0) : 0; return `<tr class="border-b border-line"><td class="py-2.5 pr-3"><span class="inline-flex items-center gap-2 whitespace-nowrap"><i class="dot" style="--c:${TM.col(o.k)}"></i><span class="font-semibold">${o.label}</span></span></td>${mid(o)}<td class="py-2.5 px-2 text-right">${TM.chg(o.m)}</td>${showInv ? `<td class="py-2.5 pl-2 text-right tnum whitespace-nowrap">${inv ? `<b>${TM.wan(inv * o.m)}</b><span class="block text-sm text-ink2">投入 ${TM.wan(inv)}</span>` : `<span class="text-ink2">—</span>`}</td>` : ""}</tr>`; }).join("")}
  <tr class="text-ink2"><td class="py-2.5 pr-3"><span class="inline-flex items-center gap-2 whitespace-nowrap"><span class="inline-block w-3 border-t-2 border-dashed border-ink2"></span>大盤</span></td>${mid({ m: TM.triMult(r) })}<td class="py-2.5 px-2 text-right">${TM.chg(TM.triMult(r))}</td>${showInv ? "<td></td>" : ""}</tr></tbody></table></div>`;
};
TM.distBar = (agg, keys0 = TM.AKEYS, big = false) => { const keys = keys0.slice().sort((a, b) => (agg[b] || 0) - (agg[a] || 0)); return `<div class="stack flex ${big ? "h-8" : "h-3"} gap-0.5 overflow-hidden rounded-sm" role="img" aria-label="全班配置比例">${keys.map(k => agg[k] > 0.001 ? `<i style="width:${(agg[k] * 100).toFixed(2)}%;background:${TM.col(k)}"></i>` : "").join("")}</div>
  <ul class="${big ? "mt-6 grid-cols-3 gap-x-10 gap-y-4 text-3xl [&_.dot]:h-4 [&_.dot]:w-4" : "mt-3 grid-cols-2 gap-x-6 gap-y-1.5 text-base"} grid">${keys.map(k => `<li class="flex items-center ${big ? "gap-3" : "gap-2"}"><i class="dot" style="--c:${TM.col(k)}"></i><span class="whitespace-nowrap text-ink2">${TM.META[k].cat}</span><span class="ml-auto font-semibold tnum">${((agg[k] || 0) * 100).toFixed(0)}%</span></li>`).join("")}</ul>`; };
TM.leaderTable = (list, meId, show = 10, big = false) => {
  if (!list || !list.length) return `<p class="text-base text-ink2">第一輪結算後才會出現排名。</p>`;
  const yi = list.findIndex(x => x.u === meId), rs = TM.ranks(list);
  const tr = (p, i) => `<tr class="border-b border-line ${p.u === meId ? "bg-mist font-semibold" : ""}"><td class="py-2 pl-2 pr-3 text-right text-ink2 tnum whitespace-nowrap">${rs[i]}</td><td class="max-w-[12rem] truncate py-2 pr-3">${TM.esc(p.n)}${p.u === meId ? "（你）" : ""}</td><td class="py-2 pr-2 text-right tnum whitespace-nowrap">${TM.wan(p.v)}</td></tr>`;
  let body = list.slice(0, show).map(tr).join("");
  if (yi >= show) body += `<tr class="border-b border-line"><td colspan="3" class="py-1 text-center text-ink2">⋯</td></tr>` + tr(list[yi], yi);
  return `<div class="overflow-x-auto"><table class="w-full min-w-[260px] border-collapse ${big ? "text-xl" : "text-base"}"><thead><tr class="border-b border-line ${big ? "text-base" : "text-sm"} text-ink2"><th class="py-2 pl-2 pr-3 text-right font-medium">名次</th><th class="py-2 pr-3 text-left font-medium">暱稱</th><th class="py-2 pr-2 text-right font-medium">資產</th></tr></thead><tbody>${body}</tbody></table></div>`;
};
/* ===== 揭曉：全班當初押了什麼 → 各產業實際結果 =====
   a、b：從第 a 輪開始到第 b 輪開始（一輪 = a、a+1；20 年 = 0、4）；dist：全班在第 a 輪的配置比例 */
TM.reveal = (a, b, dist) => {
  const rows = TM.AKEYS.map(k => ({ k, m: TM.spanMult(k, a, b), share: dist ? (dist[k] || 0) : null })).sort((x, y) => y.m - x.m);
  const best = rows[0], top = dist ? rows.slice().sort((x, y) => y.share - x.share)[0] : null;
  return { rows, best, top, worst: rows[rows.length - 1] };
};
const coName = k => k === "cash" ? "現金" : TM.coOf(k).name;
TM.revealLine = (a, b, dist) => {
  const { best, top } = TM.reveal(a, b, dist), span = b - a === 1 ? "這五年" : `這 ${(b - a) * 5} 年`;
  if (!top || top.share <= 0) return `${span}最賺的是<b>${TM.META[best.k].cat}</b>（${coName(best.k)} ${TM.xfmt(best.m)}）。`;
  const pct = s => `${Math.round(s * 100)}%`;
  if (top.k === best.k) return `${TM.YEAR[a]} 年全班最多錢押在<b>${TM.META[top.k].cat}</b>（${pct(top.share)}），${coName(top.k)}${span} <b class="tnum tm-up">${TM.xfmt(top.m)}</b>，剛好是最賺的。`;
  return `${TM.YEAR[a]} 年全班最多錢押在<b>${TM.META[top.k].cat}</b>（${pct(top.share)}），${coName(top.k)}${span} <b class="tnum ${top.m >= 1 ? "tm-up" : "tm-down"}">${TM.xfmt(top.m)}</b>。最賺的其實是<b>${TM.META[best.k].cat}</b>（${coName(best.k)} <b class="tnum tm-up">${TM.xfmt(best.m)}</b>），全班只押了 ${pct(best.share)}。`;
};
/* 對照 2006 年的主流看法：不管這間教室怎麼押，都提醒當年大家看好的是哪些產業 */
TM.consensusLine = (a, b) => {
  const hot = TM.CATS.filter(c => c.hot); if (!hot.length) return "";
  return `「2006 熱門」：${hot.map(c => c.cat).join("、")}是 2006 年大家最看好的產業。`;
};
/* 大螢幕最後一句：全班最愛 vs 真正的贏家（或 2006 熱門裡最慘的） */
TM.takeaway = (a, b, dist) => {
  const { rows, best, top } = TM.reveal(a, b, dist), x = o => `<b class="tnum ${o.m >= 1 ? "tm-up" : "tm-down"}">${TM.xfmt(o.m)}</b>`, nm = o => TM.META[o.k].cat;
  const hotWorst = rows.filter(o => TM.META[o.k].hot).slice(-1)[0];
  const few = o => Math.round(o.share * 100) > 0 ? `全班只押 ${Math.round(o.share * 100)}% 的` : "沒人押的";
  if (top && top.share > 0 && top.k !== best.k) return [`全班最愛的${nm(top)} ${x(top)}`, `${few(best)}${nm(best)} ${x(best)}`];
  if (top && top.share > 0) return [`全班最愛的${nm(top)} ${x(top)}，剛好最賺`, hotWorst && hotWorst.k !== top.k ? `2006 年熱門的${nm(hotWorst)} ${x(hotWorst)}` : ""];
  return [`最賺的${nm(best)} ${x(best)}`, hotWorst ? `2006 年熱門的${nm(hotWorst)} ${x(hotWorst)}` : ""];
};
TM.takeawayText = (a, b, dist) => { const [l1, l2] = TM.takeaway(a, b, dist); return l2 ? `${l1}；${l2}。` : `${l1}。`; };
/* size：base（手機、控制台）或 lg（大螢幕）；mine：你在第 a 輪的配置比例（選填） */
TM.revealTable = (a, b, dist, size = "base", mine = null) => {
  const { rows, top } = TM.reveal(a, b, dist), lg = size === "lg", maxShare = dist ? Math.max(...rows.map(o => o.share), 0.01) : 1;
  const later = b - a === 1 ? "五年後" : `${(b - a) * 5} 年後`;
  /* 固定欄寬，讓每一列的數字上下對齊 */
  const cols = dist ? (lg ? "grid-cols-[minmax(0,1fr)_13rem_8rem]" : "grid-cols-[minmax(0,1fr)_4rem_4.25rem]") : (lg ? "grid-cols-[minmax(0,1fr)_8rem]" : "grid-cols-[minmax(0,1fr)_4.25rem]");
  const tag = (t, cls) => `<span class="whitespace-nowrap rounded px-1.5 py-px text-sm font-semibold ${cls}">${t}</span>`;
  const row = o => { const mp = mine ? Math.round((mine[o.k] || 0) * 100) : 0;
    return `<li class="grid ${cols} items-center gap-x-3 border-b border-line ${lg ? "py-3" : "py-2.5"}">
    <span class="flex min-w-0 items-center gap-2.5"><i class="dot" style="--c:${TM.col(o.k)}"></i><span class="min-w-0"><span class="flex flex-wrap items-center gap-x-2 gap-y-1"><span class="whitespace-nowrap font-semibold ${lg ? "text-2xl" : "text-base"}">${TM.META[o.k].cat}</span>${top && o.k === top.k && top.share > 0 ? tag("全班最愛", "bg-ink text-white") : ""}</span><span class="block whitespace-nowrap ${lg ? "text-base" : "text-sm"} text-ink2">${o.k === "cash" ? TM.CASH.name : coName(o.k)}${TM.META[o.k].hot ? `・<b class="font-semibold text-ink">2006 熱門</b>` : ""}</span></span></span>
    ${!dist ? "" : lg ? `<span class="flex items-center justify-end gap-2 text-2xl tnum text-ink2"><span class="h-2.5 w-24 rounded-sm bg-mist"><i class="block h-full rounded-sm" style="width:${(o.share / maxShare * 100).toFixed(1)}%;background:${TM.col(o.k)}"></i></span>${Math.round(o.share * 100)}%</span>`
      : `<span class="block text-right tnum"><span class="block text-base text-ink2">${Math.round(o.share * 100)}%</span><span class="ml-auto mt-1 block h-1.5 w-full rounded-sm bg-mist"><i class="ml-auto block h-full rounded-sm" style="width:${(o.share / maxShare * 100).toFixed(1)}%;background:${TM.col(o.k)}"></i></span>${mp ? `<span class="mt-1 block whitespace-nowrap text-sm font-semibold text-ink">你押 ${mp}%</span>` : ""}</span>`}
    <span class="text-right font-black tnum whitespace-nowrap ${lg ? "text-4xl" : "text-xl"} ${o.m >= 1 ? "tm-up" : "tm-down"}">${TM.xfmt(o.m)}</span></li>`; };
  return `<p class="mb-3 ${lg ? "text-lg" : "text-sm"} text-ink2">×2 代表錢變成兩倍，×0.5 代表剩一半（含股利）。</p><div class="grid ${cols} gap-x-3 border-b border-line pb-2 ${lg ? "text-base" : "text-sm"} text-ink2"><span>產業</span>${dist ? `<span class="text-right"><span class="whitespace-nowrap">${TM.YEAR[a]} 年</span> <span class="whitespace-nowrap">全班押</span></span>` : ""}<span class="text-right">${later}</span></div><ol>${rows.map(row).join("")}</ol>${TM.CATS.some(c => c.hot) ? `<p class="mt-3 ${lg ? "text-lg" : "text-sm"} text-ink2">${TM.consensusLine(a, b)}</p>` : ""}`;
};
/* 時光機：快轉時年份從 from 滾到 to。每個 id 只播一次；減少動態效果時直接顯示結果 */
TM.WARPED = new Set();
TM.warp = (root) => {
  root.querySelectorAll("[data-warp-to]").forEach(el => {
    const id = el.dataset.warpId, a = +el.dataset.warpFrom, b = +el.dataset.warpTo, box = el.closest("[data-warp-box]"), line = box && box.querySelector(".warpline");
    if (TM.RM || !id || TM.WARPED.has(id)) return; TM.WARPED.add(id);
    el.classList.add("go"); if (line) line.classList.add("go");
    const t0 = performance.now(), d = 1100;
    const step = t => { const k = Math.max(0, Math.min(1, (t - t0) / d)), e = 1 - Math.pow(1 - k, 4); el.textContent = String(Math.round(a + (b - a) * e)); if (k < 1) requestAnimationFrame(step); };
    el.textContent = String(a); requestAnimationFrame(step);
  });
};
TM.warpYear = (id, from, to, cls = "") => `<span class="warp tnum ${cls}" data-warp-id="${id}" data-warp-from="${from}" data-warp-to="${to}">${to}</span>`;
TM.COUNTED = new Set();
TM.countUp = (root) => {
  if (TM.RM) return;
  root.querySelectorAll("[data-count-to]").forEach(el => { const id = el.dataset.countId; if (id) { if (TM.COUNTED.has(id)) return; TM.COUNTED.add(id); }
    const a = +el.dataset.countFrom, b = +el.dataset.countTo, t0 = performance.now(), d = 800;
    const step = t => { const k = Math.max(0, Math.min(1, (t - t0) / d)), e = 1 - Math.pow(1 - k, 3); el.textContent = TM.wan(a + (b - a) * e); if (k < 1) requestAnimationFrame(step); }; requestAnimationFrame(step); });
};
})();
