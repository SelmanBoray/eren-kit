import {
  type AjandaKaydi,
  type AjandaRevIzi,
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
  const enAzNo = Math.floor(simdiMs / GUN_MS) - 2;
  const enAz = enAzNo < tarihGunNo(`${AJANDA_SINIRLARI.YIL_MIN}-01-01`) ? undefined : gunNoTarih(enAzNo);
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
 * Geçmişte kalan hiçbir hatırlatma çalmaz: tam eşitlemede, yeniden kurulumda ya da geçmiş bir kaydın
 * düzeltilmesinde de.
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
 * Uygulama her kayıt değişikliğinde, tam eşitlemede, açılışta, yeniden başlatmada ve saat ya da dilim
 * değişiminde kaydın alarmlarını bununla yeniden kurar; tekrarda bir örnek çalınca sıradakine geçer.
 */
export function kurulacakHatirlatmalar(
  kayit: AjandaKaydi,
  simdiMs: number,
  anCevir: AnCevirici,
): Extract<HatirlatmaHali, { hal: "kurulur" }>[] {
  if (!hatirlatmaEtkinMi(kayit)) return [];
  return hatirlatmaHalleri(kayit, simdiMs, anCevir).filter((h) => h.hal === "kurulur");
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

// Modelin şimdi dayanağı

/**
 * Modelin göreli zamanı çözerken dayandığı şimdi (`dayanak`, dilimiyle ana çevrilmiş) kabul edilir mi:
 * turun başladığı andan `DAYANAK_SAPMA_DK` öncesi ile çağrı anından `DAYANAK_SAPMA_DK` sonrası arası.
 * Tur başlangıcı turu başlatan mesajın servise varışıdır; gece yarısında başlayan turda o anın
 * dayanağı ("yarın" = mesajın ertesi günü) geçerli kalır. Değilse servis `simdi_uyusmuyor` döner.
 */
export function dayanakGecerliMi(dayanakMs: number, turBaslangicMs: number, cagriMs: number): boolean {
  const pay = AJANDA_SINIRLARI.DAYANAK_SAPMA_DK * DAKIKA_MS;
  return dayanakMs >= turBaslangicMs - pay && dayanakMs <= cagriMs + pay;
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
