// Biyolüminesan Mantar Ağı — atmosfer ve parçacık efektleri (bağımlılıksız ES modülü, Canvas 2D).
//
// Sözleşme (SOZLESME §5): export class Efektler
//   boyut(w, h, dpr), guncelle(dt), arkaPlanCiz(ctx, kamera), onPlanCiz(ctx, kamera),
//   nabiz(noktalar, ton), filiz(x, y, ton), patlama(x, y, ton)
// Kamera: {x, y, olcek, w, h, ekran(x, y) -> [sx, sy], dunya(sx, sy) -> [x, y]}; ctx dpr ölçekli, CSS pikseli.
//
// Renkler SOZLESME §0.1 pastel toprak paletine göre (krem-altın, adaçayı, kum/kehribar #cdb08a; neon yok).
// Ek (isteğe bağlı) ayar: `efektler.agYaricapi` — ağın dünya birimindeki yaklaşık yarıçapı.
// Fosil halkası bu yarıçapın dışında başlar (varsayılan 1100).
//
// Tasarım notları:
// - Arka plan dokuları (toprak, taş damarları, fosil şeridi) bir kez offscreen tuvale çizilir, döşenir.
// - Işık sprite'ları ton başına (5°'lik adım) önbelleklenir; karelerde shadowBlur yok.
// - Parçacıklar sabit havuzdan gelir (yer değiştirerek silme; karede bellek ayırma yok).

const TAU = Math.PI * 2;
const HAVUZ_PARCACIK = 640;      // efekt parçacıkları (toz + ön spor dahil toplam ≤ ~800)
const HAVUZ_NABIZ = 48;
const HAVUZ_FILIZ = 32;
const HAVUZ_HALKA = 64;
const NABIZ_ORNEK = 600;         // nabız yolu örnek tavanı
const FILIZ_LIF = 16;            // filiz başına lif tavanı (ana + yan dal)
const LIF_NOKTA = 14;
const DT_TAVAN = 0.1;            // sekme dönüşü gibi büyük dt kırpılır
const TOZ_SAYI = 120, TOZ_AZ = 36;
const ON_SPOR = 6, ON_SPOR_AZ = 2;
const KATMAN_UZAK = 512, KATMAN_ORTA = 640;
const BANT_G = 768, BANT_Y = 520;
const FOSIL_S = 128;

const sinir = (v, a, b) => (v < a ? a : v > b ? b : v);
const mod = (v, m) => ((v % m) + m) % m;
const yumusakCikis = (t) => 1 - (1 - t) * (1 - t) * (1 - t);
const yumusakIkili = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);
const tonAnahtar = (t) => mod(Math.round((Number(t) || 0) / 5) * 5, 360);
const sonlu = (v) => typeof v === 'number' && Number.isFinite(v);

/** Tohumlu PRNG (mulberry32). */
function tohumlu(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tuval(w, h) {
  w = Math.max(1, Math.ceil(w)); h = Math.max(1, Math.ceil(h));
  if (typeof document !== 'undefined' && document.createElement) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  throw new Error('Offscreen tuval oluşturulamıyor');
}

/** Döşenebilir doku için: kutu kenardan taşıyorsa öğeyi karşı kenarda da çizer. */
function sarmal(g, T, x0, y0, x1, y1, fn) {
  for (let i = -1; i <= 1; i++) {
    const ox = i * T;
    if (x1 + ox < 0 || x0 + ox > T) continue;
    for (let j = -1; j <= 1; j++) {
      const oy = j * T;
      if (y1 + oy < 0 || y0 + oy > T) continue;
      g.save(); g.translate(ox, oy); fn(g); g.restore();
    }
  }
}

/** Küçük sabit havuz: etkin öğeler [0, n) önekinde; silme yer değiştirerek. */
class Havuz {
  constructor(tavan, yap) { this.d = []; for (let i = 0; i < tavan; i++) this.d.push(yap()); this.n = 0; }
  al() { return this.n < this.d.length ? this.d[this.n++] : null; }
  sil(i) { const s = --this.n; if (i !== s) { const t = this.d[i]; this.d[i] = this.d[s]; this.d[s] = t; } }
}

function yeniParcacik() {
  return { ax: 0, ay: 0, lx: 0, ly: 0, vx: 0, vy: 0, yas: 0, omur: 1, boy: 4, buyu: 0, alfa: 1,
    surt: 0, yuk: 0, kirp: 0, f: 0, sp: null };
}
function yeniNabiz() {
  return { xs: new Float32Array(NABIZ_ORNEK), ys: new Float32Array(NABIZ_ORNEK), kum: new Float32Array(NABIZ_ORNEK),
    m: 0, uzun: 0, yas: 0, sure: 1, ton: 45, kuyruk: 0, birikim: 0, vardi: false, sp: null };
}
function yeniFiliz() {
  return { x: 0, y: 0, ton: 45, yas: 0, omur: 1.2, say: 0,
    lx: new Float32Array(FILIZ_LIF * LIF_NOKTA), ly: new Float32Array(FILIZ_LIF * LIF_NOKTA),
    gecik: new Float32Array(FILIZ_LIF), kalin: new Float32Array(FILIZ_LIF), sp: null };
}
function yeniHalka() {
  return { x: 0, y: 0, ton: 45, yas: 0, omur: 1, r0: 4, r1: 60, kalin: 2, alfa: 0.8 };
}

export class Efektler {
  constructor() {
    this.agYaricapi = 1100;
    this.w = 0; this.h = 0; this.dpr = 1; this._q = 0;
    this._t = 0;
    this._hazir = false;
    this._spriteIsik = new Map();
    this._spriteBokeh = new Map();
    this._p = new Havuz(HAVUZ_PARCACIK, yeniParcacik);
    this._nabizlar = new Havuz(HAVUZ_NABIZ, yeniNabiz);
    this._filizler = new Havuz(HAVUZ_FILIZ, yeniFiliz);
    this._halkalar = new Havuz(HAVUZ_HALKA, yeniHalka);
    this._toz = [];
    this._onSpor = [];
    this._fosilR = -1;
    this._fosilSerit = [];
    this._fosilYer = [];
    // kare başına kamera afini (dünya → ekran)
    this._ox = 0; this._oy = 0; this._sa = 1; this._sd = 1; this._s = 1;
    this._az = false;
    this._azDinle();
  }

  // ------------------------------------------------------------------ genel arayüz

  boyut(w, h, dpr) {
    w = Math.max(1, Math.round(Number(w) || 1));
    h = Math.max(1, Math.round(Number(h) || 1));
    dpr = sonlu(dpr) && dpr > 0 ? dpr : 1;
    const q = Math.min(2, Math.max(1, dpr));
    const eskiW = this.w, eskiH = this.h;
    if (this._hazir && w === eskiW && h === eskiH && q === this._q) return;
    this.w = w; this.h = h; this.dpr = dpr;
    if (!this._hazir || q !== this._q) {
      this._q = q;
      if (!this._fosilSprite) this._fosilSprite = this._fosilSpriteUret();
      this._uzak = this._uzakUret(q);
      this._orta = this._ortaUret(q);
      this._bant = this._bantUret(q);
    }
    this._zemin = this._zeminUret(w, h);
    if (!this._hazir || this._toz.length === 0) this._tozKur();
    else if (eskiW > 0 && eskiH > 0) {
      const kx = (w + 80) / (eskiW + 80), ky = (h + 80) / (eskiH + 80);
      for (const d of this._toz) { d.x *= kx; d.y *= ky; }
      const bx = (w + 400) / (eskiW + 400), by = (h + 400) / (eskiH + 400);
      for (const b of this._onSpor) { b.x *= bx; b.y *= by; }
    }
    this._hazir = true;
  }

  guncelle(dt) {
    dt = sonlu(dt) ? sinir(dt, 0, DT_TAVAN) : 0;
    if (dt === 0) return;
    this._t += dt;
    const t = this._t;

    // süzülen toz / sporlar
    const hiz = this._az ? 0.25 : 1;
    const Wf = this.w + 80, Hf = this.h + 80;
    for (const d of this._toz) {
      d.x = mod(d.x + (d.vx + Math.sin(t * 0.31 + d.f) * 3 * d.z) * dt * hiz, Wf);
      d.y = mod(d.y + (d.vy + Math.cos(t * 0.23 + d.f * 1.7) * 2.4 * d.z) * dt * hiz, Hf);
      if (!this._az) {
        d.kirp -= dt;
        if (d.kirp <= 0) { d.parla = 1; d.kirp = 5 + Math.random() * 16; }
      }
      if (d.parla > 0) d.parla = Math.max(0, d.parla - dt * 2.8);
    }
    const Wb = this.w + 400, Hb = this.h + 400;
    for (const b of this._onSpor) {
      b.x = mod(b.x + b.vx * dt * hiz, Wb);
      b.y = mod(b.y + b.vy * dt * hiz, Hb);
    }

    // parçacıklar
    const P = this._p;
    for (let i = P.n - 1; i >= 0; i--) {
      const p = P.d[i];
      p.yas += dt;
      if (p.yas >= p.omur) { P.sil(i); continue; }
      const sur = p.surt > 0 ? Math.exp(-p.surt * dt) : 1;
      p.vx *= sur; p.vy = p.vy * sur + p.yuk * dt;
      p.lx += p.vx * dt; p.ly += p.vy * dt;
      p.boy += p.buyu * dt;
    }

    // nabızlar
    const N = this._nabizlar;
    for (let i = N.n - 1; i >= 0; i--) {
      const n = N.d[i];
      n.yas += dt;
      if (n.yas >= n.sure + 0.45) { N.sil(i); continue; }
      if (n.yas < n.sure) {
        n.birikim += dt * (this._az ? 10 : 28);
        if (n.birikim >= 1) {
          const bas = n.uzun * yumusakIkili(n.yas / n.sure);
          this._nabizKonum(n, bas);
          while (n.birikim >= 1) {
            n.birikim -= 1;
            const a = Math.random() * TAU, v = 8 + Math.random() * 34;
            this._parcacik(this._kx, this._ky, Math.cos(a) * v, Math.sin(a) * v,
              0.35 + Math.random() * 0.45, 2.5 + Math.random() * 3, n.ton + (Math.random() - 0.5) * 20,
              0.7, 2.2, -4, 0, 0);
          }
        }
      } else if (!n.vardi) {
        n.vardi = true;
        const m = n.m - 1;
        this._halka(n.xs[m], n.ys[m], n.ton, this._az ? 0.35 : 0.6, 4, 38, 1.6, 0.75);
        const k = this._az ? 4 : 10;
        for (let j = 0; j < k; j++) {
          const a = Math.random() * TAU, v = 20 + Math.random() * 60;
          this._parcacik(n.xs[m], n.ys[m], Math.cos(a) * v, Math.sin(a) * v,
            0.4 + Math.random() * 0.5, 3 + Math.random() * 3, n.ton, 0.8, 2.6, -6, 0, 0);
        }
      }
    }

    // filizler, halkalar
    const F = this._filizler;
    for (let i = F.n - 1; i >= 0; i--) { const f = F.d[i]; f.yas += dt; if (f.yas >= f.omur) F.sil(i); }
    const H = this._halkalar;
    for (let i = H.n - 1; i >= 0; i--) { const r = H.d[i]; r.yas += dt; if (r.yas >= r.omur) H.sil(i); }
  }

  arkaPlanCiz(ctx, kamera) {
    if (!ctx || !kamera) return;
    this._hazirla(kamera);
    this._afin(kamera);
    const w = this.w, h = this.h, s = this._s;
    const cx = w * 0.5, cy = h * 0.5;
    const dx = this._ox - cx, dy = this._oy - cy;

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;

    // 1) derin toprak zemini
    ctx.drawImage(this._zemin, 0, 0, w, h);

    // 2) uzak toprak dokusu + kök gölgeleri (yavaş paralaks)
    this._dose(ctx, this._uzak, KATMAN_UZAK, dx * 0.1, dy * 0.1, Math.pow(s, 0.06), 1);

    // 3) ağın arkasındaki miselyum sisi (çekirdek nefesi)
    const nefes = 0.5 + 0.5 * Math.sin(this._t * (this._az ? 0.4 : 1.1));
    const rs = Math.max(140, this.agYaricapi * 0.75 * s);
    if (rs < 1e6 && this._oy + rs > -h && this._oy - rs < 2 * h) {
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(this._ox, this._oy, 0, this._ox, this._oy, rs);
      g.addColorStop(0, `rgba(196,170,112,${(0.045 + 0.02 * nefes).toFixed(3)})`);
      g.addColorStop(0.45, 'rgba(120,120,80,0.022)');
      g.addColorStop(1, 'rgba(60,50,30,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
    }

    // 4) fosil katmanı: dünya koordinatında dış halka (strata + gömülü fosiller)
    this._fosilHalkaCiz(ctx);

    // 5) ekranın altına doğru fosil şeridi (orta paralaks)
    this._bantCiz(ctx, dx, dy);

    // 6) ince taş damarları (orta paralaks)
    this._dose(ctx, this._orta, KATMAN_ORTA, dx * 0.28, dy * 0.28, Math.pow(s, 0.14), 1);

    // 7) süzülen biyolüminesan toz / sporlar
    ctx.globalCompositeOperation = 'lighter';
    const Wf = w + 80, Hf = h + 80, t = this._t;
    for (const d of this._toz) {
      const x = mod(d.x + dx * d.z * 0.35, Wf) - 40;
      const y = mod(d.y + dy * d.z * 0.35, Hf) - 40;
      const a = d.alfa * (0.62 + 0.38 * Math.sin(t * d.w + d.f)) + d.parla * 0.45;
      if (a <= 0.01) continue;
      const r = d.boy * (1 + d.parla * 1.6);
      ctx.globalAlpha = a > 1 ? 1 : a;
      ctx.drawImage(d.sp, x - r, y - r, r * 2, r * 2);
    }
    ctx.restore();
  }

  onPlanCiz(ctx, kamera) {
    if (!ctx || !kamera) return;
    this._hazirla(kamera);
    this._afin(kamera);
    const s = this._s;
    const k = sinir(s, 0.45, 2.2);         // efekt yayılımı: ekranda okunur sınırlar
    const kb = sinir(s, 0.6, 1.8);         // parçacık boyu
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    this._halkalarCiz(ctx, k);
    this._filizlerCiz(ctx, k, kb);
    this._nabizlarCiz(ctx, s);
    this._parcaciklarCiz(ctx, k, kb);
    this._onSporCiz(ctx);

    ctx.restore();
  }

  nabiz(noktalar, ton) {
    if (!Array.isArray(noktalar) || noktalar.length === 0) return;
    const P = [];
    for (const p of noktalar) if (p && sonlu(p.x) && sonlu(p.y)) P.push(p);
    if (P.length === 0) return;
    ton = sonlu(ton) ? ton : 45;
    if (P.length === 1) { this._halka(P[0].x, P[0].y, ton, 0.6, 4, 40, 1.6, 0.8); return; }
    const n = this._nabizlar.al();
    if (!n) return;
    this._nabizKur(n, P);
    n.ton = ton;
    n.sp = this._isik(ton);
    n.yas = 0; n.birikim = 0; n.vardi = false;
    n.sure = sinir(n.uzun / 650, 0.7, 2.4) * (this._az ? 0.6 : 1);
  }

  filiz(x, y, ton) {
    if (!sonlu(x) || !sonlu(y)) return;
    ton = sonlu(ton) ? ton : 95;
    const f = this._filizler.al();
    if (!f) return;
    f.x = x; f.y = y; f.ton = ton; f.yas = 0; f.omur = this._az ? 0.7 : 1.2;
    f.sp = this._isik(ton);
    // kıvrımlı filamentler (yerel piksel ofsetleri, ölçek 1)
    const anaSay = 5 + ((Math.random() * 4) | 0);
    let say = 0;
    for (let i = 0; i < anaSay && say < FILIZ_LIF; i++) {
      const aci = (i / anaSay) * TAU + (Math.random() - 0.5) * 0.8;
      const uzun = 22 + Math.random() * 36;
      const kivrim = (Math.random() - 0.5) * 2.6;
      const faz = Math.random() * TAU;
      const b = say * LIF_NOKTA;
      let px = 0, py = 0, a = aci;
      f.lx[b] = 0; f.ly[b] = 0;
      for (let j = 1; j < LIF_NOKTA; j++) {
        const u = j / (LIF_NOKTA - 1);
        a += (kivrim / (LIF_NOKTA - 1)) * (1 + Math.sin(u * 5 + faz) * 0.7);
        const adim = uzun / (LIF_NOKTA - 1);
        px += Math.cos(a) * adim; py += Math.sin(a) * adim;
        f.lx[b + j] = px; f.ly[b + j] = py;
      }
      f.gecik[say] = Math.random() * 0.12;
      f.kalin[say] = 0.8 + Math.random() * 0.8;
      const ana = say++;
      // yan dal
      if (Math.random() < 0.55 && say < FILIZ_LIF) {
        const ix = 5 + ((Math.random() * 4) | 0);
        const bb = say * LIF_NOKTA;
        let sx = f.lx[ana * LIF_NOKTA + ix], sy = f.ly[ana * LIF_NOKTA + ix];
        const ex = f.lx[ana * LIF_NOKTA + ix + 1] - sx, ey = f.ly[ana * LIF_NOKTA + ix + 1] - sy;
        let a2 = Math.atan2(ey, ex) + (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.5);
        const u2 = uzun * (0.35 + Math.random() * 0.25);
        const kv2 = (Math.random() - 0.5) * 3;
        f.lx[bb] = sx; f.ly[bb] = sy;
        for (let j = 1; j < LIF_NOKTA; j++) {
          a2 += kv2 / (LIF_NOKTA - 1);
          sx += Math.cos(a2) * (u2 / (LIF_NOKTA - 1)); sy += Math.sin(a2) * (u2 / (LIF_NOKTA - 1));
          f.lx[bb + j] = sx; f.ly[bb + j] = sy;
        }
        f.gecik[say] = Math.min(0.85, f.gecik[ana] + (ix / (LIF_NOKTA - 1)) * 0.8);
        f.kalin[say] = f.kalin[ana] * 0.6;
        say++;
      }
    }
    f.say = say;
    this._halka(x, y, ton, this._az ? 0.5 : 0.95, 6, 72, 2.2, 0.8);
    const sporSay = this._az ? 4 : 10;
    for (let i = 0; i < sporSay; i++) {
      const a = Math.random() * TAU, v = 10 + Math.random() * 30;
      this._parcacik(x, y, Math.cos(a) * v, Math.sin(a) * v, (this._az ? 0.5 : 0.9) + Math.random() * 0.6,
        3 + Math.random() * 3.5, ton + (Math.random() - 0.5) * 30, 0.75, 1.2, -5, 3 + Math.random() * 4, 0);
    }
  }

  patlama(x, y, ton) {
    if (!sonlu(x) || !sonlu(y)) return;
    ton = sonlu(ton) ? ton : 346;
    const az = this._az;
    const sayi = az ? 20 : 30 + ((Math.random() * 31) | 0);
    const omurK = az ? 0.55 : 1;
    for (let i = 0; i < sayi; i++) {
      const a = Math.random() * TAU;
      const v = (30 + Math.random() * 140) * (0.6 + Math.random() * 0.4);
      const tn = ton + (Math.random() - 0.5) * 36;
      this._parcacik(x, y, Math.cos(a) * v, Math.sin(a) * v, (0.8 + Math.random() * 0.7) * omurK,
        3 + Math.random() * 6.5, tn, 0.4 + Math.random() * 0.3, 1.7, -9, Math.random() < 0.5 ? 4 + Math.random() * 8 : 0, 0);
    }
    // merkezde yumuşak spor bulutu
    const p = this._parcacik(x, y, 0, 0, 0.9 * omurK, 14, ton, 0.3, 0, 0, 0, 1);
    if (p) p.buyu = 80;
    this._halka(x, y, ton, 0.85 * omurK, 6, 95, 1.6, 0.55);
    this._halka(x, y, ton + 20, 1.3 * omurK, 2, 140, 0.8, 0.2);
  }

  // ------------------------------------------------------------------ iç yardımcılar

  _azDinle() {
    try {
      if (typeof window !== 'undefined' && window.matchMedia) {
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        this._az = !!mq.matches;
        const dinle = (e) => { this._az = !!e.matches; if (this._hazir) this._tozKur(); };
        if (mq.addEventListener) mq.addEventListener('change', dinle);
        else if (mq.addListener) mq.addListener(dinle);
      }
    } catch (_) { this._az = false; }
  }

  _hazirla(kamera) {
    if (this._hazir) return;
    const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
    this.boyut(kamera.w || 800, kamera.h || 600, dpr);
  }

  _afin(k) {
    let o, a, b;
    try { o = k.ekran(0, 0); a = k.ekran(1, 0); b = k.ekran(0, 1); } catch (_) { o = null; }
    if (o && sonlu(o[0]) && sonlu(o[1]) && a && b) {
      this._ox = o[0]; this._oy = o[1];
      this._sa = a[0] - o[0]; this._sd = b[1] - o[1];
    } else {
      const s = sonlu(k.olcek) ? k.olcek : 1;
      this._ox = this.w / 2 - (k.x || 0) * s; this._oy = this.h / 2 - (k.y || 0) * s;
      this._sa = s; this._sd = s;
    }
    if (!sonlu(this._sa) || this._sa === 0) this._sa = 1;
    if (!sonlu(this._sd) || this._sd === 0) this._sd = 1;
    this._s = Math.abs(this._sa);
  }

  _isik(ton) {
    const k = tonAnahtar(ton);
    let c = this._spriteIsik.get(k);
    if (c) return c;
    c = tuval(64, 64);
    const g = c.getContext('2d');
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, `hsla(${k},34%,88%,0.85)`);
    r.addColorStop(0.1, `hsla(${k},36%,80%,0.62)`);
    r.addColorStop(0.28, `hsla(${k},34%,72%,0.24)`);
    r.addColorStop(0.58, `hsla(${k},30%,64%,0.07)`);
    r.addColorStop(1, `hsla(${k},28%,58%,0)`);
    g.fillStyle = r; g.fillRect(0, 0, 64, 64);
    this._spriteIsik.set(k, c);
    return c;
  }

  _bokeh(ton) {
    const k = tonAnahtar(ton);
    let c = this._spriteBokeh.get(k);
    if (c) return c;
    c = tuval(128, 128);
    const g = c.getContext('2d');
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, `hsla(${k},28%,76%,0.16)`);
    r.addColorStop(0.55, `hsla(${k},28%,72%,0.13)`);
    r.addColorStop(0.82, `hsla(${k},30%,78%,0.2)`);
    r.addColorStop(0.92, `hsla(${k},30%,72%,0.08)`);
    r.addColorStop(1, `hsla(${k},28%,66%,0)`);
    g.fillStyle = r; g.fillRect(0, 0, 128, 128);
    this._spriteBokeh.set(k, c);
    return c;
  }

  _parcacik(ax, ay, vx, vy, omur, boy, ton, alfa, surt, yuk, kirp, tip) {
    const p = this._p.al();
    if (!p) return null;
    p.ax = ax; p.ay = ay; p.lx = 0; p.ly = 0; p.vx = vx; p.vy = vy;
    p.yas = 0; p.omur = omur; p.boy = boy; p.buyu = 0; p.alfa = alfa;
    p.surt = surt; p.yuk = yuk; p.kirp = kirp; p.f = Math.random() * TAU;
    p.sp = tip === 1 ? this._bokeh(ton) : this._isik(ton);
    return p;
  }

  _halka(x, y, ton, omur, r0, r1, kalin, alfa) {
    const r = this._halkalar.al();
    if (!r) return;
    r.x = x; r.y = y; r.ton = tonAnahtar(ton); r.yas = 0; r.omur = omur;
    r.r0 = r0; r.r1 = r1; r.kalin = kalin; r.alfa = alfa;
  }

  _tozKur() {
    const W = this.w + 80, H = this.h + 80;
    const say = this._az ? TOZ_AZ : TOZ_SAYI;
    this._toz = [];
    for (let i = 0; i < say; i++) {
      const u = Math.random();
      const ton = u < 0.55 ? 40 + Math.random() * 12 : u < 0.88 ? 85 + Math.random() * 20 : 25 + Math.random() * 10;
      const z = 0.3 + Math.random() * 0.7;
      this._toz.push({
        x: Math.random() * W, y: Math.random() * H, z,
        vx: (Math.random() - 0.5) * 10 * z, vy: (Math.random() - 0.5) * 8 * z - 1.5 * z,
        boy: (1.2 + Math.random() * 2.4) * z * 2.6, alfa: (0.1 + Math.random() * 0.24) * z,
        f: Math.random() * TAU, w: 0.6 + Math.random() * 1.8,
        kirp: 2 + Math.random() * 14, parla: 0, sp: this._isik(ton),
      });
    }
    const Wb = this.w + 400, Hb = this.h + 400;
    const bs = this._az ? ON_SPOR_AZ : ON_SPOR;
    this._onSpor = [];
    for (let i = 0; i < bs; i++) {
      const u = Math.random();
      const ton = u < 0.5 ? 45 : u < 0.8 ? 95 : 346;
      this._onSpor.push({
        x: Math.random() * Wb, y: Math.random() * Hb, z: 1.25 + Math.random() * 0.45,
        r: 45 + Math.random() * 85, alfa: 0.16 + Math.random() * 0.2,
        vx: (Math.random() - 0.5) * 9, vy: -1 - Math.random() * 4, sp: this._bokeh(ton),
      });
    }
  }

  // ---------------- arka plan dokuları (bir kez üretilir)

  _zeminUret(w, h) {
    const c = tuval(w, h);
    const g = c.getContext('2d');
    const lg = g.createLinearGradient(0, 0, 0, h);
    lg.addColorStop(0, '#29251a');
    lg.addColorStop(0.45, '#1d1813');
    lg.addColorStop(1, '#150f0b');
    g.fillStyle = lg; g.fillRect(0, 0, w, h);
    const m = Math.max(w, h);
    const rg = g.createRadialGradient(w * 0.5, h * 0.42, 0, w * 0.5, h * 0.42, m * 0.7);
    rg.addColorStop(0, 'rgba(64,54,38,0.38)');
    rg.addColorStop(0.5, 'rgba(51,42,32,0.16)');
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg; g.fillRect(0, 0, w, h);
    const vg = g.createRadialGradient(w * 0.5, h * 0.5, m * 0.3, w * 0.5, h * 0.5, m * 0.78);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(10,6,3,0.55)');
    g.fillStyle = vg; g.fillRect(0, 0, w, h);
    // koyu gradyanlarda bantlaşmayı kıran titreşim gürültüsü
    try {
      const im = g.getImageData(0, 0, c.width, c.height), d = im.data;
      const r = tohumlu(0x5EED);
      for (let i = 0; i < d.length; i += 4) {
        const n = (r() - 0.5) * 3;
        d[i] = sinir(d[i] + n, 0, 255); d[i + 1] = sinir(d[i + 1] + n, 0, 255); d[i + 2] = sinir(d[i + 2] + n, 0, 255);
      }
      g.putImageData(im, 0, 0);
    } catch (_) { /* getImageData yoksa titreşimsiz kalır */ }
    return c;
  }

  _uzakUret(q) {
    const T = KATMAN_UZAK;
    const c = tuval(T * q, T * q);
    const g = c.getContext('2d');
    const r = tohumlu(0xA11CE5);
    // ince toprak tanesi
    try {
      const im = g.createImageData(c.width, c.height), d = im.data;
      for (let i = 0; i < d.length; i += 4) {
        const v = r();
        if (v < 0.5) { d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; d[i + 3] = (r() * 26) | 0; }
        else { d[i] = 92; d[i + 1] = 80; d[i + 2] = 60; d[i + 3] = (r() * 9) | 0; }
      }
      g.putImageData(im, 0, 0);
    } catch (_) { /* yoksa tanesiz */ }
    g.scale(q, q);
    // toprak lekeleri
    const renk = ['rgba(12,8,4,0.2)', 'rgba(96,74,50,0.08)', 'rgba(74,84,52,0.06)', 'rgba(12,8,4,0.12)'];
    for (let i = 0; i < 150; i++) {
      const x = r() * T, y = r() * T, rr = 18 + r() * r() * 110;
      const col = renk[(r() * renk.length) | 0];
      sarmal(g, T, x - rr, y - rr, x + rr, y + rr, (gg) => {
        const rg = gg.createRadialGradient(x, y, 0, x, y, rr);
        rg.addColorStop(0, col); rg.addColorStop(1, 'rgba(0,0,0,0)');
        gg.fillStyle = rg; gg.fillRect(x - rr, y - rr, rr * 2, rr * 2);
      });
    }
    // kök gölgeleri (incelen, dallanan). Opak ara tuvallere çizilip tek alfa ile bindirilir:
    // segment eklemlerinde alfa birikmesi (boncuklu "solucan" görüntüsü) olmaz.
    const kg = tuval(T * q, T * q), kgc = kg.getContext('2d');
    const kh = tuval(T * q, T * q), khc = kh.getContext('2d');
    kgc.scale(q, q); khc.scale(q, q);
    const kok = (x, y, aci, kalin, adimSay, derin) => {
      const pts = [[x, y, kalin]];
      let a = aci, w = kalin;
      for (let i = 0; i < adimSay; i++) {
        a += (r() - 0.5) * 0.45;
        x += Math.cos(a) * 6; y += Math.sin(a) * 6;
        w = kalin * (1 - i / adimSay) + 0.5;
        pts.push([x, y, w]);
        if (derin < 2 && r() < 0.045) kok(x, y, a + (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.7), w * 0.7, (adimSay - i) * 0.6 | 0, derin + 1);
      }
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const p of pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
      sarmal(kgc, T, x0 - 10, y0 - 10, x1 + 10, y1 + 10, (gg) => {
        gg.lineCap = 'round'; gg.strokeStyle = 'rgb(14,9,5)';
        for (let i = 1; i < pts.length; i++) {
          gg.lineWidth = pts[i][2] * 1.6;
          gg.beginPath(); gg.moveTo(pts[i - 1][0], pts[i - 1][1]); gg.lineTo(pts[i][0], pts[i][1]); gg.stroke();
        }
      });
      sarmal(khc, T, x0 - 10, y0 - 10, x1 + 10, y1 + 10, (gg) => {
        gg.lineCap = 'round'; gg.strokeStyle = 'rgb(160,128,88)';
        for (let i = 1; i < pts.length; i++) {
          gg.lineWidth = Math.max(0.4, pts[i][2] * 0.4);
          gg.beginPath(); gg.moveTo(pts[i - 1][0] - 1, pts[i - 1][1] - 1); gg.lineTo(pts[i][0] - 1, pts[i][1] - 1); gg.stroke();
        }
      });
    };
    for (let i = 0; i < 8; i++) kok(r() * T, r() * T, r() * TAU, 3 + r() * 5, 50 + (r() * 60) | 0, 0);
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 0.42; g.drawImage(kg, 0, 0);
    g.globalAlpha = 0.07; g.drawImage(kh, 0, 0);
    g.restore();
    // uzak, belli belirsiz koloniler
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 6; i++) {
      const x = r() * T, y = r() * T, rr = 6 + r() * 16, ton = r() < 0.6 ? 45 : 95;
      sarmal(g, T, x - rr, y - rr, x + rr, y + rr, (gg) => {
        const rg = gg.createRadialGradient(x, y, 0, x, y, rr);
        rg.addColorStop(0, `hsla(${ton},30%,66%,0.06)`); rg.addColorStop(1, `hsla(${ton},28%,50%,0)`);
        gg.fillStyle = rg; gg.fillRect(x - rr, y - rr, rr * 2, rr * 2);
      });
    }
    return c;
  }

  _ortaUret(q) {
    const T = KATMAN_ORTA;
    const c = tuval(T * q, T * q);
    const g = c.getContext('2d');
    g.scale(q, q);
    const r = tohumlu(0x57A0E);
    // çakıllar
    for (let i = 0; i < 30; i++) {
      const x = r() * T, y = r() * T, rr = 3 + r() * 10, kose = 6 + ((r() * 4) | 0);
      const pts = [];
      for (let j = 0; j < kose; j++) { const a = (j / kose) * TAU; const d = rr * (0.7 + r() * 0.4); pts.push([Math.cos(a) * d, Math.sin(a) * d * 0.8]); }
      sarmal(g, T, x - rr, y - rr, x + rr, y + rr, (gg) => {
        gg.beginPath();
        pts.forEach((p, j) => (j ? gg.lineTo(x + p[0], y + p[1]) : gg.moveTo(x + p[0], y + p[1])));
        gg.closePath();
        gg.fillStyle = 'rgba(14,10,6,0.36)'; gg.fill();
        gg.strokeStyle = 'rgba(176,156,124,0.08)'; gg.lineWidth = 0.8; gg.stroke();
      });
    }
    // taş damarları
    const damar = (x, y, aci, adimSay, kalin, derin) => {
      const pts = [[x, y]];
      let a = aci;
      for (let i = 0; i < adimSay; i++) {
        a += (r() - 0.5) * 0.9; a += (aci - a) * 0.15;
        const st = 8 + r() * 8;
        x += Math.cos(a) * st; y += Math.sin(a) * st;
        pts.push([x, y]);
        if (derin < 2 && r() < 0.08) damar(x, y, a + (r() - 0.5) * 2.2, (adimSay * 0.4) | 0, kalin * 0.6, derin + 1);
      }
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const p of pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
      const parilti = [];
      for (let i = 1; i < pts.length; i++) if (r() < 0.12) parilti.push([pts[i][0], pts[i][1], 0.8 + r() * 1.6]);
      sarmal(g, T, x0 - 6, y0 - 6, x1 + 6, y1 + 6, (gg) => {
        gg.lineJoin = 'round'; gg.lineCap = 'round';
        gg.beginPath(); pts.forEach((p, j) => (j ? gg.lineTo(p[0], p[1]) : gg.moveTo(p[0], p[1])));
        gg.strokeStyle = 'rgba(14,10,6,0.36)'; gg.lineWidth = kalin * 2.6; gg.stroke();
        gg.strokeStyle = 'rgba(182,166,140,0.11)'; gg.lineWidth = kalin; gg.stroke();
        gg.strokeStyle = 'rgba(230,214,188,0.06)'; gg.lineWidth = Math.max(0.35, kalin * 0.35); gg.stroke();
        gg.globalCompositeOperation = 'lighter';
        for (const p of parilti) {
          const rg = gg.createRadialGradient(p[0], p[1], 0, p[0], p[1], p[2] * 3);
          rg.addColorStop(0, 'hsla(45,34%,80%,0.14)'); rg.addColorStop(1, 'hsla(45,30%,60%,0)');
          gg.fillStyle = rg; gg.fillRect(p[0] - p[2] * 3, p[1] - p[2] * 3, p[2] * 6, p[2] * 6);
        }
        gg.globalCompositeOperation = 'source-over';
      });
    };
    for (let i = 0; i < 7; i++) damar(r() * T, r() * T, r() * TAU, 25 + ((r() * 35) | 0), 0.6 + r() * 1.0, 0);
    return c;
  }

  _fosilSpriteUret() {
    const S = FOSIL_S, R = S / 2 - 6;
    const ciz = [
      // ammonit (logaritmik sarmal + kaburgalar)
      (g) => {
        const b = 0.18, tm = 6 * Math.PI;
        const rf = (t) => R * Math.exp(b * (t - tm));
        g.beginPath(); g.arc(0, 0, rf(tm), 0, TAU); g.fill();
        g.lineWidth = 2; g.stroke();
        g.beginPath();
        for (let t = 0; t <= tm; t += 0.08) { const rr = rf(t); t ? g.lineTo(Math.cos(t) * rr, Math.sin(t) * rr) : g.moveTo(rr, 0); }
        g.lineWidth = 1.4; g.stroke();
        g.globalAlpha = 0.55; g.lineWidth = 0.8;
        for (let t = 2 * Math.PI; t <= tm; t += 0.26) {
          const r1 = rf(t - 2 * Math.PI), r2 = rf(t);
          g.beginPath(); g.moveTo(Math.cos(t) * r1, Math.sin(t) * r1);
          g.quadraticCurveTo(Math.cos(t + 0.12) * (r1 + r2) / 2, Math.sin(t + 0.12) * (r1 + r2) / 2, Math.cos(t) * r2, Math.sin(t) * r2);
          g.stroke();
        }
        g.globalAlpha = 1;
      },
      // kabuk (çift kapaklı; ışınsal kaburga + büyüme halkaları)
      (g) => {
        const hx = 0, hy = R * 0.55, rr = R * 1.1;
        g.beginPath(); g.moveTo(hx, hy); g.arc(hx, hy, rr, Math.PI + 0.45, TAU - 0.45); g.closePath();
        g.fill(); g.lineWidth = 2; g.stroke();
        g.lineWidth = 0.8; g.globalAlpha = 0.6;
        for (let i = 1; i < 14; i++) {
          const a = Math.PI + 0.45 + ((Math.PI - 0.9) * i) / 14;
          g.beginPath(); g.moveTo(hx, hy); g.lineTo(hx + Math.cos(a) * rr, hy + Math.sin(a) * rr); g.stroke();
        }
        for (const f of [0.35, 0.55, 0.75, 0.9]) { g.beginPath(); g.arc(hx, hy, rr * f, Math.PI + 0.5, TAU - 0.5); g.stroke(); }
        g.globalAlpha = 1;
      },
      // trilobit
      (g) => {
        g.beginPath(); g.ellipse(0, R * 0.1, R * 0.55, R * 0.85, 0, 0, TAU); g.fill(); g.lineWidth = 1.8; g.stroke();
        g.beginPath(); g.arc(0, -R * 0.45, R * 0.6, Math.PI, TAU); g.stroke();
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(-R * 0.17, -R * 0.5); g.lineTo(-R * 0.12, R * 0.9); g.moveTo(R * 0.17, -R * 0.5); g.lineTo(R * 0.12, R * 0.9); g.stroke();
        g.globalAlpha = 0.6; g.lineWidth = 0.8;
        for (let i = 0; i < 10; i++) {
          const y = -R * 0.3 + i * R * 0.11;
          const wd = R * 0.55 * Math.sqrt(Math.max(0, 1 - ((y - R * 0.1) / (R * 0.85)) ** 2));
          g.beginPath(); g.moveTo(-wd, y); g.quadraticCurveTo(0, y + R * 0.05, wd, y); g.stroke();
        }
        g.globalAlpha = 1;
        g.beginPath(); g.arc(-R * 0.3, -R * 0.62, R * 0.08, 0, TAU); g.arc(R * 0.3, -R * 0.62, R * 0.08, 0, TAU); g.stroke();
      },
      // krinoid (sap + taç kolları)
      (g) => {
        const nokta = (u) => [Math.sin(u * 2.4) * R * 0.18, R - u * R * 1.25];
        g.lineWidth = 1;
        for (let i = 0; i <= 16; i++) {
          const [x, y] = nokta(i / 16);
          g.beginPath(); g.ellipse(x, y, R * 0.09, R * 0.04, 0, 0, TAU); g.fill(); g.stroke();
        }
        const [tx, ty] = nokta(1);
        g.beginPath(); g.moveTo(tx - R * 0.12, ty); g.quadraticCurveTo(tx, ty + R * 0.12, tx + R * 0.12, ty);
        g.lineTo(tx + R * 0.18, ty - R * 0.12); g.lineTo(tx - R * 0.18, ty - R * 0.12); g.closePath(); g.fill(); g.stroke();
        g.lineWidth = 0.9;
        for (let k = 0; k < 5; k++) {
          const a = -Math.PI / 2 + (k - 2) * 0.32;
          g.beginPath(); g.moveTo(tx, ty - R * 0.12);
          const ex = tx + Math.cos(a) * R * 0.75, ey = ty - R * 0.12 + Math.sin(a) * R * 0.6;
          g.quadraticCurveTo(tx + Math.cos(a) * R * 0.2, ty - R * 0.5, ex, ey); g.stroke();
          g.globalAlpha = 0.5;
          for (let j = 1; j < 6; j++) {
            const u = j / 6, px = tx + (ex - tx) * u, py = ty - R * 0.12 + (ey - ty + R * 0.12) * u;
            g.beginPath(); g.moveTo(px, py); g.lineTo(px + R * 0.07, py - R * 0.05); g.moveTo(px, py); g.lineTo(px - R * 0.07, py - R * 0.05); g.stroke();
          }
          g.globalAlpha = 1;
        }
      },
    ];
    return ciz.map((fn) => {
      const c = tuval(S, S);
      const g = c.getContext('2d');
      g.translate(S / 2, S / 2);
      g.strokeStyle = '#cdb08a';
      g.fillStyle = 'rgba(160,136,104,0.22)';
      g.lineCap = 'round'; g.lineJoin = 'round';
      fn(g);
      return c;
    });
  }

  _bantUret(q) {
    const W = BANT_G, H = BANT_Y;
    const c = tuval(W * q, H * q);
    const g = c.getContext('2d');
    g.scale(q, q);
    const r = tohumlu(0xF0551);
    const hatlar = [];
    let y = 26;
    while (y < H + 24) {
      hatlar.push({ y, a1: 2 + r() * 7, k1: 1 + ((r() * 3) | 0), p1: r() * TAU, a2: 0.5 + r() * 2, k2: 4 + ((r() * 5) | 0), p2: r() * TAU });
      y += 8 + r() * r() * 34;
    }
    const yAt = (L, x) => L.y + L.a1 * Math.sin((TAU * L.k1 * x) / W + L.p1) + L.a2 * Math.sin((TAU * L.k2 * x) / W + L.p2);
    // tabakalar (kehribar-gri, derine indikçe belirgin)
    for (let i = 0; i < hatlar.length - 1; i++) {
      const A = hatlar[i], B = hatlar[i + 1];
      g.beginPath();
      for (let x = 0; x <= W; x += 8) (x ? g.lineTo(x, yAt(A, x)) : g.moveTo(x, yAt(A, x)));
      for (let x = W; x >= 0; x -= 8) g.lineTo(x, yAt(B, x));
      g.closePath();
      const der = i / hatlar.length;
      const hue = 26 + r() * 18, sat = 10 + r() * 22, lig = 26 + r() * 20;
      g.fillStyle = `hsla(${hue.toFixed(0)},${sat.toFixed(0)}%,${lig.toFixed(0)}%,${(0.03 + 0.08 * der * (0.5 + r())).toFixed(3)})`;
      g.fill();
    }
    for (const L of hatlar) {
      g.beginPath();
      for (let x = 0; x <= W; x += 6) (x ? g.lineTo(x, yAt(L, x)) : g.moveTo(x, yAt(L, x)));
      g.strokeStyle = `rgba(205,176,138,${(0.05 + r() * 0.12).toFixed(3)})`;
      g.lineWidth = 0.6 + r() * 0.9;
      if (r() < 0.35) g.setLineDash([20 + r() * 70, 3 + r() * 18]); else g.setLineDash([]);
      g.stroke();
    }
    g.setLineDash([]);
    // tabaka içi çakıl kesitleri
    for (let i = 0; i < 26; i++) {
      const x = r() * W, yy = 40 + r() * (H - 40), rx = 2 + r() * 7, ry = rx * (0.4 + r() * 0.4);
      for (const ox of [-W, 0, W]) {
        if (x + ox + rx < 0 || x + ox - rx > W) continue;
        g.beginPath(); g.ellipse(x + ox, yy, rx, ry, (r() - 0.5) * 0.4, 0, TAU);
        g.fillStyle = 'rgba(0,0,0,0.35)'; g.fill();
        g.strokeStyle = 'rgba(190,160,115,0.10)'; g.lineWidth = 0.7; g.stroke();
      }
    }
    // gömülü fosiller
    for (let i = 0; i < 11; i++) {
      const sp = this._fosilSprite[(r() * this._fosilSprite.length) | 0];
      const x = r() * W, yy = 70 + r() * (H - 100), b = 22 + r() * 30, rot = (r() - 0.5) * 1.4;
      const a = 0.22 + r() * 0.28;
      for (const ox of [-W, 0, W]) {
        if (x + ox + b < 0 || x + ox - b > W) continue;
        g.save(); g.translate(x + ox, yy); g.rotate(rot); g.globalAlpha = a;
        g.drawImage(sp, -b / 2, -b / 2, b, b);
        g.restore();
      }
    }
    // üstten sönen geçiş
    g.globalCompositeOperation = 'destination-in';
    const lg = g.createLinearGradient(0, 0, 0, H);
    lg.addColorStop(0, 'rgba(0,0,0,0)');
    lg.addColorStop(0.22, 'rgba(0,0,0,0.45)');
    lg.addColorStop(0.5, 'rgba(0,0,0,1)');
    lg.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = lg; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over';
    return c;
  }

  _fosilHalkaKur() {
    const R = Math.max(50, Number(this.agYaricapi) || 1100);
    this._fosilR = this.agYaricapi;
    const r = tohumlu(0xF0551A);
    const parca = 8;
    this._fosilSerit = [];
    const P2 = typeof Path2D !== 'undefined';
    for (let k = 0; k < 10; k++) {
      const rk = R * (1.04 + k * 0.072 + (r() - 0.5) * 0.03);
      const f1 = 2 + ((r() * 3) | 0), f2 = 6 + ((r() * 5) | 0), p1 = r() * TAU, p2 = r() * TAU;
      const a1 = 0.012 + r() * 0.02, a2 = 0.004 + r() * 0.01;
      const temel = 0.06 + r() * 0.1, kalin = 0.8 + r() * 1.6;
      const kesik = r() < 0.4;
      for (let s = 0; s < parca; s++) {
        const t0 = (s / parca) * TAU, t1 = ((s + 1) / parca) * TAU;
        const orta = (t0 + t1) / 2;
        const alt = Math.max(0, Math.sin(orta));         // ekranın / ağın alt tarafına doğru belirgin
        const alfa = temel * (0.3 + 0.7 * alt * alt);
        const noktalar = [];
        for (let i = 0; i <= 24; i++) {
          const t = t0 + ((t1 - t0) * i) / 24;
          const rr = rk * (1 + a1 * Math.sin(f1 * t + p1) + a2 * Math.sin(f2 * t + p2));
          noktalar.push(Math.cos(t) * rr, Math.sin(t) * rr);
        }
        let yol = null;
        if (P2) {
          yol = new Path2D();
          yol.moveTo(noktalar[0], noktalar[1]);
          for (let i = 2; i < noktalar.length; i += 2) yol.lineTo(noktalar[i], noktalar[i + 1]);
        }
        this._fosilSerit.push({ rk, alfa, kalin, kesik, yol, noktalar });
      }
    }
    this._fosilYer = [];
    let deneme = 0;
    while (this._fosilYer.length < 46 && deneme++ < 2000) {
      const a = r() * TAU;
      if (r() > 0.3 + 0.7 * Math.max(0, Math.sin(a))) continue;
      const rr = R * (1.06 + r() * 0.7);
      this._fosilYer.push({
        x: Math.cos(a) * rr, y: Math.sin(a) * rr, b: 22 + r() * 50, rot: r() * TAU,
        alfa: 0.16 + r() * 0.24, sp: this._fosilSprite[(r() * this._fosilSprite.length) | 0],
      });
    }
  }

  _fosilHalkaCiz(ctx) {
    if (this._fosilR !== this.agYaricapi) this._fosilHalkaKur();
    const R = Math.max(50, Number(this.agYaricapi) || 1100);
    const ox = this._ox, oy = this._oy, sa = this._sa, sd = this._sd, s = this._s;
    const w = this.w, h = this.h;
    // kökten ekrana en yakın/en uzak uzaklık (ekran pikseli)
    const nx = sinir(ox, 0, w) - ox, ny = sinir(oy, 0, h) - oy;
    const dmin = Math.hypot(nx, ny);
    const dmax = Math.max(Math.hypot(ox, oy), Math.hypot(w - ox, oy), Math.hypot(ox, h - oy), Math.hypot(w - ox, h - oy));
    if (R * 2.0 * s < dmin) return;                    // halka tamamen ekran dışında (uzakta)
    if (R * 1.0 * s > dmax) return;                    // ekran halkanın içinde kalıyor

    // halka zemini: içten dışa sertleşen kehribar-gri tül
    const r0 = R * 0.92 * s, r2 = R * 2.1 * s;
    if (r2 < 4e5) {
      const g = ctx.createRadialGradient(ox, oy, r0, ox, oy, r2);
      g.addColorStop(0, 'rgba(60,50,36,0)');
      g.addColorStop(0.18, 'rgba(70,58,40,0.07)');
      g.addColorStop(0.6, 'rgba(58,50,38,0.12)');
      g.addColorStop(1, 'rgba(40,36,30,0.14)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    // strata çizgileri (dünya koordinatında Path2D; dönüşüm ile)
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(sa, sd);
    ctx.strokeStyle = '#cdb08a';
    ctx.lineJoin = 'round';
    for (const p of this._fosilSerit) {
      const rp = p.rk * s;
      if (rp * 1.05 < dmin || rp * 0.95 > dmax) continue;
      ctx.globalAlpha = p.alfa;
      ctx.lineWidth = p.kalin / s;
      if (p.kesik && ctx.setLineDash) ctx.setLineDash([60 / s, 14 / s]);
      if (p.yol) ctx.stroke(p.yol);
      else {
        const n = p.noktalar;
        ctx.beginPath(); ctx.moveTo(n[0], n[1]);
        for (let i = 2; i < n.length; i += 2) ctx.lineTo(n[i], n[i + 1]);
        ctx.stroke();
      }
      if (p.kesik && ctx.setLineDash) ctx.setLineDash([]);
    }
    ctx.restore();

    // gömülü fosil siluetleri
    for (const f of this._fosilYer) {
      const bp = f.b * s;
      if (bp < 3) continue;
      const x = ox + f.x * sa, y = oy + f.y * sd;
      if (x < -bp || y < -bp || x > w + bp || y > h + bp) continue;
      ctx.save();
      ctx.globalAlpha = f.alfa;
      ctx.translate(x, y); ctx.rotate(f.rot);
      ctx.drawImage(f.sp, -bp / 2, -bp / 2, bp, bp);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  _bantCiz(ctx, dx, dy) {
    const w = this.w, h = this.h;
    const y0 = Math.round(sinir(h * 0.72 + dy * 0.22, h * 0.3, h + 10));
    if (y0 >= h) return;
    ctx.globalAlpha = 0.85;
    const ofs = Math.round(mod(dx * 0.5, BANT_G));
    for (let x = ofs - BANT_G; x < w; x += BANT_G) ctx.drawImage(this._bant, x, y0, BANT_G, BANT_Y);
    if (y0 + BANT_Y < h) {
      ctx.fillStyle = 'rgba(30,25,19,0.5)';
      ctx.fillRect(0, y0 + BANT_Y, w, h - y0 - BANT_Y);
    }
    ctx.globalAlpha = 1;
  }

  _dose(ctx, doku, T, px, py, olc, alfa) {
    const Ts = Math.max(64, Math.round(T * sinir(olc, 0.7, 1.5)));
    const x0 = Math.round(mod(px, Ts)) - Ts, y0 = Math.round(mod(py, Ts)) - Ts;
    ctx.globalAlpha = alfa;
    for (let y = y0; y < this.h; y += Ts) {
      for (let x = x0; x < this.w; x += Ts) ctx.drawImage(doku, x, y, Ts, Ts);
    }
    ctx.globalAlpha = 1;
  }

  // ---------------- ön plan çizimleri

  _halkalarCiz(ctx, k) {
    const H = this._halkalar;
    for (let i = 0; i < H.n; i++) {
      const r = H.d[i];
      const p = r.yas / r.omur;
      const e = yumusakCikis(p);
      const rad = (r.r0 + (r.r1 - r.r0) * e) * k;
      const a = r.alfa * Math.pow(1 - p, 1.6);
      if (a < 0.01 || rad < 0.5) continue;
      const x = this._ox + r.x * this._sa, y = this._oy + r.y * this._sd;
      const lw = r.kalin * (1 - p) + 0.6;
      ctx.strokeStyle = `hsl(${r.ton},36%,76%)`;
      ctx.beginPath(); ctx.arc(x, y, rad, 0, TAU);
      ctx.globalAlpha = a * 0.22; ctx.lineWidth = lw * 5; ctx.stroke();
      ctx.globalAlpha = a; ctx.lineWidth = lw; ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  _filizlerCiz(ctx, k, kb) {
    const F = this._filizler;
    const son = LIF_NOKTA - 1;
    for (let i = 0; i < F.n; i++) {
      const f = F.d[i];
      const p = f.yas / f.omur;
      const G = yumusakCikis(Math.min(1, f.yas / (f.omur * 0.6)));
      const solma = p < 0.5 ? 1 : Math.max(0, 1 - (p - 0.5) / 0.5);
      const cx = this._ox + f.x * this._sa, cy = this._oy + f.y * this._sd;
      // ilk parlama
      const flas = Math.max(0, 1 - p * 3.5);
      if (flas > 0) {
        const rr = 42 * k * (0.6 + p * 2);
        ctx.globalAlpha = flas;
        ctx.drawImage(f.sp, cx - rr, cy - rr, rr * 2, rr * 2);
      }
      // filamentler: iki geçiş (geniş ışıma + ince çekirdek)
      for (let gec = 0; gec < 2; gec++) {
        ctx.beginPath();
        for (let l = 0; l < f.say; l++) {
          const gl = f.gecik[l];
          const g = sinir((G - gl) / (1 - gl), 0, 1);
          if (g <= 0) continue;
          const b = l * LIF_NOKTA;
          const ust = g * son, tam = Math.floor(ust), kesir = ust - tam;
          ctx.moveTo(cx + f.lx[b] * k, cy + f.ly[b] * k);
          for (let j = 1; j <= tam; j++) ctx.lineTo(cx + f.lx[b + j] * k, cy + f.ly[b + j] * k);
          if (tam < son && kesir > 0) {
            const xa = f.lx[b + tam] + (f.lx[b + tam + 1] - f.lx[b + tam]) * kesir;
            const ya = f.ly[b + tam] + (f.ly[b + tam + 1] - f.ly[b + tam]) * kesir;
            ctx.lineTo(cx + xa * k, cy + ya * k);
          }
        }
        if (gec === 0) {
          ctx.strokeStyle = `hsl(${tonAnahtar(f.ton)},28%,62%)`;
          ctx.globalAlpha = 0.2 * solma; ctx.lineWidth = 3.6 * kb;
        } else {
          ctx.strokeStyle = `hsl(${tonAnahtar(f.ton)},36%,80%)`;
          ctx.globalAlpha = 0.7 * solma; ctx.lineWidth = 1.1 * kb;
        }
        ctx.stroke();
      }
      // uçlardaki tomurcuklar
      const tb = 7 * kb;
      for (let l = 0; l < f.say; l++) {
        const gl = f.gecik[l];
        const g = sinir((G - gl) / (1 - gl), 0, 1);
        if (g <= 0) continue;
        const b = l * LIF_NOKTA;
        const ust = g * son, tam = Math.min(son - 1, Math.floor(ust)), kesir = ust - tam;
        const xa = f.lx[b + tam] + (f.lx[b + tam + 1] - f.lx[b + tam]) * kesir;
        const ya = f.ly[b + tam] + (f.ly[b + tam + 1] - f.ly[b + tam]) * kesir;
        ctx.globalAlpha = solma * (0.55 + 0.45 * (1 - g * 0.5));
        ctx.drawImage(f.sp, cx + xa * k - tb, cy + ya * k - tb, tb * 2, tb * 2);
      }
    }
    ctx.globalAlpha = 1;
  }

  _nabizKur(n, P) {
    // çok uzun girdiyi seyrelt
    if (P.length > 200) {
      const adim = Math.ceil(P.length / 200), Q = [];
      for (let i = 0; i < P.length; i += adim) Q.push(P[i]);
      if (Q[Q.length - 1] !== P[P.length - 1]) Q.push(P[P.length - 1]);
      P = Q;
    }
    const L = P.length;
    const parcaTavan = Math.max(1, Math.floor((NABIZ_ORNEK - 1) / (L - 1)));
    let m = 0, kum = 0;
    n.xs[0] = P[0].x; n.ys[0] = P[0].y; n.kum[0] = 0; m = 1;
    for (let i = 0; i < L - 1; i++) {
      const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(L - 1, i + 2)];
      const segUz = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const adim = sinir(Math.ceil(segUz / 10), 1, Math.min(32, parcaTavan));
      for (let j = 1; j <= adim; j++) {
        const t = j / adim, t2 = t * t, t3 = t2 * t;
        const x = 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
        const y = 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
        kum += Math.hypot(x - n.xs[m - 1], y - n.ys[m - 1]);
        n.xs[m] = x; n.ys[m] = y; n.kum[m] = kum; m++;
        if (m >= NABIZ_ORNEK) break;
      }
      if (m >= NABIZ_ORNEK) break;
    }
    n.m = m; n.uzun = kum;
  }

  /** Yol üzerinde `d` uzaklığındaki dünya noktası → this._kx, this._ky; dönen: örnek indeksi. */
  _nabizKonum(n, d) {
    const m = n.m;
    if (m < 2 || d <= 0) { this._kx = n.xs[0]; this._ky = n.ys[0]; return 0; }
    if (d >= n.uzun) { this._kx = n.xs[m - 1]; this._ky = n.ys[m - 1]; return m - 1; }
    let lo = 0, hi = m - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (n.kum[mid] <= d) lo = mid; else hi = mid; }
    const seg = n.kum[hi] - n.kum[lo];
    const u = seg > 0 ? (d - n.kum[lo]) / seg : 0;
    this._kx = n.xs[lo] + (n.xs[hi] - n.xs[lo]) * u;
    this._ky = n.ys[lo] + (n.ys[hi] - n.ys[lo]) * u;
    return lo;
  }

  _nabizlarCiz(ctx, s) {
    const N = this._nabizlar;
    const ox = this._ox, oy = this._oy, sa = this._sa, sd = this._sd;
    const R = sinir(7 * s, 4.5, 13);
    for (let i = 0; i < N.n; i++) {
      const n = N.d[i];
      const t = Math.min(1, n.yas / n.sure);
      const bas = n.uzun * yumusakIkili(t);
      const kuyrukUz = Math.min(n.uzun * 0.45, 120 / Math.max(s, 1e-3));
      const geriSay = n.yas > n.sure ? Math.max(0, 1 - (n.yas - n.sure) / 0.4) : 1;
      const giris = Math.min(1, n.yas / 0.12);
      const kuyruk = Math.max(0, bas - kuyrukUz * geriSay * Math.min(1, t * 3 + 0.15));
      const ib = this._nabizKonum(n, bas); const hx = ox + this._kx * sa, hy = oy + this._ky * sd;
      const ik = this._nabizKonum(n, kuyruk); const kx = ox + this._kx * sa, ky = oy + this._ky * sd;
      const tn = tonAnahtar(n.ton);
      // kuyruk: lif boyunca parlayan iz
      if (Math.hypot(hx - kx, hy - ky) > 1) {
        const lg = ctx.createLinearGradient(kx, ky, hx, hy);
        lg.addColorStop(0, `hsla(${tn},34%,70%,0)`);
        lg.addColorStop(1, `hsla(${tn},38%,82%,1)`);
        ctx.strokeStyle = lg;
        ctx.beginPath(); ctx.moveTo(kx, ky);
        for (let j = ik + 1; j <= ib; j++) ctx.lineTo(ox + n.xs[j] * sa, oy + n.ys[j] * sd);
        ctx.lineTo(hx, hy);
        ctx.globalAlpha = 0.18 * giris * geriSay; ctx.lineWidth = R * 1.5; ctx.stroke();
        ctx.globalAlpha = 0.6 * giris * geriSay; ctx.lineWidth = Math.max(1, R * 0.35); ctx.stroke();
        // kuyruk boyunca sönen ışık izleri
        for (let j = 1; j <= 5; j++) {
          const d = bas - ((bas - kuyruk) * j) / 6;
          this._nabizKonum(n, d);
          const rr = R * 2.4 * (1 - j / 7);
          ctx.globalAlpha = 0.5 * (1 - j / 6) * giris * geriSay;
          ctx.drawImage(n.sp, ox + this._kx * sa - rr, oy + this._ky * sd - rr, rr * 2, rr * 2);
        }
      }
      if (n.yas <= n.sure + 0.15) {
        const a = giris * (n.yas > n.sure ? Math.max(0, 1 - (n.yas - n.sure) / 0.15) : 1);
        const pul = 1 + 0.12 * Math.sin(n.yas * 22);
        let rr = R * 7 * pul;
        ctx.globalAlpha = 0.16 * a; ctx.drawImage(n.sp, hx - rr, hy - rr, rr * 2, rr * 2);
        rr = R * 3.2 * pul;
        ctx.globalAlpha = 0.8 * a; ctx.drawImage(n.sp, hx - rr, hy - rr, rr * 2, rr * 2);
      }
    }
    ctx.globalAlpha = 1;
  }

  _parcaciklarCiz(ctx, k, kb) {
    const P = this._p;
    const ox = this._ox, oy = this._oy, sa = this._sa, sd = this._sd, t = this._t;
    const w = this.w, h = this.h;
    for (let i = 0; i < P.n; i++) {
      const p = P.d[i];
      const u = p.yas / p.omur;
      let a = p.alfa * (u < 0.12 ? u / 0.12 : Math.pow((1 - u) / 0.88, 1.3));
      if (p.kirp > 0) a *= 0.55 + 0.45 * Math.sin(t * p.kirp + p.f);
      if (a < 0.01) continue;
      const r = p.boy * kb;
      const x = ox + p.ax * sa + p.lx * k, y = oy + p.ay * sd + p.ly * k;
      if (x < -r || y < -r || x > w + r || y > h + r) continue;
      ctx.globalAlpha = a > 1 ? 1 : a;
      ctx.drawImage(p.sp, x - r, y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
  }

  _onSporCiz(ctx) {
    const Wb = this.w + 400, Hb = this.h + 400;
    const dx = this._ox - this.w / 2, dy = this._oy - this.h / 2;
    for (const b of this._onSpor) {
      const x = mod(b.x + dx * b.z, Wb) - 200, y = mod(b.y + dy * b.z, Hb) - 200;
      ctx.globalAlpha = b.alfa;
      ctx.drawImage(b.sp, x - b.r, y - b.r, b.r * 2, b.r * 2);
    }
    ctx.globalAlpha = 1;
  }
}
