/**
 * Medya (U1): ek denetimi (`ekleriDenetle`, saf) ve yükleyici (`yukleyiciKur`). Kurallar
 * `sozlesme.ts` "Medya" bloğunda (`EkleriDenetle`, `Yukleyici`), davranış ../../TASARIM.md "Medya".
 *
 * Yükleyici platformsuzdur: dosyayı `MedyaDosyaPortu`'ndan, kaydı `DepoPortu`'ndan okur ve çerçeveyi
 * çağıranın verdiği `gonder` ile yollar. Kalıcı biçim bu dosyanındır (`v: 1`):
 * - `medya_yuklemeleri`: `{v, kayitlar: [{sohbet_id, bilgi, uri, onizleme_uri}]}` (bağlanmamış kayıtlar,
 *   `ekle` sırasıyla). Kaydın ilerlemesi kalıcı değildir: yeniden açılışta `bekliyor`'dan başlar.
 * - `medya_onizlemeleri`: `{v, onizlemeler: [{medya_id, sohbet_id, seq, onizleme_uri}]}` (mesaja
 *   bağlanmış eklerin önizleme dizini).
 * Tanınmayan sürüm, bozuk JSON ya da şemadan geçmeyen tek kayıt atılır; yükleme atmaz.
 *
 * Parça döngüsü: `media_begin` → `yukleniyor{alinan}` → `alinan`'dan en çok iki yanıtsız parça. Servis
 * her parçaya tam bir `media_state` döner (sırayla); her `yukleniyor` en eski yanıtsız parçayı kapatır.
 * Yanıt o parçanın beklenen sonu değilse kalan yanıtsız parçalar geçersiz sayılır (sonuçlarına
 * güvenilmez, yanıtları yine pencereden düşer) ve `alinan`'dan sürülür. `kabul`/`reddedildi` kaydın
 * yüklemesini kapatır, sıradaki eke geçilir. Günlüğe hiçbir şey yazılmaz (içerik, adres).
 */
import {
  EkBilgisi,
  MEDYA_MIME,
  MEDYA_SINIRLARI,
  MedyaId,
  SOHBET_SURUMU,
  SohbetId,
  type MedyaIslemeDurumu,
} from "@eren/protocol";
import { base64Kodla } from "./base64.ts";
import type {
  EkGorunumu,
  EkIlerlemesi,
  EkleriDenetle,
  EkRedi,
  MedyaYukari,
  MesajHazirligi,
  SeciliEk,
  Yukleyici,
  YukleyiciFabrikasi,
  YeniYukleme,
} from "./sozlesme.ts";

// =============================================================================================
// Ek denetimi (saf)
// =============================================================================================

const tamPozitifMi = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x >= 1;

export const ekleriDenetle: EkleriDenetle = (mevcut, yeni) => {
  const kabul: SeciliEk[] = [];
  const reddedilenler: EkRedi[] = [];
  const uriler = new Set<string>(mevcut.map((e) => e.uri));
  let videoVar = mevcut.some((e) => e.tur === "video");
  let adet = mevcut.length;
  for (const h of yeni) {
    const red = (neden: EkRedi["neden"]) => reddedilenler.push({ uri: h.uri, neden });
    const tur = h.tur;
    if (
      (tur !== "foto" && tur !== "video") ||
      h.mime === null ||
      !(MEDYA_MIME[tur] as readonly string[]).includes(h.mime)
    ) {
      red("tur_desteklenmiyor");
      continue;
    }
    if (!tamPozitifMi(h.boyut)) {
      red("okunamadi");
      continue;
    }
    if (uriler.has(h.uri)) {
      red("zaten_ekli");
      continue;
    }
    const video = tur === "video";
    if (video && h.sure_ms !== null && h.sure_ms > MEDYA_SINIRLARI.VIDEO_SURE_MS) {
      red("video_uzun");
      continue;
    }
    if (video && h.boyut > MEDYA_SINIRLARI.VIDEO_BAYT) {
      red("cok_buyuk");
      continue;
    }
    if (video && videoVar) {
      red("ikinci_video");
      continue;
    }
    if (adet >= MEDYA_SINIRLARI.EK_ADET) {
      red("adet_asildi");
      continue;
    }
    kabul.push({
      uri: h.uri,
      tur,
      mime: h.mime as SeciliEk["mime"],
      boyut: h.boyut,
      sure_ms: video ? h.sure_ms : null,
      genislik: h.genislik,
      yukseklik: h.yukseklik,
    });
    uriler.add(h.uri);
    adet++;
    if (video) videoVar = true;
  }
  return { ekler: [...mevcut, ...kabul], reddedilenler };
};

// =============================================================================================
// Yükleyici
// =============================================================================================

export const YUKLEME_ANAHTARI = "medya_yuklemeleri";
export const ONIZLEME_ANAHTARI = "medya_onizlemeleri";
const KAYIT_SURUMU = 1;
/** Kaydı olmayan kimliklerin canlı işleme bilgisi (sözleşme: en çok 64). */
const CANLI_ISLEME_AZAMI = 64;
/** Yanıtsız parça penceresi. */
const PENCERE = 2;

/** Kalıcı yükleme kaydı + canlı ilerleme. */
interface Kayit {
  sohbet_id: SohbetId;
  bilgi: EkBilgisi;
  uri: string;
  onizleme_uri: string | null;
  ilerleme: EkIlerlemesi;
}

interface Onizleme {
  medya_id: MedyaId;
  sohbet_id: SohbetId;
  seq: number;
  onizleme_uri: string | null;
}

/** Yollanmış, yanıtı beklenen parça. `gecerli: false`: yeniden eşlemeden önce yollanmış, sonucu güvenilmez. */
interface Ucan {
  son: number;
  gecerli: boolean;
}

/** Süren yükleme (bir kayıt, bir bağlantı). */
interface Aktif {
  medya_id: MedyaId;
  /** Okunacak sonraki ofset. */
  sonraki: number;
  ucanlar: Ucan[];
  okuyor: boolean;
}

const nesneMi = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const uriMi = (x: unknown): x is string => typeof x === "string" && x.length > 0;

function kayitCoz(ham: unknown): Omit<Kayit, "ilerleme"> | null {
  if (!nesneMi(ham)) return null;
  const sohbet = SohbetId.safeParse(ham["sohbet_id"]);
  const bilgi = EkBilgisi.safeParse(ham["bilgi"]);
  const uri = ham["uri"];
  const onizleme = ham["onizleme_uri"];
  if (!sohbet.success || !bilgi.success || !uriMi(uri)) return null;
  if (onizleme !== null && !uriMi(onizleme)) return null;
  return { sohbet_id: sohbet.data, bilgi: bilgi.data, uri, onizleme_uri: onizleme };
}

function onizlemeCoz(ham: unknown): Onizleme | null {
  if (!nesneMi(ham)) return null;
  const id = MedyaId.safeParse(ham["medya_id"]);
  const sohbet = SohbetId.safeParse(ham["sohbet_id"]);
  const seq = ham["seq"];
  const onizleme = ham["onizleme_uri"];
  if (!id.success || !sohbet.success) return null;
  if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 0) return null;
  if (onizleme !== null && !uriMi(onizleme)) return null;
  return { medya_id: id.data, sohbet_id: sohbet.data, seq, onizleme_uri: onizleme };
}

/** `{v: 1, <alan>: [...]}`; tanınmayan sürüm ya da bozuk JSON boş liste. */
function listeCoz(metin: string | null, alan: string): unknown[] {
  if (metin === null) return [];
  let ham: unknown;
  try {
    ham = JSON.parse(metin);
  } catch {
    return [];
  }
  if (!nesneMi(ham) || ham["v"] !== KAYIT_SURUMU) return [];
  const liste = ham[alan];
  return Array.isArray(liste) ? liste : [];
}

const yukleniyorMu = (k: Kayit) => k.ilerleme.durum === "yukleniyor";
const bitikMi = (k: Kayit) => k.ilerleme.durum === "reddedildi" || k.ilerleme.durum === "yerel_yok";

export const yukleyiciKur: YukleyiciFabrikasi = ({ depo, dosya, degisti }) => {
  /** Bağlanmamış kayıtlar, `ekle` sırasıyla (Map ekleme sırasını korur). */
  const kayitlar = new Map<MedyaId, Kayit>();
  const onizlemeler = new Map<MedyaId, Onizleme>();
  /** Kaydı olmayan kimliklerin son `isleme`'si (en çok `CANLI_ISLEME_AZAMI`, en eskisi düşer). */
  const canliIsleme = new Map<MedyaId, MedyaIslemeDurumu>();
  /** `ekle`'si sürmekte olan adresler: açılış süpürmesi bunlara dokunmaz. */
  const korunan = new Set<string>();

  let gonderFn: ((m: MedyaYukari) => boolean) | null = null;
  /** `gonder` `false` döndü: bu bağlantıda bir şey yollanmaz, kopma beklenir. */
  let durdu = false;
  /** Bu bağlantıda `media_begin`'i yollanmış kimlikler. */
  const soruldu = new Set<MedyaId>();
  let aktif: Aktif | null = null;
  /** Bağlantı ya da aktif yükleme değişince artar: süren okumanın sonucu atılır. */
  let nesil = 0;

  // --- Kalıcı yazım kuyruğu -----------------------------------------------------------------
  let kuyruk: Promise<void> = Promise.resolve();
  /** `is` sırayla koşar; sonucu çağırana döner, hatası kuyruğu bozmaz. */
  const sirala = <T>(is: () => Promise<T>): Promise<T> => {
    const sonuc = kuyruk.then(is);
    kuyruk = sonuc.then(
      () => undefined,
      () => undefined,
    );
    return sonuc;
  };

  const kayitlariYaz = (liste: readonly Kayit[]) =>
    depo.yaz(
      YUKLEME_ANAHTARI,
      JSON.stringify({
        v: KAYIT_SURUMU,
        kayitlar: liste.map((k) => ({
          sohbet_id: k.sohbet_id,
          bilgi: k.bilgi,
          uri: k.uri,
          onizleme_uri: k.onizleme_uri,
        })),
      }),
    );
  const onizlemeleriYaz = (liste: readonly Onizleme[]) =>
    depo.yaz(ONIZLEME_ANAHTARI, JSON.stringify({ v: KAYIT_SURUMU, onizlemeler: liste }));

  /** Dosyayı siler; düşerse açılış süpürmesi yeniden dener. */
  const sessizSil = async (uri: string | null): Promise<void> => {
    if (uri === null) return;
    try {
      await dosya.sil(uri);
    } catch {
      // kayıt yok: sonraki açılışta süpürülür
    }
  };

  // --- Gönderim -----------------------------------------------------------------------------
  /** Bağlı ve durmamışsa yollar; yazılamazsa durur. */
  const yolla = (m: MedyaYukari): boolean => {
    if (gonderFn === null || durdu) return false;
    if (gonderFn(m)) return true;
    durdu = true;
    aktif = null;
    nesil++;
    return false;
  };

  const sor = (id: MedyaId, k: Kayit): void => {
    if (soruldu.has(id)) return;
    if (!yolla({ v: SOHBET_SURUMU, type: "media_begin", sohbet_id: k.sohbet_id, ...k.bilgi })) return;
    soruldu.add(id);
  };

  const iptalYolla = (id: MedyaId): void => {
    yolla({ v: SOHBET_SURUMU, type: "media_cancel", medya_id: id });
  };

  const aktifiBirak = (): void => {
    aktif = null;
    nesil++;
  };

  const yerelYok = (id: MedyaId): void => {
    const k = kayitlar.get(id);
    if (aktif?.medya_id === id) aktifiBirak();
    if (k === undefined || k.ilerleme.durum === "yerel_yok") return;
    k.ilerleme = { durum: "yerel_yok" };
    iptalYolla(id);
    degisti();
    pompala();
  };

  /** Sıradaki parçayı okur ve yollar; pencere ya da dosya sonu durdurur. Okuma sürerken yeniden girmez. */
  function pompala(): void {
    if (gonderFn === null || durdu) return;
    if (aktif === null) {
      for (const [id, k] of kayitlar) {
        if (k.ilerleme.durum === "yukleniyor" && soruldu.has(id) && k.ilerleme.alinan < k.bilgi.boyut) {
          aktif = { medya_id: id, sonraki: k.ilerleme.alinan, ucanlar: [], okuyor: false };
          nesil++;
          break;
        }
      }
      if (aktif === null) return;
    }
    const a = aktif;
    const k = kayitlar.get(a.medya_id);
    if (k === undefined) {
      aktifiBirak();
      pompala();
      return;
    }
    if (a.okuyor || a.ucanlar.length >= PENCERE || a.sonraki >= k.bilgi.boyut) return;
    const ofset = a.sonraki;
    const uzunluk = Math.min(MEDYA_SINIRLARI.PARCA_BAYT, k.bilgi.boyut - ofset);
    const bu = nesil;
    a.okuyor = true;
    const gecersiz = () => aktif !== a || nesil !== bu;
    dosya.oku(k.uri, ofset, uzunluk).then(
      (baytlar) => {
        a.okuyor = false;
        if (gecersiz()) return pompala();
        // Okuma sürerken yeniden eşlendi: bu parça artık sırada değil.
        if (a.sonraki !== ofset) return pompala();
        // Dosya beyan edilen boyuttan kısa: yerel kopya bozuk.
        if (baytlar.length < uzunluk) return yerelYok(a.medya_id);
        const veri = base64Kodla(baytlar.length > uzunluk ? baytlar.subarray(0, uzunluk) : baytlar);
        if (!yolla({ v: SOHBET_SURUMU, type: "media_chunk", medya_id: a.medya_id, ofset, veri })) return;
        a.ucanlar.push({ son: ofset + uzunluk, gecerli: true });
        a.sonraki = ofset + uzunluk;
        pompala();
      },
      () => {
        a.okuyor = false;
        if (gecersiz()) return pompala();
        yerelYok(a.medya_id);
      },
    );
  }

  /** Aktif kaydın `yukleniyor{alinan}` yanıtı: en eski yanıtsız parçayı kapatır. */
  const yanitIsle = (a: Aktif, alinan: number): void => {
    const e = a.ucanlar.shift();
    if (e === undefined) {
      a.sonraki = alinan;
    } else if (e.gecerli) {
      if (alinan !== e.son) {
        for (const u of a.ucanlar) u.gecerli = false;
        a.sonraki = alinan;
      }
    } else if (!a.ucanlar.some((u) => u.gecerli)) {
      a.sonraki = alinan;
    }
  };

  const canliIslemeKoy = (id: MedyaId, isleme: MedyaIslemeDurumu): void => {
    canliIsleme.delete(id);
    canliIsleme.set(id, isleme);
    while (canliIsleme.size > CANLI_ISLEME_AZAMI) {
      const ilk = canliIsleme.keys().next();
      if (ilk.done === true) break;
      canliIsleme.delete(ilk.value);
    }
  };

  /** Açılış süpürmesi: hiçbir kaydın ya da önizlemenin anmadığı dosyalar. */
  const supur = async (): Promise<void> => {
    let dosyalar: readonly string[];
    try {
      dosyalar = await dosya.listele();
    } catch {
      return;
    }
    for (const uri of dosyalar) {
      const anilan = new Set<string>(korunan);
      for (const k of kayitlar.values()) {
        anilan.add(k.uri);
        if (k.onizleme_uri !== null) anilan.add(k.onizleme_uri);
      }
      for (const o of onizlemeler.values()) if (o.onizleme_uri !== null) anilan.add(o.onizleme_uri);
      if (!anilan.has(uri)) await sessizSil(uri);
    }
  };

  const yukleyici: Yukleyici = {
    async yukle() {
      const [hamK, hamO] = await Promise.all([depo.oku(YUKLEME_ANAHTARI), depo.oku(ONIZLEME_ANAHTARI)]);
      kayitlar.clear();
      onizlemeler.clear();
      for (const o of listeCoz(hamO, "onizlemeler")) {
        const c = onizlemeCoz(o);
        if (c !== null && !onizlemeler.has(c.medya_id)) onizlemeler.set(c.medya_id, c);
      }
      for (const h of listeCoz(hamK, "kayitlar")) {
        const c = kayitCoz(h);
        // Bağlandıktan sonra kayıt silinmeden süreç öldüyse önizleme kazanır (kayıt artığı).
        if (c === null || kayitlar.has(c.bilgi.medya_id) || onizlemeler.has(c.bilgi.medya_id)) continue;
        kayitlar.set(c.bilgi.medya_id, { ...c, ilerleme: { durum: "bekliyor" } });
      }
      void sirala(supur);
    },

    async ekle(yeniler) {
      const urilar: string[] = [];
      for (const y of yeniler) {
        urilar.push(y.uri);
        if (y.onizleme_uri !== null) urilar.push(y.onizleme_uri);
      }
      for (const u of urilar) korunan.add(u);
      try {
        await sirala(async () => {
          const eklenecek: [MedyaId, Kayit][] = [];
          const gorulen = new Set<MedyaId>();
          for (const y of yeniler) {
            const id = y.bilgi.medya_id;
            if (kayitlar.has(id) || onizlemeler.has(id) || gorulen.has(id)) continue;
            gorulen.add(id);
            eklenecek.push([id, yeniKayit(y)]);
          }
          if (eklenecek.length === 0) return;
          await kayitlariYaz([...kayitlar.values(), ...eklenecek.map(([, k]) => k)]);
          for (const [id, k] of eklenecek) kayitlar.set(id, k);
          degisti();
          for (const [id, k] of eklenecek) sor(id, k);
          pompala();
        });
      } finally {
        for (const u of urilar) korunan.delete(u);
      }
    },

    baglandi(gonder) {
      gonderFn = gonder;
      durdu = false;
      soruldu.clear();
      aktifiBirak();
      for (const [id, k] of kayitlar) if (!bitikMi(k)) sor(id, k);
    },

    koptu() {
      gonderFn = null;
      durdu = false;
      soruldu.clear();
      aktifiBirak();
      let degisen = false;
      for (const k of kayitlar.values()) {
        if (yukleniyorMu(k)) {
          k.ilerleme = { durum: "bekliyor" };
          degisen = true;
        }
      }
      if (degisen) degisti();
    },

    durum(s) {
      const k = kayitlar.get(s.medya_id);
      if (k === undefined) {
        if (s.durum === "kabul" && s.isleme !== undefined && canliIsleme.get(s.medya_id) !== s.isleme) {
          canliIslemeKoy(s.medya_id, s.isleme);
          degisti();
        }
        return;
      }
      // Yerel kopya yok: `media_cancel` gitti, geç gelen durum bunu değiştirmez.
      if (k.ilerleme.durum === "yerel_yok") return;
      const a = aktif?.medya_id === s.medya_id ? aktif : null;
      if (s.durum === "yukleniyor") {
        const alinan = s.alinan ?? 0;
        k.ilerleme = { durum: "yukleniyor", alinan, boyut: k.bilgi.boyut };
        if (a !== null) yanitIsle(a, alinan);
      } else {
        if (s.durum === "kabul") {
          const once = k.ilerleme.durum === "kabul" ? k.ilerleme.isleme : null;
          k.ilerleme = { durum: "kabul", isleme: s.isleme ?? once };
        } else {
          k.ilerleme = { durum: "reddedildi", kod: s.code ?? "medya_reddedildi" };
        }
        if (a !== null) aktifiBirak();
      }
      degisti();
      pompala();
    },

    hazirlik(medya_idler): MesajHazirligi {
      let bekliyor = false;
      let yerel = false;
      for (const id of medya_idler) {
        const k = kayitlar.get(id);
        if (k === undefined) continue;
        const i = k.ilerleme;
        if (i.durum === "reddedildi") return { hata: i.kod };
        if (i.durum === "yerel_yok") yerel = true;
        else if (i.durum !== "kabul") bekliyor = true;
      }
      if (yerel) return { hata: "ek_bulunamadi" };
      return bekliyor ? "bekliyor" : "hazir";
    },

    mesajaBaglandi(medya_id, seq) {
      return sirala(async () => {
        const k = kayitlar.get(medya_id);
        if (k === undefined) return;
        const o: Onizleme = { medya_id, sohbet_id: k.sohbet_id, seq, onizleme_uri: k.onizleme_uri };
        // Önce dizin, sonra kayıt: arada ölürse yüklemede önizleme kazanır.
        await onizlemeleriYaz([...onizlemeler.values(), o]);
        onizlemeler.set(medya_id, o);
        await kayitlariYaz([...kayitlar.values()].filter((x) => x.bilgi.medya_id !== medya_id));
        kayitlar.delete(medya_id);
        if (k.ilerleme.durum === "kabul" && k.ilerleme.isleme !== null) canliIslemeKoy(medya_id, k.ilerleme.isleme);
        if (aktif?.medya_id === medya_id) aktifiBirak();
        degisti();
        pompala();
        if (k.uri !== k.onizleme_uri) await sessizSil(k.uri);
      });
    },

    iptal(medya_idler) {
      return sirala(async () => {
        const silinecek = new Set(medya_idler.filter((id) => kayitlar.has(id)));
        if (silinecek.size === 0) return;
        await kayitlariYaz([...kayitlar.values()].filter((k) => !silinecek.has(k.bilgi.medya_id)));
        const giden: Kayit[] = [];
        for (const id of silinecek) {
          giden.push(kayitlar.get(id)!);
          kayitlar.delete(id);
          if (aktif?.medya_id === id) aktifiBirak();
          iptalYolla(id);
        }
        degisti();
        pompala();
        for (const k of giden) {
          await sessizSil(k.uri);
          if (k.onizleme_uri !== k.uri) await sessizSil(k.onizleme_uri);
        }
      });
    },

    sohbetiTemizle(sohbet_id, sinir_seq) {
      return sirala(() => onizlemeleriSil((o) => o.sohbet_id === sohbet_id && o.seq <= sinir_seq));
    },

    async sohbetSilindi(sohbet_id) {
      await sirala(() => onizlemeleriSil((o) => o.sohbet_id === sohbet_id));
      const idler = [...kayitlar.values()].filter((k) => k.sohbet_id === sohbet_id).map((k) => k.bilgi.medya_id);
      await yukleyici.iptal(idler);
    },

    sifirla() {
      return sirala(() => onizlemeleriSil(() => true));
    },

    gorunum(medya_id): EkGorunumu | null {
      const k = kayitlar.get(medya_id);
      if (k !== undefined) return { onizleme_uri: k.onizleme_uri, ilerleme: k.ilerleme };
      const o = onizlemeler.get(medya_id);
      const isleme = canliIsleme.get(medya_id);
      if (o === undefined && isleme === undefined) return null;
      return {
        onizleme_uri: o?.onizleme_uri ?? null,
        ilerleme: isleme === undefined ? null : { durum: "kabul", isleme },
      };
    },

    bekleyenSayisi() {
      let n = 0;
      for (const k of kayitlar.values()) if (!bitikMi(k)) n++;
      return n;
    },

    bosalt() {
      return kuyruk;
    },
  };

  function yeniKayit(y: YeniYukleme): Kayit {
    return {
      sohbet_id: y.sohbet_id,
      bilgi: y.bilgi,
      uri: y.uri,
      onizleme_uri: y.onizleme_uri,
      ilerleme: { durum: "bekliyor" },
    };
  }

  /** Koşulu tutan önizlemeleri dizinden ve diskten siler. Sıralı kuyruğun içinden çağrılır. */
  async function onizlemeleriSil(kosul: (o: Onizleme) => boolean): Promise<void> {
    const giden = [...onizlemeler.values()].filter(kosul);
    if (giden.length === 0) return;
    await onizlemeleriYaz([...onizlemeler.values()].filter((o) => !kosul(o)));
    for (const o of giden) {
      onizlemeler.delete(o.medya_id);
      canliIsleme.delete(o.medya_id);
    }
    degisti();
    for (const o of giden) await sessizSil(o.onizleme_uri);
  }

  return yukleyici;
};
