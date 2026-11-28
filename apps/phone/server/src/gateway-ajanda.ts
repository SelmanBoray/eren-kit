/**
 * `/ajanda` kanalı (`docs/AJANDA.md` "Kanal akışı", MODULLER.md "Ajanda dalgası" > "gateway ve
 * dis-dunya"). Ayrı ajanda uygulamasının tek kapısı: eşleştirme (ajanda penceresiyle), kimlik
 * (`eren-ajanda-auth-v1`), telafi (`karsila` + `telafiSayfasi` + `esitlendi`), canlı `kayit`, `islem` →
 * `islem_sonucu`, `gecmis_iste` → `gecmis`. Yazmaz: her değişiklik `AjandaGatewayYuzu`'ndandır.
 *
 * Güvenlik sınırı: yalnız kapsamı `ajanda` olan cihaz bu yolu açar (`kanalKapsamdaMi`, `hello`'da ve
 * kimlik sonrası her çerçevede taze okuma); çözücü yalnız ajanda çerçevelerini tanır, `/sohbet` iş mesajı
 * burada `gecersiz_mesaj` + kapanıştır. Kayıt metni günlüğe yazılmaz (yalnız kimlik, revizyon, kod).
 * `gateway.ts` bağlantıyı buraya devreder ve ortak denetimleri (uzak adres, eşleştirme) verir.
 *
 * Sürüm uyumu (`apps/ajanda/YOL-HARITASI.md` 3.3): bağlantının sürümü ilk geçerli `hello` ya da
 * `pair_request` ile o çerçevenin `v`'sine sabitlenir (`AJANDA_SURUMLERI`'nden biri); sonraki her
 * çerçeve yalnız o sürümde çözülür. Servis içeride en yeni modelle (`AjandaAsagi`) çalışır, her aşağı
 * çerçeve `ajandaAsagiSurume` ile bağlantı sürümüne uyarlanıp denetlenerek çıkar; uyarlanamayan çerçeve
 * kabloya çıkmaz, bağlantı `ic_hata` ile kapanır. `protokol_uyumsuz` reddinin `v`'si her zaman
 * `AJANDA_SURUMU`'dur (istemcinin geri düşüşü bunu okur, `ajandaGeriDusus`). Öteki retlerde sürüm
 * sabit değilse ve çerçevede desteklenen `v` yoksa ret kümenin en küçük sürümüyle (`AJANDA_SURUMLERI[0]`)
 * gider; çünkü yayınlanmış eski uygulama `v`'si farklı ret çerçevesini "uygulama eski" sayıp yeniden
 * bağlanmayı bırakır. Kod sürüm kümesine geneldir:
 * yeni sürüm yalnız protokol paketinde eklenir.
 *
 * Yetenekler (v3): `welcome.yetenekler` = `ajandaYetenekKesisimi(hello.yetenekler, ajanda.yetenekler)`;
 * sunulan küme ajanda modülünün bağımlılığıdır (asistan motoruna bağlı değil). v2 bağlantıda alan
 * uyarlamada düşer.
 *
 * Ek yedeği (`ek_yedegi`; `ajanda-ekler.ts`): `ek_yukle`, `ek_parca`, `ek_iste` yalnız şu hepsi tutunca
 * ek modülüne gider: yüzde `ekler` var (`ajandaEkliYuz`), kimlik sonrası, `esitlendi` gitmiş ve bağlantının
 * kesişiminde `ek_yedegi` var (kesişim v2'de her zaman boştur; v2 şeması bu çerçeveleri zaten tanımaz).
 * Öteki hallerde bugünkü ret: `yetkisiz` + kapanış. Ek retleri `ek_ret` ile, bağlantı kapanmaz; yetki
 * denetimi her çerçevede öteki kimlik sonrası çerçeveler gibidir. İndirme bağlantının gönderim tamponuna
 * bakar (`TamponluWsBaglantisi`): okumayan istemci ek parçasıyla belleği dolduramaz.
 */
import {
  AJANDA_AZAMI_CERCEVE,
  AJANDA_SURUMLERI,
  AJANDA_SURUMU,
  ajandaAsagiSurume,
  ajandaKimlikImzaMetni,
  ajandaSurumuMu,
  ajandaYetenekKesisimi,
  ajandaYukariCoz,
  ESKI_CIHAZ_KAPSAMI,
  kanalKapsamdaMi,
} from "@eren/protocol";
import type {
  AjandaAsagi,
  AjandaKanalHatasi,
  AjandaKaydi,
  AjandaSurumluYukari,
  AjandaSurumNo,
  HataKodu,
} from "@eren/protocol";
import type {
  AjandaGatewayYuzu,
  AjandaGecmisSayfasi,
  AjandaIslemSonucuGovdesi,
  AnahtarPortu,
  CihazKaydi,
  CihazPlatformu,
  Depo,
  Gunluk,
  IptalEt,
  RastgelePortu,
  SaatPortu,
  WsBaglantisi,
  ZamanlayiciPortu,
} from "./sozlesme.ts";
import { AJANDA_EK_YETENEGI } from "./ajanda-ekler.ts";
import type { AjandaEkCercevesi, AjandaEkleri, AjandaEkOturumu } from "./ajanda-ekler.ts";

/**
 * Kanalın ajanda yüzü: gateway'in verdiği `AjandaGatewayYuzu`, ek yedeği kuruluysa `ekler` ile
 * (`ana` `ajandaEkliYuz` ile bağlar; `gateway.ts` yüzü olduğu gibi geçirir). `ekler` yoksa ek
 * çerçeveleri bugünkü gibi reddedilir.
 */
export type AjandaKanalYuzu = AjandaGatewayYuzu & { readonly ekler?: Pick<AjandaEkleri, "oturumAc"> };

/** Ajanda yüzüne ek modülünü ekler (yöntemler aynen yönlendirilir). */
export const ajandaEkliYuz = (yuz: AjandaGatewayYuzu, ekler: Pick<AjandaEkleri, "oturumAc">): AjandaKanalYuzu => ({
  islemUygula: (device_id, islem_id, islem) => yuz.islemUygula(device_id, islem_id, islem),
  gecersizIslem: (device_id, islem_id) => yuz.gecersizIslem(device_id, islem_id),
  karsila: (hello) => yuz.karsila(hello),
  telafiSayfasi: (g) => yuz.telafiSayfasi(g),
  gecmis: (kayit_id, once_rev) => yuz.gecmis(kayit_id, once_rev),
  get yetenekler() {
    return yuz.yetenekler;
  },
  ekler,
});

/**
 * Gönderim tamponunu bildiren bağlantı: gerçeği `dis-dunya` `GercekWsBaglantisi.bekleyenBayt` (`ws`
 * `bufferedAmount`). Sözleşmedeki `WsBaglantisi`'nde yok, bu yüzden isteğe bağlı; yoksa (sahte bağlantı)
 * ek indirmesinin tampon sınırı uygulanmaz. Yalnız ek indirmesi okur; kayıt telafisi ve canlı kayıt bilerek
 * sınırsızdır (`dis-dunya` `WS_CANLILIK_ARALIGI_MS` notu).
 */
export type TamponluWsBaglantisi = WsBaglantisi & { readonly bekleyenBayt?: () => number };

/** Telafide bir `telafiSayfasi` çağrısının en çok kayıt sayısı. */
export const AJANDA_TELAFI_SAYFASI = 200;

// Yukarı çerçeveler bağlantının sürümündedir (çözücü sonucu); gövdeleri bugün bütün sürümlerde aynı.
type Hello = Extract<AjandaSurumluYukari, { type: "hello" }>;
type PairRequest = Extract<AjandaSurumluYukari, { type: "pair_request" }>;
type IslemMesaji = Extract<AjandaSurumluYukari, { type: "islem" }>;
type GecmisIste = Extract<AjandaSurumluYukari, { type: "gecmis_iste" }>;

/** `gateway.ts`'in ortak eşleştirmesinin sonucu (pencere, kod, adres sayaçları orada). */
export type AjandaEslestirmeSonucu =
  | { ok: true; deger: string }
  | { ok: false; code: "eslestirme_kapali" | "eslestirme_kodu_gecersiz" | "ip_uyusmuyor" };

export interface AjandaEslestirmeIstegi {
  kod: string;
  public_key: string;
  platform: CihazPlatformu;
  etiket?: string | undefined;
}

export interface AjandaKanaliBagimliliklari {
  depo: Pick<Depo, "kapsamliCihazGetir">;
  ajanda: AjandaKanalYuzu;
  anahtar: Pick<AnahtarPortu, "acikAnahtar" | "imzala" | "dogrula">;
  rastgele: Pick<RastgelePortu, "baytlar">;
  saat: SaatPortu;
  zamanlayici: Pick<ZamanlayiciPortu, "sonra">;
  gunluk: Gunluk;
  /** Kimlik öncesi süre (`hello` → `welcome`), gateway'inkiyle aynı. */
  elSikismaMs: number;
  /** Gateway'in denetimi: Tailscale adresi ve PC'nin kendi adresi değil. */
  uzakIzinli: (ip: string) => boolean;
  /**
   * Gateway'in ortak eşleştirmesi, kapsam `ajanda` ile: pencerenin kapsamı ajanda değilse pencere yokmuş
   * gibi `eslestirme_kapali` (sayaç ve pencereye dokunmadan); başarıda cihaz `kapsam:"ajanda"` yazılır.
   */
  eslestir: (uzakIp: string, m: AjandaEslestirmeIstegi) => AjandaEslestirmeSonucu;
}

export interface AjandaKanali {
  /** `/ajanda` yolundan gelen yeni bağlantı (gateway çalışıyorken). */
  baglantiAl(b: TamponluWsBaglantisi): void;
  /** `veriyolu` `ajanda_kayit_yazildi`: açık ve kimliği bitmiş her bağlantıya (telafi sürüyorsa sıraya). */
  kayitYazildi(kayit: AjandaKaydi): void;
  /** Kaldırılan ya da anahtarı değişen ajanda cihazının açık bağlantılarını kapatır. */
  yetkiYokla(): void;
  /** Bütün bağlantıları kapatır (servis kapanışı). */
  kapat(): void;
}

/** Kimliği bitmiş bağlantının telafi ve canlı durumu. */
interface Oturum {
  readonly device_id: string;
  /** Bu bağlantıya giden en büyük revizyon; bundan küçük ya da eşit kayıt bir daha gitmez. */
  sonRev: number;
  /** `welcome` ile `esitlendi` arası: canlı kayıt sıraya girer. */
  telafide: boolean;
  bekleyen: AjandaKaydi[];
  /** `welcome.yetenekler` (kesişim): bu bağlantıda açılan davranışlar. */
  yetenekler: readonly string[];
  /** Ek yedeği durumu; ilk ek çerçevesinde açılır, bağlantı kapanınca kapanır. */
  ek: AjandaEkOturumu | null;
}

type Asama =
  | { ad: "hello_bekliyor" }
  | { ad: "yanit_bekliyor"; cihaz: CihazKaydi; hello: Hello; server_nonce: string }
  | { ad: "ajandada"; oturum: Oturum }
  | { ad: "kapali" };

interface Kimlik {
  readonly device_id: string;
  readonly public_key: string;
}

interface Baglanti {
  readonly b: TamponluWsBaglantisi;
  /**
   * Bağlantının sürümü: ilk geçerli `hello` ya da `pair_request`'in `v`'si, sonra değişmez. `null`:
   * henüz sabitlenmedi (yalnız ret çerçevesi gidebilir, sürümü `retSurumu`).
   */
  surum: AjandaSurumNo | null;
  asama: Asama;
  sureIptal: IptalEt | null;
  kimlik: Kimlik | null;
}

const kapanisKodu = (code: HataKodu): number => {
  if (code === "mesaj_cok_buyuk") return 1009;
  if (code === "protokol_uyumsuz") return 1002;
  if (code === "ic_hata") return 1011;
  return 1008;
};

/**
 * Ham çerçevenin `v`'si bu servisin sürüm kümesindeyse o; değilse (çok büyük, JSON değil, nesne değil,
 * `v` yok ya da desteklenmiyor) `null`. Yalnız sürümü sabitlenmemiş bağlantının ret yolunda çağrılır.
 */
const hamSurumu = (ham: string): AjandaSurumNo | null => {
  if (ham.length > AJANDA_AZAMI_CERCEVE.KANAL) return null;
  let deger: unknown;
  try {
    deger = JSON.parse(ham);
  } catch {
    return null;
  }
  const v = typeof deger === "object" && deger !== null ? (deger as { v?: unknown }).v : undefined;
  return ajandaSurumuMu(v) ? v : null;
};

export const ajandaKanaliKur = (d: AjandaKanaliBagimliliklari): AjandaKanali => {
  const { depo, ajanda, anahtar, rastgele, saat, zamanlayici, gunluk } = d;
  const baglantilar = new Set<Baglanti>();

  // Hata iletisi güvenilmez değer (ya da kayıt metni) taşıyabilir: yalnız türü yazılır.
  const hataYaz = (olay: string, e: unknown): void => {
    gunluk.hata("gateway", olay, { kanal: "ajanda", hata_turu: e instanceof Error ? e.name : typeof e });
  };

  /**
   * Çerçeveyi `v` sürümüne uyarlar, denetler ve yollar. Uyarlama ya da denetim tutmazsa çerçeve kabloya
   * çıkmaz, `false`; günlüğe yalnız tür, sürüm ve alan yolları yazılır (değer değil). Bağlantıya dokunmaz.
   */
  const cerceveYaz = (g: Baglanti, m: AjandaAsagi, v: AjandaSurumNo): boolean => {
    const u = ajandaAsagiSurume(m, v);
    if (!u.ok) {
      gunluk.hata("gateway", "asagi_uyarlama_hatasi", { kanal: "ajanda", type: m.type, v, code: u.kod, yollar: u.yollar.join(",") });
      return false;
    }
    g.b.gonder(JSON.stringify(u.mesaj));
    return true;
  };

  /**
   * Kimlik ve iş çerçeveleri: model en yeni sürümdedir (`v: AJANDA_SURUMU`, tip `AjandaAsagi`; öteki
   * kanalın çerçevesi derlenmez), kabloya bağlantı sürümünde çıkar. Yollanamadıysa bağlantı `ic_hata`
   * ile kapanmıştır, `false`: çağıran durumu ilerletmeden döner.
   */
  const yolla = (g: Baglanti, m: AjandaAsagi): boolean => {
    const v = g.surum;
    if (v !== null && cerceveYaz(g, m, v)) return true;
    if (v === null) gunluk.hata("gateway", "surumsuz_cerceve", { kanal: "ajanda", type: m.type });
    reddet(g, "ic_hata");
    return false;
  };

  const birak = (g: Baglanti): void => {
    if (g.asama.ad === "ajandada") {
      try {
        g.asama.oturum.ek?.kapat();
      } catch (e) {
        hataYaz("ek_kapanis_hatasi", e);
      }
    }
    g.asama = { ad: "kapali" };
    g.sureIptal?.();
    g.sureIptal = null;
    baglantilar.delete(g);
  };

  /**
   * Ret çerçevesinin sürümü. `protokol_uyumsuz`: her zaman servisin en yüksek sürümü (istemcinin geri
   * düşüşü buna dayanır). Öteki kodlar: sabit bağlantı sürümü; yoksa reddedilen çerçevenin desteklenen
   * `v`'si (eski istemci kendi kodunu okusun); o da yoksa (zaman aşımı, bozuk JSON, çok büyük çerçeve)
   * kümenin en küçük sürümü: yayınlanmış en eski uygulama `v`'si farklı ret çerçevesini "uygulama eski"
   * sayıp yeniden bağlanmayı bıraktığından, sürümü bilinmeyen istemciye en eski sürümde yanıt verilir.
   */
  const retSurumu = (g: Baglanti, code: AjandaKanalHatasi, cerceveSurumu: AjandaSurumNo | null): AjandaSurumNo => {
    if (code === "protokol_uyumsuz") return AJANDA_SURUMU;
    return g.surum ?? cerceveSurumu ?? AJANDA_SURUMLERI[0];
  };

  // Hata çerçevesi de uyarlanamazsa bağlantı çerçevesiz kapanır (`cerceveYaz`: özyineleme yok).
  const reddet = (g: Baglanti, code: AjandaKanalHatasi, cerceveSurumu: AjandaSurumNo | null = null): void => {
    if (g.asama.ad === "kapali") return;
    gunluk.uyari("gateway", "baglanti_ret", { kanal: "ajanda", code });
    cerceveYaz(g, { v: AJANDA_SURUMU, type: "error", code }, retSurumu(g, code, cerceveSurumu));
    birak(g);
    g.b.kapat(kapanisKodu(code), code);
  };

  // Eşleşme hâlâ geçerli mi: kayıt var, kapsamı bu yolu açıyor, anahtar aynı. Kaldırma ayrı süreçten gelir.
  const yetkiSuruyor = (k: Kimlik): boolean => {
    const kayit = depo.kapsamliCihazGetir(k.device_id);
    return (
      kayit !== null &&
      kanalKapsamdaMi(kayit.kapsam ?? ESKI_CIHAZ_KAPSAMI, "ajanda") &&
      kayit.public_key === k.public_key
    );
  };

  // ------------------------------------------------------------------------------------------
  // Telafi ve canlı kayıt
  // ------------------------------------------------------------------------------------------

  const acik = (g: Baglanti): boolean => g.asama.ad === "ajandada";

  const kayitYolla = (g: Baglanti, o: Oturum, kayit: AjandaKaydi): void => {
    if (kayit.revizyon <= o.sonRev) return;
    if (!yolla(g, { v: AJANDA_SURUMU, type: "kayit", kayit })) return;
    o.sonRev = kayit.revizyon;
  };

  /**
   * `(o.sonRev, ustRev]` aralığındaki kayıtların son hali, sayfa sayfa, revizyon artan. Bağlantı arada
   * kapanırsa durur (kesilen telafi: uygulama `son_rev`'iyle kaldığı yerden sürdürür). İlerlemeyen sayfa
   * döngüyü bitirir: yanlış bir sayfa sonsuz döngü kuramaz.
   */
  const araligiYolla = (g: Baglanti, o: Oturum, ustRev: number): void => {
    while (acik(g) && o.sonRev < ustRev) {
      const once = o.sonRev;
      const sayfa = ajanda.telafiSayfasi({ sonRev: o.sonRev, ustRev, adet: AJANDA_TELAFI_SAYFASI });
      for (const kayit of sayfa) {
        if (!acik(g)) return;
        if (kayit.revizyon > ustRev) continue;
        kayitYolla(g, o, kayit);
      }
      if (sayfa.length < AJANDA_TELAFI_SAYFASI || o.sonRev === once) return;
    }
  };

  /**
   * Canlı kayıt. Revizyonu gönderilenden küçük ya da eşitse atlanır (aynı revizyon iki kez gitmez).
   * Arada boşluk varsa (yayın sırası bozulduysa ya da bir revizyonun yayını bu bağlantıya ulaşmadıysa)
   * boşluk önce depodan doldurulur: yoksa eski revizyon `sonRev` denetimine takılıp hiç gitmezdi.
   */
  const canliYolla = (g: Baglanti, o: Oturum, kayit: AjandaKaydi): void => {
    if (kayit.revizyon <= o.sonRev) return;
    if (kayit.revizyon > o.sonRev + 1) araligiYolla(g, o, kayit.revizyon - 1);
    if (acik(g)) kayitYolla(g, o, kayit);
  };

  const telafiYap = (g: Baglanti, o: Oturum, hello: Hello): void => {
    const k = ajanda.karsila({
      son_rev: hello.son_rev,
      ...(hello.depo_id !== undefined && { depo_id: hello.depo_id }),
      ...(hello.son_rev_izi !== undefined && { son_rev_izi: hello.son_rev_izi }),
    });
    // Yetenek müzakeresi: istenenlerle sunulanların kesişimi. v2 `hello` istemez (boş); v2 `welcome`'da alan
    // yoktur, uyarlama atar. Alan sona eklenir: v2'nin gördüğü baytlar (alan sırası dahil) değişmez.
    const yetenekler = ajandaYetenekKesisimi("yetenekler" in hello ? hello.yetenekler : undefined, ajanda.yetenekler);
    const welcome: AjandaAsagi = {
      v: AJANDA_SURUMU,
      type: "welcome",
      depo_id: k.depo_id,
      bas_rev: k.bas_rev,
      tam: k.tam,
      server_time_ms: saat.simdiMs(),
      yetenekler,
    };
    o.yetenekler = yetenekler;
    if (!yolla(g, welcome)) return;
    // `tam` değilse yalnız `son_rev`'ten sonrası; baştan ileri bir `son_rev` (servis `tam` demeliydi) canlıyı yutmasın.
    o.sonRev = k.tam ? 0 : Math.min(hello.son_rev, k.bas_rev);
    araligiYolla(g, o, k.bas_rev);
    if (!acik(g)) return;
    if (!yolla(g, { v: AJANDA_SURUMU, type: "esitlendi", rev: k.bas_rev })) return;
    o.sonRev = Math.max(o.sonRev, k.bas_rev);
    o.telafide = false;
    gunluk.bilgi("gateway", "ajanda_esitlendi", { device_id: o.device_id, bas_rev: k.bas_rev, tam: k.tam, yetenekler: yetenekler.join(",") });
    for (const kayit of o.bekleyen.splice(0)) {
      if (!acik(g)) return;
      canliYolla(g, o, kayit);
    }
  };

  const kayitYazildi = (kayit: AjandaKaydi): void => {
    for (const g of [...baglantilar]) {
      if (g.asama.ad !== "ajandada") continue;
      const o = g.asama.oturum;
      if (o.telafide) {
        o.bekleyen.push(kayit);
        continue;
      }
      try {
        canliYolla(g, o, kayit);
      } catch (e) {
        // Boşluk doldurulamadı: bağlantı kapanır, uygulama yeniden bağlanıp telafiyle tamamlar.
        hataYaz("canli_kayit_hatasi", e);
        reddet(g, "ic_hata");
      }
    }
  };

  // ------------------------------------------------------------------------------------------
  // Kimlik ve eşleştirme
  // ------------------------------------------------------------------------------------------

  const helloAl = (g: Baglanti, m: Hello): void => {
    // Erken: yerel oturum sunucudan imza alamaz, cihaz kaydının varlığını da öğrenemez.
    if (!d.uzakIzinli(g.b.uzakIp)) return reddet(g, "ip_uyusmuyor");
    const kayit = depo.kapsamliCihazGetir(m.device_id);
    if (kayit === null) return reddet(g, "cihaz_bilinmiyor");
    // Sınama başlamadan: sohbet kapsamlı (eski) cihaz bu yoldan sunucu imzası bile almaz.
    if (!kanalKapsamdaMi(kayit.kapsam ?? ESKI_CIHAZ_KAPSAMI, "ajanda")) return reddet(g, "kanal_desteklenmiyor");
    const server_nonce = Buffer.from(rastgele.baytlar(32)).toString("base64");
    const server_signature = anahtar.imzala(
      ajandaKimlikImzaMetni({ rol: "pc", device_id: kayit.device_id, client_nonce: m.client_nonce, server_nonce }),
    );
    if (!yolla(g, { v: AJANDA_SURUMU, type: "auth_challenge", server_nonce, server_signature })) return;
    g.asama = { ad: "yanit_bekliyor", cihaz: kayit, hello: m, server_nonce };
  };

  const yanitAl = (g: Baglanti, a: Extract<Asama, { ad: "yanit_bekliyor" }>, signature: string): void => {
    const metin = ajandaKimlikImzaMetni({
      rol: "telefon",
      device_id: a.cihaz.device_id,
      client_nonce: a.hello.client_nonce,
      server_nonce: a.server_nonce,
    });
    if (!anahtar.dogrula(a.cihaz.public_key, metin, signature)) return reddet(g, "imza_gecersiz");
    if (g.b.uzakIp !== a.cihaz.tailscale_ip) return reddet(g, "ip_uyusmuyor");
    // `hello` ile `auth_response` arasında kaldırılmış ya da kapsamı değişmiş olabilir: taze okunur.
    const kimlik: Kimlik = { device_id: a.cihaz.device_id, public_key: a.cihaz.public_key };
    if (!yetkiSuruyor(kimlik)) return reddet(g, "cihaz_bilinmiyor");

    g.sureIptal?.();
    g.sureIptal = null;
    g.kimlik = kimlik;
    g.b.kimlikDogrulandi();
    gunluk.bilgi("gateway", "kimlik_tamam", { kanal: "ajanda", device_id: kimlik.device_id });
    const oturum: Oturum = { device_id: kimlik.device_id, sonRev: 0, telafide: true, bekleyen: [], yetenekler: [], ek: null };
    g.asama = { ad: "ajandada", oturum };
    telafiYap(g, oturum, a.hello);
  };

  const eslestirmeAl = (g: Baglanti, m: PairRequest): void => {
    const sonuc: AjandaEslestirmeSonucu = d.uzakIzinli(g.b.uzakIp)
      ? d.eslestir(g.b.uzakIp, { kod: m.kod, public_key: m.public_key, platform: m.platform, etiket: m.etiket })
      : { ok: false, code: "ip_uyusmuyor" };
    if (!sonuc.ok) {
      gunluk.uyari("gateway", "eslestirme_ret", { kanal: "ajanda", code: sonuc.code });
      if (!yolla(g, { v: AJANDA_SURUMU, type: "pair_result", ok: false, code: sonuc.code })) return;
      birak(g);
      g.b.kapat(kapanisKodu(sonuc.code), sonuc.code);
      return;
    }
    gunluk.bilgi("gateway", "eslestirme_tamam", { kanal: "ajanda", device_id: sonuc.deger, platform: m.platform });
    // Bağlantı açık kalır: uygulama aynı el sıkışma süresi içinde `hello` ile sürdürebilir.
    yolla(g, {
      v: AJANDA_SURUMU,
      type: "pair_result",
      ok: true,
      device_id: sonuc.deger,
      server_public_key: anahtar.acikAnahtar(),
      kapsam: "ajanda",
    });
  };

  // ------------------------------------------------------------------------------------------
  // Kimlik sonrası
  // ------------------------------------------------------------------------------------------

  // Yalnız protokolün alanları kablaya çıkar: yüzden fazla alan gelse de şema katı çerçeveyi bozmasın.
  const sonucYolla = (g: Baglanti, islem_id: string, s: AjandaIslemSonucuGovdesi): void => {
    yolla(g, {
      v: AJANDA_SURUMU,
      type: "islem_sonucu",
      islem_id,
      ok: s.ok,
      ...(s.kayit_id !== undefined && { kayit_id: s.kayit_id }),
      ...(s.rev !== undefined && { rev: s.rev }),
      ...(s.korunan_alanlar !== undefined && { korunan_alanlar: s.korunan_alanlar }),
      ...(s.code !== undefined && { code: s.code }),
    });
  };

  // Geçici ret (`ic_hata`) tekrarsızlık kaydına yazılmaz: uygulama aynı `islem_id` ile yeniden yollar.
  const islemAl = (g: Baglanti, o: Oturum, m: IslemMesaji): void => {
    let s: AjandaIslemSonucuGovdesi;
    try {
      s = ajanda.islemUygula(o.device_id, m.islem_id, m.islem);
    } catch (e) {
      hataYaz("islem_hatasi", e);
      s = { ok: false, code: "ic_hata" };
    }
    sonucYolla(g, m.islem_id, s);
  };

  // Zarfı geçerli, gövdesi geçersiz işlem: bağlantı kapanmaz, kalıcı `gecersiz_islem` (tekrarsızlık kaydıyla).
  const gecersizIslemAl = (g: Baglanti, o: Oturum, islem_id: string): void => {
    let s: AjandaIslemSonucuGovdesi;
    try {
      s = ajanda.gecersizIslem(o.device_id, islem_id);
    } catch (e) {
      hataYaz("islem_hatasi", e);
      s = { ok: false, code: "ic_hata" };
    }
    sonucYolla(g, islem_id, s);
  };

  const gecmisAl = (g: Baglanti, m: GecmisIste): void => {
    let s: AjandaGecmisSayfasi;
    try {
      s = ajanda.gecmis(m.kayit_id, m.once_rev);
    } catch (e) {
      hataYaz("gecmis_hatasi", e);
      s = { kayit_id: m.kayit_id, girdiler: [], devami: false, code: "ic_hata" };
    }
    yolla(g, {
      v: AJANDA_SURUMU,
      type: "gecmis",
      istek_id: m.istek_id,
      kayit_id: m.kayit_id,
      girdiler: s.girdiler,
      devami: s.devami,
      ...(s.code !== undefined && { code: s.code }),
    });
  };

  /**
   * Ek yedeği çerçevesi. Yalnız `ekler` kuruluyken, `esitlendi`'den sonra ve kesişimde `ek_yedegi` varken
   * ek modülüne gider; değilse bugünkü ret (`yetkisiz` + kapanış). Yanıtlar arkadan gelir: bağlantı o
   * sırada kapanmışsa (ya da başka oturuma geçmişse) yollanmaz.
   */
  const ekAl = (g: Baglanti, o: Oturum, m: AjandaEkCercevesi): void => {
    const ekler = ajanda.ekler;
    if (ekler === undefined || o.telafide || !o.yetenekler.includes(AJANDA_EK_YETENEGI)) return reddet(g, "yetkisiz");
    o.ek ??= ekler.oturumAc({
      gonder: (y) => {
        if (g.asama.ad === "ajandada" && g.asama.oturum === o) yolla(g, y);
      },
      bekleyenBayt: () => g.b.bekleyenBayt?.() ?? 0,
    });
    o.ek.cerceve(m);
  };

  // ------------------------------------------------------------------------------------------
  // Çerçeve
  // ------------------------------------------------------------------------------------------

  const cerceveIsle = (g: Baglanti, ham: string): void => {
    // Sabitlenmişse yalnız o sürüm (başka sayı `v` `protokol_uyumsuz`); değilse kümenin herhangi biri.
    const sonuc = ajandaYukariCoz(ham, g.surum ?? undefined);
    const asama = g.asama;
    if (!sonuc.ok) {
      gunluk.uyari("gateway", "cozum_hatasi", { kanal: "ajanda", code: sonuc.kod, yollar: sonuc.yollar.join(",") });
      // Yalnız kimlik sonrası ve yalnız zarfı geçerli `islem`: kapanmaz, `gecersiz_islem` alır.
      if (asama.ad === "ajandada" && sonuc.islem_id !== undefined) {
        if (g.kimlik === null || !yetkiSuruyor(g.kimlik)) return reddet(g, "cihaz_bilinmiyor");
        return gecersizIslemAl(g, asama.oturum, sonuc.islem_id);
      }
      return reddet(g, sonuc.kod, g.surum === null && sonuc.kod !== "protokol_uyumsuz" ? hamSurumu(ham) : null);
    }
    const m = sonuc.mesaj;
    switch (asama.ad) {
      case "hello_bekliyor":
        // Sürüm burada sabitlenir; `pair_request` ardından aynı bağlantıdaki `hello` da bu sürümdedir.
        if (m.type === "hello" || m.type === "pair_request") g.surum = m.v;
        if (m.type === "hello") return helloAl(g, m);
        if (m.type === "pair_request") return eslestirmeAl(g, m);
        return reddet(g, "yetkisiz", m.v);
      case "yanit_bekliyor":
        if (m.type === "auth_response") return yanitAl(g, asama, m.signature);
        return reddet(g, "yetkisiz");
      case "ajandada":
        // Kimlik sonrası her çerçeve: kaldırılan cihaz yoklamayı beklemeden ilk çerçevede kapanır.
        if (g.kimlik === null || !yetkiSuruyor(g.kimlik)) return reddet(g, "cihaz_bilinmiyor");
        if (m.type === "islem") return islemAl(g, asama.oturum, m);
        if (m.type === "gecmis_iste") return gecmisAl(g, m);
        if (m.type === "ek_yukle" || m.type === "ek_parca" || m.type === "ek_iste") return ekAl(g, asama.oturum, m);
        return reddet(g, "yetkisiz");
      case "kapali":
        return;
    }
  };

  return {
    baglantiAl: (b) => {
      const g: Baglanti = { b, surum: null, asama: { ad: "hello_bekliyor" }, sureIptal: null, kimlik: null };
      baglantilar.add(g);
      g.sureIptal = zamanlayici.sonra(d.elSikismaMs, () => reddet(g, "zaman_asimi"));
      b.kapanisDinle(() => birak(g));
      b.mesajDinle((ham) => {
        if (g.asama.ad === "kapali") return;
        try {
          cerceveIsle(g, ham);
        } catch (e) {
          hataYaz("cerceve_hatasi", e);
          reddet(g, "ic_hata");
        }
      });
    },
    kayitYazildi,
    yetkiYokla: () => {
      for (const g of [...baglantilar]) {
        if (g.kimlik === null || g.asama.ad === "kapali") continue;
        let suruyor: boolean;
        try {
          suruyor = yetkiSuruyor(g.kimlik);
        } catch (e) {
          hataYaz("yetki_yoklama_hatasi", e);
          continue;
        }
        if (suruyor) continue;
        gunluk.uyari("gateway", "yetki_kalkti", { kanal: "ajanda", device_id: g.kimlik.device_id });
        reddet(g, "cihaz_bilinmiyor");
      }
    },
    kapat: () => {
      for (const g of [...baglantilar]) {
        birak(g);
        g.b.kapat(1001, "kapaniyor");
      }
    },
  };
};
