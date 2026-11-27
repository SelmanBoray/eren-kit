/**
 * PC'deki Claude Code oturumlarının kancası (`docs/AJANDA.md` "PC oturumları", MODULLER.md "PC
 * oturumları"): `node kanca.ts istem|arac|tur_sonu`, girdi stdin'de (Claude Code'un kanca JSON'u).
 * - `istem` (UserPromptSubmit): servise `pc_istem` (kaynak, istem kimliği; metin yalnız kullanıcının
 *   yazdığı istemde); stdout'a mesaj anı damgası (servis yanıt vermezse kancanın kendi saatinden).
 *   Claude Code bunu mesaja bağlam olarak ekler: PC oturumundaki asistan tarihi ve saati buradan bilir.
 * - `arac` (PreToolUse, yalnız ajanda araçları): `pc_arac` tasdiki; stdout boş (izin akışına karışmaz).
 * - `tur_sonu` (Stop): `pc_tur_sonu`; stdout boş.
 *
 * Bu süreç kullanıcının makinesindeki BÜTÜN Claude Code oturumlarında her mesajda ve her tur sonunda
 * çalışır. Kurallar:
 * - Hafif: yalnız Node'un yerleşikleri, bağımlılıksız `veri-koku.ts` ve protokolün bağımlılıksız çekirdeği
 *   (`@eren/protocol/kanca`). MCP kitaplığı, zod ve protokolün geri kalanı YÜKLENMEZ (yüklenince her
 *   mesaja ~0,3 sn ekleniyordu). `mimari.test.ts` bunu sınar.
 * - Hiç engellemez: her durumda 0 ile çıkar, stderr'e yazmaz; servis kapalıysa, anahtar yoksa, girdi
 *   bozuksa sessizce geçer. Servisle bütün iş `AJANDA_PC_SINIRLARI.KANCA_SURESI_MS`'i aşamaz; süreç en geç
 *   bundan bir saniye sonra kendini kapatır.
 * - Servisin kendi oturumlarında (`PC_SERVIS_OTURUMU_ORTAMI`) hiçbir şey yapmaz.
 * Servise giden çerçeveleri servis `PcKancaYukari` şemasıyla denetler; kanca turu insan ilan edemez,
 * yalnız Claude Code'un verdiği alanları iletir (kararı servisin PC defteri verir).
 */
import { readFileSync } from "node:fs";
import { connect } from "node:net";
import {
  AJANDA_BORU_ADI,
  AJANDA_PC_SINIRLARI,
  KANCA_AZAMI_SATIR,
  PC_KANCA_OLAYLARI,
  PC_SERVIS_OTURUMU_ORTAMI,
  kancaAsagiCoz,
  kancaDamgasi,
  kancaHelloSatiri,
  kancaIstekSatiri,
  kancaYerelAnMi,
  pcJetonuMu,
  pcKancaGirdisi,
  type KancaYerelAn,
  type PcKancaIstegi,
  type PcKancaOlayi,
} from "@eren/protocol/kanca";
import type { BoruBaglantisi } from "./sozlesme.ts";
import { ajandaPcAnahtarYolu, veriKokuCoz } from "./veri-koku.ts";

export interface PcKancaBagimliliklari {
  baglan: (boruAdi: string) => Promise<BoruBaglantisi>;
  /** PC anahtarı (dosyadan); `null`: yok, servise hiç gidilmez. */
  jetonOku: () => string | null;
  /** Servise ulaşılamazsa damganın anı: kancanın kendi saati ve sistem dilimi. */
  yerelSimdi: () => KancaYerelAn | null;
  /** `ms` sonra çözülür (zaman aşımı). */
  bekle: (ms: number) => Promise<void>;
  /** Servisin kendi başlattığı oturum mu (`PC_SERVIS_OTURUMU_ORTAMI`): öyleyse hiçbir şey yapılmaz. */
  servisOturumu: boolean;
}

/** Tek bağlantıdaki tek isteğin kimliği. */
const ISTEK_ID = "kanca_1";

/**
 * Kancanın gövdesi: `hamGirdi` stdin (JSON), dönen metin stdout. Hiç atmaz. Servis kapalıysa, anahtar
 * yoksa ya da girdi geçersizse sessizce geçer; `istem` yine de damgayı yazar.
 */
export async function pcKancaCalistir(olay: PcKancaOlayi, hamGirdi: string, b: PcKancaBagimliliklari): Promise<string> {
  if (b.servisOturumu) return "";
  let ham: unknown = null;
  try {
    ham = JSON.parse(hamGirdi);
  } catch {
    ham = null;
  }
  const istek = pcKancaGirdisi(olay, ham);
  let jeton: string | null = null;
  try {
    jeton = istek === null ? null : b.jetonOku();
  } catch {
    jeton = null;
  }
  let sonuc: unknown = null;
  if (istek !== null && jeton !== null) sonuc = await kancaIstegiYolla(istek, jeton, b).catch(() => null);
  if (olay !== "istem") return "";
  const servisAni = typeof sonuc === "object" && sonuc !== null ? (sonuc as Record<string, unknown>)["mesaj_ani"] : undefined;
  let an: unknown = kancaYerelAnMi(servisAni) ? servisAni : null;
  if (an === null) {
    try {
      an = b.yerelSimdi();
    } catch {
      an = null;
    }
  }
  const damga = kancaDamgasi(an);
  return damga === null ? "" : `${damga}\n`;
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

/**
 * Damganın yerel yedeği: `ms` anının `dilim`'deki duvar saati, dakikaya yuvarlanmış (`takvim.ts`
 * `yerelAn` ile aynı sonuç; test sınar). Dilim geçersizse `null`.
 */
export function kancaYerelAni(ms: number, dilim: string): KancaYerelAn | null {
  try {
    const p: Record<string, string> = {};
    const f = new Intl.DateTimeFormat("en-US", {
      timeZone: dilim,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    for (const parca of f.formatToParts(new Date(ms))) if (parca.type !== "literal") p[parca.type] = parca.value;
    const an = { tarih: `${(p["year"] ?? "").padStart(4, "0")}-${p["month"]}-${p["day"]}`, saat: `${p["hour"]}:${p["minute"]}`, saat_dilimi: dilim };
    return kancaYerelAnMi(an) ? an : null;
  } catch {
    return null;
  }
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
  let cikti = "";
  try {
    if (olay !== undefined) {
      const servisOturumu = process.env[PC_SERVIS_OTURUMU_ORTAMI] === "1";
      const girdi = servisOturumu ? "" : await stdinOku(KANCA_GIRDI_AZAMI);
      cikti = await pcKancaCalistir(olay, girdi, {
        baglan: (ad) => kancaBoruyaBaglan(ad),
        jetonOku: () => kancaAnahtariOku(process.env),
        yerelSimdi: () => kancaYerelAni(Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone),
        bekle: (ms) => new Promise((r) => setTimeout(r, ms).unref()),
        servisOturumu,
      });
    }
  } catch {
    cikti = "";
  }
  if (cikti === "") cik();
  process.stdout.write(cikti, cik);
}

if (import.meta.main) await kancaGirisi(process.argv[2]);
