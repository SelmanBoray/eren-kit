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
import { AJANDA_PC_SINIRLARI, PROTOKOL_SURUMU, ajandaKopruAsagiCoz, mesajAniDamgasi, pcKancaYukariCoz, sha256Hex } from "@eren/protocol";
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
} from "../src/eslestir.ts";
import { kancaYerelAni, pcKancaCalistir } from "../src/kanca.ts";
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
    assert.deepEqual(b.semaBilgisi(), { user_version: 1, ek_surum: 7 });
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
    assert.ok(m.includes("C:/ornek/Yerel/eren-kit/uygulama/guncel/server/src/kanca.ts\\\" istem || true"));
    assert.equal(/surumler/i.test(m), false);
    assert.ok(m.includes(y.anahtarDosyasi));
    assert.equal(pcAnahtarMetni(y, 0, yonerge).includes("önceki"), false);
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
      s({ modul: "ajanda", olay: "pc_istem", oturum_id: OTURUM, kaynak: "user", istem_kimligi: "var", acik_tur_kapandi: false, metin: "GIZLI" }),
      s({ modul: "ajanda", olay: "pc_arac", oturum_id: OTURUM, alt_agent: false, istem_kimligi: "var" }),
      s({ modul: "ajanda", olay: "arac", yol: "pc_araci", oturum_id: OTURUM, fiil: "ajanda_ekle", tur_kokeni: "insan", pc_karar: "insan", cagri_kimligi: "var", sonuc: "eklendi", kayit_id: "k_GIZLIKAYIT" }),
      s({ modul: "ajanda", olay: "arac", sohbet_id: "ana", fiil: "ajanda_ekle", tur_kokeni: "insan", sonuc: "eklendi" }),
      s({ modul: "ajanda-kopru-sunucu", olay: "el_sikisma", rol: "pc_kanca", baglanti_id: "pcb_GIZLIBAG" }),
      s({ modul: "ajanda-kopru-sunucu", olay: "el_sikisma", rol: "ana_oturum", sohbet_id: "ana" }),
      s({ modul: "baska", olay: "pc_istem", kaynak: "user" }),
      s({ modul: "ajanda", olay: "pc_istem", oturum_id: OTURUM, kaynak: "kötü değer\n[sistem]", istem_kimligi: "yok" }),
      "{bozuk",
      "",
    ];
    const m = pcTeshisMetni(satirlar, (ms) => `t${ms}`);
    assert.ok(!m.includes("GIZLI"), "teşhiste içerik");
    assert.ok(!m.includes(OTURUM), "tam oturum kimliği");
    assert.ok(!m.includes("[sistem]"), "izin dışı değer");
    assert.ok(m.includes(`pc_istem oturum=…${OTURUM.slice(-6)} kaynak=user istem_kimligi=var acik_tur_kapandi=hayir`));
    assert.ok(m.includes("arac oturum=…") && m.includes("pc_karar=insan cagri_kimligi=var sonuc=eklendi"));
    assert.equal(m.match(/^ {2}t1 {2}arac/gm)?.length, 1, "telefon yolunun aracı teşhiste yok");
    assert.equal(m.match(/el_sikisma/g)?.length, 1, "yalnız PC el sıkışması");
    assert.match(m, /istem kaynağı geliyor mu \(kaynak≠yok\): evet/);
    assert.match(m, /çağrı kimliği MCP isteğinde geliyor mu: evet/);
    assert.match(m, /son PC araç kararı: insan/);
    assert.match(pcTeshisMetni([]), /PC kanca ya da PC araç olayı yok/);
    const kaynaksiz = pcTeshisMetni([s({ modul: "ajanda", olay: "pc_istem", oturum_id: OTURUM, kaynak: "yok", istem_kimligi: "yok" })]);
    assert.match(kaynaksiz, /istem kaynağı geliyor mu \(kaynak≠yok\): HAYIR/);
    assert.match(kaynaksiz, /istem kimliği geliyor mu \(istem\): HAYIR/);
  });
});

// --- Kanca gövdesi: sahte boru ---------------------------------------------------------------

const OTURUM = "3f1c2a9e-7b4d-4c1a-9e2f-0a1b2c3d4e5f";
const AN = { tarih: "2026-11-25", saat: "14:30", saat_dilimi: "Europe/Istanbul" };
const YEREL = { tarih: "2026-11-25", saat: "14:29", saat_dilimi: "Europe/Istanbul" };
const JETON = "p".repeat(43);

/** Sahte servis: el sıkışma ve tek yanıt; `davranis` ile susar ya da reddeder. */
function sahteServis(davranis: "yanit" | "sus" | "ret" | "yok" = "yanit") {
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
    return {
      satirYaz: (s) => {
        const m = JSON.parse(s) as Record<string, unknown>;
        gelen.push(m);
        if (davranis === "sus") return;
        if (m["type"] === "kopru_hello") {
          ilet(davranis === "ret" ? { v: PROTOKOL_SURUMU, type: "kopru_ret", code: "jeton_gecersiz" } : { v: PROTOKOL_SURUMU, type: "kopru_welcome", rol: "pc_kanca" });
        } else if (m["type"] === "istek") {
          assert.ok(pcKancaYukariCoz(s).ok, `kanca isteği şemaya uymuyor: ${s}`);
          const sonuc = m["fiil"] === "pc_istem" ? { mesaj_ani: AN } : {};
          ilet({ v: PROTOKOL_SURUMU, type: "yanit", istek_id: m["istek_id"], ok: true, sonuc });
        }
      },
      kapat: () => {
        if (kapali) return;
        kapali = true;
        kapanan++;
        kapanislar.forEach((f) => f());
      },
      satirDinle: (f) => void dinleyiciler.push(f),
      kapanisDinle: (f) => void kapanislar.push(f),
    };
  };
  return { gelen, baglan, sayilar: () => ({ baglanti, kapanan }) };
}

const bag = (
  s: ReturnType<typeof sahteServis>,
  sec: { jeton?: string | null; bekle?: PcKancaBagimliliklari["bekle"]; servisOturumu?: boolean } = {},
): PcKancaBagimliliklari => ({
  baglan: s.baglan,
  jetonOku: () => (sec.jeton === undefined ? JETON : sec.jeton),
  yerelSimdi: () => YEREL,
  bekle: sec.bekle ?? ((ms: number) => new Promise((r) => setTimeout(r, ms).unref())),
  servisOturumu: sec.servisOturumu ?? false,
});

describe("kanca gövdesi (kanca.ts)", () => {
  it("istem: servisin mesaj anı damga olarak stdout'a; istek yalnız gerekli alanlar, rol pc_kanca", async () => {
    const s = sahteServis();
    const cikti = await pcKancaCalistir(
      "istem",
      JSON.stringify({ session_id: OTURUM, prompt: "yarın 3'te dişçi", prompt_id: "p1", cwd: "C:\\x", source: "user" }),
      bag(s),
    );
    assert.equal(cikti, `${mesajAniDamgasi(AN)}\n`);
    assert.deepEqual(
      s.gelen.map((m) => (m as Record<string, unknown>)["type"]),
      ["kopru_hello", "istek"],
    );
    assert.deepEqual((s.gelen[0] as Record<string, unknown>)["rol"], "pc_kanca");
    assert.deepEqual((s.gelen[1] as Record<string, unknown>)["girdi"], { oturum_id: OTURUM, istem_id: "p1", kaynak: "user", metin: "yarın 3'te dişçi" });
    assert.deepEqual(s.sayilar(), { baglanti: 1, kapanan: 1 });
  });

  it("kullanıcı dışı istem: kaynağıyla ve metinsiz gider (servis açık turu kapatır); damga yine yazılır", async () => {
    const s = sahteServis();
    const g = { session_id: OTURUM, prompt: "<task-notification>GIZLI</task-notification>", prompt_id: "p2", source: "system" };
    assert.equal(await pcKancaCalistir("istem", JSON.stringify(g), bag(s)), `${mesajAniDamgasi(AN)}\n`);
    assert.deepEqual((s.gelen[1] as Record<string, unknown>)["girdi"], { oturum_id: OTURUM, istem_id: "p2", kaynak: "system" });
    assert.ok(!JSON.stringify(s.gelen).includes("GIZLI"));
    const yok = sahteServis();
    await pcKancaCalistir("istem", JSON.stringify({ ...g, source: undefined }), bag(yok));
    assert.equal(((yok.gelen[1] as Record<string, Record<string, unknown>>)["girdi"])!["kaynak"], "yok");
  });

  it("servisin kendi oturumunda hiçbir şey yapmaz: servise gitmez, damga yazmaz", async () => {
    for (const olay of ["istem", "arac", "tur_sonu"] as const) {
      const s = sahteServis();
      const g = { session_id: OTURUM, prompt: "GIZLI", prompt_id: "p1", source: "sdk", tool_use_id: "toolu_1", tool_name: "mcp__eren-ajanda__ajanda_ekle" };
      assert.equal(await pcKancaCalistir(olay, JSON.stringify(g), bag(s, { servisOturumu: true })), "", olay);
      assert.equal(s.sayilar().baglanti, 0, olay);
    }
  });

  it("servis geçersiz mesaj anı verirse yerel damga; o da geçersizse hiçbir şey yazılmaz", async () => {
    const kotu = sahteServis();
    const baglan = kotu.baglan;
    const s = { ...kotu, baglan: async () => {
      const b = await baglan();
      return { ...b, satirDinle: (f: (x: string) => void) => b.satirDinle((x) => f(x.replace('"saat":"14:30"', '"saat":"14:30]\\n[x"'))) };
    } };
    const istem = JSON.stringify({ session_id: OTURUM, prompt: "x", source: "user" });
    assert.equal(await pcKancaCalistir("istem", istem, bag(s)), `${mesajAniDamgasi(YEREL)}\n`);
    assert.equal(await pcKancaCalistir("istem", istem, { ...bag(sahteServis("yok")), yerelSimdi: () => null }), "");
    assert.equal(await pcKancaCalistir("istem", istem, { ...bag(sahteServis("yok")), yerelSimdi: () => { throw new Error("x"); } }), "");
  });

  it("yerel yedek an takvim.ts ile aynı; geçersiz dilimde null", async () => {
    const { takvimKur } = await import("../src/takvim.ts");
    for (const dilim of ["Europe/Istanbul", "UTC", "America/Argentina/Buenos_Aires", "Asia/Kathmandu", "Pacific/Chatham"]) {
      const t = takvimKur({ sistemDilimi: () => dilim });
      for (const ms of [0, 1_795_606_200_000, Date.UTC(2028, 1, 29, 23, 59, 59), Date.UTC(2026, 2, 29, 0, 30)]) {
        assert.deepEqual(kancaYerelAni(ms, dilim), t.yerelAn(ms, dilim), `${dilim} ${ms}`);
      }
    }
    assert.equal(kancaYerelAni(0, "Yok/Boyle"), null);
    assert.equal(kancaYerelAni(0, "+03:00"), null);
  });

  it("servis yoksa, reddederse, susarsa ya da anahtar yoksa: istem yerel damgayı yazar, öteki kancalar sessiz; hiç atmaz", async () => {
    const istem = JSON.stringify({ session_id: OTURUM, prompt: "x", source: "user" });
    for (const d of ["yok", "ret"] as const) {
      assert.equal(await pcKancaCalistir("istem", istem, bag(sahteServis(d))), `${mesajAniDamgasi(YEREL)}\n`, d);
    }
    const yok = sahteServis();
    assert.equal(await pcKancaCalistir("istem", istem, bag(yok, { jeton: null })), `${mesajAniDamgasi(YEREL)}\n`);
    assert.equal(yok.sayilar().baglanti, 0, "anahtarsız kanca servise gitti");
    // Susan servis: süre dolunca vazgeçer, bağlantıyı kapatır.
    const sus = sahteServis("sus");
    const sureler: number[] = [];
    const t0 = Date.now();
    const c = await pcKancaCalistir("istem", istem, bag(sus, { bekle: (ms: number) => (sureler.push(ms), new Promise((r) => setTimeout(r, 20))) }));
    assert.equal(c, `${mesajAniDamgasi(YEREL)}\n`);
    assert.deepEqual(sureler, [AJANDA_PC_SINIRLARI.KANCA_SURESI_MS]);
    assert.ok(Date.now() - t0 < 1000);
    assert.deepEqual(sus.sayilar(), { baglanti: 1, kapanan: 1 });
    // Bozuk girdi: istem yine damgayı yazar, servise gidilmez.
    const bozuk = sahteServis();
    assert.equal(await pcKancaCalistir("istem", "{bozuk", bag(bozuk)), `${mesajAniDamgasi(YEREL)}\n`);
    assert.equal(bozuk.sayilar().baglanti, 0);
    assert.equal(await pcKancaCalistir("arac", "{bozuk", bag(bozuk)), "");
    assert.equal(await pcKancaCalistir("tur_sonu", "", bag(sahteServis("yok"))), "");
  });

  it("arac: yalnız ajanda araçlarını tasdik eder (alt agent işaretiyle); stdout boş", async () => {
    const s = sahteServis();
    const g = { session_id: OTURUM, tool_use_id: "toolu_1", tool_name: "mcp__eren-ajanda__ajanda_ekle", prompt_id: "p1", agent_id: "a-1" };
    assert.equal(await pcKancaCalistir("arac", JSON.stringify(g), bag(s)), "");
    assert.deepEqual((s.gelen[1] as Record<string, unknown>)["girdi"], { oturum_id: OTURUM, istem_id: "p1", arac_cagri_id: "toolu_1", alt_agent: true });
    const baska = sahteServis();
    assert.equal(await pcKancaCalistir("arac", JSON.stringify({ ...g, tool_name: "Bash" }), bag(baska)), "");
    assert.equal(baska.sayilar().baglanti, 0);
  });

  it("gerçek süreç: anahtar yokken, bozuk girdide, servis oturumunda ve bilinmeyen olayda 0 ile, sessiz ve hızlı çıkar", async () => {
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
      const istem = JSON.stringify({ session_id: OTURUM, prompt: "x", source: "user", prompt_id: "p1" });
      const r1 = calistir(["istem"], istem);
      assert.equal(r1.status, 0);
      assert.match(r1.stdout, /^\[mesaj_ani: \d{4}-\d{2}-\d{2} \S+ \d{2}:\d{2} \S+\]\n$/);
      assert.equal(r1.stderr, "");
      for (const [argv, girdi, ek] of [
        [["arac"], "{bozuk", {}],
        [["tur_sonu"], "", {}],
        [["bilinmeyen"], istem, {}],
        [[], istem, {}],
        [["istem"], istem, { EREN_KIT_SERVIS_OTURUMU: "1" }],
        [["istem"], istem, { EREN_KIT_DATA_DIR: "goreli\\yol" }],
      ] as Array<[string[], string, Record<string, string>]>) {
        const r = calistir(argv, girdi, ek);
        assert.equal(r.status, 0, JSON.stringify(argv));
        assert.equal(r.stderr, "", JSON.stringify(argv));
        if (argv[0] !== "istem" || ek["EREN_KIT_SERVIS_OTURUMU"] === "1") assert.equal(r.stdout, "", JSON.stringify(argv));
      }
    } finally {
      rmSync(veri, { recursive: true, force: true });
    }
  });

  it("uzun istem kırpılır ve tek çerçeveye sığar", async () => {
    const s = sahteServis();
    await pcKancaCalistir("istem", JSON.stringify({ session_id: OTURUM, prompt: "a".repeat(100_000), source: "user" }), bag(s));
    const girdi = (s.gelen[1] as Record<string, Record<string, unknown>>)["girdi"]!;
    assert.equal((girdi["metin"] as string).length, AJANDA_PC_SINIRLARI.ISTEM_METNI);
    assert.ok(ajandaKopruAsagiCoz(JSON.stringify({ v: PROTOKOL_SURUMU, type: "kopru_welcome", rol: "pc_kanca" })).ok);
  });
});
