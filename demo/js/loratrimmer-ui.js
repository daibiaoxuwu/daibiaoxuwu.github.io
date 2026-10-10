import { unitNoise, addScaled, stftDb, mul, rng } from './dsp.js';
import { BW, FS, geometry, downchirp, symbol, noiseAmp, decodeLoRaPhy, decodeTrimmer } from './loratrimmer-core.js';
import { linePlot, heatmap, palette } from './plot.js';

const $ = id => document.getElementById(id);
// Default noise seed 3 at -20 dB: a typical draw (LoRaPhy decodes 39% of seeds here, LoRaTrimmer 74%).
const state = { sf: 7, code: 48, jump: 150, snr: -20, seed: 3, phi0: 0.7, cand: null, zoom: null };
const cache = {};

// Largest value per output bucket, so narrow FFT peaks survive downsampling.
function decimateMax(arr, n) {
  if (arr.length <= n) return { y: Array.from(arr), step: 1 };
  const step = arr.length / n, y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let m = -Infinity;
    for (let j = Math.floor(i * step); j < Math.floor((i + 1) * step); j++) if (arr[j] > m) m = arr[j];
    y[i] = m;
  }
  return { y, step };
}

function compute() {
  const { sf, code, jump, snr, seed, phi0 } = state;
  const g = geometry(sf);
  const key = sf + ':' + seed;
  if (!cache.noise || cache.noiseKey !== key) { cache.noise = unitNoise(g.nsamp, seed); cache.noiseKey = key; }
  if (!cache.down || cache.downSf !== sf) { cache.down = downchirp(sf); cache.downSf = sf; }
  const { x: clean, split } = symbol(sf, code, phi0, phi0 + jump * Math.PI / 180);
  const amp = noiseAmp(clean, snr);
  const rx = addScaled(clean, cache.noise, amp);
  const base = decodeLoRaPhy(rx, sf, cache.down);
  const ours = decodeTrimmer(rx, sf, cache.down);
  return { g, clean, rx, split, base, ours };
}

function specOpts(g, fLo, fHi, win) {
  const hop = Math.max(4, g.nsamp / 128);
  return { win, hop, nfft: 1024, fLo, fHi };
}

function drawSpec(canvas, x, g, { fLo, fHi, win, range, split, zoom, regions, lines }) {
  const s = stftDb(x, FS, specOpts(g, fLo, fHi, win));
  const tEnd = g.nsamp / FS * 1e3;
  const pal = palette();
  return heatmap(canvas, {
    data: s.data, rows: s.rows, cols: s.cols, range,
    xlim: [0, tEnd], ylim: [s.fLo / 1e3, s.fHi / 1e3], xlabel: 'time (ms)', ylabel: 'kHz',
    overlay: (ctx, ax) => {
      for (const r of regions || []) {
        // window band along the top edge, plus the trim boundary
        ctx.fillStyle = r.color;
        ctx.fillRect(ax.X(r.t0), ax.T, ax.X(r.t1) - ax.X(r.t0), 7);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(ax.X(r.t1), ax.T); ctx.lineTo(ax.X(r.t1), ax.B); ctx.stroke();
      }
      for (const l of lines || []) {
        ctx.strokeStyle = l.color; ctx.lineWidth = 2; ctx.setLineDash(l.dash || []);
        ctx.beginPath(); ctx.moveTo(ax.X(l.t0), ax.Y(l.f)); ctx.lineTo(ax.X(l.t1), ax.Y(l.f)); ctx.stroke(); ctx.setLineDash([]);
      }
      if (split !== undefined) {
        const xx = ax.X(split / FS * 1e3);
        ctx.strokeStyle = pal.good; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(xx, ax.T); ctx.lineTo(xx, ax.B); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = pal.good; ctx.font = '600 11px Inter, sans-serif'; ctx.textBaseline = 'top';
        ctx.textAlign = xx > (ax.L + ax.R) / 2 ? 'right' : 'left';
        ctx.fillText('t₀ jump', xx + (ctx.textAlign === 'left' ? 4 : -4), ax.T + 2);
      }
      if (zoom !== undefined) {
        const a = ax.X(zoom / FS * 1e3), b = ax.X((zoom + 64) / FS * 1e3);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect(a, ax.T + 1, Math.max(2, b - a), ax.B - ax.T - 2);
      }
    },
  });
}

function zoomPlot(canvas, x, start, color) {
  const n = 64, y = new Float64Array(n), xs = new Float64Array(n);
  for (let i = 0; i < n; i++) { y[i] = x.re[start + i]; xs[i] = (start + i) / FS * 1e3; }
  let m = 0; for (const v of y) m = Math.max(m, Math.abs(v));
  linePlot(canvas, { series: [{ x: xs, y, color, width: 1.4 }], xlim: [xs[0], xs[n - 1]], ylim: [-m * 1.15, m * 1.15], noYTicks: true, xfmt: v => v.toFixed(3) });
}

function verdict(el, est, code) {
  el.className = 'verdict ' + (est === code ? 'ok' : 'bad');
  el.textContent = est === code ? `✓ decoded ${est} (correct)` : `✗ decoded ${est}, sent ${code}`;
}

function render() {
  const r = compute(), { g, clean, rx, split, base, ours } = r;
  const pal = palette();
  const N = g.nClasses, code = state.code;
  if (state.cand === null || state.cand >= N) state.cand = code;
  if (state.zoom === null || state.zoom > g.nsamp - 64) state.zoom = Math.max(0, Math.min(g.nsamp - 64, split - 32));
  const tEnd = g.nsamp / FS * 1e3, t0 = split / FS * 1e3;

  // 1 · signal
  drawSpec($('specClean'), clean, g, { fLo: -BW, fHi: BW, win: 96, range: 40, split, zoom: state.zoom });
  drawSpec($('specNoisy'), rx, g, { fLo: -BW, fHi: BW, win: 96, range: 22, split, zoom: state.zoom });
  zoomPlot($('zoomClean'), clean, state.zoom, pal.ink);
  zoomPlot($('zoomNoisy'), rx, state.zoom, pal.muted);
  $('zoomv').textContent = `samples ${state.zoom}–${state.zoom + 63}`;

  // 2 · LoRaPhy
  const f0 = code * BW / N;
  drawSpec($('dechirp'), base.dechirped, g, {
    fLo: -BW, fHi: BW, win: 256, range: 22, split,
    lines: [{ t0: 0, t1: t0, f: f0 / 1e3, color: pal.good, dash: [2, 4] }, { t0, t1: tEnd, f: (f0 - BW) / 1e3, color: pal.good, dash: [2, 4] }],
  });
  const n = N * base.up, L = base.spec.length;
  const both = new Float64Array(2 * n);
  both.set(base.spec.subarray(L - n), 0); both.set(base.spec.subarray(0, n), n);
  const dFull = decimateMax(both, 700);
  const xsFull = Array.from(dFull.y, (_, i) => (-BW + (i * dFull.step) / n * BW) / 1e3);
  linePlot($('fftfull'), {
    series: [{ x: xsFull, y: dFull.y, color: pal.base, fill: true }], xlim: [-125, 125], xlabel: 'kHz', noYTicks: true,
    marks: [{ x: f0 / 1e3, color: pal.good, label: 'f₀' }, { x: (f0 - BW) / 1e3, color: pal.good, label: 'f₀−125k' }],
  });
  const dF = decimateMax(base.folded, 700);
  const xsF = Array.from(dF.y, (_, i) => i * dF.step / base.up);
  let fmax = 0; for (const v of base.folded) fmax = Math.max(fmax, v);
  linePlot($('folded'), {
    series: [{ x: xsF, y: dF.y, color: pal.base, fill: true }], xlim: [0, N], xlabel: 'symbol value', noYTicks: true,
    marks: [{ x: code, color: pal.good, label: 'sent', bottom: true }],
    points: [{ x: base.est, y: fmax, color: base.est === code ? pal.good : pal.bad, shape: 'v', label: 'picked ' + base.est }],
  });
  verdict($('vBase'), base.est, code);

  // 3 · LoRaTrimmer
  const k = state.cand, shift = Math.trunc(k / N * g.nsamp), ks = g.nsamp - shift, tk = ks / FS * 1e3;
  $('cand').max = N - 1; $('cand').value = k; $('candv').textContent = k;
  drawSpec($('trim'), base.dechirped, g, {
    fLo: -BW, fHi: BW, win: 256, range: 22,
    regions: [{ t0: 0, t1: tk, color: pal.ours }, { t0: tk, t1: tEnd, color: pal.base }],
    lines: [{ t0: 0, t1: tk, f: k * BW / N / 1e3, color: pal.ours }, { t0: tk, t1: tEnd, f: (k * BW / N - BW) / 1e3, color: pal.base }],
  });
  const p1 = ours.d1.re[k] ** 2 + ours.d1.im[k] ** 2, p2 = ours.d2.re[k] ** 2 + ours.d2.im[k] ** 2;
  let vmax = 0; for (const v of ours.vals) vmax = Math.max(vmax, v);
  const rank = 1 + Array.from(ours.vals).filter(v => v > ours.vals[k]).length;
  $('trimv').innerHTML = `|E1·x|² <b>${(p1 / vmax).toFixed(2)}</b> + |E2·x|² <b>${(p2 / vmax).toFixed(2)}</b> = <b>${((p1 + p2) / vmax).toFixed(2)}</b> of the best · rank <b>${rank}</b> of ${N}${k === code ? ' · this is the sent symbol' : ''}`;
  const e1 = new Float64Array(N), tot = new Float64Array(N);
  for (let i = 0; i < N; i++) { e1[i] = (ours.d1.re[i] ** 2 + ours.d1.im[i] ** 2) / vmax; tot[i] = ours.vals[i] / vmax; }
  linePlot($('parts'), {
    series: [{ y: tot, color: pal.base, bars: true }, { y: e1, color: pal.ours, bars: true }], xlim: [-0.5, N - 0.5], ylim: [0, 1.12], xlabel: 'symbol value', noYTicks: true,
    marks: [{ x: code, color: pal.good, label: 'sent', bottom: true }, { x: k, color: pal.ink, label: 'candidate', dash: [1, 3], row: 1 }],
  });
  linePlot($('vals'), {
    series: [{ y: tot, color: pal.ours, fill: true }], xlim: [0, N - 1], ylim: [0, 1.12], xlabel: 'symbol value', noYTicks: true,
    marks: [{ x: code, color: pal.good, label: 'sent', bottom: true }],
    points: [{ x: ours.est, y: 1, color: ours.est === code ? pal.good : pal.bad, shape: 'v', label: 'picked ' + ours.est }],
  });
  verdict($('vOurs'), ours.est, code);
}

// ---------------------------------------------------------------- controls
function syncLabels() {
  $('snrv').textContent = state.snr.toFixed(1) + ' dB';
  $('jumpv').textContent = state.jump + '°';
}
function bind() {
  $('sf').value = state.sf; $('code').value = state.code; $('jump').value = state.jump; $('snr').value = state.snr;
  syncLabels();
  $('sf').onchange = e => { state.sf = +e.target.value; const N = 1 << state.sf; state.code = Math.min(state.code, N - 1); $('code').max = N - 1; $('code').value = state.code; state.cand = null; state.zoom = null; render(); };
  $('code').oninput = e => { const N = 1 << state.sf; const v = Math.max(0, Math.min(N - 1, Math.round(+e.target.value || 0))); state.code = v; state.cand = v; state.zoom = null; render(); };
  $('jump').oninput = e => { state.jump = +e.target.value; syncLabels(); render(); };
  $('snr').oninput = e => { state.snr = +e.target.value; syncLabels(); render(); };
  $('newnoise').onclick = () => { state.seed = (Math.random() * 2 ** 31) | 0; render(); };
  $('newsym').onclick = () => {
    const N = 1 << state.sf, r = rng((Math.random() * 2 ** 31) | 0);
    state.code = Math.floor(r.uniform() * N); state.phi0 = r.uniform() * 2 * Math.PI;
    state.jump = 5 * Math.round(r.uniform() * 36); state.cand = state.code; state.zoom = null;
    $('code').value = state.code; $('jump').value = state.jump; syncLabels(); render();
  };
  $('cand').oninput = e => { state.cand = +e.target.value; render(); };
  $('toTrue').onclick = () => { state.cand = state.code; render(); };
  $('toBest').onclick = () => { state.cand = compute().ours.est; render(); };
  for (const id of ['specClean', 'specNoisy']) $(id).addEventListener('click', e => {
    const c = e.currentTarget, rect = c.getBoundingClientRect();
    const frac = (e.clientX - rect.left - 44) / (rect.width - 54);
    const g = geometry(state.sf);
    state.zoom = Math.max(0, Math.min(g.nsamp - 64, Math.round(frac * g.nsamp) - 32));
    render();
  });
  let t; window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(render, 120); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);
}

// ---------------------------------------------------------------- trials (worker)
let worker;
function getWorker() {
  if (!worker) worker = new Worker(new URL('./trimmer-worker.js', import.meta.url), { type: 'module' });
  return worker;
}
function runTrials() {
  const btn = $('runTrials'); btn.disabled = true; $('trialStatus').textContent = 'running…';
  const w = getWorker();
  w.onmessage = e => {
    const m = e.data;
    if (m.type === 'progress') { $('trialStatus').textContent = `${m.done}/${m.total}`; return; }
    if (m.type !== 'point') return;
    const pct = v => (100 * v).toFixed(0) + '%';
    $('accBase').textContent = pct(m.base); $('barBase').style.width = pct(m.base);
    $('accOurs').textContent = pct(m.ours); $('barOurs').style.width = pct(m.ours);
    $('trialStatus').textContent = `${m.n} symbols at ${state.snr.toFixed(1)} dB, SF${state.sf}`;
    btn.disabled = false;
  };
  w.postMessage({ sf: state.sf, snrs: [state.snr], n: 200, seed: (Math.random() * 2 ** 31) | 0, mode: 'single' });
}
function runSweep() {
  const btn = $('runSweep'); btn.disabled = true;
  const lo = { 7: -32, 8: -35, 9: -38 }[state.sf], snrs = [];
  for (let s = lo; s <= lo + 20; s += 2) snrs.push(s);
  const n = { 7: 100, 8: 60, 9: 30 }[state.sf];
  const pts = { base: [], ours: [], x: [] };
  const w = getWorker();
  const draw = () => {
    const pal = palette();
    linePlot($('sweep'), {
      series: [{ x: pts.x, y: pts.base, color: pal.base, width: 2 }, { x: pts.x, y: pts.ours, color: pal.ours, width: 2 }],
      xlim: [snrs[0], snrs[snrs.length - 1]], ylim: [0, 1.05], xlabel: 'SNR (dB)', yfmt: v => Math.round(v * 100) + '%',
      hlines: [{ y: 0.9, label: '90%' }],
    });
  };
  draw();
  w.onmessage = e => {
    const m = e.data;
    if (m.type === 'progress') { $('sweepStatus').textContent = `${m.snr} dB: ${m.done}/${m.total}`; return; }
    if (m.type === 'point') { pts.x.push(m.snr); pts.base.push(m.base); pts.ours.push(m.ours); draw(); }
    if (m.type === 'done') { $('sweepStatus').innerHTML = `SF${state.sf}, ${n} symbols per point · <span style="color:var(--c-base)">LoRaPhy</span> vs <span style="color:var(--c-ours)">LoRaTrimmer</span>`; btn.disabled = false; }
  };
  w.postMessage({ sf: state.sf, snrs, n, seed: (Math.random() * 2 ** 31) | 0, mode: 'sweep' });
}

bind();
render();
linePlot($('sweep'), { series: [], xlim: [-32, -12], ylim: [0, 1.05], xlabel: 'SNR (dB)', yfmt: v => Math.round(v * 100) + '%', hlines: [{ y: 0.9, label: '90%' }] });
$('runTrials').onclick = runTrials;
$('runSweep').onclick = runSweep;
// `#autorun` (used for automated screenshots) runs both trial panels on load.
if (location.hash === '#autorun') { runTrials(); setTimeout(runSweep, 4000); }
