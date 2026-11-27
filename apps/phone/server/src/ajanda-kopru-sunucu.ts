/**
 * Ajanda borusunun sunucu ucu (`AJANDA_BORU_ADI`): el sıkışma, jeton ve rol denetimi, fiili ajanda
 * modülünün işleyicisine iletme, yanıt doğrulama. `kopru-sunucu`'nun bütün değişmezleri burada da
 * geçerlidir; mevcut boruya dokunmamak için ayrı örnektir (ortak kod yalnız protokol işlevleri).
 * Rol, sohbet ve nesil yalnız jetondan (`ajanda_jetonlari`) türer; `AjandaFiilIsleyiciler` dışında
 * kimse çağrılmaz; kayıt metni günlüğe girmez. MODULLER.md "Ajanda dalgası" > "ajanda-kopru-sunucu".
 *
 * PC oturumları (AJANDA.md "PC oturumları", MODULLER.md "PC oturumları"): `baslat`'a `pcKanca` verilirse
 * `pc_oturumu` (MCP köprüsü) ve `pc_kanca` (Claude Code'un araç öncesi kancası) rolleri PC anahtarıyla
 * (`ajanda_pc_anahtarlari`, yalnız özet) bağlanır. Anahtar el sıkışmada VE her istekte yeniden denetlenir:
 * `eslestir --claude-code` anahtarı yenileyince ya da kaldırınca açık bağlantı bir sonraki isteğinde
 * `kopru_ret{jeton_gecersiz}` alır ve kapanır. PC bağlantılarında tek bağlantı kuralı yoktur (çok oturum);
 * köprüler `AJANDA_PC_SINIRLARI.BAGLANTI_ADET`, kancalar ayrı olarak `KANCA_BAGLANTI_ADET` ile sınırlıdır
 * (çok oturum açıkken kanca tıkanmasın) ve kanca bağlantısı `KANCA_BAGLANTI_OMRU_MS` sonra kapatılır. `pc_oturumu` isteğinin `cagri`'sı bağlama
 * (`AjandaPcBaglami`) geçer; `ana_oturum` isteğinin `cagri`'sı yok sayılır (bağlam bugünkü gibi yalnız
 * jetonun kapsamıdır). `pc_kanca` bağlantısı yalnız kanca isteğini (`pc_arac`, `pcKancaYukariCoz`) alır.
 * `pc_oturumu` başarılı yanıtının `sonuc`'u `PcAracSonucu{cikti, karar}`'dır (PC defterinin tur kararı;
 * köprü sentetik kararın nedenini modele söyler); `ana_oturum` yanıtı bugünkü gibi yalnız çıktıdır.
 */
import { z } from "zod";
import {
  AJANDA_ARACLARI,
  AJANDA_AZAMI_CERCEVE,
  AJANDA_BORU_ADI,
  AJANDA_PC_SINIRLARI,
  OpakId,
  PC_KANCA_ARACLARI,
  PcAracSonucu,
  PROTOKOL_SURUMU,
  ajandaFiilRoldeIzinliMi,
  ajandaKopruYukariCoz,
  ajandaPcRoluMu,
  cozumle,
  mesaj,
  pcKancaYukariCoz,
  sha256Hex,
  utf8Bayt,
} from "@eren/protocol";
import type {
  AjandaFiili,
  AjandaKopruAsagi,
  AjandaKopruIstek,
  AjandaKopruRolu,
  AjandaPcRolu,
  HataKodu,
  KopruYanit,
  PcKancaIstek,
} from "@eren/protocol";
import type {
  AjandaFiilIsleyiciler,
  AjandaJetonKapsami,
  AjandaKopruBaglami,
  AjandaKopruSunucuFabrikasi,
  BoruBaglantisi,
  GunlukAlanlari,
  IptalEt,
  KapatilabilirSunucu,
  KopruIptalNedeni,
  PcKancaIsleyicileri,
  Sonuc,
} from "./sozlesme.ts";

const MODUL = "ajanda-kopru-sunucu";
const HELLO_SURESI_MS = 10_000;
/** PC bağlantısında ret yazıldıktan sonra karşı tarafın kapatması için süre; sonra servis kapatır. */
const PC_RET_KAPANIS_MS = 2_000;
/**
 * `pc_kanca` bağlantısının el sıkışmadan sonraki en uzun ömrü. Kancanın bütün işi `KANCA_SURESI_MS`'tir
 * (bağlantı ondan önce açılır); bu süre dolduğunda kanca zaten vazgeçmiştir, servis bağlantıyı kapatır.
 */
const KANCA_BAGLANTI_OMRU_MS = AJANDA_PC_SINIRLARI.KANCA_SURESI_MS + 1_000;

type GenelIsleyici = (
  girdi: unknown,
  baglam: AjandaKopruBaglami,
  sinyal: AbortSignal,
) => Promise<Sonuc<unknown, HataKodu>>;

/**
 * Tam çözüm başarısızken yalnız zarf: fiil bu rolde izinli değilse `rol_fiil_izinsiz` yanıtı için
 * (`ajandaFiilRoldeIzinliMi` her dizgeyi alır). İzinli fiilin girdisi şemaya uymuyorsa çerçeve
 * geçersizdir ve bağlantı kapanır (köprü girdiyi boruya çıkmadan denetler).
 */
const IstekZarfi = mesaj("istek", { istek_id: OpakId, fiil: z.string().max(64), girdi: z.unknown(), cagri: z.unknown().optional() });

/** Bağlantının el sıkışmayla sabitlenen kimliği. */
type Kimlik =
  /** Telefon sohbetinin ana oturumu: bağlam yalnız jetonun kapsamı. */
  | { tur: "ana"; baglam: Readonly<AjandaJetonKapsami> }
  /** PC: anahtarın özeti (her istekte yeniden denetlenir) ve servisin verdiği bağlantı kimliği. */
  | { tur: "pc"; rol: AjandaPcRolu; ozet: string; baglanti_id: string };

interface Baglanti {
  readonly port: BoruBaglantisi;
  /** `null` iken `kopru_hello` bekleniyor. */
  kimlik: Kimlik | null;
  readonly suren: Map<string, AbortController>;
  sureIptal: IptalEt | null;
  kapali: boolean;
  /** Yalnız PC: reddedildi ya da anahtarı iptal edildi; kapanış bekleniyor (`gecikmeliKapat`). */
  dusuk: boolean;
  /** `baslat`'ın PC kancası: köprü kapanışı `temizle`'de ona bildirilir. */
  readonly pcKanca: PcKancaIsleyicileri | undefined;
}

/** `depo.ajandaJetonlariSil` ile aynı eşitlik: kapsamın bütün alanları. */
const kapsamEsit = (a: AjandaJetonKapsami, b: AjandaJetonKapsami): boolean =>
  a.rol === b.rol && a.sohbet_id === b.sohbet_id && a.nesil === b.nesil;

const jetonOzeti = (jeton: string): string => sha256Hex(utf8Bayt(jeton));

const hataYaniti = (istek_id: string, code: HataKodu): KopruYanit => ({
  v: PROTOKOL_SURUMU,
  type: "yanit",
  istek_id,
  ok: false,
  code,
});

/**
 * `null`: işleyici sözleşmeye uymadı, çağıran `ic_hata` yollar. `detail` hiç taşınmaz. `pc` (yalnız
 * `pc_oturumu` çağrısı): başarılı yanıtın `sonuc`'u `PcAracSonucu`'dur (çıktı + defterin kararı); karar
 * yoksa sözleşme bozuktur.
 */
const sonucYaniti = (
  fiil: AjandaFiili,
  istek_id: string,
  sonuc: Sonuc<unknown, HataKodu> & { pc_karar?: unknown },
  pc: boolean,
): KopruYanit | null => {
  if (sonuc.ok === true) {
    const sema: z.ZodType = AJANDA_ARACLARI[fiil].cikti;
    const cikti = sema.safeParse(sonuc.deger);
    if (!cikti.success) return null;
    if (!pc) return { v: PROTOKOL_SURUMU, type: "yanit", istek_id, ok: true, sonuc: cikti.data };
    const sarili = PcAracSonucu.safeParse({ cikti: cikti.data, karar: sonuc.pc_karar });
    return sarili.success ? { v: PROTOKOL_SURUMU, type: "yanit", istek_id, ok: true, sonuc: sarili.data } : null;
  }
  // Sözleşme: boru düzeyi ret yalnız `tur_gecersiz` ve `ic_hata`.
  if (sonuc.code !== "tur_gecersiz" && sonuc.code !== "ic_hata") return null;
  return hataYaniti(istek_id, sonuc.code);
};

export const ajandaKopruSunucuKur: AjandaKopruSunucuFabrikasi = ({
  boru,
  depo,
  rastgele,
  anahtar,
  zamanlayici,
  gunluk,
}) => {
  const baglantilar = new Set<Baglanti>();
  let sunucu: KapatilabilirSunucu | null = null;
  let acik = false;

  const temizle = (bag: Baglanti): void => {
    if (bag.kapali) return;
    bag.kapali = true;
    bag.sureIptal?.();
    baglantilar.delete(bag);
    for (const denetleyici of bag.suren.values()) {
      denetleyici.abort("baglanti_koptu" satisfies KopruIptalNedeni);
    }
    bag.suren.clear();
    // Köprü kapandı (her kapanış yolu buradan, bir kez geçer): PC defteri bu bağlantının T5 bağını bırakır.
    if (bag.kimlik?.tur === "pc" && bag.kimlik.rol === "pc_oturumu") {
      try {
        bag.pcKanca?.kopruKapandi?.(bag.kimlik.baglanti_id);
      } catch {
        gunluk.hata(MODUL, "isleyici_atti", { fiil: "kopruKapandi" });
      }
    }
  };

  const baglantiKapat = (bag: Baglanti): void => {
    temizle(bag);
    bag.port.kapat();
  };

  const yaz = (bag: Baglanti, m: AjandaKopruAsagi): void => {
    if (bag.kapali) return;
    try {
      bag.port.satirYaz(JSON.stringify(m));
    } catch {
      gunluk.uyari(MODUL, "yazma_hatasi");
      baglantiKapat(bag);
    }
  };

  /** El sıkışmış, açık bir bağlantı bu kapsamı taşıyor mu (tek bağlantı kuralı). */
  const kapsamKullanimda = (kapsam: AjandaJetonKapsami): boolean => {
    for (const diger of baglantilar) {
      if (!diger.kapali && diger.kimlik?.tur === "ana" && kapsamEsit(diger.kimlik.baglam, kapsam)) return true;
    }
    return false;
  };

  /** Bu roldeki el sıkışmış, açık PC bağlantısı sayısı (köprü ve kanca ayrı sayılır). */
  const pcBaglantiSayisi = (rol: AjandaPcRolu): number => {
    let n = 0;
    for (const diger of baglantilar) if (!diger.kapali && diger.kimlik?.tur === "pc" && diger.kimlik.rol === rol) n++;
    return n;
  };

  const reddet = (bag: Baglanti, code: HataKodu, neden: string, ek: GunlukAlanlari = {}): void => {
    gunluk.uyari(MODUL, "el_sikisma_ret", { code, neden, ...ek });
    yaz(bag, { v: PROTOKOL_SURUMU, type: "kopru_ret", code });
    baglantiKapat(bag);
  };

  /** PC anahtarı bu an hâlâ etkin mi (iptal servis yeniden başlamadan geçerli olsun). Atarsa hayır. */
  const pcAnahtariGecerli = (ozet: string): boolean => {
    try {
      return depo.ajandaPcAnahtariGecerliMi(ozet);
    } catch {
      gunluk.hata(MODUL, "pc_anahtar_okunamadi");
      return false;
    }
  };

  const helloIsle = (bag: Baglanti, satir: string, pcKanca: PcKancaIsleyicileri | undefined): void => {
    const cozum = ajandaKopruYukariCoz(satir);
    if (!cozum.ok) {
      reddet(bag, cozum.kod === "protokol_uyumsuz" ? "protokol_uyumsuz" : "yetkisiz", "cerceve_gecersiz");
      return;
    }
    const m = cozum.mesaj;
    if (m.type !== "kopru_hello") {
      reddet(bag, "yetkisiz", "ilk_mesaj_hello_degil");
      return;
    }
    const ozet = jetonOzeti(m.jeton);
    if (ajandaPcRoluMu(m.rol)) {
      if (pcKanca === undefined) {
        pcReddet(bag, "yetkisiz", "pc_kapali", { rol: m.rol });
        return;
      }
      if (!pcAnahtariGecerli(ozet)) {
        pcReddet(bag, "jeton_gecersiz", "pc_anahtar_gecersiz", { rol: m.rol });
        return;
      }
      const kanca = m.rol === "pc_kanca";
      if (pcBaglantiSayisi(m.rol) >= (kanca ? AJANDA_PC_SINIRLARI.KANCA_BAGLANTI_ADET : AJANDA_PC_SINIRLARI.BAGLANTI_ADET)) {
        // Geçici: köprü yeniden dener (kalıcı ret değildir). Kanca denemez; çağrı taslak doğar, nedeni
        // günlükte (`--teshis` bunu "kanca kurulu değil"den ayırır).
        pcReddet(bag, "ic_hata", kanca ? "pc_kanca_siniri" : "pc_baglanti_siniri", { rol: m.rol });
        return;
      }
      bag.sureIptal?.();
      // Kanca bağlantısı tek iş içindir: takılan ya da kapatmayı unutan kanca sınırı tutamasın.
      bag.sureIptal = kanca ? zamanlayici.sonra(KANCA_BAGLANTI_OMRU_MS, () => baglantiKapat(bag)) : null;
      const baglanti_id = rastgele.opakId("pcb");
      bag.kimlik = { tur: "pc", rol: m.rol, ozet, baglanti_id };
      gunluk.bilgi(MODUL, "el_sikisma", { rol: m.rol, baglanti_id });
      yaz(bag, { v: PROTOKOL_SURUMU, type: "kopru_welcome", rol: m.rol });
      return;
    }
    const kayit = depo.ajandaJetonBul(ozet);
    if (kayit === null || !anahtar.sabitZamanEsit(kayit.ozet, ozet)) {
      reddet(bag, "jeton_gecersiz", "jeton_bilinmiyor");
      return;
    }
    if (kayit.kapsam.rol !== m.rol) {
      reddet(bag, "jeton_gecersiz", "rol_uyusmuyor");
      return;
    }
    // Tek bağlantı: aynı ana oturum kapsamı açıkken ikinci köprü reddedilir, açık olan sürer.
    if (kapsamKullanimda(kayit.kapsam)) {
      reddet(bag, "jeton_gecersiz", "jeton_kullanimda", { sohbet_id: kayit.kapsam.sohbet_id });
      return;
    }
    bag.sureIptal?.();
    bag.sureIptal = null;
    const baglam = Object.freeze({ ...kayit.kapsam });
    bag.kimlik = { tur: "ana", baglam };
    gunluk.bilgi(MODUL, "el_sikisma", { rol: baglam.rol, sohbet_id: baglam.sohbet_id });
    yaz(bag, { v: PROTOKOL_SURUMU, type: "kopru_welcome", rol: baglam.rol });
  };

  /** Hiç reddetmez: atan ya da sözleşmeye uymayan işleyici `ic_hata`dır, `detail` taşımaz. */
  const yanitUret = async (
    istek: AjandaKopruIstek,
    baglam: AjandaKopruBaglami,
    isleyiciler: AjandaFiilIsleyiciler,
    sinyal: AbortSignal,
  ): Promise<KopruYanit> => {
    try {
      const isleyici = isleyiciler[istek.fiil] as unknown as GenelIsleyici;
      const sonuc = await isleyici(istek.girdi, baglam, sinyal);
      const yanit = sonucYaniti(istek.fiil, istek.istek_id, sonuc, baglam.rol === "pc_oturumu");
      if (yanit !== null) return yanit;
      gunluk.hata(MODUL, "sonuc_gecersiz", { fiil: istek.fiil });
    } catch {
      gunluk.hata(MODUL, "isleyici_atti", { fiil: istek.fiil });
    }
    return hataYaniti(istek.istek_id, "ic_hata");
  };

  const istekBaslat = (
    bag: Baglanti,
    rol: AjandaKopruRolu,
    baglam: AjandaKopruBaglami,
    isleyiciler: AjandaFiilIsleyiciler,
    istek: AjandaKopruIstek,
  ): void => {
    const { istek_id, fiil } = istek;
    if (!ajandaFiilRoldeIzinliMi(rol, fiil)) {
      gunluk.uyari(MODUL, "rol_fiil_izinsiz", { rol, fiil });
      yaz(bag, hataYaniti(istek_id, "rol_fiil_izinsiz"));
      return;
    }
    if (bag.suren.has(istek_id)) {
      yaz(bag, hataYaniti(istek_id, "yinelenen_istek"));
      return;
    }
    const denetleyici = new AbortController();
    bag.suren.set(istek_id, denetleyici);
    void yanitUret(istek, baglam, isleyiciler, denetleyici.signal).then((yanit) => {
      bag.suren.delete(istek_id);
      yaz(bag, yanit);
    });
  };

  /** `pc_oturumu` çağrısının bağlamı: rol ve bağlantı kimliği servisten, `cagri` köprüden (doğrulanmamış). */
  const pcBaglami = (k: Extract<Kimlik, { tur: "pc" }>, istek: AjandaKopruIstek): AjandaKopruBaglami => {
    const b: { rol: "pc_oturumu"; baglanti_id: string; arac_cagri_id?: string; oturum_id?: string } = {
      rol: "pc_oturumu",
      baglanti_id: k.baglanti_id,
    };
    if (istek.cagri?.arac_cagri_id !== undefined) b.arac_cagri_id = istek.cagri.arac_cagri_id;
    if (istek.cagri?.oturum_id !== undefined) b.oturum_id = istek.cagri.oturum_id;
    return Object.freeze(b);
  };

  /**
   * İptal edilmiş anahtarla gelen istek: isteğin kendisine `jeton_gecersiz` yanıtı (köprü kesin metni
   * verir, anahtar dosyasını yeniden okuyup yeniden bağlanır) ve gecikmeli kapanış. Yazıp hemen kapatmak
   * adlı boruda yanıtı düşürebilir (ölçüldü: yaz + destroy yarı yarıya teslim): köprü "belirsiz" görürdü.
   */
  const pcAnahtariDusur = (bag: Baglanti, rol: AjandaPcRolu, istek_id: string): void => {
    gunluk.uyari(MODUL, "pc_anahtar_iptal", { rol });
    yaz(bag, hataYaniti(istek_id, "jeton_gecersiz"));
    gecikmeliKapat(bag);
  };

  /** PC bağlantısını karşı tarafın kapatmasına bırakır; en geç `PC_RET_KAPANIS_MS` sonra servis kapatır. */
  const gecikmeliKapat = (bag: Baglanti): void => {
    if (bag.dusuk) return;
    bag.dusuk = true;
    bag.sureIptal?.();
    bag.sureIptal = zamanlayici.sonra(PC_RET_KAPANIS_MS, () => baglantiKapat(bag));
  };

  /** PC el sıkışma reddi: `kopru_ret` (köprü engeli doğru söylesin diye gecikmeli kapanış). */
  const pcReddet = (bag: Baglanti, code: HataKodu, neden: string, ek: GunlukAlanlari): void => {
    gunluk.uyari(MODUL, "el_sikisma_ret", { code, neden, ...ek });
    yaz(bag, { v: PROTOKOL_SURUMU, type: "kopru_ret", code });
    gecikmeliKapat(bag);
  };

  const yukariIsle = (bag: Baglanti, kimlik: Kimlik, isleyiciler: AjandaFiilIsleyiciler, satir: string): void => {
    const rol = kimlik.tur === "ana" ? kimlik.baglam.rol : kimlik.rol;
    const cozum = ajandaKopruYukariCoz(satir);
    if (!cozum.ok) {
      // Zarfı geçerli, fiili bu rolün olmayan istek (ör. `eren` borusunun fiili): bağlantı kapanmaz.
      const zarf = cozum.kod === "gecersiz_mesaj" ? cozumle(IstekZarfi, satir, AJANDA_AZAMI_CERCEVE.BORU) : null;
      if (zarf?.ok === true && !ajandaFiilRoldeIzinliMi(rol, zarf.mesaj.fiil)) {
        gunluk.uyari(MODUL, "rol_fiil_izinsiz", { rol });
        yaz(bag, hataYaniti(zarf.mesaj.istek_id, "rol_fiil_izinsiz"));
        return;
      }
      gunluk.uyari(MODUL, "gecersiz_cerceve", { neden: cozum.kod, yollar: cozum.yollar.join(",") });
      baglantiKapat(bag);
      return;
    }
    const m = cozum.mesaj;
    switch (m.type) {
      case "kopru_hello":
        // Bağlantının kimliği ilk jetonla sabitlenir, ikinci hello onu değiştiremez.
        gunluk.uyari(MODUL, "ikinci_hello", { rol });
        baglantiKapat(bag);
        return;
      case "iptal":
        bag.suren.get(m.istek_id)?.abort("model_iptal" satisfies KopruIptalNedeni);
        return;
      case "istek":
        if (kimlik.tur === "ana") {
          istekBaslat(bag, rol, kimlik.baglam, isleyiciler, m);
          return;
        }
        if (!pcAnahtariGecerli(kimlik.ozet)) {
          pcAnahtariDusur(bag, kimlik.rol, m.istek_id);
          return;
        }
        istekBaslat(bag, rol, pcBaglami(kimlik, m), isleyiciler, m);
        return;
    }
  };

  /** `pc_kanca` bağlantısı: yalnız kanca istekleri; eşzamanlı işlenir, yanıt `PC_KANCA_ARACLARI` ile doğrulanır. */
  const kancaIsle = (bag: Baglanti, kimlik: Extract<Kimlik, { tur: "pc" }>, pcKanca: PcKancaIsleyicileri, satir: string): void => {
    const cozum = pcKancaYukariCoz(satir);
    if (!cozum.ok) {
      gunluk.uyari(MODUL, "gecersiz_cerceve", { rol: "pc_kanca", neden: cozum.kod, yollar: cozum.yollar.join(",") });
      baglantiKapat(bag);
      return;
    }
    const m = cozum.mesaj;
    if (m.type === "kopru_hello") {
      gunluk.uyari(MODUL, "ikinci_hello", { rol: "pc_kanca" });
      baglantiKapat(bag);
      return;
    }
    if (!pcAnahtariGecerli(kimlik.ozet)) {
      pcAnahtariDusur(bag, kimlik.rol, m.istek_id);
      return;
    }
    yaz(bag, kancaYaniti(m, pcKanca));
  };

  const kancaYaniti = (m: PcKancaIstek, pcKanca: PcKancaIsleyicileri): KopruYanit => {
    try {
      // Girdi `pcKancaYukariCoz`'dan fiilin şemasıyla geçti.
      const ham: unknown = pcKanca.pc_arac(m.girdi);
      const sema: z.ZodType = PC_KANCA_ARACLARI[m.fiil].cikti;
      const cikti = sema.safeParse(ham);
      if (cikti.success) return { v: PROTOKOL_SURUMU, type: "yanit", istek_id: m.istek_id, ok: true, sonuc: cikti.data };
      gunluk.hata(MODUL, "sonuc_gecersiz", { fiil: m.fiil });
    } catch {
      gunluk.hata(MODUL, "isleyici_atti", { fiil: m.fiil });
    }
    return hataYaniti(m.istek_id, "ic_hata");
  };

  const satirIsle = (bag: Baglanti, isleyiciler: AjandaFiilIsleyiciler, pcKanca: PcKancaIsleyicileri | undefined, satir: string): void => {
    if (bag.kapali) return;
    // Reddedilmiş ya da anahtarı düşmüş PC bağlantısı: kapanışı beklerken yalnız `jeton_gecersiz`.
    if (bag.dusuk) {
      const zarf = cozumle(IstekZarfi, satir, AJANDA_AZAMI_CERCEVE.BORU);
      if (zarf.ok && bag.kimlik !== null) yaz(bag, hataYaniti(zarf.mesaj.istek_id, "jeton_gecersiz"));
      return;
    }
    try {
      const k = bag.kimlik;
      if (k === null) helloIsle(bag, satir, pcKanca);
      else if (k.tur === "pc" && k.rol === "pc_kanca" && pcKanca !== undefined) kancaIsle(bag, k, pcKanca, satir);
      else yukariIsle(bag, k, isleyiciler, satir);
    } catch {
      gunluk.hata(MODUL, "satir_isleme_hatasi");
      if (bag.kimlik === null) reddet(bag, "ic_hata", "ic_hata");
      else baglantiKapat(bag);
    }
  };

  const baglantiKabul = (port: BoruBaglantisi, isleyiciler: AjandaFiilIsleyiciler, pcKanca: PcKancaIsleyicileri | undefined): void => {
    if (!acik) {
      port.kapat();
      return;
    }
    const bag: Baglanti = { port, kimlik: null, suren: new Map(), sureIptal: null, kapali: false, dusuk: false, pcKanca };
    baglantilar.add(bag);
    port.kapanisDinle(() => temizle(bag));
    port.satirDinle((satir) => satirIsle(bag, isleyiciler, pcKanca, satir));
    bag.sureIptal = zamanlayici.sonra(HELLO_SURESI_MS, () => {
      if (bag.kimlik === null && !bag.kapali) reddet(bag, "yetkisiz", "sure_doldu");
    });
  };

  return {
    jetonUret(kapsam) {
      const jeton = rastgele.jeton();
      depo.ajandaJetonEkle({ ozet: jetonOzeti(jeton), kapsam: { ...kapsam } });
      return jeton;
    },

    jetonlariIptalEt(kapsam) {
      depo.ajandaJetonlariSil(kapsam);
      for (const bag of [...baglantilar]) {
        if (bag.kimlik?.tur === "ana" && kapsamEsit(bag.kimlik.baglam, kapsam)) baglantiKapat(bag);
      }
    },

    jetonlariniSil() {
      // Önce depo: kapanan bağlantının yeniden denemesi silinmiş jetonu bulamasın.
      const silinen = depo.ajandaJetonlariniSil();
      let kapatilan = 0;
      for (const bag of [...baglantilar]) {
        baglantiKapat(bag);
        kapatilan++;
      }
      gunluk.bilgi(MODUL, "ajanda_jetonlari_silindi", { silinen, kapatilan });
      return silinen;
    },

    async baslat(isleyiciler, pcKanca) {
      if (acik) throw new Error("ajanda köprü sunucusu zaten açık");
      acik = true;
      try {
        sunucu = await boru.dinle({
          ad: AJANDA_BORU_ADI,
          azamiSatir: AJANDA_AZAMI_CERCEVE.BORU,
          baglanti: (port) => baglantiKabul(port, isleyiciler, pcKanca),
        });
      } catch (hata) {
        acik = false;
        throw hata;
      }
    },

    async kapat() {
      acik = false;
      const kapanis = sunucu?.kapat();
      sunucu = null;
      for (const bag of [...baglantilar]) baglantiKapat(bag);
      await kapanis;
    },
  };
};
