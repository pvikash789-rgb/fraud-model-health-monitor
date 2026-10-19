// Driftmeter simulation engine. Pure JS, runs in the browser or node.
const DM = (function () {
  const N = 3000, H = 80, D = 150, SIM_BASE = 0.006, NF = 8, LEGIT_KEEP = 0.05, WINDOW = 45, NETK = 30;
  const FEATURES = [
    { key: 'amt', label: 'Transaction amount' },
    { key: 'night', label: 'Night-time (12am to 5am)' },
    { key: 'cnp', label: 'Card not present' },
    { key: 'newdev', label: 'New device' },
    { key: 'vel', label: 'Txns per card per hour' },
    { key: 'digital', label: 'Digital goods / gift cards' },
    { key: 'geo', label: 'Location mismatch' },
    { key: 'age', label: 'Account age' }
  ];
  const PROFILES = {
    legit:    { amt: 1.0, sig: 0.9, night: .06, cnp: .35, newdev: .05, vb: 1, vl: .4, digital: .15, geo: .03, age: 'uni' },
    festive:  { amt: 1.7, sig: 0.9, night: .07, cnp: .52, newdev: .11, vb: 1, vl: .8, digital: .22, geo: .08, age: 'uni' },
    oldFraud: { amt: 3.5, sig: 0.8, night: .35, cnp: .85, newdev: .60, vb: 1, vl: 1.2, digital: .20, geo: .45, age: 'young' }
  };
  const ATTACKS = {
    ato:      { name: 'Account takeover via OTP phishing', amt: 2.2, sig: .5, night: .07, cnp: .90, newdev: .08, vb: 2, vl: 2, digital: .75, geo: .04, age: 'old',
                blurb: 'Fraudsters phish the OTP and spend from the victim’s own phone, in daytime, on an old trusted account. Every signal the old model relies on says "safe".' },
    bustout:  { name: 'Synthetic identity bust-out', amt: 3.0, sig: .5, night: .05, cnp: .55, newdev: .05, vb: 3, vl: 3, digital: .55, geo: .02, age: 'mid',
                blurb: 'Fake identities build a clean history for months, then max out every line in a few days. The accounts look aged, local and loyal.' },
    giftcard: { name: 'Gift card cash-out', amt: 4.0, sig: .3, night: .20, cnp: .95, newdev: .25, vb: 1, vl: 1.5, digital: .98, geo: .05, age: 'mid',
                blurb: 'Compromised accounts buy high-value gift cards and wallet top-ups that are resold within hours. Locations and devices look normal.' }
  };
  const PRESETS = {
    india:   { name: 'Indian retail bank', cur: 'INR', ticket: 1800, volume: 1500000, realRate: 0.0004, delay: 10 },
    issuer:  { name: 'Global card issuer', cur: 'USD', ticket: 85, volume: 4000000, realRate: 0.0006, delay: 21 },
    neobank: { name: 'Digital bank', cur: 'USD', ticket: 40, volume: 600000, realRate: 0.0009, delay: 5 },
    network: { name: 'Card network (multi-issuer)', cur: 'USD', ticket: 70, volume: 20000000, realRate: 0.0005, delay: 30 }
  };
  const STRATS = [
    { key: 'frozen', name: 'Frozen model', rule: 'Never retrained' },
    { key: 'scheduled', name: 'Monthly retrain', rule: 'Every 30 days' },
    { key: 'triggered', name: 'Drift-triggered', rule: 'When monitor alarms' },
    { key: 'continuous', name: 'Weekly retrain', rule: 'Every 7 days' },
    { key: 'network', name: 'Network-informed', rule: 'Drift-triggered + peer-bank fraud' }
  ];

  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  function generate(cfg) {
    const rnd = mulberry32(cfg.seed);
    const gauss = () => { let u = 0; while (u === 0) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
    const pois = l => { const L = Math.exp(-l); let k = 0, p = 1; do { k++; p *= rnd(); } while (p > L); return k - 1; };
    const age = k => k === 'young' ? Math.pow(rnd(), 2.5) : k === 'old' ? 1 - Math.pow(rnd(), 2.5) : k === 'mid' ? 0.3 + 0.5 * rnd() : rnd();
    const T = PRESETS[cfg.preset].ticket, atkP = ATTACKS[cfg.attack];
    const days = [];
    for (let d = 0; d < H + D; d++) {
      const dd = d - H;
      const fest = cfg.festive && dd >= 100 && dd <= 114;
      const atk = dd >= cfg.attackDay ? SIM_BASE * cfg.intensity * Math.min(1, (dd - cfg.attackDay + 1) / 7) : 0;
      const X = new Float32Array(N * NF), y = new Uint8Array(N), amt = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const u = rnd();
        let p, lab;
        if (u < SIM_BASE) { p = PROFILES.oldFraud; lab = 1; }
        else if (u < SIM_BASE + atk) { p = atkP; lab = 2; }
        else { p = fest ? PROFILES.festive : PROFILES.legit; lab = 0; }
        const a = T * p.amt * Math.exp(p.sig * gauss());
        const o = i * NF;
        X[o] = Math.log10(a);
        X[o + 1] = rnd() < p.night ? 1 : 0;
        X[o + 2] = rnd() < p.cnp ? 1 : 0;
        X[o + 3] = rnd() < p.newdev ? 1 : 0;
        X[o + 4] = (p.vb + pois(p.vl)) / 10;
        X[o + 5] = rnd() < p.digital ? 1 : 0;
        X[o + 6] = rnd() < p.geo ? 1 : 0;
        X[o + 7] = age(p.age);
        y[i] = lab; amt[i] = a;
      }
      days.push({ X, y, amt });
    }
    // peer banks hit by the same attack earlier share confirmed fraud (consortium signal)
    const r2 = mulberry32(cfg.seed + 99);
    const g2 = () => { let u = 0; while (u === 0) u = r2(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r2()); };
    const p2 = l => { const L = Math.exp(-l); let k = 0, p = 1; do { k++; p *= r2(); } while (p > L); return k - 1; };
    const a2 = k => k === 'young' ? Math.pow(r2(), 2.5) : k === 'old' ? 1 - Math.pow(r2(), 2.5) : k === 'mid' ? 0.3 + 0.5 * r2() : r2();
    const netStart = H + cfg.attackDay - (cfg.netLead || 0);
    for (let d = 0; d < days.length; d++) {
      const k = d < netStart ? 0 : Math.round(NETK * Math.min(1, (d - netStart + 1) / 7));
      const X = new Float32Array(k * NF);
      for (let i = 0; i < k; i++) {
        const p = atkP, o = i * NF;
        X[o] = Math.log10(T * p.amt * Math.exp(p.sig * g2()));
        X[o + 1] = r2() < p.night ? 1 : 0; X[o + 2] = r2() < p.cnp ? 1 : 0; X[o + 3] = r2() < p.newdev ? 1 : 0;
        X[o + 4] = (p.vb + p2(p.vl)) / 10; X[o + 5] = r2() < p.digital ? 1 : 0; X[o + 6] = r2() < p.geo ? 1 : 0; X[o + 7] = a2(p.age);
      }
      days[d].net = { X, k };
    }
    return days;
  }

  const NE = NF + NF * (NF - 1) / 2;
  function expand(X, o, e) {
    for (let j = 0; j < NF; j++) e[j] = X[o + j];
    let k = NF;
    for (let a = 0; a < NF; a++) for (let c = a + 1; c < NF; c++) e[k++] = X[o + a] * X[o + c];
    return e;
  }
  const EB = new Float64Array(NE);
  function score(m, X, o) {
    expand(X, o, EB);
    let s = m.b;
    for (let j = 0; j < NE; j++) s += m.w[j] * (EB[j] - m.mu[j]) / m.sd[j];
    return s;
  }

  function train(days, from, to, budget, rnd, useNet) {
    const rows = [], ys = [], sw = [], amts = [];
    for (let d = Math.max(0, from); d <= to; d++) {
      const { X, y, amt } = days[d];
      for (let i = 0; i < N; i++) {
        if (y[i] > 0) { rows.push(expand(X, i * NF, new Float64Array(NE))); ys.push(1); sw.push(1); amts.push(amt[i]); }
        else if (rnd() < LEGIT_KEEP) { rows.push(expand(X, i * NF, new Float64Array(NE))); ys.push(0); sw.push(1 / LEGIT_KEEP); amts.push(amt[i]); }
      }
      if (useNet && days[d].net) { const nt = days[d].net; for (let i = 0; i < nt.k; i++) { rows.push(expand(nt.X, i * NF, new Float64Array(NE))); ys.push(1); sw.push(0); amts.push(0); } }
    }
    const n = rows.length;
    const mu = new Array(NE).fill(0), sd = new Array(NE).fill(0), fraudMean = new Array(NF).fill(0);
    let nPos = 0;
    for (let r = 0; r < n; r++) for (let j = 0; j < NE; j++) mu[j] += rows[r][j] / n;
    for (let r = 0; r < n; r++) for (let j = 0; j < NE; j++) sd[j] += (rows[r][j] - mu[j]) ** 2 / n;
    for (let j = 0; j < NE; j++) sd[j] = Math.sqrt(sd[j]) || 1;
    for (let r = 0; r < n; r++) if (ys[r]) { nPos++; for (let j = 0; j < NF; j++) fraudMean[j] += rows[r][j]; }
    for (let j = 0; j < NF; j++) fraudMean[j] /= Math.max(1, nPos);
    const Z = new Float64Array(n * NE);
    for (let r = 0; r < n; r++) for (let j = 0; j < NE; j++) Z[r * NE + j] = (rows[r][j] - mu[j]) / sd[j];
    const posW = (n - nPos) / Math.max(1, nPos) * 0.3;
    const w = new Array(NE).fill(0); let b = 0;
    const mw = new Array(NE + 1).fill(0), vw = new Array(NE + 1).fill(0);
    const lr = 0.08, l2 = 1e-3, b1 = 0.9, b2 = 0.999;
    let wsum = 0; for (let r = 0; r < n; r++) wsum += ys[r] ? posW : 1;
    for (let it = 1; it <= 90; it++) {
      const g = new Array(NE + 1).fill(0);
      for (let r = 0; r < n; r++) {
        let z = b; const o = r * NE;
        for (let j = 0; j < NE; j++) z += w[j] * Z[o + j];
        const p = 1 / (1 + Math.exp(-z));
        const e = (p - ys[r]) * (ys[r] ? posW : 1);
        for (let j = 0; j < NE; j++) g[j] += e * Z[o + j];
        g[NE] += e;
      }
      for (let j = 0; j <= NE; j++) {
        let gj = g[j] / wsum + (j < NE ? l2 * w[j] : 0);
        mw[j] = b1 * mw[j] + (1 - b1) * gj; vw[j] = b2 * vw[j] + (1 - b2) * gj * gj;
        const step = lr * (mw[j] / (1 - b1 ** it)) / (Math.sqrt(vw[j] / (1 - b2 ** it)) + 1e-8);
        if (j < NE) w[j] -= step; else b -= step;
      }
    }
    const m = { w, b, mu, sd, fraudMean, from, to, posW };
    // threshold: flag the top `budget` share of (reweighted) traffic
    const sc = rows.map((x, r) => { let s = b; for (let j = 0; j < NE; j++) s += w[j] * Z[r * NE + j]; return [s, sw[r], ys[r], amts[r]]; });
    sc.sort((a, c) => c[0] - a[0]);
    let tot = 0; for (const s of sc) tot += s[1];
    let cum = 0, thr = sc[sc.length - 1][0], caught = 0, fv = 0;
    for (const s of sc) { if (s[2]) fv += s[3]; }
    for (const s of sc) { cum += s[1]; if (s[2]) caught += s[3]; if (cum / tot >= budget) { thr = s[0]; break; } }
    m.thr = thr; m.expRecall = fv ? caught / fv : 0;
    // reference score distribution for PSI: last 7 days of the window, all traffic
    const ref = [];
    for (let d = Math.max(0, to - 6); d <= to; d++) { const { X } = days[d]; for (let i = 0; i < N; i++) ref.push(score(m, X, i * NF)); }
    ref.sort((a, c) => a - c);
    m.edges = []; for (let q = 1; q < 10; q++) m.edges.push(ref[Math.floor(ref.length * q / 10)]);
    return m;
  }

  function psi(m, day) {
    const cnt = new Array(10).fill(0);
    for (let i = 0; i < N; i++) {
      const s = score(m, day.X, i * NF);
      let k = 0; while (k < 9 && s > m.edges[k]) k++;
      cnt[k]++;
    }
    let v = 0;
    for (let k = 0; k < 10; k++) { const p = Math.max(cnt[k] / N, 1e-4); v += (p - 0.1) * Math.log(p / 0.1); }
    return v;
  }

  function windowRecall(m, days, from, to) {
    let c = 0, t = 0; const fm = new Array(NF).fill(0); let nf = 0;
    for (let d = from; d <= to; d++) {
      const { X, y, amt } = days[d];
      for (let i = 0; i < N; i++) if (y[i]) {
        t += amt[i]; nf++;
        for (let j = 0; j < NF; j++) fm[j] += X[i * NF + j];
        if (score(m, X, i * NF) >= m.thr) c += amt[i];
      }
    }
    return { rec: t ? c / t : 1, fraudMean: fm.map(v => v / Math.max(1, nf)) };
  }

  // ---- explainability: exact additive attribution per base feature (interaction terms split evenly) ----
  const PAIRS = []; for (let a = 0; a < NF; a++) for (let c = a + 1; c < NF; c++) PAIRS.push([a, c]);
  function attributeFraud(m, days, from, to) {
    const acc = new Array(NF).fill(0); let n = 0; const v = new Float64Array(NF);
    for (let d = from; d <= to; d++) {
      const { X, y } = days[d];
      for (let i = 0; i < N; i++) if (y[i]) {
        expand(X, i * NF, EB);
        for (let j = 0; j < NF; j++) v[j] = m.w[j] * (EB[j] - m.mu[j]) / m.sd[j];
        for (let k = 0; k < PAIRS.length; k++) { const t = m.w[NF + k] * (EB[NF + k] - m.mu[NF + k]) / m.sd[NF + k]; v[PAIRS[k][0]] += t / 2; v[PAIRS[k][1]] += t / 2; }
        for (let j = 0; j < NF; j++) acc[j] += v[j];
        n++;
      }
    }
    return acc.map(x => x / Math.max(1, n));
  }

  // ---- ranking metrics on imbalanced data ----
  function rankMetrics(sc, lab, budget, curvePts) {
    const n = sc.length, idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    idx.sort((a, c) => sc[c] - sc[a]);
    let P = 0; for (let i = 0; i < n; i++) P += lab[i];
    const Nn = n - P;
    let tp = 0, fp = 0, ap = 0, auc = 0, prevFp = 0, prevTp = 0;
    const k = Math.round(budget * n); let precAtK = 0, recAtK = 0;
    const curve = []; let nextR = 0;
    for (let r = 0; r < n; r++) {
      const i = idx[r];
      if (lab[i]) { tp++; ap += tp / (tp + fp); } else { fp++; auc += tp; }
      if (r + 1 === k) { precAtK = tp / k; recAtK = tp / Math.max(1, P); }
      if (curvePts && tp / P >= nextR && lab[i]) { curve.push([tp / P, tp / (tp + fp)]); nextR += 1 / curvePts; }
    }
    return { rocAuc: P && Nn ? auc / (P * Nn) : 0.5, prAuc: P ? ap / P : 0, precAtK, recAtK, base: P / n, curve };
  }
  function evalWindow(m, days, from, to, budget) {
    const sc = [], lab = [];
    for (let d = from; d <= to; d++) { const { X, y } = days[d]; for (let i = 0; i < N; i++) { sc.push(score(m, X, i * NF)); lab.push(y[i] ? 1 : 0); } }
    return rankMetrics(sc, lab, budget, 0);
  }

  // ---- data drift vs concept drift, per feature ----
  const BINARY = [1, 2, 3, 5, 6];
  function featureDrift(m, days, curTrafficFrom, curTrafficTo, curFraudFrom, curFraudTo) {
    const out = [];
    for (let j = 0; j < NF; j++) {
      const ref = [], cur = [];
      for (let d = m.to - 13; d <= m.to; d++) { const { X } = days[d]; for (let i = 0; i < N; i += 3) ref.push(X[i * NF + j]); }
      for (let d = curTrafficFrom; d <= curTrafficTo; d++) { const { X } = days[d]; for (let i = 0; i < N; i += 3) cur.push(X[i * NF + j]); }
      let edges;
      if (BINARY.includes(j)) edges = [0.5];
      else { const s = ref.slice().sort((a, c) => a - c); edges = []; for (let q = 1; q < 10; q++) edges.push(s[Math.floor(s.length * q / 10)]); }
      const bin = v => { let k = 0; while (k < edges.length && v > edges[k]) k++; return k; };
      const cr = new Array(edges.length + 1).fill(0), cc = new Array(edges.length + 1).fill(0);
      for (const v of ref) cr[bin(v)]++; for (const v of cur) cc[bin(v)]++;
      let p = 0;
      for (let k = 0; k < cr.length; k++) { const a = Math.max(cr[k] / ref.length, 1e-4), c = Math.max(cc[k] / cur.length, 1e-4); p += (c - a) * Math.log(c / a); }
      let fm = 0, nf = 0;
      for (let d = curFraudFrom; d <= curFraudTo; d++) { const { X, y } = days[d]; for (let i = 0; i < N; i++) if (y[i]) { fm += X[i * NF + j]; nf++; } }
      fm /= Math.max(1, nf);
      const z = (fm - m.fraudMean[j]) / m.sd[j];
      const type = p > 0.1 ? 'data' : Math.abs(z) > 0.3 ? 'concept' : 'stable';
      out.push({ f: FEATURES[j], psi: p, fraudBefore: m.fraudMean[j], fraudNow: fm, z, type });
    }
    return out;
  }

  // ---- threshold economics: missed fraud and false declines across alert rates ----
  function thresholdCurve(m, days, from, to) {
    const rows = [];
    let totalFraud = 0;
    for (let d = from; d <= to; d++) { const { X, y, amt } = days[d]; for (let i = 0; i < N; i++) { rows.push([score(m, X, i * NF), y[i] ? amt[i] : -1]); if (y[i]) totalFraud += amt[i]; } }
    rows.sort((a, c) => c[0] - a[0]);
    const rates = []; for (let r = 0.0025; r <= 0.0601; r += 0.0025) rates.push(+r.toFixed(4));
    const missed = [], fd = [];
    let caught = 0, fdc = 0, ri = 0;
    for (let k = 0; k < rows.length && ri < rates.length; k++) {
      if (rows[k][1] >= 0) caught += rows[k][1]; else fdc++;
      if (k + 1 >= Math.round(rates[ri] * rows.length)) { missed.push(totalFraud - caught); fd.push(fdc); ri++; }
    }
    return { rates, missed, fd, days: to - from + 1 };
  }

  function run(cfg) {
    const days = generate(cfg);
    const P = PRESETS[cfg.preset];
    const lossScale = P.volume / N * P.realRate / SIM_BASE;
    const volScale = P.volume / N;
    const trnd = mulberry32(cfg.seed + 7);
    const avail0 = H - cfg.delay - 1;
    const init = train(days, avail0 - WINDOW + 1, avail0, cfg.budget, trnd);
    const out = { cfg, P, lossScale, volScale, init, strategies: {}, monitor: { rec: [], psi: [], exp: [] }, alerts: [], incident: null, registry: [{ version: 1, dd: 0, reason: 'initial', trainWin: [init.from - H, init.to - H], promoted: true }] };
    let version = 1;
    out.netRegistry = [{ version: 1, dd: 0, reason: 'initial', trainWin: [init.from - H, init.to - H], promoted: true }];
    for (const S of STRATS) {
      let m = init, last = 0, psiHigh = 0, ver = 1, netFired = false;
      const isNet = S.key === 'network';
      const r = { caught: [], total: [], fd: [], flagged: [], retrains: [], rejected: 0, model: m, versions: [{ dd: 0, v: 1, m: init }] };
      const postSc = [], postLab = [];
      for (let dd = 0; dd < D; dd++) {
        const d = H + dd, avail = d - cfg.delay - 1;
        let retrain = false, reason = null;
        if (S.key === 'scheduled') retrain = dd > 0 && dd % 30 === 0;
        else if (S.key === 'continuous') retrain = dd > 0 && dd % 7 === 0;
        else if (S.key === 'triggered' || isNet) {
          const wr = windowRecall(m, days, avail - 6, avail);
          const p = psi(m, days[d - 1]);
          psiHigh = p > 0.2 ? psiHigh + 1 : 0;
          if (!isNet) { out.monitor.rec.push(wr.rec); out.monitor.psi.push(p); out.monitor.exp.push(m.expRecall); }
          const alarmA = wr.rec < cfg.alarmRatio * m.expRecall;
          const alarmB = psiHigh >= 2;
          let alarmN = false;
          if (isNet && !netFired) { let cnt = 0; for (let q = avail - WINDOW + 1; q <= avail; q++) cnt += days[q].net ? days[q].net.k : 0; alarmN = cnt >= 60; }
          if ((alarmA || alarmB || alarmN) && dd - last >= 7) {
            reason = alarmN ? 'network' : alarmA ? 'recall' : 'traffic';
            const drift = isNet ? [] : featureDrift(m, days, d - 2, d - 1, avail - 6, avail);
            const driftType = (reason === 'traffic' || drift.some(x => x.type === 'data')) ? 'data' : drift.some(x => x.type === 'concept') ? 'concept' : 'stable';
            // challenger trained out-of-time: holds back the newest 7 labelled days for validation
            const chall = train(days, avail - 7 - WINDOW + 1, avail - 7, cfg.budget, trnd, isNet);
            const champEval = evalWindow(m, days, avail - 6, avail, cfg.budget);
            const challEval = evalWindow(chall, days, avail - 6, avail, cfg.budget);
            // a network alert is proactive: local data has no attack yet, so the gate is 'no worse on our own traffic'
            const promoted = alarmN ? challEval.prAuc >= champEval.prAuc - 0.01 : challEval.prAuc > champEval.prAuc + 0.01;
            if (alarmN) netFired = true;
            const alert = { dd, reason, rec: wr.rec, exp: m.expRecall, psi: p, drift, driftType, champ: champEval, chall: challEval, promoted };
            if (promoted) retrain = true; else r.rejected++;
            last = dd;
            (isNet ? out.netRegistry : out.registry).push({ version: promoted ? ++ver : null, dd, reason, driftType, trainWin: [avail - WINDOW + 1 - H, avail - H], valWin: [avail - 6 - H, avail - H], champAp: champEval.prAuc, challAp: challEval.prAuc, champPrec: champEval.precAtK, challPrec: challEval.precAtK, promoted });
            if (!isNet && alarmA && !out.incident && dd >= cfg.attackDay) {
              alert.shift = FEATURES.map((f, j) => ({ f, before: m.fraudMean[j], now: wr.fraudMean[j], z: (wr.fraudMean[j] - m.fraudMean[j]) / m.sd[j] }));
              out.incident = alert;
            }
            if (!isNet) out.alerts.push(alert);
          }
        }
        if (retrain) { m = train(days, avail - WINDOW + 1, avail, cfg.budget, trnd, isNet); last = dd; r.retrains.push(dd); if (S.key === 'triggered' || isNet) r.versions.push({ dd, v: ver, m }); }
        const { X, y, amt } = days[d];
        let c = 0, t = 0, fd = 0, fl = 0;
        for (let i = 0; i < N; i++) {
          const sv = score(m, X, i * NF);
          const hit = sv >= m.thr;
          if (dd >= cfg.attackDay) { postSc.push(sv); postLab.push(y[i] ? 1 : 0); }
          if (hit) fl++;
          if (y[i]) { t += amt[i]; if (hit) c += amt[i]; } else if (hit) fd++;
        }
        r.caught.push(c); r.total.push(t); r.fd.push(fd); r.flagged.push(fl / N);
      }
      if (S.key === 'triggered') version = ver;
      r.model = m;
      r.metrics = rankMetrics(postSc, postLab, cfg.budget, 40);
      out.strategies[S.key] = r;
    }
    // explainability: what v1 vs the latest live drift-triggered model reward, on the same recent fraud
    const live = out.strategies.triggered.model;
    const efrom = H + D - 30 - cfg.delay, eto = H + D - 1 - cfg.delay;
    out.explain = { v1: attributeFraud(init, days, efrom, eto), live: attributeFraud(live, days, efrom, eto), liveVersion: version };
    out.econ = thresholdCurve(live, days, H + D - 30, H + D - 1);
    out.econFrozen = thresholdCurve(init, days, H + D - 30, H + D - 1);
    const compact = m => ({ w: m.w, b: m.b, mu: m.mu, sd: m.sd, thr: m.thr, posW: m.posW });
    out.versions = {};
    for (const k of ['triggered', 'network']) out.versions[k] = out.strategies[k].versions.map(x => ({ dd: x.dd, v: x.v, m: compact(x.m) }));
    for (const k in out.strategies) { delete out.strategies[k].model; delete out.strategies[k].versions; }
    // sample transactions at checkpoint days for the per-transaction inspector
    const srnd = mulberry32(cfg.seed + 5);
    const inc = out.incident ? out.incident.dd : Math.min(D - 1, cfg.attackDay + 20);
    const cps = [...new Set([Math.max(0, cfg.attackDay - 5), Math.min(D - 1, cfg.attackDay + 7), inc, D - 8].map(v => Math.max(0, Math.min(D - 1, v))))].sort((a, b) => a - b);
    out.samples = cps.map(dd => {
      const { X, y, amt } = days[H + dd], rows = [];
      for (let i = 0; i < N; i++) if (y[i] || srnd() < 30 / N) rows.push({ id: (dd + 1) * 10000 + i, x: Array.from(X.subarray(i * NF, i * NF + NF)), y: y[i], amt: amt[i] });
      return { dd, rows };
    });
    delete out.init;
    out.initExp = init.expRecall;
    return out;
  }

  function rolling(num, den, k) {
    const res = [];
    for (let i = 0; i < num.length; i++) {
      let a = 0, b = 0;
      for (let j = Math.max(0, i - k + 1); j <= i; j++) { a += num[j]; b += den ? den[j] : 1; }
      res.push(den ? (b ? a / b : 1) : a / b);
    }
    return res;
  }

  function summarize(out) {
    const { cfg, lossScale, volScale } = out;
    const res = {};
    for (const S of STRATS) {
      const r = out.strategies[S.key];
      const rr = rolling(r.caught, r.total, 7);
      const pre = rr.slice(Math.max(0, cfg.attackDay - 14), cfg.attackDay);
      const preAvg = pre.reduce((a, b) => a + b, 0) / pre.length;
      let dip = 1;
      for (let dd = cfg.attackDay; dd < D; dd++) dip = Math.min(dip, rr[dd]);
      let c = 0, t = 0, fd = 0;
      for (let dd = 0; dd < D; dd++) { c += r.caught[dd]; t += r.total[dd]; fd += r.fd[dd]; }
      let ca = 0, ta = 0;
      for (let dd = cfg.attackDay; dd < D; dd++) { ca += r.caught[dd]; ta += r.total[dd]; }
      res[S.key] = { recall: c / t, recallAfter: ta ? ca / ta : 1, missed: (t - c) * lossScale, missedAfter: (ta - ca) * lossScale, fd: fd * volScale, retrains: r.retrains.length, rolling: rr, preAvg, dip };
    }
    return res;
  }

  const XB = new Float64Array(NE);
  function explainRow(m, x) {
    expand(x, 0, XB);
    const v = new Array(NF).fill(0); let z = m.b;
    for (let j = 0; j < NF; j++) { const t = m.w[j] * (XB[j] - m.mu[j]) / m.sd[j]; v[j] += t; z += t; }
    for (let k = 0; k < PAIRS.length; k++) { const t = m.w[NF + k] * (XB[NF + k] - m.mu[NF + k]) / m.sd[NF + k]; v[PAIRS[k][0]] += t / 2; v[PAIRS[k][1]] += t / 2; z += t; }
    // undo class weighting and legit downsampling to get a calibrated probability
    const prob = 1 / (1 + Math.exp(-(z - Math.log(m.posW) - Math.log(1 / LEGIT_KEEP))));
    return { contrib: v, z, prob, flag: z >= m.thr };
  }
  return { explainRow, N, H, D, NF, NE, FEATURES, PROFILES, ATTACKS, PRESETS, STRATS, run, summarize, rolling };
})();
if (typeof module !== 'undefined') module.exports = DM;
