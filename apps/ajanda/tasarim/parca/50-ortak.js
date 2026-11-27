'use strict';
document.documentElement.lang = 'tr';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const YON = {};

/* ---- hareket yardımcıları ---- */
const azMQ = matchMedia('(prefers-reduced-motion: reduce)');
const az = () => azMQ.matches;
const BOS_AN = { finished: Promise.resolve(), cancel() {} };
function an(e, kf, o) {
  if (!e || !e.animate) return BOS_AN;
  o = typeof o === 'number' ? { duration: o } : { ...o };
  if (az()) { o.duration = 1; o.delay = 0; }
  if (!o.fill) o.fill = 'backwards';
  const a = e.animate(kf, o);
  a.finished.catch(() => {});
  return a;
}
const bekle = (ms) => new Promise((r) => setTimeout(r, az() ? 0 : ms));
function surukle(hedef, h) {
  hedef.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    if (h.filtre && !h.filtre(e)) return;
    const x0 = e.clientX, y0 = e.clientY;
    let aktif = false, son = { x: x0, y: y0, t: e.timeStamp }, v = { x: 0, y: 0 };
    const birak = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); };
    const mv = (ev) => {
      const dx = ev.clientX - x0, dy = ev.clientY - y0;
      if (!aktif) {
        if (Math.hypot(dx, dy) < 8) return;
        if (h.eksen === 'x' && Math.abs(dx) < Math.abs(dy)) return birak();
        if (h.eksen === 'y' && Math.abs(dy) < Math.abs(dx)) return birak();
        aktif = true;
        try { hedef.setPointerCapture(e.pointerId); } catch (_) {}
        if (h.basla) h.basla(ev);
      }
      const dt = Math.max(1, ev.timeStamp - son.t);
      v = { x: (ev.clientX - son.x) / dt, y: (ev.clientY - son.y) / dt };
      son = { x: ev.clientX, y: ev.clientY, t: ev.timeStamp };
      h.tasi(dx, dy, ev);
    };
    const up = (ev) => {
      birak();
      if (!aktif) return;
      hedef._surukledi = true; setTimeout(() => { hedef._surukledi = false; }, 60);
      h.bitir(ev.clientX - x0, ev.clientY - y0, v.x, v.y, ev);
    };
    addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  });
}

/* ---- tarih ve metin ---- */
const BUGUN = '2026-11-27', SIMDI = '12:40';
const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const GUNLER = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
const KGUN = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const BOLUM = { sabah: 'sabah', ogle: 'öğle', ogleden_sonra: 'öğleden sonra', aksam: 'akşam', gece: 'gece' };
const BOLUM_SIRA = ['sabah', 'ogle', 'ogleden_sonra', 'aksam', 'gece'];
const iki = (n) => String(n).padStart(2, '0');
const T = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const iso = (d) => `${d.getFullYear()}-${iki(d.getMonth() + 1)}-${iki(d.getDate())}`;
const gunEkle = (s, n) => { const d = T(s); d.setDate(d.getDate() + n); return iso(d); };
const haftaGunu = (s) => (T(s).getDay() + 6) % 7;
const uzunTarih = (s) => `${GUNLER[haftaGunu(s)]}, ${T(s).getDate()} ${AYLAR[T(s).getMonth()]}`;
const goreli = (s) => (s === BUGUN ? 'Bugün' : s === gunEkle(BUGUN, 1) ? 'Yarın' : s === gunEkle(BUGUN, -1) ? 'Dün' : uzunTarih(s));
const dk = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const hhmm = (n) => `${iki(Math.floor(n / 60))}:${iki(n % 60)}`;
const kucuk = (s) => s.toLocaleLowerCase('tr');
const buyuk = (s) => s.toLocaleUpperCase('tr');
function ayIzgarasi(y, m) {
  const ilk = new Date(y, m, 1), bas = new Date(y, m, 1 - ((ilk.getDay() + 6) % 7));
  const g = Array.from({ length: 42 }, (_, i) => { const d = new Date(bas); d.setDate(bas.getDate() + i); return iso(d); });
  return T(g[35]).getMonth() === m ? g : g.slice(0, 35);
}

/* ---- örnek veri (hepsi uydurma) ---- */
function ornekVeri() {
  const v = (id, tarih, bitti) => ({ id, baslik: 'İş yerinde vardiya', tarih, saat: '09:00', bitis: '17:00', gorsel: 'imza', renk: 'cam', bolge: 'İş yeri', varis: 'Giriş çizelgesini imzala', bitti, not: 'Girişte çizelgeyi imzala.', fotolar: [], baglantilar: [{ tip: 'belge', ad: 'Vardiya çizelgesi' }], hatirlatmalar: ['30 dk önce'] });
  return [
    { id: 'kargo', baslik: 'Kargo teslimi', tarih: BUGUN, saat: '09:30', gorsel: 'kutu', renk: 'domates', bitti: true, not: 'Kapıcıya bırakılmasın, teslimde imza isteniyor. Koli gelince içindeki faturayı ayır.', fotolar: [], baglantilar: [{ tip: 'belge', ad: 'Gönderi takip sayfası' }], hatirlatmalar: ['15 dk önce'] },
    { id: 'araba', baslik: 'Araba yıkama', tarih: BUGUN, bolum: 'sabah', gorsel: 'araba', renk: 'kobalt', bolge: 'Oto yıkama', varis: 'Bagajdaki koliyi çıkar', kapak: 'cizim', not: 'İç temizlik de yapılsın. Bagajdaki koli çıkmadan teslim etme. Sağ arka kapıdaki çiziği göster, pasta cila fiyatını sor. Ön sol lastik biraz inik, basınca da baksınlar.', fotolar: ['araba', 'cizik'], baglantilar: [{ tip: 'harita', ad: 'Yıkamacının yeri' }, { tip: 'belge', ad: 'Geçen ayki fiş' }], hatirlatmalar: ['Sabah 08:00'] },
    { id: 'eczane', baslik: 'Eczaneden ilaç al', tarih: BUGUN, bolum: 'ogle', taslak: true, yazar: 'Asistan önerdi', gorsel: 'ilac', renk: 'gok', not: 'Dünkü konuşmadan çıkarıldı: reçetenin süresi cuma günü doluyor.', fotolar: [], baglantilar: [], hatirlatmalar: ['Öğle 11:00'] },
    { id: 'vardiya', baslik: 'İş yerinde vardiya', tarih: BUGUN, saat: '13:00', bitis: '21:00', gorsel: 'imza', renk: 'cam', bolge: 'İş yeri', varis: 'Giriş çizelgesini imzala', not: 'Girişte çizelgeyi imzalamadan soyunma odasına geçme; geçen hafta unutuldu, mesai eksik göründü. Bugün depo sayımı var, sayım formu fotoğraflarda. 17:30 yemek molası, 21:00 kasa devri.', fotolar: ['form', 'kapi'], baglantilar: [{ tip: 'belge', ad: 'Vardiya çizelgesi' }, { tip: 'belge', ad: 'Sayım formu' }, { tip: 'harita', ad: 'Yol tarifi' }], hatirlatmalar: ['30 dk önce'] },
    { id: 'market', baslik: 'Market', tarih: BUGUN, bolum: 'aksam', gorsel: 'sepet', renk: 'hardal', not: 'Süt, yumurta, kahve, bulaşık deterjanı, limon. Pazar kahvaltısı için peynir ve zeytin. Poşet götür.', fotolar: ['liste'], baglantilar: [], hatirlatmalar: ['Akşam 19:00'] },
    { id: 'vesikalik', baslik: 'Vesikalık fotoğraf çektir', gorsel: 'yildiz', renk: 'kum', not: 'Biyometrik, altı adet.', fotolar: [], baglantilar: [], hatirlatmalar: [] },
    { id: 'lastik', baslik: 'Bisiklet lastiğini şişir', gorsel: 'yildiz', renk: 'kum', not: '', fotolar: [], baglantilar: [], hatirlatmalar: [] },
    { id: 'kitaplik', baslik: 'Kitaplığı düzenle', gorsel: 'yildiz', renk: 'kum', not: 'Okunmayanları ayır, kutuya koy.', fotolar: [], baglantilar: [], hatirlatmalar: [] },
    { id: 'kahvalti', baslik: 'Kahvaltı', tarih: '2026-11-28', saat: '10:30', gorsel: 'fincan', renk: 'hardal', not: 'Dört kişilik yer ayrıldı. Rezervasyon numarası mesajda.', fotolar: [], baglantilar: [{ tip: 'harita', ad: 'Kahvaltıcının yeri' }], hatirlatmalar: ['1 saat önce'] },
    { id: 'camasir', baslik: 'Çamaşırları kuru temizlemeden al', tarih: '2026-11-28', bolum: 'aksam', gorsel: 'yildiz', renk: 'kum', not: 'Fiş cüzdanda.', fotolar: [], baglantilar: [], hatirlatmalar: ['Akşam 19:00'] },
    { id: 'disci', baslik: 'Dişçi randevusu', tarih: '2026-11-30', saat: '10:15', bitis: '11:00', gorsel: 'dis', renk: 'pembe', bolge: 'Diş kliniği', varis: 'Eski röntgeni danışmaya ver', not: 'Kontrol ve diş taşı temizliği. Eski röntgen filmini götür. Randevudan iki saat önce bir şey yeme.', fotolar: [], baglantilar: [{ tip: 'harita', ad: 'Kliniğin yeri' }, { tip: 'belge', ad: 'Randevu onayı' }], hatirlatmalar: ['1 gün önce', '1 saat önce'] },
    v('v1201', '2026-12-01', false), v('v1202', '2026-12-02', false), v('v1208', '2026-12-08', false), v('v1209', '2026-12-09', false),
    { id: 'fatura', baslik: 'Elektrik faturası son gün', tarih: '2026-12-03', gorsel: 'fatura', renk: 'gece', not: 'Otomatik ödeme kapalı, elle yatır.', fotolar: [], baglantilar: [{ tip: 'belge', ad: 'Fatura' }], hatirlatmalar: ['Sabah 09:00'] },
    { id: 'gezi', baslik: 'Hafta sonu gezisi', tarih: '2026-12-05', bitisTarih: '2026-12-06', gorsel: 'cadir', renk: 'gece', not: 'Cumartesi sabah erken çıkış. Termos, yağmurluk, şarj aleti.', fotolar: [], baglantilar: [{ tip: 'harita', ad: 'Kamp alanı' }], hatirlatmalar: ['1 gün önce'] },
    { id: 'hediye', baslik: 'Doğum günü hediyesi al', tarih: '2026-12-12', bolum: 'ogleden_sonra', gorsel: 'kutu', renk: 'domates', not: '', fotolar: [], baglantilar: [], hatirlatmalar: [] },
    { id: 'kira', baslik: 'Kira ödemesi', tarih: '2026-11-03', gorsel: 'fatura', renk: 'gece', bitti: true, not: '', fotolar: [], baglantilar: [], hatirlatmalar: [] },
    v('v1110', '2026-11-10', true), v('v1111', '2026-11-11', true), v('v1117', '2026-11-17', true), v('v1118', '2026-11-18', true), v('v1124', '2026-11-24', true), v('v1125', '2026-11-25', true),
    { id: 'sac', baslik: 'Saç kesimi', tarih: '2026-11-14', saat: '16:00', gorsel: 'yildiz', renk: 'kum', bitti: true, not: '', fotolar: [], baglantilar: [], hatirlatmalar: [] },
    { id: 'muayene', baslik: 'Araç muayenesi', tarih: '2026-11-20', saat: '11:00', gorsel: 'araba', renk: 'kobalt', bitti: true, not: 'Ruhsat ve sigorta poliçesi yanında olsun.', fotolar: [], baglantilar: [], hatirlatmalar: ['1 gün önce'] },
  ];
}
const D = { kayitlar: ornekVeri(), secili: BUGUN, ay: { y: 2026, m: 10 } };
const kayit = (id) => D.kayitlar.find((k) => k.id === id);
const siraNo = (k) => (k.saat ? 2000 + dk(k.saat) : k.bolum ? 1000 + BOLUM_SIRA.indexOf(k.bolum) : 0);
const sirala = (l) => [...l].sort((a, b) => siraNo(a) - siraNo(b));
const gunun = (t) => sirala(D.kayitlar.filter((k) => k.tarih && (k.tarih === t || (k.bitisTarih && k.tarih <= t && t <= k.bitisTarih))));
const tarihsiz = () => D.kayitlar.filter((k) => !k.tarih);
const zamanMetni = (k) => (k.saat ? (k.bitis ? `${k.saat}–${k.bitis}` : k.saat) : k.bolum ? BOLUM[k.bolum] : k.bitisTarih ? `${T(k.tarih).getDate()}–${T(k.bitisTarih).getDate()} ${AYLAR[T(k.tarih).getMonth()]}` : k.tarih ? 'gün boyu' : 'tarihsiz');
const turAdi = (k) => (k.saat ? 'Randevu' : k.tarih ? 'Gün kaydı' : 'Yapılacak');
function oner(baslik) {
  const s = kucuk(baslik);
  const K = [[/araba|oto|yıka|muayene|lastik/, 'araba', 'kobalt'], [/diş|dişçi/, 'dis', 'pembe'], [/market|alışveriş|bakkal|pazar/, 'sepet', 'hardal'], [/vardiya|imza|toplantı|iş yeri|mesai/, 'imza', 'cam'], [/kargo|paket|koli|hediye/, 'kutu', 'domates'], [/ilaç|eczane|vitamin/, 'ilac', 'gok'], [/kahve|kahvaltı|çay/, 'fincan', 'hardal'], [/fatura|kira|ödeme|aidat/, 'fatura', 'gece'], [/gezi|kamp|tatil|yürüyüş/, 'cadir', 'gece']];
  const e = K.find((x) => x[0].test(s));
  return e ? { gorsel: e[1], renk: e[2] } : { gorsel: 'yildiz', renk: 'kum' };
}
let sayac = 0;
function yeniKayit(baslik, zaman) {
  const k = { id: 'y' + (++sayac), baslik, not: '', fotolar: [], baglantilar: [], hatirlatmalar: [], ...oner(baslik), ...zaman };
  if (k.saat) k.hatirlatmalar = ['30 dk önce'];
  D.kayitlar.push(k);
  return k;
}
const kayitSil = (id) => { D.kayitlar = D.kayitlar.filter((k) => k.id !== id); };

/* ---- simgeler (24'lük çizgi) ---- */
const IK = {
  araba: '<path d="M3 13.5l1.7-4.2A2 2 0 0 1 6.6 8h8.2a2 2 0 0 1 1.6.8l2.4 3.2 2 .6a1.5 1.5 0 0 1 1.2 1.5V16a1 1 0 0 1-1 1h-1.6M3 13.5V16a1 1 0 0 0 1 1h.6M9.6 17h4.8"/><circle cx="7.2" cy="17" r="2.2"/><circle cx="16.8" cy="17" r="2.2"/>',
  dis: '<path d="M7.6 3.5c1.7 0 2.6 1 4.4 1s2.7-1 4.4-1C18.6 3.5 20 5.3 20 7.7c0 2.6-1.2 4-1.7 6.8-.4 2.4-.7 6-2.3 6-1.7 0-1.2-5-4-5s-2.3 5-4 5c-1.6 0-1.9-3.6-2.3-6C5.2 11.700 4 10.300 4 7.700 4 5.300 5.400 3.500 7.600 3.500z"/>',
  sepet: '<path d="M4 9.500h16l-1.500 8.700a2 2 0 0 1-2 1.800H7.500a2 2 0 0 1-2-1.800L4 9.500zM8 9.500l3-5.500M16 9.500L13 4M9.500 13v3.500M14.500 13v3.500"/>',
  imza: '<path d="M6.500 5.500h11v15h-11zM9.500 3.500h5v3.500h-5zM9 16.500c.8-1.800 1.500-2.300 2-1.200.5 1 .9 1.500 1.700.300.6-1 1.200-.9 2.300.300"/><path d="M9.500 10.500h5"/>',
  kutu: '<path d="M3.500 8L12 3.500 20.500 8v8.500L12 21l-8.500-4.500V8zM3.500 8l8.500 4.500L20.500 8M12 12.500V21"/>',
  ilac: '<path d="M7.200 16.800a4.200 4.200 0 0 1 0-6l3.600-3.600a4.200 4.200 0 0 1 6 6l-3.600 3.600a4.200 4.200 0 0 1-6 0zM9 9l6 6"/>',
  fincan: '<path d="M5 9.500h11v4.500a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5V9.500zM16 11h1.500a2.500 2.500 0 0 1 0 5H16M8.500 6c0-1 1-1 1-2.200M12.500 6c0-1 1-1 1-2.200"/>',
  fatura: '<path d="M6.500 3.500h11v17l-2.200-1.500-2.200 1.500-1.100-.800-1.100.800-2.200-1.500-2.200 1.500v-17zM9.500 8.500h5M9.500 12.500h5"/>',
  cadir: '<path d="M3 19.500L12 5l9 14.500H3zM12 5v14.500M12 12l-3.500 7.500"/>',
  yildiz: '<circle cx="12" cy="12" r="3.200"/><path d="M12 3.500v3M12 17.500v3M3.500 12h3M17.500 12h3M6 6l2 2M16 16l2 2M6 18l2-2M16 8l2-2"/>',
  arti: '<path d="M12 5v14M5 12h14"/>',
  tik: '<path d="M5 12.500l4.500 4.500L19 7.500"/>',
  geri: '<path d="M14.500 5.500L8 12l6.500 6.500"/>',
  ileri: '<path d="M9.500 5.500L16 12l-6.500 6.500"/>',
  asagi: '<path d="M5.500 9.500L12 16l6.500-6.500"/>',
  yukari: '<path d="M5.500 14.500L12 8l6.500 6.500"/>',
  kapat: '<path d="M6 6l12 12M18 6L6 18"/>',
  takvim: '<path d="M4.500 6.500h15v13h-15zM4.500 10.500h15M8.500 4v4M15.500 4v4"/>',
  gun: '<path d="M5 7h14M5 12h14M5 17h9"/>',
  harita: '<path d="M12 21s6.500-5.800 6.500-11a6.500 6.500 0 1 0-13 0c0 5.200 6.500 11 6.500 11z"/><circle cx="12" cy="10" r="2.300"/>',
  belge: '<path d="M7 3.500h7l4 4v13H7zM14 3.500v4h4M9.500 12.500h5M9.500 16h5"/>',
  zil: '<path d="M6.500 16.500V11a5.500 5.500 0 0 1 11 0v5.500l1.500 2h-14l1.500-2zM10.300 20.500a1.800 1.800 0 0 0 3.400 0"/>',
  foto: '<path d="M4 7.500h3.500l1.500-2h6l1.500 2H20V19H4z"/><circle cx="12" cy="13" r="3.300"/>',
  gunes: '<circle cx="12" cy="12" r="4"/><path d="M12 2.500v2.500M12 19v2.500M2.500 12H5M19 12h2.500M5.300 5.300l1.800 1.800M16.900 16.900l1.800 1.800M5.300 18.700l1.800-1.800M16.900 7.100l1.800-1.800"/>',
  ay: '<path d="M19.500 14.200A8 8 0 0 1 9.800 4.500a8 8 0 1 0 9.700 9.700z"/>',
};
const ik = (ad) => `<svg class="ik" viewBox="0 0 24 24" aria-hidden="true">${IK[ad] || IK.yildiz}</svg>`;
const TIK_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.500l4.500 4.500L19 7.500"/></svg>`;

/* ---- büyük çizimler (Sahne) ---- */
const RESIM = {
  araba: `<rect class="rs-zemin" x="20" y="137" width="200" height="5" rx="2.500"/>
    <g class="rs-kopuk"><circle cx="50" cy="52" r="9"/><circle cx="68" cy="34" r="5"/><circle cx="190" cy="42" r="7"/><circle cx="206" cy="62" r="4"/><circle cx="122" cy="24" r="6"/></g>
    <g class="rs-govde"><path class="pf" d="M28 118v-16q0-11 11-13l24-5 21-27q6-8 16-8h46q10 0 16 8l20 27 21 5q11 3 11 14v15q0 6-6 6H34q-6 0-6-6z"/>
    <path class="pl" d="M93 82l14-19q3-4 8-4h11v23z"/><path class="pl" d="M134 59h10q5 0 8 4l14 19h-32z"/>
    <rect class="pd" x="138" y="92" width="14" height="4" rx="2"/><rect class="pl" x="201" y="94" width="10" height="9" rx="3"/><rect class="pd" x="28" y="96" width="6" height="10" rx="2"/></g>
    <g><circle class="pd" cx="78" cy="122" r="17"/><circle class="pl" cx="78" cy="122" r="6.500"/></g>
    <g><circle class="pd" cx="170" cy="122" r="17"/><circle class="pl" cx="170" cy="122" r="6.500"/></g>`,
  dis: `<path class="pf" d="M84 36q18-14 36-2 18-12 36 2 16 14 6 46-6 18-9 40-3 16-12 2-6-22-21-22t-21 22q-9 14-12-2-3-22-9-40-10-32 6-46z"/>
    <path class="ps" d="M97 54q-7 9-3 24"/>
    <path class="pf rs-pirilti" d="M192 28q2 11 13 13-11 2-13 13-2-11-13-13 11-2 13-13z"/>
    <path class="pf rs-pirilti" d="M50 88q1.500 7 8 8-6.500 1-8 8-1.500-7-8-8 6.500-1 8-8z"/>`,
  sepet: `<rect class="pl" x="92" y="28" width="18" height="72" rx="9" transform="rotate(-14 101 64)"/>
    <path class="pd" d="M132 88V52q0-6 4-9v-10h10v10q4 3 4 9v36z"/>
    <circle class="pl" cx="168" cy="72" r="13"/>
    <path class="ps2" d="M82 84q38-60 76 0"/>
    <path class="pf" d="M62 84h116l-11 46q-2 10-12 10H85q-10 0-12-10z"/>
    <rect class="pd" x="56" y="78" width="128" height="13" rx="6.500"/>
    <path class="ps3" d="M96 102v26M120 102v26M144 102v26"/>`,
  imza: `<rect class="pf" x="70" y="20" width="100" height="128" rx="12"/>
    <rect class="pl" x="80" y="36" width="80" height="102" rx="5"/>
    <rect class="pd" x="100" y="12" width="40" height="20" rx="7"/>
    <rect class="pb2" x="90" y="52" width="58" height="6" rx="3"/><rect class="pb2" x="90" y="68" width="40" height="6" rx="3"/><rect class="pb2" x="90" y="84" width="50" height="6" rx="3"/>
    <path class="rs-imza-cizgi" pathLength="100" d="M90 124q7-20 13-5 4 11 10-6 4-11 8 4 3 9 9-2 5-9 9 2 3 6 9 0"/>
    <g class="rs-kalem"><path class="pd" d="M189 69l10 10-34 34-13 3 3-13z"/></g>`,
  kutu: `<path class="pf" d="M64 62l56-24 56 24v60l-56 24-56-24z"/>
    <path class="pd" opacity=".28" d="M120 86v60l56-24V62z"/>
    <path class="pl" d="M64 62l56 24 56-24-56-24z"/>
    <path class="pd" opacity=".5" d="M88 51.700l56 24v18l8-3.400v-18l-56-24z"/>`,
  ilac: `<g transform="rotate(-32 120 84)"><rect class="pl" x="56" y="58" width="128" height="52" rx="26"/><path class="pf" d="M120 58h38a26 26 0 0 1 0 52h-38z"/><rect class="pd" opacity=".16" x="74" y="68" width="34" height="7" rx="3.500"/></g>
    <path class="pf rs-pirilti" d="M190 22h10v10h10v10h-10v10h-10V42h-10V32h10z"/>`,
  fincan: `<path class="ps2 rs-buhar" d="M100 46q-8-10 0-22M126 46q-8-10 0-22"/>
    <path class="pf" d="M68 62h104v32q0 36-36 36h-32q-36 0-36-36z"/>
    <path class="ps2" d="M172 74h6q16 0 16 15t-16 15h-8"/>
    <rect class="pd" x="56" y="136" width="128" height="8" rx="4"/>`,
  fatura: `<path class="pl" d="M78 18h84v122l-14-9-14 9-14-9-14 9-14-9-14 9z"/>
    <path class="pf" d="M127 40l-24 36h17l-9 32 28-40h-17z"/>`,
  cadir: `<circle class="pf" cx="182" cy="42" r="15"/>
    <path class="pl" d="M36 134l84-100 84 100z"/><path class="pd" opacity=".8" d="M120 34l-24 100h48z"/>
    <rect class="pd" x="24" y="132" width="192" height="6" rx="3"/>`,
  yildiz: `<circle class="pf" cx="120" cy="80" r="34"/>
    <path class="ps2" d="M120 22v14M120 124v14M62 80h14M164 80h14M79 39l10 10M151 111l10 10M79 121l10-10M151 49l10-10"/>`,
};
const resim = (ad) => `<svg class="rs rs-${RESIM[ad] ? ad : 'yildiz'}" viewBox="0 0 240 160" aria-hidden="true">${RESIM[ad] || RESIM.yildiz}</svg>`;

/* ---- fotoğraf yerine geçen çizimler (dış servis yok) ---- */
const FOTO = {
  araba: `<rect width="160" height="120" fill="url(#g-gok)"/>
    <g filter="url(#f-bulanik)"><rect x="-4" y="20" width="56" height="62" fill="#878d94"/><rect x="50" y="34" width="46" height="48" fill="#aaa699"/><rect x="94" y="12" width="70" height="70" fill="#737a85"/>
    <g fill="#c9d3da" opacity=".7"><rect x="6" y="30" width="8" height="10"/><rect x="22" y="30" width="8" height="10"/><rect x="6" y="48" width="8" height="10"/><rect x="104" y="24" width="9" height="12"/><rect x="122" y="24" width="9" height="12"/><rect x="140" y="24" width="9" height="12"/><rect x="104" y="46" width="9" height="12"/><rect x="140" y="46" width="9" height="12"/></g></g>
    <rect y="80" width="160" height="40" fill="#3b3e44"/><rect y="80" width="160" height="3" fill="#bdb9ac"/>
    <ellipse cx="80" cy="104" rx="58" ry="5" fill="#1b1c1f" opacity=".6"/>
    <g transform="translate(17 39) scale(.52)"><path fill="#1f3f9f" d="M28 118v-16q0-11 11-13l24-5 21-27q6-8 16-8h46q10 0 16 8l20 27 21 5q11 3 11 14v15q0 6-6 6H34q-6 0-6-6z"/><path fill="#9cc2dc" d="M93 82l14-19q3-4 8-4h11v23zM134 59h10q5 0 8 4l14 19h-32z"/><path fill="#fff" opacity=".22" d="M40 92l150 0 14 4H36z"/><circle cx="78" cy="122" r="17" fill="#15161a"/><circle cx="78" cy="122" r="7" fill="#9aa0a8"/><circle cx="170" cy="122" r="17" fill="#15161a"/><circle cx="170" cy="122" r="7" fill="#9aa0a8"/></g>`,
  cizik: `<rect width="160" height="120" fill="url(#g-boya)"/>
    <path d="M-10 30Q60 10 170 44" stroke="#fff" stroke-width="16" opacity=".16" fill="none" filter="url(#f-bulanik)"/>
    <path d="M104 -4q-6 60 4 128" stroke="#0b1a52" stroke-width="2.500" fill="none" opacity=".8"/>
    <path d="M30 78l18-5 14 3 20-7 16 2" stroke="#e9eefc" stroke-width="1.400" fill="none" stroke-linecap="round"/>
    <path d="M36 84l22-4 12 2" stroke="#e9eefc" stroke-width=".8" fill="none" stroke-linecap="round" opacity=".8"/>
    <rect x="118" y="58" width="26" height="7" rx="3.500" fill="#0b1a52" opacity=".7"/>`,
  form: `<rect width="160" height="120" fill="url(#g-masa)"/>
    <g transform="rotate(-7 80 60)"><rect x="34" y="10" width="92" height="112" fill="#f6f4ee"/><rect x="42" y="20" width="50" height="7" fill="#2c2f36"/>
    <g stroke="#9a9ca3" stroke-width=".8"><path d="M42 36h76M42 46h76M42 56h76M42 66h76M42 76h76M42 86h76M42 96h76M68 36v60M94 36v60"/></g>
    <g stroke="#27408f" stroke-width="1.200" fill="none" stroke-linecap="round"><path d="M46 42l4 2 6-5M46 52l4 2 6-5M46 72l4 2 6-5"/><path d="M72 62h14M98 42h12M98 82h10"/></g></g>
    <rect x="128" y="70" width="8" height="52" rx="4" fill="#20232a" transform="rotate(18 132 96)"/>`,
  kapi: `<rect width="160" height="120" fill="#c8b9a2"/>
    <rect width="160" height="120" fill="url(#g-golge)" opacity=".5"/>
    <rect x="48" y="16" width="64" height="94" fill="#2a2d33"/><rect x="53" y="21" width="25" height="89" fill="url(#g-cam)"/><rect x="82" y="21" width="25" height="89" fill="url(#g-cam)"/>
    <rect x="74" y="60" width="3" height="16" fill="#d9dadc"/><rect x="83" y="60" width="3" height="16" fill="#d9dadc"/>
    <rect x="120" y="40" width="26" height="16" fill="#f1efe8"/><rect x="124" y="45" width="18" height="2" fill="#555"/><rect x="124" y="50" width="12" height="2" fill="#555"/>
    <rect y="110" width="160" height="10" fill="#8d8375"/><rect x="40" y="106" width="80" height="5" fill="#a59a8a"/>`,
  liste: `<rect width="160" height="120" fill="#dfe3e6"/><rect width="160" height="120" fill="url(#g-golge)" opacity=".35"/>
    <g transform="rotate(4 80 60)"><rect x="44" y="14" width="74" height="92" fill="#f7e27a"/><rect x="44" y="14" width="74" height="10" fill="#e9d163"/>
    <g stroke="#3a3f55" stroke-width="1.500" fill="none" stroke-linecap="round"><path d="M54 36q6-4 10 0t10 0 8 1"/><path d="M54 48q8-3 14 0t16-1"/><path d="M54 60q5-4 9 0t9 0"/><path d="M54 72q9-3 16 0t18 0 8-1"/><path d="M54 84q6-3 11 0t10 0"/></g></g>
    <circle cx="84" cy="14" r="7" fill="#c93a22"/>`,
};
const FOTO_AD = { araba: 'Araba, sokakta park hâlinde', cizik: 'Kapıdaki çizik, yakından', form: 'Sayım formu', kapi: 'İş yeri girişi', liste: 'Alışveriş listesi' };
function fotoHTML(f) {
  if (typeof f === 'object') return `<img class="ft" src="${f.url}" alt="Eklediğin fotoğraf">`;
  return `<svg class="ft" viewBox="0 0 160 120" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${FOTO_AD[f] || 'Fotoğraf'}">${FOTO[f] || ''}<rect width="160" height="120" filter="url(#f-gren)" opacity=".55"/></svg>`;
}
function fotoSec() {
  return new Promise((coz) => {
    const g = $('#foto-sec');
    g.value = '';
    g.onchange = () => {
      const d = g.files && g.files[0];
      if (!d) return coz(null);
      const o = new FileReader();
      o.onload = () => coz({ url: o.result });
      o.onerror = () => coz(null);
      o.readAsDataURL(d);
    };
    g.click();
  });
}

/* ---- tost, ışık kutusu, kapatma yığını ---- */
const app = () => $('#app');
let tostZaman = 0;
function tost(metin, eylem) {
  $$('.tost', app()).forEach((t) => t.remove());
  const t = el(`<div class="tost" role="status"><span>${esc(metin)}</span>${eylem ? `<button type="button">${esc(eylem.ad)}</button>` : ''}</div>`);
  if (eylem) $('button', t).onclick = () => { t.remove(); eylem.yap(); };
  app().append(t);
  an(t, [{ opacity: 0, transform: 'translateX(-50%) translateY(12px)' }, { opacity: 1, transform: 'translateX(-50%) translateY(0)' }], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' });
  clearTimeout(tostZaman);
  tostZaman = setTimeout(() => { an(t, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' }).finished.then(() => t.remove()); }, eylem ? 4200 : 2200);
}
const yigin = [];
const yiginEkle = (f) => { yigin.push(f); return f; };
const yiginCikar = (f) => { const i = yigin.indexOf(f); if (i >= 0) yigin.splice(i, 1); };
addEventListener('keydown', (e) => { if (e.key === 'Escape' && yigin.length) { e.preventDefault(); yigin[yigin.length - 1](); } });
function fotoAc(kaynak, f) {
  const r = kaynak.getBoundingClientRect();
  const k = el(`<div class="isik" role="dialog" aria-label="Fotoğraf"><div class="isik-ic">${fotoHTML(f)}</div><button class="isik-kapat" type="button" aria-label="Kapat">${ik('kapat')}</button></div>`);
  app().append(k);
  const ic = $('.isik-ic', k), h = ic.getBoundingClientRect();
  const ilk = { transformOrigin: '0 0', transform: `translate(${r.left - h.left}px,${r.top - h.top}px) scale(${r.width / h.width},${r.height / h.height})` };
  an(k, [{ backgroundColor: 'transparent' }, {}], { duration: 260 });
  an(ic, [ilk, { transformOrigin: '0 0', transform: 'none' }], { duration: 340, easing: 'cubic-bezier(.2,.8,.2,1)' });
  const kapat = yiginEkle(() => {
    yiginCikar(kapat);
    an(k, [{}, { backgroundColor: 'transparent' }], { duration: 220, fill: 'forwards' });
    an(ic, [{ transformOrigin: '0 0', transform: 'none' }, ilk], { duration: 240, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' }).finished.then(() => k.remove());
  });
  k.onclick = kapat;
}
const baglantiTost = (b) => tost(b.tip === 'harita' ? 'Uygulamada harita açılır' : 'Uygulamada belge açılır');
