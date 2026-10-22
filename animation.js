/* Interactive visualization of the 2D signal-rule decoder. Engine: decoder.js */
(function () {
  const $ = id => document.getElementById(id);
  const COL = { defect: '#0071bc', f1: '#0071bc', f2: '#b4c8e6', s1: '#fbb03b', s2: '#f7ddbb', err: '#d7263d' };
  const ANGLE = [0, -Math.PI / 2, Math.PI, Math.PI / 2];           // E, N(up), W, S(down)
  const STEPS = ['syndrome measurement', 'matching', '1-forward signals: creation & propagation',
    '2-forward signals: creation & propagation', 'attraction', 'anti-signals: creation',
    'anti-signals: propagation & recombination (1/3)', 'anti-signals: propagation & recombination (2/3)',
    'anti-signals: propagation & recombination (3/3)'];
  const MAXF = 1500;                                                      // history length cap

  let dec, frames, idx, L = 13, timer = null;
  const show = () => true;

  // ---------- drawing ----------
  function marker(ctx, type, x, y, r, color) {
    ctx.fillStyle = color; ctx.beginPath();
    if (type === 'o') ctx.arc(x, y, r, 0, 2 * Math.PI);
    else if (type === 's') ctx.rect(x - 0.8 * r, y - 0.8 * r, 1.6 * r, 1.6 * r);
    else {
      ctx.save(); ctx.translate(x, y); ctx.rotate(ANGLE[type]);
      ctx.moveTo(1.05 * r, 0); ctx.lineTo(-0.8 * r, -0.95 * r); ctx.lineTo(-0.8 * r, 0.95 * r); ctx.closePath();
      ctx.restore();
    }
    ctx.fill();
  }
  // direction layer of a signal array at site n: 'o' none, 's' several, or the direction
  function sig(A, n, N) {
    let c = 0, k0 = -1;
    for (let k = 0; k < 4; k++) if (A[k * N + n]) { c++; k0 = k; }
    return c === 0 ? null : c > 1 ? 's' : k0;
  }
  function geom(cv) {
    const S = Math.floor(cv.parentElement.clientWidth), c = S / (L + 0.6), pad = 0.3 * c;
    return { S, c, X: j => pad + (j + 0.5) * c, Y: i => pad + (L - 1 - i + 0.5) * c };   // row index grows upward
  }
  function draw(cv, side) {
    const dpr = window.devicePixelRatio || 1, g = geom(cv), ctx = cv.getContext('2d');
    if (g.S < 10) return;
    if (cv.width !== Math.round(g.S * dpr)) { cv.width = cv.height = Math.round(g.S * dpr); }
    cv.style.width = cv.style.height = g.S + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, g.S, g.S);
    const { c, X, Y } = g, N = dec.N, r = 0.36 * c;
    if (show('grid')) {
      ctx.strokeStyle = '#ececec'; ctx.lineWidth = 1; ctx.beginPath();
      for (let k = 0; k < L; k++) {
        ctx.moveTo(X(k), Y(0) + 0.3 * c); ctx.lineTo(X(k), Y(L - 1) - 0.3 * c);
        ctx.moveTo(X(0) - 0.3 * c, Y(k)); ctx.lineTo(X(L - 1) + 0.3 * c, Y(k));
      }
      ctx.stroke();
    }
    if (side === 0 && show('errors')) {                                  // data errors on edges (wrap-around edges as two stubs)
      ctx.lineWidth = 0.16 * c; ctx.lineCap = 'round'; ctx.strokeStyle = COL.err;
      const seg = (x0, y0, x1, y1) => { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); };
      for (let i = 0; i < L; i++) for (let j = 0; j < L; j++) {
        if (dec.h[i * L + j]) j ? seg(X(j - 1), Y(i), X(j), Y(i)) : (seg(X(0) - 0.5 * c, Y(i), X(0), Y(i)), seg(X(L - 1), Y(i), X(L - 1) + 0.5 * c, Y(i)));
        if (dec.v[i * L + j]) i < L - 1 ? seg(X(j), Y(i), X(j), Y(i + 1)) : (seg(X(j), Y(L - 1), X(j), Y(L - 1) - 0.5 * c), seg(X(j), Y(0), X(j), Y(0) + 0.5 * c));
      }
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `bold ${0.42 * c}px sans-serif`;
    const put = (n, kind, color, num) => {
      const i = Math.floor(n / L), j = n % L, x = X(j), y = Y(i);
      marker(ctx, kind, x, y, kind === 's' ? 0.34 * c : r, color);
      if (num) { ctx.fillStyle = '#fff'; ctx.fillText(num, x, y + 0.03 * c); }
    };
    for (let n = 0; n < N; n++) {
      let k;
      if (side === 0) {
        if (show('defects') && dec.D[n]) put(n, 'o', COL.defect);
        else if (show('fwd') && (k = sig(dec.F1, n, N)) !== null) put(n, k, COL.f1);
        else if (show('fwd') && (k = sig(dec.F2, n, N)) !== null) put(n, k, COL.f2);
      } else {
        const top = S => { let m = 0; for (let q = 0; q < 4; q++) m = Math.max(m, S[q * N + n]); return m; };
        let m;
        if (show('stack') && (m = top(dec.S1))) put(n, 'o', COL.s1, m);
        else if (show('stack') && (m = top(dec.S2))) put(n, 'o', COL.s2, m);
        else if (show('anti') && (k = sig(dec.A1, n, N)) !== null) put(n, k, COL.s1);
        else if (show('anti') && (k = sig(dec.A2, n, N)) !== null) put(n, k, COL.s2);
      }
    }
  }

  // ---------- state / history ----------
  const stats = () => dec.stats();
  const regime = () => document.querySelector('input[name=regime]:checked').value;
  const blocked = () => regime() === 'offline' && stats().clear;

  function render() {
    const j = Math.min(dec.ph, 5);
    $('frame-label').textContent = `iter. ${dec.it + 1}.${j}`;
    $('step-name').textContent = `step ${dec.ph}: ${STEPS[dec.ph]}`;
    draw($('cv-left'), 0); draw($('cv-right'), 1);
    $('back').disabled = $('back-iter').disabled = idx === 0;
    $('fwd').disabled = $('fwd-iter').disabled = blocked();
    $('play').textContent = timer ? '⏸' : '▶';
  }
  function go(i) { idx = i; dec.restore(frames[idx]); }
  function stepFwd() {
    if (idx < frames.length - 1) go(idx + 1);
    else if (!blocked()) {
      dec.step(); frames.push(dec.snapshot()); idx++;
      if (frames.length > MAXF) { frames.shift(); idx--; }
    } else return false;
    return true;
  }
  function stepBack() { if (idx > 0) go(idx - 1); }
  function iterFwd() { do { if (!stepFwd()) break; } while (dec.ph !== 0); }
  function iterBack() { do { stepBack(); } while (idx > 0 && dec.ph !== 0); }
  function stop() { clearTimeout(timer); timer = null; }
  function tick() {
    if (!stepFwd() || blocked()) { stop(); render(); return; }
    render(); timer = setTimeout(tick, 1000 / +$('speed').value);
  }
  function togglePlay() { if (timer) { stop(); render(); } else if (!blocked() || idx < frames.length - 1) { timer = 1; tick(); } }

  function init() {
    stop();
    const sc = 'random', P = null, online = regime() === 'online';
    if (P) { $('size').value = P.L; $('size-val').textContent = P.L; }
    L = +$('size').value;
    const p = +$('perr').value / 1000, q = online ? +$('merr').value / 1000 : 0;
    dec = new Decoder(L, { online, p, q, inj: (P && P.inj) || {}, quietFirst: false });
    if (P && P.h) { P.h.forEach(([i, j]) => dec.h[i * L + j] = 1); P.v.forEach(([i, j]) => dec.v[i * L + j] = 1); }
    if (sc === 'random' && !online) {
      let k = 0;
      for (let n = 0; n < dec.N; n++) { if (Math.random() < p) { dec.h[n] = 1; k++; } if (Math.random() < p) { dec.v[n] = 1; k++; } }
      if (!k) dec.h[Math.floor(Math.random() * dec.N)] = 1;
    }
    dec.start(); frames = [dec.snapshot()]; idx = 0; render();
  }
  function reset() { stop(); frames.length = 1; go(0); render(); }

  // ---------- legend ----------
  function legend() {
    const items = [['defect', 'o', COL.defect], ['1-forward signal', 0, COL.f1], ['2-forward signal', 0, COL.f2], ['several signals', 's', COL.f1],
      ['1-stack (top value)', 'o', COL.s1, '2'], ['2-stack (top value)', 'o', COL.s2, '1'], ['1-anti-signal', 0, COL.s1], ['2-anti-signal', 0, COL.s2], ['data error', 'e']];
    $('legend').innerHTML = '';
    for (const [label, kind, color, num] of items) {
      const li = document.createElement('li'), cv = document.createElement('canvas'); cv.width = cv.height = 44; cv.style.cssText = 'width:22px;height:22px;vertical-align:middle;margin-right:6px';
      const ctx = cv.getContext('2d'); ctx.scale(2, 2);
      if (kind === 'e') { ctx.strokeStyle = COL.err; ctx.lineWidth = 3.5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(3, 11); ctx.lineTo(19, 11); ctx.stroke(); }
      else { marker(ctx, kind, 11, 11, 8, color); if (num) { ctx.fillStyle = '#fff'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(num, 11, 11.5); } }
      li.append(cv, label); $('legend').append(li);
    }
  }

  // ---------- wiring ----------
  function syncUI() {
    const online = regime() === 'online';
    $('merr-row').hidden = !online;
    $('perr-label').textContent = online ? 'data error rate (per round)' : 'data error rate';
  }
  window.addEventListener('DOMContentLoaded', () => {
    legend();
    $('init').onclick = () => { syncUI(); init(); };
    $('reset').onclick = reset;
    $('back').onclick = () => { stop(); stepBack(); render(); };
    $('back-iter').onclick = () => { stop(); iterBack(); render(); };
    $('fwd').onclick = () => { stop(); stepFwd(); render(); };
    $('fwd-iter').onclick = () => { stop(); iterFwd(); render(); };
    $('play').onclick = togglePlay;
    for (const [id, out, f] of [['speed', 'speed-val', v => v + ' steps/s'], ['size', 'size-val', v => v], ['perr', 'perr-val', v => (v / 10) + '%'], ['merr', 'merr-val', v => (v / 10) + '%']])
      $(id).oninput = () => { $(out).textContent = f($(id).value); };
    document.querySelectorAll('input[name=regime], #size').forEach(el => el.onchange = () => { syncUI(); init(); });
    window.addEventListener('resize', () => dec && render());
    document.addEventListener('keydown', e => {
      if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && e.target.type !== 'radio' && e.target.type !== 'checkbox') return;
      if (e.key === ' ') { e.preventDefault(); togglePlay(); }
      else if (e.key === 'ArrowRight') { stop(); stepFwd(); render(); }
      else if (e.key === 'ArrowLeft') { stop(); stepBack(); render(); }
    });
    ['speed', 'size', 'perr', 'merr'].forEach(id => $(id).oninput());
    syncUI(); init();
  });
})();
