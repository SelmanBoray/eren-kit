import assert from "node:assert/strict";
import { test } from "node:test";
import { ANA_SOHBET_ID, type SohbetId } from "@eren/protocol";
import type { SurecKapisi } from "../src/sozlesme.ts";
import * as sahteler from "./sahte.ts";
import { sahteDunya, sahteRastgele, sahteZaman } from "./sahte.ts";

test("saat elle ilerler, zamanlayıcılar vade sırasıyla tetiklenir", () => {
  const z = sahteZaman(1000);
  const sira: string[] = [];
  z.zamanlayici.sonra(300, () => sira.push("c"));
  z.zamanlayici.sonra(100, () => sira.push("a"));
  const iptal = z.zamanlayici.sonra(200, () => sira.push("b-iptal"));
  iptal();
  z.zamanlayici.herAralik(150, () => sira.push(`t${z.saat.simdiMs()}`));
  z.ilerlet(99);
  assert.deepEqual(sira, []);
  z.ilerlet(401);
  assert.deepEqual(sira, ["a", "t1150", "c", "t1300", "t1450"]);
  assert.equal(z.simdi(), 1500);
});

test("zamanlayıcı sırası: eşit vadede kayıt sırası, tetiklenirken saat vadede", () => {
  const z = sahteZaman(0);
  const g: Array<[string, number]> = [];
  z.zamanlayici.sonra(50, () => g.push(["x", z.simdi()]));
  z.zamanlayici.sonra(50, () => g.push(["y", z.simdi()]));
  z.zamanlayici.herAralik(40, () => g.push(["t", z.simdi()]));
  z.ilerlet(100);
  assert.deepEqual(g, [
    ["t", 40],
    ["x", 50],
    ["y", 50],
    ["t", 80],
  ]);
  assert.equal(z.bekleyenSayisi(), 1);
  assert.throws(() => z.git(10), /geriye/);
});

test("tetiklenirken eklenen zamanlayıcı da vadesi gelirse çalışır", () => {
  const z = sahteZaman(0);
  const g: number[] = [];
  z.zamanlayici.sonra(10, () => {
    g.push(z.simdi());
    z.zamanlayici.sonra(10, () => g.push(z.simdi()));
  });
  z.ilerlet(30);
  assert.deepEqual(g, [10, 20]);
});

test("rastgele: aynı tohum aynı dizi, biçimler geçerli", () => {
  const a = sahteRastgele(7);
  const b = sahteRastgele(7);
  assert.deepEqual([a.uuid(), a.hex64(), a.jeton(), a.opakId("pl_")], [b.uuid(), b.hex64(), b.jeton(), b.opakId("pl_")]);
  const c = sahteRastgele(8);
  assert.notEqual(sahteRastgele(7).uuid(), c.uuid());
  assert.match(a.uuid(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.match(a.hex64(), /^[0-9a-f]{16}$/);
  assert.match(a.jeton(), /^[A-Za-z0-9_-]{43}$/);
  assert.match(a.opakId("on"), /^on[A-Za-z0-9_-]+$/);
  assert.equal(a.baytlar(5).length, 5);
  assert.equal(a.cagrilar.say("uuid"), 2);
});

test("dosya: yaz/oku, aralık, boyut bayt, dizin, hata enjeksiyonu", async () => {
  const { dosya } = sahteDunya();
  assert.equal(await dosya.oku("C:\\a\\b.txt"), null);
  await dosya.atomikYaz("C:\\a\\b.txt", "çay");
  assert.equal(await dosya.oku("C:/a/b.txt"), "çay");
  assert.equal(await dosya.boyut("C:/a/b.txt"), 4);
  assert.equal(await dosya.boyut("C:/yok"), null);
  assert.deepEqual([...(await dosya.aralikOku("C:/a/b.txt", 1, 2))], [...new TextEncoder().encode("çay")].slice(1, 3));
  assert.equal((await dosya.aralikOku("C:/a/b.txt", 99, 2)).length, 0);
  assert.equal((await dosya.aralikOku("C:/yok", 0, 2)).length, 0);
  dosya.ekle("C:/a/out.jsonl", "1\n");
  dosya.ekle("C:/a/out.jsonl", "2\n");
  assert.equal(dosya.icerik("C:/a/out.jsonl"), "1\n2\n");
  assert.equal(await dosya.dizinVarMi("C:/a"), true);
  assert.equal(await dosya.dizinVarMi("C:/b"), false);
  await dosya.dizinOlustur("C:/b/c/");
  assert.equal(await dosya.dizinVarMi("C:/b"), true);
  assert.equal(await dosya.dizinVarMi("C:/b/c"), true);
  dosya.hataVer("oku", new Error("bozuk"));
  await assert.rejects(dosya.oku("C:/a/b.txt"), /bozuk/);
  assert.equal(await dosya.oku("C:/a/b.txt"), "çay");
  assert.equal(dosya.cagrilar.say("atomikYaz"), 1);
  assert.deepEqual(dosya.cagrilar.son("atomikYaz")?.args, ["C:\\a\\b.txt", "çay"]);
});

test("günlük dosyası ve gunluk kaydı", () => {
  const d = sahteDunya();
  d.kayit.satirEkle("ab");
  d.kayit.satirEkle("c");
  assert.equal(d.kayit.boyut(), 5);
  d.kayit.boyutuZorla(999);
  assert.equal(d.kayit.boyut(), 999);
  d.kayit.dondur(3);
  assert.deepEqual(d.kayit.dondurmeler, [3]);
  d.gunluk.uyari("kilit", "bozuk", { neden: "x" });
  d.gunluk.bilgi("kilit", "acildi");
  assert.equal(d.gunluk.bul("bozuk", "uyari").length, 1);
  assert.equal(d.gunluk.bul("bozuk", "hata").length, 0);
  assert.deepEqual(d.gunluk.girdiler[0]?.alanlar, { neden: "x" });
});

test("süreç: borulu başlatma kaydı, akış, çıkış, yazma", async () => {
  const d = sahteDunya({ baslangicMs: 5000, servisPid: 42 });
  const s = await d.dunya.surec.boruluBaslat({ exe: "claude", argv: ["--x", ""], cwd: "C:/w", ortam: { A: "1" } });
  assert.equal(s.olusturmaMs, 5000);
  assert.deepEqual(d.surec.baslatmalar[0]?.istek, { exe: "claude", argv: ["--x", ""], cwd: "C:/w", ortam: { A: "1" } });
  const satirlar: string[] = [];
  const hatalar: string[] = [];
  let cikti = 0;
  s.stdoutSatirDinle((x) => satirlar.push(x));
  s.stderrDinle((x) => hatalar.push(x));
  s.cikisDinle(() => cikti++);
  const sb = d.surec.sonBorulu();
  sb.stdoutSatiriGonder("bir");
  sb.stderrParcasiGonder("uyari");
  assert.deepEqual(satirlar, ["bir"]);
  assert.deepEqual(hatalar, ["uyari"]);
  assert.equal(s.satirYaz("merhaba"), true);
  assert.deepEqual(sb.yazilanlar, ["merhaba"]);
  sb.boruyuKir();
  assert.equal(s.satirYaz("x"), false);
  assert.equal(sb.cikisKodu, null);
  sb.cik(3);
  sb.cik(9);
  assert.equal(cikti, 1);
  assert.equal(sb.cikisKodu, 3);
  assert.equal(await d.dunya.surec.surecVarMi(s), false);
  s.cikisDinle(() => cikti++);
  assert.equal(cikti, 2);
});

test("süreç: ayrık, anlık görüntü, surecVarMi, ağaç ve tek öldürme", async () => {
  const d = sahteDunya({ servisPid: 42 });
  const a = await d.dunya.surec.ayrikBaslat({ exe: "claude", argv: [], cwd: "C:/w", ortam: {}, outYol: "o", errYol: "e" });
  assert.equal(d.surec.baslatmalar[0]?.tur, "ayrik");
  const torun = d.surec.surecEkle({ pid: 9001, ppid: a.pid, ad: "node.exe" });
  const yetim = d.surec.surecEkle({ pid: 9002, ppid: 1 });
  assert.equal((await d.dunya.surec.anlikGoruntu()).length, 3);
  assert.equal(await d.dunya.surec.surecVarMi(a), true);
  assert.equal(await d.dunya.surec.surecVarMi({ pid: a.pid, olusturmaMs: a.olusturmaMs + 5000 }), false);
  assert.equal(await d.dunya.surec.surecVarMi({ pid: a.pid, olusturmaMs: a.olusturmaMs + 900 }), true);
  let bitti = 0;
  a.cikisDinle(() => bitti++);
  await d.dunya.surec.tekOldur(yetim.pid);
  assert.equal(await d.dunya.surec.surecVarMi(yetim), false);
  assert.equal(await d.dunya.surec.surecVarMi(torun), true);
  await d.dunya.surec.agaciOldur(a.pid);
  assert.equal(bitti, 1);
  assert.equal(await d.dunya.surec.surecVarMi(torun), false);
  assert.deepEqual((await d.dunya.surec.anlikGoruntu()).length, 0);
  assert.deepEqual(d.surec.oldurmalar, [
    { tur: "tek", pid: 9002 },
    { tur: "agac", pid: a.pid },
  ]);
});

test("süreç: araç cevapları, başlatma hatası, PID", async () => {
  const d = sahteDunya();
  assert.deepEqual(await d.dunya.surec.aracCalistir({ exe: "gh", argv: ["a"], zamanAsimiMs: 10 }), {
    zamanAsimi: false,
    stdout: "",
    stderr: "",
  });
  d.surec.aracCevabiKuyruga({ zamanAsimi: false, stdout: "ok", stderr: "" });
  d.surec.aracCevabiKuyruga((i) => ({ zamanAsimi: true, stdout: i.argv.join(","), stderr: "" }));
  d.surec.aracCevabiKuyruga(new Error("yok"));
  assert.equal((await d.dunya.surec.aracCalistir({ exe: "gh", argv: [], zamanAsimiMs: 1 })).stdout, "ok");
  const ikinci = await d.dunya.surec.aracCalistir({ exe: "gh", argv: ["p", "q"], zamanAsimiMs: 1 });
  assert.equal(ikinci.stdout, "p,q");
  assert.equal(ikinci.zamanAsimi, true);
  await assert.rejects(d.dunya.surec.aracCalistir({ exe: "gh", argv: [], zamanAsimiMs: 1 }), /yok/);
  assert.equal(d.surec.araclar.length, 4);

  d.surec.sonrakiBaslatmaHatasi(new Error("ENOENT"));
  await assert.rejects(d.dunya.surec.boruluBaslat({ exe: "x", argv: [], cwd: "c", ortam: {} }), /ENOENT/);
  d.surec.sonrakiPid(777);
  const s = await d.dunya.surec.boruluBaslat({ exe: "x", argv: [], cwd: "c", ortam: {} });
  assert.equal(s.pid, 777);
  assert.equal(d.surec.cagrilar.say("boruluBaslat"), 2);
  assert.equal(d.surec.baslatmalar.length, 1);
});

test("sistem, http, anahtar, tekil kilit", async () => {
  const d = sahteDunya();
  assert.deepEqual(d.dunya.sistem.ramOku(), { bosMb: 8000, toplamMb: 16000 });
  d.sistem.ram = { bosMb: 100, toplamMb: 16000 };
  d.sistem.tailscale = null;
  d.sistem.masaustu = "kopuk";
  assert.equal(d.dunya.sistem.ramOku().bosMb, 100);
  assert.equal(d.dunya.sistem.tailscaleAdresi(), null);
  assert.equal(await d.dunya.sistem.masaustuDurumu(), "kopuk");

  d.http.durumKuyruga(500);
  d.http.hataVer(new Error("ag"));
  assert.deepEqual(await d.dunya.http.postJson("https://x/y", { a: 1 }, 5), { durum: 500 });
  await assert.rejects(d.dunya.http.postJson("u", {}, 5), /ag/);
  assert.deepEqual(await d.dunya.http.postJson("u", {}, 5), { durum: 200 });
  assert.deepEqual(d.http.istekler[0], { url: "https://x/y", govde: { a: 1 }, zamanAsimiMs: 5 });

  const im = d.dunya.anahtar.imzala("m");
  assert.equal(d.dunya.anahtar.dogrula(d.dunya.anahtar.acikAnahtar(), "m", im), true);
  assert.equal(d.dunya.anahtar.dogrula(d.dunya.anahtar.acikAnahtar(), "baska", im), false);
  assert.equal(d.dunya.anahtar.sabitZamanEsit("a", "a"), true);
  assert.equal(d.dunya.anahtar.sabitZamanEsit("a", "b"), false);

  assert.equal(await d.dunya.tekilKilit.al(), true);
  d.tekilKilit.alinabilir = false;
  assert.equal(await d.dunya.tekilKilit.al(), false);
  assert.equal(d.tekilKilit.cagrilar.say("al"), 2);
});

test("ws: bağlantı, gönderme, mesaj, kapanış", async () => {
  const d = sahteDunya();
  assert.throws(() => d.ws.baglan("/sohbet"), /dinle/);
  const gelenler: string[] = [];
  let kapanan = 0;
  const sunucu = await d.dunya.ws.dinle({
    host: "100.64.0.1",
    port: 1,
    azamiCerceve: { "/sohbet": 10, "/cihaz": 20 },
    baglanti: (b) => {
      b.mesajDinle((m) => gelenler.push(`${b.yol}:${b.uzakIp}:${m}`));
      b.kapanisDinle(() => kapanan++);
      b.gonder("selam");
    },
  });
  const b = d.ws.baglan("/cihaz", "100.64.0.9");
  assert.deepEqual(b.gonderilenler, ["selam"]);
  b.mesajGonder("hey");
  assert.deepEqual(gelenler, ["/cihaz:100.64.0.9:hey"]);
  b.kapat(4001, "neden");
  assert.deepEqual(b.kapanis, { kod: 4001, neden: "neden" });
  assert.equal(kapanan, 1);
  b.gonder("sonra");
  b.mesajGonder("sonra");
  b.istemciKopar();
  assert.equal(kapanan, 1);
  assert.equal(gelenler.length, 1);
  const c = d.ws.baglan("/sohbet");
  c.istemciKopar();
  assert.equal(kapanan, 2);
  assert.equal(d.ws.istek()?.port, 1);
  await sunucu.kapat();
  assert.equal(d.ws.kapatildi, true);
  d.ws.sonrakiDinlemeHatasi(new Error("EADDRINUSE"));
  await assert.rejects(d.dunya.ws.dinle({ host: "h", port: 2, azamiCerceve: { "/sohbet": 1, "/cihaz": 1 }, baglanti: () => {} }), /EADDRINUSE/);
});

test("boru: satır, azami satır aşımında kapanır ve iletmez", async () => {
  const d = sahteDunya();
  const gelen: string[] = [];
  await d.dunya.boru.dinle({
    ad: "eren-test",
    azamiSatir: 5,
    baglanti: (b) => {
      b.satirDinle((s) => gelen.push(s));
      b.satirYaz("hos");
    },
  });
  const b = d.boru.baglan();
  assert.deepEqual(b.yazilanlar, ["hos"]);
  b.satirGonder("abc");
  b.satirGonder("uzunuzun");
  assert.deepEqual(gelen, ["abc"]);
  assert.equal(b.kapandi, true);
  b.satirGonder("x");
  assert.deepEqual(gelen, ["abc"]);
  assert.equal(d.boru.istek()?.ad, "eren-test");
});

test("dünya: her port sahte, DisDunya olarak atanabilir ve tohumlar ayrı dünyalarda aynı", () => {
  const a = sahteDunya({ tohum: 1 });
  const b = sahteDunya({ tohum: 1 });
  assert.equal(a.dunya.rastgele.uuid(), b.dunya.rastgele.uuid());
  assert.equal(a.dunya.saat.simdiMs(), 1_700_000_000_000);
  a.zaman.ilerlet(1000);
  assert.equal(a.dunya.saat.simdiMs(), 1_700_000_001_000);
  assert.equal(b.dunya.saat.simdiMs(), 1_700_000_000_000);
  assert.equal(a.zaman.cagrilar.say("simdiMs"), 2);
});

// ---------------------------------------------------------------------------------------------
// Dilim 2: DosyaPortu.dosyaSil sahtesi ve sahteKapi (SurecKapisi sahtesi)
// ---------------------------------------------------------------------------------------------

const SOHBET_B = "sohbet-b" as SohbetId;
/** Defter satırı `SohbetSecimi` ya da düz kimlik olabilir; ikisini de kimliğe indirir. */
const kimlik = (x: unknown): unknown => (typeof x === "object" && x !== null ? (x as { sohbet_id?: unknown }).sohbet_id : x);

test("dosyaSil: dosyayı siler, olmayan yol sessiz, çağrı defterine yazar, hata enjekte edilir", async () => {
  const { dosya } = sahteDunya();
  await dosya.atomikYaz("C:/m/eren-1.json", "{}");
  assert.equal(await dosya.oku("C:/m/eren-1.json"), "{}");
  await dosya.dosyaSil("C:/m/eren-1.json");
  assert.equal(await dosya.oku("C:/m/eren-1.json"), null);
  assert.equal(dosya.icerik("C:/m/eren-1.json"), null);
  await dosya.dosyaSil("C:/m/yok.json");
  await dosya.dosyaSil("C:/m/eren-1.json");
  assert.equal(dosya.cagrilar.say("dosyaSil"), 3);
  assert.deepEqual(dosya.cagrilar.son("dosyaSil")?.args, ["C:/m/eren-1.json"]);
  dosya.yaz("C:/m/baska.json", "x");
  dosya.hataVer("dosyaSil", new Error("kilitli"));
  await assert.rejects(dosya.dosyaSil("C:/m/baska.json"), /kilitli/);
  assert.equal(dosya.icerik("C:/m/baska.json"), "x");
  await dosya.dosyaSil("C:/m/baska.json");
  assert.equal(dosya.icerik("C:/m/baska.json"), null);
});

test("dosyaSil: eşzamanlı sil(yol) test yardımcısı port yöntemi değildir ve çağrı yazmaz", async () => {
  const { dosya } = sahteDunya();
  dosya.yaz("C:/m/a.json", "1");
  dosya.sil("C:/m/a.json");
  assert.equal(dosya.icerik("C:/m/a.json"), null);
  assert.equal(dosya.cagrilar.say("dosyaSil"), 0);
  assert.equal(typeof dosya.dosyaSil, "function");
  assert.notEqual(dosya.dosyaSil as unknown, dosya.sil as unknown);
});

test("sahteKapi: varsayılan her isteğe true, yinelenen istek aynı sohbete yuva tutar, defterler dolar", () => {
  const kapi: SurecKapisi & Record<string, any> = sahteler.sahteKapi();
  assert.equal(kapi.yuvaIste({ sohbet_id: ANA_SOHBET_ID }), true);
  assert.equal(kapi.yuvaIste({ sohbet_id: ANA_SOHBET_ID }), true);
  assert.equal(kapi.yuvaIste({ sohbet_id: SOHBET_B }), true);
  assert.equal(kapi.devirSerbestMi(), true);
  assert.deepEqual(kapi.istekler.map(kimlik), [ANA_SOHBET_ID, ANA_SOHBET_ID, SOHBET_B]);
  assert.deepEqual([...kapi.yuvadakiler()].map(kimlik).sort(), [ANA_SOHBET_ID, SOHBET_B].sort());
  kapi.yuvaBirak({ sohbet_id: ANA_SOHBET_ID });
  kapi.yuvaBirak({ sohbet_id: ANA_SOHBET_ID });
  assert.deepEqual(kapi.birakmalar.map(kimlik), [ANA_SOHBET_ID, ANA_SOHBET_ID]);
  assert.deepEqual([...kapi.yuvadakiler()].map(kimlik), [SOHBET_B]);
});

test("sahteKapi: izin(false) reddeder ve yuva ayırmaz, izin(true) geri açar; devirIzni ayrı ayarlanır", () => {
  const kapi: SurecKapisi & Record<string, any> = sahteler.sahteKapi();
  kapi.izin(false);
  assert.equal(kapi.yuvaIste({ sohbet_id: ANA_SOHBET_ID }), false);
  assert.equal(kapi.devirSerbestMi(), true);
  assert.deepEqual([...kapi.yuvadakiler()], []);
  assert.equal(kapi.istekler.length, 1);
  kapi.izin(true);
  assert.equal(kapi.yuvaIste({ sohbet_id: ANA_SOHBET_ID }), true);
  assert.deepEqual([...kapi.yuvadakiler()].map(kimlik), [ANA_SOHBET_ID]);
  kapi.devirIzni(false);
  assert.equal(kapi.devirSerbestMi(), false);
  assert.equal(kapi.yuvaIste({ sohbet_id: SOHBET_B }), true);
  kapi.devirIzni(true);
  assert.equal(kapi.devirSerbestMi(), true);
});

test("sahteKapi: yuva tutmayan sohbetin bırakması etkisiz; her çağrı yeni bağımsız kapı verir", () => {
  const a: SurecKapisi & Record<string, any> = sahteler.sahteKapi();
  const b: SurecKapisi & Record<string, any> = sahteler.sahteKapi();
  a.yuvaBirak({ sohbet_id: SOHBET_B });
  assert.deepEqual([...a.yuvadakiler()], []);
  assert.equal(a.birakmalar.length, 1);
  a.izin(false);
  assert.equal(b.yuvaIste({ sohbet_id: SOHBET_B }), true);
  assert.equal(b.istekler.length, 1);
  assert.equal(a.istekler.length, 0);
});
