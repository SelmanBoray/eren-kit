/**
 * Sesli cevabın çekirdeğe bağlanışı (bütünleşme): gerçek `cekirdekKur`, sahte WebSocket ve sahte ses
 * portu. Karar ve okuma birimleri ayrı sınanır; burada çekirdeğin çerçeveleri doğru yere ilettiği ve
 * ses portuna ne söylendiği gözlenir.
 *
 * Sözleşme: servis görünür her turun başında `assistant_activity` yollar; tur bir insan mesajıyla
 * başladıysa çerçeve `kaynak_msg_id` taşır. `assistant_message` gelen turun `kaynak_msg_id`'si
 * bildirilmişse ve o mesaj bu çalışmada `dikte`/`kisayol` ile gönderildiyse cevap bir kez okunur;
 * başka hiçbir durumda okunmaz (etkinlik çerçevesi gelmeyen eski serviste de).
 *
 * Tur yardımcıları servisin gerçek sırasını üretir: `server_status{tur_suruyor}` →
 * `assistant_activity{kaynak_msg_id}` → `user_echo` → `ack` → ara etkinlik → `assistant_message` →
 * `assistant_activity_end` → `server_status{hazir}`.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cekirdekKur } from "../../src/cekirdek/index.ts";
import type { CekirdekDurumu, SesPortu } from "../../src/cekirdek/index.ts";
import {
  ack,
  asistanOlayi,
  bosalt,
  elSikis,
  olayCercevesi,
  SahteDepo,
  SahteKimlik,
  SahteSaat,
  SahteWs,
  snapshot,
  sunucuDurumu,
  v,
  yankiOlayi,
} from "./sahte.ts";
import type { SahteBaglanti } from "./sahte.ts";

/** Ses portunun sahtesi: çağrıları kaydeder, `durumDinle` dinleyicisini elde tutar. */
class SahteSes implements SesPortu {
  seslendirilenler: string[] = [];
  durdurSayisi = 0;
  /** `true`: `seslendir` reddeder. */
  reddet = false;
  dinleyici: ((konusuyor: boolean) => void) | null = null;
  seslendir(metin: string): Promise<boolean> {
    this.seslendirilenler.push(metin);
    if (this.reddet) return Promise.reject(new Error("ses"));
    return Promise.resolve(true);
  }
  durdur(): Promise<void> {
    this.durdurSayisi++;
    return Promise.resolve();
  }
  durumDinle(f: (konusuyor: boolean) => void): () => void {
    this.dinleyici = f;
    return () => {
      if (this.dinleyici === f) this.dinleyici = null;
    };
  }
  /** Port "okuma sürüyor/bitti" bildirir. */
  bildir(konusuyor: boolean): void {
    assert.ok(this.dinleyici !== null, "çekirdek durumDinle ile abone olmalı");
    this.dinleyici(konusuyor);
  }
}

const kur = (secim: { ses?: SesPortu | null; depo?: SahteDepo; saat?: SahteSaat } = {}) => {
  const ws = new SahteWs();
  const kimlik = new SahteKimlik();
  const depo = secim.depo ?? new SahteDepo();
  const saat = secim.saat ?? new SahteSaat();
  const ses = secim.ses === undefined ? new SahteSes() : secim.ses;
  const c = cekirdekKur(ses === null ? { ws, kimlik, depo, saat } : { ws, kimlik, depo, saat, ses });
  const s = c.sohbet("ana");
  return { ws, kimlik, depo, saat, c, s };
};

type Kurulum = ReturnType<typeof kur>;
type Yol = "yazi" | "dikte" | "kisayol";

const baslat = async (k: Kurulum, head = 0): Promise<void> => {
  await k.c.baslat();
  await bosalt();
  await elSikis(k.ws.son(), head);
};

// --- Çerçeveler -------------------------------------------------------------------------------

/** Belirli yoldan gelmiş `user_echo` olayı. */
const yanki = (seq: number, client_msg_id: string, text: string, input: Yol) => ({
  ...yankiOlayi(seq, client_msg_id, text),
  input,
});

const iptalOlayi = (seq: number, turn_id: string) => ({
  seq,
  ts_ms: 1000 + seq,
  type: "turn_aborted",
  turn_id,
  neden: "kullanici_kesti",
});

/** `assistant_activity`; `kaynak_msg_id` verilmezse alan hiç yoktur (servis/sentetik tur). */
const etkinlik = (turn_id: string, kaynak_msg_id?: string, tur = "dusunuyor", gecen_ms = 0) => ({
  v,
  type: "assistant_activity",
  sohbet_id: "ana",
  turn_id,
  etkinlik: tur,
  gecen_ms,
  ...(kaynak_msg_id === undefined ? {} : { kaynak_msg_id }),
});

const etkinlikBitti = (turn_id: string) => ({ v, type: "assistant_activity_end", sohbet_id: "ana", turn_id });

const durumCercevesi = (eren: "hazir" | "tur_suruyor") => sunucuDurumu({ sohbetler: [{ sohbet_id: "ana", eren }] });

// --- Yardımcılar ------------------------------------------------------------------------------

/** Bu bağlantıdan giden son `user_message`'ın kimliği. */
const sonGidenKimlik = (b: SahteBaglanti): string => {
  const m = b
    .giden()
    .filter((x) => x["type"] === "user_message")
    .at(-1);
  assert.ok(m !== undefined, "user_message yollanmış olmalı");
  return String(m["client_msg_id"]);
};

/** Mesajı yollar; kimliği giden çerçeveden alır. */
const gonder = async (k: Kurulum, metin: string, yol: Yol): Promise<string> => {
  const g = await k.s.mesajYolla(metin, yol);
  assert.ok(g.ok, "mesaj kuyruğa girmeli");
  await bosalt();
  const id = sonGidenKimlik(k.ws.son());
  assert.equal(id, g.client_msg_id);
  return id;
};

/** Turun başı: durum, etkinlik (istenirse), yankı, `ack`. */
const turBasi = (b: SahteBaglanti, seq: number, id: string, metin: string, yol: Yol, turn_id: string, etkinlikVar = true) => {
  b.gel(durumCercevesi("tur_suruyor"));
  if (etkinlikVar) b.gel(etkinlik(turn_id, id));
  b.gel(olayCercevesi(yanki(seq, id, metin, yol)));
  b.gel(ack(id, true, { seq }));
};

/** Turun sonu: ara etkinlik (istenirse), cevap, bitiş çerçevesi, `hazir`. */
const turSonu = (b: SahteBaglanti, seq: number, turn_id: string, cevap: string, kaynak?: string, etkinlikVar = true) => {
  if (etkinlikVar) b.gel(etkinlik(turn_id, kaynak, "yaziyor", 100));
  b.gel(olayCercevesi(asistanOlayi(seq, turn_id, cevap)));
  if (etkinlikVar) b.gel(etkinlikBitti(turn_id));
  b.gel(durumCercevesi("hazir"));
};

/** Mesajı yollar ve turunu gerçek servis sırasıyla oynatır (yankı `seq`, cevap `seq + 1`). Kimliği döner. */
const turOynat = async (
  k: Kurulum,
  seq: number,
  yol: Yol,
  soru: string,
  cevap: string,
  secim: { turn_id?: string; etkinlikVar?: boolean } = {},
): Promise<string> => {
  const turn_id = secim.turn_id ?? `t${seq}`;
  const etkinlikVar = secim.etkinlikVar ?? true;
  const id = await gonder(k, soru, yol);
  const b = k.ws.son();
  turBasi(b, seq, id, soru, yol, turn_id, etkinlikVar);
  await bosalt();
  turSonu(b, seq + 1, turn_id, cevap, id, etkinlikVar);
  await bosalt();
  return id;
};

const asistanMetinleri = (k: Kurulum): string[] =>
  k.s
    .durum()
    .ogeler.filter((o) => o.tur === "asistan")
    .map((o) => (o as { metin: string }).metin);

/** Kopar ve yeni bağlantıyı `welcome(head)`'e dek götürür. */
const yenidenBaglan = async (k: Kurulum, head: number): Promise<SahteBaglanti> => {
  const eski = k.ws.son();
  eski.kopsun();
  await bosalt();
  k.saat.ilerlet(1000);
  await bosalt();
  const yeni = k.ws.son();
  assert.notEqual(yeni, eski, "yeniden bağlanılmalı");
  await elSikis(yeni, head);
  return yeni;
};

// =============================================================================================

describe("sesli cevap bağlama: hangi cevap okunur", () => {
  it("dikte ile gönderilen mesajın cevabı temizlenmiş metinle bir kez okunur", async () => {
    const ses = new SahteSes();
    const k = kur({ ses });
    await baslat(k);
    await turOynat(k, 1, "dikte", "nasıl gitti", "**Tamam**, bitti.");
    assert.deepEqual(ses.seslendirilenler, ["Tamam, bitti."]);
  });

  it("(a) gerçek sıra: tur_suruyor ve etkinlik yankıdan ve ack'ten önce gelse de dikte cevabı okunur", async () => {
    const ses = new SahteSes();
    const k = kur({ ses });
    await baslat(k);
    const id = await gonder(k, "durum ne", "dikte");
    const b = k.ws.son();
    // Süreç uyanık ve boştayken servisin yolladığı sıra (gözden geçirmede bulunan senaryo).
    b.gel(durumCercevesi("tur_suruyor"));
    b.gel(etkinlik("t1", id));
    b.gel(olayCercevesi(yanki(1, id, "durum ne", "dikte")));
    b.gel(ack(id, true, { seq: 1 }));
    b.gel(snapshot("t1", "Her"));
    b.gel(etkinlik("t1", id, "komut", 200));
    await bosalt();
    assert.deepEqual(ses.seslendirilenler, []);
    b.gel(olayCercevesi(asistanOlayi(2, "t1", "Her şey yolunda.")));
    b.gel(etkinlikBitti("t1"));
    b.gel(durumCercevesi("hazir"));
    await bosalt();
    assert.deepEqual(ses.seslendirilenler, ["Her şey yolunda."]);
  });

  it("bitiş çerçevesi cevaptan önce gelse de dikte cevabı bir kez okunur", async () => {
    const ses = new SahteSes();
    const k = kur({ ses });
    await baslat(k);
    const id = await gonder(k, "önce bitiş", "dikte");
    const b = k.ws.son();
    turBasi(b, 1, id, "önce bitiş", "dikte", "t1");
    b.gel(etkinlikBitti("t1"));
    b.gel(olayCercevesi(asistanOlayi(2, "t1", "Sonra cevap.")));
    await bosalt();
    assert.deepEqual(ses.seslendirilenler, ["Sonra cevap."]);
  });

  it("kisayol ile gönderilen mesajın cevabı da bir kez okunur", async () => {
    const ses = new SahteSes();
    const k = kur({ ses });
    await baslat(k);
    await turOynat(k, 1, "kisayol", "hatırlat", "**Tamam**, bitti.");
    assert.deepEqual(ses.seslendirilenler, ["Tamam, bitti."]);
  });

  it("yazi ile gönderilen mesajın cevabı okunmaz", async () => {
    const ses = new SahteSes();
    const k = kur({ ses });
    await baslat(k);
    await turOynat(k, 1, "yazi", "yazdım", "Cevap.");
    assert.deepEqual(ses.seslendirilenler, []);
    assert.deepEqual(asistanMetinleri(k), ["Cevap."]);
  });

  it("art arda dikte ve yazi: yalnız dikte mesajının cevabı okunur", async () => {
    const ses = new SahteSes();
    const k = kur({ ses });
    await baslat(k);
    await turOynat(k, 1, "dikte", "bir", "Birinci cevap.");
    await turOynat(k, 3, "yazi", "iki", "İkinci cevap.");
    assert.deepEqual(ses.seslendirilenler, ["Birinci cevap."]);
  });

  it("(b) sesli tur sürerken yazıyla ikinci mesaj: yalnız seslinin cevabı okunur", async () => {
    const ses = new SahteSes();
    const k = kur({ ses });
    await baslat(k);
    const a = await gonder(k, "sesli", "dikte");
    const b = k.ws.son();
    turBasi(b, 1, a, "sesli", "dikte", "t1");
    await bosalt();
    // Tur sürerken yazılan mesaj serviste sıraya girer.
    const y = await gonder(k, "yazılı", "yazi");
    b.gel(olayCercevesi(yanki(2, y, "yazılı", "yazi")));
    b.gel(ack(y, true, { seq: 2 }));
    await bosalt();
    b.gel(olayCercevesi(asistanOlayi(3, "t1", "Sesliye cevap.")));
    b.gel(etkinlikBitti("t1"));
    b.gel(etkinlik("t2", y));
    b.gel(olayCercevesi(asistanOlayi(4, "t2", "Yazılıya cevap.")));
    b.gel(etkinlikBitti("t2"));
    b.gel(durumCercevesi("hazir"));
    await bosalt();
    assert.deepEqual(ses.seslendirilenler, ["Sesliye cevap."]);
    assert.deepEqual(asistanMetinleri(k), ["Sesliye cevap.", "Yazılıya cevap."]);
  });

  it("yazılı tur sürerken dikte ile ikinci mesaj: yalnız diktenin cevabı okunur", async () => {
    const ses = new SahteSes();
    const k = kur({ ses });
    await baslat(k);
    const y = await gonder(k, "yazılı", "yazi");
    const b = k.ws.son();
    turBasi(b, 1, y, "yazılı", "yazi", "t1");
    await bosalt();
    const a = await gonder(k, "sesli", "dikte");
    b.gel(olayCercevesi(yanki(2, a, "sesli", "dikte")));
    b.gel(ack(a, true, { seq: 2 }));
    await bosalt();
    b.gel(olayCercevesi(asistanOlayi(3, "t1", "Yazılıya cevap.")));
    b.gel(etkinlikBitti("t1"));
    await bosalt();
    assert.deepEqual(ses.seslendirilenler, [], "yazılının cevabı okunmamalı");
    b.gel(etkinlik("t2", a));
    b.gel(olayCercevesi(asistanOlayi(4, "t2", "Sesliye cevap.")));
    b.gel(etkinlikBitti("t2"));
    await bosalt();
    assert.deepEqual(ses.seslendirilenler, ["Sesliye cevap."]);
  });

  it("(c) kaynak_msg_id taşımayan (sentetik) turun cevabı, araya sesli mesaj gönderilmiş olsa da okunmaz", async () => {
    const ses = new SahteSes();
    const k = kur({ ses });
    await baslat(k);
    const a = await gonder(k, "sesli", "dikte");
    const b = k.ws.son();
    // Sentetik tur (iş sonucu vb.) sesli mesajdan önce açıldı; etkinliğinde kaynak yok.
    b.gel(durumCercevesi("tur_suruyor"));
    b.gel(etkinlik("t0"));
    b.gel(olayCercevesi(yanki(1, a, "sesli", "dikte")));
    b.gel(ack(a, true, { seq: 1 }));
    b.gel(olayCercevesi(asistanOlayi(2, "t0", "Sentetik cevap.")));
    b.gel(etkinlikBitti("t0"));
    await bosalt();
    assert.deepEqual(ses.seslendirilenler, [], "sentetik turun cevabı okunmamalı");
    b.gel(etkinlik("t1", a));
    b.gel(olayCercevesi(asistanOlayi(3, "t1", "Asıl cevap.")));
    b.gel(etkinlikBitti("t1"));
    b.gel(durumCercevesi("hazir"));
    await bosalt();
    assert.deepEqual(ses.seslendirilenler, ["Asıl cevap."]);
  });

  it("(c) yalnız kaynaksız tur gelirse sesli mesaj gönderilmiş olsa da hiçbir şey okunmaz", async () => {
    const ses = new SahteSes();
    const k = kur({ ses });
    await baslat(k);
    const a = await gonder(k, "sesli", "dikte");
    const b = k.ws.son();
    b.gel(olayCercevesi(yanki(1, a, "sesli", "dikte")));
    b.gel(ack(a, true, { seq: 1 }));
    b.gel(etkinlik("t1"));
    b.gel(olayCercevesi(asistanOlayi(2, "t1", "Kaynaksız.")));
    b.gel(etkinlikBitti("t1"));
    await bosalt();
    assert.deepEqual(ses.seslendirilenler, []);
  });

  it("(d) etkinlik çerçevesi hiç gelmezse (eski servis) dikte cevabı okunmaz, hata olmaz", async () => {
    const ses = new SahteSes();
    const k = kur({ ses });
    await baslat(k);
    await turOynat(k, 1, "dikte", "eski servis", "Okunmayacak.", { etkinlikVar: false });
    assert.deepEqual(ses.seslendirilenler, []);
    assert.deepEqual(asistanMetinleri(k), ["Okunmayacak."]);
    assert.equal(k.c.durum().hata, null);
    assert.equal(k.c.durum().baglanti, "bagli");
  });

  it("(e) etkinlik, yankı ve ack mesajın yerel kaydından (mesajYolla çözülmeden) önce gelse de cevap okunur", async () => {
    const ses = new SahteSes();
    const k = kur({ ses });
    await baslat(k);
    const b = k.ws.son();
    const sira: string[] = [];
    let kimlik: string | null = null;
    const asil = b.gonder.bind(b);
    // Kablo yazılır yazılmaz (aynı mikro görevden hemen sonra) servis yanıt verir: mesajYolla henüz dönmedi.
    b.gonder = (metin: string): void => {
      asil(metin);
      const m = JSON.parse(metin) as Record<string, unknown>;
      if (m["type"] !== "user_message" || kimlik !== null) return;
      const id = String(m["client_msg_id"]);
      kimlik = id;
      queueMicrotask(() => {
        sira.push("cerceveler");
        b.gel(durumCercevesi("tur_suruyor"));
        b.gel(etkinlik("t1", id));
        b.gel(olayCercevesi(yanki(1, id, "erken", "dikte")));
        b.gel(ack(id, true, { seq: 1 }));
      });
    };
    const p = k.s.mesajYolla("erken", "dikte");
    void p.then(() => sira.push("cozuldu"));
    const g = await p;
    assert.ok(g.ok);
    await bosalt();
    assert.deepEqual(sira, ["cerceveler", "cozuldu"], "senaryo: çerçeveler mesajYolla çözülmeden gelmeli");
    assert.equal(kimlik, g.client_msg_id);
    b.gel(olayCercevesi(asistanOlayi(2, "t1", "Erken geldi.")));
    b.gel(etkinlikBitti("t1"));
    await bosalt();
    assert.deepEqual(ses.seslendirilenler, ["Erken geldi."]);
  });

  it("açılışta diskten yüklenen geçmişteki sesli mesajın cevabı okunmaz", async () => {
    const ilkSes = new SahteSes();
    const ilk = kur({ ses: ilkSes });
    await baslat(ilk);
    await turOynat(ilk, 1, "dikte", "eski", "Eski cevap.");
    assert.deepEqual(ilkSes.seslendirilenler, ["Eski cevap."]);
    ilk.c.kapat();
    await bosalt();

    const ses = new SahteSes();
    const yeni = kur({ ses, depo: ilk.depo });
    await baslat(yeni, 2);
    await bosalt();
    assert.deepEqual(asistanMetinleri(yeni), ["Eski cevap."], "geçmiş yüklenmeli");
    assert.deepEqual(ses.seslendirilenler, []);
  });

  it("tur turn_aborted ile biterse hiçbir şey okunmaz", async () => {
    const ses = new SahteSes();
    const k = kur({ ses });
    await baslat(k);
    const id = await gonder(k, "dur", "dikte");
    const b = k.ws.son();
    turBasi(b, 1, id, "dur", "dikte", "t1");
    b.gel(olayCercevesi(iptalOlayi(2, "t1")));
    b.gel(etkinlikBitti("t1"));
    b.gel(durumCercevesi("hazir"));
    await bosalt();
    assert.deepEqual(ses.seslendirilenler, []);
  });

  it("aynı assistant_message iki kez gelirse bir kez okunur", async () => {
    const ses = new SahteSes();
    const k = kur({ ses });
    await baslat(k);
    const id = await gonder(k, "tekrar", "dikte");
    const b = k.ws.son();
    turBasi(b, 1, id, "tekrar", "dikte", "t1");
    b.gel(olayCercevesi(asistanOlayi(2, "t1", "Bir kez.")));
    b.gel(olayCercevesi(asistanOlayi(2, "t1", "Bir kez.")));
    b.gel(etkinlikBitti("t1"));
    await bosalt();
    b.gel(olayCercevesi(asistanOlayi(2, "t1", "Bir kez.")));
    await bosalt();
    assert.deepEqual(ses.seslendirilenler, ["Bir kez."]);
  });
});

describe("sesli cevap bağlama: kopma ve telafi", () => {
  it("etkinliği kopmadan önce görülen turun cevabı telafiyle gelince bir kez okunur", async () => {
    const ses = new SahteSes();
    const k = kur({ ses });
    await baslat(k);
    const id = await gonder(k, "kopacak", "dikte");
    turBasi(k.ws.son(), 1, id, "kopacak", "dikte", "t1");
    await bosalt();
    const ikinci = await yenidenBaglan(k, 2);
    assert.equal(ikinci.giden()[0]?.["last_seq"], 1);
    // Servis sırası: welcome → eksik olaylar → (süren tur yok) → server_status.
    ikinci.gel(olayCercevesi(asistanOlayi(2, "t1", "Geç geldim.")));
    ikinci.gel(durumCercevesi("hazir"));
    await bosalt();
    assert.deepEqual(ses.seslendirilenler, ["Geç geldim."]);
    assert.deepEqual(asistanMetinleri(k), ["Geç geldim."]);
  });

  it("(f) tur kopukken başladı: yeniden bağlanınca snapshot + etkinlik(kaynak) ve ardından cevap: bir kez okunur", async () => {
    const ses = new SahteSes();
    const k = kur({ ses });
    await baslat(k);
    const id = await gonder(k, "kopukta", "dikte");
    // Mesaj yollandı, ack ve yankı gelmeden yol koptu; tur serviste kopukken başladı.
    const ikinci = await yenidenBaglan(k, 1);
    // Servis sırası (gateway telafiYap): eksik olaylar → süren turun snapshot'ı → etkinlik → server_status.
    ikinci.gel(olayCercevesi(yanki(1, id, "kopukta", "dikte")));
    ikinci.gel(snapshot("t1", "Yarım"));
    ikinci.gel(etkinlik("t1", id, "yaziyor", 3_000));
    ikinci.gel(durumCercevesi("tur_suruyor"));
    // Outbox mesajı aynı kimlikle yeniden yollar; servis kayıtlı ack'i döner.
    ikinci.gel(ack(id, true, { seq: 1 }));
    await bosalt();
    assert.deepEqual(ses.seslendirilenler, []);
    ikinci.gel(olayCercevesi(asistanOlayi(2, "t1", "Yarım kalmadı.")));
    ikinci.gel(etkinlikBitti("t1"));
    ikinci.gel(durumCercevesi("hazir"));
    await bosalt();
    assert.deepEqual(ses.seslendirilenler, ["Yarım kalmadı."]);
  });

  it("tur kopukken başlayıp bittiyse (etkinliği hiç görülmedi) telafiyle gelen cevap okunmaz", async () => {
    const ses = new SahteSes();
    const k = kur({ ses });
    await baslat(k);
    const id = await gonder(k, "kayıp", "dikte");
    k.ws.son().gel(ack(id, true, { seq: 1 }));
    await bosalt();
    const ikinci = await yenidenBaglan(k, 2);
    // Telafi etkinlik çerçevesini yeniden oynatmaz: tur bitmiş, kaynak hiç bildirilmedi.
    ikinci.gel(olayCercevesi(yanki(1, id, "kayıp", "dikte")));
    ikinci.gel(olayCercevesi(asistanOlayi(2, "t1", "Telafiyle.")));
    ikinci.gel(durumCercevesi("hazir"));
    await bosalt();
    assert.deepEqual(ses.seslendirilenler, []);
    assert.deepEqual(asistanMetinleri(k), ["Telafiyle."]);
  });
});

describe("sesli cevap bağlama: okuma durumu ve kesme", () => {
  it("port okuma sürüyor dedikçe seslendiriyor true, bitti deyince false; aboneler haberdar edilir", async () => {
    const ses = new SahteSes();
    const k = kur({ ses });
    await baslat(k);
    const gorulen: (boolean | undefined)[] = [];
    const kapat = k.c.abone((d: CekirdekDurumu) => {
      gorulen.push(d.seslendiriyor);
    });
    assert.equal(k.c.durum().seslendiriyor, false);

    ses.bildir(true);
    assert.equal(k.c.durum().seslendiriyor, true);
    assert.equal(gorulen.at(-1), true, "abone true görmeli");

    ses.bildir(false);
    assert.equal(k.c.durum().seslendiriyor, false);
    assert.equal(gorulen.at(-1), false, "abone false görmeli");
    kapat();
  });

  it("sustur portun durdur'unu çağırır", async () => {
    const ses = new SahteSes();
    const k = kur({ ses });
    await baslat(k);
    await turOynat(k, 1, "dikte", "oku", "Uzun bir cevap.");
    ses.bildir(true);
    const once = ses.durdurSayisi;
    k.c.sustur();
    await bosalt();
    assert.ok(ses.durdurSayisi > once, "durdur çağrılmalı");
  });

  for (const yol of ["yazi", "dikte", "kisayol"] as const) {
    it(`${yol} ile yeni mesaj gönderilince süren okuma kesilir (durdur çağrılır)`, async () => {
      const ses = new SahteSes();
      const k = kur({ ses });
      await baslat(k);
      await turOynat(k, 1, "dikte", "oku", "Okunan cevap.");
      ses.bildir(true);
      const once = ses.durdurSayisi;
      const g = await k.s.mesajYolla("araya girdim", yol);
      assert.ok(g.ok);
      await bosalt();
      assert.ok(ses.durdurSayisi > once, "durdur çağrılmalı");
    });
  }
});

describe("sesli cevap bağlama: dayanıklılık", () => {
  it("ses portu verilmezse aynı senaryo hatasız çalışır, seslendiriyor true olmaz", async () => {
    const k = kur({ ses: null });
    await baslat(k);
    await turOynat(k, 1, "dikte", "sessiz", "**Tamam**, bitti.");
    assert.deepEqual(asistanMetinleri(k), ["**Tamam**, bitti."]);
    assert.notEqual(k.c.durum().seslendiriyor, true);
    k.c.sustur();
    await bosalt();
    const g = await k.s.mesajYolla("devam", "kisayol");
    assert.ok(g.ok);
    assert.notEqual(k.c.durum().seslendiriyor, true);
  });

  it("seslendir reddetse de cevap görünüme eklenir ve sonraki mesaj gönderilir", async () => {
    const ses = new SahteSes();
    ses.reddet = true;
    const k = kur({ ses });
    await baslat(k);
    await turOynat(k, 1, "dikte", "dene", "Bozuk ses.");
    assert.deepEqual(ses.seslendirilenler, ["Bozuk ses."], "okuma denenmeli");
    assert.deepEqual(asistanMetinleri(k), ["Bozuk ses."]);

    await turOynat(k, 3, "dikte", "yine", "İkinci.");
    assert.deepEqual(asistanMetinleri(k), ["Bozuk ses.", "İkinci."]);
    assert.deepEqual(ses.seslendirilenler, ["Bozuk ses.", "İkinci."]);
    assert.equal(k.s.durum().hata, null);
    assert.equal(k.c.durum().baglanti, "bagli");
  });
});
