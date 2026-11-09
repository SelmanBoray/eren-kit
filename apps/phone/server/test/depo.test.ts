import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, describe, it } from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  ANA_SOHBET_ADI,
  ANA_SOHBET_ID,
  SILINMEZ_OLAY_TURLERI,
  SOHBET_SINIRLARI,
  planHash,
  sohbetAnahtari,
} from "@eren/protocol";
import type { Olay, Plan, SohbetId } from "@eren/protocol";
import { depoKur } from "../src/depo.ts";
import type {
  CihazKaydi,
  Depo,
  IsKaydi,
  NesilKaydi,
  OlayGirdisi,
  PlanKaydi,
  ServisOlaylari,
  SohbetKaydi,
  SohbetSecimi,
  SoruKaydi,
  TurKaydi,
  Veriyolu,
} from "../src/sozlesme.ts";
import { sahteGunluk, sahteZaman } from "./sahte.ts";

// ---------------------------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------------------------

const kok = mkdtempSync(join(tmpdir(), "eren-depo-test-"));
after(() => rmSync(kok, { recursive: true, force: true }));

let sayac = 0;
const yeniYol = (): string => join(kok, `vt-${++sayac}.db`);

/** Dilim 2: varsayılan sohbet ve iki ek sohbet. Kod `"ana"`yı elle yazmaz, sabitten alır. */
const ANA: SohbetSecimi = { sohbet_id: ANA_SOHBET_ID };
const A_ID: SohbetId = "sohbet-a";
const B_ID: SohbetId = "sohbet-b";
const A: SohbetSecimi = { sohbet_id: A_ID };
const B: SohbetSecimi = { sohbet_id: B_ID };

/** Küçük yerel yakalayıcı: yalnız `olay_yazildi` ile ilgileniriz. */
interface Yakalayici extends Veriyolu {
  yayinlar: Array<{ ad: string; veri: unknown }>;
  olaylar(): Olay[];
  /** Her yayında çağrılır (yayın anında ne görüldüğünü ölçmek için). */
  yayinda?: (olay: Olay) => void;
}

const yakalayici = (): Yakalayici => {
  const y: Yakalayici = {
    yayinlar: [],
    yayinla: (ad, veri) => {
      y.yayinlar.push({ ad, veri });
      if (ad === "olay_yazildi") y.yayinda?.((veri as ServisOlaylari["olay_yazildi"]).olay);
    },
    dinle: () => () => {},
    olaylar: () =>
      y.yayinlar.filter((x) => x.ad === "olay_yazildi").map((x) => (x.veri as ServisOlaylari["olay_yazildi"]).olay),
  };
  return y;
};

const acilanlar: Depo[] = [];
const kapaniyor = (d: Depo): Depo => {
  acilanlar.push(d);
  return d;
};
afterEach(() => {
  for (const d of acilanlar.splice(0)) {
    try {
      d.kapat();
    } catch {
      // zaten kapalı
    }
  }
});

const kur = (yol = ":memory:", veriyolu: Veriyolu | undefined = yakalayici()) => {
  const zaman = sahteZaman();
  const gunluk = sahteGunluk();
  const depo = kapaniyor(depoKur({ yol, saat: zaman.saat, ...(veriyolu ? { veriyolu } : {}), gunluk }));
  return { depo, zaman, gunluk, veriyolu: veriyolu as Yakalayici | undefined };
};

const hamAc = <T>(yol: string, f: (ham: DatabaseSync) => T): T => {
  const ham = new DatabaseSync(yol);
  try {
    return f(ham);
  } finally {
    ham.close();
  }
};
const say = (yol: string, tablo: string): number =>
  hamAc(yol, (h) => (h.prepare(`SELECT COUNT(*) AS n FROM ${tablo}`).get() as { n: number }).n);

const rapor = { yapildi: ["a"], yapilmadi: [], dosyalar: ["C:\\ornek\\x.txt"], acik_noktalar: ["b"] };

const pcPlan = (plan_id = "plan1"): Plan => ({
  plan_id,
  baslik: "Örnek iş: ğüşiöç",
  tur: "pc",
  cwd: "C:\\ornek\\proje",
  gorev_metni: "Türkçe görev\nikinci satır \u{1F600}",
  mcp_profili: "rea",
});

const telefonPlan = (plan_id = "plan2"): Plan => ({
  plan_id,
  baslik: "Telefon işi",
  tur: "telefon",
  cwd: "",
  gorev_metni: "oku",
  telefon_izin_istegi: { uygulamalar: ["com.ornek.uygulama"], mod: "oku" },
  kirli_kaynak: [1],
});

const planKaydi = (
  plan: Plan,
  profil: PlanKaydi["profil"] = "tam",
  sohbet_id: SohbetId = ANA_SOHBET_ID,
): PlanKaydi => ({
  plan,
  plan_hash: planHash(plan),
  durum: "bekliyor",
  is_id: null,
  olusturma_ms: 1000,
  profil,
  sohbet_id,
});

const isGirdisi = (plan_id: string, ek: Partial<Omit<IsKaydi, "is_id">> = {}): Omit<IsKaydi, "is_id"> => ({
  sohbet_id: ANA_SOHBET_ID,
  plan_id,
  plan_hash: "a".repeat(64),
  baslik: "baslik",
  tur: "pc",
  cwd: "C:\\ornek\\proje",
  durum: "calisiyor",
  kirli: false,
  session_id: "11111111-1111-4111-8111-111111111111",
  pid: null,
  olusturma_ms: null,
  baslangic_ms: 5000,
  bitis_ms: null,
  out_ofset: 0,
  rapor: null,
  rapor_kaynak: null,
  son_result: null,
  durdurma: null,
  ...ek,
});

/** Plan + iş: ilişkili tabloların sırası bozulmasın diye hep bu sırayla. Plan işin sohbetindedir. */
const isOlustur = (depo: Depo, plan_id: string, ek: Partial<Omit<IsKaydi, "is_id">> = {}) => {
  depo.planEkle(planKaydi(pcPlan(plan_id), "tam", ek.sohbet_id ?? ANA_SOHBET_ID));
  return depo.isEkle(isGirdisi(plan_id, ek));
};

const kullaniciOlayi = (n: number, text = `merhaba ${n}`, sohbet_id: SohbetId = ANA_SOHBET_ID): OlayGirdisi => ({
  type: "user_echo",
  sohbet_id,
  client_msg_id: `msg${n}`,
  input: "yazi",
  text,
});

const eren = (turn_id: string, text: string, sohbet_id: SohbetId = ANA_SOHBET_ID): OlayGirdisi => ({
  type: "assistant_message",
  sohbet_id,
  turn_id,
  text,
});

/** Küresel (alansız) not: `events.sohbet_id` NULL yazılır. */
const kureselNot = (metin = "not"): OlayGirdisi => ({ type: "system_notice", seviye: "bilgi", kod: "diger", metin });

/**
 * On bir kalıcı olay türü. `sohbet_id` `null` ise hiçbirinde alan yok (atma testleri için).
 * `system_notice` her zaman alansızdır (küresel not).
 */
const TUM_OLAYLAR = (sohbet_id: SohbetId | null = ANA_SOHBET_ID): OlayGirdisi[] => {
  const plan = pcPlan("planx");
  const s = sohbet_id === null ? {} : { sohbet_id };
  const liste: OlayGirdisi[] = [
    { type: "user_echo", ...s, client_msg_id: "msg1", input: "yazi", text: "merhaba 1" },
    { type: "assistant_message", ...s, turn_id: "tur1", text: "cevap" },
    { type: "turn_aborted", ...s, turn_id: "tur1", neden: "kullanici_kesti", kismi_metin: "yarım" },
    { type: "plan_proposed", ...s, plan, plan_hash: planHash(plan) },
    { type: "plan_resolved", ...s, plan_id: "planx", plan_hash: planHash(plan), sonuc: "onaylandi", is_id: 1 },
    { type: "job_started", ...s, is_id: 1, plan_id: "planx", plan_hash: planHash(plan), baslik: "b", tur: "pc" },
    { type: "job_finished", ...s, is_id: 1, durum: "tamam", kirli: false, rapor },
    { type: "question_asked", ...s, soru_id: "soru1", is_id: 1, soru: "hangisi?", secenekler: ["a", "b"] },
    { type: "question_resolved", ...s, soru_id: "soru1", is_id: 1, sonuc: "cevaplandi", cevap: "a" },
    { type: "eren_handover", ...s, nesil: 2, ozet_kabul: true },
    kureselNot(),
  ];
  return liste;
};

const nesilKaydi = (k: number, sohbet_id: SohbetId = ANA_SOHBET_ID): NesilKaydi => ({
  nesil: k,
  sohbet_id,
  session_id: `33333333-3333-4333-8333-${String(k).padStart(12, "3")}`,
  baslangic_ms: k * 10,
  bitis_ms: null,
  ozet_kabul: null,
  pid: null,
  olusturma_ms: null,
  son_dolu: null,
  pencere: null,
});

const turKaydi = (id: string, ek: Partial<TurKaydi> = {}): TurKaydi => ({
  turn_id: id,
  sohbet_id: ANA_SOHBET_ID,
  nesil: 1,
  kaynak: "insan",
  gorunur: true,
  baslangic_ms: 100,
  bitis_ms: null,
  bitis: null,
  kismi_metin: "",
  ...ek,
});

const sohbetAc = (depo: Depo, sohbet_id: SohbetId, ad = "Yeni sohbet", ms = 10): void =>
  depo.sohbetEkle({ sohbet_id, ad, olusturma_ms: ms, son_etkinlik_ms: ms });

/** `events` sütunu ile JSON gövdesindeki alan, `seq` sırasıyla. */
const olaySohbetleri = (yol: string): Array<{ seq: number; type: string; sutun: string | null; json: string | null }> =>
  hamAc(yol, (h) =>
    (
      h
        .prepare("SELECT seq, type, sohbet_id AS sutun, json_extract(veri, '$.sohbet_id') AS json FROM events ORDER BY seq")
        .all() as Array<{ seq: number; type: string; sutun: string | null; json: string | null }>
    ).map((r) => ({ seq: r.seq, type: r.type, sutun: r.sutun, json: r.json })),
  );

// ---------------------------------------------------------------------------------------------
// Dilim 1 şeması ve dilim 1 kodunun INSERT metinleri (göç 3 ve geri alma testleri)
// ---------------------------------------------------------------------------------------------

/** Dilim 1 `depo.ts`'in `GOCLER[0]`'ı (user_version 0 → 1), aynen. */
const DILIM1_TEMEL_SEMA = `
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
`;

/** Dilim 1 `depo.ts`'in `EK_GOCLER`'i (ek sürüm 1 ve 2), aynen. */
const DILIM1_EK_GOCLER = [
  "ALTER TABLE planlar ADD COLUMN profil TEXT NOT NULL DEFAULT 'tam'",
  `
  CREATE TABLE IF NOT EXISTS eren_oturumlari (
    session_id TEXT PRIMARY KEY,
    olusturma_ms INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS events_tur ON events (type);
  `,
] as const;

/** Dilim 1 kodunun açtığı dosya: `user_version` 1, `ek_surum` verilen (0: `sema_ek` yok). */
const eskiSemaKur = (yol: string, ekSurum: 0 | 1 | 2): void =>
  hamAc(yol, (h) => {
    h.exec("PRAGMA journal_mode = WAL");
    h.exec(DILIM1_TEMEL_SEMA);
    h.exec("PRAGMA user_version = 1");
    if (ekSurum > 0) {
      h.exec("CREATE TABLE IF NOT EXISTS sema_ek (anahtar TEXT PRIMARY KEY, deger INTEGER NOT NULL) STRICT");
      for (let i = 0; i < ekSurum; i++) h.exec(DILIM1_EK_GOCLER[i] as string);
      h.prepare("INSERT INTO sema_ek (anahtar, deger) VALUES ('ek_surum', ?)").run(ekSurum);
    }
  });

/**
 * Dilim 1 kodunun 13 `INSERT`'i, metinleri `depo.ts`'ten (dilim 1, commit 9fb777e) aynen; hepsi sütun
 * adı yazar, hiçbiri `sohbet_id` yazmaz. Ek göç 2'nin `eren_oturumlari` yazımı da ayrıca.
 */
const ESKI_INSERT = {
  events: "INSERT INTO events (ts_ms, type, veri) VALUES (?, ?, ?)",
  acklar: "INSERT OR IGNORE INTO acklar (device_id, client_msg_id, ok, seq, code) VALUES (?, ?, ?, ?, ?)",
  turns: `INSERT INTO turns (turn_id, nesil, kaynak, gorunur, baslangic_ms, bitis_ms, bitis, kismi_metin)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  nesiller: `INSERT INTO nesiller (nesil, session_id, baslangic_ms, bitis_ms, ozet_kabul, pid, olusturma_ms, son_dolu, pencere)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  planlar: "INSERT INTO planlar (plan_id, plan, plan_hash, durum, is_id, olusturma_ms, profil) VALUES (?, ?, ?, ?, ?, ?, ?)",
  isler: `INSERT INTO isler (plan_id, plan_hash, baslik, tur, cwd, durum, kirli, session_id, pid, olusturma_ms,
           baslangic_ms, bitis_ms, out_ofset, rapor, rapor_kaynak, son_result, durdurma)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  is_pidleri: `INSERT OR IGNORE INTO is_pidleri (is_id, pid, olusturma_ms, ad, ilk_gorulme_ms) VALUES (?, ?, ?, ?, ?)`,
  sorular: `INSERT INTO sorular (soru_id, is_id, soru, secenekler, durum, cevap, olusturma_ms, son_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  eren_kuyrugu: "INSERT INTO eren_kuyrugu (kaynak, metin, olusturma_ms) VALUES (?, ?, ?)",
  cihazlar: `INSERT INTO cihazlar (device_id, public_key, tailscale_ip, platform, etiket, eslesme_ms)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (device_id) DO UPDATE SET public_key = excluded.public_key,
           tailscale_ip = excluded.tailscale_ip, platform = excluded.platform,
           etiket = excluded.etiket, eslesme_ms = excluded.eslesme_ms`,
  eslestirme: "INSERT OR REPLACE INTO eslestirme (id, kod_ozeti, son_ms, yanlis_deneme) VALUES (1, ?, ?, ?)",
  kopru_jetonlari:
    "INSERT OR REPLACE INTO kopru_jetonlari (ozet, rol, nesil, is_id, plan_id, plan_hash) VALUES (?, ?, ?, ?, ?, ?)",
  kirli_okumalar: "INSERT INTO kirli_okumalar (is_id, nesil, ts_ms) VALUES (?, ?, ?)",
} as const;
const ESKI_OTURUM_INSERT =
  "INSERT INTO eren_oturumlari (session_id, olusturma_ms) VALUES (?, ?) ON CONFLICT (session_id) DO NOTHING";
/** Ek göç 1'den önceki plan yazımı (`profil` sütunu yok). */
const ESKI_PLAN_INSERT_PROFILSIZ =
  "INSERT INTO planlar (plan_id, plan, plan_hash, durum, is_id, olusturma_ms) VALUES (?, ?, ?, ?, ?, ?)";

interface EskiVeri {
  is_id: number;
  plan_id: string;
  soru_id: string;
  turKapali: string;
  turAcik: string;
  nesiller: [number, number];
  jetonEren: string;
  jetonSoru: string;
  oturum: string;
  kuyrukMetni: string;
  device_id: string;
  olaySeqleri: number[];
}

/**
 * Dilim 1 kodunun yazacağı satırlar, onun INSERT metinleriyle: dört olay (alansız JSON; `ts_ms`
 * sırası bilerek karışık: en küçük 1500, en büyük 9000), iki nesil, açık ve kapalı tur, plan, iş,
 * süreç, soru, kuyruk, cihaz, eşleştirme, eren ve soru jetonu, kirli okuma, oturum kaydı.
 */
const eskiVeriYaz = (
  h: DatabaseSync,
  o: { ek: string; nesilTaban: number; profil: boolean; oturum: boolean },
): EskiVeri => {
  const plan = pcPlan(`p-eski${o.ek}`);
  const n1 = o.nesilTaban;
  const n2 = o.nesilTaban + 1;
  const olaySeqleri: number[] = [];
  const olay = (ts: number, govde: object): void => {
    olaySeqleri.push(
      Number(h.prepare(ESKI_INSERT.events).run(ts, (govde as { type: string }).type, JSON.stringify(govde)).lastInsertRowid),
    );
  };
  olay(5000, { type: "user_echo", client_msg_id: `eski${o.ek}`, input: "yazi", text: `eski soru${o.ek}` });
  olay(1500, { type: "assistant_message", turn_id: `t-kapali${o.ek}`, text: `eski yanit${o.ek}` });
  olay(9000, { type: "system_notice", seviye: "bilgi", kod: "diger", metin: "eski not" });
  const sinir = (h.prepare("SELECT COALESCE(MAX(seq), 0) AS s FROM events").get() as { s: number }).s;
  olay(7000, { type: "chat_cleared", sinir_seq: sinir });

  h.prepare(ESKI_INSERT.acklar).run(`d${o.ek}`, `m${o.ek}`, 1, 1, null);
  h.prepare(ESKI_INSERT.nesiller).run(n1, "44444444-4444-4444-8444-444444444441", 10, 20, 1, null, null, null, null);
  h.prepare(ESKI_INSERT.nesiller).run(n2, "44444444-4444-4444-8444-444444444442", 30, null, null, 77, 88, 0.5, 1000);
  h.prepare(ESKI_INSERT.turns).run(`t-kapali${o.ek}`, n2, "insan", 1, 100, 200, "tamam", "ESKI-KISMI");
  h.prepare(ESKI_INSERT.turns).run(`t-acik${o.ek}`, n2, "insan", 1, 300, null, null, "ACIK-KISMI");
  if (o.profil) {
    h.prepare(ESKI_INSERT.planlar).run(plan.plan_id, JSON.stringify(plan), planHash(plan), "bekliyor", null, 1000, "hafif");
  } else {
    h.prepare(ESKI_PLAN_INSERT_PROFILSIZ).run(plan.plan_id, JSON.stringify(plan), planHash(plan), "bekliyor", null, 1000);
  }
  const is_id = Number(
    h
      .prepare(ESKI_INSERT.isler)
      .run(
        plan.plan_id,
        "a".repeat(64),
        "baslik",
        "pc",
        "C:\\ornek\\proje",
        "calisiyor",
        0,
        "11111111-1111-4111-8111-111111111111",
        null,
        null,
        5000,
        null,
        0,
        null,
        null,
        null,
        null,
      ).lastInsertRowid,
  );
  h.prepare(ESKI_INSERT.is_pidleri).run(is_id, 100, 1, "claude.exe", 5);
  h.prepare(ESKI_INSERT.sorular).run(`s-eski${o.ek}`, is_id, "devam?", null, "bekliyor", null, 1, 2);
  h.prepare(ESKI_INSERT.eren_kuyrugu).run("insan", `eski kuyruk${o.ek}`, 10);
  h.prepare(ESKI_INSERT.cihazlar).run(`cihaz${o.ek}`, "a2V5", "100.64.0.9", "android", null, 1);
  h.prepare(ESKI_INSERT.eslestirme).run(`oz${o.ek}`, 1, 0);
  h.prepare(ESKI_INSERT.kopru_jetonlari).run(`j-eren${o.ek}`, "eren", n2, null, null, null);
  h.prepare(ESKI_INSERT.kopru_jetonlari).run(`j-soru${o.ek}`, "soru", null, is_id, null, null);
  h.prepare(ESKI_INSERT.kirli_okumalar).run(is_id, n2, 50);
  if (o.oturum) h.prepare(ESKI_OTURUM_INSERT).run(`s-oturum${o.ek}`, 10);
  return {
    is_id,
    plan_id: plan.plan_id,
    soru_id: `s-eski${o.ek}`,
    turKapali: `t-kapali${o.ek}`,
    turAcik: `t-acik${o.ek}`,
    nesiller: [n1, n2],
    jetonEren: `j-eren${o.ek}`,
    jetonSoru: `j-soru${o.ek}`,
    oturum: `s-oturum${o.ek}`,
    kuyrukMetni: `eski kuyruk${o.ek}`,
    device_id: `cihaz${o.ek}`,
    olaySeqleri,
  };
};

// ---------------------------------------------------------------------------------------------
// Açılış: WAL, STRICT, sürüm, kalıcılık
// ---------------------------------------------------------------------------------------------

describe("depo: açılış", () => {
  it("geçici dosyada journal_mode gerçekten WAL", () => {
    const yol = yeniYol();
    const { depo } = kur(yol);
    depo.olayEkle(kullaniciOlayi(1));
    const ham = new DatabaseSync(yol);
    try {
      const satir = ham.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
      assert.equal(satir.journal_mode.toLowerCase(), "wal");
      assert.ok(existsSync(yol + "-wal"), "WAL yan dosyası yazım sonrası var olmalı");
    } finally {
      ham.close();
    }
  });

  it("on üç tablonun hepsi var ve STRICT", () => {
    const yol = yeniYol();
    kur(yol);
    const ham = new DatabaseSync(yol);
    try {
      const liste = ham.prepare("PRAGMA table_list").all() as Array<{ name: string; type: string; strict: number }>;
      const beklenen = [
        "events",
        "turns",
        "nesiller",
        "planlar",
        "isler",
        "is_pidleri",
        "sorular",
        "eren_kuyrugu",
        "cihazlar",
        "acklar",
        "eslestirme",
        "kopru_jetonlari",
        "kirli_okumalar",
      ];
      for (const ad of beklenen) {
        const t = liste.find((x) => x.name === ad && x.type === "table");
        assert.ok(t, `tablo yok: ${ad}`);
        assert.equal(t.strict, 1, `STRICT değil: ${ad}`);
      }
    } finally {
      ham.close();
    }
  });

  it("user_version göçten sonra sıfırdan büyük, yeniden açınca düşmez", () => {
    const yol = yeniYol();
    const { depo } = kur(yol);
    depo.kapat();
    const oku = (): number => {
      const ham = new DatabaseSync(yol);
      try {
        return (ham.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
      } finally {
        ham.close();
      }
    };
    const ilk = oku();
    assert.ok(ilk >= 1);
    kur(yol);
    assert.ok(oku() >= ilk);
  });

  it(":memory: ile de açılır", () => {
    const { depo } = kur(":memory:");
    assert.equal(depo.basSeq(), 0);
  });

  it("kapat-aç sonrası veri durur", () => {
    const yol = yeniYol();
    const a = kur(yol);
    const e = a.depo.olayEkle(kullaniciOlayi(1, "kalıcı"));
    a.depo.ackYaz("dev1", "m1", { ok: true, seq: e.seq });
    a.depo.planEkle(planKaydi(pcPlan("p1")));
    const is_id = a.depo.isEkle(isGirdisi("p1"));
    a.depo.kapat();

    const b = kur(yol);
    assert.deepEqual(b.depo.olaylariGetir(0, 10), [e]);
    assert.deepEqual(b.depo.ackBul("dev1", "m1"), { ok: true, seq: e.seq });
    assert.equal(b.depo.planGetir("p1")?.plan.plan_id, "p1");
    assert.equal(b.depo.isGetir(is_id)?.plan_id, "p1");
    assert.equal(b.depo.basSeq(), e.seq);
    // sayaç kapat-aç sonrası geri sarmaz
    assert.equal(b.depo.olayEkle(kullaniciOlayi(2)).seq, e.seq + 1);
  });
});

// ---------------------------------------------------------------------------------------------
// events: olayEkle, seq, işlem, yayın
// ---------------------------------------------------------------------------------------------

describe("depo: olaylar", () => {
  it("seq 1'den artar, ts_ms saatten gelir, dönen olay depodakiyle aynı", () => {
    const { depo, zaman } = kur();
    const a = depo.olayEkle(kullaniciOlayi(1));
    zaman.ilerlet(250);
    const b = depo.olayEkle(kullaniciOlayi(2));
    assert.equal(a.seq, 1);
    assert.equal(b.seq, 2);
    assert.equal(b.ts_ms - a.ts_ms, 250);
    assert.equal(a.type, "user_echo");
    assert.deepEqual(depo.olaylariGetir(0, 10), [a, b]);
  });

  it("on bir olay türü de gidiş dönüşte aynen döner", () => {
    const { depo } = kur();
    const yazilan = TUM_OLAYLAR().map((g) => depo.olayEkle(g));
    assert.deepEqual(
      yazilan.map((o) => o.type),
      TUM_OLAYLAR().map((g) => g.type),
    );
    assert.deepEqual(depo.olaylariGetir(0, 100), yazilan);
    for (const [i, o] of yazilan.entries()) assert.equal(o.seq, i + 1);
  });

  it("olaylariGetir: sonSeq'ten büyükler, artan, adetle sınırlı", () => {
    const { depo } = kur();
    for (let i = 1; i <= 5; i++) depo.olayEkle(kullaniciOlayi(i));
    assert.deepEqual(
      depo.olaylariGetir(2, 10).map((o) => o.seq),
      [3, 4, 5],
    );
    assert.deepEqual(
      depo.olaylariGetir(0, 2).map((o) => o.seq),
      [1, 2],
    );
    assert.deepEqual(depo.olaylariGetir(5, 10), []);
  });

  it("basSeq: boşken 0, sonra son seq", () => {
    const { depo } = kur();
    assert.equal(depo.basSeq(), 0);
    depo.olayEkle(kullaniciOlayi(1));
    depo.olayEkle(kullaniciOlayi(2));
    assert.equal(depo.basSeq(), 2);
  });

  it("şemaya uymayan olay atar, kalıcı olmaz, yayınlanmaz, seq harcanmaz", () => {
    const { depo, veriyolu } = kur();
    const kotu = {
      type: "user_echo",
      sohbet_id: ANA_SOHBET_ID,
      client_msg_id: "m1",
      input: "bilinmeyen",
      text: "x",
    } as unknown as OlayGirdisi;
    assert.throws(() => depo.olayEkle(kotu));
    const bilinmeyenTur = { type: "yok_boyle_olay", sohbet_id: ANA_SOHBET_ID } as unknown as OlayGirdisi;
    assert.throws(() => depo.olayEkle(bilinmeyenTur));
    assert.deepEqual(depo.olaylariGetir(0, 10), []);
    assert.equal(veriyolu!.olaylar().length, 0);
    assert.equal(depo.olayEkle(kullaniciOlayi(1)).seq, 1);
  });

  it("olay_yazildi her başarılı olay için, seq sırasıyla yayınlanır", () => {
    const { depo, veriyolu } = kur();
    const a = depo.olayEkle(kullaniciOlayi(1));
    const b = depo.olayEkle(kullaniciOlayi(2));
    assert.deepEqual(veriyolu!.olaylar(), [a, b]);
    assert.ok(veriyolu!.yayinlar.every((y) => y.ad === "olay_yazildi"));
  });

  it("veriyolu verilmezse olayEkle yine çalışır", () => {
    const { depo } = kur(":memory:", undefined);
    assert.equal(depo.olayEkle(kullaniciOlayi(1)).seq, 1);
  });

  it("geri alınan işlemde yayın yok ve seq boşluğu yok", () => {
    const { depo, veriyolu } = kur();
    const ilk = depo.olayEkle(kullaniciOlayi(1));
    const hata = new Error("yapay hata");
    assert.throws(
      () =>
        depo.islem(() => {
          depo.olayEkle(kullaniciOlayi(2));
          depo.olayEkle(kullaniciOlayi(3));
          throw hata;
        }),
      (e) => e === hata,
    );
    assert.deepEqual(veriyolu!.olaylar(), [ilk], "geri alınanlar yayınlanmamış olmalı");
    assert.deepEqual(depo.olaylariGetir(0, 10), [ilk]);
    assert.equal(depo.basSeq(), 1);
    const sonraki = depo.olayEkle(kullaniciOlayi(4));
    assert.equal(sonraki.seq, 2, "seq boşluğu olmamalı");
    assert.deepEqual(
      depo.olaylariGetir(0, 10).map((o) => o.seq),
      [1, 2],
    );
  });

  it("geri alma dosya veritabanında da boşluk bırakmaz (kapat-aç dahil)", () => {
    const yol = yeniYol();
    const a = kur(yol);
    a.depo.olayEkle(kullaniciOlayi(1));
    assert.throws(() =>
      a.depo.islem(() => {
        a.depo.olayEkle(kullaniciOlayi(2));
        throw new Error("x");
      }),
    );
    a.depo.kapat();
    const b = kur(yol);
    assert.equal(b.depo.olayEkle(kullaniciOlayi(3)).seq, 2);
  });

  it("işlem değeri döndürür; yayın işlem bitince, commit sonrası gelir", () => {
    const yol = yeniYol();
    const { depo, veriyolu } = kur(yol);
    const diger = kur(yol, undefined).depo;
    const yayindaGorulen: number[][] = [];
    veriyolu!.yayinda = () => {
      // Yayın anında yazım ikinci bağlantıdan da görünüyorsa commit olmuştur.
      yayindaGorulen.push(diger.olaylariGetir(0, 10).map((o) => o.seq));
    };
    let islemIciYayin = -1;
    const deger = depo.islem(() => {
      depo.olayEkle(kullaniciOlayi(1));
      depo.olayEkle(kullaniciOlayi(2));
      islemIciYayin = veriyolu!.olaylar().length;
      return 42;
    });
    assert.equal(deger, 42);
    assert.equal(islemIciYayin, 0, "işlem bitmeden yayın olmamalı");
    assert.deepEqual(
      veriyolu!.olaylar().map((o) => o.seq),
      [1, 2],
    );
    assert.deepEqual(yayindaGorulen, [
      [1, 2],
      [1, 2],
    ]);
  });

  it("iç içe işlem: yayın yalnız en dıştaki commit'ten sonra; dış geri alınırsa hiç yok", () => {
    const { depo, veriyolu } = kur();
    let icSonrasi = -1;
    depo.islem(() => {
      depo.islem(() => {
        depo.olayEkle(kullaniciOlayi(1));
      });
      icSonrasi = veriyolu!.olaylar().length;
      depo.olayEkle(kullaniciOlayi(2));
    });
    assert.equal(icSonrasi, 0);
    assert.equal(veriyolu!.olaylar().length, 2);

    assert.throws(() =>
      depo.islem(() => {
        depo.islem(() => {
          depo.olayEkle(kullaniciOlayi(3));
        });
        throw new Error("dış hata");
      }),
    );
    assert.equal(veriyolu!.olaylar().length, 2);
    assert.equal(depo.basSeq(), 2);
    assert.equal(depo.olayEkle(kullaniciOlayi(4)).seq, 3);
  });

  it("islem içinde başka tablo yazımı da olayla birlikte geri alınır", () => {
    const { depo } = kur();
    assert.throws(() =>
      depo.islem(() => {
        depo.planEkle(planKaydi(pcPlan("geri")));
        depo.olayEkle(kullaniciOlayi(1));
        throw new Error("x");
      }),
    );
    assert.equal(depo.planGetir("geri"), null);
    assert.equal(depo.basSeq(), 0);
  });
});

// ---------------------------------------------------------------------------------------------
// Dilim 2: olayEkle alan kuralı
// ---------------------------------------------------------------------------------------------

describe("depo: olayEkle sohbet alanı (dilim 2)", () => {
  it("alansız user_echo atar: olay yok, yayın yok, seq harcanmaz", () => {
    const { depo, veriyolu } = kur();
    const alansiz: OlayGirdisi = { type: "user_echo", client_msg_id: "m1", input: "yazi", text: "x" };
    assert.throws(() => depo.olayEkle(alansiz));
    assert.deepEqual(depo.olaylariGetir(0, 10), []);
    assert.equal(veriyolu!.olaylar().length, 0);
    assert.equal(depo.basSeq(), 0);
    assert.equal(depo.olayEkle(kullaniciOlayi(1)).seq, 1, "seq harcanmamalı");
  });

  it("system_notice dışındaki her tür alansız atar", () => {
    const { depo } = kur();
    const alansizlar: OlayGirdisi[] = [
      ...TUM_OLAYLAR(null).filter((g) => g.type !== "system_notice"),
      { type: "chat_cleared", sinir_seq: 0 },
    ];
    assert.equal(alansizlar.length, 11);
    for (const g of alansizlar) assert.throws(() => depo.olayEkle(g), `atmadı: ${g.type}`);
    assert.equal(depo.basSeq(), 0);
  });

  it("işlem içinde alansız olay bütün işlemi geri alır", () => {
    const { depo, veriyolu } = kur();
    assert.throws(() =>
      depo.islem(() => {
        depo.olayEkle(kullaniciOlayi(1));
        depo.kuyrugaEkle("insan", "k", 1, ANA);
        depo.olayEkle({ type: "assistant_message", turn_id: "t1", text: "y" });
      }),
    );
    assert.equal(depo.basSeq(), 0);
    assert.equal(depo.kuyrukBasi(ANA), null);
    assert.equal(veriyolu!.olaylar().length, 0);
  });

  it("alansız system_notice NULL sütunla yazılır, gövdede alan yok; alanlı olay sütunda ve gövdede aynı değer", () => {
    const yol = yeniYol();
    const { depo } = kur(yol);
    const kuresel = depo.olayEkle(kureselNot("küresel"));
    assert.ok(!("sohbet_id" in kuresel));
    assert.equal(sohbetAnahtari(kuresel), ANA_SOHBET_ID);
    const anaMesaj = depo.olayEkle(kullaniciOlayi(1));
    const bMesaj = depo.olayEkle(kullaniciOlayi(2, "b", B_ID));
    const bNotu = depo.olayEkle({ ...kureselNot("b notu"), sohbet_id: B_ID });
    assert.equal(anaMesaj.sohbet_id, ANA_SOHBET_ID);
    assert.equal(bMesaj.sohbet_id, B_ID);
    assert.deepEqual(depo.olaylariGetir(0, 10), [kuresel, anaMesaj, bMesaj, bNotu]);
    assert.deepEqual(olaySohbetleri(yol), [
      { seq: 1, type: "system_notice", sutun: null, json: null },
      { seq: 2, type: "user_echo", sutun: ANA_SOHBET_ID, json: ANA_SOHBET_ID },
      { seq: 3, type: "user_echo", sutun: B_ID, json: B_ID },
      { seq: 4, type: "system_notice", sutun: B_ID, json: B_ID },
    ]);
  });

  it("yaşam döngüsü olayları (chat_created, chat_renamed, chat_deleted) gidiş dönüşte aynen döner", () => {
    const { depo } = kur();
    const yazilan = [
      depo.olayEkle({ type: "chat_created", sohbet_id: B_ID, ad: "İkinci" }),
      depo.olayEkle({ type: "chat_renamed", sohbet_id: B_ID, ad: "Yeni ad" }),
      depo.olayEkle({ type: "chat_deleted", sohbet_id: B_ID }),
    ];
    assert.deepEqual(depo.olaylariGetir(0, 10), yazilan);
  });
});

// ---------------------------------------------------------------------------------------------
// İkinci bağlantı
// ---------------------------------------------------------------------------------------------

describe("depo: ikinci bağlantı", () => {
  it("aynı dosyaya ikinci bağlantıdan yazım, ikisi de birbirinin yazdığını görür", () => {
    const yol = yeniYol();
    const a = kur(yol);
    const b = kur(yol, undefined);
    const e1 = a.depo.olayEkle(kullaniciOlayi(1));
    const e2 = b.depo.olayEkle(kullaniciOlayi(2));
    const e3 = a.depo.olayEkle(kullaniciOlayi(3));
    assert.deepEqual([e1.seq, e2.seq, e3.seq], [1, 2, 3]);
    assert.deepEqual(a.depo.olaylariGetir(0, 10), [e1, e2, e3]);
    assert.deepEqual(b.depo.olaylariGetir(0, 10), [e1, e2, e3]);
  });

  it("ikinci bağlantı eslestirme ve cihaz yazar, ana bağlantı okur", () => {
    const yol = yeniYol();
    const ana = kur(yol).depo;
    const eslestir = kur(yol, undefined).depo;
    eslestir.eslestirmeYaz({ kod_ozeti: "ozet1", son_ms: 9000, yanlis_deneme: 0 });
    assert.deepEqual(ana.eslestirmeOku(), { kod_ozeti: "ozet1", son_ms: 9000, yanlis_deneme: 0 });
    eslestir.eslestirmeSil();
    assert.equal(ana.eslestirmeOku(), null);
  });

  it("iki bağlantı sırayla işlem yapınca seq tekrar etmez", () => {
    const yol = yeniYol();
    const a = kur(yol).depo;
    const b = kur(yol, undefined).depo;
    const seqler: number[] = [];
    for (let i = 0; i < 5; i++) {
      seqler.push(a.islem(() => a.olayEkle(kullaniciOlayi(i * 2))).seq);
      seqler.push(b.islem(() => b.olayEkle(kullaniciOlayi(i * 2 + 1))).seq);
    }
    assert.deepEqual(seqler, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

// ---------------------------------------------------------------------------------------------
// sonKonusma
// ---------------------------------------------------------------------------------------------

describe("depo: sonKonusma", () => {
  it("yalnız user_echo ve assistant_message; eskiden yeniye; rol eşlemesi", () => {
    const { depo, zaman } = kur();
    const u = depo.olayEkle(kullaniciOlayi(1, "soru"));
    zaman.ilerlet(10);
    const a = depo.olayEkle(eren("t1", "yanıt"));
    assert.deepEqual(depo.sonKonusma(10, ANA), [
      { rol: "kullanici", metin: "soru", ts_ms: u.ts_ms },
      { rol: "eren", metin: "yanıt", ts_ms: a.ts_ms },
    ]);
  });

  it("question_resolved.cevap ve job_finished.rapor çıkmaz, başka olaylar da çıkmaz", () => {
    const { depo } = kur();
    const gizliCevap = "GIZLI-CEVAP-METNI";
    const gizliRapor = "GIZLI-RAPOR-METNI";
    const s = { sohbet_id: ANA_SOHBET_ID };
    depo.olayEkle(kullaniciOlayi(1, "merhaba"));
    depo.olayEkle({ type: "question_asked", ...s, soru_id: "s1", is_id: 1, soru: "SORU-METNI", secenekler: ["x"] });
    depo.olayEkle({ type: "question_resolved", ...s, soru_id: "s1", is_id: 1, sonuc: "cevaplandi", cevap: gizliCevap });
    depo.olayEkle({
      type: "job_finished",
      ...s,
      is_id: 1,
      durum: "tamam",
      kirli: true,
      rapor: { ...rapor, yapildi: [gizliRapor] },
    });
    depo.olayEkle({ type: "system_notice", ...s, seviye: "bilgi", kod: "diger", metin: "SISTEM-NOTU" });
    depo.olayEkle({ type: "turn_aborted", ...s, turn_id: "t1", neden: "hata", kismi_metin: "KISMI" });
    depo.olayEkle(eren("t2", "tamam"));

    const sonuc = depo.sonKonusma(100, ANA);
    assert.deepEqual(
      sonuc.map((x) => x.metin),
      ["merhaba", "tamam"],
    );
    const dokum = JSON.stringify(sonuc);
    for (const yasak of [gizliCevap, gizliRapor, "SORU-METNI", "SISTEM-NOTU", "KISMI"]) {
      assert.ok(!dokum.includes(yasak), `sızdı: ${yasak}`);
    }
  });

  it("adet son N satırı verir (yine eskiden yeniye); adet taşsa hepsi", () => {
    const { depo } = kur();
    for (let i = 1; i <= 4; i++) depo.olayEkle(kullaniciOlayi(i, `m${i}`));
    assert.deepEqual(
      depo.sonKonusma(2, ANA).map((s) => s.metin),
      ["m3", "m4"],
    );
    assert.equal(depo.sonKonusma(50, ANA).length, 4);
  });

  it("boş depoda boş dizi", () => {
    assert.deepEqual(kur().depo.sonKonusma(5, ANA), []);
  });

  it("dilim 2: yalnız o sohbetin konuşması; adet o sohbetin son N satırı", () => {
    const { depo } = kur();
    depo.olayEkle(kullaniciOlayi(1, "a1", A_ID));
    depo.olayEkle(kullaniciOlayi(2, "b1", B_ID));
    depo.olayEkle(eren("ta", "a2", A_ID));
    depo.olayEkle(eren("tb", "b2", B_ID));
    depo.olayEkle(kullaniciOlayi(3, "a3", A_ID));
    depo.olayEkle(kullaniciOlayi(4, "ana1"));
    assert.deepEqual(
      depo.sonKonusma(10, A).map((s) => s.metin),
      ["a1", "a2", "a3"],
    );
    assert.deepEqual(
      depo.sonKonusma(2, A).map((s) => s.metin),
      ["a2", "a3"],
    );
    assert.deepEqual(
      depo.sonKonusma(10, B).map((s) => s.metin),
      ["b1", "b2"],
    );
    assert.deepEqual(
      depo.sonKonusma(10, ANA).map((s) => s.metin),
      ["ana1"],
    );
    assert.deepEqual(depo.sonKonusma(10, { sohbet_id: "yok" }), []);
  });
});

// ---------------------------------------------------------------------------------------------
// acklar
// ---------------------------------------------------------------------------------------------

describe("depo: ack", () => {
  it("yoksa null; yazılan aynen döner; cihaz ve mesaj kimliğiyle ayrışır", () => {
    const { depo } = kur();
    assert.equal(depo.ackBul("d1", "m1"), null);
    depo.ackYaz("d1", "m1", { ok: true, seq: 7 });
    depo.ackYaz("d1", "m2", { ok: false, code: "limit_kilitli" });
    depo.ackYaz("d2", "m1", { ok: true });
    assert.deepEqual(depo.ackBul("d1", "m1"), { ok: true, seq: 7 });
    assert.deepEqual(depo.ackBul("d1", "m2"), { ok: false, code: "limit_kilitli" });
    assert.deepEqual(depo.ackBul("d2", "m1"), { ok: true });
    assert.equal(depo.ackBul("d2", "m2"), null);
  });
});

// ---------------------------------------------------------------------------------------------
// turns
// ---------------------------------------------------------------------------------------------

describe("depo: turlar ve nesiller", () => {
  const nesil = (n: number, sohbet_id: SohbetId = ANA_SOHBET_ID): NesilKaydi => ({
    nesil: n,
    sohbet_id,
    session_id: `22222222-2222-4222-8222-22222222222${n}`,
    baslangic_ms: 100 * n,
    bitis_ms: null,
    ozet_kabul: null,
    pid: null,
    olusturma_ms: null,
    son_dolu: null,
    pencere: null,
  });

  const tur = (id: string, ek: Partial<TurKaydi> = {}): TurKaydi => ({
    turn_id: id,
    sohbet_id: ANA_SOHBET_ID,
    nesil: 1,
    kaynak: "insan",
    gorunur: true,
    baslangic_ms: 1000,
    bitis_ms: null,
    bitis: null,
    kismi_metin: "",
    ...ek,
  });

  it("nesilEkle/sonNesil/nesilGuncelle", () => {
    const { depo } = kur();
    assert.equal(depo.sonNesil(ANA), null);
    depo.nesilEkle(nesil(1));
    assert.deepEqual(depo.sonNesil(ANA), nesil(1));
    depo.nesilEkle(nesil(2));
    assert.equal(depo.sonNesil(ANA)?.nesil, 2);
    depo.nesilGuncelle(2, { pid: 321, olusturma_ms: 555, son_dolu: 1234, pencere: 1_000_000, ozet_kabul: false, bitis_ms: 900 });
    assert.deepEqual(depo.sonNesil(ANA), {
      ...nesil(2),
      pid: 321,
      olusturma_ms: 555,
      son_dolu: 1234,
      pencere: 1_000_000,
      ozet_kabul: false,
      bitis_ms: 900,
    });
    // verilmeyen alan değişmez, başka nesil etkilenmez
    depo.nesilGuncelle(2, { son_dolu: 99 });
    assert.equal(depo.sonNesil(ANA)?.pid, 321);
    assert.equal(depo.sonNesil(ANA)?.son_dolu, 99);
    depo.nesilGuncelle(2, { pid: null });
    assert.equal(depo.sonNesil(ANA)?.pid, null);
  });

  it("turEkle/turGetir gidiş dönüş, olmayan null", () => {
    const { depo } = kur();
    depo.nesilEkle(nesil(1));
    assert.equal(depo.turGetir("yok"), null);
    const t = tur("t1", { kaynak: "devir", gorunur: false });
    depo.turEkle(t);
    assert.deepEqual(depo.turGetir("t1"), t);
  });

  it("turKismiYaz, turBitir, acikTurlar", () => {
    const { depo } = kur();
    depo.nesilEkle(nesil(1));
    depo.turEkle(tur("t1"));
    depo.turEkle(tur("t2", { kaynak: "sentetik", baslangic_ms: 2000 }));
    assert.deepEqual(
      depo
        .acikTurlar(ANA)
        .map((t) => t.turn_id)
        .sort(),
      ["t1", "t2"],
    );

    depo.turKismiYaz("t1", "yarım metin");
    assert.equal(depo.turGetir("t1")?.kismi_metin, "yarım metin");
    assert.equal(depo.turGetir("t1")?.bitis, null);

    depo.turBitir("t1", "kesildi", "son yarım", 3000);
    assert.deepEqual(depo.turGetir("t1"), tur("t1", { bitis: "kesildi", bitis_ms: 3000, kismi_metin: "son yarım" }));
    assert.deepEqual(
      depo.acikTurlar(ANA).map((t) => t.turn_id),
      ["t2"],
    );
    depo.turBitir("t2", "tamam", "", 3500);
    assert.deepEqual(depo.acikTurlar(ANA), []);
  });

  it("dilim 2: tur sohbet_id'si gidiş dönüşte korunur; acikTurlar yalnız o sohbetin", () => {
    const { depo } = kur();
    depo.nesilEkle(nesil(1, A_ID));
    depo.nesilEkle(nesil(2, B_ID));
    const ta = tur("ta", { sohbet_id: A_ID, nesil: 1 });
    const tb = tur("tb", { sohbet_id: B_ID, nesil: 2, baslangic_ms: 1500 });
    depo.turEkle(ta);
    depo.turEkle(tb);
    depo.turEkle(tur("tb2", { sohbet_id: B_ID, nesil: 2, baslangic_ms: 1700 }));
    assert.deepEqual(depo.turGetir("ta"), ta);
    assert.deepEqual(depo.turGetir("tb"), tb);
    assert.deepEqual(
      depo.acikTurlar(A).map((t) => t.turn_id),
      ["ta"],
    );
    assert.deepEqual(
      depo.acikTurlar(B).map((t) => t.turn_id),
      ["tb", "tb2"],
    );
    assert.deepEqual(depo.acikTurlar(ANA), []);
    depo.turBitir("tb", "tamam", "", 2000);
    assert.deepEqual(
      depo.acikTurlar(B).map((t) => t.turn_id),
      ["tb2"],
    );
    assert.deepEqual(
      depo.acikTurlar(A).map((t) => t.turn_id),
      ["ta"],
    );
    assert.equal(depo.turGetir("tb")?.sohbet_id, B_ID);
  });
});

// ---------------------------------------------------------------------------------------------
// Dilim 2: nesiller sohbet kapsamlı, numara küresel tekil
// ---------------------------------------------------------------------------------------------

describe("depo: nesil numarası ve enBuyukNesil (dilim 2)", () => {
  it("boşken 0; bütün sohbetlerin en büyüğü", () => {
    const { depo } = kur();
    assert.equal(depo.enBuyukNesil(), 0);
    depo.nesilEkle(nesilKaydi(1, A_ID));
    depo.nesilEkle(nesilKaydi(2, B_ID));
    depo.nesilEkle(nesilKaydi(3, A_ID));
    assert.equal(depo.enBuyukNesil(), 3);
    depo.nesilEkle(nesilKaydi(5, B_ID));
    depo.nesilEkle(nesilKaydi(4));
    assert.equal(depo.enBuyukNesil(), 5);
  });

  it("sonNesil ve nesiller sohbet kapsamlı: araya başka sohbetin nesli girse de", () => {
    const { depo } = kur();
    depo.nesilEkle(nesilKaydi(1, A_ID));
    depo.nesilEkle(nesilKaydi(2, B_ID));
    depo.nesilEkle(nesilKaydi(3, A_ID));
    depo.nesilEkle(nesilKaydi(5, B_ID));
    depo.nesilEkle(nesilKaydi(4));
    assert.deepEqual(depo.sonNesil(A), nesilKaydi(3, A_ID));
    assert.deepEqual(depo.sonNesil(B), nesilKaydi(5, B_ID));
    assert.deepEqual(depo.sonNesil(ANA), nesilKaydi(4));
    assert.equal(depo.sonNesil({ sohbet_id: "yok" }), null);
    assert.deepEqual(depo.nesiller(A), [nesilKaydi(1, A_ID), nesilKaydi(3, A_ID)]);
    assert.deepEqual(
      depo.nesiller(B).map((n) => n.nesil),
      [2, 5],
    );
    assert.deepEqual(
      depo.nesiller(ANA).map((n) => n.nesil),
      [4],
    );
  });

  it("nesil numarası tüm sohbetlerde tekil: başka sohbette aynı numara atar", () => {
    const { depo } = kur();
    depo.nesilEkle(nesilKaydi(3, A_ID));
    assert.throws(() => depo.nesilEkle(nesilKaydi(3, B_ID)));
    assert.deepEqual(depo.nesiller(B), []);
    assert.equal(depo.sonNesil(A)?.sohbet_id, A_ID);
  });

  it("nesilGuncelle yalnız o nesle dokunur, sohbet_id değişmez", () => {
    const { depo } = kur();
    depo.nesilEkle(nesilKaydi(1, A_ID));
    depo.nesilEkle(nesilKaydi(2, B_ID));
    depo.nesilGuncelle(1, { bitis_ms: 77, ozet_kabul: true });
    assert.deepEqual(depo.sonNesil(A), { ...nesilKaydi(1, A_ID), bitis_ms: 77, ozet_kabul: true });
    assert.deepEqual(depo.sonNesil(B), nesilKaydi(2, B_ID));
  });
});

// ---------------------------------------------------------------------------------------------
// planlar
// ---------------------------------------------------------------------------------------------

describe("depo: planlar", () => {
  it("plan gidiş dönüşünde hash korunur (pc ve telefon, Unicode dahil)", () => {
    const { depo } = kur();
    for (const plan of [pcPlan("pc1"), telefonPlan("tel1")]) {
      depo.planEkle(planKaydi(plan));
      const geri = depo.planGetir(plan.plan_id);
      assert.ok(geri);
      assert.deepEqual(geri.plan, plan);
      assert.equal(planHash(geri.plan), geri.plan_hash);
      assert.equal(geri.plan_hash, planHash(plan));
      assert.match(geri.plan_hash, /^[0-9a-f]{64}$/);
    }
  });

  it("dosya veritabanında kapat-aç sonrası da hash tutar", () => {
    const yol = yeniYol();
    const a = kur(yol);
    const plan = pcPlan("pk");
    a.depo.planEkle(planKaydi(plan));
    a.depo.kapat();
    const geri = kur(yol).depo.planGetir("pk");
    assert.ok(geri);
    assert.equal(planHash(geri.plan), geri.plan_hash);
  });

  it("olmayan plan null; alanlar gidiş dönüşte aynı", () => {
    const { depo } = kur();
    assert.equal(depo.planGetir("yok"), null);
    const k = planKaydi(pcPlan("p1"));
    depo.planEkle(k);
    assert.deepEqual(depo.planGetir("p1"), k);
  });

  it("planGuncelle durum ve is_id; bekleyenPlanlar yalnız bekleyenleri verir", () => {
    const { depo } = kur();
    for (const id of ["a1", "b2", "c3", "d4"]) depo.planEkle(planKaydi(pcPlan(id)));
    depo.planGuncelle("b2", "izin_bekliyor", null);
    depo.planGuncelle("c3", "onaylandi", null);
    depo.planGuncelle("d4", "reddedildi", null);
    assert.equal(depo.planGetir("b2")?.durum, "izin_bekliyor");
    const is_id = depo.isEkle(isGirdisi("c3"));
    depo.planGuncelle("c3", "onaylandi", is_id);
    assert.equal(depo.planGetir("c3")?.is_id, is_id);
    assert.equal(depo.planGetir("c3")?.durum, "onaylandi");
    assert.deepEqual(
      depo
        .bekleyenPlanlar()
        .map((p) => p.plan.plan_id)
        .sort(),
      ["a1", "b2"],
    );
    depo.planGuncelle("a1", "iptal", null);
    assert.deepEqual(
      depo.bekleyenPlanlar().map((p) => p.plan.plan_id),
      ["b2"],
    );
  });

  it("dilim 2: sohbet_id sütunda, plan JSON'una ve hash'e girmez; bekleyenPlanlar(sohbet) süzer, verilmezse hepsi", () => {
    const yol = yeniYol();
    const { depo } = kur(yol);
    const pa = pcPlan("pa");
    depo.planEkle(planKaydi(pa, "tam", A_ID));
    depo.planEkle(planKaydi(pcPlan("pb"), "hafif", B_ID));
    depo.planEkle(planKaydi(pcPlan("pb2"), "tam", B_ID));
    depo.planEkle(planKaydi(pcPlan("pana")));
    assert.deepEqual(depo.planGetir("pa"), planKaydi(pa, "tam", A_ID));
    assert.equal(depo.planGetir("pb")?.sohbet_id, B_ID);
    assert.equal(depo.planGetir("pa")?.plan_hash, planHash(pa));
    assert.ok(!("sohbet_id" in (depo.planGetir("pa")?.plan as object)));
    depo.planGuncelle("pb2", "reddedildi", null);
    assert.equal(depo.planGetir("pb2")?.sohbet_id, B_ID, "planGuncelle sohbeti bozmaz");
    assert.deepEqual(
      depo.bekleyenPlanlar(A).map((p) => p.plan.plan_id),
      ["pa"],
    );
    assert.deepEqual(
      depo.bekleyenPlanlar(B).map((p) => p.plan.plan_id),
      ["pb"],
    );
    assert.deepEqual(
      depo.bekleyenPlanlar(ANA).map((p) => p.plan.plan_id),
      ["pana"],
    );
    assert.deepEqual(
      depo
        .bekleyenPlanlar()
        .map((p) => p.plan.plan_id)
        .sort(),
      ["pa", "pana", "pb"],
    );
    hamAc(yol, (h) => {
      for (const r of h.prepare("SELECT plan, sohbet_id FROM planlar").all() as Array<{ plan: string; sohbet_id: string }>) {
        assert.ok(!r.plan.includes('"sohbet_id"'), "plan JSON'unda sohbet_id var");
      }
      const sutun = h.prepare("SELECT sohbet_id FROM planlar WHERE plan_id = 'pb'").get() as { sohbet_id: string };
      assert.equal(sutun.sohbet_id, B_ID);
    });
  });

  it("0.5.0: kesin_yapilacaklar/kesin_yapilmayacaklar taşıyan eski plan ve plan_proposed okunurken atılır; satır yerinde kalır", () => {
    const yol = yeniYol();
    const { depo } = kur(yol);
    const yeniPc = pcPlan("eski-pc");
    const yeniTel = telefonPlan("eski-tel");
    // Yeni biçimle yazılır, ham SQL ile eski biçime çevrilir (göç yok, yalnız okuma yolu).
    depo.planEkle(planKaydi(yeniPc, "hafif", A_ID));
    depo.planEkle(planKaydi(yeniTel));
    const olay = depo.olayEkle({ type: "plan_proposed", sohbet_id: ANA_SOHBET_ID, plan: yeniPc, plan_hash: planHash(yeniPc) });
    const eskiPc = { ...yeniPc, kesin_yapilacaklar: ["birinci"], kesin_yapilmayacaklar: [] };
    const eskiTel = { ...yeniTel, kesin_yapilacaklar: ["bak"], kesin_yapilmayacaklar: ["dokunma"] };
    const ESKI_HASH = "e".repeat(64);
    hamAc(yol, (h) => {
      const g = h.prepare("UPDATE planlar SET plan = ?, plan_hash = ? WHERE plan_id = ?");
      g.run(JSON.stringify(eskiPc), ESKI_HASH, "eski-pc");
      g.run(JSON.stringify(eskiTel), ESKI_HASH, "eski-tel");
      const { seq: _s, ts_ms: _t, ...govde } = olay;
      h.prepare("UPDATE events SET veri = ? WHERE seq = ?").run(
        JSON.stringify({ ...govde, plan: eskiPc, plan_hash: ESKI_HASH }),
        olay.seq,
      );
    });

    const pc = depo.planGetir("eski-pc");
    assert.ok(pc, "eski plan okunur");
    assert.deepEqual(pc.plan, yeniPc);
    assert.ok(!("kesin_yapilacaklar" in pc.plan) && !("kesin_yapilmayacaklar" in pc.plan));
    assert.equal(pc.plan_hash, ESKI_HASH, "saklanan hash değişmez");
    assert.notEqual(planHash(pc.plan), pc.plan_hash, "eski plan hash denetiminden geçmez");
    assert.equal(pc.profil, "hafif");
    assert.equal(pc.sohbet_id, A_ID);
    assert.deepEqual(depo.planGetir("eski-tel")?.plan, yeniTel);
    assert.deepEqual(
      depo
        .bekleyenPlanlar()
        .map((p) => p.plan.plan_id)
        .sort(),
      ["eski-pc", "eski-tel"],
    );
    depo.planGuncelle("eski-pc", "iptal", null);
    assert.equal(depo.planGetir("eski-pc")?.durum, "iptal");

    const [geri] = depo.olaylariGetir(olay.seq - 1, 1);
    assert.ok(geri?.type === "plan_proposed");
    assert.deepEqual(geri.plan, yeniPc, "geçmişteki kart yeni şemaya uyar");
    assert.equal(geri.plan_hash, ESKI_HASH);
    assert.equal(geri.seq, olay.seq);

    hamAc(yol, (h) => {
      const r = h.prepare("SELECT plan FROM planlar WHERE plan_id = 'eski-pc'").get() as { plan: string };
      assert.ok(r.plan.includes('"kesin_yapilacaklar"'), "satır yerinde değiştirilmez (göç yok)");
    });
  });

  it("eski anahtar dışındaki bilinmeyen alan yine reddedilir (katı şema gevşemez)", () => {
    const yol = yeniYol();
    const { depo } = kur(yol);
    depo.planEkle(planKaydi(pcPlan("bozuk")));
    hamAc(yol, (h) => {
      h.prepare("UPDATE planlar SET plan = ? WHERE plan_id = 'bozuk'").run(
        JSON.stringify({ ...pcPlan("bozuk"), kesin_yapilacaklar: ["a"], yabanci: 1 }),
      );
    });
    assert.throws(() => depo.planGetir("bozuk"));
  });
});

// ---------------------------------------------------------------------------------------------
// isler, is_pidleri
// ---------------------------------------------------------------------------------------------

describe("depo: işler", () => {
  it("isEkle artan tam sayı verir; isGetir gidiş dönüş; olmayan null", () => {
    const { depo } = kur();
    assert.equal(depo.isGetir(1), null);
    const a = isOlustur(depo, "p1");
    const b = isOlustur(depo, "p2", { tur: "telefon", cwd: "" });
    assert.ok(Number.isInteger(a) && a >= 1);
    assert.ok(b > a);
    assert.deepEqual(depo.isGetir(a), { is_id: a, ...isGirdisi("p1") });
    assert.equal(depo.isGetir(b)?.tur, "telefon");
  });

  it("isGuncelle kısmi alanlar, rapor ve son_result nesneleri aynen döner", () => {
    const { depo } = kur();
    const id = isOlustur(depo, "p1");
    const sonResult = { is_error: false, metin_limit_onekli: false, structured_bos: false, structured_output: { x: [1, "a"] } };
    depo.isGuncelle(id, {
      durum: "tamam",
      kirli: true,
      pid: 77,
      olusturma_ms: 88,
      bitis_ms: 9000,
      out_ofset: 1234,
      rapor,
      rapor_kaynak: "result",
      son_result: sonResult,
      durdurma: "kullanici",
    });
    assert.deepEqual(depo.isGetir(id), {
      is_id: id,
      ...isGirdisi("p1", {
        durum: "tamam",
        kirli: true,
        pid: 77,
        olusturma_ms: 88,
        bitis_ms: 9000,
        out_ofset: 1234,
        rapor,
        rapor_kaynak: "result",
        son_result: sonResult,
        durdurma: "kullanici",
      }),
    });
    depo.isGuncelle(id, { out_ofset: 2000 });
    assert.equal(depo.isGetir(id)?.out_ofset, 2000);
    assert.equal(depo.isGetir(id)?.durum, "tamam");
    depo.isGuncelle(id, { rapor: null });
    assert.equal(depo.isGetir(id)?.rapor, null);
  });

  it("isPlanaGore plan kimliğiyle işi bulur", () => {
    const { depo } = kur();
    const id = isOlustur(depo, "p1");
    assert.equal(depo.isPlanaGore("p1")?.is_id, id);
    assert.equal(depo.isPlanaGore("yok"), null);
  });

  it("isListele: yalnızAktif süzer, adet sınırlar", () => {
    const { depo } = kur();
    const calisan = isOlustur(depo, "p1", { durum: "calisiyor" });
    const soruda = isOlustur(depo, "p2", { durum: "soru_bekliyor" });
    const biten = isOlustur(depo, "p3", { durum: "tamam", bitis_ms: 6000 });
    const hepsi = depo.isListele(false, 10).map((i) => i.is_id);
    assert.deepEqual([...hepsi].sort(), [calisan, soruda, biten].sort());
    const aktif = depo.isListele(true, 10).map((i) => i.is_id);
    assert.deepEqual([...aktif].sort(), [calisan, soruda].sort());
    assert.equal(depo.isListele(false, 2).length, 2);
    assert.equal(depo.isListele(false, 1).length, 1);
  });

  it("isPidEkle/isPidleri", () => {
    const { depo } = kur();
    const id = isOlustur(depo, "p1");
    const id2 = isOlustur(depo, "p2");
    assert.deepEqual(depo.isPidleri(id), []);
    depo.isPidEkle({ is_id: id, pid: 100, olusturmaMs: 1, ad: "claude.exe", ilk_gorulme_ms: 5 });
    depo.isPidEkle({ is_id: id, pid: 101, olusturmaMs: 2, ad: "node.exe", ilk_gorulme_ms: 6 });
    depo.isPidEkle({ is_id: id2, pid: 200, olusturmaMs: 3, ad: "claude.exe", ilk_gorulme_ms: 7 });
    assert.deepEqual(
      depo.isPidleri(id).sort((a, b) => a.pid - b.pid),
      [
        { is_id: id, pid: 100, olusturmaMs: 1, ad: "claude.exe", ilk_gorulme_ms: 5 },
        { is_id: id, pid: 101, olusturmaMs: 2, ad: "node.exe", ilk_gorulme_ms: 6 },
      ],
    );
    assert.equal(depo.isPidleri(id2).length, 1);
  });

  it("dilim 2: işin sohbet_id'si gidiş dönüşte korunur, isGuncelle bozmaz; isListele(sohbet) süzer, verilmezse hepsi", () => {
    const { depo } = kur();
    const ia = isOlustur(depo, "pa", { sohbet_id: A_ID });
    const ib = isOlustur(depo, "pb", { sohbet_id: B_ID });
    const ib2 = isOlustur(depo, "pb2", { sohbet_id: B_ID, durum: "tamam", bitis_ms: 6000 });
    const iana = isOlustur(depo, "pana");
    assert.deepEqual(depo.isGetir(ia), { is_id: ia, ...isGirdisi("pa", { sohbet_id: A_ID }) });
    assert.equal(depo.isPlanaGore("pb")?.sohbet_id, B_ID);
    depo.isGuncelle(ib, { durum: "soru_bekliyor", kirli: true });
    assert.equal(depo.isGetir(ib)?.sohbet_id, B_ID);
    assert.deepEqual(
      depo.isListele(false, 10, A).map((i) => i.is_id),
      [ia],
    );
    assert.deepEqual(
      [...depo.isListele(false, 10, B).map((i) => i.is_id)].sort(),
      [ib, ib2].sort(),
    );
    assert.deepEqual(
      depo.isListele(true, 10, B).map((i) => i.is_id),
      [ib],
    );
    assert.equal(depo.isListele(false, 1, B).length, 1);
    assert.deepEqual(
      depo.isListele(false, 10, ANA).map((i) => i.is_id),
      [iana],
    );
    assert.deepEqual(
      [...depo.isListele(false, 10).map((i) => i.is_id)].sort(),
      [ia, ib, ib2, iana].sort(),
    );
  });
});

// ---------------------------------------------------------------------------------------------
// sorular
// ---------------------------------------------------------------------------------------------

describe("depo: sorular", () => {
  const soru = (soru_id: string, is_id: number, ek: Partial<SoruKaydi> = {}): SoruKaydi => ({
    soru_id,
    is_id,
    soru: "devam edelim mi?",
    secenekler: ["evet", "hayır"],
    durum: "bekliyor",
    cevap: null,
    olusturma_ms: 100,
    son_ms: 200,
    ...ek,
  });

  it("soruEkle/soruGetir gidiş dönüş (seçenekli ve seçeneksiz)", () => {
    const { depo } = kur();
    const id = isOlustur(depo, "p1");
    assert.equal(depo.soruGetir("yok"), null);
    depo.soruEkle(soru("s1", id));
    depo.soruEkle(soru("s2", id, { secenekler: null }));
    assert.deepEqual(depo.soruGetir("s1"), soru("s1", id));
    assert.deepEqual(depo.soruGetir("s2"), soru("s2", id, { secenekler: null }));
  });

  it("soruGuncelle durum ve cevabı yazar; bekleyenSorular süzer", () => {
    const { depo } = kur();
    const a = isOlustur(depo, "p1");
    const b = isOlustur(depo, "p2");
    depo.soruEkle(soru("s1", a));
    depo.soruEkle(soru("s2", a));
    depo.soruEkle(soru("s3", b));
    assert.deepEqual(
      depo
        .bekleyenSorular()
        .map((s) => s.soru_id)
        .sort(),
      ["s1", "s2", "s3"],
    );
    assert.deepEqual(
      depo
        .bekleyenSorular(a)
        .map((s) => s.soru_id)
        .sort(),
      ["s1", "s2"],
    );
    depo.soruGuncelle("s1", "cevaplandi", "evet");
    depo.soruGuncelle("s2", "zaman_asimi", null);
    assert.equal(depo.soruGetir("s1")?.durum, "cevaplandi");
    assert.equal(depo.soruGetir("s1")?.cevap, "evet");
    assert.equal(depo.soruGetir("s2")?.durum, "zaman_asimi");
    assert.equal(depo.soruGetir("s2")?.cevap, null);
    assert.deepEqual(
      depo.bekleyenSorular().map((s) => s.soru_id),
      ["s3"],
    );
    assert.deepEqual(depo.bekleyenSorular(a), []);
  });

  it("dilim 2: bekleyenSorular({sohbet_id}) işin sohbetiyle birleşir; sayı ve süzgeçsiz biçim aynen", () => {
    const { depo } = kur();
    const ia = isOlustur(depo, "pa", { sohbet_id: A_ID });
    const ia2 = isOlustur(depo, "pa2", { sohbet_id: A_ID });
    const ib = isOlustur(depo, "pb", { sohbet_id: B_ID });
    depo.soruEkle(soru("sa1", ia));
    depo.soruEkle(soru("sa2", ia2, { olusturma_ms: 150 }));
    depo.soruEkle(soru("sa3", ia, { durum: "cevaplandi", cevap: "evet" }));
    depo.soruEkle(soru("sb1", ib));
    assert.deepEqual(
      depo
        .bekleyenSorular(A)
        .map((s) => s.soru_id)
        .sort(),
      ["sa1", "sa2"],
    );
    assert.deepEqual(depo.bekleyenSorular(A)[0], soru("sa1", ia), "satır tam ve sorunun kendisi döner");
    assert.deepEqual(
      depo.bekleyenSorular(B).map((s) => s.soru_id),
      ["sb1"],
    );
    assert.deepEqual(depo.bekleyenSorular(ANA), []);
    assert.deepEqual(
      depo.bekleyenSorular(ia2).map((s) => s.soru_id),
      ["sa2"],
    );
    assert.deepEqual(
      depo
        .bekleyenSorular()
        .map((s) => s.soru_id)
        .sort(),
      ["sa1", "sa2", "sb1"],
    );
  });
});

// ---------------------------------------------------------------------------------------------
// eren_kuyrugu
// ---------------------------------------------------------------------------------------------

describe("depo: ana oturum kuyruğu", () => {
  it("kuyrugaEkle artan kimlik; kuyrukBasi en eski; boşken null", () => {
    const { depo } = kur();
    assert.equal(depo.kuyrukBasi(ANA), null);
    const a = depo.kuyrugaEkle("insan", "bir", 10, ANA);
    const b = depo.kuyrugaEkle("sentetik", "iki", 20, ANA);
    assert.ok(b > a);
    assert.deepEqual(depo.kuyrukBasi(ANA), {
      id: a,
      sohbet_id: ANA_SOHBET_ID,
      kaynak: "insan",
      metin: "bir",
      olusturma_ms: 10,
    });
  });

  it("kuyrukSentetikBasi baştan ardışık sentetikleri verir, insanda durur, adetle sınırlı", () => {
    const { depo } = kur();
    const s1 = depo.kuyrugaEkle("sentetik", "s1", 1, ANA);
    const s2 = depo.kuyrugaEkle("sentetik", "s2", 2, ANA);
    const i1 = depo.kuyrugaEkle("insan", "i1", 3, ANA);
    const s3 = depo.kuyrugaEkle("sentetik", "s3", 4, ANA);
    assert.deepEqual(
      depo.kuyrukSentetikBasi(10, ANA).map((s) => s.id),
      [s1, s2],
    );
    assert.deepEqual(
      depo.kuyrukSentetikBasi(1, ANA).map((s) => s.id),
      [s1],
    );
    depo.kuyruktanSil([s1, s2]);
    assert.deepEqual(depo.kuyrukSentetikBasi(10, ANA), [], "baştaki insan ise sentetik yok");
    assert.equal(depo.kuyrukBasi(ANA)?.id, i1);
    depo.kuyruktanSil([i1]);
    assert.equal(depo.kuyrukBasi(ANA)?.id, s3);
    depo.kuyruktanSil([]);
    depo.kuyruktanSil([s3, 9999]);
    assert.equal(depo.kuyrukBasi(ANA), null);
  });

  it("dilim 2: kuyruk sohbet başına; araya giren başka sohbetin satırı baş ve sentetik dizisini bozmaz", () => {
    const { depo } = kur();
    const a1 = depo.kuyrugaEkle("sentetik", "a1", 1, A);
    const b1 = depo.kuyrugaEkle("insan", "b1", 2, B);
    const a2 = depo.kuyrugaEkle("sentetik", "a2", 3, A);
    const b2 = depo.kuyrugaEkle("sentetik", "b2", 4, B);
    const a3 = depo.kuyrugaEkle("insan", "a3", 5, A);
    assert.deepEqual(depo.kuyrukBasi(A), { id: a1, sohbet_id: A_ID, kaynak: "sentetik", metin: "a1", olusturma_ms: 1 });
    assert.deepEqual(depo.kuyrukBasi(B), { id: b1, sohbet_id: B_ID, kaynak: "insan", metin: "b1", olusturma_ms: 2 });
    assert.equal(depo.kuyrukBasi(ANA), null);
    assert.deepEqual(
      depo.kuyrukSentetikBasi(10, A).map((s) => s.id),
      [a1, a2],
      "B'nin insan satırı A'nın sentetik dizisini kesmez",
    );
    assert.deepEqual(depo.kuyrukSentetikBasi(10, B), [], "B'nin başı insan");
    depo.kuyruktanSil([b1]);
    assert.deepEqual(
      depo.kuyrukSentetikBasi(10, B).map((s) => s.id),
      [b2],
    );
    depo.kuyruktanSil([a1, a2]);
    assert.equal(depo.kuyrukBasi(A)?.id, a3);
    assert.equal(depo.kuyrukBasi(B)?.id, b2);
  });
});

// ---------------------------------------------------------------------------------------------
// cihazlar, eslestirme
// ---------------------------------------------------------------------------------------------

describe("depo: cihazlar ve eşleştirme", () => {
  const cihaz = (id: string, ek: Partial<CihazKaydi> = {}): CihazKaydi => ({
    device_id: id,
    public_key: "c2FobmUtYW5haHRhcg==",
    tailscale_ip: "100.64.0.20",
    platform: "android",
    etiket: "deneme",
    eslesme_ms: 777,
    ...ek,
  });

  it("cihazEkle/cihazGetir/cihazlar", () => {
    const { depo } = kur();
    assert.equal(depo.cihazGetir("yok"), null);
    assert.deepEqual(depo.cihazlar(), []);
    depo.cihazEkle(cihaz("d1"));
    depo.cihazEkle(cihaz("d2", { platform: "ipad", etiket: null }));
    assert.deepEqual(depo.cihazGetir("d1"), cihaz("d1"));
    assert.deepEqual(depo.cihazGetir("d2"), cihaz("d2", { platform: "ipad", etiket: null }));
    assert.deepEqual(
      depo
        .cihazlar()
        .map((c) => c.device_id)
        .sort(),
      ["d1", "d2"],
    );
  });

  it("eşleştirme: yaz, oku, yanlış say, sil", () => {
    const { depo } = kur();
    assert.equal(depo.eslestirmeOku(), null);
    depo.eslestirmeYaz({ kod_ozeti: "ozet-a", son_ms: 1000, yanlis_deneme: 0 });
    assert.deepEqual(depo.eslestirmeOku(), { kod_ozeti: "ozet-a", son_ms: 1000, yanlis_deneme: 0 });
    depo.eslestirmeYanlisSay();
    depo.eslestirmeYanlisSay();
    assert.equal(depo.eslestirmeOku()?.yanlis_deneme, 2);
    assert.equal(depo.eslestirmeOku()?.kod_ozeti, "ozet-a");
    // yeni kod eskisinin yerine geçer
    depo.eslestirmeYaz({ kod_ozeti: "ozet-b", son_ms: 2000, yanlis_deneme: 0 });
    assert.deepEqual(depo.eslestirmeOku(), { kod_ozeti: "ozet-b", son_ms: 2000, yanlis_deneme: 0 });
    depo.eslestirmeSil();
    assert.equal(depo.eslestirmeOku(), null);
    depo.eslestirmeYanlisSay(); // kayıt yokken atmamalı
    assert.equal(depo.eslestirmeOku(), null);
  });
});

// ---------------------------------------------------------------------------------------------
// kopru_jetonlari
// ---------------------------------------------------------------------------------------------

describe("depo: köprü jetonları", () => {
  it("jetonEkle/jetonBul her kapsam türü için gidiş dönüş", () => {
    const { depo } = kur();
    const id = isOlustur(depo, "p1");
    const hash = "b".repeat(64);
    const kayitlar = [
      { ozet: "oz-eren", kapsam: { rol: "eren", sohbet_id: ANA_SOHBET_ID, nesil: 3 } },
      { ozet: "oz-eren-b", kapsam: { rol: "eren", sohbet_id: B_ID, nesil: 4 } },
      { ozet: "oz-soru", kapsam: { rol: "soru", is_id: id } },
      { ozet: "oz-tel", kapsam: { rol: "telefon", is_id: id, plan_id: "p1", plan_hash: hash } },
    ] as const;
    assert.equal(depo.jetonBul("oz-eren"), null);
    for (const k of kayitlar) depo.jetonEkle(k);
    for (const k of kayitlar) assert.deepEqual(depo.jetonBul(k.ozet), k);
    assert.equal(depo.jetonBul("baska"), null);
  });

  it("jetonlariSil yalnız o kapsamdakileri siler", () => {
    const { depo } = kur();
    const a = isOlustur(depo, "p1");
    const b = isOlustur(depo, "p2");
    depo.jetonEkle({ ozet: "e1", kapsam: { rol: "eren", sohbet_id: ANA_SOHBET_ID, nesil: 1 } });
    depo.jetonEkle({ ozet: "e2", kapsam: { rol: "eren", sohbet_id: ANA_SOHBET_ID, nesil: 2 } });
    depo.jetonEkle({ ozet: "sa", kapsam: { rol: "soru", is_id: a } });
    depo.jetonEkle({ ozet: "sb", kapsam: { rol: "soru", is_id: b } });
    depo.jetonlariSil({ rol: "eren", sohbet_id: ANA_SOHBET_ID, nesil: 1 });
    assert.equal(depo.jetonBul("e1"), null);
    assert.ok(depo.jetonBul("e2"));
    depo.jetonlariSil({ rol: "soru", is_id: a });
    assert.equal(depo.jetonBul("sa"), null);
    assert.ok(depo.jetonBul("sb"));
    depo.jetonlariSil({ rol: "eren", sohbet_id: ANA_SOHBET_ID, nesil: 99 }); // olmayan kapsam atmaz
    assert.ok(depo.jetonBul("e2"));
  });

  it("dilim 2: eren satırı sohbet_id'yi sütuna yazar; soru ve telefon satırında sütun NULL", () => {
    const yol = yeniYol();
    const { depo } = kur(yol);
    const id = isOlustur(depo, "p1");
    depo.jetonEkle({ ozet: "e-b", kapsam: { rol: "eren", sohbet_id: B_ID, nesil: 7 } });
    depo.jetonEkle({ ozet: "s", kapsam: { rol: "soru", is_id: id } });
    depo.jetonEkle({ ozet: "t", kapsam: { rol: "telefon", is_id: id, plan_id: "p1", plan_hash: "c".repeat(64) } });
    const satirlar = hamAc(
      yol,
      (h) => h.prepare("SELECT ozet, sohbet_id FROM kopru_jetonlari ORDER BY ozet").all() as Array<Record<string, unknown>>,
    );
    assert.deepEqual(
      satirlar.map((r) => [r.ozet, r.sohbet_id]),
      [
        ["e-b", B_ID],
        ["s", null],
        ["t", null],
      ],
    );
  });

  it("dilim 2: jetonBul sohbet_id'si NULL eski eren satırını ana okur", () => {
    const yol = yeniYol();
    const { depo } = kur(yol);
    hamAc(yol, (h) => h.prepare(ESKI_INSERT.kopru_jetonlari).run("e-eski", "eren", 5, null, null, null));
    assert.deepEqual(depo.jetonBul("e-eski"), {
      ozet: "e-eski",
      kapsam: { rol: "eren", sohbet_id: ANA_SOHBET_ID, nesil: 5 },
    });
  });

  it("dilim 2: jetonlariSil eren kapsamı sohbet ve nesille; ana kapsamı NULL eski satırı da siler, başka sohbetinkine dokunmaz", () => {
    const yol = yeniYol();
    const { depo } = kur(yol);
    depo.jetonEkle({ ozet: "e-ana-1", kapsam: { rol: "eren", sohbet_id: ANA_SOHBET_ID, nesil: 1 } });
    depo.jetonEkle({ ozet: "e-b-1", kapsam: { rol: "eren", sohbet_id: B_ID, nesil: 1 } });
    depo.jetonEkle({ ozet: "e-ana-2", kapsam: { rol: "eren", sohbet_id: ANA_SOHBET_ID, nesil: 2 } });
    hamAc(yol, (h) => h.prepare(ESKI_INSERT.kopru_jetonlari).run("e-eski-1", "eren", 1, null, null, null));

    depo.jetonlariSil({ rol: "eren", sohbet_id: B_ID, nesil: 1 });
    assert.equal(depo.jetonBul("e-b-1"), null);
    assert.ok(depo.jetonBul("e-ana-1"));
    assert.ok(depo.jetonBul("e-eski-1"), "B kapsamı NULL (ana) eski satırı silmez");
    assert.ok(depo.jetonBul("e-ana-2"));

    depo.jetonEkle({ ozet: "e-b-1", kapsam: { rol: "eren", sohbet_id: B_ID, nesil: 1 } });
    depo.jetonlariSil({ rol: "eren", sohbet_id: ANA_SOHBET_ID, nesil: 1 });
    assert.equal(depo.jetonBul("e-ana-1"), null);
    assert.equal(depo.jetonBul("e-eski-1"), null, "ana kapsamı NULL eski satırı da siler");
    assert.ok(depo.jetonBul("e-b-1"), "aynı nesil başka sohbetin jetonu kalır");
    assert.ok(depo.jetonBul("e-ana-2"), "başka nesil kalır");
  });

  it("dilim 2: erenJetonlariniSil bütün eren satırlarını siler (her sohbet, her nesil, eski NULL), sayı döner; soru ve telefon kalır", () => {
    const yol = yeniYol();
    const { depo } = kur(yol);
    const id = isOlustur(depo, "p1");
    depo.jetonEkle({ ozet: "e1", kapsam: { rol: "eren", sohbet_id: ANA_SOHBET_ID, nesil: 1 } });
    depo.jetonEkle({ ozet: "e2", kapsam: { rol: "eren", sohbet_id: A_ID, nesil: 2 } });
    depo.jetonEkle({ ozet: "e3", kapsam: { rol: "eren", sohbet_id: B_ID, nesil: 3 } });
    hamAc(yol, (h) => h.prepare(ESKI_INSERT.kopru_jetonlari).run("e-eski", "eren", 1, null, null, null));
    depo.jetonEkle({ ozet: "s", kapsam: { rol: "soru", is_id: id } });
    depo.jetonEkle({ ozet: "t", kapsam: { rol: "telefon", is_id: id, plan_id: "p1", plan_hash: "c".repeat(64) } });

    assert.equal(depo.erenJetonlariniSil(), 4);
    for (const oz of ["e1", "e2", "e3", "e-eski"]) assert.equal(depo.jetonBul(oz), null, oz);
    assert.deepEqual(depo.jetonBul("s"), { ozet: "s", kapsam: { rol: "soru", is_id: id } });
    assert.equal(depo.jetonBul("t")?.kapsam.rol, "telefon");
    assert.equal(depo.erenJetonlariniSil(), 0, "ikinci çağrı sessiz");
    assert.equal(say(yol, "kopru_jetonlari"), 2);
  });
});

// ---------------------------------------------------------------------------------------------
// kirli_okumalar
// ---------------------------------------------------------------------------------------------

describe("depo: kirli okumalar", () => {
  it("enAzNesil süzer, yeniden eskiye, yinelenmesiz", () => {
    const { depo } = kur();
    const i1 = isOlustur(depo, "p1");
    const i2 = isOlustur(depo, "p2");
    const i3 = isOlustur(depo, "p3");
    const s = ANA_SOHBET_ID;
    depo.kirliOkumaEkle({ is_id: i3, sohbet_id: s, nesil: 1, ts_ms: 10 });
    depo.kirliOkumaEkle({ is_id: i1, sohbet_id: s, nesil: 1, ts_ms: 20 });
    depo.kirliOkumaEkle({ is_id: i2, sohbet_id: s, nesil: 2, ts_ms: 30 });
    depo.kirliOkumaEkle({ is_id: i1, sohbet_id: s, nesil: 2, ts_ms: 40 });
    assert.deepEqual(depo.kirliOkumalar(1, ANA), [i1, i2, i3]);
    assert.deepEqual(depo.kirliOkumalar(2, ANA), [i1, i2]);
    assert.deepEqual(depo.kirliOkumalar(3, ANA), []);
  });

  it("dilim 2: yalnız okuyan sohbetin okumaları; başka sohbetin okuması sızmaz", () => {
    const { depo } = kur();
    const i1 = isOlustur(depo, "p1", { sohbet_id: A_ID });
    const i2 = isOlustur(depo, "p2", { sohbet_id: B_ID });
    const i3 = isOlustur(depo, "p3", { sohbet_id: B_ID });
    // B'nin işini A'nın ana oturumu okudu: okuma A'nındır (işin sohbeti değil).
    depo.kirliOkumaEkle({ is_id: i2, sohbet_id: A_ID, nesil: 1, ts_ms: 10 });
    depo.kirliOkumaEkle({ is_id: i1, sohbet_id: A_ID, nesil: 3, ts_ms: 20 });
    depo.kirliOkumaEkle({ is_id: i3, sohbet_id: B_ID, nesil: 2, ts_ms: 30 });
    depo.kirliOkumaEkle({ is_id: i1, sohbet_id: B_ID, nesil: 4, ts_ms: 40 });
    assert.deepEqual(depo.kirliOkumalar(1, A), [i1, i2]);
    assert.deepEqual(depo.kirliOkumalar(3, A), [i1]);
    assert.deepEqual(depo.kirliOkumalar(1, B), [i1, i3]);
    assert.deepEqual(depo.kirliOkumalar(1, ANA), []);
  });
});

// ---------------------------------------------------------------------------------------------
// Dilim 1: ek göç, profil, geçmişi temizle
// ---------------------------------------------------------------------------------------------

describe("depo: şema (ek göç)", () => {
  it("yeni dosya: user_version 1, sema_ek ek_surum 3, semaBilgisi aynı", () => {
    const yol = yeniYol();
    const { depo } = kur(yol);
    assert.deepEqual(depo.semaBilgisi(), { user_version: 1, ek_surum: 3 });
    depo.kapat();
    hamAc(yol, (h) => {
      assert.equal((h.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 1);
      const satir = h.prepare("SELECT deger FROM sema_ek WHERE anahtar='ek_surum'").get() as { deger: number };
      assert.equal(satir.deger, 3);
      const tablo = (h.prepare("PRAGMA table_list").all() as Array<{ name: string; strict: number }>).find(
        (t) => t.name === "sema_ek",
      );
      assert.equal(tablo?.strict, 1);
    });
  });

  it("göç idempotent: tekrar açınca bozulmaz, veri korunur, sayaç tek satır", () => {
    const yol = yeniYol();
    const a = kur(yol);
    a.depo.planEkle(planKaydi(pcPlan("p1"), "hafif"));
    a.depo.kapat();
    for (let i = 0; i < 2; i++) {
      const b = kur(yol);
      assert.deepEqual(b.depo.semaBilgisi(), { user_version: 1, ek_surum: 3 });
      assert.equal(b.depo.planGetir("p1")?.profil, "hafif");
      b.depo.kapat();
    }
    assert.equal(say(yol, "sema_ek"), 1);
  });

  it("ikinci bağlantı aynı dosyayı açınca göç yinelenmez", () => {
    const yol = yeniYol();
    const a = kur(yol).depo;
    const b = kur(yol, undefined).depo;
    assert.deepEqual(a.semaBilgisi(), b.semaBilgisi());
    assert.equal(b.semaBilgisi().ek_surum, 3);
    assert.equal(say(yol, "sohbetler"), 1);
  });

  it("eski şemalı dosya (sema_ek ve profil sütunu yok, user_version 1): göç bir kez uygulanır", () => {
    const yol = yeniYol();
    eskiSemaKur(yol, 0);
    hamAc(yol, (h) => {
      const plan = pcPlan("eski");
      h.prepare(ESKI_PLAN_INSERT_PROFILSIZ).run(plan.plan_id, JSON.stringify(plan), planHash(plan), "bekliyor", null, 1000);
    });
    const b = kur(yol);
    assert.deepEqual(b.depo.semaBilgisi(), { user_version: 1, ek_surum: 3 });
    assert.equal(b.depo.planGetir("eski")?.profil, "tam", "eski satır varsayılan tam okunur");
    assert.equal(b.depo.planGetir("eski")?.sohbet_id, ANA_SOHBET_ID, "eski satır ana okunur");
    b.depo.kapat();
    const c = kur(yol);
    assert.deepEqual(c.depo.semaBilgisi(), { user_version: 1, ek_surum: 3 });
    assert.equal(say(yol, "sema_ek"), 1);
  });

  it("göç sonrası profil ve sohbet_id yazmayan eski tip INSERT geçer ve satır tam, ana okunur", () => {
    const yol = yeniYol();
    const a = kur(yol);
    a.depo.planEkle(planKaydi(pcPlan("kopya"), "hafif", B_ID));
    a.depo.kapat();
    hamAc(yol, (h) => {
      const satir = h.prepare("SELECT * FROM planlar").get() as Record<string, string | number | null>;
      const sutunlar = Object.keys(satir).filter((k) => k !== "profil" && k !== "sohbet_id");
      h.exec("DELETE FROM planlar");
      h.prepare(`INSERT INTO planlar (${sutunlar.join(", ")}) VALUES (${sutunlar.map(() => "?").join(", ")})`).run(
        ...sutunlar.map((k) => satir[k] as string | number | null),
      );
    });
    const b = kur(yol);
    const k = b.depo.planGetir("kopya");
    assert.ok(k);
    assert.equal(k.profil, "tam");
    assert.equal(k.sohbet_id, ANA_SOHBET_ID);
    assert.equal(planHash(k.plan), k.plan_hash);
  });
});

describe("depo: plan profili", () => {
  it("varsayılan tam, hafif gidiş dönüşte korunur; plan JSON'una girmez, hash değişmez", () => {
    const yol = yeniYol();
    const { depo } = kur(yol);
    const plan = pcPlan("pf");
    depo.planEkle(planKaydi(plan, "hafif"));
    depo.planEkle(planKaydi(pcPlan("pt")));
    assert.equal(depo.planGetir("pf")?.profil, "hafif");
    assert.equal(depo.planGetir("pt")?.profil, "tam");
    assert.deepEqual(depo.planGetir("pf")?.plan, plan);
    assert.ok(!("profil" in (depo.planGetir("pf")?.plan as object)));
    assert.equal(depo.planGetir("pf")?.plan_hash, planHash(plan));
    assert.deepEqual(
      depo
        .bekleyenPlanlar()
        .map((p) => [p.plan.plan_id, p.profil])
        .sort(),
      [
        ["pf", "hafif"],
        ["pt", "tam"],
      ],
    );
    hamAc(yol, (h) => {
      for (const r of h.prepare("SELECT * FROM planlar").all() as Array<Record<string, unknown>>) {
        for (const v of Object.values(r)) {
          if (typeof v === "string" && v.startsWith("{")) assert.ok(!v.includes('"profil"'), "plan JSON'unda profil var");
        }
      }
    });
  });

  it("planGuncelle profili bozmaz", () => {
    const { depo } = kur();
    depo.planEkle(planKaydi(pcPlan("pg"), "hafif"));
    depo.planGuncelle("pg", "izin_bekliyor", null);
    assert.equal(depo.planGetir("pg")?.profil, "hafif");
  });
});

describe("depo: nesiller()", () => {
  it("bütün nesiller, nesil artan", () => {
    const { depo } = kur();
    assert.deepEqual(depo.nesiller(ANA), []);
    depo.nesilEkle(nesilKaydi(2));
    depo.nesilEkle(nesilKaydi(1));
    depo.nesilEkle(nesilKaydi(3));
    assert.deepEqual(
      depo.nesiller(ANA).map((x) => x.nesil),
      [1, 2, 3],
    );
    assert.deepEqual(depo.nesiller(ANA)[1], nesilKaydi(2));
  });
});

describe("depo: gecmisiTemizle", () => {
  const turK = (id: string): TurKaydi => turKaydi(id);

  it("silinebilir olaylar gider, mezar taşı tek ve doğru şekilde kalır", () => {
    const { depo, zaman } = kur();
    const yazilan = TUM_OLAYLAR().map((g) => depo.olayEkle(g));
    const onceBas = depo.basSeq();
    assert.equal(onceBas, yazilan.length);
    zaman.ilerlet(500);
    const sonuc = depo.gecmisiTemizle(ANA);
    assert.equal(sonuc.silinen_olay, yazilan.length);
    assert.equal(sonuc.mezar.type, "chat_cleared");
    assert.equal(sonuc.mezar.sinir_seq, onceBas);
    assert.ok(sonuc.mezar.seq > sonuc.mezar.sinir_seq);
    assert.equal(sonuc.mezar.ts_ms, zaman.simdi());
    assert.equal(sonuc.mezar.sohbet_id, ANA_SOHBET_ID, "dilim 2: mezar taşı sohbet_id taşır");
    assert.deepEqual(depo.olaylariGetir(0, 100), [sonuc.mezar]);
    assert.equal(depo.basSeq(), sonuc.mezar.seq);
    assert.deepEqual(depo.sonKonusma(10, ANA), []);
  });

  it("boş depoda: sinir_seq 0, mezar seq 1, sayılar 0", () => {
    const { depo } = kur();
    const s = depo.gecmisiTemizle(ANA);
    assert.equal(s.mezar.sinir_seq, 0);
    assert.equal(s.mezar.seq, 1);
    assert.equal(s.silinen_olay, 0);
    assert.equal(s.bosaltilan_tur, 0);
    assert.equal(s.silinen_kuyruk, 0);
  });

  it("kapalı turun kısmi metni boşalır, açık turunki kalır; satırlar silinmez", () => {
    const { depo } = kur();
    depo.nesilEkle(nesilKaydi(1));
    depo.turEkle(turK("kapali"));
    depo.turEkle(turK("kapali2"));
    depo.turEkle(turK("acik"));
    depo.turBitir("kapali", "kesildi", "KAPALI-KISMI", 200);
    depo.turBitir("kapali2", "tamam", "KAPALI2", 210);
    depo.turKismiYaz("acik", "ACIK-KISMI");
    const s = depo.gecmisiTemizle(ANA);
    assert.equal(s.bosaltilan_tur, 2);
    assert.equal(depo.turGetir("kapali")?.kismi_metin, "");
    assert.equal(depo.turGetir("kapali2")?.kismi_metin, "");
    assert.equal(depo.turGetir("kapali")?.bitis, "kesildi");
    assert.equal(depo.turGetir("acik")?.kismi_metin, "ACIK-KISMI");
    assert.equal(depo.acikTurlar(ANA).length, 1);
  });

  it("kuyruktaki tüm satırlar (insan ve sentetik) silinir", () => {
    const { depo } = kur();
    depo.kuyrugaEkle("insan", "i1", 1, ANA);
    depo.kuyrugaEkle("sentetik", "s1", 2, ANA);
    depo.kuyrugaEkle("insan", "i2", 3, ANA);
    depo.kuyrugaEkle("sentetik", "s2", 4, ANA);
    const s = depo.gecmisiTemizle(ANA);
    assert.equal(s.silinen_kuyruk, 4);
    assert.deepEqual(depo.kuyrukSentetikBasi(10, ANA), []);
    assert.equal(depo.kuyrukBasi(ANA), null);
  });

  it("isler, planlar, sorular, nesiller, acklar ve diğer tabloların satırları kalır", () => {
    const yol = yeniYol();
    const { depo } = kur(yol);
    depo.nesilEkle(nesilKaydi(1));
    const id = isOlustur(depo, "p1");
    depo.planEkle(planKaydi(pcPlan("p2"), "hafif"));
    depo.soruEkle({
      soru_id: "s1",
      is_id: id,
      soru: "?",
      secenekler: null,
      durum: "cevaplandi",
      cevap: "e",
      olusturma_ms: 1,
      son_ms: 2,
    });
    depo.isPidEkle({ is_id: id, pid: 5, olusturmaMs: 1, ad: "x.exe", ilk_gorulme_ms: 1 });
    depo.ackYaz("d1", "m1", { ok: true, seq: 1 });
    depo.cihazEkle({
      device_id: "d1",
      public_key: "a2V5",
      tailscale_ip: "100.64.0.9",
      platform: "android",
      etiket: null,
      eslesme_ms: 1,
    });
    depo.jetonEkle({ ozet: "j1", kapsam: { rol: "eren", sohbet_id: ANA_SOHBET_ID, nesil: 1 } });
    depo.kirliOkumaEkle({ is_id: id, sohbet_id: ANA_SOHBET_ID, nesil: 1, ts_ms: 1 });
    depo.oturumKaydet("oturum-1", 1, ANA);
    depo.olayEkle(kullaniciOlayi(1));
    const tablolar = [
      "isler",
      "planlar",
      "sorular",
      "nesiller",
      "acklar",
      "is_pidleri",
      "cihazlar",
      "kopru_jetonlari",
      "kirli_okumalar",
      "eren_oturumlari",
      "sohbetler",
    ];
    const once = tablolar.map((t) => say(yol, t));
    const sohbetOnce = depo.sohbetGetir(ANA);
    depo.gecmisiTemizle(ANA);
    assert.deepEqual(
      tablolar.map((t) => say(yol, t)),
      once,
    );
    assert.deepEqual(depo.sohbetGetir(ANA), sohbetOnce, "sohbetler satırı değişmez");
    assert.equal(depo.isGetir(id)?.plan_id, "p1");
    assert.equal(depo.planGetir("p2")?.profil, "hafif");
    assert.deepEqual(depo.ackBul("d1", "m1"), { ok: true, seq: 1 });
  });

  it("ikinci temizlikte önceki mezar taşı silinmez; head_seq gerilemez; sinir_seq önceki basSeq", () => {
    const { depo } = kur();
    for (let i = 1; i <= 3; i++) depo.olayEkle(kullaniciOlayi(i));
    const s1 = depo.gecmisiTemizle(ANA);
    assert.equal(s1.mezar.sinir_seq, 3);
    assert.equal(s1.mezar.seq, 4);
    assert.equal(depo.basSeq(), 4);

    depo.olayEkle(kullaniciOlayi(4));
    assert.equal(depo.olayEkle(kullaniciOlayi(5)).seq, 6);
    const s2 = depo.gecmisiTemizle(ANA);
    assert.equal(s2.silinen_olay, 2, "eski mezar taşı sayılmaz");
    assert.equal(s2.mezar.sinir_seq, 6);
    assert.equal(s2.mezar.seq, 7);
    assert.deepEqual(depo.olaylariGetir(0, 100), [s1.mezar, s2.mezar]);
    assert.equal(depo.basSeq(), 7);

    const s3 = depo.gecmisiTemizle(ANA);
    assert.equal(s3.silinen_olay, 0);
    assert.equal(s3.mezar.sinir_seq, 7);
    assert.equal(s3.mezar.seq, 8);
    assert.equal(depo.olaylariGetir(0, 100).length, 3);
    assert.equal(depo.olayEkle(kullaniciOlayi(6)).seq, 9);
  });

  it("sondaki satırlar silinse de seq küçülmez; kapat-aç sonrası da", () => {
    const yol = yeniYol();
    const a = kur(yol);
    for (let i = 1; i <= 3; i++) a.depo.olayEkle(kullaniciOlayi(i));
    const s = a.depo.gecmisiTemizle(ANA);
    a.depo.kapat();
    const b = kur(yol);
    assert.equal(b.depo.basSeq(), s.mezar.seq);
    assert.equal(b.depo.olayEkle(kullaniciOlayi(9)).seq, s.mezar.seq + 1);
  });

  it("işlem içinde atan temizlikte hiçbir şey silinmez ve yayın olmaz", () => {
    const { depo, veriyolu } = kur();
    depo.nesilEkle(nesilKaydi(1));
    depo.turEkle(turK("t1"));
    depo.turBitir("t1", "tamam", "KISMI", 5);
    depo.kuyrugaEkle("insan", "i", 1, ANA);
    const e = depo.olayEkle(kullaniciOlayi(1));
    const yayinOnce = veriyolu!.olaylar().length;
    assert.throws(() =>
      depo.islem(() => {
        depo.gecmisiTemizle(ANA);
        throw new Error("geri al");
      }),
    );
    assert.deepEqual(depo.olaylariGetir(0, 10), [e]);
    assert.equal(depo.turGetir("t1")?.kismi_metin, "KISMI");
    assert.equal(depo.kuyrukBasi(ANA)?.metin, "i");
    assert.equal(veriyolu!.olaylar().length, yayinOnce);
    assert.equal(depo.basSeq(), 1);
    assert.equal(depo.olayEkle(kullaniciOlayi(2)).seq, 2);
  });

  it("mezar taşı olay_yazildi ile, işlem bittikten sonra yayınlanır", () => {
    const { depo, veriyolu } = kur();
    depo.olayEkle(kullaniciOlayi(1));
    const once = veriyolu!.olaylar().length;
    let icte = -1;
    const s = depo.islem(() => {
      const r = depo.gecmisiTemizle(ANA);
      icte = veriyolu!.olaylar().length;
      return r;
    });
    assert.equal(icte, once, "işlem bitmeden yayın olmamalı");
    const yayinlar = veriyolu!.olaylar();
    assert.equal(yayinlar.length, once + 1);
    assert.deepEqual(yayinlar[yayinlar.length - 1], s.mezar);
  });

  it("dışarıdan çağrılınca kendi işleminde yayınlar", () => {
    const { depo, veriyolu } = kur();
    const s = depo.gecmisiTemizle(ANA);
    assert.deepEqual(veriyolu!.olaylar(), [s.mezar]);
  });
});

// ---------------------------------------------------------------------------------------------
// Dilim 2: gecmisiTemizle ve sonMezarTasi sohbet kapsamlı
// ---------------------------------------------------------------------------------------------

describe("depo: gecmisiTemizle sohbet kapsamı (dilim 2)", () => {
  /** ana, B ve küresel satırlar: olaylar, kapalı tur kısmi metinleri, kuyruklar. */
  const karisikKur = () => {
    const k = kur();
    const { depo } = k;
    sohbetAc(depo, B_ID, "İkinci");
    const olay = {
      bOlusturuldu: depo.olayEkle({ type: "chat_created", sohbet_id: B_ID, ad: "İkinci" }),
      anaMesaj: depo.olayEkle(kullaniciOlayi(1, "ana mesajı")),
      bMesaj: depo.olayEkle(kullaniciOlayi(2, "b mesajı", B_ID)),
      kuresel: depo.olayEkle(kureselNot("küresel")),
      bYanit: depo.olayEkle(eren("tb", "b yanıtı", B_ID)),
      bNotu: depo.olayEkle({ ...kureselNot("b notu"), sohbet_id: B_ID }),
      anaYanit: depo.olayEkle(eren("ta", "ana yanıtı")),
      bAdlandi: depo.olayEkle({ type: "chat_renamed", sohbet_id: B_ID, ad: "Yeni ad" }),
    };
    depo.nesilEkle(nesilKaydi(1));
    depo.nesilEkle(nesilKaydi(2, B_ID));
    depo.turEkle(turKaydi("ta"));
    depo.turEkle(turKaydi("tb", { sohbet_id: B_ID, nesil: 2 }));
    depo.turEkle(turKaydi("tb-acik", { sohbet_id: B_ID, nesil: 2 }));
    depo.turBitir("ta", "tamam", "ANA-KISMI", 200);
    depo.turBitir("tb", "tamam", "B-KISMI", 210);
    depo.turKismiYaz("tb-acik", "B-ACIK");
    depo.kuyrugaEkle("insan", "ana kuyruk", 1, ANA);
    depo.kuyrugaEkle("insan", "b kuyruk", 2, B);
    depo.kuyrugaEkle("sentetik", "b sentetik", 3, B);
    return { ...k, olay };
  };

  it("gecmisiTemizle(B) yalnız B'nin olaylarını, kuyruğunu, kısmi metnini siler; ana ve küresel olay kalır", () => {
    const { depo, olay } = karisikKur();
    const onceBas = depo.basSeq();
    const s = depo.gecmisiTemizle(B);
    assert.equal(s.mezar.sohbet_id, B_ID);
    assert.equal(s.mezar.sinir_seq, onceBas, "sinir_seq küresel basSeq");
    assert.equal(s.silinen_olay, 3, "B'nin mesajı, yanıtı, notu");
    assert.equal(s.bosaltilan_tur, 1);
    assert.equal(s.silinen_kuyruk, 2);
    assert.deepEqual(depo.olaylariGetir(0, 100), [
      olay.bOlusturuldu,
      olay.anaMesaj,
      olay.kuresel,
      olay.anaYanit,
      olay.bAdlandi,
      s.mezar,
    ]);
    assert.equal(depo.turGetir("tb")?.kismi_metin, "");
    assert.equal(depo.turGetir("tb-acik")?.kismi_metin, "B-ACIK", "açık turun metni kalır");
    assert.equal(depo.turGetir("ta")?.kismi_metin, "ANA-KISMI");
    assert.equal(depo.kuyrukBasi(B), null);
    assert.equal(depo.kuyrukBasi(ANA)?.metin, "ana kuyruk");
    assert.deepEqual(depo.sonKonusma(10, B), []);
    assert.deepEqual(
      depo.sonKonusma(10, ANA).map((x) => x.metin),
      ["ana mesajı", "ana yanıtı"],
    );
    assert.deepEqual(depo.sonMezarTasi(B), s.mezar);
    assert.equal(depo.sonMezarTasi(ANA), null);
  });

  it("gecmisiTemizle(ana) NULL sütunlu küresel olayı da siler; B'nin olaylarına (notu dahil) dokunmaz", () => {
    const { depo, olay } = karisikKur();
    const s = depo.gecmisiTemizle(ANA);
    assert.equal(s.mezar.sohbet_id, ANA_SOHBET_ID);
    assert.equal(s.silinen_olay, 3, "ana mesajı, ana yanıtı, küresel not");
    assert.equal(s.bosaltilan_tur, 1);
    assert.equal(s.silinen_kuyruk, 1);
    assert.deepEqual(depo.olaylariGetir(0, 100), [
      olay.bOlusturuldu,
      olay.bMesaj,
      olay.bYanit,
      olay.bNotu,
      olay.bAdlandi,
      s.mezar,
    ]);
    assert.equal(depo.turGetir("ta")?.kismi_metin, "");
    assert.equal(depo.turGetir("tb")?.kismi_metin, "B-KISMI");
    assert.equal(depo.kuyrukBasi(ANA), null);
    assert.equal(depo.kuyrukBasi(B)?.metin, "b kuyruk");
    assert.deepEqual(depo.sonMezarTasi(ANA), s.mezar);
    assert.equal(depo.sonMezarTasi(B), null);
  });

  it("SILINMEZ_OLAY_TURLERI hiçbir temizlikte silinmez (önceki mezar taşları ve yaşam döngüsü)", () => {
    const { depo } = karisikKur();
    depo.gecmisiTemizle(B);
    depo.gecmisiTemizle(ANA);
    depo.olayEkle(kullaniciOlayi(9, "yeni", B_ID));
    depo.gecmisiTemizle(B);
    const turler = depo.olaylariGetir(0, 100).map((o) => o.type);
    assert.ok(turler.every((t) => (SILINMEZ_OLAY_TURLERI as readonly string[]).includes(t)), turler.join(","));
    assert.deepEqual(turler, ["chat_created", "chat_renamed", "chat_cleared", "chat_cleared", "chat_cleared"]);
  });

  it("sonMezarTasi sohbet başına; ana NULL sütunlu ve eski (sütun ana, alansız) mezar taşını da görür", () => {
    const yol = yeniYol();
    const { depo } = kur(yol);
    const bMezar = depo.gecmisiTemizle(B).mezar;
    hamAc(yol, (h) => {
      h.prepare("INSERT INTO events (ts_ms, type, veri, sohbet_id) VALUES (?, ?, ?, NULL)").run(
        5,
        "chat_cleared",
        JSON.stringify({ type: "chat_cleared", sinir_seq: 1 }),
      );
    });
    const nullMezar = depo.olaylariGetir(bMezar.seq, 10)[0];
    assert.ok(nullMezar && nullMezar.type === "chat_cleared");
    assert.deepEqual(depo.sonMezarTasi(ANA), nullMezar, "NULL sütunlu mezar ana'nındır");
    assert.deepEqual(depo.sonMezarTasi(B), bMezar);
    hamAc(yol, (h) => {
      h.prepare(ESKI_INSERT.events).run(6, "chat_cleared", JSON.stringify({ type: "chat_cleared", sinir_seq: 2 }));
    });
    const eskiMezar = depo.olaylariGetir(nullMezar.seq, 10)[0];
    assert.ok(eskiMezar);
    assert.deepEqual(depo.sonMezarTasi(ANA), eskiMezar, "eski kodun mezar taşı ana'nındır");
    assert.deepEqual(depo.sonMezarTasi(B), bMezar);
    assert.equal(depo.sonMezarTasi(A), null);
    const anaMezar = depo.gecmisiTemizle(ANA).mezar;
    assert.deepEqual(depo.sonMezarTasi(ANA), anaMezar);
    assert.deepEqual(depo.sonMezarTasi(B), bMezar, "ana'nın temizliği B'nin mezarını değiştirmez");
  });
});

// ---------------------------------------------------------------------------------------------
// Dilim 2: sohbetler tablosu
// ---------------------------------------------------------------------------------------------

describe("depo: sohbetler tablosu (dilim 2)", () => {
  const anaYeni: SohbetKaydi = {
    sohbet_id: ANA_SOHBET_ID,
    ad: ANA_SOHBET_ADI,
    olusturma_ms: 0,
    son_etkinlik_ms: 0,
    silinme_ms: null,
  };

  it("yeni dosyada yalnız ana var: ANA_SOHBET_ADI, olay yokken 0/0, silinmemiş; tablo STRICT", () => {
    const yol = yeniYol();
    const { depo } = kur(yol);
    assert.deepEqual(depo.sohbetListesi(), [anaYeni]);
    assert.deepEqual(depo.sohbetListesi(true), [anaYeni]);
    assert.deepEqual(depo.sohbetGetir(ANA), anaYeni);
    assert.equal(depo.basSeq(), 0, "ana için chat_created yazılmaz");
    hamAc(yol, (h) => {
      const t = (h.prepare("PRAGMA table_list").all() as Array<{ name: string; strict: number }>).find(
        (x) => x.name === "sohbetler",
      );
      assert.equal(t?.strict, 1);
    });
  });

  it("sohbetEkle/sohbetGetir gidiş dönüş, olay yazmaz; olmayan null", () => {
    const { depo, veriyolu } = kur();
    assert.equal(depo.sohbetGetir(B), null);
    depo.sohbetEkle({ sohbet_id: B_ID, ad: "İkinci ğüş", olusturma_ms: 50, son_etkinlik_ms: 60 });
    assert.deepEqual(depo.sohbetGetir(B), {
      sohbet_id: B_ID,
      ad: "İkinci ğüş",
      olusturma_ms: 50,
      son_etkinlik_ms: 60,
      silinme_ms: null,
    });
    assert.equal(depo.basSeq(), 0);
    assert.equal(veriyolu!.olaylar().length, 0);
  });

  it("sohbetEkle var olan kimlikte atar (ana ve silinmiş dahil), kayıt değişmez", () => {
    const { depo } = kur();
    assert.throws(() => sohbetAc(depo, ANA_SOHBET_ID, "Başka"));
    assert.deepEqual(depo.sohbetGetir(ANA), anaYeni);
    sohbetAc(depo, B_ID, "İkinci");
    assert.throws(() => sohbetAc(depo, B_ID, "Üçüncü", 99));
    assert.equal(depo.sohbetGetir(B)?.ad, "İkinci");
    depo.sohbetiSil(B, 500);
    assert.throws(() => sohbetAc(depo, B_ID, "Dirilen"));
    assert.equal(depo.sohbetGetir(B)?.silinme_ms, 500);
    assert.equal(depo.sohbetGetir(B)?.ad, "İkinci");
  });

  it("sohbetEkle ve sohbetAdiYaz geçersiz adda atar (SohbetAdi), kayıt değişmez; 60 UTF-16 birimi sınırı", () => {
    const { depo } = kur();
    const gecersizler = [
      "",
      " baştaki",
      "sondaki ",
      "   ",
      "iki\nsatır",
      "sekme\tli",
      "x".repeat(SOHBET_SINIRLARI.SOHBET_ADI + 1),
      "\u{1F600}".repeat(SOHBET_SINIRLARI.SOHBET_ADI / 2 + 1),
    ];
    for (const ad of gecersizler) {
      assert.throws(() => sohbetAc(depo, A_ID, ad), `kabul etti: ${JSON.stringify(ad)}`);
      assert.equal(depo.sohbetGetir(A), null);
    }
    sohbetAc(depo, A_ID, "\u{1F600}".repeat(SOHBET_SINIRLARI.SOHBET_ADI / 2));
    sohbetAc(depo, B_ID, "x".repeat(SOHBET_SINIRLARI.SOHBET_ADI));
    for (const ad of gecersizler) {
      assert.throws(() => depo.sohbetAdiYaz(B, ad), `kabul etti: ${JSON.stringify(ad)}`);
      assert.equal(depo.sohbetGetir(B)?.ad, "x".repeat(SOHBET_SINIRLARI.SOHBET_ADI));
    }
  });

  it("sohbetListesi: silinmemişler olusturma_ms artan, eşitlikte yazılış sırası; silinenlerDahil silinmişleri de verir", () => {
    const { depo } = kur();
    sohbetAc(depo, B_ID, "B", 10);
    sohbetAc(depo, A_ID, "A", 10);
    sohbetAc(depo, "sohbet-c", "C", 5);
    sohbetAc(depo, "sohbet-d", "D", 20);
    assert.deepEqual(
      depo.sohbetListesi().map((s) => s.sohbet_id),
      [ANA_SOHBET_ID, "sohbet-c", B_ID, A_ID, "sohbet-d"],
    );
    depo.sohbetiSil(B, 700);
    assert.deepEqual(
      depo.sohbetListesi().map((s) => s.sohbet_id),
      [ANA_SOHBET_ID, "sohbet-c", A_ID, "sohbet-d"],
    );
    const hepsi = depo.sohbetListesi(true);
    assert.deepEqual(
      hepsi.map((s) => s.sohbet_id),
      [ANA_SOHBET_ID, "sohbet-c", B_ID, A_ID, "sohbet-d"],
    );
    assert.equal(hepsi.find((s) => s.sohbet_id === B_ID)?.silinme_ms, 700);
    assert.deepEqual(depo.sohbetListesi(false), depo.sohbetListesi());
  });

  it("sohbetAdiYaz: adı değiştirir (ana dahil), olay yazmaz; olmayan ve silinmiş sohbette atar", () => {
    const { depo, veriyolu } = kur();
    depo.sohbetAdiYaz(ANA, "Ana sohbet");
    assert.equal(depo.sohbetGetir(ANA)?.ad, "Ana sohbet");
    sohbetAc(depo, B_ID, "İkinci", 30);
    depo.sohbetAdiYaz(B, "Yeniden");
    assert.deepEqual(depo.sohbetGetir(B), {
      sohbet_id: B_ID,
      ad: "Yeniden",
      olusturma_ms: 30,
      son_etkinlik_ms: 30,
      silinme_ms: null,
    });
    assert.equal(depo.basSeq(), 0);
    assert.equal(veriyolu!.olaylar().length, 0);
    assert.throws(() => depo.sohbetAdiYaz({ sohbet_id: "yok" }, "Ad"));
    assert.equal(depo.sohbetGetir({ sohbet_id: "yok" }), null);
    depo.sohbetiSil(B, 99);
    assert.throws(() => depo.sohbetAdiYaz(B, "Silinmişe"));
    assert.equal(depo.sohbetGetir(B)?.ad, "Yeniden");
  });

  it("sohbetEtkinlikYaz: max(eski, ms); olmayan sohbette sessiz, günlükte uyarı; ad günlüğe girmez", () => {
    const { depo, gunluk } = kur();
    const GIZLI_AD = "GIZLI-SOHBET-ADI";
    sohbetAc(depo, B_ID, GIZLI_AD, 100);
    depo.sohbetEtkinlikYaz(B, 500);
    assert.equal(depo.sohbetGetir(B)?.son_etkinlik_ms, 500);
    depo.sohbetEtkinlikYaz(B, 300);
    assert.equal(depo.sohbetGetir(B)?.son_etkinlik_ms, 500, "geriye gitmez");
    assert.equal(depo.sohbetGetir(B)?.olusturma_ms, 100);
    depo.sohbetEtkinlikYaz(ANA, 42);
    assert.equal(depo.sohbetGetir(ANA)?.son_etkinlik_ms, 42);
    assert.equal(depo.sohbetGetir(B)?.son_etkinlik_ms, 500, "başka sohbete dokunmaz");
    const uyariOnce = gunluk.girdiler.filter((g) => g.seviye === "uyari").length;
    depo.sohbetEtkinlikYaz({ sohbet_id: "yok" }, 900);
    assert.equal(depo.sohbetGetir({ sohbet_id: "yok" }), null);
    assert.ok(gunluk.girdiler.filter((g) => g.seviye === "uyari").length > uyariOnce, "uyarı yok");
    depo.sohbetAdiYaz(B, `${GIZLI_AD}-2`);
    assert.ok(!JSON.stringify(gunluk.girdiler).includes(GIZLI_AD), "ad günlüğe yazıldı");
  });

  it("sohbet satırları kapat-aç sonrası durur", () => {
    const yol = yeniYol();
    const a = kur(yol);
    sohbetAc(a.depo, B_ID, "Kalıcı", 77);
    a.depo.sohbetEtkinlikYaz(B, 88);
    a.depo.kapat();
    const b = kur(yol);
    assert.deepEqual(b.depo.sohbetGetir(B), {
      sohbet_id: B_ID,
      ad: "Kalıcı",
      olusturma_ms: 77,
      son_etkinlik_ms: 88,
      silinme_ms: null,
    });
    assert.equal(b.depo.sohbetListesi().length, 2);
  });
});

// ---------------------------------------------------------------------------------------------
// Dilim 2: sohbetiSil
// ---------------------------------------------------------------------------------------------

describe("depo: sohbetiSil (dilim 2)", () => {
  /** A ve B açık; B'nin her türden satırı var; ana, A ve küresel satırlar da var. */
  const silmeKur = () => {
    const yol = yeniYol();
    const k = kur(yol);
    const { depo } = k;
    sohbetAc(depo, A_ID, "A");
    sohbetAc(depo, B_ID, "B");
    const bOlusturuldu = depo.olayEkle({ type: "chat_created", sohbet_id: B_ID, ad: "B" });
    const aOlusturuldu = depo.olayEkle({ type: "chat_created", sohbet_id: A_ID, ad: "A" });
    depo.olayEkle(kullaniciOlayi(1, "b eski", B_ID));
    const bMezar = depo.gecmisiTemizle(B).mezar;
    const bAdlandi = depo.olayEkle({ type: "chat_renamed", sohbet_id: B_ID, ad: "B yeni" });
    const aMesaj = depo.olayEkle(kullaniciOlayi(2, "a mesajı", A_ID));
    depo.olayEkle(kullaniciOlayi(3, "b mesajı", B_ID));
    const anaMesaj = depo.olayEkle(kullaniciOlayi(4, "ana mesajı"));
    depo.olayEkle(eren("tb", "b yanıtı", B_ID));
    const kuresel = depo.olayEkle(kureselNot("küresel"));
    depo.olayEkle({ type: "turn_aborted", sohbet_id: B_ID, turn_id: "tb2", neden: "hata", kismi_metin: "K" });
    depo.olayEkle({ ...kureselNot("b notu"), sohbet_id: B_ID });

    depo.nesilEkle(nesilKaydi(1, A_ID));
    depo.nesilEkle(nesilKaydi(2, B_ID));
    depo.turEkle(turKaydi("ta", { sohbet_id: A_ID, nesil: 1 }));
    depo.turEkle(turKaydi("tb", { sohbet_id: B_ID, nesil: 2 }));
    depo.turEkle(turKaydi("tb2", { sohbet_id: B_ID, nesil: 2 }));
    depo.turEkle(turKaydi("tb-acik", { sohbet_id: B_ID, nesil: 2 }));
    depo.turBitir("ta", "tamam", "A-KISMI", 200);
    depo.turBitir("tb", "tamam", "B-KISMI", 210);
    depo.turBitir("tb2", "hata", "B-KISMI-2", 220);
    depo.turKismiYaz("tb-acik", "B-ACIK");
    depo.kuyrugaEkle("insan", "a kuyruk", 1, A);
    depo.kuyrugaEkle("insan", "b kuyruk", 2, B);
    depo.kuyrugaEkle("sentetik", "b sentetik", 3, B);
    depo.kuyrugaEkle("insan", "ana kuyruk", 4, ANA);

    const ib = isOlustur(depo, "pb", { sohbet_id: B_ID });
    depo.soruEkle({
      soru_id: "sb",
      is_id: ib,
      soru: "?",
      secenekler: null,
      durum: "cevaplandi",
      cevap: "e",
      olusturma_ms: 1,
      son_ms: 2,
    });
    depo.planEkle(planKaydi(pcPlan("pb-bekleyen"), "tam", B_ID));
    depo.kirliOkumaEkle({ is_id: ib, sohbet_id: B_ID, nesil: 2, ts_ms: 5 });
    depo.oturumKaydet("oturum-b", 1, B);
    return { ...k, yol, ib, korunan: { bOlusturuldu, aOlusturuldu, bMezar, bAdlandi, aMesaj, anaMesaj, kuresel } };
  };

  it("B'nin silinebilir bütün olaylarını siler, SILINMEZ_OLAY_TURLERI kalır, chat_deleted yazar, chat_cleared yazmaz", () => {
    const { depo, zaman, veriyolu, korunan } = silmeKur();
    const onceYayin = veriyolu!.olaylar().length;
    zaman.ilerlet(1000);
    const s = depo.sohbetiSil(B, 12345);
    assert.equal(s.silindi.type, "chat_deleted");
    assert.equal(s.silindi.sohbet_id, B_ID);
    assert.equal(s.silindi.seq, depo.basSeq(), "chat_deleted en yeni olay");
    assert.equal(s.silinen_olay, 4, "b mesajı, b yanıtı, turn_aborted, b notu");
    assert.equal(s.bosaltilan_tur, 2);
    assert.equal(s.silinen_kuyruk, 2);
    assert.deepEqual(depo.olaylariGetir(0, 100), [
      korunan.bOlusturuldu,
      korunan.aOlusturuldu,
      korunan.bMezar,
      korunan.bAdlandi,
      korunan.aMesaj,
      korunan.anaMesaj,
      korunan.kuresel,
      s.silindi,
    ]);
    const cleared = depo.olaylariGetir(0, 100).filter((o) => o.type === "chat_cleared");
    assert.deepEqual(cleared, [korunan.bMezar], "yeni chat_cleared yok");
    assert.deepEqual(veriyolu!.olaylar().slice(onceYayin), [s.silindi], "yalnız chat_deleted yayınlandı");
  });

  it("kapalı turların kısmi metni boşalır, açık turunki kalır, kuyruk silinir; A'ya, ana'ya, küresel olaya dokunmaz", () => {
    const { depo } = silmeKur();
    depo.sohbetiSil(B, 1);
    assert.equal(depo.turGetir("tb")?.kismi_metin, "");
    assert.equal(depo.turGetir("tb2")?.kismi_metin, "");
    assert.equal(depo.turGetir("tb")?.bitis, "tamam", "tur satırı kalır");
    assert.equal(depo.turGetir("tb-acik")?.kismi_metin, "B-ACIK");
    assert.equal(depo.turGetir("ta")?.kismi_metin, "A-KISMI");
    assert.equal(depo.kuyrukBasi(B), null);
    assert.equal(depo.kuyrukBasi(A)?.metin, "a kuyruk");
    assert.equal(depo.kuyrukBasi(ANA)?.metin, "ana kuyruk");
    assert.deepEqual(
      depo.sonKonusma(10, A).map((x) => x.metin),
      ["a mesajı"],
    );
    assert.deepEqual(
      depo.sonKonusma(10, ANA).map((x) => x.metin),
      ["ana mesajı"],
    );
    assert.deepEqual(depo.sonKonusma(10, B), []);
  });

  it("silinme_ms dolu, sohbetListesi()'nde yok, sohbetListesi(true)'de var; iş, plan, soru, nesil, kirli okuma, oturum kalır", () => {
    const { depo, yol, ib } = silmeKur();
    const tablolar = ["isler", "planlar", "sorular", "nesiller", "kirli_okumalar", "eren_oturumlari"];
    const once = tablolar.map((t) => say(yol, t));
    const kayitOnce = depo.sohbetGetir(B);
    depo.sohbetiSil(B, 4242);
    assert.deepEqual(
      tablolar.map((t) => say(yol, t)),
      once,
    );
    assert.deepEqual(depo.sohbetGetir(B), { ...kayitOnce, silinme_ms: 4242 });
    assert.ok(!depo.sohbetListesi().some((x) => x.sohbet_id === B_ID));
    assert.ok(depo.sohbetListesi(true).some((x) => x.sohbet_id === B_ID));
    assert.equal(depo.sohbetGetir(A)?.silinme_ms, null);
    assert.equal(depo.isGetir(ib)?.sohbet_id, B_ID);
    assert.equal(depo.planGetir("pb-bekleyen")?.durum, "bekliyor", "plan iptali çağıranın işi");
    assert.deepEqual(depo.kayitliOturumlar(B), ["oturum-b"]);
    assert.deepEqual(depo.kirliOkumalar(1, B), [ib]);
    assert.equal(depo.sonNesil(B)?.nesil, 2);
  });

  it("ana'da, olmayan sohbette ve ikinci silmede atar; atınca hiçbir şey silinmez, yayın yok", () => {
    const { depo, veriyolu } = silmeKur();
    const anlik = () => ({
      olaylar: depo.olaylariGetir(0, 100),
      bas: depo.basSeq(),
      tb: depo.turGetir("tb")?.kismi_metin,
      kuyrukB: depo.kuyrukBasi(B),
      kuyrukAna: depo.kuyrukBasi(ANA),
      liste: depo.sohbetListesi(true),
    });
    const once = anlik();
    const yayinOnce = veriyolu!.olaylar().length;
    assert.throws(() => depo.sohbetiSil(ANA, 1));
    assert.throws(() => depo.sohbetiSil({ sohbet_id: "yok" }, 1));
    assert.deepEqual(anlik(), once);
    assert.equal(veriyolu!.olaylar().length, yayinOnce);

    depo.sohbetiSil(B, 2);
    const sonra = anlik();
    const yayinSonra = veriyolu!.olaylar().length;
    assert.throws(() => depo.sohbetiSil(B, 3), "ikinci silme atar");
    assert.deepEqual(anlik(), sonra);
    assert.equal(depo.sohbetGetir(B)?.silinme_ms, 2, "ilk silme anı korunur");
    assert.equal(veriyolu!.olaylar().length, yayinSonra);
    assert.deepEqual(depo.sohbetGetir(ANA)?.silinme_ms, null);
  });

  it("işlem içinde sonra atan işlem geri alınır; chat_deleted yalnız en dıştaki commit'ten sonra yayınlanır", () => {
    const { depo, veriyolu } = silmeKur();
    const olaylarOnce = depo.olaylariGetir(0, 100);
    const yayinOnce = veriyolu!.olaylar().length;
    assert.throws(() =>
      depo.islem(() => {
        depo.sohbetiSil(B, 5);
        throw new Error("geri al");
      }),
    );
    assert.deepEqual(depo.olaylariGetir(0, 100), olaylarOnce);
    assert.equal(depo.sohbetGetir(B)?.silinme_ms, null);
    assert.equal(depo.turGetir("tb")?.kismi_metin, "B-KISMI");
    assert.equal(depo.kuyrukBasi(B)?.metin, "b kuyruk");
    assert.equal(veriyolu!.olaylar().length, yayinOnce);

    let icte = -1;
    const s = depo.islem(() => {
      const r = depo.sohbetiSil(B, 6);
      icte = veriyolu!.olaylar().length;
      return r;
    });
    assert.equal(icte, yayinOnce, "işlem bitmeden yayın yok");
    assert.deepEqual(veriyolu!.olaylar().slice(yayinOnce), [s.silindi]);
  });

  it("silinmiş sohbette sohbetAdiYaz atar; temizlik ve silme silinmiş kimliği ana'ya kaydırmaz", () => {
    const { depo } = silmeKur();
    depo.sohbetiSil(B, 7);
    assert.throws(() => depo.sohbetAdiYaz(B, "Olmaz"));
    assert.throws(() => sohbetAc(depo, B_ID, "Olmaz"));
    assert.ok(depo.olaylariGetir(0, 100).every((o) => o.type !== "chat_deleted" || o.sohbet_id === B_ID));
  });
});

describe("depo: walDaralt", () => {
  it("işlem içinde atar", () => {
    const { depo } = kur(yeniYol());
    assert.throws(() => depo.islem(() => depo.walDaralt()));
  });

  it("dışarıda atmaz ve WAL dosyası küçülür", () => {
    const yol = yeniYol();
    const { depo } = kur(yol);
    for (let i = 0; i < 200; i++) depo.olayEkle(kullaniciOlayi(i, "x".repeat(500)));
    const once = statSync(yol + "-wal").size;
    assert.ok(once > 0);
    depo.gecmisiTemizle(ANA);
    depo.walDaralt();
    assert.ok(statSync(yol + "-wal").size < once);
  });
});

describe("depo: ek göç 2 ve ana oturum kayıtları", () => {
  it("eren_oturumlari tablosu var ve STRICT; ek_surum 3", () => {
    const yol = yeniYol();
    const { depo } = kur(yol);
    assert.equal(depo.semaBilgisi().ek_surum, 3);
    depo.kapat();
    hamAc(yol, (h) => {
      const t = (h.prepare("PRAGMA table_list").all() as Array<{ name: string; strict: number }>).find(
        (x) => x.name === "eren_oturumlari",
      );
      assert.ok(t, "tablo yok");
      assert.equal(t.strict, 1);
    });
  });

  it("göç 2 iki kez açınca bozulmaz; kayıtlar korunur", () => {
    const yol = yeniYol();
    const a = kur(yol);
    a.depo.oturumKaydet("s-1", 10, ANA);
    a.depo.kapat();
    for (let i = 0; i < 2; i++) {
      const b = kur(yol);
      assert.equal(b.depo.semaBilgisi().ek_surum, 3);
      assert.deepEqual(b.depo.kayitliOturumlar(ANA), ["s-1"]);
      b.depo.kapat();
    }
  });

  it("yalnız ek göç 1 uygulanmış dosya açılınca göç 2 ve 3 uygulanır", () => {
    const yol = yeniYol();
    eskiSemaKur(yol, 1);
    const b = kur(yol);
    assert.deepEqual(b.depo.semaBilgisi(), { user_version: 1, ek_surum: 3 });
    b.depo.oturumKaydet("x", 1, ANA);
    assert.deepEqual(b.depo.kayitliOturumlar(ANA), ["x"]);
  });

  it("oturumKaydet idempotent; kayitliOturumlar oluşturma sırasıyla", () => {
    const { depo } = kur();
    assert.deepEqual(depo.kayitliOturumlar(ANA), []);
    depo.oturumKaydet("b", 10, ANA);
    depo.oturumKaydet("a", 20, ANA);
    depo.oturumKaydet("c", 30, ANA);
    depo.oturumKaydet("a", 40, ANA);
    depo.oturumKaydet("b", 10, ANA);
    assert.deepEqual(depo.kayitliOturumlar(ANA), ["b", "a", "c"]);
  });

  it("oturumKayitlariniSil yalnız verilenleri siler; boş ve olmayan atmaz", () => {
    const { depo } = kur();
    for (const [i, id] of ["a", "b", "c", "d"].entries()) depo.oturumKaydet(id, i, ANA);
    depo.oturumKayitlariniSil(["b", "d", "yok"]);
    assert.deepEqual(depo.kayitliOturumlar(ANA), ["a", "c"]);
    depo.oturumKayitlariniSil([]);
    assert.deepEqual(depo.kayitliOturumlar(ANA), ["a", "c"]);
  });

  it("gecmisiTemizle oturum kayıtlarına dokunmaz", () => {
    const { depo } = kur();
    depo.oturumKaydet("a", 1, ANA);
    depo.oturumKaydet("b", 2, ANA);
    depo.olayEkle(kullaniciOlayi(1));
    depo.gecmisiTemizle(ANA);
    assert.deepEqual(depo.kayitliOturumlar(ANA), ["a", "b"]);
  });

  it("dilim 2: oturum kayıtları sohbet başına; ikinci kayıt ilk sohbeti ve ts_ms'i korur", () => {
    const { depo } = kur();
    depo.oturumKaydet("a1", 10, A);
    depo.oturumKaydet("b1", 5, B);
    depo.oturumKaydet("a2", 20, A);
    depo.oturumKaydet("a1", 1, B);
    assert.deepEqual(depo.kayitliOturumlar(A), ["a1", "a2"]);
    assert.deepEqual(depo.kayitliOturumlar(B), ["b1"]);
    assert.deepEqual(depo.kayitliOturumlar(ANA), []);
    depo.oturumKayitlariniSil(["a1"]);
    assert.deepEqual(depo.kayitliOturumlar(A), ["a2"]);
    assert.deepEqual(depo.kayitliOturumlar(B), ["b1"]);
  });
});

// ---------------------------------------------------------------------------------------------
// Dilim 2: ek göç 3 (çoklu sohbet)
// ---------------------------------------------------------------------------------------------

describe("depo: ek göç 3 (dilim 2)", () => {
  it("göç 3 sütunları, varsayılanları ve dizinleri", () => {
    const yol = yeniYol();
    kur(yol).depo.kapat();
    hamAc(yol, (h) => {
      const sutun = (tablo: string) =>
        (h.prepare(`PRAGMA table_info(${tablo})`).all() as Array<{ name: string; notnull: number; dflt_value: unknown }>).find(
          (c) => c.name === "sohbet_id",
        );
      const anaVarsayilan = `'${ANA_SOHBET_ID}'`;
      for (const t of ["turns", "nesiller", "planlar", "isler", "eren_kuyrugu", "kirli_okumalar", "eren_oturumlari"]) {
        const c = sutun(t);
        assert.ok(c, `${t}.sohbet_id yok`);
        assert.equal(c.notnull, 1, `${t}.sohbet_id NOT NULL değil`);
        assert.equal(c.dflt_value, anaVarsayilan, `${t}.sohbet_id varsayılanı`);
      }
      const ev = sutun("events");
      assert.ok(ev);
      assert.equal(ev.notnull, 0, "events.sohbet_id NULL alabilmeli (küresel olay)");
      assert.equal(ev.dflt_value, anaVarsayilan);
      const jt = sutun("kopru_jetonlari");
      assert.ok(jt);
      assert.equal(jt.notnull, 0);
      assert.equal(jt.dflt_value, null);
      const dizinler = (h.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>).map(
        (d) => d.name,
      );
      for (const d of ["events_sohbet", "nesiller_sohbet", "eren_kuyrugu_sohbet", "events_tur"]) {
        assert.ok(dizinler.includes(d), `dizin yok: ${d}`);
      }
      const sohbetSutunlari = (h.prepare("PRAGMA table_info(sohbetler)").all() as Array<{ name: string }>).map((c) => c.name);
      assert.deepEqual(sohbetSutunlari, ["sohbet_id", "ad", "olusturma_ms", "son_etkinlik_ms", "silinme_ms"]);
    });
  });

  it("ek sürüm 2'deki dilim 1 dosyası: göç bir kez, user_version 1, ek_surum 3, bütün eski satırlar ana", () => {
    const yol = yeniYol();
    eskiSemaKur(yol, 2);
    const v = hamAc(yol, (h) => eskiVeriYaz(h, { ek: "", nesilTaban: 1, profil: true, oturum: true }));
    const { depo } = kur(yol);
    assert.deepEqual(depo.semaBilgisi(), { user_version: 1, ek_surum: 3 });

    // sohbetler: tek ana satırı, olayların en küçük/en büyük ts_ms'i
    const anaKayit: SohbetKaydi = {
      sohbet_id: ANA_SOHBET_ID,
      ad: ANA_SOHBET_ADI,
      olusturma_ms: 1500,
      son_etkinlik_ms: 9000,
      silinme_ms: null,
    };
    assert.deepEqual(depo.sohbetListesi(true), [anaKayit]);
    assert.deepEqual(depo.sohbetGetir(ANA), anaKayit);

    // olaylar: sütun ana, JSON alansız (eski kod), ikisi de ana okunur
    const olaylar = depo.olaylariGetir(0, 10);
    assert.deepEqual(
      olaylar.map((o) => o.seq),
      v.olaySeqleri,
    );
    for (const o of olaylar) {
      assert.ok(!("sohbet_id" in o), `eski olay gövdesine alan eklenmiş: ${o.type}`);
      assert.equal(sohbetAnahtari(o), ANA_SOHBET_ID);
    }
    assert.ok(olaySohbetleri(yol).every((r) => r.sutun === ANA_SOHBET_ID && r.json === null));
    assert.deepEqual(
      depo.sonKonusma(10, ANA).map((s) => s.metin),
      ["eski soru", "eski yanit"],
    );
    assert.equal(depo.sonMezarTasi(ANA)?.seq, v.olaySeqleri[3]);

    // turlar, nesiller
    assert.equal(depo.turGetir(v.turKapali)?.sohbet_id, ANA_SOHBET_ID);
    assert.equal(depo.turGetir(v.turKapali)?.kismi_metin, "ESKI-KISMI");
    assert.deepEqual(
      depo.acikTurlar(ANA).map((t) => [t.turn_id, t.sohbet_id]),
      [[v.turAcik, ANA_SOHBET_ID]],
    );
    assert.deepEqual(
      depo.nesiller(ANA).map((n) => [n.nesil, n.sohbet_id]),
      [
        [1, ANA_SOHBET_ID],
        [2, ANA_SOHBET_ID],
      ],
    );
    assert.deepEqual(depo.sonNesil(ANA), {
      nesil: 2,
      sohbet_id: ANA_SOHBET_ID,
      session_id: "44444444-4444-4444-8444-444444444442",
      baslangic_ms: 30,
      bitis_ms: null,
      ozet_kabul: null,
      pid: 77,
      olusturma_ms: 88,
      son_dolu: 0.5,
      pencere: 1000,
    });
    assert.equal(depo.enBuyukNesil(), 2);

    // plan, iş, soru
    const p = depo.planGetir(v.plan_id);
    assert.ok(p);
    assert.equal(p.sohbet_id, ANA_SOHBET_ID);
    assert.equal(p.profil, "hafif");
    assert.equal(planHash(p.plan), p.plan_hash);
    assert.deepEqual(
      depo.bekleyenPlanlar(ANA).map((x) => x.plan.plan_id),
      [v.plan_id],
    );
    assert.equal(depo.isGetir(v.is_id)?.sohbet_id, ANA_SOHBET_ID);
    assert.deepEqual(
      depo.isListele(false, 10, ANA).map((i) => i.is_id),
      [v.is_id],
    );
    assert.deepEqual(
      depo.bekleyenSorular(ANA).map((s) => s.soru_id),
      [v.soru_id],
    );

    // kuyruk, kirli okuma, oturum, jeton
    assert.deepEqual(depo.kuyrukBasi(ANA), {
      id: 1,
      sohbet_id: ANA_SOHBET_ID,
      kaynak: "insan",
      metin: v.kuyrukMetni,
      olusturma_ms: 10,
    });
    assert.deepEqual(depo.kirliOkumalar(1, ANA), [v.is_id]);
    assert.deepEqual(depo.kayitliOturumlar(ANA), [v.oturum]);
    assert.deepEqual(depo.jetonBul(v.jetonEren), {
      ozet: v.jetonEren,
      kapsam: { rol: "eren", sohbet_id: ANA_SOHBET_ID, nesil: 2 },
    });
    assert.deepEqual(depo.jetonBul(v.jetonSoru), { ozet: v.jetonSoru, kapsam: { rol: "soru", is_id: v.is_id } });

    // başka sohbet hiçbirini görmez
    assert.deepEqual(depo.acikTurlar(B), []);
    assert.equal(depo.sonNesil(B), null);
    assert.equal(depo.kuyrukBasi(B), null);
    assert.deepEqual(depo.sonKonusma(10, B), []);
    assert.equal(depo.sonMezarTasi(B), null);
    assert.deepEqual(depo.kayitliOturumlar(B), []);
    assert.deepEqual(depo.kirliOkumalar(1, B), []);
    assert.deepEqual(depo.bekleyenPlanlar(B), []);
    assert.deepEqual(depo.isListele(false, 10, B), []);
    assert.deepEqual(depo.bekleyenSorular(B), []);
  });

  it("olaysız dilim 1 dosyasında ana satırı 0/0", () => {
    const yol = yeniYol();
    eskiSemaKur(yol, 2);
    const { depo } = kur(yol);
    assert.deepEqual(depo.sohbetListesi(true), [
      { sohbet_id: ANA_SOHBET_ID, ad: ANA_SOHBET_ADI, olusturma_ms: 0, son_etkinlik_ms: 0, silinme_ms: null },
    ]);
  });

  it("ek sürüm 0'daki (sema_ek yok) dosya üç ek göçü sırayla alır; eski satırlar tam ve ana", () => {
    const yol = yeniYol();
    eskiSemaKur(yol, 0);
    const v = hamAc(yol, (h) => eskiVeriYaz(h, { ek: "", nesilTaban: 1, profil: false, oturum: false }));
    const { depo } = kur(yol);
    assert.deepEqual(depo.semaBilgisi(), { user_version: 1, ek_surum: 3 });
    const p = depo.planGetir(v.plan_id);
    assert.equal(p?.profil, "tam");
    assert.equal(p?.sohbet_id, ANA_SOHBET_ID);
    assert.equal(depo.sohbetGetir(ANA)?.olusturma_ms, 1500);
    assert.equal(depo.sohbetGetir(ANA)?.son_etkinlik_ms, 9000);
    assert.equal(depo.turGetir(v.turKapali)?.sohbet_id, ANA_SOHBET_ID);
  });

  it("ikinci açılış göçü yinelemez: ana'nın adı ve etkinliği korunur, sayaç ve ana satırı tek", () => {
    const yol = yeniYol();
    eskiSemaKur(yol, 2);
    hamAc(yol, (h) => eskiVeriYaz(h, { ek: "", nesilTaban: 1, profil: true, oturum: true }));
    const a = kur(yol);
    a.depo.sohbetAdiYaz(ANA, "Ana sohbet");
    a.depo.sohbetEtkinlikYaz(ANA, 20_000);
    a.depo.kapat();
    for (let i = 0; i < 2; i++) {
      const b = kur(yol);
      assert.deepEqual(b.depo.semaBilgisi(), { user_version: 1, ek_surum: 3 });
      assert.deepEqual(b.depo.sohbetGetir(ANA), {
        sohbet_id: ANA_SOHBET_ID,
        ad: "Ana sohbet",
        olusturma_ms: 1500,
        son_etkinlik_ms: 20_000,
        silinme_ms: null,
      });
      b.depo.kapat();
    }
    assert.equal(say(yol, "sohbetler"), 1);
    assert.equal(say(yol, "sema_ek"), 1);
  });

  it("sayacı elle geri sarılmış (ek_surum 2) göç 3'lü dosyada açılış atar (ADD COLUMN yinelenemez, bilinçli)", () => {
    const yol = yeniYol();
    kur(yol).depo.kapat();
    hamAc(yol, (h) => h.exec("UPDATE sema_ek SET deger = 2 WHERE anahtar = 'ek_surum'"));
    assert.throws(() => kur(yol));
  });

  it("açıkça NULL yazılan olay NULL kalır (yeni kodun küresel notu ve elle NULL); yeniden açılış dokunmaz", () => {
    const yol = yeniYol();
    const a = kur(yol);
    a.depo.olayEkle(kureselNot("servis"));
    a.depo.olayEkle({ ...kureselNot("b"), sohbet_id: B_ID });
    a.depo.kapat();
    hamAc(yol, (h) => {
      h.prepare("INSERT INTO events (ts_ms, type, veri, sohbet_id) VALUES (?, ?, ?, NULL)").run(
        1,
        "system_notice",
        JSON.stringify({ type: "system_notice", seviye: "bilgi", kod: "diger", metin: "elle" }),
      );
    });
    kur(yol).depo.kapat();
    kur(yol).depo.kapat();
    assert.deepEqual(
      olaySohbetleri(yol).map((r) => r.sutun),
      [null, B_ID, null],
    );
  });

  it("sohbet_id sütun adını yazmayan eski tarz INSERT'ler göçten sonra geçer ve satırlar ana okunur", () => {
    const yol = yeniYol();
    kur(yol).depo.kapat();
    const v = hamAc(yol, (h) => eskiVeriYaz(h, { ek: "-x", nesilTaban: 10, profil: true, oturum: true }));
    const { depo } = kur(yol);
    assert.ok(olaySohbetleri(yol).every((r) => r.sutun === ANA_SOHBET_ID));
    assert.equal(depo.turGetir(v.turKapali)?.sohbet_id, ANA_SOHBET_ID);
    assert.equal(depo.sonNesil(ANA)?.nesil, 11);
    assert.equal(depo.planGetir(v.plan_id)?.sohbet_id, ANA_SOHBET_ID);
    assert.equal(depo.isGetir(v.is_id)?.sohbet_id, ANA_SOHBET_ID);
    assert.equal(depo.kuyrukBasi(ANA)?.metin, v.kuyrukMetni);
    assert.deepEqual(depo.kirliOkumalar(1, ANA), [v.is_id]);
    assert.deepEqual(depo.kayitliOturumlar(ANA), [v.oturum]);
    assert.equal(depo.jetonBul(v.jetonEren)?.kapsam.rol, "eren");
    assert.deepEqual(depo.jetonBul(v.jetonEren)?.kapsam, { rol: "eren", sohbet_id: ANA_SOHBET_ID, nesil: 11 });
  });

  it("eski kod yeni şemayı açar: user_version 1, ek_surum eski kodun 2'sinden büyük; 13 INSERT geçer; yeniden yükseltmede satırlar ana", () => {
    const yol = yeniYol();
    const a = kur(yol);
    sohbetAc(a.depo, B_ID, "İkinci");
    a.depo.nesilEkle(nesilKaydi(5, B_ID));
    a.depo.olayEkle(kullaniciOlayi(1, "b mesajı", B_ID));
    a.depo.kuyrugaEkle("insan", "b kuyruk", 1, B);
    a.depo.kapat();

    const v = hamAc(yol, (h) => {
      // Dilim 1 kodunun açılış denetimi: yalnız `user_version > 1` atar; `ek_surum > 2` "daha yeni
      // sürüm göç ettirmiş" dalıdır, açılış sürer.
      assert.equal((h.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 1);
      const ek = (h.prepare("SELECT deger FROM sema_ek WHERE anahtar = 'ek_surum'").get() as { deger: number }).deger;
      assert.ok(ek > DILIM1_EK_GOCLER.length, `ek_surum ${ek}`);
      const yazilan = eskiVeriYaz(h, { ek: "-geri", nesilTaban: 20, profil: true, oturum: true });
      // Acil durum kipi: eski kodun `sonNesil`'i bütün sohbetlerin en büyük neslini görür.
      const son = h.prepare("SELECT * FROM nesiller ORDER BY nesil DESC LIMIT 1").get() as { nesil: number };
      assert.equal(son.nesil, 21);
      // Eski kodun okumaları yeni sütunlarla atmaz.
      for (const t of ["events", "turns", "nesiller", "planlar", "isler", "eren_kuyrugu", "kopru_jetonlari", "kirli_okumalar"]) {
        h.prepare(`SELECT * FROM ${t}`).all();
      }
      return yazilan;
    });

    const b = kur(yol);
    assert.deepEqual(b.depo.semaBilgisi(), { user_version: 1, ek_surum: 3 });
    // eski kodun yazdıkları ana'nın
    assert.equal(b.depo.turGetir(v.turKapali)?.sohbet_id, ANA_SOHBET_ID);
    assert.deepEqual(
      b.depo.nesiller(ANA).map((n) => n.nesil),
      [20, 21],
    );
    assert.equal(b.depo.planGetir(v.plan_id)?.sohbet_id, ANA_SOHBET_ID);
    assert.equal(b.depo.isGetir(v.is_id)?.sohbet_id, ANA_SOHBET_ID);
    assert.deepEqual(
      b.depo.bekleyenSorular(ANA).map((s) => s.soru_id),
      [v.soru_id],
    );
    assert.equal(b.depo.kuyrukBasi(ANA)?.metin, v.kuyrukMetni);
    assert.deepEqual(b.depo.kirliOkumalar(1, ANA), [v.is_id]);
    assert.deepEqual(b.depo.kayitliOturumlar(ANA), [v.oturum]);
    assert.deepEqual(b.depo.jetonBul(v.jetonEren)?.kapsam, { rol: "eren", sohbet_id: ANA_SOHBET_ID, nesil: 21 });
    assert.deepEqual(b.depo.ackBul("d-geri", "m-geri"), { ok: true, seq: 1 });
    assert.equal(b.depo.cihazGetir(v.device_id)?.device_id, v.device_id);
    assert.equal(b.depo.eslestirmeOku()?.kod_ozeti, "oz-geri");
    assert.equal(b.depo.isPidleri(v.is_id).length, 1);
    for (const r of olaySohbetleri(yol)) {
      if (v.olaySeqleri.includes(r.seq)) assert.equal(r.sutun, ANA_SOHBET_ID, `olay ${r.seq}`);
    }
    // B'nin yeni kodla yazılmış satırları bozulmadı
    assert.equal(b.depo.sonNesil(B)?.nesil, 5);
    assert.equal(b.depo.kuyrukBasi(B)?.metin, "b kuyruk");
    assert.deepEqual(
      b.depo.sonKonusma(10, B).map((s) => s.metin),
      ["b mesajı"],
    );
    assert.equal(b.depo.sohbetGetir(B)?.ad, "İkinci");
    assert.equal(say(yol, "sohbetler"), 2);
    assert.equal(b.depo.enBuyukNesil(), 21);
  });
});

describe("depo: silinen içerik dosyada kalmaz (secure_delete + walDaralt)", () => {
  const KANARYA = "KANARYA-GIZLI-7Q9Z";
  const sayKanarya = (yol: string): number => {
    let n = 0;
    for (const d of [yol, yol + "-wal"]) {
      if (!existsSync(d)) continue;
      const tampon = readFileSync(d);
      let i = tampon.indexOf(KANARYA);
      while (i >= 0) {
        n++;
        i = tampon.indexOf(KANARYA, i + 1);
      }
    }
    return n;
  };

  it("gecmisiTemizle + walDaralt sonrası eren.db ve -wal dosyalarında kanarya yok", () => {
    const yol = yeniYol();
    kur(yol).depo.kapat(); // şema
    // secure_delete kapalı ham bağlantı: silinen içerik sayfada kalır.
    hamAc(yol, (h) => {
      h.exec("PRAGMA journal_mode=WAL");
      h.exec("PRAGMA secure_delete=OFF");
      const veri = JSON.stringify({ type: "user_echo", client_msg_id: "k1", input: "yazi", text: KANARYA });
      h.prepare("INSERT INTO events (ts_ms, type, veri) VALUES (?, ?, ?)").run(1, "user_echo", veri);
      h.prepare("INSERT INTO eren_kuyrugu (kaynak, metin, olusturma_ms) VALUES (?, ?, ?)").run("insan", KANARYA, 1);
      h.prepare("INSERT INTO eren_kuyrugu (kaynak, metin, olusturma_ms) VALUES (?, ?, ?)").run("sentetik", KANARYA, 2);
      h.exec("DELETE FROM eren_kuyrugu WHERE kaynak='insan'");
    });
    assert.ok(sayKanarya(yol) > 0, "ön koşul: kanarya dosyada olmalı");

    const { depo } = kur(yol);
    depo.gecmisiTemizle(ANA);
    depo.walDaralt();
    assert.equal(sayKanarya(yol), 0, "açıkken");
    depo.kapat();
    assert.equal(sayKanarya(yol), 0, "kapandıktan sonra");
  });

  it("dilim 2: sohbetiSil + walDaralt sonrası silinen sohbetin içeriği dosyada yok", () => {
    const yol = yeniYol();
    const { depo } = kur(yol);
    sohbetAc(depo, B_ID, "B");
    depo.olayEkle(kullaniciOlayi(1, KANARYA, B_ID));
    depo.kuyrugaEkle("insan", KANARYA, 1, B);
    depo.nesilEkle(nesilKaydi(1, B_ID));
    depo.turEkle(turKaydi("tb", { sohbet_id: B_ID }));
    depo.turBitir("tb", "tamam", KANARYA, 2);
    assert.ok(sayKanarya(yol) > 0, "ön koşul");
    depo.sohbetiSil(B, 3);
    depo.walDaralt();
    assert.equal(sayKanarya(yol), 0);
  });
});

// ---------------------------------------------------------------------------------------------
// Asistan adı: `ana` sohbetinin ilk adı (`DepoBagimliliklari.anaSohbetAdi`, servis: `Ayar.asistanAdi`)
// ---------------------------------------------------------------------------------------------

describe("depo: ana sohbetin ilk adı asistan adından", () => {
  const adlaKur = (yol: string, anaSohbetAdi?: string): Depo => {
    const zaman = sahteZaman();
    return kapaniyor(
      depoKur({ yol, saat: zaman.saat, gunluk: sahteGunluk(), ...(anaSohbetAdi === undefined ? {} : { anaSohbetAdi }) }),
    );
  };

  it("ad verilmezse nötr varsayılan Claude; verilirse yeni dosyada o ad", () => {
    assert.equal(adlaKur(":memory:").sohbetGetir(ANA)?.ad, "Claude");
    assert.equal(adlaKur(":memory:", "Nova Yardımcı").sohbetGetir(ANA)?.ad, "Nova Yardımcı");
  });

  it("dilim 1 dosyasının göçü (ana YENİ oluşur) adı asistan adından alır", () => {
    const yol = yeniYol();
    eskiSemaKur(yol, 2);
    const depo = adlaKur(yol, "Örnek Asistan");
    assert.deepEqual(depo.semaBilgisi(), { user_version: 1, ek_surum: 3 });
    assert.equal(depo.sohbetGetir(ANA)?.ad, "Örnek Asistan");
  });

  it("mevcut veritabanındaki ad yeniden adlandırılmaz (başka adla yeniden açılış, eski kurulum)", () => {
    const yol = yeniYol();
    const ilk = adlaKur(yol, "Eski Ad");
    assert.equal(ilk.sohbetGetir(ANA)?.ad, "Eski Ad");
    ilk.kapat();
    const ikinci = adlaKur(yol, "Nova");
    assert.equal(ikinci.sohbetGetir(ANA)?.ad, "Eski Ad");
    assert.equal(ikinci.sohbetListesi().length, 1);
  });

  it("kablodaki sohbet adı kuralına uymayan ad (60 UTF-16 biriminden uzun) nötr varsayılana düşer", () => {
    assert.equal(adlaKur(":memory:", "\u{1F600}".repeat(40)).sohbetGetir(ANA)?.ad, "Claude");
  });

  it("tek tırnaklı ad göç metnini bozmaz", () => {
    assert.equal(adlaKur(":memory:", "O'Neil").sohbetGetir(ANA)?.ad, "O'Neil");
  });
});
