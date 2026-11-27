-- Şema 3 kodunun (göç 4 öncesi) ürettiği eşleşmesiz yerel veritabanı: sahte kabuklarla, PC'siz.
-- Kuyrukta 8 işlem: dört ekle (Dişçi, Fatura öde [sesli not, görev], Silinecek, Spor [günlük tekrar]),
-- Dişçi'ye guncelle, Fatura'ya durum tamam, Silinecek'e sil, Spor'un 2026-11-24 örneğine durum tamam.
-- Görünen kopya bunların iyimser halidir (bekleyen 1); iki kurulu alarm. Kişisel veri yoktur.
-- Göç 4 testi (tests/yukseltme.rs) bunu yeni koda açar.
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
INSERT INTO "gorunen" VALUES('k_AAECAwQFBgAICQoLDA0OCA','{"baslik":"Spor","durum":"acik","elle_alanlar":["tur","baslik","zaman","hatirlatmalar","tekrar"],"guncelleme_ms":1795606440000,"hatirlatmalar":[{"dk":60,"tur":"once"}],"kayit_id":"k_AAECAwQFBgAICQoLDA0OCA","kaynak":{"device_id":"yerel","tur_kokeni":"insan","yol":"elle"},"olusturma_ms":1795606380000,"ornekler":[{"durum":"tamam","tarih":"2026-11-24"}],"revizyon":1,"silindi":false,"taslak":false,"tekrar":{"aralik":1,"siklik":"gunluk"},"tur":"randevu","zaman":{"kesinlik":"an","saat":"07:00","saat_dilimi":"Europe/Istanbul","tarih":"2026-11-23"}}',1,'2026-11-23T07:00',0,0,1,1,1,1795606380000);
INSERT INTO "gorunen" VALUES('k_AAECAwQFBgIICQoLDA0OCg','{"baslik":"Silinecek","durum":"acik","elle_alanlar":["tur","baslik","hatirlatmalar"],"guncelleme_ms":1795606440000,"hatirlatmalar":[{"dk":60,"tur":"once"}],"kayit_id":"k_AAECAwQFBgIICQoLDA0OCg","kaynak":{"device_id":"yerel","tur_kokeni":"insan","yol":"elle"},"olusturma_ms":1795606320000,"ornekler":[],"revizyon":1,"silindi":true,"taslak":false,"tur":"randevu"}',0,'',0,1,1,0,1,1795606320000);
INSERT INTO "gorunen" VALUES('k_AAECAwQFBgQICQoLDA0ODA','{"baslik":"Fatura öde","durum":"tamam","elle_alanlar":["tur","baslik","zaman","hatirlatmalar","durum"],"guncelleme_ms":1795606440000,"hatirlatmalar":[{"dk":60,"tur":"once"}],"kayit_id":"k_AAECAwQFBgQICQoLDA0ODA","kaynak":{"device_id":"yerel","tur_kokeni":"insan","yol":"sesli_not"},"olusturma_ms":1795606260000,"ornekler":[],"revizyon":1,"silindi":false,"taslak":false,"tur":"gorev","zaman":{"kesinlik":"an","saat":"10:00","saat_dilimi":"Europe/Istanbul","tarih":"2026-11-27"}}',1,'2026-11-27T10:00',0,0,0,0,1,1795606260000);
INSERT INTO "gorunen" VALUES('k_AAECAwQFBgYICQoLDA0ODg','{"baslik":"Dişçi (kontrol)","durum":"acik","elle_alanlar":["tur","baslik","zaman","hatirlatmalar"],"guncelleme_ms":1795606440000,"hatirlatmalar":[{"dk":60,"tur":"once"}],"kayit_id":"k_AAECAwQFBgYICQoLDA0ODg","kaynak":{"device_id":"yerel","tur_kokeni":"insan","yol":"elle"},"olusturma_ms":1795606200000,"ornekler":[],"revizyon":1,"silindi":false,"taslak":false,"tur":"randevu","zaman":{"kesinlik":"an","saat":"16:00","saat_dilimi":"Europe/Istanbul","tarih":"2026-11-26"}}',1,'2026-11-26T16:00',0,0,1,1,1,1795606200000);
CREATE TABLE kurulu_alarmlar (
        alarm_no     INTEGER PRIMARY KEY AUTOINCREMENT,
        kayit_id     TEXT NOT NULL,
        tetik_ms     INTEGER NOT NULL,
        ornek_tarihi TEXT,
        teslim_ms    INTEGER,
        UNIQUE (kayit_id, tetik_ms)
    );
INSERT INTO "kurulu_alarmlar" VALUES(3,'k_AAECAwQFBgAICQoLDA0OCA',1795662000000,'2026-11-26',NULL);
INSERT INTO "kurulu_alarmlar" VALUES(4,'k_AAECAwQFBgYICQoLDA0ODg',1795694400000,NULL,NULL);
CREATE TABLE kuyruk (
        sira         INTEGER PRIMARY KEY AUTOINCREMENT,
        islem_id     TEXT NOT NULL UNIQUE,
        kayit_id     TEXT NOT NULL,
        islem_json   TEXT NOT NULL,
        deneme       INTEGER NOT NULL DEFAULT 0,
        yollandi     INTEGER NOT NULL DEFAULT 0,
        olusturma_ms INTEGER NOT NULL
    , bekledigi_rev INTEGER);
INSERT INTO "kuyruk" VALUES(1,'i_AAECAwQFBgUICQoLDA0ODQ','k_AAECAwQFBgYICQoLDA0ODg','{"baslik":"Dişçi","girdi_yolu":"elle","hatirlatmalar":[{"dk":60,"tur":"once"}],"islem":"ekle","kayit_id":"k_AAECAwQFBgYICQoLDA0ODg","tur":"randevu","zaman":{"kesinlik":"an","saat":"15:00","saat_dilimi":"Europe/Istanbul","tarih":"2026-11-26"}}',0,0,1795606200000,NULL);
INSERT INTO "kuyruk" VALUES(2,'i_AAECAwQFBgMICQoLDA0OCw','k_AAECAwQFBgQICQoLDA0ODA','{"baslik":"Fatura öde","girdi_yolu":"sesli_not","hatirlatmalar":[{"dk":60,"tur":"once"}],"islem":"ekle","kayit_id":"k_AAECAwQFBgQICQoLDA0ODA","tur":"gorev","zaman":{"kesinlik":"an","saat":"10:00","saat_dilimi":"Europe/Istanbul","tarih":"2026-11-27"}}',0,0,1795606260000,NULL);
INSERT INTO "kuyruk" VALUES(3,'i_AAECAwQFBgEICQoLDA0OCQ','k_AAECAwQFBgIICQoLDA0OCg','{"baslik":"Silinecek","girdi_yolu":"elle","hatirlatmalar":[{"dk":60,"tur":"once"}],"islem":"ekle","kayit_id":"k_AAECAwQFBgIICQoLDA0OCg","tur":"randevu"}',0,0,1795606320000,NULL);
INSERT INTO "kuyruk" VALUES(4,'i_AAECAwQFBg8ICQoLDA0OBw','k_AAECAwQFBgAICQoLDA0OCA','{"baslik":"Spor","girdi_yolu":"elle","hatirlatmalar":[{"dk":60,"tur":"once"}],"islem":"ekle","kayit_id":"k_AAECAwQFBgAICQoLDA0OCA","tekrar":{"aralik":1,"siklik":"gunluk"},"tur":"randevu","zaman":{"kesinlik":"an","saat":"07:00","saat_dilimi":"Europe/Istanbul","tarih":"2026-11-23"}}',0,0,1795606380000,NULL);
INSERT INTO "kuyruk" VALUES(5,'i_AAECAwQFBg4ICQoLDA0OBg','k_AAECAwQFBgYICQoLDA0ODg','{"degisiklik":{"baslik":"Dişçi (kontrol)","zaman":{"kesinlik":"an","saat":"16:00","saat_dilimi":"Europe/Istanbul","tarih":"2026-11-26"}},"islem":"guncelle","kayit_id":"k_AAECAwQFBgYICQoLDA0ODg","temel_revizyon":1}',0,0,1795606440000,NULL);
INSERT INTO "kuyruk" VALUES(6,'i_AAECAwQFBg0ICQoLDA0OBQ','k_AAECAwQFBgQICQoLDA0ODA','{"durum":"tamam","islem":"durum","kayit_id":"k_AAECAwQFBgQICQoLDA0ODA"}',0,0,1795606440000,NULL);
INSERT INTO "kuyruk" VALUES(7,'i_AAECAwQFBgwICQoLDA0OBA','k_AAECAwQFBgIICQoLDA0OCg','{"islem":"sil","kayit_id":"k_AAECAwQFBgIICQoLDA0OCg"}',0,0,1795606440000,NULL);
INSERT INTO "kuyruk" VALUES(8,'i_AAECAwQFBgsICQoLDA0OAw','k_AAECAwQFBgAICQoLDA0OCA','{"durum":"tamam","islem":"durum","kayit_id":"k_AAECAwQFBgAICQoLDA0OCA","ornek_tarihi":"2026-11-24"}',0,0,1795606440000,NULL);
CREATE TABLE meta (
        anahtar TEXT PRIMARY KEY,
        deger   TEXT NOT NULL
    ) WITHOUT ROWID;
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
CREATE TABLE telafi_kayitlari (
        kayit_id      TEXT PRIMARY KEY,
        revizyon      INTEGER NOT NULL,
        guncelleme_ms INTEGER NOT NULL,
        json          TEXT NOT NULL
    ) WITHOUT ROWID;
CREATE INDEX gorunen_liste ON gorunen (silindi, tarihli, sira_anahtari);
CREATE INDEX kuyruk_kayit ON kuyruk (kayit_id);
CREATE INDEX sunucu_kayitlari_revizyon ON sunucu_kayitlari (revizyon);
DELETE FROM "sqlite_sequence";
INSERT INTO "sqlite_sequence" VALUES('kurulu_alarmlar',4);
INSERT INTO "sqlite_sequence" VALUES('kuyruk',8);
