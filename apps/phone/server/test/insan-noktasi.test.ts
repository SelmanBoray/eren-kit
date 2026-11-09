import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ANA_SOHBET_ID } from "@eren/protocol";
import { akisKur } from "../src/akis.ts";
import { depoKur } from "../src/depo.ts";
import { veriyoluKur } from "../src/veriyolu.ts";
import type {
  Ayar,
  DogrulanmisInsanMesaji,
  KonusmaBagimliliklari,
} from "../src/sozlesme.ts";
import {
  sahteDosya,
  sahteGunluk,
  sahteKapi,
  sahteRastgele,
  sahteSurec,
  sahteZaman,
} from "./sahte.ts";

// Ana güvenlik değişmezi: ana oturuma "bu insandan geldi" diyen satır tek noktadan çıkar.
// MODULLER.md "### konusma", "Sabitleyen test" (a), (b); (c)'nin gateway dışı kısmı kaynak taramasıdır.

const SRC = new URL("../src/", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1",
);

function tsDosyalari(dizin: string): string[] {
  const sonuc: string[] = [];
  for (const ad of readdirSync(dizin)) {
    const yol = join(dizin, ad);
    if (statSync(yol).isDirectory()) sonuc.push(...tsDosyalari(yol));
    else if (ad.endsWith(".ts")) sonuc.push(yol);
  }
  return sonuc;
}

const ad = (yol: string): string =>
  yol.replaceAll("\\", "/").split("/").pop() ?? yol;
const oku = (dosyaAdi: string): string =>
  readFileSync(join(SRC, dosyaAdi), "utf8");
const say = (metin: string, iglesi: string): number =>
  metin.split(iglesi).length - 1;

describe("(a) kaynak taraması: human metni", () => {
  const dosyalar = tsDosyalari(SRC);

  it("konusma.ts var", () => {
    assert.ok(
      dosyalar.some((d) => ad(d) === "konusma.ts"),
      "src/konusma.ts yok: insan satırının tek kaynağı bulunamadı",
    );
  });

  it("\"human\" ve 'human' metni src altında tam bir kez, konusma.ts içinde geçer", () => {
    const gecenler: string[] = [];
    let toplam = 0;
    for (const d of dosyalar) {
      const m = readFileSync(d, "utf8");
      const n = say(m, '"human"') + say(m, "'human'");
      if (n > 0) gecenler.push(`${ad(d)}:${n}`);
      toplam += n;
    }
    assert.equal(
      toplam,
      1,
      `geçtiği yerler: ${gecenler.join(", ") || "hiçbiri"}`,
    );
    assert.deepEqual(
      gecenler.map((g) => g.split(":")[0]),
      ["konusma.ts"],
    );
  });

  it("sozlesme.ts human metnini içermez", () => {
    const m = oku("sozlesme.ts");
    assert.equal(say(m, '"human"') + say(m, "'human'"), 0);
  });
});

describe("(c) kaynak taraması: insanMesajiAl ve DogrulanmisInsanMesaji", () => {
  const yasakCagiranlar = [
    "kopru-sunucu.ts",
    "cihaz.ts",
    "isler.ts",
    "planlar.ts",
    "bildirim.ts",
    "sohbetler.ts",
    "temizlik.ts",
  ];
  const dosyalar = tsDosyalari(SRC);

  for (const dosya of yasakCagiranlar) {
    it(`${dosya} insanMesajiAl çağırmaz`, () => {
      const yol = dosyalar.find((d) => ad(d) === dosya);
      if (yol === undefined) return; // henüz yazılmamış: tarama var olanlar üzerinde
      assert.ok(
        !readFileSync(yol, "utf8").includes("insanMesajiAl"),
        `${dosya} insanMesajiAl'a erişiyor`,
      );
    });
  }

  it("DogrulanmisInsanMesaji değeri yalnız gateway.ts'te üretilir", () => {
    // Tip adı yalnız `import type`/tür konumunda geçebilir; değer üretimi (`as` ile markalama) yalnız gateway'de.
    const uretenler: string[] = [];
    for (const d of dosyalar) {
      const n = ad(d);
      if (n === "sozlesme.ts" || n === "gateway.ts") continue;
      const m = readFileSync(d, "utf8");
      if (
        /\bas\s+(?:unknown\s+as\s+)?DogrulanmisInsanMesaji\b|<\s*DogrulanmisInsanMesaji\s*>\s*\(/.test(
          m,
        )
      ) {
        uretenler.push(n);
      }
    }
    assert.deepEqual(uretenler, []);
  });

  it("insanMesajiAl'ı çağıran tek dosya gateway.ts'tir (tanım ve konusma.ts hariç)", () => {
    const cagiranlar: string[] = [];
    for (const d of dosyalar) {
      const n = ad(d);
      if (n === "sozlesme.ts" || n === "konusma.ts") continue;
      if (readFileSync(d, "utf8").includes("insanMesajiAl")) cagiranlar.push(n);
    }
    assert.ok(
      cagiranlar.every((n) => n === "gateway.ts"),
      `beklenmeyen çağıran: ${cagiranlar.join(", ")}`,
    );
  });
});

// ---------------------------------------------------------------------------------------------
// (b) davranış: gerçek konusma, sahte süreç. stdin'e yazılan her satır ayrıştırılır.
// ---------------------------------------------------------------------------------------------

async function konusmaKur() {
  const modul = await import("../src/konusma.ts"); // dosya yoksa test burada başarısız olur
  const zaman = sahteZaman();
  const gunluk = sahteGunluk();
  const veriyolu = veriyoluKur({ gunluk });
  const depo = depoKur({ yol: ":memory:", saat: zaman.saat, veriyolu, gunluk });
  const surec = sahteSurec(zaman);
  const dosya = sahteDosya();
  const yollar = {
    kok: "C:/ornek/eren-kit",
    vt: "C:/ornek/eren-kit/eren.db",
    log: "C:/ornek/eren-kit/log",
    islerDizini: "C:/ornek/eren-kit/isler",
    erenCwd: "C:/ornek/eren-kit/cwd",
    erenMcpDizini: "C:/ornek/eren-kit/eren-mcp",
    anahtar: "C:/ornek/eren-kit/anahtar",
    kimlikEki: "C:/ornek/eren-kit/kimlik.txt",
    projeler: "C:/ornek/eren-kit/projeler.json",
    yerelAyar: "C:/ornek/eren-kit/yerel.json",
    limitKilit: "C:/ornek/limit/kilit.json",
  };
  const ayar = {
    yollar,
    claudeExe: "C:/ornek/claude.exe",
    nodeExe: "C:/ornek/node.exe",
    kopruBetigi: "C:/ornek/kopru.ts",
    erenMcpYolu: (nesil: number) => `C:/ornek/eren-kit/eren-mcp/${nesil}.json`,
    erenModeli: "model-ornek",
    pcIsModeli: null,
    telefonIsModeli: "model-ornek",
    wsPort: 7000,
    ramDusukMb: 1000,
    kullaniciAdi: "Kullanici",
    asistanAdi: "Claude",
    computerUse: null,
    sureler: {
      kilitYoklamaMs: 1000,
      torunYoklamaMs: 1000,
      isYoklamaMs: 1000,
      ramYoklamaMs: 1000,
      soruZamanAsimiMs: 60_000,
      devirOzetiBeklemeMs: 5000,
      deltaTamponMs: 80,
      bildirimAckMs: 3000,
      komutPayiMs: 100,
      erenYenidenBaslatmaMs: 1000,
    },
    erenOrtami: () => ({}),
    telefonIsOrtami: () => ({}),
    pcIsOrtami: () => ({}),
    kimlikEki: async () => "",
    projeler: async () => ({ projeler: [] }),
    telegram: async () => null,
    mcpProfilSunucusu: () => null,
    isYollari: () => {
      throw new Error("kullanılmaz");
    },
  } as unknown as Ayar;
  let nesilSayaci = 0;
  const b: KonusmaBagimliliklari = {
    sohbet_id: ANA_SOHBET_ID,
    kapi: sahteKapi(),
    nesilAyir: () => ++nesilSayaci,
    ayar,
    depo,
    kilit: { baslatmaSerbestMi: () => true },
    kopru: { jetonUret: () => "jeton-ornek", jetonlariIptalEt: () => {} },
    akis: akisKur(),
    surec,
    dosya,
    saat: zaman.saat,
    zamanlayici: zaman.zamanlayici,
    rastgele: sahteRastgele(),
    veriyolu,
    gunluk,
  };
  const konusma = (
    modul.konusmaKur as (
      b: KonusmaBagimliliklari,
    ) => ReturnType<typeof modul.konusmaKur>
  )(b);
  return { konusma, surec, veriyolu, zaman };
}

type Satir = Record<string, unknown>;

/** Süreç init ve her satırdan sonra result verir; kuyruk boşalana dek stdin satırlarını toplar. */
async function satirlariTopla(
  surec: ReturnType<typeof sahteSurec>,
  zaman: ReturnType<typeof sahteZaman>,
  tur: number,
): Promise<Satir[]> {
  const s = surec.sonBorulu();
  let gorulen = 0;
  for (let i = 0; i < tur; i++) {
    for (let k = 0; k < 20; k++) await Promise.resolve();
    zaman.ilerlet(200);
    while (gorulen < s.yazilanlar.length) {
      gorulen++;
      s.stdoutSatiriGonder(
        JSON.stringify({
          type: "result",
          subtype: "success",
          is_error: false,
          result: "tamam",
          stop_reason: "end_turn",
        }),
      );
      for (let k = 0; k < 20; k++) await Promise.resolve();
      zaman.ilerlet(200);
    }
  }
  return s.yazilanlar
    .filter((y) => y.trim().startsWith("{"))
    .map((y) => JSON.parse(y) as Satir)
    .filter((o) => o["type"] === "user");
}

describe("(b) stdin satırlarında origin ve isSynthetic ayrımı", () => {
  it("sentetik satırlarda origin yok, kullanıcı satırında isSynthetic yok, yalnız kullanıcıda human var", async () => {
    const { konusma, surec, veriyolu, zaman } = await konusmaKur();
    await konusma.baslat();
    konusma.uyandir();
    // uyandir() açılışı arkada yürütür (mcp dosyası yazılır, sonra süreç başlar): bitmesini bekle.
    for (let k = 0; k < 50; k++)
      await new Promise<void>((tamam) => setImmediate(tamam));
    const s = surec.sonBorulu();
    s.stdoutSatiriGonder(
      JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "00000000-aaaa-bbbb-cccc-000000000001",
        tools: ["mcp__eren__plan_oner"],
        mcp_servers: [{ name: "eren", status: "connected" }],
        apiKeySource: "none",
        model: "model-ornek",
      }),
    );

    // Sentetik kaynaklar: veriyolu olayları (kapalı liste).
    veriyolu.yayinla("is_bitti", {
      is_id: 7 as never,
      plan_id: "plan-1",
      tur: "pc" as never,
      durum: "tamam" as never,
      kirli: true,
      sohbet_id: ANA_SOHBET_ID,
    });
    veriyolu.yayinla("soru_durumu", {
      soru_id: "soru-1",
      is_id: 7 as never,
      durum: "soruldu",
      sohbet_id: ANA_SOHBET_ID,
    });
    veriyolu.yayinla("plan_sonuclandi", {
      plan_id: "plan-1",
      sonuc: "onaylandi",
      is_id: 7 as never,
      sohbet_id: ANA_SOHBET_ID,
    });
    veriyolu.yayinla("isler_uzlastirildi", {
      sahiplenilen: 2,
      biten: 1,
      sohbetler: {},
    });
    // Kullanıcı kaynağı: tek giriş insanMesajiAl.
    const insan = {
      sohbet_id: ANA_SOHBET_ID,
      device_id: "cihaz-1",
      client_msg_id: "msg-1",
      input: "yazi",
      text: "merhaba",
    } as unknown as DogrulanmisInsanMesaji;
    konusma.insanMesajiAl(insan);

    const satirlar = await satirlariTopla(surec, zaman, 12);
    const metinli = satirlar.map((o) => ({
      o,
      metin: String(
        (o["message"] as { content?: unknown } | undefined)?.content ?? "",
      ),
    }));

    const kullanici = metinli.filter((x) => x.metin.includes("merhaba"));
    assert.equal(kullanici.length, 1, "kullanıcı satırı tam bir kez");
    for (const { o } of kullanici) {
      assert.ok(
        !("isSynthetic" in o),
        "kullanıcı satırında isSynthetic olamaz",
      );
      assert.deepEqual(o["origin"], { kind: "human" });
      assert.equal(o["client_composed"], true);
    }

    const sentetikler = metinli.filter((x) => !x.metin.includes("merhaba"));
    assert.ok(sentetikler.length >= 1, "en az bir sentetik satır görülmeli");
    for (const { o } of sentetikler) {
      assert.ok(!("origin" in o), "sentetik satırda origin anahtarı olamaz");
      assert.equal(o["isSynthetic"], true);
      assert.equal(o["client_composed"], true);
    }

    // Ham metin düzeyinde de: human yalnız kullanıcı satırında.
    const hamHuman = s.yazilanlar.filter((y) => y.includes('"human"'));
    assert.equal(hamHuman.length, 1);
    assert.ok(hamHuman[0]?.includes("merhaba"));
  });
});
