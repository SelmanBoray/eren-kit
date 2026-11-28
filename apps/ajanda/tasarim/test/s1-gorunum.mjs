// Üç yön × iki tema: ilk kare, konsol hatası, yatay taşma.
import { tarayici, ONIZLEME } from './cdp.mjs';
const t = await tarayici();
try {
  await t.boyut(390, 844, true);
  for (const tema of ['light', 'dark']) {
    await t.ortam({ tema, azHareket: false });
    for (const yon of ['cetvel', 'sahne', 'tabela']) {
      await t.git(ONIZLEME, '#' + yon);
      await t.uyu(1600);
      const o = await t.js(`({yon: document.querySelector('#app').className, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, bsw: document.body.scrollWidth, font: [...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family).filter((v,i,a)=>a.indexOf(v)===i).join('|')})`);
      console.log(tema, yon, JSON.stringify(o));
      await t.cek(`${yon}-${tema}`);
    }
  }
  console.log('HATALAR:', t.hatalar.length ? '\n' + t.hatalar.join('\n') : 'yok');
} finally { await t.kapat(); }
