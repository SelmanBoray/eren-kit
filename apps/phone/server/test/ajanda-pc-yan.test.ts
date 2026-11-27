/**
 * PC oturumlarının yan parçaları (`docs/AJANDA.md` "PC oturumları"): depo (ek göç 7, PC anahtarları),
 * `eslestir --claude-code` saf parçaları ve kanca sürecinin gövdesi (`pcKancaCalistir`) sahte boruyla.
 * Uçtan uca yol `birlesim-ajanda-pc.test.ts`'te.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
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
  kancaKomutu,
  KULLANIM,
  mcpEkleArgumanlari,
  pcAnahtarMetni,
  pcAnahtariUret,
  pcKaldirMetni,
  pcListeMetni,
} from "../src/eslestir.ts";
import { PC_KANCA_SURESI_MS, pcKancaCalistir } from "../src/kopru.ts";
import type { PcKancaBagimliliklari } from "../src/kopru.ts";
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

  it("çıktılar: kayıt komutları güncel köprüyü ve dosyayı gösterir, anahtarı göstermez", () => {
    const y = { nodeExe: "C:\\ornek\\node.exe", kopruBetigi: "C:\\ornek\\Yerel\\eren-kit\\uygulama\\guncel\\server\\src\\kopru.ts", anahtarDosyasi: ajandaPcAnahtarYolu("C:\\ornek\\Yerel\\eren-kit") };
    assert.equal(y.anahtarDosyasi, "C:\\ornek\\Yerel\\eren-kit\\ajanda-pc.anahtar");
    assert.deepEqual(mcpEkleArgumanlari(y), ["mcp", "add", "eren-ajanda", "-s", "user", "--", y.nodeExe, "--disable-warning=ExperimentalWarning", y.kopruBetigi, "--rol", "pc_oturumu"]);
    assert.equal(CLAUDE_CODE_MCP_ADI, "eren-ajanda");
    assert.equal(
      kancaKomutu(y, "istem"),
      `"C:/ornek/node.exe" --disable-warning=ExperimentalWarning "C:/ornek/Yerel/eren-kit/uygulama/guncel/server/src/kopru.ts" --kanca istem || true`,
    );
    const m = pcAnahtarMetni(y, 1);
    assert.match(m, /önceki anahtar artık geçersiz/);
    assert.ok(m.includes(`claude mcp add eren-ajanda -s user -- ${y.nodeExe} --disable-warning=ExperimentalWarning ${y.kopruBetigi} --rol pc_oturumu`));
    assert.match(m, /PreToolUse \(matcher "mcp__eren-ajanda__\.\*"\)/);
    assert.ok(m.includes(y.anahtarDosyasi));
    assert.equal(pcAnahtarMetni(y, 0).includes("önceki"), false);
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

const bag = (s: ReturnType<typeof sahteServis>, sec: { jeton?: string | null; bekle?: PcKancaBagimliliklari["bekle"] } = {}): PcKancaBagimliliklari => ({
  baglan: s.baglan,
  jetonOku: () => (sec.jeton === undefined ? JETON : sec.jeton),
  rastgele: sahteRastgele(9),
  yerelSimdi: () => YEREL,
  bekle: sec.bekle ?? ((ms) => new Promise((r) => setTimeout(r, ms).unref())),
  gunluk: sahteGunluk(),
});

describe("kanca gövdesi (kopru --kanca)", () => {
  it("istem: servisin mesaj anı damga olarak stdout'a; istek yalnız gerekli alanlar, rol pc_kanca", async () => {
    const s = sahteServis();
    const cikti = await pcKancaCalistir("istem", JSON.stringify({ session_id: OTURUM, prompt: "yarın 3'te dişçi", prompt_id: "p1", cwd: "C:\\x" }), bag(s));
    assert.equal(cikti, `${mesajAniDamgasi(AN)}\n`);
    assert.deepEqual(
      s.gelen.map((m) => (m as Record<string, unknown>)["type"]),
      ["kopru_hello", "istek"],
    );
    assert.deepEqual((s.gelen[0] as Record<string, unknown>)["rol"], "pc_kanca");
    assert.deepEqual((s.gelen[1] as Record<string, unknown>)["girdi"], { oturum_id: OTURUM, istem_id: "p1", metin: "yarın 3'te dişçi" });
    assert.deepEqual(s.sayilar(), { baglanti: 1, kapanan: 1 });
  });

  it("servis yoksa, reddederse, susarsa ya da anahtar yoksa: istem yerel damgayı yazar, öteki kancalar sessiz; hiç atmaz", async () => {
    const istem = JSON.stringify({ session_id: OTURUM, prompt: "x" });
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
    const c = await pcKancaCalistir("istem", istem, bag(sus, { bekle: (ms) => (sureler.push(ms), new Promise((r) => setTimeout(r, 20))) }));
    assert.equal(c, `${mesajAniDamgasi(YEREL)}\n`);
    assert.deepEqual(sureler, [PC_KANCA_SURESI_MS]);
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

  it("uzun istem kırpılır ve tek çerçeveye sığar", async () => {
    const s = sahteServis();
    await pcKancaCalistir("istem", JSON.stringify({ session_id: OTURUM, prompt: "a".repeat(100_000) }), bag(s));
    const girdi = (s.gelen[1] as Record<string, Record<string, unknown>>)["girdi"]!;
    assert.equal((girdi["metin"] as string).length, AJANDA_PC_SINIRLARI.ISTEM_METNI);
    assert.ok(ajandaKopruAsagiCoz(JSON.stringify({ v: PROTOKOL_SURUMU, type: "kopru_welcome", rol: "pc_kanca" })).ok);
  });
});
