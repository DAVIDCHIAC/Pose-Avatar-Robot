// Mapeo keypoints COCO (17) -> robot humanoid
// 0=nose,1=left_eye,2=right_eye,3=left_ear,4=right_ear,5=left_shoulder,6=right_shoulder,
// 7=left_elbow,8=right_elbow,9=left_wrist,10=right_wrist,11=left_hip,12=right_hip,
// 13=left_knee,14=right_knee,15=left_ankle,16=right_ankle

export const COCO = {
  NOSE: 0, L_EYE: 1, R_EYE: 2, L_EAR: 3, R_EAR: 4,
  L_SH: 5, R_SH: 6, L_EL: 7, R_EL: 8, L_WR: 9, R_WR: 10,
  L_HIP: 11, R_HIP: 12, L_KN: 13, R_KN: 14, L_AN: 15, R_AN: 16
};

export const KP_CONF = 0.25;

export function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
export function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

// Convierte keypoint (px, y abajo) a escena Three.js (y arriba), relativo a origen
export function toScene(k, origin) {
  return { x: (k.x - origin.x), y: -(k.y - origin.y) };
}

// Angulo para huesos cuyo eje por defecto apunta HACIA ARRIBA (+Y)
export function angleUp(dx, dy) { return Math.atan2(-dx, dy); }
// Angulo para huesos cuyo eje por defecto apunta HACIA ABAJO (-Y)
export function angleDown(dx, dy) { return Math.atan2(dx, -dy); }

// Lerp de angulo por arco corto (evita giras de 360)
export function angleLerp(from, to, t) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return from + d * t;
}

export function lerp(a, b, t) { return a + (b - a) * t; }
export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Suavizador exponencial para un solo valor
export class EMA {
  constructor(alpha = 0.35, init = null) { this.a = alpha; this.v = init; }
  next(val) {
    if (this.v === null || val === undefined) { this.v = val; return val; }
    this.v = lerp(this.v, val, this.a);
    return this.v;
  }
}

// Suavizador de angulo (arco corto)
export class EMAAngle {
  constructor(alpha = 0.4, init = 0) { this.a = alpha; this.v = init; }
  next(val) {
    if (val === undefined || val === null) return this.v;
    this.v = angleLerp(this.v, val, this.a);
    return this.v;
  }
}

export function kAt(kpts, i) {
  const k = kpts && kpts[i];
  if (!k || (k.c !== undefined && k.c < KP_CONF)) return null;
  return k;
}

// Filtro One Euro: suaviza cuando esta quieto, responde rapido cuando hay movimiento
export class OneEuro {
  constructor(minCutoff = 1.2, beta = 0.05, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }
  static alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  filter(x, t) {
    if (this.xPrev === null) {
      this.xPrev = x; this.tPrev = t; return x;
    }
    const dt = Math.max(1e-3, t - this.tPrev);
    this.tPrev = t;
    const dx = (x - this.xPrev) / dt;
    const aD = OneEuro.alpha(this.dCutoff, dt);
    this.dxPrev = aD * dx + (1 - aD) * this.dxPrev;
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dxPrev);
    const aX = OneEuro.alpha(cutoff, dt);
    this.xPrev = aX * x + (1 - aX) * this.xPrev;
    return this.xPrev;
  }
}

export class KptFilter {
  constructor() { this.f = new Map(); }
  filter(kpts, t) {
    if (!kpts) return kpts;
    return kpts.map((k, i) => {
      if (!k) return k;
      let pair = this.f.get(i);
      if (!pair) { pair = { x: new OneEuro(), y: new OneEuro() }; this.f.set(i, pair); }
      return { x: pair.x.filter(k.x, t), y: pair.y.filter(k.y, t), c: k.c };
    });
  }
}
