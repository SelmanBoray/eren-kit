/**
 * Kısayol kancası (Dilim 3b §6). Kotlin `KisayolDeposu`'nun tek yuvasındaki mesaj, `kisayolGeldi`
 * olayında ve çekirdek yüklenince (uygulama açılışı) `kisayolAl` ile çekilir ve "Telefon" adlı
 * sohbete `mesajYolla(metin, "kisayol", baglam?)` ile yollanır; kuyruğa (diske) girince
 * `kisayolTuket(id)`.
 *
 * Hedef: adı tam "Telefon" olan (kurulamamış olmayan) ilk sohbet; yoksa `sohbetAc("Telefon")` ile
 * açılır ve mesaj hemen yollanır: çekirdek bekleyen sohbetin mesajını kuyrukta `chat_create`'in
 * ardına koyar. 8 sohbet sınırı doluysa (yerelde ya da `sohbetAc` `sohbet_siniri` derse) `ana`.
 * Açılan sohbet seçimi değiştirmez: kullanıcı başka uygulamadan söyledi, baktığı sohbet kalır.
 *
 * Aynı `id` iki kez yollanmaz (bellekte iz); tüketme düştüyse sonraki çekişte yalnız tüketilir.
 * Bağlam yalnız paket ve ad ikisi de varken (ve kablo şemasından geçerse) verilir; çekirdek yine de
 * `gecersiz` derse mesaj bir kez bağlamsız yollanır. Bağlamsız da `gecersiz` olan mesaj tüketilir:
 * hiç gidemez, yuvayı tutmasın.
 * Geçici hatada (depo, başlamadı, sohbet açılamadı, çekme düştü) yuvada kalır; yeniden deneme
 * zamanlayıcısı (üstel aralık, `KISAYOL_ILK_ARALIK_MS`'den `KISAYOL_EN_COK_ARALIK_MS`'ye) ve
 * bağlantı bağlanınca / eşitleme bitince anında yeniden deneme; gönderilip tüketilene ya da kalıcı
 * hataya (`gecersiz`) dek sürer. Kanca kapanınca zamanlayıcı temizlenir.
 */
import { ANA_SOHBET_ID, KisayolBaglami, SOHBET_SINIRLARI } from "@eren/protocol";
import { useEffect, useMemo } from "react";
import type { Cekirdek, GonderSonucu, MesajBaglami, SohbetId, SohbetOzeti } from "../cekirdek/index.ts";
import type { ErenCihaz } from "../cihaz/erenDevice.ts";
import type { KisayolMesaji } from "../../modules/eren-device/src/ErenDevice.types.ts";

export const TELEFON_SOHBET_ADI = "Telefon";
export const KISAYOL_ILK_ARALIK_MS = 5_000;
export const KISAYOL_EN_COK_ARALIK_MS = 60_000;

export interface KisayolSecenekleri {
  ilkAralikMs?: number;
  enCokAralikMs?: number;
}

export type KisayolHedefi =
  | { tur: "var"; sohbet_id: SohbetId }
  | { tur: "ac" }
  | { tur: "ana" };

/**
 * Saf: kısayol mesajının sohbeti. Kurulamamışlar sayılmaz (PC'de yer tutmazlar, mesaj alamazlar).
 * Adı "Telefon" olan ilk satır (liste sırası) kazanır; yoksa yer varsa aç, yer yoksa `ana`.
 */
export function kisayolHedefi(sohbetler: readonly Pick<SohbetOzeti, "sohbet_id" | "ad" | "kurulum">[]): KisayolHedefi {
  const gecerli = sohbetler.filter((s) => s.kurulum !== "kurulamadi");
  const t = gecerli.find((s) => s.ad === TELEFON_SOHBET_ADI);
  if (t !== undefined) return { tur: "var", sohbet_id: t.sohbet_id };
  if (gecerli.length >= SOHBET_SINIRLARI.SOHBET_ADET) return { tur: "ana" };
  return { tur: "ac" };
}

/** Saf: paket ve ad ikisi de varsa ve kablo şemasından geçerse bağlam; yoksa `undefined` (mesaj yine gider). */
export function kisayolBaglami(m: Pick<KisayolMesaji, "paket" | "ad">): MesajBaglami | undefined {
  if (m.paket === null || m.ad === null) return undefined;
  const r = KisayolBaglami.safeParse({ paket: m.paket, ad: m.ad });
  return r.success ? r.data : undefined;
}

/** Saf: `mesajYolla` sonucundan sonra yuva tüketilir mi (kuyruğa girdi ya da hiç gidemez). */
export const kisayolTuketilirMi = (s: GonderSonucu): boolean => s.ok || s.neden === "gecersiz";

export interface KisayolYurutucusu {
  /** Olaya ve çekirdeğe abone olur; kapatıcı döner. */
  baslat(): () => void;
}

/** React'sız yürütücü: kanca bunu sarar, testler doğrudan kullanır. */
export function kisayolKur(
  cekirdek: Cekirdek,
  cihaz: ErenCihaz,
  secenek: KisayolSecenekleri = {},
): KisayolYurutucusu {
  const ilkAralik = secenek.ilkAralikMs ?? KISAYOL_ILK_ARALIK_MS;
  const enCokAralik = secenek.enCokAralikMs ?? KISAYOL_EN_COK_ARALIK_MS;
  let aralik = ilkAralik;
  let zamanlayici: ReturnType<typeof setTimeout> | null = null;
  let bekleyen = false;
  const yollanan = new Set<string>();
  let calisiyor = false;
  let tekrar = false;
  let durdu = true;
  let yuklendiGoruldu = false;

  /** Hedef sohbet; açılamadıysa (geçici hata) `null`. */
  const hedefBul = async (): Promise<SohbetId | null> => {
    const d = cekirdek.durum();
    const h = kisayolHedefi(d.sohbetler);
    if (h.tur === "var") return h.sohbet_id;
    if (h.tur === "ana") return ANA_SOHBET_ID;
    const onceki = d.secili;
    const a = await cekirdek.sohbetAc(TELEFON_SOHBET_ADI);
    if (!a.ok) return a.neden === "sohbet_siniri" ? ANA_SOHBET_ID : null;
    // `sohbetAc` yeni sohbeti seçer; arada kullanıcı başka seçim yapmadıysa önceki geri gelir.
    if (cekirdek.durum().secili === a.sohbet_id && onceki !== a.sohbet_id) cekirdek.sec(onceki);
    return a.sohbet_id;
  };

  const yolla = async (m: KisayolMesaji): Promise<GonderSonucu | null> => {
    let baglam = kisayolBaglami(m);
    // Hedef arada kurulamadı ya da silindiyse bir kez yeniden bulunur.
    for (let deneme = 0; deneme < 2; deneme++) {
      const hedef = await hedefBul();
      if (hedef === null) return null;
      const sohbet = cekirdek.sohbet(hedef);
      let s = await sohbet.mesajYolla(m.metin, "kisayol", baglam);
      // Çekirdek geçersiz bağlamda mesajı tümden reddeder: mesaj kaybolmasın, bir kez bağlamsız.
      if (!s.ok && s.neden === "gecersiz" && baglam !== undefined) {
        baglam = undefined;
        s = await sohbet.mesajYolla(m.metin, "kisayol");
      }
      if (s.ok || s.neden !== "sohbet_bulunamadi") return s;
    }
    return null;
  };

  /** `true`: yuvada işlenmemiş mesaj kaldı (geçici hata), yeniden denenmeli. */
  const tur = async (): Promise<boolean> => {
    const r = await cihaz.kisayolAl();
    if (durdu) return false;
    if (!r.ok) return true;
    if (r.deger === null) return false;
    const m = r.deger;
    if (!yollanan.has(m.id)) {
      const s = await yolla(m);
      if (s === null || !kisayolTuketilirMi(s)) return true;
      yollanan.add(m.id);
    }
    const t = await cihaz.kisayolTuket(m.id);
    return !t.ok;
  };

  const zamanlayiciTemizle = (): void => {
    if (zamanlayici !== null) clearTimeout(zamanlayici);
    zamanlayici = null;
  };

  /** Tek yürütme: çalışırken gelen tetik, tur bitince bir tur daha yaptırır. */
  const tetikle = (): void => {
    if (durdu || !cekirdek.durum().yuklendi) return;
    zamanlayiciTemizle();
    if (calisiyor) {
      tekrar = true;
      return;
    }
    calisiyor = true;
    void (async () => {
      let yeniden = false;
      try {
        do {
          tekrar = false;
          try {
            yeniden = await tur();
          } catch {
            // Bir turun hatası sonrakileri durdurmaz; beklenmedik hata geçici sayılır.
            yeniden = true;
          }
        } while (tekrar && !durdu);
      } finally {
        calisiyor = false;
      }
      bekleyen = yeniden && !durdu;
      if (!bekleyen) {
        aralik = ilkAralik;
        return;
      }
      zamanlayiciTemizle();
      const bekle = aralik;
      aralik = Math.min(aralik * 2, enCokAralik);
      zamanlayici = setTimeout(() => {
        zamanlayici = null;
        tetikle();
      }, bekle);
    })();
  };

  return {
    baslat: () => {
      if (!cihaz.desteklenir) return () => {};
      durdu = false;
      yuklendiGoruldu = false;
      bekleyen = false;
      aralik = ilkAralik;
      let oncekiBagli = cekirdek.durum().baglanti === "bagli";
      let oncekiEsitleniyor = cekirdek.durum().esitleniyor;
      const olayKapat = cihaz.kisayolGeldiDinle(() => tetikle());
      // Açılış: çekirdek yüklenince bir kez (yuvada uygulama kapalıyken bırakılmış mesaj olabilir).
      const cekirdekKapat = cekirdek.abone((d) => {
        const bagli = d.baglanti === "bagli";
        const iyilesti = (bagli && !oncekiBagli) || (oncekiEsitleniyor && !d.esitleniyor);
        oncekiBagli = bagli;
        oncekiEsitleniyor = d.esitleniyor;
        if (!d.yuklendi) return;
        if (!yuklendiGoruldu) {
          yuklendiGoruldu = true;
          tetikle();
        } else if (bekleyen && iyilesti) {
          aralik = ilkAralik;
          tetikle();
        }
      });
      return () => {
        durdu = true;
        bekleyen = false;
        zamanlayiciTemizle();
        olayKapat();
        cekirdekKapat();
      };
    },
  };
}

/** Uygulama ömrü boyunca kısayol mesajlarını "Telefon" sohbetine yollar. */
export function useKisayol(cekirdek: Cekirdek, cihaz: ErenCihaz): void {
  const y = useMemo(() => kisayolKur(cekirdek, cihaz), [cekirdek, cihaz]);
  useEffect(() => y.baslat(), [y]);
}
