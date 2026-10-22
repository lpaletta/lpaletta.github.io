/* 2D signal-rule decoder for the toric code (port of sgn2d_to_visualize.py).
 *
 * Lattice: d x d sites carrying the stabilizer outcomes (defects). Data qubits sit on edges:
 *   h[i][j] joins sites (i,j-1)-(i,j);  v[i][j] joins sites (i,j)-(i+1,j).   (periodic)
 * Signal arrays have 4 direction layers k, stored flat as k*N + i*d + j:
 *   k = 0 E (col+1), 1 N (row+1), 2 W (col-1), 3 S (row-1).
 * 1-signals use k in {1,2,3}; 2-signals use k in {0,1,3}.
 *
 * One decoder iteration = 9 micro-steps (phase 0..8):
 *   0 measure | 1 matching | 2 1-forward | 3 2-forward | 4 attraction | 5 anti-create | 6,7,8 anti-propagate
 */
(function (root) {
  const DI = [0, 1, 0, -1], DJ = [1, 0, -1, 0];

  function Decoder(d, opts) {
    this.d = d; const N = this.N = d * d;
    this.o = Object.assign({ online: false, p: 0, q: 0, inj: {}, quietFirst: false }, opts || {});
    this.h = new Uint8Array(N); this.v = new Uint8Array(N); this.D = new Uint8Array(N);
    this.F1 = new Uint8Array(4 * N); this.F2 = new Uint8Array(4 * N);
    this.A1 = new Uint8Array(4 * N); this.A2 = new Uint8Array(4 * N);
    this.S1 = new Uint16Array(4 * N); this.S2 = new Uint16Array(4 * N);
    this.it = 0; this.ph = 0; this.rng = Math.random;
  }
  const FIELDS = ['h', 'v', 'D', 'F1', 'F2', 'A1', 'A2', 'S1', 'S2'];

  Decoder.prototype.snapshot = function () {
    const s = { it: this.it, ph: this.ph };
    for (const f of FIELDS) s[f] = this[f].slice();
    return s;
  };
  Decoder.prototype.restore = function (s) {
    this.it = s.it; this.ph = s.ph;
    for (const f of FIELDS) this[f].set(s[f]);
  };

  // defect pattern produced by edge sets (ch, cv)
  Decoder.prototype.syndrome = function (ch, cv) {
    const d = this.d, out = new Uint8Array(this.N);
    for (let i = 0; i < d; i++) for (let j = 0; j < d; j++)
      out[i * d + j] = ch[i * d + j] ^ ch[i * d + (j + 1) % d] ^ cv[i * d + j] ^ cv[((i + d - 1) % d) * d + j];
    return out;
  };
  Decoder.prototype.applyCorrection = function (ch, cv) {
    const s = this.syndrome(ch, cv);
    for (let n = 0; n < this.N; n++) { this.h[n] ^= ch[n]; this.v[n] ^= cv[n]; this.D[n] ^= s[n]; }
  };

  // phase 0: (online: new data errors) + (noisy) syndrome extraction + scheduled measurement errors
  Decoder.prototype.measure = function (quiet) {
    const N = this.N, o = this.o, r = this.rng;
    if (o.online && !quiet) for (let n = 0; n < N; n++) { if (r() < o.p) this.h[n] ^= 1; if (r() < o.p) this.v[n] ^= 1; }
    this.D = this.syndrome(this.h, this.v);
    if (o.online && !quiet && o.q > 0) for (let n = 0; n < N; n++) if (r() < o.q) this.D[n] ^= 1;
    for (const [i, j] of (o.inj[this.it] || [])) this.D[i * this.d + j] = 1;
  };

  Decoder.prototype.matching = function () {
    const d = this.d, D = this.D, ch = new Uint8Array(this.N), cv = new Uint8Array(this.N);
    for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) {
      if (!D[i * d + j]) continue;
      const E = (j + 1) % d, W = (j + d - 1) % d, Nn = (i + d - 1) % d, Ss = (i + 1) % d;
      if (D[i * d + E]) ch[i * d + E] = 1;       // east neighbour  -> h[i][j+1]
      if (D[i * d + W]) ch[i * d + j] = 1;       // west neighbour  -> h[i][j]
      if (D[Nn * d + j]) cv[Nn * d + j] = 1;     // row i-1 neighbour -> v[i-1][j]
      if (D[Ss * d + j]) cv[i * d + j] = 1;      // row i+1 neighbour -> v[i][j]
    }
    this.applyCorrection(ch, cv);
  };

  Decoder.prototype.propagate = function (X) {
    const d = this.d, N = this.N, out = new Uint8Array(4 * N);
    for (let k = 0; k < 4; k++) for (let i = 0; i < d; i++) for (let j = 0; j < d; j++)
      if (X[k * N + i * d + j]) out[k * N + ((i + DI[k] + d) % d) * d + (j + DJ[k] + d) % d] = 1;
    X.set(out);
  };

  Decoder.prototype.forward1 = function () {
    const N = this.N;
    for (let n = 0; n < N; n++) if (this.D[n]) for (let k = 1; k < 4; k++)
      if (!this.F1[k * N + n]) { this.F1[k * N + n] = 1; this.S1[k * N + n]++; }
    this.propagate(this.F1);
  };

  Decoder.prototype.forward2 = function () {
    const N = this.N, F1 = this.F1, F2 = this.F2, S2 = this.S2;
    const add = [];
    for (let n = 0; n < N; n++) {
      const c0 = this.D[n] | F1[N + n] | F1[3 * N + n], c1 = F1[2 * N + n];
      if (c0 && !F2[n]) add.push(n);
      if (c1 && !F2[N + n]) add.push(N + n);
      if (c1 && !F2[3 * N + n]) add.push(3 * N + n);
    }
    for (const x of add) { F2[x] = 1; S2[x]++; }
    this.propagate(F2);
  };

  Decoder.prototype.attraction = function () {
    const d = this.d, N = this.N, D = this.D, F1 = this.F1, F2 = this.F2;
    const ch = new Uint8Array(N), cv = new Uint8Array(N);
    for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) {
      const n = i * d + j; if (!D[n]) continue;
      const a1 = F1[N + n], a2 = F1[2 * N + n], a3 = F1[3 * N + n];
      const b0 = F2[n], b1 = F2[N + n], b3 = F2[3 * N + n];
      const up = ((i + d - 1) % d) * d + j, rt = i * d + (j + 1) % d;
      const c11 = a1 && !a2 && !a3, c12 = a2, c13 = a3 && !a1 && !a2;
      if (c11) cv[up] = 1; if (c12) ch[rt] = 1; if (c13) cv[n] = 1;
      if (!(c11 || c12 || c13)) {
        if (b0) ch[n] = 1;
        if (b1 && !b0 && !b3) cv[up] = 1;
        if (b3 && !b0 && !b1) cv[n] = 1;
      }
    }
    this.applyCorrection(ch, cv);
  };

  Decoder.prototype.antiCreate = function () {
    const N = this.N, D = this.D, F1 = this.F1, A1 = this.A1, A2 = this.A2, S1 = this.S1, S2 = this.S2;
    const mv = [];
    for (let n = 0; n < N; n++) {
      if (!D[n]) for (let k = 1; k < 4; k++) if (!A1[k * N + n] && S1[k * N + n] > 0) mv.push([A1, S1, k * N + n]);
      const c0 = !D[n] && !F1[N + n] && !F1[3 * N + n], c1 = !F1[2 * N + n];
      if (c0 && !A2[n] && S2[n] > 0) mv.push([A2, S2, n]);
      if (c1 && !A2[N + n] && S2[N + n] > 0) mv.push([A2, S2, N + n]);
      if (c1 && !A2[3 * N + n] && S2[3 * N + n] > 0) mv.push([A2, S2, 3 * N + n]);
    }
    for (const [A, S, x] of mv) { A[x] = 1; S[x]--; }
  };

  Decoder.prototype.antiPropagate = function () {
    for (const [F, A] of [[this.F1, this.A1], [this.F2, this.A2]]) {
      this.propagate(A);
      for (let x = 0; x < A.length; x++) if (F[x] && A[x]) { F[x] = 0; A[x] = 0; }
    }
  };

  // advance one micro-step: frame (it,ph) -> next frame
  Decoder.prototype.step = function () {
    switch (this.ph) {
      case 0: this.matching(); break;
      case 1: this.forward1(); break;
      case 2: this.forward2(); break;
      case 3: this.attraction(); break;
      case 4: this.antiCreate(); break;
      case 8: this.it++; this.ph = -1; this.measure(false); break;   // next iteration: new measurement
      default: this.antiPropagate();                                  // ph 5,6,7
    }
    this.ph++;
  };

  // first measurement of a run (frame "1.0")
  Decoder.prototype.start = function () { this.it = 0; this.ph = 0; this.measure(this.o.quietFirst); };

  Decoder.prototype.stats = function () {
    const s = a => { let t = 0; for (let x = 0; x < a.length; x++) t += a[x]; return t; };
    const d = this.d, N = this.N; let lx = 0, ly = 0;
    for (let j = 0; j < d; j++) lx ^= this.v[j];           // v[0][*]
    for (let i = 0; i < d; i++) ly ^= this.h[i * d];       // h[*][0]
    const defects = s(this.D), fwd = s(this.F1) + s(this.F2), anti = s(this.A1) + s(this.A2), stack = s(this.S1) + s(this.S2);
    return { defects, errors: s(this.h) + s(this.v), fwd, anti, stack, lx, ly,
             clear: defects + fwd + anti + stack === 0 };
  };

  root.Decoder = Decoder;
  if (typeof module !== 'undefined') module.exports = Decoder;
})(typeof window !== 'undefined' ? window : globalThis);
