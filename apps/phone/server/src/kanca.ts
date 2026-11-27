/**
 * PC'deki Claude Code oturumlarının kancası (`docs/AJANDA.md` "PC oturumları", MODULLER.md "PC
 * oturumları"): `node kanca.ts arac`, girdi stdin'de (Claude Code'un `PreToolUse` JSON'u; eşleyici
 * `mcp__eren-ajanda__.*`, yani yalnız ajanda araçlarından önce). Servise `pc_arac` tasdiki gider (normalize
 * çerçeve, uyarlayıcı `claude-code`: çağrı kimliği, aktör, etkileşim, istem kimliği, Claude Code süreç
 * kimliği `CLAUDE_PID`); stdout boştur (izin akışına karışmaz).
 * İstem ve tur sonu kancası yoktur (yalın yol): eski kurulumun `istem`/`tur_sonu` olayıyla çağrılırsa
 * stdin'i okumadan hiçbir şey yapmadan çıkar (`kanca-ekle` o girdileri temizler).
 *
 * Kurallar:
 * - Hafif: yalnız Node'un yerleşikleri, bağımlılıksız `veri-koku.ts` ve protokolün bağımlılıksız çekirdeği
 *   (`@eren/protocol/kanca`). MCP kitaplığı, zod ve protokolün geri kalanı YÜKLENMEZ (yüklenince her
 *   çağrıya ~0,3 sn ekleniyordu). `mimari.test.ts` bunu sınar.
 * - Hiç engellemez: her durumda 0 ile çıkar, stderr'e yazmaz; servis kapalıysa, anahtar yoksa, girdi
 *   bozuksa sessizce geçer (çağrı o zaman tasdiksizdir: taslak). Servisle bütün iş
 *   `AJANDA_PC_SINIRLARI.KANCA_SURESI_MS`'i aşamaz; süreç en geç bundan bir saniye sonra kendini kapatır.
 * - Servisin kendi oturumlarında (`PC_SERVIS_OTURUMU_ORTAMI`) hiçbir şey yapmaz.
 * Servise giden çerçeveyi servis `PcKancaYukari` şemasıyla denetler; kanca turu insan ilan edemez,
 * yalnız Claude Code'un verdiği alanları iletir (kararı servisin PC defteri verir).
 */
import { readFileSync } from "node:fs";
import { connect } from "node:net";
import {
  AJANDA_BORU_ADI,
  AJANDA_PC_SINIRLARI,
  CLAUDE_CODE_GIRIS_ORTAMI,
  CLAUDE_CODE_SUREC_ORTAMI,
  KANCA_AZAMI_SATIR,
  PC_KANCA_OLAYLARI,
  PC_SERVIS_OTURUMU_ORTAMI,
  kancaAsagiCoz,
  kancaHelloSatiri,
  kancaIstekSatiri,
  pcAracKancaGirdisi,
  pcJetonuMu,
  type PcKancaIstegi,
} from "@eren/protocol/kanca";
import type { BoruBaglantisi } from "./sozlesme.ts";
import { ajandaPcAnahtarYolu, veriKokuCoz } from "./veri-koku.ts";

export interface PcKancaBagimliliklari {
  baglan: (boruAdi: string) => Promise<BoruBaglantisi>;
  /** PC anahtarı (dosyadan); `null`: yok, servise hiç gidilmez. */
  jetonOku: () => string | null;
  /** `ms` sonra çözülür (zaman aşımı). */
  bekle: (ms: number) => Promise<void>;
  /** Servisin kendi başlattığı oturum mu (`PC_SERVIS_OTURUMU_ORTAMI`): öyleyse hiçbir şey yapılmaz. */
  servisOturumu: boolean;
  /** Kanca sürecinin `CLAUDE_CODE_ENTRYPOINT`'i (`cli`, `sdk-cli`, ...; yoksa `undefined`). */
  giris: string | undefined;
  /** Kanca sürecinin `CLAUDE_PID`'i (Claude Code sürecinin kimliği; T5 bağı). Yoksa çerçeveye girmez. */
  surec?: string | undefined;
}

/** Tek bağlantıdaki tek isteğin kimliği. */
const ISTEK_ID = "kanca_1";

/**
 * Kancanın gövdesi (`PreToolUse`): `hamGirdi` stdin (JSON). Hiç atmaz, stdout'a hiçbir şey yazılmaz.
 * Servis kapalıysa, anahtar yoksa ya da girdi geçersizse sessizce geçer. Servis tasdiki kabul edince
 * çözülür (köprünün çağrısı bundan sonra gelir: Claude Code aracı kanca bittikten sonra çalıştırır).
 */
export async function pcKancaCalistir(hamGirdi: string, b: PcKancaBagimliliklari): Promise<void> {
  if (b.servisOturumu) return;
  let ham: unknown = null;
  try {
    ham = JSON.parse(hamGirdi);
  } catch {
    ham = null;
  }
  const istek = pcAracKancaGirdisi(ham, b.giris, b.surec);
  if (istek === null) return;
  let jeton: string | null = null;
  try {
    jeton = b.jetonOku();
  } catch {
    jeton = null;
  }
  if (jeton !== null) await kancaIstegiYolla(istek, jeton, b).catch(() => null);
}

/**
 * Tek bağlantı, tek istek: el sıkışma `pc_kanca`, yanıtın `sonuc`'u (doğrulanmamış) ya da `null`. En çok
 * `KANCA_SURESI_MS`; süre dolunca bağlantı kapatılır, `null`.
 */
function kancaIstegiYolla(istek: PcKancaIstegi, jeton: string, b: PcKancaBagimliliklari): Promise<unknown> {
  return new Promise((coz) => {
    let bag: BoruBaglantisi | null = null;
    let bitti = false;
    const bitir = (deger: unknown): void => {
      if (bitti) return;
      bitti = true;
      bag?.kapat();
      coz(deger);
    };
    void b.bekle(AJANDA_PC_SINIRLARI.KANCA_SURESI_MS).then(() => bitir(null));
    b.baglan(AJANDA_BORU_ADI).then(
      (bg) => {
        bag = bg;
        if (bitti) {
          bg.kapat();
          return;
        }
        bg.kapanisDinle(() => bitir(null));
        bg.satirDinle((satir) => {
          const m = kancaAsagiCoz(satir, ISTEK_ID);
          if (m.tur === "karsilandi") bg.satirYaz(kancaIstekSatiri(ISTEK_ID, istek));
          else if (m.tur === "yanit") bitir(m.sonuc);
          else if (m.tur !== "ilgisiz") bitir(null);
        });
        bg.satirYaz(kancaHelloSatiri(jeton));
      },
      () => bitir(null),
    );
  });
}

/** PC anahtar dosyası (`eslestir --claude-code` yazar); yoksa, okunamazsa ya da biçimi geçersizse `null`. */
export function kancaAnahtariOku(ortam: Readonly<Record<string, string | undefined>>): string | null {
  const kok = veriKokuCoz(ortam);
  if (!kok.ok) return null;
  try {
    const j = readFileSync(ajandaPcAnahtarYolu(kok.kok), "utf8").trim();
    return pcJetonuMu(j) ? j : null;
  } catch {
    return null;
  }
}

/** Adlı boruya satır bağlantısı; `azami`'yi aşan satırda bağlantı kapanır. */
export function kancaBoruyaBaglan(ad: string, azami: number = KANCA_AZAMI_SATIR): Promise<BoruBaglantisi> {
  return new Promise((coz, reddet) => {
    const soket = connect(ad);
    soket.once("error", reddet);
    soket.once("connect", () => {
      soket.off("error", reddet);
      soket.on("error", () => {});
      soket.setEncoding("utf8");
      let tampon = "";
      coz({
        satirYaz: (s) => {
          if (!soket.destroyed) soket.write(`${s}\n`);
        },
        kapat: () => {
          soket.destroy();
        },
        satirDinle: (f) => {
          soket.on("data", (parca: string) => {
            tampon += parca;
            for (let i = tampon.indexOf("\n"); i !== -1 && !soket.destroyed; i = tampon.indexOf("\n")) {
              const satir = tampon.slice(0, i);
              tampon = tampon.slice(i + 1);
              f(satir);
            }
            if (tampon.length > azami) soket.destroy();
          });
        },
        kapanisDinle: (f) => {
          soket.once("close", () => f());
        },
      });
    });
  });
}

/** Stdin'in tamamı, en çok `azami` bayt; fazlası okunmaz (JSON'u bozulur, kanca sessiz geçer). */
async function stdinOku(azami: number): Promise<string> {
  const parcalar: Buffer[] = [];
  let bayt = 0;
  for await (const p of process.stdin) {
    const parca = Buffer.isBuffer(p) ? p : Buffer.from(String(p));
    parcalar.push(parca);
    bayt += parca.length;
    if (bayt > azami) break;
  }
  return Buffer.concat(parcalar).toString("utf8");
}

const KANCA_GIRDI_AZAMI = 16 * 1024 * 1024;

/** Süreç girişi: her durumda 0 ile ve en geç `KANCA_SURESI_MS + 1 sn` içinde çıkar. */
async function kancaGirisi(olayArgumani: string | undefined): Promise<void> {
  const cik = (): never => process.exit(0);
  setTimeout(cik, AJANDA_PC_SINIRLARI.KANCA_SURESI_MS + 1_000);
  const olay = PC_KANCA_OLAYLARI.find((o) => o === olayArgumani);
  try {
    if (olay !== undefined) {
      const servisOturumu = process.env[PC_SERVIS_OTURUMU_ORTAMI] === "1";
      const girdi = servisOturumu ? "" : await stdinOku(KANCA_GIRDI_AZAMI);
      await pcKancaCalistir(girdi, {
        baglan: (ad) => kancaBoruyaBaglan(ad),
        jetonOku: () => kancaAnahtariOku(process.env),
        bekle: (ms) => new Promise((r) => setTimeout(r, ms).unref()),
        servisOturumu,
        giris: process.env[CLAUDE_CODE_GIRIS_ORTAMI],
        surec: process.env[CLAUDE_CODE_SUREC_ORTAMI],
      });
    }
  } catch {
    // hiçbir durumda engellemez
  }
  cik();
}

if (import.meta.main) await kancaGirisi(process.argv[2]);
