/**
 * PC oturumlarının yan parçaları (`docs/AJANDA.md` "PC oturumları"): depo (ek göç 7, PC anahtarları),
 * `eslestir --claude-code` saf parçaları ve kanca sürecinin gövdesi (`pcKancaCalistir`) sahte boruyla.
 * Uçtan uca yol `birlesim-ajanda-pc.test.ts`'te.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, describe, it } from "node:test";
import { AJANDA_BORU_ADI, AJANDA_PC_SINIRLARI, PC_TUR_KARARLARI, PROTOKOL_SURUMU, pcKancaYukariCoz, sha256Hex } from "@eren/protocol";
import { depoAc } from "../src/depo.ts";
import type { CihazYonetimliDepo } from "../src/depo.ts";
import {
  argumanCoz,
  CLAUDE_CODE_MCP_ADI,
  KAYIT_YONERGESI_YEDEK,
  kayitYonergesiYukle,
  KULLANIM,
  pcAnahtarMetni,
  pcAnahtariUret,
  pcKaldirMetni,
  pcListeMetni,
  pcTeshisMetni,
  TESHIS_KARAR_METNI,
} from "../src/eslestir.ts";
import { pcKancaCalistir } from "../src/kanca.ts";
import type { PcKancaBagimliliklari } from "../src/kanca.ts";
import type { BoruBaglantisi } from "../src/sozlesme.ts";
import { ajandaPcAnahtarYolu } from "../src/veri-koku.ts";
import { sahteGunluk, sahteRastgele, sahteZaman } from "./sahte.ts";

const kok = mkdtempSync(join(tmpdir(), "eren-ajanda-pc-yan-"));
after(() => rmSync(kok, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
let sayac = 0;
const yeniYol = (): string => join(kok, `vt-${++sayac}.db`);
const acilanlar: CihazYonetimliDepo[] = [];
afterEach(() => {
  for (const d of acilanlar.splice(0)) {
    try {
      d.kapat();
    } catch {
      // zaten kapalı
    }
  }
});
const kur = (yol = ":memory:") => {
  const depo = depoAc({ yol, saat: sahteZaman().saat, gunluk: sahteGunluk() });
  acilanlar.push(depo);
  return depo;
};
const ozet = (j: string): string => sha256Hex(new TextEncoder().encode(j));

describe("depo: PC anahtarları (ek göç 7)", () => {
  it("tablo STRICT, yalnız özet; yeni anahtar öncekileri iptal eder; iptal ve geçmiş", () => {
    const yol = yeniYol();
    const d = kur(yol);
    assert.deepEqual(d.ajandaPcAnahtarlari(), []);
    assert.equal(d.ajandaPcAnahtariGecerliMi(ozet("a".repeat(43))), false);
    d.ajandaPcAnahtariYaz(ozet("a".repeat(43)), 100);
    d.ajandaPcAnahtariYaz(ozet("b".repeat(43)), 200);
    assert.equal(d.ajandaPcAnahtariGecerliMi(ozet("a".repeat(43))), false);
    assert.equal(d.ajandaPcAnahtariGecerliMi(ozet("b".repeat(43))), true);
    assert.deepEqual(d.ajandaPcAnahtarlari(), [
      { olusturma_ms: 100, iptal_ms: 200 },
      { olusturma_ms: 200, iptal_ms: null },
    ]);
    assert.throws(() => d.ajandaPcAnahtariYaz("b".repeat(43), 300), /özeti geçersiz/);
    assert.equal(d.ajandaPcAnahtarlariniIptalEt(400), 1);
    assert.equal(d.ajandaPcAnahtarlariniIptalEt(500), 0);
    assert.equal(d.ajandaPcAnahtariGecerliMi(ozet("b".repeat(43))), false);
    // Açılıştaki ajanda jetonu temizliği PC anahtarına dokunmaz.
    d.ajandaPcAnahtariYaz(ozet("c".repeat(43)), 600);
    d.ajandaJetonlariniSil();
    assert.equal(d.ajandaPcAnahtariGecerliMi(ozet("c".repeat(43))), true);
    d.kapat();
    const h = new DatabaseSync(yol);
    try {
      const t = (h.prepare("PRAGMA table_list").all() as Array<{ name: string; strict: number }>).find((x) => x.name === "ajanda_pc_anahtarlari");
      assert.equal(t?.strict, 1);
      const satirlar = h.prepare("SELECT * FROM ajanda_pc_anahtarlari").all() as Array<Record<string, unknown>>;
      for (const s of satirlar) assert.match(String(s["ozet"]), /^[0-9a-f]{64}$/);
      assert.ok(!JSON.stringify(satirlar).includes("c".repeat(43)), "düz anahtar depoda");
    } finally {
      h.close();
    }
  });

  it("ek sürüm 6 dosyası göç 7'yi bir kez alır; sayacı geri kalmış dosyada yeniden uygulanabilir, veri durur", () => {
    const yol = yeniYol();
    const a = kur(yol);
    a.ajandaPcAnahtariYaz(ozet("a".repeat(43)), 1);
    a.kapat();
    const h = new DatabaseSync(yol);
    h.exec("UPDATE sema_ek SET deger = 6 WHERE anahtar = 'ek_surum'");
    h.close();
    const b = kur(yol);
    assert.deepEqual(b.semaBilgisi(), { user_version: 1, ek_surum: 8 });
    assert.equal(b.ajandaPcAnahtariGecerliMi(ozet("a".repeat(43))), true);
  });
});

describe("eslestir --claude-code", () => {
  it("argümanlar: anahtar, --liste, değersiz --kaldir; --ajanda ve kimlik birleşmez", () => {
    assert.deepEqual(argumanCoz(["--claude-code"]), { tur: "pc_anahtar" });
    assert.deepEqual(argumanCoz(["--claude-code", "--liste"]), { tur: "pc_liste" });
    assert.deepEqual(argumanCoz(["--liste", "--claude-code"]), { tur: "pc_liste" });
    assert.deepEqual(argumanCoz(["--kaldir", "--claude-code"]), { tur: "pc_kaldir" });
    assert.match(KULLANIM, /--claude-code --teshis/);
    assert.deepEqual(argumanCoz(["--claude-code", "-h"]), { tur: "yardim" });
    for (const argv of [
      ["--claude-code", "--ajanda"],
      ["--claude-code", "--kaldir", "cihaz1"],
      ["--claude-code", "--liste", "--kaldir"],
      ["--claude-code", "--claude-code"],
    ]) {
      assert.equal(argumanCoz(argv).tur, "hata", JSON.stringify(argv));
    }
    // Eski komutlar aynı.
    assert.deepEqual(argumanCoz(["--kaldir", "c1"]), { tur: "kaldir", device_id: "c1" });
    assert.match(KULLANIM, /eslestir --claude-code /);
  });

  it("anahtar üretimi: güvenli üreteçten jeton, depoya yalnız özeti", () => {
    const d = kur();
    const r = sahteRastgele(5);
    const { jeton, ozet: o } = pcAnahtariUret({ depo: d, rastgele: r, saat: { simdiMs: () => 42 } });
    assert.ok(jeton.length >= 43);
    assert.equal(o, ozet(jeton));
    assert.equal(d.ajandaPcAnahtariGecerliMi(o), true);
    assert.deepEqual(d.ajandaPcAnahtarlari(), [{ olusturma_ms: 42, iptal_ms: null }]);
  });

  it("kayıt yönergesi tek kaynaktan (kurulum/claude-code.ts) ve güncellemeye dayanıklı yollarla; anahtar yazılmaz", async () => {
    const y = { anahtarDosyasi: ajandaPcAnahtarYolu("C:\\ornek\\Yerel\\eren-kit") };
    assert.equal(y.anahtarDosyasi, "C:\\ornek\\Yerel\\eren-kit\\ajanda-pc.anahtar");
    assert.equal(CLAUDE_CODE_MCP_ADI, "eren-ajanda");
    const ortam = { LOCALAPPDATA: "C:\\ornek\\Yerel", USERPROFILE: "C:\\ornek\\Kullanici" };
    const modul = await kayitYonergesiYukle();
    const yonerge = modul.kayitYonergesi(ortam, "C:\\ornek\\node.exe");
    // eslestir'in yazdığı yönerge, kurulum betiğinin `goster`'iyle aynı kaynaktan (adım 0'sız).
    const kurulum = await import("../../kurulum/claude-code.ts");
    assert.equal(yonerge, kurulum.gosterMetni(kurulum.yollar(ortam, "C:\\ornek\\node.exe"), "C:\\ornek\\Kullanici\\.claude\\settings.json", false));
    const m = pcAnahtarMetni(y, 1, yonerge);
    assert.match(m, /önceki anahtar artık geçersiz/);
    assert.ok(m.endsWith(yonerge));
    // Yollar veri kökünün `guncel` bağlantısından; sürüm dizini (`surumler`) hiçbir komuta girmez.
    assert.ok(m.includes("C:\\ornek\\Yerel\\eren-kit\\uygulama\\guncel\\server\\src\\kopru.ts --rol pc_oturumu"));
    // Kanca yürütme biçiminde (kabuksuz): komut Node, argümanlar ayrı; kabuk sözdizimi yok.
    assert.ok(m.includes('"command": "C:\\\\ornek\\\\node.exe"'));
    assert.ok(m.includes('"C:\\\\ornek\\\\Yerel\\\\eren-kit\\\\uygulama\\\\guncel\\\\server\\\\src\\\\kanca.ts",\n'));
    assert.equal(m.includes("|| true"), false);
    // Yalın yol: istem ve tur sonu kancası önerilmez.
    assert.equal(/kanca\.ts\\" (istem|tur_sonu)|UserPromptSubmit|"Stop"/.test(m), false);
    // Teşhisin okuduğu kanca durumu da aynı modülden.
    assert.deepEqual(modul.kancaDurumu({ ...ortam, USERPROFILE: join(kok, "yok-kullanici") }), {
      ayarYolu: join(kok, "yok-kullanici", ".claude", "settings.json"),
      arac: false,
      eski: 0,
      kabuk: 0,
      kapatan: [],
    });
    assert.equal(/surumler/i.test(m), false);
    assert.ok(m.includes(y.anahtarDosyasi));
    assert.equal(pcAnahtarMetni(y, 0, yonerge).includes("önceki anahtar"), false);
    assert.ok(pcAnahtarMetni(y, 0, KAYIT_YONERGESI_YEDEK).includes("claude-code.ts goster"));
    const z = (ms: number) => `t${ms}`;
    assert.equal(
      pcListeMetni([{ olusturma_ms: 1, iptal_ms: 2 }, { olusturma_ms: 2, iptal_ms: null }], true, y, z),
      `Claude Code ajanda anahtarı: etkin\n  etkin, üretildi t2\nGeçersiz kılınmış anahtarlar (1):\n  üretildi t1  geçersiz t2\nAnahtar dosyası: ${y.anahtarDosyasi} (var)\n`,
    );
    assert.match(pcListeMetni([{ olusturma_ms: 2, iptal_ms: null }], false, y, z), /UYARI: anahtar etkin ama dosyası yok/);
    assert.match(pcListeMetni([], false, y, z), /^Claude Code ajanda anahtarı: yok/);
    assert.match(pcKaldirMetni(1, true), /geçersiz kılındı ve dosyası silindi/);
    assert.match(pcKaldirMetni(0, false), /zaten yok/);
  });

  it("eslestir kendi dosya yolundan komut yolu türetmez (servis surumler\\<sürüm>'den çalışır)", () => {
    const kaynak = readFileSync(new URL("../src/eslestir.ts", import.meta.url), "utf8");
    assert.equal(/import\.meta\.(filename|dirname)/.test(kaynak), false);
    // `import.meta.url` yalnız aynı sürümün kurulum modülünü YÜKLEMEK için.
    assert.deepEqual([...kaynak.matchAll(/import\.meta\.url/g)].length, 1);
  });

  it("--teshis: argüman; günlükten yalnız izinli alanlar, metin ve tam kimlik yok; sınama özeti", () => {
    assert.deepEqual(argumanCoz(["--claude-code", "--teshis"]), { tur: "pc_teshis" });
    assert.equal(argumanCoz(["--claude-code", "--teshis", "--liste"]).tur, "hata");
    const s = (o: Record<string, unknown>) => JSON.stringify({ ts_ms: 1, seviye: "bilgi", ...o });
    const satirlar = [
      // Önceki sürümün istem olayı (metinle): teşhise hiç girmez.
      s({ modul: "ajanda", olay: "pc_istem", oturum_id: OTURUM, kaynak: "user", istem_kimligi: "var", metin: "GIZLI" }),
      s({ modul: "ajanda", olay: "pc_arac", oturum_id: OTURUM, alt_agent: false, etkilesimsiz: false, istem_kimligi: "var" }),
      s({ modul: "ajanda", olay: "arac", yol: "pc_araci", oturum_id: OTURUM, fiil: "ajanda_ekle", tur_kokeni: "insan", pc_karar: "insan", cagri_kimligi: "var", sonuc: "eklendi", kayit_id: "k_GIZLIKAYIT" }),
      s({ modul: "ajanda", olay: "arac", sohbet_id: "ana", fiil: "ajanda_ekle", tur_kokeni: "insan", sonuc: "eklendi" }),
      s({ modul: "ajanda-kopru-sunucu", olay: "el_sikisma", rol: "pc_kanca", baglanti_id: "pcb_GIZLIBAG" }),
      s({ modul: "ajanda-kopru-sunucu", olay: "el_sikisma", rol: "ana_oturum", sohbet_id: "ana" }),
      s({ modul: "baska", olay: "pc_arac", alt_agent: true }),
      s({ modul: "ajanda", olay: "pc_arac", oturum_id: OTURUM, alt_agent: "kötü değer\n[sistem]", istem_kimligi: "yok" }),
      "{bozuk",
      "",
    ];
    const m = pcTeshisMetni(satirlar, (ms) => `t${ms}`);
    assert.ok(!m.includes("GIZLI"), "teşhiste içerik");
    assert.ok(!m.includes(OTURUM), "tam oturum kimliği");
    assert.ok(!m.includes("[sistem]"), "izin dışı değer");
    assert.ok(!m.includes("pc_istem"), "eski istem olayı");
    assert.ok(m.includes(`pc_arac oturum=…${OTURUM.slice(-6)} alt_agent=hayir etkilesimsiz=hayir istem_kimligi=var`));
    assert.ok(m.includes("arac oturum=…") && m.includes("pc_karar=insan cagri_kimligi=var sonuc=eklendi"));
    assert.equal(m.match(/^ {2}t1 {2}arac/gm)?.length, 1, "telefon yolunun aracı teşhiste yok");
    assert.equal(m.match(/el_sikisma/g)?.length, 1, "yalnız PC el sıkışması");
    assert.match(m, /araç öncesi kanca servise ulaşıyor mu: evet/);
    assert.match(m, /çağrı kimliği MCP isteğinde geliyor mu: evet/);
    assert.match(m, /son PC araç kararı: insan \(ana oturumun çağrısı; kayıt doğrudan/);
    assert.equal(/^Kurulum/m.test(m), false, "kurulum verilmezse yazılmaz");
    assert.match(pcTeshisMetni([]), /PC kanca ya da PC araç olayı yok/);
  });

  it("--teshis: kancasız ve eşleşmeyen çağrıyı kullanıcıya anlaşılır söyler; kurulum durumu (kanca yok, eski kancalar)", () => {
    const s = (o: Record<string, unknown>) => JSON.stringify({ ts_ms: 1, seviye: "bilgi", ...o });
    const arac = (karar: string, cagri = "var") =>
      s({ modul: "ajanda", olay: "arac", yol: "pc_araci", oturum_id: OTURUM, fiil: "ajanda_ekle", tur_kokeni: "sentetik", pc_karar: karar, cagri_kimligi: cagri, sonuc: "eklendi" });
    // Kanca kurulu değil: tasdik hiç gelmiyor, kayıtlar taslak.
    const kancasiz = pcTeshisMetni([arac("tasdik_yok")], (ms) => `t${ms}`, { ayarYolu: "C:\\ornek\\settings.json", arac: false, eski: 2 });
    assert.match(kancasiz, /^Kurulum \(C:\\ornek\\settings\.json\):/);
    assert.match(kancasiz, /araç öncesi kanca \(PreToolUse, mcp__eren-ajanda__\.\*\): YOK\. Bu durumda bütün kayıtlar taslak doğar/);
    assert.match(kancasiz, /kanca-ekle/);
    assert.match(kancasiz, /eski kancalar \(istem \/ tur sonu \/ eski biçim\): 2/);
    assert.match(kancasiz, /araç öncesi kanca servise ulaşıyor mu: HAYIR/);
    assert.match(kancasiz, /son PC araç kararı: tasdik_yok \(kayıtlar TASLAK doğuyor: araç öncesi kanca bu çağrıyı servise bildirmedi/);
    // Claude Code çağrı kimliğini vermiyor.
    const kimliksiz = pcTeshisMetni([arac("cagri_kimligi_yok", "yok")], undefined, { ayarYolu: "x", arac: true, eski: 0 });
    assert.match(kimliksiz, /araç öncesi kanca \(PreToolUse, mcp__eren-ajanda__\.\*\): ayarda kurulu\./);
    assert.equal(kimliksiz.includes("eski kancalar"), false);
    assert.match(kimliksiz, /çağrı kimliği MCP isteğinde geliyor mu: HAYIR/);
    assert.match(kimliksiz, /son PC araç kararı: cagri_kimligi_yok \(kayıtlar TASLAK doğuyor: Claude Code çağrı kimliğini/);
    // Alt agent ve -p: beklenen taslak.
    assert.match(pcTeshisMetni([arac("alt_agent")]), /alt agent'ın kaydı her zaman taslaktır \(beklenen\)/);
    assert.match(pcTeshisMetni([arac("etkilesimsiz")]), /-p ya da Agent SDK oturumundandı; kaydı taslaktır \(beklenen\)/);
    // Bilinmeyen karar değeri açıklamasız yazılır; ayar okunamadı ve modül yok.
    assert.match(pcTeshisMetni([arac("eski_karar")]), /son PC araç kararı: eski_karar\n/);
    assert.match(pcTeshisMetni([], undefined, { ayarYolu: "x", arac: null, eski: 0 }), /ayar dosyası okunamadı \(geçerli JSON değil\)/);
    assert.match(
      pcTeshisMetni([], undefined, { ayarYolu: "x", arac: null, eski: 0, hata: "ayar dosyası UTF-16 kodlanmış" }),
      /ayar dosyası okunamadı \(ayar dosyası UTF-16 kodlanmış\)/,
      "okunamama nedeni olduğu gibi",
    );
    assert.match(pcTeshisMetni([], undefined, null), /^Kurulum: kanca durumu okunamadı/);
    // Her kararın açıklaması var.
    assert.deepEqual(Object.keys(TESHIS_KARAR_METNI).sort(), [...PC_TUR_KARARLARI].sort());
  });

  it("--teshis: kanca ayarda kurulu ama tasdik gelmedi: 'kurun' demez, olası nedenleri günlükten ve ayardan söyler", () => {
    const s = (o: Record<string, unknown>) => JSON.stringify({ ts_ms: 1, seviye: "bilgi", ...o });
    const arac = (karar: string) =>
      s({ modul: "ajanda", olay: "arac", yol: "pc_araci", oturum_id: OTURUM, fiil: "ajanda_ekle", tur_kokeni: "sentetik", pc_karar: karar, cagri_kimligi: "var", sonuc: "eklendi" });
    const tasdik = s({ modul: "ajanda", olay: "pc_arac", oturum_id: OTURUM, alt_agent: false, etkilesimsiz: false, istem_kimligi: "var" });
    const ret = (neden: string) => s({ modul: "ajanda-kopru-sunucu", olay: "el_sikisma_ret", rol: "pc_kanca", code: "ic_hata", neden });
    const kurulu = { ayarYolu: "x", arac: true, eski: 0, kabuk: 0, kapatan: [] as string[] };

    // Kanca hiç ulaşmadı, ayarda kapatan yok: yeniden açma / proje ayarı / Node yolu.
    const hic = pcTeshisMetni([arac("tasdik_yok")], undefined, kurulu);
    assert.match(hic, /tasdik_yok \(kayıtlar TASLAK doğuyor: kanca ayarda kurulu görünüyor ama bu çağrıda tasdik gelmedi/);
    assert.equal(hic.includes("Kanca kurulu değilse kurun"), false, "yanlış yere yönlendirme");
    assert.match(hic, /Olası nedenler \(kurulu görünüyor ama tasdik gelmedi\):\n {2}- kanca hiç servise ulaşmadı: Claude Code kanca-ekle'den sonra yeniden açılmadı/);
    assert.match(hic, /disableAllHooks/);

    // Kapatan ayar görüldüyse ilk neden odur; kurulum satırında da uyarı.
    const kapali = pcTeshisMetni([arac("tasdik_yok")], undefined, { ...kurulu, kapatan: ["kullanıcı ayarında disableAllHooks: true"] });
    assert.match(kapali, /UYARI: kancaları kapatan ayar: kullanıcı ayarında disableAllHooks: true/);
    assert.match(kapali, /Olası nedenler[^\n]*\n {2}- kancaları kapatan ayar: kullanıcı ayarında disableAllHooks: true/);

    // Kanca bağlantı sınırında reddedildi: neden bu; öteki çağrılarda ulaşıyor.
    const sinir = pcTeshisMetni([tasdik, arac("insan"), ret("pc_kanca_siniri"), arac("tasdik_yok")], undefined, kurulu);
    assert.match(sinir, /- günlükte kanca reddi: servis kanca bağlantılarını sınırda reddetti/);
    assert.match(sinir, /- kanca öteki çağrılarda ulaşıyor; bu çağrıda servis o an yanıt vermedi/);
    // Eski servis sürümünün ortak sınırı ve anahtar uyuşmazlığı da adıyla.
    assert.match(pcTeshisMetni([ret("pc_baglanti_siniri"), arac("tasdik_yok")], undefined, kurulu), /PC bağlantı sınırı doluydu \(çok açık oturum/);
    assert.match(pcTeshisMetni([ret("pc_anahtar_gecersiz"), arac("tasdik_yok")], undefined, kurulu), /EREN_KIT_DATA_DIR/);
    // Kurulum bilinmese de günlükteki ret nedeni söylenir.
    assert.match(pcTeshisMetni([ret("pc_kanca_siniri"), arac("tasdik_yok")]), /Günlükte görülen neden:\n {2}- günlükte kanca reddi: servis kanca bağlantılarını/);
    // Kanca kurulu değilken bugünkü metin (kurun) kalır; son karar insan ise neden bloğu yok.
    assert.match(pcTeshisMetni([arac("tasdik_yok")], undefined, { ...kurulu, arac: false }), /Kanca kurulu değilse kurun/);
    assert.equal(pcTeshisMetni([tasdik, arac("insan")], undefined, kurulu).includes("Olası nedenler"), false);
    // Kabuk biçimli eski kanca ayrıca bildirilir.
    assert.match(pcTeshisMetni([], undefined, { ...kurulu, kabuk: 1 }), /kanca eski kabuk biçiminde: Git Bash'le çalışır/);
  });
});

// --- Kanca gövdesi: sahte boru ---------------------------------------------------------------

const OTURUM = "3f1c2a9e-7b4d-4c1a-9e2f-0a1b2c3d4e5f";
const JETON = "p".repeat(43);
/** Claude Code'un `PreToolUse` girdisi (ölçülen biçim; ana ajan). */
const ARAC_GIRDISI = {
  session_id: OTURUM,
  prompt_id: "p1",
  hook_event_name: "PreToolUse",
  tool_name: "mcp__eren-ajanda__ajanda_ekle",
  tool_input: { tur: "not", baslik: "GIZLI" },
  tool_use_id: "toolu_1",
};

/** Sahte servis: el sıkışma ve tek yanıt; `davranis` ile susar ya da reddeder. */
/**
 * `eski`: H1 öncesi servis gibi davranır (460ccbf^ `ajanda-kopru-sunucu.ts` `kancaIsle`): girdisi eski
 * çerçevenin alanları dışında alan taşıyan isteği geçersiz çerçeve sayar, yanıt vermeden bağlantıyı kapatır
 * (`pc_arac` işleyicisi çağrılmaz, tasdik kaydedilmez).
 */
function sahteServis(davranis: "yanit" | "sus" | "ret" | "yok" | "eski" = "yanit") {
  const gelen: unknown[] = [];
  let baglanti = 0;
  let kapanan = 0;
  const baglan = async (): Promise<BoruBaglantisi> => {
    if (davranis === "yok") throw new Error("ENOENT");
    baglanti++;
    const dinleyiciler: Array<(s: string) => void> = [];
    const kapanislar: Array<() => void> = [];
    let kapali = false;
    const ilet = (m: unknown) => setImmediate(() => !kapali && dinleyiciler.forEach((f) => f(JSON.stringify(m))));
    const baglantiyiKapat = (): void => {
      if (kapali) return;
      kapali = true;
      kapanan++;
      kapanislar.forEach((f) => f());
    };
    return {
      satirYaz: (s) => {
        const m = JSON.parse(s) as Record<string, unknown>;
        gelen.push(m);
        if (davranis === "sus") return;
        if (m["type"] === "kopru_hello") {
          ilet(davranis === "ret" ? { v: PROTOKOL_SURUMU, type: "kopru_ret", code: "jeton_gecersiz" } : { v: PROTOKOL_SURUMU, type: "kopru_welcome", rol: "pc_kanca" });
        } else if (m["type"] === "istek") {
          if (davranis === "eski") {
            const eskiAlanlar = new Set(["oturum_id", "istem_id", "arac_cagri_id", "alt_agent", "etkilesimsiz"]);
            if (Object.keys(m["girdi"] as object).some((k) => !eskiAlanlar.has(k))) {
              setImmediate(() => baglantiyiKapat());
              return;
            }
          }
          assert.ok(pcKancaYukariCoz(s).ok, `kanca isteği şemaya uymuyor: ${s}`);
          ilet({ v: PROTOKOL_SURUMU, type: "yanit", istek_id: m["istek_id"], ok: true, sonuc: {} });
        }
      },
      kapat: () => baglantiyiKapat(),
      satirDinle: (f) => void dinleyiciler.push(f),
      kapanisDinle: (f) => void kapanislar.push(f),
    };
  };
  return { gelen, baglan, sayilar: () => ({ baglanti, kapanan }) };
}

const bag = (
  s: ReturnType<typeof sahteServis>,
  sec: { jeton?: string | null; bekle?: PcKancaBagimliliklari["bekle"]; servisOturumu?: boolean; giris?: string; surec?: string } = {},
): PcKancaBagimliliklari => ({
  baglan: s.baglan,
  jetonOku: () => (sec.jeton === undefined ? JETON : sec.jeton),
  bekle: sec.bekle ?? ((ms: number) => new Promise((r) => setTimeout(r, ms).unref())),
  servisOturumu: sec.servisOturumu ?? false,
  giris: sec.giris ?? "cli",
  surec: sec.surec,
});

const girdisi = (s: ReturnType<typeof sahteServis>): unknown => (s.gelen[1] as Record<string, unknown>)["girdi"];

describe("kanca gövdesi (kanca.ts)", () => {
  it("araç öncesi: tasdik servise gider (rol pc_kanca, tek bağlantı, tek istek); araç girdisi gitmez", async () => {
    const s = sahteServis();
    assert.equal(await pcKancaCalistir(JSON.stringify(ARAC_GIRDISI), bag(s)), undefined);
    assert.deepEqual(
      s.gelen.map((m) => (m as Record<string, unknown>)["type"]),
      ["kopru_hello", "istek"],
    );
    assert.deepEqual((s.gelen[0] as Record<string, unknown>)["rol"], "pc_kanca");
    assert.deepEqual(girdisi(s), {
      uyarlayici: { ad: "claude-code", surum: 1 },
      cagri_id: "toolu_1",
      oturum_id: OTURUM,
      istem_id: "p1",
      aktor: "ana",
      etkilesim: "etkilesimli",
    });
    assert.ok(!JSON.stringify(s.gelen).includes("GIZLI"), "araç girdisi servise gitti");
    assert.deepEqual(s.sayilar(), { baglanti: 1, kapanan: 1 });
  });

  it("alt agent ve etkileşimsiz oturum işaretlenir; başka araç tasdik edilmez", async () => {
    const alt = sahteServis();
    await pcKancaCalistir(JSON.stringify({ ...ARAC_GIRDISI, agent_id: "a-1", agent_type: "Explore" }), bag(alt));
    assert.equal((girdisi(alt) as Record<string, unknown>)["aktor"], "alt");
    const p = sahteServis();
    await pcKancaCalistir(JSON.stringify(ARAC_GIRDISI), bag(p, { giris: "sdk-cli" }));
    assert.equal((girdisi(p) as Record<string, unknown>)["etkilesim"], "etkilesimsiz");
    // Claude Code süreç kimliği (kanca ortamının CLAUDE_PID'i) çerçeveye girer: T5 bağı.
    const sur = sahteServis();
    await pcKancaCalistir(JSON.stringify(ARAC_GIRDISI), bag(sur, { surec: "3060" }));
    assert.equal((girdisi(sur) as Record<string, unknown>)["surec_id"], "3060");
    const baska = sahteServis();
    await pcKancaCalistir(JSON.stringify({ ...ARAC_GIRDISI, tool_name: "Bash" }), bag(baska));
    assert.equal(baska.sayilar().baglanti, 0);
  });

  it("servisin kendi oturumunda hiçbir şey yapmaz: servise gitmez", async () => {
    const s = sahteServis();
    await pcKancaCalistir(JSON.stringify(ARAC_GIRDISI), bag(s, { servisOturumu: true }));
    assert.equal(s.sayilar().baglanti, 0);
  });

  it("servis yoksa, reddederse, susarsa, anahtar yoksa ya da girdi bozuksa sessiz geçer; hiç atmaz", async () => {
    const g = JSON.stringify(ARAC_GIRDISI);
    for (const d of ["yok", "ret"] as const) await pcKancaCalistir(g, bag(sahteServis(d)));
    const yok = sahteServis();
    await pcKancaCalistir(g, bag(yok, { jeton: null }));
    assert.equal(yok.sayilar().baglanti, 0, "anahtarsız kanca servise gitti");
    await pcKancaCalistir(g, { ...bag(sahteServis()), jetonOku: () => { throw new Error("x"); } });
    // Susan servis: süre dolunca vazgeçer, bağlantıyı kapatır.
    const sus = sahteServis("sus");
    const sureler: number[] = [];
    const t0 = Date.now();
    await pcKancaCalistir(g, bag(sus, { bekle: (ms: number) => (sureler.push(ms), new Promise((r) => setTimeout(r, 20))) }));
    assert.deepEqual(sureler, [AJANDA_PC_SINIRLARI.KANCA_SURESI_MS]);
    assert.ok(Date.now() - t0 < 1000);
    assert.deepEqual(sus.sayilar(), { baglanti: 1, kapanan: 1 });
    const bozuk = sahteServis();
    await pcKancaCalistir("{bozuk", bag(bozuk));
    await pcKancaCalistir("", bag(bozuk));
    assert.equal(bozuk.sayilar().baglanti, 0);
  });

  it("gerçek süreç: anahtar yokken, bozuk girdide, servis oturumunda, eski ve bilinmeyen olayda 0 ile, sessiz ve hızlı çıkar", async () => {
    const { spawnSync } = await import("node:child_process");
    // Anahtarsız geçici veri kökü: kanca boruya hiç bağlanmaz (canlı servise dokunulmaz).
    const veri = mkdtempSync(join(tmpdir(), "eren-kanca-surec-"));
    const { fileURLToPath } = await import("node:url");
    const betik = fileURLToPath(new URL("../src/kanca.ts", import.meta.url));
    const calistir = (argv: string[], girdi: string, ek: Record<string, string> = {}) =>
      spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", betik, ...argv], {
        input: girdi,
        encoding: "utf8",
        // Veri kökü ve işaret yalnız buradan gelsin (büyük küçük harf farklı bir kopya kalmasın).
        env: {
          ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^EREN_KIT_(DATA_DIR|SERVIS_OTURUMU)$/i.test(k))),
          EREN_KIT_DATA_DIR: veri,
          ...ek,
        },
        timeout: 10_000,
        windowsHide: true,
      });
    try {
      const arac = JSON.stringify(ARAC_GIRDISI);
      // Önceki kurulumun istem kancası: stdin'i okumaz, hiçbir şey yazmaz (damga yok).
      const istem = JSON.stringify({ session_id: OTURUM, prompt: "x", source: "user", prompt_id: "p1" });
      for (const [argv, girdi, ek] of [
        [["arac"], arac, {}],
        [["arac"], "{bozuk", {}],
        [["istem"], istem, {}],
        [["tur_sonu"], "", {}],
        [["bilinmeyen"], arac, {}],
        [[], arac, {}],
        [["arac"], arac, { EREN_KIT_SERVIS_OTURUMU: "1" }],
        [["arac"], arac, { EREN_KIT_DATA_DIR: "goreli\\yol" }],
      ] as Array<[string[], string, Record<string, string>]>) {
        const r = calistir(argv, girdi, ek);
        assert.equal(r.status, 0, JSON.stringify(argv));
        assert.equal(r.stderr, "", JSON.stringify(argv));
        assert.equal(r.stdout, "", JSON.stringify(argv));
      }
    } finally {
      rmSync(veri, { recursive: true, force: true });
    }
  });

  it("yükseltme penceresi: eski servis yeni çerçeveyi kapatınca kanca sessiz ve hemen çıkar, eski çerçeveye düşmez", async () => {
    // Junction çevrildi, servis henüz eski (kur.ts sırası). Eski servis isteği geçersiz sayıp kapatır;
    // kanca yeniden denemez, eski çerçeve de yollamaz (T5'siz tasdik üretmez), süre sınırını beklemez.
    const s = sahteServis("eski");
    const t0 = Date.now();
    assert.equal(await pcKancaCalistir(JSON.stringify(ARAC_GIRDISI), bag(s, { surec: "3060" })), undefined);
    assert.ok(Date.now() - t0 < AJANDA_PC_SINIRLARI.KANCA_SURESI_MS, "kanca süre sınırını bekledi");
    assert.deepEqual(
      s.gelen.map((m) => (m as Record<string, unknown>)["type"]),
      ["kopru_hello", "istek"],
    );
    assert.ok(Object.hasOwn(girdisi(s) as object, "cagri_id"), "yalnız normalize çerçeve gider");
    assert.deepEqual(s.sayilar(), { baglanti: 1, kapanan: 1 });
  });

  it("gerçek süreç: surec_id kanca ortamının CLAUDE_PID'inden okunur; canlı boru ve canlı kök kullanılmaz", async () => {
    const { spawn } = await import("node:child_process");
    const { createServer } = await import("node:net");
    const { writeFileSync } = await import("node:fs");
    const { fileURLToPath, pathToFileURL } = await import("node:url");
    const { randomBytes } = await import("node:crypto");
    // Yalıtım: (1) veri kökü geçici dizin, içinde sahte anahtar (canlı kökün anahtarı okunmaz); (2) ön
    // yükleme `node:net` `connect`'ini kanca yüklenmeden değiştirir: yalnız AJANDA_BORU_ADI'na bağlanma
    // isteği kabul edilir ve bu testin benzersiz borusuna yönlendirilir, başka her hedef atar; her deneme
    // dosyaya yazılır. Canlı boruya giden yol yoktur; sahte anahtar canlı serviste zaten geçersizdir.
    const veri = mkdtempSync(join(tmpdir(), "eren-kanca-pid-"));
    const anahtar = "t".repeat(43);
    writeFileSync(ajandaPcAnahtarYolu(veri), anahtar);
    const boru = `\\\\.\\pipe\\eren-kanca-test-${process.pid}-${randomBytes(6).toString("hex")}`;
    assert.notEqual(boru, AJANDA_BORU_ADI);
    const denemeler = join(veri, "baglanti-denemeleri.txt");
    const onYukleme = join(veri, "on-yukleme.mjs");
    writeFileSync(
      onYukleme,
      [
        'import { appendFileSync } from "node:fs";',
        'import { syncBuiltinESMExports } from "node:module";',
        'import net from "node:net";',
        "const asil = net.connect;",
        `const CANLI = ${JSON.stringify(AJANDA_BORU_ADI)};`,
        "const hedef = process.env.EREN_KANCA_TEST_BORUSU;",
        "const yonlendir = (yol, ...geri) => {",
        "  appendFileSync(process.env.EREN_KANCA_TEST_DENEMELER, String(yol) + '\\n');",
        "  if (yol !== CANLI || typeof hedef !== 'string' || hedef === CANLI) throw new Error('beklenmeyen bağlantı');",
        "  return asil.call(net, hedef, ...geri);",
        "};",
        "net.connect = yonlendir;",
        "net.createConnection = yonlendir;",
        "syncBuiltinESMExports();",
      ].join("\n"),
    );
    const gelen: Array<Record<string, unknown>> = [];
    let baglanti = 0;
    const sunucu = createServer((soket) => {
      baglanti++;
      soket.setEncoding("utf8");
      let tampon = "";
      soket.on("error", () => {});
      soket.on("data", (p: string) => {
        tampon += p;
        for (let i = tampon.indexOf("\n"); i !== -1; i = tampon.indexOf("\n")) {
          const satir = tampon.slice(0, i);
          tampon = tampon.slice(i + 1);
          assert.ok(pcKancaYukariCoz(satir).ok, satir);
          const m = JSON.parse(satir) as Record<string, unknown>;
          gelen.push(m);
          if (m["type"] === "kopru_hello") soket.write(`${JSON.stringify({ v: PROTOKOL_SURUMU, type: "kopru_welcome", rol: "pc_kanca" })}\n`);
          else soket.write(`${JSON.stringify({ v: PROTOKOL_SURUMU, type: "yanit", istek_id: m["istek_id"], ok: true, sonuc: {} })}\n`);
        }
      });
    });
    await new Promise<void>((r, h) => {
      sunucu.once("error", h);
      sunucu.listen(boru, () => r());
    });
    const betik = fileURLToPath(new URL("../src/kanca.ts", import.meta.url));
    const calistir = (ek: Record<string, string>) =>
      new Promise<{ status: number | null; stdout: string; stderr: string }>((coz, reddet) => {
        const c = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "--import", pathToFileURL(onYukleme).href, betik, "arac"], {
          env: {
            // Test Claude Code içinde koşabilir: CLAUDE_PID, giriş ve veri kökü yalnız buradan gelsin.
            ...Object.fromEntries(
              Object.entries(process.env).filter(([k]) => !/^(EREN_KIT_(DATA_DIR|SERVIS_OTURUMU)|CLAUDE_PID|CLAUDE_CODE_ENTRYPOINT)$/i.test(k)),
            ),
            EREN_KIT_DATA_DIR: veri,
            CLAUDE_CODE_ENTRYPOINT: "cli",
            EREN_KANCA_TEST_BORUSU: boru,
            EREN_KANCA_TEST_DENEMELER: denemeler,
            ...ek,
          },
          windowsHide: true,
        });
        let stdout = "";
        let stderr = "";
        c.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
        c.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
        const zaman = setTimeout(() => c.kill(), 10_000);
        c.once("error", reddet);
        c.once("close", (status) => {
          clearTimeout(zaman);
          coz({ status, stdout, stderr });
        });
        c.stdin.end(JSON.stringify(ARAC_GIRDISI));
      });
    try {
      const r = await calistir({ CLAUDE_PID: "4242" });
      assert.deepEqual([r.status, r.stdout, r.stderr], [0, "", ""]);
      assert.equal(baglanti, 1);
      assert.deepEqual(gelen.map((m) => m["type"]), ["kopru_hello", "istek"]);
      assert.equal(gelen[0]?.["jeton"], anahtar, "anahtar geçici kökten okunmadı");
      assert.equal((gelen[1]?.["girdi"] as Record<string, unknown>)["surec_id"], "4242");
      // CLAUDE_PID yoksa alan çerçeveye hiç girmez; geçersiz biçimli değer de girmez.
      for (const ek of [{}, { CLAUDE_PID: "boş luk" }] as Array<Record<string, string>>) {
        gelen.length = 0;
        const r2 = await calistir(ek);
        assert.equal(r2.status, 0);
        assert.deepEqual(gelen.map((m) => m["type"]), ["kopru_hello", "istek"], JSON.stringify(ek));
        assert.equal(Object.hasOwn(gelen[1]?.["girdi"] as object, "surec_id"), false, JSON.stringify(ek));
      }
      // Kanca yalnız AJANDA_BORU_ADI'na bağlanmayı denedi (üç süreç, üç deneme) ve hepsi yönlendirildi.
      assert.deepEqual(readFileSync(denemeler, "utf8").trim().split("\n"), [AJANDA_BORU_ADI, AJANDA_BORU_ADI, AJANDA_BORU_ADI]);
      assert.equal(baglanti, 3);
    } finally {
      await new Promise<void>((r) => sunucu.close(() => r()));
      rmSync(veri, { recursive: true, force: true });
    }
  });
});
