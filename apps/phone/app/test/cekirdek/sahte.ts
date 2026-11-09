/** JS çekirdeği testlerinin sahte portları ve çerçeve kurucuları. Gerçek ağ, saat, disk yok. */
import { PROTOKOL_SURUMU, SOHBET_SURUMU } from "@eren/protocol";
import type {
  DepoPortu,
  EslesmeBilgisi,
  IptalEt,
  KimlikPortu,
  SaatPortu,
  SohbetImzaSonucu,
  SohbetKimlikBaslangici,
  WsBaglantisi,
  WsDinleyici,
  WsPortu,
} from "../../src/cekirdek/sozlesme.ts";

export const NONCE = "AAAAAAAAAAAAAAAAAAAAAAAA";
export const IMZA = "c2lnbmF0dXJl";
export const OTURUM = "oturum-1";
export const HASH_A = "a".repeat(64);

/** Bekleyen promise zincirlerini boşaltır. */
export const bosalt = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await new Promise<void>((r) => setImmediate(r));
};

// ---------------------------------------------------------------------------------------------
export class SahteSaat implements SaatPortu {
  simdi = 1_000_000;
  zamanlayicilar: { ne: number; f: () => void; iptal: boolean }[] = [];
  simdiMs(): number {
    return this.simdi;
  }
  sonra(ms: number, f: () => void): IptalEt {
    const z = { ne: this.simdi + ms, f, iptal: false };
    this.zamanlayicilar.push(z);
    return () => {
      z.iptal = true;
    };
  }
  /** İptal edilmemiş, henüz çalışmamış zamanlayıcıların kalan süreleri. */
  bekleyenler(): number[] {
    return this.zamanlayicilar.filter((z) => !z.iptal).map((z) => z.ne - this.simdi);
  }
  ilerlet(ms: number): void {
    const hedef = this.simdi + ms;
    for (;;) {
      const siradaki = this.zamanlayicilar
        .filter((z) => !z.iptal && z.ne <= hedef)
        .sort((a, b) => a.ne - b.ne)[0];
      if (siradaki === undefined) break;
      siradaki.iptal = true;
      this.simdi = Math.max(this.simdi, siradaki.ne);
      siradaki.f();
    }
    this.simdi = hedef;
  }
}

// ---------------------------------------------------------------------------------------------
export class SahteBaglanti implements WsBaglantisi {
  gidenler: string[] = [];
  kapatildi = false;
  readonly url: string;
  readonly dinleyici: WsDinleyici;
  constructor(url: string, dinleyici: WsDinleyici) {
    this.url = url;
    this.dinleyici = dinleyici;
  }
  gonder(metin: string): void {
    this.gidenler.push(metin);
  }
  kapat(): void {
    this.kapatildi = true;
  }
  giden(): Record<string, unknown>[] {
    return this.gidenler.map((m) => JSON.parse(m) as Record<string, unknown>);
  }
  tipler(): string[] {
    return this.giden().map((m) => String(m["type"]));
  }
  acildi(): void {
    this.dinleyici.acildi();
  }
  /** Nesne ya da ham metin gelir. */
  gel(c: unknown): void {
    this.dinleyici.mesaj(typeof c === "string" ? c : JSON.stringify(c));
  }
  kopsun(kod = 1006): void {
    this.dinleyici.kapandi(kod);
  }
}

export class SahteWs implements WsPortu {
  baglantilar: SahteBaglanti[] = [];
  acHatasi = false;
  ac(url: string, dinleyici: WsDinleyici): WsBaglantisi {
    if (this.acHatasi) throw new Error("ac_hatasi");
    const b = new SahteBaglanti(url, dinleyici);
    this.baglantilar.push(b);
    return b;
  }
  son(): SahteBaglanti {
    const b = this.baglantilar[this.baglantilar.length - 1];
    if (b === undefined) throw new Error("bağlantı yok");
    return b;
  }
}

// ---------------------------------------------------------------------------------------------
export class SahteKimlik implements KimlikPortu {
  eslesmeDegeri: EslesmeBilgisi | null = { device_id: "cihaz-1", host: "100.64.0.1", port: 8443 };
  baslangic: SohbetKimlikBaslangici = { device_id: "cihaz-1", client_nonce: NONCE, oturum: OTURUM };
  sinamaSonucu: SohbetImzaSonucu = { signature: IMZA };
  sinamaCagrilari: { oturum: string; server_nonce: string; server_signature: string }[] = [];
  helloCagrilari = 0;
  eslesme(): Promise<EslesmeBilgisi | null> {
    return Promise.resolve(this.eslesmeDegeri);
  }
  sohbetHello(): Promise<SohbetKimlikBaslangici> {
    this.helloCagrilari++;
    return Promise.resolve(this.baslangic);
  }
  sohbetSinama(oturum: string, server_nonce: string, server_signature: string): Promise<SohbetImzaSonucu> {
    this.sinamaCagrilari.push({ oturum, server_nonce, server_signature });
    return Promise.resolve(this.sinamaSonucu);
  }
}

// ---------------------------------------------------------------------------------------------
export interface DepoIslemi {
  tur: "yaz" | "ekle" | "sil" | "satirlariYaz";
  anahtar: string;
  deger?: string;
  /** `satirlariYaz` için yazılan satırların kopyası. */
  satirlar?: string[];
}

export class SahteDepo implements DepoPortu {
  kv = new Map<string, string>();
  gunlukler = new Map<string, string[]>();
  /** Yazma yönlü işlemlerin sırası: "önce olay, sonra last_seq" iddiası için. */
  islemler: DepoIslemi[] = [];
  hata: { yaz?: boolean; ekle?: boolean; sil?: boolean; satirlariYaz?: boolean } = {};

  oku(anahtar: string): Promise<string | null> {
    return Promise.resolve(this.kv.get(anahtar) ?? null);
  }
  yaz(anahtar: string, deger: string): Promise<void> {
    if (this.hata.yaz) return Promise.reject(new Error("yaz"));
    this.islemler.push({ tur: "yaz", anahtar, deger });
    this.kv.set(anahtar, deger);
    return Promise.resolve();
  }
  ekle(anahtar: string, satir: string): Promise<void> {
    if (this.hata.ekle) return Promise.reject(new Error("ekle"));
    this.islemler.push({ tur: "ekle", anahtar, deger: satir });
    const g = this.gunlukler.get(anahtar) ?? [];
    g.push(satir);
    this.gunlukler.set(anahtar, g);
    return Promise.resolve();
  }
  satirlar(anahtar: string): Promise<string[]> {
    return Promise.resolve([...(this.gunlukler.get(anahtar) ?? [])]);
  }
  /**
   * Atomik: `hata.satirlariYaz` açıksa reddeder ve eski günlük bozulmadan kalır; başarıda günlük
   * tamamen değişir (kopya alınır, çağıranın dizisiyle paylaşılmaz).
   */
  satirlariYaz(anahtar: string, satirlar: readonly string[]): Promise<void> {
    if (this.hata.satirlariYaz) return Promise.reject(new Error("satirlariYaz"));
    const kopya = [...satirlar];
    this.islemler.push({ tur: "satirlariYaz", anahtar, satirlar: [...kopya] });
    this.gunlukler.set(anahtar, kopya);
    return Promise.resolve();
  }
  sil(anahtar: string): Promise<void> {
    if (this.hata.sil) return Promise.reject(new Error("sil"));
    this.islemler.push({ tur: "sil", anahtar });
    this.kv.delete(anahtar);
    this.gunlukler.delete(anahtar);
    return Promise.resolve();
  }
}

// ---------------------------------------------------------------------------------------------
// Kablo çerçeveleri (şemaya uyan, uydurma veri)
/** `/sohbet` çerçeve sürümü (v3). Eşleştirme çerçeveleri için `vEslesme`. */
export const v = SOHBET_SURUMU;
/** `pair_request` / `pair_result` v1'de kalır. */
export const vEslesme = PROTOKOL_SURUMU;

export const challenge = () => ({ v, type: "auth_challenge", server_nonce: NONCE, server_signature: IMZA });
export const welcome = (head_seq: number) => ({ v, type: "welcome", head_seq, server_time_ms: 1 });
export const ack = (client_msg_id: string, ok = true, extra: Record<string, unknown> = {}) =>
  ok
    ? { v, type: "ack", client_msg_id, ok: true, ...extra }
    : { v, type: "ack", client_msg_id, ok: false, code: "ic_hata", ...extra };
export const delta = (turn_id: string, offset: number, text: string, sohbet_id = "ana") => ({
  v,
  type: "assistant_delta",
  sohbet_id,
  turn_id,
  offset,
  text,
});
export const ornekServis = (extra: Partial<{ surum: string | null; baslangic_ms: number }> = {}) => ({
  surum: "abc1234" as string | null,
  baslangic_ms: 500_000,
  ...extra,
});
export const sunucuDurumu = (extra: Record<string, unknown> = {}) => ({
  v,
  type: "server_status",
  sohbetler: [{ sohbet_id: "ana", eren: "hazir" }] as { sohbet_id: string; eren: string }[],
  kilitli: false,
  aktif_is: 0,
  ram_bos_mb: 4000,
  ram_toplam_mb: 16000,
  ram_dusuk: false,
  servis: ornekServis(),
  ...extra,
});
/** Telefon -> servis `chat_clear`. */
export const chatClear = (client_msg_id: string, sohbet_id = "ana") => ({
  v,
  type: "chat_clear",
  client_msg_id,
  sohbet_id,
});
/** Telefon -> servis `chat_create`. */
export const chatCreate = (client_msg_id: string, sohbet_id: string, ad = "Yeni sohbet") => ({
  v,
  type: "chat_create",
  client_msg_id,
  sohbet_id,
  ad,
});
/** Telefon -> servis `chat_rename`. */
export const chatRename = (client_msg_id: string, sohbet_id: string, ad: string) => ({
  v,
  type: "chat_rename",
  client_msg_id,
  sohbet_id,
  ad,
});
/** Telefon -> servis `chat_delete`. */
export const chatDelete = (client_msg_id: string, sohbet_id: string) => ({
  v,
  type: "chat_delete",
  client_msg_id,
  sohbet_id,
});
/** Mezar taşı olayı (`event` içinde ya da telafide kullanılır). */
export const mezarTasiOlayi = (seq: number, sinir_seq: number, sohbet_id?: string) => ({
  seq,
  ts_ms: 1000 + seq,
  type: "chat_cleared",
  ...(sohbet_id === undefined ? {} : { sohbet_id }),
  sinir_seq,
});
export const snapshot = (turn_id: string, text: string, sohbet_id = "ana") => ({
  v,
  type: "stream_snapshot",
  sohbet_id,
  turn_id,
  text,
});
export const olayCercevesi = (event: Record<string, unknown>) => ({ v, type: "event", event });

export const yankiOlayi = (seq: number, client_msg_id = `m${seq}`, text = "merhaba", sohbet_id?: string) => ({
  seq,
  ts_ms: 1000 + seq,
  type: "user_echo",
  ...(sohbet_id === undefined ? {} : { sohbet_id }),
  client_msg_id,
  input: "yazi",
  text,
});
export const asistanOlayi = (seq: number, turn_id: string, text: string, sohbet_id?: string) => ({
  seq,
  ts_ms: 1000 + seq,
  type: "assistant_message",
  ...(sohbet_id === undefined ? {} : { sohbet_id }),
  turn_id,
  text,
});

/** Yaşam döngüsü olayı: sohbet açıldı (`sohbet_id` zorunlu). */
export const sohbetAcildiOlayi = (seq: number, sohbet_id: string, ad = "Yeni sohbet") => ({
  seq,
  ts_ms: 1000 + seq,
  type: "chat_created",
  sohbet_id,
  ad,
});
/** Yaşam döngüsü olayı: sohbet adı değişti. */
export const adDegistiOlayi = (seq: number, sohbet_id: string, ad: string) => ({
  seq,
  ts_ms: 1000 + seq,
  type: "chat_renamed",
  sohbet_id,
  ad,
});
/** Yaşam döngüsü olayı: sohbet silindi. */
export const sohbetSilindiOlayi = (seq: number, sohbet_id: string) => ({
  seq,
  ts_ms: 1000 + seq,
  type: "chat_deleted",
  sohbet_id,
});

export const ornekPlan = (plan_id = "plan1") => ({
  plan_id,
  baslik: "Ornek is",
  tur: "pc",
  cwd: "C:\\ornek\\proje",
  gorev_metni: "Bir sey yap",
});

/** Bağlantıyı `welcome`'a kadar götürür. */
export const elSikis = async (b: SahteBaglanti, head_seq = 0): Promise<void> => {
  b.acildi();
  await bosalt();
  b.gel(challenge());
  await bosalt();
  b.gel(welcome(head_seq));
  await bosalt();
};
