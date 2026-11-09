// Beyin grafı yerleşimi: düğümlerin dünya koordinatları (bağımlılıksız ES modülü).
//
// "Biyolüminesan mantar ağı": kök (0,0)'da çekirdek; kökün doğrudan çocukları (ana dallar)
// alt ağaç büyüklüğüyle orantılı açısal kolonilere yayılır; torunlar miselyum gibi dışa doğru
// dallanır. Yöntem:
//   1. Yaprak sayısıyla ağırlıklı radyal ağaç: her düğüm kendi açı dilimini alır, çocukları o
//      dilimin içine yerleşir (dilimler ayrık olduğundan alt ağaçlar birbirine girmez).
//   2. Kalabalık kardeş kümeleri birkaç kademeli sıraya bölünür (mantar kümesi görünümü).
//   3. id tohumlu açı/uzaklık sapması (Math.random yok; aynı graf -> aynı yer).
//   4. Kısa kuvvet gevşetmesi: çakışma itmesi (uzamsal karma ızgara), birincil kenar yayı,
//      başlangıç yerine (koloni dilimine) bağ, `ilgili` kenarlarda hafif çekim.
//   `onceki` verilirse eski düğümler yerinde sabit kalır; yalnız yeniler yerleştirilip gevşetilir.

// Pastel toprak paleti (SOZLESME §0.1): kök krem-altın; koloniler id sırasıyla adaçayı, yosun,
// zeytin, bal, kil/terrakota, gül-kil, liken-yeşili, mantar-bej, soluk lavanta.
const KOK_TONU = 45;
const PALET = [95, 75, 55, 40, 22, 350, 160, 30, 270];
const KOLONI_SAPMA = 6; // koloni içi ton sapması (± derece)
const PAY = 6; // iki mantar arasında bırakılan en az boşluk (dünya birimi)
const KUCUK_R_UST = 18; // kök ve ana dallar dışındaki en büyük yarıçap
const HUCRE = 2 * KUCUK_R_UST + PAY; // ızgara hücresi: küçük-küçük etkileşim 3x3 komşulukta kalır
const TABLO = 4096;
const MASKE = TABLO - 1;
const TAM_TUR = Math.PI * 2;
const YARIM_X = [1, 1, 1, 0];
const YARIM_Y = [-1, 0, 1, 1];

/** Son yerleşimde hesaplanan koloni tonları (dalTonu tek başına çağrılınca önce buraya bakılır). */
let sonDalTonlari = new Map();

// ---------------------------------------------------------------- yardımcılar

function fnv(metin) {
  let h = 0x811c9dc5;
  for (let i = 0; i < metin.length; i++) {
    h ^= metin.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** id tohumlu mulberry32; [0,1) döner. */
function tohumlu(metin) {
  let a = fnv(metin) || 0x9e3779b9;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function karsilastir(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sayi(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function tonSar(t) {
  const m = t % 360;
  return m < 0 ? m + 360 : m;
}

function tonFarki(a, b) {
  const d = Math.abs(tonSar(a) - tonSar(b));
  return d > 180 ? 360 - d : d;
}

/** k. (id sıralı) koloninin tonu: liste sırayla; 9'dan sonra başa döner, turlar +8/-8 kaydırılır. */
function siraTonu(k) {
  const tur = Math.floor(k / PALET.length);
  const kayma = tur === 0 ? 0 : tur % 2 === 1 ? 8 : -8;
  return tonSar(PALET[k % PALET.length] + kayma);
}

// ---------------------------------------------------------------- dışa açık

/**
 * Ana dal (koloni) tonu, 0–360. Son yerleşimde id sıralı dal listesinden atanmış ton varsa onu,
 * yoksa paletten id karmasıyla seçilen tonu döner. null -> kök tonu (45).
 * @param {string|null} dalId
 * @returns {number}
 */
export function dalTonu(dalId) {
  if (dalId == null) return KOK_TONU;
  const anahtar = String(dalId);
  const t = sonDalTonlari.get(anahtar);
  if (t !== undefined) return t;
  return PALET[fnv(anahtar) % PALET.length];
}

/**
 * @typedef {{x:number, y:number, r:number, ton:number, dal:(string|null), derinlik:number}} Yer
 * @param {object} graf `/api/ui/graf` yanıtı
 * @param {Map<string, Yer>|null} onceki önceki yerleşim (varsa eski düğümler yerinde kalır)
 * @returns {Map<string, Yer>}
 */
export function yerlesimHesapla(graf, onceki = null) {
  const sonuc = new Map();
  const ham = graf && Array.isArray(graf.dugumler) ? graf.dugumler : [];
  const kenarlar = graf && Array.isArray(graf.kenarlar) ? graf.kenarlar : [];

  const kayit = new Map();
  for (const d of ham) {
    if (!d || d.id == null) continue;
    const id = String(d.id);
    if (!kayit.has(id)) kayit.set(id, d);
  }
  const ids = [...kayit.keys()].sort(karsilastir);
  const N = ids.length;
  if (N === 0) return sonuc;
  const sira = new Map();
  ids.forEach((id, i) => sira.set(id, i));
  const dugum = (i) => kayit.get(ids[i]);

  // ---- kök
  let kok = graf && graf.kok != null && sira.has(String(graf.kok)) ? sira.get(String(graf.kok)) : -1;
  if (kok < 0) {
    for (let i = 0; i < N; i++) {
      const d = dugum(i);
      if (d.ebeveyn == null && d.derinlik === 0) { kok = i; break; }
    }
  }

  // ---- birincil ebeveyn (düğüm alanı; yoksa birincil `alt` kenarı)
  const kenarEbeveyn = new Map();
  for (const k of kenarlar) {
    if (!k || !k.birincil || k.tur === 'ilgili' || k.cocuk == null || k.ebeveyn == null) continue;
    const c = String(k.cocuk);
    const e = String(k.ebeveyn);
    const var_ = kenarEbeveyn.get(c);
    if (var_ === undefined || e < var_) kenarEbeveyn.set(c, e);
  }
  const ebeveynHam = new Int32Array(N).fill(-1);
  for (let i = 0; i < N; i++) {
    if (i === kok) continue;
    let e = dugum(i).ebeveyn;
    if (e === undefined) e = kenarEbeveyn.get(ids[i]);
    if (e == null) continue;
    const j = sira.get(String(e));
    if (j !== undefined && j !== i) ebeveynHam[i] = j;
  }
  const hamCocuk = Array.from({ length: N }, () => []);
  for (let i = 0; i < N; i++) if (ebeveynHam[i] >= 0) hamCocuk[ebeveynHam[i]].push(i);

  // ---- ağaç (BFS): kökten, sonra yetimlerden (ebeveyni yok/bulunamayan; döngüdekiler en son)
  const P = new Int32Array(N).fill(-1);
  const derin = new Int32Array(N);
  const ziyaret = new Uint8Array(N);
  const cocuk = Array.from({ length: N }, () => []);
  const bfsSira = [];
  const yetimler = [];
  const gez = (bas) => {
    ziyaret[bas] = 1;
    let bas_i = bfsSira.length;
    bfsSira.push(bas);
    while (bas_i < bfsSira.length) {
      const u = bfsSira[bas_i++];
      for (const v of hamCocuk[u]) {
        if (ziyaret[v]) continue;
        ziyaret[v] = 1;
        P[v] = u;
        derin[v] = derin[u] + 1;
        cocuk[u].push(v);
        bfsSira.push(v);
      }
    }
  };
  if (kok >= 0) gez(kok);
  for (let i = 0; i < N; i++) {
    if (!ziyaret[i] && ebeveynHam[i] < 0) { yetimler.push(i); gez(i); }
  }
  for (let i = 0; i < N; i++) {
    if (!ziyaret[i]) { yetimler.push(i); gez(i); }
  }

  // ---- ağırlık (yaprak sayısı) ve alt ağaç boyutu
  const W = new Float64Array(N);
  const boyut = new Float64Array(N);
  for (let n = bfsSira.length - 1; n >= 0; n--) {
    const u = bfsSira[n];
    let w = 0;
    let b = 1;
    for (const v of cocuk[u]) { w += W[v]; b += boyut[v]; }
    W[u] = Math.max(1, w);
    boyut[u] = b;
  }

  // ---- koloni (kökün doğrudan çocuğu olan ata)
  const koloni = new Int32Array(N).fill(-1);
  for (const u of bfsSira) {
    if (u === kok) continue;
    if (P[u] === kok && kok >= 0) koloni[u] = u;
    else if (P[u] >= 0) koloni[u] = koloni[P[u]];
  }

  // ---- yarıçap
  const R = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    if (i === kok) R[i] = 40;
    else if (kok >= 0 && P[i] === kok) R[i] = 24 + Math.min(6, 1.1 * Math.log2(1 + boyut[i]));
    else {
      const o = sayi(dugum(i).olgu_aktif);
      const c = cocuk[i].length;
      R[i] = 6 + Math.min(12, 1.9 * Math.sqrt(o) + 2.1 * Math.sqrt(c));
    }
  }

  // ---- önceki yerleşim
  let eski = null;
  if (onceki) {
    eski = onceki instanceof Map ? onceki : new Map(Object.entries(onceki));
  }
  const X = new Float64Array(N);
  const Y = new Float64Array(N);
  const sabit = new Uint8Array(N);
  let eskiSayisi = 0;
  if (eski) {
    for (let i = 0; i < N; i++) {
      const e = eski.get(ids[i]);
      if (e && Number.isFinite(e.x) && Number.isFinite(e.y)) {
        X[i] = e.x; Y[i] = e.y; sabit[i] = 1; eskiSayisi++;
      }
    }
  }

  // ---- koloni tonları
  const koloniler = kok >= 0 ? cocuk[kok] : []; // id sıralı
  const tonlar = new Map();
  if (eskiSayisi > 0) {
    const kullanilan = [];
    const yeniKoloni = [];
    for (const c of koloniler) {
      const e = eski.get(ids[c]);
      if (e && Number.isFinite(e.ton)) { tonlar.set(ids[c], e.ton); kullanilan.push(e.ton); }
      else yeniKoloni.push(c);
    }
    // eski kolonilerin tonu değişmez; yeni koloni sıra tonunu alır, o ton doluysa
    // listedeki (ve ±8 kaydırılmış turlarındaki) kullanılanlardan en uzak tonu.
    const enUzak = (t) => {
      let fark = 360;
      for (const u of kullanilan) fark = Math.min(fark, tonFarki(t, u));
      return fark;
    };
    for (const c of yeniKoloni) {
      let enIyi = siraTonu(koloniler.indexOf(c));
      if (enUzak(enIyi) < 3) {
        let enIyiFark = -1;
        for (let k = 0; k < 3 * PALET.length; k++) {
          const aday = siraTonu(k);
          const fark = enUzak(aday);
          if (fark > enIyiFark + 1e-9) { enIyi = aday; enIyiFark = fark; }
        }
      }
      tonlar.set(ids[c], enIyi);
      kullanilan.push(enIyi);
    }
  } else {
    koloniler.forEach((c, k) => tonlar.set(ids[c], siraTonu(k)));
  }
  sonDalTonlari = tonlar;

  const ton = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    if (i === kok) { ton[i] = KOK_TONU; continue; }
    const rnd = tohumlu('ton:' + ids[i]);
    if (koloni[i] === i) { ton[i] = tonlar.get(ids[i]); continue; }
    let taban;
    if (koloni[i] >= 0) taban = tonlar.get(ids[koloni[i]]);
    else {
      const kd = dugum(i).kok_dal;
      taban = kd != null && tonlar.has(String(kd)) ? tonlar.get(String(kd)) : KOK_TONU;
    }
    ton[i] = tonSar(taban + (rnd() - 0.5) * 2 * KOLONI_SAPMA);
  }

  // ---- ilgili (ve birincil olmayan alt) çekim çiftleri
  const ciftA = [];
  const ciftB = [];
  for (const k of kenarlar) {
    if (!k || k.ebeveyn == null || k.cocuk == null) continue;
    if (k.tur !== 'ilgili' && !(k.tur === 'alt' && !k.birincil)) continue;
    const a = sira.get(String(k.ebeveyn));
    const b = sira.get(String(k.cocuk));
    if (a === undefined || b === undefined || a === b) continue;
    if (P[a] === b || P[b] === a) continue;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    ciftA.push(lo); ciftB.push(hi);
  }
  // girdi sırasından bağımsız olsun
  const cs = ciftA.map((a, n) => n).sort((m, n) => ciftA[m] - ciftA[n] || ciftB[m] - ciftB[n]);
  const ca = cs.map((n) => ciftA[n]);
  const cb = cs.map((n) => ciftB[n]);
  ciftA.length = 0; ciftB.length = 0;
  for (let n = 0; n < ca.length; n++) {
    if (n > 0 && ca[n] === ca[n - 1] && cb[n] === cb[n - 1]) continue;
    ciftA.push(ca[n]); ciftB.push(cb[n]);
  }

  const L0 = new Float64Array(N); // birincil kenar hedef uzunluğu
  const AX = new Float64Array(N); // bağ noktası (başlangıç yeri)
  const AY = new Float64Array(N);

  const ctx = { N, R, X, Y, P, L0, AX, AY, sabit, ciftA, ciftB };

  if (eskiSayisi === 0) {
    tamYerlesim(ctx, { kok, cocuk, W, derin, yetimler, ids });
    if (kok >= 0) sabit[kok] = 1;
    gevset(ctx, 150, 0.03, 1);
    if (kok >= 0) sabit[kok] = 0;
  } else {
    const yeni = artimliYerlesim(ctx, { kok, cocuk, bfsSira, ids, koloniler });
    if (yeni > 0) gevset(ctx, 70, 0.06, 0.5);
  }

  for (let i = 0; i < N; i++) {
    const d = dugum(i);
    const dal = d.kok_dal !== undefined ? d.kok_dal : koloni[i] >= 0 ? ids[koloni[i]] : null;
    const derinlik = Number.isFinite(d.derinlik) ? d.derinlik : i === kok ? 0 : derin[i] + (koloni[i] < 0 ? 1 : 0);
    sonuc.set(ids[i], {
      x: X[i],
      y: Y[i],
      r: Math.round(R[i] * 100) / 100,
      ton: Math.round(ton[i] * 10) / 10,
      dal: dal == null ? null : String(dal),
      derinlik,
    });
  }
  return sonuc;
}

// ---------------------------------------------------------------- tam yerleşim

function tamYerlesim(ctx, { kok, cocuk, W, derin, yetimler, ids }) {
  const { R, X, Y, P, L0, AX, AY } = ctx;
  let enDis = 0;

  const adim = (d) => (d === 0 ? 140 : d === 1 ? 62 : 46);

  // kids'i [a0,a1] dilimine, taban yarıçapı R0'dan başlayarak dağıtır; çocuklarına iner.
  const dagit = (kids, R0, a0, a1, derinP, kokCocugu) => {
    if (!kids.length) return;
    const S = a1 - a0;
    const K = kids.length;
    let pay = kids.map((c) => (kokCocugu ? Math.pow(W[c], 0.7) : W[c]));
    let toplam = 0;
    let rOrt = 0;
    for (let n = 0; n < K; n++) { toplam += pay[n]; rOrt += R[kids[n]]; }
    rOrt /= K;
    if (kokCocugu) {
      // küçük koloniler de okunaklı bir açı alsın
      const taban = (0.3 * toplam) / K;
      pay = pay.map((p) => Math.max(p, taban));
      toplam = pay.reduce((a, b) => a + b, 0);
    }
    const s = pay.map((p) => (S * p) / toplam);
    // k sıra: aynı sıradaki komşular n ve n+k; aralarındaki açı yetmeli.
    const siraAraligi = 2 * rOrt + PAY + 4;
    const gerekR = (k) => {
      let enCok = 0;
      const tamTur = S >= TAM_TUR - 1e-9 && K > k;
      const son = tamTur ? K : K - k;
      for (let n = 0; n < son; n++) {
        const m = (n + k) % K;
        let aci = s[n] / 2 + s[m] / 2;
        for (let q = n + 1; q < n + k; q++) aci += s[q % K];
        const g = (R[kids[n]] + R[kids[m]] + PAY + 4) / aci;
        if (g > enCok) enCok = g;
      }
      return enCok;
    };
    let k = 1;
    let enIyiMaliyet = Infinity;
    let enIyiR0 = R0;
    for (let aday = 1; aday <= Math.min(K, 7); aday++) {
      const r0 = Math.max(R0, gerekR(aday));
      const maliyet = r0 + (aday - 1) * siraAraligi * 0.6;
      if (maliyet < enIyiMaliyet - 1e-9) { enIyiMaliyet = maliyet; k = aday; enIyiR0 = r0; }
      if (r0 <= R0 + 1e-9) break;
    }
    R0 = enIyiR0;
    const sapmaR = Math.min(12, adim(derinP) * 0.22);

    let acum = a0;
    for (let n = 0; n < K; n++) {
      const c = kids[n];
      const kenar = kokCocugu ? Math.min(0.03, s[n] * 0.08) : 0;
      const wa0 = acum + kenar;
      const wa1 = acum + s[n] - kenar;
      acum += s[n];
      const rnd = tohumlu('yer:' + ids[c]);
      const aci = (wa0 + wa1) / 2 + (rnd() - 0.5) * 0.34 * (wa1 - wa0);
      const Rc = R0 + (n % k) * siraAraligi + (rnd() - 0.5) * 2 * sapmaR;
      X[c] = Rc * Math.cos(aci);
      Y[c] = Rc * Math.sin(aci);
      enDis = Math.max(enDis, Rc + R[c]);
      if (cocuk[c].length) {
        let rMax = 0;
        for (const g of cocuk[c]) rMax = Math.max(rMax, R[g]);
        const ileri = adim(derinP + 1) * (0.88 + 0.24 * rnd());
        dagit(cocuk[c], Rc + R[c] + rMax + ileri, wa0, wa1, derinP + 1, false);
      }
    }
  };

  if (kok >= 0) {
    X[kok] = 0; Y[kok] = 0;
    const kids = cocuk[kok];
    let rMax = 0;
    for (const c of kids) rMax = Math.max(rMax, R[c]);
    const bas = -Math.PI / 2;
    dagit(kids, R[kok] + rMax + adim(0), bas, bas + TAM_TUR, 0, true);
  }

  // yetimler: dış halka
  if (yetimler.length) {
    const Rd = Math.max(enDis, kok >= 0 ? R[kok] : 0) + 150;
    const bas = -Math.PI / 2 + 0.31;
    dagit(yetimler, Rd, bas, bas + TAM_TUR, 1, false);
  }

  for (let i = 0; i < ctx.N; i++) {
    AX[i] = X[i]; AY[i] = Y[i];
    if (P[i] >= 0) L0[i] = Math.hypot(X[i] - X[P[i]], Y[i] - Y[P[i]]);
  }
  void derin;
}

// ---------------------------------------------------------------- artımlı yerleşim

function artimliYerlesim(ctx, { kok, cocuk, bfsSira, ids, koloniler }) {
  const { N, R, X, Y, P, L0, AX, AY, sabit } = ctx;
  const yerli = new Uint8Array(N);
  for (let i = 0; i < N; i++) yerli[i] = sabit[i];
  if (kok >= 0 && !yerli[kok]) { X[kok] = 0; Y[kok] = 0; yerli[kok] = 1; sabit[kok] = 1; }

  // artımlı uzamsal tablo
  const hucreler = new Map();
  const buyukler = [];
  const anahtar = (cx, cy) => (cx + 1048576) * 2097152 + (cy + 1048576);
  const ekle = (i) => {
    if (R[i] > KUCUK_R_UST) { buyukler.push(i); return; }
    const a = anahtar(Math.floor(X[i] / HUCRE), Math.floor(Y[i] / HUCRE));
    const l = hucreler.get(a);
    if (l) l.push(i); else hucreler.set(a, [i]);
  };
  for (let i = 0; i < N; i++) if (yerli[i]) ekle(i);
  const bos = (x, y, r) => {
    const menzil = Math.ceil((r + KUCUK_R_UST + PAY) / HUCRE);
    const cx = Math.floor(x / HUCRE);
    const cy = Math.floor(y / HUCRE);
    for (let dx = -menzil; dx <= menzil; dx++) {
      for (let dy = -menzil; dy <= menzil; dy++) {
        const l = hucreler.get(anahtar(cx + dx, cy + dy));
        if (!l) continue;
        for (const j of l) {
          const m = r + R[j] + PAY;
          const ex = X[j] - x;
          const ey = Y[j] - y;
          if (ex * ex + ey * ey < m * m) return false;
        }
      }
    }
    for (const j of buyukler) {
      const m = r + R[j] + PAY;
      const ex = X[j] - x;
      const ey = Y[j] - y;
      if (ex * ex + ey * ey < m * m) return false;
    }
    return true;
  };

  let enDis = 0;
  let yetimHalka = 0;
  for (let i = 0; i < N; i++) {
    if (!yerli[i]) continue;
    const d = Math.hypot(X[i], Y[i]) + R[i];
    enDis = Math.max(enDis, d);
    if (P[i] < 0 && i !== kok) yetimHalka = Math.max(yetimHalka, Math.hypot(X[i], Y[i]));
  }

  let yeni = 0;
  for (const i of bfsSira) {
    if (yerli[i]) continue;
    yeni++;
    const rnd = tohumlu('yeni:' + ids[i]);
    const p = P[i];
    let bx = 0;
    let by = 0;
    let yon;
    let taban;
    let halka = false;
    if (p >= 0) {
      bx = X[p]; by = Y[p];
      if (p === kok) {
        // yeni koloni: var olan koloniler arasındaki en geniş açı boşluğu
        const acilar = koloniler.filter((c) => yerli[c]).map((c) => Math.atan2(Y[c] - by, X[c] - bx)).sort((a, b) => a - b);
        if (acilar.length === 0) yon = -Math.PI / 2;
        else if (acilar.length === 1) yon = acilar[0] + Math.PI;
        else {
          let enGenis = -1;
          yon = 0;
          for (let n = 0; n < acilar.length; n++) {
            const a = acilar[n];
            const b = n + 1 < acilar.length ? acilar[n + 1] : acilar[0] + TAM_TUR;
            if (b - a > enGenis) { enGenis = b - a; yon = (a + b) / 2; }
          }
        }
        taban = R[p] + R[i] + 140;
      } else {
        // büyüme yönü (büyükbabadan ebeveyne) ile dışa doğru yönün ortalaması
        let gx = 0;
        let gy = 0;
        if (P[p] >= 0) {
          const ux = X[p] - X[P[p]];
          const uy = Y[p] - Y[P[p]];
          const ul = Math.hypot(ux, uy) || 1;
          gx += ux / ul; gy += uy / ul;
        }
        const rl = Math.hypot(X[p], Y[p]);
        if (rl > 1e-6) { gx += X[p] / rl; gy += Y[p] / rl; }
        yon = gx * gx + gy * gy > 1e-12 ? Math.atan2(gy, gx) : rnd() * TAM_TUR;
        taban = R[p] + R[i] + 40;
      }
    } else {
      halka = true;
      yon = rnd() * TAM_TUR;
      taban = yetimHalka > 0 ? yetimHalka : enDis + 150;
    }

    let bulundu = false;
    let sx = 0;
    let sy = 0;
    const ilkSapma = (rnd() - 0.5) * 0.16;
    for (let k = 0; k < 14 && !bulundu; k++) {
      const uz = taban + k * (2 * R[i] + PAY) * 0.75;
      const acıAdim = halka ? Math.min(0.2, (2 * R[i] + PAY) / Math.max(uz, 1)) : 0.22;
      const deneme = halka ? Math.ceil(Math.PI / acıAdim) : 7;
      for (let m = 0; m <= 2 * deneme && !bulundu; m++) {
        const ofs = m === 0 ? 0 : (m % 2 ? 1 : -1) * Math.ceil(m / 2) * acıAdim;
        const a = yon + ilkSapma + ofs;
        const x = halka ? uz * Math.cos(a) : bx + uz * Math.cos(a);
        const y = halka ? uz * Math.sin(a) : by + uz * Math.sin(a);
        if (k === 0 && m === 0) { sx = x; sy = y; }
        if (bos(x, y, R[i])) { sx = x; sy = y; bulundu = true; }
      }
    }
    X[i] = sx; Y[i] = sy;
    yerli[i] = 1;
    ekle(i);
    if (!halka) enDis = Math.max(enDis, Math.hypot(sx, sy) + R[i]);
  }

  for (let i = 0; i < N; i++) {
    AX[i] = X[i]; AY[i] = Y[i];
    if (P[i] >= 0) L0[i] = Math.hypot(X[i] - X[P[i]], Y[i] - Y[P[i]]);
  }
  void cocuk;
  return yeni;
}

// ---------------------------------------------------------------- gevşetme

function gevset(ctx, iter, bagK, ilgiliOlcek) {
  const { N, R, X, Y, P, L0, AX, AY, sabit, ciftA, ciftB } = ctx;
  const bas = new Int32Array(TABLO);
  const sonraki = new Int32Array(N);
  const hx = new Int32Array(N);
  const hy = new Int32Array(N);
  const buyuk = [];
  for (let i = 0; i < N; i++) if (R[i] > KUCUK_R_UST) buyuk.push(i);
  const buyukMu = new Uint8Array(N);
  for (const b of buyuk) buyukMu[b] = 1;
  const kutu = (cx, cy) => (Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663)) & MASKE;
  const hareketli = [];
  for (let i = 0; i < N; i++) if (!sabit[i]) hareketli.push(i);
  if (!hareketli.length) return;

  let enBuyukTasma = 0;
  const coz = (i, j) => {
    if (sabit[i] && sabit[j]) return;
    let dx = X[j] - X[i];
    let dy = Y[j] - Y[i];
    const m = R[i] + R[j] + PAY;
    const d2 = dx * dx + dy * dy;
    if (d2 >= m * m) return;
    let d = Math.sqrt(d2);
    if (d < 1e-6) {
      const a = ((i * 7919 + j * 104729) % 6283) / 1000;
      dx = Math.cos(a); dy = Math.sin(a); d = 1;
    } else { dx /= d; dy /= d; }
    const ov = m - d;
    if (ov > enBuyukTasma) enBuyukTasma = ov;
    const wi = sabit[i] ? 0 : 1 / R[i];
    const wj = sabit[j] ? 0 : 1 / R[j];
    const t = wi + wj;
    X[i] -= dx * ov * (wi / t); Y[i] -= dy * ov * (wi / t);
    X[j] += dx * ov * (wj / t); Y[j] += dy * ov * (wj / t);
  };

  const carpisma = () => {
    enBuyukTasma = 0;
    bas.fill(-1);
    for (let i = 0; i < N; i++) {
      if (buyukMu[i]) continue;
      const cx = Math.floor(X[i] / HUCRE);
      const cy = Math.floor(Y[i] / HUCRE);
      hx[i] = cx; hy[i] = cy;
      const h = kutu(cx, cy);
      sonraki[i] = bas[h];
      bas[h] = i;
    }
    // yarım şablon: her hücre çifti bir kez (aynı hücre + 4 komşu)
    for (let i = 0; i < N; i++) {
      if (buyukMu[i]) continue;
      const cx = hx[i];
      const cy = hy[i];
      for (let j = bas[kutu(cx, cy)]; j >= 0; j = sonraki[j]) {
        if (j > i && hx[j] === cx && hy[j] === cy) coz(i, j);
      }
      for (let n = 0; n < 4; n++) {
        const tx = cx + YARIM_X[n];
        const ty = cy + YARIM_Y[n];
        for (let j = bas[kutu(tx, ty)]; j >= 0; j = sonraki[j]) {
          if (hx[j] === tx && hy[j] === ty) coz(i, j);
        }
      }
    }
    // büyükler (kök, ana dallar): küçüklere yalnız çevre hücrelerinden, birbirlerine doğrudan
    for (let n = 0; n < buyuk.length; n++) {
      const b = buyuk[n];
      const menzil = Math.ceil((R[b] + KUCUK_R_UST + PAY) / HUCRE);
      const cx = Math.floor(X[b] / HUCRE);
      const cy = Math.floor(Y[b] / HUCRE);
      for (let ox = -menzil; ox <= menzil; ox++) {
        for (let oy = -menzil; oy <= menzil; oy++) {
          const tx = cx + ox;
          const ty = cy + oy;
          for (let j = bas[kutu(tx, ty)]; j >= 0; j = sonraki[j]) {
            if (hx[j] !== tx || hy[j] !== ty) continue;
            coz(b, j);
          }
        }
      }
      for (let m = n + 1; m < buyuk.length; m++) coz(b, buyuk[m]);
    }
    return enBuyukTasma;
  };

  for (let t = 0; t < iter; t++) {
    const alfa = 1 - t / iter;
    // birincil kenar yayı
    for (const i of hareketli) {
      const p = P[i];
      if (p < 0) continue;
      const dx = X[i] - X[p];
      const dy = Y[i] - Y[p];
      const d = Math.hypot(dx, dy) || 1e-6;
      const k = ((d - L0[i]) / d) * 0.2;
      const cPay = sabit[p] ? 1 : 0.8;
      X[i] -= dx * k * cPay; Y[i] -= dy * k * cPay;
      if (!sabit[p]) { X[p] += dx * k * (1 - cPay); Y[p] += dy * k * (1 - cPay); }
    }
    // koloni/başlangıç bağı
    const ka = bagK * (0.4 + 0.6 * alfa);
    for (const i of hareketli) {
      X[i] += (AX[i] - X[i]) * ka;
      Y[i] += (AY[i] - Y[i]) * ka;
    }
    // ilgili kenarlar: hafif çekim
    if (ilgiliOlcek > 0) {
      const kr = 0.006 * alfa * ilgiliOlcek;
      for (let n = 0; n < ciftA.length; n++) {
        const a = ciftA[n];
        const b = ciftB[n];
        if (sabit[a] && sabit[b]) continue;
        const dx = X[b] - X[a];
        const dy = Y[b] - Y[a];
        const d = Math.hypot(dx, dy);
        const L = 2 * (R[a] + R[b]) + 90;
        if (d <= L) continue;
        const f = Math.min(3, kr * (d - L)) / d;
        const wa = sabit[a] ? 0 : sabit[b] ? 1 : 0.5;
        const wb = sabit[b] ? 0 : sabit[a] ? 1 : 0.5;
        X[a] += dx * f * wa; Y[a] += dy * f * wa;
        X[b] -= dx * f * wb; Y[b] -= dy * f * wb;
      }
    }
    if (t >= iter * 0.4 || (t & 1) === 1) carpisma();
  }
  for (let t = 0; t < 40; t++) if (carpisma() < 0.05) break;
}
