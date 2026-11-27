// Masaüstünde gerçek fare sürüklemeleri: mezura, alt kâğıt tutamağı, ay kaydırma, satır çekme.
import { tarayici, ONIZLEME } from './cdp.mjs';
const t = await tarayici(9381);
const bak = async (kosul, ad) => { const v = await t.js(`(${kosul})`); console.log(v === true ? '  ok ' : '  HATA', ad, v === true ? '' : JSON.stringify(v)); };
const orta = (s) => t.js(`(()=>{const r=document.querySelector(${JSON.stringify(s)}).getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2];})()`);
try {
  await t.boyut(1280, 900, false); await t.ortam({ tema: 'light', azHareket: false });
  await t.git(ONIZLEME, '#cetvel'); await t.uyu(1600);
  await t.tikla('.c-ekle'); await t.uyu(700);
  let [x, y] = await orta('.c-mezura-kay');
  await t.fare([[x, y], [x - 20, y], [x - 60, y], [x - 100, y], [x - 144, y]], 30); await t.uyu(700);
  await bak(`document.querySelector('.c-okuma').textContent==='15:00'`, 'mezura fareyle sürüklendi: ' + await t.js(`document.querySelector('.c-okuma').textContent`));
  [x, y] = await orta('.c-tutamak');
  await t.fare([[x, y], [x, y + 30], [x, y + 80], [x, y + 140], [x, y + 200]], 30); await t.uyu(700);
  await bak(`!document.querySelector('.c-kagit')`, 'kâğıt tutamaktan aşağı çekilince kapandı');
  await t.tikla('.c-gecis [data-g="takvim"]'); await t.uyu(600);
  [x, y] = await orta('.c-izgara');
  await t.fare([[x, y], [x - 30, y], [x - 70, y], [x - 110, y]], 30); await t.uyu(700);
  await bak(`D.ay.m===11`, 'ay ızgarası sola çekilince Aralık');
  await t.git(ONIZLEME, '#tabela'); await t.uyu(1600);
  [x, y] = await orta('.t-s[data-id="araba"] .t-s-ad');
  await t.fare([[x, y], [x + 30, y], [x + 70, y], [x + 110, y]], 30); await t.uyu(1400);
  await bak(`kayit('araba').bitti===true && !document.querySelector('.t-dosya')`, 'satır fareyle sağa çekildi, ayrıntı açılmadı');
  await t.git(ONIZLEME, '#sahne'); await t.uyu(1600);
  await t.tikla('.s-p--buyuk [data-a="ac"]'); await t.uyu(1000);
  [x, y] = await orta('.s-a-kapak');
  await t.fare([[x, y], [x, y + 40], [x, y + 90], [x, y + 150], [x, y + 200]], 30); await t.uyu(800);
  await bak(`!document.querySelector('.s-ayr')`, 'ayrıntı fareyle aşağı çekilince kapandı');
  await t.tikla('.s-alt [data-g="takvim"]'); await t.uyu(800);
  [x, y] = await orta('.s-t-izgara');
  await t.fare([[x, y], [x + 30, y], [x + 70, y], [x + 110, y]], 30); await t.uyu(800);
  await bak(`D.ay.m===9`, 'sahne takvimi sağa çekilince Ekim');
  console.log('HATALAR:', t.hatalar.length ? '\n' + t.hatalar.join('\n') : 'yok');
} catch (e) { console.log('SENARYO DURDU:', e.message); await t.cek('hata'); } finally { await t.kapat(); }
