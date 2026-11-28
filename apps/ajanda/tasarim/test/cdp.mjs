// Başsız Chrome'u CDP ile süren küçük sınama yardımcısı (bağımlılık yok; Node 22+ WebSocket).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const burasi = dirname(fileURLToPath(import.meta.url));
export const CIKTI = join(burasi, 'cikti');
mkdirSync(CIKTI, { recursive: true });
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const uyu = (ms) => new Promise((r) => setTimeout(r, ms));

export async function tarayici(port = 9377) {
  const profil = join(burasi, 'profil-' + port);
  const surec = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profil}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
  let surum;
  for (let i = 0; i < 60; i++) { try { surum = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; } catch (_) { await uyu(250); } }
  if (!surum) throw new Error('Chrome başlamadı');
  const hedefler = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const sayfa = hedefler.find((h) => h.type === 'page');
  const ws = new WebSocket(sayfa.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let no = 0; const bekleyen = new Map(); const hatalar = []; const gunluk = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && bekleyen.has(d.id)) { const { r, j } = bekleyen.get(d.id); bekleyen.delete(d.id); d.error ? j(new Error(d.error.message)) : r(d.result); return; }
    if (d.method === 'Runtime.exceptionThrown') hatalar.push('İSTİSNA: ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
    if (d.method === 'Runtime.consoleAPICalled') { const t = d.params.args.map((a) => a.value ?? a.description ?? '').join(' '); gunluk.push(`[${d.params.type}] ${t}`); if (d.params.type === 'error') hatalar.push('KONSOL: ' + t); }
    if (d.method === 'Log.entryAdded' && (d.params.entry.level === 'error' || d.params.entry.level === 'warning')) hatalar.push(`GÜNLÜK(${d.params.entry.level}): ${d.params.entry.text} ${d.params.entry.url || ''}`);
  };
  const gonder = (method, params = {}) => new Promise((r, j) => { const id = ++no; bekleyen.set(id, { r, j }); ws.send(JSON.stringify({ id, method, params })); });
  await gonder('Runtime.enable'); await gonder('Log.enable'); await gonder('Page.enable');
  const t = {
    hatalar, gunluk, gonder, uyu,
    async boyut(w, h, mobil = true) { await gonder('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: mobil }); await gonder('Emulation.setTouchEmulationEnabled', { enabled: mobil }); },
    async ortam({ tema, azHareket } = {}) { const f = []; if (tema) f.push({ name: 'prefers-color-scheme', value: tema }); if (azHareket != null) f.push({ name: 'prefers-reduced-motion', value: azHareket ? 'reduce' : 'no-preference' }); await gonder('Emulation.setEmulatedMedia', { features: f }); },
    async git(dosya, kare = '') { await gonder('Page.navigate', { url: 'about:blank' }); await uyu(200); await gonder('Page.navigate', { url: pathToFileURL(dosya).href + kare }); await uyu(1500); },
    async js(ifade) { const s = await gonder('Runtime.evaluate', { expression: ifade, awaitPromise: true, returnByValue: true }); if (s.exceptionDetails) throw new Error('js: ' + (s.exceptionDetails.exception?.description || s.exceptionDetails.text) + '\n  ' + ifade); return s.result.value; },
    async tikla(secici, n = 0) { const ok = await t.js(`(()=>{const e=document.querySelectorAll(${JSON.stringify(secici)})[${n}]; if(!e) return false; e.click(); return true;})()`); if (!ok) throw new Error('bulunamadı: ' + secici); },
    async cek(ad) { const s = await gonder('Page.captureScreenshot', { format: 'png' }); const yol = join(CIKTI, ad + '.png'); writeFileSync(yol, Buffer.from(s.data, 'base64')); return yol; },
    async fare(noktalar, adimMs = 16) { // gerçek işaretçi sürüklemesi
      const [ilk, ...kalan] = noktalar;
      await gonder('Input.dispatchMouseEvent', { type: 'mousePressed', x: ilk[0], y: ilk[1], button: 'left', clickCount: 1 });
      for (const [x, y] of kalan) { await gonder('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 }); await uyu(adimMs); }
      const son = noktalar[noktalar.length - 1];
      await gonder('Input.dispatchMouseEvent', { type: 'mouseReleased', x: son[0], y: son[1], button: 'left', clickCount: 1 });
    },
    async dokun(noktalar, adimMs = 16) {
      const [ilk, ...kalan] = noktalar;
      await gonder('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: ilk[0], y: ilk[1] }] });
      for (const [x, y] of kalan) { await gonder('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }); await uyu(adimMs); }
      await gonder('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    },
    async yaz(metin) { await gonder('Input.insertText', { text: metin }); },
    async kapat() { try { await gonder('Browser.close'); } catch (_) {} ws.close(); await uyu(400); try { surec.kill(); } catch (_) {} await uyu(300); try { rmSync(profil, { recursive: true, force: true }); } catch (_) {} },
  };
  return t;
}
export const ONIZLEME = join(burasi, 'onizleme.html');
