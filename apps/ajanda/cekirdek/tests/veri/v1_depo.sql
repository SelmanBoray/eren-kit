-- Sürüm 1 uygulamasının (AJANDA_SURUMU 1, şema 3) ürettiği yerel veritabanı; sahte PC ile eşleşmiş,
-- beş sunucu kaydı, kuyrukta bir çevrimdışı ekleme, iki kurulu alarm. Kişisel veri yoktur.
-- Yükseltme testi (tests/yukseltme.rs) bunu yeni koda açar.
PRAGMA user_version = 3;
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
INSERT INTO "gorunen" VALUES('k_AAECAwQFBgUICQoLDA0ODQ','{"baslik":"Fatura öde","durum":"acik","elle_alanlar":["tur","baslik","zaman","hatirlatmalar"],"guncelleme_ms":1795606200000,"hatirlatmalar":[{"dk":60,"tur":"once"}],"kayit_id":"k_AAECAwQFBgUICQoLDA0ODQ","kaynak":{"device_id":"c_telefon1","tur_kokeni":"insan","yol":"elle"},"olusturma_ms":1795606200000,"ornekler":[],"revizyon":1,"silindi":false,"taslak":false,"tur":"gorev","zaman":{"kesinlik":"gun","saat_dilimi":"Europe/Istanbul","tarih":"2026-11-27"}}',1,'2026-11-27 ',0,0,1,1,1,1795606200000);
INSERT INTO "gorunen" VALUES('k_araba','{"baslik":"Araba yıkama","durum":"acik","elle_alanlar":[],"guncelleme_ms":1795606200000,"hatirlatmalar":[{"dk":60,"tur":"once"}],"kayit_id":"k_araba","kaynak":{"sohbet_id":"ana","tur_kokeni":"insan","yol":"sohbet_araci"},"olusturma_ms":1795606200000,"ornekler":[],"revizyon":3,"silindi":false,"taslak":false,"tur":"gorev","zaman":{"ifade":"yarın akşama","kesinlik":"gun","saat_dilimi":"Europe/Istanbul","tarih":"2026-11-28"}}',1,'2026-11-28 ',0,0,1,1,0,1795606200000);
INSERT INTO "gorunen" VALUES('k_bugun','{"baslik":"Bugünkü iş","durum":"acik","elle_alanlar":[],"guncelleme_ms":1795606200000,"hatirlatmalar":[{"dk":60,"tur":"once"}],"kayit_id":"k_bugun","kaynak":{"sohbet_id":"ana","tur_kokeni":"insan","yol":"sohbet_araci"},"olusturma_ms":1795606200000,"ornekler":[],"revizyon":4,"silindi":false,"taslak":false,"tur":"gorev","zaman":{"ifade":"bugün","kesinlik":"gun","saat_dilimi":"Europe/Istanbul","tarih":"2026-11-25"}}',1,'2026-11-25 ',0,0,1,1,0,1795606200000);
INSERT INTO "gorunen" VALUES('k_disci','{"baslik":"Dişçi","durum":"acik","elle_alanlar":[],"guncelleme_ms":1795606200000,"hatirlatmalar":[{"dk":60,"tur":"once"}],"kayit_id":"k_disci","kaynak":{"sohbet_id":"ana","tur_kokeni":"insan","yol":"sohbet_araci"},"olusturma_ms":1795606200000,"ornekler":[],"revizyon":1,"silindi":false,"taslak":false,"tur":"randevu","zaman":{"kesinlik":"an","saat":"15:00","saat_dilimi":"Europe/Istanbul","tarih":"2026-11-26"}}',1,'2026-11-26T15:00',0,0,1,1,0,1795606200000);
INSERT INTO "gorunen" VALUES('k_ekmek','{"baslik":"Ekmek al","durum":"acik","elle_alanlar":[],"guncelleme_ms":1795606200000,"hatirlatmalar":[{"dk":60,"tur":"once"}],"kayit_id":"k_ekmek","kaynak":{"sohbet_id":"ana","tur_kokeni":"insan","yol":"sohbet_araci"},"olusturma_ms":1795606200000,"ornekler":[],"revizyon":5,"silindi":false,"taslak":false,"tur":"gorev"}',0,'',0,0,1,1,0,1795606200000);
INSERT INTO "gorunen" VALUES('k_toplanti','{"baslik":"Toplantı","durum":"acik","elle_alanlar":[],"guncelleme_ms":1795606200000,"hatirlatmalar":[{"dk":60,"tur":"once"}],"kayit_id":"k_toplanti","kaynak":{"sohbet_id":"ana","tur_kokeni":"insan","yol":"sohbet_araci"},"olusturma_ms":1795606200000,"ornekler":[],"revizyon":2,"silindi":false,"taslak":false,"tur":"randevu","zaman":{"kesinlik":"an","saat":"10:00","saat_dilimi":"Europe/Istanbul","tarih":"2026-11-27"}}',1,'2026-11-27T10:00',0,0,1,1,0,1795606200000);
CREATE TABLE kurulu_alarmlar (
        alarm_no     INTEGER PRIMARY KEY AUTOINCREMENT,
        kayit_id     TEXT NOT NULL,
        tetik_ms     INTEGER NOT NULL,
        ornek_tarihi TEXT,
        teslim_ms    INTEGER,
        UNIQUE (kayit_id, tetik_ms)
    );
INSERT INTO "kurulu_alarmlar" VALUES(1,'k_disci',1795690800000,NULL,NULL);
INSERT INTO "kurulu_alarmlar" VALUES(2,'k_toplanti',1795759200000,NULL,NULL);
CREATE TABLE kuyruk (
        sira         INTEGER PRIMARY KEY AUTOINCREMENT,
        islem_id     TEXT NOT NULL UNIQUE,
        kayit_id     TEXT NOT NULL,
        islem_json   TEXT NOT NULL,
        deneme       INTEGER NOT NULL DEFAULT 0,
        yollandi     INTEGER NOT NULL DEFAULT 0,
        olusturma_ms INTEGER NOT NULL
    , bekledigi_rev INTEGER);
INSERT INTO "kuyruk" VALUES(1,'i_AAECAwQFBgQICQoLDA0ODA','k_AAECAwQFBgUICQoLDA0ODQ','{"baslik":"Fatura öde","girdi_yolu":"elle","hatirlatmalar":[{"dk":60,"tur":"once"}],"islem":"ekle","kayit_id":"k_AAECAwQFBgUICQoLDA0ODQ","tur":"gorev","zaman":{"kesinlik":"gun","saat_dilimi":"Europe/Istanbul","tarih":"2026-11-27"}}',0,0,1795606200000,NULL);
CREATE TABLE meta (
        anahtar TEXT PRIMARY KEY,
        deger   TEXT NOT NULL
    ) WITHOUT ROWID;
INSERT INTO "meta" VALUES('depo_id','d_pc1');
INSERT INTO "meta" VALUES('eslesme','{"device_id":"c_telefon1","host":"100.64.0.1","port":8787,"server_public_key":"CQkJCQ=="}');
INSERT INTO "meta" VALUES('son_esitlenme_ms','1795606200000');
INSERT INTO "meta" VALUES('son_rev','5');
CREATE TABLE ret_listesi (
        islem_id   TEXT PRIMARY KEY,
        kayit_id   TEXT NOT NULL,
        islem_json TEXT NOT NULL,
        neden      TEXT NOT NULL,
        ts_ms      INTEGER NOT NULL
    , govde_json TEXT, sira INTEGER NOT NULL DEFAULT 0) WITHOUT ROWID;
CREATE TABLE sunucu_kayitlari (
        kayit_id      TEXT PRIMARY KEY,
        revizyon      INTEGER NOT NULL,
        guncelleme_ms INTEGER NOT NULL,
        json          TEXT NOT NULL
    ) WITHOUT ROWID;
INSERT INTO "sunucu_kayitlari" VALUES('k_araba',3,1795606200000,'{"baslik":"Araba yıkama","durum":"acik","elle_alanlar":[],"guncelleme_ms":1795606200000,"hatirlatmalar":[{"dk":60,"tur":"once"}],"kayit_id":"k_araba","kaynak":{"sohbet_id":"ana","tur_kokeni":"insan","yol":"sohbet_araci"},"olusturma_ms":1795606200000,"ornekler":[],"revizyon":3,"silindi":false,"taslak":false,"tur":"gorev","zaman":{"ifade":"yarın akşama","kesinlik":"gun","saat_dilimi":"Europe/Istanbul","tarih":"2026-11-28"}}');
INSERT INTO "sunucu_kayitlari" VALUES('k_bugun',4,1795606200000,'{"baslik":"Bugünkü iş","durum":"acik","elle_alanlar":[],"guncelleme_ms":1795606200000,"hatirlatmalar":[{"dk":60,"tur":"once"}],"kayit_id":"k_bugun","kaynak":{"sohbet_id":"ana","tur_kokeni":"insan","yol":"sohbet_araci"},"olusturma_ms":1795606200000,"ornekler":[],"revizyon":4,"silindi":false,"taslak":false,"tur":"gorev","zaman":{"ifade":"bugün","kesinlik":"gun","saat_dilimi":"Europe/Istanbul","tarih":"2026-11-25"}}');
INSERT INTO "sunucu_kayitlari" VALUES('k_disci',1,1795606200000,'{"baslik":"Dişçi","durum":"acik","elle_alanlar":[],"guncelleme_ms":1795606200000,"hatirlatmalar":[{"dk":60,"tur":"once"}],"kayit_id":"k_disci","kaynak":{"sohbet_id":"ana","tur_kokeni":"insan","yol":"sohbet_araci"},"olusturma_ms":1795606200000,"ornekler":[],"revizyon":1,"silindi":false,"taslak":false,"tur":"randevu","zaman":{"kesinlik":"an","saat":"15:00","saat_dilimi":"Europe/Istanbul","tarih":"2026-11-26"}}');
INSERT INTO "sunucu_kayitlari" VALUES('k_ekmek',5,1795606200000,'{"baslik":"Ekmek al","durum":"acik","elle_alanlar":[],"guncelleme_ms":1795606200000,"hatirlatmalar":[{"dk":60,"tur":"once"}],"kayit_id":"k_ekmek","kaynak":{"sohbet_id":"ana","tur_kokeni":"insan","yol":"sohbet_araci"},"olusturma_ms":1795606200000,"ornekler":[],"revizyon":5,"silindi":false,"taslak":false,"tur":"gorev"}');
INSERT INTO "sunucu_kayitlari" VALUES('k_toplanti',2,1795606200000,'{"baslik":"Toplantı","durum":"acik","elle_alanlar":[],"guncelleme_ms":1795606200000,"hatirlatmalar":[{"dk":60,"tur":"once"}],"kayit_id":"k_toplanti","kaynak":{"sohbet_id":"ana","tur_kokeni":"insan","yol":"sohbet_araci"},"olusturma_ms":1795606200000,"ornekler":[],"revizyon":2,"silindi":false,"taslak":false,"tur":"randevu","zaman":{"kesinlik":"an","saat":"10:00","saat_dilimi":"Europe/Istanbul","tarih":"2026-11-27"}}');
CREATE TABLE telafi_kayitlari (
        kayit_id      TEXT PRIMARY KEY,
        revizyon      INTEGER NOT NULL,
        guncelleme_ms INTEGER NOT NULL,
        json          TEXT NOT NULL
    ) WITHOUT ROWID;
CREATE INDEX sunucu_kayitlari_revizyon ON sunucu_kayitlari (revizyon);
CREATE INDEX kuyruk_kayit ON kuyruk (kayit_id);
CREATE INDEX gorunen_liste ON gorunen (silindi, tarihli, sira_anahtari);
DELETE FROM "sqlite_sequence";
INSERT INTO "sqlite_sequence" VALUES('kurulu_alarmlar',2);
INSERT INTO "sqlite_sequence" VALUES('kuyruk',1);
