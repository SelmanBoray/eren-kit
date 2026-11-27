import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { AJANDA_QR_SURUMU, AjandaEslestirmeQr, EslestirmeQr, sha256Hex, SINIRLAR, utf8Bayt } from "@eren/protocol";
import { createHash, generateKeyPairSync } from "node:crypto";
import { depoAc, depoKur } from "../src/depo.ts";
import {
  ajandaEslestirmeBaslat,
  argumanCoz,
  cihazKaldirKomutu,
  CLAUDE_CODE_GORUNUMU,
  eslestirmeBaslat,
  KAYIT_YONERGESI_YEDEK,
  kayitYonergesiYedegi,
  kayitYonergesiYukle,
  kodMetni,
  KULLANIM,
  listeMetni,
  parmakIzi,
  pcAjanKaydiYukle,
  pcAjanSec,
  pcAnahtarMetni,
  pcKaldirMetni,
  pcListeMetni,
  pcTeshisMetni,
  VARSAYILAN_PC_AJANI,
} from "../src/eslestir.ts";
import type { PcAjaniModulu, PcAjanKaydi } from "../src/eslestir.ts";
import { PC_AJAN_ADLARI, pcAjani } from "../../kurulum/harness/tur.ts";
import type { Depo, EslestirmeBagimliliklari } from "../src/sozlesme.ts";
import { sahteAnahtar, sahteGunluk, sahteRastgele, sahteSistem, sahteZaman } from "./sahte.ts";

const BES_DK_MS = 5 * 60 * 1000;

function kur(sec: { tohum?: number; adres?: string | null; port?: number } = {}) {
  const zaman = sahteZaman();
  const rastgele = sahteRastgele(sec.tohum);
  const sistem = sahteSistem();
  if (sec.adres !== undefined) sistem.tailscale = sec.adres;
  const anahtar = sahteAnahtar();
  const depo: Depo = depoKur({ yol: ":memory:", saat: zaman.saat, gunluk: sahteGunluk() });
  const b: EslestirmeBagimliliklari = {
    depo,
    anahtar,
    sistem,
    rastgele,
    saat: zaman.saat,
    wsPort: sec.port ?? 7443,
  };
  return { zaman, rastgele, sistem, anahtar, depo, b };
}

describe("eslestir: kod", () => {
  it("8 karakter [A-Z0-9], protokol sınırları içinde", () => {
    for (let tohum = 1; tohum <= 40; tohum++) {
      const { b } = kur({ tohum });
      const s = eslestirmeBaslat(b);
      assert.equal(s.ok, true);
      if (!s.ok) return;
      assert.match(s.deger.kod, /^[A-Z0-9]{8}$/);
      assert.ok(s.deger.kod.length >= SINIRLAR.ESLESTIRME_KODU_MIN && s.deger.kod.length <= SINIRLAR.ESLESTIRME_KODU_MAX);
    }
  });

  it("QR içindeki kod elle girilen kodla aynı ve QR şemadan geçer", () => {
    const { b, anahtar } = kur({ port: 8123 });
    const s = eslestirmeBaslat(b);
    assert.equal(s.ok, true);
    if (!s.ok) return;
    assert.equal(s.deger.qr.kod, s.deger.kod);
    assert.equal(s.deger.qr.host, "100.64.0.10");
    assert.equal(s.deger.qr.port, 8123);
    assert.equal(s.deger.qr.server_public_key, anahtar.acikAnahtar());
    assert.equal(EslestirmeQr.safeParse(s.deger.qr).success, true);
  });

  it("farklı rastgelelikle farklı kod (sabit değil)", () => {
    const kodlar = new Set<string>();
    for (let tohum = 1; tohum <= 20; tohum++) {
      const s = eslestirmeBaslat(kur({ tohum }).b);
      if (s.ok) kodlar.add(s.deger.kod);
    }
    assert.ok(kodlar.size > 15);
  });

  it("aynı tohumla aynı kod (rastgele yalnız porttan gelir)", () => {
    const a = eslestirmeBaslat(kur({ tohum: 7 }).b);
    const c = eslestirmeBaslat(kur({ tohum: 7 }).b);
    assert.deepEqual(a, c);
  });
});

describe("eslestir: süre ve depo", () => {
  it("son_ms = şimdi + 5 dk, hem dönüşte hem depoda", () => {
    const { b, depo, zaman } = kur();
    zaman.ilerlet(12_345);
    const simdi = zaman.simdi();
    const s = eslestirmeBaslat(b);
    assert.equal(s.ok, true);
    if (!s.ok) return;
    assert.equal(s.deger.sonMs, simdi + BES_DK_MS);
    assert.equal(depo.eslestirmeOku()?.son_ms, simdi + BES_DK_MS);
  });

  it("depoya yalnız sha256Hex(utf8Bayt(kod)) yazılır; düz kod depoda yok", () => {
    const { b, depo } = kur({ tohum: 99 });
    const s = eslestirmeBaslat(b);
    assert.equal(s.ok, true);
    if (!s.ok) return;
    const kayit = depo.eslestirmeOku();
    assert.ok(kayit);
    assert.equal(kayit.kod_ozeti, sha256Hex(utf8Bayt(s.deger.kod)));
    assert.equal(kayit.yanlis_deneme, 0);
    assert.equal(JSON.stringify(kayit).includes(s.deger.kod), false);
  });

  it("yeni komut eskisini ezer: tek kayıt, eski kodun özeti gider, sayaç sıfırlanır", () => {
    const { b, depo, zaman } = kur({ tohum: 3 });
    const ilk = eslestirmeBaslat(b);
    assert.equal(ilk.ok, true);
    if (!ilk.ok) return;
    depo.eslestirmeYanlisSay();
    assert.equal(depo.eslestirmeOku()?.yanlis_deneme, 1);
    zaman.ilerlet(60_000);
    const ikinci = eslestirmeBaslat(b);
    assert.equal(ikinci.ok, true);
    if (!ikinci.ok) return;
    assert.notEqual(ikinci.deger.kod, ilk.deger.kod);
    const kayit = depo.eslestirmeOku();
    assert.equal(kayit?.kod_ozeti, sha256Hex(utf8Bayt(ikinci.deger.kod)));
    assert.notEqual(kayit?.kod_ozeti, sha256Hex(utf8Bayt(ilk.deger.kod)));
    assert.equal(kayit?.yanlis_deneme, 0);
    assert.equal(kayit?.son_ms, zaman.simdi() + BES_DK_MS);
  });
});

describe("eslestir: parmak izi", () => {
  it("P-256 SPKI DER için büyük harf, 4'lü gruplu SHA-256", () => {
    const { publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const der = publicKey.export({ type: "spki", format: "der" });
    const beklenen = createHash("sha256")
      .update(der)
      .digest("hex")
      .toUpperCase()
      .match(/.{4}/g)!
      .join(" ");
    const s = parmakIzi(der.toString("base64"));
    assert.equal(s, beklenen);
    assert.match(s, /^([0-9A-F]{4} ){15}[0-9A-F]{4}$/);
  });

  it("sabit bilinen bayt dizisi için sabit değer", () => {
    // "abc" baytlarının SHA-256'sı (FIPS 180-2 örneği)
    assert.equal(
      parmakIzi("YWJj"),
      "BA78 16BF 8F01 CFEA 4141 40DE 5DAE 2223 B003 61A3 9617 7A9C B410 FF61 F200 15AD",
    );
  });
});

describe("eslestir: adres reddi", () => {
  const kotuAdresler = ["192.168.1.5", "10.0.0.1", "100.63.255.255", "100.128.0.1", "127.0.0.1", "8.8.8.8", "100.64.0.1.5", ""];
  for (const adres of kotuAdresler) {
    it(`Tailscale dışı adres reddedilir: "${adres}"`, () => {
      const { b, depo } = kur({ adres });
      const s = eslestirmeBaslat(b);
      assert.equal(s.ok, false);
      if (s.ok) return;
      assert.equal(s.code, "ic_hata");
      assert.equal(depo.eslestirmeOku(), null);
    });
  }

  it("Tailscale adresi yoksa (null) hata, depoya yazılmaz", () => {
    const { b, depo } = kur({ adres: null });
    const s = eslestirmeBaslat(b);
    assert.equal(s.ok, false);
    if (s.ok) return;
    assert.equal(s.code, "ic_hata");
    assert.equal(depo.eslestirmeOku(), null);
  });

  it("aralık sınırları kabul edilir: 100.64.0.0 ve 100.127.255.255", () => {
    for (const adres of ["100.64.0.0", "100.127.255.255"]) {
      const { b } = kur({ adres });
      const s = eslestirmeBaslat(b);
      assert.equal(s.ok, true, adres);
      if (s.ok) assert.equal(s.deger.qr.host, adres);
    }
  });

  it("reddedilen çağrı önceki geçerli kaydı bozmaz", () => {
    const { b, depo, sistem } = kur({ tohum: 5 });
    const ilk = eslestirmeBaslat(b);
    assert.equal(ilk.ok, true);
    const onceki = depo.eslestirmeOku();
    sistem.tailscale = "192.168.0.2";
    assert.equal(eslestirmeBaslat(b).ok, false);
    assert.deepEqual(depo.eslestirmeOku(), onceki);
  });
});

// ---------------------------------------------------------------------------------------------
// Eşleşme yönetimi: --liste, --kaldir
// ---------------------------------------------------------------------------------------------

describe("eslestir: argümanlar", () => {
  it("argümansız kod, --liste, --kaldir <kimlik>, yardım", () => {
    assert.deepEqual(argumanCoz([]), { tur: "kod" });
    assert.deepEqual(argumanCoz(["--liste"]), { tur: "liste" });
    assert.deepEqual(argumanCoz(["--kaldir", "cihazX"]), { tur: "kaldir", device_id: "cihazX" });
    for (const y of ["-h", "--help", "--yardim"]) assert.deepEqual(argumanCoz([y]), { tur: "yardim" });
  });

  it("eksik, fazla ya da bilinmeyen argüman hata (komut 2 ile çıkar)", () => {
    for (const argv of [["--kaldir"], ["--kaldir", ""], ["--kaldir", "  "], ["--kaldir", "--liste"], ["--kaldir", "a", "b"], ["--liste", "x"], ["--sil", "a"], ["kaldir"]]) {
      assert.equal(argumanCoz(argv).tur, "hata", JSON.stringify(argv));
    }
  });

  it("bilinmeyen seçenek iletisinde kontrol karakteri kaçırılır", () => {
    const s = argumanCoz(["--x\u001b[2J"]);
    assert.equal(s.tur, "hata");
    if (s.tur === "hata") assert.ok(!s.ileti.includes("\u001b"));
  });
});

describe("eslestir: --liste ve --kaldir (gerçek depo)", () => {
  const ACIK = "QUNJSy1BTkFIVEFSLUdJWkxJ";
  const IP = "100.64.0.42";
  const zaman = (ms: number): string => `T${ms}`;
  const depoKurY = () => depoAc({ yol: ":memory:", saat: sahteZaman(1000).saat, gunluk: sahteGunluk() });
  const ekle = (d: ReturnType<typeof depoKurY>, id: string, etiket: string | null, ms: number): void =>
    d.cihazEkle({ device_id: id, public_key: ACIK, tailscale_ip: IP, platform: "android", etiket, eslesme_ms: ms });

  it("liste: kimlik, platform, etiket, eşleşme ve kaldırma zamanı; açık anahtar ve IP yazılmaz", () => {
    const d = depoKurY();
    try {
      ekle(d, "cihaz-a", "Telefon", 10);
      ekle(d, "cihaz-b", null, 20);
      d.cihazKaldir("cihaz-b");
      const metin = listeMetni(d.eslesmeler(), zaman);
      assert.equal(
        metin,
        [
          "Eşleşmiş cihazlar (1):",
          '  cihaz-a  android  "Telefon"  eşleşme T10',
          "Kaldırılmış (1; yetkisi yok, geçmişi durur):",
          "  cihaz-b  android  -  eşleşme T20  kaldırıldı T1000",
          "",
        ].join("\n"),
      );
      assert.ok(!metin.includes(ACIK) && !metin.includes(IP));
      assert.equal(listeMetni([], zaman), "Eşleşmiş cihazlar (0):\n  (yok)\n");
    } finally {
      d.kapat();
    }
  });

  it("liste: telefonun yolladığı etiket terminali bozamaz (ESC, satır sonu, yön karakteri kaçırılır, kırpılır)", () => {
    const d = depoKurY();
    try {
      ekle(d, "cihaz-k", "a\u001b[2J\nSAHTE SATIR‮" + "x".repeat(200), 1);
      const metin = listeMetni(d.eslesmeler(), zaman);
      assert.ok(!/[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/.test(metin), JSON.stringify(metin));
      assert.equal(metin.split("\n").length, 3, "etiket yeni satır açmamalı");
      assert.ok(!metin.includes("x".repeat(100)), "etiket kırpılmalı");
    } finally {
      d.kapat();
    }
  });

  it("kaldır: 0 ve bilgi; ikinci kez 0 (idempotent); bilinmeyen kimlik 1 ve stderr", () => {
    const d = depoKurY();
    try {
      ekle(d, "cihaz-a", null, 10);
      const ilk = cihazKaldirKomutu(d, "cihaz-a", zaman);
      assert.equal(ilk.kod, 0);
      assert.match(ilk.cikti, /^Eşleşme kaldırıldı: cihaz-a\n/);
      assert.equal(ilk.hata, "");
      assert.equal(d.cihazGetir("cihaz-a"), null);

      const ikinci = cihazKaldirKomutu(d, "cihaz-a", zaman);
      assert.deepEqual(ikinci, { kod: 0, cikti: "Eşleşme zaten kaldırılmış: cihaz-a (T1000)\n", hata: "" });

      const yok = cihazKaldirKomutu(d, "yok\u001b[2J", zaman);
      assert.equal(yok.kod, 1);
      assert.equal(yok.cikti, "");
      assert.match(yok.hata, /^Cihaz bulunamadı: /);
      assert.ok(!yok.hata.includes("\u001b"), "verilen kimlik kaçırılmalı");
    } finally {
      d.kapat();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Ajanda dalgası: --ajanda
// ---------------------------------------------------------------------------------------------

describe("eslestir --ajanda: pencere ve QR", () => {
  it("QR AjandaEslestirmeQr'dan geçer, EslestirmeQr'dan geçmez; sohbet QR'ı da tersine", () => {
    const { b, anahtar } = kur({ port: 8123 });
    const a = ajandaEslestirmeBaslat(b);
    assert.equal(a.ok, true);
    if (!a.ok) return;
    assert.deepEqual(a.deger.qr, {
      v: AJANDA_QR_SURUMU,
      host: "100.64.0.10",
      port: 8123,
      kod: a.deger.kod,
      server_public_key: anahtar.acikAnahtar(),
      kanal: "ajanda",
    });
    assert.equal(AjandaEslestirmeQr.safeParse(a.deger.qr).success, true);
    assert.equal(EslestirmeQr.safeParse(a.deger.qr).success, false);
    assert.match(a.deger.kod, /^[A-Z0-9]{8}$/);

    const s = eslestirmeBaslat(kur().b);
    assert.equal(s.ok, true);
    if (!s.ok) return;
    assert.equal(AjandaEslestirmeQr.safeParse(s.deger.qr).success, false);
    assert.equal("kanal" in s.deger.qr, false);
  });

  it("pencere depoda kapsam ajanda; yalnız özet, son_ms = şimdi + 5 dk; aynı kod üreteci", () => {
    const { b, depo, zaman } = kur({ tohum: 11 });
    zaman.ilerlet(777);
    const a = ajandaEslestirmeBaslat(b);
    assert.equal(a.ok, true);
    if (!a.ok) return;
    assert.equal(a.deger.sonMs, zaman.simdi() + BES_DK_MS);
    assert.deepEqual(depo.eslestirmeOku(), {
      kod_ozeti: sha256Hex(utf8Bayt(a.deger.kod)),
      son_ms: zaman.simdi() + BES_DK_MS,
      yanlis_deneme: 0,
      kapsam: "ajanda",
    });
    // Aynı tohumla sohbet kodu da aynı: üreteç ortak.
    const s = eslestirmeBaslat(kur({ tohum: 11 }).b);
    assert.equal(s.ok && s.deger.kod, a.deger.kod);
  });

  it("karışmaz: sohbet penceresi kapsamsız yazılır ve ajanda penceresini kapatır; tersi de", () => {
    const { b, depo, zaman } = kur({ tohum: 4 });
    const a = ajandaEslestirmeBaslat(b);
    assert.equal(a.ok, true);
    zaman.ilerlet(1000);
    const s = eslestirmeBaslat(b);
    assert.equal(s.ok, true);
    if (!a.ok || !s.ok) return;
    const sohbetKaydi = depo.eslestirmeOku();
    assert.deepEqual(sohbetKaydi, { kod_ozeti: sha256Hex(utf8Bayt(s.deger.kod)), son_ms: zaman.simdi() + BES_DK_MS, yanlis_deneme: 0 });
    assert.equal(sohbetKaydi !== null && "kapsam" in sohbetKaydi, false, "sohbet penceresinde kapsam alanı yok");

    zaman.ilerlet(1000);
    const a2 = ajandaEslestirmeBaslat(b);
    assert.equal(a2.ok, true);
    if (!a2.ok) return;
    const k = depo.eslestirmeOku();
    assert.equal(k?.kapsam, "ajanda");
    assert.equal(k?.kod_ozeti, sha256Hex(utf8Bayt(a2.deger.kod)));
    assert.notEqual(k?.kod_ozeti, sha256Hex(utf8Bayt(s.deger.kod)));
  });

  it("Tailscale dışı adres: hata, depoya yazılmaz, önceki sohbet penceresi bozulmaz", () => {
    const { b, depo, sistem } = kur({ tohum: 5 });
    assert.equal(eslestirmeBaslat(b).ok, true);
    const onceki = depo.eslestirmeOku();
    for (const adres of ["192.168.0.2", null]) {
      sistem.tailscale = adres;
      const a = ajandaEslestirmeBaslat(b);
      assert.equal(a.ok, false);
      if (!a.ok) assert.equal(a.code, "ic_hata");
      assert.deepEqual(depo.eslestirmeOku(), onceki);
    }
  });
});

describe("eslestir --ajanda: argümanlar", () => {
  it("--ajanda tek başına ve --liste/--kaldir ile, her sırada", () => {
    assert.deepEqual(argumanCoz(["--ajanda"]), { tur: "kod", kapsam: "ajanda" });
    assert.deepEqual(argumanCoz(["--ajanda", "--liste"]), { tur: "liste", kapsam: "ajanda" });
    assert.deepEqual(argumanCoz(["--liste", "--ajanda"]), { tur: "liste", kapsam: "ajanda" });
    assert.deepEqual(argumanCoz(["--ajanda", "--kaldir", "c1"]), { tur: "kaldir", device_id: "c1", kapsam: "ajanda" });
    assert.deepEqual(argumanCoz(["--kaldir", "c1", "--ajanda"]), { tur: "kaldir", device_id: "c1", kapsam: "ajanda" });
    assert.deepEqual(argumanCoz(["--ajanda", "-h"]), { tur: "yardim" });
  });

  it("çelişen, yinelenen, eksik ya da bilinmeyen seçenek anlaşılır hata", () => {
    const durumlar: [string[], RegExp][] = [
      [["--ajanda", "--ajanda"], /--ajanda bir kez/],
      [["--liste", "--kaldir", "c1"], /--liste ve --kaldir/],
      [["--kaldir", "c1", "--liste"], /--liste ve --kaldir/],
      [["--liste", "--liste"], /--liste ve --kaldir/],
      [["--ajanda", "--kaldir"], /--kaldir bir cihaz kimliği ister/],
      [["--kaldir", "--ajanda"], /--kaldir bir cihaz kimliği ister/],
      [["--ajanda", "fazla"], /bilinmeyen seçenek: fazla/],
      [["--ajanda", "--liste", "x"], /--liste ek değer almaz/],
      [["--ajanda", "--kaldir", "a", "b"], /--kaldir tek kimlik alır/],
      [["--ajanda", "--sohbet"], /bilinmeyen seçenek: --sohbet/],
    ];
    for (const [argv, ileti] of durumlar) {
      const s = argumanCoz(argv);
      assert.equal(s.tur, "hata", JSON.stringify(argv));
      if (s.tur === "hata") assert.match(s.ileti, ileti, JSON.stringify(argv));
    }
  });

  it("kullanım metni --ajanda'yı anlatır", () => {
    assert.match(KULLANIM, /eslestir --ajanda /);
    assert.match(KULLANIM, /--ajanda --liste/);
    assert.match(KULLANIM, /--ajanda --kaldir <kimlik>/);
  });
});

describe("eslestir --ajanda: kod çıktısı", () => {
  const ACIK = "YWJj";
  const temel = { kod: "ABCD2345", sonMs: 1000 + BES_DK_MS };
  const sohbetQr = { v: 1, host: "100.64.0.10", port: 7443, kod: "ABCD2345", server_public_key: ACIK };

  it("sohbet çıktısı bugünkü üç satır, bayt bayt", () => {
    assert.equal(
      kodMetni({ ...temel, qr: sohbetQr }, { simdiMs: 1000 }),
      `${JSON.stringify(sohbetQr)}\nParmak izi: ${parmakIzi(ACIK)}\nKod:ABCD2345  (5 dakika geçerli, tek kullanımlık)\n`,
    );
    // Süresi dolmuş ya da aynı kapsamın penceresi not üretmez.
    assert.equal(kodMetni({ ...temel, qr: sohbetQr }, { simdiMs: 1000, oncekiPencere: { son_ms: 999 + BES_DK_MS } }).split("\n").length, 4);
    assert.equal(kodMetni({ ...temel, qr: sohbetQr }, { simdiMs: 1000, oncekiPencere: { son_ms: 999, kapsam: "ajanda" } }).split("\n").length, 4);
  });

  it("ajanda: ilk satır şemadan geçen JSON, sonda kapsam satırı; açık sohbet penceresi kapandıysa not", () => {
    const qr = { ...sohbetQr, v: AJANDA_QR_SURUMU, kanal: "ajanda" as const };
    const metin = kodMetni({ ...temel, qr }, { simdiMs: 1000, kapsam: "ajanda", oncekiPencere: { son_ms: 5000 } });
    const satirlar = metin.split("\n");
    assert.equal(AjandaEslestirmeQr.safeParse(JSON.parse(satirlar[0] ?? "")).success, true);
    assert.equal(satirlar[1], `Parmak izi: ${parmakIzi(ACIK)}`);
    assert.equal(satirlar[2], "Kod:ABCD2345  (5 dakika geçerli, tek kullanımlık)");
    assert.match(satirlar[3] ?? "", /^Kapsam: ajanda .*sohbet kanalını açamaz/);
    assert.match(satirlar[4] ?? "", /^Not: açık sohbet eşleştirme penceresi kapandı/);
    // Sohbet kodu açık ajanda penceresini kapatınca da söylenir.
    assert.match(kodMetni({ ...temel, qr: sohbetQr }, { simdiMs: 1000, oncekiPencere: { son_ms: 5000, kapsam: "ajanda" } }), /Not: açık ajanda eşleştirme penceresi kapandı/);
  });
});

describe("eslestir --ajanda: --liste ve --kaldir (gerçek depo)", () => {
  const ACIK = "QUNJSy1BTkFIVEFSLUdJWkxJ";
  const IP = "100.64.0.42";
  const zaman = (ms: number): string => `T${ms}`;
  const depoKurY = () => depoAc({ yol: ":memory:", saat: sahteZaman(1000).saat, gunluk: sahteGunluk() });
  const ekle = (d: ReturnType<typeof depoKurY>, id: string, ms: number, ajanda: boolean): void =>
    d.cihazEkle({
      device_id: id,
      public_key: ACIK,
      tailscale_ip: IP,
      platform: "android",
      etiket: null,
      eslesme_ms: ms,
      ...(ajanda ? { kapsam: "ajanda" as const } : {}),
    });

  it("liste: ajanda cihazı [ajanda] işaretli, sohbet satırı bugünkü; --ajanda yalnız ajanda cihazlarını gösterir", () => {
    const d = depoKurY();
    try {
      ekle(d, "sohbet-a", 10, false);
      ekle(d, "ajanda-a", 20, true);
      ekle(d, "ajanda-b", 30, true);
      d.cihazKaldir("ajanda-b");
      assert.equal(
        listeMetni(d.eslesmeler(), zaman),
        [
          "Eşleşmiş cihazlar (2):",
          "  sohbet-a  android  -  eşleşme T10",
          "  ajanda-a  android  -  eşleşme T20  [ajanda]",
          "Kaldırılmış (1; yetkisi yok, geçmişi durur):",
          "  ajanda-b  android  -  eşleşme T30  kaldırıldı T1000  [ajanda]",
          "",
        ].join("\n"),
      );
      assert.equal(
        listeMetni(d.eslesmeler(), zaman, "ajanda"),
        [
          "Eşleşmiş ajanda cihazları (1):",
          "  ajanda-a  android  -  eşleşme T20  [ajanda]",
          "Kaldırılmış ajanda cihazları (1; yetkisi yok, geçmişi durur):",
          "  ajanda-b  android  -  eşleşme T30  kaldırıldı T1000  [ajanda]",
          "",
        ].join("\n"),
      );
      assert.equal(listeMetni([], zaman, "ajanda"), "Eşleşmiş ajanda cihazları (0):\n  (yok)\n");
    } finally {
      d.kapat();
    }
  });

  it("kaldır: kapsamsız komut ajanda cihazını kaldırır; --ajanda yalnız ajanda cihazını, sohbet cihazına dokunmaz", () => {
    const d = depoKurY();
    try {
      ekle(d, "sohbet-a", 10, false);
      ekle(d, "ajanda-a", 20, true);
      ekle(d, "ajanda-b", 30, true);

      const yanlis = cihazKaldirKomutu(d, "sohbet-a", zaman, "ajanda");
      assert.equal(yanlis.kod, 1);
      assert.equal(yanlis.cikti, "");
      assert.match(yanlis.hata, /ajanda cihazı değil \(sohbet cihazı\), kaldırılmadı: sohbet-a/);
      assert.notEqual(d.cihazGetir("sohbet-a"), null, "sohbet cihazı yerinde kalmalı");

      const yok = cihazKaldirKomutu(d, "yok", zaman, "ajanda");
      assert.equal(yok.kod, 1);
      assert.match(yok.hata, /^Ajanda cihazı bulunamadı: yok\nKimlikleri görmek için: eslestir --ajanda --liste\n$/);

      const a = cihazKaldirKomutu(d, "ajanda-a", zaman, "ajanda");
      assert.equal(a.kod, 0);
      assert.match(a.cikti, /^Eşleşme kaldırıldı: ajanda-a \(ajanda\)\n[\s\S]*eslestir --ajanda/);
      assert.equal(d.kapsamliCihazGetir("ajanda-a"), null);
      assert.deepEqual(cihazKaldirKomutu(d, "ajanda-a", zaman, "ajanda"), {
        kod: 0,
        cikti: "Eşleşme zaten kaldırılmış: ajanda-a (ajanda) (T1000)\n",
        hata: "",
      });

      const b = cihazKaldirKomutu(d, "ajanda-b", zaman);
      assert.equal(b.kod, 0);
      assert.equal(d.kapsamliCihazGetir("ajanda-b"), null);
      assert.notEqual(d.cihazGetir("sohbet-a"), null);
      assert.equal(d.eslesmeler().find((e) => e.device_id === "ajanda-b")?.kapsam, "ajanda");
    } finally {
      d.kapat();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// PC ajanları: --pc-ajan <ad> (--claude-code onun eski adı)
// ---------------------------------------------------------------------------------------------

describe("eslestir --pc-ajan: argümanlar", () => {
  it("--pc-ajan claude-code, --claude-code ile aynı komut (her alt komutta, her sırada)", () => {
    for (const alt of [[], ["--liste"], ["--kaldir"], ["--teshis"]]) {
      const eski = argumanCoz(["--claude-code", ...alt]);
      assert.notEqual(eski.tur, "hata", JSON.stringify(alt));
      assert.deepEqual(argumanCoz(["--pc-ajan", "claude-code", ...alt]), eski, JSON.stringify(alt));
      assert.deepEqual(argumanCoz([...alt, "--pc-ajan", "claude-code"]), eski, JSON.stringify(alt));
    }
    assert.deepEqual(argumanCoz(["--pc-ajan", "claude-code"]), { tur: "pc_anahtar" });
    assert.deepEqual(argumanCoz(["--pc-ajan", "claude-code", "-h"]), { tur: "yardim" });
  });

  it("başka ad komutta taşınır (doğrulama pcAjanSec'te); claude-code adı taşınmaz", () => {
    assert.deepEqual(argumanCoz(["--pc-ajan", "codex"]), { tur: "pc_anahtar", ajan: "codex" });
    assert.deepEqual(argumanCoz(["--liste", "--pc-ajan", "codex"]), { tur: "pc_liste", ajan: "codex" });
    assert.deepEqual(argumanCoz(["--pc-ajan", "codex", "--kaldir"]), { tur: "pc_kaldir", ajan: "codex" });
    assert.deepEqual(argumanCoz(["--pc-ajan", "codex", "--teshis"]), { tur: "pc_teshis", ajan: "codex" });
    // Büyük/küçük harf ad sayılır: kapalı listede değil, taşınır ve reddedilir.
    assert.deepEqual(argumanCoz(["--pc-ajan", "Claude-Code"]), { tur: "pc_anahtar", ajan: "Claude-Code" });
  });

  it("--claude-code ile --pc-ajan birlikte, eksik ad, yinelenen ve yabancı seçenek hata", () => {
    const ileti = (argv: string[]): string => {
      const s = argumanCoz(argv);
      assert.equal(s.tur, "hata", JSON.stringify(argv));
      return s.tur === "hata" ? s.ileti : "";
    };
    for (const argv of [
      ["--claude-code", "--pc-ajan", "claude-code"],
      ["--pc-ajan", "claude-code", "--claude-code"],
      ["--pc-ajan", "codex", "--claude-code", "--liste"],
    ]) {
      assert.match(ileti(argv), /--claude-code ve --pc-ajan birlikte verilmez/, JSON.stringify(argv));
    }
    for (const argv of [["--pc-ajan"], ["--pc-ajan", ""], ["--pc-ajan", " "], ["--pc-ajan", "--liste"], ["--liste", "--pc-ajan"]]) {
      assert.match(ileti(argv), /--pc-ajan bir ajan adı ister/, JSON.stringify(argv));
    }
    assert.equal(ileti(["--pc-ajan", "a", "--pc-ajan", "b"]), "--pc-ajan bir kez verilir");
    assert.equal(ileti(["--pc-ajan", "claude-code", "--ajanda"]), "--pc-ajan ile kullanılamaz: --ajanda");
    assert.equal(ileti(["--pc-ajan", "claude-code", "--kaldir", "cihaz1"]), "--pc-ajan ile kullanılamaz: cihaz1");
    assert.equal(ileti(["--pc-ajan", "claude-code", "--liste", "--teshis"]), "--liste ve --teshis birlikte verilmez");
    assert.ok(!ileti(["--pc-ajan", "claude-code", "x\u001b[2J"]).includes("\u001b"));
  });

  it("--claude-code hata iletileri bugünkü gibi", () => {
    const ileti = (argv: string[]): string => {
      const s = argumanCoz(argv);
      return s.tur === "hata" ? s.ileti : `hata değil: ${s.tur}`;
    };
    assert.equal(ileti(["--claude-code", "--ajanda"]), "--claude-code ile kullanılamaz: --ajanda");
    assert.equal(ileti(["--claude-code", "--kaldir", "cihaz1"]), "--claude-code ile kullanılamaz: cihaz1");
    assert.equal(ileti(["--claude-code", "--claude-code"]), "--claude-code bir kez verilir");
    assert.equal(ileti(["--claude-code", "--liste", "--kaldir"]), "--liste ve --kaldir birlikte verilmez");
    assert.deepEqual(argumanCoz(["--claude-code", "-h", "--pc-ajan", "x"]), { tur: "yardim" });
  });

  it("yardım metni --pc-ajan'ı, eski adı, ortak anahtarı ve bütün geçerli adları anlatır", () => {
    assert.match(KULLANIM, /eslestir --pc-ajan <ad> \[--liste \| --kaldir \| --teshis\]/);
    assert.match(KULLANIM, /--claude-code, --pc-ajan claude-code'un kısa adıdır/);
    assert.match(KULLANIM, /ikisi birlikte verilmez/);
    assert.match(KULLANIM, /Ajanda anahtarı bütün PC ajanlarında ortaktır/);
    const gecerli = /Geçerli adlar: ([^\n]+)\./.exec(KULLANIM)?.[1];
    assert.deepEqual(gecerli?.split(", "), [...PC_AJAN_ADLARI], "yardımdaki ad listesi kurulum/harness/tur.ts ile aynı olmalı");
    // Eski satırlar yerinde.
    for (const s of ["--claude-code            Yeni ajanda anahtarı", "--claude-code --liste", "--claude-code --kaldir", "--claude-code --teshis"]) {
      assert.ok(KULLANIM.includes(`  eslestir ${s}`), s);
    }
  });
});

describe("eslestir --pc-ajan: uyarlayıcı seçimi", () => {
  it("gerçek kayıt: claude-code uyarlayıcısı; bilinmeyen ad geçerli adlarla reddedilir", async () => {
    const kayit = await pcAjanKaydiYukle();
    assert.deepEqual([...kayit.PC_AJAN_ADLARI], [...PC_AJAN_ADLARI]);
    const s = pcAjanSec("claude-code", kayit);
    assert.ok(s.ok);
    if (!s.ok) return;
    assert.equal(s.ajan, pcAjani("claude-code"));
    assert.deepEqual(s.gorunum, CLAUDE_CODE_GORUNUMU);
    assert.equal(VARSAYILAN_PC_AJANI, "claude-code");
    // Geri uyum yükleyicisi de aynı uyarlayıcıyı verir.
    assert.equal(await kayitYonergesiYukle(), pcAjani("claude-code"));
    for (const ad of ["codex", "Claude-Code", "__proto__", "toString", "constructor"]) {
      const r = pcAjanSec(ad, kayit);
      assert.equal(r.ok, false, ad);
      if (!r.ok) assert.equal(r.ileti, `bilinmeyen PC ajanı: ${ad} (geçerli adlar: ${PC_AJAN_ADLARI.join(", ")})`);
    }
    const kacik = pcAjanSec("x\u001b[2J", kayit);
    assert.ok(!kacik.ok && !kacik.ileti.includes("\u001b"));
  });

  it("kurulum dizini yokken yalnız claude-code geçer (uyarlayıcısız, bugünkü yedek metin)", () => {
    const s = pcAjanSec("claude-code", null);
    assert.deepEqual(s, { ok: true, ajan: null, gorunum: CLAUDE_CODE_GORUNUMU });
    const r = pcAjanSec("codex", null);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.ileti, /^bilinmeyen PC ajanı: codex \(uyarlayıcılar yüklenemedi: kurulum dizini yok; geçerli ad: claude-code\)$/);
    assert.equal(kayitYonergesiYedegi(CLAUDE_CODE_GORUNUMU), KAYIT_YONERGESI_YEDEK);
  });

  it("ikinci uyarlayıcı kayda eklenince seçilir; çıktılar onun adıyla, anahtar notu ortak", () => {
    const deneme: PcAjaniModulu = {
      ad: "deneme",
      gorunenAd: "Deneme Ajanı",
      kayitYonergesi: () => "DENEME YÖNERGESİ\n",
      kancaDurumu: () => ({ ayarYolu: "C:\\deneme\\ayar.toml", arac: false, eski: 1 }),
    };
    const kayit: PcAjanKaydi = { PC_AJAN_ADLARI: ["claude-code", "deneme"], pcAjani: (ad) => (ad === "deneme" ? deneme : null) };
    const s = pcAjanSec("deneme", kayit);
    assert.ok(s.ok);
    if (!s.ok) return;
    assert.equal(s.ajan, deneme);
    const g = s.gorunum;
    assert.deepEqual(g, { ad: "deneme", gorunenAd: "Deneme Ajanı" });
    const y = { anahtarDosyasi: "C:\\veri\\ajanda-pc.anahtar" };
    const anahtar = pcAnahtarMetni(y, 1, "DENEME YÖNERGESİ\n", g);
    assert.match(anahtar, /^Deneme Ajanı ajanda anahtarı üretildi \(önceki anahtar artık geçersiz/);
    assert.match(anahtar, /sızarsa: eslestir --pc-ajan deneme \(yeniler\)/);
    assert.match(anahtar, /bütün PC ajanlarında ortaktır/);
    assert.ok(anahtar.endsWith("DENEME YÖNERGESİ\n"));
    const z = (ms: number) => `t${ms}`;
    const liste = pcListeMetni([{ olusturma_ms: 2, iptal_ms: null }], false, y, z, g);
    assert.match(liste, /^Deneme Ajanı ajanda anahtarı: etkin\n/);
    assert.match(liste, /yenilemek için: eslestir --pc-ajan deneme\n/);
    assert.match(liste, /bütün PC ajanlarında ortaktır/);
    assert.match(pcKaldirMetni(1, true, g), /^Deneme Ajanı ajanda anahtarı geçersiz kılındı ve dosyası silindi[\s\S]*hiçbiri ajandaya erişemez\.\n$/);
    assert.equal(pcKaldirMetni(0, false, g), "Deneme Ajanı ajanda anahtarı zaten yok; hiçbir şey değişmedi.\n");
    const teshis = pcTeshisMetni([], z, deneme.kancaDurumu({}), g);
    assert.match(teshis, /^Kurulum \(C:\\deneme\\ayar\.toml\):\n {2}araç öncesi kanca: YOK\. Bu durumda bütün kayıtlar taslak doğar\. Kurmak için kayıt yönergesine bakın \(eslestir --pc-ajan deneme;/);
    assert.match(teshis, /eski kancaları: 1/);
    assert.match(teshis, /anahtar var mı \(eslestir --pc-ajan deneme --liste\)\?\n {2}Yeni bir Deneme Ajanı oturumunda/);
    for (const m of [anahtar, liste, pcKaldirMetni(1, true, g), teshis]) {
      assert.ok(!/Claude Code|claude-code\.ts|PreToolUse|--claude-code/.test(m), m);
    }
    assert.match(kayitYonergesiYedegi(g), /^Deneme Ajanı kayıt yönergesi üretilemedi/);
  });

  it("Claude Code çıktıları bugünkü metinle bayt bayt aynı (varsayılan, açık görünüm ve kayıttan gelen görünüm)", async () => {
    const kayit = await pcAjanKaydiYukle();
    const s = pcAjanSec("claude-code", kayit);
    assert.ok(s.ok);
    if (!s.ok) return;
    const y = { anahtarDosyasi: "C:\\veri\\ajanda-pc.anahtar" };
    const z = (ms: number) => `t${ms}`;
    for (const g of [undefined, CLAUDE_CODE_GORUNUMU, s.gorunum]) {
      assert.equal(
        pcAnahtarMetni(y, 1, "YÖNERGE\n", g),
        "Claude Code ajanda anahtarı üretildi (önceki anahtar artık geçersiz; açık PC oturumları yeni dosyayı kendiliğinden okur).\n" +
          "Anahtar dosyası: C:\\veri\\ajanda-pc.anahtar\n" +
          "  Yalnız bu Windows kullanıcısı okuyabilir (veri kökü). İçeriğini hiçbir yere yapıştırmayın; sızarsa: eslestir --claude-code (yeniler).\n" +
          "\nYÖNERGE\n",
      );
      assert.equal(
        pcListeMetni([{ olusturma_ms: 2, iptal_ms: null }], false, y, z, g),
        "Claude Code ajanda anahtarı: etkin\n  etkin, üretildi t2\nAnahtar dosyası: C:\\veri\\ajanda-pc.anahtar (yok)\n" +
          "UYARI: anahtar etkin ama dosyası yok; yenilemek için: eslestir --claude-code\n",
      );
      assert.equal(
        pcKaldirMetni(1, true, g),
        "Claude Code ajanda anahtarı geçersiz kılındı ve dosyası silindi. Açık PC oturumlarının köprüsü bir sonraki çağrıda reddedilir; " +
          "kayıtlı MCP sunucusu ve kanca durur, kaldırmak için docs/SERVIS.md \"Claude Code oturumları\".\n",
      );
      assert.equal(pcKaldirMetni(0, false, g), "Claude Code ajanda anahtarı zaten yok; hiçbir şey değişmedi.\n");
      assert.equal(
        pcTeshisMetni([], z, { ayarYolu: "C:\\p\\settings.json", arac: false, eski: 2, kabuk: 0, kapatan: [] }, g),
        "Kurulum (C:\\p\\settings.json):\n" +
          "  araç öncesi kanca (PreToolUse, mcp__eren-ajanda__.*): YOK. Bu durumda bütün kayıtlar taslak doğar. " +
          "Kurmak için: node --disable-warning=ExperimentalWarning kurulum\\claude-code.ts kanca-ekle (sonra Claude Code'u yeniden açın).\n" +
          "  eski kancalar (istem / tur sonu / eski biçim): 2. Artık hiçbir şey yapmazlar ama her mesajda çalışırlar; kanca-ekle onları temizler.\n" +
          "\n" +
          "Servis günlüğünde PC kanca ya da PC araç olayı yok.\n" +
          "  MCP köprüsü kayıtlı mı (kurulum\\claude-code.ts goster), anahtar var mı (eslestir --claude-code --liste)?\n" +
          "  Yeni bir Claude Code oturumunda bir kayıt isteyip yeniden bakın.\n",
      );
      assert.equal(
        pcTeshisMetni([], z, { ayarYolu: "x", arac: true, eski: 0, kabuk: 1, kapatan: ["k"] }, g).split("\n\n")[0],
        "Kurulum (x):\n  araç öncesi kanca (PreToolUse, mcp__eren-ajanda__.*): ayarda kurulu.\n" +
          "  kanca eski kabuk biçiminde: Git Bash'le çalışır, Git Bash bulunamazsa Claude Code PowerShell'e düşer ve orada " +
          "çalışmaz. kanca-ekle onu kabuktan bağımsız yürütme biçimine çevirir.\n" +
          "  UYARI: kancaları kapatan ayar: k. Bu durdukça kanca hiç çalışmaz, bütün kayıtlar taslak doğar.",
      );
    }
  });
});

describe("eslestir: komut satırı (ayrı süreç, temiz ortam)", () => {
  const KOMUT = fileURLToPath(new URL("../src/eslestir.ts", import.meta.url));
  const gecici = mkdtempSync(join(tmpdir(), "eren-eslestir-komut-"));
  after(() => rmSync(gecici, { recursive: true, force: true }));
  const kok = join(gecici, "veri");
  const profil = join(gecici, "profil");
  const yerel = join(profil, "AppData", "Local");
  const dolasan = join(profil, "AppData", "Roaming");
  mkdirSync(yerel, { recursive: true });
  mkdirSync(dolasan, { recursive: true });

  /**
   * Temiz makine (CI) benzetimi: bu makineye özgü hiçbir değişken alt sürece geçmez. Profil klasörleri
   * boş geçici klasöre, PATH yalnız node ve System32'ye iner (`claude`, Tailscale, npm global yok);
   * veri kökü yalnız `EREN_KIT_DATA_DIR` ile verilir.
   */
  const temizOrtam = (): Record<string, string> => {
    const env: Record<string, string> = {};
    for (const ad of ["SystemRoot", "windir", "ComSpec", "PATHEXT", "TEMP", "TMP", "OS"]) {
      const v = process.env[ad];
      if (v !== undefined) env[ad] = v;
    }
    const sistem = process.env["SystemRoot"] ?? "C:\Windows";
    env["PATH"] = [dirname(process.execPath), join(sistem, "System32")].join(";");
    Object.assign(env, { USERPROFILE: profil, HOME: profil, LOCALAPPDATA: yerel, APPDATA: dolasan, EREN_KIT_DATA_DIR: kok });
    return env;
  };

  const calistir = (...argv: string[]) => {
    const r = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", KOMUT, ...argv], {
      env: temizOrtam(),
      encoding: "utf8",
      timeout: 60_000,
    });
    const tani = `eslestir ${argv.join(" ")} -> çıkış ${String(r.status)}${r.error ? ` (${r.error.message})` : ""}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`;
    return { kod: r.status, cikti: r.stdout, hata: r.stderr, tani };
  };

  it("--liste, --kaldir (0, idempotent 0, bilinmeyen 1), hatalı argüman 2; kaldırma kalıcı", () => {
    // Boş veri kökü: veri kökünü ve şemayı komutun kendisi kurar.
    const ilk = calistir("--liste");
    assert.equal(ilk.kod, 0, ilk.tani);
    assert.ok(existsSync(join(kok, "eren.db")), `veri kökü EREN_KIT_DATA_DIR'den alınmalı\n${ilk.tani}`);
    assert.ok(!existsSync(join(yerel, "eren-kit")), "varsayılan köke (LOCALAPPDATA) yazılmamalı");
    // Cihazı servisin yazacağı gibi doğrudan depoya yaz.
    const d = depoAc({ yol: join(kok, "eren.db"), saat: sahteZaman().saat, gunluk: sahteGunluk() });
    try {
      d.cihazEkle({ device_id: "cihaz-s", public_key: "QUNJSw==", tailscale_ip: "100.64.0.7", platform: "android", etiket: "T", eslesme_ms: 1 });
    } finally {
      d.kapat();
    }
    const liste = calistir("--liste");
    assert.equal(liste.kod, 0, liste.tani);
    assert.match(liste.cikti, /Eşleşmiş cihazlar \(1\):\n {2}cihaz-s {2}android/, liste.tani);
    assert.ok(!liste.cikti.includes("QUNJSw==") && !liste.cikti.includes("100.64.0.7"), liste.tani);

    const k1 = calistir("--kaldir", "cihaz-s");
    assert.equal(k1.kod, 0, k1.tani);
    const k2 = calistir("--kaldir", "cihaz-s");
    assert.equal(k2.kod, 0, k2.tani);
    assert.match(k2.cikti, /zaten kaldırılmış/, k2.tani);
    const k3 = calistir("--kaldir", "cihaz-yok");
    assert.equal(k3.kod, 1, k3.tani);
    assert.match(k3.hata, /Cihaz bulunamadı: cihaz-yok/, k3.tani);
    const k4 = calistir("--kaldir");
    assert.equal(k4.kod, 2, k4.tani);
    const k5 = calistir("--bilinmeyen");
    assert.equal(k5.kod, 2, k5.tani);

    const sonra = calistir("--liste");
    assert.match(sonra.cikti, /Eşleşmiş cihazlar \(0\):[\s\S]*Kaldırılmış \(1;[\s\S]*cihaz-s/, sonra.tani);
    const e = depoAc({ yol: join(kok, "eren.db"), saat: sahteZaman().saat, gunluk: sahteGunluk() });
    try {
      assert.equal(e.cihazGetir("cihaz-s"), null);
    } finally {
      e.kapat();
    }
  });

  it("--ajanda --liste ve --ajanda --kaldir: yalnız ajanda cihazı; sohbet cihazı 1 ile korunur; çelişen seçenek 2", () => {
    const d = depoAc({ yol: join(kok, "eren.db"), saat: sahteZaman().saat, gunluk: sahteGunluk() });
    try {
      const ortak = { public_key: "QUNJSw==", tailscale_ip: "100.64.0.8", platform: "android" as const, etiket: null };
      d.cihazEkle({ ...ortak, device_id: "ajanda-s", eslesme_ms: 2, kapsam: "ajanda" });
      d.cihazEkle({ ...ortak, device_id: "sohbet-s", eslesme_ms: 3 });
    } finally {
      d.kapat();
    }
    const liste = calistir("--ajanda", "--liste");
    assert.equal(liste.kod, 0, liste.tani);
    assert.match(liste.cikti, /^Eşleşmiş ajanda cihazları \(1\):\n {2}ajanda-s {2}android .*\[ajanda\]\n/, liste.tani);
    assert.ok(!liste.cikti.includes("sohbet-s"), liste.tani);

    const yanlis = calistir("--ajanda", "--kaldir", "sohbet-s");
    assert.equal(yanlis.kod, 1, yanlis.tani);
    assert.match(yanlis.hata, /ajanda cihazı değil/, yanlis.tani);
    const k = calistir("--kaldir", "ajanda-s", "--ajanda");
    assert.equal(k.kod, 0, k.tani);
    assert.equal(calistir("--ajanda", "--ajanda").kod, 2);
    assert.equal(calistir("--ajanda", "--liste", "--kaldir", "x").kod, 2);

    const e = depoAc({ yol: join(kok, "eren.db"), saat: sahteZaman().saat, gunluk: sahteGunluk() });
    try {
      assert.equal(e.kapsamliCihazGetir("ajanda-s"), null);
      assert.notEqual(e.cihazGetir("sohbet-s"), null);
    } finally {
      e.kapat();
    }
  });

  it("--pc-ajan claude-code ve --claude-code aynı çıktı ve kod; anahtar ajandan bağımsız tek anahtar", () => {
    const anahtarYolu = join(kok, "ajanda-pc.anahtar");
    const etkinler = () => {
      const d = depoAc({ yol: join(kok, "eren.db"), saat: sahteZaman().saat, gunluk: sahteGunluk() });
      try {
        return d.ajandaPcAnahtarlari().filter((a) => a.iptal_ms === null);
      } finally {
        d.kapat();
      }
    };
    const ayni = (eski: string[], yeni: string[], kod = 0) => {
      const a = calistir("--claude-code", ...eski);
      const b = calistir("--pc-ajan", "claude-code", ...yeni);
      assert.equal(a.kod, kod, a.tani);
      assert.equal(b.kod, kod, b.tani);
      assert.equal(b.cikti, a.cikti, `${a.tani}\n---\n${b.tani}`);
      assert.equal(b.hata, a.hata, `${a.tani}\n---\n${b.tani}`);
      return a;
    };
    // Teşhis (yalnız okur; kanca durumu geçici profilden).
    const t = ayni(["--teshis"], ["--teshis"]);
    assert.match(t.cikti, /^Kurulum \(.*settings\.json\):\n {2}araç öncesi kanca \(PreToolUse/, t.tani);
    // Anahtar: önceki etkin anahtar sayısı ikisinde de 0 olsun diye arada kaldırılır.
    calistir("--claude-code", "--kaldir");
    const a = calistir("--claude-code");
    assert.equal(a.kod, 0, a.tani);
    assert.match(a.cikti, /^Claude Code ajanda anahtarı üretildi\.\n/, a.tani);
    assert.match(a.cikti, /claude mcp add eren-ajanda/, a.tani);
    const ilkJeton = readFileSync(anahtarYolu, "utf8");
    assert.equal(calistir("--claude-code", "--kaldir").kod, 0);
    const b = calistir("--pc-ajan", "claude-code");
    assert.equal(b.kod, 0, b.tani);
    assert.equal(b.cikti, a.cikti, `${a.tani}\n---\n${b.tani}`);
    // Aynı tek anahtar deposu ve dosyası: hangi adla üretilirse üretilsin bir etkin anahtar, öteki ad onu görür.
    const jeton = readFileSync(anahtarYolu, "utf8");
    assert.notEqual(jeton, ilkJeton);
    assert.equal(etkinler().length, 1);
    const liste = ayni(["--liste"], ["--liste"]);
    assert.match(liste.cikti, /^Claude Code ajanda anahtarı: etkin\n/, liste.tani);
    // Bilinmeyen ad: 2, geçerli adlarla; anahtara, dosyasına ve depoya dokunulmaz.
    for (const argv of [["--pc-ajan", "codex"], ["--pc-ajan", "codex", "--kaldir"], ["--pc-ajan", "Claude-Code", "--liste"]]) {
      const r = calistir(...argv);
      assert.equal(r.kod, 2, r.tani);
      assert.match(r.hata, new RegExp(`^eslestir: bilinmeyen PC ajanı: ${argv[1]} \\(geçerli adlar: claude-code\\)\n`), r.tani);
      assert.equal(r.cikti, "", r.tani);
      assert.equal(readFileSync(anahtarYolu, "utf8"), jeton, r.tani);
      assert.equal(etkinler().length, 1, r.tani);
    }
    // Birlikte verilen iki ad 2; anahtar yine yerinde.
    const ikisi = calistir("--claude-code", "--pc-ajan", "claude-code", "--kaldir");
    assert.equal(ikisi.kod, 2, ikisi.tani);
    assert.match(ikisi.hata, /^eslestir: --claude-code ve --pc-ajan birlikte verilmez/, ikisi.tani);
    assert.equal(etkinler().length, 1);
    // Kaldırma: ilki gerçekten kaldırır, ikincisi "zaten yok"; iki adla aynı metin.
    const k1 = calistir("--pc-ajan", "claude-code", "--kaldir");
    assert.equal(k1.kod, 0, k1.tani);
    assert.match(k1.cikti, /^Claude Code ajanda anahtarı geçersiz kılındı ve dosyası silindi\./, k1.tani);
    assert.equal(existsSync(anahtarYolu), false);
    assert.equal(etkinler().length, 0);
    const k2 = ayni(["--kaldir"], ["--kaldir"]);
    assert.equal(k2.cikti, "Claude Code ajanda anahtarı zaten yok; hiçbir şey değişmedi.\n", k2.tani);
    // Yardım aynı; sözdizimi hatası ikisinde de 2 (iletide ailenin seçeneği adıyla).
    ayni(["-h"], ["-h"]);
    const h1 = calistir("--claude-code", "--ajanda");
    const h2 = calistir("--pc-ajan", "claude-code", "--ajanda");
    assert.equal(h1.kod, 2, h1.tani);
    assert.equal(h2.kod, 2, h2.tani);
    assert.match(h1.hata, /^eslestir: --claude-code ile kullanılamaz: --ajanda\n/, h1.tani);
    assert.match(h2.hata, /^eslestir: --pc-ajan ile kullanılamaz: --ajanda\n/, h2.tani);
  });

  it("--ajanda kod üretimi de tam ayar ister; neden stderr'e yazılır", () => {
    const r = calistir("--ajanda");
    assert.equal(r.kod, 1, r.tani);
    assert.match(r.hata, /^(eslestir: claude\.exe bulunamadı|Eşleştirme başlatılamadı: )/, r.tani);
  });

  it("beklenmeyen hata nedeni stderr'e yazılır (kod üretmek tam ayar ister; claude yokken neden görünür)", () => {
    const r = calistir();
    assert.equal(r.kod, 1, r.tani);
    // Bu ortamda `claude` yok: ayar hatası. (PATH'teki node dizininde `claude` bulunan bir makinede ayar geçer,
    // Tailscale yokluğu döner.) İkisinde de neden yazılır.
    assert.match(r.hata, /^(eslestir: claude\.exe bulunamadı|Eşleştirme başlatılamadı: )/, r.tani);
    assert.ok(!r.hata.includes("beklenmeyen hata"), r.tani);
  });
});
