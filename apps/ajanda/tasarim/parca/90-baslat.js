/* ============ kabuk ============ */
const YONLER = {
  cetvel: {
    ad: 'Cetvel',
    fikir: 'Gün bir ölçü şeridi: saat çizgisi yerinde durur, kayıtlar zamanlarına asılır, saatsiz olanlar gün bölümünün kesikli bandında bekler.',
    hareket: 'Sönümlü ve kesin, hiçbir şey zıplamaz. Kayıt durduğu yerden açılır, bitince üstü çizilir, saat mezura kaydırılarak seçilir.',
    gorsel: 'Küçük bir çizgi simge, satırın ucunda fotoğraf karesi. Görsel süs değil, işaret.',
    android: 'Compose ile doğrudan yapılır: Canvas ölçek, paylaşılan sınır geçişi, snap’li yatay kaydırma. Pahalı yeri yok; değişken genişlikli yazı tipi uygulamaya gömülmeli.',
  },
  sahne: {
    ad: 'Sahne',
    fikir: 'Her kaydın bir resmi var: gün, sıradaki iş en büyük olacak şekilde resimli levhalardan kurulur; taslak karakalemdir, onaylanınca boyanır.',
    hareket: 'Yaylı ve oyuncu. Levha büyüyerek ayrıntıya dönüşür, aşağı çekince geri küçülür; başlığı yazarken çizim kendiliğinden gelir.',
    gorsel: 'Başlığa göre önerilen çizim ya da eklediğin fotoğraf kapak olur; ayrıntıda ikisi arasında geçilir.',
    android: 'Compose’da yapılır. Asıl maliyet çizim takımı: 20–30 vektör çizim ve anahtar sözcük tablosu. Çizimin parça parça canlanması AnimatedVectorDrawable ya da Lottie ister; karakalemden boyamaya geçiş ve dairesel açılma özel çizim kodu gerektirir.',
  },
  tabela: {
    ad: 'Tabela',
    fikir: 'Gün bir kalkış tabelası: sık satırlar, hafta şeridi hep görünür, değişen her şey kanat çevrilerek gelir.',
    hareket: 'Mekanik ve adımlı. Durum kanadı çevrilir, satırlar basamak basamak yer değiştirir, gün değişince tabela baştan aşağı döner; satırı sağa çekmek tamamlar.',
    gorsel: 'Tek renk piktogram; fotoğraflar ayrıntının Fotolar sekmesinde küçük karelerle durur.',
    android: 'En ucuz yön: düz liste ve graphicsLayer ile rotationX. Harf harf kanat çevirme çok satırda pahalılaşır, hücre başına tek çevirme yeter. Büyük yazı ayarında sık satırlar iki satıra bölünmeli.',
  },
};
const YON_SIRA = ['cetvel', 'sahne', 'tabela'];
let yon = 'sahne';

function kunyeCiz() {
  const y = YONLER[yon];
  $('#kunye-ad').textContent = y.ad;
  $('#kunye-fikir').textContent = y.fikir;
  $('#kunye-hareket').textContent = y.hareket;
  $('#kunye-gorsel').textContent = y.gorsel;
  $('#kunye-android').textContent = y.android;
}
function yonSec(y) {
  yon = y;
  const a = app();
  yigin.length = 0;
  a.className = 'app d-' + y;
  a.innerHTML = '';
  $('.yonler').dataset.y = y;
  $$('.yonler button').forEach((b) => b.setAttribute('aria-selected', b.dataset.yon === y));
  kunyeCiz();
  YON[y].kur(a);
  an(a, [{ opacity: 0 }, { opacity: 1 }], { duration: 220 });
}
function temaSimdi() {
  return document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
function temaIkon() { $('#tema').innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${temaSimdi() === 'dark' ? IK.gunes : IK.ay}</svg>`; }

$('.yonler').addEventListener('click', (e) => {
  const b = e.target.closest('[data-yon]'); if (!b || b.dataset.yon === yon) return;
  try { location.hash = b.dataset.yon; } catch (_) {}
  yonSec(b.dataset.yon);
});
$('.yonler').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const i = (YON_SIRA.indexOf(yon) + (e.key === 'ArrowRight' ? 1 : 2)) % 3;
  $('#yon-' + YON_SIRA[i]).focus(); $('#yon-' + YON_SIRA[i]).click();
});
addEventListener('hashchange', () => { const h = location.hash.slice(1); if (YON_SIRA.includes(h) && h !== yon) yonSec(h); });
$('#tema').addEventListener('click', () => { document.documentElement.dataset.theme = temaSimdi() === 'dark' ? 'light' : 'dark'; temaIkon(); });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', temaIkon);
$('#kunye-ac').addEventListener('click', (e) => { const k = $('#kunye'), acik = k.classList.toggle('acik'); e.currentTarget.setAttribute('aria-expanded', acik); e.currentTarget.textContent = acik ? 'Kapat' : 'Notlar'; });
$('#sifirla').addEventListener('click', () => { D.kayitlar = ornekVeri(); D.secili = BUGUN; D.ay = { y: 2026, m: 10 }; yonSec(yon); });

(() => {
  const h = location.hash.slice(1);
  temaIkon();
  yonSec(YON_SIRA.includes(h) ? h : 'sahne');
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { const l = $('.s-alt-leke'); if (l && yon === 'sahne') { const b = $('.s-alt [aria-current="page"]'); l.style.width = b.offsetWidth + 'px'; l.style.transform = `translateX(${b.offsetLeft}px)`; } });
})();
