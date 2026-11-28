/* ============ TABELA ============ */
YON.tabela = (() => {
  const MEK = 'cubic-bezier(.3,0,.2,1)', P = 'perspective(700px) ';
  const KBOLUM = { sabah: 'SABAH', ogle: 'ÖĞLE', ogleden_sonra: 'Ö.SONRA', aksam: 'AKŞAM', gece: 'GECE' };
  const KAY = ['OCA', 'ŞUB', 'MAR', 'NİS', 'MAY', 'HAZ', 'TEM', 'AĞU', 'EYL', 'EKİ', 'KAS', 'ARA'];
  const HARF = 'ABCDEGHKLMNORSTUYZ0123456789';
  let kok, ayAcik = false, yazAcik = false;

  const zamanK = (k) => k.saat || (k.bolum ? KBOLUM[k.bolum] : k.bitisTarih ? 'DÖNEM' : k.tarih ? 'GÜN' : '––');
  function durum(k) {
    if (k.bitti) return ['bitti', 'BİTTİ'];
    if (k.taslak) return ['taslak', 'TASLAK'];
    if (k.tarih === BUGUN && k.saat) { const f = dk(k.saat) - dk(SIMDI); if (f >= 0 && f <= 90) return ['yakin', f + ' DK']; if (f < 0) return ['gec', 'GEÇTİ']; }
    return ['acik', 'AÇIK'];
  }
  const karis = (m) => [...m].map((c) => (c === ' ' || c === ':' ? c : HARF[Math.floor(Math.random() * HARF.length)])).join('');
  function cevir(e, metin, tur = 2) {
    if (!e) return;
    if (e._hedef === metin || (e._hedef == null && e.textContent === metin)) return;
    if (az()) { e._cv = (e._cv || 0) + 1; e._hedef = null; e.textContent = metin; return; }
    e._hedef = metin;
    const adimlar = [...Array.from({ length: tur }, () => karis(metin)), metin];
    const benim = (e._cv = (e._cv || 0) + 1);
    let i = 0;
    const bir = () => {
      if (e._cv !== benim) return;
      an(e, [{ transform: P + 'rotateX(0deg)' }, { transform: P + 'rotateX(-90deg)' }], { duration: 65, easing: 'ease-in', fill: 'forwards' }).finished.then(() => {
        if (e._cv !== benim) return;
        e.textContent = adimlar[i++];
        an(e, [{ transform: P + 'rotateX(90deg)' }, { transform: P + 'rotateX(0deg)' }], { duration: 85, easing: 'ease-out', fill: 'forwards' }).finished.then(() => { if (e._cv !== benim) return; if (i < adimlar.length) bir(); else { e._hedef = null; e.getAnimations().forEach((x) => x.cancel()); } });
      });
    };
    bir();
  }
  const panoSirasi = (l) => [...sirala(l.filter((k) => !k.bitti)), ...sirala(l.filter((k) => k.bitti))];

  function kur(root) {
    kok = root; ayAcik = false; yazAcik = false;
    kok.innerHTML = `<div class="t-ekran">
      <header class="t-bas"><span class="t-f t-f--buyuk" data-b="gun"></span><span class="t-f t-f--buyuk" data-b="no"></span><span class="t-f t-f--buyuk" data-b="ay"></span><span class="t-bas-saat" aria-label="Saat">${SIMDI}</span><button class="t-ay-d" data-a="ay-ac" aria-expanded="false">Ay${ik('asagi')}</button></header>
      <div class="t-takvim"></div>
      <div class="t-pano"></div>
      <div class="t-alt-yuva"></div>
    </div>`;
    D.ay = { y: T(D.secili).getFullYear(), m: T(D.secili).getMonth() };
    basCiz(false); takvimCiz(); panoCiz(true, 320); altCiz();
    kok.onclick = tik;
    $$('.t-bas .t-f', kok).forEach((f, i) => { const m = f.textContent; f.textContent = karis(m); setTimeout(() => cevir(f, m, 3), az() ? 0 : 80 + i * 120); });
    surukle($('.t-takvim', kok), { eksen: 'x', tasi: () => {}, bitir: (dx) => { if (Math.abs(dx) < 50) return; if (ayAcik) ayDegis(dx < 0 ? 1 : -1); else gunSec(gunEkle(D.secili, dx < 0 ? 7 : -7)); } });
  }
  function basMetin() { const d = T(D.secili); return { gun: buyuk(KGUN[haftaGunu(D.secili)]), no: iki(d.getDate()), ay: KAY[d.getMonth()] }; }
  function basCiz(hareketli) {
    const m = basMetin();
    $$('.t-bas .t-f', kok).forEach((f, i) => { const y = m[f.dataset.b]; if (hareketli) setTimeout(() => cevir(f, y, 1), i * 60); else f.textContent = y; });
    $('.t-bas', kok).setAttribute('aria-label', uzunTarih(D.secili));
  }

  function takvimCiz() {
    const { y, m } = D.ay, g = ayIzgarasi(y, m), haftalar = [];
    for (let i = 0; i < g.length; i += 7) haftalar.push(g.slice(i, i + 7));
    const tk = $('.t-takvim', kok);
    tk.innerHTML = `<div class="t-ay-bas"><button data-a="ay" data-d="-1" aria-label="Önceki ay">${ik('geri')}</button><b>${AYLAR[m]} ${y}</b><button data-a="ay" data-d="1" aria-label="Sonraki ay">${ik('ileri')}</button></div>
      <div class="t-gunad" aria-hidden="true">${KGUN.map((x) => `<span>${x}</span>`).join('')}</div>
      ${haftalar.map((h, i) => `<div class="t-hafta ${h.includes(D.secili) ? 'gor' : ''}" style="--i:${i}">${h.map((t) => { const l = gunun(t), d = T(t); return `<button class="t-g ${d.getMonth() !== m ? 'dis' : ''} ${t === BUGUN ? 'bugun' : ''} ${t === D.secili ? 'sec' : ''}" data-a="gun" data-t="${t}" aria-label="${uzunTarih(t)}, ${l.length} kayıt" aria-pressed="${t === D.secili}"><b>${d.getDate()}</b><span class="l">${l.slice(0, 4).map((k) => `<i class="${k.bitti ? 'b' : k.taslak ? 't' : ''}"></i>`).join('')}</span></button>`; }).join('')}</div>`).join('')}`;
    tk.classList.toggle('acik', ayAcik);
  }
  function satir(k) {
    const [d, dm] = durum(k), alt = [k.bitis ? '–' + k.bitis : '', k.bolge ? '@ ' + esc(k.bolge) : '', k.bitisTarih ? zamanMetni(k) : ''].filter(Boolean).join(' ');
    return `<div class="t-s ${k.bitti ? 'bitti' : ''} ${k.taslak ? 'taslak' : ''}" data-id="${k.id}">
      <div class="t-s-alt" aria-hidden="true">${k.bitti ? 'GERİ AL' : 'BİTTİ'}</div>
      <div class="t-s-ic"><span class="t-f t-f-z">${zamanK(k)}</span><span class="t-s-im">${ik(k.gorsel)}</span>
        <div class="t-s-ad"><button data-a="ac"><span>${esc(k.baslik)}</span>${alt || k.taslak ? `<small>${k.taslak ? 'asistan önerdi, onay bekliyor' : alt}</small>` : ''}</button>${k.taslak ? '<span class="t-s-onay"><button class="t-f t-f--d" data-a="onayla">ONAYLA</button><button class="t-f t-f--d t-f--bos" data-a="sil">SİL</button></span>' : ''}</div>
        <button class="t-f t-f-durum" data-a="${k.taslak ? 'ac' : 'bitir'}" data-d="${d}" aria-label="${k.taslak ? 'Taslak' : k.bitti ? 'Geri al' : 'Tamamla'}: ${esc(k.baslik)}"><span>${dm}</span></button>
      </div></div>`;
  }
  function panoCiz(hareketli, gecikme = 0) {
    const l = panoSirasi(gunun(D.secili)), ts = panoSirasi(tarihsiz()), p = $('.t-pano', kok);
    p.innerHTML = `<div class="t-kolon"><span>Saat</span><span>Kayıt</span><span>Durum</span></div>${l.length ? l.map(satir).join('') : '<p class="t-bos">Bu güne kayıt yok.</p>'}<div class="t-ayrac">Tarihsiz</div>${ts.map(satir).join('')}<div class="t-pano-son"></div>`;
    $$('.t-s:not(.taslak) .t-s-ic', p).forEach((ic) => {
      const id = ic.parentElement.dataset.id;
      surukle(ic, { eksen: 'x', filtre: (e) => !e.target.closest('.t-f-durum'),
        tasi: (dx) => { ic.style.transform = `translateX(${Math.max(0, Math.min(150, dx))}px)`; },
        bitir: (dx) => { const x = Math.max(0, Math.min(150, dx)); ic.style.transform = ''; an(ic, [{ transform: `translateX(${x}px)` }, { transform: 'none' }], { duration: 180, easing: 'steps(4,end)' }); if (dx > 84) bitir(id); } });
      ic.addEventListener('click', (e) => { if (ic._surukledi) { e.stopPropagation(); e.preventDefault(); } }, true);
    });
    if (hareketli) $$('.t-s,.t-bos', p).forEach((s, i) => an(s, [{ transform: P + 'rotateX(-90deg)', opacity: .3 }, { transform: P + 'rotateX(0deg)', opacity: 1 }], { duration: 190, delay: gecikme + i * 42, easing: MEK }));
  }
  function altCiz() {
    const y = $('.t-alt-yuva', kok), l = gunun(D.secili), acik = l.filter((k) => !k.bitti && !k.taslak).length, bitti = l.filter((k) => k.bitti).length;
    if (yazAcik) return;
    y.innerHTML = `<footer class="t-alt"><button class="t-f t-f--mavi" data-a="yaz">+ YENİ KAYIT</button><span class="t-ozet">${acik} açık, ${bitti} bitti</span></footer>`;
  }

  function gunSec(t) {
    if (t === D.secili) return;
    D.secili = t;
    const d = T(t);
    if (d.getMonth() !== D.ay.m && !$(`.t-g[data-t="${t}"]`, kok)) D.ay = { y: d.getFullYear(), m: d.getMonth() };
    if (!ayAcik) D.ay = { y: d.getFullYear(), m: d.getMonth() };
    takvimCiz(); basCiz(true); panoCiz(true); altCiz();
  }
  function ayDegis(d) {
    let { y, m } = D.ay; m += d; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; }
    D.ay = { y, m };
    takvimCiz();
    $$('.t-hafta', kok).forEach((h, i) => an(h, [{ transform: P + 'rotateX(-90deg)', transformOrigin: '50% 0' }, { transform: P + 'rotateX(0deg)', transformOrigin: '50% 0' }], { duration: 170, delay: i * 36, easing: MEK }));
  }
  function ayAc() {
    ayAcik = !ayAcik;
    if (!ayAcik) { const d = T(D.secili); if (d.getMonth() !== D.ay.m || !$(`.t-g[data-t="${D.secili}"]`, kok)) { D.ay = { y: d.getFullYear(), m: d.getMonth() }; takvimCiz(); } }
    $('.t-takvim', kok).classList.toggle('acik', ayAcik);
    const b = $('.t-ay-d', kok); b.setAttribute('aria-expanded', ayAcik);
  }

  function siraAnim() {
    const p = $('.t-pano', kok), once = new Map($$('.t-s', p).map((s) => [s.dataset.id, s.getBoundingClientRect().top]));
    panoCiz(false);
    $$('.t-s', p).forEach((s) => { const o = once.get(s.dataset.id), n = s.getBoundingClientRect().top; if (o == null) an(s, [{ transform: P + 'rotateX(-90deg)' }, { transform: P + 'rotateX(0deg)' }], { duration: 220, easing: MEK }); else if (Math.abs(o - n) > 1) an(s, [{ transform: `translateY(${o - n}px)` }, { transform: 'none' }], { duration: 300, easing: 'steps(5,end)' }); });
    altCiz(); takvimCiz();
  }
  function bitir(id) {
    const k = kayit(id); k.bitti = !k.bitti;
    const s = $(`.t-s[data-id="${id}"]`, kok);
    if (s) { const f = $('.t-f-durum', s), [d, dm] = durum(k); s.classList.toggle('bitti', k.bitti); f.dataset.d = d; cevir($('span', f), dm, 2); }
    setTimeout(siraAnim, az() ? 0 : 560);
    const dos = $('.t-dosya', kok); if (dos && dos.dataset.id === id) { const b = $('[data-a="bitir-a"]', dos); cevir(b, k.bitti ? 'GERİ AL' : 'BİTTİ OLARAK İŞARETLE', 1); }
  }
  function onayla(id) {
    const k = kayit(id); k.taslak = false;
    const s = $(`.t-s[data-id="${id}"]`, kok), f = s && $('.t-f-durum span', s);
    if (f) { f.parentElement.dataset.d = 'acik'; cevir(f, 'AÇIK', 2); }
    setTimeout(() => { siraAnim(); tost('Onaylandı'); }, az() ? 0 : 520);
  }
  function sil(id) {
    const k = kayit(id), s = $(`.t-s[data-id="${id}"]`, kok);
    an(s, [{ transform: P + 'rotateX(0deg)' }, { transform: P + 'rotateX(90deg)' }], { duration: 160, easing: 'ease-in', fill: 'forwards' }).finished.then(() => {
      kayitSil(id); siraAnim();
      tost('Taslak silindi', { ad: 'Geri al', yap: () => { D.kayitlar.push(k); siraAnim(); } });
    });
  }

  /* ---- dosya (ayrıntı) ---- */
  function sekmeHTML(k, s) {
    if (s === 'ayr') return `${k.not ? `<p class="t-not">${esc(k.not)}</p>` : '<p class="t-dl-bos">Not yok.</p>'}
      ${k.varis ? `<div class="t-kutu"><small>${esc(k.bolge)} bölgesine varınca hatırlat</small><b>${esc(k.varis)}</b></div>` : ''}
      <dl class="t-meta"><dt>Tür</dt><dd>${turAdi(k)}</dd><dt>Zaman</dt><dd>${k.tarih ? uzunTarih(k.tarih) + ', ' + zamanMetni(k) : 'Tarihi yok'}</dd><dt>Ekleyen</dt><dd>${k.yazar || 'Elle'}</dd></dl>`;
    if (s === 'foto') return `<div class="t-kareler">${k.fotolar.map((f, i) => `<button data-a="foto" data-i="${i}" aria-label="Fotoğrafı büyüt">${fotoHTML(f)}</button>`).join('')}<button class="t-kare-ekle" data-a="foto-ekle">${ik('foto')}Fotoğraf ekle</button></div>`;
    if (s === 'bag') return k.baglantilar.length ? `<ul class="t-dl">${k.baglantilar.map((b, i) => `<li><button data-a="baglanti" data-i="${i}"><span class="t-f">${b.tip === 'harita' ? 'HARİTA' : 'BELGE'}</span>${esc(b.ad)}</button></li>`).join('')}</ul>` : '<p class="t-dl-bos">Bağlantı yok.</p>';
    const h = k.hatirlatmalar.map((x) => { const m = /(\d\d:\d\d)/.exec(x), dkOnce = /(\d+) dk önce/.exec(x); return `<li><span class="sat"><span class="t-f">${m ? m[1] : k.saat && dkOnce ? hhmm(dk(k.saat) - +dkOnce[1]) : 'ZİL'}</span>${esc(x)}</span></li>`; }).join('') + (k.varis ? `<li><span class="sat"><span class="t-f">VARIŞ</span>${esc(k.bolge)}: ${esc(k.varis)}</span></li>` : '');
    return h ? `<ul class="t-dl">${h}</ul>` : '<p class="t-dl-bos">Hatırlatma yok.</p>';
  }
  function ac(id) {
    const k = kayit(id), ekran = $('.t-ekran', kok), ust = $('.t-bas', kok).offsetHeight;
    const say = (n) => (n ? `<sup>${n}</sup>` : '');
    const o = el(`<div class="t-dosya" role="dialog" aria-label="Kayıt ayrıntısı" data-id="${k.id}" style="top:${ust}px">
      <div class="t-d-ust"><button class="t-d-geri" data-a="kapat">${ik('geri')}Pano</button><span class="t-f">${durum(k)[1]}</span></div>
      <h2 class="t-d-ad">${ik(k.gorsel)}<span>${esc(k.baslik)}</span></h2>
      <div class="t-d-kanatlar"><span class="t-f">${zamanK(k)}</span>${k.bitis ? `<span class="t-f">${k.bitis}</span>` : ''}${k.bolge ? `<span class="t-f">@ ${buyuk(k.bolge)}</span>` : ''}</div>
      <div class="t-sekmeler" role="tablist"><button role="tab" aria-selected="true" data-a="sekme" data-s="ayr">Ayrıntılar</button><button role="tab" aria-selected="false" data-a="sekme" data-s="foto">Fotolar${say(k.fotolar.length)}</button><button role="tab" aria-selected="false" data-a="sekme" data-s="bag">Bağlantılar${say(k.baglantilar.length)}</button><button role="tab" aria-selected="false" data-a="sekme" data-s="hat">Hatırlatma${say(k.hatirlatmalar.length + (k.varis ? 1 : 0))}</button></div>
      <div class="t-d-ic" role="tabpanel">${sekmeHTML(k, 'ayr')}</div>
      ${k.taslak ? '' : `<div class="t-d-alt"><button class="t-f t-f--mavi" data-a="bitir-a">${k.bitti ? 'GERİ AL' : 'BİTTİ OLARAK İŞARETLE'}</button></div>`}
    </div>`);
    ekran.append(o);
    an(o, [{ transform: 'perspective(1400px) rotateX(-88deg)', opacity: .4 }, { transform: 'perspective(1400px) rotateX(0deg)', opacity: 1 }], { duration: 330, easing: 'cubic-bezier(.2,.7,.25,1)' });
    $$('.t-d-kanatlar .t-f, .t-d-ust .t-f', o).forEach((f, i) => { const m = f.textContent; f.textContent = karis(m); setTimeout(() => cevir(f, m, 1), az() ? 0 : 260 + i * 70); });
    const kapat = yiginEkle(() => {
      yiginCikar(kapat);
      an(o, [{ transform: 'perspective(1400px) rotateX(0deg)', opacity: 1 }, { transform: 'perspective(1400px) rotateX(-88deg)', opacity: .4 }], { duration: 220, easing: 'ease-in', fill: 'forwards' }).finished.then(() => o.remove());
    });
    o._kapat = kapat;
  }
  function dosyaTik(a, b, o) {
    const k = kayit(o.dataset.id);
    if (a === 'kapat') o._kapat();
    else if (a === 'sekme') {
      if (b.getAttribute('aria-selected') === 'true') return;
      $$('.t-sekmeler button', o).forEach((x) => x.setAttribute('aria-selected', x === b));
      const ic = $('.t-d-ic', o);
      an(ic, [{ transform: P + 'rotateX(0deg)' }, { transform: P + 'rotateX(-90deg)' }], { duration: 90, easing: 'ease-in', fill: 'forwards' }).finished.then(() => {
        ic.innerHTML = sekmeHTML(k, b.dataset.s); ic.scrollTop = 0; ic.dataset.s = b.dataset.s;
        an(ic, [{ transform: P + 'rotateX(90deg)' }, { transform: P + 'rotateX(0deg)' }], { duration: 130, easing: 'ease-out', fill: 'forwards' }).finished.then(() => ic.getAnimations().forEach((x) => x.cancel()));
      });
    } else if (a === 'foto') fotoAc(b, k.fotolar[+b.dataset.i]);
    else if (a === 'baglanti') baglantiTost(k.baglantilar[+b.dataset.i]);
    else if (a === 'foto-ekle') fotoSec().then((f) => {
      if (!f) return;
      k.fotolar.push(f);
      const y = el(`<button data-a="foto" data-i="${k.fotolar.length - 1}" aria-label="Fotoğrafı büyüt">${fotoHTML(f)}</button>`); b.before(y);
      an(y, [{ transform: P + 'rotateX(-90deg)' }, { transform: P + 'rotateX(0deg)' }], { duration: 200, easing: MEK });
      const sup = $('.t-sekmeler [data-s="foto"]', o); sup.innerHTML = `Fotolar<sup>${k.fotolar.length}</sup>`;
    });
    else if (a === 'bitir-a') { bitir(k.id); cevir($('.t-d-ust .t-f', o), durum(k)[1], 2); }
  }

  /* ---- yeni kayıt satırı ---- */
  function yazAc() {
    yazAcik = true;
    const yuva = $('.t-alt-yuva', kok);
    const MODLAR = ['saatli', 'bolum', 'tarihsiz'], MOD_AD = { saatli: 'SAATLİ', bolum: 'GÜN İÇİ', tarihsiz: 'TARİHSİZ' };
    let mod = 'saatli', saat = Math.min(23 * 60, Math.ceil((dk(SIMDI) + 20) / 15) * 15), bolum = 'aksam';
    yuva.innerHTML = `<form class="t-yaz" novalidate>
      <label class="gizli-yazi" for="t-baslik">Yeni kayıt</label><input id="t-baslik" autocomplete="off" enterkeyhint="done" placeholder="Yeni kayıt">
      <div class="t-yaz-sat">
        <button type="button" class="t-f t-f--d" data-y="mod" aria-label="Zaman türünü değiştir">${MOD_AD[mod]}</button>
        <span class="t-yaz-ayar"></span>
        <span class="t-yaz-son"><button type="button" class="t-f t-f--d t-f--bos t-f--kare" data-y="vazgec" aria-label="Vazgeç">${ik('kapat')}</button><button type="submit" class="t-f t-f--d t-f--mavi">EKLE</button></span>
      </div>
      <p class="t-yaz-ipucu">${uzunTarih(D.secili)} gününe eklenir. Türü değiştirmek için ilk kanada dokun.</p>
    </form>`;
    const form = $('form', yuva), ayar = $('.t-yaz-ayar', form), giris = $('#t-baslik', form);
    const ayarCiz = () => {
      ayar.innerHTML = mod === 'saatli' ? `<button type="button" class="t-f t-f--d t-f--bos" data-y="eksi" aria-label="15 dakika geri">−</button><span class="t-f t-f--d" data-y="okuma">${hhmm(saat)}</span><button type="button" class="t-f t-f--d t-f--bos" data-y="arti" aria-label="15 dakika ileri">+</button>`
        : mod === 'bolum' ? `<button type="button" class="t-f t-f--d" data-y="bolum" aria-label="Gün bölümünü değiştir">${KBOLUM[bolum]}</button>` : '';
      $('.t-yaz-ipucu', form).textContent = mod === 'tarihsiz' ? 'Tarihsiz listeye eklenir.' : `${uzunTarih(D.secili)} gününe eklenir. Türü değiştirmek için ilk kanada dokun.`;
    };
    ayarCiz();
    an(form, [{ transform: 'translateY(100%)' }, { transform: 'none' }], { duration: 200, easing: 'steps(5,end)' });
    const kapat = yiginEkle(() => { yiginCikar(kapat); yazAcik = false; altCiz(); });
    form.addEventListener('click', (e) => {
      const b = e.target.closest('[data-y]'); if (!b) return;
      const y = b.dataset.y;
      if (y === 'mod') { mod = MODLAR[(MODLAR.indexOf(mod) + 1) % 3]; cevir(b, MOD_AD[mod], 1); ayarCiz(); $$('.t-f', ayar).forEach((f) => an(f, [{ transform: P + 'rotateX(-90deg)' }, { transform: P + 'rotateX(0deg)' }], { duration: 160, easing: MEK })); }
      else if (y === 'eksi' || y === 'arti') { saat = Math.max(0, Math.min(23 * 60 + 45, saat + (y === 'arti' ? 15 : -15))); cevir($('[data-y="okuma"]', ayar), hhmm(saat), 0); }
      else if (y === 'bolum') { bolum = BOLUM_SIRA[(BOLUM_SIRA.indexOf(bolum) + 1) % 5]; cevir(b, KBOLUM[bolum], 0); }
      else if (y === 'vazgec') kapat();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const ad = giris.value.trim();
      if (!ad) { giris.focus(); an(giris, [{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'none' }], { duration: 200, easing: 'steps(4,end)' }); return; }
      const k = yeniKayit(ad, mod === 'saatli' ? { tarih: D.secili, saat: hhmm(saat) } : mod === 'bolum' ? { tarih: D.secili, bolum } : {});
      kapat();
      siraAnim();
      const s = $(`.t-s[data-id="${k.id}"]`, kok);
      if (s) { s.scrollIntoView({ block: 'nearest', behavior: az() ? 'auto' : 'smooth' }); const f = $('.t-f-z', s), m = f.textContent; f.textContent = karis(m); cevir(f, m, 2); }
    });
    setTimeout(() => { try { giris.focus({ preventScroll: true }); } catch (_) {} }, az() ? 0 : 220);
  }

  function tik(e) {
    const b = e.target.closest('[data-a]'); if (!b || !kok.contains(b)) return;
    const a = b.dataset.a, dos = b.closest('.t-dosya');
    if (dos) return dosyaTik(a, b, dos);
    const s = b.closest('[data-id]'), id = s && s.dataset.id;
    if (a === 'ac') ac(id);
    else if (a === 'bitir') bitir(id);
    else if (a === 'onayla') onayla(id);
    else if (a === 'sil') sil(id);
    else if (a === 'yaz') yazAc();
    else if (a === 'ay-ac') ayAc();
    else if (a === 'ay') ayDegis(+b.dataset.d);
    else if (a === 'gun') { if ($('.t-takvim', kok)._surukledi) return; gunSec(b.dataset.t); }
  }
  return { kur };
})();
