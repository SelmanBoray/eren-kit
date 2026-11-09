// Beyin arayüzü sahnesi — "Biyolüminesan Mantar Ağı" (bağımlılıksız ES modülü, Canvas 2D).
// Ağı çizer (miselyum lifleri, ışıldayan mantar/nöron düğümler, etiketler) ve gezinmeyi sağlar.
// Metinler yalnız canvas `fillText` ile basılır; DOM'a içerik yazılmaz.

const TAU = Math.PI * 2;
const FOSIL_DURUMLAR = new Set(['arsiv', 'bitti']);
// Palet: SOZLESME §0.1 — pastel toprak tonları; doygunluk ≤%40, ışıma opaklığı ≤0.35.
const ILGILI_TON = 318; // soluk gül-mor (toz pembe/lavanta arası) — `ilgili` lifleri
const MUHUR_TON = 36; // kum/kehribar mühür
const OZEL_TON = 38; // krem-gri sis
const OLCEK_MAKS = 8;
const SURUKLEME_ESIGI = 5; // px (fare)
const SURUKLEME_ESIGI_DOKUNMA = 10; // px
const CIFT_TIK_MS = 330;
const FILIZ_SURE = 1.1; // sn
const SONME_SURE = 0.7; // sn
const ETIKET_ESIGI = 6.5; // ekran px cinsinden mantar yarıçapı
const ETIKET_MAKS = 140;
const IZGARA_HUCRE = 80; // dünya birimi
const ZAMANDA_FILIZ_MAKS = 10;

// ---------------------------------------------------------------- yardımcılar

function ozet32(s) {
  // FNV-1a
  let h = 0x811c9dc5;
  const m = String(s);
  for (let i = 0; i < m.length; i++) {
    h ^= m.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function rastgele(tohum) {
  // mulberry32
  let a = (tohum >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const kisit = (v, a, b) => (v < a ? a : v > b ? b : v);
const yumusak = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const disariGeri = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

function zamanMs(s) {
  if (s == null || s === '') return NaN;
  if (typeof s === 'number') return s;
  const m = String(s);
  // sqlite biçimi "YYYY-MM-DD HH:MM:SS" → ISO
  return Date.parse(m.length > 10 && m[10] === ' ' ? m.slice(0, 10) + 'T' + m.slice(11) : m);
}

// Renk dizgisi → küçük tamsayı (gruplama anahtarlarında dizgi birleştirmeden kaçınmak için)
const RENK_NO = new Map();
function renkNo(renk) {
  let n = RENK_NO.get(renk);
  if (n === undefined) {
    n = RENK_NO.size + 1;
    RENK_NO.set(renk, n);
  }
  return n;
}

function kisalt(s, n) {
  const m = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  if (m.length <= n) return m;
  return m.slice(0, n - 1).trimEnd() + '…';
}

// ---------------------------------------------------------------- kamera

class Kamera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.olcek = 1;
    this.w = 1;
    this.h = 1;
  }

  ekran(x, y) {
    return [(x - this.x) * this.olcek + this.w / 2, (y - this.y) * this.olcek + this.h / 2];
  }

  dunya(sx, sy) {
    return [(sx - this.w / 2) / this.olcek + this.x, (sy - this.h / 2) / this.olcek + this.y];
  }
}

// ---------------------------------------------------------------- önceden çizilmiş ışık lekeleri

class LekeDeposu {
  constructor() {
    this._m = new Map();
  }

  _tuval(n) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(n, n);
    const c = document.createElement('canvas');
    c.width = n;
    c.height = n;
    return c;
  }

  /** tur ∈ {hale, cekirdek, sis}; ton 6°'ye nicemlenir. */
  al(tur, ton) {
    const tq = (((Math.round(ton / 6) * 6) % 360) + 360) % 360;
    const k = tur + tq;
    let s = this._m.get(k);
    if (s) return s;
    const n = tur === 'cekirdek' ? 64 : 128;
    s = this._tuval(n);
    const g = s.getContext('2d');
    const m = n / 2;
    const rg = g.createRadialGradient(m, m, 0, m, m, m);
    if (tur === 'hale') {
      // yumuşak, geniş, pastel hale (merkez opaklığı ≤0.35)
      rg.addColorStop(0, `hsla(${tq},38%,78%,0.34)`);
      rg.addColorStop(0.18, `hsla(${tq},36%,74%,0.2)`);
      rg.addColorStop(0.45, `hsla(${tq},32%,70%,0.08)`);
      rg.addColorStop(0.75, `hsla(${tq},28%,66%,0.025)`);
      rg.addColorStop(1, `hsla(${tq},28%,66%,0)`);
    } else if (tur === 'cekirdek') {
      // iç çekirdek: krem-pastel, beyaza patlamaz
      rg.addColorStop(0, `hsla(${tq},40%,86%,0.7)`);
      rg.addColorStop(0.3, `hsla(${tq},38%,80%,0.42)`);
      rg.addColorStop(0.65, `hsla(${tq},34%,74%,0.1)`);
      rg.addColorStop(1, `hsla(${tq},30%,70%,0)`);
    } else {
      // sis: düşük doygunluk, dağınık
      rg.addColorStop(0, `hsla(${tq},14%,76%,0.26)`);
      rg.addColorStop(0.45, `hsla(${tq},12%,70%,0.1)`);
      rg.addColorStop(1, `hsla(${tq},10%,66%,0)`);
    }
    g.fillStyle = rg;
    g.fillRect(0, 0, n, n);
    this._m.set(k, s);
    return s;
  }
}

// ---------------------------------------------------------------- düğüm biçim verisi (id tohumlu)

function dendritUret(rnd, kok) {
  // Yerel birim (r = 1) koordinatlarda kuadratik eğriler: [x0,y0,cx,cy,x1,y1, ...]
  // Yerel "yukarı" (-y) ebeveynden dışarıyı gösterir; sap +y yönünde ebeveyne bakar.
  const d = [];
  const ekle = (x0, y0, aci, uz, kivrim) => {
    const x1 = x0 + Math.cos(aci) * uz;
    const y1 = y0 + Math.sin(aci) * uz;
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    const k = (rnd() - 0.5) * kivrim * uz;
    d.push(x0, y0, mx - Math.sin(aci) * k, my + Math.cos(aci) * k, x1, y1);
    return [x1, y1];
  };
  if (kok) {
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + (rnd() - 0.5) * 0.5;
      const uz = 1.3 + rnd() * 1.1;
      const bx = Math.cos(a) * 0.95;
      const by = Math.sin(a) * 0.95;
      const [ux, uy] = ekle(bx, by, a, uz, 0.8);
      ekle(ux, uy, a + 0.5 + rnd() * 0.3, uz * 0.45, 0.6);
      ekle(ux, uy, a - 0.5 - rnd() * 0.3, uz * 0.4, 0.6);
    }
    return d;
  }
  const n = 3 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const a = Math.PI / 2 + (rnd() - 0.5) * 2.4;
    const uz = 0.9 + rnd() * 1.4;
    const [ux, uy] = ekle(0, 1.0, a, uz, 0.9);
    if (rnd() < 0.8) {
      const t = 0.55 + rnd() * 0.2;
      const fx = (0 + (ux - 0) * t);
      const fy = (1.0 + (uy - 1.0) * t);
      ekle(fx, fy, a + (rnd() < 0.5 ? -1 : 1) * (0.45 + rnd() * 0.4), uz * 0.45, 0.7);
    }
  }
  // şapka kenarından iki kılcal
  for (const yan of [-1, 1]) {
    if (rnd() < 0.75) ekle(yan * 0.95, 0.05, (yan < 0 ? Math.PI : 0) + yan * (0.3 + rnd() * 0.5), 0.5 + rnd() * 0.6, 0.8);
  }
  return d;
}

function benekUret(rnd) {
  const b = [];
  const n = 3 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const x = (rnd() - 0.5) * 1.2;
    const y = -0.2 - rnd() * 0.42 * (1 - Math.abs(x));
    b.push(x, y, 0.05 + rnd() * 0.07);
  }
  return b;
}

function catlakUret(rnd) {
  // Taşlaşmış şapka üzerinde kırık çizgiler (birim koordinat polilinler)
  const c = [];
  const n = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const p = [];
    let x = (rnd() - 0.5) * 1.4;
    let y = -0.05 - rnd() * 0.25;
    p.push(x, y);
    const adim = 2 + Math.floor(rnd() * 2);
    for (let j = 0; j < adim; j++) {
      x += (rnd() - 0.5) * 0.45;
      y -= 0.12 + rnd() * 0.18;
      p.push(x, y);
    }
    c.push(p);
  }
  return c;
}

function runUret(rnd) {
  // Mühür halkası üzerinde küçük işaretler: her biri 3 doğru parçası (birim kutu -1..1)
  const r = [];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const g = [];
    for (let j = 0; j < 3; j++) {
      g.push((rnd() - 0.5) * 2, (rnd() - 0.5) * 2, (rnd() - 0.5) * 2, (rnd() - 0.5) * 2);
    }
    r.push(g);
  }
  return r;
}

// ---------------------------------------------------------------- sahne

export class Sahne {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} efektler efekt.js `Efektler` örneği
   */
  constructor(canvas, efektler) {
    this.canvas = canvas;
    this.ef = efektler || null;
    this.ctx = canvas.getContext('2d');
    this.kamera = new Kamera();

    this._dinleyiciler = new Map();
    this._leke = new LekeDeposu();

    this._graf = null;
    this._kokId = null;
    this._dugumler = [];
    this._harita = new Map();
    this._kenarlar = [];
    this._kenarHarita = new Map();
    this._sira = [];
    this._izgara = new Map();
    this._maksR = 40;
    this._izgaraKirli = false;

    this._vurgu = null;
    this._secili = null;
    this._secKenar = new Set();
    this._secDugum = new Set();
    this._zaman = null;
    this._uzerinde = null;

    this.t = 0;
    this._sonDamga = 0;
    this._raf = 0;
    this._calisiyor = false;
    this._dpr = 1;
    this._ilkVeri = true;
    this._kameraHazir = false;
    this._parlaklikT = 0;

    this._ucus = null;
    this._yakin = null;
    this._hiz = { vx: 0, vy: 0 };
    this._ip = new Map();
    this._surukle = null;
    this._sikistir = null;
    this._sonTik = null;

    this._zamanlanmis = [];
    this._nabizlar = [];
    this._olcekMin = 0.03;
    this._azHareket = false;
    this._yazi = 'system-ui, sans-serif';
    this._hataSayisi = 0;
    this._akis = [];
    this._etiketAday = [];
    this._kareOrt = 0;
    this._hafif = false;

    this._kareBagli = (z) => this._kare(z);

    try {
      if (!canvas.hasAttribute('tabindex')) canvas.tabIndex = 0;
      canvas.style.touchAction = 'none';
      canvas.style.cursor = 'grab';
      canvas.style.outline = 'none';
    } catch (_) { /* yoksay */ }

    this._hareketTercihiKur();
    this._yaziOku();
    this._boyutKur();
    this._isaretciKur();
    this._gorunurlukKur();
  }

  // ============================================================ genel API

  /** Olay dinleyicisi ekler. Dönen fonksiyon kaldırır. */
  on(olay, fn) {
    if (!this._dinleyiciler.has(olay)) this._dinleyiciler.set(olay, new Set());
    this._dinleyiciler.get(olay).add(fn);
    return () => this._dinleyiciler.get(olay)?.delete(fn);
  }

  baslat() {
    if (this._calisiyor) return;
    this._calisiyor = true;
    this._sonDamga = 0;
    this._boyutla();
    if (!this._belgeGizli()) this._raf = requestAnimationFrame(this._kareBagli);
  }

  /**
   * Graf ve yerleşimi ayarlar; tekrar çağrılabilir (canlı güncelleme).
   * @param {object} graf `/api/ui/graf` yanıtı
   * @param {Map<string, {x,y,r,ton,dal,derinlik}>} yerler
   */
  veriAyarla(graf, yerler) {
    this._graf = graf || { dugumler: [], kenarlar: [] };
    const kokId = this._graf.kok || null;
    const ilk = this._ilkVeri;
    const simdi = this._referansZaman();
    const yeniIdler = new Set();
    const eskiHarita = this._harita;
    const yeniDugumler = [];
    const yeniHarita = new Map();
    let filizSayisi = 0;

    const dugumler = Array.isArray(this._graf.dugumler) ? this._graf.dugumler : [];
    let bulunanKok = null;
    for (const v of dugumler) {
      if (!v || v.id == null) continue;
      const y = yerler && yerler.get ? yerler.get(v.id) : null;
      if (!y) continue;
      yeniIdler.add(v.id);
      let d = eskiHarita.get(v.id);
      const yeni = !d || d.silinecek;
      if (!d) {
        d = this._dugumOlustur(v, y);
        d.gor = 0;
        d.buyuyor = true;
        d.hedef = true;
        d.gecikme = 0;
        if (ilk) {
          d.gecikme = this._azHareket ? 0 : Math.min(2.6, (v.derinlik || 0) * 0.2 + d.rnd0 * 0.3);
        } else if (filizSayisi < ZAMANDA_FILIZ_MAKS) {
          d.filizIste = true;
          filizSayisi++;
        }
      } else {
        this._dugumGuncelle(d, v, y);
        if (yeni) {
          d.silinecek = false;
          d.buyuyor = true;
          d.filizIste = true;
        }
      }
      if (v.id === kokId || (!kokId && (v.derinlik === 0))) bulunanKok = v.id;
      yeniDugumler.push(d);
      yeniHarita.set(v.id, d);
    }
    this._kokId = kokId || bulunanKok;

    // Kaybolanlar söner
    for (const [id, d] of eskiHarita) {
      if (yeniIdler.has(id)) continue;
      d.silinecek = true;
      d.hedef = false;
      d.buyuyor = false;
      yeniDugumler.push(d);
      yeniHarita.set(id, d);
    }

    this._dugumler = yeniDugumler;
    this._harita = yeniHarita;

    for (const d of this._dugumler) {
      d.kok = d.id === this._kokId;
      d.zamanda = this._zamandaMi(d);
      if (!d.silinecek) {
        const hedef = d.zamanda;
        if (hedef !== d.hedef) {
          d.hedef = hedef;
          d.buyuyor = hedef;
        }
      }
      d.parlak = d.kok ? 1 : this._parlaklik(d, simdi);
    }
    for (const d of this._dugumler) this._yonHesapla(d);
    this._kenarlariKur();
    this._siraKur();
    this._izgaraKur();
    if (this._secili && !this._harita.has(this._secili)) this._secili = null;
    this._secimZinciriKur();

    // efekt.js fosil halkası yarıçapı: kökten en uzak düğüm mesafesi
    if (this.ef && typeof this.ef === 'object') {
      const kok = this._kokId != null ? this._harita.get(this._kokId) : null;
      const ox = kok ? kok.hx : 0;
      const oy = kok ? kok.hy : 0;
      let enUzak = 0;
      for (const d of this._dugumler) {
        if (d.silinecek) continue;
        const u = Math.hypot(d.hx - ox, d.hy - oy) + d.r;
        if (u > enUzak) enUzak = u;
      }
      if (enUzak > 0) {
        try { this.ef.agYaricapi = enUzak; } catch (_) { /* yoksay */ }
      }
    }

    this._ilkVeri = false;
    if (!this._kameraHazir && this.kamera.w > 2 && this._dugumler.length) {
      this.genelBakis(true);
      this._kameraHazir = true;
    } else {
      this._olcekSinirHesapla();
    }
  }

  /** Eşleşen düğümleri parlatır, kalanını karartır; null normale döner. */
  vurgula(ids) {
    this._vurgu = ids && typeof ids.has === 'function' ? ids : null;
  }

  /** Seçili düğüm; etrafında halka, kökten yolu aydınlanır. */
  sec(id) {
    this._secili = id != null && this._harita.has(id) ? id : null;
    this._secimZinciriKur();
  }

  /** Yumuşak kamera uçuşuyla düğüme odaklanır. */
  odaklan(id, { sure = 900 } = {}) {
    const d = this._harita.get(id);
    if (!d) return false;
    const hedefOlcek = kisit(Math.max(36 / Math.max(d.r, 1), 1.2), this._olcekMin, Math.min(OLCEK_MAKS, 5));
    this._ucusBaslat(d.x, d.y, hedefOlcek, sure);
    return true;
  }

  /** Tüm (görünür) ağı ekrana sığdırır. */
  genelBakis(anlik = false) {
    const k = this._sinirlar(true);
    const cam = this.kamera;
    if (!k) {
      this._ucusBaslat(0, 0, 1, anlik === true ? 0 : 700);
      return;
    }
    const pay = 60;
    const gw = Math.max(1, cam.w - pay * 2);
    const gh = Math.max(1, cam.h - pay * 2);
    const olcek = Math.min(gw / Math.max(k.w, 1), gh / Math.max(k.h, 1), 3);
    this._olcekSinirHesapla(olcek);
    const s = kisit(olcek, this._olcekMin, OLCEK_MAKS);
    this._ucusBaslat(k.cx, k.cy, s, anlik === true ? 0 : 750);
  }

  /** Zaman süzgeci: yalnız `olusturma <= t` düğümleri. null = hepsi. */
  zamanAyarla(t) {
    const yeni = t == null || !Number.isFinite(Number(t)) ? null : Number(t);
    this._zaman = yeni;
    const ref = this._referansZaman();
    let filiz = 0;
    for (const d of this._dugumler) {
      d.zamanda = this._zamandaMi(d);
      if (!d.silinecek && d.zamanda !== d.hedef) {
        d.hedef = d.zamanda;
        d.buyuyor = d.zamanda;
        d.gecikme = 0;
        if (d.zamanda && filiz < ZAMANDA_FILIZ_MAKS) {
          d.filizIste = true;
          filiz++;
        }
      }
      d.parlak = d.kok ? 1 : this._parlaklik(d, ref);
    }
  }

  /** Kökten düğüme birincil zincir boyunca nabız; varışta filiz. */
  nabiz(dugumId) {
    const d = this._harita.get(dugumId);
    if (!d) return;
    const zincir = this._zincir(d);
    const noktalar = [];
    const kenarlar = new Set();
    if (zincir.length <= 1) {
      noktalar.push({ x: d.x, y: d.y });
    } else {
      noktalar.push({ x: zincir[0].x, y: zincir[0].y });
      for (let i = 1; i < zincir.length; i++) {
        const a = zincir[i - 1];
        const b = zincir[i];
        const k = this._kenarHarita.get(a.id + '>' + b.id);
        if (k) {
          kenarlar.add(k.anahtar);
          this._kontrolHesapla(k);
          const n = 10;
          for (let j = 1; j <= n; j++) {
            const u = j / n;
            const v = 1 - u;
            noktalar.push({
              x: v * v * a.x + 2 * v * u * k.cx + u * u * b.x,
              y: v * v * a.y + 2 * v * u * k.cy + u * u * b.y,
            });
          }
        } else {
          noktalar.push({ x: b.x, y: b.y });
        }
      }
    }
    let uz = 0;
    for (let i = 1; i < noktalar.length; i++) uz += Math.hypot(noktalar[i].x - noktalar[i - 1].x, noktalar[i].y - noktalar[i - 1].y);
    this._ef('nabiz', noktalar, d.ton);
    // efekt.js nabız süresiyle aynı formül (varışta filiz eşzamanlı olsun)
    const sure = noktalar.length < 2 ? 0 : kisit(uz / 650, 0.7, 2.4) * (this._azHareket ? 0.6 : 1);
    this._nabizlar.push({ kenarlar, bas: this.t, sure });
    this._zamanla(sure, () => {
      const g = this._harita.get(dugumId);
      if (!g) return;
      this._ef('filiz', g.x, g.y, g.ton);
      g.nabizT = this.t;
    });
  }

  // ============================================================ veri iç işleri

  _dugumOlustur(v, y) {
    const rnd = rastgele(ozet32(v.id));
    const d = {
      id: v.id,
      rnd0: rnd(),
      faz: rnd() * TAU,
      dendrit: null,
      benek: benekUret(rnd),
      catlak: catlakUret(rnd),
      run: runUret(rnd),
      sisFaz: [rnd() * TAU, rnd() * TAU, rnd() * TAU, rnd() * TAU],
      x: y.x, y: y.y, hx: y.x, hy: y.y,
      gor: 0, hedef: true, buyuyor: true, gecikme: 0, silinecek: false, filizIste: false,
      vf: 1, nabizT: -1e9, parlak: 0.5, zamanda: true,
      _rnd: rnd,
    };
    this._dugumGuncelle(d, v, y);
    d.dendrit = dendritUret(rastgele(ozet32(v.id) ^ 0x9e3779b9), false);
    d.kokDendrit = null;
    return d;
  }

  _dugumGuncelle(d, v, y) {
    d.veri = v;
    d.baslik = v.baslik == null ? '' : String(v.baslik);
    d.kisa = kisalt(d.baslik, 30);
    d.olcu = null;
    d.ebeveyn = v.ebeveyn == null ? null : v.ebeveyn;
    d.derinlik = Number.isFinite(v.derinlik) ? v.derinlik : (y.derinlik || 0);
    d.hx = y.x;
    d.hy = y.y;
    if (!Number.isFinite(d.x)) { d.x = y.x; d.y = y.y; }
    d.r = kisit(Number(y.r) || 8, 2, 80);
    d.ton = Number.isFinite(y.ton) ? y.ton : 45;
    d.dal = y.dal == null ? null : y.dal;
    d.gizlilik = v.gizlilik === 'ozel' || v.gizlilik === 'sir_icerir' ? v.gizlilik : (v.gizlilik === 'normal' ? 'normal' : 'sir_icerir');
    d.fosil = FOSIL_DURUMLAR.has(v.durum);
    d.olguEski = d.gizlilik === 'sir_icerir' ? 0 : (Number(v.olgu_eski) || 0);
    d.olusMs = zamanMs(v.olusturma);
    d.gunMs = zamanMs(v.guncelleme);
    const t = d.ton;
    if (d.fosil) {
      // taşlaşmış: gri-kehribar taş, kum rengi kenar
      d.renkDolgu = 'hsl(32,14%,30%)';
      d.renkKenar = 'hsl(35,40%,67%)'; // #cdb08a
      d.renkLif = 'hsl(34,18%,46%)';
      d.renkEtiket = 'hsl(35,30%,74%)';
    } else if (d.gizlilik === 'sir_icerir') {
      // mühürlü: koyu çikolata şapka
      d.renkDolgu = 'hsl(28,20%,9%)';
      d.renkKenar = 'hsl(30,18%,24%)';
      d.renkLif = 'hsl(32,20%,34%)';
      d.renkEtiket = 'hsl(36,36%,72%)';
    } else if (d.gizlilik === 'ozel') {
      // özel: sisli, düşük doygunluk
      // krem-gri sis
      d.renkDolgu = `hsl(${OZEL_TON},14%,70%)`;
      d.renkKenar = `hsl(${OZEL_TON},16%,80%)`;
      d.renkLif = `hsl(${OZEL_TON},14%,52%)`;
      d.renkEtiket = `hsl(${OZEL_TON},14%,84%)`;
    } else {
      // pastel mantar: doygunluk %22–40, açıklık %66–80; lif daha koyu ve soluk
      d.renkDolgu = `hsl(${t},32%,66%)`;
      d.renkKenar = `hsl(${t},38%,80%)`;
      d.renkLif = `hsl(${t},24%,54%)`;
      d.renkEtiket = `hsl(${t},30%,86%)`;
    }
    d.renkBenek = `hsl(${t},36%,88%)`;
    d.renkNo = renkNo(d.renkDolgu + d.renkKenar);
    d.lifNo = renkNo(d.renkLif);
    d.kenarNo = renkNo(d.renkKenar);
    d.renkSap = d.fosil ? 'hsl(32,12%,26%)' : `hsl(${t},20%,58%)`;
  }

  _yonHesapla(d) {
    if (d.kok) {
      d.yon = -Math.PI / 2;
      if (!d.kokDendrit) d.kokDendrit = dendritUret(rastgele(ozet32(d.id) ^ 0x51ed27), true);
      return;
    }
    const e = d.ebeveyn != null ? this._harita.get(d.ebeveyn) : null;
    if (e) {
      const dx = d.hx - e.hx;
      const dy = d.hy - e.hy;
      d.yon = dx === 0 && dy === 0 ? -Math.PI / 2 : Math.atan2(dy, dx);
    } else {
      d.yon = -Math.PI / 2;
    }
  }

  _kenarlariKur() {
    const eski = this._kenarHarita;
    const yeni = new Map();
    const liste = [];
    const kenarlar = this._graf && Array.isArray(this._graf.kenarlar) ? this._graf.kenarlar : [];
    for (const v of kenarlar) {
      if (!v) continue;
      const e = this._harita.get(v.ebeveyn);
      const c = this._harita.get(v.cocuk);
      if (!e || !c || e === c) continue;
      const tur = v.tur === 'ilgili' ? 'ilgili' : 'alt';
      const anahtar = v.ebeveyn + '>' + v.cocuk + (tur === 'ilgili' ? '~' : '');
      let k = eski.get(anahtar);
      if (!k) {
        const rnd = rastgele(ozet32(anahtar));
        const yon = rnd() < 0.5 ? -1 : 1;
        k = {
          anahtar,
          sapma: tur === 'ilgili' ? yon * (0.22 + rnd() * 0.28) : (rnd() - 0.5) * 0.42,
          faz: rnd() * TAU,
          periyot: 7 + rnd() * 10,
          akisFaz: rnd() * 20,
          cx: 0, cy: 0,
        };
      }
      k.e = e;
      k.c = c;
      k.tur = tur;
      k.birincil = !!v.birincil;
      if (yeni.has(anahtar)) continue;
      yeni.set(anahtar, k);
      liste.push(k);
    }
    // birincil alt kenarları ayrıca anahtarsız ad ile de bul (nabız/seçim yolu için)
    for (const d of this._dugumler) {
      if (d.ebeveyn == null) continue;
      const a = d.ebeveyn + '>' + d.id;
      if (!yeni.has(a)) {
        const e = this._harita.get(d.ebeveyn);
        if (!e) continue;
        // grafta kenar yoksa birincil ebeveyn ilişkisinden üret
        let k = eski.get(a);
        if (!k) {
          const rnd = rastgele(ozet32(a));
          k = { anahtar: a, sapma: (rnd() - 0.5) * 0.42, faz: rnd() * TAU, periyot: 7 + rnd() * 10, akisFaz: rnd() * 20, cx: 0, cy: 0 };
        }
        k.e = e;
        k.c = d;
        k.tur = 'alt';
        k.birincil = true;
        yeni.set(a, k);
        liste.push(k);
      }
    }
    // ilgili önce (altta), sonra alt
    liste.sort((p, q) => (p.tur === q.tur ? 0 : p.tur === 'ilgili' ? -1 : 1));
    this._kenarlar = liste;
    this._kenarHarita = yeni;
  }

  _siraKur() {
    this._sira = this._dugumler.slice().sort((a, b) => (b.derinlik - a.derinlik) || (a.r - b.r));
  }

  _izgaraKur() {
    const g = new Map();
    let maksR = 6;
    for (const d of this._dugumler) {
      if (d.silinecek) continue;
      const cx = Math.floor(d.x / IZGARA_HUCRE);
      const cy = Math.floor(d.y / IZGARA_HUCRE);
      const k = cx + ',' + cy;
      let h = g.get(k);
      if (!h) g.set(k, (h = []));
      h.push(d);
      if (d.r > maksR) maksR = d.r;
    }
    this._izgara = g;
    this._maksR = maksR;
    this._izgaraKirli = false;
  }

  _zincir(d) {
    const z = [];
    const gorulen = new Set();
    let n = d;
    while (n && !gorulen.has(n.id)) {
      gorulen.add(n.id);
      z.push(n);
      n = n.ebeveyn != null ? this._harita.get(n.ebeveyn) : null;
    }
    return z.reverse();
  }

  _secimZinciriKur() {
    this._secKenar = new Set();
    this._secDugum = new Set();
    const d = this._secili ? this._harita.get(this._secili) : null;
    if (!d) return;
    const z = this._zincir(d);
    for (let i = 0; i < z.length; i++) {
      this._secDugum.add(z[i].id);
      if (i > 0) this._secKenar.add(z[i - 1].id + '>' + z[i].id);
    }
  }

  _zamandaMi(d) {
    if (this._zaman == null) return true;
    if (!Number.isFinite(d.olusMs)) return true;
    return d.olusMs <= this._zaman;
  }

  _referansZaman() {
    return this._zaman == null ? Date.now() : this._zaman;
  }

  _parlaklik(d, ref) {
    let g = d.gunMs;
    if (!Number.isFinite(g) || g > ref) g = d.olusMs;
    if (!Number.isFinite(g)) return 0.35;
    if (g > ref) g = ref;
    const gun = (ref - g) / 864e5;
    if (gun < 1) return 1;
    return kisit(1 - Math.log10(gun) * 0.36, 0.16, 1);
  }

  _sinirlar(yalnizGorunur) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    let n = 0;
    for (const d of this._dugumler) {
      if (d.silinecek) continue;
      if (yalnizGorunur && !d.hedef) continue;
      const r = d.r * 1.6;
      if (d.hx - r < x0) x0 = d.hx - r;
      if (d.hy - r < y0) y0 = d.hy - r;
      if (d.hx + r > x1) x1 = d.hx + r;
      if (d.hy + r * 2.2 > y1) y1 = d.hy + r * 2.2;
      n++;
    }
    if (!n) {
      if (yalnizGorunur) return this._sinirlar(false);
      return null;
    }
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
  }

  _olcekSinirHesapla(sigdir) {
    let s = sigdir;
    if (!Number.isFinite(s)) {
      const k = this._sinirlar(false);
      if (!k) return;
      s = Math.min(this.kamera.w / Math.max(k.w, 1), this.kamera.h / Math.max(k.h, 1));
    }
    this._olcekMin = kisit(s * 0.35, 0.005, 0.5);
  }

  // ============================================================ döngü

  _kare(damga) {
    this._raf = 0;
    if (!this._calisiyor) return;
    const ms = Number.isFinite(damga) ? damga : (typeof performance !== 'undefined' ? performance.now() : Date.now());
    let dt = this._sonDamga ? (ms - this._sonDamga) / 1000 : 1 / 60;
    this._sonDamga = ms;
    dt = kisit(dt, 0, 0.1);
    if (!this._belgeGizli()) this._raf = requestAnimationFrame(this._kareBagli);
    try {
      this._guncelle(dt);
      // kare sırası: efektler.guncelle → arkaPlanCiz → kenarlar → düğümler → etiketler → onPlanCiz
      this._ef('guncelle', dt);
      const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
      this._ciz(dt);
      if (t0) {
        // uyarlamalı kalite: kare süresi uzarsa sönük/uzak düğümlerin halesi atlanır
        const sure = performance.now() - t0;
        this._kareOrt = this._kareOrt * 0.92 + sure * 0.08;
        if (!this._hafif && this._kareOrt > 18) this._hafif = true;
        else if (this._hafif && this._kareOrt < 11) this._hafif = false;
      }
    } catch (hata) {
      this._hataBildir(hata);
    }
  }

  _guncelle(dt) {
    this.t += dt;
    const cam = this.kamera;

    // DPR değişti mi (pencere başka ekrana taşındı)?
    const dpr = this._dprAl();
    if (dpr !== this._dpr) this._boyutla();

    // Zamanlanmış işler
    if (this._zamanlanmis.length) {
      const kalan = [];
      for (const z of this._zamanlanmis) {
        if (this.t >= z.zaman) {
          try { z.fn(); } catch (h) { this._hataBildir(h); }
        } else kalan.push(z);
      }
      this._zamanlanmis = kalan;
    }
    if (this._nabizlar.length) this._nabizlar = this._nabizlar.filter((n) => this.t - n.bas < n.sure + 0.8);

    // Kamera uçuşu
    if (this._ucus) {
      const u = this._ucus;
      const p = u.sure <= 0 ? 1 : kisit((this.t - u.bas) / u.sure, 0, 1);
      const e = yumusak(p);
      cam.x = u.x0 + (u.x1 - u.x0) * e;
      cam.y = u.y0 + (u.y1 - u.y0) * e;
      const ls = Math.log(u.s0) + (Math.log(u.s1) - Math.log(u.s0)) * e;
      cam.olcek = Math.exp(ls) * (1 - u.dalis * Math.sin(Math.PI * e));
      if (p >= 1) {
        cam.olcek = u.s1;
        this._ucus = null;
      }
    }

    // Tekerlek yakınlaştırma (yumuşak)
    if (this._yakin) {
      const z = this._yakin;
      const ls = Math.log(cam.olcek);
      const lh = Math.log(z.hedef);
      const k = this._azHareket ? 1 : 1 - Math.exp(-dt * 16);
      const yeni = Math.exp(ls + (lh - ls) * k);
      this._olcekleAt(yeni, z.ax, z.ay);
      if (Math.abs(lh - Math.log(yeni)) < 0.002) {
        this._olcekleAt(z.hedef, z.ax, z.ay);
        this._yakin = null;
      }
    }

    // Eylemsizlik (kaydırma sonrası süzülme)
    if (!this._ip.size && (this._hiz.vx || this._hiz.vy)) {
      cam.x -= (this._hiz.vx * dt) / cam.olcek;
      cam.y -= (this._hiz.vy * dt) / cam.olcek;
      const sonum = Math.exp(-dt * 4.5);
      this._hiz.vx *= sonum;
      this._hiz.vy *= sonum;
      if (Math.abs(this._hiz.vx) < 4 && Math.abs(this._hiz.vy) < 4) this._hiz.vx = this._hiz.vy = 0;
    }

    // Parlaklık yenile (gerçek zamanda, 30 sn'de bir)
    if (this._zaman == null && this.t - this._parlaklikT > 30) {
      this._parlaklikT = this.t;
      const ref = Date.now();
      for (const d of this._dugumler) d.parlak = d.kok ? 1 : this._parlaklik(d, ref);
    }

    // Düğüm durumları
    const vurgu = this._vurgu;
    const k8 = 1 - Math.exp(-dt * 8);
    const kayma = 1 - Math.exp(-dt * 5);
    let silinecekVar = false;
    let kirli = false;
    for (const d of this._dugumler) {
      if (d.hedef) {
        if (d.gecikme > 0) d.gecikme -= dt;
        else if (d.gor < 1) {
          const onceki = d.gor;
          d.gor = this._azHareket ? 1 : Math.min(1, d.gor + dt / FILIZ_SURE);
          if (d.filizIste && onceki < 0.38 && d.gor >= 0.38) {
            d.filizIste = false;
            this._ef('filiz', d.x, d.y, d.ton);
          }
          if (d.gor >= 1) d.filizIste = false;
        }
      } else if (d.gor > 0) {
        d.gor = this._azHareket ? 0 : Math.max(0, d.gor - dt / SONME_SURE);
      }
      if (d.silinecek && d.gor <= 0) silinecekVar = true;

      const hedefVf = vurgu ? (vurgu.has(d.id) ? 1.35 : this._secDugum.has(d.id) ? 0.55 : 0.12) : 1;
      d.vf += (hedefVf - d.vf) * k8;

      if (d.x !== d.hx || d.y !== d.hy) {
        const dx = d.hx - d.x;
        const dy = d.hy - d.y;
        if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05 || this._azHareket) {
          d.x = d.hx;
          d.y = d.hy;
        } else {
          d.x += dx * kayma;
          d.y += dy * kayma;
        }
        kirli = true;
      }
    }
    if (silinecekVar) this._silinenleriAt();
    else if (kirli || this._izgaraKirli) this._izgaraKur();
  }

  _silinenleriAt() {
    this._dugumler = this._dugumler.filter((d) => !(d.silinecek && d.gor <= 0));
    this._harita = new Map(this._dugumler.map((d) => [d.id, d]));
    this._kenarlar = this._kenarlar.filter((k) => this._harita.get(k.e.id) === k.e && this._harita.get(k.c.id) === k.c);
    this._kenarHarita = new Map(this._kenarlar.map((k) => [k.anahtar, k]));
    this._siraKur();
    this._izgaraKur();
    if (this._uzerinde && !this._harita.has(this._uzerinde)) this._uzerinde = null;
  }

  _ciz() {
    const ctx = this.ctx;
    const cam = this.kamera;
    const dpr = this._dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, cam.w, cam.h);

    this._efCiz('arkaPlanCiz');
    this._durumSifirla();
    this._kenarlarCiz(ctx, cam);
    this._durumSifirla();
    this._dugumlerCiz(ctx, cam);
    this._durumSifirla();
    this._etiketlerCiz(ctx, cam);
    this._durumSifirla();
    this._efCiz('onPlanCiz');
  }

  _durumSifirla() {
    const ctx = this.ctx;
    const dpr = this._dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    if (ctx.setLineDash) ctx.setLineDash([]);
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
  }

  _efCiz(ad) {
    if (!this.ef || typeof this.ef[ad] !== 'function') return;
    const ctx = this.ctx;
    ctx.save();
    try {
      this.ef[ad](ctx, this.kamera);
    } catch (h) {
      this._hataBildir(h);
    }
    ctx.restore();
  }

  _ef(ad, ...arg) {
    if (!this.ef || typeof this.ef[ad] !== 'function') return undefined;
    try {
      return this.ef[ad](...arg);
    } catch (h) {
      this._hataBildir(h);
      return undefined;
    }
  }

  _hataBildir(h) {
    this._hataSayisi++;
    if (this._hataSayisi <= 3 && typeof console !== 'undefined') console.error('sahne:', h);
  }

  // ============================================================ kenarlar (miselyum)

  _kontrolHesapla(k) {
    const e = k.e;
    const c = k.c;
    const dx = c.x - e.x;
    const dy = c.y - e.y;
    const len = Math.hypot(dx, dy) || 1;
    const dalga = this._azHareket ? 0 : Math.sin(this.t * 0.55 + k.faz) * 0.028;
    const sap = (k.sapma + dalga) * len;
    k.cx = (e.x + c.x) / 2 - (dy / len) * sap;
    k.cy = (e.y + c.y) / 2 + (dx / len) * sap;
    k.len = len;
  }

  _kenarlarCiz(ctx, cam) {
    const s = cam.olcek;
    const hw = cam.w / 2;
    const hh = cam.h / 2;
    const pay = 40 / s;
    const vx0 = cam.x - hw / s - pay;
    const vx1 = cam.x + hw / s + pay;
    const vy0 = cam.y - hh / s - pay;
    const vy1 = cam.y + hh / s + pay;
    const vurgu = this._vurgu;
    const basit = new Map();
    const ilgili = new Map();
    const akis = this._akis;
    akis.length = 0;
    const nabizKenar = this._nabizlar.length ? this._nabizlar : null;
    const yogun = this._kenarlar.length > 900;

    // lifler toprakta krem-kahve kök gibi: ölçülü karışım için kaynak üstü
    ctx.globalCompositeOperation = 'source-over';
    for (const k of this._kenarlar) {
      const e = k.e;
      const c = k.c;
      if (e.gor <= 0 || c.gor <= 0) continue;
      if (e.gecikme > 0 || c.gecikme > 0) continue;
      this._kontrolHesapla(k);
      const minx = Math.min(e.x, c.x, k.cx);
      const maxx = Math.max(e.x, c.x, k.cx);
      const miny = Math.min(e.y, c.y, k.cy);
      const maxy = Math.max(e.y, c.y, k.cy);
      if (maxx < vx0 || minx > vx1 || maxy < vy0 || miny > vy1) continue;

      // filizlenme: lif ebeveynden çocuğa doğru uzar
      const ilerleme = c.buyuyor ? kisit(c.gor / 0.45, 0, 1) : 1;
      if (ilerleme <= 0.001) continue;
      let a = 1;
      if (!c.buyuyor) a = Math.min(a, c.gor);
      if (!e.buyuyor) a = Math.min(a, e.gor);
      else if (e.gor < 1) a = Math.min(a, kisit(e.gor * 2, 0, 1));

      let vf = 1;
      if (vurgu) {
        const ve = vurgu.has(e.id);
        const vc = vurgu.has(c.id);
        vf = ve && vc ? 1.2 : vc || ve ? 0.4 : 0.07;
      }
      const sec = this._secKenar.has(k.anahtar);
      if (sec && vurgu) vf = Math.max(vf, 0.9);
      let nb = 0;
      if (nabizKenar) {
        for (const n of nabizKenar) {
          if (n.kenarlar.has(k.anahtar)) {
            const p = (this.t - n.bas) / (n.sure + 0.8);
            nb = Math.max(nb, Math.sin(Math.PI * kisit(p, 0, 1)));
          }
        }
      }

      const x0 = (e.x - cam.x) * s + hw;
      const y0 = (e.y - cam.y) * s + hh;
      let cx = (k.cx - cam.x) * s + hw;
      let cy = (k.cy - cam.y) * s + hh;
      let x1 = (c.x - cam.x) * s + hw;
      let y1 = (c.y - cam.y) * s + hh;
      if (ilerleme < 1) {
        // kuadratik eğriyi ilerleme noktasında böl (de Casteljau)
        const u = ilerleme;
        const v = 1 - u;
        const ex = v * v * x0 + 2 * v * u * cx + u * u * x1;
        const ey = v * v * y0 + 2 * v * u * cy + u * u * y1;
        cx = x0 + (cx - x0) * u;
        cy = y0 + (cy - y0) * u;
        x1 = ex;
        y1 = ey;
      }
      const ekranUz = k.len * s * ilerleme;
      const parlak = Math.min(1, (e.parlak + c.parlak * 2) / 3);

      if (k.tur === 'ilgili') {
        const al = kisit(0.34 * a * vf * (0.45 + 0.55 * parlak) * (1 + nb), 0, 1);
        if (al < 0.01) continue;
        const q = Math.max(1, Math.round(al * 20));
        let dizi = ilgili.get(q);
        if (!dizi) ilgili.set(q, (dizi = []));
        dizi.push(x0, y0, cx, cy, x1, y1);
        continue;
      }

      let w0 = k.birincil ? kisit(c.r * 0.1 * s, 0.7, 4.5) : kisit(c.r * 0.06 * s, 0.5, 2.4);
      let al = (0.16 + 0.42 * parlak) * a * vf;
      if (sec) {
        al = Math.min(0.9, al * 1.4 + 0.18);
        w0 = Math.min(6, w0 * 1.3 + 0.4);
      }
      if (nb > 0) {
        al = Math.min(1, al + 0.5 * nb);
        w0 *= 1 + 0.4 * nb;
      }
      al = kisit(al, 0, 1);
      if (al < 0.01) continue;
      const renk = sec ? c.renkKenar : c.renkLif;

      if (ekranUz < 30 || (!sec && (yogun || w0 < 1.3) && ekranUz < 90)) {
        const wq = Math.max(0.5, Math.round(w0 * 0.7 * 2) / 2);
        const aq = Math.max(1, Math.round(al * 20));
        const anah = ((sec ? c.kenarNo : c.lifNo) * 32 + aq) * 64 + wq * 2;
        let g = basit.get(anah);
        if (!g) basit.set(anah, (g = { renk, a: aq / 20, w: wq, dizi: [] }));
        g.dizi.push(x0, y0, cx, cy, x1, y1);
      } else {
        // ışıma payı (yakında birincil lifler için)
        if (k.birincil && ekranUz > 80 && s > 0.6) {
          ctx.globalAlpha = al * 0.1;
          ctx.strokeStyle = renk;
          ctx.lineWidth = w0 * 2.4;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.quadraticCurveTo(cx, cy, x1, y1);
          ctx.stroke();
        }
        ctx.globalAlpha = al;
        ctx.fillStyle = renk;
        this._incelenLif(ctx, x0, y0, cx, cy, x1, y1, w0, w0 * 0.32, ekranUz > 220 ? 16 : 9);
      }

      if (ilerleme >= 1 && ekranUz > 28 && (!this._azHareket || sec)) {
        akis.push(k, x0, y0, cx, cy, x1, y1, al, w0, sec ? 1 : 0);
      }
    }

    // basit (uzak) lifler: gruplanmış tek vuruş
    ctx.lineCap = 'round';
    for (const g of basit.values()) {
      ctx.globalAlpha = g.a;
      ctx.strokeStyle = g.renk;
      ctx.lineWidth = g.w;
      ctx.beginPath();
      const d = g.dizi;
      for (let i = 0; i < d.length; i += 6) {
        ctx.moveTo(d[i], d[i + 1]);
        ctx.quadraticCurveTo(d[i + 2], d[i + 3], d[i + 4], d[i + 5]);
      }
      ctx.stroke();
    }

    // ilgili lifler: ince, benekli, mor
    if (ilgili.size) {
      ctx.strokeStyle = `hsl(${ILGILI_TON},24%,70%)`;
      ctx.lineWidth = s > 1.5 ? 1.3 : 1;
      if (ctx.setLineDash) ctx.setLineDash([1.2, 5.5]);
      ctx.lineDashOffset = this._azHareket ? 0 : -this.t * 6;
      for (const [q, d] of ilgili) {
        ctx.globalAlpha = q / 20;
        ctx.beginPath();
        for (let i = 0; i < d.length; i += 6) {
          ctx.moveTo(d[i], d[i + 1]);
          ctx.quadraticCurveTo(d[i + 2], d[i + 3], d[i + 4], d[i + 5]);
        }
        ctx.stroke();
      }
      if (ctx.setLineDash) ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    }

    // besin ışıkları: kökten dışa, yavaş ve seyrek (yumuşak 'lighter')
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < akis.length; i += 10) {
      const k = akis[i];
      const x0 = akis[i + 1], y0 = akis[i + 2], cx = akis[i + 3], cy = akis[i + 4], x1 = akis[i + 5], y1 = akis[i + 6];
      const al = akis[i + 7];
      const w0 = akis[i + 8];
      const sec = akis[i + 9] === 1;
      const yol = Math.max(1.4, Math.min(4.5, k.len / 110));
      const isiklar = [];
      if (!this._azHareket) {
        const u = ((this.t + k.akisFaz) % k.periyot) / yol;
        if (u < 1) isiklar.push(u);
      }
      if (sec) {
        const hz = this._azHareket ? 0 : this.t * 0.45;
        isiklar.push((hz) % 1, (hz + 0.5) % 1);
      }
      if (!isiklar.length) continue;
      const leke = this._leke.al('cekirdek', k.c.ton);
      const R = kisit(w0 * 2.8, 3, 13);
      for (const u of isiklar) {
        const v = 1 - u;
        const px = v * v * x0 + 2 * v * u * cx + u * u * x1;
        const py = v * v * y0 + 2 * v * u * cy + u * u * y1;
        ctx.globalAlpha = kisit((0.35 + al) * Math.sin(Math.PI * u), 0, 1);
        ctx.drawImage(leke, px - R, py - R, R * 2, R * 2);
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Kuadratik eğri boyunca kalından inceye dolgulu lif. */
  _incelenLif(ctx, x0, y0, cx, cy, x1, y1, w0, w1, n) {
    ctx.beginPath();
    for (let pas = 0; pas < 2; pas++) {
      for (let j = 0; j <= n; j++) {
        const i = pas === 0 ? j : n - j;
        const u = i / n;
        const v = 1 - u;
        const px = v * v * x0 + 2 * v * u * cx + u * u * x1;
        const py = v * v * y0 + 2 * v * u * cy + u * u * y1;
        let tx = 2 * v * (cx - x0) + 2 * u * (x1 - cx);
        let ty = 2 * v * (cy - y0) + 2 * u * (y1 - cy);
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl;
        ty /= tl;
        const w = (w0 + (w1 - w0) * u) * 0.5 * (pas === 0 ? 1 : -1);
        const qx = px - ty * w;
        const qy = py + tx * w;
        if (pas === 0 && j === 0) ctx.moveTo(qx, qy);
        else ctx.lineTo(qx, qy);
      }
    }
    ctx.closePath();
    ctx.fill();
  }

  // ============================================================ düğümler (mantar / nöron)

  _dugumlerCiz(ctx, cam) {
    const s = cam.olcek;
    const hw = cam.w / 2;
    const hh = cam.h / 2;
    const dpr = this._dpr;
    const t = this.t;
    const nefesGenlik = this._azHareket ? 0 : 0.035;
    const adaylar = this._etiketAday;
    adaylar.length = 0;
    const vurgu = this._vurgu;

    // Görünür düğümleri ve ekran ölçülerini topla
    const gorunen = [];
    for (const d of this._sira) {
      if (d.gor <= 0 || d.gecikme > 0) continue;
      const sx = (d.x - cam.x) * s + hw;
      const sy = (d.y - cam.y) * s + hh;
      let rs = d.r * s;
      const pay = Math.max(rs * 5, 14) + 30;
      if (sx < -pay || sx > cam.w + pay || sy < -pay || sy > cam.h + pay) continue;
      // filizlenme ölçeği / sönme
      let olc = 1;
      let al = 1;
      if (d.buyuyor && d.gor < 1) {
        const p = kisit((d.gor - 0.35) / 0.65, 0, 1);
        olc = p <= 0 ? 0 : disariGeri(p);
        al = kisit(d.gor * 2.5, 0, 1);
      } else if (!d.buyuyor) {
        al = d.gor;
        olc = 0.7 + 0.3 * d.gor;
      }
      if (olc <= 0.001) continue;
      const nefes = 1 + nefesGenlik * Math.sin(t * 1.1 + d.faz);
      rs *= olc * nefes;
      // varış nabzı: kısa şişme
      const nz = t - d.nabizT;
      let nabiz = 0;
      if (nz >= 0 && nz < 2.2) {
        nabiz = Math.exp(-nz * 2.2);
        rs *= 1 + 0.25 * nabiz * Math.sin(Math.min(nz * 9, Math.PI));
      }
      const isik = (0.88 + (this._azHareket ? 0 : 0.12 * Math.sin(t * 0.7 + d.faz * 1.3))) * d.parlak;
      gorunen.push({ d, sx, sy, rs, al, isik, nabiz, cx: 0, cy: 0, cR: 0, cA: 0, aci: 0 });
    }

    // 1) Haleler ('lighter')
    ctx.globalCompositeOperation = 'lighter';
    for (const g of gorunen) this._haleCiz(ctx, g, t);

    // 2) Fosil katmanları (eski olgular) — kaynak üstü
    ctx.globalCompositeOperation = 'source-over';
    for (const g of gorunen) {
      if (g.d.olguEski > 0 && g.rs >= 2.5) this._fosilKatmanCiz(ctx, g);
    }

    // 3) Taşlaşmış ve mühürlü gövdeler — kaynak üstü
    for (const g of gorunen) {
      const d = g.d;
      if (d.fosil) this._fosilGovdeCiz(ctx, g, dpr);
      else if (d.gizlilik === 'sir_icerir') this._muhurluGovdeCiz(ctx, g, dpr, t);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 4) Pastel gövdeler — kaynak üstü (yalnız iç çekirdek 'lighter')
    ctx.globalCompositeOperation = 'source-over';
    for (const g of gorunen) {
      const d = g.d;
      if (d.fosil || d.gizlilik === 'sir_icerir') continue;
      if (d.kok) this._kokCiz(ctx, g, dpr, t);
      else if (g.rs >= 1.8 && g.rs < 7 && d.gizlilik !== 'ozel') this._ortaMantarCiz(ctx, g, t);
      else this._mantarCiz(ctx, g, dpr, t);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 4b) İç çekirdekler — tek 'lighter' geçişi
    ctx.globalCompositeOperation = 'lighter';
    for (const g of gorunen) {
      if (!(g.cR > 0) || g.cA < 0.01) continue;
      ctx.globalAlpha = g.cA;
      ctx.drawImage(this._leke.al('cekirdek', g.d.ton), g.cx - g.cR, g.cy - g.cR, g.cR * 2, g.cR * 2);
    }
    ctx.globalCompositeOperation = 'source-over';

    // 5) Seçim ve üzerinde halkaları
    for (const g of gorunen) {
      const d = g.d;
      const secili = d.id === this._secili;
      const uzerinde = d.id === this._uzerinde;
      if (secili || uzerinde) this._halkaCiz(ctx, g, secili, t);
      // etiket adayı
      const zorunlu = d.kok || d.derinlik <= 1 || secili || uzerinde || (vurgu && vurgu.has(d.id));
      if (zorunlu || g.rs >= ETIKET_ESIGI) {
        if (vurgu && !zorunlu && !vurgu.has(d.id)) continue;
        let oncelik;
        if (d.kok) oncelik = 1e7;
        else if (secili) oncelik = 9e6;
        else if (uzerinde) oncelik = 8e6;
        else if (vurgu && vurgu.has(d.id)) oncelik = 5e6 + g.rs;
        else if (d.derinlik <= 1) oncelik = 4e6 + g.rs;
        else oncelik = g.rs * (0.6 + 0.4 * d.parlak);
        adaylar.push({ g, oncelik, zorunlu: !!(d.kok || secili || uzerinde), herZaman: !!(d.kok || d.derinlik <= 1 || secili || uzerinde) });
      }
    }
    ctx.globalAlpha = 1;
  }

  _haleCiz(ctx, g, t) {
    const d = g.d;
    const { sx, sy, rs } = g;
    const vf = d.vf;
    const al = g.al;
    if (this._hafif && rs < 7 && d.derinlik > 1 && g.isik < 0.6 && vf <= 1 && !g.nabiz && d.id !== this._secili) {
      // hafif kip: sönük/uzak düğümde hale yerine yalnız ışık noktası (_mantarCiz/_ortaMantarCiz)
      if (rs < 1.8 && !d.fosil && d.gizlilik !== 'sir_icerir') {
        ctx.globalAlpha = kisit((0.35 + 0.55 * g.isik) * al, 0, 1);
        ctx.fillStyle = d.renkBenek;
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(rs * 0.8, 0.9), 0, TAU);
        ctx.fill();
      }
      return;
    }
    if (d.fosil) {
      // taşlaşmış: neredeyse ışıksız, çok soluk kehribar iz
      ctx.globalAlpha = kisit(0.1 * al * Math.min(vf, 1), 0, 1);
      const R = Math.max(rs * 2.2, 5);
      ctx.drawImage(this._leke.al('hale', 36), sx - R, sy - R, R * 2, R * 2);
      return;
    }
    if (d.gizlilik === 'sir_icerir') {
      ctx.globalAlpha = kisit(0.16 * al * Math.min(vf, 1.2), 0, 1);
      const R = Math.max(rs * 2.4, 5);
      ctx.drawImage(this._leke.al('hale', MUHUR_TON), sx - R, sy - R, R * 2, R * 2);
      return;
    }
    const isik = g.isik;
    const sec = d.id === this._secili ? 0.35 : 0;
    if (d.gizlilik === 'ozel') {
      const leke = this._leke.al('sis', OZEL_TON);
      const R = Math.max(rs * 4.6, 7);
      const kay = this._azHareket ? 0 : rs * 0.45;
      ctx.globalAlpha = kisit((0.55 + 0.45 * isik) * al * vf, 0, 1);
      ctx.drawImage(leke, sx - R + Math.cos(t * 0.31 + d.faz) * kay, sy - R + Math.sin(t * 0.23 + d.faz) * kay, R * 2, R * 2);
      ctx.drawImage(leke, sx - R * 0.8 + Math.cos(t * 0.19 + d.faz * 2) * kay, sy - R * 0.8 + Math.sin(t * 0.27 + d.faz) * kay, R * 1.6, R * 1.6);
      ctx.globalAlpha = kisit((0.12 + 0.2 * isik + sec) * al * vf, 0, 1);
      const R2 = Math.max(rs * 2.8, 4);
      ctx.drawImage(this._leke.al('hale', d.ton), sx - R2, sy - R2, R2 * 2, R2 * 2);
      // sis zerreleri
      if (rs >= 4) {
        const z = this._leke.al('sis', OZEL_TON);
        for (let i = 0; i < 4; i++) {
          const f = d.sisFaz[i];
          const aci = f + (this._azHareket ? 0 : t * 0.12 * (i % 2 ? 1 : -1));
          const uz = rs * (1.5 + 0.5 * Math.sin((this._azHareket ? 0 : t * 0.4) + f));
          const zr = rs * (0.7 + 0.2 * i);
          ctx.globalAlpha = kisit(0.7 * al * vf, 0, 1);
          ctx.drawImage(z, sx + Math.cos(aci) * uz - zr, sy + Math.sin(aci) * uz * 0.8 - zr, zr * 2, zr * 2);
        }
      }
      return;
    }
    // normal / kök
    const kokCarpan = d.kok ? 1.5 : 1;
    const R = Math.max(rs * 4.2 * kokCarpan * (0.65 + 0.35 * isik) * (1 + g.nabiz * 0.6), 6);
    ctx.globalAlpha = kisit((0.28 + 0.72 * isik + sec + g.nabiz * 0.5) * al * Math.min(vf, 1.5), 0, 1);
    ctx.drawImage(this._leke.al('hale', d.ton), sx - R, sy - R, R * 2, R * 2);
    if (rs < 1.8) {
      // uzak: yalnız ışık noktası
      // (küçük yol dolgusu leke basmaktan ucuz)
      ctx.globalAlpha = kisit((0.35 + 0.55 * isik) * al * Math.min(vf, 1.3), 0, 1);
      ctx.fillStyle = d.renkBenek;
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(rs * 0.8, 0.9), 0, TAU);
      ctx.fill();
    }
  }

  _donusturAyarla(ctx, dpr, sx, sy, aci) {
    const c = Math.cos(aci);
    const s = Math.sin(aci);
    ctx.setTransform(dpr * c, dpr * s, -dpr * s, dpr * c, dpr * sx, dpr * sy);
  }

  /** Kubbe biçimli şapka yolu (yerel koordinat, merkez 0,0). */
  _sapkaYolu(ctx, rs, oy) {
    ctx.beginPath();
    ctx.ellipse(0, oy, rs, rs * 0.78, 0, Math.PI, TAU);
    ctx.quadraticCurveTo(0, oy + rs * 0.34, -rs, oy);
    ctx.closePath();
  }

  _dendritCiz(ctx, dizi, rs) {
    ctx.beginPath();
    for (let i = 0; i < dizi.length; i += 6) {
      ctx.moveTo(dizi[i] * rs, dizi[i + 1] * rs);
      ctx.quadraticCurveTo(dizi[i + 2] * rs, dizi[i + 3] * rs, dizi[i + 4] * rs, dizi[i + 5] * rs);
    }
    ctx.stroke();
  }

  _mantarCiz(ctx, g, dpr, t) {
    const d = g.d;
    const { sx, sy, rs } = g;
    if (rs < 1.8) return; // uzak: hale + çekirdek noktası yeterli
    const ozel = d.gizlilik === 'ozel';
    const vf = Math.min(d.vf, 1.4);
    const isik = g.isik;
    const al = g.al;
    const salinim = this._azHareket ? 0 : Math.sin(t * 0.8 + d.faz) * 0.05;
    this._donusturAyarla(ctx, dpr, sx, sy, d.yon + Math.PI / 2 + salinim);
    const tam = rs >= 7;
    const oy = -rs * 0.1;

    if (tam) {
      // kılcal dendritler
      ctx.strokeStyle = d.renkLif;
      ctx.lineWidth = Math.max(0.5, rs * 0.035);
      ctx.lineCap = 'round';
      ctx.globalAlpha = kisit((ozel ? 0.18 : 0.3) * (0.4 + 0.6 * isik) * al * vf, 0, 1);
      this._dendritCiz(ctx, d.dendrit, rs);
      // sap
      ctx.strokeStyle = d.renkSap;
      ctx.lineWidth = rs * 0.26;
      ctx.globalAlpha = kisit((ozel ? 0.25 : 0.45) * (0.5 + 0.5 * isik) * al * vf, 0, 1);
      ctx.beginPath();
      ctx.moveTo(0, oy + rs * 0.12);
      ctx.quadraticCurveTo(rs * 0.12 * Math.sin(d.faz), rs * 0.6, rs * 0.05 * Math.cos(d.faz), rs * 1.05);
      ctx.stroke();
    }

    // şapka
    const kopya = ozel ? 2 : 1;
    for (let i = 0; i < kopya; i++) {
      const ox = ozel ? (i ? 1 : -1) * rs * 0.09 : 0;
      if (ox) ctx.translate(ox, ox * 0.5);
      ctx.fillStyle = d.renkDolgu;
      ctx.globalAlpha = kisit((ozel ? 0.3 : 0.3 + 0.55 * isik) * al * vf, 0, 1);
      this._sapkaYolu(ctx, rs, oy);
      ctx.fill();
      ctx.strokeStyle = d.renkKenar;
      ctx.lineWidth = Math.max(0.8, rs * 0.07);
      ctx.globalAlpha = kisit((ozel ? 0.3 : 0.45 + 0.5 * isik) * al * vf, 0, 1);
      ctx.stroke();
      if (ox) ctx.translate(-ox, -ox * 0.5);
    }

    if (tam && !ozel) {
      // iç halka ve lameller
      ctx.strokeStyle = d.renkKenar;
      ctx.lineWidth = Math.max(0.6, rs * 0.035);
      ctx.globalAlpha = kisit(0.3 * isik * al * vf, 0, 1);
      ctx.beginPath();
      ctx.ellipse(0, oy, rs * 0.62, rs * 0.46, 0, Math.PI * 1.05, Math.PI * 1.95);
      ctx.stroke();
      ctx.globalAlpha = kisit(0.22 * isik * al * vf, 0, 1);
      ctx.beginPath();
      for (let i = -3; i <= 3; i++) {
        const fx = i / 3.6;
        ctx.moveTo(0, oy + rs * 0.22);
        ctx.lineTo(fx * rs * 0.95, oy + rs * 0.02 + Math.abs(fx) * rs * 0.02);
      }
      ctx.stroke();
      // biyolüminesan benekler
      ctx.fillStyle = d.renkBenek;
      ctx.globalAlpha = kisit((0.4 + 0.6 * isik) * al * vf, 0, 1);
      ctx.beginPath();
      const b = d.benek;
      for (let i = 0; i < b.length; i += 3) {
        const px = b[i] * rs;
        const py = oy + b[i + 1] * rs;
        const pr = b[i + 2] * rs;
        ctx.moveTo(px + pr, py);
        ctx.arc(px, py, pr, 0, TAU);
      }
      ctx.fill();
    }

    // iç çekirdek: ayrı toplu 'lighter' geçişinde çizilir (kompozit değişimini azaltmak için)
    const ly = oy - rs * 0.25;
    const aci = d.yon + Math.PI / 2 + salinim;
    g.cx = sx - Math.sin(aci) * ly;
    g.cy = sy + Math.cos(aci) * ly;
    g.cR = rs * (ozel ? 0.7 : 0.85) * (1 + g.nabiz * 0.5);
    g.cA = kisit((ozel ? 0.35 : 0.45 + 0.55 * isik + g.nabiz) * al * vf, 0, 1);
  }

  /**
   * Orta ayrıntı (uzak) mantarlar: dönüşüm ve leke basmadan, döndürülmüş elipsli küçük kubbe yolu
   * + küçük çekirdek noktası. (Ölçüm: tek tek küçük yol ≈2 µs; döndürülmüş leke ≈6 µs; tek dev yol çok pahalı.)
   */
  _ortaMantarCiz(ctx, g, t) {
    const d = g.d;
    const vf = Math.min(d.vf, 1.4);
    const isik = g.isik;
    const al = g.al;
    const salinim = this._azHareket ? 0 : Math.sin(t * 0.8 + d.faz) * 0.05;
    const aci = d.yon + Math.PI / 2 + salinim;
    const rs = g.rs;
    const c = Math.cos(aci);
    const s = Math.sin(aci);
    const oy = -rs * 0.1;
    // yerel (lx, ly) → ekran: (sx + lx*c - ly*s, sy + lx*s + ly*c)
    const mx = g.sx - oy * s;
    const my = g.sy + oy * c;
    const ky = oy + rs * 0.34;
    ctx.beginPath();
    ctx.ellipse(mx, my, rs, rs * 0.78, aci, Math.PI, TAU);
    ctx.quadraticCurveTo(g.sx - ky * s, g.sy + ky * c, mx - rs * c, my - rs * s);
    ctx.closePath();
    ctx.fillStyle = d.renkDolgu;
    ctx.globalAlpha = kisit((0.3 + 0.55 * isik) * al * vf, 0, 1);
    ctx.fill();
    ctx.strokeStyle = d.renkKenar;
    ctx.lineWidth = 0.8;
    ctx.globalAlpha = kisit((0.45 + 0.5 * isik) * al * vf, 0, 1);
    ctx.stroke();
    if (rs >= 3) {
      const ly = -rs * 0.35;
      ctx.fillStyle = d.renkBenek;
      ctx.globalAlpha = kisit((0.35 + 0.6 * isik) * al * vf, 0, 1);
      ctx.beginPath();
      ctx.arc(g.sx - s * ly, g.sy + c * ly, Math.max(0.8, rs * 0.22), 0, TAU);
      ctx.fill();
    }
  }

  _kokCiz(ctx, g, dpr, t) {
    const d = g.d;
    const { sx, sy, rs } = g;
    const al = g.al;
    const vf = Math.min(Math.max(d.vf, 0.5), 1.4);
    // kalp atışı: çift vuruş
    const P = 2.6;
    const p = this._azHareket ? 0.5 : (t % P) / P;
    const atis = Math.exp(-Math.pow((p - 0.05) / 0.045, 2)) + 0.6 * Math.exp(-Math.pow((p - 0.2) / 0.05, 2));
    this._donusturAyarla(ctx, dpr, sx, sy, this._azHareket ? 0 : Math.sin(t * 0.15) * 0.08);

    // genişleyen dalga halkaları
    if (!this._azHareket && rs > 2) {
      ctx.strokeStyle = d.renkKenar;
      for (const ofs of [0, 0.5]) {
        const q = (p + ofs) % 1;
        ctx.globalAlpha = kisit(Math.pow(1 - q, 2) * 0.45 * al * vf, 0, 1);
        ctx.lineWidth = Math.max(0.7, rs * 0.05 * (1 - q));
        ctx.beginPath();
        ctx.arc(0, 0, rs * (1.15 + q * 4.2), 0, TAU);
        ctx.stroke();
      }
    }
    if (rs >= 5 && d.kokDendrit) {
      ctx.strokeStyle = d.renkLif;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(0.6, rs * 0.04);
      ctx.globalAlpha = kisit(0.38 * al * vf, 0, 1);
      this._dendritCiz(ctx, d.kokDendrit, rs);
    }
    if (rs >= 1.8) {
      // soma
      ctx.fillStyle = d.renkDolgu;
      ctx.globalAlpha = kisit((0.45 + 0.25 * atis) * al * vf, 0, 1);
      ctx.beginPath();
      ctx.arc(0, 0, rs * (1 + 0.05 * atis), 0, TAU);
      ctx.fill();
      ctx.strokeStyle = d.renkKenar;
      ctx.lineWidth = Math.max(1, rs * 0.07);
      ctx.globalAlpha = kisit((0.7 + 0.3 * atis) * al * vf, 0, 1);
      ctx.stroke();
      if (rs >= 7) {
        ctx.lineWidth = Math.max(0.6, rs * 0.03);
        ctx.globalAlpha = kisit(0.35 * al * vf, 0, 1);
        ctx.beginPath();
        ctx.arc(0, 0, rs * 0.68, 0, TAU);
        ctx.stroke();
        ctx.fillStyle = d.renkBenek;
        ctx.globalAlpha = kisit(0.7 * al * vf, 0, 1);
        ctx.beginPath();
        const b = d.benek;
        for (let i = 0; i < b.length; i += 3) {
          const px = b[i] * rs * 0.8;
          const py = (b[i + 1] + 0.3) * rs * 0.9;
          const pr = b[i + 2] * rs * 0.8;
          ctx.moveTo(px + pr, py);
          ctx.arc(px, py, pr, 0, TAU);
        }
        ctx.fill();
      }
    }
    // nabız atan çekirdek
    const Rc = Math.max(rs * (1.1 + 0.45 * atis + g.nabiz * 0.5), 2);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = kisit((0.7 + 0.3 * atis) * al, 0, 1);
    ctx.drawImage(this._leke.al('cekirdek', d.ton), -Rc, -Rc, Rc * 2, Rc * 2);
    const Rn = Rc * 0.45;
    ctx.globalAlpha = kisit(0.6 * al, 0, 1);
    ctx.drawImage(this._leke.al('cekirdek', 45), -Rn, -Rn, Rn * 2, Rn * 2);
    ctx.globalCompositeOperation = 'source-over';
  }

  _fosilKatmanCiz(ctx, g) {
    const d = g.d;
    const { sx, sy, rs } = g;
    const n = Math.min(4, 1 + Math.floor(Math.log2(d.olguEski)));
    const al = g.al * Math.min(d.vf, 1);
    ctx.lineWidth = Math.max(0.6, rs * 0.05);
    ctx.strokeStyle = 'hsl(36,32%,62%)';
    for (let i = 0; i < n; i++) {
      ctx.globalAlpha = kisit((0.34 - i * 0.065) * al, 0, 1);
      ctx.beginPath();
      ctx.ellipse(sx, sy + rs * (1.3 + i * 0.3), rs * (0.85 + i * 0.3), rs * (0.1 + i * 0.015), 0, 0, TAU);
      ctx.stroke();
    }
    if (rs >= 7) {
      // katmanlarda gömülü küçük fosil kabuklar
      ctx.fillStyle = 'hsl(38,28%,60%)';
      ctx.globalAlpha = kisit(0.35 * al, 0, 1);
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const fx = sx + (Math.sin(d.faz * (i + 2)) * 0.6) * rs * (0.85 + i * 0.3);
        const fy = sy + rs * (1.3 + i * 0.3);
        const fr = Math.max(0.8, rs * 0.05);
        ctx.moveTo(fx + fr, fy);
        ctx.arc(fx, fy, fr, 0, TAU);
      }
      ctx.fill();
    }
  }

  _fosilGovdeCiz(ctx, g, dpr) {
    const d = g.d;
    const { sx, sy, rs } = g;
    const al = g.al * Math.min(d.vf, 1);
    if (rs < 1.8) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = 'hsl(35,24%,52%)';
      ctx.globalAlpha = kisit(0.75 * al, 0, 1);
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(1.3, rs), 0, TAU);
      ctx.fill();
      return;
    }
    this._donusturAyarla(ctx, dpr, sx, sy, d.yon + Math.PI / 2);
    const oy = -rs * 0.1;
    const tam = rs >= 7;
    if (tam) {
      ctx.strokeStyle = 'hsl(32,12%,34%)';
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(0.5, rs * 0.035);
      ctx.globalAlpha = kisit(0.35 * al, 0, 1);
      this._dendritCiz(ctx, d.dendrit, rs * 0.85);
      ctx.strokeStyle = d.renkSap;
      ctx.lineWidth = rs * 0.26;
      ctx.globalAlpha = kisit(0.9 * al, 0, 1);
      ctx.beginPath();
      ctx.moveTo(0, oy + rs * 0.12);
      ctx.lineTo(0, rs * 1.0);
      ctx.stroke();
    }
    ctx.fillStyle = d.renkDolgu;
    ctx.globalAlpha = kisit(0.95 * al, 0, 1);
    this._sapkaYolu(ctx, rs, oy);
    ctx.fill();
    ctx.strokeStyle = d.renkKenar;
    ctx.lineWidth = Math.max(0.8, rs * 0.06);
    ctx.globalAlpha = kisit(0.65 * al, 0, 1);
    ctx.stroke();
    if (tam) {
      // çatlaklar ve taş benekleri (ışıksız doku)
      ctx.strokeStyle = 'hsl(28,18%,15%)';
      ctx.lineWidth = Math.max(0.6, rs * 0.03);
      ctx.globalAlpha = kisit(0.85 * al, 0, 1);
      ctx.beginPath();
      for (const p of d.catlak) {
        ctx.moveTo(p[0] * rs, oy + p[1] * rs);
        for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i] * rs, oy + p[i + 1] * rs);
      }
      ctx.stroke();
      ctx.fillStyle = 'hsl(38,24%,58%)';
      ctx.globalAlpha = kisit(0.45 * al, 0, 1);
      ctx.beginPath();
      const b = d.benek;
      for (let i = 0; i < b.length; i += 3) {
        const px = b[i] * rs;
        const py = oy + b[i + 1] * rs;
        const pr = b[i + 2] * rs * 0.6;
        ctx.moveTo(px + pr, py);
        ctx.arc(px, py, pr, 0, TAU);
      }
      ctx.fill();
    }
  }

  _muhurluGovdeCiz(ctx, g, dpr, t) {
    const d = g.d;
    const { sx, sy, rs } = g;
    const al = g.al * Math.min(d.vf, 1.2);
    const amber = `hsl(${MUHUR_TON},40%,68%)`;
    if (rs < 1.8) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = d.renkDolgu;
      ctx.globalAlpha = kisit(0.95 * al, 0, 1);
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(1.5, rs), 0, TAU);
      ctx.fill();
      ctx.strokeStyle = amber;
      ctx.lineWidth = 0.8;
      ctx.globalAlpha = kisit(0.55 * al, 0, 1);
      ctx.stroke();
      return;
    }
    this._donusturAyarla(ctx, dpr, sx, sy, d.yon + Math.PI / 2);
    const oy = -rs * 0.1;
    if (rs >= 7) {
      ctx.strokeStyle = d.renkKenar;
      ctx.lineWidth = rs * 0.24;
      ctx.lineCap = 'round';
      ctx.globalAlpha = kisit(0.9 * al, 0, 1);
      ctx.beginPath();
      ctx.moveTo(0, oy + rs * 0.12);
      ctx.lineTo(0, rs * 1.0);
      ctx.stroke();
    }
    ctx.fillStyle = d.renkDolgu;
    ctx.globalAlpha = kisit(0.97 * al, 0, 1);
    this._sapkaYolu(ctx, rs, oy);
    ctx.fill();
    ctx.strokeStyle = d.renkKenar;
    ctx.lineWidth = Math.max(0.8, rs * 0.06);
    ctx.globalAlpha = kisit(0.9 * al, 0, 1);
    ctx.stroke();

    // mühür halkası (dünya düzlemine hizalı, yavaş döner)
    ctx.setTransform(dpr, 0, 0, dpr, dpr * sx, dpr * sy);
    const R = rs * 1.4;
    ctx.strokeStyle = amber;
    ctx.lineWidth = Math.max(0.7, rs * 0.045);
    ctx.globalAlpha = kisit(0.6 * al, 0, 1);
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, TAU);
    ctx.stroke();
    const don = this._azHareket ? 0 : t * 0.05;
    if (rs >= 7) {
      // run işaretleri
      ctx.lineWidth = Math.max(0.6, rs * 0.03);
      ctx.lineCap = 'round';
      ctx.globalAlpha = kisit(0.75 * al, 0, 1);
      ctx.beginPath();
      const n = d.run.length;
      const boy = rs * 0.13;
      for (let i = 0; i < n; i++) {
        const a = don + (i / n) * TAU;
        const cx = Math.cos(a) * (R + boy * 1.6);
        const cy = Math.sin(a) * (R + boy * 1.6);
        const c = Math.cos(a + Math.PI / 2);
        const s = Math.sin(a + Math.PI / 2);
        const gl = d.run[i];
        for (let j = 0; j < gl.length; j += 4) {
          const ax = gl[j] * boy, ay = gl[j + 1] * boy, bx = gl[j + 2] * boy, by = gl[j + 3] * boy;
          ctx.moveTo(cx + ax * c - ay * s, cy + ax * s + ay * c);
          ctx.lineTo(cx + bx * c - by * s, cy + bx * s + by * c);
        }
      }
      ctx.stroke();
    } else {
      ctx.lineWidth = 1;
      ctx.globalAlpha = kisit(0.6 * al, 0, 1);
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = don + (i / 4) * TAU;
        ctx.moveTo(Math.cos(a) * R, Math.sin(a) * R);
        ctx.lineTo(Math.cos(a) * (R + 3), Math.sin(a) * (R + 3));
      }
      ctx.stroke();
    }
  }

  _halkaCiz(ctx, g, secili, t) {
    const d = g.d;
    const { sx, sy } = g;
    const rs = Math.max(g.rs, 3);
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = d.gizlilik === 'sir_icerir' ? `hsl(${MUHUR_TON},40%,74%)` : d.fosil ? 'hsl(36,34%,70%)' : d.renkKenar;
    if (secili) {
      const R = rs * (d.kok ? 1.6 : 1.75) + 4;
      ctx.lineWidth = 1.6;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(sx, sy, R, 0, TAU);
      ctx.stroke();
      ctx.lineWidth = 1.2;
      ctx.globalAlpha = 0.6;
      if (ctx.setLineDash) ctx.setLineDash([5, 7]);
      ctx.lineDashOffset = this._azHareket ? 0 : -t * 18;
      ctx.beginPath();
      ctx.arc(sx, sy, R + 5, 0, TAU);
      ctx.stroke();
      if (ctx.setLineDash) ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    } else {
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.4;
      ctx.beginPath();
      ctx.arc(sx, sy, rs * 1.6 + 3, 0, TAU);
      ctx.stroke();
    }
  }

  // ============================================================ etiketler

  _etiketlerCiz(ctx, cam) {
    const adaylar = this._etiketAday;
    if (!adaylar.length) return;
    adaylar.sort((a, b) => b.oncelik - a.oncelik);
    const kutular = new Map();
    const HUCRE = 64;
    const cakisir = (x0, y0, x1, y1) => {
      const a0 = Math.floor(x0 / HUCRE), a1 = Math.floor(x1 / HUCRE);
      const b0 = Math.floor(y0 / HUCRE), b1 = Math.floor(y1 / HUCRE);
      for (let i = a0; i <= a1; i++) {
        for (let j = b0; j <= b1; j++) {
          const h = kutular.get(i * 100003 + j);
          if (!h) continue;
          for (let k = 0; k < h.length; k += 4) {
            if (x0 < h[k + 2] && x1 > h[k] && y0 < h[k + 3] && y1 > h[k + 1]) return true;
          }
        }
      }
      return false;
    };
    const ekle = (x0, y0, x1, y1) => {
      const a0 = Math.floor(x0 / HUCRE), a1 = Math.floor(x1 / HUCRE);
      const b0 = Math.floor(y0 / HUCRE), b1 = Math.floor(y1 / HUCRE);
      for (let i = a0; i <= a1; i++) {
        for (let j = b0; j <= b1; j++) {
          const anah = i * 100003 + j;
          let h = kutular.get(anah);
          if (!h) kutular.set(anah, (h = []));
          h.push(x0, y0, x1, y1);
        }
      }
    };

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.globalCompositeOperation = 'source-over';
    let sayi = 0;
    let sonFont = '';
    for (const a of adaylar) {
      if (sayi >= ETIKET_MAKS) break;
      const g = a.g;
      const d = g.d;
      if (!d.kisa) continue;
      const kok = d.kok;
      const boy = kok ? 15 : d.derinlik <= 1 ? 13 : Math.round(11 + Math.min(2, g.rs * 0.05));
      const kalin = kok || d.derinlik <= 1 || d.id === this._secili ? '600 ' : '';
      const font = `${kalin}${boy}px ${this._yazi}`;
      if (font !== sonFont) {
        ctx.font = font;
        sonFont = font;
      }
      if (!d.olcu || d.olcu.f !== font) d.olcu = { f: font, w: ctx.measureText(d.kisa).width };
      const w = d.olcu.w;
      const asagi = d.kok ? Math.max(g.rs * 1.25, 6) : Math.max(g.rs * 1.15, 4);
      const x = g.sx;
      const y = g.sy + asagi + 3;
      const x0 = x - w / 2 - 3;
      const x1 = x + w / 2 + 3;
      const y0 = y - 1;
      const y1 = y + boy + 2;
      if (x1 < 0 || x0 > cam.w || y1 < 0 || y0 > cam.h) continue;
      if (!a.zorunlu && cakisir(x0, y0, x1, y1)) continue;
      ekle(x0, y0, x1, y1);
      sayi++;
      let al = a.herZaman ? 0.95 : kisit((g.rs - ETIKET_ESIGI) / 5 + 0.25, 0, 0.9);
      if (!a.herZaman && this._vurgu && this._vurgu.has(d.id)) al = 0.95;
      if (d.derinlik <= 1 && !kok && g.rs < 3) al *= 0.8;
      al *= g.al * kisit(d.vf, 0.25, 1);
      if (al < 0.03) continue;
      ctx.globalAlpha = al * 0.85;
      ctx.fillStyle = 'rgba(20,15,10,0.9)';
      ctx.fillText(d.kisa, x + 1, y + 1);
      ctx.fillText(d.kisa, x - 1, y);
      ctx.globalAlpha = al;
      ctx.fillStyle = d.renkEtiket;
      ctx.fillText(d.kisa, x, y);
    }
    ctx.globalAlpha = 1;
  }

  // ============================================================ kamera işleri

  _ucusBaslat(x, y, olcek, sure) {
    const cam = this.kamera;
    this._yakin = null;
    this._hiz.vx = this._hiz.vy = 0;
    const s1 = kisit(olcek, this._olcekMin, OLCEK_MAKS);
    let ms = Number(sure);
    if (!Number.isFinite(ms) || ms < 0) ms = 900;
    if (this._azHareket) ms = Math.min(ms, 150);
    if (ms <= 0 || cam.w <= 2) {
      cam.x = x;
      cam.y = y;
      cam.olcek = s1;
      this._ucus = null;
      return;
    }
    // uzak uçuşta ortada hafif geri çekil (yay)
    const ekranMesafe = Math.hypot(x - cam.x, y - cam.y) * Math.min(cam.olcek, s1);
    const dalis = kisit(ekranMesafe / (Math.max(cam.w, cam.h) * 3), 0, 0.45);
    this._ucus = { bas: this.t, sure: ms / 1000, x0: cam.x, y0: cam.y, s0: cam.olcek, x1: x, y1: y, s1, dalis };
  }

  _olcekleAt(yeni, ax, ay) {
    const cam = this.kamera;
    const s = kisit(yeni, this._olcekMin, OLCEK_MAKS);
    const wx = (ax - cam.w / 2) / cam.olcek + cam.x;
    const wy = (ay - cam.h / 2) / cam.olcek + cam.y;
    cam.olcek = s;
    cam.x = wx - (ax - cam.w / 2) / s;
    cam.y = wy - (ay - cam.h / 2) / s;
  }

  _yakinlas(carpan, ax, ay) {
    this._ucus = null;
    const taban = this._yakin ? this._yakin.hedef : this.kamera.olcek;
    const hedef = kisit(taban * carpan, this._olcekMin, OLCEK_MAKS);
    this._yakin = { hedef, ax, ay };
  }

  // ============================================================ isabet testi

  _isabet(sx, sy, tolerans) {
    const cam = this.kamera;
    const [wx, wy] = cam.dunya(sx, sy);
    const tol = tolerans / cam.olcek;
    const R = this._maksR * 1.3 + tol;
    const a0 = Math.floor((wx - R) / IZGARA_HUCRE), a1 = Math.floor((wx + R) / IZGARA_HUCRE);
    const b0 = Math.floor((wy - R) / IZGARA_HUCRE), b1 = Math.floor((wy + R) / IZGARA_HUCRE);
    let en = null;
    let enUz = Infinity;
    for (let i = a0; i <= a1; i++) {
      for (let j = b0; j <= b1; j++) {
        const h = this._izgara.get(i + ',' + j);
        if (!h) continue;
        for (const d of h) {
          if (!d.hedef || d.gor < 0.3 || d.gecikme > 0) continue;
          const uz = Math.hypot(d.x - wx, d.y - wy);
          const sinir = d.r * (d.kok ? 1.15 : 1.05) + tol;
          if (uz <= sinir && uz - d.r < enUz) {
            enUz = uz - d.r;
            en = d;
          }
        }
      }
    }
    return en ? en.id : null;
  }

  // ============================================================ girdi

  _yerel(e) {
    const r = this.canvas.getBoundingClientRect ? this.canvas.getBoundingClientRect() : { left: 0, top: 0 };
    return [e.clientX - r.left, e.clientY - r.top];
  }

  _yay(olay, ...arg) {
    const s = this._dinleyiciler.get(olay);
    if (!s) return;
    for (const fn of s) {
      try { fn(...arg); } catch (h) { this._hataBildir(h); }
    }
  }

  _uzerindeAyarla(id, sx, sy) {
    if (id === this._uzerinde && id == null) return;
    this._uzerinde = id;
    try { this.canvas.style.cursor = this._surukle && this._surukle.suruklendi ? 'grabbing' : id ? 'pointer' : 'grab'; } catch (_) { /* yoksay */ }
    this._yay('uzerinde', id, sx, sy);
  }

  _isaretciKur() {
    const c = this.canvas;
    if (!c.addEventListener) return;
    c.addEventListener('pointerdown', (e) => this._pBas(e));
    c.addEventListener('pointermove', (e) => this._pHareket(e));
    c.addEventListener('pointerup', (e) => this._pBirak(e, false));
    c.addEventListener('pointercancel', (e) => this._pBirak(e, true));
    c.addEventListener('pointerleave', (e) => {
      if (!this._ip.size && this._uzerinde != null) {
        const [x, y] = this._yerel(e);
        this._uzerindeAyarla(null, x, y);
      }
    });
    c.addEventListener('wheel', (e) => this._tekerlek(e), { passive: false });
    c.addEventListener('keydown', (e) => this._tus(e));
    c.addEventListener('dblclick', (e) => e.preventDefault());
    c.addEventListener('contextmenu', (e) => { if (this._ip.size > 1) e.preventDefault(); });
  }

  _pBas(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try { this.canvas.focus({ preventScroll: true }); } catch (_) { /* yoksay */ }
    try { this.canvas.setPointerCapture(e.pointerId); } catch (_) { /* yoksay */ }
    const [x, y] = this._yerel(e);
    this._ip.set(e.pointerId, { x, y, tur: e.pointerType });
    this._ucus = null;
    this._yakin = null;
    this._hiz.vx = this._hiz.vy = 0;
    if (this._ip.size === 1) {
      const zaman = typeof performance !== 'undefined' ? performance.now() : Date.now();
      this._surukle = { bx: x, by: y, sx: x, sy: y, st: zaman, vx: 0, vy: 0, suruklendi: false, tur: e.pointerType };
      this._sikistir = null;
    } else if (this._ip.size === 2) {
      this._sikistirBaslat();
      if (this._surukle) this._surukle.suruklendi = true;
    }
  }

  _sikistirBaslat() {
    const p = [...this._ip.values()];
    if (p.length < 2) return;
    const mx = (p[0].x + p[1].x) / 2;
    const my = (p[0].y + p[1].y) / 2;
    const [wx, wy] = this.kamera.dunya(mx, my);
    this._sikistir = { d0: Math.max(10, Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y)), s0: this.kamera.olcek, wx, wy };
  }

  _pHareket(e) {
    const [x, y] = this._yerel(e);
    const ip = this._ip.get(e.pointerId);
    if (!ip) {
      // fare üstü
      if (e.pointerType === 'mouse' || e.pointerType === 'pen') {
        const id = this._isabet(x, y, 6);
        if (id !== this._uzerinde || id != null) this._uzerindeAyarla(id, x, y);
      }
      return;
    }
    ip.x = x;
    ip.y = y;
    const cam = this.kamera;
    if (this._ip.size >= 2 && this._sikistir) {
      const p = [...this._ip.values()];
      const mx = (p[0].x + p[1].x) / 2;
      const my = (p[0].y + p[1].y) / 2;
      const d = Math.max(10, Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y));
      const z = this._sikistir;
      cam.olcek = kisit((z.s0 * d) / z.d0, this._olcekMin, OLCEK_MAKS);
      cam.x = z.wx - (mx - cam.w / 2) / cam.olcek;
      cam.y = z.wy - (my - cam.h / 2) / cam.olcek;
      return;
    }
    const s = this._surukle;
    if (!s) return;
    const esik = s.tur === 'touch' ? SURUKLEME_ESIGI_DOKUNMA : SURUKLEME_ESIGI;
    if (!s.suruklendi && Math.hypot(x - s.bx, y - s.by) > esik) {
      s.suruklendi = true;
      if (this._uzerinde != null) this._uzerindeAyarla(null, x, y);
      try { this.canvas.style.cursor = 'grabbing'; } catch (_) { /* yoksay */ }
    }
    if (s.suruklendi) {
      const dx = x - s.sx;
      const dy = y - s.sy;
      cam.x -= dx / cam.olcek;
      cam.y -= dy / cam.olcek;
      const simdi = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const gecen = Math.max(1, simdi - s.st) / 1000;
      const k = Math.min(1, gecen * 12);
      s.vx = s.vx * (1 - k) + (dx / gecen) * k;
      s.vy = s.vy * (1 - k) + (dy / gecen) * k;
      s.st = simdi;
    }
    s.sx = x;
    s.sy = y;
  }

  _pBirak(e, iptal) {
    if (!this._ip.has(e.pointerId)) return;
    const [x, y] = this._yerel(e);
    this._ip.delete(e.pointerId);
    try { this.canvas.releasePointerCapture(e.pointerId); } catch (_) { /* yoksay */ }
    if (this._ip.size === 1) {
      // sıkıştırmadan tek parmağa dönüş: tık sayılmaz, kaydırma sürer
      const [kalan] = [...this._ip.values()];
      this._sikistir = null;
      this._surukle = { bx: kalan.x, by: kalan.y, sx: kalan.x, sy: kalan.y, st: performance.now(), vx: 0, vy: 0, suruklendi: true, tur: kalan.tur };
      return;
    }
    if (this._ip.size > 1) {
      this._sikistirBaslat();
      return;
    }
    const s = this._surukle;
    this._surukle = null;
    this._sikistir = null;
    try { this.canvas.style.cursor = this._uzerinde ? 'pointer' : 'grab'; } catch (_) { /* yoksay */ }
    if (!s || iptal) return;
    if (s.suruklendi) {
      const simdi = performance.now();
      if (!this._azHareket && simdi - s.st < 90) {
        const v = Math.hypot(s.vx, s.vy);
        const sinir = 2600;
        const k = v > sinir ? sinir / v : 1;
        if (v > 60) {
          this._hiz.vx = s.vx * k;
          this._hiz.vy = s.vy * k;
        }
      }
      return;
    }
    this._dokun(x, y, s.tur);
  }

  _dokun(x, y, tur) {
    const id = this._isabet(x, y, tur === 'touch' ? 14 : 6);
    const simdi = performance.now();
    const onceki = this._sonTik;
    if (onceki && simdi - onceki.t < CIFT_TIK_MS && Math.hypot(x - onceki.x, y - onceki.y) < 24) {
      this._sonTik = null;
      if (id) this.odaklan(id);
      else this._yakinlas(2, x, y);
      return;
    }
    this._sonTik = { t: simdi, x, y };
    this._yay('sec', id);
  }

  _tekerlek(e) {
    e.preventDefault();
    const [x, y] = this._yerel(e);
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16;
    else if (e.deltaMode === 2) dy *= this.kamera.h || 800;
    if (e.ctrlKey) dy *= 2.5; // dokunmatik yüzey sıkıştırması
    dy = kisit(dy, -300, 300);
    this._yakinlas(Math.exp(-dy * 0.0016), x, y);
  }

  _tus(e) {
    if (e.altKey || e.metaKey || e.ctrlKey) return;
    const cam = this.kamera;
    const adim = 700;
    let islendi = true;
    const kay = (vx, vy) => {
      this._ucus = null;
      if (this._azHareket) {
        cam.x += (vx * 0.15) / cam.olcek;
        cam.y += (vy * 0.15) / cam.olcek;
      } else {
        this._hiz.vx = -vx;
        this._hiz.vy = -vy;
      }
    };
    switch (e.key) {
      case 'ArrowLeft': kay(-adim, 0); break;
      case 'ArrowRight': kay(adim, 0); break;
      case 'ArrowUp': kay(0, -adim); break;
      case 'ArrowDown': kay(0, adim); break;
      case '+': case '=': this._yakinlas(1.4, cam.w / 2, cam.h / 2); break;
      case '-': case '_': this._yakinlas(1 / 1.4, cam.w / 2, cam.h / 2); break;
      case 'Home': case '0': this.genelBakis(); break;
      default: islendi = false;
    }
    if (islendi) e.preventDefault();
  }

  // ============================================================ ortam

  _dprAl() {
    const d = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
    return Math.min(2, d);
  }

  _boyutla() {
    const c = this.canvas;
    let w = c.clientWidth;
    let h = c.clientHeight;
    if (!w || !h) {
      w = (typeof innerWidth === 'number' ? innerWidth : 0) || c.width || 800;
      h = (typeof innerHeight === 'number' ? innerHeight : 0) || c.height || 600;
    }
    const dpr = this._dprAl();
    const pw = Math.max(1, Math.round(w * dpr));
    const ph = Math.max(1, Math.round(h * dpr));
    if (c.width !== pw) c.width = pw;
    if (c.height !== ph) c.height = ph;
    this._dpr = dpr;
    const cam = this.kamera;
    cam.w = w;
    cam.h = h;
    this._ef('boyut', w, h, dpr);
    if (!this._kameraHazir && this._dugumler.length && w > 2) {
      this.genelBakis(true);
      this._kameraHazir = true;
    }
  }

  _boyutKur() {
    if (typeof ResizeObserver !== 'undefined') {
      this._gozlemci = new ResizeObserver(() => this._boyutla());
      try { this._gozlemci.observe(this.canvas); } catch (_) { /* yoksay */ }
    } else if (typeof addEventListener === 'function') {
      addEventListener('resize', () => this._boyutla());
    }
    this._boyutla();
  }

  _belgeGizli() {
    return typeof document !== 'undefined' && document.hidden === true;
  }

  _gorunurlukKur() {
    if (typeof document === 'undefined' || !document.addEventListener) return;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this._raf) cancelAnimationFrame(this._raf);
        this._raf = 0;
      } else if (this._calisiyor && !this._raf) {
        this._sonDamga = 0;
        this._raf = requestAnimationFrame(this._kareBagli);
      }
    });
  }

  _hareketTercihiKur() {
    if (typeof matchMedia !== 'function') return;
    try {
      const m = matchMedia('(prefers-reduced-motion: reduce)');
      this._azHareket = !!m.matches;
      const f = (e) => { this._azHareket = !!e.matches; };
      if (m.addEventListener) m.addEventListener('change', f);
      else if (m.addListener) m.addListener(f);
    } catch (_) { /* yoksay */ }
  }

  _yaziOku() {
    try {
      if (typeof getComputedStyle !== 'function' || typeof document === 'undefined') return;
      const v = getComputedStyle(document.documentElement).getPropertyValue('--yazi');
      if (v && v.trim()) this._yazi = v.trim();
    } catch (_) { /* yoksay */ }
  }

  _zamanla(sn, fn) {
    this._zamanlanmis.push({ zaman: this.t + Math.max(0, sn), fn });
  }
}
