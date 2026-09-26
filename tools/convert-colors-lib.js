// OKLCH string -> "#rrggbb" or "rgba(r, g, b, a)".
// Ottosson OKLab matrices + the CSS Color 4 gamut-mapping algorithm
// (chroma reduction with local clipping under a deltaE-OK JND) — this is what
// Chromium runs, so the emitted colours match its rendered output.
'use strict';

const cbrt = Math.cbrt;

function oklabToLinear(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}
function linearToOklab(r, g, b) {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = cbrt(l), m_ = cbrt(m), s_ = cbrt(s);
  return [
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  ];
}
const oklchToLinear = (L, C, H) => {
  const h = (H * Math.PI) / 180;
  return oklabToLinear(L, C * Math.cos(h), C * Math.sin(h));
};
const inGamut = (rgb) => rgb.every((c) => c >= -1e-4 && c <= 1 + 1e-4);
const clip = (rgb) => rgb.map((c) => Math.min(1, Math.max(0, c)));
function deltaEOK(lin1, lin2) {
  const a = linearToOklab(...lin1), b = linearToOklab(...lin2);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// CSS Color 4 "CSS gamut mapping" — https://www.w3.org/TR/css-color-4/#css-gamut-mapping
function gamutMapLinear(L, C, H) {
  if (L >= 1) return [1, 1, 1];
  if (L <= 0) return [0, 0, 0];
  const JND = 0.02;
  const EPS = 1e-4;
  let current = oklchToLinear(L, C, H);
  let clipped = clip(current);
  if (deltaEOK(clipped, current) < JND) return clipped;
  let min = 0, max = C, minInGamut = true;
  while (max - min > EPS) {
    const chroma = (min + max) / 2;
    current = oklchToLinear(L, chroma, H);
    if (minInGamut && inGamut(current)) { min = chroma; continue; }
    clipped = clip(current);
    const E = deltaEOK(clipped, current);
    if (E < JND) {
      if (JND - E < EPS) return clipped;
      minInGamut = false;
      min = chroma;
    } else {
      max = chroma;
    }
  }
  return clipped;
}

function to255(lin) {
  const gam = (x) => {
    x = Math.min(1, Math.max(0, x));
    return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  };
  return lin.map((c) => Math.round(gam(c) * 255));
}

function convertOne(src) {
  const m = String(src).match(
    /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.-]+)\s*(?:\/\s*([\d.]+%?)\s*)?\)$/i
  );
  if (!m) return null;
  const L = parseFloat(m[1]) / 100;
  const C = parseFloat(m[2]);
  const H = parseFloat(m[3]);
  let A = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  // Chromium (this Electron's version) resolves out-of-gamut oklch() by simply
  // clipping linear-sRGB channels, not the full CSS Color 4 chroma reduction —
  // plain clip matches its output far more closely. (gamutMapLinear kept for
  // reference / newer engines.)
  const [r, g, b] = to255(clip(oklchToLinear(L, C, H)));
  if (A >= 1) return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  A = Math.round(A * 1000) / 1000;
  return `rgba(${r}, ${g}, ${b}, ${A})`;
}

module.exports = { convertOne };
