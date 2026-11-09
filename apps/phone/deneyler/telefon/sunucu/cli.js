'use strict';
// Kullanım: node cli.js <durum|foreground|elements [--tum]|screenshot [--max N] [--q N]|burst N|tap X Y|
//                        tap_node ID|type ID METIN|status|wakelock on|off|ozet [saat]>
const fs = require('fs');
const net = require('net');
const path = require('path');

const BORU = process.env.EREN_BORU || '\\\\.\\pipe\\eren-deneme';
const LOG = process.env.EREN_LOG || path.join(__dirname, 'log.jsonl');
const CIKTI = process.env.EREN_CIKTI || path.join(__dirname, 'cikti');

function bayrak(a, ad, varsayilan) {
  const i = a.indexOf(ad);
  return i >= 0 ? Number(a[i + 1]) : varsayilan;
}

function istekler(gonderilecek, zamanMs) {
  return new Promise((coz, red) => {
    const s = net.connect(BORU);
    const yanitlar = new Map();
    let tampon = '';
    const zaman = setTimeout(() => { s.destroy(); red(new Error('boru zaman asimi')); }, zamanMs);
    s.on('connect', () => {
      gonderilecek.forEach((g, i) => s.write(JSON.stringify({ rid: i, ...g }) + '\n'));
    });
    s.on('data', (p) => {
      tampon += p.toString();
      let i;
      while ((i = tampon.indexOf('\n')) >= 0) {
        const m = JSON.parse(tampon.slice(0, i));
        tampon = tampon.slice(i + 1);
        yanitlar.set(m.rid, m);
        if (yanitlar.size === gonderilecek.length) {
          clearTimeout(zaman);
          s.end();
          coz(gonderilecek.map((_, r) => yanitlar.get(r)));
        }
      }
    });
    s.on('error', (e) => { clearTimeout(zaman); red(new Error(`sunucuya ulasilamadi: ${e.message}`)); });
  });
}

const cmd = (name, args, timeout_ms) => ({ op: 'cmd', name, args, timeout_ms });
const bas = (o) => console.log(JSON.stringify(o, null, 2));

function dugumSatiri(n) {
  const [l, t, r, b] = n.bounds;
  const yazi = n.isPassword ? `<parola hasText=${n.hasText}>` : JSON.stringify(n.text || n.desc || n.hint || '');
  const isaret = [n.clickable && 'tik', n.editable && 'yaz', n.focused && 'odak'].filter(Boolean).join(',');
  return `[${n.id}] ${n.role} ${yazi} @${l},${t},${r - l}x${b - t}${isaret ? ` {${isaret}}` : ''}${n.rid ? ` ${n.rid}` : ''}`;
}

function ekraniYaz(m, ek) {
  const { jpeg_b64, ...kalan } = m;
  if (jpeg_b64) {
    fs.mkdirSync(CIKTI, { recursive: true });
    const yol = path.join(CIKTI, `ekran-${Date.now()}${ek}.jpg`);
    fs.writeFileSync(yol, Buffer.from(jpeg_b64, 'base64'));
    kalan.dosya = yol;
  }
  return kalan;
}

function yuzdelik(d, y) {
  if (!d.length) return null;
  const s = [...d].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * y))];
}

function ozet(saat) {
  const sinir = saat ? Date.now() - saat * 3600_000 : 0;
  const satirlar = fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map((s) => JSON.parse(s))
    .filter((o) => o.ts >= sinir);
  const baglantilar = satirlar.filter((o) => o.ev === 'conn');
  const kopmalar = satirlar.filter((o) => o.ev === 'disc');
  const pingler = satirlar.filter((o) => o.ev === 'ping');
  const pong = satirlar.filter((o) => o.ev === 'srv_pong').map((o) => o.rtt_ms);
  const bosluklar = [];
  for (let i = 1; i < pingler.length; i++) {
    const fark = pingler[i].ts - pingler[i - 1].ts;
    if (fark > 45_000) bosluklar.push({ bas: pingler[i - 1].iso, sn: Math.round(fark / 1000), ekran: pingler[i - 1].ekran, wl: pingler[i - 1].wl });
  }
  const yenidenBas = satirlar.filter((o) => o.ev === 'hello').map((o) => ({
    iso: o.iso, surec_sayaci: o.surec_sayaci, servis_sayaci: o.servis_sayaci, surec_yasi_sn: Math.round(o.surec_yasi_ms / 1000), son_kopma: o.son_kopma,
  }));
  const ilkPil = pingler[0];
  const sonPil = pingler[pingler.length - 1];
  bas({
    aralik: satirlar.length ? [satirlar[0].iso, satirlar[satirlar.length - 1].iso] : [],
    baglanti: baglantilar.length,
    kopma: kopmalar.map((o) => ({ iso: o.iso, neden: o.neden, kod: o.kod, kapanis_metni: o.kapanis_metni, sure_sn: Math.round(o.sure_ms / 1000) })),
    ping: pingler.length,
    ping_bosluklari_45sn_ustu: bosluklar,
    srv_pong_rtt_ms: { adet: pong.length, p50: yuzdelik(pong, 0.5), p95: yuzdelik(pong, 0.95), enCok: pong.length ? Math.max(...pong) : null },
    ekran_kapali_ping: pingler.filter((p) => p.ekran === false).length,
    doze_ping: pingler.filter((p) => p.idle === true).length,
    ag: [...new Set(pingler.map((p) => p.ag))],
    pil: ilkPil && { ilk: ilkPil.pil, son: sonPil.pil, sarj_son: sonPil.sarj },
    hello: yenidenBas,
    red: satirlar.filter((o) => o.ev === 'ws_red' || o.ev === 'http_red').map((o) => ({ iso: o.iso, ev: o.ev, ip: o.ip })),
  });
}

async function ana() {
  const [ad, ...a] = process.argv.slice(2);
  const t0 = Date.now();
  let m;
  switch (ad) {
    case 'durum':
      [m] = await istekler([{ op: 'durum' }], 5000);
      return bas(m);
    case 'ozet':
      return ozet(a[0] ? Number(a[0]) : 0);
    case 'foreground':
    case 'status':
      [m] = await istekler([cmd(ad, {})], 25000);
      break;
    case 'elements': {
      [m] = await istekler([cmd(ad, { all: a.includes('--tum'), max: bayrak(a, '--max', 400) })], 25000);
      if (m.dugumler) {
        m.dugumler.forEach((n) => console.log(dugumSatiri(n)));
        delete m.dugumler;
      }
      break;
    }
    case 'screenshot': {
      [m] = await istekler([cmd(ad, { max: bayrak(a, '--max', 720), q: bayrak(a, '--q', 60) })], 25000);
      m = ekraniYaz(m, '');
      break;
    }
    case 'burst': {
      const n = Number(a[0] || 5);
      const hepsi = await istekler(Array.from({ length: n }, () => cmd('screenshot', { max: 320, q: 40 })), 45000);
      hepsi.forEach((y, i) => {
        const k = ekraniYaz(y, `-b${i}`);
        console.log(`#${i} ok=${k.ok} rtt=${k.rtt_ms}ms capture=${k.capture_ms}ms code=${k.code_name || '-'} err=${k.err || '-'}`);
      });
      return;
    }
    case 'tap':
      [m] = await istekler([cmd(ad, { x: Number(a[0]), y: Number(a[1]) })], 25000);
      break;
    case 'tap_node':
      [m] = await istekler([cmd(ad, { id: Number(a[0]) })], 25000);
      break;
    case 'type':
      [m] = await istekler([cmd(ad, { id: Number(a[0]), text: a[1] })], 25000);
      break;
    case 'wakelock':
      [m] = await istekler([cmd(ad, { on: a[0] !== 'off' })], 25000);
      break;
    default:
      console.error('komut: durum foreground elements screenshot burst tap tap_node type status wakelock ozet');
      process.exit(2);
  }
  bas(m);
  console.log(`rtt_sunucu_ms=${m.rtt_ms} toplam_cli_ms=${Date.now() - t0}`);
  process.exitCode = m.ok ? 0 : 1;
}

ana().catch((e) => { console.error(e.message); process.exit(3); });
