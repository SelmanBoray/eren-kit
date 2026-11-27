/**
 * Yukarı iş mesajlarının kalıcı kuyruğu. `client_msg_id` kalıcı sayaçtan üretilir ve mesaj diske
 * yazılmadan yollanmaz: çökmeden sonra aynı kimlik başka mesaja verilseydi servis eski `ack`'i
 * döner, yeni mesaj sessizce düşerdi. Kimlikten sonra sırayla yollanır, `ack` gelince silinir;
 * `ok:false` yeniden yollanmaz, kullanıcıya hata olur. Bilinmeyen ya da ikinci `ack` zararsızdır.
 * Giden her mesaj `v: SOHBET_SURUMU`; diskte kalmış eski sürüm (v1-v4) öğeler yüklemede güncel sürüme
 * yükseltilir.
 * Dilim 2: sohbet kimlikleri (`sohbetIdUret`) aynı kalıcı sayaçtan; `kaldir` sohbet artıklarını siler.
 * `ack ok` almış `chat_create` kuyruktan çıkar ama `kaldir` onu bırakana dek diskte (kuyruğun başında)
 * kalır: `chat_created` telafi günlüğüne yazılmadan süreç ölürse sohbet adıyla birlikte kaybolmasın.
 * Yeniden yüklemede kuyruğa döner ve aynı kimlikle yeniden yollanır; servis aynı `ack`'i döner.
 * TASARIM.md "Outbox v2 → v3" (Dilim 3: v3 → v4, 0.5.0: v4 → v5 aynı kalıpla); protocol README `/sohbet`; tipler
 * sozlesme.ts "Dilim 2".
 * Medya (U2): yollanmamış her öğe yollanmadan önce `hazirlik`'e sorulur. `"bekliyor"` olan öğe yalnız
 * kendi sohbetini tıkar: o sohbetin sonraki `user_message`'ları ve `chat_clear`'ı bekler (geçmiş silme,
 * kendisinden önce yazılmış mesajı geçmesin); öteki sohbetler, sohbetsiz öğeler, aynı sohbetin
 * `interrupt`/`chat_create`/`chat_rename`/`chat_delete`'i yürür. `{hata}` öğesi kuyruktan hatalara taşınır.
 * Henüz hiç yollanmamış `user_message` `bekleyeniKaldir` ile kuyruktan kaldırılabilir (eski servise
 * bağlıyken sonsuza dek bekleyen ekli mesaj). TASARIM.md "Medya".
 */
import { ANA_SOHBET_ID, HataKodu, SOHBET_SURUMU, SohbetYukari } from "@eren/protocol";
import type { MedyaId, SohbetId } from "@eren/protocol";
import type {
  GeciciIsTuru,
  GidenHataKodu,
  GidenHatasi,
  IsMesaji,
  IsMesajiTuru,
  MesajHazirligi,
  Outbox,
  OutboxBagimliliklari,
  OutboxOgesi,
} from "./sozlesme.ts";

export type {
  AckCercevesi,
  AckSonucu,
  EkleSecenekleri,
  EkleSonucu,
  GidenGovde,
  GidenHataKodu,
  GidenHatasi,
  IsMesaji,
  Outbox,
  OutboxBagimliliklari,
  OutboxFabrikasi,
  OutboxOgesi,
  YuklemeOzeti,
} from "./sozlesme.ts";

export const OUTBOX_ANAHTARI = "sohbet_outbox";

/**
 * Medya (U2). `Outbox`'a ek olarak `outboxKur`'un verdiği üyeler (sözleşmede henüz yok; çağıran
 * `outboxKur`'un dönüş tipinden görür).
 */
export interface MedyaliOutbox extends Outbox {
  medyaIdUret: () => MedyaId;
  hazirlikDegisti(): void;
  /**
   * Bu süreçte hiç yollanmamış bir `user_message`'ı kuyruktan kaldırır (ör. eki hazır olmayan ve
   * sohbetini tıkayan mesaj için "Kaldır"); hatalara düşmez. Kaldırılan mesajı döner. Öğe yoksa, ileti
   * `user_message` değilse ya da bu süreçte en az bir kez yollandıysa (servise ulaşmış olabilir, `ack`
   * beklenir) `null` döner, hiçbir şey değişmez. Bellek ve `degisti` hemen; söz tek yazımı bekler,
   * arkasında bekleyenler (bağlıysa) yazım bitince yollanır. Yazım başarısızsa bellekte yine
   * kaldırılmıştır, söz reddedilir. Eklerin yükleyiciden iptali (`Yukleyici.iptal`) çağıranındır.
   * Sınır: önceki süreçte yollanıp `ack`'i gelmemiş mesaj diskten "hiç yollanmamış" olarak döner;
   * servis onu aldıysa yankısı telafiyle yine gelir.
   */
  bekleyeniKaldir(client_msg_id: string): Promise<IsMesaji | null>;
  /**
   * Sohbette `hazirlik`'i `"bekliyor"` olan (eki hazır değil), bu süreçte hiç yollanmamış öğe var mı.
   * Eşzamanlı; bağlantıdan bağımsız. Tıkalı sohbette `chat_clear` kuyrukta bekler: çağıran (ör. "Geçmişi
   * sil" süresi) bunu bilmek isteyebilir. `hazirlik` verilmemişse hep `false`.
   */
  sohbetTikaliMi(sohbet_id: SohbetId): boolean;
}

// Kayıt biçimi kümenin eksiksizliğini tipe bağlar: `IsMesajiTuru`'na tür eklenirse `tsc` kırılır.
const IS_TURU_KAYDI: Record<IsMesajiTuru, true> = {
  user_message: true,
  interrupt: true,
  plan_decision: true,
  question_answer: true,
  job_cancel: true,
  chat_clear: true,
  chat_create: true,
  chat_rename: true,
  chat_delete: true,
};
const IS_TURLERI: ReadonlySet<string> = new Set(Object.keys(IS_TURU_KAYDI));

/**
 * Medya. Sohbeti tıkalıyken bekleyen türler. `chat_clear` da bekler: önce yazılmış ekli mesaj silmeden
 * sonra gitseydi sıra tersine dönerdi. `chat_delete` beklemez: sohbet silinince bekleyen mesajı
 * çekirdek `kaldir`'la atar, eklerini iptal eder.
 */
const TIKANAN_TURLER: ReadonlySet<string> = new Set<IsMesajiTuru>(["user_message", "chat_clear"]);

const mesajinSohbeti = (m: IsMesaji): string | null =>
  "sohbet_id" in m && typeof m.sohbet_id === "string" ? m.sohbet_id : null;

const GECICI_TUR_KAYDI: Record<GeciciIsTuru, true> = { chat_clear: true, chat_delete: true };
const GECICI_TURLER: ReadonlySet<string> = new Set(Object.keys(GECICI_TUR_KAYDI));

/** Yalnız bağlıyken giden, kopunca yeniden yollanmayan, önceki süreçten kalanı atılan tür. */
const geciciTurMu = (m: IsMesaji): boolean => GECICI_TURLER.has(m.type);

/** v3'ten beri `sohbet_id`'si zorunlu olup v1/v2'de alanı olmayan türler: eskileri `ana`'nındır. */
const ANAYA_BAGLANAN_TURLER: ReadonlySet<string> = new Set<IsMesajiTuru>([
  "user_message",
  "interrupt",
  "chat_clear",
]);

export const isMesajiMi = (m: SohbetYukari): m is IsMesaji => IS_TURLERI.has(m.type);

const AZAMI_HATA = 100;
const DONEM = /^[a-z0-9]{1,16}$/;

interface Oge {
  mesaj: IsMesaji;
  gecici: boolean;
  /** Bu öğeyi içeren bir yazım bitti. */
  kalici: boolean;
  /** Bu bağlantıda yollandı. */
  yollandi: boolean;
  /** Bu süreçte en az bir kez yollandı (servise ulaşmış olabilir). */
  denendi: boolean;
}

interface Kayit {
  donem: string;
  sayac: number;
  ogeler: { mesaj: IsMesaji; gecici: boolean }[];
  hatalar: GidenHatasi[];
}

const mesajCoz = (ham: unknown): IsMesaji | null => {
  const c = SohbetYukari.safeParse(ham);
  return c.success && isMesajiMi(c.data) ? c.data : null;
};

/**
 * Diskte kalmış olabilecek eski `/sohbet` sürümleri: v1 (Dilim 1 öncesi), v2 (Dilim 1), v3 (Dilim 2),
 * v4 (Dilim 3). `sohbet_id`'siz olanlar (v1, v2) `ana`'ya bağlanır; v3 kaydı v4'ün alt kümesidir.
 * v4 → v5 yalnız aşağı olaylardaki planı değiştirdi (iki plan listesi kalktı); yukarı mesajlar
 * aynıdır, yalnız `v` değişir.
 */
const SOHBET_IDSIZ_SURUMLER: ReadonlySet<unknown> = new Set([1, 2]);
/** Kısayol girdisi (`input: "kisayol"`, `baglam`) v4'te geldi: daha eski kayıtta olamaz. */
const KISAYOLSUZ_SURUMLER: ReadonlySet<unknown> = new Set([1, 2, 3]);
const ESKI_SOHBET_SURUMLERI: ReadonlySet<unknown> = new Set([1, 2, 3, 4]);

/**
 * Diskteki kayıtlı mesaj. Güncel sürümse olduğu gibi çözülür. `v` 1, 2, 3 ya da 4 ise `v`
 * `SOHBET_SURUMU` yapılır; v1/v2 `user_message`/`interrupt`/`chat_clear`'da `sohbet_id` yoksa
 * `ANA_SOHBET_ID` eklenir; sonra yeniden çözülür. Kimlik ve öteki alanlar aynı kalır; yükseltilmiş
 * hali de şemadan geçmezse `null` (çağıran `atilan`'a sayar). v1-v3'te olamayacak v4 alanları
 * (`input: "kisayol"`, `baglam`) taşıyan v1-v3 kaydı bozuktur: `null`. Başka `v` `null`.
 */
const kayitliMesajCoz = (ham: unknown): { mesaj: IsMesaji; yukseltildi: boolean } | null => {
  const mesaj = mesajCoz(ham);
  if (mesaj !== null) return { mesaj, yukseltildi: false };
  if (typeof ham !== "object" || ham === null || Array.isArray(ham)) return null;
  const eski = ham as { v?: unknown; type?: unknown; sohbet_id?: unknown; input?: unknown };
  if (!ESKI_SOHBET_SURUMLERI.has(eski.v)) return null;
  if (KISAYOLSUZ_SURUMLER.has(eski.v) && (eski.input === "kisayol" || "baglam" in eski)) return null;
  const yeni: Record<string, unknown> = { ...ham, v: SOHBET_SURUMU };
  if (
    SOHBET_IDSIZ_SURUMLER.has(eski.v) &&
    typeof eski.type === "string" &&
    ANAYA_BAGLANAN_TURLER.has(eski.type) &&
    eski.sohbet_id === undefined
  ) {
    yeni.sohbet_id = ANA_SOHBET_ID;
  }
  const yukseltilmis = mesajCoz(yeni);
  return yukseltilmis === null ? null : { mesaj: yukseltilmis, yukseltildi: true };
};

type HamKayit = Partial<Record<keyof Kayit, unknown>>;

/** Diskteki kaydın biçimi bozuksa boş kayıt: dönem yeniden üretilir. */
const hamKayitCoz = (ham: string | null): HamKayit => {
  if (ham === null) return {};
  try {
    const deger: unknown = JSON.parse(ham);
    return typeof deger === "object" && deger !== null ? (deger as HamKayit) : {};
  } catch {
    return {};
  }
};

const diziMi = (ham: unknown): readonly unknown[] => (Array.isArray(ham) ? ham : []);

const hataKoduCoz = (ham: unknown): GidenHataKodu | null => {
  if (ham === "baglanti_koptu" || ham === "ek_bulunamadi") return ham;
  const c = HataKodu.safeParse(ham);
  return c.success ? c.data : null;
};

export const outboxKur = ({ depo, saat, degisti, hazirlik }: OutboxBagimliliklari): MedyaliOutbox => {
  // Kimlik `<donem>-<sayac>`, sohbet kimliği `s-<donem>-<sayac>` (aynı sayaç). Dönem ilk açılışın
  // zamanıdır: kayıt kaybolup sayaç sıfırlansa da aynı cihazda eski bir kimlik yeniden üretilmez.
  let donem = "";
  let sayac = 0;
  let yuklendi = false;
  let liste: Oge[] = [];
  let hataListesi: GidenHatasi[] = [];
  // `ack ok` almış, olayı henüz telafi günlüğüne yazılmamış `chat_create`'ler: yalnız diskte.
  let tutulanlar: IsMesaji[] = [];
  let gonder: ((m: SohbetYukari) => boolean) | null = null;
  let zincir: Promise<void> = Promise.resolve();
  let yayinOgeler: readonly OutboxOgesi[] = [];
  let yayinHatalar: readonly GidenHatasi[] = [];
  let ogelerKirli = true;
  let hatalarKirli = true;

  const bildir = (ogeler: boolean, hatalar: boolean): void => {
    if (ogeler) ogelerKirli = true;
    if (hatalar) hatalarKirli = true;
    degisti();
  };

  const kayitKur = (): Kayit => ({
    donem,
    sayac,
    // Tutulanlar başta: yeniden yüklemede sohbetlerinin mesajlarından önce yollanırlar.
    ogeler: [
      ...tutulanlar.map((mesaj) => ({ mesaj, gecici: false })),
      ...liste.map((o) => ({ mesaj: o.mesaj, gecici: o.gecici })),
    ],
    hatalar: hataListesi,
  });

  // Anlık durum adım çalışırken alınır: araya giren değişiklikler de aynı yazıma girer.
  const kaydet = (): Promise<void> => {
    const adim = zincir.then(async () => {
      const dahil = liste.slice();
      await depo.yaz(OUTBOX_ANAHTARI, JSON.stringify(kayitKur()));
      for (const o of dahil) o.kalici = true;
    });
    zincir = adim.catch(() => undefined);
    return adim;
  };

  // Silme ve hata kaydı kaybolursa öğe yeniden yollanır, servis aynı `ack`'i döner.
  const arkadanKaydet = (): void => {
    kaydet().catch(() => undefined);
  };

  const hataEkle = (h: GidenHatasi): void => {
    hataListesi = [...hataListesi, h].slice(-AZAMI_HATA);
  };

  // Bağımlılık atmamalı; atarsa öğe kaybolmasın diye beklemede kalır.
  const hazirlikSor = (m: IsMesaji): MesajHazirligi => {
    if (hazirlik === undefined) return "hazir";
    try {
      return hazirlik(m);
    } catch {
      return "bekliyor";
    }
  };

  const gonderBekleyenler = (): void => {
    if (gonder === null) return;
    let yollanan = false;
    const tikali = new Set<string>();
    const hatali = new Set<Oge>();
    // Anlık kopya: `{hata}` öğeleri döngüden sonra listeden çıkar.
    for (const o of liste.slice()) {
      // Sıra: kalıcı olmayanın ardındakiler de bekler.
      if (!o.kalici) break;
      if (o.yollandi) continue;
      const sohbet = mesajinSohbeti(o.mesaj);
      // Tıkalı sohbetin sırası: sonraki mesaj ve geçmiş silme önündekini geçmez (sorulmaz bile).
      if (sohbet !== null && tikali.has(sohbet) && TIKANAN_TURLER.has(o.mesaj.type)) continue;
      const h = hazirlikSor(o.mesaj);
      if (h === "bekliyor") {
        if (sohbet !== null) tikali.add(sohbet);
        continue;
      }
      if (h !== "hazir") {
        hatali.add(o);
        hataEkle({ client_msg_id: o.mesaj.client_msg_id, mesaj: o.mesaj, kod: h.hata });
        continue;
      }
      let tamam = false;
      try {
        tamam = gonder(o.mesaj);
      } catch {
        tamam = false;
      }
      if (!tamam) break;
      o.yollandi = true;
      o.denendi = true;
      yollanan = true;
    }
    if (hatali.size > 0) {
      liste = liste.filter((o) => !hatali.has(o));
      arkadanKaydet();
      bildir(true, true);
    } else if (yollanan) bildir(true, false);
  };

  const sayacKimligi = (onek: string, ad: string): string => {
    if (!yuklendi) throw new Error(`outbox: ${ad} yukle'den önce çağrıldı`);
    // Sayaç diske ardından gelen `ekle`'nin yazımıyla girer; yazım olmadan süreç ölürse kimlik
    // hiçbir yere yazılmamıştır, yeniden üretilmesi zararsızdır.
    sayac++;
    return `${onek}-${donem}-${sayac}`;
  };

  const outbox: MedyaliOutbox = {
    yukle: async () => {
      const ham = await depo.oku(OUTBOX_ANAHTARI);
      const kayit = hamKayitCoz(ham);
      const kayitDonem = kayit.donem;
      const kayitSayac = kayit.sayac;
      if (
        typeof kayitDonem === "string" &&
        DONEM.test(kayitDonem) &&
        typeof kayitSayac === "number" &&
        Number.isSafeInteger(kayitSayac) &&
        kayitSayac >= 0
      ) {
        donem = kayitDonem;
        sayac = kayitSayac;
      } else {
        donem = Math.max(0, Math.trunc(saat.simdiMs())).toString(36);
        sayac = 0;
      }

      liste = [];
      hataListesi = [];
      tutulanlar = [];
      let yukseltilen = 0;
      let atilan = 0;
      // Sıra diskteki sıradır; yükseltme sırayı ve kimliği değiştirmez. Yükseltilen kayıt bir
      // sonraki yazımda güncel sürümle (`SOHBET_SURUMU`) yazılır.
      const gorulen = new Set<string>();
      for (const h of diziMi(kayit.ogeler)) {
        if (typeof h !== "object" || h === null) {
          atilan++;
          continue;
        }
        const c = kayitliMesajCoz((h as { mesaj?: unknown }).mesaj);
        if (c === null || gorulen.has(c.mesaj.client_msg_id)) {
          atilan++;
          continue;
        }
        const { mesaj } = c;
        gorulen.add(mesaj.client_msg_id);
        // Önceki süreçten kalan silme isteğinin (geçmiş ya da sohbet) sonucu yalnız o sürecin
        // sözündendi: ne yeniden yollanır ne hata olur. Servis sildiyse olay telafiyle gelir.
        if (geciciTurMu(mesaj)) {
          atilan++;
          continue;
        }
        if (c.yukseltildi) yukseltilen++;
        // Önceki süreçten kalan hedefsiz kesme bayattır: yeni bir turu öldürebilirdi.
        if ((h as { gecici?: unknown }).gecici === true) {
          hataEkle({ client_msg_id: mesaj.client_msg_id, mesaj, kod: "baglanti_koptu" });
          continue;
        }
        liste.push({ mesaj, gecici: false, kalici: true, yollandi: false, denendi: false });
      }
      for (const h of diziMi(kayit.hatalar)) {
        if (typeof h !== "object" || h === null) {
          atilan++;
          continue;
        }
        const c = kayitliMesajCoz((h as { mesaj?: unknown }).mesaj);
        const kod = hataKoduCoz((h as { kod?: unknown }).kod);
        if (c === null || kod === null || geciciTurMu(c.mesaj)) {
          atilan++;
          continue;
        }
        if (c.yukseltildi) yukseltilen++;
        hataEkle({ client_msg_id: c.mesaj.client_msg_id, mesaj: c.mesaj, kod });
      }
      yuklendi = true;
      bildir(true, true);
      return { yukseltilen, atilan };
    },

    ekle: async (govde, secenek) => {
      const client_msg_id = `${donem}-${sayac + 1}`;
      const mesaj = mesajCoz({ ...govde, v: SOHBET_SURUMU, client_msg_id });
      if (mesaj === null) return { ok: false, neden: "gecersiz" };
      // Yazım başarısız olsa da sayaç geri alınmaz: o kimlik diske ulaşmış olabilir.
      sayac++;
      // `chat_clear`/`chat_delete` yalnız bağlıyken gider, kopunca yeniden yollanmaz: geç gelen
      // silme sonradan yazılanı da silerdi. Kimliği yine diske yazılır; aynı kimlik başka mesaja
      // verilmesin.
      const gecici = secenek?.gecici === true || geciciTurMu(mesaj);
      const oge: Oge = { mesaj, gecici, kalici: false, yollandi: false, denendi: false };
      liste.push(oge);
      bildir(true, false);
      try {
        await kaydet();
      } catch {
        liste = liste.filter((o) => o !== oge);
        bildir(true, false);
        return { ok: false, neden: "depo_hatasi" };
      }
      gonderBekleyenler();
      return { ok: true, client_msg_id };
    },

    kimlikTamam: (g) => {
      gonder = g;
      for (const o of liste) o.yollandi = false;
      gonderBekleyenler();
    },

    koptu: () => {
      gonder = null;
      const geciciler = liste.filter((o) => o.gecici);
      for (const o of liste) o.yollandi = false;
      if (geciciler.length > 0) {
        liste = liste.filter((o) => !o.gecici);
        for (const o of geciciler) {
          hataEkle({ client_msg_id: o.mesaj.client_msg_id, mesaj: o.mesaj, kod: "baglanti_koptu" });
        }
        arkadanKaydet();
      }
      bildir(true, geciciler.length > 0);
    },

    ack: (a) => {
      const i = liste.findIndex((o) => o.mesaj.client_msg_id === a.client_msg_id);
      if (i < 0) return null;
      const oge = liste[i]!;
      liste = [...liste.slice(0, i), ...liste.slice(i + 1)];
      if (a.ok) {
        if (oge.mesaj.type === "chat_create") tutulanlar = [...tutulanlar, oge.mesaj];
        arkadanKaydet();
        bildir(true, false);
        return { ok: true, mesaj: oge.mesaj, seq: a.seq ?? null };
      }
      const kod = a.code ?? "ic_hata";
      hataEkle({ client_msg_id: a.client_msg_id, mesaj: oge.mesaj, kod });
      arkadanKaydet();
      bildir(true, true);
      return { ok: false, mesaj: oge.mesaj, kod };
    },

    ogeler: () => {
      if (ogelerKirli) {
        yayinOgeler = liste.map((o) => ({
          client_msg_id: o.mesaj.client_msg_id,
          mesaj: o.mesaj,
          yollandi: o.yollandi,
        }));
        ogelerKirli = false;
      }
      return yayinOgeler;
    },

    hatalar: () => {
      if (hatalarKirli) {
        yayinHatalar = hataListesi.slice();
        hatalarKirli = false;
      }
      return yayinHatalar;
    },

    hataKapat: async (client_msg_id) => {
      const once = hataListesi.length;
      hataListesi = hataListesi.filter((h) => h.client_msg_id !== client_msg_id);
      if (hataListesi.length === once) return;
      bildir(false, true);
      await kaydet().catch(() => undefined);
    },

    sohbetIdUret: () => sayacKimligi("s", "sohbetIdUret"),

    medyaIdUret: () => sayacKimligi("m", "medyaIdUret"),

    // Bağlı değilken `gonderBekleyenler` hiçbir şey yapmaz; yollanmış öğe atlanır.
    hazirlikDegisti: () => {
      gonderBekleyenler();
    },

    bekleyeniKaldir: async (client_msg_id) => {
      const oge = liste.find((o) => o.mesaj.client_msg_id === client_msg_id);
      if (oge === undefined || oge.mesaj.type !== "user_message" || oge.yollandi || oge.denendi) return null;
      liste = liste.filter((o) => o !== oge);
      bildir(true, false);
      try {
        await kaydet();
      } finally {
        // Arkasında bekleyenler (aynı sohbetin mesajları, geçmiş silme) artık yürüyebilir; kaldırma
        // diske ulaşmadan yollanmazlar (çökmede kaldırılan mesaj onların arkasına düşmesin).
        gonderBekleyenler();
      }
      return oge.mesaj;
    },

    sohbetTikaliMi: (sohbet_id) =>
      liste.some(
        (o) => !o.denendi && mesajinSohbeti(o.mesaj) === sohbet_id && hazirlikSor(o.mesaj) === "bekliyor",
      ),

    // `async` gövdesi ilk `await`'e kadar eşzamanlı koşar: koşul çağrı anında değerlendirilir,
    // listeler hemen değişir; söz yalnız yazımı bekler.
    kaldir: async (kosul) => {
      // Önce hepsi hesaplanır: `kosul` atarsa hiçbir şey değişmez, söz reddedilir.
      const kalanOgeler = liste.filter((o) => geciciTurMu(o.mesaj) || !kosul(o.mesaj));
      const kalanHatalar = hataListesi.filter((h) => geciciTurMu(h.mesaj) || !kosul(h.mesaj));
      const kalanTutulanlar = tutulanlar.filter((m) => !kosul(m));
      const ogeSayisi = liste.length - kalanOgeler.length;
      const hataSayisi = hataListesi.length - kalanHatalar.length;
      const tutulanSayisi = tutulanlar.length - kalanTutulanlar.length;
      if (ogeSayisi + hataSayisi + tutulanSayisi === 0) return 0;
      // Kaldırılan yollanmış öğenin geç gelen `ack`'i bilinmeyen `ack` gibi `null` döner.
      liste = kalanOgeler;
      hataListesi = kalanHatalar;
      tutulanlar = kalanTutulanlar;
      // Tutulanlar görünür listelerde değil: yalnız onlar kalktıysa bildirim yok.
      if (ogeSayisi + hataSayisi > 0) bildir(ogeSayisi > 0, hataSayisi > 0);
      try {
        await kaydet();
      } finally {
        // Medya: kaldırılan öğe bir sohbeti tıkıyor olabilir; arkasındakiler yürüsün.
        if (ogeSayisi > 0) gonderBekleyenler();
      }
      return ogeSayisi + hataSayisi + tutulanSayisi;
    },

    bosalt: () => zincir,
  };
  return outbox;
};
