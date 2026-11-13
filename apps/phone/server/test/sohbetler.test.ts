/**
 * `sohbetler` modülü (Dilim 2): MODULLER.md "Dilim 2" > "sohbetler" maddesinin Bitti'si ve "Sırayla
 * akışlar" 1-5, 10. Gerçek `konusma` yok: `konusmaKur` yerine bu dosyadaki örnek sahtesi (`sahteOrnek`)
 * verilir; depo gerçek (`depoKur`, `:memory:`), zaman/sistem/süreç `sahte.ts`'ten.
 *
 * Örnek sahtesi `Konusma` sözleşmesini (sozlesme.ts) taklit eder: `uyandir` kapıyı EŞZAMANLI sorar;
 * `true` → `baslatiliyor` (test `hazirOl()` ile bitirir); `uyut` boştaysa hemen (bir mikro görevde, süreç
 * çıkışı gibi), tur/başlatma sürüyorsa o bitince ve SIRADAKİ KUYRUK SATIRI AÇILMADAN kapanır; kapanınca
 * `yuvaBirak`, kuyruk doluysa yeniden yuva ister. Beklentiler belgeden yazıldı; üretim koduna uydurulmadı.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { ANA_SOHBET_ID, SOHBET_SINIRLARI, SohbetDurumlari } from "@eren/protocol";
import type { Olay } from "@eren/protocol";
import { depoKur } from "../src/depo.ts";
import { sohbetlerKur } from "../src/sohbetler.ts";
import { veriyoluKur } from "../src/veriyolu.ts";
import type {
  AkisYardimcilari,
  AktifTur,
  Ayar,
  Depo,
  ErenKopruBaglami,
  Konusma,
  KonusmaBagimliliklari,
  KonusmaFabrikasi,
  NesilKaydi,
  ServisOlaylari,
  SohbetErenDurumuTipi,
  SohbetYoneticisi,
} from "../src/sozlesme.ts";
import { sahteDunya } from "./sahte.ts";
import type { SahteDunya } from "./sahte.ts";

// ---------------------------------------------------------------------------------------------
// Donanım
// ---------------------------------------------------------------------------------------------

const DK = 60_000;
const RAM_DUSUK_MB = 1000;
/** `ramDusukMb + RAM_KAPISI_PAYI_MB (768)`: bunun altı düşük. */
const RAM_ESIGI = RAM_DUSUK_MB + 768;
const RAM_YOKLAMA_MS = 30_000;

const bekle = (): Promise<void> => new Promise((r) => setImmediate(r));
const s = (sohbet_id: string) => ({ sohbet_id });

const sahteAyar = (azami: number, bostaDk: number, asistanAdi = "Claude"): Ayar =>
  ({
    yollar: {
      kok: "C:\\ornek\\eren-kit",
      vt: "C:\\ornek\\eren-kit\\eren.db",
      log: "C:\\ornek\\eren-kit\\logs\\servis.log",
      islerDizini: "C:\\ornek\\eren-kit\\isler",
      erenCwd: "C:\\ornek\\eren-kit\\eren-cwd",
      erenMcpDizini: "C:\\ornek\\eren-kit\\eren-mcp",
      anahtar: "C:\\ornek\\eren-kit\\sunucu-anahtar.pem",
      kimlikEki: "C:\\ornek\\eren-kit\\kimlik.local.md",
      projeler: "C:\\ornek\\eren-kit\\projeler.json",
      yerelAyar: "C:\\ornek\\eren-kit\\ayar.local.json",
      limitKilit: "C:\\ornek\\ClaudeLimitKilit\\kilit.json",
      claudeProjeleri: "C:\\ornek\\kullanici\\.claude\\projects",
    },
    erenMcpYolu: (nesil: number) => `C:\\ornek\\eren-kit\\eren-mcp\\${nesil}.json`,
    erenCanliAzami: azami,
    erenBostaKapatMs: bostaDk * DK,
    ramDusukMb: RAM_DUSUK_MB,
    servis: { surum: null, baslangic_ms: 1_700_000_000_000 },
    computerUse: null,
    claudeExe: "C:\\ornek\\npm\\claude.exe",
    nodeExe: "C:\\ornek\\node\\node.exe",
    kopruBetigi: "C:\\ornek\\eren-kit\\src\\kopru.ts",
    erenModeli: "opus",
    kullaniciAdi: "Ornek",
    asistanAdi,
    sureler: {
      kilitYoklamaMs: 5000,
      torunYoklamaMs: 10000,
      isYoklamaMs: 2000,
      ramYoklamaMs: RAM_YOKLAMA_MS,
      soruZamanAsimiMs: 82_800_000,
      devirOzetiBeklemeMs: 120_000,
      deltaTamponMs: 80,
      bildirimAckMs: 30000,
      komutPayiMs: 15000,
      erenYenidenBaslatmaMs: 30000,
    },
  }) as unknown as Ayar;

// ---------------------------------------------------------------------------------------------
// Örnek sahtesi
// ---------------------------------------------------------------------------------------------

interface SahteOrnek extends Konusma {
  readonly b: KonusmaBagimliliklari;
  surec: "yok" | "baslatiliyor" | "hazir";
  tur: boolean;
  /** Bekleyen kullanıcı satırları (depo kuyruğu kimlikleri). */
  kuyruk: number[];
  uyutIstendi: boolean;
  /** Kapıdan `true` aldı ve henüz `yuvaBirak` demedi. */
  yuvada: boolean;
  sirada: boolean;
  /** `true`: `uyandir` kapıyı sormaz (kilit serbest değil). */
  kilitli: boolean;
  kapatildi: boolean;
  /** Test zorlaması: `bostaBeri` bunu döner (`undefined` ise hesaplanır). */
  bostaZorla: number | null | undefined;
  nesilDegeri: number;
  insanTuruDegeri: string | null;
  aktifTurDegeri: AktifTur | null;
  devirCagrilari: Array<{ ozet: string; nesil: number }>;
  /** Kapı cevapları, sırayla. */
  cevaplar: boolean[];
  acilisSayisi: number;
  turSayisi: number;
  uyutSayisi: number;
  uyandirSayisi: number;
  /** Kurulduğu andan beri dinlediği, kendi `sohbet_id`'li `is_bitti` yükleri (gerçek örnek gibi). */
  isBittiler: Array<ServisOlaylari["is_bitti"]>;
  /** Kendi girdisi olan `isler_uzlastirildi` yükleri. */
  uzlastirmalar: Array<ServisOlaylari["isler_uzlastirildi"]>;
  /** `uyandir` kapıyı sormadan hemen önce (araya giren istek denemesi için). */
  uyandirOncesi: (() => void) | null;
  /** Kullanıcı mesajı geldi: etkinlik + kuyruk; süreç yoksa `uyandir()`, hazır ve boştaysa tur başlar. */
  mesaj(): void;
  /** Süren başlatma bitti. */
  hazirOl(): void;
  /** Süren tur bitti. */
  turBitir(): void;
}

interface Duzen {
  d: SahteDunya;
  depo: Depo;
  veriyolu: ReturnType<typeof veriyoluKur>;
  y: SohbetYoneticisi;
  azami: number;
  /** Son kurulan örnek, kimliğe göre. */
  ornekler: Map<string, SahteOrnek>;
  /** `konusmaKur` çağrılarının sohbet kimlikleri, sırayla. */
  kurulumlar: string[];
  /** Ortak sıra defteri: `erenJetonlariniSil`, `kur:X`, `baslat:X`, `baslatBitti:X`, `uyandir:X`, `uyut:X`, `kapat:X`. */
  sira: string[];
  listeOlaylari: Array<ServisOlaylari["sohbet_listesi_degisti"]>;
  /** Yuva sınırı ihlalleri (kapı `true` verdiğinde yuvada olanların sayısı). */
  ihlaller: string[];
  o(id: string): SahteOrnek;
  yuvadakiler(): string[];
}

function kur(
  sec: {
    azami?: number;
    bostaDk?: number;
    hazirla?: (depo: Depo, d: SahteDunya) => void;
    /** `Ayar.asistanAdi`; verilmezse "Claude". */
    asistanAdi?: string;
    /** Yöneticiye verilen depoyu sarar (gerçek depo `h.depo`'da kalır). */
    depoSar?: (depo: Depo) => Depo;
  } = {},
): Duzen {
  const azami = sec.azami ?? 2;
  const d = sahteDunya();
  const veriyolu = veriyoluKur({ gunluk: d.gunluk });
  const depo = depoKur({ yol: ":memory:", saat: d.saat, veriyolu, gunluk: d.gunluk });
  sec.hazirla?.(depo, d);
  const ornekler = new Map<string, SahteOrnek>();
  const kurulumlar: string[] = [];
  const sira: string[] = [];
  const ihlaller: string[] = [];
  const yuvadakiler = (): string[] => [...ornekler.values()].filter((o) => o.yuvada).map((o) => o.sohbet_id);

  const sahteOrnek = (b: KonusmaBagimliliklari): SahteOrnek => {
    const id = b.sohbet_id;
    let baslatBitti = false;
    let bekleyenUyandir = false;
    let bostaSince: number | null = null;
    let uyutBekleyenler: Array<() => void> = [];
    let turNo = 0;
    let sonYayilan: SohbetErenDurumuTipi | null = null;
    /** Sözleşme: her durum değişiminde `eren_durumu{sohbet_id, durum}`. */
    const yay = (): void => {
      const durum = o.durum();
      if (durum === sonYayilan) return;
      sonYayilan = durum;
      b.veriyolu.yayinla("eren_durumu", { sohbet_id: id, durum });
    };

    const turBasla = (): void => {
      const satir = o.kuyruk.shift();
      if (satir !== undefined) depo.kuyruktanSil([satir]);
      o.tur = true;
      o.turSayisi++;
      turNo++;
      bostaSince = null;
      b.veriyolu.yayinla("tur_basladi", { sohbet_id: id, turn_id: `${id}-t${turNo}` });
      yay();
    };
    const kapan = (): void => {
      if (o.surec === "yok") return;
      o.surec = "yok";
      o.tur = false;
      o.uyutIstendi = false;
      bostaSince = null;
      o.yuvada = false;
      yay();
      b.kapi.yuvaBirak(s(id));
      const l = uyutBekleyenler;
      uyutBekleyenler = [];
      for (const f of l) f();
      // Sözleşme (`uyut`): kapandıktan sonra kuyruk doluysa yeniden yuva ister.
      if (o.kuyruk.length > 0) o.uyandir();
    };

    const o: SahteOrnek = {
      b,
      sohbet_id: id,
      surec: "yok",
      tur: false,
      kuyruk: [],
      uyutIstendi: false,
      yuvada: false,
      sirada: false,
      kilitli: false,
      kapatildi: false,
      bostaZorla: undefined,
      nesilDegeri: 0,
      insanTuruDegeri: null,
      aktifTurDegeri: null,
      devirCagrilari: [],
      cevaplar: [],
      acilisSayisi: 0,
      turSayisi: 0,
      uyutSayisi: 0,
      uyandirSayisi: 0,
      uyandirOncesi: null,
      isBittiler: [],
      uzlastirmalar: [],

      async baslat() {
        sira.push(`baslat:${id}`);
        // Kurtarma yalnız okuma: kuyruktaki satır örneğin kuyruğudur. Süreç AÇMAZ, kapıyı sormaz.
        const bas = depo.kuyrukBasi(s(id));
        if (bas !== null && !o.kuyruk.includes(bas.id)) o.kuyruk.push(bas.id);
        await Promise.resolve();
        baslatBitti = true;
        sira.push(`baslatBitti:${id}`);
        if (bekleyenUyandir) {
          bekleyenUyandir = false;
          o.uyandir();
        }
      },
      uyandir() {
        o.uyandirSayisi++;
        sira.push(`uyandir:${id}`);
        if (o.kapatildi || o.kilitli || o.surec !== "yok") return;
        if (!baslatBitti) {
          bekleyenUyandir = true;
          return;
        }
        o.uyandirOncesi?.();
        const cevap = b.kapi.yuvaIste(s(id));
        o.cevaplar.push(cevap);
        if (cevap) {
          o.yuvada = true;
          o.sirada = false;
          o.surec = "baslatiliyor";
          o.acilisSayisi++;
          yay();
          const n = yuvadakiler().length;
          if (n > azami) ihlaller.push(`${id} açıldı, yuvada ${n} > ${azami}: ${yuvadakiler().join(",")}`);
        } else {
          o.sirada = true;
          yay();
        }
      },
      uyut() {
        o.uyutSayisi++;
        sira.push(`uyut:${id}`);
        if (o.surec === "yok") return Promise.resolve();
        return new Promise<void>((coz) => {
          uyutBekleyenler.push(coz);
          if (o.surec === "hazir" && !o.tur) {
            // Boşta: hemen, süreç çıkışı gibi bir sonraki mikro görevde.
            queueMicrotask(kapan);
          } else {
            o.uyutIstendi = true;
          }
        });
      },
      bostaBeri() {
        if (o.bostaZorla !== undefined) return o.bostaZorla;
        return o.surec === "hazir" && !o.tur && o.kuyruk.length === 0 && !o.uyutIstendi ? bostaSince : null;
      },
      durum(): SohbetErenDurumuTipi {
        if (o.kapatildi) return "kapali";
        if (o.surec === "yok") return o.sirada ? "sirada" : "uyuyor";
        if (o.surec === "baslatiliyor") return "baslatiliyor";
        return o.tur ? "tur_suruyor" : "hazir";
      },
      aktifTur: () => o.aktifTurDegeri,
      nesil: () => o.nesilDegeri,
      insanTuru: () => o.insanTuruDegeri,
      insanMesajiAl: () => {
        throw new Error("sahte örnek: sohbetler bu yöntemi çağırmamalı");
      },
      kes: () => ({ ok: true, deger: undefined }),
      devirOzetiAl(ozet, nesil) {
        o.devirCagrilari.push({ ozet, nesil });
        return { kabul: true };
      },
      temizlenebilirMi: () => !o.tur,
      async yeniSayfa() {
        sira.push(`yeniSayfa:${id}`);
        // Sözleşme: temizlik kuyruğu sildi (`gecmisiTemizle`); süreci olmayan örnek yuva beklemez (`sirada`
        // biter, `eren_durumu` yayınlanır), kuyruk yeniden dolarsa yeniden ister.
        if (depo.kuyrukBasi(s(id)) === null) o.kuyruk = [];
        if (o.surec === "yok" && o.sirada) {
          o.sirada = false;
          yay();
          if (o.kuyruk.length > 0) o.uyandir();
        }
        await Promise.resolve();
        return { eski_oturumlar: [], eski_surec_cikti: true, yeni_nesil_acildi: false };
      },
      sonlandir: async () => ({ eski_oturumlar: [], eski_surec_cikti: true }),
      async kapat() {
        sira.push(`kapat:${id}`);
        o.kapatildi = true;
        yay();
      },

      mesaj() {
        const simdi = d.zaman.simdi();
        depo.sohbetEtkinlikYaz(s(id), simdi);
        o.kuyruk.push(depo.kuyrugaEkle("insan", "ileti", simdi, s(id)));
        if (o.surec === "yok") o.uyandir();
        else if (o.surec === "hazir" && !o.tur && !o.uyutIstendi) turBasla();
      },
      hazirOl() {
        assert.equal(o.surec, "baslatiliyor", `${id}: başlatma yok`);
        o.surec = "hazir";
        bostaSince = d.zaman.simdi();
        yay();
        if (o.uyutIstendi) kapan();
        else if (o.kuyruk.length > 0) turBasla();
      },
      turBitir() {
        assert.equal(o.tur, true, `${id}: tur yok`);
        o.tur = false;
        bostaSince = d.zaman.simdi();
        b.veriyolu.yayinla("tur_bitti", { sohbet_id: id, turn_id: `${id}-t${turNo}` });
        yay();
        if (o.uyutIstendi) kapan();
        else if (o.kuyruk.length > 0) turBasla();
      },
    };
    // Gerçek örnek gibi: kurulduğu anda veriyolunu dinler, yalnız kendi sohbetinin olaylarını alır.
    b.veriyolu.dinle("is_bitti", (v) => {
      if (v.sohbet_id === id) o.isBittiler.push(v);
    });
    b.veriyolu.dinle("isler_uzlastirildi", (v) => {
      if (Object.hasOwn(v.sohbetler, id)) o.uzlastirmalar.push(v);
    });
    return o;
  };

  const konusmaKur: KonusmaFabrikasi = (b) => {
    kurulumlar.push(b.sohbet_id);
    sira.push(`kur:${b.sohbet_id}`);
    const o = sahteOrnek(b);
    ornekler.set(b.sohbet_id, o);
    return o;
  };
  const listeOlaylari: Duzen["listeOlaylari"] = [];
  veriyolu.dinle("sohbet_listesi_degisti", (v) => listeOlaylari.push(v));

  const y = sohbetlerKur({
    konusmaKur,
    ayar: sahteAyar(azami, sec.bostaDk ?? 30, sec.asistanAdi ?? "Claude"),
    depo: sec.depoSar ? sec.depoSar(depo) : depo,
    kilit: { baslatmaSerbestMi: () => true },
    kopru: {
      jetonUret: () => "sahte-jeton",
      jetonlariIptalEt: () => {},
      erenJetonlariniSil: () => {
        sira.push("erenJetonlariniSil");
        return 0;
      },
    },
    akis: {} as unknown as AkisYardimcilari,
    surec: d.surec,
    dosya: d.dosya,
    saat: d.saat,
    zamanlayici: d.zamanlayici,
    rastgele: d.rastgele,
    veriyolu,
    gunluk: d.gunluk,
    sistem: d.sistem,
  });

  return {
    d,
    depo,
    veriyolu,
    y,
    azami,
    ornekler,
    kurulumlar,
    sira,
    listeOlaylari,
    ihlaller,
    o: (id) => {
      const o = ornekler.get(id);
      assert.ok(o, `örnek yok: ${id}`);
      return o;
    },
    yuvadakiler,
  };
}

/** `baslat` + verilen sohbetleri `olustur`; `baslat()`'ları arkada bitsin. */
async function hazir(h: Duzen, ...idler: string[]): Promise<void> {
  await h.y.baslat();
  for (const id of idler) {
    const r = h.y.olustur(s(id), `Sohbet ${id}`);
    assert.ok(r.ok, `olustur ${id}: ${JSON.stringify(r)}`);
    h.d.zaman.ilerlet(10);
  }
  await bekle();
}

const olaylar = (depo: Depo): Olay[] => depo.olaylariGetir(0, 10_000);
const turdeki = (depo: Depo, type: string): Array<Record<string, unknown>> =>
  olaylar(depo).filter((o) => o.type === type) as unknown as Array<Record<string, unknown>>;

const uyutlar = (h: Duzen): string[] => h.sira.filter((x) => x.startsWith("uyut:"));
const uyandirlar = (h: Duzen): string[] => h.sira.filter((x) => x.startsWith("uyandir:"));

/** Depo kaydı: açılış testleri için (yönetici kurulmadan önce). */
const sohbetKoy = (depo: Depo, id: string, etkinlik: number, olusturma = etkinlik): void =>
  depo.sohbetEkle({ sohbet_id: id, ad: `Sohbet ${id}`, olusturma_ms: olusturma, son_etkinlik_ms: etkinlik });

const nesilKaydi = (sohbet_id: string, nesil: number, ek: Partial<NesilKaydi> = {}): NesilKaydi => ({
  nesil,
  sohbet_id,
  session_id: `00000000-0000-4000-8000-${String(nesil).padStart(12, "0")}`,
  baslangic_ms: 1_000,
  bitis_ms: null,
  ozet_kabul: null,
  pid: null,
  olusturma_ms: null,
  son_dolu: null,
  pencere: null,
  ...ek,
});

// ---------------------------------------------------------------------------------------------
// olustur
// ---------------------------------------------------------------------------------------------

describe("sohbetler: olustur (chat_create)", () => {
  it("yeni kimlik: chat_created yazılır, seq döner, örnek kurulur ve döner, sohbet_listesi_degisti, süreç açılmaz", async () => {
    const h = kur();
    await h.y.baslat();
    const once = h.depo.basSeq();
    const r = h.y.olustur(s("sB"), "İş sohbeti");
    assert.ok(r.ok);
    assert.equal(typeof r.deger.seq, "number");
    // Aynı eşzamanlı akışta örnek döner.
    const ornek = h.y.konusma(s("sB"));
    assert.ok(ornek);
    assert.equal(ornek.sohbet_id, "sB");
    assert.deepEqual(h.kurulumlar.filter((x) => x === "sB"), ["sB"]);
    assert.equal(typeof h.o("sB").b.nesilAyir, "function");
    assert.ok(h.o("sB").b.kapi);

    const created = turdeki(h.depo, "chat_created");
    assert.equal(created.length, 1);
    assert.equal(created[0]!.sohbet_id, "sB");
    assert.equal(created[0]!.ad, "İş sohbeti");
    assert.equal(created[0]!.seq, r.deger.seq);
    assert.equal(h.depo.basSeq(), once + 1);
    const kayit = h.depo.sohbetGetir(s("sB"));
    assert.ok(kayit);
    assert.equal(kayit.ad, "İş sohbeti");
    assert.equal(kayit.olusturma_ms, h.d.zaman.simdi());
    assert.equal(kayit.son_etkinlik_ms, h.d.zaman.simdi());

    assert.deepEqual(h.listeOlaylari, [{ sohbet_id: "sB", olay: "olusturuldu" }]);
    await bekle();
    assert.ok(h.sira.includes("baslat:sB"), "örneğin baslat'ı arkada çağrılır");
    // Süreç açılmaz: ilk mesajda açılır.
    assert.equal(h.o("sB").uyandirSayisi, 0);
    assert.equal(h.o("sB").cevaplar.length, 0);
    assert.equal(h.o("sB").durum(), "uyuyor");
    assert.deepEqual(
      h.y.durumlar().find((x) => x.sohbet_id === "sB"),
      { sohbet_id: "sB", eren: "uyuyor" },
    );
  });

  it("yinelenen kimlik yan etkisiz: seq null, olay yok, ad değişmez, örnek yeniden kurulmaz, liste olayı yok", async () => {
    const h = kur();
    await hazir(h, "sB");
    const seq = h.depo.basSeq();
    const kurulum = h.kurulumlar.length;
    const liste = h.listeOlaylari.length;
    const ornek = h.y.konusma(s("sB"));
    const r = h.y.olustur(s("sB"), "Başka ad");
    assert.deepEqual(r, { ok: true, deger: { seq: null } });
    assert.equal(h.depo.basSeq(), seq);
    assert.equal(h.depo.sohbetGetir(s("sB"))!.ad, "Sohbet sB");
    assert.equal(h.kurulumlar.length, kurulum);
    assert.equal(h.listeOlaylari.length, liste);
    assert.equal(h.y.konusma(s("sB")), ornek);
  });

  it("açılış güvencesi: ana satırı yoksa adı asistan adından eklenir; varsa dokunulmaz", async () => {
    for (const [asistanAdi, beklenen] of [
      [undefined, "Claude"],
      ["Nova", "Nova"],
      ["\u{1F600}".repeat(40), "Claude"],
    ] as const) {
      const eklenenler: string[] = [];
      let anaYok = true;
      const h = kur({
        ...(asistanAdi === undefined ? {} : { asistanAdi }),
        depoSar: (depo) => ({
          ...depo,
          sohbetGetir: (secim) => (secim.sohbet_id === ANA_SOHBET_ID && anaYok ? null : depo.sohbetGetir(secim)),
          sohbetEkle: (k) => {
            if (k.sohbet_id !== ANA_SOHBET_ID) return depo.sohbetEkle(k);
            eklenenler.push(k.ad);
            anaYok = false;
          },
        }),
      });
      await h.y.baslat();
      assert.deepEqual(eklenenler, [beklenen], String(asistanAdi));
    }
    // Satır varsa (gerçek depo, göçün koyduğu ad) yeniden adlandırılmaz.
    const h = kur({ asistanAdi: "Nova" });
    await h.y.baslat();
    assert.equal(h.depo.sohbetGetir(s(ANA_SOHBET_ID))!.ad, "Claude");
  });

  it("ana: seq null, olay yok, ad değişmez", async () => {
    const h = kur();
    await h.y.baslat();
    const seq = h.depo.basSeq();
    const ad = h.depo.sohbetGetir(s(ANA_SOHBET_ID))!.ad;
    const r = h.y.olustur(s(ANA_SOHBET_ID), "Başka");
    assert.deepEqual(r, { ok: true, deger: { seq: null } });
    assert.equal(h.depo.basSeq(), seq);
    assert.equal(h.depo.sohbetGetir(s(ANA_SOHBET_ID))!.ad, ad);
    assert.equal(h.listeOlaylari.length, 0);
  });

  it("silinmiş kimlik: sohbet_bulunamadi, olay yok, örnek yok; adlandir de sohbet_bulunamadi", async () => {
    const h = kur();
    await hazir(h, "sB");
    h.depo.sohbetiSil(s("sB"), h.d.zaman.simdi());
    assert.ok(h.y.kaldir(s("sB")));
    const seq = h.depo.basSeq();
    const r = h.y.olustur(s("sB"), "Yeniden");
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.code, "sohbet_bulunamadi");
    assert.equal(h.depo.basSeq(), seq);
    assert.equal(h.y.konusma(s("sB")), null);
    const a = h.y.adlandir(s("sB"), "Yeniden");
    assert.equal(!a.ok && a.code, "sohbet_bulunamadi");
    assert.equal(h.depo.basSeq(), seq);
  });

  it(`sınır ${SOHBET_SINIRLARI.SOHBET_ADET} (ana dahil): fazlası sohbet_siniri, yan etkisiz; silinen sayılmaz`, async () => {
    assert.equal(SOHBET_SINIRLARI.SOHBET_ADET, 8);
    const h = kur();
    const idler = ["s1", "s2", "s3", "s4", "s5", "s6", "s7"];
    await hazir(h, ...idler);
    assert.equal(h.depo.sohbetListesi().length, 8);
    const seq = h.depo.basSeq();
    const kurulum = h.kurulumlar.length;
    const r = h.y.olustur(s("s8"), "Fazla");
    assert.equal(!r.ok && r.code, "sohbet_siniri");
    assert.equal(h.depo.basSeq(), seq);
    assert.equal(h.depo.sohbetGetir(s("s8")), null);
    assert.equal(h.y.konusma(s("s8")), null);
    assert.equal(h.kurulumlar.length, kurulum);
    // Sınırda var olan kimliğin yinelenmesi yine yan etkisiz ok (sınır denetiminden önce).
    assert.deepEqual(h.y.olustur(s("s3"), "x"), { ok: true, deger: { seq: null } });
    // Biri silinince yer açılır.
    h.depo.sohbetiSil(s("s1"), h.d.zaman.simdi());
    h.y.kaldir(s("s1"));
    const r2 = h.y.olustur(s("s8"), "Artık sığar");
    assert.ok(r2.ok);
    assert.equal(typeof r2.deger.seq, "number");
    assert.equal(h.depo.sohbetListesi().length, 8);
  });
});

// ---------------------------------------------------------------------------------------------
// adlandir, kaldir
// ---------------------------------------------------------------------------------------------

describe("sohbetler: adlandir (chat_rename) ve kaldir", () => {
  it("olmayan sohbet_bulunamadi; aynı ad yan etkisiz; farklı ad chat_renamed + seq; ana da adlandırılır", async () => {
    const h = kur();
    await hazir(h, "sB");
    const seq0 = h.depo.basSeq();
    const yok = h.y.adlandir(s("sYok"), "Ad");
    assert.equal(!yok.ok && yok.code, "sohbet_bulunamadi");
    assert.equal(h.depo.basSeq(), seq0);

    assert.deepEqual(h.y.adlandir(s("sB"), "Sohbet sB"), { ok: true, deger: { seq: null } });
    assert.equal(h.depo.basSeq(), seq0);

    const r = h.y.adlandir(s("sB"), "Tatil planı");
    assert.ok(r.ok);
    assert.equal(typeof r.deger.seq, "number");
    const ren = turdeki(h.depo, "chat_renamed");
    assert.equal(ren.length, 1);
    assert.equal(ren[0]!.sohbet_id, "sB");
    assert.equal(ren[0]!.ad, "Tatil planı");
    assert.equal(ren[0]!.seq, r.deger.seq);
    assert.equal(h.depo.sohbetGetir(s("sB"))!.ad, "Tatil planı");

    const ra = h.y.adlandir(s(ANA_SOHBET_ID), "Asıl sohbet");
    assert.ok(ra.ok);
    assert.equal(typeof ra.deger.seq, "number");
    assert.equal(h.depo.sohbetGetir(s(ANA_SOHBET_ID))!.ad, "Asıl sohbet");
  });

  it("kaldir: örneği döner, sonra konusma() null, sohbet_listesi_degisti{silindi}; ana ve bilinmeyen için null", async () => {
    const h = kur();
    await hazir(h, "sB");
    const ornek = h.y.konusma(s("sB"));
    h.depo.sohbetiSil(s("sB"), h.d.zaman.simdi());
    assert.equal(h.y.kaldir(s("sB")), ornek);
    assert.equal(h.y.konusma(s("sB")), null);
    assert.deepEqual(h.listeOlaylari.at(-1), { sohbet_id: "sB", olay: "silindi" });
    assert.equal(h.y.durumlar().some((x) => x.sohbet_id === "sB"), false);
    const n = h.listeOlaylari.length;
    assert.equal(h.y.kaldir(s(ANA_SOHBET_ID)), null);
    assert.ok(h.y.konusma(s(ANA_SOHBET_ID)), "ana kalır");
    assert.equal(h.y.kaldir(s("sYok")), null);
    assert.equal(h.y.kaldir(s("sB")), null, "ikinci kaldir null");
    assert.equal(h.listeOlaylari.length, n);
  });

  it("kaldir sıradan çıkarır: yuva boşalınca kaldırılan sohbete uyandir gelmez", async () => {
    const h = kur({ azami: 1 });
    await hazir(h, "sB", "sC");
    const ana = h.o(ANA_SOHBET_ID);
    ana.hazirOl();
    ana.mesaj(); // ana tur sürüyor: kurban olursa tur bitince kapanır
    h.o("sB").mesaj(); // sirada
    assert.equal(h.o("sB").durum(), "sirada");
    h.d.zaman.ilerlet(10);
    h.o("sC").mesaj(); // sirada, B'nin arkasında
    h.depo.sohbetiSil(s("sB"), h.d.zaman.simdi());
    h.y.kaldir(s("sB"));
    const bUyandir = h.o("sB").uyandirSayisi;
    ana.turBitir();
    await bekle();
    assert.equal(h.o("sB").uyandirSayisi, bUyandir, "kaldırılan sohbete uyandir yok");
    assert.equal(h.o("sC").durum(), "baslatiliyor", "sıradaki C açılır");
    assert.deepEqual(h.ihlaller, []);
  });
});

// ---------------------------------------------------------------------------------------------
// durumlar, aktifTurlar, yönlendirme
// ---------------------------------------------------------------------------------------------

describe("sohbetler: durumlar ve yönlendirme", () => {
  it("durumlar: SohbetDurumlari şemasına uyar, ana var (ve ilk), en çok 8, uyuyor/sirada örnekten gelir", async () => {
    const h = kur({ azami: 1 });
    await h.y.baslat();
    let l = h.y.durumlar();
    assert.ok(SohbetDurumlari.safeParse(l).success, JSON.stringify(l));
    assert.equal(l[0]!.sohbet_id, ANA_SOHBET_ID, "ana ilk (olusturma_ms en küçük)");
    await hazir(h, "s1", "s2", "s3", "s4", "s5", "s6", "s7");
    h.o(ANA_SOHBET_ID).hazirOl();
    h.o(ANA_SOHBET_ID).mesaj(); // tur
    h.o("s1").mesaj(); // sınır 1: sirada
    l = h.y.durumlar();
    const r = SohbetDurumlari.safeParse(l);
    assert.ok(r.success, JSON.stringify(l));
    assert.equal(l.length, 8);
    assert.equal(l[0]!.sohbet_id, ANA_SOHBET_ID);
    const harita = Object.fromEntries(l.map((x) => [x.sohbet_id, x.eren]));
    assert.equal(harita[ANA_SOHBET_ID], "tur_suruyor");
    assert.equal(harita["s1"], "sirada");
    assert.equal(harita["s2"], "uyuyor");
    for (const x of l) assert.equal(x.eren, h.o(x.sohbet_id).durum());
  });

  it("aktifTurlar: yalnız görünür turu olan örnekler, sohbet_id ile", async () => {
    const h = kur();
    await hazir(h, "sB", "sC");
    assert.deepEqual(h.y.aktifTurlar(), []);
    h.o("sB").aktifTurDegeri = { turn_id: "t-b", text: "yarım", etkinlik: null };
    assert.deepEqual([...h.y.aktifTurlar()], [{ sohbet_id: "sB", turn_id: "t-b", text: "yarım", etkinlik: null }]);
  });

  it("aktifTurlar: örneğin canlı etkinliği (kategori ve başlangıç) korunur", async () => {
    const h = kur();
    await hazir(h, "sB", "sC");
    const etkinlik = { etkinlik: "komut", baslangic_ms: 12_345, kaynak_msg_id: "msg-b" } as const;
    h.o("sB").aktifTurDegeri = { turn_id: "t-b", text: "", etkinlik };
    h.o("sC").aktifTurDegeri = { turn_id: "t-c", text: "yarım", etkinlik: null };
    const l = [...h.y.aktifTurlar()].sort((a, b) => a.sohbet_id.localeCompare(b.sohbet_id));
    assert.deepEqual(l, [
      { sohbet_id: "sB", turn_id: "t-b", text: "", etkinlik: { etkinlik: "komut", baslangic_ms: 12_345, kaynak_msg_id: "msg-b" } },
      { sohbet_id: "sC", turn_id: "t-c", text: "yarım", etkinlik: null },
    ]);
  });

  it("nesil / insanTuru / devirOzetiAl doğru örneğe gider; örnek yoksa 0 / null / {kabul:false}", async () => {
    const h = kur();
    await hazir(h, "sB", "sC");
    h.o("sB").nesilDegeri = 7;
    h.o("sC").nesilDegeri = 9;
    h.o("sB").insanTuruDegeri = "t-insan";
    assert.equal(h.y.nesil(s("sB")), 7);
    assert.equal(h.y.nesil(s("sC")), 9);
    assert.equal(h.y.nesil(s("sYok")), 0);
    assert.equal(h.y.insanTuru(s("sB")), "t-insan");
    assert.equal(h.y.insanTuru(s("sC")), null);
    assert.equal(h.y.insanTuru(s("sYok")), null);
    const baglam: ErenKopruBaglami = { rol: "eren", sohbet_id: "sC", nesil: 9 };
    assert.deepEqual(h.y.devirOzetiAl(baglam, "özet metni"), { kabul: true });
    assert.deepEqual(h.o("sC").devirCagrilari, [{ ozet: "özet metni", nesil: 9 }]);
    assert.deepEqual(h.o("sB").devirCagrilari, []);
    assert.deepEqual(h.y.devirOzetiAl({ rol: "eren", sohbet_id: "sYok", nesil: 9 }, "x"), { kabul: false });
    // Silinmiş sohbete yönlendirme yok.
    h.depo.sohbetiSil(s("sB"), h.d.zaman.simdi());
    h.y.kaldir(s("sB"));
    assert.equal(h.y.nesil(s("sB")), 0);
    assert.deepEqual(h.y.devirOzetiAl({ rol: "eren", sohbet_id: "sB", nesil: 7 }, "x"), { kabul: false });
  });
});

// ---------------------------------------------------------------------------------------------
// nesilAyir
// ---------------------------------------------------------------------------------------------

describe("sohbetler: nesilAyir", () => {
  it("bütün örneklerde tekil, artan; depo tohumu ve sonradan büyüyen depo aşılır", async () => {
    const h = kur({
      hazirla: (depo) => depo.nesilEkle(nesilKaydi(ANA_SOHBET_ID, 10)),
    });
    await hazir(h, "sB");
    const a = h.o(ANA_SOHBET_ID).b.nesilAyir;
    const b = h.o("sB").b.nesilAyir;
    const n1 = a();
    const n2 = b();
    const n3 = a();
    assert.ok(n1 > 10, `depo tohumu aşılır: ${n1}`);
    assert.equal(new Set([n1, n2, n3]).size, 3, "üç çağrı üç farklı numara");
    assert.ok(n1 < n2 && n2 < n3, "artan");
    h.depo.nesilEkle(nesilKaydi("sB", 50));
    const n4 = b();
    assert.ok(n4 > 50, `depo büyüyünce onu aşar: ${n4}`);
    assert.ok(a() > n4);
  });
});

// ---------------------------------------------------------------------------------------------
// Açılış
// ---------------------------------------------------------------------------------------------

describe("sohbetler: örnekler fabrikada kurulur (uzlaştırma regresyonu)", () => {
  const hazirla = (depo: Depo): void => {
    sohbetKoy(depo, "sB", 200, 11);
    sohbetKoy(depo, "sSil", 300, 12);
    depo.sohbetiSil(s("sSil"), 400);
  };

  it("sohbetlerKur döner dönmez, baslat çağrılmadan ana ve B'nin örneği vardır", () => {
    const h = kur({ hazirla });
    assert.ok(h.y.konusma(s(ANA_SOHBET_ID)), "ana örneği fabrikada kurulmalı");
    assert.ok(h.y.konusma(s("sB")), "B örneği fabrikada kurulmalı");
    assert.equal(h.y.konusma(s(ANA_SOHBET_ID))!.sohbet_id, ANA_SOHBET_ID);
    assert.equal(h.y.konusma(s("sB"))!.sohbet_id, "sB");
    assert.equal(h.sira.some((x) => x.startsWith("baslat:")), false, "fabrika örnek baslat'ı çağırmaz");
  });

  it("fabrika sonrası, baslat öncesi yayınlanan is_bitti{B} B'nin örneğine ulaşır, ana'ya ulaşmaz; isler_uzlastirildi yalnız girdisi olana", () => {
    const h = kur({ hazirla });
    const yuk: ServisOlaylari["is_bitti"] = {
      is_id: 1 as ServisOlaylari["is_bitti"]["is_id"],
      plan_id: "p-1",
      tur: "pc",
      durum: "tamam",
      kirli: false,
      sohbet_id: "sB",
    };
    h.veriyolu.yayinla("is_bitti", yuk);
    h.veriyolu.yayinla("isler_uzlastirildi", {
      sahiplenilen: 1,
      biten: 1,
      sohbetler: { sB: { sahiplenilen: 1, biten: 1 } },
    });
    assert.deepEqual(h.o("sB").isBittiler, [yuk]);
    assert.deepEqual(h.o(ANA_SOHBET_ID).isBittiler, []);
    assert.equal(h.o("sB").uzlastirmalar.length, 1);
    assert.equal(h.o(ANA_SOHBET_ID).uzlastirmalar.length, 0);
  });

  it("silinmiş sohbetin örneği fabrikada kurulmaz", () => {
    const h = kur({ hazirla });
    assert.equal(h.kurulumlar.includes("sSil"), false);
    assert.equal(h.y.konusma(s("sSil")), null);
  });

  it("baslat örnekleri yeniden kurmaz: örnek fabrikası sohbet başına bir kez", async () => {
    const h = kur({ hazirla });
    const ana = h.y.konusma(s(ANA_SOHBET_ID));
    const b = h.y.konusma(s("sB"));
    await h.y.baslat();
    await bekle();
    assert.deepEqual([...h.kurulumlar].sort(), [ANA_SOHBET_ID, "sB"].sort());
    assert.equal(h.y.konusma(s(ANA_SOHBET_ID)), ana);
    assert.equal(h.y.konusma(s("sB")), b);
    assert.ok(h.sira.includes(`baslat:${ANA_SOHBET_ID}`) && h.sira.includes("baslat:sB"), "baslat örnekleri başlatır");
  });
});

describe("sohbetler: baslat (açılış sırası)", () => {
  it("erenJetonlariniSil önce; her silinmemiş sohbete örnek + baslat; hepsi bitince kuyruğu dolu olanlar önce, sonra son etkinlik yeniden eskiye ilk N'e uyandir", async () => {
    const h = kur({
      azami: 2,
      hazirla: (depo) => {
        depo.sohbetEtkinlikYaz(s(ANA_SOHBET_ID), 100);
        sohbetKoy(depo, "sA", 400, 10);
        sohbetKoy(depo, "sB", 200, 11);
        sohbetKoy(depo, "sC", 300, 12);
        sohbetKoy(depo, "sD", 500, 13);
        depo.kuyrugaEkle("insan", "b", 200, s("sB"));
        depo.kuyrugaEkle("insan", "c", 300, s("sC"));
      },
    });
    await h.y.baslat();
    await bekle();
    // Şef kararı (uzlaştırma regresyonu): örnekler fabrikada kurulur, yani `kur:` girdileri jeton
    // silmeden önce gelir; kural "erenJetonlariniSil örnek baslat'larından önce".
    const jetonSil = h.sira.indexOf("erenJetonlariniSil");
    const ilkBaslat = h.sira.findIndex((x) => x.startsWith("baslat:"));
    assert.ok(jetonSil >= 0 && jetonSil < ilkBaslat, h.sira.join(" "));
    // Bütün `kur:*` fabrikada oldu: `baslat()` çağrılmadan önce (jeton silme `baslat`'ın ilk adımı).
    const kurlar = h.sira.flatMap((x, i) => (x.startsWith("kur:") ? [i] : []));
    assert.equal(kurlar.length, 5, h.sira.join(" "));
    assert.ok(kurlar.every((i) => i < jetonSil && i < ilkBaslat), h.sira.join(" "));
    assert.deepEqual([...h.kurulumlar].sort(), [ANA_SOHBET_ID, "sA", "sB", "sC", "sD"].sort());
    const ilkUyandir = h.sira.findIndex((x) => x.startsWith("uyandir:"));
    const sonBitis = h.sira.reduce((m, x, i) => (x.startsWith("baslatBitti:") ? i : m), -1);
    assert.ok(ilkUyandir > sonBitis, `uyandir'lar bütün baslat'lar bittikten sonra: ${h.sira.join(" ")}`);
    // Sıra: C (kuyruk, 300), B (kuyruk, 200), D (500), A (400), ana (100). Sınır 2 → C, B.
    assert.deepEqual(uyandirlar(h), ["uyandir:sC", "uyandir:sB"]);
    assert.deepEqual(h.yuvadakiler().sort(), ["sB", "sC"]);
    for (const id of [ANA_SOHBET_ID, "sA", "sD"]) assert.equal(h.o(id).durum(), "uyuyor", id);
    assert.deepEqual(h.ihlaller, []);
  });

  it("kuyruk yoksa son etkinliği en yeni N sohbet açılır (M1)", async () => {
    const h = kur({
      azami: 2,
      hazirla: (depo) => {
        depo.sohbetEtkinlikYaz(s(ANA_SOHBET_ID), 100);
        sohbetKoy(depo, "sA", 400, 10);
        sohbetKoy(depo, "sD", 500, 13);
        sohbetKoy(depo, "sE", 50, 14);
      },
    });
    await h.y.baslat();
    await bekle();
    assert.deepEqual(uyandirlar(h), ["uyandir:sD", "uyandir:sA"]);
    assert.deepEqual(h.yuvadakiler().sort(), ["sA", "sD"]);
  });

  it("sınır 1: kuyruğu dolu olup sınıra sığmayan da uyandir alır ve sirada kalır; en yeni kuyruklu açılır", async () => {
    const h = kur({
      azami: 1,
      hazirla: (depo) => {
        sohbetKoy(depo, "sB", 200, 11);
        sohbetKoy(depo, "sC", 300, 12);
        sohbetKoy(depo, "sD", 500, 13);
        depo.kuyrugaEkle("insan", "b", 200, s("sB"));
        depo.kuyrugaEkle("insan", "c", 300, s("sC"));
      },
    });
    await h.y.baslat();
    await bekle();
    assert.deepEqual(uyandirlar(h).slice(0, 2), ["uyandir:sC", "uyandir:sB"]);
    assert.equal(h.o("sD").uyandirSayisi, 0);
    assert.equal(h.o(ANA_SOHBET_ID).uyandirSayisi, 0);
    assert.deepEqual(h.yuvadakiler(), ["sC"]);
    assert.equal(h.o("sB").durum(), "sirada");
    assert.deepEqual(h.ihlaller, []);
  });

  it("silinmiş sohbetin canlı son nesil süreci öldürülür (agaciOldur), ölüsüne dokunulmaz; silinmişe örnek kurulmaz", async () => {
    const h = kur({
      hazirla: (depo, d) => {
        sohbetKoy(depo, "sX", 10);
        sohbetKoy(depo, "sY", 11);
        const canli = d.surec.surecEkle({ pid: 7777, ppid: 1, ad: "claude.exe", olusturmaMs: 5_000 });
        depo.nesilEkle(nesilKaydi("sX", 3, { pid: canli.pid, olusturma_ms: canli.olusturmaMs }));
        depo.nesilEkle(nesilKaydi("sY", 4, { pid: 8888, olusturma_ms: 6_000 })); // süreç tablosunda yok: ölü
        depo.sohbetiSil(s("sX"), 20);
        depo.sohbetiSil(s("sY"), 21);
      },
    });
    await h.y.baslat();
    await bekle();
    const olen = h.d.surec.oldurmalar.map((x) => x.pid);
    assert.ok(olen.includes(7777), `canlı sahipsiz süreç öldürülür: ${JSON.stringify(h.d.surec.oldurmalar)}`);
    assert.equal(olen.includes(8888), false);
    assert.equal(h.kurulumlar.includes("sX"), false);
    assert.equal(h.kurulumlar.includes("sY"), false);
    assert.equal(h.y.konusma(s("sX")), null);
  });

  it("kuyruktaki tek sohbet: açılışta uyandir alır; kuyruğu boş olanlar sınır dolduysa uyuyor", async () => {
    const h = kur({
      azami: 1,
      hazirla: (depo) => {
        sohbetKoy(depo, "sD", 500, 13);
        sohbetKoy(depo, "sB", 200, 11);
        depo.kuyrugaEkle("insan", "b", 200, s("sB"));
      },
    });
    await h.y.baslat();
    await bekle();
    assert.deepEqual(uyandirlar(h), ["uyandir:sB"]);
    assert.equal(h.o("sD").durum(), "uyuyor");
  });
});

// ---------------------------------------------------------------------------------------------
// SurecKapisi
// ---------------------------------------------------------------------------------------------

describe("sohbetler: SurecKapisi (yuva, sıra, kurban)", () => {
  it("sınır 2: iki yuva verilir, üçüncü istek false + sirada; kurban en uzun süredir boşta olan (etkinliği daha yeni olsa da)", async () => {
    const h = kur({ azami: 2 });
    await hazir(h, "sB", "sC");
    const ana = h.o(ANA_SOHBET_ID); // açılışta yuva aldı
    const b = h.o("sB");
    assert.deepEqual(h.yuvadakiler(), [ANA_SOHBET_ID]);
    ana.hazirOl();
    // B: önce mesaj (etkinlik eski), uzun tur; ana: sonra mesaj (etkinlik yeni), kısa tur → ana daha uzun boşta.
    b.mesaj();
    assert.equal(b.cevaplar.at(-1), true);
    b.hazirOl(); // B tur
    h.d.zaman.ilerlet(1000);
    ana.mesaj(); // ana tur
    h.d.zaman.ilerlet(1000);
    ana.turBitir(); // ana boşta: t+2000
    h.d.zaman.ilerlet(5000);
    b.turBitir(); // B boşta: t+7000
    h.d.zaman.ilerlet(1000);
    assert.ok(ana.bostaBeri()! < b.bostaBeri()!);
    assert.ok(h.depo.sohbetGetir(s(ANA_SOHBET_ID))!.son_etkinlik_ms > h.depo.sohbetGetir(s("sB"))!.son_etkinlik_ms);

    h.o("sC").mesaj();
    assert.equal(h.o("sC").cevaplar.at(-1), false);
    assert.equal(h.o("sC").durum(), "sirada");
    assert.deepEqual(uyutlar(h), [`uyut:${ANA_SOHBET_ID}`], "kurban en uzun boşta olan ana");
    await bekle();
    assert.equal(ana.surec, "yok");
    assert.equal(h.o("sC").durum(), "baslatiliyor", "boşalan yuva sıradakine");
    assert.deepEqual(h.o("sC").cevaplar, [false, true]);
    assert.deepEqual(h.yuvadakiler().sort(), ["sB", "sC"]);
    assert.deepEqual(h.ihlaller, []);
  });

  it("hiçbiri boşta değilse kurban son_etkinlik_ms'i en eski canlı sohbet; tur bitince kapanır, sonra sıradaki açılır", async () => {
    const h = kur({ azami: 2 });
    await hazir(h, "sB", "sC");
    const ana = h.o(ANA_SOHBET_ID);
    const b = h.o("sB");
    ana.hazirOl();
    b.mesaj(); // B etkinlik eski
    b.hazirOl(); // B tur
    h.d.zaman.ilerlet(1000);
    ana.mesaj(); // ana etkinlik yeni, tur
    h.d.zaman.ilerlet(1000);
    assert.equal(ana.bostaBeri(), null);
    assert.equal(b.bostaBeri(), null);
    h.o("sC").mesaj();
    assert.equal(h.o("sC").durum(), "sirada");
    assert.deepEqual(uyutlar(h), ["uyut:sB"], "kurban etkinliği en eski olan B (ana listede önce olsa da)");
    await bekle();
    assert.equal(b.surec, "hazir", "tur sürerken kapanmaz");
    assert.equal(h.o("sC").durum(), "sirada");
    b.turBitir();
    await bekle();
    assert.equal(b.surec, "yok");
    assert.equal(h.o("sC").durum(), "baslatiliyor");
    assert.deepEqual(h.ihlaller, []);
  });

  it("bir anda tek kurban; sıra FIFO; aynı sohbetin yinelenen isteği sırayı değiştirmez", async () => {
    const h = kur({ azami: 2 });
    await hazir(h, "sB", "sC", "sD");
    const ana = h.o(ANA_SOHBET_ID);
    const b = h.o("sB");
    ana.hazirOl();
    b.mesaj();
    b.hazirOl();
    h.d.zaman.ilerlet(1000);
    ana.mesaj();
    h.d.zaman.ilerlet(1000);
    h.o("sC").mesaj(); // kurban B (tur bitince)
    h.d.zaman.ilerlet(10);
    h.o("sD").mesaj(); // ikinci kurban YOK
    h.d.zaman.ilerlet(10);
    h.o("sC").mesaj(); // C yineler: sırada öne/arkaya geçmez
    assert.equal(uyutlar(h).length, 1, `tek kurban: ${uyutlar(h).join(" ")}`);
    assert.equal(h.o("sD").durum(), "sirada");
    b.turBitir();
    await bekle();
    assert.equal(h.o("sC").durum(), "baslatiliyor", "FIFO: önce gelen C");
    assert.equal(h.o("sD").durum(), "sirada");
    assert.ok(!h.yuvadakiler().includes("sD"));
    assert.deepEqual(h.ihlaller, []);
  });

  it("yuva sıradakine ayrılır: araya giren başka sohbetin isteği false, ayrılanın isteği true", async () => {
    const h = kur({ azami: 1 });
    await hazir(h, "sB", "sE");
    const ana = h.o(ANA_SOHBET_ID);
    ana.hazirOl();
    ana.mesaj(); // tur
    h.o("sB").mesaj(); // sirada, kurban ana (tur bitince)
    const e = h.o("sE");
    let araya: boolean | undefined;
    h.o("sB").uyandirOncesi = () => {
      h.o("sB").uyandirOncesi = null;
      araya = e.b.kapi.yuvaIste(s("sE"));
    };
    ana.turBitir();
    await bekle();
    assert.equal(araya, false, "ayrılmış yuvayı başkası alamaz");
    assert.equal(h.o("sB").cevaplar.at(-1), true);
    assert.equal(h.o("sB").durum(), "baslatiliyor");
    assert.deepEqual(h.yuvadakiler(), ["sB"]);
    assert.deepEqual(h.ihlaller, []);
  });

  it("boş yuva varken önünde bekleyen varsa yeni istek false (FIFO)", async () => {
    const h = kur({ azami: 2 });
    await hazir(h, "sB", "sC", "sD");
    h.o(ANA_SOHBET_ID).hazirOl();
    h.d.sistem.ram = { bosMb: RAM_ESIGI - 1, toplamMb: 16000 };
    h.o("sB").mesaj();
    h.o("sC").mesaj();
    assert.equal(h.o("sB").durum(), "sirada");
    h.d.sistem.ram = { bosMb: RAM_ESIGI, toplamMb: 16000 };
    // RAM düzeldi ama yoklama henüz gelmedi: boş yuva var, önünde B ve C bekliyor.
    h.o("sD").mesaj();
    assert.equal(h.o("sD").cevaplar.at(-1), false);
    h.d.zaman.ilerlet(RAM_YOKLAMA_MS);
    await bekle();
    assert.equal(h.o("sB").durum(), "baslatiliyor", "sıranın başı B açılır");
    assert.notEqual(h.o("sD").durum(), "baslatiliyor");
    assert.deepEqual(h.ihlaller, []);
  });

  it("uyandir döndüğünde kullanılmayan rezervasyon düşer (kilit), sıradakine geçilir", async () => {
    const h = kur({ azami: 1 });
    await hazir(h, "sB", "sC");
    const ana = h.o(ANA_SOHBET_ID);
    ana.hazirOl();
    ana.mesaj();
    h.o("sB").mesaj();
    h.d.zaman.ilerlet(10);
    h.o("sC").mesaj();
    h.o("sB").kilitli = true;
    const bOnce = h.o("sB").uyandirSayisi;
    ana.turBitir();
    await bekle();
    assert.ok(h.o("sB").uyandirSayisi > bOnce, "sıranın başına uyandir dendi");
    assert.equal(h.o("sB").surec, "yok");
    assert.equal(h.o("sC").durum(), "baslatiliyor", "B kullanmadı, C aldı");
    assert.deepEqual(h.yuvadakiler(), ["sC"]);
    assert.deepEqual(h.ihlaller, []);
  });

  it("sıradaki sohbet temizlenince (yuva beklemesi biter) sıradan çıkar: onun için kurban seçilmez, yer açılınca uyandırılmaz", async () => {
    // Regresyon (gözden geçirme, hata 2): temizlenen C yöneticinin sırasında kalıyordu; canlı biri boşa
    // düşünce C için kurban uyutuluyor, C'ye yuva verilip işi olmadığı hâlde süreç açılıyordu.
    const h = kur({ azami: 2 });
    await hazir(h, "sB", "sC");
    const ana = h.o(ANA_SOHBET_ID); // açılışta yuva aldı, başlatılıyor
    const b = h.o("sB");
    const c = h.o("sC");
    b.mesaj(); // ikinci yuva, başlatılıyor
    assert.deepEqual(h.yuvadakiler().sort(), [ANA_SOHBET_ID, "sB"]);
    h.d.zaman.ilerlet(10);
    c.mesaj(); // yuvalar dolu, aday yok (ikisi de başlatılıyor): C sırada bekler
    assert.equal(c.durum(), "sirada");
    assert.deepEqual(uyutlar(h), [], "başlatılan sohbet kurban olmaz");

    // chat_clear{C}: kuyruk silinir, sonra yeni sayfa.
    h.d.zaman.ilerlet(10);
    h.depo.gecmisiTemizle(s("sC"));
    await c.yeniSayfa();
    assert.equal(c.durum(), "uyuyor");
    const cUyandir = c.uyandirSayisi;

    ana.hazirOl(); // ana boşa düştü: eskiden C için kurban edilirdi
    await bekle();
    assert.deepEqual(uyutlar(h), [], "işi olmayan, temizlenmiş sohbet için kurban yok");
    assert.equal(ana.surec, "hazir");

    // Boşta kapatma yuvayı boşaltır: temizlenen C'ye uyandir gelmez.
    h.d.zaman.ilerlet(31 * DK);
    await bekle();
    assert.equal(ana.surec, "yok", "boşta kapatıldı");
    assert.equal(c.uyandirSayisi, cUyandir, "C'ye uyandir yok");
    assert.equal(c.acilisSayisi, 0, "C için süreç açılmadı");
    assert.equal(c.durum(), "uyuyor");
    const cDurum = h.y.durumlar().find((x) => x.sohbet_id === "sC");
    assert.equal(cDurum?.eren, "uyuyor", "server_status C'yi sirada göstermez");
    assert.deepEqual(h.ihlaller, []);
  });

  it("kilit: hepsi kapanınca kimse yuva tutmaz; kilit açılınca istekler sınırı aşmaz", async () => {
    const h = kur({ azami: 1 });
    await hazir(h, "sB");
    const ana = h.o(ANA_SOHBET_ID);
    const b = h.o("sB");
    ana.hazirOl();
    ana.mesaj(); // tur
    b.mesaj(); // sirada
    // Kilit aktif: örnekler kilitlenir, süreç kapanır (yuvaBirak), sıradaki kapıyı sormaz.
    ana.kilitli = true;
    b.kilitli = true;
    ana.mesaj(); // ana'nın kuyruğu da dolu
    ana.uyutIstendi = true; // sahte: kilit tepkisi süreç kapatır
    ana.turBitir();
    await bekle();
    assert.deepEqual(h.yuvadakiler(), []);
    assert.equal(b.surec, "yok");
    // Kilit serbest: kuyruğu dolu iki örnek uyandir der (dinleyici sırasıyla).
    ana.kilitli = false;
    b.kilitli = false;
    b.uyandir();
    ana.uyandir();
    await bekle();
    assert.equal(h.yuvadakiler().length, 1, `tek yuva: ${h.yuvadakiler().join(",")}`);
    assert.deepEqual(h.ihlaller, []);
  });

  it("devirSerbestMi canlı sınırından muaf, yalnız RAM'e bakar", async () => {
    const h = kur({ azami: 1 });
    await h.y.baslat();
    const kapi = h.o(ANA_SOHBET_ID).b.kapi;
    assert.deepEqual(h.yuvadakiler(), [ANA_SOHBET_ID], "yuvalar dolu");
    assert.equal(kapi.devirSerbestMi(), true);
    h.d.sistem.ram = { bosMb: RAM_ESIGI - 1, toplamMb: 16000 };
    assert.equal(kapi.devirSerbestMi(), false);
    h.d.sistem.ram = { bosMb: RAM_ESIGI, toplamMb: 16000 };
    assert.equal(kapi.devirSerbestMi(), true);
  });
});

describe("sohbetler: RAM kapısı", () => {
  it("RAM düşükken boş yuva olsa da her istek false + sirada, kurban seçilmez; RAM düzelince (ramYoklamaMs) sıradaki açılır", async () => {
    const h = kur({ azami: 2 });
    await hazir(h, "sB", "sC");
    h.o(ANA_SOHBET_ID).hazirOl();
    h.d.sistem.ram = { bosMb: RAM_ESIGI - 1, toplamMb: 16000 };
    h.o("sB").mesaj();
    h.d.zaman.ilerlet(10);
    h.o("sC").mesaj();
    assert.deepEqual(h.o("sB").cevaplar, [false]);
    assert.deepEqual(h.o("sC").cevaplar, [false]);
    assert.equal(h.o("sB").durum(), "sirada");
    assert.deepEqual(uyutlar(h), [], "RAM reddi kurban seçtirmez");
    h.d.zaman.ilerlet(RAM_YOKLAMA_MS);
    await bekle();
    assert.equal(h.o("sB").durum(), "sirada", "RAM hâlâ düşük");
    h.d.sistem.ram = { bosMb: RAM_ESIGI, toplamMb: 16000 };
    h.d.zaman.ilerlet(RAM_YOKLAMA_MS);
    await bekle();
    assert.equal(h.o("sB").durum(), "baslatiliyor", "sıranın başı B açılır");
    assert.equal(h.o("sB").cevaplar.at(-1), true);
    assert.ok(h.yuvadakiler().includes("sB"));
    // C'nin sonrası (yuvalar dolu: kurban seçilip seçilmemesi) bu testin konusu değil; sınır aşılmaz.
    assert.ok(h.yuvadakiler().length <= 2);
    assert.deepEqual(h.ihlaller, []);
  });
});

// ---------------------------------------------------------------------------------------------
// Boşta kapatma
// ---------------------------------------------------------------------------------------------

describe("sohbetler: boşta yoklaması", () => {
  it("bostaBeri süresi (erenBostaKapatMs) dolunca uyut; dolmadan çağırmaz", async () => {
    const h = kur({ azami: 2, bostaDk: 30 });
    await h.y.baslat();
    const ana = h.o(ANA_SOHBET_ID);
    ana.hazirOl();
    h.d.zaman.ilerlet(29 * DK);
    assert.equal(ana.uyutSayisi, 0);
    h.d.zaman.ilerlet(2 * DK);
    assert.equal(ana.uyutSayisi, 1);
    await bekle();
    assert.equal(ana.surec, "yok");
    assert.equal(ana.durum(), "uyuyor");
    assert.deepEqual(h.yuvadakiler(), []);
  });

  it("bostaBeri null iken (tur, kuyruk, devir) süre ne kadar geçse de uyutmaz", async () => {
    const h = kur({ azami: 2, bostaDk: 30 });
    await hazir(h, "sB");
    const ana = h.o(ANA_SOHBET_ID);
    ana.hazirOl();
    ana.mesaj(); // tur sürüyor
    h.o("sB").mesaj();
    h.o("sB").hazirOl();
    h.o("sB").bostaZorla = null; // ör. devir sürüyor
    h.d.zaman.ilerlet(3 * 60 * DK);
    assert.equal(ana.uyutSayisi, 0);
    assert.equal(h.o("sB").uyutSayisi, 0);
  });

  it("ölçüm bostaBeri'den: süreç uzun süredir açık ama yeni boşa düştüyse uyutmaz", async () => {
    const h = kur({ azami: 2, bostaDk: 30 });
    await h.y.baslat();
    const ana = h.o(ANA_SOHBET_ID);
    ana.hazirOl();
    ana.mesaj();
    h.d.zaman.ilerlet(40 * DK);
    ana.turBitir(); // şimdi boşa düştü
    h.d.zaman.ilerlet(20 * DK);
    assert.equal(ana.uyutSayisi, 0);
    h.d.zaman.ilerlet(11 * DK);
    assert.equal(ana.uyutSayisi, 1);
  });
});

// ---------------------------------------------------------------------------------------------
// Sınır 1: karşılıklı uyutma (thrash) — sözleşme yazarının açık sorusu
// ---------------------------------------------------------------------------------------------

describe("sohbetler: sınır 1'de iki sohbet birbirini sürekli uyutmaz", () => {
  it("talep yokken ping-pong yok: B açılınca ana bir kez uyutulur, sonra kimse uyutulmaz", async () => {
    const h = kur({ azami: 1 });
    await hazir(h, "sB");
    const ana = h.o(ANA_SOHBET_ID);
    const b = h.o("sB");
    ana.hazirOl();
    b.mesaj();
    await bekle();
    b.hazirOl();
    b.turBitir();
    h.d.zaman.ilerlet(10 * DK);
    await bekle();
    assert.equal(ana.uyutSayisi, 1);
    assert.equal(b.uyutSayisi, 0);
    assert.equal(ana.acilisSayisi, 1);
    assert.equal(b.acilisSayisi, 1);
    assert.equal(b.turSayisi, 1);
    assert.deepEqual(h.ihlaller, []);
  });

  it("ikisinin de mesajı varken (biri tur sürerken) ikisi de hizmet alır", async () => {
    const h = kur({ azami: 1 });
    await hazir(h, "sB");
    const ana = h.o(ANA_SOHBET_ID);
    const b = h.o("sB");
    ana.hazirOl();
    ana.mesaj(); // ana tur
    h.d.zaman.ilerlet(1000);
    b.mesaj(); // kurban ana (tur bitince)
    h.d.zaman.ilerlet(1000);
    ana.mesaj(); // ana'nın kuyruğu: kapanınca yeniden yuva ister
    const sonuc = await surdur(h, [ana, b], 20);
    assert.ok(sonuc.bitti, `iki sohbetin kuyruğu boşalmalı: ${sonuc.ozet}`);
    assert.equal(ana.turSayisi, 2);
    assert.equal(b.turSayisi, 1);
    assert.deepEqual(h.ihlaller, []);
  });

  it("yeni açılan (henüz başlatılıyor) sohbet, diğerinin mesajıyla hemen kurban edilip turunu kaçırmaz (canlı kilit yok)", async () => {
    // Senaryo: ana boşta, B'ye mesaj → ana uyutulur, B açılmaya başlar (baslatiliyor). Bu sırada ana'ya
    // mesaj gelir → ana sirada; yuvalar dolu → kurban seçilir. Canlı tek sohbet B'dir ve boşta değildir;
    // sözleşmenin kuralı ("boşta yoksa son_etkinlik_ms'i en eski canlı") B'yi seçer. `uyut` sözleşmesi
    // başlatma sürerken "o bitince, sıradaki kuyruk satırı açılmadan" kapatır → B turunu açmadan kapanır,
    // kuyruğu dolu olduğu için yeniden ister ve ana'yı (o da başlatılıyor) kurban eder... Hiçbiri tur
    // açamazsa canlı kilit (thrash) var demektir. Beklenen: sınırlı adımda ikisi de hizmet alır.
    const h = kur({ azami: 1 });
    await hazir(h, "sB");
    const ana = h.o(ANA_SOHBET_ID);
    const b = h.o("sB");
    ana.hazirOl(); // ana boşta
    h.d.zaman.ilerlet(1000);
    b.mesaj(); // kurban ana (boşta → hemen)
    await bekle();
    assert.equal(b.durum(), "baslatiliyor");
    h.d.zaman.ilerlet(1000);
    ana.mesaj(); // ana'nın etkinliği B'ninkinden yeni
    const sonuc = await surdur(h, [ana, b], 20);
    assert.ok(
      sonuc.bitti,
      `canlı kilit: ${sonuc.adim} adımda kuyruklar boşalmadı; ${sonuc.ozet}; uyutlar: ${uyutlar(h).join(" ")}`,
    );
    assert.equal(b.turSayisi, 1);
    assert.equal(ana.turSayisi, 1);
    assert.deepEqual(h.ihlaller, []);
  });
});

/**
 * Kullanıcı başka mesaj yollamadan sistemi ilerletir: başlatılanı hazırlar, süren turu bitirir; iki
 * kuyruk da boşalınca durur. Adım sınırı canlı kilidi yakalar.
 */
async function surdur(
  h: Duzen,
  ornekler: SahteOrnek[],
  azamiAdim: number,
): Promise<{ bitti: boolean; adim: number; ozet: string }> {
  let adim = 0;
  const ozet = (): string =>
    ornekler
      .map((o) => `${o.sohbet_id}[durum=${o.durum()} tur=${o.turSayisi} acilis=${o.acilisSayisi} uyut=${o.uyutSayisi} kuyruk=${o.kuyruk.length}]`)
      .join(" ");
  for (; adim < azamiAdim; adim++) {
    await bekle();
    if (ornekler.every((o) => o.kuyruk.length === 0 && !o.tur)) return { bitti: true, adim, ozet: ozet() };
    let ilerledi = false;
    for (const o of ornekler) {
      if (o.surec === "baslatiliyor") {
        o.hazirOl();
        ilerledi = true;
        break;
      }
      if (o.tur) {
        o.turBitir();
        ilerledi = true;
        break;
      }
    }
    if (!ilerledi) {
      await bekle();
      if (!ornekler.some((o) => o.surec === "baslatiliyor" || o.tur)) break;
    }
    h.d.zaman.ilerlet(100);
  }
  await bekle();
  return { bitti: ornekler.every((o) => o.kuyruk.length === 0 && !o.tur), adim, ozet: ozet() };
}

// ---------------------------------------------------------------------------------------------
// Kapanış, günlük, dosya taraması
// ---------------------------------------------------------------------------------------------

describe("sohbetler: kapat", () => {
  it("bütün örnekler kapat; sonra kapı her isteğe false, boşta yoklaması ve RAM yoklaması durur", async () => {
    const h = kur({ azami: 2 });
    await hazir(h, "sB", "sC");
    h.o(ANA_SOHBET_ID).hazirOl();
    h.d.sistem.ram = { bosMb: RAM_ESIGI - 1, toplamMb: 16000 };
    h.o("sB").mesaj(); // sirada (RAM)
    h.d.sistem.ram = { bosMb: 8000, toplamMb: 16000 };
    await h.y.kapat();
    for (const id of [ANA_SOHBET_ID, "sB", "sC"]) assert.ok(h.sira.includes(`kapat:${id}`), id);
    const kapi = h.o("sC").b.kapi;
    assert.equal(kapi.yuvaIste(s("sC")), false);
    const uyandirOnce = h.o("sB").uyandirSayisi;
    h.d.zaman.ilerlet(2 * 60 * DK);
    await bekle();
    assert.equal(h.o(ANA_SOHBET_ID).uyutSayisi, 0, "boşta yoklaması durdu");
    assert.equal(h.o("sB").uyandirSayisi, uyandirOnce, "RAM yoklaması sıradakine uyandir demez");
  });
});

describe("sohbetler: günlük ve dosya", () => {
  it("sohbet adı günlüğe girmez (oluştur, adlandır, açılış, kurban, kaldır)", async () => {
    const AD1 = "GizliAdBir-ğüşiöç";
    const AD2 = "GizliAdIki-ĞÜŞİÖÇ";
    const h = kur({
      azami: 1,
      hazirla: (depo) => sohbetKoy(depo, "sEski", 5),
    });
    await h.y.baslat();
    assert.ok(h.y.olustur(s("sB"), AD1).ok);
    assert.ok(h.y.adlandir(s("sB"), AD2).ok);
    h.y.olustur(s("sB"), AD1);
    await bekle();
    // Açılışta yuvayı etkinliği daha yeni olan sEski aldı; boşa düşsün, B'nin isteği onu kurban etsin.
    const tutan = h.yuvadakiler();
    assert.equal(tutan.length, 1);
    h.o(tutan[0]!).hazirOl();
    h.o("sB").mesaj();
    await bekle();
    assert.ok(uyutlar(h).length >= 1, "kurban seçildi");
    h.depo.sohbetiSil(s("sEski"), h.d.zaman.simdi());
    h.y.kaldir(s("sEski"));
    await h.y.kapat();
    const metin = JSON.stringify(h.d.gunluk.girdiler);
    assert.equal(metin.includes("GizliAd"), false, metin);
    assert.equal(metin.includes("Sohbet sEski"), false, metin);
  });

  it("src/sohbetler.ts: insan mesajı yönteminin adı geçmez (yorum dahil), konusma.ts içe aktarılmaz", () => {
    const kaynak = readFileSync(new URL("../src/sohbetler.ts", import.meta.url), "utf8");
    assert.equal(kaynak.includes("insanMesajiAl"), false);
    assert.equal(/from\s+["']\.\/konusma(\.ts)?["']/.test(kaynak), false);
  });
});
