// Background trials for the LoRaTrimmer demo: fresh symbol, random phase jump
// (independent phases before/after, the paper's Assumption 2), fresh noise.
import { rng, unitNoise, addScaled } from './dsp.js';
import { geometry, downchirp, symbol, noiseAmp, decodeLoRaPhy, decodeTrimmer } from './loratrimmer-core.js';

self.onmessage = e => {
  const { sf, snrs, n, seed } = e.data;
  const g = geometry(sf), down = downchirp(sf), r = rng(seed);
  for (const snr of snrs) {
    let okBase = 0, okOurs = 0;
    for (let i = 0; i < n; i++) {
      const code = Math.floor(r.uniform() * g.nClasses);
      const { x } = symbol(sf, code, r.uniform() * 2 * Math.PI, r.uniform() * 2 * Math.PI);
      const rx = addScaled(x, unitNoise(g.nsamp, (r.uniform() * 2 ** 31) | 0), noiseAmp(x, snr));
      if (decodeLoRaPhy(rx, sf, down).est === code) okBase++;
      if (decodeTrimmer(rx, sf, down).est === code) okOurs++;
      if (i % 10 === 9) self.postMessage({ type: 'progress', snr, done: i + 1, total: n });
    }
    self.postMessage({ type: 'point', snr, n, base: okBase / n, ours: okOurs / n });
  }
  self.postMessage({ type: 'done' });
};
