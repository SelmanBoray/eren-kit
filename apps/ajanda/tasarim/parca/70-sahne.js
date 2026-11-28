/* ============ SAHNE ============ */
YON.sahne = (() => {
  const YAY = 'cubic-bezier(.34,1.45,.55,1)', YUM = 'cubic-bezier(.2,.8,.2,1)';
  let kok, gor = 'bugun';
  const fotoKapak = (k) => k.kapak === 'foto' && k.fotolar.length > 0;
  const kapak = (k) => (fotoKapak(k) ? fotoHTML(k.fotolar[0]) : resim(k.gorsel));
  const tikD = (k) => `<button class="s-tik ${k.bitti ? 'oldu' : ''}" data-a="bitir" aria-pressed="${!!k.bitti}" aria-label="${k.bitti ? 'Geri al' : 'Tamamla'}: ${esc(k.baslik)}">${TIK_SVG}</button>`;
  const HARITA = `<svg viewBox="0 0 84 84" aria-hidden="true"><rect width="84" height="84" fill="var(--pl)"/><path d="M-4 30h92M-4 64h62M26-4v92M60 22v70M38 30l32-36" stroke="var(--pb)" stroke-width="7" opacity=".4" fill="none"/><circle class="s-halka" cx="52" cy="46" r="20" fill="var(--pd)"/><circle cx="52" cy="46" r="7" fill="var(--pd)"/></svg>`;
  const bagResim = (tip) => (tip === 'harita'
    ? `<svg viewBox="0 0 120 56" aria-hidden="true"><rect width="120" height="56" fill="var(--s-line)"/><path d="M-4 18h128M-4 44h70M30-4v64M90 10v50M50 18l34-24" stroke="var(--s-bg)" stroke-width="6" fill="none"/><path d="M72 28c0-7-5-11-10-11s-10 4-10 11c0 8 10 16 10 16s10-8 10-16z" fill="var(--s-ink)"/><circle cx="62" cy="28" r="3.500" fill="var(--s-bg)"/></svg>`
    : `<svg viewBox="0 0 120 56" aria-hidden="true"><rect width="120" height="56" fill="var(--s-line)"/><rect x="34" y="9" width="52" height="56" rx="4" fill="var(--s-bg)"/><path d="M43 21h26M43 31h34M43 41h34M43 51h20" stroke="var(--s-soft)" stroke-width="3" stroke-linecap="round"/></svg>`);

  function plaka(k, tip, canli) {
    return `<article class="s-p s-p--${tip} r-${k.renk} ${k.taslak ? 'eskiz' : ''} ${k.bitti ? 'bitti' : ''} ${fotoKapak(k) ? 'kapak-foto' : ''} ${canli ? 'canli' : ''}" data-id="${k.id}">
      <div class="s-p-resim">${kapak(k)}</div>
      <button class="s-p-ac" data-a="ac"><b>${esc(k.baslik)}</b><span>${k.taslak ? 'Asistan önerdi, ' : ''}${zamanMetni(k)}${k.bolge ? ` @ ${esc(k.bolge)}` : ''}</span></button>
      ${k.taslak ? '<div class="s-p-onay"><button data-a="onayla">Onayla</button><button data-a="sil">Vazgeç</button></div>' : tikD(k)}
    </article>`;
  }

  function kur(root) {
    kok = root; gor = 'bugun';
    kok.innerHTML = `<div class="s-ekran">
      <div class="s-sayfa s-bugun"></div><div class="s-sayfa s-takvim" hidden></div>
      <nav class="s-alt" aria-label="Görünüm"><i class="s-alt-leke"></i><button data-a="gor" data-g="bugun" aria-current="page">${ik('gun')}<span>Bugün</span></button><button class="s-arti" data-a="ekle" aria-label="Yeni kayıt">${ik('arti')}</button><button data-a="gor" data-g="takvim">${ik('takvim')}<span>Takvim</span></button></nav>
    </div>`;
    bugunCiz(); altLeke();
    kok.onclick = tik;
    acilis();
  }
  function altLeke() {
    const b = $(`.s-alt [data-g="${gor}"]`, kok), l = $('.s-alt-leke', kok);
    l.style.width = b.offsetWidth + 'px'; l.style.transform = `translateX(${b.offsetLeft}px)`;
    $$('.s-alt [data-g]', kok).forEach((x) => (x === b ? x.setAttribute('aria-current', 'page') : x.removeAttribute('aria-current')));
  }
  function acilis() {
    an($('.s-bas', kok), [{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'none' }], { duration: 460, easing: YUM });
    $$('.s-mozaik > *', kok).forEach((p, i) => an(p, [{ opacity: 0, transform: 'translateY(46px) scale(.88) rotate(-2.5deg)' }, { opacity: 1, transform: 'none' }], { duration: 620, delay: 140 + i * 90, easing: YAY }));
    an($('.s-alt', kok), [{ transform: 'translateX(-50%) translateY(96px)' }, { transform: 'translateX(-50%) translateY(0)' }], { duration: 560, delay: 380, easing: YAY });
  }

  function bugunCiz() {
    const l = gunun(BUGUN), acik = l.filter((k) => !k.bitti && !k.taslak), taslak = l.filter((k) => k.taslak), biten = l.filter((k) => k.bitti);
    const sira = acik.find((k) => k.saat && dk(k.saat) >= dk(SIMDI)) || acik[0], diger = acik.filter((k) => k !== sira);
    let bas, alt;
    if (sira && sira.saat && dk(sira.saat) >= dk(SIMDI)) { const f = dk(sira.saat) - dk(SIMDI); bas = `Sırada ${kucuk(sira.baslik)} var.`; alt = `${f < 60 ? f + ' dakika' : Math.round(f / 60) + ' saat'} sonra, ${sira.saat}`; }
    else if (sira) { bas = `Sırada ${kucuk(sira.baslik)} var.`; alt = `Bugün, ${zamanMetni(sira)}`; }
    else { bas = 'Bugünlük bu kadar.'; alt = biten.length ? `${biten.length} iş bitti.` : 'Yeni bir şey eklemek için artıya dokun.'; }
    const ts = tarihsiz();
    $('.s-bugun', kok).innerHTML = `<header class="s-bas"><p class="s-tarih">${uzunTarih(BUGUN)}</p><h1 class="s-selam">${esc(bas)}</h1><p class="s-selam-alt">${esc(alt)}</p></header>
      <div class="s-mozaik">${sira ? plaka(sira, 'buyuk', true) : ''}${diger.map((k, i) => plaka(k, diger.length % 2 && i === diger.length - 1 ? 'genis' : 'kare')).join('')}${taslak.map((k) => plaka(k, 'genis')).join('')}</div>
      ${biten.length ? `<h2 class="s-ara">Bitenler</h2><div class="s-biten">${biten.map((k) => `<button class="s-b r-${k.renk}" data-id="${k.id}" data-a="ac"><i>${ik('tik')}</i><span>${esc(k.baslik)}</span></button>`).join('')}</div>` : ''}
      <h2 class="s-ara">Tarihi olmayanlar</h2>
      <div class="s-serbest">${ts.length ? ts.map((k) => `<article class="s-s r-${k.renk} ${k.bitti ? 'bitti' : ''}" data-id="${k.id}"><span class="s-s-r">${resim(k.gorsel)}</span><button class="s-s-ad" data-a="ac">${esc(k.baslik)}</button>${tikD(k)}</article>`).join('') : '<p class="s-bos">Tarihsiz iş yok.</p>'}</div>`;
  }
  function dizAnim(ciz) {
    const sayfa = $(`.s-${gor}`, kok);
    const once = new Map($$('[data-id]', sayfa).map((e) => [e.dataset.id, e.getBoundingClientRect()]));
    ciz();
    $$('[data-id]', sayfa).forEach((e) => {
      const o = once.get(e.dataset.id), n = e.getBoundingClientRect();
      if (!o) return an(e, [{ opacity: 0, transform: 'scale(.5) rotate(-6deg)' }, { opacity: 1, transform: 'none' }], { duration: 560, easing: YAY });
      if (Math.abs(o.left - n.left) < 1 && Math.abs(o.top - n.top) < 1 && Math.abs(o.width - n.width) < 1) return;
      an(e, [{ transformOrigin: '0 0', transform: `translate(${o.left - n.left}px,${o.top - n.top}px) scale(${o.width / n.width},${o.height / n.height})` }, { transformOrigin: '0 0', transform: 'none' }], { duration: 560, easing: 'cubic-bezier(.3,1.25,.45,1)' });
    });
    an($('.s-bas', sayfa), [{ opacity: .3 }, { opacity: 1 }], { duration: 400 });
  }
  const ciz = () => (gor === 'bugun' ? bugunCiz() : takvimCiz());
  const yenile = () => dizAnim(ciz);

  async function bitir(id, s) {
    const k = kayit(id);
    if (s._mesgul) return;
    if (k.bitti) { k.bitti = false; return yenile(); }
    s._mesgul = true;
    const t = $('.s-tik', s);
    if (t) { t.classList.add('oldu'); an(t, [{ transform: 'scale(.6)' }, { transform: 'scale(1)' }], { duration: 460, easing: YAY }); }
    if (s.classList.contains('s-p')) { s.classList.add('yikaniyor', 'patla'); await bekle(720); } else await bekle(300);
    k.bitti = true;
    yenile();
    tost(`Bitti: ${k.baslik}`, { ad: 'Geri al', yap: () => { k.bitti = false; yenile(); } });
  }
  async function onayla(id, s) {
    const k = kayit(id); k.taslak = false;
    s.classList.remove('eskiz');
    const o = $('.s-p-onay', s); if (o) an(o, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' });
    await bekle(900);
    yenile();
    tost('Onaylandı');
  }
  function sil(id, s) {
    const k = kayit(id);
    an(s, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.7) rotate(4deg)' }], { duration: 260, easing: 'ease-in', fill: 'forwards' }).finished.then(() => {
      kayitSil(id); yenile();
      tost('Öneriden vazgeçildi', { ad: 'Geri al', yap: () => { D.kayitlar.push(k); yenile(); } });
    });
  }

  /* ---- takvim ---- */
  function takvimCiz() {
    const { y, m } = D.ay, gunler = ayIzgarasi(y, m), sayfa = $('.s-takvim', kok);
    sayfa.innerHTML = `<header class="s-t-bas"><h1 class="s-t-ay">${AYLAR[m]}</h1><span class="s-t-yil">${y}</span><div class="s-t-ok"><button data-a="ay" data-d="-1" aria-label="Önceki ay">${ik('geri')}</button><button data-a="ay" data-d="1" aria-label="Sonraki ay">${ik('ileri')}</button></div></header>
      <div class="s-t-gunler" aria-hidden="true">${KGUN.map((x) => `<span>${x}</span>`).join('')}</div>
      <div class="s-t-izgara"><i class="s-t-leke"></i>${gunler.map((t) => { const l = gunun(t), d = T(t); return `<button class="s-g ${d.getMonth() !== m ? 'dis' : ''} ${t === BUGUN ? 'bugun' : ''}" data-a="gun" data-t="${t}" aria-label="${uzunTarih(t)}, ${l.length} kayıt"><b>${d.getDate()}</b><span class="nk">${l.slice(0, 3).map((k) => `<i class="r-${k.renk} ${k.bitti ? 'b' : ''} ${k.taslak ? 't' : ''}"></i>`).join('')}</span></button>`; }).join('')}</div>
      <section class="s-t-gun"></section>`;
    lekeKoy(false); seritCiz(false);
    const iz = $('.s-t-izgara', sayfa);
    surukle(iz, { eksen: 'x',
      tasi: (dx) => { iz.style.transform = `translateX(${dx * 0.6}px)`; },
      bitir: (dx) => { iz.style.transform = ''; if (Math.abs(dx) > 56) ayDegis(dx < 0 ? 1 : -1); else an(iz, [{ transform: `translateX(${dx * 0.6}px)` }, { transform: 'none' }], { duration: 420, easing: YAY }); } });
  }
  function lekeKoy(hareketli) {
    const leke = $('.s-t-leke', kok), h = $(`.s-g[data-t="${D.secili}"]`, kok);
    $$('.s-g.sec', kok).forEach((x) => { x.className = x.className.replace(/\s*\br-\w+/g, '').replace(/\s*\bsec\b/, ''); });
    if (!h) { leke.hidden = true; return; }
    const ilk = gunun(D.secili)[0], renk = ilk ? ilk.renk : null;
    leke.hidden = false;
    leke.className = 's-t-leke' + (renk ? ' r-' + renk : '');
    h.classList.add('sec'); if (renk) h.classList.add('r-' + renk);
    h.style.color = renk ? `var(--${renk}-i)` : '';
    $$('.s-g:not(.sec)', kok).forEach((x) => { x.style.color = ''; });
    const b = Math.min(h.offsetWidth, h.offsetHeight) - 2, eski = leke.style.transform;
    const yeni = `translate(${h.offsetLeft + (h.offsetWidth - b) / 2}px,${h.offsetTop + (h.offsetHeight - b) / 2}px)`;
    leke.style.width = leke.style.height = b + 'px'; leke.style.transform = yeni;
    if (hareketli && eski) an(leke, [{ transform: eski + ' scale(.7)' }, { transform: yeni + ' scale(1)' }], { duration: 520, easing: YAY });
  }
  function seritCiz(hareketli) {
    const l = gunun(D.secili), kutu = $('.s-t-gun', kok);
    kutu.innerHTML = `<h2>${goreli(D.secili) === uzunTarih(D.secili) ? uzunTarih(D.secili) : goreli(D.secili) + ', ' + uzunTarih(D.secili).split(', ')[1]}</h2>${l.length ? `<div class="s-serit">${l.map((k) => plaka(k, 'serit')).join('')}</div>` : '<p class="s-bos">Bu gün boş. Artıya dokunup bir şey ekle.</p>'}`;
    if (hareketli) $$('.s-p,.s-bos', kutu).forEach((p, i) => an(p, [{ opacity: 0, transform: 'translateX(60px) scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 520, delay: i * 70, easing: YAY }));
  }
  function ayDegis(d) {
    let { y, m } = D.ay; m += d; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; }
    D.ay = { y, m };
    takvimCiz();
    an($('.s-t-izgara', kok), [{ opacity: 0, transform: `translateX(${d * 70}px)` }, { opacity: 1, transform: 'none' }], { duration: 520, easing: YAY });
    an($('.s-t-ay', kok), [{ opacity: 0, transform: `translateY(${d * 24}px)` }, { opacity: 1, transform: 'none' }], { duration: 460, easing: YAY });
  }
  function gorDegis(g) {
    if (g === gor) return;
    const eski = $(`.s-${gor}`, kok), yeni = $(`.s-${g}`, kok), yon = g === 'takvim' ? 1 : -1;
    gor = g; altLeke();
    if (g === 'takvim') { D.ay = { y: T(D.secili).getFullYear(), m: T(D.secili).getMonth() }; takvimCiz(); } else bugunCiz();
    eski.hidden = true; yeni.hidden = false; yeni.scrollTop = 0;
    if (g === 'takvim') lekeKoy(false);
    an(yeni, [{ opacity: 0, transform: `translateX(${yon * 34}%)` }, { opacity: 1, transform: 'none' }], { duration: 520, easing: YAY });
  }

  /* ---- ayrıntı ---- */
  function kapakIc(k) {
    const fk = fotoKapak(k);
    return `<div class="s-a-resim ${fk ? 'foto' : ''}">${kapak(k)}</div>${fk ? `<div class="s-a-etiket">${resim(k.gorsel)}</div>` : ''}`;
  }
  function ayrHTML(k) {
    const fk = fotoKapak(k);
    const zaman = k.tarih ? `${goreli(k.tarih) === uzunTarih(k.tarih) ? uzunTarih(k.tarih) : goreli(k.tarih)}, ${zamanMetni(k)}` : 'Tarihi yok';
    return `<div class="s-ayr r-${k.renk}" role="dialog" aria-label="Kayıt ayrıntısı" data-id="${k.id}">
      <div class="s-a-kapak canli"><div class="s-a-kapak-ic">${kapakIc(k)}</div>
        <button class="s-a-kapat" data-a="kapat" aria-label="Kapat">${ik('asagi')}</button>
        ${k.fotolar.length ? `<div class="s-a-sec" role="group" aria-label="Kapak görseli"><button data-a="kapak" data-k="cizim" aria-pressed="${!fk}">Çizim</button><button data-a="kapak" data-k="foto" aria-pressed="${fk}">Fotoğraf</button></div>` : ''}
      </div>
      <div class="s-a-ic">
        <div><h2>${esc(k.baslik)}</h2><p class="s-a-zaman">${zaman}${k.taslak ? ', asistan önerdi' : ''}</p></div>
        ${k.varis ? `<div class="s-varis">${HARITA}<div><span>${esc(k.bolge)} bölgesine varınca</span><b>${esc(k.varis)}</b></div></div>` : ''}
        ${k.not ? `<section><h3>Not</h3><p class="s-a-not">${esc(k.not)}</p></section>` : ''}
        <section><h3>Fotoğraflar</h3><div class="s-gal">${k.fotolar.map((f, i) => `<button data-a="foto" data-i="${i}" aria-label="Fotoğrafı büyüt">${fotoHTML(f)}</button>`).join('')}<button class="s-gal-ekle" data-a="foto-ekle">${ik('foto')}Fotoğraf ekle</button></div></section>
        ${k.baglantilar.length ? `<section><h3>Bağlantılar</h3><div class="s-bag">${k.baglantilar.map((b, i) => `<button data-a="baglanti" data-i="${i}">${bagResim(b.tip)}<span>${esc(b.ad)}<small>${b.tip === 'harita' ? 'Harita' : 'Belge'}</small></span></button>`).join('')}</div></section>` : ''}
        ${k.hatirlatmalar.length ? `<section><h3>Hatırlatmalar</h3><ul class="s-hat">${k.hatirlatmalar.map((h) => `<li>${ik('zil')}${esc(h)}</li>`).join('')}${k.varis ? `<li>${ik('harita')}Varınca</li>` : ''}</ul></section>` : ''}
      </div>
      ${k.taslak ? '' : `<div class="s-a-alt"><button data-a="bitir-a" aria-pressed="${!!k.bitti}">${k.bitti ? 'Bitti, geri al' : 'Bitti'}</button></div>`}
    </div>`;
  }
  function ac(id, s) {
    const k = kayit(id), ekran = $('.s-ekran', kok), o = el(ayrHTML(k));
    ekran.append(o);
    const er = ekran.getBoundingClientRect(), r = s && s.getBoundingClientRect(), kp = $('.s-a-kapak', o), kr = kp.getBoundingClientRect();
    an(o, [{ backgroundColor: 'transparent' }, {}], { duration: 320 });
    if (r && r.width) an(kp, [{ transformOrigin: '0 0', transform: `translate(${r.left - kr.left}px,${r.top - kr.top}px) scale(${r.width / kr.width},${r.height / kr.height})`, borderRadius: '40px' }, { transformOrigin: '0 0', transform: 'none', borderRadius: '0 0 34px 34px' }], { duration: 560, easing: 'cubic-bezier(.3,1.2,.4,1)' });
    else an(kp, [{ transform: 'translateY(-100%)' }, { transform: 'none' }], { duration: 440, easing: YUM });
    $$('.s-a-ic > *', o).forEach((b, i) => an(b, [{ opacity: 0, transform: 'translateY(40px)' }, { opacity: 1, transform: 'none' }], { duration: 560, delay: 140 + i * 60, easing: YAY }));
    an($('.s-a-alt', o), [{ opacity: 0, transform: 'translateY(30px)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: 360, easing: YAY });
    const kapat = yiginEkle(() => {
      yiginCikar(kapat);
      if (o._kirli) ciz();
      const hedef = $(`.s-${gor} [data-id="${id}"]`, kok), h = hedef && hedef.getBoundingClientRect(), m = getComputedStyle(o).transform;
      const son = h && h.width ? { transformOrigin: '0 0', transform: `translate(${h.left - er.left}px,${h.top - er.top}px) scale(${h.width / er.width},${h.height / er.height})`, opacity: 0, borderRadius: '80px' } : { transformOrigin: '0 0', transform: `translate(0px,${er.height}px) scale(1,1)`, opacity: 1, borderRadius: '0px' };
      o.style.overflow = 'hidden';
      an(o, [{ transformOrigin: '0 0', transform: m === 'none' ? 'translate(0px,0px) scale(1,1)' : m, opacity: 1, borderRadius: o.style.borderRadius || '0px' }, { ...son, opacity: 1, offset: .7 }, son], { duration: 380, easing: 'cubic-bezier(.4,0,.3,1)', fill: 'forwards' }).finished.then(() => o.remove());
      if (hedef) an(hedef, [{ transform: 'scale(.94)' }, { transform: 'none' }], { duration: 460, delay: 240, easing: YAY });
    });
    o._kapat = kapat;
    surukle(kp, { eksen: 'y', filtre: (e) => o.scrollTop <= 0 && !e.target.closest('button'),
      tasi: (dx, dy) => { const d = Math.max(0, dy), c = Math.max(.8, 1 - d / 1600); o.style.transformOrigin = '0 0'; o.style.transform = `translate(${((1 - c) * er.width) / 2}px,${d}px) scale(${c})`; o.style.borderRadius = Math.min(40, d / 3) + 'px'; o.style.overflow = 'hidden'; },
      bitir: (dx, dy, vx, vy) => { if (dy > 110 || vy > 0.6) return kapat(); const m = o.style.transform; o.style.transform = ''; o.style.borderRadius = ''; o.style.overflow = ''; an(o, [{ transformOrigin: '0 0', transform: m }, { transformOrigin: '0 0', transform: 'none' }], { duration: 460, easing: YAY }); } });
  }
  function ayrTik(a, b, o) {
    const k = kayit(o.dataset.id);
    if (a === 'kapat') o._kapat();
    else if (a === 'foto') fotoAc(b, k.fotolar[+b.dataset.i]);
    else if (a === 'baglanti') baglantiTost(k.baglantilar[+b.dataset.i]);
    else if (a === 'kapak') {
      k.kapak = b.dataset.k; o._kirli = true;
      $$('.s-a-sec button', o).forEach((x) => x.setAttribute('aria-pressed', x === b));
      const ic = $('.s-a-kapak-ic', o); ic.innerHTML = kapakIc(k);
      an($('.s-a-resim', ic), [{ opacity: 0, transform: 'scale(1.12)' }, { opacity: 1, transform: 'none' }], { duration: 520, easing: YUM });
      an($('.s-a-etiket', ic), [{ transform: 'scale(0) rotate(30deg)' }, { transform: 'rotate(-6deg)' }], { duration: 560, delay: 160, easing: YAY });
    } else if (a === 'foto-ekle') fotoSec().then((f) => {
      if (!f) return;
      k.fotolar.push(f); o._kirli = true;
      const y = el(`<button data-a="foto" data-i="${k.fotolar.length - 1}" aria-label="Fotoğrafı büyüt">${fotoHTML(f)}</button>`); b.before(y);
      an(y, [{ opacity: 0, transform: 'scale(.6) rotate(8deg)' }, { opacity: 1, transform: 'rotate(-1.2deg)' }], { duration: 560, easing: YAY });
      y.scrollIntoView({ behavior: az() ? 'auto' : 'smooth', inline: 'center', block: 'nearest' });
      if (!$('.s-a-sec', o)) { k.kapak = 'cizim'; $('.s-a-kapak', o).append(el('<div class="s-a-sec" role="group" aria-label="Kapak görseli"><button data-a="kapak" data-k="cizim" aria-pressed="true">Çizim</button><button data-a="kapak" data-k="foto" aria-pressed="false">Fotoğraf</button></div>')); }
    });
    else if (a === 'bitir-a') {
      k.bitti = !k.bitti; o._kirli = true;
      b.setAttribute('aria-pressed', !!k.bitti); b.textContent = k.bitti ? 'Bitti, geri al' : 'Bitti';
      an(b, [{ transform: 'scale(.94)' }, { transform: 'none' }], { duration: 420, easing: YAY });
      if (k.bitti) { const kp = $('.s-a-kapak', o); kp.classList.remove('patla'); void kp.offsetWidth; kp.classList.add('patla'); setTimeout(() => o.isConnected && o._kapat(), az() ? 0 : 520); }
    }
  }

  /* ---- yeni kayıt ---- */
  function ekleAc(dugme) {
    const ekran = $('.s-ekran', kok), er = ekran.getBoundingClientRect(), br = dugme.getBoundingClientRect();
    const cx = br.left + br.width / 2 - er.left, cy = br.top + br.height / 2 - er.top, R = Math.hypot(er.width, er.height);
    const SAATLER = ['09:00', '12:00', '15:00', '18:00', '20:00'];
    const o = el(`<div class="s-yeni r-kum" role="dialog" aria-label="Yeni kayıt">
      <button class="s-y-kapat" type="button" data-a="yeni-kapat" aria-label="Vazgeç">${ik('kapat')}</button>
      <div class="s-y-sahne canli">${resim('yildiz')}</div>
      <form class="s-y-form" novalidate>
        <div><label for="s-baslik">Ne yapacaksın?</label><input id="s-baslik" autocomplete="off" enterkeyhint="done" placeholder="Yaz ya da aşağıdan seç"></div>
        <div class="s-y-oneri">${['Araba yıkama', 'Dişçi', 'Market', 'Kargo', 'Kahvaltı'].map((x) => `<button type="button" data-a="ornek">${x}</button>`).join('')}</div>
        <div class="s-y-tur" role="radiogroup" aria-label="Zaman türü" data-t="saatli"><i></i><button type="button" role="radio" aria-checked="true" data-a="tur" data-t="saatli">Saatli</button><button type="button" role="radio" aria-checked="false" data-a="tur" data-t="bolum">Gün içinde</button><button type="button" role="radio" aria-checked="false" data-a="tur" data-t="tarihsiz">Tarihsiz</button></div>
        <div class="s-y-ayar" role="radiogroup" aria-label="Zaman"></div>
        <button type="submit" class="s-y-ekle">Ekle</button>
      </form></div>`);
    ekran.append(o);
    let tur = 'saatli', saat = '15:00', bolum = 'aksam', gorsel = 'yildiz', renk = 'kum';
    const giris = $('#s-baslik', o), ayar = $('.s-y-ayar', o);
    const ayarCiz = () => {
      ayar.innerHTML = tur === 'saatli' ? SAATLER.map((x) => `<button type="button" role="radio" aria-checked="${x === saat}" data-a="saat" data-v="${x}">${x}</button>`).join('')
        : tur === 'bolum' ? BOLUM_SIRA.map((x) => `<button type="button" role="radio" aria-checked="${x === bolum}" data-a="bolum" data-v="${x}">${BOLUM[x]}</button>`).join('')
        : '<span>Tarih vermeden listeye girer.</span>';
      $$(':scope > *', ayar).forEach((c, i) => an(c, [{ opacity: 0, transform: 'scale(.7)' }, { opacity: 1, transform: 'none' }], { duration: 380, delay: i * 35, easing: YAY }));
    };
    const onerCiz = () => {
      const n = oner(giris.value);
      if (n.gorsel === gorsel) return;
      gorsel = n.gorsel; o.classList.remove('r-' + renk); renk = n.renk; o.classList.add('r-' + renk);
      const sahne = $('.s-y-sahne', o); sahne.innerHTML = resim(gorsel);
      an(sahne.firstElementChild, [{ opacity: 0, transform: 'scale(.4) rotate(-14deg)' }, { opacity: 1, transform: 'none' }], { duration: 620, easing: YAY });
    };
    ayarCiz();
    an(o, [{ clipPath: `circle(0px at ${cx}px ${cy}px)` }, { clipPath: `circle(${R}px at ${cx}px ${cy}px)` }], { duration: 560, easing: 'cubic-bezier(.3,.7,.2,1)' });
    an($('.s-y-sahne', o), [{ opacity: 0, transform: 'scale(.5)' }, { opacity: 1, transform: 'none' }], { duration: 620, delay: 200, easing: YAY });
    $$('.s-y-form > *', o).forEach((c, i) => an(c, [{ opacity: 0, transform: 'translateY(30px)' }, { opacity: 1, transform: 'none' }], { duration: 520, delay: 180 + i * 50, easing: YAY }));
    const kapat = yiginEkle(() => {
      yiginCikar(kapat);
      an(o, [{ clipPath: `circle(${R}px at ${cx}px ${cy}px)` }, { clipPath: `circle(0px at ${cx}px ${cy}px)` }], { duration: 380, easing: 'cubic-bezier(.5,0,.7,.3)', fill: 'forwards' }).finished.then(() => o.remove());
    });
    giris.addEventListener('input', onerCiz);
    o.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      const a = b.dataset.a;
      if (a === 'yeni-kapat') kapat();
      else if (a === 'ornek') { giris.value = b.textContent; onerCiz(); }
      else if (a === 'tur') { tur = b.dataset.t; $('.s-y-tur', o).dataset.t = tur; $$('.s-y-tur button', o).forEach((x) => x.setAttribute('aria-checked', x === b)); ayarCiz(); }
      else if (a === 'saat') { saat = b.dataset.v; $$('button', ayar).forEach((x) => x.setAttribute('aria-checked', x === b)); }
      else if (a === 'bolum') { bolum = b.dataset.v; $$('button', ayar).forEach((x) => x.setAttribute('aria-checked', x === b)); }
    });
    $('form', o).addEventListener('submit', (e) => {
      e.preventDefault();
      const ad = giris.value.trim();
      if (!ad) { giris.focus(); an(giris, [{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(7px)' }, { transform: 'none' }], 300); return; }
      const tarih = gor === 'takvim' ? D.secili : BUGUN;
      const k = yeniKayit(ad, tur === 'saatli' ? { tarih, saat } : tur === 'bolum' ? { tarih, bolum } : {});
      kapat();
      setTimeout(() => {
        yenile();
        if (gor === 'takvim') lekeKoy(false);
        const y = $(`.s-${gor} [data-id="${k.id}"]`, kok);
        if (y) y.scrollIntoView({ behavior: az() ? 'auto' : 'smooth', block: 'center', inline: 'center' });
        else tost('Tarihi olmayanlara eklendi');
      }, az() ? 0 : 240);
    });
  }

  function tik(e) {
    const b = e.target.closest('[data-a]'); if (!b || !kok.contains(b)) return;
    const a = b.dataset.a, ayr = b.closest('.s-ayr');
    if (ayr) return ayrTik(a, b, ayr);
    if (b.closest('.s-yeni')) return;
    const s = b.closest('[data-id]'), id = s && s.dataset.id;
    if (a === 'gor') gorDegis(b.dataset.g);
    else if (a === 'ac') ac(id, s);
    else if (a === 'bitir') bitir(id, s);
    else if (a === 'onayla') onayla(id, s);
    else if (a === 'sil') sil(id, s);
    else if (a === 'ekle') ekleAc(b);
    else if (a === 'ay') ayDegis(+b.dataset.d);
    else if (a === 'gun') { if (b.parentElement._surukledi) return; D.secili = b.dataset.t; lekeKoy(true); seritCiz(true); }
  }
  return { kur };
})();
