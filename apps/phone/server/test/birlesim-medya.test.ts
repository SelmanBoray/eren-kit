/**
 * Medya birleşim testi (MODULLER.md "Medya dalgası" > S9). `servisKur` gerçek modülleri kurar (depo, medya
 * yöneticisi, gateway, sohbetler, konuşma, temizlik); modüller arasında sahte yoktur. Dış dünya sahtedir:
 * telefon sahte WebSocket'ten gerçek P-256 imzayla konuşur, `claude` sahte süreçtir. Medya işleyici ve dosya
 * portu iki kipte koşar: (1) sahte işleyici + bellek içi port (her makinede), (2) ffmpeg PATH'teyse gerçek
 * `medyaIsleyiciKur` + geçici veri kökünde gerçek `medyaDosyaKur` (girdiler lavfi ile üretilir; döküm modeli
 * bu testte verilmez, `medya-ffmpeg.test.ts` sınar). Giden her `/sohbet` çerçevesi kablo şemasından geçer.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign as imzaAt,
  timingSafeEqual,
  verify as imzaDogrula,
} from "node:crypto";
import type { KeyObject } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  AJANDA_ROL_FIILLERI,
  ANA_SOHBET_ID,
  ekOneki,
  kimlikImzaMetni,
  MEDYA_SINIRLARI,
  PROTOKOL_SURUMU,
  ROL_FIILLERI,
  SOHBET_SURUMU,
  SOHBET_YETENEKLERI,
  sohbetAsagiCoz,
} from "@eren/protocol";
import { servisKur } from "../src/ana.ts";
import type { Servis, ServisGirdisi } from "../src/ana.ts";
import { ayarKur } from "../src/ayar.ts";
import { medyaDosyaKur } from "../src/dis-dunya.ts";
import { eslestirmeBaslat } from "../src/eslestir.ts";
import { medyaIsleyiciKur } from "../src/medya-isle.ts";
import type { AnahtarPortu, AracIstegi, AracSonucu, Ayar, MedyaAyari } from "../src/sozlesme.ts";
import { sahteDunya, sahteMedyaBaytlari, sahteMedyaDosya, sahteMedyaIsleyici } from "./sahte.ts";
import type { SahteBoruluSurec, SahteDunya, SahteMedyaIsleyici, SahteWsBaglantisi } from "./sahte.ts";

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const T0 = Date.UTC(2026, 10, 27, 9, 0, 0);
const DILIM = "Europe/Istanbul";
const YEREL = "C:\\ornek\\Yerel";
const KULLANICI = "C:\\ornek\\Kullanici";
const NODE_EXE = "C:\\ornek\\node.exe";
const BIN = "C:\\ornek\\bin";
const CLAUDE_EXE = `${BIN}\\claude.exe`;
const VERI_KOKU = `${YEREL}\\eren-kit`;
const YEREL_AYAR = `${VERI_KOKU}\\ayar.local.json`;
const TELEFON_IP = "100.64.0.20";
const MODEL = "claude-ornek";
const MEDYA1 = SOHBET_YETENEKLERI.MEDYA;
/** Kullanıcının metni: hiçbir günlük satırında görünmemeli (M0.4). */
const METIN = "bu fotoğraftaki ve videodaki şey ne? ☕️";

const bosalt = async (): Promise<void> => {
  for (let i = 0; i < 30; i++) await new Promise<void>((r) => setImmediate(r));
};

/** Gerçek araç ve gerçek dosya G/Ç'si `setImmediate` turlarıyla bitmez: koşul tutana dek gerçek zamanla yokla. */
const bekleKosul = async (f: () => boolean, aciklama: string, ms = 60_000): Promise<void> => {
  const son = Date.now() + ms;
  while (!f()) {
    if (Date.now() > son) assert.fail(`zaman aşımı: ${aciklama}`);
    await bosalt();
    await new Promise<void>((r) => setTimeout(r, 10));
  }
};

// ---------------------------------------------------------------------------------------------
// Gerçek P-256
// ---------------------------------------------------------------------------------------------

const imzala = (anahtar: KeyObject, metin: string): string =>
  imzaAt("sha256", Buffer.from(metin, "utf8"), anahtar).toString("base64");

function gercekAnahtar(): AnahtarPortu {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const acik = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  return {
    acikAnahtar: () => acik,
    imzala: (metin) => imzala(privateKey, metin),
    dogrula: (a, metin, imza) => {
      try {
        const k = createPublicKey({ key: Buffer.from(a, "base64"), format: "der", type: "spki" });
        return imzaDogrula("sha256", Buffer.from(metin, "utf8"), k, Buffer.from(imza, "base64"));
      } catch {
        return false;
      }
    },
    sabitZamanEsit: (a, b) => {
      const x = Buffer.from(a, "utf8");
      const y = Buffer.from(b, "utf8");
      return x.length === y.length && timingSafeEqual(x, y);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// `/sohbet` ucu: giden her çerçeve kablo şemasından geçer
// ---------------------------------------------------------------------------------------------

interface Uc {
  c: SahteWsBaglantisi;
  kareler(): J[];
  tur(t: string): J[];
  gonder(m: J): Promise<void>;
  /** Bu bağlantıya gelen `user_echo` olayları. */
  yankilar(): J[];
  /** Bu `medya_id`'nin son `media_state`'i. */
  durum(medya_id: string): J | undefined;
}

function ucSar(c: SahteWsBaglantisi): Uc {
  const kareler = (): J[] =>
    c.gonderilenler.map((m) => {
      const r = sohbetAsagiCoz(m);
      assert.ok(r.ok, `giden çerçeve şemaya uymuyor: ${m.slice(0, 300)}`);
      return r.mesaj as J;
    });
  const tur = (t: string): J[] => kareler().filter((k) => k["type"] === t);
  return {
    c,
    kareler,
    tur,
    gonder: async (m) => {
      c.mesajGonder(JSON.stringify(m));
      await bosalt();
    },
    yankilar: () =>
      tur("event")
        .map((k) => k["event"] as J)
        .filter((e) => e["type"] === "user_echo"),
    durum: (medya_id) => tur("media_state").filter((k) => k["medya_id"] === medya_id).at(-1),
  };
}

// ---------------------------------------------------------------------------------------------
// `claude` satırları (birlesim-ajanda ile aynı biçim)
// ---------------------------------------------------------------------------------------------

const argDegeri = (s: SahteBoruluSurec, bayrak: string): string => {
  const a = s.istek.argv;
  const i = a.indexOf(bayrak);
  assert.ok(i >= 0, `argv'de ${bayrak} yok`);
  return a[i + 1]!;
};

const oturumKimligi = (s: SahteBoruluSurec): string => {
  const a = s.istek.argv;
  const i = Math.max(a.indexOf("--session-id"), a.indexOf("--resume"));
  return a[i + 1]!;
};

const initSatiri = (s: SahteBoruluSurec): string =>
  JSON.stringify({
    type: "system",
    subtype: "init",
    session_id: oturumKimligi(s),
    tools: [
      ...ROL_FIILLERI.eren.map((f) => `mcp__eren__${f}`),
      ...AJANDA_ROL_FIILLERI.ana_oturum.map((f) => `mcp__eren-ajanda__${f}`),
    ],
    mcp_servers: [
      { name: "eren", status: "connected" },
      { name: "eren-ajanda", status: "connected" },
    ],
    apiKeySource: "none",
    model: MODEL,
  });

// ---------------------------------------------------------------------------------------------
// Gerçek ffmpeg (yoksa o kip atlanır)
// ---------------------------------------------------------------------------------------------

const nerede = (ad: string): string | null => {
  if (process.platform !== "win32") return null;
  const r = spawnSync("where.exe", [ad], { encoding: "utf8", windowsHide: true });
  const ilk = r.status === 0 ? r.stdout.split(/\r?\n/)[0]?.trim() : undefined;
  return ilk !== undefined && ilk !== "" ? ilk : null;
};
const FFMPEG = nerede("ffmpeg");
const FFPROBE = nerede("ffprobe");
const ARAC_YOK = FFMPEG === null || FFPROBE === null ? "ffmpeg/ffprobe PATH'te yok" : false;

/** `dis-dunya.ts` `aracCalistir`'ın anlamı: stdin kapalı, pencere yok, zaman aşımında öldür, çıkış kodu yok. */
const aracCalistir = (i: AracIstegi): Promise<AracSonucu> =>
  new Promise((coz, reddet) => {
    const c = spawn(i.exe, [...i.argv], { cwd: i.cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let zamanAsimi = false;
    c.stdout.setEncoding("utf8").on("data", (p: string) => (stdout += p));
    c.stderr.setEncoding("utf8").on("data", (p: string) => (stderr += p));
    const sayac = setTimeout(() => {
      zamanAsimi = true;
      c.kill();
    }, i.zamanAsimiMs);
    c.once("error", (e) => {
      clearTimeout(sayac);
      reddet(e);
    });
    c.once("close", () => {
      clearTimeout(sayac);
      coz({ zamanAsimi, stdout, stderr });
    });
  });

const ffmpegUret = (argv: readonly string[]): void => {
  const r = spawnSync(FFMPEG as string, ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", ...argv], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(r.status, 0, `girdi üretilemedi: ${r.stderr}`);
};

// ---------------------------------------------------------------------------------------------
// Ortam
// ---------------------------------------------------------------------------------------------

const temizlikler: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const f of temizlikler.splice(0).reverse()) {
    try {
      await f();
    } catch {
      // Temizlik testin kendi sonucunu örtmesin.
    }
  }
});

type MedyaKipi =
  /** `ayarKur` gerçek; araçlar ve modeller sahte dosyada var. Port bellek içi, işleyici sahte. */
  | { tur: "sahte"; isleyici?: (i: SahteMedyaIsleyici) => void }
  /** Araç yok: `ayar.medya` `null`. */
  | { tur: "kapali" }
  /** Gerçek port (geçici kökte) ve gerçek işleyici (gerçek ffmpeg). */
  | { tur: "gercek" };

let msgNo = 0;
let medyaNo = 0;

async function ortamKur(kip: MedyaKipi) {
  const d: SahteDunya = sahteDunya({ baslangicMs: T0, servisPid: 4000 });
  const anahtar = gercekAnahtar();
  const gecici = mkdtempSync(join(tmpdir(), "eren-medya-birlesim-"));
  temizlikler.push(() => rmSync(gecici, { recursive: true, force: true }));

  d.dosya.yaz(CLAUDE_EXE, "");
  d.dosya.yaz(YEREL_AYAR, JSON.stringify({ kullanici_adi: "Deneme", claude_exe: CLAUDE_EXE, tam_yetki: false }));
  if (kip.tur !== "kapali") {
    // `ayarKur` PATH'te arar: medya açık, varsayılan döküm modeli "var"; Silero dosyası da var ama
    // varsayılanı yok (ayar.ts'teki ölçüm notu), anahtarsız kullanılmaz.
    d.dosya.yaz(`${BIN}\\ffmpeg.exe`, "");
    d.dosya.yaz(`${BIN}\\ffprobe.exe`, "");
    d.dosya.yaz(`${VERI_KOKU}\\modeller\\ggml-large-v3-turbo-q5_0.bin`, "");
    d.dosya.yaz(`${VERI_KOKU}\\modeller\\ggml-silero-v5.1.2.bin`, "");
  }
  const kurulan: Ayar = await ayarKur({
    dosya: d.dosya,
    ortam: { LOCALAPPDATA: YEREL, USERPROFILE: KULLANICI, PATH: BIN },
    execPath: NODE_EXE,
    baslangicMs: T0 - 5_000,
  });

  let ayar: Ayar = kurulan;
  let medya: ServisGirdisi["medya"];
  let sahteIsleyici: SahteMedyaIsleyici | null = null;
  let medyaKoku: string;
  if (kip.tur === "kapali") {
    assert.equal(kurulan.medya, null);
    medyaKoku = `${VERI_KOKU}\\medya`;
  } else if (kip.tur === "sahte") {
    assert.ok(kurulan.medya, "ayarKur medyayı açmalıydı");
    assert.equal(kurulan.medya.dokumModeli, "modeller/ggml-large-v3-turbo-q5_0.bin");
    assert.equal(kurulan.medya.dokumVadModeli, null, "VAD varsayılanı yok");
    medyaKoku = kurulan.medya.kok;
    const dosya = sahteMedyaDosya(medyaKoku);
    sahteIsleyici = sahteMedyaIsleyici(dosya);
    kip.isleyici?.(sahteIsleyici);
    medya = { dosya, isleyici: sahteIsleyici };
  } else {
    assert.ok(kurulan.medya);
    medyaKoku = join(gecici, "medya");
    const medyaAyari: MedyaAyari = {
      ...kurulan.medya,
      kok: medyaKoku,
      ffmpeg: FFMPEG as string,
      ffprobe: FFPROBE as string,
      dokumModeli: null,
      dokumVadModeli: null,
    };
    ayar = { ...kurulan, medya: medyaAyari };
    const dosya = medyaDosyaKur({ kok: medyaKoku });
    medya = { dosya, isleyici: medyaIsleyiciKur({ surec: { aracCalistir }, ayar: medyaAyari, veriKoku: gecici, dosya }) };
  }

  const dunya = { ...d.dunya, anahtar };
  const servis = servisKur({
    dunya,
    ayar,
    depoYolu: join(gecici, "eren.db"),
    ajanda: { sistemDilimi: () => DILIM },
    ...(medya !== undefined && { medya }),
  });
  temizlikler.push(() => servis.kapat());

  const o = {
    d,
    ayar,
    servis: servis as Servis,
    medyaKoku,
    sahteIsleyici,
    baslat: async (): Promise<void> => {
      await servis.baslat();
      await bosalt();
    },
    ilerlet: async (ms: number): Promise<void> => {
      let kalan = ms;
      while (kalan > 0) {
        const a = Math.min(1000, kalan);
        d.zaman.ilerlet(a);
        kalan -= a;
        await bosalt();
      }
    },
    /** Ana sohbetin ana oturum süreci (en son başlatılan). */
    eren: (): SahteBoruluSurec => {
      const yol = ayar.erenMcpYolu(servis.sohbetler.nesil({ sohbet_id: ANA_SOHBET_ID }));
      const s = d.surec.borulular().filter((x) => argDegeri(x, "--mcp-config") === yol).at(-1);
      assert.ok(s, "ana oturum süreci yok");
      return s;
    },
    kullaniciSatirlari: (s: SahteBoruluSurec): J[] =>
      s.yazilanlar.map((x) => JSON.parse(x) as J).filter((l) => l["type"] === "user"),
    gunlukSatirlari: (): J[] => d.kayit.satirlar.map((s) => JSON.parse(s) as J),

    /** Yeni eşleşmiş sohbet cihazı; `baglan` her çağrıda yeni `/sohbet` bağlantısı açar. */
    cihaz: async (): Promise<{ device_id: string; baglan(yetenekler?: string[], last_seq?: number): Promise<Uc> }> => {
      const { privateKey: ozel, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
      const acik = publicKey.export({ type: "spki", format: "der" }).toString("base64");
      const b = eslestirmeBaslat({ depo: servis.depo, anahtar, sistem: d.sistem, rastgele: d.rastgele, saat: d.saat, wsPort: ayar.wsPort });
      assert.ok(b.ok);
      const e = ucSar(d.ws.baglan("/sohbet", TELEFON_IP));
      await e.gonder({ v: PROTOKOL_SURUMU, type: "pair_request", kod: b.deger.kod, public_key: acik, platform: "android", etiket: "medya" });
      const pr = e.tur("pair_result")[0];
      assert.ok(pr?.["ok"], JSON.stringify(pr));
      e.c.istemciKopar();
      const device_id = pr["device_id"] as string;
      return {
        device_id,
        baglan: async (yetenekler = [], last_seq = 0) => {
          const u = ucSar(d.ws.baglan("/sohbet", TELEFON_IP, yetenekler));
          const client_nonce = randomBytes(32).toString("base64");
          await u.gonder({ v: SOHBET_SURUMU, type: "hello", device_id, client_nonce, last_seq });
          const ch = u.tur("auth_challenge")[0];
          assert.ok(ch, "auth_challenge yok");
          const imza = imzala(
            ozel,
            kimlikImzaMetni({ rol: "telefon", kanal: "sohbet", device_id, client_nonce, server_nonce: ch["server_nonce"] as string }),
          );
          await u.gonder({ v: SOHBET_SURUMU, type: "auth_response", signature: imza });
          assert.equal(u.tur("welcome").length, 1, "welcome yok");
          return u;
        },
      };
    },

    /**
     * `media_begin` + sıralı `media_chunk`'lar (`parca` baytlık), her parçanın `media_state`'i beklenir.
     * Son durumu (`kabul` beklenir) döner.
     */
    yukle: async (u: Uc, ek: { tur: "foto" | "video"; mime: string; bayt: Uint8Array; sure_ms?: number }, parca: number): Promise<{ ek: J; durum: J }> => {
      const medya_id = `m-1-${++medyaNo}`;
      const bilgi: J = { medya_id, tur: ek.tur, mime: ek.mime, boyut: ek.bayt.length, ...(ek.sure_ms !== undefined && { sure_ms: ek.sure_ms }) };
      await u.gonder({ v: SOHBET_SURUMU, type: "media_begin", sohbet_id: ANA_SOHBET_ID, ...bilgi });
      await bekleKosul(() => u.durum(medya_id) !== undefined, "media_begin yanıtı");
      assert.deepEqual(u.durum(medya_id), { v: SOHBET_SURUMU, type: "media_state", medya_id, durum: "yukleniyor", alinan: 0 });
      let parcaSayisi = 0;
      for (let ofset = 0; ofset < ek.bayt.length; ofset += parca) {
        const dilim = ek.bayt.subarray(ofset, Math.min(ofset + parca, ek.bayt.length));
        const once = u.tur("media_state").filter((k) => k["medya_id"] === medya_id).length;
        await u.gonder({ v: SOHBET_SURUMU, type: "media_chunk", medya_id, ofset, veri: Buffer.from(dilim).toString("base64") });
        await bekleKosul(() => u.tur("media_state").filter((k) => k["medya_id"] === medya_id).length > once, `parça ${ofset}`);
        parcaSayisi++;
        const son = ofset + dilim.length;
        if (son < ek.bayt.length) assert.deepEqual(u.durum(medya_id)?.["alinan"], son, "alinan parçayla ilerlemeli");
      }
      assert.ok(parcaSayisi >= 2, "yükleme parçalı olmalı");
      await bekleKosul(() => u.durum(medya_id)?.["durum"] !== "yukleniyor", "doğrulama");
      const durum = u.durum(medya_id)!;
      assert.equal(durum["durum"], "kabul", JSON.stringify(durum));
      return { ek: bilgi, durum };
    },

    mesaj: async (u: Uc, text: string, ekler?: J[]): Promise<J> => {
      const client_msg_id = `msg_${++msgNo}`;
      await u.gonder({
        v: SOHBET_SURUMU,
        type: "user_message",
        sohbet_id: ANA_SOHBET_ID,
        input: "yazi",
        text,
        client_msg_id,
        ...(ekler !== undefined && { ekler }),
      });
      const ack = u.tur("ack").find((k) => k["client_msg_id"] === client_msg_id);
      assert.ok(ack, "ack gelmedi");
      return ack;
    },
  };
  return o;
}

type Ortam = Awaited<ReturnType<typeof ortamKur>>;

/** Servis ayakta, ana oturum hazır, medya1 isteyen yeni telefon ve medya1'siz eski telefon bağlı. */
async function hazirla(o: Ortam) {
  await o.baslat();
  const eren = o.eren();
  eren.stdoutSatiriGonder(initSatiri(eren));
  await bosalt();
  const yeniCihaz = await o.cihaz();
  const yeni = await yeniCihaz.baglan([MEDYA1]);
  const eskiCihaz = await o.cihaz();
  const eski = await eskiCihaz.baglan([]);
  return { eren, yeni, eski, eskiCihaz };
}

/**
 * Ortak senaryo: foto + video parçalı yüklenir, ekli mesaj gider, ana oturuma TEK insan satırı yazılır.
 * Eski istemci aynı mesajı önekli metinle görür (canlı ve telafide).
 */
async function senaryo(o: Ortam, girdi: { foto: Uint8Array; video: Uint8Array; sure_ms: number; parca: number }) {
  const { eren, yeni, eski, eskiCihaz } = await hazirla(o);
  assert.deepEqual(yeni.tur("welcome")[0]!["yetenekler"], [MEDYA1]);
  assert.equal(eski.tur("welcome")[0]!["yetenekler"], undefined, "medya1 istemeyenin welcome'ı değişmemeli");

  const foto = await o.yukle(yeni, { tur: "foto", mime: "image/jpeg", bayt: girdi.foto }, girdi.parca);
  const video = await o.yukle(yeni, { tur: "video", mime: "video/mp4", bayt: girdi.video, sure_ms: girdi.sure_ms }, girdi.parca);
  assert.equal(eski.tur("media_state").length, 0, "media_state eski istemciye gitmemeli");

  const onceki = o.kullaniciSatirlari(eren).length;
  const ekler = [foto.ek, video.ek];
  const ack = await o.mesaj(yeni, METIN, ekler);
  assert.equal(ack["ok"], true, JSON.stringify(ack));

  // İşleme ve önbelleğe okuma bitince kuyruk başı tur açar: tek yeni insan satırı.
  await bekleKosul(() => o.kullaniciSatirlari(eren).length > onceki, "ana oturuma insan satırı");
  await o.servis.medya?.bekle();
  await bosalt();
  const yeniSatirlar = o.kullaniciSatirlari(eren).slice(onceki);
  assert.equal(yeniSatirlar.length, 1, "ek içeriği ayrı insan mesajı olmamalı");
  const satir = yeniSatirlar[0]!;
  assert.deepEqual(satir["origin"], { kind: "human" });
  assert.equal(o.kullaniciSatirlari(eren).filter((l) => l["origin"]?.["kind"] === "human").length, onceki + 1);

  const icerik = satir["message"]["content"] as J[];
  assert.ok(Array.isArray(icerik), "ekli satırda content dizi olmalı");
  assert.equal(icerik[0]!["type"], "text");
  assert.match(icerik[0]!["text"] as string, /^\[mesaj_ani: /, "damga ilk metin bloğunun başında");
  const son = icerik.at(-1)!;
  assert.equal(son["type"], "text");
  assert.ok((son["text"] as string).includes(METIN), "kullanıcının metni en sonda");
  const gorseller = icerik.filter((b) => b["type"] === "image");
  const kareSayisi = 3;
  assert.equal(gorseller.length, 1 + kareSayisi, "foto görseli + video kareleri");
  for (const g of gorseller) {
    assert.equal(g["source"]["type"], "base64");
    assert.equal(g["source"]["media_type"], "image/jpeg");
    const b = Buffer.from(g["source"]["data"] as string, "base64");
    assert.deepEqual([...b.subarray(0, 3)], [0xff, 0xd8, 0xff], "görsel JPEG olmalı");
  }
  const metinler = icerik.filter((b) => b["type"] === "text").map((b) => b["text"] as string);
  const yolda = (t: string, ad: string): boolean => t.includes(`"${o.medyaKoku}\\`) && t.includes(`\\${ad}"`);
  assert.ok(metinler.some((t) => t.startsWith("Fotoğraf 1 ") && yolda(t, "asil.jpg")), `fotoğraf bloğu PC yolunu taşır: ${JSON.stringify(metinler)}`);
  assert.ok(metinler.some((t) => t.startsWith("Video 1 ") && yolda(t, "asil.mp4") && t.includes("3 kare")), "video bloğu PC yolunu taşır");
  assert.equal(metinler.filter((t) => /^Kare \d\/3 · /.test(t)).length, kareSayisi);

  // Yeni istemcinin yankısı ekli ve öneksiz; eski istemcininki öneksiz değil, eksiz (canlı).
  const yeniYanki = yeni.yankilar().at(-1)!;
  assert.equal(yeniYanki["text"], METIN);
  assert.deepEqual(yeniYanki["ekler"], ekler);
  const beklenenEski = `${ekOneki(ekler as Array<{ tur: "foto" | "video" }>)} ${METIN}`;
  assert.equal(beklenenEski.startsWith("[1 fotoğraf, 1 video] "), true);
  const eskiYanki = eski.yankilar().at(-1)!;
  assert.equal(eskiYanki["text"], beklenenEski);
  assert.equal(eskiYanki["ekler"], undefined);
  // Telafide de (yeniden bağlanan eski istemci, `last_seq` 0).
  eski.c.istemciKopar();
  await bosalt();
  const eskiTekrar = await eskiCihaz.baglan([], 0);
  const telafi = eskiTekrar.yankilar().at(-1)!;
  assert.equal(telafi["text"], beklenenEski);
  assert.equal(telafi["ekler"], undefined);

  // Günlüğe kullanıcı metni ve medya yolu girmez (M0.4); medya açıldı.
  const gunluk = o.d.kayit.satirlar.join("\n");
  assert.ok(!gunluk.includes(METIN.slice(0, 12)), "kullanıcı metni günlüğe girdi");
  assert.ok(!gunluk.includes(o.medyaKoku), "medya yolu günlüğe girdi");
  assert.ok(o.gunlukSatirlari().some((s) => s["modul"] === "ana" && s["olay"] === "medya_acik"));
  return { eren, icerik, metinler };
}

// ---------------------------------------------------------------------------------------------
// Senaryolar
// ---------------------------------------------------------------------------------------------

describe("birleşim: medya (sahte işleyici)", () => {
  it("medya1: foto + video parçalı yükleme -> ekli user_message -> tek origin:human satırı ve görsel bloklar; eski istemci önekli user_echo (canlı ve telafi)", async () => {
    const o = await ortamKur({ tur: "sahte" });
    const { metinler } = await senaryo(o, {
      foto: sahteMedyaBaytlari("jpg", MEDYA_SINIRLARI.PARCA_BAYT + 1000),
      video: sahteMedyaBaytlari("mp4", 300_000),
      sure_ms: 20_000,
      parca: 128 * 1024,
    });
    // Sahte işleyicinin SRT'si: döküm içerikte (çitli); günlükte model var, VAD yok.
    assert.ok(metinler.some((t) => t.includes("merhaba")), "ses dökümü içerikte olmalı");
    const isleyici = o.sahteIsleyici!;
    assert.equal(isleyici.cagrilar.say("dokumUret"), 1);
    assert.equal(isleyici.cagrilar.say("kareUret"), 3);
    const acik = o.gunlukSatirlari().find((s) => s["olay"] === "medya_acik")!;
    assert.equal(acik["dokum_modeli"], true);
    assert.equal(acik["dokum_vad"], false);
  });

  it("kapanış: süren medya işi servisin kapanışını en çok sınır kadar tutar, depo yine kapanır", async () => {
    let birak: () => void = () => {};
    const o = await ortamKur({
      tur: "sahte",
      isleyici: (i) => {
        // Fotoğrafın doğrulaması (`gorselUret`) hiç bitmez: kapanışta süren araç.
        i.bekletme = new Promise<void>((r) => (birak = r));
      },
    });
    const { yeni } = await hazirla(o);
    const bayt = sahteMedyaBaytlari("jpg", 4096);
    await yeni.gonder({ v: SOHBET_SURUMU, type: "media_begin", sohbet_id: ANA_SOHBET_ID, medya_id: "m-kapanis", tur: "foto", mime: "image/jpeg", boyut: bayt.length });
    await yeni.gonder({ v: SOHBET_SURUMU, type: "media_chunk", medya_id: "m-kapanis", ofset: 0, veri: Buffer.from(bayt).toString("base64") });
    assert.equal(yeni.durum("m-kapanis")?.["durum"], "yukleniyor", "doğrulama sürmeli");

    let bitti = false;
    const kapanis = o.servis.kapat().then(() => (bitti = true));
    await bosalt();
    assert.equal(bitti, false, "kapanış medyayı beklemeli");
    await o.ilerlet(9_000);
    assert.equal(bitti, false, "sınırdan önce bitmemeli");
    await o.ilerlet(2_000);
    await kapanis;
    assert.equal(bitti, true);
    assert.ok(o.gunlukSatirlari().some((s) => s["modul"] === "ana" && s["olay"] === "medya_kapanis_siniri" && s["sinir_ms"] === 10_000));
    assert.ok(!o.gunlukSatirlari().some((s) => s["olay"] === "kapanis_hatasi"), "kapanış adımı düşmemeli");
    birak();
  });
});

describe("birleşim: medya kapalı", () => {
  it("ffmpeg yok: günlükte medya_kapali nedeni, medya1 isteyene yetenekler [], ekli mesaj gecersiz_mesaj, media_begin yetkisiz", async () => {
    const o = await ortamKur({ tur: "kapali" });
    await o.baslat();
    assert.equal(o.servis.medya, null);
    const kapali = o.gunlukSatirlari().find((s) => s["modul"] === "ana" && s["olay"] === "medya_kapali");
    assert.ok(kapali, "medya_kapali günlükte yok");
    assert.match(kapali["neden"] as string, /^ffmpeg ve ffprobe bulunamadı/);
    assert.ok(!o.gunlukSatirlari().some((s) => s["olay"] === "medya_acik"));

    const eren = o.eren();
    eren.stdoutSatiriGonder(initSatiri(eren));
    await bosalt();
    const cihaz = await o.cihaz();
    const u = await cihaz.baglan([MEDYA1]);
    assert.deepEqual(u.tur("welcome")[0]!["yetenekler"], []);
    const ack = await o.mesaj(u, "ekli", [{ medya_id: "m-yok", tur: "foto", mime: "image/jpeg", boyut: 10 }]);
    assert.deepEqual([ack["ok"], ack["code"]], [false, "gecersiz_mesaj"]);
    await u.gonder({ v: SOHBET_SURUMU, type: "media_begin", sohbet_id: ANA_SOHBET_ID, medya_id: "m-yok", tur: "foto", mime: "image/jpeg", boyut: 10 });
    const hata = u.tur("error").at(-1);
    assert.equal(hata?.["code"], "yetkisiz");
  });
});

describe("birleşim: medya (gerçek ffmpeg)", { skip: ARAC_YOK }, () => {
  it("gerçek port ve işleyici: lavfi foto + 3 sn video -> kabul, diskte görsel ve kareler, modele JPEG bloklar", async () => {
    const o = await ortamKur({ tur: "gercek" });
    const girdi = mkdtempSync(join(tmpdir(), "eren-medya-girdi-"));
    temizlikler.push(() => rmSync(girdi, { recursive: true, force: true }));
    const fotoYolu = join(girdi, "foto.jpg");
    const videoYolu = join(girdi, "video.mp4");
    ffmpegUret(["-f", "lavfi", "-i", "testsrc=size=1600x1200:rate=1", "-frames:v", "1", "-q:v", "2", fotoYolu]);
    ffmpegUret([
      "-f", "lavfi", "-i", "testsrc=duration=3:size=640x360:rate=15",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", videoYolu,
    ]);
    const foto = new Uint8Array(readFileSync(fotoYolu));
    const video = new Uint8Array(readFileSync(videoYolu));
    const parca = 32 * 1024;
    assert.ok(foto.length > parca && video.length > parca, "girdiler birden çok parça olmalı");

    const { metinler } = await senaryo(o, { foto, video, sure_ms: 3000, parca });
    assert.ok(metinler.some((t) => t.startsWith("Ses dökümü yok")), "model verilmedi: döküm yok notu");
    // Diskte: kabul edilen eklerin dizinleri, görsel ve kareler; yarım yükleme kalmadı.
    const dizinler = ["1", "2"].map((n) => join(o.medyaKoku, n));
    assert.ok(statSync(join(dizinler[0]!, "gorsel.jpg")).size > 0);
    assert.ok(existsSync(join(dizinler[0]!, "asil.jpg")));
    assert.ok(existsSync(join(dizinler[1]!, "asil.mp4")));
    for (const k of ["kare-01.jpg", "kare-02.jpg", "kare-03.jpg"]) assert.ok(statSync(join(dizinler[1]!, k)).size > 0, k);
    const gelen = join(o.medyaKoku, "gelen");
    assert.deepEqual(existsSync(gelen) ? readdirSync(gelen) : [], [], "yarım yükleme kalmamalı");
  });
});
