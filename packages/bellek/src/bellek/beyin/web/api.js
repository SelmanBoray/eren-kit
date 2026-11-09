// Beyin arayüzü API istemcisi (bağımlılıksız ES modülü).
// Tüm istekler /api/ui/* altına, X-Beyin-Arayuz başlığıyla gider.

const ANAHTAR = 'beyin_arayuz';
const BASLIK = 'X-Beyin-Arayuz';
const ZAMAN_ASIMI_MS = 15000;

/** sessionStorage kullanılamazsa belirteç burada tutulur. */
let bellekBelirteci = null;

export class ApiHatasi extends Error {
  /**
   * @param {string} mesaj
   * @param {number} kod HTTP durum kodu; ağ hatası/zaman aşımı için 0
   */
  constructor(mesaj, kod = 0) {
    super(mesaj);
    this.name = 'ApiHatasi';
    this.kod = kod;
  }
}

function belirtecOku() {
  try {
    const d = sessionStorage.getItem(ANAHTAR);
    if (d) return d;
  } catch (_) { /* sessionStorage kullanılamıyor */ }
  return bellekBelirteci;
}

/**
 * İlk çağrıda `#t=` belirtecini sessionStorage'a taşır ve adresten siler.
 * @returns {boolean} belirteç var mı
 */
export function belirtecVar() {
  try {
    const h = location.hash ? location.hash.slice(1) : '';
    if (h) {
      const p = new URLSearchParams(h);
      const t = p.get('t');
      if (t) {
        bellekBelirteci = t;
        try { sessionStorage.setItem(ANAHTAR, t); } catch (_) { /* bellekte kaldı */ }
        p.delete('t');
        // Hash'i tümüyle sil (kalan parametre varsa korumak istenirse burada eklenir).
        history.replaceState(null, '', location.pathname + location.search);
      }
    }
  } catch (_) { /* yoksay */ }
  return !!belirtecOku();
}

/**
 * @param {'GET'|'POST'} yontem
 * @param {string} yol
 * @param {Object<string, string|number>} [sorgu]
 * @param {any} [govde]
 * @returns {Promise<any>}
 */
async function istek(yontem, yol, sorgu, govde) {
  let url = yol;
  if (sorgu) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sorgu)) {
      if (v !== undefined && v !== null) p.set(k, String(v));
    }
    const s = p.toString();
    if (s) url += '?' + s;
  }
  const basliklar = {};
  const t = belirtecOku();
  if (t) basliklar[BASLIK] = t;
  const secenek = { method: yontem, headers: basliklar, credentials: 'omit', cache: 'no-store' };
  if (yontem === 'POST') {
    basliklar['Content-Type'] = 'application/json';
    secenek.body = JSON.stringify(govde === undefined ? null : govde);
  }
  const ac = new AbortController();
  secenek.signal = ac.signal;
  const zamanlayici = setTimeout(() => ac.abort(), ZAMAN_ASIMI_MS);
  let yanit;
  let metin;
  try {
    yanit = await fetch(url, secenek);
    metin = await yanit.text();
  } catch (e) {
    const zaman = e && e.name === 'AbortError';
    throw new ApiHatasi(zaman ? 'İstek zaman aşımına uğradı.' : 'Sunucuya ulaşılamadı.', 0);
  } finally {
    clearTimeout(zamanlayici);
  }
  let veri = null;
  let jsonMu = true;
  try { veri = JSON.parse(metin); } catch (_) { jsonMu = false; }
  if (yanit.status === 401) {
    try { window.dispatchEvent(new CustomEvent('beyin:yetkisiz')); } catch (_) { /* yoksay */ }
  }
  if (!yanit.ok) {
    const m = jsonMu && veri && typeof veri.hata === 'string' ? veri.hata : `İstek başarısız (HTTP ${yanit.status}).`;
    throw new ApiHatasi(m, yanit.status);
  }
  if (!jsonMu) throw new ApiHatasi('Sunucu geçerli JSON döndürmedi.', yanit.status);
  return veri;
}

/** @returns {Promise<object>} graf: {imlec, gelen_bekleyen, kok, dugumler, kenarlar} */
export function graf() {
  return istek('GET', '/api/ui/graf');
}

/**
 * @param {string} id
 * @param {boolean} [ac] ozel düğümün içeriğini aç
 */
export function dugum(id, ac = false) {
  return istek('GET', '/api/ui/dugum', { id, ac: ac ? '1' : '0' });
}

/**
 * @param {string} q
 * @param {number} [k]
 * @returns {Promise<{sonuclar: object[]}>}
 */
export function ara(q, k = 20) {
  return istek('GET', '/api/ui/ara', { q, k });
}

/** @returns {Promise<{olaylar: object[], sonraki: number|null}>} */
export function gecmis(sonra = 0, limit = 500) {
  return istek('GET', '/api/ui/gecmis', { sonra, limit });
}

/** Tüm geçmişi sayfalayarak tek dizide döndürür (en çok 200 sayfa). @returns {Promise<object[]>} */
export async function tumGecmis() {
  const hepsi = [];
  let sonra = 0;
  for (let sayfa = 0; sayfa < 200; sayfa++) {
    const y = await gecmis(sonra, 1000);
    const o = (y && y.olaylar) || [];
    for (const e of o) hepsi.push(e);
    if (y.sonraki === null || y.sonraki === undefined) break;
    sonra = y.sonraki;
  }
  return hepsi;
}

/** @returns {Promise<{imlec:number, olaylar:object[], yeniden_yukle:boolean, gelen_bekleyen:number}>} */
export function degisim(imlec) {
  return istek('GET', '/api/ui/degisim', { imlec });
}

/**
 * @param {string|null} [ac] belirli gelen öğesinin içeriğini aç
 * @returns {Promise<{gelen: object[]}>}
 */
export function gelen(ac = null) {
  return istek('GET', '/api/ui/gelen', ac ? { ac } : undefined);
}

/**
 * @param {string} id
 * @param {'kabul'|'red'} karar
 * @param {{dugum_id:string}|{ebeveyn:string, baslik:string}|null} [duzeltme]
 */
export function gelenKarar(id, karar, duzeltme = null) {
  return istek('POST', '/api/ui/gelen/karar', undefined, { id, karar, duzeltme });
}

/**
 * Değişim yoklaması. Olay varsa ya da yeniden_yukle ise geriCagir(yanit) çağrılır.
 * @param {number} imlec başlangıç imleci
 * @param {(yanit: object) => void} geriCagir
 * @param {number} [aralikMs]
 * @returns {() => void} durdurucu
 */
export function yoklamaBaslat(imlec, geriCagir, aralikMs = 2000) {
  let durdu = false;
  let zamanlayici = null;
  let calisiyor = false;
  let bekleme = aralikMs;
  let simdiki = imlec;

  const planla = (ms) => {
    if (durdu) return;
    clearTimeout(zamanlayici);
    zamanlayici = setTimeout(tur, ms);
  };

  async function tur() {
    zamanlayici = null;
    if (durdu || calisiyor) return;
    if (document.hidden) return; // görünür olunca visibilitychange yeniden başlatır
    calisiyor = true;
    try {
      const y = await degisim(simdiki);
      if (durdu) return;
      if (y && typeof y.imlec === 'number') simdiki = y.imlec;
      bekleme = aralikMs;
      if (y && ((y.olaylar && y.olaylar.length > 0) || y.yeniden_yukle)) {
        try { geriCagir(y); } catch (e) { console.warn('Yoklama geri çağrısı hata verdi:', e && e.message); }
      }
    } catch (_) {
      bekleme = Math.min(bekleme * 2, 30000);
    } finally {
      calisiyor = false;
    }
    planla(bekleme);
  }

  const gorunurluk = () => {
    if (durdu) return;
    if (document.hidden) {
      clearTimeout(zamanlayici);
      zamanlayici = null;
    } else if (zamanlayici === null && !calisiyor) {
      tur();
    }
  };
  document.addEventListener('visibilitychange', gorunurluk);

  planla(aralikMs);

  return () => {
    durdu = true;
    clearTimeout(zamanlayici);
    zamanlayici = null;
    document.removeEventListener('visibilitychange', gorunurluk);
  };
}
