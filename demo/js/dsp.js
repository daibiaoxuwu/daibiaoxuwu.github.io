// Small DSP toolkit shared by the demos: complex arrays, FFT, seeded noise, STFT.
// Complex vectors are {re: Float64Array, im: Float64Array}.

export function cvec(n) {
  return { re: new Float64Array(n), im: new Float64Array(n) };
}

export function cslice(x, start, end) {
  return { re: x.re.slice(start, end), im: x.im.slice(start, end) };
}

// In-place iterative radix-2 FFT. n must be a power of two.
// sign = -1 forward (numpy convention), +1 inverse (unnormalised).
const twiddleCache = new Map();
function twiddles(n) {
  let t = twiddleCache.get(n);
  if (!t) {
    t = { c: new Float64Array(n / 2), s: new Float64Array(n / 2) };
    for (let k = 0; k < n / 2; k++) {
      t.c[k] = Math.cos(2 * Math.PI * k / n);
      t.s[k] = Math.sin(2 * Math.PI * k / n);
    }
    twiddleCache.set(n, t);
  }
  return t;
}

export function fftInPlace(re, im, sign = -1) {
  const n = re.length;
  if (n & (n - 1)) throw new Error('fft length must be a power of two: ' + n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  const tw = twiddles(n);
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1, step = n / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const wr = tw.c[k * step], wi = sign * tw.s[k * step];
        const a = i + k, b = a + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
  }
}

// FFT of x zero-padded (or truncated) to n points; returns a new complex vector.
export function fft(x, n = x.re.length) {
  const out = cvec(n);
  const m = Math.min(n, x.re.length);
  out.re.set(x.re.subarray(0, m));
  out.im.set(x.im.subarray(0, m));
  fftInPlace(out.re, out.im, -1);
  return out;
}

export function fftshift(x) {
  const n = x.re.length, h = n >> 1, out = cvec(n);
  out.re.set(x.re.subarray(h)); out.re.set(x.re.subarray(0, h), n - h);
  out.im.set(x.im.subarray(h)); out.im.set(x.im.subarray(0, h), n - h);
  return out;
}

export function abs(x) {
  const n = x.re.length, out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.hypot(x.re[i], x.im[i]);
  return out;
}

export function mul(a, b) {
  const n = a.re.length, out = cvec(n);
  for (let i = 0; i < n; i++) {
    out.re[i] = a.re[i] * b.re[i] - a.im[i] * b.im[i];
    out.im[i] = a.re[i] * b.im[i] + a.im[i] * b.re[i];
  }
  return out;
}

export function argmax(arr) {
  let best = 0;
  for (let i = 1; i < arr.length; i++) if (arr[i] > arr[best]) best = i;
  return best;
}

// Seeded PRNG (mulberry32) and Box-Muller normals, so "New noise" is a new seed.
export function rng(seed) {
  let a = seed >>> 0;
  const uniform = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spare = null;
  const normal = () => {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let u = 0;
    while (u === 0) u = uniform();
    const v = uniform(), r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
  return { uniform, normal };
}

// Unit-variance complex noise (E|w|^2 = 1). The demos keep one realisation and
// rescale it, so moving the SNR slider changes the level but not the pattern.
export function unitNoise(n, seed) {
  const r = rng(seed), w = cvec(n), s = Math.SQRT1_2;
  for (let i = 0; i < n; i++) { w.re[i] = r.normal() * s; w.im[i] = r.normal() * s; }
  return w;
}

export function addScaled(x, w, scale) {
  const n = x.re.length, out = cvec(n);
  for (let i = 0; i < n; i++) {
    out.re[i] = x.re[i] + scale * w.re[i];
    out.im[i] = x.im[i] + scale * w.im[i];
  }
  return out;
}

// Short-time Fourier transform magnitude in dB, cropped to [fLo, fHi] Hz.
// Returns {data: Float32Array (rows = freq low->high, cols = time), rows, cols}.
export function stftDb(x, fs, { win = 96, hop = 8, nfft = 1024, fLo = -fs / 2, fHi = fs / 2 } = {}) {
  const n = x.re.length;
  const w = new Float64Array(win);
  for (let i = 0; i < win; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (win - 1));
  const kLo = Math.max(0, Math.round(fLo / fs * nfft + nfft / 2));
  const kHi = Math.min(nfft, Math.round(fHi / fs * nfft + nfft / 2));
  const rows = kHi - kLo;
  const cols = Math.max(1, Math.floor((n - win) / hop) + 1);
  const data = new Float32Array(rows * cols);
  const re = new Float64Array(nfft), im = new Float64Array(nfft);
  for (let c = 0; c < cols; c++) {
    re.fill(0); im.fill(0);
    const s = c * hop;
    for (let i = 0; i < win; i++) { re[i] = x.re[s + i] * w[i]; im[i] = x.im[s + i] * w[i]; }
    fftInPlace(re, im, -1);
    for (let r = 0; r < rows; r++) {
      const k = (kLo + r + nfft / 2) % nfft;           // fftshift index
      data[r * cols + c] = 10 * Math.log10(re[k] * re[k] + im[k] * im[k] + 1e-12);
    }
  }
  return { data, rows, cols, fLo: (kLo - nfft / 2) * fs / nfft, fHi: (kHi - nfft / 2) * fs / nfft };
}
