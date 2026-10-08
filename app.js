/* Tactics Board — vanilla JS, no libraries.
 * State is a plain object that can be saved to localStorage or shared in the URL hash.
 */
(() => {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const STORE_KEY = "tactics-board:lineups";
  const $ = (sel) => document.querySelector(sel);

  const pitch = $("#pitch");
  const playersLayer = $("#players");
  const oppLayer = $("#opponents");
  const arrowsLayer = $("#arrows");
  const preview = $("#preview");

  let state = freshState("4-3-3");
  let tool = "move";

  // ---------- state helpers ----------
  function freshState(formation) {
    return {
      formation,
      players: FORMATIONS[formation].map(([x, y, num, role]) => ({ x, y, num, role, name: role })),
      arrows: [],
      showOpp: false,
    };
  }

  function applyFormation(formation) {
    // keep names/numbers the user typed, move them into the new shape
    const old = state.players;
    const next = freshState(formation);
    next.players.forEach((p, i) => {
      if (old[i] && old[i].name !== old[i].role) p.name = old[i].name;
      if (old[i] && old[i].customNum) { p.num = old[i].num; p.customNum = true; }
    });
    next.arrows = state.arrows;
    next.showOpp = state.showOpp;
    state = next;
    render();
  }

  // ---------- rendering ----------
  function el(name, attrs = {}, parent) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (parent) parent.appendChild(node);
    return node;
  }

  function arrowPath(a) {
    if (a.type === "run") {
      // runs curve slightly — looks like a player bending their run
      const mx = (a.x1 + a.x2) / 2, my = (a.y1 + a.y2) / 2;
      const dx = a.x2 - a.x1, dy = a.y2 - a.y1;
      const bend = 0.18;
      const cx = mx - dy * bend, cy = my + dx * bend;
      return `M${a.x1} ${a.y1}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${a.x2} ${a.y2}`;
    }
    return `M${a.x1} ${a.y1}L${a.x2} ${a.y2}`;
  }

  function render() {
    playersLayer.replaceChildren();
    state.players.forEach((p, i) => {
      const g = el("g", { class: "player" + (p.role === "GK" ? " gk" : ""), transform: `translate(${p.x} ${p.y})`, "data-i": i, tabindex: 0 }, playersLayer);
      el("circle", { r: 24 }, g);
      const num = el("text", { class: "num" }, g);
      num.textContent = p.num;
      const name = el("text", { class: "name", y: 46 }, g);
      name.textContent = p.name;
    });

    oppLayer.replaceChildren();
    if (state.showOpp) {
      OPPONENTS.forEach(([x, y], i) => {
        const g = el("g", { class: "opp", transform: `translate(${x} ${y})` }, oppLayer);
        el("circle", { r: 20 }, g);
        el("text", {}, g).textContent = i + 1;
      });
    }

    arrowsLayer.replaceChildren();
    state.arrows.forEach((a) => el("path", { class: `arrow ${a.type}`, d: arrowPath(a) }, arrowsLayer));

    document.querySelectorAll("#formations button").forEach((b) => b.classList.toggle("on", b.dataset.f === state.formation));
    $("#showOpp").checked = state.showOpp;
    $("#shapeLabel").textContent = state.formation;
    const n = state.arrows.length;
    $("#arrowCount").textContent = `${n} arrow${n === 1 ? "" : "s"}`;
  }

  // ---------- pointer handling ----------
  function toSvg(evt) {
    const pt = pitch.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    const p = pt.matrixTransform(pitch.getScreenCTM().inverse());
    return { x: clamp(Math.round(p.x), 20, 660), y: clamp(Math.round(p.y), 20, 1030) };
  }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  let drag = null;
  let lastTap = { i: -1, t: 0 };

  pitch.addEventListener("pointerdown", (evt) => {
    const start = toSvg(evt);
    if (tool === "move") {
      const g = evt.target.closest(".player");
      if (!g) return;
      const i = Number(g.dataset.i);
      // our own double-tap detection (works for mouse and touch, survives pointer capture)
      const now = performance.now();
      if (lastTap.i === i && now - lastTap.t < 350) { lastTap = { i: -1, t: 0 }; openEditor(i); return; }
      lastTap = { i, t: now };
      drag = { kind: "player", i, dx: state.players[i].x - start.x, dy: state.players[i].y - start.y, node: g };
    } else {
      // snap arrow start to a player if you press on one
      const g = evt.target.closest(".player");
      const from = g ? state.players[Number(g.dataset.i)] : start;
      drag = { kind: "arrow", x1: from.x, y1: from.y, fromPlayer: !!g };
      preview.setAttribute("class", `arrow ${tool}`);
    }
    pitch.setPointerCapture(evt.pointerId);
    evt.preventDefault();
  });

  pitch.addEventListener("pointermove", (evt) => {
    if (!drag) return;
    const p = toSvg(evt);
    if (drag.kind === "player") {
      const pl = state.players[drag.i];
      pl.x = clamp(p.x + drag.dx, 30, 650);
      pl.y = clamp(p.y + drag.dy, 30, 1020);
      drag.node.setAttribute("transform", `translate(${pl.x} ${pl.y})`);
    } else {
      preview.setAttribute("d", arrowPath({ type: tool, x1: drag.x1, y1: drag.y1, x2: p.x, y2: p.y }));
    }
  });

  function endDrag(evt) {
    if (!drag) return;
    if (drag.kind === "arrow") {
      const p = toSvg(evt);
      const g = document.elementFromPoint(evt.clientX, evt.clientY)?.closest?.(".player");
      const to = g ? state.players[Number(g.dataset.i)] : p;
      const len = Math.hypot(to.x - drag.x1, to.y - drag.y1);
      if (len > 25) {
        // stop the arrow at the edge of a player's circle so the head stays visible
        const ux = (to.x - drag.x1) / len, uy = (to.y - drag.y1) / len;
        const s = drag.fromPlayer ? 30 : 0, e = g ? 34 : 0;
        if (len > s + e + 20) {
          state.arrows.push({
            type: tool,
            x1: Math.round(drag.x1 + ux * s), y1: Math.round(drag.y1 + uy * s),
            x2: Math.round(to.x - ux * e), y2: Math.round(to.y - uy * e),
          });
        }
      }
      preview.setAttribute("d", "");
    }
    const wasArrow = drag.kind === "arrow";
    drag = null;
    if (wasArrow) render();
  }
  pitch.addEventListener("pointerup", endDrag);
  pitch.addEventListener("pointercancel", () => { drag = null; preview.setAttribute("d", ""); });

  // ---------- edit player ----------
  const dlg = $("#editDlg");
  let editing = null;
  function openEditor(i) {
    editing = i;
    $("#editNum").value = state.players[i].num;
    $("#editName").value = state.players[i].name;
    dlg.showModal();
    $("#editName").select();
  }
  playersLayer.addEventListener("keydown", (evt) => {
    const g = evt.target.closest(".player");
    if (g && (evt.key === "Enter" || evt.key === " ")) { evt.preventDefault(); openEditor(Number(g.dataset.i)); }
  });
  dlg.addEventListener("close", () => {
    if (dlg.returnValue === "ok" && editing !== null) {
      const p = state.players[editing];
      const n = parseInt($("#editNum").value, 10);
      if (n >= 1 && n <= 99 && n !== p.num) { p.num = n; p.customNum = true; }
      const name = $("#editName").value.trim();
      p.name = name || p.role;
      render();
    }
    editing = null;
  });

  // ---------- controls ----------
  const fWrap = $("#formations");
  Object.keys(FORMATIONS).forEach((f) => {
    const b = document.createElement("button");
    b.textContent = f;
    b.dataset.f = f;
    b.addEventListener("click", () => applyFormation(f));
    fWrap.appendChild(b);
  });

  const hints = {
    move: "Drag players to reposition. Double-click a player to rename.",
    pass: "Drag from a player to draw a pass (dashed cyan).",
    run: "Drag to draw a run (curved green). Start on a player to snap to them.",
  };
  function setTool(t) {
    tool = t;
    document.querySelectorAll("[data-tool]").forEach((b) => {
      const on = b.dataset.tool === t;
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", on);
    });
    document.body.classList.toggle("drawing", t !== "move");
    $("#toolHint").textContent = hints[t];
  }
  document.querySelectorAll("[data-tool]").forEach((b) => b.addEventListener("click", () => setTool(b.dataset.tool)));

  $("#showOpp").addEventListener("change", (e) => { state.showOpp = e.target.checked; render(); });
  $("#undo").addEventListener("click", () => { state.arrows.pop(); render(); });
  $("#clear").addEventListener("click", () => { state.arrows = []; render(); });
  $("#reset").addEventListener("click", () => {
    const keep = state.arrows;
    const opp = state.showOpp;
    state = freshState(state.formation);
    state.arrows = keep;
    state.showOpp = opp;
    render();
  });

  document.addEventListener("keydown", (e) => {
    if (dlg.open || e.target.matches("input")) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); state.arrows.pop(); render(); return; }
    const map = { m: "move", p: "pass", r: "run" };
    if (map[e.key.toLowerCase()]) setTool(map[e.key.toLowerCase()]);
  });

  // ---------- saved lineups (localStorage) ----------
  function readStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
  }
  function writeStore(obj) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(obj)); return true; } catch { return false; }
  }
  function renderSaved() {
    const list = $("#saved");
    list.replaceChildren();
    const store = readStore();
    const names = Object.keys(store);
    if (!names.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "No saved lineups yet.";
      list.appendChild(li);
      return;
    }
    names.forEach((name) => {
      const li = document.createElement("li");
      const load = document.createElement("button");
      load.textContent = name;
      load.title = `Load "${name}"`;
      load.addEventListener("click", () => { state = structuredClone(store[name]); render(); toast(`Loaded “${name}”`); });
      const del = document.createElement("button");
      del.textContent = "✕";
      del.title = `Delete "${name}"`;
      del.setAttribute("aria-label", `Delete ${name}`);
      del.addEventListener("click", () => { const s = readStore(); delete s[name]; writeStore(s); renderSaved(); });
      li.append(load, del);
      list.appendChild(li);
    });
  }
  $("#save").addEventListener("click", () => {
    const name = $("#lineupName").value.trim() || `${state.formation} · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    const store = readStore();
    store[name] = structuredClone(state);
    toast(writeStore(store) ? `Saved “${name}”` : "Couldn't save — storage is blocked in this browser");
    $("#lineupName").value = "";
    renderSaved();
  });

  // ---------- share via URL ----------
  function encodeState(s) {
    const compact = {
      f: s.formation,
      o: s.showOpp ? 1 : 0,
      p: s.players.map((p) => [p.x, p.y, p.num, p.name === p.role ? 0 : p.name]),
      a: s.arrows.map((a) => [a.type === "run" ? 1 : 0, a.x1, a.y1, a.x2, a.y2]),
    };
    const bytes = new TextEncoder().encode(JSON.stringify(compact));
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function decodeState(str) {
    const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64);
    const c = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))));
    if (!FORMATIONS[c.f]) throw new Error("bad formation");
    const base = freshState(c.f);
    base.showOpp = !!c.o;
    base.players.forEach((p, i) => {
      const q = c.p[i];
      if (!q) return;
      p.x = clamp(+q[0], 30, 650); p.y = clamp(+q[1], 30, 1020);
      p.num = clamp(+q[2] || p.num, 1, 99);
      if (q[3]) p.name = String(q[3]).slice(0, 14);
    });
    base.arrows = (c.a || []).slice(0, 200).map((a) => ({ type: a[0] ? "run" : "pass", x1: +a[1], y1: +a[2], x2: +a[3], y2: +a[4] }));
    return base;
  }
  $("#share").addEventListener("click", async () => {
    const url = `${location.origin}${location.pathname}#${encodeState(state)}`;
    history.replaceState(null, "", url);
    try { await navigator.clipboard.writeText(url); toast("Link copied — send it to your squad"); }
    catch { toast("Link is in the address bar — copy it from there"); }
  });

  // ---------- export PNG ----------
  const EXPORT_CSS = `
    .lines *{fill:none;stroke:rgba(57,255,136,.55);stroke-width:3}.lines .fill{fill:rgba(57,255,136,.55)}
    .player circle{fill:#00e5ff;stroke:#eafcff;stroke-width:3}.player.gk circle{fill:#39ff88}
    .player text.num{fill:#00121a;font:900 22px Inter,Segoe UI,Arial,sans-serif;text-anchor:middle;dominant-baseline:central}
    .player text.name{fill:#e8eef5;font:600 17px Inter,Segoe UI,Arial,sans-serif;text-anchor:middle;paint-order:stroke;stroke:#05070d;stroke-width:5px}
    .opp circle{fill:none;stroke:#ff2a46;stroke-width:3}.opp text{fill:#ff2a46;font:800 16px Inter,Arial,sans-serif;text-anchor:middle;dominant-baseline:central}
    .arrow{fill:none;stroke-width:5;stroke-linecap:round}.arrow.pass{stroke:#00e5ff;stroke-dasharray:14 10;marker-end:url(#headPass)}
    .arrow.run{stroke:#39ff88;marker-end:url(#headRun)}`;
  $("#export").addEventListener("click", () => {
    const clone = pitch.cloneNode(true);
    clone.querySelector("#preview")?.remove();
    clone.setAttribute("width", 1360);
    clone.setAttribute("height", 2100);
    const style = document.createElementNS(SVG_NS, "style");
    style.textContent = EXPORT_CSS;
    clone.insertBefore(style, clone.firstChild);
    const xml = new XMLSerializer().serializeToString(clone);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1360;
      canvas.height = 2100;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `tactics-${state.formation}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        toast("PNG downloaded");
      });
    };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
  });

  // ---------- toast ----------
  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
  }

  // ---------- boot ----------
  if (location.hash.length > 1) {
    try { state = decodeState(location.hash.slice(1)); toast("Loaded shared lineup"); }
    catch { toast("That share link looks broken — loaded the default 4-3-3"); }
  }
  render();
  renderSaved();
})();
