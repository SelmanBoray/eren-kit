//! SAHİBİ: R4 (yerel depo ve eşitleme motoru). SQLite şeması. Sürüm `PRAGMA user_version`'dadır;
//! yeni göç dizinin sonuna eklenir, yayımlanmış adım değişmez. (İlk yayından önce, yalnız R4 ve
//! şef sırasıyla, 2. göç yerinde düzeltilebilir: `MIMARI.md` "Ortak dosyalar".)
//!
//! `kurulu_alarmlar` tablosunu R3 (`depo/alarmlar.rs`) kullanır; sütun değişikliği R3 ile birlikte.

pub const GOCLER: &[&str] = &[
    // 1: iskelet tablosu (köprü kanıtı). Yayımlanmış iskelet APK'sı açabilsin diye durur, 2. göç siler.
    "CREATE TABLE kayit (
        kimlik INTEGER PRIMARY KEY,
        metin  TEXT NOT NULL,
        imza   BLOB
    );",
    // 2: ajanda.
    "DROP TABLE kayit;

    -- Tekil değerler: eşleşme (QR, device_id, sunucu anahtarı), depo_id, son_rev, telafi durumu.
    CREATE TABLE meta (
        anahtar TEXT PRIMARY KEY,
        deger   TEXT NOT NULL
    ) WITHOUT ROWID;

    -- Sunucu kopyası: PC'den gelen son haller (`kayit` çerçevesi), mezar taşları dahil.
    CREATE TABLE sunucu_kayitlari (
        kayit_id      TEXT PRIMARY KEY,
        revizyon      INTEGER NOT NULL,
        guncelleme_ms INTEGER NOT NULL,
        json          TEXT NOT NULL
    ) WITHOUT ROWID;
    CREATE INDEX sunucu_kayitlari_revizyon ON sunucu_kayitlari (revizyon);

    -- Süren tam telafinin topladıkları (`esitlendi`'de sunucu kopyasının yerine geçer, kopmada silinir).
    CREATE TABLE telafi_kayitlari (
        kayit_id      TEXT PRIMARY KEY,
        revizyon      INTEGER NOT NULL,
        guncelleme_ms INTEGER NOT NULL,
        json          TEXT NOT NULL
    ) WITHOUT ROWID;

    -- Kalıcı işlem kuyruğu: sırayla, birer birer. `deneme`: sonuçsuz deneme sayısı.
    -- `yollandi`: bu bağlantıda yollandı, sonucu bekleniyor (kopmada deneme sayılır).
    CREATE TABLE kuyruk (
        sira         INTEGER PRIMARY KEY AUTOINCREMENT,
        islem_id     TEXT NOT NULL UNIQUE,
        kayit_id     TEXT NOT NULL,
        islem_json   TEXT NOT NULL,
        deneme       INTEGER NOT NULL DEFAULT 0,
        yollandi     INTEGER NOT NULL DEFAULT 0,
        olusturma_ms INTEGER NOT NULL
    );
    CREATE INDEX kuyruk_kayit ON kuyruk (kayit_id);

    -- Kullanıcıya görünen ret listesi (`AJANDA_KUYRUK_RET_NEDENLERI`).
    CREATE TABLE ret_listesi (
        islem_id   TEXT PRIMARY KEY,
        kayit_id   TEXT NOT NULL,
        islem_json TEXT NOT NULL,
        neden      TEXT NOT NULL,
        ts_ms      INTEGER NOT NULL
    ) WITHOUT ROWID;

    -- Görünen kopya: sunucu kopyası + kuyruktaki işlemlerin iyimser uygulaması. Arayüz ve alarmlar
    -- yalnız bunu okur. Sıralama ve süzme sütunları `json`'dan türetilir (`depo/gorunen.rs`).
    CREATE TABLE gorunen (
        kayit_id     TEXT PRIMARY KEY,
        json         TEXT NOT NULL,
        tarihli      INTEGER NOT NULL,
        sira_anahtari TEXT NOT NULL,
        taslak       INTEGER NOT NULL,
        silindi      INTEGER NOT NULL,
        acik         INTEGER NOT NULL,
        etkin        INTEGER NOT NULL,
        bekleyen     INTEGER NOT NULL,
        olusturma_ms INTEGER NOT NULL
    ) WITHOUT ROWID;
    CREATE INDEX gorunen_liste ON gorunen (silindi, tarihli, sira_anahtari);

    -- Android'e kurdurulan alarmlar, teslim edilene dek (`kacirilanHatirlatmalar`).
    -- Kimlik `(kayit_id, tetik_ms)`; `alarm_no` Android PendingIntent istek kodudur.
    CREATE TABLE kurulu_alarmlar (
        alarm_no     INTEGER PRIMARY KEY AUTOINCREMENT,
        kayit_id     TEXT NOT NULL,
        tetik_ms     INTEGER NOT NULL,
        ornek_tarihi TEXT,
        teslim_ms    INTEGER,
        UNIQUE (kayit_id, tetik_ms)
    );",
];
