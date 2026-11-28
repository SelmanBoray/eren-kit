// Masaüstü yerleşimi, dar telefon, azaltılmış hareket, tema düğmesi, künye, fotoğraf ekleme, yön değiştirme.
import { tarayici, ONIZLEME, CIKTI } from './cdp.mjs';
import { join } from 'node:path';
const t = await tarayici(9380);
const bak = async (kosul, ad) => { const v = await t.js(`(${kosul})`); console.log(v === true ? '  ok ' : '  HATA', ad, v === true ? '' : JSON.stringify(v)); };
const tasma = `(()=>{const d=document.documentElement; const kotu=[...document.querySelectorAll('.kabuk *')].filter(e=>{const r=e.getBoundingClientRect(); return r.width>0 && r.right>innerWidth+1 && !e.closest('.c-mezura,.s-gal,.s-serit,.c-a-fotolar,.t-sekmeler,.s-sayfa[hidden]') && getComputedStyle(e).position!=='fixed';}).slice(0,5).map(e=>e.className||e.tagName); return {sw:d.scrollWidth,cw:d.clientWidth,kotu};})()`;
try {
  // masaüstü
  await t.boyut(1280, 900, false);
  await t.ortam({ tema: 'light', azHareket: false });
  for (const yon of ['cetvel', 'sahne', 'tabela']) { await t.git(ONIZLEME, '#' + yon); await t.uyu(1700); await t.cek('masa-' + yon); }
  await bak(`getComputedStyle(document.querySelector('.kunye-ek')).display!=='none' && document.querySelector('.telefon').getBoundingClientRect().width===392`, 'masaüstü: künye açık, telefon 392px');
  // tema düğmesi iki yönde de sistemi ezer
  await t.tikla('#tema'); await t.uyu(300);
  await bak(`document.documentElement.dataset.theme==='dark' && getComputedStyle(document.body).backgroundColor`, 'tema düğmesi → koyu (arka plan rengi)');
  await t.cek('masa-tabela-koyu');
  await t.ortam({ tema: 'dark', azHareket: false }); await t.tikla('#tema'); await t.uyu(300);
  await bak(`document.documentElement.dataset.theme==='light' && getComputedStyle(document.body).backgroundColor`, 'sistem koyu iken düğme → açık');
  // yön değiştirme (düğmeyle) ve durumun yönler arasında taşınması
  await t.ortam({ tema: 'light', azHareket: false });
  await t.git(ONIZLEME, '#sahne'); await t.uyu(1500);
  await t.tikla('#yon-cetvel'); await t.uyu(1200);
  await t.tikla('.c-k[data-id="vardiya"] [data-a="bitir"]'); await t.uyu(400);
  await t.tikla('#yon-tabela'); await t.uyu(1500);
  await bak(`document.querySelector('.t-s[data-id="vardiya"] .t-f-durum').textContent==='BİTTİ' && location.hash==='#tabela'`, 'yönler arası durum korunuyor, kare #tabela');
  await t.tikla('#sifirla'); await t.uyu(1200);
  await bak(`kayit('vardiya').bitti!==true`, 'sıfırla çalışıyor');

  // dar telefon
  await t.boyut(360, 700, true);
  for (const yon of ['cetvel', 'sahne', 'tabela']) {
    await t.git(ONIZLEME, '#' + yon); await t.uyu(1600);
    console.log('  360px', yon, JSON.stringify(await t.js(tasma)));
    await t.cek('dar-' + yon);
  }
  await t.tikla('#kunye-ac'); await t.uyu(300); await t.cek('dar-kunye');
  await bak(`document.querySelector('#kunye').classList.contains('acik') && document.documentElement.scrollWidth<=360`, 'künye açılıyor, taşma yok');
  await t.tikla('#kunye-ac');
  // 360'ta açık katmanlarda taşma
  await t.git(ONIZLEME, '#sahne'); await t.uyu(1500);
  await t.tikla('.s-p--buyuk [data-a="ac"]'); await t.uyu(900); console.log('  360px sahne ayrıntı', JSON.stringify(await t.js(tasma)));
  await t.tikla('.s-a-kapat'); await t.uyu(600); await t.tikla('.s-arti'); await t.uyu(900); console.log('  360px sahne yeni', JSON.stringify(await t.js(tasma))); await t.cek('dar-sahne-yeni');
  await t.git(ONIZLEME, '#tabela'); await t.uyu(1500);
  await t.tikla('.t-alt [data-a="yaz"]'); await t.uyu(500); console.log('  360px tabela yaz', JSON.stringify(await t.js(tasma))); await t.cek('dar-tabela-yaz');
  await t.git(ONIZLEME, '#cetvel'); await t.uyu(1500);
  await t.tikla('.c-ekle'); await t.uyu(700); console.log('  360px cetvel yeni', JSON.stringify(await t.js(tasma)));

  // azaltılmış hareket: geçişler anında bitmeli, durumlar doğru olmalı
  await t.boyut(390, 844, true);
  await t.ortam({ tema: 'light', azHareket: true });
  await t.git(ONIZLEME, '#sahne'); await t.uyu(600);
  await bak(`az()===true && document.getAnimations().filter(a=>a.playState==='running' && a.effect.getTiming().iterations!==Infinity).length===0`, 'az hareket: açılışta süren geçiş yok');
  await bak(`[...document.querySelectorAll('.rs-kopuk circle')].every(c=>parseFloat(getComputedStyle(c).animationDuration)<0.001)`, 'az hareket: süs döngüleri kapalı');
  await t.tikla('.s-p[data-id="araba"] [data-a="bitir"]'); await t.uyu(200);
  await bak(`kayit('araba').bitti===true && !!document.querySelector('.s-b[data-id="araba"]')`, 'az hareket: tamamlama anında');
  await t.tikla('.s-p--buyuk [data-a="ac"]'); await t.uyu(150); await t.cek('az-sahne-ayrinti');
  await bak(`!!document.querySelector('.s-ayr') && getComputedStyle(document.querySelector('.s-a-ic h2')).opacity==='1'`, 'az hareket: ayrıntı anında görünür');
  await t.git(ONIZLEME, '#tabela'); await t.uyu(500);
  await t.tikla('.t-s[data-id="market"] [data-a="bitir"]'); await t.uyu(150);
  await bak(`document.querySelector('.t-s[data-id="market"] .t-f-durum').textContent==='BİTTİ'`, 'az hareket: kanat anında');
  await t.git(ONIZLEME, '#cetvel'); await t.uyu(500);
  await bak(`document.querySelector('.c-gun').scrollTop>100`, 'az hareket: cetvel şimdiye konumlu');
  await t.cek('az-cetvel');

  // fotoğraf ekleme (dosya girişi)
  await t.ortam({ tema: 'light', azHareket: false });
  await t.git(ONIZLEME, '#sahne'); await t.uyu(1500);
  await t.tikla('.s-p[data-id="market"] [data-a="ac"]'); await t.uyu(900);
  await t.js(`document.querySelector('.s-ayr').scrollTop=500`);
  await t.tikla('.s-ayr [data-a="foto-ekle"]'); await t.uyu(300);
  const o = await t.gonder('Runtime.evaluate', { expression: `document.querySelector('#foto-sec')` });
  await t.gonder('DOM.setFileInputFiles', { files: [join(CIKTI, 'dar-kunye.png')], objectId: o.result.objectId });
  await t.uyu(1200); await t.cek('foto-eklendi');
  await bak(`kayit('market').fotolar.length===2 && typeof kayit('market').fotolar[1]==='object' && document.querySelectorAll('.s-gal img.ft').length===1`, 'fotoğraf eklendi ve galeride');
  // klavye: Escape katmanı kapatır
  await t.gonder('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await t.uyu(700);
  await bak(`!document.querySelector('.s-ayr')`, 'Escape ayrıntıyı kapatır');
  console.log('HATALAR:', t.hatalar.length ? '\n' + t.hatalar.join('\n') : 'yok');
} catch (e) { console.log('SENARYO DURDU:', e.message); console.log('HATALAR:', t.hatalar.join('\n')); await t.cek('hata'); } finally { await t.kapat(); }
