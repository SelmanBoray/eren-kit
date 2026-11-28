/* ============ CETVEL ============ */
YON.cetvel = (() => {
  const B = 7, S = 23, SP = 60, YUM = 'cubic-bezier(.2,.8,.2,1)';
  const BANT = { sabah: [7, 11, 8.5], ogle: [11, 13, 11.5], ogleden_sonra: [13, 17, 14.5], aksam: [17, 21, 19], gece: [21, 23, 21.75] };
  const yy = (dakika) => (dakika / 60 - B) * SP;
  let kok, gor = 'gun';

  const altMetin = (k) => `${k.taslak ? BOLUM[k.bolum] || zamanMetni(k) : zamanMetni(k)}${k.bolge ? ` @ ${esc(k.bolge)}` : ''}${k.taslak ? ', asistan önerdi' : ''}`;
  const tikD = (k) => `<button class="c-k-tik" data-a="bitir" aria-pressed="${!!k.bitti}" aria-label="${k.bitti ? 'Geri al' : 'Tamamla'}: ${esc(k.baslik)}"><i>${TIK_SVG}</i></button>`;
  const adD = (k, alt) => `<button class="c-k-ad" data-a="ac"><span class="c-k-b"><b>${esc(k.baslik)}</b></span>${alt ? `<small>${alt}</small>` : ''}</button>`;

  function kur(root) {
    kok = root; gor = 'gun';
    kok.innerHTML = `<div class="c-ekran">
      <header class="c-bas">
        <div class="c-tarih"><div class="c-no" aria-hidden="true"></div><div class="c-aygun"><b></b><span></span></div></div>
        <div class="c-gecis" data-g="gun"><i></i><button data-a="gor" data-g="gun" aria-pressed="true">Gün</button><button data-a="gor" data-g="takvim" aria-pressed="false">Ay</button></div>
      </header>
      <div class="c-govde"><section class="c-gun" aria-label="Gün"></section><section class="c-ay" aria-label="Ay takvimi" hidden></section></div>
      <footer class="c-alt"><button class="c-cep" data-a="cep"></button><button class="c-ekle" data-a="ekle">${ik('arti')}Yeni</button></footer>
    </div>`;
    basCiz(false); gunCiz(); cepCiz();
    kok.onclick = tik;
    acilis();
  }

  function basCiz(hareketli) {
    const d = T(D.secili), no = $('.c-no', kok), yeni = iki(d.getDate()), eski = no.textContent;
    no.innerHTML = [...yeni].map((c) => `<span>${c}</span>`).join('');
    if (hareketli && eski !== yeni) $$('span', no).forEach((s, i) => { if (eski[i] !== yeni[i]) an(s, [{ transform: 'translateY(90%)' }, { transform: 'none' }], { duration: 380, delay: i * 50, easing: YUM }); });
    $('.c-aygun b', kok).textContent = AYLAR[d.getMonth()];
    $('.c-aygun span', kok).textContent = GUNLER[haftaGunu(D.secili)] + (D.secili === BUGUN ? ', bugün' : '');
  }

  function gunCiz() {
    const g = $('.c-gun', kok), t = D.secili, liste = gunun(t);
    const boyu = liste.filter((k) => !k.saat && !k.bolum), yerli = liste.filter((k) => k.saat || k.bolum);
    const konum = yerli.map((k) => ({ k, y: k.saat ? yy(dk(k.saat)) : yy(BANT[k.bolum][2] * 60) })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < konum.length; i++) { const bosluk = konum[i - 1].k.taslak ? 86 : 52; if (konum[i].y < konum[i - 1].y + bosluk) konum[i].y = konum[i - 1].y + bosluk; }
    const saatler = Array.from({ length: S - B + 1 }, (_, i) => B + i);
    const gecmisY = t < BUGUN ? (S - B) * SP + 44 : t === BUGUN ? yy(dk(SIMDI)) + 22 : 0;
    const cubuklar = yerli.map((k) => (k.saat && k.bitis ? `<div class="c-sure" style="top:${yy(dk(k.saat))}px;height:${yy(dk(k.bitis)) - yy(dk(k.saat))}px"></div>` : !k.saat ? `<div class="c-bant" style="top:${yy(BANT[k.bolum][0] * 60) + 4}px;height:${(BANT[k.bolum][1] - BANT[k.bolum][0]) * SP - 8}px"></div>` : '')).join('');
    g.innerHTML = `${boyu.length ? `<div class="c-boyu">${boyu.map((k) => `<article class="c-l ${k.bitti ? 'bitti' : ''}" data-id="${k.id}"><span class="c-l-z yumusak">${k.bitisTarih ? 'dönem' : 'gün boyu'}</span>${adD(k, k.bitisTarih ? zamanMetni(k) : '')}${tikD(k)}</article>`).join('')}</div>` : ''}
      <div class="c-cetvel" style="height:${(S - B) * SP + 1}px">
        ${gecmisY ? `<div class="c-gecmis" style="height:${gecmisY}px"></div>` : ''}
        <div class="c-olcek">${saatler.map((h) => `<span class="c-sa" style="top:${(h - B) * SP}px">${iki(h)}</span>`).join('')}</div>
        ${cubuklar}
        ${konum.map(satir).join('')}
        ${!liste.length ? `<p class="c-bos" style="top:${yy(12 * 60) - 10}px">Bu güne kayıt yok. Alttaki Yeni ile ekle.</p>` : ''}
        ${t === BUGUN ? `<div class="c-simdi" style="top:${yy(dk(SIMDI))}px"><span>şimdi ${SIMDI}</span></div>` : ''}
      </div>`;
  }
  function satir({ k, y }) {
    return `<article class="c-k ${k.bitti ? 'bitti' : ''} ${k.taslak ? 'taslak' : ''} ${k.saat ? '' : 'bolumlu'}" data-id="${k.id}" style="top:${y - 22}px">
      <span class="c-k-im"></span><span class="c-k-sim">${ik(k.gorsel)}</span>
      ${k.taslak ? `<div class="c-k-ad"><button data-a="ac"><span class="c-k-b"><b>${esc(k.baslik)}</b></span></button><small>${altMetin(k)}</small><span class="c-k-onay"><button data-a="onayla">Onayla</button><button data-a="sil">Sil</button></span></div>` : adD(k, altMetin(k))}
      ${k.fotolar.length ? `<span class="c-k-foto">${fotoHTML(k.fotolar[0])}</span>` : ''}
      ${k.taslak ? '' : tikD(k)}
    </article>`;
  }
  function cepCiz() {
    const n = tarihsiz().filter((k) => !k.bitti).length;
    $('.c-cep', kok).innerHTML = `${ik('yukari')}Cepte ${n} iş <small>tarihi yok</small>`;
  }

  function kaydirHedef() {
    const g = $('.c-gun', kok), c = $('.c-cetvel', g);
    let y = yy(9 * 60);
    if (D.secili === BUGUN) y = yy(dk(SIMDI)); else { const ilk = $('.c-k', g); if (ilk) y = parseFloat(ilk.style.top); }
    return Math.max(0, c.offsetTop + y - g.clientHeight * 0.36);
  }
  function kaydir(g, hedef, sure) {
    if (az() || !sure) { g.scrollTop = hedef; return; }
    const bas = g.scrollTop, t0 = performance.now();
    const adim = (t) => { const p = Math.min(1, (t - t0) / sure), e = 1 - Math.pow(1 - p, 4); g.scrollTop = bas + (hedef - bas) * e; if (p < 1 && g.isConnected) requestAnimationFrame(adim); };
    requestAnimationFrame(adim);
  }
  function satirGiris(gecikme) {
    $$('.c-k', kok).forEach((s, i) => {
      an($('.c-k-im', s), [{ transform: 'scaleX(0)', transformOrigin: 'left' }, { transform: 'scaleX(1)', transformOrigin: 'left' }], { duration: 300, delay: gecikme + i * 70, easing: YUM });
      $$('.c-k-sim,.c-k-ad,.c-k-foto,.c-k-tik', s).forEach((p) => an(p, [{ opacity: 0, transform: 'translateX(-10px)' }, { opacity: 1, transform: 'none' }], { duration: 340, delay: gecikme + 80 + i * 70, easing: YUM }));
    });
    $$('.c-sure', kok).forEach((c) => an(c, [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], { duration: 700, delay: gecikme + 200, easing: YUM }));
  }
  function acilis() {
    const g = $('.c-gun', kok);
    g.scrollTop = 0;
    kaydir(g, kaydirHedef(), 900);
    satirGiris(260);
    an($('.c-simdi', kok), [{ clipPath: 'inset(-20px 100% -20px 0)' }, { clipPath: 'inset(-20px 0 -20px 0)' }], { duration: 700, delay: 500, easing: YUM });
    $$('.c-no span', kok).forEach((s, i) => an(s, [{ transform: 'translateY(90%)' }, { transform: 'none' }], { duration: 480, delay: i * 70, easing: YUM }));
  }

  /* ---- ay ---- */
  function ayCiz() {
    const a = $('.c-ay', kok), { y, m } = D.ay, gunler = ayIzgarasi(y, m);
    a.innerHTML = `<div class="c-ay-bas"><h2 class="c-ay-ad">${AYLAR[m]} <span>${y}</span></h2><div class="c-ay-ok"><button data-a="ay" data-d="-1" aria-label="Önceki ay">${ik('geri')}</button><button data-a="ay" data-d="1" aria-label="Sonraki ay">${ik('ileri')}</button></div></div>
      <div class="c-ay-gunler" aria-hidden="true">${KGUN.map((x) => `<span>${x}</span>`).join('')}</div>
      <div class="c-izgara">${gunler.map((t) => { const l = gunun(t), d = T(t); return `<button class="c-h ${d.getMonth() !== m ? 'dis' : ''} ${t === BUGUN ? 'bugun' : ''}" data-a="gun" data-t="${t}" aria-label="${uzunTarih(t)}, ${l.length} kayıt"><b>${d.getDate()}</b><span class="im">${l.slice(0, 4).map((k) => `<i class="${k.bitisTarih ? 'uz' : k.bitti ? 'b' : k.taslak ? 't' : ''}"></i>`).join('')}</span></button>`; }).join('')}<i class="c-sec"></i></div>
      <div class="c-ay-liste"></div>`;
    secimKoy(false); listeCiz();
    surukle($('.c-izgara', a), { eksen: 'x',
      tasi: (dx) => { $('.c-izgara', a).style.transform = `translateX(${dx * 0.5}px)`; },
      bitir: (dx) => { const iz = $('.c-izgara', a); iz.style.transform = ''; if (Math.abs(dx) > 56) ayDegis(dx < 0 ? 1 : -1); else an(iz, [{ transform: `translateX(${dx * 0.5}px)` }, { transform: 'none' }], { duration: 260, easing: YUM }); } });
  }
  function secimKoy(hareketli) {
    const sec = $('.c-sec', kok), h = $(`.c-h[data-t="${D.secili}"]`, kok);
    if (!sec) return;
    if (!h) { sec.hidden = true; return; }
    sec.hidden = false;
    if (!hareketli) sec.style.transition = 'none';
    sec.style.width = h.offsetWidth + 'px'; sec.style.height = h.offsetHeight + 'px';
    sec.style.transform = `translate(${h.offsetLeft}px,${h.offsetTop}px)`;
    if (!hareketli) { sec.offsetWidth; sec.style.transition = ''; }
  }
  function listeCiz(hareketli) {
    const l = gunun(D.secili), kutu = $('.c-ay-liste', kok);
    kutu.innerHTML = `<h3 class="c-l-bas">${uzunTarih(D.secili)} <span>${l.length ? l.length + ' kayıt' : ''}</span></h3>${l.length ? l.map((k) => `<article class="c-l ${k.bitti ? 'bitti' : ''} ${k.taslak ? 'taslak' : ''}" data-id="${k.id}"><span class="c-l-z ${k.saat ? '' : 'yumusak'}">${k.saat || (k.bolum ? BOLUM[k.bolum] : k.bitisTarih ? 'dönem' : 'gün boyu')}</span>${adD(k, [k.bolge ? '@ ' + esc(k.bolge) : '', k.taslak ? 'taslak, onay bekliyor' : '', k.saat && k.bitis ? k.bitis + ' bitiş' : ''].filter(Boolean).join(', '))}${k.taslak ? '' : tikD(k)}</article>`).join('') : '<p class="c-l-bos">Bu güne kayıt yok.</p>'}`;
    if (hareketli) $$('.c-l,.c-l-bos', kutu).forEach((s, i) => an(s, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 260, delay: i * 35, easing: YUM }));
  }
  function ayDegis(d) {
    let { y, m } = D.ay; m += d; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; }
    D.ay = { y, m };
    ayCiz();
    an($('.c-izgara', kok), [{ opacity: 0, transform: `translateX(${d * 36}px)` }, { opacity: 1, transform: 'none' }], { duration: 320, easing: YUM });
    an($('.c-ay-ad', kok), [{ opacity: 0, transform: `translateX(${d * 14}px)` }, { opacity: 1, transform: 'none' }], { duration: 320, easing: YUM });
  }
  function gorDegis(g) {
    if (g === gor) return;
    const eski = $(gor === 'gun' ? '.c-gun' : '.c-ay', kok), yeni = $(g === 'gun' ? '.c-gun' : '.c-ay', kok), yon = g === 'takvim' ? 1 : -1;
    gor = g;
    $('.c-gecis', kok).dataset.g = g;
    $$('.c-gecis button', kok).forEach((x) => x.setAttribute('aria-pressed', x.dataset.g === g));
    yeni.hidden = false;
    if (g === 'gun') { gunCiz(); yeni.scrollTop = kaydirHedef(); satirGiris(140); } else { D.ay = { y: T(D.secili).getFullYear(), m: T(D.secili).getMonth() }; ayCiz(); }
    eski.hidden = true;
    an(yeni, [{ opacity: 0, transform: `translateY(${16 * yon}px)` }, { opacity: 1, transform: 'none' }], { duration: 340, easing: YUM });
  }

  /* ---- tamamla, taslak ---- */
  function bitir(id) {
    const k = kayit(id); k.bitti = !k.bitti;
    $$(`[data-id="${id}"]`, kok).forEach((s) => {
      s.classList.toggle('bitti', k.bitti);
      const t = $('[data-a="bitir"]', s); if (t) { t.setAttribute('aria-pressed', k.bitti); t.setAttribute('aria-label', `${k.bitti ? 'Geri al' : 'Tamamla'}: ${k.baslik}`); an($('i', t), [{ transform: 'scale(.78)' }, { transform: 'scale(1)' }], { duration: 240, easing: YUM }); }
    });
    cepCiz();
    return k;
  }
  function onayla(id, s) {
    const k = kayit(id); k.taslak = false;
    const r = s.getBoundingClientRect();
    gor === 'gun' ? gunCiz() : listeCiz();
    const y = $(`[data-id="${id}"]`, kok);
    if (y) { an($('.c-k-im', y), [{ transform: 'scaleX(0)', transformOrigin: 'left' }, { transform: 'scaleX(1)', transformOrigin: 'left' }], { duration: 360, easing: YUM }); an(y, [{ opacity: .4 }, { opacity: 1 }], { duration: 360 }); }
    tost('Onaylandı, takvime işlendi');
    void r;
  }
  function sil(id, s) {
    const k = kayit(id);
    an(s, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(24px)' }], { duration: 220, easing: 'ease-in', fill: 'forwards' }).finished.then(() => {
      kayitSil(id); gor === 'gun' ? gunCiz() : (ayCiz());
      tost('Taslak silindi', { ad: 'Geri al', yap: () => { D.kayitlar.push(k); gor === 'gun' ? gunCiz() : ayCiz(); } });
    });
  }

  /* ---- ayrıntı ---- */
  function serit(k) {
    if (!k.tarih || (!k.saat && !k.bolum)) return '';
    let a, b, bas, son;
    if (k.saat) { bas = dk(k.saat) / 60; son = k.bitis ? dk(k.bitis) / 60 : bas; } else { [bas, son] = BANT[k.bolum]; }
    a = Math.max(0, Math.floor(bas) - 2); b = Math.min(24, Math.ceil(son) + 1);
    if (b - a < 5) b = Math.min(24, a + 5);
    const p = (h) => ((h - a) / (b - a)) * 100;
    const saatler = []; for (let h = a; h <= b; h += (b - a > 8 ? 2 : 1)) saatler.push(h);
    const zil = k.hatirlatmalar.map((h) => { const m = /(\d+) dk önce/.exec(h), s = /(\d+) saat önce/.exec(h), n = /(\d\d):(\d\d)/.exec(h); if (k.saat && m) return bas - m[1] / 60; if (k.saat && s) return bas - s[1]; if (n) return +n[1] + n[2] / 60; return null; }).filter((x) => x !== null && x >= a && x <= b);
    const simdi = dk(SIMDI) / 60;
    return `<div class="c-a-b c-serit" style="--adim:${100 / (b - a)}%">
      ${saatler.map((h) => `<span style="left:${p(h)}%">${iki(h)}</span>`).join('')}
      <i class="cubuk ${k.saat ? '' : 'nokta'}" style="left:${p(bas)}%;width:${Math.max(k.saat && !k.bitis ? 1.5 : 0, p(son) - p(bas))}%"></i>
      ${zil.map((z) => `<i class="zil" style="left:${p(z)}%">${ik('zil')}</i>`).join('')}
      ${k.tarih === BUGUN && simdi >= a && simdi <= b ? `<i class="igne" style="left:${p(simdi)}%"></i>` : ''}
    </div>`;
  }
  function ayrHTML(k) {
    const zaman = k.tarih ? `${goreli(k.tarih)}${k.tarih === BUGUN ? ', ' + uzunTarih(k.tarih).split(', ')[1] : ''}, ${zamanMetni(k)}` : 'Tarihi yok, cepte bekliyor';
    return `<div class="c-ayr" role="dialog" aria-label="Kayıt ayrıntısı" data-id="${k.id}">
      <div class="c-a-ust"><button class="c-a-geri" data-a="kapat">${ik('geri')}Geri</button><span class="c-a-tur">${turAdi(k)}${k.taslak ? ', taslak' : ''}</span></div>
      <div class="c-a-ic">
        <div class="c-a-kafa"><span class="c-a-sim">${ik(k.gorsel)}</span><div><h2 class="c-a-ad ${k.bitti ? 'bitti' : ''}"><span>${esc(k.baslik)}</span></h2><p class="c-a-zaman">${zaman}</p></div></div>
        ${serit(k)}
        ${k.bolge ? `<div class="c-a-b c-a-bolge"><b>${ik('harita')}@ ${esc(k.bolge)}</b>${k.varis ? `<mark>Varınca hatırlat: ${esc(k.varis)}</mark>` : ''}</div>` : ''}
        ${k.not ? `<section class="c-a-b"><h3>Not</h3><p class="c-a-not">${esc(k.not)}</p></section>` : ''}
        <section class="c-a-b"><h3>Fotoğraflar</h3><div class="c-a-fotolar">${k.fotolar.map((f, i) => `<button data-a="foto" data-i="${i}" aria-label="Fotoğrafı büyüt">${fotoHTML(f)}</button>`).join('')}<button class="c-a-fekle" data-a="foto-ekle">${ik('foto')}Fotoğraf ekle</button></div></section>
        ${k.baglantilar.length ? `<section class="c-a-b"><h3>Bağlantılar</h3><ul class="c-a-liste">${k.baglantilar.map((b, i) => `<li><button data-a="baglanti" data-i="${i}">${ik(b.tip)}${esc(b.ad)}<small>${b.tip === 'harita' ? 'Harita' : 'Belge'}</small></button></li>`).join('')}</ul></section>` : ''}
        ${k.hatirlatmalar.length || k.varis ? `<section class="c-a-b"><h3>Hatırlatmalar</h3><ul class="c-a-liste">${k.hatirlatmalar.map((h) => `<li><span class="sat">${ik('zil')}${esc(h)}</span></li>`).join('')}${k.varis ? `<li><span class="sat">${ik('harita')}${esc(k.bolge)} bölgesine varınca</span></li>` : ''}</ul></section>` : ''}
      </div>
      ${k.taslak ? '' : `<div class="c-a-alt"><button data-a="bitir-a" aria-pressed="${!!k.bitti}">${k.bitti ? 'Tamamlandı, geri al' : 'Tamamlandı olarak işaretle'}</button></div>`}
    </div>`;
  }
  function ac(id, s) {
    const k = kayit(id), o = el(ayrHTML(k)), ekran = $('.c-ekran', kok);
    ekran.append(o);
    const er = ekran.getBoundingClientRect(), r = s && s.getBoundingClientRect();
    if (!r) an(o, [{ clipPath: 'inset(100% 0 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], { duration: 360, easing: YUM });
    if (r) {
      an(o, [{ clipPath: `inset(${r.top - er.top}px 0 ${er.bottom - r.bottom}px 0)` }, { clipPath: 'inset(0 0 0 0)' }], { duration: 400, easing: YUM });
      const kb = $('.c-k-b', s), hb = $('.c-a-ad', o);
      if (kb) { const x = kb.getBoundingClientRect(), z = hb.getBoundingClientRect(); an(hb, [{ transformOrigin: '0 0', transform: `translate(${x.left - z.left}px,${x.top - z.top}px) scale(${17 / 32})` }, { transformOrigin: '0 0', transform: 'none' }], { duration: 400, easing: YUM }); }
    }
    $$('.c-a-b,.c-a-zaman,.c-a-sim', o).forEach((b, i) => an(b, [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration: 320, delay: 160 + i * 45, easing: YUM }));
    an($('.c-serit .cubuk', o), [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 520, delay: 300, easing: YUM });
    const kapat = yiginEkle(() => {
      yiginCikar(kapat);
      const hedef = $(`.c-k[data-id="${id}"], .c-l[data-id="${id}"]`, kok), h = hedef && hedef.getBoundingClientRect();
      const son = h && h.height ? { clipPath: `inset(${h.top - er.top}px 0 ${er.bottom - h.bottom}px 0)`, opacity: .6 } : { clipPath: 'inset(100% 0 0 0)', opacity: 1 };
      an(o, [{ clipPath: 'inset(0 0 0 0)', opacity: 1 }, son], { duration: 280, easing: 'cubic-bezier(.4,0,.7,.2)', fill: 'forwards' }).finished.then(() => o.remove());
    });
    o._kapat = kapat;
  }
  function ayrTik(a, b, o) {
    const k = kayit(o.dataset.id);
    if (a === 'kapat') o._kapat();
    else if (a === 'foto') fotoAc(b, k.fotolar[+b.dataset.i]);
    else if (a === 'baglanti') baglantiTost(k.baglantilar[+b.dataset.i]);
    else if (a === 'foto-ekle') fotoSec().then((f) => { if (!f) return; k.fotolar.push(f); const y = el(`<button data-a="foto" data-i="${k.fotolar.length - 1}" aria-label="Fotoğrafı büyüt">${fotoHTML(f)}</button>`); b.before(y); an(y, [{ opacity: 0, transform: 'scale(.85)' }, { opacity: 1, transform: 'none' }], { duration: 300, easing: YUM }); gor === 'gun' && gunCiz(); });
    else if (a === 'bitir-a') { bitir(k.id); $('.c-a-ad', o).classList.toggle('bitti', k.bitti); b.setAttribute('aria-pressed', !!k.bitti); b.textContent = k.bitti ? 'Tamamlandı, geri al' : 'Tamamlandı olarak işaretle'; }
  }

  /* ---- alt kâğıt ---- */
  function kagitAc(icerik, sinif) {
    const ekran = $('.c-ekran', kok);
    const perde = el('<div class="c-perde"></div>'), kagit = el(`<div class="c-kagit ${sinif}" role="dialog"><div class="c-tutamak" aria-hidden="true"></div><div class="c-kagit-ic">${icerik}</div></div>`);
    ekran.append(perde, kagit);
    an(perde, [{ opacity: 0 }, { opacity: 1 }], { duration: 220 });
    an(kagit, [{ transform: 'translateY(100%)' }, { transform: 'none' }], { duration: 380, easing: YUM });
    const kapat = yiginEkle(() => {
      yiginCikar(kapat);
      an(perde, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' }).finished.then(() => perde.remove());
      const m = new DOMMatrix(getComputedStyle(kagit).transform).m42;
      an(kagit, [{ transform: `translateY(${m}px)` }, { transform: 'translateY(100%)' }], { duration: 240, easing: 'cubic-bezier(.4,0,.8,.3)', fill: 'forwards' }).finished.then(() => kagit.remove());
    });
    perde.onclick = kapat;
    surukle($('.c-tutamak', kagit), { eksen: 'y',
      tasi: (dx, dy) => { kagit.style.transform = `translateY(${Math.max(0, dy)}px)`; },
      bitir: (dx, dy, vx, vy) => { if (dy > 90 || vy > 0.6) kapat(); else { an(kagit, [{ transform: `translateY(${Math.max(0, dy)}px)` }, { transform: 'none' }], { duration: 260, easing: YUM }); kagit.style.transform = ''; } } });
    return { kagit, kapat };
  }
  function cepAc() {
    const l = tarihsiz();
    const { kagit } = kagitAc(`<h2>Cepte</h2><div class="c-cep-liste">${l.map((k) => `<article class="c-l ${k.bitti ? 'bitti' : ''}" data-id="${k.id}"><span class="c-k-sim">${ik(k.gorsel)}</span>${adD(k, '')}${tikD(k)}</article>`).join('')}</div>`, 'c-cepk');
    kagit.setAttribute('aria-label', 'Tarihi olmayan işler');
  }
  function ekleAc() {
    const marks = []; for (let m = B * 60; m <= S * 60; m += 15) marks.push(m);
    const ilk = Math.min(S * 60, Math.ceil((dk(SIMDI) + 20) / 15) * 15);
    const { kagit, kapat } = kagitAc(`<form class="c-yeni" novalidate>
      <h2>Yeni kayıt</h2>
      <label for="c-baslik">Ne yapılacak?</label><input id="c-baslik" autocomplete="off" enterkeyhint="done" placeholder="Örn. lastik değişimi">
      <div class="c-tur" role="radiogroup" aria-label="Zaman türü" data-t="saatli"><i></i><button type="button" role="radio" aria-checked="true" data-a="tur" data-t="saatli">Saatli</button><button type="button" role="radio" aria-checked="false" data-a="tur" data-t="bolum">Gün içinde</button><button type="button" role="radio" aria-checked="false" data-a="tur" data-t="tarihsiz">Tarihsiz</button></div>
      <div class="c-tur-ic" data-t="saatli"><output class="c-okuma" for="c-baslik">${hhmm(ilk)}</output><div class="c-mezura"><div class="c-mezura-kay" tabindex="0" role="slider" aria-label="Saat" aria-valuetext="${hhmm(ilk)}">${marks.map((m) => `<div class="c-mz ${m % 60 ? '' : 's'}">${m % 60 ? '' : `<span>${iki(m / 60)}</span>`}</div>`).join('')}</div></div></div>
      <div class="c-tur-ic" data-t="bolum" hidden><div class="c-yongalar" role="radiogroup" aria-label="Gün bölümü">${BOLUM_SIRA.map((b, i) => `<button type="button" role="radio" aria-checked="${i === 3}" data-a="bolum" data-b="${b}">${BOLUM[b]}</button>`).join('')}</div></div>
      <div class="c-tur-ic" data-t="tarihsiz" hidden><p>Tarih verilmez; cepte bekler, istediğin gün cetvele alırsın.</p></div>
      <button type="submit" class="c-kaydet">Kaydı ekle</button>
    </form>`, 'c-yenik');
    kagit.setAttribute('aria-label', 'Yeni kayıt');
    const kay = $('.c-mezura-kay', kagit), okuma = $('.c-okuma', kagit);
    let secSaat = ilk, tur = 'saatli', bolum = 'aksam';
    kay.scrollLeft = ((ilk - B * 60) / 15) * 18;
    kay.addEventListener('scroll', () => {
      const m = B * 60 + Math.max(0, Math.min(marks.length - 1, Math.round(kay.scrollLeft / 18))) * 15;
      if (m !== secSaat) { secSaat = m; okuma.textContent = hhmm(m); kay.setAttribute('aria-valuetext', hhmm(m)); an(okuma, [{ transform: 'translateY(-2px)' }, { transform: 'none' }], 90); }
    }, { passive: true });
    kay.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); kay.scrollLeft += e.key === 'ArrowRight' ? 18 : -18; } });
    let bas0 = 0;
    surukle(kay, { eksen: 'x', filtre: (e) => e.pointerType === 'mouse',
      basla: () => { bas0 = kay.scrollLeft; kay.style.scrollSnapType = 'none'; },
      tasi: (dx) => { kay.scrollLeft = bas0 - dx; },
      bitir: () => { kay.scrollTo({ left: Math.round(kay.scrollLeft / 18) * 18, behavior: az() ? 'auto' : 'smooth' }); setTimeout(() => { kay.style.scrollSnapType = ''; }, 320); } });
    kagit.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      if (b.dataset.a === 'tur') { tur = b.dataset.t; $('.c-tur', kagit).dataset.t = tur; $$('.c-tur button', kagit).forEach((x) => x.setAttribute('aria-checked', x === b)); $$('.c-tur-ic', kagit).forEach((x) => { x.hidden = x.dataset.t !== tur; if (!x.hidden) an(x, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: YUM }); }); }
      if (b.dataset.a === 'bolum') { bolum = b.dataset.b; $$('.c-yongalar button', kagit).forEach((x) => x.setAttribute('aria-checked', x === b)); }
    });
    $('form', kagit).addEventListener('submit', (e) => {
      e.preventDefault();
      const giris = $('#c-baslik', kagit), ad = giris.value.trim();
      if (!ad) { giris.focus(); an(giris, [{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(5px)' }, { transform: 'none' }], 240); return; }
      const k = yeniKayit(ad, tur === 'saatli' ? { tarih: D.secili, saat: hhmm(secSaat) } : tur === 'bolum' ? { tarih: D.secili, bolum } : {});
      kapat();
      cepCiz();
      if (!k.tarih) { tost('Cebe kondu'); an($('.c-cep', kok), [{ transform: 'translateY(0)' }, { transform: 'translateY(-5px)' }, { transform: 'none' }], { duration: 320, easing: YUM }); return; }
      if (gor !== 'gun') { ayCiz(); tost(`${uzunTarih(k.tarih)} gününe eklendi`); return; }
      gunCiz();
      const s = $(`.c-k[data-id="${k.id}"]`, kok), g = $('.c-gun', kok);
      kaydir(g, Math.max(0, $('.c-cetvel', g).offsetTop + parseFloat(s.style.top) - g.clientHeight * 0.4), 500);
      an($('.c-k-im', s), [{ transform: 'scaleX(0)', transformOrigin: 'left' }, { transform: 'scaleX(1)', transformOrigin: 'left' }], { duration: 420, delay: 240, easing: YUM });
      $$('.c-k-sim,.c-k-ad,.c-k-tik', s).forEach((p) => an(p, [{ opacity: 0, transform: 'translateX(-12px)' }, { opacity: 1, transform: 'none' }], { duration: 380, delay: 380, easing: YUM }));
    });
    setTimeout(() => { try { $('#c-baslik', kagit).focus({ preventScroll: true }); } catch (_) {} }, az() ? 0 : 400);
  }

  function tik(e) {
    const b = e.target.closest('[data-a]'); if (!b || !kok.contains(b)) return;
    const a = b.dataset.a, ayr = b.closest('.c-ayr');
    if (ayr) return ayrTik(a, b, ayr);
    if (b.closest('.c-yeni')) return;
    const s = b.closest('[data-id]'), id = s && s.dataset.id;
    if (a === 'gor') gorDegis(b.dataset.g);
    else if (a === 'ac') { if (b.closest('.c-kagit')) { yigin[yigin.length - 1](); ac(id, null); } else ac(id, s); }
    else if (a === 'bitir') bitir(id);
    else if (a === 'onayla') onayla(id, s);
    else if (a === 'sil') sil(id, s);
    else if (a === 'cep') cepAc();
    else if (a === 'ekle') ekleAc();
    else if (a === 'ay') ayDegis(+b.dataset.d);
    else if (a === 'gun') { if (b.parentElement._surukledi) return; D.secili = b.dataset.t; secimKoy(true); basCiz(true); listeCiz(true); }
  }
  return { kur };
})();
