'use strict';
// Telefon denemesi test sunucusu. Telefon WebSocket ile bağlanır, CLI adlandırılmış boruyla konuşur.
// Komutlar kuyruklanmaz: kopuksa telefon_bagli_degil, koptuysa belirsiz (kararlar.md ile aynı).
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { WebSocketServer } = require('ws');

const CFG = {
  host: process.env.EREN_PC_IP || '127.0.0.1',
  port: Number(process.env.EREN_PORT || 47800),
  izinli: new Set((process.env.EREN_TELEFON_IP || '').split(',')),
  boru: process.env.EREN_BORU || '\\\\.\\pipe\\eren-deneme',
  log: process.env.EREN_LOG || path.join(__dirname, 'log.jsonl'),
  apk: path.join(__dirname, '..', 'deneme.apk'),
};
const PING_MS = 30_000;
const SESSIZLIK_MS = 120_000;

const logAkisi = fs.createWriteStream(CFG.log, { flags: 'a' });
function kaydet(ev, alanlar) {
  const ts = Date.now();
  logAkisi.write(JSON.stringify({ ts, iso: new Date(ts).toISOString(), ev, ...alanlar }) + '\n');
}

function ipAl(soket) {
  return (soket.remoteAddress || '').replace(/^::ffff:/, '');
}

let aktif = null;
let baglantiNo = 0;
let komutNo = 0;
const bekleyen = new Map();

// Günlüğe yalnız ölçüm girer: metin, öğe içeriği ve ekran görüntüsü girmez.
function argOzet(ad, args) {
  if (ad !== 'type') return args;
  const { text, ...kalan } = args || {};
  return { ...kalan, text_len: typeof text === 'string' ? text.length : null };
}
function yanitOzet(m) {
  const o = {
    name: m.name, ok: m.ok, denied: m.denied, reason: m.reason, err: m.err,
    code: m.code, code_name: m.code_name, ms: m.ms, fg: m.fg,
  };
  if (m.name === 'status') o.payload = m.payload;
  if (m.name === 'type') { o.isPassword = m.isPassword; o.text_set = m.text_set; }
  if (m.name === 'elements') { o.sayi = m.sayi; o.gezilen = m.gezilen; o.kirpildi = m.kirpildi; }
  if (m.name === 'screenshot') {
    Object.assign(o, {
      capture_ms: m.capture_ms, encode_ms: m.encode_ms, w: m.w, h: m.h, bytes: m.bytes,
      ort_parlaklik: m.ort_parlaklik, siyah_orani: m.siyah_orani,
    });
  }
  return o;
}

function bekleyeniBitir(id, govde) {
  const b = bekleyen.get(id);
  if (!b) return;
  bekleyen.delete(id);
  clearTimeout(b.zamanlayici);
  if (!b.soket.destroyed) b.soket.write(JSON.stringify({ rid: b.rid, rtt_ms: Date.now() - b.t0, ...govde }) + '\n');
}

function kopar(b, neden, ayrinti) {
  if (b.bitti) return;
  b.bitti = true;
  clearInterval(b.pingZamanlayici);
  kaydet('disc', { no: b.no, neden, ...ayrinti, sure_ms: Date.now() - b.t0, ping: b.pingSayi, srv_pong: b.pongSayi });
  if (aktif === b) aktif = null;
  for (const [id, k] of bekleyen) {
    if (k.baglanti === b) bekleyeniBitir(id, { ok: false, err: 'belirsiz', detay: 'komut yolda iken baglanti koptu' });
  }
}

const httpSunucu = http.createServer((req, res) => {
  const ip = ipAl(req.socket);
  if (!CFG.izinli.has(ip)) {
    kaydet('http_red', { ip, url: req.url });
    res.writeHead(403).end();
    return;
  }
  if (req.method === 'GET' && req.url === '/deneme.apk' && fs.existsSync(CFG.apk)) {
    kaydet('apk_indirme', { ip });
    res.writeHead(200, {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Length': fs.statSync(CFG.apk).size,
      'Content-Disposition': 'attachment; filename="deneme.apk"',
    });
    fs.createReadStream(CFG.apk).pipe(res);
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 });

httpSunucu.on('upgrade', (req, soket, bas) => {
  const ip = ipAl(soket);
  if (!CFG.izinli.has(ip) || req.url !== '/') {
    kaydet('ws_red', { ip, url: req.url });
    soket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    soket.destroy();
    return;
  }
  soket.setKeepAlive(true, 30_000);
  wss.handleUpgrade(req, soket, bas, (ws) => baglantiAcildi(ws, ip));
});

function baglantiAcildi(ws, ip) {
  if (aktif) {
    const eski = aktif;
    kopar(eski, 'yeni_baglanti_geldi');
    eski.ws.terminate();
  }
  const b = {
    no: ++baglantiNo, ws, ip, t0: Date.now(), sonAlim: Date.now(), hello: null,
    pingSayi: 0, pongSayi: 0, bitti: false, sonPing: null,
  };
  aktif = b;
  kaydet('conn', { no: b.no, ip });

  b.pingZamanlayici = setInterval(() => {
    if (Date.now() - b.sonAlim > SESSIZLIK_MS) {
      kopar(b, 'srv_sessizlik_zaman_asimi');
      ws.terminate();
      return;
    }
    if (ws.readyState === ws.OPEN) ws.ping(String(Date.now()));
  }, PING_MS);

  // Sunucu kaynaklı WS ping'i telefonun uyanma gecikmesini ölçer: telefonun zamanlayıcısına bağlı değildir.
  ws.on('pong', (veri) => {
    b.sonAlim = Date.now();
    b.pongSayi++;
    kaydet('srv_pong', { no: b.no, rtt_ms: Date.now() - Number(veri.toString()) });
  });
  ws.on('message', (ham) => {
    b.sonAlim = Date.now();
    let m;
    try { m = JSON.parse(ham.toString()); } catch { kaydet('bozuk', { no: b.no, boy: ham.length }); return; }
    if (m.t === 'hello') {
      b.hello = m;
      kaydet('hello', { no: b.no, kurulum_ms: Date.now() - b.t0, ...m, t: undefined });
    } else if (m.t === 'ping') {
      b.pingSayi++;
      b.sonPing = m;
      kaydet('ping', { no: b.no, ...m, t: undefined });
      ws.send(JSON.stringify({ t: 'pong', n: m.n, srv_ts: Date.now() }));
    } else if (m.t === 'not') {
      kaydet('not', { no: b.no, olay: m.olay, tel_ts: m.ts });
    } else if (m.t === 'res') {
      const k = bekleyen.get(m.id);
      kaydet('res', { no: b.no, id: m.id, rtt_ms: k ? Date.now() - k.t0 : null, boy: ham.length, ...yanitOzet(m) });
      const { t, id, ...govde } = m;
      bekleyeniBitir(id, govde);
    } else {
      kaydet('bilinmeyen', { no: b.no, t: m.t });
    }
  });
  ws.on('close', (kod, metin) => kopar(b, 'close', { kod, kapanis_metni: metin.toString() || undefined }));
  ws.on('error', (e) => kaydet('ws_hata', { no: b.no, hata: e.message }));
}

function durumGovdesi() {
  return {
    ok: true,
    baglanti: aktif && {
      no: aktif.no, ip: aktif.ip, acik_ms: Date.now() - aktif.t0, son_alim_once_ms: Date.now() - aktif.sonAlim,
      ping: aktif.pingSayi, srv_pong: aktif.pongSayi, hello: aktif.hello, son_ping: aktif.sonPing,
    },
    toplam_baglanti: baglantiNo,
    pid: process.pid,
    dinleme: `${CFG.host}:${CFG.port}`,
    izinli: [...CFG.izinli],
  };
}

const boruSunucu = net.createServer((soket) => {
  let tampon = '';
  soket.on('error', () => {});
  soket.on('data', (parca) => {
    tampon += parca.toString();
    let i;
    while ((i = tampon.indexOf('\n')) >= 0) {
      const satir = tampon.slice(0, i);
      tampon = tampon.slice(i + 1);
      let m;
      try { m = JSON.parse(satir); } catch { continue; }
      boruIstegi(soket, m);
    }
  });
});

function boruIstegi(soket, m) {
  const yaz = (g) => soket.write(JSON.stringify({ rid: m.rid, ...g }) + '\n');
  if (m.op === 'durum') return yaz(durumGovdesi());
  if (m.op !== 'cmd') return yaz({ ok: false, err: 'bilinmeyen_op' });
  if (!aktif || aktif.ws.readyState !== aktif.ws.OPEN) {
    kaydet('cmd_red', { name: m.name, neden: 'telefon_bagli_degil' });
    return yaz({ ok: false, err: 'telefon_bagli_degil', rtt_ms: 0 });
  }
  const id = String(++komutNo);
  const zaman = m.timeout_ms || 20_000;
  bekleyen.set(id, {
    soket, rid: m.rid, t0: Date.now(), baglanti: aktif,
    zamanlayici: setTimeout(() => {
      kaydet('cmd_zaman_asimi', { id, name: m.name, ms: zaman });
      bekleyeniBitir(id, { ok: false, err: 'belirsiz', detay: 'yanit gelmedi' });
    }, zaman),
  });
  kaydet('cmd', { no: aktif.no, id, name: m.name, args: argOzet(m.name, m.args) });
  aktif.ws.send(JSON.stringify({ t: 'cmd', id, name: m.name, args: m.args || {} }));
}

process.on('uncaughtException', (e) => {
  kaydet('istisna', { hata: String(e && e.stack || e) });
  console.error(e);
  if (e && (e.code === 'EADDRINUSE' || e.code === 'EADDRNOTAVAIL')) process.exit(2);
});

boruSunucu.listen(CFG.boru, () => {
  httpSunucu.listen(CFG.port, CFG.host, () => {
    if (!process.env.EREN_PORT) fs.writeFileSync(path.join(__dirname, 'sunucu.pid'), String(process.pid));
    kaydet('start', { pid: process.pid, host: CFG.host, port: CFG.port, izinli: [...CFG.izinli], node: process.version });
    console.log(`dinliyor ${CFG.host}:${CFG.port} izinli=${[...CFG.izinli]} boru=${CFG.boru} pid=${process.pid}`);
  });
});
