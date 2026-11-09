/**
 * Oto izin kancası (Dilim 3b §6). Tam yetki açıkken, bütün sohbetlerde "bekliyor" durumundaki
 * telefon planı kartları için onay ekranı açmadan `cihaz.otoIzin(plan_json, plan_hash)` denenir:
 * `verildi` → o sohbetin `planKarari(plan_id, plan_hash, "onay")`; `onay_gerekli` → kart
 * kullanıcıya kalır ("Telefonda izin iste" düğmesi aynen), nedeni bu kancanın deposunda tutulur.
 *
 * Kart başına tek değerlendirme (bellekte iz, anahtar `plan_id` + `plan_hash`): tam yetki o an
 * kapalıysa kart denenmeden kullanıcıya bırakılır ve sonradan tam yetki açılsa da yeniden
 * değerlendirilmez. Kararı zaten kuyrukta ya da hatalarda olan kart (kullanıcı ya da önceki süreç
 * karar verdi; `izin_bekleniyor` dahil) hiç denenmez. Yalnız yüklenmiş, bağlı ve eşitlenmiş
 * çekirdekte çalışır: eksik olaylar gelirken "bekliyor" görünen kart aslında sonuçlanmış olabilir.
 *
 * **Yalnız yeni öneri** (`oneriYeniMi`): bellekteki iz süreçle ölür; yeniden başlayan süreç, önceki
 * sürecin tam yetki kapalıyken bilerek bekletilmiş bıraktığı kartı ayırt edemez. Bu yüzden kart
 * ancak önerisi (`plan_proposed.ts_ms`, PC saati) `OTO_IZIN_AZAMI_YAS_MS`'ten yeni ise denenir;
 * zamanı bilinmeyen ya da saat payını aşan ileri tarihli kart denenmez. Tam yetki köprüden
 * okunamazsa kartlar işaretlenmez: sonraki tetikte (hâlâ yeniyse) yeniden değerlendirilir.
 *
 * **Ya otomatik ya elle**: kullanıcı karta elle karar vermeye başlayınca (`elleBasla`) kart
 * otomatik denemeden çıkar; otomatik deneme sürerken (`deneniyor`) elle yol başlamaz ve kartın
 * düğmeleri kapalıdır (`otoIzinKartGorunumu`).
 *
 * Nedenin kartta gösterilmesi: çekirdek kart nesnesine yazılmaz. `App.tsx` deposu
 * `OtoIzinBaglami` ile verir; `PlanKartiEkrani` `useOtoIzinNotu`/`useOtoIzinDeneniyor` ile okur ve
 * `otoIzinKartGorunumu` ile yazar.
 */
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import type {
  BekleyenOge,
  Cekirdek,
  CekirdekDurumu,
  GidenHatasi,
  GorunumOgesi,
  PlanKarti,
  SohbetId,
} from "../cekirdek/index.ts";
import type { ErenCihaz } from "../cihaz/erenDevice.ts";
import type { OtoIzinNedeni } from "../../modules/eren-device/src/ErenDevice.types.ts";

/**
 * Kartın kullanıcıya kalma nedeni. Köprünün nedenlerine ek: `kopru_hatasi` (otoIzin çağrısı
 * düştü), `karar_gonderilemedi` (izin verildi ama `planKarari` kuyruğa giremedi).
 */
export type OtoIzinNotu = OtoIzinNedeni | "kopru_hatasi" | "karar_gonderilemedi";

export const OTO_IZIN_NOT_METNI: Record<OtoIzinNotu, string> = {
  tam_yetki_kapali: "Otomatik izin verilmedi: tam yetki kapalı.",
  gecersiz: "Otomatik izin verilmedi: plan telefonda doğrulanamadı.",
  uygulama_listede_degil: "Otomatik izin verilmedi: uygulama izin listesinde açık değil.",
  hassas: "Otomatik izin verilmedi: hassas ya da korunan bir uygulama.",
  erisim_acilamadi: "Otomatik izin verilmedi: erişilebilirlik servisi açılamadı.",
  cekirdek_yok: "Otomatik izin verilmedi: telefon çekirdeği hazır değil.",
  kopru_hatasi: "Otomatik izin denenemedi.",
  karar_gonderilemedi: "İzin verildi ama karar gönderilemedi.",
};

export const OTO_IZIN_DENENIYOR_METNI = "Otomatik izin deneniyor.";

/**
 * Otomatik denenecek önerinin azami yaşı. Bağlı telefonda öneri saniyeler içinde gelir; kopuk
 * bağlantıda en kötü yol geri çekilme tavanı (30 sn) + el sıkışma (15 sn) + eşitleme + erişilebilirlik
 * açılışı (≤ 4 sn), bir dakikanın altı. İki kat pay. Daha uzun tutmak, bekletilmiş kartın yeniden
 * başlatmadan sonra kendiliğinden onaylanma penceresini büyütür.
 */
export const OTO_IZIN_AZAMI_YAS_MS = 2 * 60_000;
/** PC saati (`ts_ms`) telefondan ileriyse önerinin "gelecekte" görünmesine izin verilen pay. */
export const OTO_IZIN_SAAT_PAYI_MS = 30_000;

export interface KartKimligi {
  plan_id: string;
  plan_hash: string;
}

export interface OtoIzinAdayi extends KartKimligi {
  sohbet_id: SohbetId;
  plan_json: string;
}

/** `otoIzinAdaylari` girdisi: bir sohbet ve `Sohbet.durum()`'unun gereken alanları. */
export interface OtoIzinSohbetGirdisi {
  sohbet_id: SohbetId;
  ogeler: readonly GorunumOgesi[];
  bekleyenler: readonly BekleyenOge[];
  hatalar: readonly GidenHatasi[];
}

export const kartAnahtari = (k: KartKimligi): string => `${k.plan_id}\n${k.plan_hash}`;

/** Saf: kartlar ancak yüklenmiş, bağlı ve eşitlenmiş çekirdekte değerlendirilir. */
export const otoIzinZamaniMi = (d: Pick<CekirdekDurumu, "yuklendi" | "baglanti" | "esitleniyor">): boolean =>
  d.yuklendi && d.baglanti === "bagli" && !d.esitleniyor;

/**
 * Saf: öneri otomatik denenecek kadar yeni mi. Zamanı bilinmeyen (sonlu pozitif sayı değil) öneri,
 * `OTO_IZIN_AZAMI_YAS_MS`'ten eski öneri ve `OTO_IZIN_SAAT_PAYI_MS`'ten fazla ileri tarihli öneri
 * yeni değildir; telefon saati okunamadıysa hiçbir öneri yeni değildir.
 */
export const oneriYeniMi = (ts_ms: number, simdiMs: number): boolean => {
  if (!Number.isFinite(ts_ms) || ts_ms <= 0 || !Number.isFinite(simdiMs)) return false;
  const yas = simdiMs - ts_ms;
  return yas >= -OTO_IZIN_SAAT_PAYI_MS && yas <= OTO_IZIN_AZAMI_YAS_MS;
};

/**
 * Saf: denenecek kartlar, sohbet ve görünüm sırasıyla. Aday: `tur:"plan"`, `durum:"bekliyor"`,
 * `plan.tur:"telefon"`, önerisi `simdiMs`'e göre yeni (`oneriYeniMi`), `degerlendirilen`'de yok ve
 * hiçbir sohbetin `bekleyenler`/`hatalar`'ında aynı `plan_id`'nin `plan_decision`'ı yok.
 */
export function otoIzinAdaylari(
  sohbetler: readonly OtoIzinSohbetGirdisi[],
  degerlendirilen: ReadonlySet<string>,
  simdiMs: number,
): OtoIzinAdayi[] {
  const kararli = new Set<string>();
  for (const s of sohbetler) {
    for (const b of s.bekleyenler) if (b.mesaj.type === "plan_decision") kararli.add(b.mesaj.plan_id);
    for (const h of s.hatalar) if (h.mesaj.type === "plan_decision") kararli.add(h.mesaj.plan_id);
  }
  const sonuc: OtoIzinAdayi[] = [];
  for (const s of sohbetler) {
    for (const o of s.ogeler) {
      if (o.tur !== "plan" || o.durum !== "bekliyor" || o.plan.tur !== "telefon") continue;
      if (!oneriYeniMi(o.ts_ms, simdiMs)) continue;
      if (kararli.has(o.plan_id) || degerlendirilen.has(kartAnahtari(o))) continue;
      sonuc.push({ sohbet_id: s.sohbet_id, plan_id: o.plan_id, plan_hash: o.plan_hash, plan_json: o.plan_json });
    }
  }
  return sonuc;
}

export interface OtoIzinKartGorunumu {
  /** Kartta küçük satır olarak yazılacak metin; yoksa `null`. */
  satir: string | null;
  /** Kartın karar düğmeleri kapalı mı (otomatik deneme sürüyor). */
  kilitli: boolean;
}

/**
 * Saf: kartın oto izin satırı ve kilidi. Sonuçlanmış kartta hiçbir şey; bekleyen kartta deneme
 * sürüyorsa "deneniyor" ve kilit, değilse varsa kullanıcıya kalma nedeni.
 */
export function otoIzinKartGorunumu(
  durum: PlanKarti["durum"],
  not: OtoIzinNotu | null,
  deneniyor: boolean,
): OtoIzinKartGorunumu {
  if (durum !== "bekliyor") return { satir: null, kilitli: false };
  if (deneniyor) return { satir: OTO_IZIN_DENENIYOR_METNI, kilitli: true };
  return { satir: not === null ? null : OTO_IZIN_NOT_METNI[not], kilitli: false };
}

/** Kart yüzeyi (`PlanKartiEkrani` için). */
export interface OtoIzinDeposu {
  /** Kart kullanıcıya kaldıysa nedeni; denenmediyse, verildiyse ya da başkası karar verdiyse `null`. */
  notu(k: KartKimligi): OtoIzinNotu | null;
  /** Kart için otomatik deneme şu an sürüyor mu (köprüye gidildi, karar henüz kuyrukta değil). */
  deneniyor(k: KartKimligi): boolean;
  /**
   * Kullanıcı karta elle karar vermeye başlıyor ("Telefonda izin iste" ya da "Reddet"). Otomatik
   * deneme sürüyorsa `false` (elle yol başlamaz); değilse kart otomatik denemeden kalıcı olarak
   * çıkar ve `true`.
   */
  elleBasla(k: KartKimligi): boolean;
  /** Bir not ya da deneme durumu değişince çağrılır. */
  abone(f: () => void): () => void;
}

export interface OtoIzinYurutucusu extends OtoIzinDeposu {
  /** Çekirdeğe abone olur ve kartları değerlendirmeye başlar; kapatıcı döner. */
  baslat(): () => void;
}

/** React'sız yürütücü: kanca bunu sarar, testler doğrudan kullanır. `simdiMs`: telefon saati. */
export function otoIzinKur(
  cekirdek: Cekirdek,
  cihaz: ErenCihaz,
  simdiMs: () => number = Date.now,
): OtoIzinYurutucusu {
  const degerlendirilen = new Set<string>();
  /** Otomatik denemesi şu an süren kartlar. */
  const denenen = new Set<string>();
  const notlar = new Map<string, OtoIzinNotu>();
  const dinleyiciler = new Set<() => void>();
  let calisiyor = false;
  let tekrar = false;
  let durdu = true;

  const bildir = (): void => {
    for (const f of [...dinleyiciler]) {
      try {
        f();
      } catch {
        // Bir ekranın hatası ötekileri durdurmaz.
      }
    }
  };

  const notYaz = (k: KartKimligi, n: OtoIzinNotu): void => {
    notlar.set(kartAnahtari(k), n);
    bildir();
  };

  /** Güncel adaylar; çekirdek değerlendirmeye hazır değilse boş. */
  const adaylar = (): OtoIzinAdayi[] => {
    const d = cekirdek.durum();
    if (!otoIzinZamaniMi(d)) return [];
    const girdi = d.sohbetler.map((oz): OtoIzinSohbetGirdisi => {
      const s = cekirdek.sohbet(oz.sohbet_id).durum();
      return { sohbet_id: oz.sohbet_id, ogeler: s.ogeler, bekleyenler: s.bekleyenler, hatalar: s.hatalar };
    });
    return otoIzinAdaylari(girdi, degerlendirilen, simdiMs());
  };

  const dene = async (a: OtoIzinAdayi): Promise<void> => {
    const r = await cihaz.otoIzin(a.plan_json, a.plan_hash);
    if (!r.ok) {
      notYaz(a, "kopru_hatasi");
      return;
    }
    if (r.deger.sonuc === "onay_gerekli") {
      notYaz(a, r.deger.neden);
      return;
    }
    const s = await cekirdek.sohbet(a.sohbet_id).planKarari(a.plan_id, a.plan_hash, "onay");
    // Arada kullanıcı ya da başka yol karar verdiyse not gerekmez.
    if (!s.ok && s.neden !== "zaten_yollandi" && s.neden !== "plan_sonuclandi") {
      notYaz(a, "karar_gonderilemedi");
    }
  };

  const tur = async (): Promise<void> => {
    const ilk = adaylar();
    if (ilk.length === 0) return;
    const cd = await cihaz.durum();
    if (durdu) return;
    // Okunamadı (geçici): işaretlenmez; sonraki tetikte, kart hâlâ yeniyse yeniden değerlendirilir.
    if (!cd.ok) return;
    if (!cd.deger.tam_yetki) {
      // Tam yetki kapalı: bu kartlar denenmeden kullanıcıya kalır.
      for (const a of ilk) degerlendirilen.add(kartAnahtari(a));
      return;
    }
    for (const a of ilk) {
      if (durdu) return;
      // Köprü beklenirken kullanıcı karar vermiş ya da elle başlamış, kart sonuçlanmış ya da
      // eskimiş, bağlantı gitmiş olabilir.
      const anahtar = kartAnahtari(a);
      if (!adaylar().some((x) => kartAnahtari(x) === anahtar)) continue;
      degerlendirilen.add(anahtar);
      denenen.add(anahtar);
      bildir();
      try {
        await dene(a);
      } catch {
        notYaz(a, "kopru_hatasi");
      } finally {
        denenen.delete(anahtar);
        bildir();
      }
    }
  };

  /** Tek yürütme: çalışırken gelen tetik, tur bitince bir tur daha yaptırır. */
  const tetikle = (): void => {
    if (durdu || !cihaz.desteklenir) return;
    if (calisiyor) {
      tekrar = true;
      return;
    }
    calisiyor = true;
    void (async () => {
      try {
        do {
          tekrar = false;
          try {
            await tur();
          } catch {
            // Bir turun hatası sonrakileri durdurmaz.
          }
        } while (tekrar && !durdu);
      } finally {
        calisiyor = false;
      }
    })();
  };

  return {
    notu: (k) => notlar.get(kartAnahtari(k)) ?? null,
    deneniyor: (k) => denenen.has(kartAnahtari(k)),
    elleBasla: (k) => {
      const anahtar = kartAnahtari(k);
      if (denenen.has(anahtar)) return false;
      degerlendirilen.add(anahtar);
      return true;
    },
    abone: (f) => {
      dinleyiciler.add(f);
      return () => {
        dinleyiciler.delete(f);
      };
    },
    baslat: () => {
      durdu = false;
      const kapat = cekirdek.abone(() => tetikle());
      return () => {
        durdu = true;
        kapat();
      };
    },
  };
}

const BOS_DEPO: OtoIzinDeposu = {
  notu: () => null,
  deneniyor: () => false,
  elleBasla: () => true,
  abone: () => () => {},
};

/** `App.tsx` yürütücüyü buradan verir; sağlayıcı yoksa notlar hep `null`, elle yol hep serbest. */
export const OtoIzinBaglami = createContext<OtoIzinDeposu>(BOS_DEPO);

/** Uygulama ömrü boyunca oto izin; dönen depo `OtoIzinBaglami` değeridir. */
export function useOtoIzin(cekirdek: Cekirdek, cihaz: ErenCihaz): OtoIzinDeposu {
  const y = useMemo(() => otoIzinKur(cekirdek, cihaz), [cekirdek, cihaz]);
  useEffect(() => y.baslat(), [y]);
  return y;
}

/** `PlanKartiEkrani` için: `elleBasla` çağrısı bu depoya yapılır. */
export const useOtoIzinDeposu = (): OtoIzinDeposu => useContext(OtoIzinBaglami);

/** `PlanKartiEkrani` için: kart kullanıcıya kaldıysa nedeni (`otoIzinKartGorunumu` ile yazılır). */
export function useOtoIzinNotu(kart: KartKimligi): OtoIzinNotu | null {
  const d = useContext(OtoIzinBaglami);
  return useSyncExternalStore(d.abone, () => d.notu(kart));
}

/** `PlanKartiEkrani` için: kart için otomatik deneme sürüyor mu (sürerken düğmeler kapalı). */
export function useOtoIzinDeneniyor(kart: KartKimligi): boolean {
  const d = useContext(OtoIzinBaglami);
  return useSyncExternalStore(d.abone, () => d.deneniyor(kart));
}
