/**
 * "Geçmişi sil" ve (dilim 2) "sohbeti sil" düzenleyicisi: `chat_clear` ve `chat_delete`'in tek işleyicisi
 * (çağıran yalnız `gateway`'in kimliği bitmiş `/sohbet` dalı; boruda bu modüle ulaşan fiil yoktur).
 * MODULLER.md "Geçmişi sil" 3, "temizlik"; dilim 2: "Sırayla akışlar" 7, 8 ve "Modül maddeleri" >
 * "temizlik"; K3.
 *
 * `gecmisiSil(sohbet)` sırası: örnek var mı → ön koşul → `depo.islem(bekleyenleriIptal →
 * gecmisiTemizle)` → `walDaralt` → `örnek.yeniSayfa()` çağrılır (beklenmez) → dönüş; arkada sayfa
 * bitince, eski süreç çıktıysa `transkript.sil(eski_oturumlar)`, tam silmede `oturumKayitlariniSil`.
 *
 * `sohbetiSil(sohbet)` sırası: `ana` → `sohbet_silinemez` → örnek var mı → aynı ön koşul →
 * `depo.islem(bekleyenleriIptal → depo.sohbetiSil)` → `sohbetler.kaldir` → `walDaralt` → dönüş;
 * arkada `örnek.sonlandir()`, sonra yukarıdaki transkript ve oturum kaydı silmesi. İş kayıtları kalır.
 *
 * Arka iş SOHBET BAŞINADIR (`Map`): sürerken aynı sohbete ikinci çağrı KUYRUKLANMAZ, `sohbet_mesgul`
 * ile reddedilir; başka sohbete engel değildir. Gerekçe: iki işleyici eşzamanlıdır ve `gateway`
 * `ack`'i dönüşe göre hemen yazar, kuyruk sonucu sonraya bırakır ve bu imzaya sığmaz; telefon
 * `sohbet_mesgul`'u zaten tanır, kullanıcı yeniden basabilir. `bekle` ve `kapat` bütün arka işleri bekler.
 *
 * Günlüğe yalnız `sohbet_id` (opak kimlik), sayılar ve kapalı liste değerleri yazılır: sohbet adı,
 * oturum kimliği, yol, metin yazılmaz.
 */
import { ANA_SOHBET_ID } from "@eren/protocol";
import type {
  GecmisTemizlemeSonucu,
  GunlukAlanlari,
  Sonuc,
  SohbetSecimi,
  SohbetSilmeCiktisi,
  SohbetSilmeHatasi,
  SohbetSilmeSonucu,
  SonlandirmaSonucu,
  TemizlikFabrikasi,
  TemizlikHatasi,
  TemizlikSohbetleri,
  TemizlikSonucu,
  YeniSayfaSonucu,
} from "./sozlesme.ts";

const MODUL = "temizlik";

type Seviye = "bilgi" | "uyari" | "hata";

/** Ön koşulun neden tutmadığı: kapalı liste, günlüğe yazılır. */
type MesgulNedeni = "temizlik_suruyor" | "konusma" | "aktif_is" | "bekleyen_soru";

/** İki işleyicinin ortak ret biçimi; her iki `Sonuc` türüne de atanabilir. */
type Red<K extends string> = { ok: false; code: K };

type Ornek = NonNullable<ReturnType<TemizlikSohbetleri["konusma"]>>;

const hataTuru = (e: unknown): string => (e instanceof Error ? e.name : typeof e);

export const temizlikKur: TemizlikFabrikasi = ({
  depo,
  sohbetler,
  isler,
  planlar,
  transkript,
  saat,
  gunluk,
}) => {
  let kapali = false;
  /** Eşzamanlı bölüm sürüyor: işlem içinden yeniden girişe karşı (hangi sohbet olursa olsun). */
  let suruyor = false;
  /** Sohbet başına süren tek arka iş (yeni sayfa ya da sonlandırma, transkript silme); hiç reddetmez. */
  const arka = new Map<string, Promise<void>>();

  // Günlük atsa bile servis düşmesin: arka iş reddedilmemeli, işleyicinin sonucunu değiştirmemeli.
  const yaz = (seviye: Seviye, olay: string, alanlar?: GunlukAlanlari): void => {
    try {
      gunluk[seviye](MODUL, olay, alanlar);
    } catch {
      // günlük yazılamadı; yapılacak başka şey yok
    }
  };

  const mesgul = (sohbet_id: string, neden: MesgulNedeni): Red<"sohbet_mesgul"> => {
    yaz("bilgi", "sohbet_mesgul", { sohbet_id, neden });
    return { ok: false, code: "sohbet_mesgul" };
  };

  const bulunamadi = (sohbet_id: string): Red<"sohbet_bulunamadi"> => {
    yaz("bilgi", "sohbet_bulunamadi", { sohbet_id });
    return { ok: false, code: "sohbet_bulunamadi" };
  };

  const icHata = (sohbet_id: string, olay: string, e?: unknown): Red<"ic_hata"> => {
    yaz("hata", olay, e === undefined ? { sohbet_id } : { sohbet_id, hata_turu: hataTuru(e) });
    return { ok: false, code: "ic_hata" };
  };

  /**
   * Yan etkisiz okuma; ilk tutmayan koşulu döner. İki işleyicinin ortak ön koşulu (MODULLER "temizlik":
   * "aynı yardımcı"): bu sohbetin arka işi, örneğin `temizlenebilirMi()`, bu sohbetin çalışan işi ve
   * bekleyen sorusu. Başka sohbetin arka işi engel değildir.
   */
  const onKosul = (ornek: Ornek, sohbet: SohbetSecimi): MesgulNedeni | null => {
    if (arka.has(sohbet.sohbet_id)) return "temizlik_suruyor";
    if (!ornek.temizlenebilirMi()) return "konusma";
    if (isler.aktifSayisi(sohbet) !== 0) return "aktif_is";
    if (depo.bekleyenSorular(sohbet).length !== 0) return "bekleyen_soru";
    return null;
  };

  /**
   * Süreç kapandıktan sonra: eski süreç çıktıysa bu sohbetin eski oturumlarının transkriptleri, hepsi
   * tam silindiyse oturum kayıtları. Hiç atmaz.
   */
  const transkriptTemizle = async (sohbet_id: string, s: SonlandirmaSonucu): Promise<void> => {
    const eski_oturum = s.eski_oturumlar.length;

    // Eski süreç çıkmadıysa transkript dosyası kilitli olabilir (Windows): silme denenmez.
    if (!s.eski_surec_cikti) {
      yaz("uyari", "transkript_atlandi", { sohbet_id, eski_surec_cikti: false, eski_oturum });
      return;
    }

    let tamSilindi: boolean;
    try {
      // Yalnız bu sohbetin eski nesillerinin kimlikleri; iş oturumu kimliği bu porta hiçbir yoldan girmez.
      const t = await transkript.sil(Array.from(s.eski_oturumlar));
      tamSilindi = t.silinemeyen === 0 && t.reddedilen === 0;
      yaz(tamSilindi ? "bilgi" : "uyari", "transkript_silindi", {
        sohbet_id,
        eski_oturum,
        silinen: t.silinen,
        bulunamayan: t.bulunamayan,
        silinemeyen: t.silinemeyen,
        reddedilen: t.reddedilen,
      });
    } catch (e) {
      yaz("hata", "transkript_hata", { sohbet_id, eski_oturum, hata_turu: hataTuru(e) });
      return;
    }

    // Kayıtlar yalnız tam silmede gider; değilse kalır, sonraki silmede yeniden denenir.
    if (!tamSilindi) {
      yaz("uyari", "oturum_kayitlari_korundu", { sohbet_id, eski_oturum });
      return;
    }
    try {
      depo.oturumKayitlariniSil(Array.from(s.eski_oturumlar));
      yaz("bilgi", "oturum_kayitlari_silindi", { sohbet_id, eski_oturum });
    } catch (e) {
      yaz("hata", "oturum_kayitlari_silinemedi", { sohbet_id, eski_oturum, hata_turu: hataTuru(e) });
    }
  };

  const yeniSayfaArka = async (sohbet_id: string, ornek: Ornek): Promise<void> => {
    // `yeniSayfa` dönüşten ÖNCE çağrılır ama beklenmez (`ack` beklemez): eşzamanlı ön eki kuyruğu
    // hemen durdurur, silinmiş geçmişle eski süreçte yeni tur açılacak bir aralık kalmaz.
    let sayfa: YeniSayfaSonucu;
    try {
      sayfa = await ornek.yeniSayfa();
    } catch (e) {
      yaz("hata", "yeni_sayfa_hata", { sohbet_id, hata_turu: hataTuru(e) });
      return;
    }
    yaz("bilgi", "yeni_sayfa", {
      sohbet_id,
      eski_surec_cikti: sayfa.eski_surec_cikti,
      yeni_nesil_acildi: sayfa.yeni_nesil_acildi,
      eski_oturum: sayfa.eski_oturumlar.length,
    });
    await transkriptTemizle(sohbet_id, sayfa);
  };

  const sonlandirArka = async (
    sohbet_id: string,
    ornek: NonNullable<ReturnType<TemizlikSohbetleri["kaldir"]>>,
  ): Promise<void> => {
    // `sonlandir` dönüşten ÖNCE çağrılır ama beklenmez: eşzamanlı ön eki örneği kalıcı olarak kapatır.
    let son: SonlandirmaSonucu;
    try {
      son = await ornek.sonlandir();
    } catch (e) {
      yaz("hata", "sonlandirma_hata", { sohbet_id, hata_turu: hataTuru(e) });
      return;
    }
    yaz("bilgi", "sonlandirildi", {
      sohbet_id,
      eski_surec_cikti: son.eski_surec_cikti,
      eski_oturum: son.eski_oturumlar.length,
    });
    await transkriptTemizle(sohbet_id, son);
  };

  /** Arka işi bu sohbetin yuvasına koyar. `f`'nin ilk `await`'e kadarki kısmı burada, eşzamanlı koşar. */
  const arkaBaslat = (sohbet_id: string, f: () => Promise<void>): void => {
    const is: Promise<void> = f()
      .catch(() => {
        yaz("hata", "arka_is_hata", { sohbet_id });
      })
      .then(() => {
        if (arka.get(sohbet_id) === is) arka.delete(sohbet_id);
      });
    arka.set(sohbet_id, is);
  };

  const temizle = (sohbet: SohbetSecimi): Sonuc<TemizlikSonucu, TemizlikHatasi> => {
    const sohbet_id = sohbet.sohbet_id;

    // 1. Örnek ve ön koşul. Tutmazsa hiçbir yan etki yok (plan iptali dahil).
    let ornek: Ornek | null;
    let neden: MesgulNedeni | null;
    try {
      ornek = sohbetler.konusma(sohbet);
      if (ornek === null) return bulunamadi(sohbet_id);
      neden = onKosul(ornek, sohbet);
    } catch (e) {
      return icHata(sohbet_id, "on_kosul_okunamadi", e);
    }
    if (neden !== null) return mesgul(sohbet_id, neden);

    // 2. Plan iptali ve geçmiş silme tek işlemde, iptal önce: `plan_resolved{iptal}` da silinir.
    let iptal_plan = 0;
    let sonuc: GecmisTemizlemeSonucu;
    try {
      sonuc = depo.islem(() => {
        iptal_plan = planlar.bekleyenleriIptal(sohbet);
        return depo.gecmisiTemizle(sohbet);
      });
    } catch (e) {
      // İşlem geri alındı: hiçbir şey silinmedi, planlar yerinde.
      return icHata(sohbet_id, "gecmis_silinemedi", e);
    }

    // 3. İşlem bittikten sonra, dönüşten önce. Atsa da geçmiş silinmiştir: sonuç başarı.
    try {
      depo.walDaralt();
    } catch (e) {
      yaz("uyari", "wal_daraltilamadi", { sohbet_id, hata_turu: hataTuru(e) });
    }

    const mezar_seq = sonuc.mezar.seq;
    const sinir_seq = sonuc.mezar.sinir_seq;
    yaz("bilgi", "gecmis_silindi", {
      sohbet_id,
      silinen_olay: sonuc.silinen_olay,
      bosaltilan_tur: sonuc.bosaltilan_tur,
      silinen_kuyruk: sonuc.silinen_kuyruk,
      iptal_plan,
      mezar_seq,
      sinir_seq,
    });

    // 4. Arkada: yeni sayfa (çağrı burada, eşzamanlı) ve transkript silme.
    const o = ornek;
    arkaBaslat(sohbet_id, () => yeniSayfaArka(sohbet_id, o));
    return { ok: true, deger: { mezar_seq, sinir_seq } };
  };

  const sohbetSil = (sohbet: SohbetSecimi): Sonuc<SohbetSilmeCiktisi, SohbetSilmeHatasi> => {
    const sohbet_id = sohbet.sohbet_id;

    // 1. `ana` silinemez: yalnız temizlenir. Hiçbir şey okunmaz, hiçbir şey değişmez.
    if (sohbet_id === ANA_SOHBET_ID) {
      yaz("bilgi", "sohbet_silinemez", { sohbet_id });
      return { ok: false, code: "sohbet_silinemez" };
    }

    // 2. Örnek ve `gecmisiSil`'in ön koşulu. Tutmazsa hiçbir yan etki yok (plan iptali, `kaldir` dahil).
    let neden: MesgulNedeni | null;
    try {
      const ornek = sohbetler.konusma(sohbet);
      if (ornek === null) return bulunamadi(sohbet_id);
      neden = onKosul(ornek, sohbet);
    } catch (e) {
      return icHata(sohbet_id, "on_kosul_okunamadi", e);
    }
    if (neden !== null) return mesgul(sohbet_id, neden);

    // 3. Plan iptali ve sohbet silme tek işlemde, iptal önce: `plan_resolved{iptal}` da silinir.
    // `chat_deleted` yazılır, `chat_cleared` yazılmaz (depo). Atarsa geri alınır, `kaldir` çağrılmaz.
    let iptal_plan = 0;
    let sonuc: SohbetSilmeSonucu;
    try {
      const ms = saat.simdiMs();
      sonuc = depo.islem(() => {
        iptal_plan = planlar.bekleyenleriIptal(sohbet);
        return depo.sohbetiSil(sohbet, ms);
      });
    } catch (e) {
      return icHata(sohbet_id, "sohbet_silinemedi", e);
    }

    // 4. İşlem bittikten hemen sonra, araya `await` girmeden: örnek haritadan ve sıradan çıkar. Atsa da
    // sohbet veritabanında silinmiştir: sonuç başarı, yalnız sonlandırma yapılamaz (günlükte görünür).
    let kaldirilan: ReturnType<TemizlikSohbetleri["kaldir"]> = null;
    try {
      kaldirilan = sohbetler.kaldir(sohbet);
    } catch (e) {
      yaz("hata", "ornek_kaldirilamadi", { sohbet_id, hata_turu: hataTuru(e) });
    }

    // 5. Atsa da sohbet silinmiştir: sonuç başarı.
    try {
      depo.walDaralt();
    } catch (e) {
      yaz("uyari", "wal_daraltilamadi", { sohbet_id, hata_turu: hataTuru(e) });
    }

    const seq = sonuc.silindi.seq;
    yaz("bilgi", "sohbet_silindi", {
      sohbet_id,
      silinen_olay: sonuc.silinen_olay,
      bosaltilan_tur: sonuc.bosaltilan_tur,
      silinen_kuyruk: sonuc.silinen_kuyruk,
      iptal_plan,
      seq,
      ornek_kaldirildi: kaldirilan !== null,
    });

    // 6. Arkada: sonlandırma (çağrı burada, eşzamanlı), transkript ve oturum kaydı silme.
    if (kaldirilan !== null) {
      const k = kaldirilan;
      arkaBaslat(sohbet_id, () => sonlandirArka(sohbet_id, k));
    } else {
      yaz("uyari", "sonlandirma_atlandi", { sohbet_id });
    }
    return { ok: true, deger: { seq } };
  };

  /**
   * Ortak sarmal: kapanış (`ic_hata`), yeniden giriş (eşzamanlı bölüm sürerken, örneğin işlem içinden
   * gelen ikinci çağrı: `sohbet_mesgul`, hangi sohbet olursa olsun), beklenmeyen hata (`ic_hata`).
   */
  const sarmala = <T>(
    sohbet: SohbetSecimi,
    f: () => T | Red<"sohbet_mesgul" | "ic_hata">,
  ): T | Red<"sohbet_mesgul" | "ic_hata"> => {
    const sohbet_id = sohbet.sohbet_id;
    if (kapali) {
      yaz("uyari", "kapali", { sohbet_id });
      return { ok: false, code: "ic_hata" };
    }
    if (suruyor) return mesgul(sohbet_id, "temizlik_suruyor");
    suruyor = true;
    try {
      return f();
    } catch (e) {
      return icHata(sohbet_id, "beklenmeyen_hata", e);
    } finally {
      suruyor = false;
    }
  };

  const bekle = async (): Promise<void> => {
    while (arka.size > 0) await Promise.all(Array.from(arka.values()));
  };

  return {
    gecmisiSil(sohbet) {
      return sarmala<Sonuc<TemizlikSonucu, TemizlikHatasi>>(sohbet, () => temizle(sohbet));
    },

    sohbetiSil(sohbet) {
      return sarmala<Sonuc<SohbetSilmeCiktisi, SohbetSilmeHatasi>>(sohbet, () => sohbetSil(sohbet));
    },

    bekle,

    async kapat() {
      kapali = true;
      await bekle();
    },
  };
};
