import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { BildirimBagimliliklari, TelegramAyari, ServisOlaylari } from "../src/sozlesme.ts";
import { bildirimKur } from "../src/bildirim.ts";
import { veriyoluKur } from "../src/veriyolu.ts";
import { sahteGunluk, sahteHttp, sahteZaman } from "./sahte.ts";

const ACK_MS = 30_000;
const JETON = "123456:ORNEK-JETON-gizli";
const SOHBET = "-1001234567890";
const URL_BEKLENEN = `https://api.telegram.org/bot${JETON}/sendMessage`;
const TUZAK = "TUZAK-GIZLI-ICERIK";

type OlayVerisi = ServisOlaylari["olay_yazildi"]["olay"];

const bosalt = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await new Promise<void>((r) => setImmediate(r));
};

interface BildirGirdisi {
  tur: string;
  baslik: string;
  metin: string;
}

interface KurSecenek {
  telegram?: TelegramAyari | null;
  /** `bildir` bu dizinin sırasıyla döner; bitince `null`. */
  bildirSonuclari?: Array<string | null>;
  onayli?: boolean;
  asistanAdi?: string;
}

const kur = (sec: KurSecenek = {}) => {
  const zaman = sahteZaman();
  const http = sahteHttp();
  const gunluk = sahteGunluk();
  const veriyolu = veriyoluKur({ gunluk });
  const bildirimler: BildirGirdisi[] = [];
  const sorgular: string[] = [];
  const sonuclar = [...(sec.bildirSonuclari ?? ["n1"])];
  let onayli = sec.onayli ?? false;
  const telegram = sec.telegram === undefined ? { jeton: JETON, sohbetId: SOHBET } : sec.telegram;
  const b = {
    ayar: {
      telegram: async () => telegram,
      sureler: { bildirimAckMs: ACK_MS },
      asistanAdi: sec.asistanAdi ?? "Claude",
    },
    cihaz: {
      bildir: (g: BildirGirdisi) => {
        bildirimler.push(g);
        return sonuclar.length > 0 ? sonuclar.shift()! : null;
      },
      bildirimOnaylandiMi: (id: string) => {
        sorgular.push(id);
        return onayli;
      },
    },
    http,
    zamanlayici: zaman.zamanlayici,
    veriyolu,
    gunluk,
  } as unknown as BildirimBagimliliklari;
  const bildirim = bildirimKur(b);
  let seq = 0;
  const yayinla = (olay: Record<string, unknown>): void => {
    seq++;
    veriyolu.yayinla("olay_yazildi", { olay: { seq, ts_ms: zaman.simdi(), ...olay } as unknown as OlayVerisi });
  };
  return {
    zaman,
    http,
    gunluk,
    veriyolu,
    bildirim,
    bildirimler,
    sorgular,
    yayinla,
    onayla: () => {
      onayli = true;
    },
  };
};

const PLAN_TUZAK = {
  plan_id: "pln1",
  baslik: `${TUZAK}-plan-baslik`,
  gorev: `${TUZAK}-gorev-metni kod: rm -rf`,
  maddeler: [`${TUZAK}-madde`],
  cwd: `C:\\ornek\\${TUZAK}`,
};

const planOlayi = () => ({ type: "plan_proposed", plan: PLAN_TUZAK, plan_hash: "a".repeat(64) });
const soruOlayi = (is_id = 7) => ({
  type: "question_asked",
  soru_id: "soru1",
  is_id,
  soru: `${TUZAK}-soru-metni?`,
  secenekler: [`${TUZAK}-secenek-a`, `${TUZAK}-secenek-b`],
});
const bitisOlayi = (is_id = 7, durum = "tamam") => ({
  type: "job_finished",
  is_id,
  durum,
  kirli: true,
  rapor: {
    yapildi: [`${TUZAK}-yapildi`],
    yapilmadi: [`${TUZAK}-yapilmadi`],
    dosyalar: [`C:\\ornek\\${TUZAK}.txt`],
    acik_noktalar: [`${TUZAK}-acik`],
  },
});
const sistemOlayi = (kod: string, seviye = "kritik") => ({
  type: "system_notice",
  seviye,
  kod,
  metin: `${TUZAK}-sistem-metni`,
});

const KODLAR = [
  "ram_dusuk",
  "limit_kilit_aktif",
  "limit_kilit_bitti",
  "eren_yeniden_basladi",
  "servis_yeniden_basladi",
  "is_uzlastirildi",
  "diger",
];

/** Dışarı çıkan her şeyi tek metne toplar: cihaza giden, HTTP gövdesi ve günlük. */
const disariCikanlar = (d: ReturnType<typeof kur>): string =>
  JSON.stringify({ b: d.bildirimler, h: d.http.istekler.map((i) => i.govde), g: d.gunluk.girdiler });

describe("bildirim: eşleme", () => {
  it("plan_proposed: plan / Onay bekliyor / Yeni plan var.", () => {
    const d = kur();
    d.bildirim.baslat();
    d.yayinla(planOlayi());
    assert.deepEqual(d.bildirimler, [{ tur: "plan", baslik: "Onay bekliyor", metin: "Yeni plan var." }]);
  });

  it("question_asked: soru / Soru var / İş N cevap bekliyor.", () => {
    const d = kur();
    d.bildirim.baslat();
    d.yayinla(soruOlayi(7));
    assert.deepEqual(d.bildirimler, [{ tur: "soru", baslik: "Soru var", metin: "İş 7 cevap bekliyor." }]);
  });

  it("job_finished: is_bitti / İş bitti / İş N: tamam. (durum kapalı listeden, rapor yok)", () => {
    const d = kur({ bildirSonuclari: ["a", "b", "c"] });
    d.bildirim.baslat();
    d.yayinla(bitisOlayi(7, "tamam"));
    d.yayinla(bitisOlayi(12, "hata"));
    d.yayinla(bitisOlayi(3, "iptal"));
    assert.deepEqual(d.bildirimler[0], { tur: "is_bitti", baslik: "İş bitti", metin: "İş 7: tamam." });
    // Tablo yalnız tamam örneğini verir; diğer durumlar kapalı liste değeri olarak aynı kalıba girebilir.
    assert.match(d.bildirimler[1]!.metin, /^İş 12: (tamam|hata)\.$/);
    assert.match(d.bildirimler[2]!.metin, /^İş 3: (tamam|iptal)\.$/);
    for (const g of d.bildirimler) {
      assert.equal(g.tur, "is_bitti");
      assert.equal(g.baslik, "İş bitti");
    }
  });

  it("system_notice uyari ve kritik: sistem / Sistem / sabit metin; diger için Uygulamaya bak.", () => {
    for (const seviye of ["uyari", "kritik"]) {
      for (const kod of KODLAR) {
        const d = kur();
        d.bildirim.baslat();
        d.yayinla(sistemOlayi(kod, seviye));
        assert.equal(d.bildirimler.length, 1, `${seviye}/${kod}`);
        const g = d.bildirimler[0]!;
        assert.equal(g.tur, "sistem");
        assert.equal(g.baslik, "Sistem");
        assert.ok(g.metin.length > 0, `${kod}: metin boş`);
        assert.ok(!g.metin.includes(TUZAK), `${kod}: olay metni sızdı`);
        if (kod === "diger") assert.equal(g.metin, "Uygulamaya bak.");
      }
    }
  });

  it("eren_yeniden_basladi metni asistan adını ayardan alır (varsayılan Claude, sabit kişilik adı yok)", () => {
    for (const [asistanAdi, beklenen] of [
      [undefined, "Claude yeniden başladı."],
      ["Örnek Asistan", "Örnek Asistan yeniden başladı."],
    ] as const) {
      const d = kur(asistanAdi === undefined ? {} : { asistanAdi });
      d.bildirim.baslat();
      d.yayinla(sistemOlayi("eren_yeniden_basladi", "uyari"));
      assert.deepEqual(d.bildirimler, [{ tur: "sistem", baslik: "Sistem", metin: beklenen }]);
    }
  });

  it("system_notice bilgi: bildirim yok", async () => {
    const d = kur();
    d.bildirim.baslat();
    d.yayinla(sistemOlayi("ram_dusuk", "bilgi"));
    d.zaman.ilerlet(ACK_MS * 2);
    await bosalt();
    assert.equal(d.bildirimler.length, 0);
    assert.equal(d.http.istekler.length, 0);
  });

  it("diğer olay türleri bildirim üretmez", async () => {
    const d = kur();
    d.bildirim.baslat();
    d.yayinla({ type: "user_echo", client_msg_id: "m1", input: "metin", text: TUZAK });
    d.yayinla({ type: "assistant_message", turn_id: "t1", text: TUZAK });
    d.yayinla({ type: "plan_resolved", plan_id: "pln1", plan_hash: "a".repeat(64), sonuc: "onaylandi" });
    d.yayinla({ type: "question_resolved", soru_id: "s1", is_id: 7, sonuc: "cevaplandi", cevap: TUZAK });
    d.yayinla({ type: "job_started", is_id: 7, plan_id: "pln1", plan_hash: "a".repeat(64), baslik: TUZAK, tur: "yazma" });
    d.zaman.ilerlet(ACK_MS * 2);
    await bosalt();
    assert.equal(d.bildirimler.length, 0);
    assert.equal(d.http.istekler.length, 0);
  });
});

describe("bildirim: sohbet yaşam döngüsü", () => {
  const AD = "GIZLI-SOHBET-ADI-TUZAK";
  const yasamOlaylari = () => [
    { type: "chat_created", sohbet_id: "s_yeni", ad: AD },
    { type: "chat_renamed", sohbet_id: "s_yeni", ad: AD },
    { type: "chat_deleted", sohbet_id: "s_yeni" },
  ];

  it("chat_created/renamed/deleted ve sohbet_listesi_degisti bildirim üretmez (cihaz, Telegram, günlük)", async () => {
    const d = kur({ bildirSonuclari: [null, null, null, null, null] });
    d.bildirim.baslat();
    for (const o of yasamOlaylari()) d.yayinla(o);
    d.veriyolu.yayinla("sohbet_listesi_degisti", { sohbet_id: "s_yeni", olay: "olusturuldu" });
    d.veriyolu.yayinla("sohbet_listesi_degisti", { sohbet_id: "s_yeni", olay: "silindi" });
    d.zaman.ilerlet(ACK_MS * 2);
    await bosalt();
    assert.equal(d.bildirimler.length, 0);
    assert.equal(d.http.istekler.length, 0);
    assert.ok(!disariCikanlar(d).includes(AD), "sohbet adı dışarı çıktı");
  });

  it("sohbet adı hiçbir bildirim metnine girmez: yaşam döngüsü olayları arasındaki gerçek bildirimlerde de", async () => {
    const d = kur({ bildirSonuclari: [null, null, null, null] });
    d.bildirim.baslat();
    d.yayinla(yasamOlaylari()[0]!);
    d.yayinla(planOlayi());
    d.yayinla({ ...yasamOlaylari()[1]!, sohbet_id: "ana" });
    d.yayinla(soruOlayi(4));
    d.yayinla(yasamOlaylari()[2]!);
    await bosalt();
    assert.deepEqual(
      d.bildirimler.map((b) => b.metin),
      ["Yeni plan var.", "İş 4 cevap bekliyor."],
    );
    assert.equal(d.http.istekler.length, 2);
    assert.ok(!disariCikanlar(d).includes(AD), "sohbet adı sızdı");
    assert.ok(!disariCikanlar(d).includes("s_yeni"), "sohbet kimliği sızdı");
  });
});

describe("bildirim: içerik sızmaması", () => {
  it("tuzak metinli plan, soru, rapor ve sistem notu hiçbir yerden çıkmaz (cihaz, Telegram, günlük)", async () => {
    // bildir null: her olay yedeğe düşer, yani hem cihaz hem Telegram yolu taranır.
    const d = kur({ bildirSonuclari: [] });
    d.bildirim.baslat();
    d.yayinla(planOlayi());
    d.yayinla(soruOlayi());
    d.yayinla(bitisOlayi());
    d.yayinla(sistemOlayi("diger"));
    d.yayinla(sistemOlayi("ram_dusuk", "uyari"));
    await bosalt();
    assert.equal(d.http.istekler.length, 5);
    assert.equal(d.bildirimler.length, 5);
    const hepsi = disariCikanlar(d);
    assert.ok(!hepsi.includes(TUZAK), "tuzak metin dışarı çıktı");
    for (const parca of ["rm -rf", "pln1", "soru1", "a".repeat(64)]) {
      assert.ok(!hepsi.includes(parca), `${parca} sızdı`);
    }
  });

  it("Telegram gövdesi yalnız {chat_id,text}; metin sabit nottan kurulur", async () => {
    const d = kur({ bildirSonuclari: [null, null, null] });
    d.bildirim.baslat();
    d.yayinla(planOlayi());
    d.yayinla(soruOlayi(7));
    d.yayinla(bitisOlayi(7));
    await bosalt();
    assert.equal(d.http.istekler.length, 3);
    const sabit = ["Yeni plan var.", "İş 7 cevap bekliyor.", "İş 7: tamam."];
    d.http.istekler.forEach((i, n) => {
      const govde = i.govde as Record<string, unknown>;
      assert.deepEqual(Object.keys(govde).sort(), ["chat_id", "text"]);
      assert.equal(govde["chat_id"], SOHBET);
      assert.equal(typeof govde["text"], "string");
      assert.ok((govde["text"] as string).includes(sabit[n]!), `metin ${sabit[n]} içermiyor`);
    });
  });
});

describe("bildirim: yedeğe düşme", () => {
  it("bildir null: hemen Telegram'a gider, doğru URL ve gövdeyle", async () => {
    const d = kur({ bildirSonuclari: [null] });
    d.bildirim.baslat();
    d.yayinla(planOlayi());
    await bosalt();
    assert.equal(d.http.istekler.length, 1);
    assert.equal(d.http.istekler[0]!.url, URL_BEKLENEN);
    assert.equal((d.http.istekler[0]!.govde as { chat_id: string }).chat_id, SOHBET);
    assert.equal(d.sorgular.length, 0, "null ise onay sorulmaz");
  });

  it("bildir kimlik verdi, ack süresi içinde gelmedi: süre dolunca Telegram", async () => {
    const d = kur({ bildirSonuclari: ["n1"] });
    d.bildirim.baslat();
    d.yayinla(planOlayi());
    await bosalt();
    d.zaman.ilerlet(ACK_MS - 1);
    await bosalt();
    assert.equal(d.http.istekler.length, 0, "süre dolmadan yedek gitmemeli");
    d.zaman.ilerlet(1);
    await bosalt();
    assert.equal(d.http.istekler.length, 1);
    assert.equal(d.http.istekler[0]!.url, URL_BEKLENEN);
    assert.deepEqual(d.sorgular, ["n1"]);
  });

  it("notify_ack geldi: Telegram'a gitmez", async () => {
    const d = kur({ bildirSonuclari: ["n1"] });
    d.bildirim.baslat();
    d.yayinla(planOlayi());
    await bosalt();
    d.onayla();
    d.zaman.ilerlet(ACK_MS * 3);
    await bosalt();
    assert.equal(d.http.istekler.length, 0);
    assert.equal(d.bildirimler.length, 1);
  });

  it("her bildirim kendi kimliğiyle sorgulanır", async () => {
    const d = kur({ bildirSonuclari: ["n1", "n2"] });
    d.bildirim.baslat();
    d.yayinla(planOlayi());
    d.yayinla(soruOlayi());
    await bosalt();
    d.zaman.ilerlet(ACK_MS);
    await bosalt();
    assert.deepEqual([...d.sorgular].sort(), ["n1", "n2"]);
    assert.equal(d.http.istekler.length, 2);
  });

  it("kapat: bekleyen ack zamanlayıcısı iptal olur, sonradan Telegram gitmez", async () => {
    const d = kur({ bildirSonuclari: ["n1"] });
    d.bildirim.baslat();
    d.yayinla(planOlayi());
    await bosalt();
    d.bildirim.kapat();
    d.zaman.ilerlet(ACK_MS * 2);
    await bosalt();
    assert.equal(d.http.istekler.length, 0);
  });

  it("kapat sonrası olay bildirim üretmez", async () => {
    const d = kur({ bildirSonuclari: [null, null] });
    d.bildirim.baslat();
    d.bildirim.kapat();
    d.yayinla(planOlayi());
    await bosalt();
    assert.equal(d.bildirimler.length, 0);
    assert.equal(d.http.istekler.length, 0);
  });
});

describe("bildirim: Telegram ayarı yok", () => {
  it("ayar null: HTTP yok, günlüğe yazılır, atmaz", async () => {
    const d = kur({ telegram: null, bildirSonuclari: [null] });
    d.bildirim.baslat();
    d.yayinla(planOlayi());
    await bosalt();
    assert.equal(d.http.istekler.length, 0);
    assert.ok(d.gunluk.girdiler.length >= 1, "günlük notu beklenir");
    assert.ok(!disariCikanlar(d).includes(TUZAK));
  });

  it("ayar null ve ack gelmedi: süre dolunca yine HTTP yok", async () => {
    const d = kur({ telegram: null, bildirSonuclari: ["n1"] });
    d.bildirim.baslat();
    d.yayinla(planOlayi());
    await bosalt();
    d.zaman.ilerlet(ACK_MS);
    await bosalt();
    assert.equal(d.http.istekler.length, 0);
    assert.ok(d.gunluk.girdiler.length >= 1);
  });
});

describe("bildirim: HTTP hatası", () => {
  it("ağ hatası atmaz, yeniden denemez", async () => {
    const d = kur({ bildirSonuclari: [null] });
    d.http.hataVer(new Error(`ECONNRESET ${URL_BEKLENEN}`));
    d.bildirim.baslat();
    assert.doesNotThrow(() => d.yayinla(planOlayi()));
    await bosalt();
    d.zaman.ilerlet(ACK_MS * 10);
    await bosalt();
    assert.equal(d.http.istekler.length, 1, "yeniden deneme yok");
  });

  it("4xx/5xx durumu atmaz, yeniden denemez", async () => {
    for (const durum of [400, 401, 429, 500]) {
      const d = kur({ bildirSonuclari: [null] });
      d.http.durumKuyruga(durum);
      d.bildirim.baslat();
      assert.doesNotThrow(() => d.yayinla(planOlayi()));
      await bosalt();
      d.zaman.ilerlet(ACK_MS * 10);
      await bosalt();
      assert.equal(d.http.istekler.length, 1, `durum ${durum}`);
    }
  });

  it("hata sonrası sonraki olay yine işlenir", async () => {
    const d = kur({ bildirSonuclari: [null, null] });
    d.http.hataVer(new Error("ag"));
    d.bildirim.baslat();
    d.yayinla(planOlayi());
    await bosalt();
    d.yayinla(soruOlayi());
    await bosalt();
    assert.equal(d.http.istekler.length, 2);
  });

  it("atan ağ hatasının metni ve URL günlüğe girmez", async () => {
    const d = kur({ bildirSonuclari: [null] });
    d.http.hataVer(new Error(`fetch failed ${URL_BEKLENEN}`));
    d.bildirim.baslat();
    d.yayinla(planOlayi());
    await bosalt();
    const g = JSON.stringify(d.gunluk.girdiler);
    assert.ok(!g.includes(JETON), "jeton günlükte");
    assert.ok(!g.includes("api.telegram.org"), "URL günlükte");
  });
});

describe("bildirim: günlük gizliliği", () => {
  it("başarılı gönderimde de jeton ve URL günlükte yok", async () => {
    const d = kur({ bildirSonuclari: [null, "n2"] });
    d.bildirim.baslat();
    d.yayinla(planOlayi());
    d.yayinla(soruOlayi());
    await bosalt();
    d.zaman.ilerlet(ACK_MS);
    await bosalt();
    assert.ok(d.http.istekler.length >= 1);
    const g = JSON.stringify(d.gunluk.girdiler);
    assert.ok(!g.includes(JETON), "jeton günlükte");
    assert.ok(!g.includes("bot123456"), "jeton parçası günlükte");
    assert.ok(!g.includes("api.telegram.org"), "URL günlükte");
  });

  it("ayar yokken de günlükte jeton ve URL yok", async () => {
    const d = kur({ telegram: null, bildirSonuclari: [null] });
    d.bildirim.baslat();
    d.yayinla(planOlayi());
    await bosalt();
    const g = JSON.stringify(d.gunluk.girdiler);
    assert.ok(!g.includes("api.telegram.org"));
    assert.ok(!g.includes(JETON));
  });
});

describe("bildirim: yalnız canlı yayın", () => {
  it("baslat'tan önce yayınlanan eski olaylar için bildirim yok", async () => {
    const d = kur({ bildirSonuclari: [null, null] });
    d.yayinla(planOlayi());
    d.yayinla(bitisOlayi());
    d.bildirim.baslat();
    await bosalt();
    d.zaman.ilerlet(ACK_MS * 2);
    await bosalt();
    assert.equal(d.bildirimler.length, 0);
    assert.equal(d.http.istekler.length, 0);
  });

  it("baslat'tan sonraki olay işlenir; baslat öncesi olaylar tekrar edilmez", async () => {
    const d = kur({ bildirSonuclari: ["n1"] });
    d.yayinla(planOlayi());
    d.bildirim.baslat();
    d.yayinla(soruOlayi(9));
    assert.deepEqual(d.bildirimler, [{ tur: "soru", baslik: "Soru var", metin: "İş 9 cevap bekliyor." }]);
  });
});

describe("bildirim: kaynak taraması", () => {
  const kaynak = (): string | null => {
    try {
      return readFileSync(new URL("../src/bildirim.ts", import.meta.url), "utf8");
    } catch {
      return null;
    }
  };

  it("getUpdates ve webhook kaynakta yok (Telegram'dan girdi alınmaz)", () => {
    const k = kaynak();
    assert.ok(k !== null, "src/bildirim.ts okunamadı");
    assert.ok(!/getupdates/i.test(k), "getUpdates bulundu");
    assert.ok(!/webhook/i.test(k), "webhook bulundu");
  });

  it("kaynakta yalnız sendMessage ucu var", () => {
    const k = kaynak();
    assert.ok(k !== null, "src/bildirim.ts okunamadı");
    assert.ok(k.includes("sendMessage"));
    const uclar = [...k.matchAll(/\/bot[^/\s"'`]*\/([A-Za-z]+)/g)].map((m) => m[1]);
    for (const u of uclar) assert.equal(u, "sendMessage");
  });
});
