/**
 * Kimlik öncesi kaynak sınırları (denetim bulgusu B3), gerçek `ws` sunucusuyla: `Origin` süzgeci, kimlik
 * öncesi bayt sınırı, adres başına bağlantı sınırı, yanıtsız uca kapanış süresi. Yalnız 127.0.0.1 ve
 * rastgele port; adlandırılmış boru ve tekil kilit kullanılmaz (canlı servisle çakışmaz).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { connect, createServer } from "node:net";
import type { Socket } from "node:net";
import { WebSocket } from "ws";
import { kaynakIzinliMi, wsKur } from "../src/dis-dunya.ts";
import type { KapatilabilirSunucu, WsBaglantisi } from "../src/sozlesme.ts";

const bekle = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function kosulBekle(f: () => boolean, ms = 5000): Promise<boolean> {
  const son = Date.now() + ms;
  while (Date.now() < son) {
    if (f()) return true;
    await bekle(20);
  }
  return f();
}

function rastgeleYerelPort(): Promise<number> {
  return new Promise((coz, red) => {
    const s = createServer();
    s.once("error", red);
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => coz(p));
    });
  });
}

interface Kayit {
  b: WsBaglantisi;
  metinler: string[];
  kapandi: boolean;
}

async function sunucuKur(o: {
  kimlikOncesiAzamiBayt?: number;
  ipBasinaAzamiBaglanti?: number;
  kapanisBeklemeMs?: number;
  /** Gelen ilk mesajda `kimlikDogrulandi` çağrılır (kimlik adımının yerine). */
  ilkMesajKimlik?: boolean;
}): Promise<{ port: number; sunucu: KapatilabilirSunucu; kayitlar: Kayit[] }> {
  const port = await rastgeleYerelPort();
  const kayitlar: Kayit[] = [];
  const sunucu = await wsKur({
    aralikMs: 60_000,
    herAralik: (ms, f) => {
      const t = setInterval(f, ms);
      t.unref();
      return () => clearInterval(t);
    },
    ...(o.kapanisBeklemeMs === undefined ? {} : { kapanisBeklemeMs: o.kapanisBeklemeMs }),
  }).dinle({
    host: "127.0.0.1",
    port,
    azamiCerceve: { "/sohbet": 1024 * 1024, "/cihaz": 1024 * 1024 },
    kimlikOncesiAzamiBayt: o.kimlikOncesiAzamiBayt ?? 4096,
    ipBasinaAzamiBaglanti: o.ipBasinaAzamiBaglanti ?? 100,
    baglanti: (b) => {
      const k: Kayit = { b, metinler: [], kapandi: false };
      kayitlar.push(k);
      b.mesajDinle((m) => {
        if (o.ilkMesajKimlik === true && k.metinler.length === 0) b.kimlikDogrulandi();
        k.metinler.push(m);
      });
      b.kapanisDinle(() => (k.kapandi = true));
    },
  });
  return { port, sunucu, kayitlar };
}

const ac = (port: number, yol = "/sohbet", headers?: Record<string, string>) =>
  new Promise<WebSocket>((coz, red) => {
    const w = new WebSocket(`ws://127.0.0.1:${port}${yol}`, { headers });
    w.once("open", () => coz(w));
    w.once("error", red);
    w.once("unexpected-response", (_i, res) => red(new Error("yanit:" + res.statusCode)));
  });
const kapanis = (w: WebSocket) => new Promise<number>((coz) => w.once("close", (kod) => coz(kod)));

describe("kaynakIzinliMi (Origin)", () => {
  it("başlık yoksa ya da React Native'in türettiği kendi adresiyse kabul", () => {
    assert.equal(kaynakIzinliMi(undefined, "100.64.0.10", 47800), true);
    assert.equal(kaynakIzinliMi("http://100.64.0.10:47800", "100.64.0.10", 47800), true);
    assert.equal(kaynakIzinliMi("https://100.64.0.10:47800", "100.64.0.10", 47800), true);
    assert.equal(kaynakIzinliMi("http://100.64.0.10", "100.64.0.10", 80), true);
  });

  it("tarayıcı sayfası kaynakları, null, başka port ve birden çok başlık reddedilir", () => {
    for (const o of [
      "http://100.64.0.10:8080",
      "http://100.64.0.11:47800",
      "https://ornek.com",
      "null",
      "file://",
      "http://100.64.0.10:47800/yol",
      "http://x@100.64.0.10:47800",
      "",
    ]) {
      assert.equal(kaynakIzinliMi(o, "100.64.0.10", 47800), false, o);
    }
    assert.equal(kaynakIzinliMi(["http://100.64.0.10:47800"], "100.64.0.10", 47800), false);
    assert.equal(kaynakIzinliMi("http://100.64.0.10", "100.64.0.10", 47800), false);
  });

  it("gerçek sunucu: yabancı kaynak 403 alır, bağlantı kurulmaz; kendi kaynağı ve başlıksız açılır", async () => {
    const { port, sunucu, kayitlar } = await sunucuKur({});
    try {
      await assert.rejects(ac(port, "/sohbet", { Origin: "https://kotu.ornek" }), /yanit:403/);
      await assert.rejects(ac(port, "/cihaz", { Origin: "http://127.0.0.1:1" }), /yanit:403/);
      assert.equal(kayitlar.length, 0);
      const a = await ac(port, "/sohbet", { Origin: `http://127.0.0.1:${port}` });
      const b = await ac(port, "/cihaz");
      assert.ok(await kosulBekle(() => kayitlar.length === 2));
      a.close();
      b.close();
    } finally {
      await sunucu.kapat();
    }
  });
});

describe("kimlik öncesi bayt sınırı", () => {
  it("sınırı aşan tek çerçeve kimlik öncesi koparır, iletilmez", async () => {
    const { port, sunucu, kayitlar } = await sunucuKur({ kimlikOncesiAzamiBayt: 4096 });
    try {
      const w = await ac(port);
      const k = kapanis(w);
      w.send("a".repeat(200_000));
      assert.equal(await k, 1006);
      assert.ok(await kosulBekle(() => kayitlar[0]!.kapandi));
      assert.deepEqual(kayitlar[0]!.metinler, []);
    } finally {
      await sunucu.kapat();
    }
  });

  it("küçük çerçevelerin toplamı da sayılır (denetim TCP parçası başınadır: bellek sınır + bir parça)", async () => {
    const { port, sunucu, kayitlar } = await sunucuKur({ kimlikOncesiAzamiBayt: 4096 });
    try {
      const w = await ac(port);
      const k = kapanis(w);
      let kapandi = false;
      void k.then(() => (kapandi = true));
      for (let i = 0; i < 20 && !kapandi; i++) {
        w.send("b".repeat(500));
        await bekle(15);
      }
      assert.equal(await k, 1006);
      assert.ok(kayitlar[0]!.metinler.length < 20, `${kayitlar[0]!.metinler.length} ileti geçti`);
    } finally {
      await sunucu.kapat();
    }
  });

  it("sınırın altında kalan kimlik öncesi akış etkilenmez; kimlikten sonra büyük çerçeve geçer", async () => {
    const { port, sunucu, kayitlar } = await sunucuKur({ kimlikOncesiAzamiBayt: 4096, ilkMesajKimlik: true });
    try {
      const w = await ac(port);
      w.send("kimlik");
      assert.ok(await kosulBekle(() => kayitlar[0]?.metinler.length === 1));
      const buyuk = randomBytes(150_000).toString("base64");
      w.send(buyuk);
      assert.ok(await kosulBekle(() => kayitlar[0]!.metinler.length === 2));
      assert.equal(kayitlar[0]!.metinler[1], buyuk);
      assert.equal(kayitlar[0]!.kapandi, false);
      w.close();
    } finally {
      await sunucu.kapat();
    }
  });

  it("kimlik iletisiyle aynı anda yollanan büyük çerçeve kimlik işlendikten sonra sayılmaz (sıra korunur)", async () => {
    const { port, sunucu, kayitlar } = await sunucuKur({ kimlikOncesiAzamiBayt: 4096, ilkMesajKimlik: true });
    try {
      const w = await ac(port);
      const buyuk = "c".repeat(100_000);
      // Aynı tik: iki çerçeve çoğunlukla aynı TCP parçasında gelir.
      w.send("kimlik");
      w.send(buyuk);
      assert.ok(await kosulBekle(() => kayitlar[0]?.metinler.length === 2), "iki ileti de gelmeli");
      assert.equal(kayitlar[0]!.kapandi, false);
      w.close();
    } finally {
      await sunucu.kapat();
    }
  });
});

describe("adres başına bağlantı sınırı", () => {
  it("sınırı aşan bağlantı kurulmaz; biri kapanınca yenisi açılır", async () => {
    const { port, sunucu, kayitlar } = await sunucuKur({ ipBasinaAzamiBaglanti: 3 });
    try {
      const acik = [await ac(port), await ac(port, "/cihaz"), await ac(port)];
      await assert.rejects(ac(port));
      // Yükseltme yapmadan bekleyen çıplak TCP de sayılır.
      const ciplak = connect(port, "127.0.0.1");
      ciplak.on("error", () => {});
      const ciplakKapandi = new Promise<void>((coz) => ciplak.once("close", () => coz()));
      await ciplakKapandi;
      assert.equal(kayitlar.length, 3);
      const k = kapanis(acik[0]!);
      acik[0]!.close();
      await k;
      assert.ok(await kosulBekle(() => kayitlar[0]!.kapandi));
      let yeni: WebSocket | null = null;
      assert.ok(
        await kosulBekle(() => {
          void ac(port).then(
            (w) => (yeni = w),
            () => {},
          );
          return yeni !== null;
        }, 3000),
      );
      for (const w of [...acik.slice(1), yeni!]) w.close();
    } finally {
      await sunucu.kapat();
    }
  });
});

describe("kapanış süresi", () => {
  it("kapanış çerçevesine yanıt vermeyen uç süre dolunca koparılır (30 sn beklenmez)", async () => {
    const { port, sunucu, kayitlar } = await sunucuKur({ kapanisBeklemeMs: 300 });
    let soket: Socket | null = null;
    try {
      soket = connect(port, "127.0.0.1");
      soket.on("error", () => {});
      await new Promise<void>((coz) => soket!.once("connect", () => coz()));
      let gelen = "";
      soket.on("data", (p: Buffer) => (gelen += p.toString("latin1")));
      soket.write(
        "GET /sohbet HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
          `Sec-WebSocket-Key: ${randomBytes(16).toString("base64")}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      );
      assert.ok(await kosulBekle(() => gelen.includes("101") && kayitlar.length === 1));
      const kapandi = new Promise<number>((coz) => soket!.once("close", () => coz(Date.now())));
      const bas = Date.now();
      kayitlar[0]!.b.kapat(1008, "yetkisiz");
      // İstemci kapanış çerçevesini yanıtlamaz.
      const bitis = await Promise.race([kapandi, bekle(5000).then(() => -1)]);
      assert.notEqual(bitis, -1, "soket koparılmadı");
      assert.ok(bitis - bas < 3000, `koparma ${bitis - bas} ms sürdü`);
      assert.ok(await kosulBekle(() => kayitlar[0]!.kapandi));
    } finally {
      soket?.destroy();
      await sunucu.kapat();
    }
  });
});
