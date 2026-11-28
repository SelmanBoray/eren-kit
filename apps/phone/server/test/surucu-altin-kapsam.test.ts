/**
 * H4.0 altın kayıtlarının bayatlama denetimi: kaynak, kayıtların kapsamadığı Claude'a özgü bir şey
 * getirirse (yeni argv bayrağı, ortam anahtarı, stdin satır kurucusu, akış olayı/girdi türü, veriyolu
 * yayını, depo yazımı, ayar alanı, bağımlılık, medya sınırı) kırmızı. Kayıtlar sessizce eskimez.
 *
 * Yol: kaynak taraması ↔ kayıt karşılaştırması (parmak izi DEĞİL). Gerekçe: H4 dilimleri kodu taşır
 * (`konusma.ts` → `surucu-claude.ts`); bölge parmak izi her taşımada ve yorum düzeltmesinde kırmızı olur,
 * yeniden üretmek refleks olur ve anlamını yitirir. Tarama taşımaya dayanıklıdır (dosya kümesi önekle:
 * `surucu-*.ts` kendiliğinden girer), yalnız YENİ bir şey belirince düşer. Her kategori:
 *   kaynakta görülen ⊆ kayıtlarda görülen ∪ bilerek dışarıda (gerekçeli); dışarıda listesi de bayatlamaz.
 * Kayıtta görünen ama kaynakta olmayan bir şey kayıt farkıyla zaten kırmızıdır (`surucu-altin.test.ts`).
 *
 * Kırmızıda: ya yeni duruma senaryo ekle ve kayıtları yeniden üret (`ALTIN_YENIDEN_URET`), ya da bilerek
 * kapsam dışıysa aşağıdaki tabloya gerekçesiyle ekle.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ALTIN_DIZINI, ALTIN_YENIDEN_URET, altinOku, SERVER_DIZINI } from "./altin-kayit.ts";
import { DEPO_OKUMALARI, DEPO_YAZIMLARI } from "./altin-duzen.ts";
import {
  anahtarAdlari,
  arayuzAlanlari,
  birlesimTurleri,
  caseDizgeleri,
  cagriDizgeleri,
  dizgeler,
  kaynaklar,
  secilenler,
  uyeler,
} from "./altin-tarama.ts";
import type { Bulgu, KaynakDosyasi } from "./altin-tarama.ts";

/** Claude'a özgü kodun dosyaları (önekle): sürücü dilimleri yeni dosyayı `surucu-*.ts` adıyla açar. */
const SURUCU_DOSYALARI = ["konusma", "isler", "surucu", "akis", "ayar", "etkinlik", "tuketim"] as const;
const ONERI = `Senaryo ekleyip yeniden üret (${ALTIN_YENIDEN_URET}) ya da bilerek kapsam dışıysa surucu-altin-kapsam.test.ts tablosuna gerekçesiyle ekle.`;

const sozlesme = (): KaynakDosyasi => {
  const d = kaynaklar().find((k) => k.ad === "sozlesme.ts");
  assert.ok(d, "sozlesme.ts yok");
  return d;
};

const kume = (b: readonly Bulgu[]): Map<string, Set<string>> => {
  const m = new Map<string, Set<string>>();
  for (const x of b) {
    const s = m.get(x.deger) ?? new Set<string>();
    s.add(x.dosya);
    m.set(x.deger, s);
  }
  return m;
};

/** Kayıtların bütün değerlerinde gezer. */
function gez(v: unknown, f: (x: unknown, anahtar: string | null) => void, anahtar: string | null = null): void {
  f(v, anahtar);
  if (Array.isArray(v)) for (const x of v) gez(x, f, null);
  else if (v !== null && typeof v === "object") for (const [k, x] of Object.entries(v)) gez(x, f, k);
}

const izler = (kayit: string): unknown[][] => {
  const l: unknown[][] = [];
  gez(altinOku(kayit), (x, k) => {
    if (k === "iz" && Array.isArray(x)) for (const g of x) if (Array.isArray(g)) l.push(g);
  });
  return l;
};

/**
 * Ortak denetim: kaynakta görülen her değer kayıtta ya da gerekçeli dışarıda listesinde olmalı; dışarıda
 * listesindeki her değer kaynakta hâlâ görülmeli ve kayıtta OLMAMALI (yoksa liste bayattır).
 */
function kapsamDenetle(baslik: string, kaynak: Map<string, Set<string>>, kayit: ReadonlySet<string>, disarida: Readonly<Record<string, string>>): void {
  const eksik = [...kaynak].filter(([d]) => !kayit.has(d) && !Object.hasOwn(disarida, d)).map(([d, f]) => `${d} (${[...f].join(", ")})`);
  const bayat = Object.keys(disarida).filter((d) => !kaynak.has(d) || kayit.has(d));
  assert.deepEqual(eksik, [], `${baslik}: kaynakta var, altın kayıtta yok → kayıt bayatlamış olabilir. ${ONERI}`);
  assert.deepEqual(bayat, [], `${baslik}: "bilerek dışarıda" listesi bayat (kaynakta yok ya da artık kayıtta var); listeden çıkar.`);
}

// ---------------------------------------------------------------------------------------------
// Bilerek kapsam dışı tablolar (her girdi gerekçeli)
// ---------------------------------------------------------------------------------------------

/** `veriyolu.yayinla("X"` sürücü dosyalarında; kayıtta olmayanlar. */
const YAYIN_DISARIDA: Readonly<Record<string, string>> = {
  isler_uzlastirildi: "İşlerin açılış uzlaştırması (servis yeniden başlayınca); süreç komutu ve akış çözümü değil.",
  kirli_okundu: "Köprünün rapor okuma yolu; Claude sürecine dokunmaz.",
  ram_degisti: "RAM yoklaması; sürücüden bağımsız.",
  soru_durumu: "İş sorusu yolu (0.5.0'da iş soru sormaz, köprü fiili); akış çözümü değil.",
};

/** `depo.X` yazımları sürücü dosyalarında; kayıtta olmayanlar. */
const DEPO_YAZIM_DISARIDA: Readonly<Record<string, string>> = {
  isPidEkle: "Torun süreç kaydı (anlık görüntü yoklaması); süreç adı eşlemesi H4.5'te ayrı testlerle (isler*.test.ts).",
  soruEkle: "İş sorusu yolu; akış çözümü değil.",
  soruGuncelle: "İş sorusu yolu; akış çözümü değil.",
};

/**
 * `ayar.X` okumaları sürücü dosyalarında → kaydın neresinde değiştiği / görüldüğü. Yeni alan okunursa
 * (ör. yeni bir bayrağı açan seçenek) kırmızı: o seçeneğin varyantı kayda eklenmeli.
 */
const AYAR_EKSENLERI: Readonly<Record<string, string>> = {
  asistanAdi: "baslatma yeni_hepsi (EREN_KIT_ASSISTANT_NAME), istem metni",
  claudeExe: "baslatma/isler exe",
  computerUse: "baslatma yeni_computer_use; isler pc_rea_cu_yok",
  erenMcpYolu: "baslatma mcp.yol",
  erenModeli: "baslatma argv --model (varsayılan; seçenek değeri argv'ye aynen)",
  erenOrtami: "baslatma ortam",
  isYollari: "isler istek outYol/errYol, gorev.txt, mcp.json",
  kimlikEki: "baslatma yeni_hepsi (istem sonu)",
  kopruBetigi: "mcp args (<server>)",
  kullaniciAdi: "isler telefon istemi",
  mcpProfilSunucusu: "isler pc_rea_cu_yok",
  medya: "baslatma yeni_medya; konusma medyali, gorsel_butcesi_*; medya sinirlar",
  nodeExe: "mcp command",
  pcIsModeli: "isler pc_tam_model, pc_hafif",
  pcIsOrtami: "isler pc_* ortam",
  ramDusukMb: "DIŞARIDA: RAM eşiği, sürücüden bağımsız",
  sureler: "senaryolarda varsayılan değerler (deltaTamponMs, devirOzetiBeklemeMs, erenYenidenBaslatmaMs, isYoklamaMs)",
  tamYetki: "baslatma yeni_tam_yetki_yok, yeni_hepsi_tam_yetki_yok",
  telefonIsModeli: "isler telefon",
  telefonIsOrtami: "isler telefon ortam",
  yollar: "baslatma cwd (erenCwd)",
};

/** Konuşma ve işler bağımlılıkları → kayıttaki karşılığı. Yeni bağımlılık (ör. H4.2'de `surucu`) kırmızı. */
const KONUSMA_BAGIMLILIKLARI: Readonly<Record<string, string>> = {
  sohbet_id: "sabit ana",
  kapi: "sahte kapı; iz 'kapi'",
  nesilAyir: "depo.enBuyukNesil + 1",
  ayar: "gerçek ayarKur (sahte dosya/ortam)",
  depo: "gerçek depo; iz 'depo'/'islem'",
  kilit: "serbest (kilit yolu sürücüden bağımsız)",
  kopru: "iz 'kopru'",
  akis: "gerçek akisKur",
  surec: "sahte süreç; iz 'surec'/'stdin'",
  dosya: "sahte dosya; iz 'dosya'",
  saat: "sahte saat; <t+N>",
  zamanlayici: "sahte zamanlayıcı",
  rastgele: "sahte; yer tutucu",
  veriyolu: "gerçek; iz 'yayin'",
  gunluk: "kayda girmez (davranış değil)",
  takvim: "takvim var/yok varyantları",
  ajandaKopru: "takvimle birlikte; iz 'ajanda'",
  medya: "medya var/yok varyantları; iz 'medya'",
};
const ISLER_BAGIMLILIKLARI: Readonly<Record<string, string>> = {
  ayar: "gerçek ayarKur",
  depo: "gerçek depo; iz",
  kilit: "serbest",
  kopru: "iz 'kopru'",
  akis: "gerçek akisKur",
  surec: "sahte süreç; iz 'surec'",
  dosya: "sahte dosya; iz 'dosya'",
  sistem: "sahte sistem (masaüstü bağlı)",
  saat: "sahte saat",
  zamanlayici: "sahte zamanlayıcı",
  rastgele: "sahte; yer tutucu",
  veriyolu: "gerçek; iz 'yayin'",
  gunluk: "kayda girmez",
};

/** `plan.X` okumaları (işler). */
const PLAN_ALANLARI: Readonly<Record<string, string>> = {
  baslik: "isler iz (job_started)",
  cwd: "isler pc istek cwd",
  gorev_metni: "gorev.txt ve -p (tire önekli varyant dahil)",
  kirli_kaynak: "kirli bayrağı (komutu etkilemez); isler*.test.ts",
  mcp_profili: "isler pc_rea_cu_yok",
  plan_id: "isler iz",
  tur: "pc ve telefon varyantları",
};

/** stdin'e giden satır kurucuları: kaynaktaki sayı ve kayıttaki biçim kümesi. Yeni kurucu kırmızı. */
const STDIN_KURUCU_SAYILARI = { parent_tool_use_id_anahtari: 2, control_request_dizgesi: 1 } as const;
const STDIN_BICIMLERI: readonly string[] = [
  "control_request|interrupt",
  "user|human|-|blok:image,text",
  "user|human|-|metin",
  "user|-|sentetik|metin",
];

// ---------------------------------------------------------------------------------------------
// Kayıttan okunan kümeler
// ---------------------------------------------------------------------------------------------

const KOMUT_KAYITLARI = ["baslatma", "isler"] as const;

const kayitDizgeleri = (kayitlar: readonly string[], suzgec: RegExp): Set<string> => {
  const s = new Set<string>();
  for (const k of kayitlar) gez(altinOku(k), (x) => {
    if (typeof x === "string" && suzgec.test(x)) s.add(x);
  });
  return s;
};

const kayitAnahtarlari = (kayitlar: readonly string[], ust: string): Set<string> => {
  const s = new Set<string>();
  for (const k of kayitlar) gez(altinOku(k), (x, a) => {
    if (a === ust && x !== null && typeof x === "object" && !Array.isArray(x)) for (const kk of Object.keys(x)) s.add(kk);
  });
  return s;
};

const izAdlari = (tur: string): Set<string> => {
  const s = new Set<string>();
  for (const k of ["konusma", "isler"]) for (const g of izler(k)) if (g[0] === tur && typeof g[1] === "string") s.add(g[1]);
  return s;
};

const stdinBicimi = (o: Record<string, unknown>): string => {
  if (o["type"] === "control_request") return `control_request|${String((o["request"] as Record<string, unknown> | undefined)?.["subtype"])}`;
  const origin = (o["origin"] as Record<string, unknown> | undefined)?.["kind"];
  const icerik = (o["message"] as Record<string, unknown> | undefined)?.["content"];
  const ic = Array.isArray(icerik)
    ? `blok:${[...new Set(icerik.map((b) => String((b as Record<string, unknown>)["type"])))].sort().join(",")}`
    : typeof icerik === "string"
      ? "metin"
      : String(icerik);
  return `${String(o["type"])}|${typeof origin === "string" ? origin : "-"}|${o["isSynthetic"] === true ? "sentetik" : "-"}|${ic}`;
};

// ---------------------------------------------------------------------------------------------
// Testler
// ---------------------------------------------------------------------------------------------

describe("surucu-altin-kapsam: altın kayıtlar kaynağa göre bayat değil", () => {
  const surucu = secilenler(SURUCU_DOSYALARI);

  it("sürücü dosya kümesi taranıyor (konusma, isler, akis, ayar en azından)", () => {
    const adlar = surucu.map((k) => k.ad);
    for (const ad of ["konusma.ts", "konusma-metin.ts", "isler.ts", "isler-komut.ts", "akis.ts", "ayar.ts"]) assert.ok(adlar.includes(ad), ad);
  });

  it("argv bayrakları: kaynaktaki her `--bayrak` dizgesi bir kayıtlı argv'de (ya da mcp args'ta) görülüyor", () => {
    const suzgec = /^--[A-Za-z][A-Za-z0-9-]*$/;
    kapsamDenetle("argv bayrağı", kume(dizgeler(surucu, suzgec)), kayitDizgeleri(KOMUT_KAYITLARI, suzgec), {});
  });

  it("ortam anahtarları: kaynaktaki her CLAUDE*/ANTHROPIC* anahtarı kayıtlı bir ortamda", () => {
    const suzgec = /^(CLAUDE|ANTHROPIC)[A-Z0-9]*_[A-Z0-9_]+$/;
    const kaynak = kume([...dizgeler(surucu, suzgec), ...anahtarAdlari(surucu, suzgec)]);
    kapsamDenetle("ortam anahtarı", kaynak, kayitAnahtarlari(KOMUT_KAYITLARI, "ortam"), {});
  });

  it("stdin satır kurucuları: kaynakta beklenen sayıda, kayıtta beklenen biçimlerin hepsi", () => {
    const anahtar = anahtarAdlari(surucu, /^parent_tool_use_id$/).length;
    const kontrol = dizgeler(surucu, /^control_request$/).length;
    assert.deepEqual(
      { parent_tool_use_id_anahtari: anahtar, control_request_dizgesi: kontrol },
      STDIN_KURUCU_SAYILARI,
      `stdin satır kurucusu sayısı değişti (yeni satır türü?). Yeni türün senaryosunu ekle, STDIN_KURUCU_SAYILARI ve STDIN_BICIMLERI'ni güncelle, yeniden üret. ${ONERI}`,
    );
    const bicimler = new Set<string>();
    for (const g of izler("konusma")) if (g[0] === "stdin" && g[2] !== null && typeof g[2] === "object") bicimler.add(stdinBicimi(g[2] as Record<string, unknown>));
    assert.deepEqual([...bicimler].sort(), [...STDIN_BICIMLERI].sort(), "kayıttaki stdin satır biçimleri beklenen kataloğa uymuyor: kataloğu bilerek güncelle.");
  });

  it("akış: AkisOlayi'nin her türü ve akis.ts'in her `case` girdisi çözücü kaydında", () => {
    const cozucu = altinOku("cozucu");
    const olaylar = new Set<string>();
    const girdiler = new Set<string>();
    for (const s of (cozucu["satirlar"] as Array<{ satir: string; olay: { tur?: string } | null }>)) {
      if (s.olay?.tur !== undefined) olaylar.add(s.olay.tur);
      try {
        gez(JSON.parse(s.satir.replace(/^﻿/, "")) as unknown, (x, a) => {
          if ((a === "type" || a === "subtype") && typeof x === "string") girdiler.add(x);
        });
      } catch {
        // bozuk girdi örneği
      }
    }
    const turler = new Map(birlesimTurleri(sozlesme(), "AkisOlayi", "tur").map((t) => [t, new Set(["sozlesme.ts"])]));
    kapsamDenetle("AkisOlayi türü", turler, olaylar, {});
    kapsamDenetle("stream-json girdi türü (case)", kume(caseDizgeleri(secilenler(["akis", "surucu"]))), girdiler, {});
  });

  it("veriyolu yayınları ve depo yazımları kayıtta (ya da gerekçeli dışarıda)", () => {
    kapsamDenetle("veriyolu yayını", kume(cagriDizgeleri(surucu, "veriyolu", "yayinla")), izAdlari("yayin"), YAYIN_DISARIDA);
    const depo = kume(uyeler(surucu, "depo"));
    const siniflanmamis = [...depo.keys()].filter((y) => !DEPO_YAZIMLARI.has(y) && !DEPO_OKUMALARI.has(y));
    assert.deepEqual(siniflanmamis, [], "sınıflanmamış depo yöntemi: altin-duzen.ts DEPO_YAZIMLARI ya da DEPO_OKUMALARI'na ekle (yazımsa ize girer).");
    const yazimlar = new Map([...depo].filter(([y]) => DEPO_YAZIMLARI.has(y)));
    kapsamDenetle("depo yazımı", yazimlar, izAdlari("depo"), DEPO_YAZIM_DISARIDA);
  });

  it("ayar alanları, plan alanları ve bağımlılıklar: her eksen kayıtta bir varyanta bağlı", () => {
    const tablo = (baslik: string, kaynak: Iterable<string>, beklenen: Readonly<Record<string, string>>): void => {
      const k = [...new Set(kaynak)].sort();
      assert.deepEqual(k, Object.keys(beklenen).sort(), `${baslik} değişti: yeni eksenin varyantını kayda ekle, tabloyu güncelle. ${ONERI}`);
    };
    tablo("ayar.X okumaları", uyeler(surucu, "ayar").map((b) => b.deger), AYAR_EKSENLERI);
    tablo("plan.X okumaları", uyeler(secilenler(["isler"]), "plan").map((b) => b.deger), PLAN_ALANLARI);
    tablo("KonusmaBagimliliklari", arayuzAlanlari(sozlesme(), "KonusmaBagimliliklari"), KONUSMA_BAGIMLILIKLARI);
    tablo("IslerBagimliliklari", arayuzAlanlari(sozlesme(), "IslerBagimliliklari"), ISLER_BAGIMLILIKLARI);
  });

  it("medya sınırları: MedyaServisSinirlari'nın her alanı kayıtta", () => {
    const kayit = Object.keys((altinOku("medya")["sinirlar"] ?? {}) as Record<string, unknown>).sort();
    assert.deepEqual(kayit, arayuzAlanlari(sozlesme(), "MedyaServisSinirlari").sort(), `medya sınırı eklendi/çıktı. ${ONERI}`);
  });

  it("kayıtlarda kişisel yol, ad, gerçek kullanıcı dizini yok", () => {
    const yasak = [homedir(), userInfo().username, SERVER_DIZINI, "\\Users\\", "/Users/", "AppData\\Roaming", ".claude\\projects\\C--"]
      .filter((y) => y.length >= 3)
      .flatMap((y) => [y, JSON.stringify(y).slice(1, -1)]);
    for (const ad of readdirSync(ALTIN_DIZINI).filter((a) => a.endsWith(".json"))) {
      const metin = readFileSync(join(ALTIN_DIZINI, ad), "utf8");
      for (const y of yasak) assert.ok(!metin.toLowerCase().includes(y.toLowerCase()), `${ad} kişisel/yerel değer içeriyor`);
    }
  });
});
