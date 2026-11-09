// Zaman şeridi: ağın tohumdan bugüne büyümesini kaydırır ve oynatır.
// Sözleşme: zamanKur(kok, {onZaman}) -> {grafAyarla(graf), olayEkle(olaylar)}; onZaman(t | null), t epoch ms.
// DOM yalnız createElement + textContent ile kurulur.

import { tumGecmis } from './api.js';

const ADIM = 10000;            // kaydırıcı çözünürlüğü (0..ADIM)
const OYNATMA_SN = 20;         // 1× hızda mevcut konumdan şimdiye süre
const HIZLAR = [1, 4, 16];
// "Olay zamanı" ölçeği: konumun bu kadarı olay sırasından, kalanı takvimden gelir.
// Saf sıra ölçeği sessiz haftaları sıfıra indirirdi; karışım hem yoğun anları açar hem boşlukları hissettirir.
const OLAY_AGIRLIK = 0.75;
const CUBUK_PX = 4;      // histogram çubuk genişliği (CSS pikseli)
// stil.css değişkenleri okunamazsa SOZLESME §0.1 pastel toprak tonları.
const YEDEK_RENK = { '--isik': '#a9c79b', '--isik-2': '#d3d9a4', '--fosil': '#cdb08a' };

const tarihBicim = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });
const sayiBicim = new Intl.NumberFormat('tr-TR');

function el(etiket, sinif, metin) {
  const e = document.createElement(etiket);
  if (sinif) e.className = sinif;
  if (metin !== undefined && metin !== null) e.textContent = metin;
  return e;
}

function dugmeYap(sinif, metin, etiket) {
  const b = el('button', 'dugme ikincil ' + sinif, metin);
  b.type = 'button';
  if (etiket) b.setAttribute('aria-label', etiket);
  return b;
}

function zamanMs(iso) {
  if (typeof iso !== 'string') return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** dizi[i] > x olan ilk indeks (artan dizi). */
function ustSinir(dizi, x) {
  let a = 0, b = dizi.length;
  while (a < b) { const m = (a + b) >> 1; if (dizi[m] <= x) a = m + 1; else b = m; }
  return a;
}

/** dizi[k] <= x <= dizi[k+1] olan k (0..len-2'ye kırpılır). */
function parca(dizi, x) {
  const k = ustSinir(dizi, x) - 1;
  return Math.max(0, Math.min(dizi.length - 2, k));
}

function kirp(x, a, b) { return x < a ? a : x > b ? b : x; }

/**
 * Zaman modeli: düğüm oluşturma ve olgu ekleme anlarından iki ölçek (takvim, olay) kurar.
 * Ölçekler parçalı doğrusal ve kesin artandır; böylece konum <-> zaman iki yönde de çevrilir.
 */
function modelKur(dugumZaman, olguZaman, simdi) {
  const dugumT = Array.from(dugumZaman.values()).sort((a, b) => a - b);
  if (!dugumT.length) return null;
  const tMin = dugumT[0];
  let tMax = Math.max(simdi, dugumT[dugumT.length - 1]);
  const olayT = dugumT.slice();
  for (const t of olguZaman.values()) {
    olayT.push(t < tMin ? tMin : t);
    if (t > tMax) tMax = t;
  }
  olayT.sort((a, b) => a - b);
  if (tMax <= tMin) tMax = tMin + 1;
  const sure = tMax - tMin;

  const kt = [];
  const kv = [];
  const ekle = (t, v) => {
    const s = kt.length - 1;
    if (s >= 0 && t <= kt[s]) { if (v > kv[s]) kv[s] = v; return; }
    kt.push(t); kv.push(v);
  };
  ekle(tMin, 0);
  const n = olayT.length;
  for (let i = 0; i < n;) {
    let j = i;
    while (j < n && olayT[j] === olayT[i]) j++;
    ekle(olayT[i], (i + j) / 2);  // aynı andaki olayların ortası: kesin artan sıra eğrisi
    i = j;
  }
  ekle(tMax, n);
  if (kt.length < 2) { kt.push(tMax); kv.push(n + 1); }

  const v0 = kv[0];
  const vAralik = Math.max(kv[kv.length - 1] - v0, 1e-9);
  const uTakvim = new Float64Array(kt.length);
  const uOlay = new Float64Array(kt.length);
  for (let k = 0; k < kt.length; k++) {
    const l = (kt[k] - tMin) / sure;
    uTakvim[k] = l;
    uOlay[k] = OLAY_AGIRLIK * ((kv[k] - v0) / vAralik) + (1 - OLAY_AGIRLIK) * l;
  }
  uTakvim[kt.length - 1] = 1; uOlay[kt.length - 1] = 1;
  uTakvim[0] = 0; uOlay[0] = 0;
  return { tMin, tMax, kt, uTakvim, uOlay, olayT, dugumT };
}

function konumdanZaman(m, u, p) {
  p = kirp(p, 0, 1);
  const k = parca(u, p);
  const du = u[k + 1] - u[k];
  const f = du > 0 ? (p - u[k]) / du : 0;
  return m.kt[k] + f * (m.kt[k + 1] - m.kt[k]);
}

function zamandanKonum(m, u, t) {
  t = kirp(t, m.tMin, m.tMax);
  const k = parca(m.kt, t);
  const dt = m.kt[k + 1] - m.kt[k];
  const f = dt > 0 ? (t - m.kt[k]) / dt : 0;
  return u[k] + f * (u[k + 1] - u[k]);
}

export function zamanKur(kok, { onZaman } = {}) {
  const bildir = typeof onZaman === 'function' ? onZaman : () => {};
  const azHareket = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

  // ---- durum
  const dugumZaman = new Map();   // düğüm id -> oluşturma ms (graf ya da canlı 'ekle' olayı)
  const grafDugumleri = new Set();
  const olguZaman = new Map();    // olay id -> ms (olgu ekleme)
  let model = null;
  let modelSurum = 0;
  let acik = false;
  let p = 1;                      // 0..1; 1 = şimdi
  let oynuyor = false;
  let hiz = 1;
  let oran = 0;                   // oynatmada 1× hızda konum/sn
  let olcek = 'olay';
  let gecmisDurum = 'yok';        // yok | yukleniyor | tamam | hata
  let sonGonderilen;              // undefined: hiç gönderilmedi
  let bekleyen;                   // rAF ile kısılmış bildirim
  let bildirRaf = 0;
  let oynatRaf = 0;
  let oncekiZaman = 0;
  let cubuklar = null;

  // ---- DOM
  kok.textContent = '';
  kok.classList.add('zs');
  const cubuk = el('div', 'zs-cubuk');
  const acDugme = el('button', 'dugme ikincil zs-ac');
  acDugme.type = 'button';
  acDugme.setAttribute('aria-expanded', 'false');
  acDugme.setAttribute('aria-controls', 'zs-govde');
  acDugme.title = 'Ağın tohumdan bugüne büyümesini göster';
  acDugme.append(el('span', 'zs-simge', '⏳'), el('span', 'zs-ac-metin', 'Zaman'));
  acDugme.firstChild.setAttribute('aria-hidden', 'true');
  const anEtiket = el('span', 'zs-an', 'şimdi');
  cubuk.append(acDugme, anEtiket);

  const govde = el('div', 'zs-govde');
  govde.id = 'zs-govde';
  govde.hidden = true;

  const kontroller = el('div', 'zs-kontroller');
  const oynatDugme = dugmeYap('zs-oynat', '▶', 'Oynat');
  const hizGrubu = el('div', 'zs-hizlar');
  hizGrubu.setAttribute('role', 'group');
  hizGrubu.setAttribute('aria-label', 'Oynatma hızı');
  const hizDugmeleri = HIZLAR.map((h) => {
    const b = dugmeYap('zs-hiz', h + '×', h + ' kat hız');
    b.dataset.hiz = String(h);
    b.setAttribute('aria-pressed', h === hiz ? 'true' : 'false');
    hizGrubu.append(b);
    return b;
  });
  const olcekDugme = dugmeYap('zs-olcek', '', '');
  const simdiDugme = dugmeYap('zs-simdi', 'Şimdi', 'Şimdiye dön');
  const bilgi = el('span', 'zs-bilgi soluk');
  bilgi.setAttribute('aria-live', 'polite');
  kontroller.append(oynatDugme, hizGrubu, olcekDugme, simdiDugme, bilgi);

  const iz = el('div', 'zs-iz');
  const tuval = el('canvas', 'zs-histogram');
  tuval.setAttribute('aria-hidden', 'true');
  const kaydirici = el('input', 'zs-kaydirici');
  kaydirici.type = 'range';
  kaydirici.min = '0';
  kaydirici.max = String(ADIM);
  kaydirici.step = '1';
  kaydirici.value = String(ADIM);
  kaydirici.setAttribute('aria-label', 'Zaman konumu');
  iz.append(tuval, kaydirici);

  const uclar = el('div', 'zs-uclar');
  const basEtiket = el('span', 'zs-bas soluk', '');
  const sonEtiket = el('span', 'zs-son soluk', 'şimdi');
  uclar.append(basEtiket, sonEtiket);

  govde.append(kontroller, iz, uclar);
  kok.append(cubuk, govde);

  // ---- yardımcılar
  const u = () => (olcek === 'olay' ? model.uOlay : model.uTakvim);
  const simdiMi = () => p >= 1 - 1e-9;
  const anZaman = () => (model && !simdiMi() ? konumdanZaman(model, u(), p) : null);

  function zamanGonder(t, hemen) {
    bekleyen = t;
    if (hemen) {
      if (bildirRaf) { cancelAnimationFrame(bildirRaf); bildirRaf = 0; }
      bekleyeniGonder();
      return;
    }
    if (!bildirRaf) bildirRaf = requestAnimationFrame(() => { bildirRaf = 0; bekleyeniGonder(); });
  }

  function bekleyeniGonder() {
    const t = bekleyen === null ? null : Math.round(bekleyen);
    if (t === sonGonderilen) return;
    sonGonderilen = t;
    try { bildir(t); } catch (e) { console.warn('onZaman hata verdi:', e && e.message); }
  }

  function gorunenDugum(t) {
    if (!model) return 0;
    return t === null ? model.dugumT.length : ustSinir(model.dugumT, t);
  }

  function arayuzGuncelle() {
    const t = anZaman();
    let metin;
    if (!model) metin = 'şimdi';
    else if (t === null) metin = acik ? 'Şimdi · ' + sayiBicim.format(gorunenDugum(null)) + ' düğüm' : 'şimdi';
    else metin = tarihBicim.format(new Date(t)) + ' · ' + sayiBicim.format(gorunenDugum(t)) + ' düğüm';
    anEtiket.textContent = metin;
    kaydirici.setAttribute('aria-valuetext', t === null ? 'Şimdi' : tarihBicim.format(new Date(t)));
    const deger = String(Math.round(p * ADIM));
    if (kaydirici.value !== deger) kaydirici.value = deger;
    kok.classList.toggle('zs-gecmiste', t !== null);
    histogramCiz();
  }

  function kontrolleriGuncelle() {
    const yok = !model;
    for (const b of [oynatDugme, olcekDugme, simdiDugme, kaydirici, ...hizDugmeleri]) b.disabled = yok;
    oynatDugme.textContent = oynuyor ? '❚❚' : '▶';
    oynatDugme.setAttribute('aria-label', oynuyor ? 'Duraklat' : 'Oynat');
    oynatDugme.title = oynuyor ? 'Duraklat (boşluk)' : 'Oynat (boşluk)';
    kok.classList.toggle('zs-oynuyor', oynuyor);
    for (const b of hizDugmeleri) b.setAttribute('aria-pressed', Number(b.dataset.hiz) === hiz ? 'true' : 'false');
    if (olcek === 'olay') {
      olcekDugme.textContent = '⇄ Olay sırası';
      olcekDugme.setAttribute('aria-label', 'Ölçek: olay sırası. Takvim zamanına geç');
      olcekDugme.title = 'Yoğun anlar geniş açılır; takvim zamanına geçmek için tıkla';
    } else {
      olcekDugme.textContent = '⇄ Takvim';
      olcekDugme.setAttribute('aria-label', 'Ölçek: takvim zamanı. Olay sırasına geç');
      olcekDugme.title = 'Eşit süreler eşit uzunlukta; olay sırasına geçmek için tıkla';
    }
    simdiDugme.disabled = yok || simdiMi();
    basEtiket.textContent = model ? tarihBicim.format(new Date(model.tMin)) : '';
    let b = '';
    if (!model) b = 'Ağ bekleniyor…';
    else if (gecmisDurum === 'yukleniyor') b = 'Geçmiş yükleniyor…';
    else if (gecmisDurum === 'hata') b = 'Geçmiş yüklenemedi; düğüm tarihleri kullanılıyor.';
    else b = sayiBicim.format(model.olayT.length) + ' olay';
    if (bilgi.textContent !== b) bilgi.textContent = b;
  }

  function yenidenKur() {
    const t = anZaman();
    model = modelKur(dugumZaman, olguZaman, Date.now());
    modelSurum++;
    cubuklar = null;
    if (!model) { p = 1; durdur(); }
    else if (t !== null) p = Math.min(zamandanKonum(model, u(), t), 1 - 1 / ADIM);
    kontrolleriGuncelle();
    arayuzGuncelle();
  }

  // ---- konum değişimi
  function konumAyarla(yeni, { kaynak = 'kullanici', hemen = false } = {}) {
    if (!model) return;
    p = kirp(yeni, 0, 1);
    if (kaynak === 'kullanici' && oynuyor) durdur();
    zamanGonder(anZaman(), hemen);
    kontrolleriGuncelle();
    arayuzGuncelle();
  }

  function simdiyeDon() {
    durdur();
    p = 1;
    zamanGonder(null, true);
    kontrolleriGuncelle();
    arayuzGuncelle();
  }

  // ---- oynatma
  function oynat() {
    if (!model || oynuyor) return;
    if (model.tMax < Date.now() - 60000) yenidenKur();
    if (simdiMi()) p = 0;     // sondaysa baştan başlat
    oran = (1 - p) / OYNATMA_SN;
    if (oran <= 0) return;
    oynuyor = true;
    oncekiZaman = 0;
    zamanGonder(anZaman(), true);
    kontrolleriGuncelle();
    arayuzGuncelle();
    oynatRaf = requestAnimationFrame(kare);
  }

  function kare(simdi) {
    oynatRaf = 0;
    if (!oynuyor) return;
    const dt = oncekiZaman ? Math.min((simdi - oncekiZaman) / 1000, 0.1) : 0;
    oncekiZaman = simdi;
    const yeni = p + oran * hiz * dt;
    if (yeni >= 1) {
      oynuyor = false;
      p = 1;
      zamanGonder(null, true);
      kontrolleriGuncelle();
      arayuzGuncelle();
      return;
    }
    p = yeni;
    zamanGonder(anZaman(), true);
    arayuzGuncelle();
    oynatRaf = requestAnimationFrame(kare);
  }

  function durdur() {
    if (!oynuyor && !oynatRaf) return;
    oynuyor = false;
    if (oynatRaf) { cancelAnimationFrame(oynatRaf); oynatRaf = 0; }
    kontrolleriGuncelle();
  }

  function oynatDuraklat() { if (oynuyor) durdur(); else oynat(); }

  // ---- aç / kapat
  function acKapa(durum) {
    acik = durum;
    govde.hidden = !acik;
    kok.classList.toggle('acik', acik);
    acDugme.setAttribute('aria-expanded', acik ? 'true' : 'false');
    acDugme.title = acik ? 'Zaman şeridini kapat ve şimdiye dön' : 'Ağın tohumdan bugüne büyümesini göster';
    if (acik) {
      if (model && model.tMax < Date.now() - 60000) yenidenKur();
      gecmisYukle();
      kontrolleriGuncelle();
      arayuzGuncelle();
      requestAnimationFrame(histogramCiz);  // yerleşim oturduktan sonra boyut al
    } else {
      simdiyeDon();
    }
  }

  async function gecmisYukle() {
    if (gecmisDurum === 'yukleniyor' || gecmisDurum === 'tamam') return;
    gecmisDurum = 'yukleniyor';
    kontrolleriGuncelle();
    try {
      const olaylar = await tumGecmis();
      olaylariIsle(olaylar);
      gecmisDurum = 'tamam';
    } catch (e) {
      gecmisDurum = 'hata';   // bir sonraki açılışta yeniden denenir
    }
    yenidenKur();
  }

  /** @returns {boolean} modeli etkiledi mi */
  function olaylariIsle(olaylar) {
    let degisti = false;
    if (!Array.isArray(olaylar)) return false;
    for (const o of olaylar) {
      if (!o || o.islem !== 'ekle') continue;
      const t = zamanMs(o.zaman);
      if (t === null) continue;
      if (o.tablo === 'olgu') {
        const anahtar = String(o.id);
        if (!olguZaman.has(anahtar)) { olguZaman.set(anahtar, t); degisti = true; }
      } else if (o.tablo === 'dugum' && o.dugum_id && !dugumZaman.has(o.dugum_id)) {
        dugumZaman.set(o.dugum_id, t);   // graf gelince grafın değeri geçerli olur
        degisti = true;
      }
    }
    return degisti;
  }

  // ---- histogram
  function css(ad) {
    let v = '';
    try { v = getComputedStyle(document.documentElement).getPropertyValue(ad).trim(); } catch (_) { /* yedeğe düş */ }
    return v || YEDEK_RENK[ad];
  }

  function cubuklarHesapla(w) {
    const adet = Math.max(8, Math.floor(w / CUBUK_PX));
    const dizi = model.olayT;
    const yogunluk = new Float64Array(adet);
    const sayi = new Uint32Array(adet);
    let enCok = 0;
    for (let i = 0; i < adet; i++) {
      const ta = konumdanZaman(model, u(), i / adet);
      const tb = konumdanZaman(model, u(), (i + 1) / adet);
      const a = i === 0 ? 0 : ustSinir(dizi, ta);
      const b = ustSinir(dizi, tb);
      const c = Math.max(0, b - a);
      sayi[i] = c;
      // olay/saat; çok dar dilimlerde sonsuza kaçmasın diye en az 1 sn
      const d = c / (Math.max(tb - ta, 1000) / 3600000);
      yogunluk[i] = d;
      if (d > enCok) enCok = d;
    }
    const yukseklik = new Float32Array(adet);
    const ol = Math.log1p(enCok) || 1;
    for (let i = 0; i < adet; i++) {
      yukseklik[i] = sayi[i] ? 0.12 + 0.88 * (Math.log1p(yogunluk[i]) / ol) : 0;
    }
    cubuklar = { w, surum: modelSurum, olcek, yukseklik };
  }

  function histogramCiz() {
    if (!acik) return;
    const w = tuval.clientWidth;
    const h = tuval.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const gw = Math.round(w * dpr), gh = Math.round(h * dpr);
    if (tuval.width !== gw) tuval.width = gw;
    if (tuval.height !== gh) tuval.height = gh;
    const ctx = tuval.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!model) return;
    if (!cubuklar || cubuklar.w !== w || cubuklar.surum !== modelSurum || cubuklar.olcek !== olcek) cubuklarHesapla(w);

    const isik = css('--isik');      // adaçayı: geçilmiş dönem
    const isik2 = css('--isik-2');   // fıstık/liken: imleç
    const kum = css('--fosil');      // kum: henüz gelmemiş dönem
    const parilti = azHareket && azHareket.matches ? 0 : 1;  // az harekette oynatırken titreyen ışıma yok
    const yh = cubuklar.yukseklik;
    const adet = yh.length;
    const bw = w / adet;
    const imlecX = p * w;
    const gecmis = new Path2D();
    const gelecek = new Path2D();
    for (let i = 0; i < adet; i++) {
      if (!yh[i]) continue;
      const x = i * bw;
      const ch = Math.max(1, yh[i] * (h - 3));
      const yol = x + bw / 2 <= imlecX ? gecmis : gelecek;
      yol.rect(x + 0.5, h - ch, Math.max(1, bw - 1), ch);
    }
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = kum;
    ctx.fill(gelecek);
    // yumuşak ışıma: önce geniş, soluk bir hale; sonra çubuklar ışımasız
    if (parilti) {
      ctx.globalAlpha = 0.18;
      ctx.shadowColor = isik;
      ctx.shadowBlur = 10;
      ctx.fillStyle = isik;
      ctx.fill(gecmis);
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 0.72;
    ctx.fillStyle = isik;
    ctx.fill(gecmis);
    ctx.restore();

    // imleç: seçili an
    if (!simdiMi()) {
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = isik2;
      ctx.shadowColor = isik2;
      ctx.shadowBlur = 6 * parilti;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(Math.round(imlecX) + 0.5, 0);
      ctx.lineTo(Math.round(imlecX) + 0.5, h);
      ctx.stroke();
      ctx.restore();
    }
  }

  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => histogramCiz()).observe(tuval);
  } else {
    window.addEventListener('resize', histogramCiz);
  }

  // ---- olaylar
  acDugme.addEventListener('click', () => acKapa(!acik));
  oynatDugme.addEventListener('click', oynatDuraklat);
  simdiDugme.addEventListener('click', simdiyeDon);
  for (const b of hizDugmeleri) {
    b.addEventListener('click', () => { hiz = Number(b.dataset.hiz) || 1; kontrolleriGuncelle(); });
  }
  olcekDugme.addEventListener('click', () => {
    if (!model) return;
    const t = anZaman();
    olcek = olcek === 'olay' ? 'takvim' : 'olay';
    if (t !== null) {
      p = Math.min(zamandanKonum(model, u(), t), 1 - 1 / ADIM);
      if (oynuyor) oran = (1 - p) / OYNATMA_SN;
    }
    kontrolleriGuncelle();
    arayuzGuncelle();
  });

  kaydirici.addEventListener('input', () => {
    konumAyarla(Number(kaydirici.value) / ADIM);
  });

  kaydirici.addEventListener('keydown', (e) => {
    if (!model || e.altKey || e.ctrlKey || e.metaKey) return;
    let yeni = null;
    const ileri = e.key === 'ArrowRight' || e.key === 'ArrowUp';
    const geri = e.key === 'ArrowLeft' || e.key === 'ArrowDown';
    if (ileri || geri) {
      if (olcek === 'olay' && !e.shiftKey) {
        // olay ölçeğinde oklar bir sonraki/önceki olay anına atlar
        const t = simdiMi() ? model.tMax : konumdanZaman(model, u(), p);
        const kt = model.kt;
        let hedef;
        if (ileri) { const k = ustSinir(kt, t + 0.5); hedef = k < kt.length ? kt[k] : model.tMax; }
        else { const k = ustSinir(kt, t - 0.5) - 1; hedef = k >= 0 ? kt[k] : model.tMin; }
        yeni = zamandanKonum(model, u(), hedef);
      } else {
        yeni = p + (ileri ? 1 : -1) * (e.shiftKey ? 0.1 : 0.01);
      }
    } else if (e.key === 'PageUp') yeni = p + 0.1;
    else if (e.key === 'PageDown') yeni = p - 0.1;
    else if (e.key === 'Home') yeni = 0;
    else if (e.key === 'End') yeni = 1;
    if (yeni === null) return;
    e.preventDefault();
    if (yeni >= 1) simdiyeDon();
    else konumAyarla(yeni);
  });

  kok.addEventListener('keydown', (e) => {
    if (!acik || e.key !== ' ' || e.repeat) return;
    if (e.target === acDugme) return;  // aç/kapa düğmesinde boşluk kendi işini yapar
    e.preventDefault();
    oynatDuraklat();
  });
  // Düğmelerde boşluk keyup'ta tıklama üretir; keydown'da işlediğimiz için onu yut.
  kok.addEventListener('keyup', (e) => {
    if (acik && e.key === ' ' && e.target !== acDugme && e.target.tagName === 'BUTTON') e.preventDefault();
  });

  kontrolleriGuncelle();

  return {
    /** Graf (yeniden) geldiğinde zaman eksenini kurar. */
    grafAyarla(graf) {
      const dugumler = graf && Array.isArray(graf.dugumler) ? graf.dugumler : [];
      const yeniGraf = new Set();
      for (const d of dugumler) {
        if (!d || !d.id) continue;
        const t = zamanMs(d.olusturma);
        if (t === null) continue;
        yeniGraf.add(d.id);
        dugumZaman.set(d.id, t);
      }
      // Daha önce graftan gelen ama artık olmayan düğümleri çıkar (canlı eklenenler graf gelene dek kalır).
      for (const id of grafDugumleri) if (!yeniGraf.has(id)) dugumZaman.delete(id);
      grafDugumleri.clear();
      for (const id of yeniGraf) grafDugumleri.add(id);
      yenidenKur();
    },
    /** Canlı gelen olayları (degisim) histograma ve eksene ekler. */
    olayEkle(olaylar) {
      if (olaylariIsle(olaylar)) yenidenKur();
    },
  };
}
