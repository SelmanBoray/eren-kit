'use strict';
// Telefonsuz doğrulama. Pozitif yol ayrı sınama örneğinde (Tailscale IP'si, 47898, izinli = PC) koşar;
// gerçek sunucu kurala uygun olarak PC'yi reddetmeli, bu da negatif sınamadır.
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');

const HOST = process.env.EREN_PC_IP || '127.0.0.1';
const SINAMA_PORT = 47898;
const GIZLI = 'GIZLI-OZTEST-METNI';
const dizin = fs.mkdtempSync(path.join(__dirname, '.oztest-'));
const ortam = {
  ...process.env,
  EREN_PC_IP: HOST,
  EREN_PORT: String(SINAMA_PORT),
  EREN_TELEFON_IP: HOST,
  EREN_BORU: '\\\\.\\pipe\\eren-deneme-oztest',
  EREN_LOG: path.join(dizin, 'log.jsonl'),
  EREN_CIKTI: path.join(dizin, 'cikti'),
};

let hataSayisi = 0;
function sina(ad, kosul, ayrinti) {
  console.log(`${kosul ? 'GECTI' : 'KALDI'}  ${ad}${ayrinti ? `  (${ayrinti})` : ''}`);
  if (!kosul) hataSayisi++;
}
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
// Eşzamansız olmak zorunda: sahte telefon bu süreçte yaşıyor, spawnSync onu da kilitler.
function cli(...a) {
  return new Promise((coz) => {
    const c = spawn(process.execPath, [path.join(__dirname, 'cli.js'), ...a], { env: ortam });
    let cikti = '';
    c.stdout.on('data', (d) => { cikti += d; });
    c.stderr.on('data', (d) => { cikti += d; });
    c.on('close', (kod) => coz({ kod, cikti }));
  });
}
function logSatirlari() {
  return fs.readFileSync(ortam.EREN_LOG, 'utf8').split('\n').filter(Boolean).map((s) => JSON.parse(s));
}

// Telefon taklidi: gerçek uygulamanın yanıt biçimini verir, kapı kararı telefonda olduğu için ret de üretir.
const PNG1 = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');
function sahteTelefon(url) {
  return new Promise((coz, red) => {
    const ws = new WebSocket(url);
    ws.on('error', red);
    ws.on('open', () => {
      ws.send(JSON.stringify({ t: 'hello', ts: Date.now(), model: 'sahte', sdk: 36, surec_yasi_ms: 5, surec_sayaci: 1, servis_sayaci: 1, toplam_baglanti: 1, son_kopma: null, a11y: true, wl: true }));
      ws.send(JSON.stringify({ t: 'ping', n: 1, ts: Date.now(), uyku_ms: 0, ekran: true, idle: false, pil: 90, sarj: false, wl: true, ag: 'wifi+vpn', surec_yasi_ms: 5 }));
      coz(ws);
    });
    ws.on('message', (ham) => {
      const m = JSON.parse(ham.toString());
      if (m.t !== 'cmd') return;
      const g = { t: 'res', id: m.id, name: m.name, ok: true, ms: 1 };
      if (m.name === 'foreground') g.fg = 'dev.eren.deneme';
      if (m.name === 'status') g.payload = { surec_yasi_ms: 5 };
      if (m.name === 'elements') {
        Object.assign(g, { fg: 'dev.eren.deneme', sayi: 2, gezilen: 9, kirpildi: false, dugumler: [
          { id: 1, role: 'button', text: 'Say', isPassword: false, hasText: true, bounds: [0, 0, 100, 50], clickable: true },
          { id: 2, role: 'textbox', isPassword: true, hasText: true, bounds: [0, 60, 100, 110], editable: true },
        ] });
      }
      if (m.name === 'screenshot') Object.assign(g, { capture_ms: 3, encode_ms: 2, w: 1, h: 1, bytes: 4, ort_parlaklik: 0, siyah_orani: 1, jpeg_b64: PNG1 });
      if (m.name === 'type') Object.assign(g, { isPassword: true, text_set: true });
      if (m.name === 'tap') Object.assign(g, { ok: false, denied: true, reason: 'foreground_not_self', fg: 'com.diger' });
      ws.send(JSON.stringify(g));
    });
  });
}

function httpDurum(url) {
  return new Promise((coz) => {
    http.get(url, (r) => { r.resume(); coz(r.statusCode); }).on('error', (e) => coz(`hata:${e.code}`));
  });
}
function wsSonuc(url) {
  return new Promise((coz) => {
    const ws = new WebSocket(url);
    ws.on('open', () => { ws.close(); coz('acildi'); });
    ws.on('unexpected-response', (_q, r) => coz(`http_${r.statusCode}`));
    ws.on('error', (e) => coz(`hata:${e.code || e.message}`));
  });
}

async function ana() {
  const sunucu = spawn(process.execPath, [path.join(__dirname, 'sunucu.js')], { env: ortam, stdio: 'pipe' });
  sunucu.stderr.on('data', (d) => process.stderr.write(d));
  await bekle(800);
  try {
    const t0 = Date.now();
    const tel = await sahteTelefon(`ws://${HOST}:${SINAMA_PORT}/`);
    sina('sinama ornegine WS baglantisi', tel.readyState === WebSocket.OPEN, `${Date.now() - t0} ms`);
    await bekle(150);

    const durum = JSON.parse((await cli('durum')).cikti);
    sina('CLI durum baglantiyi goruyor', durum.baglanti && durum.baglanti.ping === 1);

    const fg = await cli('foreground');
    sina('foreground gidis donus', fg.kod === 0 && fg.cikti.includes('dev.eren.deneme'), fg.cikti.match(/rtt_sunucu_ms=\S+/)?.[0]);
    const el = await cli('elements');
    sina('elements satir bicimi', el.cikti.includes('[1] button "Say"') && el.cikti.includes('[2] textbox <parola hasText=true>'));
    const ek = await cli('screenshot');
    sina('screenshot dosyaya yazildi', ek.kod === 0 && fs.readdirSync(ortam.EREN_CIKTI).length === 1);
    const ty = await cli('type', '2', GIZLI);
    sina('type yaniti metni yankilamiyor', ty.kod === 0 && !ty.cikti.includes(GIZLI));
    const tp = await cli('tap', '10', '10');
    sina('denied CLIye geliyor, cikis kodu 1', tp.kod === 1 && tp.cikti.includes('foreground_not_self'));
    const bu = await cli('burst', '3');
    const buSatir = bu.cikti.split(/\r?\n/).filter((s) => s.startsWith('#') && s.includes('ok=true'));
    sina('burst paralel 3 basarili yanit', buSatir.length === 3);

    const sonuc = new Promise((coz) => tel.on('close', coz));
    tel.close();
    await sonuc;
    await bekle(200);
    const kopuk = await cli('foreground');
    sina('kopukken telefon_bagli_degil, kuyruk yok', kopuk.kod === 1 && kopuk.cikti.includes('telefon_bagli_degil'));

    await bekle(100);
    const satirlar = logSatirlari();
    const ham = fs.readFileSync(ortam.EREN_LOG, 'utf8');
    for (const ev of ['start', 'conn', 'hello', 'ping', 'cmd', 'res', 'disc', 'cmd_red']) {
      sina(`log olayi: ${ev}`, satirlar.some((s) => s.ev === ev));
    }
    sina('log metni icermiyor (text_len var)', !ham.includes(GIZLI) && satirlar.some((s) => s.args && s.args.text_len === GIZLI.length));
    sina('log ekran goruntusu icermiyor', !ham.includes('jpeg_b64'));
    sina('log oge icerigi icermiyor', !ham.includes('"Say"'));
    const oz = JSON.parse((await cli('ozet')).cikti);
    sina('ozet calisiyor', oz.baglanti === 1 && oz.ping === 1);
    sina('kopma nedeni gunlukte korunuyor', oz.kopma.length === 1 && oz.kopma[0].neden === 'close' && typeof oz.kopma[0].kod === 'number', JSON.stringify(oz.kopma[0] || {}));
    const apkBoy = await new Promise((coz) => {
      http.get(`http://${HOST}:${SINAMA_PORT}/deneme.apk`, (r) => {
        let n = 0;
        r.on('data', (d) => { n += d.length; });
        r.on('end', () => coz({ kod: r.statusCode, n }));
      }).on('error', (e) => coz({ kod: e.code, n: 0 }));
    });
    const gercekBoy = fs.statSync(path.join(__dirname, '..', 'deneme.apk')).size;
    sina('izinli IP APK yedek yolunu indirebiliyor', apkBoy.kod === 200 && apkBoy.n === gercekBoy, `${apkBoy.kod}, ${apkBoy.n} bayt`);
  } finally {
    sunucu.kill();
  }

  // Gerçek sunucu: PC IP'si izinli değil, reddedilmeli.
  const gercekWs = await wsSonuc(`ws://${HOST}:47800/`);
  sina('gercek sunucu PC kaynakli WS reddediyor', gercekWs === 'http_403', gercekWs);
  const gercekApk = await httpDurum(`http://${HOST}:47800/deneme.apk`);
  sina('gercek sunucu PC kaynakli APK indirmeyi reddediyor', gercekApk === 403, String(gercekApk));

  fs.rmSync(dizin, { recursive: true, force: true });
  console.log(hataSayisi ? `\n${hataSayisi} KALDI` : '\nHEPSI GECTI');
  process.exit(hataSayisi ? 1 : 0);
}

ana().catch((e) => { console.error(e); process.exit(3); });
