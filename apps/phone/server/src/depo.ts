/**
 * Kalıcı durum: tek `node:sqlite` kullanıcısı, eşzamanlı `DatabaseSync`. MODULLER.md, "depo".
 * Deneysel API (`DatabaseSync, prepare, run, get, all, exec`) yalnız bu dosyada kalır.
 */
import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue, StatementSync } from "node:sqlite";
import {
  ANA_SOHBET_ID,
  IsId,
  IsProfili,
  Olay,
  Plan,
  Sayac,
  SILINMEZ_OLAY_TURLERI,
  SOHBET_SINIRLARI,
  SohbetAdi,
  SohbetId,
  VARSAYILAN_IS_PROFILI,
} from "@eren/protocol";
import type { TuketimIkilisi, TuketimToplami } from "@eren/protocol";
import { anaSohbetAdiUret } from "./ana-sohbet-adi.ts";
import type {
  AckGovdesi,
  CihazKaydi,
  Depo,
  DepoFabrikasi,
  ErenKuyrukKaynagi,
  ErenKuyrukSatiri,
  GecmisTemizlemeSonucu,
  Gunluk,
  IsKaydi,
  IsNo,
  IsPidKaydi,
  JetonKapsami,
  JetonKaydi,
  KirliOkumaKaydi,
  KonusmaSatiri,
  MezarTasiOlayi,
  NesilKaydi,
  OlayGirdisi,
  PlanDurumu,
  PlanKaydi,
  SohbetKaydi,
  SohbetSecimi,
  SohbetSilindiOlayi,
  SohbetSilmeSonucu,
  SoruDurumu,
  SoruKaydi,
  TuketimKaydi,
  TuketimOzeti,
  TurBitisi,
  TurKaydi,
} from "./sozlesme.ts";

/**
 * `PRAGMA user_version`. Yalnız geriye uyumsuz göçte artar; ek göçler `sema_ek`'te (MODULLER.md,
 * "Şema kuralı (K2)"). Bu sayı değişmediği sürece eski kod yeni şemalı dosyayı açabilir: açılışı
 * yalnız `user_version`'a bakar, bütün `INSERT`'leri sütun adı yazar, ek sütunlar varsayılanlıdır.
 */
const SURUM = 1;

/** Göç ileri yönlüdür: `GOCLER[n]`, sürüm n'den n+1'e çıkarır. */
const GOCLER: readonly string[] = [
  `
  CREATE TABLE events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    ts_ms INTEGER NOT NULL,
    type TEXT NOT NULL,
    veri TEXT NOT NULL
  ) STRICT;

  CREATE TABLE acklar (
    device_id TEXT NOT NULL,
    client_msg_id TEXT NOT NULL,
    ok INTEGER NOT NULL,
    seq INTEGER,
    code TEXT,
    PRIMARY KEY (device_id, client_msg_id)
  ) STRICT;

  CREATE TABLE nesiller (
    nesil INTEGER PRIMARY KEY,
    session_id TEXT NOT NULL,
    baslangic_ms INTEGER NOT NULL,
    bitis_ms INTEGER,
    ozet_kabul INTEGER,
    pid INTEGER,
    olusturma_ms INTEGER,
    son_dolu REAL,
    pencere INTEGER
  ) STRICT;

  CREATE TABLE turns (
    turn_id TEXT PRIMARY KEY,
    nesil INTEGER NOT NULL,
    kaynak TEXT NOT NULL,
    gorunur INTEGER NOT NULL,
    baslangic_ms INTEGER NOT NULL,
    bitis_ms INTEGER,
    bitis TEXT,
    kismi_metin TEXT NOT NULL
  ) STRICT;
  CREATE INDEX turns_acik ON turns (baslangic_ms) WHERE bitis_ms IS NULL;

  CREATE TABLE planlar (
    plan_id TEXT PRIMARY KEY,
    plan TEXT NOT NULL,
    plan_hash TEXT NOT NULL,
    durum TEXT NOT NULL,
    is_id INTEGER,
    olusturma_ms INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE isler (
    is_id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id TEXT NOT NULL,
    plan_hash TEXT NOT NULL,
    baslik TEXT NOT NULL,
    tur TEXT NOT NULL,
    cwd TEXT NOT NULL,
    durum TEXT NOT NULL,
    kirli INTEGER NOT NULL,
    session_id TEXT NOT NULL,
    pid INTEGER,
    olusturma_ms INTEGER,
    baslangic_ms INTEGER NOT NULL,
    bitis_ms INTEGER,
    out_ofset INTEGER NOT NULL,
    rapor TEXT,
    rapor_kaynak TEXT,
    son_result TEXT,
    durdurma TEXT
  ) STRICT;
  CREATE INDEX isler_plan ON isler (plan_id);

  CREATE TABLE is_pidleri (
    is_id INTEGER NOT NULL REFERENCES isler (is_id),
    pid INTEGER NOT NULL,
    olusturma_ms INTEGER NOT NULL,
    ad TEXT NOT NULL,
    ilk_gorulme_ms INTEGER NOT NULL,
    PRIMARY KEY (is_id, pid, olusturma_ms)
  ) STRICT;

  CREATE TABLE sorular (
    soru_id TEXT PRIMARY KEY,
    is_id INTEGER NOT NULL REFERENCES isler (is_id),
    soru TEXT NOT NULL,
    secenekler TEXT,
    durum TEXT NOT NULL,
    cevap TEXT,
    olusturma_ms INTEGER NOT NULL,
    son_ms INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE eren_kuyrugu (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kaynak TEXT NOT NULL,
    metin TEXT NOT NULL,
    olusturma_ms INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE cihazlar (
    device_id TEXT PRIMARY KEY,
    public_key TEXT NOT NULL,
    tailscale_ip TEXT NOT NULL,
    platform TEXT NOT NULL,
    etiket TEXT,
    eslesme_ms INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE eslestirme (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    kod_ozeti TEXT NOT NULL,
    son_ms INTEGER NOT NULL,
    yanlis_deneme INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE kopru_jetonlari (
    ozet TEXT PRIMARY KEY,
    rol TEXT NOT NULL,
    nesil INTEGER,
    is_id INTEGER,
    plan_id TEXT,
    plan_hash TEXT
  ) STRICT;

  CREATE TABLE kirli_okumalar (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    is_id INTEGER NOT NULL,
    nesil INTEGER NOT NULL,
    ts_ms INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX kirli_okumalar_nesil ON kirli_okumalar (nesil);
  `,
];

/** SQL metin değişmezi: göç metnine sabit gömmek için (tek tırnak ikilenir). */
const sqlMetni = (s: string): string => `'${s.replaceAll("'", "''")}'`;
const ANA_SQL = sqlMetni(ANA_SOHBET_ID);

/** Ek göç sayacının tablosu: `anahtar='ek_surum'`. Ek göçlerle aynı işlemde kurulur. */
const SEMA_EK_TABLOSU = "CREATE TABLE IF NOT EXISTS sema_ek (anahtar TEXT PRIMARY KEY, deger INTEGER NOT NULL) STRICT";

/**
 * Ek (geriye uyumlu, yalnız ekleme) göçler, ileri yönlü: `EK_GOCLER[n]` ek sürüm n'den n+1'e çıkarır.
 * Her biri kendi işleminde uygulanır, `sema_ek.ek_surum` aynı işlemde artar. Kural: yalnız eski kodun
 * görmezden gelebileceği şey eklenir (varsayılanlı sütun, yeni tablo, dizin); yeniden adlandırma,
 * silme, `NOT NULL` varsayılansız sütun ya da anlamı değişen sütun geriye uyumsuzdur, `SURUM` artar.
 */
/**
 * `anaAdi`: göç 3'ün `ana` satırına yazdığı ad (`DepoBagimliliklari.anaSohbetAdi`, servis için
 * `Ayar.asistanAdi`). Yalnız satır YOKKEN girer (`INSERT OR IGNORE`, göç bir kez koşar): mevcut
 * veritabanındaki ad yeniden adlandırılmaz. Göç metninin geri kalanı addan bağımsızdır.
 */
const ekGocler = (anaAdi: string): readonly string[] => [
  // 1: iş profili (K5). Plan JSON'una ve `plan_hash`'e girmez; eski satırlar `tam` okunur.
  "ALTER TABLE planlar ADD COLUMN profil TEXT NOT NULL DEFAULT 'tam'",
  // 2: ana oturum kimlikleri (transkript silme, servis yeniden başlasa da) ve `events(type)` dizini
  // (`sonMezarTasi` her `--resume` kararında tam tarama yapmasın). Eski kod tabloyu görmez, dizini
  // SQLite kendisi günceller. `IF NOT EXISTS`: sayaç geri kalmış (elle ya da kısmen geri sarılmış)
  // bir dosyada göç yeniden uygulanabilsin.
  `
  CREATE TABLE IF NOT EXISTS eren_oturumlari (
    session_id TEXT PRIMARY KEY,
    olusturma_ms INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS events_tur ON events (type);
  `,
  // 3: çoklu sohbet (dilim 2, MODULLER.md "Dilim 2" > "Şema"). Önceki bütün geçmiş `ana`'nındır
  // (sütun varsayılanı); `ana` için `chat_created` yazılmaz. `events.sohbet_id` NULL alabilir (küresel
  // olay); `kopru_jetonlari.sohbet_id` yalnız `eren` satırında dolar. Eski kod yeni şemayı açar: bütün
  // `INSERT`'leri sütun adlıdır, yeni sütunlar varsayılanlıdır. `ALTER ... ADD COLUMN` yinelenemez:
  // sayacı elle geri sarılmış dosyada göç atar, açılış durur (bilinçli).
  `
  CREATE TABLE IF NOT EXISTS sohbetler (
    sohbet_id TEXT PRIMARY KEY,
    ad TEXT NOT NULL,
    olusturma_ms INTEGER NOT NULL,
    son_etkinlik_ms INTEGER NOT NULL,
    silinme_ms INTEGER
  ) STRICT;
  INSERT OR IGNORE INTO sohbetler (sohbet_id, ad, olusturma_ms, son_etkinlik_ms, silinme_ms)
    SELECT ${ANA_SQL}, ${sqlMetni(anaAdi)}, COALESCE(MIN(ts_ms), 0), COALESCE(MAX(ts_ms), 0), NULL FROM events;
  ALTER TABLE turns ADD COLUMN sohbet_id TEXT NOT NULL DEFAULT ${ANA_SQL};
  ALTER TABLE nesiller ADD COLUMN sohbet_id TEXT NOT NULL DEFAULT ${ANA_SQL};
  ALTER TABLE planlar ADD COLUMN sohbet_id TEXT NOT NULL DEFAULT ${ANA_SQL};
  ALTER TABLE isler ADD COLUMN sohbet_id TEXT NOT NULL DEFAULT ${ANA_SQL};
  ALTER TABLE eren_kuyrugu ADD COLUMN sohbet_id TEXT NOT NULL DEFAULT ${ANA_SQL};
  ALTER TABLE kirli_okumalar ADD COLUMN sohbet_id TEXT NOT NULL DEFAULT ${ANA_SQL};
  ALTER TABLE eren_oturumlari ADD COLUMN sohbet_id TEXT NOT NULL DEFAULT ${ANA_SQL};
  ALTER TABLE events ADD COLUMN sohbet_id TEXT DEFAULT ${ANA_SQL};
  ALTER TABLE kopru_jetonlari ADD COLUMN sohbet_id TEXT;
  CREATE INDEX IF NOT EXISTS events_sohbet ON events (sohbet_id, seq);
  CREATE INDEX IF NOT EXISTS nesiller_sohbet ON nesiller (sohbet_id, nesil);
  CREATE INDEX IF NOT EXISTS eren_kuyrugu_sohbet ON eren_kuyrugu (sohbet_id, id);
  `,
  // 4: tüketim (sonuç başına model başına bir satır; yalnız sayı ve kimlik, içerik yok). Yalnız yeni
  // tablo ve dizinleri: var olan hiçbir tabloya dokunmaz, eski kod tabloyu görmez. `IF NOT EXISTS`:
  // sayacı geri kalmış bir dosyada yeniden uygulanabilir. Otomatik silme yok; `gecmisiTemizle` ve
  // `sohbetiSil` bu tabloya dokunmaz.
  `
  CREATE TABLE IF NOT EXISTS tuketim (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts_ms INTEGER NOT NULL,
    kaynak TEXT NOT NULL,
    sohbet_id TEXT NOT NULL,
    is_id INTEGER,
    turn_id TEXT,
    nesil INTEGER,
    rol TEXT,
    model TEXT NOT NULL,
    girdi INTEGER NOT NULL,
    cache_yazma INTEGER NOT NULL,
    cache_okuma INTEGER NOT NULL,
    cikti INTEGER NOT NULL,
    maliyet_usd REAL,
    olcum TEXT NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS tuketim_zaman ON tuketim (ts_ms);
  CREATE INDEX IF NOT EXISTS tuketim_sohbet ON tuketim (sohbet_id, ts_ms);
  CREATE INDEX IF NOT EXISTS tuketim_is ON tuketim (is_id) WHERE is_id IS NOT NULL;
  `,
];

/** Mezar taşının olay türü. Silinmeyenler listesi ayrıca `SILINMEZ_OLAY_TURLERI`'nden okunur. */
const MEZAR_TASI_TURU = "chat_cleared" satisfies MezarTasiOlayi["type"];
/** Sohbet silindi olayının türü (`chat_deleted`), `SILINMEZ_OLAY_TURLERI`'nde. */
const SOHBET_SILINDI_TURU = "chat_deleted" satisfies SohbetSilindiOlayi["type"];
/** `sohbet_id`'siz yazılabilen tek olay türü: küresel not (`events.sohbet_id` NULL). */
const KURESEL_OLAY_TURU = "system_notice" satisfies Olay["type"];

/** `type NOT IN (...)` için silinmeyen türler, parametre olarak. */
const SILINMEZLER = SILINMEZ_OLAY_TURLERI as readonly string[];
const SILINMEZ_YER = SILINMEZLER.map(() => "?").join(", ");

/**
 * `events` için sohbet süzgeci. Yalnız `gecmisiTemizle` ve `sonMezarTasi` kullanır: `ANA_SOHBET_ID`
 * için `sohbet_id IS NULL` (küresel ya da sütunsuz yazılmış) olaylar da `ana`'nındır. Diğer bütün
 * süzgeçler düz `sohbet_id = ?`'dir.
 */
const olaySohbetSuzgeci = (sohbet_id: string): string =>
  sohbet_id === ANA_SOHBET_ID ? "(sohbet_id = ? OR sohbet_id IS NULL)" : "sohbet_id = ?";

type Satir = Record<string, unknown>;

const AKTIF_DURUMLAR = "('baslatiliyor','calisiyor','soru_bekliyor')";

const sayi = (v: unknown): number => Number(v);
const sayiVeyaNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const metinVeyaNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const boolVeyaNull = (v: unknown): boolean | null => (v === null || v === undefined ? null : Number(v) !== 0);
const ikili = (b: boolean | null | undefined): number | null => (b === null || b === undefined ? null : b ? 1 : 0);
const jsonVeyaNull = (v: unknown): string | null => (v === null || v === undefined ? null : JSON.stringify(v));

/** Kısmi güncelleme için sütun haritası: alan adı -> değeri sütuna çeviren işlev. */
type Donusum = (v: never) => SQLInputValue;
type SutunHaritasi = Readonly<Record<string, Donusum>>;

const ham: Donusum = ((v: SQLInputValue) => v) as unknown as Donusum;
const bool: Donusum = ((v: boolean | null) => ikili(v)) as unknown as Donusum;
const json: Donusum = ((v: unknown) => jsonVeyaNull(v)) as unknown as Donusum;

const NESIL_SUTUNLARI: SutunHaritasi = {
  session_id: ham,
  baslangic_ms: ham,
  bitis_ms: ham,
  ozet_kabul: bool,
  pid: ham,
  olusturma_ms: ham,
  son_dolu: ham,
  pencere: ham,
};

const IS_SUTUNLARI: SutunHaritasi = {
  plan_id: ham,
  plan_hash: ham,
  baslik: ham,
  tur: ham,
  cwd: ham,
  durum: ham,
  kirli: bool,
  session_id: ham,
  pid: ham,
  olusturma_ms: ham,
  baslangic_ms: ham,
  bitis_ms: ham,
  out_ofset: ham,
  rapor: json,
  rapor_kaynak: ham,
  son_result: json,
  durdurma: ham,
};

const turSatiri = (r: Satir): TurKaydi => ({
  turn_id: String(r.turn_id),
  sohbet_id: String(r.sohbet_id),
  nesil: sayi(r.nesil),
  kaynak: String(r.kaynak) as TurKaydi["kaynak"],
  gorunur: Number(r.gorunur) !== 0,
  baslangic_ms: sayi(r.baslangic_ms),
  bitis_ms: sayiVeyaNull(r.bitis_ms),
  bitis: metinVeyaNull(r.bitis) as TurBitisi | null,
  kismi_metin: String(r.kismi_metin),
});

const nesilSatiri = (r: Satir): NesilKaydi => ({
  nesil: sayi(r.nesil),
  sohbet_id: String(r.sohbet_id),
  session_id: String(r.session_id),
  baslangic_ms: sayi(r.baslangic_ms),
  bitis_ms: sayiVeyaNull(r.bitis_ms),
  ozet_kabul: boolVeyaNull(r.ozet_kabul),
  pid: sayiVeyaNull(r.pid),
  olusturma_ms: sayiVeyaNull(r.olusturma_ms),
  son_dolu: sayiVeyaNull(r.son_dolu),
  pencere: sayiVeyaNull(r.pencere),
});

/**
 * 0.5.0 öncesi plan JSON'u (`planlar.plan`, `plan_proposed` olayının `plan`'ı) bu iki anahtarı taşır;
 * katı `Plan` onları reddeder. Göç yok: okurken atılır, satır yerinde kalır. Saklanan `plan_hash` eski
 * metnin hash'idir; böyle bir plan `planlar`'ın hash denetiminden geçmez, başlatılamaz (güvenli yön).
 */
const ESKI_PLAN_ANAHTARLARI: readonly string[] = ["kesin_yapilacaklar", "kesin_yapilmayacaklar"];

const eskiPlanAnahtarlariniAt = (ham: unknown): unknown => {
  if (ham === null || typeof ham !== "object" || Array.isArray(ham)) return ham;
  if (!ESKI_PLAN_ANAHTARLARI.some((a) => Object.hasOwn(ham, a))) return ham;
  return Object.fromEntries(Object.entries(ham).filter(([a]) => !ESKI_PLAN_ANAHTARLARI.includes(a)));
};

/**
 * `planlar.profil` sütunu: `IsProfili` değilse (elle bozulmuş satır) `tam` okunur ve günlüğe uyarı
 * düşer. Değerin kendisi günlüğe yazılmaz, yalnız `plan_id`.
 */
const planSatiri = (r: Satir, gunluk: Gunluk): PlanKaydi => {
  const plan = Plan.parse(eskiPlanAnahtarlariniAt(JSON.parse(String(r.plan))));
  const profil = IsProfili.safeParse(r.profil);
  if (!profil.success) gunluk.uyari("depo", "gecersiz_profil", { plan_id: plan.plan_id });
  return {
    plan,
    plan_hash: String(r.plan_hash),
    durum: String(r.durum) as PlanDurumu,
    is_id: sayiVeyaNull(r.is_id),
    olusturma_ms: sayi(r.olusturma_ms),
    profil: profil.success ? profil.data : VARSAYILAN_IS_PROFILI,
    sohbet_id: String(r.sohbet_id),
  };
};

/** `events` satırı -> `Olay`. `veri` `type` dahil gövdedir; `seq` ve `ts_ms` sütundan gelir. */
const olaySatiri = (r: Satir): Olay => {
  const veri = JSON.parse(String(r.veri)) as Record<string, unknown>;
  // Eski `plan_proposed` kartı geçmişte kalır; planı yeni şemaya uyar (`eskiPlanAnahtarlariniAt`).
  if (veri["type"] === "plan_proposed") veri["plan"] = eskiPlanAnahtarlariniAt(veri["plan"]);
  return { ...veri, seq: sayi(r.seq), ts_ms: sayi(r.ts_ms) } as Olay;
};

const isSatiri = (r: Satir): IsKaydi => ({
  is_id: sayi(r.is_id),
  sohbet_id: String(r.sohbet_id),
  plan_id: String(r.plan_id),
  plan_hash: String(r.plan_hash),
  baslik: String(r.baslik),
  tur: String(r.tur) as IsKaydi["tur"],
  cwd: String(r.cwd),
  durum: String(r.durum) as IsKaydi["durum"],
  kirli: Number(r.kirli) !== 0,
  session_id: String(r.session_id),
  pid: sayiVeyaNull(r.pid),
  olusturma_ms: sayiVeyaNull(r.olusturma_ms),
  baslangic_ms: sayi(r.baslangic_ms),
  bitis_ms: sayiVeyaNull(r.bitis_ms),
  out_ofset: sayi(r.out_ofset),
  rapor: r.rapor === null ? null : (JSON.parse(String(r.rapor)) as IsKaydi["rapor"]),
  rapor_kaynak: metinVeyaNull(r.rapor_kaynak) as IsKaydi["rapor_kaynak"],
  son_result: r.son_result === null ? null : (JSON.parse(String(r.son_result)) as IsKaydi["son_result"]),
  durdurma: metinVeyaNull(r.durdurma) as IsKaydi["durdurma"],
});

const soruSatiri = (r: Satir): SoruKaydi => ({
  soru_id: String(r.soru_id),
  is_id: sayi(r.is_id),
  soru: String(r.soru),
  secenekler: r.secenekler === null ? null : (JSON.parse(String(r.secenekler)) as string[]),
  durum: String(r.durum) as SoruDurumu,
  cevap: metinVeyaNull(r.cevap),
  olusturma_ms: sayi(r.olusturma_ms),
  son_ms: sayi(r.son_ms),
});

const cihazSatiri = (r: Satir): CihazKaydi => ({
  device_id: String(r.device_id),
  public_key: String(r.public_key),
  tailscale_ip: String(r.tailscale_ip),
  platform: String(r.platform) as CihazKaydi["platform"],
  etiket: metinVeyaNull(r.etiket),
  eslesme_ms: sayi(r.eslesme_ms),
});

const kuyrukSatiri = (r: Satir): ErenKuyrukSatiri => ({
  id: sayi(r.id),
  sohbet_id: String(r.sohbet_id),
  kaynak: String(r.kaynak) as ErenKuyrukKaynagi,
  metin: String(r.metin),
  olusturma_ms: sayi(r.olusturma_ms),
});

const sohbetSatiri = (r: Satir): SohbetKaydi => ({
  sohbet_id: String(r.sohbet_id),
  ad: String(r.ad),
  olusturma_ms: sayi(r.olusturma_ms),
  son_etkinlik_ms: sayi(r.son_etkinlik_ms),
  silinme_ms: sayiVeyaNull(r.silinme_ms),
});

// --- Tüketim (ek göç 4) ---

const TUKETIM_ROLLERI: ReadonlySet<unknown> = new Set(["normal", "devir_istek", "devir_ilk", null]);
const TUKETIM_OLCUMLERI: ReadonlySet<unknown> = new Set(["model_farki", "ana_usage"]);
/** `TuketimToplami.maliyet_usd` üst sınırı (protokol şeması). */
const MALIYET_UST = 1e7;

/**
 * Yazmadan önce denetim: özetin protokol şemasından geçmesi için gereken her şey (sayaçlar, `is_id` ile
 * `kaynak` eşleşmesi). `turn_id`/`nesil`'in yalnız `sohbet`'te dolu olması burada zorlanmaz: özeti
 * etkilemez, atmak ise `islem` içindeki çağıranın (iş: `out_ofset`) işlemini geri alırdı.
 */
const tuketimDenetle = (k: TuketimKaydi): void => {
  const hata = (alan: string): never => {
    throw new Error(`depo: geçersiz tüketim alanı (${alan})`);
  };
  if (!Sayac.safeParse(k.ts_ms).success) hata("ts_ms");
  if (k.kaynak !== "sohbet" && k.kaynak !== "is") hata("kaynak");
  if (!SohbetId.safeParse(k.sohbet_id).success) hata("sohbet_id");
  if (k.kaynak === "is" ? !IsId.safeParse(k.is_id).success : k.is_id !== null) hata("is_id");
  if (k.turn_id !== null && typeof k.turn_id !== "string") hata("turn_id");
  if (k.nesil !== null && !Number.isSafeInteger(k.nesil)) hata("nesil");
  if (!TUKETIM_ROLLERI.has(k.rol)) hata("rol");
  if (typeof k.model !== "string") hata("model");
  for (const alan of ["girdi", "cache_yazma", "cache_okuma", "cikti"] as const) {
    if (!Sayac.safeParse(k[alan]).success) hata(alan);
  }
  if (k.maliyet_usd !== null && !(Number.isFinite(k.maliyet_usd) && k.maliyet_usd >= 0)) hata("maliyet_usd");
  if (!TUKETIM_OLCUMLERI.has(k.olcum)) hata("olcum");
};

/**
 * Bir sonucun kimliği: `tuketimKayitlari` bir sonucun bütün satırlarına aynı bağlamı (`ts_ms` dahil)
 * verir, tabloda sonuç kimliği yoktur. `sonuc_adet` bu sütunlara göre gruplanmış sonuç sayısıdır
 * (`GROUP BY` NULL'ları eşit sayar). Varsayım: aynı bağlamda iki sonuç aynı milisaniyede işlenmez.
 */
const SONUC_ANAHTARI = "ts_ms, kaynak, sohbet_id, is_id, turn_id, nesil, rol";

/**
 * Önce sonuç başına, sonra `dis` sütunlarına göre toplar. `maliyetli`: maliyeti bilinen satır sayısı
 * (`maliyet_usd` yalnız > 0 ise yazılır). `kosul` sabit SQL'dir, değerler parametreyle girer.
 */
const tuketimToplamSql = (dis: string, kosul: string, son = ""): string => `
  SELECT ${dis}, SUM(girdi) AS girdi, SUM(cache_yazma) AS cache_yazma, SUM(cache_okuma) AS cache_okuma,
         SUM(cikti) AS cikti, COUNT(*) AS sonuc_adet, SUM(maliyet) AS maliyet, SUM(maliyetli) AS maliyetli
  FROM (
    SELECT ${SONUC_ANAHTARI}, SUM(girdi) AS girdi, SUM(cache_yazma) AS cache_yazma,
           SUM(cache_okuma) AS cache_okuma, SUM(cikti) AS cikti, SUM(maliyet_usd) AS maliyet,
           COUNT(maliyet_usd) AS maliyetli
    FROM tuketim WHERE ${kosul} GROUP BY ${SONUC_ANAHTARI}
  )
  GROUP BY ${dis} ${son}`;

/** Toplama ara durumu: satırlar (ya da gruplar) üst üste eklenir, `tuketimToplami` kapatır. */
interface TuketimBirikimi {
  girdi: number;
  cache_yazma: number;
  cache_okuma: number;
  cikti: number;
  sonuc_adet: number;
  maliyet: number;
  maliyetli: number;
}
const bosBirikim = (): TuketimBirikimi => ({
  girdi: 0,
  cache_yazma: 0,
  cache_okuma: 0,
  cikti: 0,
  sonuc_adet: 0,
  maliyet: 0,
  maliyetli: 0,
});
const birikimeEkle = (a: TuketimBirikimi, r: Satir): void => {
  a.girdi += sayi(r.girdi ?? 0);
  a.cache_yazma += sayi(r.cache_yazma ?? 0);
  a.cache_okuma += sayi(r.cache_okuma ?? 0);
  a.cikti += sayi(r.cikti ?? 0);
  a.sonuc_adet += sayi(r.sonuc_adet ?? 0);
  a.maliyet += sayi(r.maliyet ?? 0);
  a.maliyetli += sayi(r.maliyetli ?? 0);
};
const tuketimToplami = (a: TuketimBirikimi): TuketimToplami => {
  const t: TuketimToplami = {
    girdi: a.girdi,
    cache_yazma: a.cache_yazma,
    cache_okuma: a.cache_okuma,
    cikti: a.cikti,
    sonuc_adet: a.sonuc_adet,
  };
  if (a.maliyetli > 0) t.maliyet_usd = Math.min(MALIYET_UST, Math.max(0, a.maliyet));
  return t;
};
/** `kaynak` sütunlu satırlardan ikili. */
const tuketimIkilisi = (satirlar: readonly Satir[]): TuketimIkilisi => {
  const sohbet = bosBirikim();
  const is = bosBirikim();
  for (const r of satirlar) birikimeEkle(String(r.kaynak) === "is" ? is : sohbet, r);
  return { sohbet: tuketimToplami(sohbet), is: tuketimToplami(is) };
};

/** Kapsamı sütunlara açar; kullanılmayan sütun `null` kalır. `sohbet_id` yalnız `eren`'de dolu. */
const kapsamSutunlari = (k: JetonKapsami) => ({
  rol: k.rol,
  sohbet_id: k.rol === "eren" ? k.sohbet_id : null,
  nesil: k.rol === "eren" ? k.nesil : null,
  is_id: k.rol === "eren" ? null : k.is_id,
  plan_id: k.rol === "telefon" ? k.plan_id : null,
  plan_hash: k.rol === "telefon" ? k.plan_hash : null,
});

export const depoKur: DepoFabrikasi = (b) => {
  const EK_GOCLER = ekGocler(anaSohbetAdiUret(b.anaSohbetAdi));
  const db = new DatabaseSync(b.yol);
  const hazirlar = new Map<string, StatementSync>();
  let kapali = false;

  const hazir = (sql: string): StatementSync => {
    let s = hazirlar.get(sql);
    if (s === undefined) {
      s = db.prepare(sql);
      hazirlar.set(sql, s);
    }
    return s;
  };
  const calistir = (sql: string, ...p: SQLInputValue[]): { changes: number; kimlik: number } => {
    const s = hazir(sql).run(...p);
    return { changes: Number(s.changes), kimlik: Number(s.lastInsertRowid) };
  };
  const bir = (sql: string, ...p: SQLInputValue[]): Satir | null => {
    const r = hazir(sql).get(...p);
    return r === undefined ? null : (r as Satir);
  };
  const hepsi = (sql: string, ...p: SQLInputValue[]): Satir[] => hazir(sql).all(...p) as Satir[];

  // Açılış. `busy_timeout` önce: WAL'a geçiş ve göç ikinci süreçle yarışabilir.
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = FULL");
  db.exec("PRAGMA foreign_keys = ON");

  const surumOku = (): number => Number((db.prepare("PRAGMA user_version").get() as Satir).user_version);
  if (surumOku() !== SURUM) {
    db.exec("BEGIN IMMEDIATE");
    try {
      let mevcut = surumOku(); // kilit altında yeniden oku: öteki süreç göçü bitirmiş olabilir
      if (mevcut > SURUM) throw new Error(`depo: veritabani sürümü yeni (${mevcut} > ${SURUM})`);
      while (mevcut < SURUM) {
        db.exec(GOCLER[mevcut] as string);
        mevcut += 1;
        db.exec(`PRAGMA user_version = ${mevcut}`);
      }
      db.exec("COMMIT");
    } catch (e) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // işlem zaten kapanmış olabilir
      }
      db.close();
      throw e;
    }
  }

  // Ek göçler. Sayaç tablosu ilk ek göçle aynı işlemde kurulur; hazır ifade önbelleği kullanılmaz
  // (tablo henüz yokken hazırlanan ifade atar).
  const ekSurumOku = (): number => {
    const tablo = db.prepare("SELECT 1 AS var FROM sqlite_master WHERE type = 'table' AND name = 'sema_ek'").get();
    if (tablo === undefined) return 0;
    const r = db.prepare("SELECT deger FROM sema_ek WHERE anahtar = 'ek_surum'").get() as Satir | undefined;
    return r === undefined ? 0 : Number(r.deger);
  };
  let ekSurum = ekSurumOku();
  while (ekSurum < EK_GOCLER.length) {
    db.exec("BEGIN IMMEDIATE");
    try {
      ekSurum = ekSurumOku(); // kilit altında yeniden oku: öteki süreç bu göçü bitirmiş olabilir
      if (ekSurum < EK_GOCLER.length) {
        db.exec(SEMA_EK_TABLOSU);
        db.exec(EK_GOCLER[ekSurum] as string);
        ekSurum += 1;
        db.prepare(
          "INSERT INTO sema_ek (anahtar, deger) VALUES ('ek_surum', ?) ON CONFLICT (anahtar) DO UPDATE SET deger = excluded.deger",
        ).run(ekSurum);
      }
      db.exec("COMMIT");
    } catch (e) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // işlem zaten kapanmış olabilir
      }
      db.close();
      throw e;
    }
  }
  // `ekSurum > EK_GOCLER.length`: dosyayı daha yeni bir sürüm göç ettirmiş (geri alma). Ek göçler
  // geriye uyumlu olduğu için açılış sürer; bu kod tanımadığı sütun ve tabloları okumaz.

  // Silinen satırların içeriği dosyada sıfırlanır ("geçmişi sil"). Bağlantıya özgüdür, kalıcı değil:
  // her açılışta (ikinci süreç `eslestir` dahil) yeniden verilir.
  db.exec("PRAGMA secure_delete = ON");
  b.gunluk.bilgi("depo", "acildi", { surum: SURUM, ek_surum: ekSurum });

  // --- işlem ---
  let derinlik = 0;
  let bekleyenOlaylar: Olay[] = [];

  const islem = <T>(f: () => T): T => {
    if (derinlik > 0) {
      derinlik += 1;
      try {
        return f();
      } finally {
        derinlik -= 1;
      }
    }
    db.exec("BEGIN IMMEDIATE");
    derinlik = 1;
    let sonuc: T;
    try {
      sonuc = f();
      db.exec("COMMIT");
    } catch (e) {
      bekleyenOlaylar = [];
      derinlik = 0;
      try {
        db.exec("ROLLBACK");
      } catch {
        // COMMIT başarısız olduysa işlem açık kalmış olabilir; kapanmışsa yapacak şey yok
      }
      throw e;
    }
    derinlik = 0;
    const yayinlanacak = bekleyenOlaylar;
    bekleyenOlaylar = [];
    if (b.veriyolu !== undefined) {
      for (const olay of yayinlanacak) b.veriyolu.yayinla("olay_yazildi", { olay });
    }
    return sonuc;
  };

  const kismiGuncelle = (
    tablo: string,
    anahtarSutun: string,
    anahtar: SQLInputValue,
    harita: SutunHaritasi,
    alanlar: object,
  ): void => {
    const atamalar: string[] = [];
    const degerler: SQLInputValue[] = [];
    for (const [ad, deger] of Object.entries(alanlar)) {
      if (deger === undefined) continue;
      const donustur = harita[ad];
      if (donustur === undefined) throw new Error(`depo: ${tablo} için bilinmeyen alan ${ad}`);
      atamalar.push(`${ad} = ?`);
      degerler.push((donustur as (v: unknown) => SQLInputValue)(deger));
    }
    if (atamalar.length === 0) return;
    const r = calistir(`UPDATE ${tablo} SET ${atamalar.join(", ")} WHERE ${anahtarSutun} = ?`, ...degerler, anahtar);
    if (r.changes === 0) b.gunluk.uyari("depo", "guncellenecek_kayit_yok", { tablo });
  };

  /**
   * Kendi kayıt noktasında çalıştırır (dilim 1 deseni): dıştaki işlem hatayı yakalayıp sürse bile yarım
   * silme kalmaz, bu adımda biriken yayınlar da düşer. `islem` içinden çağrılır.
   */
  const kayitNoktasinda = <T>(ad: string, f: () => T): T => {
    const yayinOncesi = bekleyenOlaylar.length;
    db.exec(`SAVEPOINT ${ad}`);
    try {
      const sonuc = f();
      db.exec(`RELEASE ${ad}`);
      return sonuc;
    } catch (e) {
      bekleyenOlaylar.splice(yayinOncesi);
      try {
        db.exec(`ROLLBACK TO ${ad}`);
        db.exec(`RELEASE ${ad}`);
      } catch {
        // işlem kapanmışsa dıştaki `islem` geri alır
      }
      throw e;
    }
  };

  /**
   * `gecmisiTemizle` ve `sohbetiSil`'in ortak silmesi, yalnız o sohbetin satırları: `SILINMEZ_OLAY_TURLERI`
   * dışındaki olaylar (`sinir_seq` verilirse yalnız `seq <= sinir_seq`; `ana` için `sohbet_id IS NULL`
   * dahil), kapalı turların kısmi metni, kuyruğun tamamı (sentetik "İş N bitti" notu da: ana oturum unutur).
   */
  const sohbetIceriginiSil = (
    sohbet_id: string,
    sinir_seq: number | null,
  ): { silinen_olay: number; bosaltilan_tur: number; silinen_kuyruk: number } => {
    const seqKosulu = sinir_seq === null ? "" : "seq <= ? AND ";
    const seqDegeri: SQLInputValue[] = sinir_seq === null ? [] : [sinir_seq];
    const silinen_olay = calistir(
      `DELETE FROM events WHERE ${seqKosulu}${olaySohbetSuzgeci(sohbet_id)} AND type NOT IN (${SILINMEZ_YER})`,
      ...seqDegeri,
      sohbet_id,
      ...SILINMEZLER,
    ).changes;
    const bosaltilan_tur = calistir(
      "UPDATE turns SET kismi_metin = '' WHERE sohbet_id = ? AND bitis_ms IS NOT NULL AND kismi_metin <> ''",
      sohbet_id,
    ).changes;
    const silinen_kuyruk = calistir("DELETE FROM eren_kuyrugu WHERE sohbet_id = ?", sohbet_id).changes;
    return { silinen_olay, bosaltilan_tur, silinen_kuyruk };
  };

  const depo: Depo = {
    islem,
    kapat() {
      if (kapali) return;
      kapali = true;
      hazirlar.clear();
      db.close();
    },

    olayEkle(girdi: OlayGirdisi): Olay {
      const ts_ms = b.saat.simdiMs();
      // `seq` yer tutucudur: şema `seq >= 1` ister, gerçeği eklemeden sonra bilinir.
      const dogru = Olay.parse({ ...girdi, seq: 1, ts_ms });
      // Dilim 2: sohbete bağlı her olay `sohbet_id` ile yazılır (`ana` dahil); alansız yalnız küresel
      // not olabilir. Unutulan alan sessizce `ana`'ya düşmesin: yazmadan atar (dıştaki işlem geri alınır).
      if (dogru.sohbet_id === undefined && dogru.type !== KURESEL_OLAY_TURU) {
        throw new Error(`depo: ${dogru.type} olayı sohbet_id'siz yazılamaz`);
      }
      const { seq: _seq, ts_ms: _ts, ...govde } = dogru;
      const ekle = (): Olay => {
        // Sütun JSON gövdesindeki alanla aynı değer; alansız küresel not NULL.
        const r = calistir(
          "INSERT INTO events (ts_ms, type, veri, sohbet_id) VALUES (?, ?, ?, ?)",
          ts_ms,
          dogru.type,
          JSON.stringify(govde),
          dogru.sohbet_id ?? null,
        );
        const olay = { ...dogru, seq: r.kimlik } as Olay;
        bekleyenOlaylar.push(olay);
        return olay;
      };
      return islem(ekle);
    },
    olaylariGetir(sonSeq, adet) {
      return hepsi("SELECT seq, ts_ms, veri FROM events WHERE seq > ? ORDER BY seq LIMIT ?", sonSeq, adet).map(olaySatiri);
    },
    basSeq() {
      return sayi((bir("SELECT COALESCE(MAX(seq), 0) AS s FROM events") as Satir).s);
    },
    sonKonusma(adet, sohbet): KonusmaSatiri[] {
      const satirlar = hepsi(
        // `+type`: `events_tur` dizini kullanılmasın; `events_sohbet (sohbet_id, seq)` ile o sohbetin
        // satırları sondan taranıp `adet` satırda durulur.
        `SELECT type, ts_ms, json_extract(veri, '$.text') AS metin, json_extract(veri, '$.input') AS girdi,
                json_extract(veri, '$.baglam.paket') AS paket, json_extract(veri, '$.baglam.ad') AS ad FROM events
         WHERE sohbet_id = ? AND +type IN ('user_echo', 'assistant_message') ORDER BY seq DESC LIMIT ?`,
        sohbet.sohbet_id,
        adet,
      );
      return satirlar.reverse().map((r) => ({
        rol: r.type === "user_echo" ? "kullanici" : "eren",
        metin: String(r.metin),
        ts_ms: sayi(r.ts_ms),
        ...(r.type === "user_echo" &&
          r.girdi === "kisayol" && {
            kisayol: r.paket === null || r.ad === null ? {} : { baglam: { paket: String(r.paket), ad: String(r.ad) } },
          }),
      }));
    },

    ackBul(device_id, client_msg_id) {
      const r = bir("SELECT ok, seq, code FROM acklar WHERE device_id = ? AND client_msg_id = ?", device_id, client_msg_id);
      if (r === null) return null;
      const ack: AckGovdesi = { ok: Number(r.ok) !== 0 };
      if (r.seq !== null) ack.seq = sayi(r.seq);
      if (r.code !== null) ack.code = String(r.code) as AckGovdesi["code"];
      return ack;
    },
    ackYaz(device_id, client_msg_id, ack) {
      // İlk yazılan kazanır: aynı `client_msg_id` hep aynı cevabı alır.
      calistir(
        "INSERT OR IGNORE INTO acklar (device_id, client_msg_id, ok, seq, code) VALUES (?, ?, ?, ?, ?)",
        device_id,
        client_msg_id,
        ack.ok ? 1 : 0,
        ack.seq ?? null,
        ack.code ?? null,
      );
    },

    turEkle(t) {
      calistir(
        `INSERT INTO turns (turn_id, sohbet_id, nesil, kaynak, gorunur, baslangic_ms, bitis_ms, bitis, kismi_metin)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        t.turn_id,
        t.sohbet_id,
        t.nesil,
        t.kaynak,
        t.gorunur ? 1 : 0,
        t.baslangic_ms,
        t.bitis_ms,
        t.bitis,
        t.kismi_metin,
      );
    },
    turKismiYaz(turn_id, kismi_metin) {
      calistir("UPDATE turns SET kismi_metin = ? WHERE turn_id = ?", kismi_metin, turn_id);
    },
    turBitir(turn_id, bitis, kismi_metin, ms) {
      calistir("UPDATE turns SET bitis = ?, kismi_metin = ?, bitis_ms = ? WHERE turn_id = ?", bitis, kismi_metin, ms, turn_id);
    },
    turGetir(turn_id) {
      const r = bir("SELECT * FROM turns WHERE turn_id = ?", turn_id);
      return r === null ? null : turSatiri(r);
    },
    acikTurlar(sohbet) {
      return hepsi(
        "SELECT * FROM turns WHERE bitis_ms IS NULL AND sohbet_id = ? ORDER BY baslangic_ms, rowid",
        sohbet.sohbet_id,
      ).map(turSatiri);
    },

    nesilEkle(n) {
      calistir(
        `INSERT INTO nesiller (nesil, sohbet_id, session_id, baslangic_ms, bitis_ms, ozet_kabul, pid, olusturma_ms,
           son_dolu, pencere)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        n.nesil,
        n.sohbet_id,
        n.session_id,
        n.baslangic_ms,
        n.bitis_ms,
        ikili(n.ozet_kabul),
        n.pid,
        n.olusturma_ms,
        n.son_dolu,
        n.pencere,
      );
    },
    nesilGuncelle(nesil, alanlar) {
      kismiGuncelle("nesiller", "nesil", nesil, NESIL_SUTUNLARI, alanlar);
    },
    sonNesil(sohbet) {
      const r = bir("SELECT * FROM nesiller WHERE sohbet_id = ? ORDER BY nesil DESC LIMIT 1", sohbet.sohbet_id);
      return r === null ? null : nesilSatiri(r);
    },
    nesiller(sohbet) {
      return hepsi("SELECT * FROM nesiller WHERE sohbet_id = ? ORDER BY nesil", sohbet.sohbet_id).map(nesilSatiri);
    },
    enBuyukNesil() {
      return sayi((bir("SELECT COALESCE(MAX(nesil), 0) AS n FROM nesiller") as Satir).n);
    },

    planEkle(k) {
      const plan = Plan.parse(k.plan);
      // Profil sütuna gider, plan JSON'una değil (`Plan` katıdır, hash'e girmez). Sözleşme dışı
      // çağıranın unuttuğu profil varsayılana düşer; geçersiz değer atar, `Plan.parse` gibi.
      const profil = IsProfili.parse(k.profil ?? VARSAYILAN_IS_PROFILI);
      calistir(
        `INSERT INTO planlar (plan_id, plan, plan_hash, durum, is_id, olusturma_ms, profil, sohbet_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        plan.plan_id,
        JSON.stringify(plan),
        k.plan_hash,
        k.durum,
        k.is_id,
        k.olusturma_ms,
        profil,
        k.sohbet_id,
      );
    },
    planGetir(plan_id) {
      const r = bir("SELECT * FROM planlar WHERE plan_id = ?", plan_id);
      return r === null ? null : planSatiri(r, b.gunluk);
    },
    planGuncelle(plan_id, durum, is_id) {
      calistir("UPDATE planlar SET durum = ?, is_id = ? WHERE plan_id = ?", durum, is_id, plan_id);
    },
    bekleyenPlanlar(sohbet) {
      const satirlar =
        sohbet === undefined
          ? hepsi("SELECT * FROM planlar WHERE durum IN ('bekliyor', 'izin_bekliyor') ORDER BY olusturma_ms, rowid")
          : hepsi(
              `SELECT * FROM planlar WHERE durum IN ('bekliyor', 'izin_bekliyor') AND sohbet_id = ?
               ORDER BY olusturma_ms, rowid`,
              sohbet.sohbet_id,
            );
      return satirlar.map((r) => planSatiri(r, b.gunluk));
    },

    isEkle(k) {
      const r = calistir(
        `INSERT INTO isler (sohbet_id, plan_id, plan_hash, baslik, tur, cwd, durum, kirli, session_id, pid, olusturma_ms,
           baslangic_ms, bitis_ms, out_ofset, rapor, rapor_kaynak, son_result, durdurma)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        k.sohbet_id,
        k.plan_id,
        k.plan_hash,
        k.baslik,
        k.tur,
        k.cwd,
        k.durum,
        k.kirli ? 1 : 0,
        k.session_id,
        k.pid,
        k.olusturma_ms,
        k.baslangic_ms,
        k.bitis_ms,
        k.out_ofset,
        jsonVeyaNull(k.rapor),
        k.rapor_kaynak,
        jsonVeyaNull(k.son_result),
        k.durdurma,
      );
      return r.kimlik;
    },
    isGuncelle(is_id, alanlar) {
      kismiGuncelle("isler", "is_id", is_id, IS_SUTUNLARI, alanlar);
    },
    isGetir(is_id) {
      const r = bir("SELECT * FROM isler WHERE is_id = ?", is_id);
      return r === null ? null : isSatiri(r);
    },
    isPlanaGore(plan_id) {
      const r = bir("SELECT * FROM isler WHERE plan_id = ? ORDER BY is_id DESC LIMIT 1", plan_id);
      return r === null ? null : isSatiri(r);
    },
    isListele(yalnizAktif, adet, sohbet) {
      const kosullar: string[] = [];
      const degerler: SQLInputValue[] = [];
      if (yalnizAktif) kosullar.push(`durum IN ${AKTIF_DURUMLAR}`);
      if (sohbet !== undefined) {
        kosullar.push("sohbet_id = ?");
        degerler.push(sohbet.sohbet_id);
      }
      const nerede = kosullar.length === 0 ? "" : `WHERE ${kosullar.join(" AND ")} `;
      return hepsi(`SELECT * FROM isler ${nerede}ORDER BY is_id DESC LIMIT ?`, ...degerler, adet).map(isSatiri);
    },

    isPidEkle(k: IsPidKaydi) {
      // Aynı süreç ikinci kez görülürse ilk görülme anı korunur.
      calistir(
        `INSERT OR IGNORE INTO is_pidleri (is_id, pid, olusturma_ms, ad, ilk_gorulme_ms) VALUES (?, ?, ?, ?, ?)`,
        k.is_id,
        k.pid,
        k.olusturmaMs,
        k.ad,
        k.ilk_gorulme_ms,
      );
    },
    isPidleri(is_id) {
      return hepsi("SELECT * FROM is_pidleri WHERE is_id = ? ORDER BY ilk_gorulme_ms, rowid", is_id).map((r) => ({
        is_id: sayi(r.is_id),
        pid: sayi(r.pid),
        olusturmaMs: sayi(r.olusturma_ms),
        ad: String(r.ad),
        ilk_gorulme_ms: sayi(r.ilk_gorulme_ms),
      }));
    },

    soruEkle(k) {
      calistir(
        `INSERT INTO sorular (soru_id, is_id, soru, secenekler, durum, cevap, olusturma_ms, son_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        k.soru_id,
        k.is_id,
        k.soru,
        jsonVeyaNull(k.secenekler),
        k.durum,
        k.cevap,
        k.olusturma_ms,
        k.son_ms,
      );
    },
    soruGetir(soru_id) {
      const r = bir("SELECT * FROM sorular WHERE soru_id = ?", soru_id);
      return r === null ? null : soruSatiri(r);
    },
    soruGuncelle(soru_id, durum, cevap) {
      calistir("UPDATE sorular SET durum = ?, cevap = ? WHERE soru_id = ?", durum, cevap, soru_id);
    },
    bekleyenSorular(suzgec) {
      let satirlar: Satir[];
      if (suzgec === undefined) {
        satirlar = hepsi("SELECT * FROM sorular WHERE durum = 'bekliyor' ORDER BY olusturma_ms, rowid");
      } else if (typeof suzgec === "number") {
        satirlar = hepsi(
          "SELECT * FROM sorular WHERE durum = 'bekliyor' AND is_id = ? ORDER BY olusturma_ms, rowid",
          suzgec,
        );
      } else {
        // Sorunun kendi sohbet sütunu yok: sohbeti işinkidir (M4). İki tabloda da `durum` ve
        // `olusturma_ms` var, sütunlar nitelikli yazılır.
        satirlar = hepsi(
          `SELECT sorular.* FROM sorular JOIN isler USING (is_id)
           WHERE sorular.durum = 'bekliyor' AND isler.sohbet_id = ?
           ORDER BY sorular.olusturma_ms, sorular.rowid`,
          suzgec.sohbet_id,
        );
      }
      return satirlar.map(soruSatiri);
    },

    kuyrugaEkle(kaynak, metin, ms, sohbet) {
      return calistir(
        "INSERT INTO eren_kuyrugu (sohbet_id, kaynak, metin, olusturma_ms) VALUES (?, ?, ?, ?)",
        sohbet.sohbet_id,
        kaynak,
        metin,
        ms,
      ).kimlik;
    },
    kuyrukBasi(sohbet) {
      const r = bir("SELECT * FROM eren_kuyrugu WHERE sohbet_id = ? ORDER BY id LIMIT 1", sohbet.sohbet_id);
      return r === null ? null : kuyrukSatiri(r);
    },
    kuyrukSentetikBasi(adet, sohbet) {
      const bas: ErenKuyrukSatiri[] = [];
      const satirlar = hepsi("SELECT * FROM eren_kuyrugu WHERE sohbet_id = ? ORDER BY id LIMIT ?", sohbet.sohbet_id, adet);
      for (const r of satirlar) {
        const s = kuyrukSatiri(r);
        if (s.kaynak !== "sentetik") break;
        bas.push(s);
      }
      return bas;
    },
    kuyruktanSil(idler) {
      islem(() => {
        for (const id of idler) calistir("DELETE FROM eren_kuyrugu WHERE id = ?", id);
      });
    },

    cihazEkle(k) {
      calistir(
        `INSERT INTO cihazlar (device_id, public_key, tailscale_ip, platform, etiket, eslesme_ms)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (device_id) DO UPDATE SET public_key = excluded.public_key,
           tailscale_ip = excluded.tailscale_ip, platform = excluded.platform,
           etiket = excluded.etiket, eslesme_ms = excluded.eslesme_ms`,
        k.device_id,
        k.public_key,
        k.tailscale_ip,
        k.platform,
        k.etiket,
        k.eslesme_ms,
      );
    },
    cihazGetir(device_id) {
      const r = bir("SELECT * FROM cihazlar WHERE device_id = ?", device_id);
      return r === null ? null : cihazSatiri(r);
    },
    cihazlar() {
      return hepsi("SELECT * FROM cihazlar ORDER BY eslesme_ms, rowid").map(cihazSatiri);
    },

    eslestirmeYaz(k) {
      calistir(
        "INSERT OR REPLACE INTO eslestirme (id, kod_ozeti, son_ms, yanlis_deneme) VALUES (1, ?, ?, ?)",
        k.kod_ozeti,
        k.son_ms,
        k.yanlis_deneme,
      );
    },
    eslestirmeOku() {
      const r = bir("SELECT kod_ozeti, son_ms, yanlis_deneme FROM eslestirme WHERE id = 1");
      return r === null ? null : { kod_ozeti: String(r.kod_ozeti), son_ms: sayi(r.son_ms), yanlis_deneme: sayi(r.yanlis_deneme) };
    },
    eslestirmeYanlisSay() {
      calistir("UPDATE eslestirme SET yanlis_deneme = yanlis_deneme + 1 WHERE id = 1");
    },
    eslestirmeSil() {
      calistir("DELETE FROM eslestirme WHERE id = 1");
    },

    jetonEkle(k: JetonKaydi) {
      const s = kapsamSutunlari(k.kapsam);
      calistir(
        `INSERT OR REPLACE INTO kopru_jetonlari (ozet, rol, sohbet_id, nesil, is_id, plan_id, plan_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        k.ozet,
        s.rol,
        s.sohbet_id,
        s.nesil,
        s.is_id,
        s.plan_id,
        s.plan_hash,
      );
    },
    jetonBul(ozet) {
      const r = bir("SELECT * FROM kopru_jetonlari WHERE ozet = ?", ozet);
      if (r === null) return null;
      let kapsam: JetonKapsami;
      // Dilim 1 satırının `sohbet_id`'si NULL: `ana`'nındır.
      if (r.rol === "eren") {
        kapsam = { rol: "eren", sohbet_id: metinVeyaNull(r.sohbet_id) ?? ANA_SOHBET_ID, nesil: sayi(r.nesil) };
      } else if (r.rol === "soru") kapsam = { rol: "soru", is_id: sayi(r.is_id) };
      else
        kapsam = { rol: "telefon", is_id: sayi(r.is_id), plan_id: String(r.plan_id), plan_hash: String(r.plan_hash) };
      return { ozet: String(r.ozet), kapsam };
    },
    jetonlariSil(kapsam) {
      if (kapsam.rol === "eren") {
        // `ana` kapsamı NULL `sohbet_id`'li dilim 1 satırını da siler.
        calistir(
          `DELETE FROM kopru_jetonlari
           WHERE rol = 'eren' AND nesil = ? AND (sohbet_id = ? OR (? = ${ANA_SQL} AND sohbet_id IS NULL))`,
          kapsam.nesil,
          kapsam.sohbet_id,
          kapsam.sohbet_id,
        );
        return;
      }
      const s = kapsamSutunlari(kapsam);
      calistir(
        `DELETE FROM kopru_jetonlari WHERE rol = ? AND nesil IS ? AND is_id IS ? AND plan_id IS ? AND plan_hash IS ?`,
        s.rol,
        s.nesil,
        s.is_id,
        s.plan_id,
        s.plan_hash,
      );
    },
    erenJetonlariniSil() {
      return calistir("DELETE FROM kopru_jetonlari WHERE rol = 'eren'").changes;
    },

    kirliOkumaEkle(k: KirliOkumaKaydi) {
      calistir(
        "INSERT INTO kirli_okumalar (is_id, sohbet_id, nesil, ts_ms) VALUES (?, ?, ?, ?)",
        k.is_id,
        k.sohbet_id,
        k.nesil,
        k.ts_ms,
      );
    },
    kirliOkumalar(enAzNesil, sohbet): IsNo[] {
      return hepsi(
        `SELECT is_id FROM kirli_okumalar WHERE nesil >= ? AND sohbet_id = ?
         GROUP BY is_id ORDER BY MAX(ts_ms) DESC, MAX(id) DESC`,
        enAzNesil,
        sohbet.sohbet_id,
      ).map((r) => sayi(r.is_id));
    },

    // --- Geçmişi sil (dilim 1, K3), dilim 2'de sohbet başına. ---

    gecmisiTemizle(sohbet): GecmisTemizlemeSonucu {
      const { sohbet_id } = sohbet;
      return islem(() =>
        kayitNoktasinda("gecmisi_temizle", () => {
          // `seq` AUTOINCREMENT: silinen en büyük numara bir daha verilmez, mezar taşı en yeni olur.
          const sinir_seq = depo.basSeq();
          const sayilar = sohbetIceriginiSil(sohbet_id, sinir_seq);
          const mezar = depo.olayEkle({ type: MEZAR_TASI_TURU, sohbet_id, sinir_seq }) as MezarTasiOlayi;
          if (!(mezar.seq > sinir_seq)) throw new Error("depo: mezar taşı en yeni olay değil");
          return { mezar, ...sayilar };
        }),
      );
    },
    sonMezarTasi(sohbet): MezarTasiOlayi | null {
      const r = bir(
        `SELECT seq, ts_ms, veri FROM events WHERE type = ? AND ${olaySohbetSuzgeci(sohbet.sohbet_id)}
         ORDER BY seq DESC LIMIT 1`,
        MEZAR_TASI_TURU,
        sohbet.sohbet_id,
      );
      return r === null ? null : (olaySatiri(r) as MezarTasiOlayi);
    },
    walDaralt() {
      // İşlem içinde checkpoint ya hiçbir şey yapmaz ya da kilitlenir, VACUUM atar; çağıranın sırası yanlıştır.
      if (derinlik > 0 || db.isTransaction) throw new Error("depo: walDaralt işlem içinde çağrılamaz");
      const kesKontrol = (asama: "once" | "sonra"): void => {
        let r: Satir | undefined;
        try {
          r = db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get() as Satir | undefined;
        } catch {
          b.gunluk.uyari("depo", "wal_daraltilamadi", { asama, istisna: true });
          return;
        }
        // `busy` 1: bir okuyucu ya da yazıcı (ikinci süreç) yüzünden WAL kesilemedi; sonraki temizlik dener.
        if (r !== undefined && Number(r.busy) !== 0) {
          b.gunluk.uyari("depo", "wal_daraltilamadi", {
            asama,
            busy: Number(r.busy),
            log: Number(r.log),
            checkpointed: Number(r.checkpointed),
          });
        }
      };
      kesKontrol("once");
      // `secure_delete` yalnız açıldıktan sonraki silmeleri sıfırlar; ondan önce yazılıp silinenler boş
      // sayfalarda ve sayfa boşluklarında kalır. VACUUM dosyayı yeniden kurar: yalnız canlı satırlar
      // kalır, dosya kısalır. Yeni sayfalar WAL'a gider, ikinci checkpoint onları dosyaya yazıp WAL'ı keser.
      // `temp_store = MEMORY`: VACUUM'un ara kopyası diskte geçici dosyaya düşmesin. AUTOINCREMENT
      // sayacı (`sqlite_sequence`) ve açık `INTEGER PRIMARY KEY`'ler korunur; diğer tablolarda `rowid`
      // yeniden sıralanabilir ama göreli sıra korunur (kopya rowid sırasıyla yapılır).
      try {
        db.exec("PRAGMA temp_store = MEMORY");
        db.exec("VACUUM");
      } catch {
        b.gunluk.uyari("depo", "wal_daraltilamadi", { asama: "vacuum", istisna: true });
      } finally {
        try {
          db.exec("PRAGMA temp_store = DEFAULT");
        } catch {
          // ayar geri alınamazsa yalnız geçici tablolar bellekte kalır
        }
      }
      kesKontrol("sonra");
    },
    semaBilgisi() {
      return { user_version: surumOku(), ek_surum: ekSurumOku() };
    },

    oturumKaydet(session_id, ts_ms, sohbet) {
      // İlk yazılan kazanır: ikinci kayıt `olusturma_ms`'i ve sohbeti değiştirmez.
      calistir(
        `INSERT INTO eren_oturumlari (session_id, olusturma_ms, sohbet_id) VALUES (?, ?, ?)
         ON CONFLICT (session_id) DO NOTHING`,
        session_id,
        ts_ms,
        sohbet.sohbet_id,
      );
    },
    kayitliOturumlar(sohbet) {
      return hepsi(
        "SELECT session_id FROM eren_oturumlari WHERE sohbet_id = ? ORDER BY olusturma_ms, rowid",
        sohbet.sohbet_id,
      ).map((r) => String(r.session_id));
    },
    oturumKayitlariniSil(ids) {
      if (ids.length === 0) return;
      islem(() => {
        for (const id of ids) calistir("DELETE FROM eren_oturumlari WHERE session_id = ?", id);
      });
    },

    // --- Dilim 2: sohbetler tablosu. Ad kullanıcı metnidir: günlüğe yazılmaz, yalnız kimlik. ---

    sohbetEkle(kayit) {
      const sohbet_id = SohbetId.parse(kayit.sohbet_id);
      const ad = SohbetAdi.parse(kayit.ad);
      // Silinmiş kimlik de var sayılır: bir daha kullanılmaz (idempotentlik çağıranındır).
      if (bir("SELECT 1 AS var FROM sohbetler WHERE sohbet_id = ?", sohbet_id) !== null) {
        throw new Error(`depo: sohbet zaten var (${sohbet_id})`);
      }
      calistir(
        `INSERT INTO sohbetler (sohbet_id, ad, olusturma_ms, son_etkinlik_ms, silinme_ms) VALUES (?, ?, ?, ?, NULL)`,
        sohbet_id,
        ad,
        kayit.olusturma_ms,
        kayit.son_etkinlik_ms,
      );
    },
    sohbetGetir(sohbet) {
      const r = bir("SELECT * FROM sohbetler WHERE sohbet_id = ?", sohbet.sohbet_id);
      return r === null ? null : sohbetSatiri(r);
    },
    sohbetListesi(silinenlerDahil = false) {
      const sql = silinenlerDahil
        ? "SELECT * FROM sohbetler ORDER BY olusturma_ms, rowid"
        : "SELECT * FROM sohbetler WHERE silinme_ms IS NULL ORDER BY olusturma_ms, rowid";
      return hepsi(sql).map(sohbetSatiri);
    },
    sohbetAdiYaz(sohbet, ad) {
      const gecerli = SohbetAdi.parse(ad);
      const r = calistir(
        "UPDATE sohbetler SET ad = ? WHERE sohbet_id = ? AND silinme_ms IS NULL",
        gecerli,
        sohbet.sohbet_id,
      );
      if (r.changes === 0) throw new Error(`depo: adlandırılacak sohbet yok ya da silinmiş (${sohbet.sohbet_id})`);
    },
    sohbetEtkinlikYaz(sohbet, ms) {
      const r = calistir(
        "UPDATE sohbetler SET son_etkinlik_ms = MAX(son_etkinlik_ms, ?) WHERE sohbet_id = ?",
        ms,
        sohbet.sohbet_id,
      );
      if (r.changes === 0) b.gunluk.uyari("depo", "sohbet_yok", { sohbet_id: sohbet.sohbet_id });
    },
    sohbetiSil(sohbet, ms): SohbetSilmeSonucu {
      const { sohbet_id } = sohbet;
      return islem(() =>
        kayitNoktasinda("sohbeti_sil", () => {
          // Savunma: ön koşul çağıranındır (`temizlik`). Hiçbir şey silinmeden atar.
          if (sohbet_id === ANA_SOHBET_ID) throw new Error("depo: ana sohbet silinemez");
          const kayit = depo.sohbetGetir(sohbet);
          if (kayit === null) throw new Error(`depo: silinecek sohbet yok (${sohbet_id})`);
          if (kayit.silinme_ms !== null) throw new Error(`depo: sohbet zaten silinmiş (${sohbet_id})`);
          // Sınırsız: o sohbetin silinebilir bütün olayları (`ana` olmadığı için NULL satır söz konusu değil).
          const sayilar = sohbetIceriginiSil(sohbet_id, null);
          calistir("UPDATE sohbetler SET silinme_ms = ? WHERE sohbet_id = ?", ms, sohbet_id);
          // Tür zorlaması: `protocol` `olay()` zarfındaki isteğe bağlı `sohbet_id` ile yaşam döngüsü
          // olaylarının zorunlu `sohbet_id`'si tip düzeyinde `undefined`'a çöküyor (çalışma anında şema
          // doğru: alan zorunlu). Şef'e raporlandı; `Olay.parse` yine doğrular.
          const girdi = { type: SOHBET_SILINDI_TURU, sohbet_id } as unknown as OlayGirdisi;
          const silindi = depo.olayEkle(girdi) as SohbetSilindiOlayi;
          return { silindi, ...sayilar };
        }),
      );
    },

    // --- Tüketim: `tuketim` tablosu (ek göç 4). Yalnız sayı ve kimlik; silme yok. ---

    tuketimEkle(kayitlar) {
      if (kayitlar.length === 0) return;
      for (const k of kayitlar) tuketimDenetle(k); // hiçbir şey yazılmadan atar
      islem(() => {
        for (const k of kayitlar) {
          calistir(
            `INSERT INTO tuketim (ts_ms, kaynak, sohbet_id, is_id, turn_id, nesil, rol, model, girdi, cache_yazma,
               cache_okuma, cikti, maliyet_usd, olcum) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            k.ts_ms,
            k.kaynak,
            k.sohbet_id,
            k.is_id,
            k.turn_id,
            k.nesil,
            k.rol,
            k.model,
            k.girdi,
            k.cache_yazma,
            k.cache_okuma,
            k.cikti,
            k.maliyet_usd,
            k.olcum,
          );
        }
      });
    },
    tuketimOzeti({ gunBaslangicMs, yediGunBaslangicMs, isAdet }): TuketimOzeti {
      // İşlemsiz okuma (öteki okuyucular gibi): `islem` yazma kilidi (`BEGIN IMMEDIATE`) alırdı. Bu süreç
      // eşzamanlıdır; `tuketim`'e yazan tek süreç odur, sorgular arasında satır eklenmez.
      const pencere = (baslangic: number): TuketimIkilisi =>
        tuketimIkilisi(hepsi(tuketimToplamSql("kaynak", "ts_ms >= ?"), baslangic));

      // Sohbet başına tüm zaman. "Silinmiş": `sohbetler.silinme_ms` dolu (sohbetiSil'in modeli);
      // `sohbetler`'de satırı olmayan kimlik de silinmemiş listeye giremez, oraya sayılır. Böylece
      // liste + silinmiş = tüm zaman toplamı.
      const sohbetSatirlari = new Map<string, Satir[]>();
      for (const r of hepsi(tuketimToplamSql("sohbet_id, kaynak", "1"))) {
        const id = String(r.sohbet_id);
        const l = sohbetSatirlari.get(id);
        if (l === undefined) sohbetSatirlari.set(id, [r]);
        else l.push(r);
      }
      const sohbetler: TuketimOzeti["sohbetler"] = [];
      for (const s of depo.sohbetListesi(false)) {
        const satirlar = sohbetSatirlari.get(s.sohbet_id);
        if (satirlar === undefined) continue;
        sohbetSatirlari.delete(s.sohbet_id);
        if (sohbetler.length >= SOHBET_SINIRLARI.SOHBET_ADET) {
          // Olmamalı (`sohbet_siniri`); şema sınırı aşılmasın. Pencere toplamlarında kalır.
          b.gunluk.uyari("depo", "tuketim_sohbet_siniri", { sohbet_id: s.sohbet_id });
          continue;
        }
        sohbetler.push({ sohbet_id: s.sohbet_id, toplam: tuketimIkilisi(satirlar) });
      }
      const silinmisSatirlar = [...sohbetSatirlari.values()].flat();

      // En yeni işler: `is_id` artan sayaçtır; silinmiş sohbetin işleri de listede (yalnız kimlik).
      const sinir = Math.max(0, Math.min(Math.trunc(isAdet) || 0, SOHBET_SINIRLARI.TUKETIM_IS_ADET));
      const isler: TuketimOzeti["isler"] =
        sinir === 0
          ? []
          : hepsi(
              tuketimToplamSql("is_id", "kaynak = 'is' AND is_id IS NOT NULL", "ORDER BY is_id DESC LIMIT ?"),
              sinir,
            ).map((r) => {
              const a = bosBirikim();
              birikimeEkle(a, r);
              return { is_id: sayi(r.is_id), toplam: tuketimToplami(a) };
            });

      const ozet: TuketimOzeti = {
        bugun: pencere(gunBaslangicMs),
        son_7_gun: pencere(yediGunBaslangicMs),
        sohbetler,
        isler,
      };
      if (silinmisSatirlar.length > 0) ozet.silinmis_sohbetler = tuketimIkilisi(silinmisSatirlar);
      return ozet;
    },
  };
  return depo;
};
