import {
  AJANDA_RET_NEDENLERI,
  type AjandaKaydi,
  type AjandaRetNedeni,
  type AjandaRevIzi,
  ajandaRetGeciciMi,
  hatirlatmaEtkinMi,
  type KayitDurumu,
  kullaniciEmriMi,
  type KaynakYolu,
  type TurKokeni,
} from "./ajanda.ts";
import { gunNoTarih, ornekGunuMu, tarihGunNo, tekrarOrnekleri } from "./ajanda-zaman.ts";
import { AJANDA_SINIRLARI } from "./sinirlar.ts";

/**
 * Ajandanın servis ve uygulamada aynı sonucu vermesi gereken saf kararları: hangi hatırlatmanın
 * kurulacağı, tekilleştirme, telafi kipi, modelin "şimdi" dayanağı, örnek durumu. Saat dilimi
 * veritabanı kullanılmaz: duvar saatinden ana çeviri çağırandan gelir (`AnCevirici`; uygulamada
 * java.time `ZonedDateTime.of`, serviste aynı kural). Vektörler sabit ofsetli dilimlerle sınar.
 */

/** Yerel duvar saatini (`tarih`, `saat`, IANA dilimi) epoch milisaniyesine çevirir. */
export type AnCevirici = (tarih: string, saat: string, saat_dilimi: string) => number;

const DAKIKA_MS = 60_000;
const GUN_MS = 86_400_000;

/** Bir hatırlatmanın şimdiye göre hali: kurulur (tetik gelecekte), saatsiz (bekler), geçmiş (çalmaz). */
export type HatirlatmaHali =
  | { sira: number; hal: "kurulur"; tetik_ms: number; ornek_tarihi?: string }
  | { sira: number; hal: "saatsiz" }
  | { sira: number; hal: "gecmis" };

function seriSonrakiTetik(
  kayit: AjandaKaydi,
  dk: number,
  simdiMs: number,
  anCevir: AnCevirici,
): { tetik_ms: number; ornek_tarihi: string } | undefined {
  const z = kayit.zaman;
  if (z === undefined || z.kesinlik !== "an" || kayit.tekrar === undefined) return undefined;
  // Tetiği şimdiden sonra olan örnek şimdinin UTC gününden en çok 1 gün önce başlar; 2 gün pay.
  const enAz = gunAlti(Math.floor(simdiMs / GUN_MS) - 2);
  const kapali = new Set(kayit.ornekler.map((o) => o.tarih));
  for (const gun of tekrarOrnekleri(z.tarih, kayit.tekrar, enAz)) {
    if (kapali.has(gun)) continue;
    const tetik = anCevir(gun, z.saat, z.saat_dilimi) - dk * DAKIKA_MS;
    if (tetik > simdiMs) return { tetik_ms: tetik, ornek_tarihi: gun };
  }
  return undefined;
}

/**
 * Kaydın her hatırlatmasının şimdiye göre hali (etkinlikten bağımsız). Kural tek anlamlıdır:
 * - `mutlak`: tetik kendi anı; tetik > şimdi ise kurulur, değilse geçmiş (bir kez, tekrarda da).
 * - `once`, zaman kesinliği `an` değil: saatsiz, bekler.
 * - `once`, tekrarsız: tetik = olayın anı − dk; tetik > şimdi ise kurulur, değilse geçmiş.
 * - `once`, tekrarlı: `ornekler`'de kapalı olmayan, tetiği şimdiden sonraki ilk örnek; yoksa geçmiş.
 * `gecmis` kurulmaz. Kurulmuş ama teslim edilmemiş bir alarmın tetiği geçtiyse (telefon kapalıydı,
 * yeniden başladı, kurulum tam o anda yenilendi) onu `kacirilanHatirlatmalar` söyler; hiç kurulmamış
 * (doğduğunda ya da değiştiğinde tetiği zaten geçmiş) hatırlatma hiç çalmaz.
 */
export function hatirlatmaHalleri(kayit: AjandaKaydi, simdiMs: number, anCevir: AnCevirici): HatirlatmaHali[] {
  return kayit.hatirlatmalar.map((h, sira): HatirlatmaHali => {
    if (h.tur === "mutlak") {
      const tetik = anCevir(h.tarih, h.saat, h.saat_dilimi);
      return tetik > simdiMs ? { sira, hal: "kurulur", tetik_ms: tetik } : { sira, hal: "gecmis" };
    }
    const z = kayit.zaman;
    if (z === undefined || z.kesinlik !== "an") return { sira, hal: "saatsiz" };
    if (kayit.tekrar !== undefined) {
      const s = seriSonrakiTetik(kayit, h.dk, simdiMs, anCevir);
      return s === undefined ? { sira, hal: "gecmis" } : { sira, hal: "kurulur", ...s };
    }
    const tetik = anCevir(z.tarih, z.saat, z.saat_dilimi) - h.dk * DAKIKA_MS;
    return tetik > simdiMs ? { sira, hal: "kurulur", tetik_ms: tetik } : { sira, hal: "gecmis" };
  });
}

/**
 * Uygulamanın kurduğu alarmlar: `hatirlatmaEtkinMi` doğruysa `kurulur` halindekiler, değilse hiçbiri.
 * Uygulama her kayıt değişikliğinde, tam eşitlemenin sonunda, açılışta, yeniden başlatmada ve saat ya
 * da dilim değişiminde kaydın alarmlarını bununla yeniden kurar; tekrarda bir örnek çalınca sıradakine
 * geçer. Alarmın kimliği `(kayit_id, tetik_ms)`'dir (aynı tetikli iki hatırlatma tek bildirim); uygulama
 * kurduğu kimlikleri teslim edilene dek kalıcı saklar (`kacirilanHatirlatmalar`).
 */
export function kurulacakHatirlatmalar(
  kayit: AjandaKaydi,
  simdiMs: number,
  anCevir: AnCevirici,
): Extract<HatirlatmaHali, { hal: "kurulur" }>[] {
  if (!hatirlatmaEtkinMi(kayit)) return [];
  return hatirlatmaHalleri(kayit, simdiMs, anCevir).filter((h) => h.hal === "kurulur");
}

export type KacirilanHatirlatma = { sira: number; tetik_ms: number; ornek_tarihi?: string };

/**
 * Kaçırılan hatırlatmalar: tetiği `(şimdi − KACIRILAN_PENCERE_DK, şimdi]` içinde olan ve `kurulanlar`da
 * bulunan (uygulamanın bu kayıt için kurup henüz teslim etmediği alarmların `tetik_ms`'i) her tetik;
 * `hatirlatmaEtkinMi` yanlışsa hiçbiri. Tekrarda kapalı örnek atlanır, pencereye düşen her örnek ayrı
 * satırdır. Uygulama yeniden kurulumda (açılış, yeniden başlatma, kayıt değişikliği, tam eşitlemenin
 * sonu) bunları hemen bir kez gösterir (birden çoksa tek özet bildirimde), teslim edildi işaretler;
 * pencereden eski ya da artık kayıtta olmayan kurulu kimlikleri sessizce siler. Böylece yeniden
 * kurulumda bildirim yağmuru olmaz, hiç kurulmamış geçmiş hatırlatma çalmaz, kurulmuş olan kaybolmaz.
 * `şimdi`den sonraki tetik `kurulacakHatirlatmalar`'ındır: iki işlev aynı tetiği iki kez vermez.
 */
export function kacirilanHatirlatmalar(
  kayit: AjandaKaydi,
  simdiMs: number,
  anCevir: AnCevirici,
  kurulanlar: readonly number[],
): KacirilanHatirlatma[] {
  if (!hatirlatmaEtkinMi(kayit) || kurulanlar.length === 0) return [];
  const kurulu = new Set(kurulanlar);
  const altMs = simdiMs - AJANDA_SINIRLARI.KACIRILAN_PENCERE_DK * DAKIKA_MS;
  const sonuc: KacirilanHatirlatma[] = [];
  const dene = (sira: number, tetik_ms: number, ornek_tarihi?: string) => {
    if (tetik_ms <= altMs || tetik_ms > simdiMs || !kurulu.has(tetik_ms)) return;
    sonuc.push(ornek_tarihi === undefined ? { sira, tetik_ms } : { sira, tetik_ms, ornek_tarihi });
  };
  const z = kayit.zaman;
  kayit.hatirlatmalar.forEach((h, sira) => {
    if (h.tur === "mutlak") return dene(sira, anCevir(h.tarih, h.saat, h.saat_dilimi));
    if (z === undefined || z.kesinlik !== "an") return;
    if (kayit.tekrar === undefined) return dene(sira, anCevir(z.tarih, z.saat, z.saat_dilimi) - h.dk * DAKIKA_MS);
    const kapali = new Set(kayit.ornekler.map((o) => o.tarih));
    const enAz = gunAlti(Math.floor((altMs + h.dk * DAKIKA_MS) / GUN_MS) - 2);
    for (const gun of tekrarOrnekleri(z.tarih, kayit.tekrar, enAz)) {
      const tetik = anCevir(gun, z.saat, z.saat_dilimi) - h.dk * DAKIKA_MS;
      if (tetik > simdiMs) break;
      if (!kapali.has(gun)) dene(sira, tetik, gun);
    }
  });
  return sonuc;
}

/** Tekrar taramasının alt günü; `YIL_MIN`'den önceyse sınırsız (çapadan). */
function gunAlti(gunNo: number): string | undefined {
  return gunNo < tarihGunNo(`${AJANDA_SINIRLARI.YIL_MIN}-01-01`) ? undefined : gunNoTarih(gunNo);
}

/** Araç çıktısının hatırlatma özeti: `kurulacak` etkinlik dahil, öteki sayılar etkinlikten bağımsız. */
export function hatirlatmaOzeti(
  kayit: AjandaKaydi,
  simdiMs: number,
  anCevir: AnCevirici,
): { toplam: number; kurulacak: number; saatsiz: number; gecmis: number } {
  const haller = hatirlatmaHalleri(kayit, simdiMs, anCevir);
  const say = (hal: HatirlatmaHali["hal"]) => haller.filter((h) => h.hal === hal).length;
  return {
    toplam: haller.length,
    kurulacak: hatirlatmaEtkinMi(kayit) ? say("kurulur") : 0,
    saatsiz: say("saatsiz"),
    gecmis: say("gecmis"),
  };
}

// Tekilleştirme

export type TekilKarari = { karar: "ekle" } | { karar: "zaten_var"; sira: number } | { karar: "onayla"; sira: number };

/**
 * Otomatik eklemede aynı tekil anahtarlı eşler (`esler`, oluşturma sırasıyla) varken ne yapılır.
 * - Kullanıcı emri (`kullaniciEmriMi`): yalnız açık (`acik`, silinmemiş) eş engeller. Eş taslaksa
 *   kullanıcı aynı şeyi sohbetten istemiştir: taslak onaylanır (`onayla`). Bitmiş, iptal ya da
 *   silinmiş eş yeni isteği engellemez (`ekle`).
 * - Emir olmayan otomasyon (sentetik tur, arka plan çıkarımı): her eş engeller, silinmiş ve bitmiş
 *   olan da: kullanıcının sildiği ya da bitirdiği kaydı otomasyon yeniden yaratmaz. Hiçbir şeyi onaylamaz.
 */
export function ajandaTekilKarari(
  esler: readonly Pick<AjandaKaydi, "silindi" | "durum" | "taslak">[],
  yazar: { yol: KaynakYolu; tur_kokeni: TurKokeni },
): TekilKarari {
  const acik = esler.findIndex((e) => !e.silindi && e.durum === "acik");
  if (kullaniciEmriMi(yazar)) {
    if (acik < 0) return { karar: "ekle" };
    return esler[acik]!.taslak ? { karar: "onayla", sira: acik } : { karar: "zaten_var", sira: acik };
  }
  if (esler.length === 0) return { karar: "ekle" };
  return { karar: "zaten_var", sira: acik < 0 ? 0 : acik };
}

// Telafi

/**
 * `welcome.tam`. Doğru ise uygulama sunucu kopyasını atar. Tam telafi şu hallerde:
 * `depo_id` yok ya da farklı; `son_rev > bas_rev`; `son_rev` > 0 iken iz yok; servisin geçmişinde
 * `son_rev` satırı yok (`izdeki` yok) ya da satırın kaydı ve zamanı izle tutmuyor. Son koşul, aynı
 * `depo_id`'yle yedekten geri yüklenip revizyon numaraları yeniden kullanılınca ayrışmayı yakalar.
 */
export function ajandaTelafiTamMi(g: {
  hello: { son_rev: number; depo_id?: string | undefined; son_rev_izi?: AjandaRevIzi | undefined };
  depo_id: string;
  bas_rev: number;
  /** Servis geçmişinde `rev` = `hello.son_rev` satırının kaydı ve `ts_ms`'i. */
  izdeki?: { kayit_id: string; ts_ms: number } | undefined;
}): boolean {
  const { hello } = g;
  if (hello.depo_id === undefined || hello.depo_id !== g.depo_id) return true;
  if (hello.son_rev > g.bas_rev) return true;
  if (hello.son_rev === 0) return false;
  const iz = hello.son_rev_izi;
  if (iz === undefined || g.izdeki === undefined) return true;
  return iz.kayit_id !== g.izdeki.kayit_id || iz.guncelleme_ms !== g.izdeki.ts_ms;
}

// Modelin dayanağı: turun mesaj anı

/** Yerel an: tarih, duvar saati ve IANA dilimi (`AjandaYerelAn` ile aynı biçim). */
export type YerelAn = { tarih: string; saat: string; saat_dilimi: string };

const dakikaNo = (saat: string) => Number(saat.slice(0, 2)) * 60 + Number(saat.slice(3, 5));

/**
 * Modelin göreli zamanı çözerken dayandığı an (`dayanak`) kabul edilir mi. Göreli ifade ("yarın",
 * "bu akşam", "1 saat sonra") kullanıcının mesajının servise ulaştığı ana göre çözülür: oturum meşgul
 * ya da uykudaysa mesaj ana oturuma geç iletilebilir, araç çağrısı daha da sonra gelir; ikisi de
 * dayanak olamaz. `mesajAni`, turun mesaj anının kullanıcının dilimindeki yerel halidir (varışta bir
 * kez hesaplanıp saklanır; damga da aynı değerden yazılır: `mesajAniDamgasi`).
 * Kural duvar saatiyle, dilim veritabanısız: `dayanak.saat_dilimi` verilmişse mesaj anınınkiyle aynı,
 * `dayanak.tarih` mesaj anının yerel günüyle aynı ve saat farkı en çok `DAYANAK_SAPMA_DK`. Gün
 * eşitliği şarttır: 23:58'de yazılıp 00:01'de iletilen mesajda 00:01 dayanağı (ertesi gün) reddedilir.
 * Değilse servis kayıt yazmaz, `dayanak_uyusmuyor` ve mesaj anını döner.
 */
export function dayanakGecerliMi(
  dayanak: { tarih: string; saat: string; saat_dilimi?: string | undefined },
  mesajAni: YerelAn,
): boolean {
  if (dayanak.saat_dilimi !== undefined && dayanak.saat_dilimi !== mesajAni.saat_dilimi) return false;
  if (dayanak.tarih !== mesajAni.tarih) return false;
  return Math.abs(dakikaNo(dayanak.saat) - dakikaNo(mesajAni.saat)) <= AJANDA_SINIRLARI.DAYANAK_SAPMA_DK;
}

// Örnek durumu

export type OrnekDurumuSonucu =
  | { ok: true; ornekler: AjandaKaydi["ornekler"]; degisti: boolean; atilan: AjandaKaydi["ornekler"] }
  | { ok: false; neden: "ornek_gecersiz" };

/**
 * `durum` işleminin `ornek_tarihi`'li hali (servis ve uygulamanın iyimser uygulaması). Tekrarsız
 * kayıtta ya da serinin günü olmayan tarihte `ornek_gecersiz`. `acik` satırı kaldırır; `tamam`/`iptal`
 * ekler ya da değiştirir. Satır sayısı `ORNEK_ADET`'i aşarsa `bugun`'den (kaydın dilimindeki yerel gün)
 * önceki en eski satırlar atılır: geçmiş örneğin hatırlatması zaten çalmaz, değişiklik geçmişte durur.
 * Yine aşılıyorsa (hepsi bugün ya da sonrası) `ornek_gecersiz`.
 */
export function ajandaOrnekDurumuUygula(
  kayit: AjandaKaydi,
  ornek_tarihi: string,
  durum: KayitDurumu,
  bugun: string,
): OrnekDurumuSonucu {
  const z = kayit.zaman;
  if (kayit.tekrar === undefined || z === undefined || !("tarih" in z) || !ornekGunuMu(z.tarih, kayit.tekrar, ornek_tarihi)) {
    return { ok: false, neden: "ornek_gecersiz" };
  }
  const simdiki = kayit.ornekler.find((o) => o.tarih === ornek_tarihi);
  if (durum === "acik") {
    if (simdiki === undefined) return { ok: true, ornekler: [...kayit.ornekler], degisti: false, atilan: [] };
    return { ok: true, ornekler: kayit.ornekler.filter((o) => o !== simdiki), degisti: true, atilan: [] };
  }
  if (simdiki?.durum === durum) return { ok: true, ornekler: [...kayit.ornekler], degisti: false, atilan: [] };
  const ornekler = [...kayit.ornekler.filter((o) => o.tarih !== ornek_tarihi), { tarih: ornek_tarihi, durum }].sort(
    (a, b) => (a.tarih < b.tarih ? -1 : a.tarih > b.tarih ? 1 : 0),
  );
  // Az önce değişen satır atılmaz; ondan başka, bugünden önceki en eski satırlar atılır.
  const atilan: AjandaKaydi["ornekler"] = [];
  for (let i = 0; ornekler.length - atilan.length > AJANDA_SINIRLARI.ORNEK_ADET && i < ornekler.length; i++) {
    const o = ornekler[i]!;
    if (o.tarih >= bugun) break;
    if (o.tarih !== ornek_tarihi) atilan.push(o);
  }
  if (ornekler.length - atilan.length > AJANDA_SINIRLARI.ORNEK_ADET) return { ok: false, neden: "ornek_gecersiz" };
  return { ok: true, ornekler: ornekler.filter((o) => !atilan.includes(o)), degisti: true, atilan };
}

// Uygulamanın işlem kuyruğu

/** Uygulamanın ret listesindeki nedenler: servisin retleri ve deneme sınırında `teslim_edilemedi`. */
export const AJANDA_KUYRUK_RET_NEDENLERI = [...AJANDA_RET_NEDENLERI, "teslim_edilemedi"] as const;
export type AjandaKuyrukRetNedeni = (typeof AJANDA_KUYRUK_RET_NEDENLERI)[number];

/**
 * Kuyruğun başındaki işlemin başına gelen:
 * - `sonuc`: `islem_sonucu` geldi.
 * - `kopma`: işlem yollandı, sonucu gelmeden bağlantı koptu (servis çerçeveyi reddedip kapatsa da).
 *   Yollanmadan kopmak olay değildir.
 * - `tam_telafi`: `welcome.tam` geldi.
 */
export type AjandaKuyrukOlayi =
  | { olay: "sonuc"; ok: true }
  | { olay: "sonuc"; ok: false; code: AjandaRetNedeni }
  | { olay: "kopma" }
  | { olay: "tam_telafi" };

/**
 * - `cikar`: kuyruktan çıkar; iyimser değişiklik ilgili `kayit` gelince yerini gerçeğe bırakır.
 * - `bekle`: kuyruğun başında kalır, `deneme` saklanır, sonra aynı `islem_id` ile yeniden yollanır.
 * - `ret_listesi`: kuyruktan çıkar, iyimser değişiklik geri alınır, işlem içeriği ve nedeniyle
 *   kullanıcının gördüğü ret listesine geçer (düzeltip yeniden ekler ya da atar); arkasındakiler gider.
 */
export type AjandaKuyrukKarari =
  | { karar: "cikar" }
  | { karar: "bekle"; deneme: number }
  | { karar: "ret_listesi"; neden: AjandaKuyrukRetNedeni };

/**
 * Kuyruğun başındaki işlemle ne yapılır. `deneme`: işlemin şimdiye dek sonuçsuz (geçici ret ya da
 * kopma) denemesi, kuyrukla birlikte kalıcı saklanır. Kural:
 * - Başarı çıkarır; kalıcı ret (`gecersiz_islem` dahil) ret listesine yollar.
 * - Geçici ret ve kopma denemeyi artırır; `ISLEM_DENEME`'ye varınca işlem ret listesine geçer (geçici
 *   retle `ic_hata`, kopmayla `teslim_edilemedi`). Tek işlem kuyruğu kalıcı olarak tıkayamaz.
 * - Tam telafi hiçbir işlemi atmaz: yollanmış ama sonucu gelmemiş işlem de kuyrukta kalır, taze
 *   kopya üstüne yeniden iyimser uygulanır ve `esitlendi`'den sonra aynı `islem_id` ile yollanır
 *   (servis tekrarsızdır: uygulanmışsa aynı sonucu döner). İşlem kuyruktan yalnız `cikar` ya da
 *   `ret_listesi` ile çıkar; hiçbir yolda sessizce kaybolmaz.
 */
export function ajandaKuyrukKarari(olay: AjandaKuyrukOlayi, deneme: number): AjandaKuyrukKarari {
  if (olay.olay === "tam_telafi") return { karar: "bekle", deneme };
  if (olay.olay === "sonuc" && olay.ok) return { karar: "cikar" };
  if (olay.olay === "sonuc" && !olay.ok && !ajandaRetGeciciMi(olay.code)) return { karar: "ret_listesi", neden: olay.code };
  const neden: AjandaKuyrukRetNedeni = olay.olay === "kopma" ? "teslim_edilemedi" : olay.code;
  return deneme + 1 >= AJANDA_SINIRLARI.ISLEM_DENEME ? { karar: "ret_listesi", neden } : { karar: "bekle", deneme: deneme + 1 };
}

// Uygulamanın sunucu kopyası ve eşitleme

/** Eşitlemenin baktığı alanlar (kopya tam `AjandaKaydi` tutar). */
export type AjandaKopyaKaydi = Pick<AjandaKaydi, "kayit_id" | "revizyon" | "guncelleme_ms">;

/**
 * Uygulamanın sunucu kopyası. `kayitlar` görünen ve alarmları kurulan kopyadır. `tam`: süren tam
 * telafinin topladıkları; `esitlendi`'de kopyanın yerine geçer, kopmada atılır.
 */
export type AjandaKopya<K extends AjandaKopyaKaydi = AjandaKaydi> = {
  depo_id?: string;
  son_rev: number;
  kayitlar: ReadonlyMap<string, K>;
  tam?: { depo_id: string; son_rev: number; kayitlar: ReadonlyMap<string, K> };
};

export type AjandaEsitlemeOlayi<K extends AjandaKopyaKaydi = AjandaKaydi> =
  | { olay: "welcome"; depo_id: string; tam: boolean }
  | { olay: "kayit"; kayit: K }
  | { olay: "esitlendi" }
  | { olay: "kopma" };

function kopyaKur<K extends AjandaKopyaKaydi>(
  depo_id: string | undefined,
  son_rev: number,
  kayitlar: ReadonlyMap<string, K>,
  tam?: AjandaKopya<K>["tam"],
): AjandaKopya<K> {
  const k: AjandaKopya<K> = { son_rev, kayitlar };
  if (depo_id !== undefined) k.depo_id = depo_id;
  if (tam !== undefined) k.tam = tam;
  return k;
}

/** `kayit` çerçevesi: yalnız revizyonu yereldekinden büyükse uygulanır; `son_rev` her çerçevede ilerler. */
function kayitUygula<K extends AjandaKopyaKaydi>(
  kayitlar: ReadonlyMap<string, K>,
  son_rev: number,
  kayit: K,
): { kayitlar: ReadonlyMap<string, K>; son_rev: number } {
  const yeniRev = Math.max(son_rev, kayit.revizyon);
  const eski = kayitlar.get(kayit.kayit_id);
  if (eski !== undefined && eski.revizyon >= kayit.revizyon) return { kayitlar, son_rev: yeniRev };
  const yeni = new Map(kayitlar);
  yeni.set(kayit.kayit_id, kayit);
  return { kayitlar: yeni, son_rev: yeniRev };
}

/**
 * Uygulamanın `/ajanda` eşitlemesinin bir adımı (girdi değişmez, yeni kopya döner).
 * - `welcome` `tam` değil: kopya sürer, `kayit`'ler doğrudan uygulanır (kopma ortada olsa da sürer).
 * - `welcome` `tam`: kopya, kurulu alarmlar, `son_rev`, `depo_id` olduğu gibi kalır; gelenler `tam`'da
 *   toplanır. `esitlendi`'de toplanan kopyanın yerine geçer (gelmeyen kayıt düşer), alarmlar yeniden
 *   kurulur. Kopma toplananı atar: telafi yarıda kesilse de görünen kayıtlar ve kurulu hatırlatmalar
 *   kaybolmaz, sonraki `hello` eski kopyanın iziyle gider ve servis tam telafiyi yeniden başlatır.
 */
export function ajandaEsitlemeAdimi<K extends AjandaKopyaKaydi>(
  d: AjandaKopya<K>,
  o: AjandaEsitlemeOlayi<K>,
): AjandaKopya<K> {
  switch (o.olay) {
    case "welcome":
      return o.tam
        ? kopyaKur(d.depo_id, d.son_rev, d.kayitlar, { depo_id: o.depo_id, son_rev: 0, kayitlar: new Map() })
        : kopyaKur(o.depo_id, d.son_rev, d.kayitlar);
    case "kayit": {
      if (d.tam === undefined) {
        const s = kayitUygula(d.kayitlar, d.son_rev, o.kayit);
        return kopyaKur(d.depo_id, s.son_rev, s.kayitlar);
      }
      const s = kayitUygula(d.tam.kayitlar, d.tam.son_rev, o.kayit);
      return kopyaKur(d.depo_id, d.son_rev, d.kayitlar, { depo_id: d.tam.depo_id, son_rev: s.son_rev, kayitlar: s.kayitlar });
    }
    case "esitlendi":
      return d.tam === undefined ? d : kopyaKur(d.tam.depo_id, d.tam.son_rev, d.tam.kayitlar);
    case "kopma":
      return kopyaKur(d.depo_id, d.son_rev, d.kayitlar);
  }
}

/**
 * `hello`'nun telafi alanları, yalnız görünen kopyadan (süren tam telafinin topladığı girmez):
 * `son_rev`, varsa `depo_id`, `son_rev` > 0 iken revizyonu `son_rev` olan kaydın izi.
 */
export function ajandaHelloAlanlari(d: AjandaKopya<AjandaKopyaKaydi>): {
  son_rev: number;
  depo_id?: string;
  son_rev_izi?: AjandaRevIzi;
} {
  const alanlar: { son_rev: number; depo_id?: string; son_rev_izi?: AjandaRevIzi } = { son_rev: d.son_rev };
  if (d.depo_id !== undefined) alanlar.depo_id = d.depo_id;
  if (d.son_rev > 0) {
    for (const k of d.kayitlar.values()) {
      if (k.revizyon === d.son_rev) alanlar.son_rev_izi = { kayit_id: k.kayit_id, guncelleme_ms: k.guncelleme_ms };
    }
  }
  return alanlar;
}
