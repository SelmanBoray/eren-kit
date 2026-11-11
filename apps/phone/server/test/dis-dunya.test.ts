// dis-dunya: gerçek küçük süreçlerle. Kukla betikler os.tmpdir() altında, test sonunda silinir.
// Yalnız kendi başlattığımız süreçleri öldürürüz. Yalnız 127.0.0.1 ve rastgele port.
// Tekil kilit adı üretimdeki sabit addır: aynı anda gerçek servis çalışmadığı varsayılır.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer, connect } from "node:net";
import { createServer as httpSunucu } from "node:http";
import { createPublicKey, createVerify, generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { WebSocket } from "ws";
import type { DisDunya, ErenYollari, SurecKaydi, SurecKimligi } from "../src/sozlesme.ts";
import {
  canlilikIzleyicisiKur,
  disDunyaKur,
  dosyaPortuKur,
  kimlikOkuyucuKur,
  WS_CANLILIK_ARALIGI_MS,
  wsKur,
} from "../src/dis-dunya.ts";
import type { KimlikCocugu } from "../src/dis-dunya.ts";
import { sahteZaman } from "./sahte.ts";

const win = process.platform === "win32";
const uretim = pathToFileURL(join(import.meta.dirname, "..", "src", "dis-dunya.ts")).href;

let kok = "";
let d: DisDunya;
const baslatilanPidler = new Set<number>();

const yollarUret = (dizin: string): ErenYollari => ({
  kok: dizin,
  vt: join(dizin, "eren.db"),
  log: join(dizin, "servis.log"),
  islerDizini: join(dizin, "isler"),
  erenCwd: join(dizin, "eren-cwd"),
  erenMcpDizini: join(dizin, "eren-mcp"),
  anahtar: join(dizin, "sunucu-anahtar.pem"),
  kimlikEki: join(dizin, "kimlik.local.md"),
  projeler: join(dizin, "projeler.json"),
  yerelAyar: join(dizin, "ayar.local.json"),
  limitKilit: join(dizin, "kilit.json"),
  claudeProjeleri: join(dizin, "claude-projeleri"),
});

const ortam = (): Record<string, string> => ({ ...process.env }) as Record<string, string>;
const bekle = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function kosulBekle(f: () => Promise<boolean> | boolean, ms = 10000): Promise<boolean> {
  const son = Date.now() + ms;
  while (Date.now() < son) {
    if (await f()) return true;
    await bekle(50);
  }
  return false;
}

function yaz(ad: string, icerik: string): string {
  const yol = join(kok, ad);
  writeFileSync(yol, icerik);
  return yol;
}

function temizlePid(pid: number): void {
  spawnSync("taskkill.exe", ["/T", "/F", "/PID", String(pid)], { windowsHide: true });
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

const uyuBetik = "setInterval(() => {}, 1000);";

before(() => {
  kok = mkdtempSync(join(tmpdir(), "eren-dis-dunya-"));
});

after(() => {
  for (const pid of baslatilanPidler) temizlePid(pid);
  rmSync(kok, { recursive: true, force: true });
});

describe("dis-dunya", { skip: !win }, () => {
  before(async () => {
    d = await disDunyaKur({ yollar: yollarUret(kok) });
  });

  describe("surec.boruluBaslat", () => {
    test("satır gidiş dönüş, çıkış dinleyicisi, 1 MiB satır bütün gelir", async () => {
      const betik = yaz(
        "yanki.mjs",
        `process.stdin.setEncoding("utf8"); let t="";
         process.stdin.on("data", c => { t += c; let i; while ((i = t.indexOf("\\n")) >= 0) { const s = t.slice(0,i); t = t.slice(i+1); process.stdout.write("yanki:" + s + "\\n"); } });
         process.stdin.on("end", () => process.exit(0));`,
      );
      const s = await d.surec.boruluBaslat({ exe: process.execPath, argv: [betik], cwd: kok, ortam: ortam() });
      baslatilanPidler.add(s.pid);
      const gelen: string[] = [];
      s.stdoutSatirDinle((l) => gelen.push(l));
      let cikti = false;
      s.cikisDinle(() => (cikti = true));

      assert.equal(s.satirYaz("merhaba"), true);
      const uzun = "x".repeat(1024 * 1024);
      assert.equal(s.satirYaz(uzun), true);
      assert.ok(await kosulBekle(() => gelen.length >= 2));
      assert.equal(gelen[0], "yanki:merhaba");
      assert.equal(gelen[1], "yanki:" + uzun);

      s.stdinKapat();
      assert.ok(await kosulBekle(() => cikti));
    });

    test("ölü süreçte satirYaz atmaz", async () => {
      const betik = yaz("hemen-cik.mjs", "process.exit(0);");
      const s = await d.surec.boruluBaslat({ exe: process.execPath, argv: [betik], cwd: kok, ortam: ortam() }).catch(() => null);
      if (!s) return; // süreç oluşma anı okunmadan çıktıysa başlatma atabilir
      let cikti = false;
      s.cikisDinle(() => (cikti = true));
      await kosulBekle(() => cikti);
      await bekle(200);
      let sonuc: unknown;
      assert.doesNotThrow(() => {
        sonuc = s.satirYaz("x");
      });
      assert.equal(sonuc, false);
    });
  });

  describe("surec.ayrikBaslat", () => {
    test("başlatıcı ölünce çocuk yaşar, çıktı dosyaya gider", async () => {
      const cocuk = yaz("ayrik-cocuk.mjs", `console.log("selam-out"); console.error("selam-err"); ${uyuBetik}`);
      const out = join(kok, "ayrik.out");
      const err = join(kok, "ayrik.err");
      const baslatici = yaz(
        "baslatici.mjs",
        `import { disDunyaKur } from ${JSON.stringify(uretim)};
         const d = await disDunyaKur({ yollar: ${JSON.stringify(yollarUret(join(kok, "baslatici-veri")))} });
         const s = await d.surec.ayrikBaslat({ exe: process.execPath, argv: [${JSON.stringify(cocuk)}], cwd: ${JSON.stringify(kok)}, ortam: process.env, outYol: ${JSON.stringify(out)}, errYol: ${JSON.stringify(err)} });
         process.stdout.write(JSON.stringify({ pid: s.pid, olusturmaMs: s.olusturmaMs }) + "\\n");`,
      );
      const r = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", baslatici], { encoding: "utf8", windowsHide: true, timeout: 30000 });
      assert.equal(r.status, 0, r.stderr);
      const kimlik = JSON.parse(r.stdout.trim().split("\n").pop()!) as SurecKimligi;
      baslatilanPidler.add(kimlik.pid);

      // başlatıcı çoktan öldü; çocuk yaşamalı
      assert.equal(await d.surec.surecVarMi(kimlik), true);
      assert.ok(await kosulBekle(() => existsSync(out) && readFileSync(out, "utf8").includes("selam-out")));
      assert.ok(await kosulBekle(() => existsSync(err) && readFileSync(err, "utf8").includes("selam-err")));

      // PID yeniden kullanımı: oluşma anı tutmuyorsa yok sayılır, ±1000 ms içinde aynı süreç
      assert.equal(await d.surec.surecVarMi({ pid: kimlik.pid, olusturmaMs: kimlik.olusturmaMs + 60_000 }), false);
      assert.equal(await d.surec.surecVarMi({ pid: kimlik.pid, olusturmaMs: kimlik.olusturmaMs + 500 }), true);

      await d.surec.agaciOldur(kimlik.pid);
      assert.ok(await kosulBekle(async () => !(await d.surec.surecVarMi(kimlik))));
    });

    test("oluşma anı okunamazsa süreç ağacının tamamı ölür (alt süreç yetim kalmaz)", async () => {
      // Kök, MCP sunucusu gibi bir alt süreç açar; sonra kimlik sorgusu (sahte) hep atar.
      const alt = yaz("kimlik-alt.mjs", uyuBetik);
      const kokBetik = yaz(
        "kimlik-kok.mjs",
        `import { spawn } from "node:child_process";
         const a = spawn(process.execPath, [${JSON.stringify(alt)}], { stdio: "ignore", windowsHide: true });
         process.stdout.write(JSON.stringify({ alt: a.pid }) + "\\n");
         setInterval(() => {}, 1000);`,
      );
      const cocuk = spawn(process.execPath, [kokBetik], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
      baslatilanPidler.add(cocuk.pid!);
      let cikti = "";
      cocuk.stdout.on("data", (b: Buffer) => (cikti += b.toString()));
      assert.ok(await kosulBekle(() => cikti.includes("\n")), "kök alt süreç pid'ini yazmalı");
      const altPid = (JSON.parse(cikti.split("\n")[0]!) as { alt: number }).alt;
      baslatilanPidler.add(altPid);
      const tablo = await d.surec.anlikGoruntu();
      const kokK = tablo.find((k) => k.pid === cocuk.pid);
      const altK = tablo.find((k) => k.pid === altPid);
      assert.ok(kokK && altK, "kök ve alt süreç görüntüde olmalı");
      assert.equal(altK.ppid, cocuk.pid);

      const oku = kimlikOkuyucuKur({
        pidSorgula: async () => {
          throw new Error("powershell_zaman_asimi");
        },
        agaciOldur: (pid) => d.surec.agaciOldur(pid),
      });
      await assert.rejects(oku(cocuk), /powershell_zaman_asimi/);
      assert.ok(await kosulBekle(async () => !(await d.surec.surecVarMi(kokK))), "kök ölmeli");
      assert.ok(await kosulBekle(async () => !(await d.surec.surecVarMi(altK))), "alt süreç de ölmeli");
    });
  });

  describe("surec.agaciOldur / tekOldur / anlikGoruntu", () => {
    async function agacKur() {
      const torun = yaz("torun.mjs", uyuBetik);
      const ebeveyn = yaz(
        "ebeveyn.mjs",
        `import { spawn } from "node:child_process";
         const t = spawn(process.execPath, [${JSON.stringify(torun)}], { stdio: "ignore", windowsHide: true, detached: true });
         process.stdout.write(JSON.stringify({ torun: t.pid }) + "\\n");
         setInterval(() => {}, 1000);`,
      );
      const s = await d.surec.boruluBaslat({ exe: process.execPath, argv: [ebeveyn], cwd: kok, ortam: ortam() });
      baslatilanPidler.add(s.pid);
      const satirlar: string[] = [];
      s.stdoutSatirDinle((l) => satirlar.push(l));
      assert.ok(await kosulBekle(() => satirlar.length > 0));
      const torunPid = (JSON.parse(satirlar[0]!) as { torun: number }).torun;
      baslatilanPidler.add(torunPid);
      const tk = (await d.surec.anlikGoruntu()).find((k) => k.pid === torunPid);
      assert.ok(tk, "torun anlık görüntüde olmalı");
      const torunKimlik: SurecKimligi = { pid: tk.pid, olusturmaMs: tk.olusturmaMs };
      return { s, torunPid, torunKimlik };
    }

    test("anlikGoruntu ebeveyn bağı, ad ve oluşma anı verir", async () => {
      const { s, torunPid } = await agacKur();
      const g = await d.surec.anlikGoruntu();
      const e = g.find((k) => k.pid === s.pid);
      const t = g.find((k) => k.pid === torunPid);
      assert.ok(e && t);
      assert.equal(t.ppid, s.pid);
      assert.match(e.ad.toLowerCase(), /node/);
      assert.ok(Math.abs(e.olusturmaMs - Date.now()) < 120_000, "oluşma anı epoch ms ve yakın olmalı");
      await d.surec.agaciOldur(s.pid);
    });

    test("agaciOldur ağacı öldürür: sağ kalan sıfır", async () => {
      const { s, torunKimlik } = await agacKur();
      await d.surec.agaciOldur(s.pid);
      assert.ok(await kosulBekle(async () => !(await d.surec.surecVarMi(s)) && !(await d.surec.surecVarMi(torunKimlik))));
      const g = await d.surec.anlikGoruntu();
      const sag = [s.pid, torunKimlik.pid].filter((p) => g.some((k) => k.pid === p));
      assert.equal(sag.length, 0);
    });

    test("tekOldur yalnız o süreci öldürür, torun sağ kalır", async () => {
      const { s, torunKimlik } = await agacKur();
      await d.surec.tekOldur(s.pid);
      assert.ok(await kosulBekle(async () => !(await d.surec.surecVarMi(s))));
      assert.equal(await d.surec.surecVarMi(torunKimlik), true);
      await d.surec.tekOldur(torunKimlik.pid);
      assert.ok(await kosulBekle(async () => !(await d.surec.surecVarMi(torunKimlik))));
    });

    test("olmayan PID'yi öldürmek atmaz", async () => {
      await assert.doesNotReject(d.surec.agaciOldur(2_000_000_000));
      await assert.doesNotReject(d.surec.tekOldur(2_000_000_000));
    });
  });

  describe("surec.aracCalistir", () => {
    test("stdout/stderr toplar", async () => {
      const betik = yaz("arac.mjs", 'process.stdout.write("tamam"); process.stderr.write("uyari");');
      const r = await d.surec.aracCalistir({ exe: process.execPath, argv: [betik], zamanAsimiMs: 15000 });
      assert.equal(r.zamanAsimi, false);
      assert.equal(r.stdout, "tamam");
      assert.equal(r.stderr, "uyari");
    });

    test("zaman aşımında zamanAsimi true döner", async () => {
      const betik = yaz("arac-uyu.mjs", uyuBetik);
      const t0 = Date.now();
      const r = await d.surec.aracCalistir({ exe: process.execPath, argv: [betik], zamanAsimiMs: 500 });
      assert.equal(r.zamanAsimi, true);
      assert.ok(Date.now() - t0 < 10000);
    });
  });

  describe("sistem", () => {
    test("tailscaleAdresi null ya da 100.64.0.0/10 içinde", () => {
      const a = d.sistem.tailscaleAdresi();
      if (a === null) return;
      const [b1, b2] = a.split(".").map(Number);
      assert.equal(b1, 100);
      assert.ok(b2! >= 64 && b2! <= 127);
    });

    test("ramOku ve masaustuDurumu geçerli değer verir", async () => {
      const r = d.sistem.ramOku();
      assert.ok(r.toplamMb > 0 && r.bosMb >= 0 && r.bosMb <= r.toplamMb);
      assert.ok(["bagli", "kopuk", "bilinmiyor"].includes(await d.sistem.masaustuDurumu()));
    });
  });

  describe("ws.dinle", () => {
    const ac = (port: number, yol: string, headers?: Record<string, string>) =>
      new Promise<WebSocket>((coz, red) => {
        const w = new WebSocket(`ws://127.0.0.1:${port}${yol}`, { headers });
        w.once("open", () => coz(w));
        w.once("error", red);
        w.once("unexpected-response", (_i, res) => red(new Error("yanit:" + res.statusCode)));
      });
    const kapanisKodu = (w: WebSocket) => new Promise<number>((coz) => w.once("close", (kod) => coz(kod)));

    test("yol kabulü, yol dışı ret, maxPayload (yola göre), ikili çerçevede kapat, uzakIp yerel", async () => {
      const port = await rastgeleYerelPort();
      const baglantilar: { yol: string; uzakIp: string; metinler: string[]; kapandi: boolean }[] = [];
      const sunucu = await d.ws.dinle({
        host: "127.0.0.1",
        port,
        azamiCerceve: { "/sohbet": 1024, "/cihaz": 256 },
        baglanti: (b) => {
          const k = { yol: b.yol, uzakIp: b.uzakIp, metinler: [] as string[], kapandi: false };
          baglantilar.push(k);
          b.mesajDinle((m) => {
            k.metinler.push(m);
            b.gonder("yanki:" + m.length);
          });
          b.kapanisDinle(() => (k.kapandi = true));
        },
      });
      try {
        await assert.rejects(ac(port, "/baska"));
        await assert.rejects(ac(port, "/"));
        assert.equal(baglantilar.length, 0);

        const w = await ac(port, "/sohbet");
        const cevap = new Promise<string>((coz) => w.once("message", (m) => coz(m.toString())));
        w.send("selam");
        assert.equal(await cevap, "yanki:5");
        assert.equal(baglantilar[0]!.yol, "/sohbet");
        assert.equal(baglantilar[0]!.uzakIp, "127.0.0.1");

        // sınır tam: kabul; bir bayt fazlası: 1009 ile kapanır, mesaj iletilmez
        const tam = await new Promise<string>((coz) => {
          w.once("message", (m) => coz(m.toString()));
          w.send("a".repeat(1024));
        });
        assert.equal(tam, "yanki:1024");
        const kod = kapanisKodu(w);
        w.send("a".repeat(1025));
        assert.equal(await kod, 1009);
        assert.ok(await kosulBekle(() => baglantilar[0]!.kapandi));
        assert.ok(!baglantilar[0]!.metinler.some((m) => m.length > 1024));

        // /cihaz sınırı ayrı
        const c = await ac(port, "/cihaz");
        const ck = kapanisKodu(c);
        c.send("b".repeat(300));
        assert.equal(await ck, 1009);

        // ikili çerçeve: bağlantı kapanır, mesaj iletilmez
        const i = await ac(port, "/sohbet");
        const ik = kapanisKodu(i);
        const indeks = baglantilar.length - 1;
        i.send(Buffer.from("ikili"), { binary: true });
        await ik;
        assert.deepEqual(baglantilar[indeks]!.metinler, []);
        assert.ok(await kosulBekle(() => baglantilar[indeks]!.kapandi));
      } finally {
        await sunucu.kapat();
      }
      await assert.rejects(
        new Promise<void>((coz, red) => {
          const s = connect(port, "127.0.0.1");
          s.once("connect", () => {
            s.destroy();
            coz();
          });
          s.once("error", red);
        }),
      );
    });

    test("başlık uzakIp'yi etkilemez", async () => {
      const port = await rastgeleYerelPort();
      let uzak = "";
      const sunucu = await d.ws.dinle({
        host: "127.0.0.1",
        port,
        azamiCerceve: { "/sohbet": 1024, "/cihaz": 1024 },
        baglanti: (b) => {
          uzak = b.uzakIp;
        },
      });
      try {
        const w = await ac(port, "/sohbet", { "X-Forwarded-For": "100.64.9.9" });
        assert.ok(await kosulBekle(() => uzak !== ""));
        assert.equal(uzak, "127.0.0.1");
        w.close();
      } finally {
        await sunucu.kapat();
      }
    });
  });

  describe("boru.dinle", () => {
    // Sözleşme `ad`ın tam boru yolu mu kısa ad mı olduğunu söylemez; kısa ad varsayılır.
    const boruYolu = (ad: string) => `\\\\.\\pipe\\${ad}`;

    test("satır çerçevesi, parçalı satır, satirYaz, azamiSatir aşılınca kapat", async () => {
      const ad = `eren-test-${process.pid}-${Date.now()}`;
      const satirlar: string[] = [];
      let kapandi = false;
      let yazici: ((s: string) => void) | null = null;
      const sunucu = await d.boru.dinle({
        ad,
        azamiSatir: 100,
        baglanti: (b) => {
          yazici = (s) => b.satirYaz(s);
          b.satirDinle((s) => satirlar.push(s));
          b.kapanisDinle(() => (kapandi = true));
        },
      });
      try {
        const i = connect(boruYolu(ad));
        i.on("error", () => {});
        await new Promise<void>((coz) => i.once("connect", () => coz()));
        let alinan = "";
        i.on("data", (c) => (alinan += c.toString("utf8")));

        i.write("bir\niki\nuc");
        await bekle(100);
        i.write("-devam\n");
        assert.ok(await kosulBekle(() => satirlar.length >= 3));
        assert.deepEqual(satirlar, ["bir", "iki", "uc-devam"]);

        assert.ok(await kosulBekle(() => yazici !== null));
        yazici!("cevap");
        assert.ok(await kosulBekle(() => alinan === "cevap\n"));

        i.write("k".repeat(100) + "\n");
        assert.ok(await kosulBekle(() => satirlar.length >= 4));
        assert.equal(satirlar[3], "k".repeat(100));

        const once = satirlar.length;
        i.write("u".repeat(500) + "\n");
        assert.ok(await kosulBekle(() => kapandi));
        assert.equal(satirlar.length, once);
        i.destroy();
      } finally {
        await sunucu.kapat();
      }
    });

    test("satır sonu gelmeyen veri sınırı aşınca kapatır", async () => {
      const ad = `eren-test-${process.pid}-${Date.now()}-b`;
      let kapandi = false;
      const satirlar: string[] = [];
      const sunucu = await d.boru.dinle({
        ad,
        azamiSatir: 64,
        baglanti: (b) => {
          b.satirDinle((s) => satirlar.push(s));
          b.kapanisDinle(() => (kapandi = true));
        },
      });
      try {
        const i = connect(boruYolu(ad));
        i.on("error", () => {});
        await new Promise<void>((coz) => i.once("connect", () => coz()));
        i.write("z".repeat(10_000));
        assert.ok(await kosulBekle(() => kapandi));
        assert.equal(satirlar.length, 0);
        i.destroy();
      } finally {
        await sunucu.kapat();
      }
    });
  });

  describe("tekilKilit.al", () => {
    // Kilidi bu süreçte almayız: dinleyen sunucu olay döngüsünü açık tutar, test süreci çıkamazdı.
    test("ikinci süreçte false; sahibi taskkill /F ile ölünce yeniden alınabilir", async () => {
      const dene = yaz(
        "kilit-dene.mjs",
        `import { disDunyaKur } from ${JSON.stringify(uretim)};
         const d = await disDunyaKur({ yollar: ${JSON.stringify(yollarUret(join(kok, "kilit-veri")))} });
         const sonuc = await d.tekilKilit.al();
         const yazildi = new Promise((c) => process.stdout.write(JSON.stringify({ sonuc }) + "\\n", c)); await yazildi;
         if (sonuc && process.argv[2] === "tut") setInterval(() => {}, 1000); else process.exit(0);`,
      );
      const baslat = async (mod: string) => {
        const c = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", dene, mod], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
        baslatilanPidler.add(c.pid!);
        let cikti = ""; let hata = "";
        c.stdout.on("data", (b) => (cikti += b.toString())); c.stderr.on("data", (b) => (hata += b.toString()));
        assert.ok(await kosulBekle(() => cikti.includes("\n"), 30000), "çocuk kilit sonucunu yazmalı: " + mod + " " + hata);
        return { c, sonuc: (JSON.parse(cikti.split("\n")[0]!) as { sonuc: boolean }).sonuc };
      };

      const sahip = await baslat("tut");
      assert.equal(sahip.sonuc, true);
      assert.equal((await baslat("dene")).sonuc, false);

      temizlePid(sahip.c.pid!);
      let son = false;
      assert.ok(
        await kosulBekle(async () => {
          son = (await baslat("dene")).sonuc;
          return son;
        }, 15000),
      );
    });
  });

  describe("anahtar", () => {
    test("üretilir, kalıcıdır, imza gidiş dönüş; bağımsız doğrulama; geçersiz girdide false", async () => {
      const dizin = mkdtempSync(join(kok, "anahtar-"));
      const yollar = yollarUret(dizin);
      const a1 = (await disDunyaKur({ yollar })).anahtar;
      assert.ok(existsSync(yollar.anahtar));
      assert.match(readFileSync(yollar.anahtar, "utf8"), /-----BEGIN [A-Z ]*PRIVATE KEY-----/);

      const acik = a1.acikAnahtar();
      const metin = "merhaba dünya ğüşiöç";
      const imza = a1.imzala(metin);
      assert.equal(a1.dogrula(acik, metin, imza), true);
      assert.equal(a1.dogrula(acik, metin + "x", imza), false);

      assert.match(acik, /^[A-Za-z0-9+/]+=*$/);
      const pk = createPublicKey({ key: Buffer.from(acik, "base64"), format: "der", type: "spki" });
      assert.equal(pk.asymmetricKeyType, "ec");
      assert.equal(pk.asymmetricKeyDetails?.namedCurve, "prime256v1");

      const v = createVerify("SHA256");
      v.update(metin, "utf8");
      assert.equal(v.verify(pk, Buffer.from(imza, "base64")), true);

      const a2 = (await disDunyaKur({ yollar })).anahtar;
      assert.equal(a2.acikAnahtar(), acik);
      assert.equal(a2.dogrula(acik, metin, imza), true);

      const yabanci = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
      const yImza = sign("sha256", Buffer.from(metin, "utf8"), yabanci.privateKey).toString("base64");
      const yAcik = yabanci.publicKey.export({ format: "der", type: "spki" }).toString("base64");
      assert.equal(a1.dogrula(yAcik, metin, yImza), true);
      assert.equal(a1.dogrula(acik, metin, yImza), false);

      assert.equal(a1.dogrula("bu-bir-anahtar-degil", metin, imza), false);
      assert.equal(a1.dogrula("", metin, imza), false);
      assert.equal(a1.dogrula(acik, metin, "!!!bozuk!!!"), false);
      assert.equal(a1.dogrula(acik, metin, ""), false);
    });

    test("sabitZamanEsit", () => {
      const a = d.anahtar;
      assert.equal(a.sabitZamanEsit("abc", "abc"), true);
      assert.equal(a.sabitZamanEsit("abc", "abd"), false);
      assert.equal(a.sabitZamanEsit("abc", "abcd"), false);
      assert.equal(a.sabitZamanEsit("", ""), true);
    });
  });

  describe("rastgele, saat, kayit", () => {
    test("biçimler", () => {
      const r = d.rastgele;
      assert.equal(r.baytlar(16).length, 16);
      assert.match(r.uuid(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      assert.match(r.hex64(), /^[0-9a-f]{16}$/);
      assert.ok(r.opakId("on").startsWith("on"));
      assert.notEqual(r.jeton(), r.jeton());
      assert.ok(r.jeton().length >= 43);
      assert.ok(Math.abs(d.saat.simdiMs() - Date.now()) < 1000);
    });

    test("kayit satirEkle/boyut atmaz", () => {
      assert.doesNotThrow(() => d.kayit.satirEkle("deneme"));
      assert.equal(typeof d.kayit.boyut(), "number");
    });
  });

  describe("http", () => {
    test("yerel sunucuya postJson: durum kodu ve gövde", async () => {
      let govde = "";
      const s = httpSunucu((q, y) => {
        q.on("data", (c) => (govde += c));
        q.on("end", () => {
          y.statusCode = 201;
          y.end("{}");
        });
      });
      await new Promise<void>((coz) => s.listen(0, "127.0.0.1", () => coz()));
      const port = (s.address() as { port: number }).port;
      try {
        const r = await d.http.postJson(`http://127.0.0.1:${port}/x`, { a: 1 }, 5000);
        assert.equal(r.durum, 201);
        assert.deepEqual(JSON.parse(govde), { a: 1 });
      } finally {
        s.closeAllConnections();
        s.close();
      }
    });

    test("zaman aşımında atar", async () => {
      const s = httpSunucu(() => {});
      await new Promise<void>((coz) => s.listen(0, "127.0.0.1", () => coz()));
      const port = (s.address() as { port: number }).port;
      try {
        await assert.rejects(d.http.postJson(`http://127.0.0.1:${port}/x`, {}, 300));
      } finally {
        s.closeAllConnections();
        s.close();
      }
    });
  });
});

// Sahte sorgu ve öldürücüyle: gerçek süreç yok, her platformda koşar.
describe("kimlikOkuyucuKur (sahte dış dünya)", () => {
  const KOK = 4242;
  const kayitTut = () => {
    const sira: string[] = [];
    const cocuk: KimlikCocugu & { exitCode: number | null } = {
      pid: KOK,
      exitCode: null,
      signalCode: null,
      kill: () => {
        sira.push(`kok:${KOK}`);
        return true;
      },
    };
    return { sira, cocuk };
  };
  const kayit = (olusturmaMs: number): SurecKaydi => ({ pid: KOK, ppid: 1, olusturmaMs, ad: "claude.exe" });

  test("sorgu iki kez atarsa: önce ağaç (taskkill /T), sonra kök öldürülür; asıl hata atılır", async () => {
    const { sira, cocuk } = kayitTut();
    let sorgu = 0;
    const oku = kimlikOkuyucuKur({
      pidSorgula: async () => {
        sorgu += 1;
        throw new Error("powershell_zaman_asimi");
      },
      agaciOldur: async (pid) => void sira.push(`agac:${pid}`),
    });
    await assert.rejects(oku(cocuk), /powershell_zaman_asimi/);
    assert.equal(sorgu, 2);
    assert.deepEqual(sira, [`agac:${KOK}`, `kok:${KOK}`]);
  });

  test("süreç listede bulunamazsa da ağaç öldürülür", async () => {
    const { sira, cocuk } = kayitTut();
    const oku = kimlikOkuyucuKur({ pidSorgula: async () => null, agaciOldur: async (pid) => void sira.push(`agac:${pid}`) });
    await assert.rejects(oku(cocuk), /olusturma_ani_okunamadi/);
    assert.deepEqual(sira, [`agac:${KOK}`, `kok:${KOK}`]);
  });

  test("ağaç öldürücü atsa da kök öldürülür ve sorgu hatası atılır", async () => {
    const { sira, cocuk } = kayitTut();
    const oku = kimlikOkuyucuKur({
      pidSorgula: async () => {
        throw new Error("powershell_hata");
      },
      agaciOldur: async () => {
        throw new Error("taskkill_yok");
      },
    });
    await assert.rejects(oku(cocuk), /powershell_hata/);
    assert.deepEqual(sira, [`kok:${KOK}`]);
  });

  test("ikinci denemede okunursa kimse öldürülmez", async () => {
    const { sira, cocuk } = kayitTut();
    let sorgu = 0;
    const oku = kimlikOkuyucuKur({
      pidSorgula: async () => {
        sorgu += 1;
        if (sorgu === 1) throw new Error("powershell_zaman_asimi");
        return kayit(1234);
      },
      agaciOldur: async (pid) => void sira.push(`agac:${pid}`),
    });
    assert.deepEqual(await oku(cocuk), { pid: KOK, olusturmaMs: 1234 });
    assert.deepEqual(sira, []);
  });

  test("çocuk sorgu sırasında kendiliğinden çıktıysa öldürülmez, kimlik döner", async () => {
    const { sira, cocuk } = kayitTut();
    const oku = kimlikOkuyucuKur({
      pidSorgula: async () => {
        cocuk.exitCode = 0;
        throw new Error("powershell_zaman_asimi");
      },
      agaciOldur: async (pid) => void sira.push(`agac:${pid}`),
    });
    const k = await oku(cocuk);
    assert.equal(k.pid, KOK);
    assert.deepEqual(sira, []);
  });
});

describe("transkript.sil", { skip: !win }, () => {
  const U1 = "11111111-2222-4333-8444-555555555555";
  const U2 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  let tk = "";
  let kokDizin = "";
  let t: DisDunya["transkript"];

  const dosya = (...p: string[]) => {
    mkdirSync(join(...p.slice(0, -1)), { recursive: true });
    writeFileSync(join(...p), "x");
  };
  const uuidSeti = (proje: string, u: string) => {
    dosya(proje, `${u}.jsonl`);
    dosya(proje, `${u}.jsonl.nesil1.bak`);
    dosya(proje, u, "alt", "ic.txt");
  };

  before(async () => {
    tk = mkdtempSync(join(kok, "transkript-"));
    const yollar = yollarUret(tk);
    kokDizin = yollar.claudeProjeleri;
    mkdirSync(kokDizin, { recursive: true });
    t = (await disDunyaKur({ yollar })).transkript;
  });

  test("iki projede üç tür öğe silinir, başka UUID kalır, olmayan oturum bulunamayan", async () => {
    const a = join(kokDizin, "proje-a");
    const b = join(kokDizin, "proje-b");
    uuidSeti(a, U1);
    uuidSeti(b, U1);
    uuidSeti(a, U2);
    const sonuc = await t.sil([U1.toUpperCase(), "99999999-9999-4999-8999-999999999999"]);
    for (const p of [a, b]) {
      assert.equal(existsSync(join(p, `${U1}.jsonl`)), false);
      assert.equal(existsSync(join(p, `${U1}.jsonl.nesil1.bak`)), false);
      assert.equal(existsSync(join(p, U1)), false);
    }
    assert.equal(existsSync(join(a, `${U2}.jsonl`)), true);
    assert.equal(existsSync(join(a, `${U2}.jsonl.nesil1.bak`)), true);
    assert.equal(existsSync(join(a, U2, "alt", "ic.txt")), true);
    assert.ok(sonuc.silinen >= 6);
    assert.equal(sonuc.bulunamayan, 1);
    assert.equal(sonuc.reddedilen, 0);
    assert.equal(sonuc.silinemeyen, 0);
  });

  test("UUID olmayan adlar reddedilir, hiçbir şey silinmez", async () => {
    const p = join(kokDizin, "proje-r");
    dosya(p, "x");
    dosya(p, "x.jsonl");
    dosya(p, "a.jsonl");
    dosya(kokDizin, "x");
    dosya(tk, "x");
    const once = existsSync(join(p, "a.jsonl"));
    assert.equal(once, true);
    const sonuc = await t.sil(["../x", "*", "", "..\\x", "11111111-2222-4333-8444-55555555555"]);
    assert.equal(sonuc.reddedilen, 5);
    assert.equal(sonuc.silinen, 0);
    for (const y of [join(p, "x"), join(p, "x.jsonl"), join(p, "a.jsonl"), join(kokDizin, "x"), join(tk, "x")]) {
      assert.equal(existsSync(y), true, y);
    }
  });

  test("iki düzey derindeki eşleşme silinmez", async () => {
    const derin = join(kokDizin, "proje-d", "ic");
    const U = "12345678-1234-4234-8234-123456789012";
    uuidSeti(derin, U);
    uuidSeti(kokDizin, U); // kökün doğrudan çocuğu da proje değil: dosya/dizin düzeyi
    await t.sil([U]);
    assert.equal(existsSync(join(derin, `${U}.jsonl`)), true);
    assert.equal(existsSync(join(derin, U, "alt", "ic.txt")), true);
  });

  test("proje klasörü junction ise hedefindeki dosya silinmez", (ctx) => {
    const hedef = join(tk, "junction-hedef");
    const U = "abcdefab-cdef-4bcd-8bcd-abcdefabcdef";
    uuidSeti(hedef, U);
    const bag = join(kokDizin, "proje-junction");
    try {
      symlinkSync(hedef, bag, "junction");
    } catch {
      ctx.skip("junction kurulamadı");
      return;
    }
    return t.sil([U]).then((sonuc) => {
      assert.equal(existsSync(join(hedef, `${U}.jsonl`)), true);
      assert.equal(existsSync(join(hedef, `${U}.jsonl.nesil1.bak`)), true);
      assert.equal(existsSync(join(hedef, U, "alt", "ic.txt")), true);
      assert.equal(typeof sonuc.silinen, "number");
    });
  });

  test("<uuid> dizini içinde junction varsa hedef silinmez", async (ctx) => {
    const hedef = join(tk, "ic-junction-hedef");
    dosya(hedef, "dokunma.txt");
    const U = "fedcba98-7654-4321-8fed-cba987654321";
    const proje = join(kokDizin, "proje-ij");
    mkdirSync(join(proje, U), { recursive: true });
    try {
      symlinkSync(hedef, join(proje, U, "bag"), "junction");
    } catch {
      ctx.skip("junction kurulamadı");
      return;
    }
    await t.sil([U]);
    assert.equal(existsSync(join(hedef, "dokunma.txt")), true);
    assert.equal(existsSync(join(proje, U)), false);
  });

  test("kök yoksa her oturum bulunamayan, port atmaz", async () => {
    const bos = mkdtempSync(join(kok, "transkript-yok-"));
    const t2 = (await disDunyaKur({ yollar: yollarUret(bos) })).transkript; // claudeProjeleri oluşturulmadı
    const sonuc = await t2.sil([U1, U2, "../x"]);
    assert.equal(sonuc.bulunamayan, 2);
    assert.equal(sonuc.reddedilen, 1);
    assert.equal(sonuc.silinen, 0);
    await assert.doesNotReject(t2.sil([]));
  });
});

describe("dosyaPortuKur", () => {
  test("atomikYaz/oku/aralikOku/boyut/dizin", async () => {
    const f = dosyaPortuKur();
    const dizin = join(kok, "dosya-portu", "alt");
    assert.equal(await f.dizinVarMi(dizin), false);
    await f.dizinOlustur(dizin);
    assert.equal(await f.dizinVarMi(dizin), true);

    const yol = join(dizin, "a.txt");
    assert.equal(await f.oku(yol), null);
    assert.equal(await f.boyut(yol), null);
    await f.atomikYaz(yol, "çğş-merhaba");
    assert.equal(await f.oku(yol), "çğş-merhaba");
    await f.atomikYaz(yol, "ikinci");
    assert.equal(await f.oku(yol), "ikinci");
    assert.equal(await f.boyut(yol), 6);

    assert.equal(Buffer.from(await f.aralikOku(yol, 2, 3)).toString(), "inc");
    assert.equal((await f.aralikOku(yol, 6, 10)).length, 0);
    assert.equal((await f.aralikOku(yol, 100, 10)).length, 0);
    assert.equal((await f.aralikOku(join(dizin, "yok"), 0, 10)).length, 0);
  });

  test("dosyaSil: var olan dosyayı siler, olmayan yol sessiz", async () => {
    const f = dosyaPortuKur();
    const dizin = mkdtempSync(join(kok, "dosya-sil-"));
    const yol = join(dizin, "silinecek.json");
    writeFileSync(yol, "x");
    assert.equal(existsSync(yol), true);
    await f.dosyaSil(yol);
    assert.equal(existsSync(yol), false);
    assert.equal(await f.oku(yol), null);
    await assert.doesNotReject(f.dosyaSil(yol)); // ikinci kez: yok, sessiz
    await assert.doesNotReject(f.dosyaSil(join(dizin, "hic-olmayan", "yok.json")));
  });

  test("dosyaSil: dizinde atar, dizin ve içeriği kalır", async () => {
    const f = dosyaPortuKur();
    const dizin = mkdtempSync(join(kok, "dosya-sil-dizin-"));
    const ic = join(dizin, "ic.txt");
    writeFileSync(ic, "x");
    await assert.rejects(f.dosyaSil(dizin));
    assert.equal(existsSync(dizin), true);
    assert.equal(existsSync(ic), true);
  });

  test("dosyaSil: junction'da atar, hedef kalır", async (ctx) => {
    const f = dosyaPortuKur();
    const dizin = mkdtempSync(join(kok, "dosya-sil-junction-"));
    const hedef = join(dizin, "hedef");
    mkdirSync(hedef);
    writeFileSync(join(hedef, "dokunma.txt"), "x");
    const bag = join(dizin, "bag");
    try {
      symlinkSync(hedef, bag, "junction");
    } catch {
      ctx.skip("junction kurulamadı");
      return;
    }
    await assert.rejects(f.dosyaSil(bag));
    assert.equal(existsSync(join(hedef, "dokunma.txt")), true);
    assert.equal(existsSync(hedef), true);
  });
});

describe("ws canlılık yoklaması (sahte zamanlayıcı)", () => {
  const ARALIK = WS_CANLILIK_ARALIGI_MS;

  const izleyiciKur = () => {
    const zaman = sahteZaman();
    const sayac = { ping: 0, sonlandir: 0 };
    const iz = canlilikIzleyicisiKur({
      aralikMs: ARALIK,
      herAralik: zaman.zamanlayici.herAralik,
      ping: () => void sayac.ping++,
      sonlandir: () => void sayac.sonlandir++,
    });
    return { zaman, sayac, iz };
  };

  test("aralık 30 sn: ölü bağlantı en geç 60 sn'de düşer", () => {
    assert.equal(ARALIK, 30_000);
  });

  test("pong gelmeyen izleyici ikinci aralıkta sonlandırır, önce değil; sonra zamanlayıcı kalmaz", () => {
    const { zaman, sayac } = izleyiciKur();
    zaman.ilerlet(ARALIK - 1);
    assert.deepEqual(sayac, { ping: 0, sonlandir: 0 });
    zaman.ilerlet(1);
    assert.deepEqual(sayac, { ping: 1, sonlandir: 0 });
    zaman.ilerlet(ARALIK - 1);
    assert.deepEqual(sayac, { ping: 1, sonlandir: 0 }, "pong için bir tam aralık beklenir");
    zaman.ilerlet(1);
    assert.deepEqual(sayac, { ping: 1, sonlandir: 1 });
    assert.equal(zaman.bekleyenSayisi(), 0);
    zaman.ilerlet(10 * ARALIK);
    assert.deepEqual(sayac, { ping: 1, sonlandir: 1 }, "sonlandırmadan sonra ping ya da ikinci sonlandırma yok");
  });

  test("her aralıkta pong (ya da mesaj) gelen izleyici N aralık boyunca sonlandırmaz", () => {
    const { zaman, sayac, iz } = izleyiciKur();
    zaman.ilerlet(ARALIK);
    assert.equal(sayac.ping, 1);
    for (let i = 0; i < 20; i++) {
      // pong aralığın son milisaniyesinde gelir: mobil ağ gecikmesine tam aralık pay
      zaman.ilerlet(ARALIK - 1);
      iz.canliIsaretle();
      zaman.ilerlet(1);
    }
    assert.deepEqual(sayac, { ping: 21, sonlandir: 0 });
    assert.equal(zaman.bekleyenSayisi(), 1);
  });

  test("durdur zamanlayıcıyı bırakır, iki kez çağrılabilir; sonra ping gitmez", () => {
    const { zaman, sayac, iz } = izleyiciKur();
    assert.equal(zaman.bekleyenSayisi(), 1);
    iz.durdur();
    iz.durdur();
    assert.equal(zaman.bekleyenSayisi(), 0);
    zaman.ilerlet(5 * ARALIK);
    assert.deepEqual(sayac, { ping: 0, sonlandir: 0 });
  });

  describe("gerçek ws sunucusu", () => {
    const ac = (port: number, yol: string, secenek: { autoPong?: boolean } = {}) =>
      new Promise<WebSocket>((coz, red) => {
        const w = new WebSocket(`ws://127.0.0.1:${port}${yol}`, secenek);
        w.once("open", () => coz(w));
        w.once("error", red);
      });
    const olay = (w: WebSocket, ad: "ping" | "pong" | "close") => new Promise<void>((coz) => w.once(ad, () => coz()));

    interface Kayit {
      b: import("../src/sozlesme.ts").WsBaglantisi;
      kapandi: boolean;
      metinler: string[];
    }
    const kur = async () => {
      const zaman = sahteZaman();
      const port = await rastgeleYerelPort();
      const kayitlar: Kayit[] = [];
      const sunucu = await wsKur({ aralikMs: ARALIK, herAralik: zaman.zamanlayici.herAralik }).dinle({
        host: "127.0.0.1",
        port,
        azamiCerceve: { "/sohbet": 1024, "/cihaz": 1024 },
        baglanti: (b) => {
          const k: Kayit = { b, kapandi: false, metinler: [] };
          kayitlar.push(k);
          b.mesajDinle((m) => {
            k.metinler.push(m);
            b.gonder("yanki:" + m);
          });
          b.kapanisDinle(() => (k.kapandi = true));
        },
      });
      return { zaman, port, kayitlar, sunucu };
    };

    test("pong dönmeyen istemci iki aralıkta sonlandırılır, kapanış yolu çalışır, zamanlayıcı kalmaz", async () => {
      const { zaman, port, kayitlar, sunucu } = await kur();
      try {
        for (const yol of ["/sohbet", "/cihaz"] as const) {
          const w = await ac(port, yol, { autoPong: false });
          assert.ok(await kosulBekle(() => kayitlar.length > 0 && kayitlar.at(-1)!.b.yol === yol));
          const k = kayitlar.at(-1)!;
          assert.equal(zaman.bekleyenSayisi(), 1);
          const ping = olay(w, "ping");
          zaman.ilerlet(ARALIK);
          await ping;
          assert.equal(w.readyState, WebSocket.OPEN);
          assert.equal(k.kapandi, false);
          const kapanis = olay(w, "close");
          zaman.ilerlet(ARALIK);
          await kapanis;
          assert.ok(await kosulBekle(() => k.kapandi), "kapanisDinle tetiklenir");
          assert.equal(zaman.bekleyenSayisi(), 0);
        }
      } finally {
        await sunucu.kapat();
      }
    });

    test("pong dönen sessiz istemci N aralık boyunca açık kalır", async () => {
      const { zaman, port, kayitlar, sunucu } = await kur();
      try {
        const w = await ac(port, "/cihaz");
        assert.ok(await kosulBekle(() => kayitlar.length === 1));
        for (let i = 0; i < 6; i++) {
          const ping = olay(w, "ping");
          zaman.ilerlet(ARALIK);
          await ping;
          // İstemci pong'u 'ping' olayından önce yazar. İstemcinin kendi ping'ine gelen pong,
          // sunucunun o pong'u işlediğini kanıtlar (aynı TCP yolu, sıra korunur).
          const donus = olay(w, "pong");
          w.ping();
          await donus;
        }
        assert.equal(w.readyState, WebSocket.OPEN);
        assert.equal(kayitlar[0]!.kapandi, false);
        assert.equal(zaman.bekleyenSayisi(), 1);
        const yanit = new Promise<string>((coz) => w.once("message", (m) => coz(m.toString())));
        w.send("hala");
        assert.equal(await yanit, "yanki:hala");
      } finally {
        await sunucu.kapat();
      }
    });

    test("gonder açık sokette true, kapanmış sokette false döner; kapanan bağlantı ve sunucu zamanlayıcı bırakır", async () => {
      const { zaman, port, kayitlar, sunucu } = await kur();
      let kapatildi = false;
      try {
        const w1 = await ac(port, "/sohbet");
        const w2 = await ac(port, "/cihaz");
        assert.ok(await kosulBekle(() => kayitlar.length === 2));
        assert.equal(zaman.bekleyenSayisi(), 2);
        const k1 = kayitlar.find((k) => k.b.yol === "/sohbet")!;
        const ilk: unknown = k1.b.gonder("merhaba");
        assert.equal(ilk, true);
        w1.close();
        assert.ok(await kosulBekle(() => k1.kapandi));
        assert.equal(zaman.bekleyenSayisi(), 1, "kapanan bağlantının zamanlayıcısı kalmaz");
        const sonra: unknown = k1.b.gonder("kimse yok");
        assert.equal(sonra, false);

        const kapanis = olay(w2, "close");
        await sunucu.kapat();
        kapatildi = true;
        assert.equal(zaman.bekleyenSayisi(), 0, "sunucu durunca zamanlayıcı kalmaz");
        await kapanis;
        zaman.ilerlet(10 * ARALIK); // bırakılmış zamanlayıcı tetiklenmez, atmaz
      } finally {
        if (!kapatildi) await sunucu.kapat();
      }
    });
  });
});
