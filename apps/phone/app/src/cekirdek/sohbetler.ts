/**
 * Dilim 2 (çoklu sohbet): saf sohbet mantığı, port yok. Sohbet defteri (yaşam döngüsü olaylarından
 * sohbet kayıtları), liste özeti (çekmece satırları), kullanıcı adını kabloya hazırlama, ilk mesajdan
 * otomatik ad ve okunmamış sayımında asistan kaynaklı öğe. TASARIM.md "Dilim 2: çoklu sohbet":
 * "Sohbet listesi" 1-5, "Okunmamış", "Yönetim işlemleri" (otomatik ad). İmzalar sozlesme.ts'te donmuştur.
 */
import {
  ANA_SOHBET_ADI,
  ANA_SOHBET_ID,
  gorunmezBirimMi,
  SohbetAdi,
  sohbetAnahtari,
  VARSAYILAN_SOHBET_ADI,
} from "@eren/protocol";
import type { SohbetId } from "@eren/protocol";
import type {
  AdHazirla,
  ErenKaynakliMi,
  IsMesaji,
  OtomatikAdUret,
  OzetleriKur,
  SohbetDefteri,
  SohbetDefteriFabrikasi,
  SohbetGorunumu,
  SohbetKaydi,
  SohbetKurulumu,
  SohbetOzeti,
  SohbetYasamOlayi,
  SonMesaj,
} from "./sozlesme.ts";

type GorunumOgesi = SohbetGorunumu["ogeler"][number];
type KurulumMesaji = Extract<IsMesaji, { type: "chat_create" }>;

/** Otomatik adın "…" eklenmeden önceki en uzun hali (UTF-16 birimi). */
export const OTOMATIK_AD_UZUNLUGU = 40;

const UC_NOKTA = "…";

/** `ana`'nın yer tutucu adı: verilen ad (görünen asistan adı) `SohbetAdi`'ndan geçerse o, yoksa `ANA_SOHBET_ADI`. */
function anaAdiHazirla(ad: string | undefined): SohbetAdi {
  return ad !== undefined && SohbetAdi.safeParse(ad).success ? ad : ANA_SOHBET_ADI;
}

function anaKaydi(ad: SohbetAdi): SohbetKaydi {
  return { sohbet_id: ANA_SOHBET_ID, ad, olusturma_seq: 0, olusturma_ms: 0 };
}

// ---------------------------------------------------------------------------------------------
// Sohbet defteri
// ---------------------------------------------------------------------------------------------

export const sohbetDefteriKur: SohbetDefteriFabrikasi = (anaAdi) => {
  const anaAd = anaAdiHazirla(anaAdi);
  // Değişince yeni `Map` kurulur: `kayitlar()` değişmedikçe aynı nesneyi döner.
  let kayitlar: Map<SohbetId, SohbetKaydi> = new Map([[ANA_SOHBET_ID, anaKaydi(anaAd)]]);
  const silinmisler = new Set<SohbetId>();
  let sonSeq = 0;

  const defter: SohbetDefteri = {
    olay(o: SohbetYasamOlayi): boolean {
      if (o.seq <= sonSeq) return false;
      sonSeq = o.seq;
      const id = sohbetAnahtari(o);
      switch (o.type) {
        case "chat_created": {
          if (kayitlar.has(id) || silinmisler.has(id)) return false;
          const yeni = new Map(kayitlar);
          yeni.set(id, { sohbet_id: id, ad: o.ad, olusturma_seq: o.seq, olusturma_ms: o.ts_ms });
          kayitlar = yeni;
          return true;
        }
        case "chat_renamed": {
          const kayit = kayitlar.get(id);
          if (kayit === undefined || silinmisler.has(id)) return false;
          if (kayit.ad === o.ad) return false;
          const yeni = new Map(kayitlar);
          yeni.set(id, { ...kayit, ad: o.ad });
          kayitlar = yeni;
          return true;
        }
        case "chat_deleted": {
          if (id === ANA_SOHBET_ID) return false;
          silinmisler.add(id);
          if (!kayitlar.has(id)) return false;
          const yeni = new Map(kayitlar);
          yeni.delete(id);
          kayitlar = yeni;
          return true;
        }
      }
    },
    sifirla(): void {
      kayitlar = new Map([[ANA_SOHBET_ID, anaKaydi(anaAd)]]);
      silinmisler.clear();
      sonSeq = 0;
    },
    kayitlar(): ReadonlyMap<SohbetId, SohbetKaydi> {
      return kayitlar;
    },
    silindiMi(sohbet_id: SohbetId): boolean {
      return silinmisler.has(sohbet_id);
    },
  };
  return defter;
};

// ---------------------------------------------------------------------------------------------
// Asistan kaynaklı öğe (okunmamış sayımı)
// ---------------------------------------------------------------------------------------------

export const erenKaynakli: ErenKaynakliMi = (o) => {
  switch (o.tur) {
    case "asistan":
    case "plan":
    case "plan_gizlendi":
    case "soru":
    case "rapor":
    case "tur_kesildi":
    case "devir":
      return true;
    case "sistem":
      return o.seviye !== "bilgi";
    case "kullanici":
    case "is":
    case "gecmis_silindi":
      return false;
    default: {
      const hic: never = o;
      return hic;
    }
  }
};

// ---------------------------------------------------------------------------------------------
// Liste özeti
// ---------------------------------------------------------------------------------------------

function sonMesajBul(ogeler: readonly GorunumOgesi[]): SonMesaj | null {
  for (let i = ogeler.length - 1; i >= 0; i--) {
    const o = ogeler[i]!;
    if (o.tur === "kullanici") return { kim: "kullanici", metin: o.metin };
    if (o.tur === "asistan") return { kim: "asistan", metin: o.metin };
  }
  return null;
}

export const ozetleriKur: OzetleriKur = (g) => {
  const kayitlar = g.kayitlar;

  // Kural 2: defterde kaydı olmayan kimliklerin kurulum kaynağı, ilk tutan kazanır.
  // Sıra (teslim, kuyruk, hata) aynı zamanda "kayıtsızlar" bölümünün ileri sırasıdır.
  const kayitsizlar = new Map<SohbetId, { kurulum: SohbetKurulumu; mesaj: KurulumMesaji }>();
  const kayitsizEkle = (m: IsMesaji, kurulum: SohbetKurulumu) => {
    if (m.type !== "chat_create") return;
    const id = sohbetAnahtari(m);
    if (kayitlar.has(id) || kayitsizlar.has(id)) return;
    kayitsizlar.set(id, { kurulum, mesaj: m });
  };
  for (const m of g.teslimler) kayitsizEkle(m, "kuruldu");
  for (const o of g.kuyruk) kayitsizEkle(o.mesaj, "bekliyor");
  for (const h of g.hatalar) kayitsizEkle(h.mesaj, "kurulamadi");

  // Kural 3: ad üstüne yazımları. Önce teslimler, sonra kuyruk; son gelen kazanır. Hatalar yok sayılır.
  const adlar = new Map<SohbetId, SohbetAdi>();
  for (const m of g.teslimler) {
    if (m.type === "chat_rename") adlar.set(sohbetAnahtari(m), m.ad);
  }
  for (const o of g.kuyruk) {
    if (o.mesaj.type === "chat_rename") adlar.set(sohbetAnahtari(o.mesaj), o.mesaj.ad);
  }

  const sunucu = g.sunucu;
  const ozetKur = (
    id: SohbetId,
    tabanAd: SohbetAdi,
    kurulum: SohbetKurulumu,
    kayit: SohbetKaydi | null,
  ): SohbetOzeti => {
    const gorunum = g.gorunum(id);
    const ogeler = gorunum?.ogeler ?? [];
    const akis = gorunum?.akis ?? null;
    const eren = sunucu?.find((s) => s.sohbet_id === id)?.eren ?? null;
    const okunduSeq = g.okunduSeq(id);
    let okunmamis = 0;
    let calisanIs = 0;
    for (const o of ogeler) {
      if (o.seq > okunduSeq && erenKaynakli(o)) okunmamis++;
      if (o.tur === "is" && o.durum === "suruyor") calisanIs++;
    }
    let sonEtkinlikMs: number | null = null;
    if (kayit !== null) {
      const son = ogeler[ogeler.length - 1];
      sonEtkinlikMs = son === undefined ? kayit.olusturma_ms : Math.max(kayit.olusturma_ms, son.ts_ms);
    }
    return {
      sohbet_id: id,
      ad: adlar.get(id) ?? tabanAd,
      ana: id === ANA_SOHBET_ID,
      kurulum,
      eren,
      yaziyor: akis !== null || eren === "tur_suruyor",
      okunmamis,
      calisanIs,
      sonMesaj: sonMesajBul(ogeler),
      sonEtkinlikMs,
    };
  };

  // Kural 5: önce kayıtsızlar, en yeni önce (teslim, kuyruk, hata sırasının tersi).
  const bas: SohbetOzeti[] = [];
  for (const [id, { kurulum, mesaj }] of kayitsizlar) bas.push(ozetKur(id, mesaj.ad, kurulum, null));
  bas.reverse();

  // Sonra kayıtlılar: `sonEtkinlikMs` azalan, eşitse `olusturma_seq` azalan. `ana` defterde hep
  // vardır; girdide yoksa (defter dışı kullanım) yine de eklenir, liste `ana`'sız kalmaz.
  const kayitlilar: { ozet: SohbetOzeti; olusturma_seq: number }[] = [];
  for (const kayit of kayitlar.values()) {
    kayitlilar.push({
      ozet: ozetKur(kayit.sohbet_id, kayit.ad, "kuruldu", kayit),
      olusturma_seq: kayit.olusturma_seq,
    });
  }
  if (!kayitlar.has(ANA_SOHBET_ID)) {
    const ana = anaKaydi(anaAdiHazirla(g.anaAdi));
    kayitlilar.push({ ozet: ozetKur(ANA_SOHBET_ID, ana.ad, "kuruldu", ana), olusturma_seq: 0 });
  }
  kayitlilar.sort(
    (a, b) =>
      (b.ozet.sonEtkinlikMs ?? 0) - (a.ozet.sonEtkinlikMs ?? 0) || b.olusturma_seq - a.olusturma_seq,
  );

  return [...bas, ...kayitlilar.map((k) => k.ozet)];
};

// ---------------------------------------------------------------------------------------------
// Ad hazırlama ve otomatik ad
// ---------------------------------------------------------------------------------------------

export const adHazirla: AdHazirla = (ham) => {
  const ad = ham.trim();
  if (ad.length === 0) return null;
  return SohbetAdi.safeParse(ad).success ? ad : null;
};

function yuksekVekilMi(birim: number): boolean {
  return birim >= 0xd800 && birim <= 0xdbff;
}

export const otomatikAd: OtomatikAdUret = (metin) => {
  // Önce görünmez/yön birimleri atılır (iki boşluk arasında kalan görünmez karakter çift boşluk
  // bırakmasın), sonra boşluk dizileri (satır sonu dahil) tek boşluk olur, kırpılır.
  let temiz = "";
  for (let i = 0; i < metin.length; i++) {
    if (!gorunmezBirimMi(metin.charCodeAt(i))) temiz += metin[i];
  }
  temiz = temiz.replace(/\s+/g, " ").trim();
  if (temiz.length === 0) return null;

  let aday = temiz;
  if (temiz.length > OTOMATIK_AD_UZUNLUGU) {
    // Sözcük ortasından kesilmez: ilk 40 birimin son boşluğu (40. konumdaki boşluk da sayılır:
    // ilk 40 birim tam bir sözcükte biter). Boşluk yoksa 40'ta kesilir; yarım vekil çift atılır.
    const bosluk = temiz.lastIndexOf(" ", OTOMATIK_AD_UZUNLUGU);
    let kesik: string;
    if (bosluk > 0) {
      kesik = temiz.slice(0, bosluk);
    } else {
      kesik = temiz.slice(0, OTOMATIK_AD_UZUNLUGU);
      if (yuksekVekilMi(kesik.charCodeAt(kesik.length - 1))) kesik = kesik.slice(0, -1);
    }
    aday = kesik + UC_NOKTA;
  }

  if (aday === VARSAYILAN_SOHBET_ADI) return null;
  return SohbetAdi.safeParse(aday).success ? aday : null;
};
