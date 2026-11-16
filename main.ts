// Leviathan of Light — a colossal luminous whale breaching through a
// starstorm, painted procedurally with pure Node.js (stdlib only).
// Writes exactly one image: /output/entry.png (or $MAKEFUN_OUTPUT_DIR).
// Deterministic: fixed seeds, no clock, no network, no randomness.
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const W = 1024;
const H = 1024;

// ---------- deterministic PRNG ----------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- small helpers ----------
const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const sstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
function hash2(x: number, y: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (((h ^ (h >>> 16)) >>> 0) % 10000) / 10000;
}

// ---------- float RGB canvas ----------
const px = new Float32Array(W * H * 3);
const idx = (x: number, y: number): number => (y * W + x) * 3;

function addPix(x: number, y: number, r: number, g: number, b: number): void {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = idx(x, y);
  px[i] += r;
  px[i + 1] += g;
  px[i + 2] += b;
}
function setPix(x: number, y: number, r: number, g: number, b: number): void {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = idx(x, y);
  px[i] = r;
  px[i + 1] = g;
  px[i + 2] = b;
}

// Soft elliptical glow, additive.
function glow(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  r: number,
  g: number,
  b: number,
  strength: number,
): void {
  const x0 = Math.max(0, Math.floor(cx - rx));
  const x1 = Math.min(W - 1, Math.ceil(cx + rx));
  const y0 = Math.max(0, Math.floor(cy - ry));
  const y1 = Math.min(H - 1, Math.ceil(cy + ry));
  for (let y = y0; y <= y1; y++) {
    const dy = (y - cy) / ry;
    for (let x = x0; x <= x1; x++) {
      const dx = (x - cx) / rx;
      const d2 = dx * dx + dy * dy;
      if (d2 >= 1) continue;
      const f = strength * Math.exp(-3.2 * d2);
      const i = idx(x, y);
      px[i] += r * f;
      px[i + 1] += g * f;
      px[i + 2] += b * f;
    }
  }
}

// Soft disc, additive, radius in px.
function disc(
  cx: number,
  cy: number,
  rad: number,
  r: number,
  g: number,
  b: number,
  strength: number,
): void {
  glow(cx, cy, rad, rad, r, g, b, strength);
}

// A light streak from (x0,y0) along angle, additive, tapering.
function streak(
  x0: number,
  y0: number,
  angle: number,
  len: number,
  width: number,
  r: number,
  g: number,
  b: number,
  strength: number,
): void {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const x1 = x0 + dx * len;
  const y1 = y0 + dy * len;
  const bx0 = Math.max(0, Math.floor(Math.min(x0, x1) - width));
  const bx1 = Math.min(W - 1, Math.ceil(Math.max(x0, x1) + width));
  const by0 = Math.max(0, Math.floor(Math.min(y0, y1) - width));
  const by1 = Math.min(H - 1, Math.ceil(Math.max(y0, y1) + width));
  const segLen2 = len * len;
  for (let y = by0; y <= by1; y++) {
    for (let x = bx0; x <= bx1; x++) {
      const pxr = x - x0;
      const pyr = y - y0;
      let t = (pxr * dx + pyr * dy) / len;
      if (t < 0 || t > 1) continue;
      const cxp = x0 + dx * t * len;
      const cyp = y0 + dy * t * len;
      const d = Math.hypot(x - cxp, y - cyp);
      if (d > width) continue;
      const f =
        strength * Math.exp(-((d / width) * (d / width)) * 2.2) * (1 - t * 0.75);
      const i = idx(x, y);
      px[i] += r * f;
      px[i + 1] += g * f;
      px[i + 2] += b * f;
    }
  }
  void segLen2;
}

// ---------- 1. sky ----------
const SKY_STOPS: Array<[number, number, number, number]> = [
  [0.0, 7, 6, 26],
  [0.45, 17, 12, 50],
  [0.72, 42, 20, 74],
  [0.86, 76, 30, 88],
  [1.0, 12, 22, 38],
];
function skyColor(t: number): [number, number, number] {
  for (let s = 0; s < SKY_STOPS.length - 1; s++) {
    const a = SKY_STOPS[s];
    const b = SKY_STOPS[s + 1];
    if (t >= a[0] && t <= b[0]) {
      const f = (t - a[0]) / (b[0] - a[0]);
      return [lerp(a[1], b[1], f), lerp(a[2], b[2], f), lerp(a[3], b[3], f)];
    }
  }
  const last = SKY_STOPS[SKY_STOPS.length - 1];
  return [last[1], last[2], last[3]];
}
for (let y = 0; y < H; y++) {
  const c = skyColor(y / (H - 1));
  for (let x = 0; x < W; x++) {
    const i = idx(x, y);
    px[i] = c[0];
    px[i + 1] = c[1];
    px[i + 2] = c[2];
  }
}

// ---------- 2. nebulae ----------
glow(180, 190, 330, 280, 45, 212, 191, 0.16); // teal
glow(860, 140, 300, 250, 232, 121, 248, 0.14); // magenta
glow(520, 430, 380, 300, 139, 92, 246, 0.1); // violet
glow(880, 720, 300, 240, 251, 191, 36, 0.1); // gold
glow(140, 640, 260, 220, 56, 189, 248, 0.12); // blue
glow(640, 120, 210, 170, 244, 114, 182, 0.1); // pink
glow(512, 855, 520, 90, 200, 60, 140, 0.12); // horizon blush

// ---------- 3. stars ----------
{
  const rng = mulberry32(20261116);
  for (let s = 0; s < 560; s++) {
    const x = rng() * W;
    const y = rng() * H * 0.84;
    const bright = 0.25 + rng() * 0.75;
    const rad = 0.6 + rng() * 1.5;
    const warm = rng();
    const r = warm > 0.7 ? 255 : 210;
    const g = warm > 0.7 ? 220 : 225;
    const b = warm > 0.7 ? 170 : 255;
    disc(x, y, rad, r * bright, g * bright, b * bright, 0.9);
    if (bright > 0.93) {
      // cross sparkle on only the brightest stars
      const len = 4 + rng() * 6;
      streak(x, y, 0, len, 1.1, 255, 255, 255, 0.55);
      streak(x, y, Math.PI, len, 1.1, 255, 255, 255, 0.55);
      streak(x, y, Math.PI / 2, len, 1.1, 255, 255, 255, 0.55);
      streak(x, y, -Math.PI / 2, len, 1.1, 255, 255, 255, 0.55);
    }
  }
}

// ---------- 4. radiant burst behind the whale's head ----------
const BX = 762;
const BY = 296;
glow(BX, BY, 320, 320, 255, 205, 130, 0.5);
glow(BX, BY, 130, 130, 255, 238, 200, 0.75);
disc(BX, BY, 26, 255, 246, 214, 1.0);
{
  // light rays fanning out of the burst
  const angles = [-2.7, -2.25, -1.8, -1.35, -0.85, -0.35, 0.15, 0.75, 1.35, 2.05];
  const rng = mulberry32(777);
  for (const a of angles) {
    streak(
      BX,
      BY,
      a,
      320 + rng() * 380,
      3 + rng() * 6,
      255,
      214,
      140,
      0.1 + rng() * 0.1,
    );
  }
}

// ---------- 5. sea ----------
const SEA_Y = 866;
for (let y = SEA_Y; y < H; y++) {
  const t = (y - SEA_Y) / (H - SEA_Y);
  const base: [number, number, number] = [
    lerp(9, 5, t),
    lerp(40, 22, t),
    lerp(56, 36, t),
  ];
  for (let x = 0; x < W; x++) {
    const wave = 7 * Math.sin(y * 0.11 + 2.2 * Math.sin(x * 0.008 + 1.3));
    const i = idx(x, y);
    px[i] = base[0];
    px[i + 1] = base[1] + wave;
    px[i + 2] = base[2] + wave * 1.4;
  }
}
glow(700, 905, 280, 12, 251, 191, 36, 0.14); // gold shimmer
glow(300, 945, 320, 13, 56, 189, 248, 0.12); // teal shimmer
glow(860, 965, 210, 9, 232, 121, 248, 0.1); // magenta shimmer
glow(762, 935, 90, 60, 255, 205, 130, 0.18); // burst reflection
glow(512, 866, 560, 18, 150, 80, 150, 0.3); // soften the horizon line

// ---------- 6. the whale ----------
// Axis from tail (TX,TY) to head (HX,HY); body arches along it.
const TX = 300;
const TY = 855;
const HX = 748;
const HY = 318;
const AX = HX - TX;
const AY = HY - TY;
const AL = Math.hypot(AX, AY);
const UX = AX / AL;
const UY = AY / AL;
const PX = -UY; // perpendicular, belly side (down-right)
const PY = UX;

function whaleWidth(u: number): number {
  if (u < 0 || u > 1) return 0;
  const s = Math.sin(Math.PI * (0.06 + 0.88 * u));
  let w = 102 * Math.pow(Math.max(s, 0), 0.72);
  w *= 1 - 0.3 * sstep(0.78, 1.0, u); // taper to the head
  w *= 1 - 0.25 * (1 - sstep(0.0, 0.12, u)); // taper to the tail
  return w;
}
function bow(u: number): number {
  return 58 * Math.sin(Math.PI * clamp(u, 0, 1));
}
function localToWorld(u: number, vv: number): [number, number] {
  const b = bow(u);
  return [
    TX + UX * u * AL + PX * (vv + b),
    TY + UY * u * AL + PY * (vv + b),
  ];
}
function pointInTriangle(
  px0: number,
  py0: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): boolean {
  const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  const a = ((by - cy) * (px0 - cx) + (cx - bx) * (py0 - cy)) / d;
  const b = ((cy - ay) * (px0 - cx) + (ax - cx) * (py0 - cy)) / d;
  const c = 1 - a - b;
  return a >= 0 && b >= 0 && c >= 0;
}

const C_TAIL: [number, number, number] = [28, 48, 122];
const C_MID: [number, number, number] = [34, 64, 168];
const C_HEAD: [number, number, number] = [66, 112, 222];

{
  const x0 = 200;
  const x1 = 860;
  const y0 = 210;
  const y1 = 940;
  // dorsal fin triangle, in local (u, vv) space
  const dA: [number, number] = [0.3, -whaleWidth(0.3) + 4];
  const dB: [number, number] = [0.375, -whaleWidth(0.375) - 38];
  const dC: [number, number] = [0.45, -whaleWidth(0.45) + 4];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const relx = x - TX;
      const rely = y - TY;
      const along = relx * UX + rely * UY;
      const u = along / AL;
      if (u < -0.14 || u > 1.03) continue;
      const across = relx * PX + rely * PY;
      const vv = across - bow(u);
      const w = whaleWidth(u);
      let inside = false;
      let shade = 1;
      // body
      const edge = w - Math.abs(vv);
      let feather = clamp(edge / 3, 0, 1);
      let flukeQ = -1;
      if (edge > 0) {
        inside = true;
      } else if (u >= -0.14 && u <= 0.14) {
        // tail flukes: two rotated ellipses at the tail end
        for (const side of [-1, 1]) {
          const du = (u + 0.045) * AL;
          const dv = vv - side * 50;
          const a = side > 0 ? -0.6 : 0.6;
          const ca = Math.cos(a);
          const sa = Math.sin(a);
          const rx = du * ca - dv * sa;
          const ry = du * sa + dv * ca;
          const q = (rx / 64) * (rx / 64) + (ry / 26) * (ry / 26);
          if (q < 1) {
            inside = true;
            shade = 0.95;
            feather = clamp((1 - q) * 6, 0, 1);
            flukeQ = q;
          }
        }
      }
      if (!inside && u >= 0.4 && u <= 0.68 && vv > 30) {
        // pectoral fin: rotated ellipse below the body
        const du = (u - 0.55) * AL;
        const dv = vv - 88;
        const a = -0.55;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const rx = du * ca - dv * sa;
        const ry = du * sa + dv * ca;
        const q = (rx / 90) * (rx / 90) + (ry / 22) * (ry / 22);
        if (q < 1) {
          inside = true;
          shade = 0.8;
          feather = clamp((1 - q) * 6, 0, 1);
        }
      }
      if (!inside && u >= 0.28 && u <= 0.47 && vv < 0) {
        // no dorsal fin: a blue whale's is tiny, and it read as an artefact
      }
      const i = idx(x, y);
      if (inside) {
        const t = clamp(u, 0, 1);
        let base: [number, number, number];
        if (t < 0.5) {
          const f = t / 0.5;
          base = [
            lerp(C_TAIL[0], C_MID[0], f),
            lerp(C_TAIL[1], C_MID[1], f),
            lerp(C_TAIL[2], C_MID[2], f),
          ];
        } else {
          const f = (t - 0.5) / 0.5;
          base = [
            lerp(C_MID[0], C_HEAD[0], f),
            lerp(C_MID[1], C_HEAD[1], f),
            lerp(C_MID[2], C_HEAD[2], f),
          ];
        }
        // belly light (belly side is vv > 0), darker back
        const belly = clamp(vv / Math.max(w, 1), -1, 1);
        const light = 1 + belly * 0.35 - (1 - t) * 0.08;
        let r = base[0] * light * shade;
        let g = base[1] * light * shade;
        let b = base[2] * light * shade;
        // luminous rim around the tail flukes
        if (flukeQ >= 0) {
          const rf = Math.exp(-Math.pow((1 - flukeQ) * 5, 2));
          r += 150 * rf * 0.9;
          g += 220 * rf * 0.9;
          b += 255 * rf * 0.9;
        }
        // luminous rim along the back edge
        const rim = Math.exp(-Math.pow((Math.abs(vv) - w) / 4, 2));
        if (vv < 0) {
          r += 165 * rim * 0.9;
          g += 240 * rim * 0.9;
          b += 255 * rim * 0.9;
        } else if (t > 0.7) {
          r += 255 * rim * 0.5;
          g += 210 * rim * 0.5;
          b += 120 * rim * 0.5;
        }
        // soft edge feather (feather was set per body part above)
        const oldR = px[i];
        const oldG = px[i + 1];
        const oldB = px[i + 2];
        px[i] = lerp(oldR, r, feather);
        px[i + 1] = lerp(oldG, g, feather);
        px[i + 2] = lerp(oldB, b, feather);
      } else if (edge > -10 && edge <= 0 && w > 0) {
        // faint halo hugging the body
        const f = Math.exp(-((-edge) * (-edge)) / 18) * 0.35;
        px[i] += 120 * f;
        px[i + 1] += 200 * f;
        px[i + 2] += 255 * f;
      }
    }
  }
  // bioluminescent dots along the belly, smooth and round
  {
    const rng = mulberry32(31337);
    for (let k = 0; k < 46; k++) {
      const u = 0.22 + rng() * 0.68;
      const w = whaleWidth(u);
      const vv = rng() * w * 0.7;
      const [wx, wy] = localToWorld(u, vv);
      disc(wx, wy, 1.5 + rng() * 1.6, 190, 240, 255, 0.8);
    }
  }
  // mouth: a subtle dark curve under the jaw
  for (let s = 0; s <= 24; s++) {
    const u = 0.8 + (s / 24) * 0.17;
    const w = whaleWidth(u);
    const [wx, wy] = localToWorld(u, w * 0.12);
    disc(wx, wy, 2.2, 12, 18, 44, 0.55);
  }
  // eye: dark disc with a glint, near the head
  const [ex, ey] = localToWorld(0.87, -whaleWidth(0.87) * 0.35);
  for (let y = Math.floor(ey - 6); y <= Math.ceil(ey + 6); y++) {
    for (let x = Math.floor(ex - 6); x <= Math.ceil(ex + 6); x++) {
      const d = Math.hypot(x - ex, y - ey);
      if (d < 5.5) setPix(x, y, 8, 10, 26);
    }
  }
  disc(ex - 2, ey - 2, 2, 255, 255, 255, 0.95);
}

// ---------- 7. breach spray + foam ----------
{
  const rng = mulberry32(4242);
  for (let p = 0; p < 320; p++) {
    const ang = -Math.PI * (0.12 + rng() * 0.72);
    const speed = 60 + rng() * 230;
    const t = rng();
    const x = TX + Math.cos(ang) * speed * t;
    const y = TY + Math.sin(ang) * speed * t + 250 * t * t;
    const bright = 0.5 + rng() * 0.5;
    disc(x, y, 1.5 + rng() * 2.5, 235 * bright, 245 * bright, 255 * bright, 0.85);
  }
  // foam rings where the tail leaves the water
  const cx = 300;
  const cy = 872;
  for (let y = cy - 46; y <= cy + 46; y++) {
    for (let x = cx - 190; x <= cx + 190; x++) {
      const d = ((x - cx) / 170) * ((x - cx) / 170) + ((y - cy) / 36) * ((y - cy) / 36);
      const ring = Math.exp(-Math.pow(d - 1, 2) / 0.02);
      if (ring < 0.02) continue;
      const i = idx(x, y);
      px[i] += 220 * ring * 0.35;
      px[i + 1] += 235 * ring * 0.35;
      px[i + 2] += 255 * ring * 0.35;
    }
  }
  // a second, offset ring so the foam is not perfectly geometric
  for (let y = cy - 40; y <= cy + 40; y++) {
    for (let x = cx - 200; x <= cx + 200; x++) {
      const d =
        ((x - (cx + 30)) / 185) * ((x - (cx + 30)) / 185) +
        ((y - (cy + 8)) / 30) * ((y - (cy + 8)) / 30);
      const ring = Math.exp(-Math.pow(d - 1, 2) / 0.03);
      if (ring < 0.02) continue;
      const i = idx(x, y);
      px[i] += 200 * ring * 0.2;
      px[i + 1] += 220 * ring * 0.2;
      px[i + 2] += 245 * ring * 0.2;
    }
  }
  glow(300, 876, 150, 30, 200, 230, 255, 0.25);
}

// ---------- 8. bokeh depth ----------
{
  const rng = mulberry32(99);
  const cols: Array<[number, number, number]> = [
    [56, 189, 248],
    [251, 191, 36],
    [232, 121, 248],
    [45, 212, 191],
  ];
  for (let k = 0; k < 14; k++) {
    const x = rng() * W;
    const y = rng() * H;
    const c = cols[k % cols.length];
    glow(x, y, 10 + rng() * 26, 10 + rng() * 26, c[0], c[1], c[2], 0.05 + rng() * 0.07);
  }
}

// ---------- 9. vignette, to bytes ----------
// True RGB bytes first (no grain: it costs ~100 KB of PNG size).
const rgb = new Uint8Array(W * H * 3);
for (let y = 0; y < H; y++) {
  const ny = (y - H / 2) / (H / 2);
  for (let x = 0; x < W; x++) {
    const nx = (x - W / 2) / (W / 2);
    const r2 = nx * nx + ny * ny;
    const vig = 1 - 0.26 * clamp(r2 - 0.4, 0, 1);
    const i = idx(x, y);
    const o = i;
    rgb[o] = clamp(Math.round(px[i] * vig), 0, 255);
    rgb[o + 1] = clamp(Math.round(px[i + 1] * vig), 0, 255);
    rgb[o + 2] = clamp(Math.round(px[i + 2] * vig), 0, 255);
  }
}
// Per-row best filter (None / Sub / Up / Average / Paeth), scored by the
// sum of absolute values of the filtered bytes as signed values.
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}
const raw = Buffer.alloc(H * (1 + W * 3));
{
  const prev = new Uint8Array(W * 3);
  const cand = new Uint8Array(W * 3);
  for (let y = 0; y < H; y++) {
    const rowOff = y * (1 + W * 3);
    const row = rgb.subarray(y * W * 3, (y + 1) * W * 3);
    let bestFilter = 0;
    let bestScore = Infinity;
    for (let f = 0; f <= 4; f++) {
      let score = 0;
      for (let x = 0; x < W * 3; x++) {
        const left = x >= 3 ? row[x - 3] : 0;
        const up = prev[x];
        const upLeft = x >= 3 ? prev[x - 3] : 0;
        let pred = 0;
        if (f === 1) pred = left;
        else if (f === 2) pred = up;
        else if (f === 3) pred = (left + up) >> 1;
        else if (f === 4) pred = paeth(left, up, upLeft);
        const v = (row[x] - pred + 256) % 256;
        cand[x] = v;
        score += v < 128 ? v : 256 - v;
        if (score >= bestScore) break;
      }
      if (score < bestScore) {
        bestScore = score;
        bestFilter = f;
        raw[rowOff] = f;
        raw.set(cand, rowOff + 1);
      }
    }
    prev.set(row);
  }
}

// ---------- PNG encoding ----------
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function encodePNG(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- main ----------
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/entry.png`, encodePNG());
