// Beyin arayüzü — giriş modülü: yaşam döngüsü, modüllerin bağlanması ve "canlılık".
// Export yok. Metinler yalnız textContent ile basılır (HTML enjeksiyonu yasak).

import { belirtecKaydet, belirtecSil, belirtecVar, graf as grafGetir, yoklamaBaslat } from './api.js';

// ---------------------------------------------------------------- yardımcılar

const $ = (id) => document.getElementById(id);
const SON_DUGUM = 'beyin_son_dugum';
const YENIDEN_DENE_MS = 5000;
const NABIZ_EN_COK = 12;
const NABIZ_ARALIK_MS = 170;

/** Bir işi güvenle çalıştırır; hata uygulamayı öldürmez. */
function guvenli(ad, fn, ...arg) {
  try {
    return fn(...arg);
  } catch (e) {
    console.error(`[beyin] ${ad} hata verdi:`, e);
    return undefined;
  }
}

function depoOku(anahtar) {
  try { return sessionStorage.getItem(anahtar); } catch (_) { return null; }
}
function depoYaz(anahtar, deger) {
  try {
    if (deger === null || deger === undefined) sessionStorage.removeItem(anahtar);
    else sessionStorage.setItem(anahtar, deger);
  } catch (_) { /* depo yok; önemsiz */ }
}

function yaziyorMu() {
  const a = document.activeElement;
  return !!(a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable));
}

// ---------------------------------------------------------------- durum

const durum = {
  zamanlayici: null,
  /** @param {string} metin @param {number} [sureMs] verilirse o süre sonra silinir */
  yaz(metin, sureMs = 0) {
    const el = $('durum');
    if (!el) return;
    clearTimeout(this.zamanlayici);
    this.zamanlayici = null;
    el.textContent = metin || '';
    if (sureMs > 0) {
      this.zamanlayici = setTimeout(() => {
        this.zamanlayici = null;
        el.textContent = '';
      }, sureMs);
    }
  },
};

// ---------------------------------------------------------------- uygulama durumu

let durdu = false;               // yetkisiz → her şey durur
let yoklamaDurdur = null;
let yenidenDeneZamanlayici = null;

let grafVeri = null;
let dugumHaritasi = new Map();   // id → düğüm nesnesi
let yerler = null;               // Map<id, Yer>
let seciliId = null;

let Mod = {};                    // dinamik yüklenen modüller
let efektler = null;
let sahne = null;
let panel = null;
let arama = null;
let gelen = null;
let zaman = null;

/** Sahne/panel arasında olay yankısını (sonsuz döngü) önler. */
let icerde = 0;
function korumali(fn) {
  icerde++;
  try { return fn(); } finally { icerde--; }
}

// ---------------------------------------------------------------- giriş / yetkisiz

/** Giriş ekranındaki "anahtarı yapıştır" alanı (ör. telefonda ana ekran uygulaması). */
function yapistirmaBagla() {
  const girdi = $('giris-anahtar');
  const dugme = $('giris-bagla');
  const uyari = $('giris-anahtar-uyari');
  if (!girdi || !dugme || dugme.dataset.bagli) return;
  dugme.dataset.bagli = '1';
  const dene = () => {
    if (belirtecKaydet(girdi.value)) {
      girdi.value = '';
      location.reload();
    } else if (uyari) {
      uyari.hidden = false;
    }
  };
  dugme.addEventListener('click', dene);
  girdi.addEventListener('keydown', (e) => { if (e.key === 'Enter') dene(); });
}

function girisGoster(yetkisiz) {
  const el = $('giris');
  if (!el) return;
  yapistirmaBagla();
  if (yetkisiz) {
    let not = el.querySelector('.giris-not');
    if (!not) {
      not = document.createElement('p');
      not.className = 'giris-not soluk';
      (el.querySelector('.giris-kart') || el).appendChild(not);
    }
    not.textContent = 'Anahtar artık geçerli değil; beyin servisi yeniden başlamış olabilir. '
      + 'Terminalde python -m bellek.beyin ac komutuyla arayüzü yeniden aç.';
  }
  el.hidden = false;
}

function hepsiniDurdur() {
  durdu = true;
  clearTimeout(yenidenDeneZamanlayici);
  yenidenDeneZamanlayici = null;
  if (yoklamaDurdur) guvenli('yoklama durdurma', yoklamaDurdur);
  yoklamaDurdur = null;
}

window.addEventListener('beyin:yetkisiz', () => {
  belirtecSil();
  hepsiniDurdur();
  durum.yaz('Yetki geçersiz — bağlantı durdu.');
  girisGoster(true);
});

// ---------------------------------------------------------------- graf verisi

function grafKaydet(g) {
  grafVeri = g;
  dugumHaritasi = new Map();
  for (const d of (g && g.dugumler) || []) dugumHaritasi.set(d.id, d);
}

function gizliMi(d) {
  return !!d && (d.gizlilik === 'ozel' || d.gizlilik === 'sir_icerir');
}

// ---------------------------------------------------------------- seçim

function secimKaydet(id) {
  seciliId = id || null;
  depoYaz(SON_DUGUM, seciliId);
}

/** Düğüme git: seç, odaklan, paneli aç. */
function git(id) {
  if (!id || durdu) return;
  secimKaydet(id);
  korumali(() => {
    if (sahne) {
      guvenli('sahne.sec', () => sahne.sec(id));
      guvenli('sahne.odaklan', () => sahne.odaklan(id));
    }
    if (panel) guvenli('panel.goster', () => panel.goster(id));
  });
}

/** Sahneden gelen seçim: odaklanmadan seç + panel. */
function secOdaksiz(id) {
  secimKaydet(id);
  korumali(() => {
    if (sahne) guvenli('sahne.sec', () => sahne.sec(id));
    if (panel) guvenli('panel.goster', () => panel.goster(id));
  });
}

function secimTemizle({ paneliKapat = true } = {}) {
  secimKaydet(null);
  korumali(() => {
    if (sahne) guvenli('sahne.sec', () => sahne.sec(null));
    if (paneliKapat && panel) guvenli('panel.kapat', () => panel.kapat());
  });
}

function panelAcik() {
  if (panel && typeof panel.acik === 'function') {
    const v = guvenli('panel.acik', () => panel.acik());
    if (typeof v === 'boolean') return v;
  }
  const el = $('dugum-panel');
  return !!el && !el.hidden;
}

function gelenAcik() {
  const el = $('gelen-panel');
  return !!el && !el.hidden;
}

function aramaOdakta() {
  const kok = $('arama');
  return !!kok && kok.contains(document.activeElement);
}

function panelKapandi() {
  if (icerde) return;
  secimTemizle({ paneliKapat: false });
}
// Olay panelin kendisinde ya da window'da yayınlanabilir; ikisini de dinle (tekrar zararsız).
window.addEventListener('panel:kapandi', panelKapandi);
document.addEventListener('panel:kapandi', panelKapandi);

// ---------------------------------------------------------------- ipucu

function ipucu(id, sx, sy) {
  const el = $('ipucu');
  if (!el) return;
  const d = id ? dugumHaritasi.get(id) : null;
  if (!d) {
    el.hidden = true;
    return;
  }
  el.replaceChildren();
  const baslik = document.createElement('div');
  baslik.className = 'ipucu-baslik';
  baslik.textContent = d.baslik || '(başlıksız)';
  const alt = document.createElement('div');
  alt.className = 'ipucu-tur';
  alt.textContent = d.tur || '';
  if (d.gizlilik === 'ozel' || d.gizlilik === 'sir_icerir') {
    const isaret = document.createElement('span');
    isaret.className = 'ipucu-isaret ' + (d.gizlilik === 'ozel' ? 'ozel' : 'sir');
    isaret.textContent = d.gizlilik === 'ozel' ? ' · ◌ özel' : ' · ⊘ mühürlü';
    alt.appendChild(isaret);
  }
  el.appendChild(baslik);
  el.appendChild(alt);
  el.style.position = 'fixed';
  el.style.pointerEvents = 'none';
  el.hidden = false;

  // Sahne koordinatı → pencere koordinatı (canvas tam ekran olsa da ofseti hesaba kat).
  let ox = 0;
  let oy = 0;
  const tuval = $('sahne');
  if (tuval) {
    const r = tuval.getBoundingClientRect();
    ox = r.left;
    oy = r.top;
  }
  const cx = ox + (Number(sx) || 0);
  const cy = oy + (Number(sy) || 0);
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const W = window.innerWidth;
  const H = window.innerHeight;
  const pay = 8;
  let x = cx + 14;
  let y = cy + 16;
  if (x + w > W - pay) x = cx - 14 - w;
  if (y + h > H - pay) y = cy - 16 - h;
  x = Math.max(pay, Math.min(x, W - w - pay));
  y = Math.max(pay, Math.min(y, H - h - pay));
  el.style.left = `${Math.round(x)}px`;
  el.style.top = `${Math.round(y)}px`;
}

// ---------------------------------------------------------------- nabız / efekt

function nabiz(id) {
  if (!sahne || !id || durdu) return;
  if (!dugumHaritasi.has(id)) return;
  guvenli('sahne.nabiz', () => sahne.nabiz(id));
}

/** Açılış uyanışı: kökten başlayıp ana dallara sırayla nabız. */
function uyanis(g) {
  const kok = g.kok;
  const dallar = ((g && g.dugumler) || []).filter((d) => d.derinlik === 1);
  setTimeout(() => nabiz(kok), 250);
  const adim = dallar.length ? Math.min(380, 2600 / dallar.length) : 0;
  dallar.slice(0, 16).forEach((d, i) => {
    setTimeout(() => nabiz(d.id), 900 + i * adim);
  });
}

function yerdeEfekt(ad, id) {
  if (!efektler || !yerler || !id) return;
  const y = yerler.get(id);
  if (!y || typeof efektler[ad] !== 'function') return;
  guvenli(`efektler.${ad}`, () => efektler[ad](y.x, y.y, y.ton));
}

// ---------------------------------------------------------------- tazeleme kuyruğu

const kuyruk = {
  yukleniyor: false,
  tekrar: false,
  olaylar: [],      // işlenmeyi bekleyen Olay'lar
  kararlar: [],     // kabul edilmiş gelen sonucu → bağlandığı düğüm id'leri
  zamanlayici: null,
};

function tazele() {
  if (durdu) return;
  if (kuyruk.yukleniyor) {
    kuyruk.tekrar = true;
    return;
  }
  kuyruk.yukleniyor = true;
  (async () => {
    try {
      do {
        kuyruk.tekrar = false;
        await birTazeleme();
      } while (kuyruk.tekrar && !durdu);
    } finally {
      kuyruk.yukleniyor = false;
    }
  })();
}

async function birTazeleme() {
  const olaylar = kuyruk.olaylar.splice(0);
  const kararlar = kuyruk.kararlar.splice(0);
  let yeni;
  try {
    yeni = await grafGetir();
  } catch (e) {
    if (durdu) return;
    // Olayları geri koy; 5 sn sonra yeniden dene.
    kuyruk.olaylar.unshift(...olaylar);
    kuyruk.kararlar.unshift(...kararlar);
    durum.yaz(`Ağ tazelenemedi: ${(e && e.message) || 'bilinmeyen hata'} — 5 sn sonra yeniden denenecek.`);
    clearTimeout(kuyruk.zamanlayici);
    kuyruk.zamanlayici = setTimeout(tazele, YENIDEN_DENE_MS);
    return;
  }
  if (durdu || !yeni) return;

  const oncekiYerler = yerler;
  let yeniYerler = null;
  try {
    yeniYerler = Mod.yerlesimHesapla(yeni, oncekiYerler);
  } catch (e) {
    console.error('[beyin] yerleşim hesaplanamadı:', e);
    return;
  }
  grafKaydet(yeni);
  yerler = yeniYerler;
  if (sahne) guvenli('sahne.veriAyarla', () => sahne.veriAyarla(yeni, yeniYerler));
  if (zaman) {
    guvenli('zaman.grafAyarla', () => zaman.grafAyarla(yeni));
    if (olaylar.length) guvenli('zaman.olayEkle', () => zaman.olayEkle(olaylar));
  }
  if (gelen && typeof yeni.gelen_bekleyen === 'number') {
    guvenli('gelen.sayiAyarla', () => gelen.sayiAyarla(yeni.gelen_bekleyen));
  }

  // Seçili düğüm ağdan kalktıysa seçimi bırak.
  if (seciliId && !dugumHaritasi.has(seciliId)) secimTemizle();

  // Değişen düğümler (sırayla, benzersiz; en yeniler korunur).
  const sira = [];
  const goruldu = new Set();
  for (let i = olaylar.length - 1; i >= 0; i--) {
    const id = olaylar[i] && olaylar[i].dugum_id;
    if (id && !goruldu.has(id)) {
      goruldu.add(id);
      sira.unshift(id);
    }
  }
  const nabizlar = sira.slice(-NABIZ_EN_COK);
  nabizlar.forEach((id, i) => {
    setTimeout(() => {
      if (durdu) return;
      // Ağa yeni katılan düğüm filizlenir.
      if (oncekiYerler && !oncekiYerler.has(id)) yerdeEfekt('filiz', id);
      nabiz(id);
    }, i * NABIZ_ARALIK_MS);
  });

  // Kabul edilen spor bağlandığı yerde patlar.
  kararlar.forEach((id, i) => {
    setTimeout(() => {
      if (durdu || !dugumHaritasi.has(id)) return;
      yerdeEfekt('patlama', id);
      if (!goruldu.has(id)) nabiz(id);
    }, 120 + i * NABIZ_ARALIK_MS);
  });

  // Açık panel değişen düğümü gösteriyorsa tazele (gizli düğümde açılmış içeriği kilitlememek için yalnız normal).
  if (seciliId && goruldu.has(seciliId) && panel && panelAcik()) {
    const d = dugumHaritasi.get(seciliId);
    if (d && !gizliMi(d)) korumali(() => guvenli('panel.goster', () => panel.goster(seciliId)));
  }

  // Gelen kutusu olayı geldiyse ve panel açıksa listeyi tazele.
  if (gelen && gelenAcik() && olaylar.some((o) => o && o.tablo === 'gelen')) {
    guvenli('gelen.yenile', () => gelen.yenile());
  }

  filizDuyur(olaylar);
}

/** #durum'da kısa "yeni filiz" duyurusu. */
function filizDuyur(olaylar) {
  let son = null;
  let sayi = 0;
  const ids = new Set();
  for (const o of olaylar) {
    if (!o || !o.dugum_id) continue;
    if (!ids.has(o.dugum_id)) {
      ids.add(o.dugum_id);
      sayi++;
    }
    son = o;
  }
  if (!son) return;
  const ek = sayi > 1 ? ` (+${sayi - 1})` : '';
  const d = dugumHaritasi.get(son.dugum_id);
  const gizli = son.gizlilik === 'ozel' || son.gizlilik === 'sir_icerir' || gizliMi(d);
  if (gizli) {
    durum.yaz(`✧ yeni filiz${ek}`, 4000);
    return;
  }
  const metin = (son.baslik || son.ozet || '').trim();
  if (!metin) return;
  const kisa = metin.length > 80 ? metin.slice(0, 79) + '…' : metin;
  durum.yaz(`✧ yeni filiz: ${kisa}${ek}`, 4000);
}

function yoklamaGeriCagir(yanit) {
  if (durdu || !yanit) return;
  if (gelen && typeof yanit.gelen_bekleyen === 'number') {
    guvenli('gelen.sayiAyarla', () => gelen.sayiAyarla(yanit.gelen_bekleyen));
  }
  if (Array.isArray(yanit.olaylar)) kuyruk.olaylar.push(...yanit.olaylar);
  tazele();
}

/**
 * gelen.js'nin onKarar'ı: `{id, karar, yanit}` (yanit = POST /api/ui/gelen/karar gövdesi).
 * Şekil sözleşmede sabit değil; kabul edilen düğümü esnekçe ara.
 */
function kararGeldi(...arg) {
  let dugumId = null;
  let bekleyen = null;
  const bak = (o) => {
    if (!o || typeof o !== 'object') return;
    if (o.karar === 'red') return;
    if (o.yanit && typeof o.yanit === 'object') bak(o.yanit);
    if (typeof o.gelen_bekleyen === 'number') bekleyen = o.gelen_bekleyen;
    const s = o.sonuc && typeof o.sonuc === 'object' ? o.sonuc : o;
    if (s && s.sonuc !== 'reddedildi' && typeof s.dugum_id === 'string' && s.dugum_id) {
      dugumId = s.dugum_id;
    }
  };
  arg.forEach(bak);
  if (gelen && bekleyen !== null) guvenli('gelen.sayiAyarla', () => gelen.sayiAyarla(bekleyen));
  if (dugumId) kuyruk.kararlar.push(dugumId);
  tazele();
}

// ---------------------------------------------------------------- klavye

let escOnce = null;
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  // Modüller (document dinleyicileri) işlemeden önceki durumu kaydet.
  escOnce = { arama: aramaOdakta(), panel: panelAcik(), gelen: gelenAcik() };
}, true);

window.addEventListener('keydown', (e) => {
  if (durdu) return;
  if (e.key === 'Escape') {
    const once = escOnce || { arama: false, panel: false, gelen: false };
    escOnce = null;
    if (e.defaultPrevented) return;   // bir modül zaten işledi
    if (once.arama) return;           // arama kendi Esc'ini yönetir
    if (once.panel) {
      // Modül kapatmadıysa biz kapatırız (çift işlem yok: kapandıysa dokunma).
      if (panelAcik()) secimTemizle();
      return;
    }
    if (once.gelen) {
      if (gelenAcik() && gelen) guvenli('gelen.kapat', () => gelen.kapat());
      return;
    }
    if (seciliId) secimTemizle();
    else if (sahne) korumali(() => guvenli('sahne.sec', () => sahne.sec(null)));
    return;
  }
  if (e.key === 'Home' && !yaziyorMu() && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (sahne) {
      e.preventDefault();
      guvenli('sahne.genelBakis', () => sahne.genelBakis());
    }
  }
});

// ---------------------------------------------------------------- kurulum

async function modulleriYukle() {
  const adlar = ['yerlesim', 'efekt', 'sahne', 'panel_dugum', 'arama', 'gelen', 'zaman'];
  const sonuc = await Promise.allSettled(adlar.map((a) => import(`./${a}.js`)));
  const m = {};
  sonuc.forEach((s, i) => {
    if (s.status === 'fulfilled') m[adlar[i]] = s.value;
    else console.error(`[beyin] ${adlar[i]}.js yüklenemedi:`, s.reason);
  });
  return {
    yerlesimHesapla: m.yerlesim && m.yerlesim.yerlesimHesapla,
    Efektler: m.efekt && m.efekt.Efektler,
    Sahne: m.sahne && m.sahne.Sahne,
    dugumPanelKur: m.panel_dugum && m.panel_dugum.dugumPanelKur,
    aramaKur: m.arama && m.arama.aramaKur,
    gelenKur: m.gelen && m.gelen.gelenKur,
    zamanKur: m.zaman && m.zaman.zamanKur,
  };
}

function sahneKur(g) {
  yerler = Mod.yerlesimHesapla(g, null);
  grafKaydet(g);
  efektler = new Mod.Efektler();
  sahne = new Mod.Sahne($('sahne'), efektler);
  sahne.veriAyarla(g, yerler);
  guvenli('sahne.on(sec)', () => sahne.on('sec', (id) => {
    if (icerde || durdu) return;
    if (id) secOdaksiz(id);
    else secimTemizle();
  }));
  guvenli('sahne.on(uzerinde)', () => sahne.on('uzerinde', (id, sx, sy) => guvenli('ipucu', ipucu, id, sx, sy)));
  sahne.baslat();
  guvenli('sahne.genelBakis', () => sahne.genelBakis());
}

function arayuzKur(g) {
  if (Mod.dugumPanelKur && $('dugum-panel')) {
    panel = guvenli('dugumPanelKur', () => Mod.dugumPanelKur($('dugum-panel'), { onGit: (id) => git(id) })) || null;
    const el = $('dugum-panel');
    el.addEventListener('panel:kapandi', panelKapandi);
  }
  if (Mod.aramaKur && $('arama')) {
    arama = guvenli('aramaKur', () => Mod.aramaKur($('arama'), {
      onSonuclar: (ids) => { if (sahne) guvenli('sahne.vurgula', () => sahne.vurgula(ids)); },
      onSec: (id) => git(id),
    })) || null;
  }
  if (Mod.gelenKur && $('gelen-dugme') && $('gelen-panel')) {
    gelen = guvenli('gelenKur', () => Mod.gelenKur($('gelen-dugme'), $('gelen-panel'), {
      onKarar: kararGeldi,
      onGit: (id) => git(id),
    })) || null;
    if (gelen) guvenli('gelen.sayiAyarla', () => gelen.sayiAyarla(g.gelen_bekleyen));
  }
  if (Mod.zamanKur && $('zaman-serit')) {
    zaman = guvenli('zamanKur', () => Mod.zamanKur($('zaman-serit'), {
      onZaman: (t) => { if (sahne) guvenli('sahne.zamanAyarla', () => sahne.zamanAyarla(t)); },
    })) || null;
    if (zaman) guvenli('zaman.grafAyarla', () => zaman.grafAyarla(g));
  }
}

async function ilkYukle() {
  yenidenDeneZamanlayici = null;
  if (durdu) return;
  durum.yaz('Ağ uyanıyor…');
  let g;
  try {
    g = await grafGetir();
  } catch (e) {
    if (durdu) return;  // yetkisiz: giriş katmanı zaten gösterildi
    durum.yaz(`Ağa ulaşılamadı: ${(e && e.message) || 'bilinmeyen hata'} — 5 sn sonra yeniden denenecek.`);
    yenidenDeneZamanlayici = setTimeout(ilkYukle, YENIDEN_DENE_MS);
    return;
  }
  if (durdu) return;

  try {
    sahneKur(g);
  } catch (e) {
    console.error('[beyin] sahne kurulamadı:', e);
    durum.yaz('Ağ çizilemedi; tarayıcı konsolunda ayrıntı var. Sayfayı yenilemeyi dene.');
    return;
  }

  arayuzKur(g);
  uyanis(g);

  const son = depoOku(SON_DUGUM);
  if (son && dugumHaritasi.has(son)) setTimeout(() => git(son), 1200);
  else depoYaz(SON_DUGUM, null);

  const n = dugumHaritasi.size;
  durum.yaz(`Ağ uyandı · ${n} düğüm`, 3500);

  yoklamaDurdur = guvenli('yoklamaBaslat',
    () => yoklamaBaslat(typeof g.imlec === 'number' ? g.imlec : 0, yoklamaGeriCagir)) || null;
}

async function basla() {
  if (!belirtecVar()) {
    girisGoster(false);
    return;
  }
  durum.yaz('Ağ uyanıyor…');
  try {
    Mod = await modulleriYukle();
  } catch (e) {
    console.error('[beyin] modüller yüklenemedi:', e);
    Mod = {};
  }
  if (!Mod.yerlesimHesapla || !Mod.Efektler || !Mod.Sahne) {
    durum.yaz('Arayüz dosyaları yüklenemedi (yerleşim/efekt/sahne); tarayıcı konsolunda ayrıntı var.');
    return;
  }
  await ilkYukle();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { basla(); }, { once: true });
} else {
  basla();
}
