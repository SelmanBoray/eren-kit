/**
 * Kalıcı olay listesinden görünüm modeli: sohbet balonları, plan, iş, soru ve rapor kartları,
 * devir ve sistem notları. Olaylar `seq` sırasıyla, her biri bir kez gelir (`telafi` sağlar).
 * Plan kartında `plan_hash` yeniden hesaplanır; tutmazsa plan gösterilmez, yerine içeriksiz bir
 * `plan_gizlendi` satırı kalır. TASARIM.md "JS modülleri"; protocol README "Plan onayı".
 */
import { kanonikJson, planHash } from "@eren/protocol";
import type {
  GirdiYolu,
  IsBitisDurumu,
  IsProfili,
  IsRaporu,
  IsTuru,
  KisayolBaglami,
  Plan,
} from "@eren/protocol";
import type { GecmisSilindiNotu, KaliciOlay } from "./sozlesme.ts";

type OlayTuru<T extends KaliciOlay["type"]> = Extract<KaliciOlay, { type: T }>;

interface Ortak {
  /** Öğeyi açan olayın numarası; liste içinde benzersizdir. */
  seq: number;
  ts_ms: number;
}

export interface KullaniciBalonu extends Ortak {
  tur: "kullanici";
  client_msg_id: string;
  input: GirdiYolu;
  metin: string;
  /**
   * Dilim 3. Yalnız `user_echo` taşıyorsa (`input === "kisayol"`): kısayolun açıldığı an bakılan
   * uygulama (`ad` ekranda gösterilir). Yoksa alan yoktur.
   */
  baglam?: KisayolBaglami;
}

export interface AsistanBalonu extends Ortak {
  tur: "asistan";
  turn_id: string;
  metin: string;
}

export interface KesilenTur extends Ortak {
  tur: "tur_kesildi";
  turn_id: string;
  neden: OlayTuru<"turn_aborted">["neden"];
  kismi_metin: string | null;
}

export type PlanKartDurumu = "bekliyor" | "onaylandi" | "reddedildi" | "iptal";

export interface PlanKarti extends Ortak {
  tur: "plan";
  plan_id: string;
  /** Telefonda yeniden hesaplanmış ve olaydakiyle aynı olduğu doğrulanmış özet. */
  plan_hash: string;
  plan: Plan;
  /** Planın kanonik JSON'u: telefon planında `izinIste(plan_json, plan_hash)` için. */
  plan_json: string;
  durum: PlanKartDurumu;
  is_id: number | null;
}

/** Özeti tutmayan plan: içeriği gösterilmez, karar verilemez. */
export interface GizlenenPlan extends Ortak {
  tur: "plan_gizlendi";
}

export interface IsKarti extends Ortak {
  tur: "is";
  is_id: number;
  plan_id: string;
  plan_hash: string;
  baslik: string;
  is_turu: IsTuru;
  durum: "suruyor" | IsBitisDurumu;
  /** Yalnız `job_started` taşıyorsa (PC işi); yoksa alan yoktur. */
  profil?: IsProfili;
}

/** İş bitti. `rapor` güvenilmez metindir: düz metin, otomatik bağlantısız gösterilir. */
export interface RaporKarti extends Ortak {
  tur: "rapor";
  is_id: number;
  /** `job_started` görülmediyse `null`. */
  baslik: string | null;
  is_turu: IsTuru | null;
  durum: IsBitisDurumu;
  kirli: boolean;
  rapor: IsRaporu | null;
}

export type SoruKartDurumu = "bekliyor" | OlayTuru<"question_resolved">["sonuc"];

export interface SoruKarti extends Ortak {
  tur: "soru";
  soru_id: string;
  is_id: number;
  soru: string;
  secenekler: readonly string[];
  durum: SoruKartDurumu;
  cevap: string | null;
}

export interface DevirNotu extends Ortak {
  tur: "devir";
  nesil: number;
  ozet_kabul: boolean;
}

export interface SistemNotu extends Ortak {
  tur: "sistem";
  seviye: OlayTuru<"system_notice">["seviye"];
  kod: OlayTuru<"system_notice">["kod"];
  metin: string;
}

export type GorunumOgesi =
  | KullaniciBalonu
  | AsistanBalonu
  | KesilenTur
  | PlanKarti
  | GizlenenPlan
  | IsKarti
  | RaporKarti
  | SoruKarti
  | DevirNotu
  | SistemNotu
  | GecmisSilindiNotu;

export interface Olaylar {
  /** `seq`'i son eklenenden büyük olmayan olay yok sayılır. */
  ekle(o: KaliciOlay): void;
  sifirla(): void;
  /** Değişmedikçe aynı dizi döner; değişen kart yeni nesneyle yer değiştirir. */
  ogeler(): readonly GorunumOgesi[];
  plan(plan_id: string): PlanKarti | null;
  soru(soru_id: string): SoruKarti | null;
  is(is_id: number): IsKarti | null;
  /** Bu `client_msg_id`'nin `user_echo`'su görüldü mü. */
  yankiVar(client_msg_id: string): boolean;
}

export type OlaylarFabrikasi = () => Olaylar;

/** Özet tutarsa kanonik JSON, tutmazsa ya da plan geçersizse `null`. */
const dogrulanmisPlanJson = (o: OlayTuru<"plan_proposed">): string | null => {
  try {
    return planHash(o.plan) === o.plan_hash ? kanonikJson(o.plan) : null;
  } catch {
    return null;
  }
};

export const olaylarKur: OlaylarFabrikasi = () => {
  let liste: GorunumOgesi[] = [];
  let yayin: readonly GorunumOgesi[] = [];
  let degisti = false;
  let sonSeq = 0;
  // Güncellenen kartların yeri: "plan:<id>", "is:<id>", "soru:<id>".
  let konum = new Map<string, number>();
  let yankilar = new Set<string>();

  const ekleOge = (anahtar: string | null, oge: GorunumOgesi): void => {
    if (anahtar !== null) konum.set(anahtar, liste.length);
    liste.push(oge);
    degisti = true;
  };

  const bul = <T extends GorunumOgesi["tur"]>(
    anahtar: string,
    tur: T,
  ): { i: number; oge: Extract<GorunumOgesi, { tur: T }> } | null => {
    const i = konum.get(anahtar);
    if (i === undefined) return null;
    const oge = liste[i];
    if (oge === undefined || oge.tur !== tur) return null;
    return { i, oge: oge as Extract<GorunumOgesi, { tur: T }> };
  };

  const degistir = (i: number, oge: GorunumOgesi): void => {
    liste[i] = oge;
    degisti = true;
  };

  const uygula = (o: KaliciOlay): void => {
    const ortak = { seq: o.seq, ts_ms: o.ts_ms };
    switch (o.type) {
      case "user_echo":
        yankilar.add(o.client_msg_id);
        ekleOge(null, {
          ...ortak,
          tur: "kullanici",
          client_msg_id: o.client_msg_id,
          input: o.input,
          metin: o.text,
          ...(o.baglam !== undefined ? { baglam: o.baglam } : {}),
        });
        return;

      case "assistant_message":
        ekleOge(null, { ...ortak, tur: "asistan", turn_id: o.turn_id, metin: o.text });
        return;

      case "turn_aborted":
        ekleOge(null, {
          ...ortak,
          tur: "tur_kesildi",
          turn_id: o.turn_id,
          neden: o.neden,
          kismi_metin: o.kismi_metin ?? null,
        });
        return;

      case "plan_proposed": {
        const anahtar = `plan:${o.plan.plan_id}`;
        if (konum.has(anahtar)) return;
        const plan_json = dogrulanmisPlanJson(o);
        if (plan_json === null) {
          ekleOge(null, { ...ortak, tur: "plan_gizlendi" });
          return;
        }
        ekleOge(anahtar, {
          ...ortak,
          tur: "plan",
          plan_id: o.plan.plan_id,
          plan_hash: o.plan_hash,
          plan: o.plan,
          plan_json,
          durum: "bekliyor",
          is_id: null,
        });
        return;
      }

      case "plan_resolved": {
        const k = bul(`plan:${o.plan_id}`, "plan");
        // Başka özetin sonucu bu kartı kapatamaz.
        if (k === null || k.oge.plan_hash !== o.plan_hash) return;
        degistir(k.i, { ...k.oge, durum: o.sonuc, is_id: o.is_id ?? k.oge.is_id });
        return;
      }

      case "job_started": {
        const anahtar = `is:${o.is_id}`;
        if (konum.has(anahtar)) return;
        ekleOge(anahtar, {
          ...ortak,
          tur: "is",
          is_id: o.is_id,
          plan_id: o.plan_id,
          plan_hash: o.plan_hash,
          baslik: o.baslik,
          is_turu: o.tur,
          durum: "suruyor",
          ...(o.profil !== undefined ? { profil: o.profil } : {}),
        });
        return;
      }

      case "job_finished": {
        const k = bul(`is:${o.is_id}`, "is");
        if (k !== null) degistir(k.i, { ...k.oge, durum: o.durum });
        ekleOge(null, {
          ...ortak,
          tur: "rapor",
          is_id: o.is_id,
          baslik: k?.oge.baslik ?? null,
          is_turu: k?.oge.is_turu ?? null,
          durum: o.durum,
          kirli: o.kirli,
          rapor: o.rapor ?? null,
        });
        return;
      }

      case "question_asked": {
        const anahtar = `soru:${o.soru_id}`;
        if (konum.has(anahtar)) return;
        ekleOge(anahtar, {
          ...ortak,
          tur: "soru",
          soru_id: o.soru_id,
          is_id: o.is_id,
          soru: o.soru,
          secenekler: o.secenekler ?? [],
          durum: "bekliyor",
          cevap: null,
        });
        return;
      }

      case "question_resolved": {
        const k = bul(`soru:${o.soru_id}`, "soru");
        if (k === null) return;
        degistir(k.i, { ...k.oge, durum: o.sonuc, cevap: o.cevap ?? null });
        return;
      }

      case "eren_handover":
        ekleOge(null, { ...ortak, tur: "devir", nesil: o.nesil, ozet_kabul: o.ozet_kabul });
        return;

      case "system_notice":
        ekleOge(null, { ...ortak, tur: "sistem", seviye: o.seviye, kod: o.kod, metin: o.metin });
        return;

      case "chat_cleared": {
        const kalan = liste.filter((oge) => oge.seq > o.sinir_seq);
        // Önceki notlar (eski "geçmiş silindi" dahil) ve yankılar gider; kalanların konumu yeniden kurulur.
        const yeni = kalan.filter((oge) => oge.tur !== "gecmis_silindi");
        liste = yeni;
        konum = new Map();
        yankilar = new Set();
        yeni.forEach((oge, i) => {
          if (oge.tur === "plan") konum.set(`plan:${oge.plan_id}`, i);
          else if (oge.tur === "is") konum.set(`is:${oge.is_id}`, i);
          else if (oge.tur === "soru") konum.set(`soru:${oge.soru_id}`, i);
          else if (oge.tur === "kullanici") yankilar.add(oge.client_msg_id);
        });
        ekleOge(null, { tur: "gecmis_silindi", seq: o.seq, ts_ms: o.ts_ms, sinir_seq: o.sinir_seq });
        return;
      }
    }
  };

  return {
    ekle: (o) => {
      if (o.seq <= sonSeq) return;
      sonSeq = o.seq;
      uygula(o);
    },

    sifirla: () => {
      liste = [];
      yayin = [];
      degisti = false;
      sonSeq = 0;
      konum = new Map();
      yankilar = new Set();
    },

    ogeler: () => {
      if (degisti) {
        yayin = liste.slice();
        degisti = false;
      }
      return yayin;
    },

    plan: (plan_id) => bul(`plan:${plan_id}`, "plan")?.oge ?? null,
    soru: (soru_id) => bul(`soru:${soru_id}`, "soru")?.oge ?? null,
    is: (is_id) => bul(`is:${is_id}`, "is")?.oge ?? null,
    yankiVar: (client_msg_id) => yankilar.has(client_msg_id),
  };
};
