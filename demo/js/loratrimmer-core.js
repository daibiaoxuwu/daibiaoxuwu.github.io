// LoRaTrimmer demo core: symbol model, LoRaPhy (Abs+) baseline and LoRaTrimmer.
// Decoders are ports of github.com/LoRaTrimmer/LoRaTrimmer/main.py
// (gen_constants, decode_loraphy, decode_ours); parity is checked against it.
import { cvec, fft, abs, mul, argmax } from './dsp.js';

export const BW = 125e3, FS = 1e6;

export function geometry(sf) {
  const nClasses = 1 << sf;
  const nsamp = Math.round(nClasses * FS / BW);
  return { sf, nClasses, nsamp, T: nClasses / BW, beta: BW * BW / nClasses };
}

// scipy.signal.chirp(t, f0=bw/2, f1=-bw/2, t1=2^sf/bw, phi=90) + j*chirp(..., phi=0)
export function downchirp(sf) {
  const { nsamp, T } = geometry(sf);
  const d = cvec(nsamp), k = -BW / T;
  for (let i = 0; i < nsamp; i++) {
    const t = i / FS;
    const th = 2 * Math.PI * (BW / 2 * t + 0.5 * k * t * t);
    d.re[i] = Math.cos(th + Math.PI / 2);
    d.im[i] = Math.cos(th);
  }
  return d;
}

// One upchirp symbol `code` with the real frequency jump: the rising segment
// runs until t0 = (1 - code/N) T, then the chirp wraps to -bw/2 and continues.
// phi0 / phi1 are the carrier phases before and after the jump; real radios do
// not keep them continuous (LoRaTrimmer, Sec. 2 and Assumption 2).
export function symbol(sf, code, phi0, phi1) {
  const { nClasses, nsamp, T } = geometry(sf);
  const beta = BW / T, split = nsamp - Math.round(code / nClasses * nsamp);
  const x = cvec(nsamp), f0 = -BW / 2 + code * BW / nClasses;
  for (let i = 0; i < nsamp; i++) {
    let ph;
    if (i < split) { const t = i / FS; ph = phi0 + 2 * Math.PI * (f0 * t + 0.5 * beta * t * t); }
    else { const t = (i - split) / FS; ph = phi1 + 2 * Math.PI * (-BW / 2 * t + 0.5 * beta * t * t); }
    x.re[i] = Math.cos(ph); x.im[i] = Math.sin(ph);
  }
  return { x, split };
}

// Noise amplitude used by the reference: amp = 10^(-snr/20) * mean|y|,
// noise = amp/sqrt(2) * (randn + j randn)  ==  amp * (unit-variance complex noise).
export function noiseAmp(x, snrDb) {
  let s = 0;
  for (let i = 0; i < x.re.length; i++) s += Math.hypot(x.re[i], x.im[i]);
  return Math.pow(0.1, snrDb / 20) * s / x.re.length;
}

// LoRaPhy "Abs+" baseline: dechirp, zero-padded FFT, fold the two halves by
// adding magnitudes. The reference pads 100x; 128x keeps the FFT a power of two.
export function decodeLoRaPhy(x, sf, down = downchirp(sf), up = 128) {
  const { nClasses } = geometry(sf);
  const dechirped = mul(x, down);
  const spec = abs(fft(dechirped, dechirped.re.length * up));
  const n = nClasses * up;
  const cut1 = spec.subarray(0, n), cut2 = spec.subarray(spec.length - n);
  const folded = new Float64Array(n);
  for (let i = 0; i < n; i++) folded[i] = cut1[i] + cut2[i];
  const est = Math.round(argmax(folded) / up) % nClasses;
  return { dechirped, spec, cut1, cut2, folded, up, est };
}

// LoRaTrimmer: row k of E1 holds downchirp[shift_k:] over samples [0, split_k),
// row k of E2 holds downchirp[:shift_k] over [split_k, nsamp). Each candidate
// code is trimmed at its own frequency-jump sample; score = |E1 x|^2 + |E2 x|^2.
export function decodeTrimmer(x, sf, down = downchirp(sf)) {
  const { nClasses, nsamp } = geometry(sf);
  const d1 = cvec(nClasses), d2 = cvec(nClasses), vals = new Float64Array(nClasses);
  for (let k = 0; k < nClasses; k++) {
    const shift = Math.trunc(k / nClasses * nsamp), split = nsamp - shift;
    let ar = 0, ai = 0, br = 0, bi = 0;
    for (let i = 0; i < split; i++) {
      const dr = down.re[i + shift], di = down.im[i + shift];
      ar += dr * x.re[i] - di * x.im[i]; ai += dr * x.im[i] + di * x.re[i];
    }
    if (k !== 0) for (let i = split; i < nsamp; i++) {
      const dr = down.re[i - split], di = down.im[i - split];
      br += dr * x.re[i] - di * x.im[i]; bi += dr * x.im[i] + di * x.re[i];
    }
    d1.re[k] = ar; d1.im[k] = ai; d2.re[k] = br; d2.im[k] = bi;
    vals[k] = ar * ar + ai * ai + br * br + bi * bi;
  }
  return { d1, d2, vals, est: argmax(vals) };
}
