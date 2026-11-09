/**
 * Kişilik adı ve veri kökü nötrleştirmesi: görünen asistan adı yalnız `Ayar.asistanAdi`'den
 * (`EREN_KIT_ASSISTANT_NAME`, varsayılan "Claude") gelir; veri kökü kuralı tek yerdedir
 * (`veri-koku.ts`) ve servis, bekçi günlüğü ve e2e aynı kökü kullanır.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ANA_SOHBET_ADI, SohbetAdi } from "@eren/protocol";
import { anaSohbetAdiUret } from "../src/ana-sohbet-adi.ts";
import { asistanAdiUret, yollariUret } from "../src/ayar.ts";
import { devirMetni, initReddiMetni, sistemIstemi, yenidenBasladiMetni } from "../src/konusma-metin.ts";
import type { Ortam } from "../src/sozlesme.ts";
import { ortamDegeri, VARSAYILAN_VERI_KLASORU, veriKokuCoz, VERI_KOKU_ORTAMI } from "../src/veri-koku.ts";

const UP = "C:\\ornek\\kullanici";

describe("asistan adı: servis metinleri", () => {
  it("sistem istemi adı ek almadan, ilk cümlede taşır; ad dışında metin aynıdır", () => {
    const a = sistemIstemi("", false, false, "Claude");
    const b = sistemIstemi("", false, false, "Örnek Asistan");
    assert.ok(a.startsWith("Adın Claude: "));
    assert.ok(b.startsWith("Adın Örnek Asistan: "));
    assert.equal(b.replace("Örnek Asistan", "Claude"), a);
    assert.ok(sistemIstemi("EK", true, true, "Nova").endsWith("\n\nEK"));
  });

  it("init reddi ve yeniden başlatma notu adı ayardan alır", () => {
    assert.equal(
      initReddiMetni("Nova"),
      "Nova durduruldu: başlangıç denetimi geçmedi (abonelik dışı kimlik). Otomatik yeniden deneme yok.",
    );
    assert.equal(yenidenBasladiMetni("Claude"), "Claude süreci beklenmedik biçimde kapandı, yeniden başlatıldı.");
  });

  it("devir notunda asistan satırı adla etiketlenir (kayıttaki rol `eren` görünmez)", () => {
    const metin = devirMetni({
      asistanAdi: "Nova Yardımcı",
      citliOzet: null,
      isler: [],
      planlar: [],
      sorular: [],
      konusma: [
        { rol: "kullanici", metin: "merhaba", ts_ms: 1 },
        { rol: "eren", metin: "selam", ts_ms: 2 },
      ],
    });
    assert.ok(metin.includes('- kullanıcı: "merhaba"'), metin);
    assert.ok(metin.includes('- Nova Yardımcı: "selam"'), metin);
    assert.equal(metin.includes("- eren:"), false);
  });
});

describe("asistan adı: ana sohbetin ilk adı", () => {
  it("geçerli ad olduğu gibi; yoksa ya da kablodaki sohbet adı kuralına uymuyorsa nötr varsayılan", () => {
    assert.equal(ANA_SOHBET_ADI, "Claude");
    assert.equal(anaSohbetAdiUret(undefined), "Claude");
    assert.equal(anaSohbetAdiUret("Nova"), "Nova");
    assert.equal(anaSohbetAdiUret(asistanAdiUret("  Örnek   Asistan ")), "Örnek Asistan");
    // 40 emoji = 80 UTF-16 birimi > SOHBET_ADI (60): kablo reddederdi.
    const emoji = asistanAdiUret("\u{1F600}".repeat(40));
    assert.equal(SohbetAdi.safeParse(emoji).success, false);
    assert.equal(anaSohbetAdiUret(emoji), "Claude");
    // asistanAdiUret'in çıktısı (en çok 40 kod noktası, BMP) her zaman geçerli bir sohbet adıdır.
    assert.equal(anaSohbetAdiUret("ş".repeat(40)), "ş".repeat(40));
  });
});

describe("veri kökü: tek kural", () => {
  it("EREN_KIT_DATA_DIR (mutlak) önce gelir; yoksa %LOCALAPPDATA%\\eren-kit", () => {
    assert.equal(VERI_KOKU_ORTAMI, "EREN_KIT_DATA_DIR");
    assert.equal(VARSAYILAN_VERI_KLASORU, "eren-kit");
    assert.deepEqual(veriKokuCoz({ LOCALAPPDATA: "C:\\Yerel" }), { ok: true, kok: "C:\\Yerel\\eren-kit" });
    assert.deepEqual(veriKokuCoz({ LOCALAPPDATA: "C:\\Yerel", EREN_KIT_DATA_DIR: "D:/Veri/../kit" }), {
      ok: true,
      kok: "D:\\kit",
    });
    // Ortam adı büyük küçük harf duyarsız; boş değer yok sayılır.
    assert.deepEqual(veriKokuCoz({ localappdata: "C:\\Yerel", eren_kit_data_dir: "" }), {
      ok: true,
      kok: "C:\\Yerel\\eren-kit",
    });
    assert.deepEqual(veriKokuCoz({ LOCALAPPDATA: "C:\\Yerel", EREN_KIT_DATA_DIR: "veri" }), {
      ok: false,
      hata: "ozel_kok_goreli",
    });
    assert.deepEqual(veriKokuCoz({}), { ok: false, hata: "localappdata_yok" });
    assert.deepEqual(veriKokuCoz({ LOCALAPPDATA: "goreli" }), { ok: false, hata: "localappdata_yok" });
    // LOCALAPPDATA olmadan da özel kök yeter (bekçi günlüğü için).
    assert.deepEqual(veriKokuCoz({ EREN_KIT_DATA_DIR: "D:\\Veri" }), { ok: true, kok: "D:\\Veri" });
    assert.equal(ortamDegeri({ Path: "x" }, "PATH"), "x");
  });

  it("eski kurulumun klasörü değişkenle sürdürülür: servis kökü kuralla aynı", () => {
    const ortam = (ek: Record<string, string>) => ({ LOCALAPPDATA: "C:\\Yerel", USERPROFILE: UP, ...ek }) as Ortam;
    const ekler: Array<Record<string, string>> = [
      {},
      { EREN_KIT_DATA_DIR: "C:\\Yerel\\Eski" },
      { EREN_KIT_DATA_DIR: "D:\\Veri\\kit" },
    ];
    for (const ek of ekler) {
      const r = veriKokuCoz(ortam(ek));
      assert.ok(r.ok);
      const y = yollariUret(ortam(ek));
      assert.equal(y.kok, r.kok);
      assert.equal(y.log, `${r.kok}\\logs\\servis.log`);
    }
  });

  it("bekçi günlüğü aynı kuraldan: bekci-ana.ts sabit klasör adı kurmaz", () => {
    const kaynak = readFileSync(fileURLToPath(new URL("../src/bekci-ana.ts", import.meta.url)), "utf8");
    assert.match(kaynak, /import \{ veriKokuCoz \} from "\.\/veri-koku\.ts";/);
    assert.match(kaynak, /veriKokuCoz\(process\.env\)/);
    assert.equal(/process\.env\["LOCALAPPDATA"\]/.test(kaynak), false);
  });
});
