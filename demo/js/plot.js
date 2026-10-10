// Minimal canvas plotting for the demos: line/bar plots and heatmaps.
// Colours come from CSS custom properties so plots follow light/dark mode.

const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export const palette = () => ({
  ink: css('--ink'), muted: css('--muted'), faint: css('--faint'), grid: css('--line'),
  bg: css('--surface'), base: css('--c-base'), ours: css('--c-ours'),
  good: css('--c-good'), bad: css('--c-bad'), aux: css('--c-aux'),
});

// Prepare a canvas for crisp drawing at device pixel ratio. Height follows the
// CSS aspect ratio of the element.
export function setup(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

const PAD = { l: 44, r: 10, t: 10, b: 30 };

function niceTicks(lo, hi, n = 5) {
  const span = hi - lo || 1;
  const step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => span / s <= n) || 10 * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9 * span; v += step) out.push(+v.toFixed(10));
  return out;
}

function fmt(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toFixed(a % 1e6 ? 1 : 0) + 'M';
  if (a >= 1e3) return (v / 1e3).toFixed(a % 1e3 ? 1 : 0) + 'k';
  if (a > 0 && a < 0.01) return v.toExponential(0);
  return String(+v.toFixed(2));
}

function axes(ctx, w, h, x0, x1, y0, y1, opt, pal) {
  const L = PAD.l, R = w - PAD.r, T = PAD.t, B = h - PAD.b;
  ctx.font = '11px Inter, system-ui, sans-serif';
  ctx.strokeStyle = pal.grid; ctx.fillStyle = pal.muted; ctx.lineWidth = 1;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (const v of (opt.xticks || niceTicks(x0, x1))) {
    const x = L + (v - x0) / (x1 - x0) * (R - L);
    ctx.beginPath(); ctx.moveTo(x, B); ctx.lineTo(x, B + 4); ctx.stroke();
    ctx.fillText(opt.xfmt ? opt.xfmt(v) : fmt(v), x, B + 6);
  }
  if (!opt.noYTicks) {
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (const v of niceTicks(y0, y1, 4)) {
      const y = B - (v - y0) / (y1 - y0) * (B - T);
      ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(R, y); ctx.globalAlpha = 0.5; ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillText(opt.yfmt ? opt.yfmt(v) : fmt(v), L - 6, y);
    }
  }
  ctx.strokeStyle = pal.faint;
  ctx.beginPath(); ctx.moveTo(L, T); ctx.lineTo(L, B); ctx.lineTo(R, B); ctx.stroke();
  if (opt.xlabel) { ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillStyle = pal.faint; ctx.fillText(opt.xlabel, R, h - 1); }
  if (opt.ylabel) {
    ctx.save(); ctx.translate(11, T + (B - T) / 2); ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = pal.faint; ctx.fillText(opt.ylabel, 0, 0); ctx.restore();
  }
  return {
    X: v => L + (v - x0) / (x1 - x0) * (R - L),
    Y: v => B - (v - y0) / (y1 - y0) * (B - T),
    L, R, T, B,
  };
}

// series: [{x?: array, y: array, color, width?, fill?, dash?, alpha?}]
// marks:  [{x, color, label?, dash?}] vertical markers; points: [{x, y, color, label?, shape?}]
export function linePlot(canvas, { series, marks = [], points = [], hlines = [], xlim, ylim, ...opt }) {
  const { ctx, w, h } = setup(canvas);
  const pal = palette();
  let [x0, x1] = xlim || [0, Math.max(...series.map(s => s.y.length)) - 1];
  let y0 = 0, y1 = 1;
  if (ylim) [y0, y1] = ylim;
  else {
    let lo = Infinity, hi = -Infinity;
    for (const s of series) for (const v of s.y) { if (v < lo) lo = v; if (v > hi) hi = v; }
    y0 = opt.yFromZero === false ? lo : Math.min(0, lo); y1 = hi + (hi - y0) * 0.12 || 1;
  }
  const ax = axes(ctx, w, h, x0, x1, y0, y1, opt, pal);
  ctx.save(); ctx.beginPath(); ctx.rect(ax.L, ax.T - 2, ax.R - ax.L, ax.B - ax.T + 2); ctx.clip();
  for (const hl of hlines) {
    ctx.strokeStyle = hl.color || pal.faint; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(ax.L, ax.Y(hl.y)); ctx.lineTo(ax.R, ax.Y(hl.y)); ctx.stroke(); ctx.setLineDash([]);
    if (hl.label) { ctx.fillStyle = hl.color || pal.faint; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(hl.label, ax.R - 2, ax.Y(hl.y) - 2); }
  }
  for (const s of series) {
    const xs = s.x || null, n = s.y.length;
    ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 1.3; ctx.globalAlpha = s.alpha ?? 1;
    if (s.dash) ctx.setLineDash(s.dash);
    if (s.dots) {
      ctx.fillStyle = s.color;
      for (let i = 0; i < n; i++) {
        ctx.beginPath(); ctx.arc(ax.X(xs ? xs[i] : i), ax.Y(s.y[i]), s.r || 2, 0, 2 * Math.PI); ctx.fill();
      }
    } else if (s.bars) {
      ctx.fillStyle = s.color;
      const bw = Math.max(1, (ax.R - ax.L) / n * 0.8);
      for (let i = 0; i < n; i++) {
        const x = ax.X(xs ? xs[i] : i), y = ax.Y(s.y[i]);
        ctx.fillRect(x - bw / 2, y, bw, ax.Y(Math.max(y0, 0)) - y);
      }
    } else {
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = ax.X(xs ? xs[i] : i), y = ax.Y(s.y[i]);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
      if (s.fill) {
        ctx.lineTo(ax.X(xs ? xs[n - 1] : n - 1), ax.Y(Math.max(y0, 0)));
        ctx.lineTo(ax.X(xs ? xs[0] : 0), ax.Y(Math.max(y0, 0)));
        ctx.closePath(); ctx.fillStyle = s.color; ctx.globalAlpha = 0.14; ctx.fill();
      }
    }
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }
  ctx.restore();
  ctx.font = '600 11px Inter, system-ui, sans-serif';
  for (const m of marks) {
    const x = ax.X(m.x);
    ctx.strokeStyle = m.color; ctx.lineWidth = 1.2; ctx.setLineDash(m.dash || [3, 3]);
    ctx.beginPath(); ctx.moveTo(x, ax.T); ctx.lineTo(x, ax.B); ctx.stroke(); ctx.setLineDash([]);
    if (m.label) {
      ctx.fillStyle = m.color; ctx.textBaseline = 'top';
      ctx.textAlign = x > (ax.L + ax.R) / 2 ? 'right' : 'left';
      const ly = m.bottom ? ax.B - 15 : ax.T + (m.row || 0) * 14;
      ctx.fillText(m.label, x + (ctx.textAlign === 'left' ? 4 : -4), ly);
    }
  }
  for (const p of points) {
    const x = ax.X(p.x), y = ax.Y(p.y);
    ctx.fillStyle = p.color; ctx.beginPath();
    if (p.shape === 'v') { ctx.moveTo(x - 5, y - 9); ctx.lineTo(x + 5, y - 9); ctx.lineTo(x, y - 2); }
    else ctx.arc(x, y, 3.5, 0, 2 * Math.PI);
    ctx.fill();
    if (p.label) {
      ctx.textAlign = x > (ax.L + ax.R) / 2 ? 'right' : 'left'; ctx.textBaseline = 'bottom';
      ctx.fillText(p.label, x + (ctx.textAlign === 'left' ? 7 : -7), y - 9);
    }
  }
  return ax;
}

// Perceptual colormap (magma-like) as 256 RGB triples.
const MAGMA = [[0, 0, 4], [28, 16, 68], [79, 18, 123], [129, 37, 129], [181, 54, 122], [229, 80, 100], [251, 135, 97], [254, 194, 135], [252, 253, 191]];
const LUT = (() => {
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255 * (MAGMA.length - 1), k = Math.min(MAGMA.length - 2, Math.floor(t)), f = t - k;
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = MAGMA[k][c] * (1 - f) + MAGMA[k + 1][c] * f;
  }
  return lut;
})();

// Heatmap of data (rows x cols, row 0 drawn at the bottom). Values are mapped
// to [vmin, vmax] (default: top `range` dB below the max).
export function heatmap(canvas, { data, rows, cols, vmin, vmax, range, xlim, ylim, overlay, ...opt }) {
  const { ctx, w, h } = setup(canvas);
  const pal = palette();
  let hi = vmax, lo = vmin;
  if (hi === undefined) { hi = -Infinity; for (const v of data) if (v > hi) hi = v; }
  if (lo === undefined) {
    if (range !== undefined) lo = hi - range;
    else { lo = Infinity; for (const v of data) if (v < lo) lo = v; }
  }
  const img = new ImageData(cols, rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const v = data[r * cols + c];
    const i = Math.max(0, Math.min(255, Math.round((v - lo) / (hi - lo || 1) * 255)));
    const o = ((rows - 1 - r) * cols + c) * 4;
    img.data[o] = LUT[i * 3]; img.data[o + 1] = LUT[i * 3 + 1]; img.data[o + 2] = LUT[i * 3 + 2]; img.data[o + 3] = 255;
  }
  const off = new OffscreenCanvas(cols, rows);
  off.getContext('2d').putImageData(img, 0, 0);
  const [x0, x1] = xlim || [0, cols];
  const [y0, y1] = ylim || [0, rows];
  const ax = axes(ctx, w, h, x0, x1, y0, y1, opt, pal);
  ctx.imageSmoothingEnabled = opt.smooth !== false;
  ctx.drawImage(off, ax.L, ax.T, ax.R - ax.L, ax.B - ax.T);
  if (overlay) overlay(ctx, ax, pal);
  return ax;
}

// Phasors chained head to tail from the origin, with the resultant drawn bold.
// `scale` is the half-width of the view in data units, shared between panels
// so arrow lengths compare across them.
export function phasorPlot(canvas, { arrows, scale, resultantColor, label }) {
  const { ctx, w, h } = setup(canvas);
  const pal = palette();
  const cx = w / 2, cy = h / 2, k = Math.min(w, h) / 2 * 0.9 / scale;
  ctx.strokeStyle = pal.grid; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.stroke();
  const head = (x0, y0, x1, y1, color, width) => {
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    const a = Math.atan2(y1 - y0, x1 - x0), L = Math.min(8, Math.hypot(x1 - x0, y1 - y0) * 0.6);
    if (L < 2) return;
    ctx.beginPath(); ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - L * Math.cos(a - 0.4), y1 - L * Math.sin(a - 0.4));
    ctx.lineTo(x1 - L * Math.cos(a + 0.4), y1 - L * Math.sin(a + 0.4)); ctx.closePath(); ctx.fill();
  };
  let x = 0, y = 0;
  for (const ar of arrows) {
    const nx = x + ar.dx, ny = y + ar.dy;
    head(cx + x * k, cy - y * k, cx + nx * k, cy - ny * k, ar.color, 1.4);
    x = nx; y = ny;
  }
  ctx.setLineDash([4, 3]);
  head(cx, cy, cx + x * k, cy - y * k, resultantColor || pal.ink, 2.2);
  ctx.setLineDash([]);
  if (label) {
    ctx.font = '600 12px Inter, system-ui, sans-serif'; ctx.fillStyle = pal.ink; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(label, 8, 8);
  }
  return Math.hypot(x, y);
}

// One coloured cell per item, e.g. payload symbols right/wrong.
export function strip(canvas, cells) {
  const { ctx, w, h } = setup(canvas);
  const n = cells.length || 1, cw = w / n;
  cells.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(i * cw + 0.5, 4, Math.max(1, cw - 1.5), h - 8); });
}
