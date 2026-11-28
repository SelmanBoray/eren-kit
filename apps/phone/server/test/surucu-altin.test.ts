/**
 * H4.0 altın kayıtları (HARNESS-H4-PLAN.md "H4.0"): sürücü sınırına taşınmadan ÖNCE bugünkü Claude'a özgü
 * davranış, sahte portlarla. Sonraki her H4 dilimi bu kayıtları bayt bayt korur. `src`'ye dokunulmaz.
 *
 * Kayıtlar (`test/altin/claude-*.json`), plan maddeleriyle:
 * - `baslatma` (a): ana oturum `exe`/`argv`/`cwd`/`ortam` + nesil mcp dosyası; kip yeni/devam; takvim,
 *   medya, computer-use, tam yetki var/yok. Ayar gerçek `ayarKur`'dan (ortam silme ve kapatma anahtarları dahil).
 * - `konusma` (b, c, d): stdin satırları (insan, kısayollu, medyalı, sentetik, birleşik sentetik, devir isteği
 *   ve ilk satırı, kurtarma notu, kesme), akış senaryosu (veriyolu ve depo yazım sırası, işlem sınırları,
 *   etkinlik, tüketim), kimlik reddi, hata devri, doluluk devri ve eşik altı, görsel bütçesi devri.
 * - `kararlar` (d): `apiKeySource` tablosu (gerçek konuşmayla), tur sınıfı, devir eşiği, doluluk,
 *   `pencereSec`, araç kategorisi.
 * - `isler` (e): PC tam/hafif/model/rea ve telefon `AyrikSurecIstegi`, `mcp.json`, `gorev.txt`; `out.jsonl`
 *   senaryolarından `son_result`, tüketim, "bağlı değil" notu, limit olayı, telefon köprüsüz kapanış.
 * - `medya` (f, koordinatör): `MEDYA_SERVIS_SINIRLARI` (gerçek ayardan), görsel/kare ölçek argv'si ve boyutları,
 *   ekli satırın blok içeriği.
 * - `cozucu` (plan f): stream-json girdi satırı → `AkisOlayi`, satır ayırıcı.
 *
 * Yeniden üretme: `altin-kayit.ts` `ALTIN_YENIDEN_URET`. Bayatlama: `surucu-altin-kapsam.test.ts`.
 */
import { describe, it } from "node:test";
import type { EkBilgisi } from "@eren/protocol";
import { akisKur } from "../src/akis.ts";
import { aracKategorisi } from "../src/etkinlik.ts";
import { gorselArgv, kareArgv, olcekBoyutu } from "../src/medya-isle.ts";
import { medyaIcerigiKur } from "../src/medya-metin.ts";
import type { AkisOlayi, MediaStateGovdesi, MedyaIcerigi, MedyaServisSinirlari } from "../src/sozlesme.ts";
import { altinDenetle, jsonKaydi, normallestir, T0 } from "./altin-kayit.ts";
import {
  ANA,
  asistanSatiri,
  bosalt,
  initSatiri,
  islerDuzeni,
  konusmaDuzeni,
  MODEL,
  parcaSatiri,
  sonucSatiri,
} from "./altin-duzen.ts";
import type { IslerDuzeni, KonusmaDuzeni, KonusmaSecenegi } from "./altin-duzen.ts";
import { sahteMedyaBaytlari } from "./sahte.ts";

const izKaydi = (h: KonusmaDuzeni | IslerDuzeni, ek: Record<string, unknown> = {}): unknown =>
  normallestir({ ...ek, iz: h.iz.girdiler }, h.yt);

/**
 * Uzun argv metinleri (sistem istemi, JSON şeması) senaryolar arasında bir kez yazılır: argv'de `<metin:N>`,
 * metin `uzun_metinler` senaryosunda bayt bayt. Kayıt küçük kalır, bilgi kaybolmaz.
 */
class UzunMetinler {
  readonly tablo: Record<string, string> = {};
  private readonly harita = new Map<string, string>();
  ref(m: string): string {
    if (m.length <= 300) return m;
    let k = this.harita.get(m);
    if (k === undefined) {
      k = `<metin:${this.harita.size + 1}>`;
      this.harita.set(m, k);
      this.tablo[k] = m;
    }
    return k;
  }
}

const B64 = Buffer.from(sahteMedyaBaytlari("jpg", 12)).toString("base64");
const SIFIRLAMA_SN = T0 / 1000 + 3600;

// ---------------------------------------------------------------------------------------------
// (a) Ana oturum başlatma
// ---------------------------------------------------------------------------------------------

const HEPSI: KonusmaSecenegi = {
  takvim: true,
  medya: true,
  computerUse: true,
  kimlikEki: "Kimlik eki: örnek satır.",
  asistanAdi: "Ornek Asistan",
};

const BASLATMA: Record<string, { sec: KonusmaSecenegi; devam: boolean }> = {
  yeni_temel: { sec: {}, devam: false },
  devam_temel: { sec: {}, devam: true },
  yeni_takvim: { sec: { takvim: true }, devam: false },
  yeni_medya: { sec: { medya: true }, devam: false },
  yeni_computer_use: { sec: { computerUse: true }, devam: false },
  yeni_tam_yetki_yok: { sec: { tamYetki: false }, devam: false },
  yeni_hepsi: { sec: HEPSI, devam: false },
  devam_hepsi: { sec: HEPSI, devam: true },
  yeni_hepsi_tam_yetki_yok: { sec: { ...HEPSI, tamYetki: false }, devam: false },
};

async function baslatmaKaydi(sec: KonusmaSecenegi, devam: boolean, uzun: UzunMetinler): Promise<unknown> {
  const h = await konusmaDuzeni(sec);
  if (devam) h.nesilTohumla({});
  await h.basla();
  const b = h.baslatmalar[0];
  if (b === undefined) throw new Error("altın: başlatma yok");
  const argv = b.istek.argv;
  const mcpYolu = argv[argv.indexOf("--mcp-config") + 1]!;
  const mcp = h.d.dosya.icerik(mcpYolu);
  return normallestir(
    {
      secenek: { ...sec, devam },
      baslatma: { exe: b.istek.exe, argv: argv.map((a) => uzun.ref(a)), cwd: b.istek.cwd, ortam: b.istek.ortam },
      mcp: { yol: mcpYolu, icerik: mcp === null ? null : jsonKaydi(mcp) },
      iz: h.iz.girdiler,
    },
    h.yt,
  );
}

// ---------------------------------------------------------------------------------------------
// (b, c, d) Konuşma senaryoları
// ---------------------------------------------------------------------------------------------

const TAKVIM: KonusmaSecenegi = { takvim: true };

/** (c) init → stream_event → assistant usage/tool_use → rate_limit → tool_result → result. */
async function akisTuru(): Promise<unknown> {
  const h = await konusmaDuzeni({ takvim: true, computerUse: true });
  await h.basla();
  const s = h.sonSurec();
  await h.besle(s, "init", initSatiri(s, { mcp_servers: [{ name: "eren", status: "connected" }, { name: "computer-use-windows", status: "connected" }] }));
  h.insan(1, "Merhaba, dosyaları listele.");
  await bosalt();
  await h.besle(s, "message_start", { type: "stream_event", parent_tool_use_id: null, event: { type: "message_start", message: { id: "m1" } } });
  await h.besle(s, "blok:thinking", { type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_start", index: 0, content_block: { type: "thinking" } } });
  await h.besle(s, "blok:text", { type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_start", index: 1, content_block: { type: "text" } } });
  await h.besle(s, "parca", parcaSatiri("Bakıyorum, "));
  await h.besle(s, "parca", parcaSatiri("hemen"));
  await h.ilerlet(100);
  await h.besle(s, "blok:tool_use", {
    type: "stream_event",
    parent_tool_use_id: null,
    event: { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "arac_1", name: "PowerShell" } },
  });
  await h.besle(
    s,
    "assistant:m1",
    asistanSatiri("m1", 1000, { cc: 200, cr: 300, icerik: [{ type: "text", text: "Bakıyorum, hemen" }, { type: "tool_use", id: "arac_1", name: "PowerShell", input: {} }] }),
  );
  await h.besle(s, "assistant:alt_ajan", asistanSatiri("m_alt", 5, { ebeveyn: "arac_1", icerik: [{ type: "tool_use", id: "arac_alt", name: "Read", input: {} }] }));
  await h.besle(s, "rate_limit", {
    type: "rate_limit_event",
    rate_limit_info: {
      unifiedWindows: {
        five_hour: { utilization: 0.42, resetsAt: SIFIRLAMA_SN },
        seven_day: { utilization: 0.1, resetsAt: SIFIRLAMA_SN + 86_400 },
      },
    },
  });
  await h.besle(s, "tool_result:arac_1", { type: "user", parent_tool_use_id: null, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "arac_1", content: "a.txt" }] } });
  await h.besle(s, "user:replay", { type: "user", isReplay: true, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "arac_1" }] } });
  await h.besle(s, "blok:tool_use:ekran", {
    type: "stream_event",
    parent_tool_use_id: null,
    event: { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "arac_2", name: "mcp__computer-use-windows__screenshot" } },
  });
  await h.besle(s, "tool_result:arac_2", { type: "user", parent_tool_use_id: null, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "arac_2" }] } });
  await h.besle(s, "message_start", { type: "stream_event", parent_tool_use_id: null, event: { type: "message_start", message: { id: "m2" } } });
  await h.besle(s, "parca", parcaSatiri(" Üç dosya var. "));
  h.iz.ekle("aktifTur", h.konusma.aktifTur());
  await h.besle(s, "assistant:m2", asistanSatiri("m2", 2000, { cr: 1500 }));
  await h.besle(s, "assistant:m2_tekrar", asistanSatiri("m2", 2100, { cr: 1500 }));
  await h.besle(s, "hook_response", { type: "system", subtype: "hook_response", output: "kanca" });
  await h.besle(s, "control_response", { type: "control_response", response: { subtype: "success", request_id: "istek_1" } });
  await h.ilerlet(1500);
  await h.besle(
    s,
    "result",
    sonucSatiri({
      result: "Bakıyorum, hemen Üç dosya var.",
      modelUsage: { [`${MODEL}[1m]`]: { contextWindow: 1_000_000 }, "claude-haiku-ornek": { contextWindow: 200_000 } },
      model_usage_since_last_result: {
        [MODEL]: { inputTokens: 3000, outputTokens: 40, cacheReadInputTokens: 1800, cacheCreationInputTokens: 200, costUSD: 0.12 },
        "claude-haiku-ornek": { inputTokens: 50, outputTokens: 5, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.001 },
      },
      usage: { input_tokens: 2100, cache_creation_input_tokens: 0, cache_read_input_tokens: 1500, output_tokens: 30 },
    }),
  );
  h.iz.ekle("durum", h.konusma.durum());
  return izKaydi(h);
}

/** (b) İnsan satırı damgasız (takvim yok). */
async function insanTakvimsiz(): Promise<unknown> {
  const h = await konusmaDuzeni({});
  await h.basla();
  const s = h.sonSurec();
  await h.besle(s, "init", initSatiri(s));
  h.insan(1, "merhaba");
  await bosalt();
  await h.besle(s, "result", sonucSatiri());
  return izKaydi(h);
}

/** (b) Kısayollu insan satırı: bağlamlı ve bağlamsız; damgalı. */
async function kisayol(): Promise<unknown> {
  const h = await konusmaDuzeni(TAKVIM);
  await h.basla();
  const s = h.sonSurec();
  await h.besle(s, "init", initSatiri(s));
  h.insan(1, "Bu ne?", { input: "kisayol", baglam: { paket: "com.ornek.uygulama", ad: 'Örnek "Uygulama" ikinci' } });
  await bosalt();
  await h.besle(s, "result", sonucSatiri());
  h.insan(2, "Ya bu?", { input: "kisayol" });
  await bosalt();
  await h.besle(s, "result", sonucSatiri());
  return izKaydi(h);
}

const foto = (medya_id: string): EkBilgisi => ({ medya_id, tur: "foto", mime: "image/jpeg", boyut: 1000 });
const video = (medya_id: string): EkBilgisi => ({ medya_id, tur: "video", mime: "video/mp4", boyut: 5000 });

const ornekIcerik = (kullanici_metni: string, fotoAdet: number, videoVar: boolean): MedyaIcerigi =>
  medyaIcerigiKur({
    ekler: [
      ...Array.from({ length: fotoAdet }, (_, i) => ({ tur: "foto" as const, yol: `C:\\ornek\\Yerel\\eren-kit\\medya\\${i + 1}\\asil.jpg`, gorsel: B64 })),
      ...(videoVar
        ? [
            {
              tur: "video" as const,
              yol: "C:\\ornek\\Yerel\\eren-kit\\medya\\9\\asil.mp4",
              sure_ms: 20_000,
              kareler: [
                { zaman_ms: 3333, base64: B64 },
                { zaman_ms: 10_000, base64: B64 },
              ],
              dokum: { var: true as const, metin: "merhaba dünya", kirpildi: false },
            },
          ]
        : []),
    ],
    kullanici_metni,
    cit: () => "c1700000000000aa",
  });

const medyaDurumu = (h: KonusmaDuzeni, medya_id: string): void =>
  h.veriyolu.yayinla("medya_durumu", {
    device_id: "cihaz1",
    sohbet_id: ANA,
    durum: { medya_id, durum: "kabul" } as unknown as MediaStateGovdesi,
  });

/** Ekli mesaj gönderir; bağlanan kuyruk satırı. */
const ekliGonder = (h: KonusmaDuzeni, n: number, text: string, ekler: EkBilgisi[]): number => {
  const m = h.medya;
  if (m === null) throw new Error("altın: medya yok");
  for (const e of ekler) m.ekKoy("cihaz1", ANA, e);
  h.insan(n, text, { ekler });
  const bag = m.cagrilar.son("ekleriBagla");
  if (bag === undefined) throw new Error("altın: ekleriBagla çağrılmadı");
  return bag.args[2] as number;
};

/** (b) Medyalı insan satırı: `bekliyor` tur açmaz, `hazir` olunca tek satırda blok dizisi (text + base64 image). */
async function medyali(): Promise<unknown> {
  const h = await konusmaDuzeni({ takvim: true, medya: true });
  await h.basla();
  const s = h.sonSurec();
  await h.besle(s, "init", initSatiri(s));
  const kuyruk = ekliGonder(h, 1, "Bunlara bak.", [foto("medya_foto1"), video("medya_video1")]);
  await bosalt();
  h.iz.ekle("girdi", "icerik_hazir", kuyruk);
  h.medya!.icerikAyarla(kuyruk, { durum: "hazir", icerik: ornekIcerik("Bunlara bak.", 1, true), gorsel_adet: 3 });
  medyaDurumu(h, "medya_foto1");
  await bosalt();
  await h.besle(s, "result", sonucSatiri());
  return izKaydi(h);
}

/** (b) Sentetik satır (boşta) ve tur sürerken biriken birleşik sentetik satır. */
async function sentetik(): Promise<unknown> {
  const h = await konusmaDuzeni(TAKVIM);
  await h.basla();
  const s = h.sonSurec();
  await h.besle(s, "init", initSatiri(s));
  h.iz.ekle("girdi", "is_bitti");
  h.veriyolu.yayinla("is_bitti", { is_id: 7, plan_id: "plan_1", tur: "pc", durum: "tamam", kirli: false, sohbet_id: ANA });
  await bosalt();
  await h.besle(s, "result", sonucSatiri());
  h.insan(1, "Durum ne?");
  await bosalt();
  h.iz.ekle("girdi", "olaylar_tur_surerken");
  h.veriyolu.yayinla("soru_durumu", { soru_id: "soru_1", is_id: 7, sohbet_id: ANA, durum: "soruldu" });
  h.d.zaman.ilerlet(1000);
  h.veriyolu.yayinla("plan_sonuclandi", { plan_id: "plan_2", sohbet_id: ANA, sonuc: "reddedildi" });
  h.d.zaman.ilerlet(1000);
  h.veriyolu.yayinla("plan_sonuclandi", { plan_id: "plan_3", sohbet_id: ANA, sonuc: "onaylandi", is_id: 8 });
  h.veriyolu.yayinla("is_bitti", { is_id: 8, plan_id: "plan_3", tur: "telefon", durum: "hata", kirli: true, sohbet_id: ANA });
  h.veriyolu.yayinla("isler_uzlastirildi", { sahiplenilen: 1, biten: 2, sohbetler: { [ANA]: { sahiplenilen: 1, biten: 2 } } });
  await bosalt();
  await h.besle(s, "result", sonucSatiri());
  await h.besle(s, "result:birlesik", sonucSatiri());
  return izKaydi(h);
}

/** (b, d) Kesme: `control_request/interrupt`, sonra `aborted_*` → `kesildi`. */
async function kesme(): Promise<unknown> {
  const h = await konusmaDuzeni(TAKVIM);
  await h.basla();
  const s = h.sonSurec();
  await h.besle(s, "init", initSatiri(s));
  h.insan(1, "Uzun bir şey anlat.");
  await bosalt();
  await h.besle(s, "parca", parcaSatiri("Uzun bir cevap "));
  h.iz.ekle("kes", h.konusma.kes());
  h.iz.ekle("kes_yanlis_tur", h.konusma.kes("tur_yok"));
  await bosalt();
  await h.besle(s, "result:kesildi", sonucSatiri({ subtype: "error_during_execution", is_error: true, terminal_reason: "aborted_streaming", result: "" }));
  return izKaydi(h);
}

/** (b, d) Doluluk devri: eşikte devir isteği, özet, aday ve ilk satırı, devir başarısı, eski sürecin kapanışı. */
async function devirDoluluk(toplam: number): Promise<unknown> {
  const h = await konusmaDuzeni(TAKVIM);
  await h.basla();
  const s = h.sonSurec();
  await h.besle(s, "init", initSatiri(s));
  h.insan(1, "Merhaba");
  await bosalt();
  await h.besle(s, "parca", parcaSatiri("Selam. "));
  await h.besle(s, "assistant", asistanSatiri("m1", toplam - 50_000, { cc: 30_000, cr: 20_000 }));
  await h.besle(s, "result", sonucSatiri({ result: "Selam." }));
  h.iz.ekle("devirOzetiAl:yanlis_nesil", h.konusma.devirOzetiAl("yok", 99));
  h.iz.ekle("devirOzetiAl", h.konusma.devirOzetiAl("Özet: kullanıcı selamlaştı.", h.konusma.nesil()));
  await h.besle(s, "result:devir_istegi", sonucSatiri({ result: "özet verildi" }));
  await bosalt();
  const aday = h.sonSurec();
  if (aday !== s) {
    await h.besle(aday, "init:aday", initSatiri(aday));
    await h.besle(aday, "result:aday", sonucSatiri({ result: "devraldım" }));
    await h.ilerlet(5000);
  }
  h.insan(2, "Devam edelim.");
  await bosalt();
  h.iz.ekle("durum", h.konusma.durum(), h.konusma.nesil());
  return izKaydi(h);
}

/** (b) Kurtarma notu: görünür tur sürerken süreç öldü; yeniden başlatmada (`--resume`) ilk satır not. */
async function kurtarma(): Promise<unknown> {
  const h = await konusmaDuzeni(TAKVIM);
  await h.basla();
  const s = h.sonSurec();
  await h.besle(s, "init", initSatiri(s));
  h.insan(1, "Bir şey yap.");
  await bosalt();
  await h.besle(s, "parca", parcaSatiri("Yarım cevap "));
  await h.ilerlet(100);
  h.iz.ekle("girdi", s.pid, "cikis:1");
  s.cik(1);
  await bosalt();
  await h.ilerlet(30_000);
  const yeni = h.sonSurec();
  await h.besle(yeni, "init", initSatiri(yeni));
  await h.besle(yeni, "result", sonucSatiri());
  return izKaydi(h);
}

/** (d) Kimlik reddi: `apiKeySource` "none" değil; tur hata, süreç kapanır, kritik not, otomatik açılış yok. */
async function kimlikReddiIzi(): Promise<unknown> {
  const h = await konusmaDuzeni({});
  await h.basla();
  const s = h.sonSurec();
  h.insan(1, "merhaba");
  await bosalt();
  await h.besle(s, "init:anahtar", initSatiri(s, { apiKeySource: "ANTHROPIC_API_KEY" }));
  h.insan(2, "orada mısın?");
  await h.ilerlet(60_000);
  h.iz.ekle("durum", h.konusma.durum());
  return izKaydi(h);
}

/** (d) Hata devri: iki ardışık hatalı sonuçtan sonra özetsiz aday. */
async function hataDevri(): Promise<unknown> {
  const h = await konusmaDuzeni({});
  await h.basla();
  const s = h.sonSurec();
  await h.besle(s, "init", initSatiri(s));
  h.insan(1, "bir");
  await bosalt();
  await h.besle(s, "result:hata", sonucSatiri({ subtype: "error_during_execution", is_error: true, result: "" }));
  h.insan(2, "iki");
  await bosalt();
  await h.besle(s, "result:hata", sonucSatiri({ subtype: "error_during_execution", is_error: true, result: "" }));
  await bosalt();
  const aday = h.sonSurec();
  if (aday !== s) {
    await h.besle(aday, "init:aday", initSatiri(aday));
    await h.besle(aday, "result:aday", sonucSatiri());
  }
  h.iz.ekle("durum", h.konusma.durum(), h.konusma.nesil());
  return izKaydi(h);
}

/** (d) Görsel bütçesi devri: neslin görseli + satırın görseli sınırı aşınca satırdan önce devir. */
async function gorselButcesiDevri(): Promise<unknown> {
  const h = await konusmaDuzeni({ takvim: true, medya: true });
  await h.basla();
  const s = h.sonSurec();
  await h.besle(s, "init", initSatiri(s));
  h.medya!.nesilGorselleri.set(h.konusma.nesil(), 58);
  const kuyruk = ekliGonder(h, 1, "Üç fotoğraf.", [foto("medya_a"), foto("medya_b"), foto("medya_c")]);
  h.medya!.icerikAyarla(kuyruk, { durum: "hazir", icerik: ornekIcerik("Üç fotoğraf.", 3, false), gorsel_adet: 3 });
  medyaDurumu(h, "medya_a");
  await bosalt();
  h.iz.ekle("devirOzetiAl", h.konusma.devirOzetiAl("Özet: görsel bütçesi.", h.konusma.nesil()));
  await h.besle(s, "result:devir_istegi", sonucSatiri());
  await bosalt();
  const aday = h.sonSurec();
  if (aday !== s) {
    await h.besle(aday, "init:aday", initSatiri(aday));
    await h.besle(aday, "result:aday", sonucSatiri());
    await bosalt();
  }
  h.iz.ekle("durum", h.konusma.durum(), h.konusma.nesil());
  return izKaydi(h);
}

/** (d) Görsel bütçesi sınırları: devir başlıyor mu, satır hangi sürece gitti. */
async function gorselButcesiKarari(onceki: number, adet: number): Promise<unknown> {
  const h = await konusmaDuzeni({ medya: true });
  await h.basla();
  const s = h.sonSurec();
  await h.besle(s, "init", initSatiri(s));
  h.medya!.nesilGorselleri.set(h.konusma.nesil(), onceki);
  const kuyruk = ekliGonder(h, 1, "Fotoğraf.", [foto("medya_a")]);
  // `gorsel_adet` yöneticinin beyanıdır; burada blok sayısından bağımsız (karar yalnız sayıya bakar).
  h.medya!.icerikAyarla(kuyruk, { durum: "hazir", icerik: ornekIcerik("Fotoğraf.", 1, false), gorsel_adet: adet });
  medyaDurumu(h, "medya_a");
  await bosalt();
  const satirlar = s.yazilanlar.map((x) => JSON.parse(x) as { isSynthetic?: boolean; message: { content: unknown } });
  return normallestir({
    onceki,
    adet,
    sinir: h.ayar.medya?.sinirlar.gorselNesilSiniri ?? null,
    devir_istegi: satirlar.some((l) => l.isSynthetic === true),
    ekli_satir_yazildi: satirlar.some((l) => Array.isArray(l.message.content)),
    nesil_gorsel: h.medya!.nesilGorselleri.get(h.konusma.nesil()) ?? 0,
  });
}

// ---------------------------------------------------------------------------------------------
// (d) Karar tabloları
// ---------------------------------------------------------------------------------------------

const akis = akisKur();
const sonucOlayi = (o: Record<string, unknown>): Extract<AkisOlayi, { tur: "result" }> => {
  const r = akis.satirCoz(JSON.stringify({ type: "result", ...o }));
  if (r === null || r.tur !== "result") throw new Error("altın: result çözülmedi");
  return r;
};

async function kimlikTablosu(): Promise<unknown> {
  const satirlar: unknown[] = [];
  for (const kaynak of ["none", "ANTHROPIC_API_KEY", "apiKeyHelper", "/login managed key", "", null, "yok"] as const) {
    const h = await konusmaDuzeni({});
    await h.basla();
    const s = h.sonSurec();
    const init = initSatiri(s);
    if (kaynak === null) init["apiKeySource"] = null;
    else if (kaynak === "yok") delete init["apiKeySource"];
    else init["apiKeySource"] = kaynak;
    s.stdoutSatiriGonder(JSON.stringify(init));
    await bosalt();
    const red = h.depo.olaylariGetir(0, 1000).some((o) => o.type === "system_notice" && o.seviye === "kritik");
    satirlar.push({ apiKeySource: kaynak === "yok" ? "<alan yok>" : kaynak, kabul: !red, durum: h.konusma.durum() });
  }
  return satirlar;
}

function kararTablolari(): Record<string, unknown> {
  const sinif = [
    { terminal_reason: "completed", is_error: false },
    { terminal_reason: "completed", is_error: true },
    { terminal_reason: "aborted_streaming", is_error: false },
    { terminal_reason: "aborted_tools", is_error: true },
    { terminal_reason: "max_turns", is_error: true },
    { terminal_reason: null, is_error: false },
    { terminal_reason: null, is_error: true },
    { terminal_reason: "completed", is_error: "evet" },
    { terminal_reason: "completed" },
  ].map((g) => ({ girdi: g, sinif: akis.turSonucuSinifla(sonucOlayi(g)), is_error: sonucOlayi(g).is_error }));
  const esik = [1, 100_000, 200_000, 399_999, 400_000, 1_000_000].map((pencere) => ({ pencere, esik: akis.devirEsigi(pencere) }));
  const doluluk = [
    { input_tokens: 150_000, cache_creation_input_tokens: 30_000, cache_read_input_tokens: 20_000 },
    { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  ].map((k) => ({ kullanim: k, dolu: akis.dolulukHesapla(k) }));
  const pencereGirdileri: Array<{ pencereler: Record<string, number>; model: string | null }> = [
    { pencereler: {}, model: MODEL },
    { pencereler: { [MODEL]: 200_000 }, model: MODEL },
    { pencereler: { [`${MODEL}[1m]`]: 1_000_000, "claude-haiku-ornek": 200_000 }, model: MODEL },
    { pencereler: { "claude-opus": 500_000 }, model: `${MODEL}-uzun` },
    { pencereler: { a: 300_000, b: 100_000 }, model: null },
    { pencereler: { a: 300_000, b: 100_000 }, model: "" },
    { pencereler: { a: 300_000, b: 100_000 }, model: "c" },
    { pencereler: { a: 0, b: -5, c: 50_000 }, model: "a" },
  ];
  const pencere = pencereGirdileri.map((g) => ({ ...g, secilen: akis.pencereSec(g.pencereler, g.model) }));
  const araclar = [
    "PowerShell",
    "Bash",
    "Read",
    "Edit",
    "Write",
    "Glob",
    "Grep",
    "WebFetch",
    "WebSearch",
    "NotebookEdit",
    "Task",
    "mcp__eren__plan_oner",
    "mcp__eren__rapor_oku",
    "mcp__eren-ajanda__ajanda_ekle",
    "mcp__computer-use-windows__screenshot",
    "",
  ].map((ad) => ({ ad, kategori: aracKategorisi(ad) }));
  return { tur_sinifi: sinif, devir_esigi: esik, doluluk, pencere_secimi: pencere, arac_kategorisi: araclar };
}

// ---------------------------------------------------------------------------------------------
// (e) İşler
// ---------------------------------------------------------------------------------------------

const RAPOR = { yapildi: ["Birinci is yapildi"], yapilmadi: [], dosyalar: ["C:\\ornek\\proje\\a.txt"], acik_noktalar: [] };

const pcPlan = (ek: Record<string, unknown> = {}) =>
  ({
    plan_id: "plan_pc1",
    baslik: "Ornek is",
    tur: "pc",
    cwd: "C:\\ornek\\proje",
    gorev_metni: "Ornek gorev metni, cok satirli\nikinci satir ş ğ ü.",
    ...ek,
  }) as unknown as Parameters<IslerDuzeni["baslat"]>[0];

const telPlan = () =>
  ({
    plan_id: "plan_tel1",
    baslik: "Telefon isi",
    tur: "telefon",
    cwd: "",
    gorev_metni: "Telefonda ornek bir sey oku.",
    telefon_izin_istegi: { uygulamalar: ["com.ornek.uygulama"], mod: "oku" },
  }) as unknown as Parameters<IslerDuzeni["baslat"]>[0];

async function isKomutu(
  sec: Parameters<typeof islerDuzeni>[0],
  plan: Parameters<IslerDuzeni["baslat"]>[0],
  profil: "tam" | "hafif",
  uzun: UzunMetinler,
): Promise<unknown> {
  const h = await islerDuzeni(sec);
  const id = await h.baslat(plan, profil);
  const b = h.baslatmalar[0];
  if (b === undefined) throw new Error("altın: iş süreci başlamadı");
  const y = h.ayar.isYollari(id);
  const mcp = h.d.dosya.icerik(y.mcp);
  return normallestir(
    {
      secenek: { ...sec, profil },
      istek: { ...b.istek, argv: b.istek.argv.map((a) => uzun.ref(a)) },
      mcp_json: mcp === null ? null : jsonKaydi(mcp),
      gorev_txt: h.d.dosya.icerik(y.gorev),
      iz: h.iz.girdiler,
    },
    h.yt,
  );
}

const isInit = (h: IslerDuzeni, id: number, sunucular: Array<{ name: string; status: string }>) => ({
  type: "system",
  subtype: "init",
  session_id: h.depo.isGetir(id)?.session_id,
  tools: ["Bash", "Read"],
  mcp_servers: sunucular,
  apiKeySource: "none",
  model: "claude-ornek",
});

async function pcAkisi(): Promise<unknown> {
  const h = await islerDuzeni({});
  const id = await h.baslat(pcPlan(), "tam");
  const session_id = h.depo.isGetir(id)?.session_id;
  h.outEkle(
    id,
    "init+hook+assistant+rate_limit",
    isInit(h, id, [{ name: "computer-use-windows", status: "connected" }]),
    { type: "system", subtype: "hook_response", output: "" },
    asistanSatiri("m1", 100),
    { type: "rate_limit_event", rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.5, resetsAt: SIFIRLAMA_SN } } } },
  );
  await h.yokla();
  // Yarım satır (satır sonu yok): ofsete girmez, sonraki okumada baştan gelir.
  h.iz.ekle("girdi", "out", "yarim_satir");
  h.d.dosya.ekle(h.ayar.isYollari(id).out, '{"type":"result","subtype":"suc');
  await h.yokla();
  h.outEkle(
    id,
    "result_sonu+raporsuz_result",
    'cess","is_error":false,"result":"Is bitti.","terminal_reason":"completed","session_id":"' +
      String(session_id) +
      '","structured_output":' +
      JSON.stringify(RAPOR) +
      ',"usage":{"input_tokens":10,"cache_creation_input_tokens":1,"cache_read_input_tokens":2,"output_tokens":3},"model_usage_since_last_result":{"claude-ornek":{"inputTokens":10,"outputTokens":3,"cacheReadInputTokens":2,"cacheCreationInputTokens":1,"costUSD":0.01}}}',
    { type: "result", subtype: "success", is_error: false, result: "", num_turns: 0, terminal_reason: "completed", session_id },
  );
  await h.yokla();
  h.iz.ekle("girdi", "cikis:0");
  h.surecOf(id).cik(0);
  await h.yokla();
  h.iz.ekle("son", h.depo.isGetir(id));
  return izKaydi(h);
}

async function telefonKoprusuz(): Promise<unknown> {
  const h = await islerDuzeni({});
  const id = await h.baslat(telPlan(), "tam");
  h.outEkle(id, "init:eren-telefon_failed", isInit(h, id, [{ name: "eren-telefon", status: "failed" }]));
  await h.yokla();
  await h.yokla();
  h.iz.ekle("son", h.depo.isGetir(id));
  return izKaydi(h);
}

async function telefonHataSonucu(): Promise<unknown> {
  const h = await islerDuzeni({});
  const id = await h.baslat(telPlan(), "tam");
  h.outEkle(
    id,
    "init+limitli_hata_sonucu",
    isInit(h, id, [{ name: "eren-telefon", status: "connected" }]),
    { type: "result", subtype: "error_during_execution", is_error: true, result: "Limit doldu", terminal_reason: "completed", structured_output: null },
  );
  await h.yokla();
  h.iz.ekle("girdi", "cikis:1");
  h.surecOf(id).cik(1);
  await h.yokla();
  h.iz.ekle("son", h.depo.isGetir(id));
  return izKaydi(h);
}

// ---------------------------------------------------------------------------------------------
// (f) Medya sınırları
// ---------------------------------------------------------------------------------------------

async function medyaKaydi(): Promise<Record<string, unknown>> {
  const h = await konusmaDuzeni({ medya: true });
  const s = h.ayar.medya?.sinirlar;
  if (s === undefined || s === null) throw new Error("altın: medya ayarı yok");
  const sinirlar: MedyaServisSinirlari = s;
  const boyutlar = [
    [4032, 3024],
    [3024, 4032],
    [1568, 1000],
    [1200, 900],
    [8000, 1000],
    [1000, 8000],
    [1, 1],
  ].map(([w, hh]) => ({
    girdi: [w, hh],
    gorsel: olcekBoyutu(w!, hh!, sinirlar.gorselUzunKenar, sinirlar.gorselPiksel),
    kare: olcekBoyutu(w!, hh!, sinirlar.kareUzunKenar, null),
  }));
  return normallestir({
    sinirlar,
    medya_ayari: { ...h.ayar.medya, sinirlar: "<yukarıda>" },
    gorsel_argv: gorselArgv("medya/1/asil.jpg", "medya/1/gorsel.jpg", "jpg", sinirlar),
    gorsel_argv_heic: gorselArgv("medya/2/asil.heic", "medya/2/gorsel.jpg", "heic", sinirlar),
    kare_argv: kareArgv("medya/3/asil.mp4", "medya/3/kare-01.jpg", "mp4", 3333, sinirlar),
    olcek_boyutlari: boyutlar,
    ekli_icerik: ornekIcerik("Bunlara bak.", 1, true),
    ekli_icerik_bos_metin: ornekIcerik("  ", 1, false),
  }) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------------------------
// (plan f) Çözücü
// ---------------------------------------------------------------------------------------------

const COZUCU_GIRDILERI: Array<[string, string]> = [
  ["init_tam", JSON.stringify({ type: "system", subtype: "init", session_id: "s1", tools: ["Read", 5, "mcp__eren__plan_oner"], mcp_servers: [{ name: "eren", status: "connected" }, { name: "x" }, { status: "y" }, 3], apiKeySource: "none", model: MODEL })],
  ["init_eksik", JSON.stringify({ type: "system", subtype: "init" })],
  ["hook_response", JSON.stringify({ type: "system", subtype: "hook_response", output: "çıktı" })],
  ["hook_response_ciktisiz", JSON.stringify({ type: "system", subtype: "hook_response" })],
  ["system_diger", JSON.stringify({ type: "system", subtype: "compact_boundary" })],
  ["assistant_tam", JSON.stringify(asistanSatiri("m1", 10, { cc: 2, cr: 3, icerik: [{ type: "text", text: "a" }, { type: "tool_use", id: "t1", name: "Read" }, { type: "tool_use", id: 5, name: "X" }] }))],
  ["assistant_alt_ajan", JSON.stringify(asistanSatiri("m2", 10, { ebeveyn: "t1", icerik: [{ type: "tool_use", id: "t2", name: "Read" }] }))],
  ["assistant_mesajsiz", JSON.stringify({ type: "assistant" })],
  ["assistant_kullanimsiz", JSON.stringify({ type: "assistant", message: { id: "m3", model: MODEL, usage: { input_tokens: "x" } } })],
  ["user_tool_result", JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1" }, { type: "tool_result" }, { type: "text", text: "x" }] } })],
  ["user_replay", JSON.stringify({ type: "user", isReplay: true, message: { content: [{ type: "tool_result", tool_use_id: "t1" }] } })],
  ["user_alt_ajan", JSON.stringify({ type: "user", parent_tool_use_id: "t9", message: { content: [{ type: "tool_result", tool_use_id: "t1" }] } })],
  ["user_duz_metin", JSON.stringify({ type: "user", message: { content: "merhaba" } })],
  ["stream_text_delta", JSON.stringify(parcaSatiri("parça"))],
  ["stream_alt_ajan", JSON.stringify({ ...parcaSatiri("x"), parent_tool_use_id: "t1" })],
  ["stream_message_start", JSON.stringify({ type: "stream_event", event: { type: "message_start" } })],
  ["stream_blok_thinking", JSON.stringify({ type: "stream_event", event: { type: "content_block_start", content_block: { type: "thinking" } } })],
  ["stream_blok_redacted", JSON.stringify({ type: "stream_event", event: { type: "content_block_start", content_block: { type: "redacted_thinking" } } })],
  ["stream_blok_text", JSON.stringify({ type: "stream_event", event: { type: "content_block_start", content_block: { type: "text" } } })],
  ["stream_blok_tool_use", JSON.stringify({ type: "stream_event", event: { type: "content_block_start", content_block: { type: "tool_use", id: "t1", name: "Bash" } } })],
  ["stream_blok_tool_use_bozuk", JSON.stringify({ type: "stream_event", event: { type: "content_block_start", content_block: { type: "tool_use", id: "t1" } } })],
  ["stream_blok_bilinmeyen", JSON.stringify({ type: "stream_event", event: { type: "content_block_start", content_block: { type: "server_tool_use" } } })],
  ["stream_input_json_delta", JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "input_json_delta", partial_json: "{" } } })],
  ["stream_message_stop", JSON.stringify({ type: "stream_event", event: { type: "message_stop" } })],
  ["rate_limit_tam", JSON.stringify({ type: "rate_limit_event", rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.25, resetsAt: SIFIRLAMA_SN }, seven_day: { utilization: 1 } } } })],
  ["rate_limit_bos", JSON.stringify({ type: "rate_limit_event" })],
  ["rate_limit_bozuk", JSON.stringify({ type: "rate_limit_event", rate_limit_info: { unifiedWindows: { five_hour: { utilization: "%50" } } } })],
  [
    "result_tam",
    JSON.stringify(
      sonucSatiri({
        structured_output: RAPOR,
        model_usage_since_last_result: { [MODEL]: { inputTokens: 5.7, outputTokens: -1, cacheReadInputTokens: 1e300, cacheCreationInputTokens: "x", costUSD: -1 }, bozuk: 3 },
      }),
    ),
  ],
  ["result_is_error_yok", JSON.stringify({ type: "result", result: 5, modelUsage: { a: { contextWindow: 0 }, b: 3 } })],
  ["result_usage_bos", JSON.stringify({ type: "result", is_error: false, model_usage_since_last_result: {}, usage: null })],
  ["control_response", JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: "r1" } })],
  ["control_response_hata", JSON.stringify({ type: "control_response", response: { subtype: "error" } })],
  ["control_response_bos", JSON.stringify({ type: "control_response" })],
  ["bilinmeyen_tur", JSON.stringify({ type: "keep_alive" })],
  ["tursuz", JSON.stringify({ x: 1 })],
  ["bom_ve_bosluk", `\uFEFF  ${JSON.stringify({ type: "keep_alive" })}  `],
  ["bos", "   "],
  ["bozuk_json", '{"type":'],
  ["dizi", "[1,2]"],
  ["sayi", "5"],
];

function cozucuKaydi(): Record<string, unknown> {
  const satirlar = COZUCU_GIRDILERI.map(([etiket, satir]) => ({ etiket, satir, olay: akis.satirCoz(satir) }));
  const ayirici = akis.satirAyirici();
  const enc = new TextEncoder();
  const ornekler = ["a\nb\r\nc", "\n\nş\n", "yarım", "x\r\n\r\ny\n"].map((m) => ({ girdi: m, ...ayirici.ayir(enc.encode(m)) }));
  return normallestir({ satirlar, satir_ayirici: ornekler }) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------------------------
// Testler
// ---------------------------------------------------------------------------------------------

describe("surucu-altin: H4.0 altın kayıtları (Claude, bugünkü davranış)", () => {
  it("(a) ana oturum başlatma: exe, argv, cwd, ortam, nesil mcp dosyası", async () => {
    const senaryolar: Record<string, unknown> = {};
    const uzun = new UzunMetinler();
    for (const [ad, v] of Object.entries(BASLATMA)) senaryolar[ad] = await baslatmaKaydi(v.sec, v.devam, uzun);
    senaryolar["uzun_metinler"] = normallestir(uzun.tablo);
    altinDenetle("baslatma", { aciklama: "Ana oturum süreç isteği ve nesil mcp dosyası (H4.2 bayt bayt korur)." }, senaryolar);
  });

  it("(b, c, d) konuşma: stdin satırları, akış senaryosu, devir/kurtarma/kimlik/görsel bütçesi izleri", async () => {
    const senaryolar: Record<string, unknown> = {
      akis_turu: await akisTuru(),
      insan_takvimsiz: await insanTakvimsiz(),
      kisayol: await kisayol(),
      medyali: await medyali(),
      sentetik_ve_birlesik: await sentetik(),
      kesme: await kesme(),
      devir_doluluk_esikte: await devirDoluluk(200_000),
      devir_doluluk_esik_alti: await devirDoluluk(199_999),
      kurtarma_notu: await kurtarma(),
      kimlik_reddi: await kimlikReddiIzi(),
      hata_devri: await hataDevri(),
      gorsel_butcesi_devri: await gorselButcesiDevri(),
    };
    altinDenetle(
      "konusma",
      { aciklama: "Konuşma izleri: süreç, stdin, veriyolu yayını, depo yazımı (işlem sınırlarıyla), dosya, jeton (H4.3, H4.4)." },
      senaryolar,
    );
  });

  it("(d) kararlar: apiKeySource, tur sınıfı, devir eşiği, doluluk, pencereSec, araç kategorisi, görsel bütçesi", async () => {
    const senaryolar: Record<string, unknown> = {
      kimlik_kabulu: await kimlikTablosu(),
      ...kararTablolari(),
      gorsel_butcesi: [
        await gorselButcesiKarari(58, 3),
        await gorselButcesiKarari(58, 2),
        await gorselButcesiKarari(0, 61),
        await gorselButcesiKarari(60, 1),
      ],
    };
    altinDenetle("kararlar", { aciklama: "Claude'a özgü kararların girdi → sonuç tabloları (H4.1, H4.4)." }, senaryolar);
  });

  it("(e) işler: PC/telefon süreç isteği, mcp.json, gorev.txt, out.jsonl akışı", async () => {
    const uzun = new UzunMetinler();
    const senaryolar: Record<string, unknown> = {
      pc_tam: await isKomutu({}, pcPlan(), "tam", uzun),
      pc_tam_model: await isKomutu({ yerel: { pc_is_modeli: "opus-ornek" } }, pcPlan(), "tam", uzun),
      pc_hafif: await isKomutu({ yerel: { pc_is_modeli: "opus-ornek" } }, pcPlan(), "hafif", uzun),
      pc_rea_cu_yok: await isKomutu({ computerUse: false }, pcPlan({ mcp_profili: "rea", gorev_metni: "-tire ile başlayan görev" }), "tam", uzun),
      telefon: await isKomutu({ yerel: { telefon_is_modeli: "sonnet-ornek" } }, telPlan(), "tam", uzun),
      pc_akisi: await pcAkisi(),
      telefon_koprusuz: await telefonKoprusuz(),
      telefon_hata_sonucu: await telefonHataSonucu(),
    };
    senaryolar["uzun_metinler"] = normallestir(uzun.tablo);
    altinDenetle("isler", { aciklama: "İş oturumları: komut, ortam, dosyalar ve out.jsonl çözümünün depo/yayın izi (H4.2, H4.5)." }, senaryolar);
  });

  it("(f) medya sınırları: değerler, ölçek argv'si ve boyutları, ekli satır blokları", async () => {
    altinDenetle("medya", { aciklama: "Claude görsel girdisine göre seçilen medya sınırları ve görsel hazırlığı (sürücü yeteneği adayı)." }, await medyaKaydi());
  });

  it("(plan f) çözücü: stream-json satırı → AkisOlayi, satır ayırıcı", () => {
    altinDenetle("cozucu", { aciklama: "akis.satirCoz ve satirAyirici; H4.1 olayCoz eşlemesinin girdisi." }, cozucuKaydi());
  });
});
