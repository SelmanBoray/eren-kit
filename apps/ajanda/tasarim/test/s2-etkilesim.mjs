// Başlıca etkileşimler: her yönde tamamlama, ayrıntı, takvim, ekleme, taslak; adım adım ekran görüntüsü.
import { tarayici, ONIZLEME } from './cdp.mjs';
const hangi = process.argv[2] || 'hepsi', tema = process.argv[3] || 'light';
const t = await tarayici(9378);
const adim = async (ad, ms = 900) => { await t.uyu(ms); await t.cek(ad); };
const say = (s) => t.js(`document.querySelectorAll(${JSON.stringify(s)}).length`);
const bekle = (kosul, ad) => t.js(`(${kosul})`).then((v) => { console.log(v ? '  ok ' : '  HATA', ad, v === true ? '' : JSON.stringify(v)); });
try {
  await t.boyut(390, 844, true);
  await t.ortam({ tema, azHareket: false });

  if (hangi === 'hepsi' || hangi === 'cetvel') {
    console.log('CETVEL');
    await t.git(ONIZLEME, '#cetvel'); await t.uyu(1500);
    await t.tikla('.c-k[data-id="vardiya"] [data-a="bitir"]'); await adim('c1-bitir', 700);
    await bekle(`kayit('vardiya').bitti===true && document.querySelector('.c-k[data-id="vardiya"]').classList.contains('bitti')`, 'vardiya bitti');
    await t.tikla('.c-k[data-id="vardiya"] [data-a="bitir"]');
    await t.js(`document.querySelector('.c-gun').scrollTop=0`);
    await t.tikla('.c-k[data-id="araba"] [data-a="ac"]'); await adim('c2-ayrinti', 900);
    await bekle(`!!document.querySelector('.c-ayr')`, 'ayrıntı açıldı');
    await t.js(`document.querySelector('.c-a-ic').scrollTop=420`); await adim('c3-ayrinti-alt', 300);
    await t.tikla('.c-ayr [data-a="foto"]'); await adim('c3b-isik', 600);
    await t.tikla('.isik'); await t.uyu(400);
    await t.tikla('.c-ayr [data-a="kapat"]'); await t.uyu(500);
    await bekle(`!document.querySelector('.c-ayr')`, 'ayrıntı kapandı');
    await t.tikla('.c-gecis [data-g="takvim"]'); await adim('c4-ay', 700);
    await t.tikla('.c-h[data-t="2026-11-30"]'); await adim('c5-ay-30', 700);
    await bekle(`D.secili==='2026-11-30' && document.querySelector('.c-no').textContent==='30'`, 'gün seçildi, başlık 30');
    await t.tikla('.c-ay-ok [data-d="1"]'); await adim('c6-aralik', 600);
    await t.tikla('.c-gecis [data-g="gun"]'); await adim('c7-gun-30', 800);
    await t.tikla('.c-gecis [data-g="takvim"]'); await t.uyu(500);
    await t.tikla('.c-h[data-t="2026-11-27"]'); await t.uyu(300); await t.tikla('.c-gecis [data-g="gun"]'); await t.uyu(700);
    await t.tikla('.c-ekle'); await adim('c8-ekle', 800);
    await t.js(`(()=>{const k=document.querySelector('.c-mezura-kay'); k.scrollLeft += 18*6; })()`); await t.uyu(300);
    const okuma = await t.js(`document.querySelector('.c-okuma').textContent`); console.log('  mezura okuma:', okuma);
    await t.js(`document.querySelector('#c-baslik').focus()`); await t.yaz('Lastik değişimi'); await adim('c9-ekle-dolu', 300);
    await t.js(`document.querySelector('.c-yeni').requestSubmit()`); await adim('c10-eklendi', 1200);
    await bekle(`D.kayitlar.some(k=>k.baslik==='Lastik değişimi' && k.saat==='${okuma}' && k.gorsel==='araba')`, 'kayıt eklendi (saat mezuradan, simge öneri)');
    await t.tikla('.c-cep'); await adim('c11-cep', 700);
    await t.tikla('.c-cepk [data-a="bitir"]'); await t.uyu(500);
    await bekle(`document.querySelector('.c-cep').textContent.includes('2 iş')`, 'cep sayacı 2');
    await t.tikla('.c-perde'); await t.uyu(500);
    await t.js(`document.querySelector('.c-gun').scrollTop=180`);
    await t.tikla('.c-k[data-id="eczane"] [data-a="onayla"]'); await adim('c12-onay', 800);
    await bekle(`kayit('eczane').taslak===false && !document.querySelector('.c-k.taslak')`, 'taslak onaylandı');
  }

  if (hangi === 'hepsi' || hangi === 'sahne') {
    console.log('SAHNE');
    await t.git(ONIZLEME, '#sahne'); await t.uyu(1700);
    await t.js(`document.querySelector('.s-bugun').scrollTop=620`); await adim('s1-alt', 400);
    await t.tikla('.s-p[data-id="araba"] [data-a="bitir"]'); await adim('s2-bitir-an', 380); await adim('s3-bitti', 1300);
    await bekle(`kayit('araba').bitti===true && !!document.querySelector('.s-b[data-id="araba"]')`, 'araba bitti, Bitenler\'e geçti');
    await t.tikla('.s-p[data-id="eczane"] [data-a="onayla"]'); await adim('s4-onay-an', 450); await adim('s5-onaylandi', 1400);
    await bekle(`kayit('eczane').taslak===false && !document.querySelector('.s-p.eskiz')`, 'taslak onaylandı');
    await t.js(`document.querySelector('.s-bugun').scrollTop=0`);
    await t.tikla('.s-p[data-id="vardiya"] [data-a="ac"]'); await adim('s6-ayrinti-an', 200); await adim('s7-ayrinti', 1100);
    await t.js(`document.querySelector('.s-ayr').scrollTop=430`); await adim('s8-ayrinti-alt', 400);
    await t.js(`document.querySelector('.s-ayr').scrollTop=900`); await adim('s8b-ayrinti-son', 400);
    await t.js(`document.querySelector('.s-ayr').scrollTop=0`); await t.uyu(200);
    await t.tikla('.s-a-sec [data-k="foto"]'); await adim('s9-kapak-foto', 900);
    await t.tikla('.s-a-kapat'); await adim('s10-kapandi', 900);
    await bekle(`!document.querySelector('.s-ayr') && !!document.querySelector('.s-p.kapak-foto[data-id="vardiya"]')`, 'ayrıntı kapandı, levha fotoğraf kapaklı');
    await t.tikla('.s-alt [data-g="takvim"]'); await adim('s11-takvim', 900);
    await t.tikla('.s-g[data-t="2026-11-30"]'); await adim('s12-takvim-30', 900);
    await t.tikla('.s-t-ok [data-d="1"]'); await adim('s13-aralik', 800);
    await t.tikla('.s-t-ok [data-d="-1"]'); await t.uyu(600);
    await t.tikla('.s-alt [data-g="bugun"]'); await t.uyu(700);
    await t.tikla('.s-arti'); await adim('s14-ekle', 1000);
    await t.js(`document.querySelector('#s-baslik').focus()`); await t.yaz('Dişçi kontrolü'); await adim('s15-ekle-dis', 900);
    await bekle(`document.querySelector('.s-yeni').classList.contains('r-pembe') && !!document.querySelector('.s-y-sahne .rs-dis')`, 'başlığa göre çizim ve renk geldi');
    await t.tikla('.s-y-tur [data-t="bolum"]'); await adim('s16-ekle-bolum', 600);
    await t.js(`document.querySelector('.s-y-form').requestSubmit()`); await adim('s17-eklendi', 1500);
    await bekle(`D.kayitlar.some(k=>k.baslik==='Dişçi kontrolü' && k.bolum==='aksam') && !document.querySelector('.s-yeni')`, 'kayıt eklendi');
    // aşağı çekerek kapatma (dokunma)
    await t.js(`document.querySelector('.s-bugun').scrollTop=0`); await t.uyu(200);
    await t.tikla('.s-p--buyuk [data-a="ac"]'); await t.uyu(1000);
    await t.dokun([[195, 250], [195, 270], [195, 300], [195, 340], [195, 390], [195, 440]], 30); await adim('s18-cek-kapat', 80);
    await t.uyu(700);
    await bekle(`!document.querySelector('.s-ayr')`, 'aşağı çekince kapandı');
  }

  if (hangi === 'hepsi' || hangi === 'tabela') {
    console.log('TABELA');
    await t.git(ONIZLEME, '#tabela'); await t.uyu(1700);
    await t.tikla('.t-ay-d'); await adim('t1-ay', 700);
    await t.tikla('.t-g[data-t="2026-11-30"]'); await adim('t2-gun30-an', 150); await adim('t3-gun30', 900);
    await bekle(`D.secili==='2026-11-30' && document.querySelector('.t-bas [data-b="no"]').textContent==='30' && document.querySelector('.t-bas [data-b="gun"]').textContent==='PZT'`, 'gün seçildi, başlık kanatları');
    await t.tikla('.t-g[data-t="2026-11-27"]'); await t.uyu(900); await t.tikla('.t-ay-d'); await t.uyu(500);
    await t.tikla('.t-s[data-id="market"] [data-a="bitir"]'); await adim('t4-bitir-an', 160); await adim('t5-bitti', 1500);
    await bekle(`kayit('market').bitti===true && document.querySelector('.t-s[data-id="market"] .t-f-durum').textContent==='BİTTİ'`, 'market bitti, kanat BİTTİ');
    // satırı sağa çekerek tamamla (dokunma)
    const r = await t.js(`(()=>{const e=document.querySelector('.t-s[data-id="araba"] .t-s-ic').getBoundingClientRect(); return [e.left+150, e.top+e.height/2];})()`);
    await t.dokun([[r[0], r[1]], [r[0] + 20, r[1]], [r[0] + 50, r[1]], [r[0] + 90, r[1]], [r[0] + 120, r[1]]], 30); await adim('t6-cek', 50);
    await t.uyu(1500);
    await bekle(`kayit('araba').bitti===true`, 'sağa çekince araba bitti');
    await t.tikla('.t-s[data-id="eczane"] [data-a="onayla"]'); await adim('t7-onay', 1400);
    await bekle(`kayit('eczane').taslak===false`, 'taslak onaylandı');
    await t.tikla('.t-s[data-id="vardiya"] [data-a="ac"]'); await adim('t8-dosya-an', 140); await adim('t9-dosya', 900);
    await t.tikla('.t-sekmeler [data-s="foto"]'); await adim('t10-fotolar', 600);
    await t.tikla('.t-sekmeler [data-s="bag"]'); await adim('t11-baglantilar', 600);
    await t.tikla('.t-sekmeler [data-s="hat"]'); await adim('t12-hatirlatma', 600);
    await t.tikla('.t-dosya [data-a="kapat"]'); await t.uyu(600);
    await bekle(`!document.querySelector('.t-dosya')`, 'dosya kapandı');
    await t.tikla('.t-alt [data-a="yaz"]'); await adim('t13-yaz', 600);
    await t.tikla('.t-yaz [data-y="arti"]'); await t.tikla('.t-yaz [data-y="arti"]'); await t.uyu(500);
    await t.js(`document.querySelector('#t-baslik').focus()`); await t.yaz('Kargo iadesi'); await adim('t14-yaz-dolu', 300);
    await t.js(`document.querySelector('.t-yaz').requestSubmit()`); await adim('t15-eklendi', 1300);
    await bekle(`D.kayitlar.some(k=>k.baslik==='Kargo iadesi' && k.saat==='13:30' && k.gorsel==='kutu')`, 'kayıt eklendi 13:30');
  }
  console.log('HATALAR:', t.hatalar.length ? '\n' + t.hatalar.join('\n') : 'yok');
} catch (e) { console.log('SENARYO DURDU:', e.message); console.log('HATALAR:', t.hatalar.join('\n')); await t.cek('hata'); } finally { await t.kapat(); }
