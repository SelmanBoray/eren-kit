-- Şema 3 kodunun (7c8b12d, göç 4 öncesi) sahte kabuklar ve sahte PC ile ürettiği eşleşmiş yerel veritabanı
-- (üreteç: o sürümün tests/ortak düzeneğiyle yazılmış tek seferlik test; VACUUM INTO + Python iterdump).
-- İçerik: PC'de silinmiş kayıt (k_eski, mezar taşı), günlük tekrar ve 2026-11-24 örneği tamam (k_spor),
-- ret listesinde kayıt sınırına takılmış bir ekleme, teslim edilmiş alarm (k_kargo, 14:50 çaldı), kuyrukta
-- onaylanmış satır (k_disci, bekledigi_rev 7: PC uyguladı, kayit gelmedi), yollanmış ama yanıtsız satır
-- (k_spor başlığı) ve arkasında bekleyen sesli not eklemesi. Kişisel veri yoktur.
-- El ile eklenen tek satır en sondadır: meta.alarm_ufku (bütçe aşımı 400+ kayıt isterdi).
-- Göç 4 testi (tests/yukseltme.rs) bunu eşleşmiş ve (eslesme satırı silinerek) eşleşmesiz açar.
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
INSERT INTO "gorunen" VALUES('k_AAECAwQFBg8ICQoLDA0OBw','{"baslik":"Fatura öde","durum":"acik","elle_alanlar":["tur","baslik","zaman","hatirlatmalar"],"guncelleme_ms":1795607460000,"hatirlatmalar":[{"dk":60,"tur":"once"}],"kayit_id":"k_AAECAwQFBg8ICQoLDA0OBw","kaynak":{"device_id":"c_telefon1","tur_kokeni":"insan","yol":"sesli_not"},"olusturma_ms":1795607460000,"ornekler":[],"revizyon":1,"silindi":false,"taslak":false,"tur":"randevu","zaman":{"kesinlik":"an","saat":"10:00","saat_dilimi":"Europe/Istanbul","tarih":"2026-11-27"}}',1,'2026-11-27T10:00',0,0,1,1,1,1795607460000);
INSERT INTO "gorunen" VALUES('k_disci','{"baslik":"Dişçi (kontrol)","durum":"acik","elle_alanlar":["baslik"],"guncelleme_ms":1795607460000,"hatirlatmalar":[{"dk":60,"tur":"once"}],"kayit_id":"k_disci","kaynak":{"sohbet_id":"ana","tur_kokeni":"insan","yol":"sohbet_araci"},"olusturma_ms":1795606200000,"ornekler":[],"revizyon":1,"silindi":false,"taslak":false,"tur":"randevu","zaman":{"kesinlik":"an","saat":"15:00","saat_dilimi":"Europe/Istanbul","tarih":"2026-11-26"}}',1,'2026-11-26T15:00',0,0,1,1,0,1795606200000);
INSERT INTO "gorunen" VALUES('k_eski','{"baslik":"Eski not","durum":"acik","elle_alanlar":[],"guncelleme_ms":1795606200000,"hatirlatmalar":[{"dk":60,"tur":"once"}],"kayit_id":"k_eski","kaynak":{"sohbet_id":"ana","tur_kokeni":"insan","yol":"sohbet_araci"},"olusturma_ms":1795606200000,"ornekler":[],"revizyon":5,"silindi":true,"taslak":false,"tur":"gorev"}',0,'',0,1,1,0,0,1795606200000);
INSERT INTO "gorunen" VALUES('k_kargo','{"baslik":"Kargo","durum":"acik","elle_alanlar":[],"guncelleme_ms":1795606200000,"hatirlatmalar":[{"dk":10,"tur":"once"}],"kayit_id":"k_kargo","kaynak":{"sohbet_id":"ana","tur_kokeni":"insan","yol":"sohbet_araci"},"olusturma_ms":1795606200000,"ornekler":[],"revizyon":4,"silindi":false,"taslak":false,"tur":"randevu","zaman":{"kesinlik":"an","saat":"15:00","saat_dilimi":"Europe/Istanbul","tarih":"2026-11-25"}}',1,'2026-11-25T15:00',0,0,1,1,0,1795606200000);
INSERT INTO "gorunen" VALUES('k_spor','{"baslik":"Spor (koşu)","durum":"acik","elle_alanlar":["baslik"],"guncelleme_ms":1795607460000,"hatirlatmalar":[{"dk":60,"tur":"once"}],"kayit_id":"k_spor","kaynak":{"sohbet_id":"ana","tur_kokeni":"insan","yol":"sohbet_araci"},"olusturma_ms":1795606200000,"ornekler":[{"durum":"tamam","tarih":"2026-11-24"}],"revizyon":6,"silindi":false,"taslak":false,"tekrar":{"aralik":1,"siklik":"gunluk"},"tur":"randevu","zaman":{"kesinlik":"an","saat":"07:00","saat_dilimi":"Europe/Istanbul","tarih":"2026-11-23"}}',1,'2026-11-23T07:00',0,0,1,1,1,1795606200000);
CREATE TABLE kurulu_alarmlar (
        alarm_no     INTEGER PRIMARY KEY AUTOINCREMENT,
        kayit_id     TEXT NOT NULL,
        tetik_ms     INTEGER NOT NULL,
        ornek_tarihi TEXT,
        teslim_ms    INTEGER,
        UNIQUE (kayit_id, tetik_ms)
    );
INSERT INTO "kurulu_alarmlar" VALUES(1,'k_disci',1795690800000,NULL,NULL);
INSERT INTO "kurulu_alarmlar" VALUES(2,'k_kargo',1795607400000,NULL,1795607460000);
INSERT INTO "kurulu_alarmlar" VALUES(3,'k_spor',1795662000000,'2026-11-26',NULL);
INSERT INTO "kurulu_alarmlar" VALUES(4,'k_AAECAwQFBg8ICQoLDA0OBw',1795759200000,NULL,NULL);
CREATE TABLE kuyruk (
        sira         INTEGER PRIMARY KEY AUTOINCREMENT,
        islem_id     TEXT NOT NULL UNIQUE,
        kayit_id     TEXT NOT NULL,
        islem_json   TEXT NOT NULL,
        deneme       INTEGER NOT NULL DEFAULT 0,
        yollandi     INTEGER NOT NULL DEFAULT 0,
        olusturma_ms INTEGER NOT NULL
    , bekledigi_rev INTEGER);
INSERT INTO "kuyruk" VALUES(3,'i_AAECAwQFBgIICQoLDA0OCg','k_disci','{"degisiklik":{"baslik":"Dişçi (kontrol)"},"islem":"guncelle","kayit_id":"k_disci","temel_revizyon":1}',0,0,1795607460000,7);
INSERT INTO "kuyruk" VALUES(4,'i_AAECAwQFBgAICQoLDA0OCA','k_spor','{"degisiklik":{"baslik":"Spor (koşu)"},"islem":"guncelle","kayit_id":"k_spor","temel_revizyon":6}',0,1,1795607460000,NULL);
INSERT INTO "kuyruk" VALUES(5,'i_AAECAwQFBg4ICQoLDA0OBg','k_AAECAwQFBg8ICQoLDA0OBw','{"baslik":"Fatura öde","girdi_yolu":"sesli_not","hatirlatmalar":[{"dk":60,"tur":"once"}],"islem":"ekle","kayit_id":"k_AAECAwQFBg8ICQoLDA0OBw","tur":"randevu","zaman":{"kesinlik":"an","saat":"10:00","saat_dilimi":"Europe/Istanbul","tarih":"2026-11-27"}}',0,0,1795607460000,NULL);
CREATE TABLE meta (
        anahtar TEXT PRIMARY KEY,
        deger   TEXT NOT NULL
    ) WITHOUT ROWID;
INSERT INTO "meta" VALUES('depo_id','d_pc1');
INSERT INTO "meta" VALUES('eslesme','{"device_id":"c_telefon1","host":"100.64.0.1","port":8787,"server_public_key":"CQkJCQ=="}');
INSERT INTO "meta" VALUES('son_esitlenme_ms','1795607460000');
INSERT INTO "meta" VALUES('son_rev','6');
CREATE TABLE ret_listesi (
        islem_id   TEXT PRIMARY KEY,
        kayit_id   TEXT NOT NULL,
        islem_json TEXT NOT NULL,
        neden      TEXT NOT NULL,
        ts_ms      INTEGER NOT NULL
    , govde_json TEXT, sira INTEGER NOT NULL DEFAULT 0) WITHOUT ROWID;
INSERT INTO "ret_listesi" VALUES('i_AAECAwQFBgMICQoLDA0OCw','k_AAECAwQFBgQICQoLDA0ODA','{"baslik":"Sığmayan","girdi_yolu":"elle","hatirlatmalar":[{"dk":60,"tur":"once"}],"islem":"ekle","kayit_id":"k_AAECAwQFBgQICQoLDA0ODA","tur":"randevu"}','kayit_siniri',1795606200000,'{"baslik":"Sığmayan","hatirlatmalar":[{"dk":60,"tur":"once"}],"tur":"randevu"}',2);
CREATE TABLE sunucu_kayitlari (
        kayit_id      TEXT PRIMARY KEY,
        revizyon      INTEGER NOT NULL,
        guncelleme_ms INTEGER NOT NULL,
        json          TEXT NOT NULL
    ) WITHOUT ROWID;
INSERT INTO "sunucu_kayitlari" VALUES('k_disci',1,1795606200000,'{"baslik":"Dişçi","durum":"acik","elle_alanlar":[],"guncelleme_ms":1795606200000,"hatirlatmalar":[{"dk":60,"tur":"once"}],"kayit_id":"k_disci","kaynak":{"sohbet_id":"ana","tur_kokeni":"insan","yol":"sohbet_araci"},"olusturma_ms":1795606200000,"ornekler":[],"revizyon":1,"silindi":false,"taslak":false,"tur":"randevu","zaman":{"kesinlik":"an","saat":"15:00","saat_dilimi":"Europe/Istanbul","tarih":"2026-11-26"}}');
INSERT INTO "sunucu_kayitlari" VALUES('k_eski',5,1795606200000,'{"baslik":"Eski not","durum":"acik","elle_alanlar":[],"guncelleme_ms":1795606200000,"hatirlatmalar":[{"dk":60,"tur":"once"}],"kayit_id":"k_eski","kaynak":{"sohbet_id":"ana","tur_kokeni":"insan","yol":"sohbet_araci"},"olusturma_ms":1795606200000,"ornekler":[],"revizyon":5,"silindi":true,"taslak":false,"tur":"gorev"}');
INSERT INTO "sunucu_kayitlari" VALUES('k_kargo',4,1795606200000,'{"baslik":"Kargo","durum":"acik","elle_alanlar":[],"guncelleme_ms":1795606200000,"hatirlatmalar":[{"dk":10,"tur":"once"}],"kayit_id":"k_kargo","kaynak":{"sohbet_id":"ana","tur_kokeni":"insan","yol":"sohbet_araci"},"olusturma_ms":1795606200000,"ornekler":[],"revizyon":4,"silindi":false,"taslak":false,"tur":"randevu","zaman":{"kesinlik":"an","saat":"15:00","saat_dilimi":"Europe/Istanbul","tarih":"2026-11-25"}}');
INSERT INTO "sunucu_kayitlari" VALUES('k_spor',6,1795606200000,'{"baslik":"Spor","durum":"acik","elle_alanlar":[],"guncelleme_ms":1795606200000,"hatirlatmalar":[{"dk":60,"tur":"once"}],"kayit_id":"k_spor","kaynak":{"sohbet_id":"ana","tur_kokeni":"insan","yol":"sohbet_araci"},"olusturma_ms":1795606200000,"ornekler":[{"durum":"tamam","tarih":"2026-11-24"}],"revizyon":6,"silindi":false,"taslak":false,"tekrar":{"aralik":1,"siklik":"gunluk"},"tur":"randevu","zaman":{"kesinlik":"an","saat":"07:00","saat_dilimi":"Europe/Istanbul","tarih":"2026-11-23"}}');
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
INSERT INTO "sqlite_sequence" VALUES('kurulu_alarmlar',4);
INSERT INTO "sqlite_sequence" VALUES('kuyruk',5);
-- El ile eklendi (üretilmedi): alarm ufku.
INSERT INTO "meta" VALUES('alarm_ufku','1795759200000 k_AAECAwQFBg8ICQoLDA0OBw');
