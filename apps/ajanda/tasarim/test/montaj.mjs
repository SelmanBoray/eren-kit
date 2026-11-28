// Ekran görüntülerini yan yana tek karede toplar: node montaj.mjs cikis ad1 ad2 ...
import { tarayici, CIKTI } from './cdp.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [cikis, ...adlar] = process.argv.slice(2);
const oran = +(process.env.ORAN || (844 / 390)); const gen = 380, yuk = Math.round(gen * oran);
const html = `<!doctype html><body style="margin:0;display:flex;gap:6px;background:#888">${adlar.map((a) => `<img src="${pathToFileURL(join(CIKTI, a + '.png')).href}" style="width:${gen}px;height:${yuk}px">`).join('')}</body>`;
const yol = join(CIKTI, '_montaj.html');
writeFileSync(yol, html);
const t = await tarayici(9379);
try {
  await t.gonder('Emulation.setDeviceMetricsOverride', { width: adlar.length * (gen + 6) - 6, height: yuk, deviceScaleFactor: 1, mobile: false });
  await t.git(yol); await t.uyu(500);
  console.log(await t.cek(cikis));
} finally { await t.kapat(); }
