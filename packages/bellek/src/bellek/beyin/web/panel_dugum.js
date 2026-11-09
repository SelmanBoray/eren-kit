// Düğüm paneli: bir mantara tıklayınca sağda açılan "içine gir" görünümü.
// DOM yalnız createElement + textContent ile kurulur; HTML yorumlanmaz
// (içerik LLM oturumlarından gelir, SOZLESME §1).

import { dugum, ApiHatasi } from './api.js';

const TUR_ADI = {
  kok: 'kök', dal: 'dal', proje: 'proje', kisi: 'kişi', olay: 'olay',
  tercih: 'tercih', kural: 'kural', arac: 'araç', bilgi: 'bilgi',
};
const DURUM_ADI = {
  aktif: 'aktif', bitti: 'bitti', duraklatildi: 'duraklatıldı', bekliyor: 'bekliyor',
  bilinmiyor: 'bilinmiyor', arsiv: 'arşiv',
};
const GIZLILIK_ADI = { normal: 'açık', ozel: 'özel', sir_icerir: 'sır' };
// stil.css ortak çip renk sınıfları
const GIZLILIK_RENK = { ozel: 'spor', sir_icerir: 'fosil' };
const DURUM_RENK = { aktif: 'isik-2', bitti: 'fosil', arsiv: 'fosil', duraklatildi: 'fosil' };
const GUVEN = {
  yuksek: { ad: 'yüksek güven', seviye: 3 },
  orta: { ad: 'orta güven', seviye: 2 },
  dusuk: { ad: 'düşük güven', seviye: 1 },
};
const KAYNAK_ADI = {
  tohum: 'tohum', oturum: 'oturum', memory: 'hafıza', devir: 'devir', elle: 'elle',
};

// Kilitli içerik yerine basılan sahte satırlar: gerçek metinle ilgisi yok.
const SAHTE_SATIRLAR = [
  'miselyum ağının derininde saklı bir iz',
  'sporların arasında sessizce ışıyan',
  'toprağın altında bekleyen bir',
  'ince liflerle bağlanmış eski bir',
  'sis dağılınca okunacak',
];

const TARIH_GUN = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
const TARIH_AY = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' });
const TARIH_SAAT = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

/** Küçük yardımcı: öğe oluştur, sınıf ve metin ver. */
function el(etiket, sinif = null, metin = null) {
  const e = document.createElement(etiket);
  if (sinif) e.className = sinif;
  if (metin !== null && metin !== undefined) e.textContent = String(metin);
  return e;
}

/**
 * Tarih metnini Türkçe okunur biçime çevirir. Tanınmayan biçimde metni olduğu gibi döndürür.
 * @param {string|null} s
 * @param {boolean} [saatli]
 */
export function tarihBicim(s, saatli = false) {
  if (!s || typeof s !== 'string') return null;
  const t = s.trim();
  let m = /^(\d{4})$/.exec(t);
  if (m) return m[1];
  m = /^(\d{4})-(\d{2})$/.exec(t);
  if (m) return TARIH_AY.format(new Date(Number(m[1]), Number(m[2]) - 1, 1));
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return TARIH_GUN.format(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(t)) {
    const d = new Date(t.replace(' ', 'T'));
    if (!Number.isNaN(d.getTime())) return (saatli ? TARIH_SAAT : TARIH_GUN).format(d);
  }
  return t;
}

/** Bir zaman öğesi: görünen metin Türkçe, datetime özniteliği ham değer. */
function zamanEl(ham, sinif = 'dp-zaman', saatli = false) {
  const z = el('time', sinif, tarihBicim(ham, saatli) ?? '');
  if (ham) z.dateTime = ham;
  return z;
}

/** `kod` parçalarını görsel span'e ayırarak metni bir kaba ekler (HTML yorumlama yok). */
// `kod` ya da **kalın**; kalın içeriği `kod` parçası taşıyabilir ama kod içindeki ** kalın sayılmaz.
// Eşi olmayan tek ** ve boşlukla çevrili ** metin olarak kalır.
const SATIR_ICI = /`([^`\n]+)`|\*\*(?![\s*])((?:`[^`\n]+`|[^`\n])+?)(?<!\s)\*\*/g;

function satirIciEkle(kap, metin) {
  const desen = new RegExp(SATIR_ICI.source, 'g');
  let son = 0;
  let m;
  while ((m = desen.exec(metin)) !== null) {
    if (m.index > son) kap.append(document.createTextNode(metin.slice(son, m.index)));
    if (m[1] !== undefined) {
      kap.append(el('span', 'dp-kod', m[1]));
    } else {
      const kalin = el('strong', 'dp-kalin');
      satirIciEkle(kalin, m[2]);
      kap.append(kalin);
    }
    son = m.index + m[0].length;
  }
  if (son < metin.length) kap.append(document.createTextNode(metin.slice(son)));
}

/**
 * Ayrıntı metnini bloklara çevirir: `- ` satırları madde listesi, boş satır paragraf sonu,
 * ardışık düz satırlar aynı paragrafta satır kırılımıyla.
 */
function ayrintiKur(metin) {
  const kap = el('div', 'dp-ayrinti');
  let paragraf = null;
  let liste = null;
  for (const hamSatir of String(metin).replace(/\r\n?/g, '\n').split('\n')) {
    const satir = hamSatir.replace(/\s+$/, '');
    if (satir.trim() === '') {
      paragraf = null;
      liste = null;
      continue;
    }
    const madde = /^\s*[-*•]\s+(.*)$/.exec(satir);
    if (madde) {
      paragraf = null;
      if (!liste) {
        liste = el('ul', 'dp-liste');
        kap.append(liste);
      }
      const li = el('li');
      satirIciEkle(li, madde[1]);
      liste.append(li);
      continue;
    }
    if (liste && /^\s{2,}\S/.test(satir) && liste.lastElementChild) {
      // girintili devam satırı: son maddeye eklenir
      liste.lastElementChild.append(document.createTextNode(' '));
      satirIciEkle(liste.lastElementChild, satir.trim());
      continue;
    }
    liste = null;
    if (!paragraf) {
      paragraf = el('p');
      kap.append(paragraf);
    } else {
      paragraf.append(el('br'));
    }
    satirIciEkle(paragraf, satir.trim());
  }
  return kap;
}

function cip(metin, ek = '') {
  return el('span', ek ? `cip ${ek}` : 'cip', metin);
}

/** Gizlilik işaretli tıklanabilir çip bulutu. */
function bulutKur(baslik, ogeler, sinif, onGit) {
  const bolum = el('section', `dp-bolum ${sinif}`);
  const h = el('h3', 'dp-bolum-baslik');
  h.append(document.createTextNode(baslik + ' '));
  h.append(el('span', 'dp-sayi', ogeler.length));
  bolum.append(h);
  const ul = el('ul', 'dp-bulut');
  for (const o of ogeler) {
    const li = el('li');
    const b = el('button', `cip dp-git dp-g-${o.gizlilik || 'normal'}`);
    b.type = 'button';
    b.dataset.id = o.id;
    if (o.gizlilik && o.gizlilik !== 'normal') {
      b.append(el('span', 'dp-git-isaret', o.gizlilik === 'ozel' ? '◌' : '◆'));
      b.setAttribute('aria-label', `${o.baslik} (${GIZLILIK_ADI[o.gizlilik] || o.gizlilik})`);
    }
    b.append(el('span', 'dp-git-ad', o.baslik));
    b.addEventListener('click', () => onGit(o.id));
    li.append(b);
    ul.append(li);
  }
  bolum.append(ul);
  return bolum;
}

/**
 * @param {HTMLElement} kok `#dugum-panel`
 * @param {{onGit?: (id: string) => void}} [secenek]
 * @returns {{goster(id: string, ac?: boolean): Promise<void>, kapat(): void, acik(): boolean}}
 */
export function dugumPanelKur(kok, { onGit } = {}) {
  let istekNo = 0;
  let sonId = null;
  let sonAc = false;
  let sonVeri = null;
  let onceOdak = null;

  const git = (id) => {
    if (typeof onGit === 'function') onGit(id);
    else goster(id);
  };

  // --- iskelet ---------------------------------------------------------
  kok.setAttribute('role', 'dialog');
  kok.setAttribute('aria-label', 'Düğüm ayrıntısı');
  kok.tabIndex = -1;
  kok.classList.add('dp');

  const kapatDugme = el('button', 'kapat dp-kapat', '×');
  kapatDugme.type = 'button';
  kapatDugme.setAttribute('aria-label', 'Paneli kapat');
  kapatDugme.title = 'Kapat (Esc)';
  kapatDugme.addEventListener('click', () => kapat());

  const icerik = el('div', 'dp-icerik');
  kok.replaceChildren(kapatDugme, icerik);

  function odakIceride() {
    const a = document.activeElement;
    return !!a && a !== document.body && kok.contains(a);
  }

  function ac() {
    const yeniAcildi = kok.hidden;
    if (yeniAcildi) {
      const a = document.activeElement;
      onceOdak = a && a !== document.body && !kok.contains(a) ? a : null;
      kok.hidden = false;
    }
    return yeniAcildi;
  }

  function basligaOdak() {
    const h = icerik.querySelector('.dp-baslik');
    if (h) h.focus({ preventScroll: true });
    else kok.focus({ preventScroll: true });
  }

  // --- durumlar --------------------------------------------------------
  function iskeletGoster() {
    const k = el('div', 'dp-iskelet');
    k.setAttribute('aria-hidden', 'true');
    k.append(el('div', 'dp-isk dp-isk-yol'));
    k.append(el('div', 'dp-isk dp-isk-baslik'));
    const cipler = el('div', 'dp-isk-cipler');
    for (let i = 0; i < 3; i++) cipler.append(el('div', 'dp-isk dp-isk-cip'));
    k.append(cipler);
    for (let i = 0; i < 4; i++) k.append(el('div', `dp-isk dp-isk-satir dp-isk-s${i}`));
    for (let i = 0; i < 3; i++) k.append(el('div', 'dp-isk dp-isk-kart'));
    const durum = el('p', 'gorunmez', 'Yükleniyor…');
    durum.setAttribute('role', 'status');
    icerik.replaceChildren(durum, k);
    icerik.setAttribute('aria-busy', 'true');
    kok.scrollTop = 0;
  }

  function hataGoster(hata, id, acIstek) {
    icerik.removeAttribute('aria-busy');
    const kutu = el('div', 'dp-hata');
    kutu.setAttribute('role', 'alert');
    const yok = hata instanceof ApiHatasi && hata.kod === 404;
    const h = el('h2', 'dp-baslik', yok ? 'Bu düğüm artık yok' : 'Düğüm yüklenemedi');
    h.tabIndex = -1;
    kutu.append(el('div', 'dp-hata-iz'), h);
    if (yok) {
      kutu.append(el('p', 'soluk', 'Lif kopmuş: düğüm silinmiş ya da taşınmış olabilir.'));
    } else {
      const mesaj = hata && hata.message ? hata.message : 'Bilinmeyen hata.';
      kutu.append(el('p', 'soluk', mesaj));
      const tekrar = el('button', 'dugme', 'Yeniden dene');
      tekrar.type = 'button';
      tekrar.addEventListener('click', () => goster(id, acIstek));
      kutu.append(tekrar);
    }
    kok.setAttribute('aria-label', yok ? 'Düğüm bulunamadı' : 'Düğüm yüklenemedi');
    icerik.replaceChildren(kutu);
  }

  // --- içerik ----------------------------------------------------------
  function ustKur(v) {
    const ust = el('header', 'dp-ust');

    if (Array.isArray(v.yol) && v.yol.length > 1) {
      const nav = el('nav', 'dp-yol');
      nav.setAttribute('aria-label', 'Yol');
      const ol = el('ol');
      v.yol.forEach((y, i) => {
        const li = el('li');
        if (i === v.yol.length - 1) {
          const s = el('span', 'dp-yol-son', y.baslik);
          s.setAttribute('aria-current', 'page');
          li.append(s);
        } else {
          const b = el('button', 'dp-yol-dugme', y.baslik);
          b.type = 'button';
          b.addEventListener('click', () => git(y.id));
          li.append(b);
        }
        ol.append(li);
      });
      nav.append(ol);
      ust.append(nav);
    }

    const h = el('h2', 'dp-baslik', v.baslik);
    h.tabIndex = -1;
    ust.append(h);

    const cipler = el('div', 'dp-cipler');
    if (v.tur) cipler.append(cip(TUR_ADI[v.tur] || v.tur, `isik dp-cip-tur dp-tur-${v.tur}`));
    if (v.durum) cipler.append(cip(DURUM_ADI[v.durum] || v.durum, `${DURUM_RENK[v.durum] || ''} dp-cip-durum dp-durum-${v.durum}`.trim()));
    if (v.gizlilik) {
      cipler.append(cip(GIZLILIK_ADI[v.gizlilik] || v.gizlilik, `${GIZLILIK_RENK[v.gizlilik] || ''} dp-cip-gizlilik dp-g-${v.gizlilik}`.trim()));
    }
    if (v.tarih) {
      const t = cip('', 'dp-cip-tarih');
      t.append(zamanEl(v.tarih, 'dp-zaman'));
      cipler.append(t);
    }
    ust.append(cipler);

    if (v.olusturma || v.guncelleme) {
      const zaman = el('p', 'dp-zamanlar soluk');
      if (v.olusturma) {
        zaman.append(document.createTextNode('Filizlendi '));
        zaman.append(zamanEl(v.olusturma));
      }
      if (v.guncelleme && v.guncelleme !== v.olusturma) {
        if (v.olusturma) zaman.append(document.createTextNode(' · '));
        zaman.append(document.createTextNode('son besin '));
        zaman.append(zamanEl(v.guncelleme, 'dp-zaman', true));
      }
      ust.append(zaman);
    }
    return ust;
  }

  function sisKur(v) {
    const kap = el('section', 'dp-sis');
    kap.setAttribute('aria-label', 'Özel içerik kilitli');
    const satirlar = el('div', 'dp-sis-satirlar');
    satirlar.setAttribute('aria-hidden', 'true');
    SAHTE_SATIRLAR.forEach((s, i) => {
      const d = el('div', `bulanik dp-sahte dp-sahte-${i}`, s);
      satirlar.append(d);
    });
    kap.append(satirlar);
    const alt = el('div', 'dp-sis-alt');
    alt.append(el('p', 'soluk', 'Bu düğüm özel. İçerik sisin altında; yalnız sen açınca gelir.'));
    const acDugme = el('button', 'dugme dp-ac', 'Aç');
    acDugme.type = 'button';
    acDugme.addEventListener('click', () => {
      acDugme.disabled = true;
      acDugme.textContent = 'Sis dağılıyor…';
      goster(v.id, true);
    });
    alt.append(acDugme);
    kap.append(alt);
    return kap;
  }

  function muhurKur() {
    const kap = el('section', 'muhur dp-muhur');
    kap.setAttribute('aria-label', 'Mühürlü içerik');
    kap.append(el('p', 'dp-muhur-metin', '[gizli içerik]'));
    kap.append(el('p', 'soluk', 'Bu düğüm sır içeriyor. İçeriği arayüzde hiçbir zaman gösterilmez; yalnız başlığı görünür.'));
    return kap;
  }

  function guvenEl(guven) {
    const g = GUVEN[guven];
    const kap = el('span', `dp-guven dp-guven-${guven || 'yok'}`);
    kap.title = g ? g.ad : 'güven bilinmiyor';
    kap.setAttribute('aria-label', kap.title);
    kap.setAttribute('role', 'img');
    const seviye = g ? g.seviye : 0;
    for (let i = 1; i <= 3; i++) kap.append(el('span', i <= seviye ? 'dp-nokta dolu' : 'dp-nokta'));
    return kap;
  }

  function olguKartKur(o, haritasi) {
    const fosil = o.durum !== 'aktif';
    const li = el('li', `kart dp-olgu${fosil ? ' fosil dp-fosil' : ''}`);
    li.dataset.olgu = o.id;
    li.tabIndex = -1;
    haritasi.set(o.id, li);
    const metin = el('p', 'dp-olgu-metin');
    satirIciEkle(metin, o.metin ?? '');
    li.append(metin);

    const alt = el('div', 'dp-olgu-alt');
    if (o.olusturma) alt.append(zamanEl(o.olusturma, 'dp-zaman soluk'));
    if (o.gecerli_bas || o.gecerli_bit) {
      const ger = el('span', 'dp-gecerli soluk');
      const bas = tarihBicim(o.gecerli_bas) || '…';
      const bit = tarihBicim(o.gecerli_bit) || 'bugün';
      ger.textContent = `geçerli: ${bas} – ${bit}`;
      alt.append(ger);
    }
    if (o.kaynak_tur) alt.append(cip(KAYNAK_ADI[o.kaynak_tur] || o.kaynak_tur, `dp-kaynak dp-kaynak-${o.kaynak_tur}`));
    alt.append(guvenEl(o.guven));
    if (fosil && o.yerine_gecen) {
      const b = el('button', 'dp-yerine', 'yerine geçen →');
      b.type = 'button';
      b.dataset.hedef = o.yerine_gecen;
      alt.append(b);
    }
    li.append(alt);
    return li;
  }

  function olguyaKaydir(hedef) {
    if (!hedef) return;
    const det = hedef.closest('details');
    if (det && !det.open) det.open = true;
    const azHareket = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    hedef.scrollIntoView({ behavior: azHareket ? 'auto' : 'smooth', block: 'center' });
    hedef.classList.remove('dp-vurgu');
    void hedef.offsetWidth; // animasyonu yeniden başlat
    hedef.classList.add('dp-vurgu');
    hedef.focus({ preventScroll: true });
  }

  function olgularKur(olgular) {
    const parca = document.createDocumentFragment();
    const aktif = olgular.filter((o) => o.durum === 'aktif');
    const eski = olgular.filter((o) => o.durum !== 'aktif');
    const harita = new Map();

    if (aktif.length) {
      const bolum = el('section', 'dp-bolum dp-olgular');
      const h = el('h3', 'dp-bolum-baslik');
      h.append(document.createTextNode('Sporlar '));
      h.append(el('span', 'dp-sayi', aktif.length));
      bolum.append(h);
      const ul = el('ul', 'dp-olgu-liste');
      aktif.forEach((o, i) => {
        const k = olguKartKur(o, harita);
        k.style.setProperty('--sira', String(Math.min(i, 12)));
        ul.append(k);
      });
      bolum.append(ul);
      parca.append(bolum);
    }

    if (eski.length) {
      const det = el('details', 'dp-bolum dp-fosil-katman');
      const ozet = el('summary', 'dp-bolum-baslik');
      ozet.append(document.createTextNode('Fosil katmanı '));
      ozet.append(el('span', 'dp-sayi', eski.length));
      det.append(ozet);
      det.append(el('p', 'dp-fosil-not soluk', 'Eskimiş bilgi solar ama silinmez.'));
      const ul = el('ul', 'dp-olgu-liste');
      eski.forEach((o) => ul.append(olguKartKur(o, harita)));
      det.append(ul);
      parca.append(det);
    }

    // "yerine geçen" bağlantıları: hedef olgu bu düğümdeyse ona kaydır.
    for (const b of parca.querySelectorAll('.dp-yerine')) {
      const hedef = harita.get(b.dataset.hedef);
      if (hedef) {
        b.addEventListener('click', () => olguyaKaydir(hedef));
      } else {
        b.disabled = true;
        b.textContent = 'yerine geçen başka yerde';
      }
    }
    return parca;
  }

  function govdeKur(v) {
    const govde = el('div', 'dp-govde');
    if (v.gizlilik === 'sir_icerir') {
      govde.append(muhurKur());
      return govde;
    }
    if (v.kilitli) {
      govde.append(sisKur(v));
      return govde;
    }
    if (v.gizlilik === 'ozel') {
      const serit = el('div', 'dp-ozel-serit');
      serit.append(el('span', 'soluk', 'Özel içerik açık.'));
      const sisle = el('button', 'dugme ikincil dp-sisle', 'Yeniden sisle');
      sisle.type = 'button';
      sisle.addEventListener('click', () => goster(v.id, false));
      serit.append(sisle);
      govde.append(serit);
    }
    if (v.ozet) {
      const p = el('p', 'dp-ozet');
      satirIciEkle(p, v.ozet);
      govde.append(p);
    }
    if (v.ayrinti) govde.append(ayrintiKur(v.ayrinti));
    const olgular = Array.isArray(v.olgular) ? v.olgular : [];
    if (olgular.length) govde.append(olgularKur(olgular));
    if (!v.ozet && !v.ayrinti && !olgular.length) {
      govde.append(el('p', 'dp-bos soluk', 'Bu mantar henüz besin toplamadı: özet, ayrıntı ya da olgu yok.'));
    }
    return govde;
  }

  function veriGoster(v, sisDagil) {
    sonVeri = v;
    icerik.removeAttribute('aria-busy');
    const parca = document.createDocumentFragment();
    parca.append(ustKur(v));
    const govde = govdeKur(v);
    if (sisDagil) govde.classList.add('dp-sis-dagil');
    parca.append(govde);
    const cocuklar = Array.isArray(v.cocuklar) ? v.cocuklar : [];
    const ilgili = Array.isArray(v.ilgili) ? v.ilgili : [];
    if (cocuklar.length) parca.append(bulutKur('Filizler', cocuklar, 'dp-filizler', git));
    if (ilgili.length) parca.append(bulutKur('Bağlı lifler', ilgili, 'dp-lifler', git));
    kok.dataset.gizlilik = v.gizlilik || 'normal';
    kok.setAttribute('aria-label', `Düğüm: ${v.baslik}`);
    icerik.replaceChildren(parca);
    if (!sisDagil) kok.scrollTop = 0;
  }

  // --- genel arayüz ----------------------------------------------------
  /**
   * @param {string} id
   * @param {boolean} [acIstek] özel içeriği aç
   */
  async function goster(id, acIstek = false) {
    const no = ++istekNo;
    const yeniAcildi = ac();
    const odakVardi = yeniAcildi || odakIceride();
    // Aynı kilitli düğüm açılıyorsa sis yerinde kalır, sonra dağılır.
    const sisDagil = !!(acIstek && sonVeri && sonVeri.id === id && sonVeri.kilitli
      && sonVeri.gizlilik === 'ozel' && !yeniAcildi);
    sonId = id;
    sonAc = acIstek;
    if (sisDagil) {
      icerik.setAttribute('aria-busy', 'true');
    } else {
      sonVeri = null;
      iskeletGoster();
      if (odakVardi) kok.focus({ preventScroll: true });
    }
    let v;
    try {
      v = await dugum(id, acIstek);
    } catch (hata) {
      if (no !== istekNo) return;
      hataGoster(hata, id, acIstek);
      if (odakVardi || odakIceride()) basligaOdak();
      return;
    }
    if (no !== istekNo) return;
    if (!v || typeof v !== 'object') {
      hataGoster(new ApiHatasi('Sunucu boş yanıt döndürdü.', 0), id, acIstek);
      return;
    }
    const odakSimdi = odakVardi || odakIceride();
    veriGoster(v, sisDagil && !v.kilitli);
    if (odakSimdi) basligaOdak();
  }

  function kapat() {
    istekNo++;
    if (kok.hidden) return;
    kok.hidden = true;
    const geri = onceOdak;
    onceOdak = null;
    if (geri && geri.isConnected && typeof geri.focus === 'function') {
      try { geri.focus({ preventScroll: true }); } catch (_) { /* önemsiz */ }
    }
    kok.dispatchEvent(new CustomEvent('panel:kapandi', { bubbles: true, detail: { id: sonId } }));
  }

  function acik() {
    return !kok.hidden;
  }

  function yaziAlani(t) {
    if (!t || !(t instanceof Element)) return false;
    if (t.isContentEditable) return true;
    const ad = t.tagName;
    return ad === 'INPUT' || ad === 'TEXTAREA' || ad === 'SELECT';
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.isComposing || kok.hidden) return;
    if (yaziAlani(e.target) || yaziAlani(document.activeElement)) return;
    e.preventDefault();
    kapat();
  });

  // ilk durum: kapalı
  if (!kok.hasAttribute('hidden')) kok.hidden = true;

  return { goster, kapat, acik };
}
