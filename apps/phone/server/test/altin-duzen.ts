/**
 * H4.0 altın kayıtlarının düzenekleri: gerçek `ayarKur` (sahte dosya ve ortamla), gerçek `konusmaKur` /
 * `islerKur`, `depoKur(:memory:)`, `akisKur`, `veriyoluKur`; dış dünya `sahteDunya`. Her port bir iz
 * defterine yazar: süreç başlatma, stdin satırı, veriyolu yayını, depo yazımı (işlem sınırlarıyla), dosya
 * yazma/silme, köprü jetonları, kapı ve medya yazımları. Okuma çağrıları ize girmez (davranış değil), ama
 * kapsam denetimi için adları toplanır.
 */
import { planHash } from "@eren/protocol";
import type { IsProfili, Plan, SohbetId } from "@eren/protocol";
import { ANA_SOHBET_ID } from "@eren/protocol";
import { akisKur } from "../src/akis.ts";
import { ayarKur } from "../src/ayar.ts";
import { depoKur } from "../src/depo.ts";
import { islerKur } from "../src/isler.ts";
import { konusmaKur } from "../src/konusma.ts";
import { veriyoluKur } from "../src/veriyolu.ts";
import type {
  AjandaJetonKapsami,
  Ayar,
  BoruluSurecIstegi,
  AyrikSurecIstegi,
  Depo,
  DogrulanmisInsanMesaji,
  DosyaPortu,
  JetonKapsami,
  KonusmaMedyaYuzu,
  LimitKilitDurumu,
  NesilKaydi,
  RastgelePortu,
  SurecPortu,
  Veriyolu,
} from "../src/sozlesme.ts";
import { T0, YerTutucular, izliRastgele, jsonKaydi } from "./altin-kayit.ts";
import { sahteDunya, sahteKapi, sahteMedyaYoneticisi } from "./sahte.ts";
import type { SahteBoruluSurec, SahteDunya, SahteMedyaYoneticisi } from "./sahte.ts";

export type IzGirdisi = readonly unknown[];

/** Depo yöntemlerinin sınıfı: yazım ize girer; okuma girmez. Sınıflanmamış yöntem kapsam testinde kırmızıdır. */
export const DEPO_YAZIMLARI: ReadonlySet<string> = new Set([
  "olayEkle",
  "turEkle",
  "turKismiYaz",
  "turBitir",
  "nesilEkle",
  "nesilGuncelle",
  "kuyrugaEkle",
  "kuyruktanSil",
  "kuyrukEkiYaz",
  "oturumKaydet",
  "sohbetEtkinlikYaz",
  "tuketimEkle",
  "isEkle",
  "isGuncelle",
  "isPidEkle",
  "soruEkle",
  "soruGuncelle",
  "planEkle",
  "planGuncelle",
]);
export const DEPO_OKUMALARI: ReadonlySet<string> = new Set([
  "islem",
  "acikTurlar",
  "isListele",
  "isGetir",
  "isPidleri",
  "isPlanaGore",
  "kayitliOturumlar",
  "kuyrukBasi",
  "kuyrukSentetikBasi",
  "nesiller",
  "sonKonusma",
  "sonMezarTasi",
  "sonNesil",
  "bekleyenSorular",
  "bekleyenPlanlar",
  "planGetir",
  "soruGetir",
  "enBuyukNesil",
  "sohbetGetir",
  "olaylariGetir",
]);

const kopya = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

export const bosalt = async (tur = 6): Promise<void> => {
  for (let i = 0; i < tur; i++) await new Promise<void>((r) => setImmediate(r));
};

// ---------------------------------------------------------------------------------------------
// Ortak: ayar (gerçek `ayarKur`)
// ---------------------------------------------------------------------------------------------

export const YEREL = "C:\\ornek\\Yerel";
export const BIN = "C:\\ornek\\bin";
export const NODE_EXE = "C:\\ornek\\node\\node.exe";
const YEREL_AYAR = `${YEREL}\\eren-kit\\ayar.local.json`;
const KIMLIK_EKI = `${YEREL}\\eren-kit\\kimlik.local.md`;
export const CU_TANIMI = { command: "C:\\ornek\\cu\\cu.exe", args: ["--sunucu"], env: { CU_ORNEK: "1" } };
export const REA_TANIMI = { command: "C:\\ornek\\rea\\rea.exe", args: ["--mcp"] };

export interface AyarSecenegi {
  computerUse?: boolean;
  tamYetki?: boolean;
  medya?: boolean;
  kimlikEki?: string;
  asistanAdi?: string;
  /** `ayar.local.json`'a ek alanlar (ör. `pc_is_modeli`). */
  yerel?: Record<string, unknown>;
}

/** Sahte ortam: kişisel değer yok; `CLAUDE*`/`ANTHROPIC*` anahtarları silinmeyi göstermek için var. */
export const sahteOrtam = (asistanAdi?: string): Record<string, string> => ({
  LOCALAPPDATA: YEREL,
  USERPROFILE: "C:\\ornek\\Kullanici",
  PATH: BIN,
  ORNEK_DEGISKEN: "1",
  CLAUDE_CODE_ORNEK: "gizli",
  ANTHROPIC_API_KEY: "gizli",
  Anthropic_Kucuk: "gizli",
  ...(asistanAdi !== undefined && { EREN_KIT_ASSISTANT_NAME: asistanAdi }),
});

export async function ayarHazirla(d: SahteDunya, sec: AyarSecenegi): Promise<Ayar> {
  d.dosya.yaz(`${BIN}\\claude.exe`, "");
  if (sec.medya === true) {
    d.dosya.yaz(`${BIN}\\ffmpeg.exe`, "");
    d.dosya.yaz(`${BIN}\\ffprobe.exe`, "");
  }
  if (sec.kimlikEki !== undefined) d.dosya.yaz(KIMLIK_EKI, sec.kimlikEki);
  d.dosya.yaz(
    YEREL_AYAR,
    JSON.stringify({
      kullanici_adi: "Ornek",
      ...(sec.computerUse === true && { computer_use: CU_TANIMI }),
      rea: REA_TANIMI,
      ...(sec.tamYetki === false && { tam_yetki: false }),
      ...sec.yerel,
    }),
  );
  const ayar = await ayarKur({ dosya: d.dosya, ortam: sahteOrtam(sec.asistanAdi), execPath: NODE_EXE, baslangicMs: T0 });
  d.dosya.cagrilar.temizle();
  return ayar;
}

// ---------------------------------------------------------------------------------------------
// İz defteri ve izli portlar
// ---------------------------------------------------------------------------------------------

export class Iz {
  readonly girdiler: IzGirdisi[] = [];
  acik = false;
  readonly depoCagrilari = new Set<string>();
  readonly yayinAdlari = new Set<string>();
  ekle(...g: unknown[]): void {
    if (this.acik) this.girdiler.push(g.map((x) => kopya(x)));
  }
}

export function izliVeriyolu(iz: Iz, v: Veriyolu): Veriyolu {
  return {
    yayinla: (ad, veri) => {
      iz.yayinAdlari.add(ad);
      iz.ekle("yayin", ad, veri);
      v.yayinla(ad, veri);
    },
    dinle: (ad, f) => v.dinle(ad, f),
  };
}

export function izliDepo(iz: Iz, depo: Depo): Depo {
  return new Proxy(depo, {
    get(hedef, ad, alici) {
      const deger = Reflect.get(hedef, ad, alici) as unknown;
      if (typeof deger !== "function" || typeof ad !== "string") return deger;
      const f = deger as (...a: unknown[]) => unknown;
      return (...args: unknown[]) => {
        iz.depoCagrilari.add(ad);
        if (ad === "islem") {
          iz.ekle("islem", "bas");
          try {
            const r = f.apply(hedef, args);
            iz.ekle("islem", "son");
            return r;
          } catch (e) {
            iz.ekle("islem", "geri");
            throw e;
          }
        }
        if (DEPO_YAZIMLARI.has(ad)) iz.ekle("depo", ad, ...args);
        return f.apply(hedef, args);
      };
    },
  });
}

export function izliDosya(iz: Iz, dosya: DosyaPortu): DosyaPortu {
  return {
    ...dosya,
    atomikYaz: async (yol, icerik) => {
      iz.ekle("dosya", "yaz", yol, jsonKaydi(icerik));
      await dosya.atomikYaz(yol, icerik);
    },
    dosyaSil: async (yol) => {
      iz.ekle("dosya", "sil", yol);
      await dosya.dosyaSil(yol);
    },
    dizinOlustur: async (yol) => {
      iz.ekle("dosya", "dizin", yol);
      await dosya.dizinOlustur(yol);
    },
  };
}

export interface Baslatma {
  tur: "borulu" | "ayrik";
  istek: BoruluSurecIstegi | AyrikSurecIstegi;
  pid: number;
}

/** Süreç portu: başlatma (kısa iz; tam istek `baslatmalar`'da), stdin satırı, stdin kapatma, öldürme. */
export function izliSurec(iz: Iz, d: SahteDunya, baslatmalar: Baslatma[]): SurecPortu {
  return {
    boruluBaslat: async (istek) => {
      const s = (await d.surec.boruluBaslat(istek)) as SahteBoruluSurec;
      baslatmalar.push({ tur: "borulu", istek, pid: s.pid });
      const a = istek.argv;
      const i = a.indexOf("--session-id");
      const kip = i >= 0 ? "session-id" : "resume";
      iz.ekle("surec", "baslat", { pid: s.pid, kip, oturum: a[(i >= 0 ? i : a.indexOf("--resume")) + 1] });
      const yaz = s.satirYaz.bind(s);
      s.satirYaz = (satir: string): boolean => {
        const ok = yaz(satir);
        if (ok) iz.ekle("stdin", s.pid, jsonKaydi(satir));
        else iz.ekle("stdin_yazilamadi", s.pid);
        return ok;
      };
      const kapat = s.stdinKapat.bind(s);
      s.stdinKapat = () => {
        iz.ekle("surec", "stdinKapat", s.pid);
        kapat();
      };
      return s;
    },
    ayrikBaslat: async (istek) => {
      const s = await d.surec.ayrikBaslat(istek);
      baslatmalar.push({ tur: "ayrik", istek, pid: s.pid });
      iz.ekle("surec", "ayrikBaslat", { pid: s.pid });
      return s;
    },
    aracCalistir: (istek) => d.surec.aracCalistir(istek),
    anlikGoruntu: () => d.surec.anlikGoruntu(),
    surecVarMi: (k) => d.surec.surecVarMi(k),
    agaciOldur: (pid) => {
      iz.ekle("surec", "agaciOldur", pid);
      return d.surec.agaciOldur(pid);
    },
    tekOldur: (pid) => {
      iz.ekle("surec", "tekOldur", pid);
      return d.surec.tekOldur(pid);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Konuşma düzeni
// ---------------------------------------------------------------------------------------------

export interface KonusmaSecenegi extends AyarSecenegi {
  /** `takvim` ve `ajandaKopru` birlikte (ana böyle verir): damga ve `eren-ajanda` sunucusu. */
  takvim?: boolean;
}

export interface KonusmaDuzeni {
  d: SahteDunya;
  ayar: Ayar;
  depo: Depo;
  /** Testin girdisi: yayın ize `girdi` olarak düşer (konuşmanın kendi yayınları `yayin`). */
  veriyolu: Veriyolu;
  iz: Iz;
  yt: YerTutucular;
  baslatmalar: Baslatma[];
  konusma: ReturnType<typeof konusmaKur>;
  medya: SahteMedyaYoneticisi | null;
  /** Kayda başlar: baslat + uyandır, süreç açılır. */
  basla(): Promise<void>;
  sonSurec(): SahteBoruluSurec;
  /** Süreç stdout'una satır; ize `girdi` etiketiyle düşer. */
  besle(s: SahteBoruluSurec, etiket: string, satir: unknown): Promise<void>;
  insan(n: number, text: string, ek?: { input?: string; baglam?: { paket: string; ad: string }; ekler?: unknown[] }): void;
  ilerlet(ms: number): Promise<void>;
  /** Önceden kayıtlı nesil (devam kipi): kayıt açılmadan önce. */
  nesilTohumla(n: Partial<NesilKaydi>): void;
}

export const ANA: SohbetId = ANA_SOHBET_ID;
export const SABIT_OTURUM = "11111111-1111-4111-8111-111111111111";
export const MODEL = "claude-opus-ornek";

export async function konusmaDuzeni(sec: KonusmaSecenegi = {}): Promise<KonusmaDuzeni> {
  const d = sahteDunya({ baslangicMs: T0 });
  const ayar = await ayarHazirla(d, sec);
  const iz = new Iz();
  const yt = new YerTutucular();
  const tabanVeriyolu = veriyoluKur({ gunluk: d.gunluk });
  const veriyolu = izliVeriyolu(iz, tabanVeriyolu);
  const girdiVeriyolu: Veriyolu = {
    yayinla: (ad, veri) => {
      iz.ekle("girdi", "yayin", ad, veri);
      tabanVeriyolu.yayinla(ad, veri);
    },
    dinle: (ad, f) => tabanVeriyolu.dinle(ad, f),
  };
  const tabanDepo = depoKur({ yol: ":memory:", saat: d.saat, veriyolu, gunluk: d.gunluk });
  if (tabanDepo.sohbetGetir({ sohbet_id: ANA }) === null) {
    tabanDepo.sohbetEkle({ sohbet_id: ANA, ad: "Ornek sohbet", olusturma_ms: T0, son_etkinlik_ms: T0 });
  }
  const depo = izliDepo(iz, tabanDepo);
  const kapi = sahteKapi();
  let nesilSayaci = 0;
  const baslatmalar: Baslatma[] = [];
  const rastgele: RastgelePortu = izliRastgele(d.rastgele, yt);
  let jetonNo = 0;
  const kopru = {
    jetonUret: (kapsam: JetonKapsami): string => {
      iz.ekle("kopru", "jetonUret", kapsam);
      return `jeton-${kapsam.rol}-${++jetonNo}`;
    },
    jetonlariIptalEt: (kapsam: JetonKapsami): void => iz.ekle("kopru", "iptal", kapsam),
  };
  const ajandaKopru = {
    jetonUret: (kapsam: AjandaJetonKapsami): string => {
      iz.ekle("ajanda", "jetonUret", kapsam);
      return `jeton-ajanda-${++jetonNo}`;
    },
    jetonlariIptalEt: (kapsam: AjandaJetonKapsami): void => iz.ekle("ajanda", "iptal", kapsam),
  };
  const izliKapi = {
    yuvaIste: (s: { sohbet_id: SohbetId }) => {
      iz.ekle("kapi", "yuvaIste");
      return kapi.yuvaIste(s);
    },
    yuvaBirak: (s: { sohbet_id: SohbetId }) => {
      iz.ekle("kapi", "yuvaBirak");
      kapi.yuvaBirak(s);
    },
    devirSerbestMi: () => kapi.devirSerbestMi(),
  };
  const medya = sec.medya === true ? sahteMedyaYoneticisi() : null;
  const medyaYuzu: KonusmaMedyaYuzu | null =
    medya === null
      ? null
      : {
          ekleriBagla: (g) => {
            iz.ekle("medya", "ekleriBagla", { kuyruk_id: g.kuyruk_id, ekler: g.ekler.map((e) => e.medya_id) });
            medya.ekleriBagla(g);
          },
          icerik: (g) => medya.icerik(g),
          icerikBirak: (k) => {
            iz.ekle("medya", "icerikBirak", k);
            medya.icerikBirak(k);
          },
          nesilGorselSayisi: (n) => medya.nesilGorselSayisi(n),
          nesilGorselEkle: (n, adet) => {
            iz.ekle("medya", "nesilGorselEkle", n, adet);
            medya.nesilGorselEkle(n, adet);
          },
          ekDizinleri: (s, l) => medya.ekDizinleri(s, l),
        };
  const konusma = konusmaKur({
    sohbet_id: ANA,
    kapi: izliKapi,
    nesilAyir: () => (nesilSayaci = Math.max(nesilSayaci, tabanDepo.enBuyukNesil()) + 1),
    ayar,
    depo,
    kilit: { baslatmaSerbestMi: () => true },
    kopru,
    akis: akisKur(),
    surec: izliSurec(iz, d, baslatmalar),
    dosya: izliDosya(iz, d.dosya),
    saat: d.saat,
    zamanlayici: d.zamanlayici,
    rastgele,
    veriyolu,
    gunluk: d.gunluk,
    ...(sec.takvim === true && { takvim: d.takvim, ajandaKopru }),
    ...(medyaYuzu !== null && { medya: medyaYuzu }),
  });

  const h: KonusmaDuzeni = {
    d,
    ayar,
    depo: tabanDepo,
    veriyolu: girdiVeriyolu,
    iz,
    yt,
    baslatmalar,
    konusma,
    medya,
    async basla() {
      iz.acik = true;
      await konusma.baslat();
      konusma.uyandir();
      await bosalt();
    },
    sonSurec() {
      const s = d.surec.borulular().at(-1);
      if (s === undefined) throw new Error("altın: süreç açılmadı");
      return s;
    },
    async besle(s, etiket, satir) {
      iz.ekle("girdi", s.pid, etiket);
      s.stdoutSatiriGonder(typeof satir === "string" ? satir : JSON.stringify(satir));
      await bosalt();
    },
    insan(n, text, ek = {}) {
      iz.ekle("girdi", "insan", n);
      konusma.insanMesajiAl({
        device_id: "cihaz1",
        client_msg_id: `msg${n}`,
        sohbet_id: ANA,
        input: ek.input ?? "yazi",
        text,
        ...(ek.baglam !== undefined && { baglam: ek.baglam }),
        ...(ek.ekler !== undefined && { ekler: ek.ekler }),
      } as unknown as DogrulanmisInsanMesaji);
    },
    async ilerlet(ms) {
      iz.ekle("girdi", "saat", ms);
      await bosalt();
      d.zaman.ilerlet(ms);
      await bosalt();
    },
    nesilTohumla(n) {
      tabanDepo.nesilEkle({
        nesil: 1,
        sohbet_id: ANA,
        session_id: SABIT_OTURUM,
        baslangic_ms: T0 - 60_000,
        bitis_ms: null,
        ozet_kabul: null,
        pid: null,
        olusturma_ms: null,
        son_dolu: null,
        pencere: null,
        ...n,
      });
    },
  };
  return h;
}

// ---------------------------------------------------------------------------------------------
// Akış satırı kurucuları (stream-json girdisi; testin kendi verisi)
// ---------------------------------------------------------------------------------------------

export const oturumKimligi = (s: SahteBoruluSurec): string => {
  const a = s.istek.argv;
  return a[Math.max(a.indexOf("--session-id"), a.indexOf("--resume")) + 1]!;
};

export const initSatiri = (s: SahteBoruluSurec, ek: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: "system",
  subtype: "init",
  session_id: oturumKimligi(s),
  tools: ["PowerShell", "Read", "mcp__eren__plan_oner"],
  mcp_servers: [{ name: "eren", status: "connected" }],
  apiKeySource: "none",
  model: MODEL,
  ...ek,
});

export const sonucSatiri = (ek: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: "result",
  subtype: "success",
  is_error: false,
  terminal_reason: "completed",
  stop_reason: "end_turn",
  result: "tamam",
  session_id: "ornek",
  modelUsage: { [`${MODEL}[1m]`]: { contextWindow: 1_000_000 } },
  usage: { input_tokens: 3, cache_creation_input_tokens: 2, cache_read_input_tokens: 1, output_tokens: 4 },
  ...ek,
});

export const asistanSatiri = (id: string, input: number, ek: { cc?: number; cr?: number; icerik?: unknown[]; ebeveyn?: string } = {}) => ({
  type: "assistant",
  parent_tool_use_id: ek.ebeveyn ?? null,
  message: {
    id,
    model: MODEL,
    content: ek.icerik ?? [],
    usage: { input_tokens: input, cache_creation_input_tokens: ek.cc ?? 0, cache_read_input_tokens: ek.cr ?? 0, output_tokens: 10 },
  },
});

export const parcaSatiri = (text: string): Record<string, unknown> => ({
  type: "stream_event",
  parent_tool_use_id: null,
  event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
});

// ---------------------------------------------------------------------------------------------
// İşler düzeni
// ---------------------------------------------------------------------------------------------

export interface IslerDuzeni {
  d: SahteDunya;
  ayar: Ayar;
  depo: Depo;
  iz: Iz;
  yt: YerTutucular;
  baslatmalar: Baslatma[];
  isler: ReturnType<typeof islerKur>;
  baslat(plan: Plan, profil?: IsProfili): Promise<number>;
  outEkle(is_id: number, etiket: string, ...satirlar: unknown[]): void;
  yokla(ms?: number): Promise<void>;
  surecOf(is_id: number): { cik(kod: number): void };
}

export async function islerDuzeni(sec: AyarSecenegi = {}): Promise<IslerDuzeni> {
  const d = sahteDunya({ baslangicMs: T0, servisPid: 4000 });
  const ayar = await ayarHazirla(d, { computerUse: true, ...sec });
  const iz = new Iz();
  const yt = new YerTutucular();
  const veriyolu = izliVeriyolu(iz, veriyoluKur({ gunluk: d.gunluk }));
  const tabanDepo = depoKur({ yol: ":memory:", saat: d.saat, veriyolu, gunluk: d.gunluk });
  const depo = izliDepo(iz, tabanDepo);
  const baslatmalar: Baslatma[] = [];
  const kilitDurumu: LimitKilitDurumu = { tur: "serbest" };
  let jetonNo = 0;
  const isler = islerKur({
    ayar,
    depo,
    kilit: { durum: () => kilitDurumu, baslatmaSerbestMi: () => true },
    kopru: {
      jetonUret: (kapsam) => {
        iz.ekle("kopru", "jetonUret", kapsam);
        return `jeton-${kapsam.rol}-${++jetonNo}`;
      },
      jetonlariIptalEt: (kapsam) => iz.ekle("kopru", "iptal", kapsam),
    },
    akis: akisKur(),
    surec: izliSurec(iz, d, baslatmalar),
    dosya: izliDosya(iz, d.dosya),
    sistem: d.sistem,
    saat: d.saat,
    zamanlayici: d.zamanlayici,
    rastgele: izliRastgele(d.rastgele, yt),
    veriyolu,
    gunluk: d.gunluk,
  });
  return {
    d,
    ayar,
    depo: tabanDepo,
    iz,
    yt,
    baslatmalar,
    isler,
    async baslat(plan, profil = "tam") {
      tabanDepo.planEkle({
        plan,
        plan_hash: planHash(plan),
        durum: "onaylandi",
        profil,
        is_id: null,
        olusturma_ms: d.zaman.simdi(),
        sohbet_id: ANA,
      });
      iz.acik = true;
      const r = await isler.baslat({ plan, plan_hash: planHash(plan), profil, sohbet_id: ANA });
      if (!r.ok) throw new Error(`altın: iş başlamadı (${r.code})`);
      await bosalt();
      return r.deger;
    },
    outEkle(is_id, etiket, ...satirlar) {
      iz.ekle("girdi", "out", etiket);
      d.dosya.ekle(ayar.isYollari(is_id).out, satirlar.map((s) => `${typeof s === "string" ? s : JSON.stringify(s)}\n`).join(""));
    },
    async yokla(ms = 2000) {
      await bosalt(30);
      d.zaman.ilerlet(ms);
      await bosalt(30);
    },
    surecOf(is_id) {
      const pid = tabanDepo.isGetir(is_id)?.pid;
      const s = d.surec.ayriklar().find((x) => x.pid === pid);
      if (s === undefined) throw new Error("altın: iş süreci yok");
      return s;
    },
  };
}
