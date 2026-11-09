/**
 * `plan_oner` -> kart -> karar -> başlatma. MODULLER.md "planlar", protocol/README.md "Plan onayı".
 * `planOner` kart doğurur; istisna `konusma`'nın insan turunda önerilen temiz PC planıdır, tam yetkide
 * (Dilim 3b, `tamYetki()`) ise her PC planı; ikisi de `karar`'ın onay yolundan başlar. Servis yalnız
 * kaydedilen `plan_hash`'in metnini başlatır.
 *
 * Dilim 2 (MODULLER.md "Dilim 2" > "Aitlik", "planlar"): planın sohbeti yalnız `planOner`'in `sohbet`
 * parametresidir (köprü jeton kapsamı); sonrasında her yol onu depodaki `PlanKaydi.sohbet_id`'den okur.
 * İnsan turu, kirli zinciri ve mezar taşı kuralı o sohbetle sınırlıdır. `dayandigi_isler` sohbet
 * süzgecinden geçmez: başka sohbetin kirli işine dayanan plan da kirlidir (güvenli yön, bilinçli).
 */
import { Plan, SINIRLAR, isRaporuJsonSemasi, planHash } from "@eren/protocol";
import type { PlanOnerCikti } from "@eren/protocol";
import type {
  IsNo,
  PlanKararHatasi,
  PlanKaydi,
  PlanlarFabrikasi,
  SohbetSecimi,
  Sonuc,
} from "./sozlesme.ts";

/** `CreateProcess` komut satırı 32.767 birimdir, sondaki NUL dahil. */
const KOMUT_SATIRI_AZAMI = 32_766;
/**
 * `isler`'in bu modülün görmediği argümanları için kaçış sonrası üst pay: exe ve `mcp.json` yolu,
 * oturum kimliği, model, telefon güvenlik metnindeki üç kullanıcı adı.
 */
const AYAR_PAYI = 2 * 1_024 + 64 + 256 + 3 * 256;
/** Bayraklar ve sabit metinler. Ölçülen (0.5.0): pc 174, hafif 288, telefon 1.395 (güvenlik metni, araç listesi). */
const PROFIL_PAYI = { pc: 1_000, telefon: 3_000 } as const;
/** Görev argümanında `gorev_metni` dışındakiler: soru notu, ayraç, tırnaklar, baştaki boşluk. Ölçülen (0.5.0): 144. */
const GOREV_SABIT_PAYI = 1_000;

/**
 * libuv `quote_cmd_arg`'ın kaçış sonrası uzunluğuna üst sınır: argüman hep tırnaklı sayılır; her `"`,
 * ondan önceki ters bölüler ve sondaki ters bölüler ikiye katlanır. Parça parça toplamak da üst sınırdır:
 * `isler`'in ayraçları `"` ya da `\` taşımaz, parça sonundaki ters bölüler zaten katlı sayılır.
 */
const kacisliUzunluk = (s: string): number => {
  let n = s.length + 2;
  let katla = true;
  for (let i = s.length - 1; i >= 0; i--) {
    const c = s.charCodeAt(i);
    if (c === 0x22) {
      n++;
      katla = true;
    } else if (c === 0x5c) {
      if (katla) n++;
    } else {
      katla = false;
    }
  }
  return n;
};

const komutSatiriUstSiniri = (plan: Plan, semaUzunlugu: number): number => {
  const gorev = GOREV_SABIT_PAYI + kacisliUzunluk(plan.gorev_metni);
  return AYAR_PAYI + PROFIL_PAYI[plan.tur] + 1 + semaUzunlugu + 1 + gorev;
};

export const planlarKur: PlanlarFabrikasi = ({
  depo,
  isler,
  kilit,
  cihaz,
  nesil,
  insanTuru,
  tamYetki,
  dosya,
  rastgele,
  saat,
  veriyolu,
  gunluk,
}) => {
  let kapali = false;

  /**
   * Dilim 3b: PC tarafının tam yetki anahtarı. Ayar servis açılışında bir kez okunur; değişiklik yeniden başlatmayla geçerli olur.
   * Okunamayan ya da `true` olmayan değer kapalı sayılır: kart bugünkü kurallarla bekler.
   */
  const tamYetkiAcik = (): boolean => {
    try {
      return tamYetki() === true;
    } catch {
      gunluk.hata("planlar", "tam_yetki_okunamadi");
      return false;
    }
  };

  /**
   * Yalnız o sohbetin örneğinin insan turu: A'nın insan turu B'nin önerisini onaysız başlatmaz.
   * Okunamayan bilgi insan turu sayılmaz: kart onay bekler.
   */
  const aktifInsanTuru = (sohbet: SohbetSecimi): string | null => {
    try {
      return insanTuru?.(sohbet) ?? null;
    } catch {
      gunluk.hata("planlar", "insan_turu_okunamadi", { sohbet_id: sohbet.sohbet_id });
      return null;
    }
  };
  /** Silinmiş ya da hiç olmamış sohbete plan yazılmaz. */
  const sohbetCanliMi = (sohbet: SohbetSecimi): boolean => {
    const kayit = depo.sohbetGetir(sohbet);
    return kayit !== null && kayit.silinme_ms === null;
  };
  /** Başlatma beklerken ikinci bir karar ya da izin aynı planı yeniden başlatmasın. */
  const surenler = new Set<string>();
  const semaUzunlugu = kacisliUzunluk(isRaporuJsonSemasi());

  const onaylandiYaz = (kayit: PlanKaydi, is_id: IsNo): void => {
    const plan_id = kayit.plan.plan_id;
    const sohbet_id = kayit.sohbet_id;
    depo.islem(() => {
      depo.planGuncelle(plan_id, "onaylandi", is_id);
      depo.olayEkle({
        type: "plan_resolved",
        sohbet_id,
        plan_id,
        plan_hash: kayit.plan_hash,
        sonuc: "onaylandi",
        is_id,
      });
    });
    veriyolu.yayinla("plan_sonuclandi", { plan_id, sohbet_id, sonuc: "onaylandi", is_id });
  };

  /**
   * `isler.baslat` satırı ve `job_started`'ı `plan_resolved`'dan önce kesinleştirir: servis arada
   * ölürse plan sonuçlanmamış kalır ama işi vardır. O plana gelen karar yeni iş açmaz, planı o işle
   * sonuçlandırır. Yalnız `isler`'in `ayrikBaslat` atınca bıraktığı iz (pid ve olusturma_ms null, bitmiş) süreç
   * kesin açılmadı demektir; yalnız o yeniden denemeyi serbest bırakır. pid null ama olusturma_ms dolu iş,
   * servis başlatma sırasında ölmüş olsa da `claude` çalışmış olabilir.
   * Depo planın en yeni işini verir; başka iş yalnız böyle biten işlerden sonra açılır.
   */
  const isVarsaSonuclandir = (kayit: PlanKaydi): boolean => {
    const is = depo.isPlanaGore(kayit.plan.plan_id);
    if (is === null) return false;
    if (is.pid === null && is.olusturma_ms === null && is.bitis_ms !== null) return false;
    onaylandiYaz(kayit, is.is_id);
    gunluk.uyari("planlar", "plan_isle_sonuclandi", { plan_id: kayit.plan.plan_id, is_id: is.is_id });
    return true;
  };

  const planiBaslat = async (kayit: PlanKaydi): Promise<Sonuc<void, PlanKararHatasi>> => {
    const plan_id = kayit.plan.plan_id;
    const eskiDurum = kayit.durum;
    surenler.add(plan_id);
    try {
      let hesaplanan: string;
      try {
        // Depodaki metin değişmişse ya da geçersizse planHash atar ya da farklı çıkar.
        hesaplanan = planHash(kayit.plan);
      } catch {
        gunluk.hata("planlar", "plan_hash_hesaplanamadi", { plan_id });
        return { ok: false, code: "ic_hata" };
      }
      if (hesaplanan !== kayit.plan_hash) {
        gunluk.hata("planlar", "depo_plan_degismis", { plan_id });
        return { ok: false, code: "ic_hata" };
      }

      // Profil ve sohbet depodaki kayıttan: bellekteki öneri bağlamından değil.
      const sonuc = await isler.baslat({
        plan: kayit.plan,
        plan_hash: hesaplanan,
        profil: kayit.profil,
        sohbet_id: kayit.sohbet_id,
      });
      if (!sonuc.ok) {
        if (eskiDurum === "izin_bekliyor") depo.planGuncelle(plan_id, "bekliyor", null);
        gunluk.uyari("planlar", "baslatma_basarisiz", { plan_id, code: sonuc.code });
        return { ok: false, code: sonuc.code === "limit_kilitli" ? "limit_kilitli" : "ic_hata" };
      }

      // plan_resolved iş başladıktan sonra, durum güncellemesiyle tek işlemde.
      onaylandiYaz(kayit, sonuc.deger);
      return { ok: true, deger: undefined };
    } catch {
      gunluk.hata("planlar", "baslatma_istisna", { plan_id });
      try {
        if (eskiDurum === "izin_bekliyor") depo.planGuncelle(plan_id, "bekliyor", null);
      } catch {
        // durum yazılamadıysa yapılacak başka şey yok
      }
      return { ok: false, code: "ic_hata" };
    } finally {
      surenler.delete(plan_id);
    }
  };

  const izinleriDinle = veriyolu.dinle("izin_geldi", ({ izin }) => {
    if (kapali) return;
    void (async () => {
      try {
        if (surenler.has(izin.plan_id)) return;
        const kayit = depo.planGetir(izin.plan_id);
        // Sonuçlanmış (iptal, reddedildi) plana geç gelen izin telefonda açık kalmasın.
        if (
          kayit !== null &&
          (kayit.durum === "iptal" || kayit.durum === "reddedildi") &&
          kayit.plan_hash === izin.plan_hash
        ) {
          cihaz.izinGeriCek(izin.grant_id, "is_iptal");
          return;
        }
        // Karar yokken izin başlatmaz: yalnız karar kaydedilmiş (izin_bekliyor) plan.
        if (kayit === null || kayit.durum !== "izin_bekliyor") return;
        if (kayit.plan_hash !== izin.plan_hash) return;
        if (isVarsaSonuclandir(kayit)) return;
        if (!kilit.baslatmaSerbestMi()) {
          gunluk.uyari("planlar", "izin_geldi_kilitli", { plan_id: izin.plan_id });
          return;
        }
        await planiBaslat(kayit);
      } catch {
        gunluk.hata("planlar", "izin_geldi_hata", { plan_id: izin.plan_id });
      }
    })();
  });

  const izinGidenDinle = veriyolu.dinle("izin_gitti", ({ plan_id }) => {
    if (kapali) return;
    try {
      if (surenler.has(plan_id)) return;
      const kayit = depo.planGetir(plan_id);
      if (kayit === null || kayit.durum !== "izin_bekliyor") return;
      depo.planGuncelle(plan_id, "bekliyor", null);
    } catch {
      gunluk.hata("planlar", "izin_gitti_hata", { plan_id });
    }
  });

  // Açılışta, `isler.uzlastir` önceki sürecin işlerini sahiplenip bitirdikten sonra. Tek dinleyici,
  // olay başına tek geçiş: `sohbetler` sayılarına bakmaz, bütün sohbetlerin bekleyen planlarını
  // (süzgeçsiz) bir kez dolaşır. İkinci olay sonuçlanmış plana yeni olay yazmaz.
  const uzlastirmaDinle = veriyolu.dinle("isler_uzlastirildi", () => {
    if (kapali) return;
    let bekleyenler: PlanKaydi[];
    try {
      bekleyenler = depo.bekleyenPlanlar();
    } catch {
      gunluk.hata("planlar", "uzlastirma_okunamadi");
      return;
    }
    for (const kayit of bekleyenler) {
      if (surenler.has(kayit.plan.plan_id)) continue;
      try {
        isVarsaSonuclandir(kayit);
      } catch {
        gunluk.hata("planlar", "uzlastirma_hatasi", { plan_id: kayit.plan.plan_id });
      }
    }
  });

  // `sohbet_id` OKUYAN ana oturumun sohbetidir (işin değil): kirlilik okuyanın bağlamına bulaşır.
  const kirliOkunduDinle = veriyolu.dinle("kirli_okundu", ({ is_id, sohbet_id }) => {
    if (kapali) return;
    try {
      depo.kirliOkumaEkle({ is_id, sohbet_id, nesil: nesil({ sohbet_id }), ts_ms: saat.simdiMs() });
    } catch {
      gunluk.hata("planlar", "kirli_okuma_yazilamadi", { is_id, sohbet_id });
    }
  });

  /** Telefonun `plan_decision`'ı ile insan turundaki PC önerisinin ortak yolu. Hash depodaki plandan yeniden hesaplanır. */
  const kararIsle = async (
    plan_id: string,
    plan_hash: string,
    secim: "onay" | "ret",
  ): Promise<Sonuc<void, PlanKararHatasi>> => {
    try {
      const kayit = depo.planGetir(plan_id);
      if (kayit === null) return { ok: false, code: "plan_bulunamadi" };
      if (plan_hash !== kayit.plan_hash) return { ok: false, code: "plan_hash_uyusmuyor" };
      if (kayit.durum === "onaylandi" || kayit.durum === "reddedildi" || kayit.durum === "iptal") {
        return { ok: false, code: "plan_zaten_sonuclandi" };
      }
      if (surenler.has(kayit.plan.plan_id)) return { ok: false, code: "plan_zaten_sonuclandi" };
      // Kilit ve izinden önce: yeni iş başlamayacak, plan yalnız sonuçlanır.
      if (isVarsaSonuclandir(kayit)) {
        return secim === "onay" ? { ok: true, deger: undefined } : { ok: false, code: "plan_zaten_sonuclandi" };
      }

      if (secim === "ret") {
        depo.islem(() => {
          depo.planGuncelle(kayit.plan.plan_id, "reddedildi", null);
          depo.olayEkle({
            type: "plan_resolved",
            sohbet_id: kayit.sohbet_id,
            plan_id: kayit.plan.plan_id,
            plan_hash: kayit.plan_hash,
            sonuc: "reddedildi",
          });
        });
        if (kayit.plan.tur === "telefon") {
          const izin = cihaz.izinBul(kayit.plan.plan_id, kayit.plan_hash);
          if (izin !== null) cihaz.izinGeriCek(izin.grant_id, "is_iptal");
        }
        veriyolu.yayinla("plan_sonuclandi", {
          plan_id: kayit.plan.plan_id,
          sohbet_id: kayit.sohbet_id,
          sonuc: "reddedildi",
        });
        return { ok: true, deger: undefined };
      }

      if (!kilit.baslatmaSerbestMi()) return { ok: false, code: "limit_kilitli" };

      if (kayit.plan.tur === "telefon") {
        const izin = cihaz.izinBul(kayit.plan.plan_id, kayit.plan_hash);
        if (izin === null) {
          if (kayit.durum !== "izin_bekliyor") depo.planGuncelle(kayit.plan.plan_id, "izin_bekliyor", null);
          return { ok: false, code: "izin_bekleniyor" };
        }
      }
      return await planiBaslat(kayit);
    } catch {
      gunluk.hata("planlar", "karar_istisna");
      return { ok: false, code: "ic_hata" };
    }
  };

  type OnerDurumu = Pick<PlanOnerCikti, "durum" | "is_id" | "neden">;

  /**
   * Yeni PC planını karar beklemeden onay yolundan başlatmayı dener ve `plan_oner`'in gerçek durumunu
   * döner. Tam yetkide tur ve kirli kaynak ayrımı yoktur; kapalıyken yalnız kullanıcının mesajıyla
   * başlayan turda önerilen temiz plan başlar. Kullanıcının turu öneri işlenirken bittiyse (kesme, yeni
   * mesaj) iki durumda da kart kalır. Kilit, işi olan plan ve eşzamanlı karar kuralları `kararIsle`'de
   * aynen; başlatma olmazsa kart kalır, kullanıcı onaylar.
   */
  const pcOnaysizBaslat = async (
    plan: Plan,
    plan_hash: string,
    turn_id: string | null,
    sohbet: SohbetSecimi,
  ): Promise<OnerDurumu> => {
    const plan_id = plan.plan_id;
    const kirli = plan.kirli_kaynak !== undefined;
    const tam = tamYetkiAcik();
    if (!tam && turn_id === null) return { durum: "onay_bekliyor", neden: "tam_yetki_kapali" };
    if (!tam && kirli) return { durum: "onay_bekliyor", neden: "kirli_kaynak" };
    const iz: Record<string, boolean> = tam ? { tam_yetki: true, kirli } : {};
    try {
      // Aynı sohbetin aynı turu: başka sohbetin turu ya da aynı sohbetin sonraki turu sayılmaz.
      if (turn_id !== null && aktifInsanTuru(sohbet) !== turn_id) {
        gunluk.bilgi("planlar", "insan_turu_bitti", { plan_id, ...iz });
        return { durum: "onay_bekliyor", neden: "tur_bitti" };
      }
      const sonuc = await kararIsle(plan_id, plan_hash, "onay");
      // Eşzamanlı bir karar (telefon) planı bu arada başlatmış olabilir: depodaki gerçek kazanır.
      const kayit = sonuc.ok || sonuc.code === "plan_zaten_sonuclandi" ? depo.planGetir(plan_id) : null;
      if (kayit !== null && kayit.durum === "onaylandi") {
        gunluk.bilgi("planlar", "onaysiz_basladi", { plan_id, ...iz });
        return kayit.is_id === null ? { durum: "basladi" } : { durum: "basladi", is_id: kayit.is_id };
      }
      const code = sonuc.ok ? "durum_okunamadi" : sonuc.code;
      gunluk.uyari("planlar", "onaysiz_baslatilamadi", { plan_id, code, ...iz });
      return { durum: "onay_bekliyor", neden: code === "limit_kilitli" ? "limit_kilitli" : "baslatma_hatasi" };
    } catch {
      gunluk.hata("planlar", "onaysiz_baslatma_istisna", { plan_id });
      return { durum: "onay_bekliyor", neden: "baslatma_hatasi" };
    }
  };

  return {
    async planOner(taslak, profil, sohbet) {
      // Sohbet yalnız parametreden (köprü jeton kapsamı); taslakta alan yok. Kopyalanır: sonraki
      // `await`'lerde çağıranın nesnesi değişse de plan aynı sohbete yazılır.
      const sahip: SohbetSecimi = { sohbet_id: sohbet.sohbet_id };
      // İlk `await`'ten önce: çağrının geldiği tur, yalnız bu sohbette.
      const turn_id = aktifInsanTuru(sahip);
      try {
        if (!sohbetCanliMi(sahip)) {
          gunluk.uyari("planlar", "plan_gecersiz", { yollar: "sohbet", sohbet_id: sahip.sohbet_id });
          return { ok: false, code: "plan_gecersiz", detail: "sohbet" };
        }
        const { dayandigi_isler, ...govde } = taslak;

        // kirli_kaynak = (dayandigi_isler ∩ kirli işler) ∪ kirliOkumalar(enAz, planın sohbeti).
        // `dayandigi_isler` sohbete göre süzülmez: başka sohbetin kirli işine dayanan plan da kirlidir.
        const kirli = new Set<number>();
        for (const is_id of dayandigi_isler ?? []) {
          const is = depo.isGetir(is_id);
          if (is !== null && is.kirli) kirli.add(is_id);
        }
        // Önceki nesil = bu sohbetin etkin nesilden küçük en büyük nesli (`simdiki - 1` değil: numaralar
        // bütün sohbetlerde tekil, araya başka sohbetin nesli girer). Yalnız bu sohbetin son mezar
        // taşından sonra başladıysa sayılır: silinen geçmişin okuması taşınmaz.
        const simdiki = nesil(sahip);
        const mezar = depo.sonMezarTasi(sahip);
        let onceki: { nesil: number; baslangic_ms: number } | undefined;
        for (const n of depo.nesiller(sahip)) {
          if (n.nesil < simdiki && (onceki === undefined || n.nesil > onceki.nesil)) onceki = n;
        }
        // Bu sohbette önceki nesil kaydı yoksa: mezar taşı da yoksa dilim 1 gibi `simdiki - 1` (okumalar
        // sohbetle süzüldüğü için başka sohbetin nesli karışmaz; fazla kirli güvenli yöndür), varsa etkin nesil.
        const enAz =
          onceki !== undefined
            ? mezar === null || onceki.baslangic_ms > mezar.ts_ms
              ? onceki.nesil
              : simdiki
            : mezar === null
              ? simdiki - 1
              : simdiki;
        for (const is_id of depo.kirliOkumalar(enAz, sahip)) kirli.add(is_id);
        const sirali = [...kirli].sort((a, b) => b - a);
        const kirli_kaynak = sirali.slice(0, SINIRLAR.KIRLI_KAYNAK_ADET);
        if (sirali.length > kirli_kaynak.length) {
          gunluk.uyari("planlar", "kirli_kaynak_tasti", {
            toplam: sirali.length,
            atilan: sirali.length - kirli_kaynak.length,
          });
        }

        const aday = {
          plan_id: rastgele.opakId("plan"),
          ...govde,
          ...(kirli_kaynak.length > 0 ? { kirli_kaynak } : {}),
        };
        const ayrisan = Plan.safeParse(aday);
        if (!ayrisan.success) {
          const yollar = [...new Set(ayrisan.error.issues.map((s) => s.path.join(".") || "plan"))].join(",");
          gunluk.uyari("planlar", "plan_gecersiz", { yollar });
          return { ok: false, code: "plan_gecersiz", detail: yollar };
        }
        const plan = ayrisan.data;

        if (plan.tur === "pc") {
          let var_mi = false;
          try {
            var_mi = await dosya.dizinVarMi(plan.cwd);
          } catch {
            gunluk.uyari("planlar", "cwd_denetlenemedi", { plan_id: plan.plan_id });
          }
          if (!var_mi) {
            gunluk.uyari("planlar", "plan_gecersiz", { yollar: "cwd" });
            return { ok: false, code: "plan_gecersiz", detail: "cwd" };
          }
        }
        // Windows `spawn` argümanları tırnaklayıp kaçırır: ham uzunluk sınırı aşan planı kaçırabilir.
        if (komutSatiriUstSiniri(plan, semaUzunlugu) > KOMUT_SATIRI_AZAMI) {
          gunluk.uyari("planlar", "plan_gecersiz", { yollar: "gorev_metni" });
          return { ok: false, code: "plan_gecersiz", detail: "gorev_metni" };
        }

        const hash = planHash(plan);
        // Sohbet `await` sırasında silinmiş olabilir: denetim yazımla aynı işlemde yinelenir. `sohbetiSil`
        // bekleyenleri kendi işleminde iptal ettiği için silinen sohbete sahipsiz plan kalmaz.
        const yazildi = depo.islem(() => {
          if (!sohbetCanliMi(sahip)) return false;
          depo.planEkle({
            plan,
            plan_hash: hash,
            durum: "bekliyor",
            is_id: null,
            olusturma_ms: saat.simdiMs(),
            profil: plan.tur === "pc" ? profil : "tam",
            sohbet_id: sahip.sohbet_id,
          });
          depo.olayEkle({ type: "plan_proposed", sohbet_id: sahip.sohbet_id, plan, plan_hash: hash });
          return true;
        });
        if (!yazildi) {
          gunluk.uyari("planlar", "plan_gecersiz", { yollar: "sohbet", sohbet_id: sahip.sohbet_id });
          return { ok: false, code: "plan_gecersiz", detail: "sohbet" };
        }
        veriyolu.yayinla("plan_onerildi", { plan_id: plan.plan_id, sohbet_id: sahip.sohbet_id });
        // Kart yazıldı: başlatmanın sonucu ne olursa olsun öneri başarılıdır; dönüş gerçek durumu taşır.
        // Tam yetkide her PC planı (insan ya da sentetik tur, kirli_kaynak dolu ya da boş) karar
        // beklemeden başlar; kirli_kaynak yine hesaplanıp plana yazılmıştır (iz). Telefon planı telefona
        // gider: telefonun tam yetkisi ve uygulama durumu orada karar verir, servis bu anda bilemez.
        // Tam yetki kapalıyken güvenilmez telefon verisine dayanan plan insan turunda da onay bekler.
        const durum: OnerDurumu =
          plan.tur === "pc"
            ? await pcOnaysizBaslat(plan, hash, turn_id, sahip)
            : { durum: "telefonda_baslatiliyor" };
        return { ok: true, deger: { plan_id: plan.plan_id, plan_hash: hash, ...durum } };
      } catch {
        gunluk.hata("planlar", "plan_oner_istisna");
        return { ok: false, code: "plan_gecersiz", detail: "ic_hata" };
      }
    },

    karar: (mesaj) => kararIsle(mesaj.plan_id, mesaj.plan_hash, mesaj.karar),

    /** Yalnız o sohbetin planları. Eşzamanlı, `await` yok; `plan_sonuclandi` yayınlanmaz. */
    bekleyenleriIptal(sohbet) {
      let sayi = 0;
      for (const kayit of depo.bekleyenPlanlar(sohbet)) {
        // Depo süzer; yine de başka sohbetin planına asla dokunulmaz.
        if (kayit.sohbet_id !== sohbet.sohbet_id) continue;
        const plan_id = kayit.plan.plan_id;
        depo.islem(() => {
          depo.planGuncelle(plan_id, "iptal", null);
          depo.olayEkle({
            type: "plan_resolved",
            sohbet_id: kayit.sohbet_id,
            plan_id,
            plan_hash: kayit.plan_hash,
            sonuc: "iptal",
          });
        });
        sayi++;
        if (kayit.plan.tur === "telefon") {
          try {
            const izin = cihaz.izinBul(plan_id, kayit.plan_hash);
            if (izin !== null) cihaz.izinGeriCek(izin.grant_id, "is_iptal");
          } catch {
            gunluk.hata("planlar", "iptal_izin_geri_cekilemedi", { plan_id });
          }
        }
      }
      return sayi;
    },

    kapat() {
      kapali = true;
      izinleriDinle();
      izinGidenDinle();
      uzlastirmaDinle();
      kirliOkunduDinle();
    },
  };
};
