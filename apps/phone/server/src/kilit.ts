/**
 * Limit kilidi dosyasını yoklar, tek başlatma kapısını tutar. Dosyaya hiçbir şey yazmaz (ack dahil),
 * hiçbir süreci öldürmez; tepkiler `kilit_degisti` dinleyicilerindedir. MODULLER.md, "kilit".
 */
import type { LimitKilitDurumu, KilitFabrikasi, OlayGirdisi } from "./sozlesme.ts";

const YENIDEN_DENEME_ADEDI = 2;
const YENIDEN_DENEME_ARASI_MS = 300;

type Okuma = { tur: "yok" } | { tur: "gecerli"; deger: Record<string, unknown> } | { tur: "bozuk"; neden: string };

const metinMi = (v: unknown): v is string => typeof v === "string";
const sonluSayiMi = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Baş ve sondaki BOM ile boşluk atılır, sonra çözülür. */
const metniCoz = (metin: string): unknown => {
  const temiz = metin.replace(/^[\s﻿]+/, "").replace(/[\s﻿]+$/, "");
  return JSON.parse(temiz);
};

const degerlendir = (deger: unknown, simdiMs: number): LimitKilitDurumu => {
  if (deger === null || typeof deger !== "object" || Array.isArray(deger)) {
    return { tur: "belirsiz", neden: "nesne_degil" };
  }
  const o = deger as Record<string, unknown>;
  if (o["surum"] !== 1) return { tur: "belirsiz", neden: "surum" };
  if (!sonluSayiMi(o["esik"]) || !sonluSayiMi(o["yuzde"])) return { tur: "belirsiz", neden: "sayi_alani" };
  if (!metinMi(o["sifirlanma"]) || !metinMi(o["kilitlendi"]) || !metinMi(o["oturum"])) {
    return { tur: "belirsiz", neden: "metin_alani" };
  }
  const acildi = o["acildi"];
  if (acildi !== null && !metinMi(acildi)) return { tur: "belirsiz", neden: "acildi" };
  if (acildi !== null) return { tur: "serbest" };
  const sifirlanmaMs = Date.parse(o["sifirlanma"]);
  if (Number.isNaN(sifirlanmaMs)) return { tur: "belirsiz", neden: "sifirlanma" };
  if (sifirlanmaMs <= simdiMs) return { tur: "serbest" };
  return { tur: "aktif", sifirlanmaMs, yuzde: o["yuzde"] };
};

export const kilitKur: KilitFabrikasi = ({ ayar, depo, dosya, saat, zamanlayici, veriyolu, gunluk }) => {
  // Ilk okumaya kadar kapı kapalı: bilinmeyen durum serbest sayılmaz.
  let durum: LimitKilitDurumu = { tur: "belirsiz", neden: "baslatilmadi" };
  let ilkOkumaYapildi = false;
  let kapali = false;
  let baslatildi = false;
  let yoklaniyor = false;
  let yoklamayiIptalEt: (() => void) | null = null;
  let beklemeIptal: (() => void) | null = null;

  const bekle = (ms: number): Promise<void> =>
    new Promise<void>((coz) => {
      const iptal = zamanlayici.sonra(ms, () => {
        beklemeIptal = null;
        coz();
      });
      // kapat() bekleyeni de bırakır: yoklama asılı kalmaz.
      beklemeIptal = () => {
        iptal();
        coz();
      };
    });

  const guvenli = (modul: string, olay: string, f: () => void): void => {
    try {
      f();
    } catch (e) {
      try {
        gunluk.hata("kilit", olay, { hata_turu: e instanceof Error ? e.name : typeof e, modul });
      } catch {
        // günlük de atarsa yoklama bozulmaz
      }
    }
  };

  const oku = async (): Promise<Okuma> => {
    for (let deneme = 0; deneme <= YENIDEN_DENEME_ADEDI; deneme++) {
      if (deneme > 0) {
        await bekle(YENIDEN_DENEME_ARASI_MS);
        if (kapali) return { tur: "bozuk", neden: "kapandi" };
      }
      const icerik = await dosya.oku(ayar.yollar.limitKilit);
      if (icerik === null) return { tur: "yok" };
      try {
        const cozulmus = metniCoz(icerik);
        if (cozulmus === null || typeof cozulmus !== "object" || Array.isArray(cozulmus)) {
          // Çözüldü ama nesne değil: yarım yazım değil, yeniden denemek gerekmez.
          return { tur: "bozuk", neden: "nesne_degil" };
        }
        return { tur: "gecerli", deger: cozulmus as Record<string, unknown> };
      } catch {
        // Mod o an yazıyor olabilir: kalan denemeler.
      }
    }
    return { tur: "bozuk", neden: "cozulemedi" };
  };

  const bildirimEkle = (girdi: OlayGirdisi): void => {
    guvenli("depo", "bildirim_yazilamadi", () => {
      depo.olayEkle(girdi);
    });
  };

  const gecisiIsle = (onceki: LimitKilitDurumu | null, yeni: LimitKilitDurumu): void => {
    const ilk = onceki === null;
    if (ilk ? yeni.tur === "serbest" : onceki.tur === yeni.tur) return;

    gunluk.bilgi("kilit", "kilit_degisti", {
      onceki: onceki === null ? "yok" : onceki.tur,
      yeni: yeni.tur,
      ...(yeni.tur === "belirsiz" ? { neden: yeni.neden } : {}),
    });

    if (yeni.tur === "aktif") {
      bildirimEkle({
        type: "system_notice",
        seviye: "kritik",
        kod: "limit_kilit_aktif",
        metin: "Limit kilidi aktif: yeni başlatma durdu.",
      });
    } else if (yeni.tur === "serbest" && onceki !== null && onceki.tur === "aktif") {
      bildirimEkle({
        type: "system_notice",
        seviye: "bilgi",
        kod: "limit_kilit_bitti",
        metin: "Limit kilidi kalktı: başlatma yeniden açık.",
      });
    } else if (yeni.tur === "belirsiz") {
      bildirimEkle({
        type: "system_notice",
        seviye: "uyari",
        kod: "diger",
        metin: "Limit kilidi okunamadı: yeni başlatma yok.",
      });
    }
    guvenli("veriyolu", "yayin_hatasi", () => {
      veriyolu.yayinla("kilit_degisti", { durum: yeni });
    });
  };

  const yokla = async (): Promise<void> => {
    if (kapali || yoklaniyor) return;
    yoklaniyor = true;
    try {
      let yeni: LimitKilitDurumu;
      try {
        const okuma = await oku();
        if (okuma.tur === "yok") yeni = { tur: "serbest" };
        else if (okuma.tur === "bozuk") yeni = { tur: "belirsiz", neden: okuma.neden };
        else yeni = degerlendir(okuma.deger, saat.simdiMs());
      } catch {
        yeni = { tur: "belirsiz", neden: "okuma_hatasi" };
      }
      if (kapali) return;
      const onceki = ilkOkumaYapildi ? durum : null;
      durum = yeni;
      ilkOkumaYapildi = true;
      gecisiIsle(onceki, yeni);
    } finally {
      yoklaniyor = false;
    }
  };

  return {
    async baslat() {
      if (baslatildi || kapali) return;
      baslatildi = true;
      await yokla();
      if (kapali) return;
      yoklamayiIptalEt = zamanlayici.herAralik(ayar.sureler.kilitYoklamaMs, () => {
        void yokla();
      });
    },
    durum() {
      return durum;
    },
    baslatmaSerbestMi() {
      return durum.tur === "serbest";
    },
    kapat() {
      kapali = true;
      if (yoklamayiIptalEt !== null) {
        yoklamayiIptalEt();
        yoklamayiIptalEt = null;
      }
      if (beklemeIptal !== null) {
        beklemeIptal();
        beklemeIptal = null;
      }
    },
  };
};
