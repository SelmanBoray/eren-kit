/**
 * Tek `/sohbet` bağlantısı: `hello` -> `auth_challenge` -> (PC imzası Kotlin'de doğrulanır, telefon
 * imzası döner) -> `auth_response` -> `welcome`. Kimlik bitmeden iş mesajı yollanmaz, gelen iş
 * çerçevesi kabul edilmez; sıra dışı ya da çözülemeyen çerçeve bağlantıyı kapatır. Kopunca
 * 1 sn'den 30 sn'ye ikiye katlanarak yeniden dener, `welcome` geri çekilmeyi sıfırlar.
 * TASARIM.md "JS modülleri"; protocol README `/sohbet` 2.
 */
import { EslestirmeQr, SOHBET_SURUMU, sohbetAsagiCoz, SohbetYukari } from "@eren/protocol";
import type { HataKodu } from "@eren/protocol";
import type {
  BaglantiDurumu,
  GelenCerceve,
  IptalEt,
  IsMesajiTuru,
  KimlikPortu,
  SaatPortu,
  WsBaglantisi,
  WsDinleyici,
  WsPortu,
} from "./sozlesme.ts";

export const GERI_CEKILME = { ILK_MS: 1_000, AZAMI_MS: 30_000 } as const;
/** Bağlantı açılışından `welcome`'a kadar. Servisin kendi el sıkışma süresi 10 sn'dir. */
export const EL_SIKISMA_SURESI_MS = 15_000;

/** Telefonda saptanan hata; servisin `error.code`'u ayrıca `HataKodu` olarak gelir. */
export type YerelBaglantiHatasi =
  | "eslesme_yok"
  /** Eşleşmedeki adres Tailscale aralığında değil ya da port geçersiz. */
  | "eslesme_gecersiz"
  /** Kimlik portu attı ya da kabloya uymayan değer verdi. */
  | "kimlik_portu"
  /** Bilgisayarın imzası doğrulanamadı: telefon imza vermedi. */
  | "pc_imzasi_gecersiz"
  /** Kotlin'deki 30 sn'lik oturum bitti. */
  | "oturum_yok"
  | "sira_disi"
  | "cozum_hatasi"
  | "el_sikisma_zaman_asimi"
  /** Kimlik bitmeden bağlantı kapandı ya da açılamadı. */
  | "baglanti_kapandi";

export type BaglantiHatasi = YerelBaglantiHatasi | HataKodu;

export type WelcomeCercevesi = Extract<GelenCerceve, { type: "welcome" }>;
/** Kimlik sonrası dinleyiciye geçen çerçeveler; `error` `hata` ile gelir. */
export type KimlikliCerceve = Exclude<
  GelenCerceve,
  { type: "auth_challenge" | "welcome" | "pair_result" | "error" }
>;

export interface BaglantiDinleyicisi {
  durumDegisti(durum: BaglantiDurumu): void;
  hata(hata: BaglantiHatasi): void;
  /** `gonder` bundan sonra çalışır. */
  kimlikTamam(welcome: WelcomeCercevesi): void;
  cerceve(c: KimlikliCerceve): void;
  /** Kimliği bitmiş bağlantı gitti. */
  koptu(): void;
}

export interface BaglantiBagimliliklari {
  ws: WsPortu;
  kimlik: KimlikPortu;
  saat: SaatPortu;
  /** `hello.last_seq`: o anda kalıcı olan son olay. */
  sonSeq(): number;
  dinleyici: BaglantiDinleyicisi;
}

/** `uzun`: bir sonraki deneme en uzun beklemeyle; kendiliğinden düzelmeyecek hatalar için. */
export type SonrakiDeneme = "normal" | "uzun";

export interface Baglanti {
  baslat(): void;
  /** Bağlantıyı kapatır, yeniden denemez. */
  durdur(): void;
  /** Bekleyen denemeyi öne çeker, geri çekilmeyi sıfırlar. Durdurulmuşsa bir şey yapmaz. */
  simdiBaglan(): void;
  /** Bu bağlantıyı kapatır; çalışıyorsa yeniden dener. */
  kopar(sonraki: SonrakiDeneme): void;
  /** Yalnız kimlik bitmişken ve yalnız iş mesajı; yollanamazsa `false`. */
  gonder(m: SohbetYukari): boolean;
  durum(): BaglantiDurumu;
  /** Bekleyen yeniden denemenin zamanı (`saat.simdiMs` cinsinden) ya da `null`. */
  sonrakiDenemeMs(): number | null;
}

export type BaglantiFabrikasi = (b: BaglantiBagimliliklari) => Baglanti;

/** `IsMesajiTuru`'nun tamamı; biri eksik ya da fazla kalırsa `tsc` kırılır. */
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

type Asama =
  | "eslesme"
  | "aciliyor"
  | "hello_hazirlaniyor"
  | "challenge_bekliyor"
  | "sinaniyor"
  | "welcome_bekliyor"
  | "bagli";

interface Deneme {
  b: WsBaglantisi | null;
  asama: Asama;
  oturum: string;
  sure: IptalEt | null;
}

export const baglantiKur: BaglantiFabrikasi = ({ ws, kimlik, saat, sonSeq, dinleyici }) => {
  let calisiyor = false;
  let deneme: Deneme | null = null;
  let gecikme: number = GERI_CEKILME.ILK_MS;
  let bekleme: IptalEt | null = null;
  let sonraki: number | null = null;
  let durum: BaglantiDurumu = "kapali";

  const durumYap = (d: BaglantiDurumu): void => {
    if (durum === d) return;
    durum = d;
    dinleyici.durumDegisti(d);
  };

  const planla = (): void => {
    if (!calisiyor || bekleme !== null || deneme !== null) return;
    const ms = gecikme;
    gecikme = Math.min(gecikme * 2, GERI_CEKILME.AZAMI_MS);
    sonraki = saat.simdiMs() + ms;
    bekleme = saat.sonra(ms, () => {
      bekleme = null;
      sonraki = null;
      baglan();
    });
  };

  const bitir = (d: Deneme, hata: BaglantiHatasi | null, ileri: SonrakiDeneme): void => {
    if (deneme !== d) return;
    deneme = null;
    d.sure?.();
    d.sure = null;
    const bagliydi = d.asama === "bagli";
    try {
      d.b?.kapat();
    } catch {
      // Kapanmış taşıma: yapılacak bir şey yok.
    }
    if (ileri === "uzun") gecikme = GERI_CEKILME.AZAMI_MS;
    if (bagliydi) dinleyici.koptu();
    if (hata !== null) dinleyici.hata(hata);
    planla();
    durumYap("kapali");
  };

  const yolla = (d: Deneme, m: SohbetYukari): void => {
    d.b?.gonder(JSON.stringify(m));
  };

  const sinama = async (
    d: Deneme,
    m: Extract<GelenCerceve, { type: "auth_challenge" }>,
  ): Promise<void> => {
    d.asama = "sinaniyor";
    let sonuc: Awaited<ReturnType<KimlikPortu["sohbetSinama"]>>;
    try {
      sonuc = await kimlik.sohbetSinama(d.oturum, m.server_nonce, m.server_signature);
    } catch {
      return bitir(d, "kimlik_portu", "normal");
    }
    if (deneme !== d || d.asama !== "sinaniyor") return;
    if ("hata" in sonuc) {
      return bitir(d, sonuc.hata === "oturum_yok" ? "oturum_yok" : "pc_imzasi_gecersiz", "normal");
    }
    const yanit = SohbetYukari.safeParse({
      v: SOHBET_SURUMU,
      type: "auth_response",
      signature: sonuc.signature,
    });
    if (!yanit.success) return bitir(d, "kimlik_portu", "normal");
    d.asama = "welcome_bekliyor";
    yolla(d, yanit.data);
  };

  const helloYolla = async (d: Deneme): Promise<void> => {
    let bas: Awaited<ReturnType<KimlikPortu["sohbetHello"]>>;
    try {
      bas = await kimlik.sohbetHello();
    } catch {
      return bitir(d, "kimlik_portu", "normal");
    }
    if (deneme !== d || d.asama !== "hello_hazirlaniyor") return;
    const hello = SohbetYukari.safeParse({
      v: SOHBET_SURUMU,
      type: "hello",
      device_id: bas.device_id,
      last_seq: sonSeq(),
      client_nonce: bas.client_nonce,
    });
    if (!hello.success || typeof bas.oturum !== "string") return bitir(d, "kimlik_portu", "normal");
    d.oturum = bas.oturum;
    d.asama = "challenge_bekliyor";
    yolla(d, hello.data);
  };

  const mesajAl = (d: Deneme, metin: string): void => {
    const bagli = d.asama === "bagli";
    const c = sohbetAsagiCoz(metin);
    if (!c.ok) {
      // Çözülemeyen olay atlanırsa sonraki `seq` onu sessizce geçerdi: bağlantı durur.
      return bitir(d, c.kod === "protokol_uyumsuz" ? c.kod : "cozum_hatasi", bagli ? "uzun" : "normal");
    }
    const m = c.mesaj;
    if (m.type === "error") {
      // Kimlikten sonra servis yalnız `gecersiz_mesaj`'da bağlantıyı açık tutar; gerisini kendi kapatır.
      if (bagli) return dinleyici.hata(m.code);
      return bitir(d, m.code, "normal");
    }
    switch (d.asama) {
      case "challenge_bekliyor":
        if (m.type === "auth_challenge") {
          void sinama(d, m);
          return;
        }
        break;
      case "welcome_bekliyor":
        if (m.type === "welcome") {
          d.asama = "bagli";
          d.sure?.();
          d.sure = null;
          gecikme = GERI_CEKILME.ILK_MS;
          durumYap("bagli");
          dinleyici.kimlikTamam(m);
          return;
        }
        break;
      case "bagli":
        if (m.type !== "auth_challenge" && m.type !== "welcome" && m.type !== "pair_result") {
          dinleyici.cerceve(m);
          return;
        }
        break;
      default:
        break;
    }
    bitir(d, "sira_disi", bagli ? "uzun" : "normal");
  };

  const dinleyiciKur = (d: Deneme): WsDinleyici => ({
    acildi: () => {
      if (deneme !== d || d.asama !== "aciliyor") return;
      d.asama = "hello_hazirlaniyor";
      durumYap("el_sikisma");
      void helloYolla(d);
    },
    mesaj: (metin) => {
      if (deneme !== d) return;
      mesajAl(d, metin);
    },
    kapandi: () => {
      if (deneme !== d) return;
      bitir(d, d.asama === "bagli" ? null : "baglanti_kapandi", "normal");
    },
    hata: () => {
      if (deneme !== d) return;
      bitir(d, d.asama === "bagli" ? null : "baglanti_kapandi", "normal");
    },
  });

  const ac = async (d: Deneme): Promise<void> => {
    let eslesme: Awaited<ReturnType<KimlikPortu["eslesme"]>>;
    try {
      eslesme = await kimlik.eslesme();
    } catch {
      return bitir(d, "kimlik_portu", "normal");
    }
    if (deneme !== d) return;
    if (eslesme === null) return bitir(d, "eslesme_yok", "normal");
    // Telefon yalnız Tailscale aralığındaki bir adrese bağlanır.
    const host = EslestirmeQr.shape.host.safeParse(eslesme.host);
    const port = EslestirmeQr.shape.port.safeParse(eslesme.port);
    if (!host.success || !port.success) return bitir(d, "eslesme_gecersiz", "normal");
    d.asama = "aciliyor";
    let b: WsBaglantisi;
    try {
      b = ws.ac(`ws://${host.data}:${port.data}/sohbet`, dinleyiciKur(d));
    } catch {
      return bitir(d, "baglanti_kapandi", "normal");
    }
    if (deneme !== d) {
      // Açılış sırasında kapanış geldi: dönen taşıma artık kimsenin değil.
      try {
        b.kapat();
      } catch {
        // yok
      }
      return;
    }
    d.b = b;
  };

  const baglan = (): void => {
    if (!calisiyor || deneme !== null) return;
    const d: Deneme = { b: null, asama: "eslesme", oturum: "", sure: null };
    deneme = d;
    durumYap("baglaniyor");
    d.sure = saat.sonra(EL_SIKISMA_SURESI_MS, () => bitir(d, "el_sikisma_zaman_asimi", "normal"));
    void ac(d);
  };

  const beklemeyiBirak = (): void => {
    bekleme?.();
    bekleme = null;
    sonraki = null;
  };

  return {
    baslat: () => {
      if (calisiyor) return;
      calisiyor = true;
      gecikme = GERI_CEKILME.ILK_MS;
      baglan();
    },

    durdur: () => {
      calisiyor = false;
      beklemeyiBirak();
      if (deneme !== null) bitir(deneme, null, "normal");
      durumYap("kapali");
    },

    simdiBaglan: () => {
      if (!calisiyor) return;
      gecikme = GERI_CEKILME.ILK_MS;
      if (deneme !== null) return;
      beklemeyiBirak();
      baglan();
    },

    kopar: (ileri) => {
      if (deneme !== null) bitir(deneme, null, ileri);
    },

    gonder: (m) => {
      const d = deneme;
      if (d === null || d.asama !== "bagli" || d.b === null || !IS_TURLERI.has(m.type)) return false;
      try {
        d.b.gonder(JSON.stringify(m));
        return true;
      } catch {
        bitir(d, null, "normal");
        return false;
      }
    },

    durum: () => durum,
    sonrakiDenemeMs: () => sonraki,
  };
};
