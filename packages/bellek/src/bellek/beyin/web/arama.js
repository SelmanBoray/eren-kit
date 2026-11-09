// Arama kutusu: "el feneri" — yazdıkça eşleşen mantarlar parlar.
import { ara } from './api.js';

const GECIKME_MS = 200;
const OZET_AZAMI = 110;

function kucult(s) {
  return String(s).toLocaleLowerCase('tr');
}

function el(etiket, sinif, metin) {
  const e = document.createElement(etiket);
  if (sinif) e.className = sinif;
  if (metin != null) e.textContent = metin;
  return e;
}

// Başlıkta sorgu kelimelerinin geçtiği aralıkları bulur; uzunluk değişirse vurgusuz döner.
function aralikBul(metin, kelimeler) {
  const alt = kucult(metin);
  if (alt.length !== metin.length) return [];
  const aralik = [];
  for (const k of kelimeler) {
    let i = 0;
    while ((i = alt.indexOf(k, i)) !== -1) {
      aralik.push([i, i + k.length]);
      i += k.length;
    }
  }
  aralik.sort((a, b) => a[0] - b[0]);
  const birlesik = [];
  for (const r of aralik) {
    const son = birlesik[birlesik.length - 1];
    if (son && r[0] <= son[1]) son[1] = Math.max(son[1], r[1]);
    else birlesik.push([r[0], r[1]]);
  }
  return birlesik;
}

function vurguluBaslik(kap, metin, kelimeler) {
  let konum = 0;
  for (const [b, s] of aralikBul(metin, kelimeler)) {
    if (b > konum) kap.appendChild(el('span', null, metin.slice(konum, b)));
    kap.appendChild(el('span', 'ar-vurgu', metin.slice(b, s)));
    konum = s;
  }
  if (konum < metin.length) kap.appendChild(el('span', null, metin.slice(konum)));
}

function kirp(metin) {
  const t = String(metin).replace(/\s+/g, ' ').trim();
  return t.length > OZET_AZAMI ? t.slice(0, OZET_AZAMI - 1).trimEnd() + '…' : t;
}

export function aramaKur(kok, { onSonuclar, onSec }) {
  const input = document.createElement('input');
  input.type = 'search';
  input.placeholder = 'Beyinde ara…  ( / )';
  input.setAttribute('aria-label', 'Beyinde ara');
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('spellcheck', 'false');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-autocomplete', 'list');

  const liste = el('div', 'kaydirma');
  liste.id = 'arama-liste';
  liste.setAttribute('role', 'listbox');
  liste.setAttribute('aria-label', 'Arama sonuçları');
  liste.hidden = true;
  input.setAttribute('aria-controls', liste.id);

  kok.appendChild(input);
  kok.appendChild(liste);

  let zamanlayici = null;
  let istekNo = 0;
  let secili = -1;
  let ogeler = []; // {oge, id}

  function listeKapat() {
    liste.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    secili = -1;
    ogeler.forEach((o) => {
      o.oge.classList.remove('secili');
      o.oge.setAttribute('aria-selected', 'false');
    });
  }

  function listeAc() {
    liste.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function seciliAyarla(i, kaydir = true) {
    if (!ogeler.length) return;
    secili = (i + ogeler.length) % ogeler.length;
    ogeler.forEach((o, n) => {
      const acik = n === secili;
      o.oge.classList.toggle('secili', acik);
      o.oge.setAttribute('aria-selected', acik ? 'true' : 'false');
    });
    const o = ogeler[secili].oge;
    input.setAttribute('aria-activedescendant', o.id);
    if (kaydir && o.scrollIntoView) o.scrollIntoView({ block: 'nearest' });
  }

  function mesaj(metin) {
    liste.replaceChildren(el('div', 'ar-mesaj soluk', metin));
    ogeler = [];
    secili = -1;
    listeAc();
  }

  function listeCiz(sonuclar, kelimeler) {
    liste.replaceChildren();
    ogeler = [];
    secili = -1;
    sonuclar.forEach((s, n) => {
      const oge = el('div', 'ar-oge');
      oge.id = 'arama-oge-' + n;
      oge.setAttribute('role', 'option');
      oge.setAttribute('aria-selected', 'false');

      const ust = el('div', 'ar-ust');
      const baslik = el('span', 'ar-baslik');
      vurguluBaslik(baslik, String(s.baslik ?? ''), kelimeler);
      ust.appendChild(baslik);
      if (s.gizlilik === 'ozel' || s.gizlilik === 'sir') {
        ust.appendChild(el('span', 'cip ar-cip', s.gizlilik === 'sir' ? 'sır' : 'özel'));
      }
      oge.appendChild(ust);

      if (Array.isArray(s.yol) && s.yol.length) {
        oge.appendChild(el('div', 'ar-yol soluk', s.yol.join(' › ')));
      }
      if (s.ozet) oge.appendChild(el('div', 'ar-ozet', kirp(s.ozet)));

      // mousedown: input odağını kaybetmeden seç
      oge.addEventListener('mousedown', (e) => e.preventDefault());
      oge.addEventListener('click', () => sec(s.id));
      oge.addEventListener('mousemove', () => {
        if (secili !== n) seciliAyarla(n, false);
      });
      liste.appendChild(oge);
      ogeler.push({ oge, id: s.id });
    });
    listeAc();
  }

  function sec(id) {
    listeKapat();
    onSec(id);
  }

  async function sorgula(q) {
    const no = ++istekNo;
    const kelimeler = q.split(/\s+/).filter(Boolean).map(kucult);
    try {
      const yanit = await ara(q, 20);
      if (no !== istekNo) return;
      const sonuclar = (yanit && yanit.sonuclar) || [];
      onSonuclar(new Set(sonuclar.map((s) => s.id)));
      if (!sonuclar.length) mesaj('Bu sözcük ağda hiç filizlenmemiş.');
      else listeCiz(sonuclar, kelimeler);
    } catch (hata) {
      if (no !== istekNo) return;
      mesaj('Arama şu an yapılamıyor' + (hata && hata.message ? ': ' + hata.message : '.'));
    }
  }

  function girdi() {
    clearTimeout(zamanlayici);
    const q = input.value.trim();
    if (q.length < 2) {
      istekNo++;
      liste.replaceChildren();
      ogeler = [];
      listeKapat();
      onSonuclar(null);
      return;
    }
    zamanlayici = setTimeout(() => sorgula(q), GECIKME_MS);
  }

  function temizle() {
    clearTimeout(zamanlayici);
    istekNo++;
    input.value = '';
    liste.replaceChildren();
    ogeler = [];
    listeKapat();
    onSonuclar(null);
  }

  input.addEventListener('input', girdi);
  input.addEventListener('focus', () => {
    if (liste.childElementCount) listeAc();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (liste.hidden && liste.childElementCount) listeAc();
      seciliAyarla(secili + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      seciliAyarla(secili < 0 ? ogeler.length - 1 : secili - 1);
    } else if (e.key === 'Enter') {
      if (!ogeler.length) return;
      e.preventDefault();
      sec(ogeler[secili >= 0 ? secili : 0].id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      temizle();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    const a = document.activeElement;
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable)) return;
    e.preventDefault();
    input.focus();
    input.select();
  });

  document.addEventListener('mousedown', (e) => {
    if (!kok.contains(e.target)) listeKapat();
  });

  return { temizle };
}
