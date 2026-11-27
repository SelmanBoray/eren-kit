/**
 * Kalıcı durum: tek `node:sqlite` kullanıcısı, eşzamanlı `DatabaseSync`. MODULLER.md, "depo".
 * Deneysel API (`DatabaseSync, prepare, run, get, all, exec`) yalnız bu dosyada kalır.
 */
import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue, StatementSync } from "node:sqlite";
import {
  AJANDA_SURUMU,
  ANA_SOHBET_ID,
  AjandaGecmisGirdisi,
  AjandaIslemSonucu,
  AjandaKaydi,
  AjandaYerelAn,
  DepoId,
  IsId,
  IsProfili,
  Olay,
  OpakId,
  Plan,
  Sayac,
  SILINMEZ_OLAY_TURLERI,
  SOHBET_SINIRLARI,
  SohbetAdi,
  SohbetId,
  VARSAYILAN_IS_PROFILI,
  ajandaRetGeciciMi,
  kanonikJson,
  EkListesi,
  MEDYA_ISLEME_DURUMLARI,
  MEDYA_SINIRLARI,
  MedyaId,
  MedyaMime,
  MedyaTuru,
  mimeTuru,
  turBaytSiniri,
} from "@eren/protocol";
import type { CihazKapsami, MedyaIslemeDurumu, TuketimIkilisi, TuketimToplami } from "@eren/protocol";
import { anaSohbetAdiUret } from "./ana-sohbet-adi.ts";
import type {
  AckGovdesi,
  AjandaDegisiklikYazimi,
  AjandaIslemSonucuGovdesi,
  AjandaJetonKapsami,
  AjandaJetonKaydi,
  AjandaKayitSuzgeci,
  CihazKaydi,
  Depo,
  DepoBagimliliklari,
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
  KuyrukSatirEki,
  MedyaBicimi,
  MedyaHatasi,
  MedyaIslemeNedeni,
  MedyaKaydi,
  MedyaKayitDurumu,
  MedyaKayitSuzgeci,
  MedyaliDepo,
  MedyaliDepoFabrikasi,
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
  // 5: eşleşmesi kaldırılan cihazlar (`cihazKaldir`). Yalnız yeni tablo: var olan hiçbir satıra ve
  // sütuna dokunmaz, göçün kendisi veri silmez (geri dönüş: tabloyu düşürmek). Kaldırma, kimlik bilgisi
  // (açık anahtar, IP) taşıyan `cihazlar` satırını SİLER ve kimliği buraya taşır: eski kod (geri alma)
  // tabloyu görmez ama satır olmadığı için kaldırılan cihazı yine tanımaz, yetki dirilmez. Açık anahtar
  // ve IP buraya yazılmaz. `IF NOT EXISTS`: sayacı geri kalmış bir dosyada yeniden uygulanabilir.
  `
  CREATE TABLE IF NOT EXISTS cihaz_iptalleri (
    device_id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    etiket TEXT,
    eslesme_ms INTEGER NOT NULL,
    iptal_ms INTEGER NOT NULL
  ) STRICT;
  `,
  // 6: ajanda (docs/AJANDA.md, MODULLER.md "Ajanda dalgası" > "depo"). YALNIZ yeni tablo ve dizin: var
  // olan hiçbir tabloya ve sütuna dokunmaz (`ALTER` yok), bu yüzden sayacı geri kalmış dosyada yeniden
  // uygulanabilir ve eski kod hiçbir şeyi görmez. Kapsam bilerek SÜTUN DEĞİL, ayrı tablodur: geri alınan
  // eski kod ajanda cihazını (`ajanda_cihazlari`), ajanda penceresini (`ajanda_eslestirme`) ve ajanda
  // jetonunu (`ajanda_jetonlari`) hiç görmez; kapsamı bilmeyen kod ajanda cihazına `/sohbet` açamaz,
  // ajanda jetonunu `eren` borusunda başka rol diye okuyamaz. `kuyruk_ekleri` metin taşımaz (an ve
  // kimlik): eski kodun "geçmişi sil"i satırı silip eki yetim bıraksa da içerik kalmaz; yetim açılışta
  // silinir (`eren_kuyrugu.id` AUTOINCREMENT, kimlik yeniden kullanılmaz). Geçmiş `rev` AUTOINCREMENT:
  // tek artan revizyon sayacı, geri gitmez. "Geçmişi sil" bu tabloların hiçbirine dokunmaz.
  `
  CREATE TABLE IF NOT EXISTS ajanda_kayitlari (
    kayit_id TEXT PRIMARY KEY,
    revizyon INTEGER NOT NULL,
    olusturma_rev INTEGER NOT NULL,
    tekil_anahtar TEXT,
    tur TEXT NOT NULL,
    durum TEXT NOT NULL,
    silindi INTEGER NOT NULL,
    veri TEXT NOT NULL
  ) STRICT;
  CREATE UNIQUE INDEX IF NOT EXISTS ajanda_kayit_rev ON ajanda_kayitlari (revizyon);
  CREATE UNIQUE INDEX IF NOT EXISTS ajanda_kayit_sira ON ajanda_kayitlari (olusturma_rev);
  CREATE INDEX IF NOT EXISTS ajanda_kayit_tekil ON ajanda_kayitlari (tekil_anahtar) WHERE tekil_anahtar IS NOT NULL;
  CREATE TABLE IF NOT EXISTS ajanda_gecmisi (
    rev INTEGER PRIMARY KEY AUTOINCREMENT,
    kayit_id TEXT NOT NULL,
    ts_ms INTEGER NOT NULL,
    veri TEXT NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS ajanda_gecmisi_kayit ON ajanda_gecmisi (kayit_id, rev);
  CREATE TABLE IF NOT EXISTS ajanda_islemleri (
    device_id TEXT NOT NULL,
    islem_id TEXT NOT NULL,
    sonuc TEXT NOT NULL,
    ts_ms INTEGER NOT NULL,
    PRIMARY KEY (device_id, islem_id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS ajanda_meta (
    anahtar TEXT PRIMARY KEY,
    deger TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS ajanda_jetonlari (
    ozet TEXT PRIMARY KEY,
    rol TEXT NOT NULL,
    sohbet_id TEXT NOT NULL,
    nesil INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS ajanda_cihazlari (
    device_id TEXT PRIMARY KEY,
    public_key TEXT NOT NULL,
    tailscale_ip TEXT NOT NULL,
    platform TEXT NOT NULL,
    etiket TEXT,
    eslesme_ms INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS ajanda_cihaz_iptalleri (
    device_id TEXT PRIMARY KEY
  ) STRICT;
  CREATE TABLE IF NOT EXISTS ajanda_eslestirme (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    kod_ozeti TEXT NOT NULL,
    son_ms INTEGER NOT NULL,
    yanlis_deneme INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS kuyruk_ekleri (
    kuyruk_id INTEGER PRIMARY KEY,
    mesaj_ani TEXT NOT NULL,
    kaynak_msg_id TEXT
  ) STRICT;
  `,
  // 7: PC'deki Claude Code oturumlarının ajanda anahtarları (AJANDA.md "PC oturumları"). YALNIZ yeni
  // tablo: var olan hiçbir tabloya dokunmaz, eski kod (geri alma) tabloyu görmez ve PC rolünü zaten
  // tanımaz (`ajandaJetonBul` tanımadığı rolü `null` okur). Düz anahtar yazılmaz, yalnız SHA-256 özeti.
  // Satır silinmez, iptal `iptal_ms` ile. `IF NOT EXISTS`: sayacı geri kalmış dosyada yeniden uygulanabilir.
  `
  CREATE TABLE IF NOT EXISTS ajanda_pc_anahtarlari (
    ozet TEXT PRIMARY KEY,
    olusturma_ms INTEGER NOT NULL,
    iptal_ms INTEGER
  ) STRICT;
  `,
  // 8: medya ekleri (MODULLER.md "Medya dalgası" > "S1 depo"). YALNIZ yeni tablo ve dizin: var olan
  // hiçbir tabloya dokunmaz (`ALTER` yok), eski kod (geri alma) tabloları görmez; eski kodun "geçmişi
  // sil"i medya satırlarını `silinecek` yapamaz ama içerik dosyadadır, satır yalnız kimlik ve sayı taşır
  // (yol ve dosya adı yazılmaz). Kapalı liste değerleri (`durum`, `tur`, `bicim`...) bilerek `CHECK`'siz:
  // ileri sürümün eklediği değer tabloyu yeniden kurmadan yazılabilsin; denetim yazarken JS'tedir.
  // `kuyruk_medyalari.medya_no` tekil: bir kayıt tek kuyruk satırına bağlanır. `no` AUTOINCREMENT: dizin
  // adı (`<kök>\<no>`) bir daha verilmez. `IF NOT EXISTS`: sayacı geri kalmış dosyada yeniden uygulanabilir.
  `
  CREATE TABLE IF NOT EXISTS medya (
    no INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    medya_id TEXT NOT NULL,
    sohbet_id TEXT NOT NULL,
    tur TEXT NOT NULL,
    mime TEXT NOT NULL,
    boyut INTEGER NOT NULL,
    alinan INTEGER NOT NULL,
    durum TEXT NOT NULL,
    red_kodu TEXT,
    bicim TEXT,
    isleme TEXT,
    isleme_nedeni TEXT,
    sure_ms INTEGER,
    genislik INTEGER,
    yukseklik INTEGER,
    kare_adet INTEGER,
    olusturma_ms INTEGER NOT NULL,
    guncelleme_ms INTEGER NOT NULL,
    bagli_msg_id TEXT,
    turetilen_bayt INTEGER NOT NULL DEFAULT 0,
    UNIQUE (device_id, medya_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS medya_durum ON medya (durum);
  CREATE INDEX IF NOT EXISTS medya_sohbet ON medya (sohbet_id, no);
  CREATE TABLE IF NOT EXISTS kuyruk_medyalari (
    kuyruk_id INTEGER NOT NULL,
    sira INTEGER NOT NULL,
    medya_no INTEGER NOT NULL,
    PRIMARY KEY (kuyruk_id, sira)
  ) STRICT;
  CREATE UNIQUE INDEX IF NOT EXISTS kuyruk_medyalari_medya ON kuyruk_medyalari (medya_no);
  CREATE TABLE IF NOT EXISTS nesil_gorselleri (
    nesil INTEGER PRIMARY KEY,
    adet INTEGER NOT NULL
  ) STRICT;
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

/** Sohbet cihazında `kapsam` alanı yazılmaz (`ESKI_CIHAZ_KAPSAMI`); ajanda cihazında `"ajanda"`. */
const cihazSatiri = (r: Satir, kapsam: CihazKapsami = "sohbet"): CihazKaydi => ({
  device_id: String(r.device_id),
  public_key: String(r.public_key),
  tailscale_ip: String(r.tailscale_ip),
  platform: String(r.platform) as CihazKaydi["platform"],
  etiket: metinVeyaNull(r.etiket),
  eslesme_ms: sayi(r.eslesme_ms),
  ...(kapsam === "sohbet" ? {} : { kapsam }),
});

/** Kuyruk satırı + eki (`kuyruk_ekleri`, LEFT JOIN `ek_` önekli sütunlar). Bozuk ek okunmaz, satır okunur. */
const kuyrukSatiri = (r: Satir): ErenKuyrukSatiri => {
  const satir: ErenKuyrukSatiri = {
    id: sayi(r.id),
    sohbet_id: String(r.sohbet_id),
    kaynak: String(r.kaynak) as ErenKuyrukKaynagi,
    metin: String(r.metin),
    olusturma_ms: sayi(r.olusturma_ms),
  };
  if (typeof r.ek_mesaj_ani === "string") {
    try {
      const an = AjandaYerelAn.safeParse(JSON.parse(r.ek_mesaj_ani));
      if (an.success) satir.mesaj_ani = an.data;
    } catch {
      // bozuk ek: alan yok, `konusma` varış anını `olusturma_ms`'ten hesaplar
    }
  }
  if (typeof r.ek_kaynak_msg_id === "string") satir.kaynak_msg_id = r.ek_kaynak_msg_id;
  return satir;
};

/** Kuyruk okumalarının ortak başı: satır + eki. */
const KUYRUK_SECIMI = `SELECT q.id, q.sohbet_id, q.kaynak, q.metin, q.olusturma_ms,
  e.mesaj_ani AS ek_mesaj_ani, e.kaynak_msg_id AS ek_kaynak_msg_id
  FROM eren_kuyrugu q LEFT JOIN kuyruk_ekleri e ON e.kuyruk_id = q.id`;

// --- Medya (ek göç 8) ---

/** Kapalı listeler: `Record` tamlığı derleyicide sabitler (sözleşmeye değer eklenirse burası derlenmez). */
const MEDYA_KAYIT_DURUMLARI: Record<MedyaKayitDurumu, true> = {
  yukleniyor: true,
  kabul: true,
  reddedildi: true,
  silinecek: true,
};
const MEDYA_RED_KODLARI: Record<MedyaHatasi, true> = { medya_yok: true, medya_reddedildi: true, medya_siniri: true };
const MEDYA_BICIMLERI: Record<MedyaBicimi, true> = {
  jpg: true,
  png: true,
  webp: true,
  heic: true,
  mp4: true,
  mov: true,
  "3gp": true,
  webm: true,
};
const MEDYA_ISLEME_NEDENLERI: Record<MedyaIslemeNedeni, true> = {
  model_yok: true,
  ses_yok: true,
  zaman_asimi: true,
  hata: true,
};
const MEDYA_ISLEMELERI: ReadonlySet<string> = new Set<MedyaIslemeDurumu>(MEDYA_ISLEME_DURUMLARI);

const medyaSatiri = (r: Satir): MedyaKaydi => ({
  no: sayi(r.no),
  device_id: String(r.device_id),
  medya_id: String(r.medya_id),
  sohbet_id: String(r.sohbet_id),
  tur: String(r.tur) as MedyaKaydi["tur"],
  mime: String(r.mime) as MedyaKaydi["mime"],
  boyut: sayi(r.boyut),
  alinan: sayi(r.alinan),
  durum: String(r.durum) as MedyaKayitDurumu,
  red_kodu: metinVeyaNull(r.red_kodu) as MedyaHatasi | null,
  bicim: metinVeyaNull(r.bicim) as MedyaBicimi | null,
  isleme: metinVeyaNull(r.isleme) as MedyaIslemeDurumu | null,
  isleme_nedeni: metinVeyaNull(r.isleme_nedeni) as MedyaIslemeNedeni | null,
  sure_ms: sayiVeyaNull(r.sure_ms),
  genislik: sayiVeyaNull(r.genislik),
  yukseklik: sayiVeyaNull(r.yukseklik),
  kare_adet: sayiVeyaNull(r.kare_adet),
  olusturma_ms: sayi(r.olusturma_ms),
  guncelleme_ms: sayi(r.guncelleme_ms),
  bagli_msg_id: metinVeyaNull(r.bagli_msg_id),
  turetilen_bayt: sayi(r.turetilen_bayt),
});

/**
 * `sonKonusma`: `user_echo.ekler` (`json_extract` JSON metni) → `{ekler}` ya da `{}`. Olay yazılırken
 * şemadan geçti; yine de okunamayan ek satırı düşürmez, yalnız alan yazılmaz.
 */
const ekleriOku = (ham: unknown): { ekler?: EkListesi } => {
  if (typeof ham !== "string") return {};
  try {
    const l = EkListesi.safeParse(JSON.parse(ham));
    return l.success ? { ekler: l.data } : {};
  } catch {
    return {};
  }
};

type MedyaAlanlari = Parameters<MedyaliDepo["medyaGuncelle"]>[1];

const kapaliListe =
  (ad: string, kume: Readonly<Record<string, true>> | ReadonlySet<string>, nullOlur: boolean) =>
  (v: unknown): SQLInputValue => {
    if (v === null && nullOlur) return null;
    const var_ = typeof v === "string" && (kume instanceof Set ? kume.has(v) : Object.hasOwn(kume, v));
    if (!var_) throw new Error(`depo: medya ${ad} geçersiz`);
    return v as string;
  };
const negatifOlmayan =
  (ad: string, nullOlur: boolean) =>
  (v: unknown): SQLInputValue => {
    if (v === null && nullOlur) return null;
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) throw new Error(`depo: medya ${ad} geçersiz`);
    return v;
  };

/** `medyaGuncelle`'nin yazabildiği alanlar ve denetimleri; kimlik ve beyan alanları burada yok (yazılırsa atar). */
const MEDYA_GUNCELLEME: { readonly [A in keyof Required<MedyaAlanlari>]: (v: unknown) => SQLInputValue } = {
  alinan: negatifOlmayan("alinan", false),
  durum: kapaliListe("durum", MEDYA_KAYIT_DURUMLARI, false),
  red_kodu: kapaliListe("red_kodu", MEDYA_RED_KODLARI, true),
  bicim: kapaliListe("bicim", MEDYA_BICIMLERI, true),
  isleme: kapaliListe("isleme", MEDYA_ISLEMELERI, true),
  isleme_nedeni: kapaliListe("isleme_nedeni", MEDYA_ISLEME_NEDENLERI, true),
  sure_ms: negatifOlmayan("sure_ms", true),
  genislik: negatifOlmayan("genislik", true),
  yukseklik: negatifOlmayan("yukseklik", true),
  kare_adet: negatifOlmayan("kare_adet", true),
  guncelleme_ms: negatifOlmayan("guncelleme_ms", false),
  bagli_msg_id: (v) => (v === null ? null : OpakId.parse(v)),
  turetilen_bayt: negatifOlmayan("turetilen_bayt", false),
};

/** Diskte yer tutan durumlar (`medyaDiskBayti`): `reddedildi`'nin dosyaları silinmiştir. */
const MEDYA_DISKTE = "('yukleniyor', 'kabul', 'silinecek')";

// --- Ajanda (ek göç 6) ---

/** Ajanda kaydı satırından: `veri` tam `AjandaKaydi` JSON'udur (yazarken şemadan geçti). */
const ajandaKaydiSatiri = (r: Satir): AjandaKaydi => JSON.parse(String(r.veri)) as AjandaKaydi;

/** Geçmiş satırından: `rev` ve `ts_ms` sütundadır, gövde `veri`'de. */
const gecmisGirdisiSatiri = (r: Satir): AjandaGecmisGirdisi =>
  ({ rev: sayi(r.rev), ts_ms: sayi(r.ts_ms), ...(JSON.parse(String(r.veri)) as object) }) as AjandaGecmisGirdisi;

/** Ajanda jetonunun tek tanınan rolü; başka roldeki satır (sonraki dilim) `null` okunur. */
const AJANDA_JETON_ROLU = "ana_oturum" satisfies AjandaJetonKapsami["rol"];
const AJANDA_DEPO_ANAHTARI = "depo_id";

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

// --- Eşleşme yönetimi (ek göç 5). Sözleşmedeki `Depo`'da yok: yalnız yerel komut (`eslestir.ts`)
// `depoAc` ile kullanır; servis `depoKur` (`Depo`) görür ve kaldırmayı `cihazGetir` üzerinden duyar. ---

/** Eşleşme listesinin satırı. Sır niteliğindeki alan (açık anahtar, IP) bilerek yoktur. */
export interface EslesmeOzeti {
  device_id: string;
  platform: CihazKaydi["platform"];
  etiket: string | null;
  eslesme_ms: number;
  /** `null`: eşleşme etkin. */
  iptal_ms: number | null;
  /** Ajanda dalgası: yalnız ajanda cihazında `"ajanda"`; yoksa `sohbet` (`ESKI_CIHAZ_KAPSAMI`). */
  kapsam?: CihazKapsami;
}

export type CihazKaldirmaSonucu =
  | { sonuc: "kaldirildi"; iptal_ms: number }
  | { sonuc: "zaten_kaldirilmis"; iptal_ms: number }
  | { sonuc: "bulunamadi" };

export interface CihazYonetimi {
  /** Etkin ve kaldırılmış eşleşmeler, eşleşme sırasıyla. */
  eslesmeler(): EslesmeOzeti[];
  /**
   * Tek işlem: kimlik bilgili `cihazlar` (ajanda dalgası: ya da `ajanda_cihazlari`) satırı silinir, kimlik
   * `cihaz_iptalleri`'ne taşınır (ajanda cihazında ayrıca `ajanda_cihaz_iptalleri`'ne: listede kapsam).
   * Bundan sonra `cihazGetir`/`cihazlar`/`kapsamliCihazGetir` o kimliği hiç döndürmez. İdempotent;
   * bilinmeyen kimlik `bulunamadi`.
   */
  cihazKaldir(device_id: string): CihazKaldirmaSonucu;
}

/** Medya dalgası: `MedyaliDepo` bir `Depo`dur; eşleşme yönetimi yerel komutlar içindir. */
export type CihazYonetimliDepo = MedyaliDepo & CihazYonetimi;

/** Kaldırılmış kimlik süzgeci: `cihazlar` satırı ancak iptal kaydı yoksa geçerlidir (savunma). */
const IPTAL_EDILMEMIS = "NOT EXISTS (SELECT 1 FROM cihaz_iptalleri i WHERE i.device_id = cihazlar.device_id)";
/** Aynı süzgeç ajanda cihazları için. */
const AJANDA_IPTAL_EDILMEMIS =
  "NOT EXISTS (SELECT 1 FROM cihaz_iptalleri i WHERE i.device_id = ajanda_cihazlari.device_id)";

export const depoKur: MedyaliDepoFabrikasi = (b) => depoAc(b);

export const depoAc = (b: DepoBagimliliklari): CihazYonetimliDepo => {
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

  // Ek göç 6: geri alınmış eski kodun sildiği kuyruk satırlarının yetim ekleri (içerik taşımaz). Kimlik
  // yeniden kullanılmadığı için zararsızdır; yine de birikmesin. Yapılamazsa açılış sürer.
  try {
    const yetim = db.prepare("DELETE FROM kuyruk_ekleri WHERE kuyruk_id NOT IN (SELECT id FROM eren_kuyrugu)").run();
    if (Number(yetim.changes) > 0) b.gunluk.uyari("depo", "yetim_kuyruk_eki_silindi", { adet: Number(yetim.changes) });
  } catch {
    b.gunluk.uyari("depo", "yetim_kuyruk_eki_silinemedi");
  }

  // --- işlem ---
  let derinlik = 0;
  let bekleyenOlaylar: Olay[] = [];
  /** Ajanda dalgası: `ajanda_kayit_yazildi` de `olay_yazildi` gibi en dıştaki işlem bitince yayınlanır. */
  let bekleyenAjanda: AjandaKaydi[] = [];

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
      bekleyenAjanda = [];
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
    const ajandaYayini = bekleyenAjanda;
    bekleyenAjanda = [];
    if (b.veriyolu !== undefined) {
      for (const olay of yayinlanacak) b.veriyolu.yayinla("olay_yazildi", { olay });
      for (const kayit of ajandaYayini) b.veriyolu.yayinla("ajanda_kayit_yazildi", { kayit });
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
    const ajandaOncesi = bekleyenAjanda.length;
    db.exec(`SAVEPOINT ${ad}`);
    try {
      const sonuc = f();
      db.exec(`RELEASE ${ad}`);
      return sonuc;
    } catch (e) {
      bekleyenOlaylar.splice(yayinOncesi);
      bekleyenAjanda.splice(ajandaOncesi);
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
    ms: number,
  ): { silinen_olay: number; bosaltilan_tur: number; silinen_kuyruk: number; silinecek_medya: number } => {
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
    // Ajanda dalgası: ekler satırlarla birlikte gider. Ajanda tablolarına DOKUNULMAZ.
    calistir("DELETE FROM kuyruk_ekleri WHERE kuyruk_id IN (SELECT id FROM eren_kuyrugu WHERE sohbet_id = ?)", sohbet_id);
    // Medya dalgası: o sohbetin kuyruk bağları satırlarla gider; o sohbetin bütün medyası (bitmemiş
    // yükleme dahil) `silinecek` olur ve artık hiçbir yoldan modele ya da telefona gitmez. Dizinleri
    // işlemden sonra `MedyaYoneticisi.sohbetMedyasiniSil` siler. Başka sohbetin satırına dokunulmaz.
    calistir(
      "DELETE FROM kuyruk_medyalari WHERE kuyruk_id IN (SELECT id FROM eren_kuyrugu WHERE sohbet_id = ?)",
      sohbet_id,
    );
    const silinecek_medya = calistir(
      "UPDATE medya SET durum = 'silinecek', guncelleme_ms = ? WHERE sohbet_id = ? AND durum <> 'silinecek'",
      ms,
      sohbet_id,
    ).changes;
    const silinen_kuyruk = calistir("DELETE FROM eren_kuyrugu WHERE sohbet_id = ?", sohbet_id).changes;
    return { silinen_olay, bosaltilan_tur, silinen_kuyruk, silinecek_medya };
  };

  /** Ajanda cihazı mı (iptal süzgeçsiz: kimlik tek kapsamdadır kuralı için). */
  const ajandaCihaziVarMi = (device_id: string): boolean =>
    bir("SELECT 1 AS var FROM ajanda_cihazlari WHERE device_id = ?", device_id) !== null;
  const sohbetCihaziVarMi = (device_id: string): boolean =>
    bir("SELECT 1 AS var FROM cihazlar WHERE device_id = ?", device_id) !== null;

  const depo: CihazYonetimliDepo = {
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
                json_extract(veri, '$.baglam.paket') AS paket, json_extract(veri, '$.baglam.ad') AS ad,
                json_extract(veri, '$.ekler') AS ekler FROM events
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
        ...(r.type === "user_echo" && ekleriOku(r.ekler)),
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
      const r = bir(`${KUYRUK_SECIMI} WHERE q.sohbet_id = ? ORDER BY q.id LIMIT 1`, sohbet.sohbet_id);
      return r === null ? null : kuyrukSatiri(r);
    },
    kuyrukSentetikBasi(adet, sohbet) {
      const bas: ErenKuyrukSatiri[] = [];
      const satirlar = hepsi(`${KUYRUK_SECIMI} WHERE q.sohbet_id = ? ORDER BY q.id LIMIT ?`, sohbet.sohbet_id, adet);
      for (const r of satirlar) {
        const s = kuyrukSatiri(r);
        if (s.kaynak !== "sentetik") break;
        bas.push(s);
      }
      return bas;
    },
    kuyruktanSil(idler) {
      islem(() => {
        for (const id of idler) {
          calistir("DELETE FROM kuyruk_ekleri WHERE kuyruk_id = ?", id);
          // Medya dalgası: bağ gider, kayıt kalır (`bagli_msg_id` dolu: gönderilmiş, tahliye adayı).
          calistir("DELETE FROM kuyruk_medyalari WHERE kuyruk_id = ?", id);
          calistir("DELETE FROM eren_kuyrugu WHERE id = ?", id);
        }
      });
    },
    kuyrukEkiYaz(kuyruk_id, ek: KuyrukSatirEki) {
      const an = AjandaYerelAn.parse(ek.mesaj_ani);
      const msg = ek.kaynak_msg_id === undefined ? null : OpakId.parse(ek.kaynak_msg_id);
      islem(() => {
        if (bir("SELECT 1 AS var FROM eren_kuyrugu WHERE id = ?", kuyruk_id) === null) {
          throw new Error("depo: eki yazılacak kuyruk satırı yok");
        }
        calistir(
          `INSERT INTO kuyruk_ekleri (kuyruk_id, mesaj_ani, kaynak_msg_id) VALUES (?, ?, ?)
           ON CONFLICT (kuyruk_id) DO UPDATE SET mesaj_ani = excluded.mesaj_ani, kaynak_msg_id = excluded.kaynak_msg_id`,
          kuyruk_id,
          JSON.stringify(an),
          msg,
        );
      });
    },

    cihazEkle(k) {
      const ajanda = k.kapsam === "ajanda";
      islem(() => {
        // Kaldırılmış kimlik dirilmez: yeniden eşleşme hep yeni `device_id` ile olur.
        if (bir("SELECT 1 AS var FROM cihaz_iptalleri WHERE device_id = ?", k.device_id) !== null) {
          throw new Error("depo: kaldırılmış cihaz kimliği yeniden eklenemez");
        }
        // Ajanda dalgası: bir kimlik tek kapsamdadır; kapsam değiştirmek yeni eşleşme (yeni kimlik) ister.
        if (ajanda ? sohbetCihaziVarMi(k.device_id) : ajandaCihaziVarMi(k.device_id)) {
          throw new Error("depo: cihaz kimliği öteki kapsamda var");
        }
        calistir(
          `INSERT INTO ${ajanda ? "ajanda_cihazlari" : "cihazlar"} (device_id, public_key, tailscale_ip, platform, etiket, eslesme_ms)
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
      });
    },
    cihazGetir(device_id) {
      // Bütün kimlik denetimleri (gateway `hello`, `auth_response`, kimlik sonrası çerçeve ve yoklama)
      // buradan okur: iptal süzgeci tek yerde. Ajanda dalgası: yalnız sohbet kapsamı (`cihazlar`).
      const r = bir(`SELECT * FROM cihazlar WHERE device_id = ? AND ${IPTAL_EDILMEMIS}`, device_id);
      return r === null ? null : cihazSatiri(r);
    },
    cihazlar() {
      return hepsi(`SELECT * FROM cihazlar WHERE ${IPTAL_EDILMEMIS} ORDER BY eslesme_ms, rowid`).map((r) => cihazSatiri(r));
    },
    kapsamliCihazGetir(device_id) {
      const sohbet = depo.cihazGetir(device_id);
      if (sohbet !== null) return sohbet;
      const r = bir(`SELECT * FROM ajanda_cihazlari WHERE device_id = ? AND ${AJANDA_IPTAL_EDILMEMIS}`, device_id);
      return r === null ? null : cihazSatiri(r, "ajanda");
    },
    eslesmeler() {
      return hepsi(
        `SELECT device_id, platform, etiket, eslesme_ms, NULL AS iptal_ms, 0 AS ajanda, 0 AS grup FROM cihazlar
           WHERE ${IPTAL_EDILMEMIS}
         UNION ALL
         SELECT device_id, platform, etiket, eslesme_ms, NULL AS iptal_ms, 1 AS ajanda, 0 AS grup FROM ajanda_cihazlari
           WHERE ${AJANDA_IPTAL_EDILMEMIS}
         UNION ALL
         SELECT device_id, platform, etiket, eslesme_ms, iptal_ms,
           EXISTS (SELECT 1 FROM ajanda_cihaz_iptalleri a WHERE a.device_id = cihaz_iptalleri.device_id) AS ajanda,
           1 AS grup FROM cihaz_iptalleri
         ORDER BY grup, eslesme_ms, device_id`,
      ).map((r) => ({
        device_id: String(r.device_id),
        platform: String(r.platform) as CihazKaydi["platform"],
        etiket: metinVeyaNull(r.etiket),
        eslesme_ms: sayi(r.eslesme_ms),
        iptal_ms: sayiVeyaNull(r.iptal_ms),
        ...(Number(r.ajanda) !== 0 ? { kapsam: "ajanda" as const } : {}),
      }));
    },
    cihazKaldir(device_id) {
      return islem((): CihazKaldirmaSonucu => {
        const onceki = bir("SELECT iptal_ms FROM cihaz_iptalleri WHERE device_id = ?", device_id);
        if (onceki !== null) {
          // Savunma: iki tabloda birden kalmış satır (elle ya da eski kodla yazılmış) burada da silinir.
          calistir("DELETE FROM cihazlar WHERE device_id = ?", device_id);
          calistir("DELETE FROM ajanda_cihazlari WHERE device_id = ?", device_id);
          return { sonuc: "zaten_kaldirilmis", iptal_ms: sayi(onceki.iptal_ms) };
        }
        let tablo = "cihazlar";
        let r = bir("SELECT platform, etiket, eslesme_ms FROM cihazlar WHERE device_id = ?", device_id);
        if (r === null) {
          tablo = "ajanda_cihazlari";
          r = bir("SELECT platform, etiket, eslesme_ms FROM ajanda_cihazlari WHERE device_id = ?", device_id);
        }
        if (r === null) return { sonuc: "bulunamadi" };
        const iptal_ms = b.saat.simdiMs();
        calistir(
          "INSERT INTO cihaz_iptalleri (device_id, platform, etiket, eslesme_ms, iptal_ms) VALUES (?, ?, ?, ?, ?)",
          device_id,
          String(r.platform),
          metinVeyaNull(r.etiket),
          sayi(r.eslesme_ms),
          iptal_ms,
        );
        if (tablo === "ajanda_cihazlari") calistir("INSERT INTO ajanda_cihaz_iptalleri (device_id) VALUES (?)", device_id);
        // `secure_delete` açık: açık anahtar ve IP dosyada da sıfırlanır.
        calistir(`DELETE FROM ${tablo} WHERE device_id = ?`, device_id);
        return { sonuc: "kaldirildi", iptal_ms };
      });
    },

    // Ajanda dalgası: tek pencere, kapsam ayrı tabloda (`ajanda_eslestirme`; eski kod görmez).
    eslestirmeYaz(k) {
      const ajanda = k.kapsam === "ajanda";
      islem(() => {
        calistir(`DELETE FROM ${ajanda ? "eslestirme" : "ajanda_eslestirme"} WHERE id = 1`);
        calistir(
          `INSERT OR REPLACE INTO ${ajanda ? "ajanda_eslestirme" : "eslestirme"} (id, kod_ozeti, son_ms, yanlis_deneme)
           VALUES (1, ?, ?, ?)`,
          k.kod_ozeti,
          k.son_ms,
          k.yanlis_deneme,
        );
      });
    },
    eslestirmeOku() {
      const s = bir("SELECT kod_ozeti, son_ms, yanlis_deneme FROM eslestirme WHERE id = 1");
      const a = bir("SELECT kod_ozeti, son_ms, yanlis_deneme FROM ajanda_eslestirme WHERE id = 1");
      // İkisi birden ancak karışık sürümle (geri alınmış eski kodun yazdığı sohbet penceresi) olur: son
      // süresi geç olan (sonra açılan) kazanır, eşitlikte sohbet.
      const ajanda = a !== null && (s === null || sayi(a.son_ms) > sayi(s.son_ms));
      const r = ajanda ? a : s;
      if (r === null) return null;
      return {
        kod_ozeti: String(r.kod_ozeti),
        son_ms: sayi(r.son_ms),
        yanlis_deneme: sayi(r.yanlis_deneme),
        ...(ajanda ? { kapsam: "ajanda" as const } : {}),
      };
    },
    eslestirmeYanlisSay() {
      calistir("UPDATE eslestirme SET yanlis_deneme = yanlis_deneme + 1 WHERE id = 1");
      calistir("UPDATE ajanda_eslestirme SET yanlis_deneme = yanlis_deneme + 1 WHERE id = 1");
    },
    eslestirmeSil() {
      calistir("DELETE FROM eslestirme WHERE id = 1");
      calistir("DELETE FROM ajanda_eslestirme WHERE id = 1");
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
          const sayilar = sohbetIceriginiSil(sohbet_id, sinir_seq, b.saat.simdiMs());
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
          const sayilar = sohbetIceriginiSil(sohbet_id, null, ms);
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

    // --- Ajanda (ek göç 6). Tek yazar `ajanda.ts`; kayıt metni günlüğe yazılmaz. "Geçmişi sil" dokunmaz. ---

    ajandaDepoKimligi(yeni) {
      return islem(() => {
        const r = bir("SELECT deger FROM ajanda_meta WHERE anahtar = ?", AJANDA_DEPO_ANAHTARI);
        if (r !== null) return String(r.deger);
        const depo_id = DepoId.parse(yeni());
        calistir("INSERT INTO ajanda_meta (anahtar, deger) VALUES (?, ?)", AJANDA_DEPO_ANAHTARI, depo_id);
        return depo_id;
      });
    },
    ajandaDepoKimligiYenile(depo_id) {
      const gecerli = DepoId.parse(depo_id);
      calistir(
        "INSERT INTO ajanda_meta (anahtar, deger) VALUES (?, ?) ON CONFLICT (anahtar) DO UPDATE SET deger = excluded.deger",
        AJANDA_DEPO_ANAHTARI,
        gecerli,
      );
    },
    ajandaBasRev() {
      return sayi((bir("SELECT COALESCE(MAX(rev), 0) AS r FROM ajanda_gecmisi") as Satir).r);
    },
    ajandaKaydiGetir(kayit_id) {
      const r = bir("SELECT veri FROM ajanda_kayitlari WHERE kayit_id = ?", kayit_id);
      return r === null ? null : ajandaKaydiSatiri(r);
    },
    ajandaKayitSayisi() {
      return sayi((bir("SELECT COUNT(*) AS n FROM ajanda_kayitlari") as Satir).n);
    },
    ajandaTekilEsler(tekil_anahtar) {
      return hepsi(
        "SELECT veri FROM ajanda_kayitlari WHERE tekil_anahtar = ? ORDER BY olusturma_rev",
        tekil_anahtar,
      ).map(ajandaKaydiSatiri);
    },
    ajandaKayitlari(suzgec: AjandaKayitSuzgeci = {}) {
      const kosullar: string[] = [];
      const degerler: SQLInputValue[] = [];
      if (suzgec.silinmislerDahil !== true) kosullar.push("silindi = 0");
      const liste = (sutun: string, l: readonly string[] | undefined): void => {
        if (l === undefined) return;
        if (l.length === 0) {
          kosullar.push("0");
          return;
        }
        kosullar.push(`${sutun} IN (${l.map(() => "?").join(", ")})`);
        degerler.push(...l);
      };
      liste("durum", suzgec.durumlar);
      liste("tur", suzgec.turler);
      const nerede = kosullar.length === 0 ? "" : `WHERE ${kosullar.join(" AND ")} `;
      return hepsi(`SELECT veri FROM ajanda_kayitlari ${nerede}ORDER BY olusturma_rev`, ...degerler).map(ajandaKaydiSatiri);
    },
    ajandaRevAraligi({ sonRev, ustRev, adet }) {
      return hepsi(
        "SELECT veri FROM ajanda_kayitlari WHERE revizyon > ? AND revizyon <= ? ORDER BY revizyon LIMIT ?",
        sonRev,
        ustRev,
        Math.max(0, Math.trunc(adet)),
      ).map(ajandaKaydiSatiri);
    },
    ajandaDegisiklikYaz(g: AjandaDegisiklikYazimi): AjandaKaydi {
      const { kayit_id } = g.kayit;
      const ekle = g.girdi.islem === "ekle";
      // Önce denetim, sonra yazım: revizyon ve zaman yer tutucuyla şemadan geçer (kurallar ikisine bağlı
      // değil, `guncelleme_ms >= olusturma_ms` dışında: o da gerçek `ts_ms` ile denetlenir).
      const ornekKayit = AjandaKaydi.parse({ ...g.kayit, revizyon: 1, guncelleme_ms: g.ts_ms });
      const ornekGirdi = AjandaGecmisGirdisi.parse({ ...g.girdi, rev: 1, ts_ms: g.ts_ms });
      const { rev: _r, ts_ms: _t, ...girdiGovdesi } = ornekGirdi;
      return islem(() =>
        kayitNoktasinda("ajanda_degisiklik", () => {
          const simdiki = depo.ajandaKaydiGetir(kayit_id);
          if (ekle && simdiki !== null) throw new Error("depo: ajanda kaydı zaten var");
          if (!ekle && simdiki === null) throw new Error("depo: ajanda kaydı yok");
          if (simdiki !== null) {
            // Kaynak izi ve doğuş anı kayıt doğarken yazılır, sonra değişmez.
            if (kanonikJson(simdiki.kaynak) !== kanonikJson(ornekKayit.kaynak)) {
              throw new Error("depo: ajanda kaydının kaynağı değiştirilemez");
            }
            if (simdiki.olusturma_ms !== ornekKayit.olusturma_ms) {
              throw new Error("depo: ajanda kaydının oluşturma anı değiştirilemez");
            }
          }
          const rev = calistir(
            "INSERT INTO ajanda_gecmisi (kayit_id, ts_ms, veri) VALUES (?, ?, ?)",
            kayit_id,
            g.ts_ms,
            JSON.stringify(girdiGovdesi),
          ).kimlik;
          if (simdiki !== null && !(rev > simdiki.revizyon)) throw new Error("depo: ajanda revizyonu geriledi");
          const kayit: AjandaKaydi = { ...ornekKayit, revizyon: rev, guncelleme_ms: g.ts_ms };
          // `olusturma_rev` (oluşturma sırası) yalnız ilk yazımda girer; güncellemede değişmez.
          calistir(
            `INSERT INTO ajanda_kayitlari (kayit_id, revizyon, olusturma_rev, tekil_anahtar, tur, durum, silindi, veri)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (kayit_id) DO UPDATE SET revizyon = excluded.revizyon, tur = excluded.tur,
               durum = excluded.durum, silindi = excluded.silindi, veri = excluded.veri`,
            kayit_id,
            rev,
            rev,
            kayit.kaynak.tekil_anahtar ?? null,
            kayit.tur,
            kayit.durum,
            kayit.silindi ? 1 : 0,
            JSON.stringify(kayit),
          );
          bekleyenAjanda.push(kayit);
          return kayit;
        }),
      );
    },
    ajandaGecmisi({ kayit_id, once_rev, adet }) {
      const sinir = Math.max(0, Math.trunc(adet));
      const satirlar =
        once_rev === undefined
          ? hepsi("SELECT rev, ts_ms, veri FROM ajanda_gecmisi WHERE kayit_id = ? ORDER BY rev DESC LIMIT ?", kayit_id, sinir)
          : hepsi(
              "SELECT rev, ts_ms, veri FROM ajanda_gecmisi WHERE kayit_id = ? AND rev < ? ORDER BY rev DESC LIMIT ?",
              kayit_id,
              once_rev,
              sinir,
            );
      return satirlar.map(gecmisGirdisiSatiri);
    },
    ajandaGecmisSatiri(rev) {
      const r = bir("SELECT kayit_id, ts_ms FROM ajanda_gecmisi WHERE rev = ?", rev);
      return r === null ? null : { kayit_id: String(r.kayit_id), ts_ms: sayi(r.ts_ms) };
    },
    ajandaIslemSonucuBul(device_id, islem_id) {
      const r = bir("SELECT sonuc FROM ajanda_islemleri WHERE device_id = ? AND islem_id = ?", device_id, islem_id);
      return r === null ? null : (JSON.parse(String(r.sonuc)) as AjandaIslemSonucuGovdesi);
    },
    ajandaIslemSonucuYaz(device_id, islem_id, sonuc, ts_ms) {
      // Şemadan geçmeyen ya da geçici sonuç kalıcı olamaz: aynı kimliğe hep aynı (yanlış) cevap dönerdi.
      const { v: _v, type: _ty, islem_id: _i, ...govde } = AjandaIslemSonucu.parse({
        ...sonuc,
        v: AJANDA_SURUMU,
        type: "islem_sonucu",
        islem_id,
      });
      if (!govde.ok && govde.code !== undefined && ajandaRetGeciciMi(govde.code)) {
        throw new Error("depo: geçici ajanda reddi tekrarsızlık kaydına yazılmaz");
      }
      calistir(
        "INSERT OR IGNORE INTO ajanda_islemleri (device_id, islem_id, sonuc, ts_ms) VALUES (?, ?, ?, ?)",
        OpakId.parse(device_id),
        islem_id,
        JSON.stringify(govde),
        ts_ms,
      );
    },

    ajandaJetonEkle(k: AjandaJetonKaydi) {
      calistir(
        "INSERT OR REPLACE INTO ajanda_jetonlari (ozet, rol, sohbet_id, nesil) VALUES (?, ?, ?, ?)",
        k.ozet,
        k.kapsam.rol,
        k.kapsam.sohbet_id,
        k.kapsam.nesil,
      );
    },
    ajandaJetonBul(ozet) {
      const r = bir("SELECT ozet, rol, sohbet_id, nesil FROM ajanda_jetonlari WHERE ozet = ?", ozet);
      if (r === null || r.rol !== AJANDA_JETON_ROLU) return null;
      return { ozet: String(r.ozet), kapsam: { rol: AJANDA_JETON_ROLU, sohbet_id: String(r.sohbet_id), nesil: sayi(r.nesil) } };
    },
    ajandaJetonlariSil(kapsam: AjandaJetonKapsami) {
      calistir(
        "DELETE FROM ajanda_jetonlari WHERE rol = ? AND sohbet_id = ? AND nesil = ?",
        kapsam.rol,
        kapsam.sohbet_id,
        kapsam.nesil,
      );
    },
    ajandaJetonlariniSil() {
      return calistir("DELETE FROM ajanda_jetonlari").changes;
    },

    // Ek göç 7: PC anahtarları. Satır silinmez: iptal `iptal_ms` ile işaretlenir (geçmiş görünsün).
    ajandaPcAnahtariYaz(ozet: string, ms: number) {
      if (!/^[0-9a-f]{64}$/.test(ozet)) throw new Error("PC anahtarı özeti geçersiz");
      islem(() => {
        calistir("UPDATE ajanda_pc_anahtarlari SET iptal_ms = ? WHERE iptal_ms IS NULL", ms);
        calistir("INSERT INTO ajanda_pc_anahtarlari (ozet, olusturma_ms, iptal_ms) VALUES (?, ?, NULL)", ozet, ms);
      });
    },
    ajandaPcAnahtariGecerliMi(ozet: string) {
      return bir("SELECT 1 AS var FROM ajanda_pc_anahtarlari WHERE ozet = ? AND iptal_ms IS NULL", ozet) !== null;
    },
    ajandaPcAnahtarlariniIptalEt(ms: number) {
      return calistir("UPDATE ajanda_pc_anahtarlari SET iptal_ms = ? WHERE iptal_ms IS NULL", ms).changes;
    },
    ajandaPcAnahtarlari() {
      return hepsi("SELECT olusturma_ms, iptal_ms FROM ajanda_pc_anahtarlari ORDER BY olusturma_ms, rowid").map((r) => ({
        olusturma_ms: sayi(r.olusturma_ms),
        iptal_ms: r.iptal_ms === null ? null : sayi(r.iptal_ms),
      }));
    },

    // --- Medya (ek göç 8). Yalnız `medya.ts` (S4) çağırır; temizlik/silme adımları `sohbetIceriginiSil`'de. ---

    medyaKaydiAc(k) {
      // Beyan denetimi (savunma: S4 kablo şemasından geçirmiştir). Hiçbir şey yazılmadan atar.
      const medya_id = MedyaId.parse(k.medya_id);
      const tur = MedyaTuru.parse(k.tur);
      const mime = MedyaMime.parse(k.mime);
      if (mimeTuru(mime) !== tur) throw new Error("depo: medya mime türle uyuşmuyor");
      if (!Number.isSafeInteger(k.boyut) || k.boyut < 1 || k.boyut > turBaytSiniri(tur)) {
        throw new Error("depo: medya boyutu geçersiz");
      }
      if (!Number.isSafeInteger(k.olusturma_ms) || k.olusturma_ms < 0) throw new Error("depo: medya zamanı geçersiz");
      if (typeof k.device_id !== "string" || k.device_id.length === 0) throw new Error("depo: medya cihazı geçersiz");
      if (typeof k.sohbet_id !== "string" || k.sohbet_id.length === 0) throw new Error("depo: medya sohbeti geçersiz");
      const no = islem(() => {
        if (depo.medyaKaydiBul(k.device_id, medya_id) !== null) throw new Error("depo: medya kaydı zaten var");
        return calistir(
          `INSERT INTO medya (device_id, medya_id, sohbet_id, tur, mime, boyut, alinan, durum, olusturma_ms, guncelleme_ms)
           VALUES (?, ?, ?, ?, ?, ?, 0, 'yukleniyor', ?, ?)`,
          k.device_id,
          medya_id,
          k.sohbet_id,
          tur,
          mime,
          k.boyut,
          k.olusturma_ms,
          k.olusturma_ms,
        ).kimlik;
      });
      return depo.medyaKaydiGetir(no) as MedyaKaydi;
    },
    medyaKaydiBul(device_id, medya_id) {
      const r = bir("SELECT * FROM medya WHERE device_id = ? AND medya_id = ?", device_id, medya_id);
      return r === null ? null : medyaSatiri(r);
    },
    medyaKaydiGetir(no) {
      const r = bir("SELECT * FROM medya WHERE no = ?", no);
      return r === null ? null : medyaSatiri(r);
    },
    medyaGuncelle(no, alanlar) {
      const atamalar: string[] = [];
      const degerler: SQLInputValue[] = [];
      // Hepsi yazmadan önce denetlenir: bilinmeyen alan (kimlik ve beyan dahil) ya da geçersiz değer atar.
      const yazilacak: Array<[string, unknown]> = Object.entries(alanlar).filter(([, v]) => v !== undefined);
      for (const [ad, v] of yazilacak) {
        const denetle = (MEDYA_GUNCELLEME as Record<string, ((v: unknown) => SQLInputValue) | undefined>)[ad];
        if (denetle === undefined || !Object.hasOwn(MEDYA_GUNCELLEME, ad)) {
          throw new Error(`depo: medya için yazılamaz alan ${ad}`);
        }
        atamalar.push(ad);
        degerler.push(denetle(v));
      }
      islem(() => {
        const kayit = depo.medyaKaydiGetir(no);
        if (kayit === null) throw new Error(`depo: medya kaydı yok (${no})`);
        if (atamalar.length === 0) return;
        // `silinecek` geri dönmez: işlem sürerken sohbet silinmiş olabilir; geç gelen "kabul" silinmiş
        // sohbetin medyasını diriltmesin. Öteki alanlar yazılır.
        const i = atamalar.indexOf("durum");
        if (kayit.durum === "silinecek" && i >= 0 && degerler[i] !== "silinecek") {
          atamalar.splice(i, 1);
          degerler.splice(i, 1);
          b.gunluk.uyari("depo", "silinecek_medya_durumu_korundu", { no });
          if (atamalar.length === 0) return;
        }
        calistir(`UPDATE medya SET ${atamalar.map((a) => `${a} = ?`).join(", ")} WHERE no = ?`, ...degerler, no);
      });
    },
    medyaKayitlari(suzgec: MedyaKayitSuzgeci = {}) {
      const kosullar: string[] = [];
      const degerler: SQLInputValue[] = [];
      if (suzgec.durumlar !== undefined) {
        if (suzgec.durumlar.length === 0) return [];
        kosullar.push(`durum IN (${suzgec.durumlar.map(() => "?").join(", ")})`);
        degerler.push(...suzgec.durumlar);
      }
      if (suzgec.sohbet !== undefined) {
        kosullar.push("sohbet_id = ?");
        degerler.push(suzgec.sohbet.sohbet_id);
      }
      if (suzgec.device_id !== undefined) {
        kosullar.push("device_id = ?");
        degerler.push(suzgec.device_id);
      }
      if (suzgec.bagli !== undefined) kosullar.push(suzgec.bagli ? "bagli_msg_id IS NOT NULL" : "bagli_msg_id IS NULL");
      if (suzgec.guncellemeOnce !== undefined) {
        kosullar.push("guncelleme_ms < ?");
        degerler.push(suzgec.guncellemeOnce);
      }
      const nerede = kosullar.length === 0 ? "" : ` WHERE ${kosullar.join(" AND ")}`;
      return hepsi(`SELECT * FROM medya${nerede} ORDER BY no`, ...degerler).map(medyaSatiri);
    },
    medyaBekleyenSayisi(device_id) {
      const r = bir(
        `SELECT COUNT(*) AS n FROM medya WHERE device_id = ?
           AND (durum = 'yukleniyor' OR (durum = 'kabul' AND bagli_msg_id IS NULL))`,
        device_id,
      ) as Satir;
      return sayi(r.n);
    },
    medyaDiskBayti() {
      // Asıl dosya + türetilenler (`gorsel.jpg`, kareler, döküm): kota gerçek disk kullanımına bakar.
      return sayi(
        (bir(`SELECT COALESCE(SUM(boyut + turetilen_bayt), 0) AS t FROM medya WHERE durum IN ${MEDYA_DISKTE}`) as Satir).t,
      );
    },
    medyaTahliyeAdaylari() {
      // Gönderilmiş (bağlanmış, kuyruk satırı ana oturuma yazılıp silinmiş) kabul edilmiş kayıtlar, en eskiden.
      // Kuyrukta bekleyen (bağı duran), bağlanmamış, yarım ve `silinecek` kayıt aday değildir.
      return hepsi(
        `SELECT * FROM medya m WHERE m.durum = 'kabul' AND m.bagli_msg_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM kuyruk_medyalari k WHERE k.medya_no = m.no)
         ORDER BY m.olusturma_ms, m.no`,
      ).map(medyaSatiri);
    },
    medyaKuyrugaBagla({ kuyruk_id, client_msg_id, nolar, ms }) {
      const msg = OpakId.parse(client_msg_id);
      if (nolar.length === 0 || nolar.length > MEDYA_SINIRLARI.EK_ADET) throw new Error("depo: bağlanacak medya sayısı geçersiz");
      if (new Set(nolar).size !== nolar.length) throw new Error("depo: bağlanacak medya yinelenmiş");
      if (!Number.isSafeInteger(ms) || ms < 0) throw new Error("depo: bağlama zamanı geçersiz");
      islem(() =>
        kayitNoktasinda("medya_bagla", () => {
          const satir = bir("SELECT sohbet_id FROM eren_kuyrugu WHERE id = ?", kuyruk_id);
          if (satir === null) throw new Error("depo: medyanın bağlanacağı kuyruk satırı yok");
          if (bir("SELECT 1 AS var FROM kuyruk_medyalari WHERE kuyruk_id = ? LIMIT 1", kuyruk_id) !== null) {
            throw new Error("depo: kuyruk satırının medyası zaten bağlı");
          }
          // Önce hepsi denetlenir, sonra yazılır; kayıt noktası yine de yarım yazımı geri alır.
          for (const no of nolar) {
            const k = depo.medyaKaydiGetir(no);
            if (k === null) throw new Error(`depo: bağlanacak medya yok (${no})`);
            if (k.durum !== "kabul") throw new Error(`depo: bağlanacak medya kabul değil (${no})`);
            if (k.bagli_msg_id !== null) throw new Error(`depo: medya zaten bağlı (${no})`);
            if (k.sohbet_id !== String(satir.sohbet_id)) throw new Error(`depo: medya başka sohbetin (${no})`);
          }
          nolar.forEach((no, sira) => {
            calistir("INSERT INTO kuyruk_medyalari (kuyruk_id, sira, medya_no) VALUES (?, ?, ?)", kuyruk_id, sira, no);
            calistir("UPDATE medya SET bagli_msg_id = ?, guncelleme_ms = ? WHERE no = ?", msg, ms, no);
          });
        }),
      );
    },
    kuyrukMedyalari(kuyruk_id) {
      return hepsi(
        "SELECT m.* FROM kuyruk_medyalari k JOIN medya m ON m.no = k.medya_no WHERE k.kuyruk_id = ? ORDER BY k.sira",
        kuyruk_id,
      ).map(medyaSatiri);
    },
    medyaYetimBaglariSil() {
      // Kuyruk satırı (geri alınmış eski kodun silmesi) ya da medya kaydı gitmiş bağlar.
      return calistir(
        `DELETE FROM kuyruk_medyalari WHERE kuyruk_id NOT IN (SELECT id FROM eren_kuyrugu)
           OR medya_no NOT IN (SELECT no FROM medya)`,
      ).changes;
    },
    medyaKaydiSil(no) {
      islem(() => {
        calistir("DELETE FROM kuyruk_medyalari WHERE medya_no = ?", no);
        calistir("DELETE FROM medya WHERE no = ?", no);
      });
    },
    nesilGorselSayisi(nesil) {
      const r = bir("SELECT adet FROM nesil_gorselleri WHERE nesil = ?", nesil);
      return r === null ? 0 : sayi(r.adet);
    },
    nesilGorselEkle(nesil, adet) {
      if (!Number.isSafeInteger(nesil)) throw new Error("depo: nesil geçersiz");
      if (!Number.isSafeInteger(adet) || adet < 0) throw new Error("depo: görsel adedi geçersiz");
      calistir(
        `INSERT INTO nesil_gorselleri (nesil, adet) VALUES (?, ?)
         ON CONFLICT (nesil) DO UPDATE SET adet = adet + excluded.adet`,
        nesil,
        adet,
      );
    },
  };
  return depo;
};
