import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { EslestirmeQr, sha256Hex, SINIRLAR, utf8Bayt } from "@eren/protocol";
import { createHash, generateKeyPairSync } from "node:crypto";
import { depoAc, depoKur } from "../src/depo.ts";
import { argumanCoz, cihazKaldirKomutu, eslestirmeBaslat, listeMetni, parmakIzi } from "../src/eslestir.ts";
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

  it("beklenmeyen hata nedeni stderr'e yazılır (kod üretmek tam ayar ister; claude yokken neden görünür)", () => {
    const r = calistir();
    assert.equal(r.kod, 1, r.tani);
    // Bu ortamda `claude` yok: ayar hatası. (PATH'teki node dizininde `claude` bulunan bir makinede ayar geçer,
    // Tailscale yokluğu döner.) İkisinde de neden yazılır.
    assert.match(r.hata, /^(eslestir: claude\.exe bulunamadı|Eşleştirme başlatılamadı: )/, r.tani);
    assert.ok(!r.hata.includes("beklenmeyen hata"), r.tani);
  });
});
