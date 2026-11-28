// Parçaları tek dosyada birleştirir: ajanda-yonler.html (yayımlanacak) ve test/onizleme.html (yerel sınama için iskeletle sarılı).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const kok = join(dirname(fileURLToPath(import.meta.url)), '..');
const oku = (ad) => readFileSync(join(kok, 'parca', ad), 'utf8');
const koyu = oku('11-koyu.css').trimEnd();
const koyuBlok = `@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){\n${koyu}\n}}\n:root[data-theme="dark"]{\n${koyu}\n}`;
const css = [oku('10-kabuk.css').replace('/*KOYU*/', koyuBlok), oku('20-cetvel.css'), oku('30-sahne.css'), oku('40-tabela.css')].join('\n');
const js = ['50-ortak.js', '60-cetvel.js', '70-sahne.js', '80-tabela.js', '90-baslat.js'].map(oku).join('\n');
const fontlar = 'https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&family=Barlow:wght@400;500;600&family=Barlow+Condensed:wght@400;500;600;700&family=Bricolage+Grotesque:opsz,wght@12..96,200..800&display=swap';
const sayfa = `<title>Ajanda Yönleri</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="${fontlar}">
<style>
${css}
</style>
${oku('45-govde.html')}
<script>
${js}
</script>
`;
writeFileSync(join(kok, 'ajanda-yonler.html'), sayfa);
const iskelet = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>:root{color-scheme:light;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style></head><body>${sayfa}</body></html>`;
writeFileSync(join(kok, 'test', 'onizleme.html'), iskelet);
console.log('yazıldı', (Buffer.byteLength(sayfa) / 1024).toFixed(1), 'KB');
