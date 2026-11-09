// Sporlar paneli: gelen kutusundaki önerileri gösterir, kabul/red kararını alır.
// DOM yalnızca createElement + textContent ile kurulur.
import { gelen, gelenKarar, ApiHatasi } from './api.js';

const TUR_ADI = {
  yeni_dugum: 'Yeni dal',
  olgu: 'Olgu',
  celiski: 'Çelişki',
  tasima: 'Taşıma',
};
const ONAY_SURESI_MS = 5000;
const DAGILMA_MS = 700;

const zamanBicim = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });

function el(etiket, sinif, metin) {
  const e = document.createElement(etiket);
  if (sinif) e.className = sinif;
  if (metin != null) e.textContent = metin;
  return e;
}

function zamanMetni(z) {
  const d = new Date(z);
  return Number.isNaN(d.getTime()) ? '' : zamanBicim.format(d);
}

function hataMetni(h) {
  if (h instanceof ApiHatasi) {
    if (h.kod === 404) return 'Bu spor artık bulunamıyor. Listeyi yenile.';
    if (h.kod === 400) return 'Karar kabul edilmedi' + (h.message ? ': ' + h.message : '.');
    if (h.kod === 401) return 'Oturum yetkisiz. Arayüzü terminalden yeniden aç.';
    return 'Bir hata oldu' + (h.message ? ': ' + h.message : '.');
  }
  return 'Sunucuya ulaşılamadı. Biraz sonra yeniden dene.';
}

export function gelenKur(dugme, panel, { onKarar, onGit } = {}) {
  const rozet = dugme.querySelector('#gelen-rozet');
  let sonSayi = 0;
  let istek = 0;

  // ---- Panel iskeleti ----
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Sporlar: ağa bağlanmayı bekleyen öneriler');
  panel.textContent = '';

  const ust = el('div', 'gelen-ust');
  const baslikKutu = el('div', 'gelen-baslik-kutu');
  baslikKutu.append(
    el('h2', 'gelen-baslik', 'Sporlar'),
    el('p', 'gelen-aciklama soluk', 'Henüz ağa bağlanmamış öneriler. Bağlarsan ağa filizlenir, silersen dağılır.'),
  );
  const kapatDugme = el('button', 'kapat', '×');
  kapatDugme.type = 'button';
  kapatDugme.setAttribute('aria-label', 'Sporlar panelini kapat');
  ust.append(baslikKutu, kapatDugme);

  const liste = el('div', 'gelen-liste kaydirma');
  liste.setAttribute('aria-live', 'polite');
  panel.append(ust, liste);

  function durumGoster(metin, sinif) {
    liste.textContent = '';
    liste.append(el('p', 'gelen-durum ' + (sinif || 'soluk'), metin));
  }

  // ---- Kart ----
  function kartKur(oge) {
    const kart = el('article', 'kart spor-kart');
    kart.dataset.id = oge.id;
    let mesgul = false;
    let onayZamanlayici = null;

    const ustSatir = el('div', 'spor-ust');
    ustSatir.append(el('span', 'cip spor-cip', TUR_ADI[oge.tur] || 'Öneri'));
    const zm = zamanMetni(oge.zaman);
    if (zm) ustSatir.append(el('span', 'spor-zaman soluk', zm));
    kart.append(ustSatir);

    if (oge.baslik) kart.append(el('h3', 'spor-baslik', oge.baslik));
    if (oge.ebeveyn) {
      const yer = el('p', 'spor-yer soluk');
      yer.append('Önerilen yer: ', el('span', 'spor-yol', oge.ebeveyn));
      kart.append(yer);
    }

    const sir = oge.gizlilik === 'sir_icerir';
    if (oge.kilitli && sir) {
      kart.append(el('p', 'muhur spor-muhur', 'Mühürlü içerik. Yalnız başlık görünür.'));
    } else if (oge.kilitli) {
      const bulanik = el('div', 'spor-bulanik bulanik');
      bulanik.setAttribute('aria-hidden', 'true');
      for (const w of ['w90', 'w100', 'w65']) bulanik.append(el('span', 'spor-sahte ' + w, 'xxxxxxxx xxxxxx xxxxxxx'));
      kart.append(bulanik);
    } else if (oge.metin) {
      kart.append(el('p', 'spor-metin', oge.metin));
    }

    const hataSatiri = el('p', 'spor-hata');
    hataSatiri.setAttribute('role', 'alert');
    hataSatiri.hidden = true;
    function hataGoster(m) {
      hataSatiri.textContent = m || '';
      hataSatiri.hidden = !m;
    }

    const baglar = el('div', 'spor-baglar');
    if (oge.hedef_id) {
      const git = el('button', 'dugme ikincil spor-git', 'Ağda göster');
      git.type = 'button';
      git.addEventListener('click', () => { if (onGit) onGit(oge.hedef_id); });
      baglar.append(git);
    }
    if (oge.kilitli && !sir) {
      const ac = el('button', 'dugme ikincil spor-ac', 'Aç');
      ac.type = 'button';
      ac.addEventListener('click', async () => {
        if (mesgul) return;
        mesgul = true;
        ac.disabled = true;
        hataGoster('');
        try {
          const y = await gelen(oge.id);
          const acik = (y.gelen || []).find((x) => x.id === oge.id);
          if (!acik) throw new ApiHatasi('Spor bulunamadı', 404);
          kart.replaceWith(kartKur(acik));
        } catch (h) {
          mesgul = false;
          ac.disabled = false;
          hataGoster(hataMetni(h));
        }
      });
      baglar.append(ac);
    }
    if (baglar.childNodes.length) kart.append(baglar);

    // Düzeltme formu (yalnız yeni_dugum)
    let duzBaslik = null;
    let duzUst = null;
    let duzForm = null;
    if (oge.tur === 'yeni_dugum') {
      duzForm = el('div', 'spor-duzeltme');
      duzForm.hidden = true;
      const e1 = el('label', 'spor-alan');
      e1.append(el('span', 'soluk', 'Başlık'));
      duzBaslik = el('input');
      duzBaslik.type = 'text';
      duzBaslik.maxLength = 200;
      duzBaslik.placeholder = oge.baslik || '';
      e1.append(duzBaslik);
      const e2 = el('label', 'spor-alan');
      e2.append(el('span', 'soluk', 'Üst yol'));
      duzUst = el('input');
      duzUst.type = 'text';
      duzUst.maxLength = 300;
      duzUst.placeholder = oge.ebeveyn || '';
      e2.append(duzUst);
      duzForm.append(e1, e2);
      kart.append(duzForm);
    }

    const eylem = el('div', 'spor-eylem');
    kart.append(hataSatiri, eylem);

    function onayiIptal() {
      if (onayZamanlayici) { clearTimeout(onayZamanlayici); onayZamanlayici = null; }
    }

    function normalGoster() {
      onayiIptal();
      eylem.textContent = '';
      const bagla = el('button', 'dugme spor-bagla', 'Bağla');
      bagla.type = 'button';
      bagla.addEventListener('click', () => onayGoster('kabul'));
      const sil = el('button', 'dugme tehlike spor-sil', 'Sil');
      sil.type = 'button';
      sil.addEventListener('click', () => onayGoster('red'));
      eylem.append(bagla);
      if (duzForm) {
        const duz = el('button', 'dugme ikincil spor-duz', duzForm.hidden ? 'Düzelt' : 'Düzeltmeyi gizle');
        duz.type = 'button';
        duz.setAttribute('aria-expanded', String(!duzForm.hidden));
        duz.addEventListener('click', () => {
          duzForm.hidden = !duzForm.hidden;
          duz.textContent = duzForm.hidden ? 'Düzelt' : 'Düzeltmeyi gizle';
          duz.setAttribute('aria-expanded', String(!duzForm.hidden));
          if (!duzForm.hidden) duzBaslik.focus();
        });
        eylem.append(duz);
      }
      eylem.append(sil);
    }

    function onayGoster(karar) {
      onayiIptal();
      hataGoster('');
      eylem.textContent = '';
      const soru = el('span', 'spor-onay-soru', 'Emin misin?');
      const evet = el('button', karar === 'red' ? 'dugme tehlike' : 'dugme', 'Evet');
      evet.type = 'button';
      const vazgec = el('button', 'dugme ikincil', 'Vazgeç');
      vazgec.type = 'button';
      evet.addEventListener('click', () => gonder(karar));
      vazgec.addEventListener('click', normalGoster);
      eylem.append(soru, evet, vazgec);
      evet.focus();
      onayZamanlayici = setTimeout(normalGoster, ONAY_SURESI_MS);
    }

    async function gonder(karar) {
      if (mesgul) return;
      onayiIptal();
      mesgul = true;
      for (const b of eylem.querySelectorAll('button')) b.disabled = true;
      let duzeltme = null;
      if (karar === 'kabul' && duzBaslik) {
        const b = duzBaslik.value.trim();
        const u = duzUst.value.trim();
        if (b || u) duzeltme = { ebeveyn: u || oge.ebeveyn || '', baslik: b || oge.baslik || '' };
      }
      try {
        const yanit = await gelenKarar(oge.id, karar, duzeltme);
        kart.classList.add('dagil');
        let bitti = false;
        const kaldir = () => {
          if (bitti) return;
          bitti = true;
          kart.remove();
          if (!liste.querySelector('.spor-kart')) durumGoster('Şu an bekleyen spor yok. Ağ sakin.');
        };
        kart.addEventListener('animationend', kaldir, { once: true });
        setTimeout(kaldir, DAGILMA_MS);
        api.sayiAyarla(yanit.gelen_bekleyen);
        if (onKarar) onKarar({ id: oge.id, karar, yanit });
      } catch (h) {
        mesgul = false;
        hataGoster(hataMetni(h));
        normalGoster();
      }
    }

    normalGoster();
    return kart;
  }

  // ---- Yenile ----
  async function yenile() {
    const benim = ++istek;
    durumGoster('Sporlar yoklanıyor…');
    try {
      const y = await gelen();
      if (benim !== istek) return;
      const oneriler = y.gelen || [];
      liste.textContent = '';
      if (!oneriler.length) {
        durumGoster('Şu an bekleyen spor yok. Ağ sakin.');
      } else {
        for (const o of oneriler) liste.append(kartKur(o));
      }
      api.sayiAyarla(oneriler.length);
    } catch (h) {
      if (benim !== istek) return;
      durumGoster(hataMetni(h), 'spor-hata');
    }
  }

  // ---- Aç / kapat ----
  function ac() {
    panel.hidden = false;
    dugme.setAttribute('aria-expanded', 'true');
    yenile();
  }
  function kapat() {
    panel.hidden = true;
    dugme.setAttribute('aria-expanded', 'false');
  }

  dugme.setAttribute('aria-haspopup', 'dialog');
  dugme.setAttribute('aria-expanded', String(!panel.hidden));
  dugme.addEventListener('click', () => (panel.hidden ? ac() : kapat()));
  kapatDugme.addEventListener('click', () => { kapat(); dugme.focus(); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.isComposing || panel.hidden || e.defaultPrevented) return;
    const yazi = (t) => !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    if (yazi(e.target) || yazi(document.activeElement)) return;
    // Yakalama aşamasında çalışır: Esc yalnız bu paneli kapatır; panel_dugum.js'in
    // (defaultPrevented'a bakmayan) dinleyicisi ve app.js'in baloncuk dinleyicisi bu olayı görmez.
    e.preventDefault();
    e.stopPropagation();
    kapat();
  }, true);
  dugme.addEventListener('animationend', () => dugme.classList.remove('nabiz'));

  // ---- Sayı ----
  function sayiAyarla(n) {
    const say = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
    if (rozet) {
      rozet.textContent = say > 0 ? String(say) : '';
      rozet.hidden = say === 0;
    }
    dugme.setAttribute('aria-label', say + ' bekleyen spor');
    if (say > sonSayi) {
      dugme.classList.remove('nabiz');
      void dugme.offsetWidth;
      dugme.classList.add('nabiz');
    }
    sonSayi = say;
  }

  const api = { sayiAyarla, yenile, ac, kapat };
  return api;
}
