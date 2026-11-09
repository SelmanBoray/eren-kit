/**
 * Sahte telefon: P-256 kimlik, `/sohbet` ve `/cihaz` WebSocket istemcileri, el sıkışma, eşleştirme.
 * Gelen her çerçeve protokol çözücüsünden geçer; geçmeyen çerçeve `gecersiz` diye kaydedilir.
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, verify } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { cihazAsagiCoz, kimlikImzaMetni, PROTOKOL_SURUMU, SOHBET_SURUMU, sohbetAsagiCoz } from "@eren/protocol";
import WebSocket from "ws";

export type Msg = Record<string, any>;

export interface Gelen {
  ts: number;
  m: Msg;
}

export interface TelefonKimligi {
  ozelPem: string;
  acik: string;
}

export const kimlikUret = (): TelefonKimligi => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return {
    ozelPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    acik: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
  };
};

const ozelAnahtar = (k: TelefonKimligi): KeyObject => createPrivateKey(k.ozelPem);

export const nonceUret = (): string => randomBytes(32).toString("base64");

let msgSayac = 0;
export const msgId = (on = "m"): string => `${on}-${Date.now().toString(36)}-${(msgSayac++).toString(36)}`;

/** Telefon tarafı sohbet kimliği: `OpakId` biçimi (`[A-Za-z0-9_-]`, 1-64). */
export const sohbetIdUret = (on = "s"): string => `${on}-${randomBytes(9).toString("base64url")}`;

/** `/sohbet` (`SOHBET_SURUMU`, v3+) yukarı mesajları; `sohbet_id` zorunlu, varsayılan `"ana"`. */
export const ustMesaj = {
  userMessage: (text: string, sohbet_id = "ana", client_msg_id = msgId("u")): Msg => ({
    v: SOHBET_SURUMU,
    type: "user_message",
    client_msg_id,
    sohbet_id,
    input: "yazi",
    text,
  }),
  interrupt: (sohbet_id = "ana", turn_id?: string, client_msg_id = msgId("i")): Msg => ({
    v: SOHBET_SURUMU,
    type: "interrupt",
    client_msg_id,
    sohbet_id,
    ...(turn_id === undefined ? {} : { turn_id }),
  }),
  chatClear: (sohbet_id = "ana", client_msg_id = msgId("c")): Msg => ({
    v: SOHBET_SURUMU,
    type: "chat_clear",
    client_msg_id,
    sohbet_id,
  }),
  chatCreate: (sohbet_id: string, ad = "Yeni sohbet", client_msg_id = msgId("cc")): Msg => ({
    v: SOHBET_SURUMU,
    type: "chat_create",
    client_msg_id,
    sohbet_id,
    ad,
  }),
};

/** `server_status.sohbetler[]` içinden bir sohbetin ana oturum durumu (`eren` alanı yok, v3+). */
export const sohbetErenDurumu = (m: Msg, sohbet_id = "ana"): string | undefined =>
  (m.sohbetler as Array<{ sohbet_id: string; eren: string }> | undefined)?.find((s) => s.sohbet_id === sohbet_id)?.eren;

export class Baglanti {
  readonly kanal: "sohbet" | "cihaz";
  readonly ws: WebSocket;
  readonly gelenler: Gelen[] = [];
  readonly gecersiz: string[] = [];
  kapandi = false;
  kapanisTs = 0;
  private bekleyenler: Array<() => void> = [];
  private dinleyiciler: Array<(m: Msg) => void> = [];

  private constructor(kanal: "sohbet" | "cihaz", ws: WebSocket) {
    this.kanal = kanal;
    this.ws = ws;
    ws.on("message", (veri) => {
      const ham = veri.toString();
      const coz = kanal === "sohbet" ? sohbetAsagiCoz(ham) : cihazAsagiCoz(ham);
      if (!coz.ok) {
        this.gecersiz.push(ham.slice(0, 300));
        return;
      }
      const m = coz.mesaj as Msg;
      this.gelenler.push({ ts: Date.now(), m });
      for (const f of [...this.dinleyiciler]) {
        try {
          f(m);
        } catch {
          // dinleyici hatası bağlantıyı bozmaz
        }
      }
      this.uyandir();
    });
    ws.on("close", () => {
      this.kapandi = true;
      this.kapanisTs = Date.now();
      this.uyandir();
    });
    ws.on("error", () => {});
  }

  static ac(url: string, kanal: "sohbet" | "cihaz", zamanMs = 10_000): Promise<Baglanti> {
    return new Promise((coz, reddet) => {
      const ws = new WebSocket(url, { perMessageDeflate: false });
      const b = new Baglanti(kanal, ws);
      const t = setTimeout(() => {
        ws.terminate();
        reddet(new Error(`baglanti_zaman_asimi ${kanal}`));
      }, zamanMs);
      ws.once("open", () => {
        clearTimeout(t);
        coz(b);
      });
      ws.once("error", (e) => {
        clearTimeout(t);
        reddet(e);
      });
    });
  }

  private uyandir(): void {
    for (const f of this.bekleyenler.splice(0)) f();
  }

  dinle(f: (m: Msg) => void): void {
    this.dinleyiciler.push(f);
  }

  gonder(m: Msg): void {
    this.ws.send(JSON.stringify(m));
  }

  kapat(): void {
    try {
      this.ws.close(1000, "bitti");
    } catch {
      this.ws.terminate();
    }
  }

  /** `bas` dizininden itibaren `kosul`u tutan ilk gelen. Zaman aşımında hata. */
  async bekle(kosul: (m: Msg) => boolean, zamanMs: number, aciklama: string, bas = 0): Promise<Gelen> {
    const son = Date.now() + zamanMs;
    for (;;) {
      for (let i = bas; i < this.gelenler.length; i++) {
        const g = this.gelenler[i]!;
        if (kosul(g.m)) return g;
      }
      if (this.kapandi) throw new Error(`baglanti_kapandi: ${aciklama}`);
      const kalan = son - Date.now();
      if (kalan <= 0) throw new Error(`zaman_asimi: ${aciklama}`);
      await new Promise<void>((coz) => {
        const t = setTimeout(coz, Math.min(kalan, 1000));
        this.bekleyenler.push(() => {
          clearTimeout(t);
          coz();
        });
      });
    }
  }

  /** Kapanmayı bekler; kapanmazsa `false`. */
  async kapanmaBekle(zamanMs: number): Promise<boolean> {
    const son = Date.now() + zamanMs;
    while (!this.kapandi && Date.now() < son) await new Promise((c) => setTimeout(c, 100));
    return this.kapandi;
  }
}

export interface ElSikmaSonucu {
  welcome: Msg;
  sunucuImzasiGecerli: boolean;
  sureMs: number;
}

/**
 * hello -> auth_challenge (sunucu imzası doğrulanır) -> auth_response -> welcome. `v` kanalın sürümüdür:
 * `/sohbet` `SOHBET_SURUMU`, `/cihaz` `PROTOKOL_SURUMU` (protocol README "Sürümleme").
 */
export async function elSik(
  b: Baglanti,
  g: { device_id: string; kimlik: TelefonKimligi; sunucuAcik: string; last_seq?: number },
): Promise<ElSikmaSonucu> {
  const bas = Date.now();
  const nonce = nonceUret();
  const v = b.kanal === "sohbet" ? SOHBET_SURUMU : PROTOKOL_SURUMU;
  const i0 = b.gelenler.length;
  b.gonder(
    b.kanal === "sohbet"
      ? { v, type: "hello", device_id: g.device_id, last_seq: g.last_seq ?? 0, client_nonce: nonce }
      : { v, type: "hello", device_id: g.device_id, client_nonce: nonce },
  );
  const ch = await b.bekle((m) => m.type === "auth_challenge" || m.type === "error", 10_000, "auth_challenge", i0);
  if (ch.m.type === "error") throw new Error(`el_sikisma_reddi ${ch.m.code}`);
  const pcMetni = kimlikImzaMetni({
    rol: "pc",
    kanal: b.kanal,
    device_id: g.device_id,
    client_nonce: nonce,
    server_nonce: ch.m.server_nonce,
  });
  const sunucuAnahtari = createPublicKey({ key: Buffer.from(g.sunucuAcik, "base64"), format: "der", type: "spki" });
  const sunucuImzasiGecerli = verify(
    "sha256",
    Buffer.from(pcMetni, "utf8"),
    sunucuAnahtari,
    Buffer.from(ch.m.server_signature, "base64"),
  );
  if (!sunucuImzasiGecerli) throw new Error("sunucu_imzasi_gecersiz");
  const telMetni = kimlikImzaMetni({
    rol: "telefon",
    kanal: b.kanal,
    device_id: g.device_id,
    client_nonce: nonce,
    server_nonce: ch.m.server_nonce,
  });
  const imza = sign("sha256", Buffer.from(telMetni, "utf8"), ozelAnahtar(g.kimlik)).toString("base64");
  const i1 = b.gelenler.length;
  b.gonder({ v, type: "auth_response", signature: imza });
  const w = await b.bekle((m) => m.type === "welcome" || m.type === "error", 10_000, "welcome", i1);
  if (w.m.type === "error") throw new Error(`kimlik_reddi ${w.m.code}`);
  return { welcome: w.m, sunucuImzasiGecerli, sureMs: Date.now() - bas };
}

/**
 * Açık `/sohbet` bağlantısında eşleşir; bağlantı açık kalır, hemen `elSik` ile sürdürülebilir.
 * Eşleştirme `/sohbet`'te de v1 kalır (`sohbetSurumu("pair_request")`): Kotlin `v == 1` denetler.
 */
export async function eslestir(
  b: Baglanti,
  kod: string,
  kimlik: TelefonKimligi,
): Promise<{ device_id: string; server_public_key: string }> {
  const i0 = b.gelenler.length;
  b.gonder({ v: PROTOKOL_SURUMU, type: "pair_request", kod, public_key: kimlik.acik, platform: "android", etiket: "e2e" });
  const r = await b.bekle((m) => m.type === "pair_result" || m.type === "error", 10_000, "pair_result", i0);
  if (r.m.type !== "pair_result" || r.m.ok !== true) throw new Error(`eslestirme_reddi ${r.m.code}`);
  return { device_id: r.m.device_id, server_public_key: r.m.server_public_key };
}
