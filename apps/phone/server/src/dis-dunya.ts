/**
 * Portların gerçekleri: süreç, dosya, ağ, saat, anahtar. İş kuralı yok. MODULLER.md, "dis-dunya".
 * Genel kural 3'ün istisnası: `node:*`, `ws`, `fetch` yalnız burada ve `ana`/`kopru`/`eslestir`'de serbest.
 */
import { spawn } from "node:child_process";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import {
  createPrivateKey,
  createPublicKey,
  createSign,
  createVerify,
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  appendFileSync,
  closeSync,
  constants as dosyaSabitleri,
  existsSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import type { Dirent } from "node:fs";
import { lstat, mkdir, open, readdir, readFile, rename, rmdir, stat, truncate, unlink, writeFile } from "node:fs/promises";
import { createServer as httpSunucusu } from "node:http";
import { createServer as boruSunucusu } from "node:net";
import type { Server as NetSunucusu, Socket } from "node:net";
import { freemem, networkInterfaces, totalmem } from "node:os";
import { dirname, join, win32 } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { SOHBET_YETENEK_PARAMETRESI } from "@eren/protocol";
import {
  izinBetigi,
  izinCiktisiCoz,
  posixKokIzniDegerlendir,
  windowsKokIzniDegerlendir,
  windowsPowerShellOrtami,
} from "./kok-izni.ts";
import type { KokIzniSonucu } from "./kok-izni.ts";
import type { AjandaEkDiski, AjandaEkDosyasi, AjandaEkYarimi } from "./ajanda-ekler.ts";
import { WebSocketServer } from "ws";
import type { RawData, WebSocket } from "ws";
import type {
  AnahtarPortu,
  AracIstegi,
  AracSonucu,
  AyrikSurec,
  AyrikSurecIstegi,
  BoruBaglantisi,
  BoruluSurec,
  BoruluSurecIstegi,
  BoruSunucuIstegi,
  BoruSunucuPortu,
  DisDunya,
  DisDunyaFabrikasi,
  DosyaPortu,
  DosyaPortuFabrikasi,
  HttpPortu,
  IptalEt,
  KapatilabilirSunucu,
  KayitPortu,
  MasaustuDurumu,
  RamOkumasi,
  RastgelePortu,
  SaatPortu,
  SistemPortu,
  SurecKaydi,
  SurecKimligi,
  SurecPortu,
  TekilKilitPortu,
  TranskriptPortu,
  TranskriptSilmeSonucu,
  WsBaglantisi,
  WsSunucuIstegi,
  WsSunucuPortu,
  WsYolu,
  ZamanlayiciPortu,
} from "./sozlesme.ts";

const TEKIL_KILIT_BORUSU = "\\\\.\\pipe\\eren-servis-tekil";
const BORU_ONEKI = "\\\\.\\pipe\\";
const SATIR_TAMPON_SINIRI = 32 * 1024 * 1024;
const STDERR_TAMPON_SINIRI = 1024 * 1024;
const ARAC_CIKTI_SINIRI = 16 * 1024 * 1024;
const OLUSMA_ANI_TOLERANSI_MS = 1000;
const SORGU_ZAMAN_ASIMI_MS = 20_000;
const TASKKILL_ZAMAN_ASIMI_MS = 15_000;
const KAPANIS_TOLERANSI_MS = 500;

const bos = (): void => {};

// ---------------------------------------------------------------------------------------------
// Saat, zamanlayıcı, rastgele
// ---------------------------------------------------------------------------------------------

const saatKur = (): SaatPortu => ({ simdiMs: () => Date.now() });

const zamanlayiciKur = (): ZamanlayiciPortu => ({
  sonra: (ms, f): IptalEt => {
    const t = setTimeout(f, ms);
    return () => clearTimeout(t);
  },
  herAralik: (ms, f): IptalEt => {
    const t = setInterval(f, ms);
    return () => clearInterval(t);
  },
});

const rastgeleKur = (): RastgelePortu => ({
  baytlar: (adet) => new Uint8Array(randomBytes(adet)),
  uuid: () => randomUUID(),
  opakId: (on) => on + randomBytes(9).toString("base64url"),
  jeton: () => randomBytes(32).toString("base64url"),
  hex64: () => randomBytes(8).toString("hex"),
});

// ---------------------------------------------------------------------------------------------
// Dosya
// ---------------------------------------------------------------------------------------------

const hataKodu = (e: unknown): string | undefined =>
  typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : undefined;

let gecici = 0;

export const dosyaPortuKur: DosyaPortuFabrikasi = (): DosyaPortu => ({
  oku: async (yol) => {
    try {
      return await readFile(yol, "utf8");
    } catch (e) {
      if (hataKodu(e) === "ENOENT") return null;
      throw e;
    }
  },
  atomikYaz: async (yol, icerik) => {
    gecici += 1;
    const gecici_yol = `${yol}.${process.pid}.${gecici}.${randomBytes(4).toString("hex")}.tmp`;
    try {
      await writeFile(gecici_yol, icerik, "utf8");
      // Windows'ta hedef o an açıksa rename EPERM/EBUSY verebilir: kısa yeniden deneme.
      for (let deneme = 0; ; deneme += 1) {
        try {
          await rename(gecici_yol, yol);
          return;
        } catch (e) {
          const k = hataKodu(e);
          if (deneme >= 5 || (k !== "EPERM" && k !== "EBUSY" && k !== "EACCES")) throw e;
          await new Promise<void>((coz) => setTimeout(coz, 20 * (deneme + 1)));
        }
      }
    } catch (e) {
      await unlink(gecici_yol).catch(bos);
      throw e;
    }
  },
  aralikOku: async (yol, ofset, azamiBayt) => {
    let f;
    try {
      f = await open(yol, "r");
    } catch (e) {
      if (hataKodu(e) === "ENOENT") return new Uint8Array(0);
      throw e;
    }
    try {
      const tampon = Buffer.alloc(Math.max(0, azamiBayt));
      const { bytesRead } = await f.read(tampon, 0, tampon.length, ofset);
      return new Uint8Array(tampon.buffer, tampon.byteOffset, bytesRead);
    } finally {
      await f.close().catch(bos);
    }
  },
  boyut: async (yol) => {
    try {
      return (await stat(yol)).size;
    } catch (e) {
      if (hataKodu(e) === "ENOENT") return null;
      throw e;
    }
  },
  dizinOlustur: async (yol) => {
    await mkdir(yol, { recursive: true });
  },
  dizinVarMi: async (yol) => {
    try {
      return (await stat(yol)).isDirectory();
    } catch (e) {
      const k = hataKodu(e);
      if (k === "ENOENT" || k === "ENOTDIR") return false;
      throw e;
    }
  },
  dosyaSil: async (yol) => {
    let durum;
    try {
      durum = await lstat(yol);
    } catch (e) {
      if (hataKodu(e) === "ENOENT") return;
      throw e;
    }
    // Yalnız düz dosya silinir; dizin, junction ve sembolik bağa dokunulmaz.
    if (!durum.isFile()) throw new Error("dosya_degil");
    try {
      await unlink(yol);
    } catch (e) {
      if (hataKodu(e) === "ENOENT") return;
      throw e;
    }
  },
});

// ---------------------------------------------------------------------------------------------
// Kayıt (günlük dosyası)
// ---------------------------------------------------------------------------------------------

const kayitKur = (yol: string): KayitPortu => {
  let boyut = 0;
  try {
    boyut = statSync(yol).size;
  } catch {
    boyut = 0;
  }
  const numarali = (n: number): string => yol.replace(/(\.[^.\\/]*)?$/, (ek) => `.${n}${ek}`);
  return {
    satirEkle: (satir) => {
      try {
        const metin = satir.endsWith("\n") ? satir : `${satir}\n`;
        try {
          appendFileSync(yol, metin);
        } catch (e) {
          if (hataKodu(e) !== "ENOENT") throw e;
          mkdirSync(dirname(yol), { recursive: true });
          appendFileSync(yol, metin);
        }
        boyut += Buffer.byteLength(metin);
      } catch {
        // günlük hatası servisi düşürmez
      }
    },
    boyut: () => boyut,
    dondur: (azamiDosya) => {
      try {
        const toplam = Math.max(1, Math.floor(azamiDosya));
        // servis.log + servis.1.log ... servis.(toplam-1).log
        if (toplam > 1) rmSync(numarali(toplam - 1), { force: true });
        for (let n = toplam - 2; n >= 1; n -= 1) {
          if (existsSync(numarali(n))) renameSync(numarali(n), numarali(n + 1));
        }
        if (toplam > 1) {
          if (existsSync(yol)) renameSync(yol, numarali(1));
        } else {
          rmSync(yol, { force: true });
        }
        boyut = 0;
      } catch {
        // dönüştürme başarısızsa dosya büyümeye devam eder, yutulur
        try {
          boyut = statSync(yol).size;
        } catch {
          boyut = 0;
        }
      }
    },
  };
};

// ---------------------------------------------------------------------------------------------
// Süreç
// ---------------------------------------------------------------------------------------------

const sistemKoku = (): string => process.env["SystemRoot"] ?? process.env["windir"] ?? "C:\\Windows";
const powershellYolu = (): string => `${sistemKoku()}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
const taskkillYolu = (): string => `${sistemKoku()}\\System32\\taskkill.exe`;

interface KisaSonuc {
  zamanAsimi: boolean;
  stdout: string;
  stderr: string;
  kod: number | null;
}

/** Kısa ömürlü yardımcı: `windowsHide`, `detached` yok, kabuk yok. Başlatılamazsa atar. */
const kisaCalistir = (
  exe: string,
  argv: readonly string[],
  secenekler: { cwd?: string; ortam?: Readonly<Record<string, string>>; zamanAsimiMs: number },
): Promise<KisaSonuc> =>
  new Promise<KisaSonuc>((coz, reddet) => {
    const so: SpawnOptions = { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] };
    if (secenekler.cwd !== undefined) so.cwd = secenekler.cwd;
    if (secenekler.ortam !== undefined) so.env = { ...secenekler.ortam };
    let cocuk: ChildProcess;
    try {
      cocuk = spawn(exe, [...argv], so);
    } catch (e) {
      reddet(e);
      return;
    }
    const cikti = { stdout: [] as Buffer[], stderr: [] as Buffer[], stdoutBayt: 0, stderrBayt: 0 };
    const topla = (hedef: "stdout" | "stderr", parca: Buffer): void => {
      const bayt = hedef === "stdout" ? "stdoutBayt" : "stderrBayt";
      const kalan = ARAC_CIKTI_SINIRI - cikti[bayt];
      if (kalan <= 0) return;
      const alinan = parca.length > kalan ? parca.subarray(0, kalan) : parca;
      cikti[hedef].push(alinan);
      cikti[bayt] += alinan.length;
    };
    cocuk.stdout?.on("data", (p: Buffer) => topla("stdout", p));
    cocuk.stderr?.on("data", (p: Buffer) => topla("stderr", p));
    cocuk.stdout?.on("error", bos);
    cocuk.stderr?.on("error", bos);
    let bitti = false;
    let zamanAsimi = false;
    const bitir = (kod: number | null): void => {
      if (bitti) return;
      bitti = true;
      clearTimeout(sayac);
      coz({
        zamanAsimi,
        stdout: Buffer.concat(cikti.stdout).toString("utf8"),
        stderr: Buffer.concat(cikti.stderr).toString("utf8"),
        kod,
      });
    };
    const sayac = setTimeout(() => {
      zamanAsimi = true;
      try {
        cocuk.kill();
      } catch {
        // süreç zaten bitmiş olabilir
      }
      bitir(null);
    }, secenekler.zamanAsimiMs);
    cocuk.once("error", (e) => {
      if (bitti) return;
      bitti = true;
      clearTimeout(sayac);
      reddet(e);
    });
    cocuk.once("close", (kod) => bitir(kod));
  });

const powershellCalistir = async (betik: string): Promise<string> => {
  const kodlu = Buffer.from(betik, "utf16le").toString("base64");
  const s = await kisaCalistir(
    powershellYolu(),
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", kodlu],
    // PS7'den devralınan `PSModulePath` 5.1'de modül yüklemesini bozar (`windowsPowerShellOrtami`).
    { zamanAsimiMs: SORGU_ZAMAN_ASIMI_MS, ortam: windowsPowerShellOrtami(process.env) },
  );
  if (s.zamanAsimi) throw new Error("powershell_zaman_asimi");
  if (s.kod !== 0) throw new Error("powershell_hata");
  return s.stdout;
};

// ---------------------------------------------------------------------------------------------
// Veri kökü izni
// ---------------------------------------------------------------------------------------------

export interface KokIzniBaglari {
  readonly platform: NodeJS.Platform;
  /** Windows: betiği Windows PowerShell'de çalıştırır, stdout'u döner; başarısızsa atar. */
  readonly powershell: (betik: string) => Promise<string>;
}

const GERCEK_KOK_IZNI_BAGLARI: KokIzniBaglari = { platform: process.platform, powershell: (b) => powershellCalistir(b) };

/**
 * Servis açılışında, kökte hiçbir dosya açılmadan önce: kök yoksa yalnız kullanıcıya açık oluşturur
 * (Windows: tek adımda güvenlik tanımıyla; POSIX: 0700), sonra izni `kok-izni.ts` kuralıyla
 * değerlendirir. Var olan köke dokunmaz: daraltma kurulumun işidir (`kur.ts --izin-duzelt`). Okuma
 * başarısızsa güvensiz sayılır (kapalı başarısızlık). Atmaz.
 */
export const veriKokuIzniHazirla = async (
  kok: string,
  b: KokIzniBaglari = GERCEK_KOK_IZNI_BAGLARI,
): Promise<KokIzniSonucu> => {
  const okunamadi: KokIzniSonucu = { guvenli: false, sorunlar: [{ tur: "cozulemedi" }] };
  try {
    if (b.platform === "win32") {
      const c = izinCiktisiCoz(await b.powershell(izinBetigi(kok, "hazirla")));
      return c === null ? okunamadi : windowsKokIzniDegerlendir(c.sddl, c.sid);
    }
    await mkdir(kok, { recursive: true, mode: 0o700 });
    const d = await stat(kok);
    if (!d.isDirectory()) return okunamadi;
    return posixKokIzniDegerlendir({ uid: d.uid, kip: d.mode, kullaniciUid: process.getuid?.() ?? -1 });
  } catch {
    return okunamadi;
  }
};

const SUREC_SORGUSU = (filtre: string): string =>
  [
    "$ErrorActionPreference='Stop'",
    "[Console]::OutputEncoding=[Text.Encoding]::UTF8",
    `Get-CimInstance -ClassName Win32_Process${filtre} | ForEach-Object { if ($_.CreationDate) { '{0}|{1}|{2}|{3}' -f $_.ProcessId,$_.ParentProcessId,([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds(),$_.Name } }`,
  ].join("\n");

const kayitlariCoz = (metin: string): SurecKaydi[] => {
  const kayitlar: SurecKaydi[] = [];
  for (const satir of metin.split(/\r?\n/)) {
    const p = satir.split("|");
    if (p.length < 4) continue;
    const pid = Number(p[0]);
    const ppid = Number(p[1]);
    const olusturmaMs = Number(p[2]);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid) || !Number.isFinite(olusturmaMs)) continue;
    kayitlar.push({ pid, ppid, olusturmaMs, ad: p.slice(3).join("|") });
  }
  return kayitlar;
};

const pidSorgula = async (pid: number): Promise<SurecKaydi | null> => {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const kayitlar = kayitlariCoz(await powershellCalistir(SUREC_SORGUSU(` -Filter "ProcessId=${pid}"`)));
  return kayitlar.find((k) => k.pid === pid) ?? null;
};

/** `kimlikOkuyucuKur`'un baktığı çocuk alanları; test sahte nesne verebilsin diye dar. */
export type KimlikCocugu = Pick<ChildProcess, "pid" | "exitCode" | "signalCode" | "kill">;

export interface KimlikOkumaBaglari {
  pidSorgula(pid: number): Promise<SurecKaydi | null>;
  /** `taskkill /T /F /PID`: atmaz, kodu okunmaz. */
  agaciOldur(pid: number): Promise<void>;
}

/**
 * Çocuk bitmediği halde oluşma anı okunamazsa kimlik güvenilmez: süreç ağacı öldürülür, atılır.
 * Sorgu 2 x `SORGU_ZAMAN_ASIMI_MS` sürebilir; `claude` o arada MCP sunucularını açmış olur. Yalnız kökü
 * öldürmek onları yetim bırakır ve çağıran iz tutmaz (pid yok). Kök yaşarken `/T` ağacı bulur, ölü köke
 * çalışmaz: önce ağaç, sonra yedek olarak kök. Dışa açık yalnız test için (sahte sorgu ve öldürücü).
 */
export const kimlikOkuyucuKur =
  (bag: KimlikOkumaBaglari) =>
  async (cocuk: KimlikCocugu): Promise<SurecKimligi> => {
    const pid = cocuk.pid;
    if (pid === undefined) throw new Error("pid_yok");
    let son: unknown = null;
    for (let deneme = 0; deneme < 2; deneme += 1) {
      try {
        const k = await bag.pidSorgula(pid);
        if (k) return { pid, olusturmaMs: k.olusturmaMs };
      } catch (e) {
        son = e;
      }
      if (cocuk.exitCode !== null || cocuk.signalCode !== null) break;
    }
    if (cocuk.exitCode !== null || cocuk.signalCode !== null) return { pid, olusturmaMs: Date.now() };
    try {
      await bag.agaciOldur(pid);
    } catch {
      // yedek: en azından kök ölsün
    }
    try {
      cocuk.kill();
    } catch {
      // yok say
    }
    throw son instanceof Error ? son : new Error("olusturma_ani_okunamadi");
  };

const kimlikOku = kimlikOkuyucuKur({
  pidSorgula,
  agaciOldur: (pid) => taskkill(["/T", "/F", "/PID", String(pid)]),
});

const baslamayiBekle = (cocuk: ChildProcess): Promise<void> =>
  new Promise<void>((coz, reddet) => {
    cocuk.once("error", reddet);
    cocuk.once("spawn", () => {
      cocuk.removeListener("error", reddet);
      // başlamadan sonraki hatalar da işlenmeli, yoksa süreç düşer
      cocuk.on("error", bos);
      coz();
    });
  });

/** Dinleyiciler sonradan eklenebilir; olay olduysa hemen çağrılır. */
const birKezOlayKur = (): { tetikle(): void; dinle(f: () => void): void } => {
  let oldu = false;
  const dinleyiciler: Array<() => void> = [];
  return {
    tetikle: () => {
      if (oldu) return;
      oldu = true;
      for (const f of dinleyiciler.splice(0)) f();
    },
    dinle: (f) => {
      if (oldu) f();
      else dinleyiciler.push(f);
    },
  };
};

/** Satır ayırıcı: bayt düzeyinde böler, sınırı aşan satırı satır sonuna dek atar. */
const satirAyirici = (sinir: number, teslim: (satir: string) => void): ((parca: Buffer) => void) => {
  let kalan: Buffer = Buffer.alloc(0);
  let atla = false;
  return (parca) => {
    let veri = kalan.length > 0 ? Buffer.concat([kalan, parca]) : parca;
    kalan = Buffer.alloc(0);
    for (;;) {
      const i = veri.indexOf(0x0a);
      if (i < 0) break;
      if (atla) {
        atla = false;
      } else if (i <= sinir) {
        let son = i;
        if (son > 0 && veri[son - 1] === 0x0d) son -= 1;
        teslim(veri.subarray(0, son).toString("utf8"));
      }
      veri = veri.subarray(i + 1);
    }
    if (atla) return;
    if (veri.length > sinir) {
      atla = true;
      return;
    }
    kalan = Buffer.from(veri);
  };
};

const boruluBaslat = async (istek: BoruluSurecIstegi): Promise<BoruluSurec> => {
  const cocuk = spawn(istek.exe, [...istek.argv], {
    cwd: istek.cwd,
    env: { ...istek.ortam },
    windowsHide: true,
    stdio: "pipe",
  });
  await baslamayiBekle(cocuk);
  const stdin = cocuk.stdin;
  stdin?.on("error", bos);
  cocuk.stdout?.on("error", bos);
  cocuk.stderr?.on("error", bos);

  const cikis = birKezOlayKur();
  cocuk.once("close", () => cikis.tetikle());
  cocuk.once("exit", () => {
    // Yetim torunlar boruyu açık tutabilir: `close` gelmezse de bildir.
    setTimeout(() => cikis.tetikle(), KAPANIS_TOLERANSI_MS);
  });

  const satirDinleyicileri: Array<(satir: string) => void> = [];
  const bekleyenSatirlar: string[] = [];
  let bekleyenBayt = 0;
  const stdoutAyirici = satirAyirici(SATIR_TAMPON_SINIRI, (satir) => {
    if (satirDinleyicileri.length === 0) {
      if (bekleyenBayt + satir.length <= SATIR_TAMPON_SINIRI) {
        bekleyenSatirlar.push(satir);
        bekleyenBayt += satir.length;
      }
      return;
    }
    for (const f of [...satirDinleyicileri]) f(satir);
  });
  cocuk.stdout?.on("data", (p: Buffer) => stdoutAyirici(p));

  const stderrDinleyicileri: Array<(parca: string) => void> = [];
  const bekleyenStderr: string[] = [];
  let bekleyenStderrBayt = 0;
  const stderrCozucu = new StringDecoder("utf8");
  cocuk.stderr?.on("data", (p: Buffer) => {
    const metin = stderrCozucu.write(p);
    if (metin === "") return;
    if (stderrDinleyicileri.length === 0) {
      if (bekleyenStderrBayt + metin.length <= STDERR_TAMPON_SINIRI) {
        bekleyenStderr.push(metin);
        bekleyenStderrBayt += metin.length;
      }
      return;
    }
    for (const f of [...stderrDinleyicileri]) f(metin);
  });

  const kimlik = await kimlikOku(cocuk);
  return {
    ...kimlik,
    satirYaz: (satir) => {
      if (!stdin || stdin.destroyed || stdin.writableEnded || !stdin.writable) return false;
      try {
        stdin.write(`${satir}\n`, bos);
        return true;
      } catch {
        return false;
      }
    },
    stdinKapat: () => {
      try {
        stdin?.end();
      } catch {
        // kırık boru
      }
    },
    stdoutSatirDinle: (f) => {
      satirDinleyicileri.push(f);
      for (const satir of bekleyenSatirlar.splice(0)) f(satir);
      bekleyenBayt = 0;
    },
    stderrDinle: (f) => {
      stderrDinleyicileri.push(f);
      for (const parca of bekleyenStderr.splice(0)) f(parca);
      bekleyenStderrBayt = 0;
    },
    cikisDinle: (f) => cikis.dinle(f),
  };
};

const ayrikBaslat = async (istek: AyrikSurecIstegi): Promise<AyrikSurec> => {
  const outFd = openSync(istek.outYol, "a");
  let errFd: number;
  try {
    errFd = openSync(istek.errYol, "a");
  } catch (e) {
    closeSync(outFd);
    throw e;
  }
  let cocuk: ChildProcess;
  try {
    cocuk = spawn(istek.exe, [...istek.argv], {
      cwd: istek.cwd,
      env: { ...istek.ortam },
      detached: true,
      windowsHide: true,
      stdio: ["ignore", outFd, errFd],
    });
    await baslamayiBekle(cocuk);
  } catch (e) {
    closeSync(outFd);
    closeSync(errFd);
    throw e;
  }
  // Çocuk kendi kopyasını aldı; ebeveynin tutması gerekmez.
  closeSync(outFd);
  closeSync(errFd);
  cocuk.unref();
  const cikis = birKezOlayKur();
  cocuk.once("exit", () => cikis.tetikle());
  const kimlik = await kimlikOku(cocuk);
  return { ...kimlik, cikisDinle: (f) => cikis.dinle(f) };
};

const aracCalistir = async (istek: AracIstegi): Promise<AracSonucu> => {
  const secenek: { cwd?: string; ortam?: Readonly<Record<string, string>>; zamanAsimiMs: number } = {
    zamanAsimiMs: istek.zamanAsimiMs,
  };
  if (istek.cwd !== undefined) secenek.cwd = istek.cwd;
  if (istek.ortam !== undefined) secenek.ortam = istek.ortam;
  const s = await kisaCalistir(istek.exe, istek.argv, secenek);
  return { zamanAsimi: s.zamanAsimi, stdout: s.stdout, stderr: s.stderr };
};

/** Çıkış kodu bilerek okunmaz: başarıda 128 ölçüldü. Sağlama `anlikGoruntu`dadır. */
const taskkill = async (argv: readonly string[]): Promise<void> => {
  try {
    await kisaCalistir(taskkillYolu(), argv, { zamanAsimiMs: TASKKILL_ZAMAN_ASIMI_MS });
  } catch {
    // taskkill başlatılamadıysa sağlama anlikGoruntu ile yapılır
  }
};

const surecKur = (): SurecPortu => ({
  boruluBaslat,
  ayrikBaslat,
  aracCalistir,
  anlikGoruntu: async () => kayitlariCoz(await powershellCalistir(SUREC_SORGUSU(""))),
  surecVarMi: async (kimlik) => {
    const k = await pidSorgula(kimlik.pid);
    return k !== null && Math.abs(k.olusturmaMs - kimlik.olusturmaMs) <= OLUSMA_ANI_TOLERANSI_MS;
  },
  agaciOldur: async (pid) => {
    if (!Number.isInteger(pid) || pid <= 0) return;
    await taskkill(["/T", "/F", "/PID", String(pid)]);
  },
  tekOldur: async (pid) => {
    if (!Number.isInteger(pid) || pid <= 0) return;
    await taskkill(["/F", "/PID", String(pid)]);
  },
});

// ---------------------------------------------------------------------------------------------
// Sistem
// ---------------------------------------------------------------------------------------------

const MASAUSTU_BETIGI = [
  "$ErrorActionPreference='Stop'",
  `Add-Type -Namespace ErenKit -Name Wts -MemberDefinition '[DllImport("wtsapi32.dll")] public static extern bool WTSQuerySessionInformationW(IntPtr h, int sid, int cls, out IntPtr buf, out int n); [DllImport("wtsapi32.dll")] public static extern void WTSFreeMemory(IntPtr p);'`,
  "$sid=[Diagnostics.Process]::GetCurrentProcess().SessionId",
  "$b=[IntPtr]::Zero; $n=0",
  "if ([ErenKit.Wts]::WTSQuerySessionInformationW([IntPtr]::Zero,$sid,8,[ref]$b,[ref]$n)) { [Runtime.InteropServices.Marshal]::ReadInt32($b); [ErenKit.Wts]::WTSFreeMemory($b) }",
].join("\n");

/** 100.64.0.0/10: ilk sekizli 100, ikincisi 64-127. */
const tailscaleAraligindaMi = (adres: string): boolean => {
  const p = adres.split(".");
  if (p.length !== 4) return false;
  const s = p.map((x) => (/^\d{1,3}$/.test(x) ? Number(x) : NaN));
  if (s.some((x) => !Number.isInteger(x) || x > 255)) return false;
  return s[0] === 100 && (s[1] ?? 0) >= 64 && (s[1] ?? 0) <= 127;
};

const sistemKur = (): SistemPortu => ({
  ramOku: (): RamOkumasi => ({ bosMb: freemem() / (1024 * 1024), toplamMb: totalmem() / (1024 * 1024) }),
  tailscaleAdresi: () => {
    for (const [ad, adresler] of Object.entries(networkInterfaces())) {
      // 100.64/10 taşıyıcı CGNAT'ıyla ortak; başka VPN'ler de bu aralıktan adres alır.
      if (!ad.toLowerCase().includes("tailscale")) continue;
      for (const a of adresler ?? []) {
        if (a.family === "IPv4" && !a.internal && tailscaleAraligindaMi(a.address)) return a.address;
      }
    }
    return null;
  },
  masaustuDurumu: async (): Promise<MasaustuDurumu> => {
    try {
      const durum = (await powershellCalistir(MASAUSTU_BETIGI)).trim().split(/\r?\n/)[0];
      if (durum === "0") return "bagli";
      if (durum === "4") return "kopuk";
      return "bilinmiyor";
    } catch {
      return "bilinmiyor";
    }
  },
});

// ---------------------------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------------------------

/**
 * Bilinen yollar. Ajanda dalgası: `/ajanda` yalnız `azamiCerceve["/ajanda"]` verilmişse dinlenir;
 * verilmemişse o yola yükseltme yol dışı gibi `404` alır (eski çağıranın davranışı birebir aynı).
 */
const WS_YOLLARI: readonly WsYolu[] = ["/sohbet", "/cihaz", "/ajanda"];

const wsMetni = (veri: RawData): string => {
  if (Buffer.isBuffer(veri)) return veri.toString("utf8");
  if (Array.isArray(veri)) return Buffer.concat(veri).toString("utf8");
  return Buffer.from(veri).toString("utf8");
};

/**
 * Yarı açık bağlantı yoklaması (telefon ağ değiştirdi, kapsama dışı: soket düzgün kapanmadı). Her
 * aralıkta bir WebSocket ping çerçevesi gider; bir tam aralık boyunca karşı uçtan HİÇ bayt gelmeyen
 * bağlantı `terminate` edilir ve bugünkü kapanış yolundan temizlenir. Kanıt alttaki TCP soketinin
 * `bytesRead` sayacıdır (Node `net.Socket`'in kamuya açık alanı; `ws`'nin iç alanı değil): yarım
 * yüklenen büyük çerçeve de sayılır. Telefon tek bir büyük çerçeve (ör. 8 MB ekran görüntüsü) yüklerken
 * pong o çerçevenin arkasında bekler; yükleme sürdükçe bağlantı canlıdır. Ölü bağlantı en geç iki aralıkta (60 sn)
 * düşer; pong için bir tam aralık (30 sn) beklenir: mobil ağ gecikmesine geniş pay. Ping uygulama
 * mesajı değildir, protokol değişmez: telefondaki WebSocket gerçeklemeleri pong'u kendiliğinden döner.
 * Tampon için ek üst sınır yok: telafi bütün partileri bir kerede yazar, sağlıklı ama yavaş bağlantıda
 * tampon meşru olarak büyür; sınır yeniden bağlanma döngüsü doğurur. Ölü sokete yazılan en çok iki
 * aralığın olaylarıdır.
 */
export const WS_CANLILIK_ARALIGI_MS = 30_000;

export interface CanlilikIzleyicisi {
  /** Pong ya da mesaj geldi: bağlantı bu aralıkta canlı (bayt sayacına ek, ucuz kanıt). */
  canliIsaretle(): void;
  /** Zamanlayıcıyı bırakır. Birden çok çağrı zararsızdır. */
  durdur(): void;
}

export interface CanlilikIstegi {
  aralikMs: number;
  herAralik: ZamanlayiciPortu["herAralik"];
  ping: () => void;
  /** Karşı uçtan bugüne okunan toplam bayt. Her tikte bir önceki tikten büyükse bağlantı canlıdır. */
  okunanBayt: () => number;
  /** Bir aralık boyunca canlılık kanıtı gelmedi. Çağrılmadan önce zamanlayıcı bırakılır. */
  sonlandir: () => void;
}

export const canlilikIzleyicisiKur = (i: CanlilikIstegi): CanlilikIzleyicisi => {
  let canli = true;
  let sonBayt = i.okunanBayt();
  let iptal: IptalEt | null = null;
  const durdur = (): void => {
    const f = iptal;
    iptal = null;
    f?.();
  };
  iptal = i.herAralik(i.aralikMs, () => {
    if (iptal === null) return;
    const bayt = i.okunanBayt();
    if (bayt !== sonBayt) {
      // Kısmi çerçeve verisi dahil herhangi bir bayt: karşı uç bu aralıkta yaşıyordu.
      sonBayt = bayt;
      canli = true;
    }
    if (!canli) {
      durdur();
      i.sonlandir();
      return;
    }
    canli = false;
    i.ping();
  });
  return {
    canliIsaretle: () => {
      canli = true;
    },
    durdur,
  };
};

/** Süreç çıkışını tutmayan aralık: canlılık yoklaması servisin kapanmasını bekletmez. */
const tutmayanAralik: ZamanlayiciPortu["herAralik"] = (ms, f) => {
  const t = setInterval(f, ms);
  t.unref();
  return () => clearInterval(t);
};

export interface WsCanlilikAyari {
  aralikMs: number;
  herAralik: ZamanlayiciPortu["herAralik"];
  /**
   * Sunucunun başlattığı kapanışta karşı ucun kapanış çerçevesi için beklenen süre; dolunca soket
   * koparılır. `ws`'nin kendi süresi 30 sn'dir: yanıt vermeyen (kimliksiz) uç reddedildikten sonra
   * soketi o kadar tutamasın. Verilmezse `WS_KAPANIS_BEKLEME_MS`.
   */
  kapanisBeklemeMs?: number;
}

export const WS_KAPANIS_BEKLEME_MS = 3_000;

const VARSAYILAN_CANLILIK: WsCanlilikAyari = { aralikMs: WS_CANLILIK_ARALIGI_MS, herAralik: tutmayanAralik };

/**
 * Yükseltme isteğinin `Origin` başlığı kabul edilir mi. Başlık yoksa evet (OkHttp, `ws`). React Native'in
 * WebSocket'i (Android ve iOS) başlığı bağlanılan adresten türetir: `http://<host>:<port>`; bu da kabul.
 * Başka her değer (tarayıcıda açılmış bir sayfanın kaynağı, `null`, birden çok başlık) reddedilir: aynı
 * tailnet'teki bir cihazın tarayıcısında açılan sayfa kimliksiz yüzeye ulaşamaz. Bu adres ve portta
 * HTTP sayfası sunulmadığından (her HTTP isteği 426) hiçbir sayfa bu kaynağa sahip olamaz.
 */
export const kaynakIzinliMi = (origin: string | readonly string[] | undefined, host: string, port: number): boolean => {
  if (origin === undefined) return true;
  if (typeof origin !== "string") return false;
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (u.username !== "" || u.password !== "" || u.pathname !== "/" || u.search !== "" || u.hash !== "") return false;
  const etkinPort = u.port === "" ? (u.protocol === "http:" ? 80 : 443) : Number(u.port);
  return u.hostname.toLowerCase() === host.toLowerCase() && etkinPort === port;
};

/**
 * Sözleşmedeki `gonder` `void` döner; gerçekleme gönderimin sokete verilip verilmediğini söyler:
 * soket açık değilse ya da `send` atarsa `false` (çerçeve gitmedi). Eşzamansız yazma hatası burada
 * görünmez: o bağlantı kapanış olayıyla düşer.
 */
export interface GercekWsBaglantisi extends WsBaglantisi {
  gonder(metin: string): boolean;
}

const wsBaglantisiKur = (
  ws: WebSocket,
  yol: WsYolu,
  yetenekler: ReadonlySet<string>,
  soket: Socket,
  canlilik: WsCanlilikAyari,
  izleyiciler: Set<CanlilikIzleyicisi>,
  kimlikOncesi: { readonly baslangicBayt: number; readonly azamiBayt: number },
): GercekWsBaglantisi => {
  const mesajlar: Array<(metin: string) => void> = [];
  const kapanislar = birKezOlayKur();
  const uzakIp = soket.remoteAddress ?? "";
  // Kimlik öncesi bayt sınırı. `ws`'nin `data` dinleyicisi bundan önce eklendi ve iletiyi eşzamanlı
  // yayar: aynı TCP parçasındaki `auth_response` önce işlenir (sınır kalkar), denetim ondan sonra
  // çalışır. Sayaç soketin kendi `bytesRead`'idir; büyük çerçeve tamamı tamponlanmadan, parça parça
  // yakalanır (bellek: sınır + en çok bir okuma parçası).
  let kimlikOncesiSinir: number | null = kimlikOncesi.baslangicBayt + kimlikOncesi.azamiBayt;
  const sinirKaldir = (): void => {
    kimlikOncesiSinir = null;
    soket.off("data", sinirDenetle);
  };
  function sinirDenetle(): void {
    if (kimlikOncesiSinir === null || soket.bytesRead <= kimlikOncesiSinir) return;
    sinirKaldir();
    ws.terminate();
  }
  soket.on("data", sinirDenetle);
  sinirDenetle();
  const kapanisBeklemeMs = canlilik.kapanisBeklemeMs ?? WS_KAPANIS_BEKLEME_MS;
  const izleyici = canlilikIzleyicisiKur({
    aralikMs: canlilik.aralikMs,
    herAralik: canlilik.herAralik,
    // Yükseltilen istek soketi (`req.socket`) `ws`'nin okuduğu sokettir; yalnız sayaç okunur,
    // dinleyici eklenmez, akışa dokunulmaz.
    okunanBayt: () => soket.bytesRead,
    ping: () => {
      try {
        ws.ping(undefined, undefined, bos);
      } catch {
        // açık olmayan soket: kapanış olayı ya da sonraki aralık temizler
      }
    },
    sonlandir: () => {
      izleyiciler.delete(izleyici);
      ws.terminate();
    },
  });
  izleyiciler.add(izleyici);
  ws.on("error", bos);
  ws.on("pong", () => izleyici.canliIsaretle());
  ws.on("close", () => {
    sinirKaldir();
    izleyici.durdur();
    izleyiciler.delete(izleyici);
    kapanislar.tetikle();
  });
  ws.on("message", (veri: RawData, ikili: boolean) => {
    izleyici.canliIsaretle();
    if (ikili) {
      try {
        ws.close(1003, "ikili_cerceve");
      } catch {
        ws.terminate();
      }
      return;
    }
    const metin = wsMetni(veri);
    for (const f of [...mesajlar]) f(metin);
  });
  return {
    yol,
    uzakIp,
    yetenekler,
    gonder: (metin) => {
      if (ws.readyState !== ws.OPEN) return false;
      try {
        ws.send(metin, bos);
        return true;
      } catch {
        // yazılamayan bağlantı kapanış olayıyla temizlenir
        return false;
      }
    },
    kapat: (kod, neden) => {
      try {
        ws.close(kod, neden);
      } catch {
        // geçersiz kod ya da uzun neden: zorla kapat
        ws.terminate();
        return;
      }
      if (ws.readyState === ws.CLOSED) return;
      const t = setTimeout(() => ws.terminate(), kapanisBeklemeMs);
      t.unref();
      ws.once("close", () => clearTimeout(t));
    },
    mesajDinle: (f) => {
      mesajlar.push(f);
    },
    kapanisDinle: (f) => kapanislar.dinle(f),
    kimlikDogrulandi: sinirKaldir,
  };
};

const yolCoz = (url: string | undefined): WsYolu | null => {
  const yol = (url ?? "").split("?")[0];
  return WS_YOLLARI.find((y) => y === yol) ?? null;
};

/** Yetenek değerinden okunan en çok uzunluk ve jeton adedi: fazlası sessizce atılır, bağlantı düşmez. */
const AZAMI_YETENEK_METNI = 256;
const AZAMI_YETENEK_ADEDI = 16;
/** Bu biçime uymayan jeton yok sayılır. Protokolün jetonları (`etkinlik1`) uyar. */
const YETENEK_JETONU = /^[a-z0-9_-]{1,32}$/;
const BOS_YETENEKLER: ReadonlySet<string> = new Set();

/**
 * Adres sorgusundaki `yetenek` parametresi (protokol `SOHBET_YETENEK_PARAMETRESI`): virgülle ayrılmış
 * jeton listesi; parametre birden çok kez gelirse hepsi okunur. Yoksa, boşsa ya da bozuksa boş küme,
 * hiçbir durumda atmaz. Bilinmeyen jeton kümede kalır: anlamını gateway verir, burada iş kuralı yok.
 */
export const yetenekleriCoz = (url: string | undefined): ReadonlySet<string> => {
  const metin = url ?? "";
  const soru = metin.indexOf("?");
  if (soru < 0) return BOS_YETENEKLER;
  const yetenekler = new Set<string>();
  // `URLSearchParams` bozuk yüzde kodlamasında atmaz (WHATWG: geçersiz dizi olduğu gibi kalır).
  for (const ham of new URLSearchParams(metin.slice(soru + 1)).getAll(SOHBET_YETENEK_PARAMETRESI)) {
    let deger = ham;
    if (deger.length > AZAMI_YETENEK_METNI) {
      // Kırpmada son parça yarım jeton olabilir (`etkinlik10` → `etkinlik1`): son virgülden sonrası atılır.
      const son = deger.lastIndexOf(",", AZAMI_YETENEK_METNI);
      deger = son < 0 ? "" : deger.slice(0, son);
    }
    for (const parca of deger.split(",")) {
      if (yetenekler.size >= AZAMI_YETENEK_ADEDI) return yetenekler;
      const jeton = parca.trim();
      if (YETENEK_JETONU.test(jeton)) yetenekler.add(jeton);
    }
  }
  return yetenekler;
};

/** `canlilik` yalnız testte değişir: sahte zamanlayıcıyla yoklama gerçek zaman beklemeden sürülür. */
export const wsKur = (canlilik: WsCanlilikAyari = VARSAYILAN_CANLILIK): WsSunucuPortu => ({
  dinle: (istek: WsSunucuIstegi) =>
    new Promise<KapatilabilirSunucu>((coz, reddet) => {
      const http = httpSunucusu((_i, y) => {
        y.writeHead(426, { Connection: "close" });
        y.end();
      });
      const izleyiciler = new Set<CanlilikIzleyicisi>();
      // Uzak adres başına açık TCP bağlantısı: tek bir uç (ya da aynı adresi paylaşan bir LAN) yarım
      // açık, yanıtsız ya da kimliksiz bağlantıyla sınırsız soket tutamasın. Fazlası hemen koparılır.
      const adresBasina = new Map<string, number>();
      http.on("connection", (soket: Socket) => {
        const adres = soket.remoteAddress ?? "";
        const n = (adresBasina.get(adres) ?? 0) + 1;
        if (n > istek.ipBasinaAzamiBaglanti) {
          soket.destroy();
          return;
        }
        adresBasina.set(adres, n);
        soket.once("close", () => {
          const kalan = (adresBasina.get(adres) ?? 1) - 1;
          if (kalan <= 0) adresBasina.delete(adres);
          else adresBasina.set(adres, kalan);
        });
      });
      // Yükseltme isteğinin başlıkları sayaca girmez; başlıkla aynı parçada gelen çerçeve baytları girer.
      const kimlikOncesiBaslangic = new WeakMap<object, number>();
      // `maxPayload` yol başınadır, bu yüzden yol başına bir `WebSocketServer` ve elle yükseltme.
      const sunucular = new Map<WsYolu, WebSocketServer>();
      for (const yol of WS_YOLLARI) {
        const maxPayload = istek.azamiCerceve[yol];
        // Sınırı verilmeyen yol (`/ajanda` isteğe bağlı) dinlenmez: sınırsız `maxPayload` hiç kurulmaz.
        if (maxPayload === undefined) continue;
        const w = new WebSocketServer({
          noServer: true,
          maxPayload,
          perMessageDeflate: false,
        });
        w.on("connection", (ws, req) => {
          // Yetenek yalnız `/sohbet`'te okunur; kimlikten önce okunur ama anlamı kimlik sonrası gönderimdedir.
          const yetenekler = yol === "/sohbet" ? yetenekleriCoz(req.url) : BOS_YETENEKLER;
          const b = wsBaglantisiKur(ws, yol, yetenekler, req.socket, canlilik, izleyiciler, {
            baslangicBayt: kimlikOncesiBaslangic.get(req) ?? req.socket.bytesRead,
            azamiBayt: istek.kimlikOncesiAzamiBayt,
          });
          try {
            istek.baglanti(b);
          } catch {
            ws.terminate();
          }
        });
        sunucular.set(yol, w);
      }
      http.on("upgrade", (req, soket, head) => {
        soket.on("error", bos);
        const yol = yolCoz(req.url);
        const w = yol === null ? undefined : sunucular.get(yol);
        if (w === undefined) {
          soket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
          soket.destroy();
          return;
        }
        if (!kaynakIzinliMi(req.headers.origin, istek.host, istek.port)) {
          soket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
          soket.destroy();
          return;
        }
        kimlikOncesiBaslangic.set(req, (soket as Socket).bytesRead - head.length);
        w.handleUpgrade(req, soket, head, (ws) => w.emit("connection", ws, req));
      });
      http.once("error", reddet);
      http.listen({ host: istek.host, port: istek.port }, () => {
        http.removeListener("error", reddet);
        http.on("error", bos);
        let kapaniyor: Promise<void> | null = null;
        coz({
          kapat: () => {
            if (kapaniyor) return kapaniyor;
            kapaniyor = new Promise<void>((bitti) => {
              // Kapanış olayını beklemeden: sunucu durunca hiçbir yoklama zamanlayıcısı kalmaz.
              for (const iz of izleyiciler) iz.durdur();
              izleyiciler.clear();
              for (const w of sunucular.values()) {
                for (const istemci of w.clients) istemci.terminate();
                w.close();
              }
              http.close(() => bitti());
              http.closeAllConnections();
            });
            return kapaniyor;
          },
        });
      });
    }),
});

// ---------------------------------------------------------------------------------------------
// Adlandırılmış boru ve tekil kilit
// ---------------------------------------------------------------------------------------------

const boruYolu = (ad: string): string => (ad.startsWith(BORU_ONEKI) ? ad : BORU_ONEKI + ad);

const boruBaglantisiKur = (soket: Socket, azamiSatir: number): BoruBaglantisi => {
  const satirlar: Array<(satir: string) => void> = [];
  const kapanislar = birKezOlayKur();
  let kapandi = false;
  const kapat = (): void => {
    if (kapandi) return;
    kapandi = true;
    soket.destroy();
    kapanislar.tetikle();
  };
  soket.on("error", () => kapat());
  soket.on("close", () => {
    kapandi = true;
    kapanislar.tetikle();
  });
  let kalan: Buffer = Buffer.alloc(0);
  soket.on("data", (parca: Buffer) => {
    if (kapandi) return;
    let veri = kalan.length > 0 ? Buffer.concat([kalan, parca]) : parca;
    for (;;) {
      const i = veri.indexOf(0x0a);
      if (i < 0) break;
      if (i > azamiSatir) {
        kapat();
        return;
      }
      const satir = veri.subarray(0, i).toString("utf8");
      veri = veri.subarray(i + 1);
      for (const f of [...satirlar]) f(satir);
      if (kapandi) return;
    }
    if (veri.length > azamiSatir) {
      kapat();
      return;
    }
    kalan = Buffer.from(veri);
  });
  return {
    satirYaz: (satir) => {
      if (kapandi || soket.destroyed || !soket.writable) return;
      soket.write(`${satir}\n`, bos);
    },
    kapat,
    satirDinle: (f) => {
      satirlar.push(f);
    },
    kapanisDinle: (f) => kapanislar.dinle(f),
  };
};

const boruKur = (): BoruSunucuPortu => ({
  dinle: (istek: BoruSunucuIstegi) =>
    new Promise<KapatilabilirSunucu>((coz, reddet) => {
      const baglantilar = new Set<Socket>();
      const sunucu = boruSunucusu((soket) => {
        baglantilar.add(soket);
        soket.once("close", () => baglantilar.delete(soket));
        const b = boruBaglantisiKur(soket, istek.azamiSatir);
        try {
          istek.baglanti(b);
        } catch {
          b.kapat();
        }
      });
      sunucu.once("error", reddet);
      sunucu.listen(boruYolu(istek.ad), () => {
        sunucu.removeListener("error", reddet);
        sunucu.on("error", bos);
        let kapaniyor: Promise<void> | null = null;
        coz({
          kapat: () => {
            if (kapaniyor) return kapaniyor;
            kapaniyor = new Promise<void>((bitti) => {
              for (const s of baglantilar) s.destroy();
              sunucu.close(() => bitti());
            });
            return kapaniyor;
          },
        });
      });
    }),
});

const tekilKilitKur = (): TekilKilitPortu => {
  let tutulan: NetSunucusu | null = null;
  return {
    al: () =>
      new Promise<boolean>((coz, reddet) => {
        if (tutulan) {
          coz(true);
          return;
        }
        const sunucu = boruSunucusu((s) => s.destroy());
        sunucu.once("error", (e) => {
          if (hataKodu(e) === "EADDRINUSE") coz(false);
          else reddet(e);
        });
        sunucu.listen(TEKIL_KILIT_BORUSU, () => {
          sunucu.removeAllListeners("error");
          sunucu.on("error", bos);
          tutulan = sunucu;
          coz(true);
        });
      }),
  };
};

// ---------------------------------------------------------------------------------------------
// Http
// ---------------------------------------------------------------------------------------------

const httpKur = (): HttpPortu => ({
  postJson: async (url, govde, zamanAsimiMs) => {
    const yanit = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(govde),
      signal: AbortSignal.timeout(zamanAsimiMs),
    });
    await yanit.body?.cancel().catch(bos);
    return { durum: yanit.status };
  },
});

// ---------------------------------------------------------------------------------------------
// Anahtar
// ---------------------------------------------------------------------------------------------

const anahtarKur = async (yol: string): Promise<AnahtarPortu> => {
  const dosya = dosyaPortuKur();
  let pem = await dosya.oku(yol);
  if (pem === null) {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const yeni = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    await mkdir(dirname(yol), { recursive: true });
    try {
      // `wx`: iki süreç yarışırsa ikincisi birincinin anahtarını ezmez.
      await writeFile(yol, yeni, { encoding: "utf8", flag: "wx", mode: 0o600 });
      pem = yeni;
    } catch (e) {
      if (hataKodu(e) !== "EEXIST") throw e;
      pem = await dosya.oku(yol);
    }
  }
  if (pem === null) throw new Error("anahtar_okunamadi");
  // Bozuk dosya burada atar ve ezilmez: yanlış kimliğe sessizce geçilmez.
  const ozel = createPrivateKey(pem);
  if (ozel.asymmetricKeyType !== "ec" || ozel.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new Error("anahtar_p256_degil");
  }
  const acik = createPublicKey(ozel).export({ type: "spki", format: "der" }).toString("base64");
  return {
    acikAnahtar: () => acik,
    imzala: (metin) =>
      createSign("SHA256").update(metin, "utf8").sign({ key: ozel, dsaEncoding: "der" }).toString("base64"),
    dogrula: (acikAnahtar, metin, imza) => {
      try {
        const anahtar = createPublicKey({ key: Buffer.from(acikAnahtar, "base64"), format: "der", type: "spki" });
        if (anahtar.asymmetricKeyType !== "ec" || anahtar.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
          return false;
        }
        return createVerify("SHA256")
          .update(metin, "utf8")
          .verify({ key: anahtar, dsaEncoding: "der" }, Buffer.from(imza, "base64"));
      } catch {
        return false;
      }
    },
    sabitZamanEsit: (a, b) => {
      const ba = Buffer.from(a, "utf8");
      const bb = Buffer.from(b, "utf8");
      // Uzunluk farkı hash'le gizlenir; yalnız uzunluk eşitliği ayrıca sınanır.
      const ha = createHash("sha256").update(ba).digest();
      const hb = createHash("sha256").update(bb).digest();
      return timingSafeEqual(ha, hb) && ba.length === bb.length;
    },
  };
};

// ---------------------------------------------------------------------------------------------
// Transkript (dar silme portu)
// ---------------------------------------------------------------------------------------------

const UUID_DESENI = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Bağ (junction, sembolik) ise yalnız bağı kaldırır, hedefe girmez. Tamamen silindiyse `true`. */
const agaciBagIzlemedenSil = async (yol: string): Promise<boolean> => {
  let durum;
  try {
    durum = await lstat(yol);
  } catch (e) {
    return hataKodu(e) === "ENOENT";
  }
  try {
    if (durum.isSymbolicLink()) {
      try {
        await unlink(yol);
      } catch {
        await rmdir(yol);
      }
      return true;
    }
    if (durum.isDirectory()) {
      let tamam = true;
      for (const ad of await readdir(yol)) {
        if (!(await agaciBagIzlemedenSil(win32.join(yol, ad)))) tamam = false;
      }
      if (!tamam) return false;
      await rmdir(yol);
      return true;
    }
    await unlink(yol);
    return true;
  } catch (e) {
    return hataKodu(e) === "ENOENT";
  }
};

const transkriptKur = (kok: string): TranskriptPortu => ({
  sil: async (oturumlar): Promise<TranskriptSilmeSonucu> => {
    const sonuc: TranskriptSilmeSonucu = { silinen: 0, bulunamayan: 0, silinemeyen: 0, reddedilen: 0 };
    try {
      const gecerli = new Set<string>();
      for (const o of oturumlar) {
        if (typeof o === "string" && UUID_DESENI.test(o)) gecerli.add(o.toLowerCase());
        else sonuc.reddedilen += 1;
      }
      if (gecerli.size === 0) return sonuc;

      // Kökün doğrudan alt klasörleri; bağ olan alt klasöre girilmez.
      const projeler: string[] = [];
      try {
        for (const d of await readdir(kok, { withFileTypes: true })) {
          if (!d.isDirectory() || d.isSymbolicLink()) continue;
          if (d.name.includes("..") || d.name.includes("\\") || d.name.includes("/")) continue;
          projeler.push(d.name);
        }
      } catch {
        // kök yok ya da okunamıyor: her kimlik bulunamayan
      }

      const bulunan = new Set<string>();
      for (const proje of projeler) {
        const projeYolu = win32.join(kok, proje);
        let adlar: string[];
        try {
          adlar = await readdir(projeYolu);
        } catch {
          continue;
        }
        for (const ad of adlar) {
          if (ad.includes("\\") || ad.includes("/")) continue;
          const kucuk = ad.toLowerCase();
          for (const uuid of gecerli) {
            const tam = kucuk === uuid;
            if (!tam && !kucuk.startsWith(`${uuid}.`)) continue;
            bulunan.add(uuid);
            const yol = win32.join(projeYolu, ad);
            try {
              const durum = await lstat(yol);
              if (durum.isDirectory() && !durum.isSymbolicLink()) {
                // yalnız tam `<uuid>` dizini silinir; `<uuid>.*` adlı dizinler eşleşme değildir
                if (!tam) continue;
              } else if (tam && !durum.isSymbolicLink()) {
                continue; // `<uuid>` adlı düz dosya eşleşme değildir
              }
              if (await agaciBagIzlemedenSil(yol)) sonuc.silinen += 1;
              else sonuc.silinemeyen += 1;
            } catch {
              sonuc.silinemeyen += 1;
            }
            break;
          }
        }
      }
      for (const uuid of gecerli) if (!bulunan.has(uuid)) sonuc.bulunamayan += 1;
    } catch {
      // hiç atmaz
    }
    return sonuc;
  },
});

// ---------------------------------------------------------------------------------------------
// Ajanda ek deposu (`ek_yedegi`; sözleşme `ajanda-ekler.ts` `AjandaEkDiski`)
// ---------------------------------------------------------------------------------------------

const EK_OZETI = /^[0-9a-f]{64}$/;
const EK_ONEKI = /^[0-9a-f]{2}$/;
const EK_YARIM_DIZINI = "yarim";
const EK_ISARET_DOSYASI = "basvurusuz.json";
const EK_ONAY = ".onay";
const EK_GECICI = ".tmp";
const EK_OKUMA_PARCASI = 256 * 1024;

/** Windows'ta hedef o an açıksa yeniden adlandırma EPERM/EBUSY verebilir: kısa yeniden deneme. */
const ekYenidenAdlandir = async (kaynak: string, hedef: string): Promise<void> => {
  for (let deneme = 0; ; deneme += 1) {
    try {
      await rename(kaynak, hedef);
      return;
    } catch (e) {
      const k = hataKodu(e);
      if (deneme >= 5 || (k !== "EPERM" && k !== "EBUSY" && k !== "EACCES")) throw e;
      await new Promise<void>((coz) => setTimeout(coz, 20 * (deneme + 1)));
    }
  }
};

/** Düz dosyanın `lstat`'ı; yoksa `null`. Dizin ya da bağ (junction, sembolik) ise atar: izlenmez. */
const ekDuzDosya = async (yol: string): Promise<{ size: number; mtimeMs: number } | null> => {
  let d;
  try {
    d = await lstat(yol);
  } catch (e) {
    if (hataKodu(e) === "ENOENT" || hataKodu(e) === "ENOTDIR") return null;
    throw e;
  }
  if (!d.isFile()) throw new Error("dosya_degil");
  return d;
};

const ekVarsaSil = async (yol: string): Promise<void> => {
  if ((await ekDuzDosya(yol)) === null) return;
  try {
    await unlink(yol);
  } catch (e) {
    if (hataKodu(e) !== "ENOENT") throw e;
  }
};

/** Dizini oluşturur ve gerçek dizin olduğunu (bağ değil) doğrular. */
const ekDizinHazirla = async (yol: string): Promise<void> => {
  await mkdir(yol, { recursive: true });
  const d = await lstat(yol);
  if (!d.isDirectory() || d.isSymbolicLink()) throw new Error("ek_dizini_guvensiz");
};

/** Var olan dizin gerçek dizin mi; yoksa `false`, bağsa atar. */
const ekDizinVar = async (yol: string): Promise<boolean> => {
  let d;
  try {
    d = await lstat(yol);
  } catch (e) {
    if (hataKodu(e) === "ENOENT" || hataKodu(e) === "ENOTDIR") return false;
    throw e;
  }
  if (!d.isDirectory() || d.isSymbolicLink()) throw new Error("ek_dizini_guvensiz");
  return true;
};

const ekDizinListesi = async (yol: string): Promise<Dirent[]> => {
  try {
    return await readdir(yol, { withFileTypes: true });
  } catch (e) {
    if (hataKodu(e) === "ENOENT" || hataKodu(e) === "ENOTDIR") return [];
    throw e;
  }
};

/** Küçük veriyi geçici dosyaya yazar, diske indirir, tek adımda yerine taşır. */
const ekAtomikYaz = async (yol: string, icerik: string): Promise<void> => {
  const gecici = yol + EK_GECICI;
  const f = await open(gecici, "w");
  try {
    await f.writeFile(icerik, "utf8");
    await f.sync();
  } finally {
    await f.close().catch(bos);
  }
  try {
    await ekYenidenAdlandir(gecici, yol);
  } catch (e) {
    await unlink(gecici).catch(bos);
    throw e;
  }
};

/**
 * `kok`: `<veri kökü>\ajanda-ekler`. Yerleşim: tam dosya `<ozet[0:2]>\<ozet>`, yarım `yarim\<ozet>` ve
 * onaylı uzunluğu `yarim\<ozet>.onay`, başvurusuzluk işaretleri `basvurusuz.json`. Yol yalnız doğrulanmış
 * 64 onaltılık özetten kurulur. Veri kökünün izni (`kok-izni.ts`) alt klasörlere kalıtımla geçer.
 *
 * Çökme tutarlılığı: parça yazılır ve diske indirilir (`sync`), SONRA onay dosyası geçici addan yerine
 * taşınır. Okumada onayın ötesindeki bayt (yarım kalan yazım) kesilir; onay diskteki boydan büyükse
 * (onaylanan bayt kaybolmuş) yarım baştan alınır. Tamamlama aynı birimde tek yeniden adlandırmadır.
 */
export const ajandaEkDiskiKur = (kok: string): AjandaEkDiski => {
  const ozetli = (ozet: string): string => {
    if (typeof ozet !== "string" || !EK_OZETI.test(ozet)) throw new Error("gecersiz_ozet");
    return ozet;
  };
  const yarimDizini = join(kok, EK_YARIM_DIZINI);
  const tamDizini = (ozet: string): string => join(kok, ozetli(ozet).slice(0, 2));
  const tamYolu = (ozet: string): string => join(tamDizini(ozet), ozet);
  const yarimYolu = (ozet: string): string => join(yarimDizini, ozetli(ozet));
  const onayYolu = (ozet: string): string => yarimYolu(ozet) + EK_ONAY;

  /** Tam dosyanın yolu; kök ya da önek dizini yoksa `null`, bağsa atar. */
  const tamYoluOku = async (ozet: string): Promise<string | null> => {
    const yol = tamYolu(ozet);
    if (!(await ekDizinVar(kok)) || !(await ekDizinVar(tamDizini(ozet)))) return null;
    return yol;
  };

  const tamBoyutu = async (ozet: string): Promise<number | null> => {
    const yol = await tamYoluOku(ozet);
    if (yol === null) return null;
    return (await ekDuzDosya(yol))?.size ?? null;
  };

  const onayOku = async (ozet: string): Promise<number | null> => {
    if ((await ekDuzDosya(onayYolu(ozet))) === null) return null;
    let metin: string;
    try {
      metin = await readFile(onayYolu(ozet), "utf8");
    } catch (e) {
      if (hataKodu(e) === "ENOENT") return null;
      throw e;
    }
    if (!/^\d{1,16}$/.test(metin)) return null;
    const n = Number(metin);
    return Number.isSafeInteger(n) ? n : null;
  };

  const yarimDurumu = async (ozet: string): Promise<number | null> => {
    const yol = yarimYolu(ozet);
    if (!(await ekDizinVar(kok)) || !(await ekDizinVar(yarimDizini))) return null;
    const d = await ekDuzDosya(yol);
    if (d === null) {
      await ekVarsaSil(onayYolu(ozet));
      return null;
    }
    const onay = await onayOku(ozet);
    let n = onay ?? 0;
    // Onaylanan bayt diskte yok (dosya kısalmış): yarıma güvenilmez, baştan.
    if (n > d.size) n = 0;
    if (d.size !== n) await truncate(yol, n);
    if (onay !== null && onay !== n) await ekAtomikYaz(onayYolu(ozet), String(n));
    return n;
  };

  return {
    tamBoyutu,

    tamOku: async (ozet, ofset, azamiBayt) => {
      const yol = await tamYoluOku(ozet);
      if (yol === null || (await ekDuzDosya(yol)) === null) return new Uint8Array(0);
      const f = await open(yol, "r");
      try {
        const tampon = Buffer.alloc(Math.max(0, azamiBayt));
        let okunan = 0;
        while (okunan < tampon.length) {
          const { bytesRead } = await f.read(tampon, okunan, tampon.length - okunan, ofset + okunan);
          if (bytesRead === 0) break;
          okunan += bytesRead;
        }
        return new Uint8Array(tampon.buffer, tampon.byteOffset, okunan);
      } finally {
        await f.close().catch(bos);
      }
    },

    tamSil: async (ozet) => {
      const yol = await tamYoluOku(ozet);
      if (yol !== null) await ekVarsaSil(yol);
    },

    tamListesi: async () => {
      const liste: AjandaEkDosyasi[] = [];
      if (!(await ekDizinVar(kok))) return liste;
      for (const d of await ekDizinListesi(kok)) {
        if (!d.isDirectory() || d.isSymbolicLink() || !EK_ONEKI.test(d.name)) continue;
        for (const f of await ekDizinListesi(join(kok, d.name))) {
          if (!f.isFile() || !EK_OZETI.test(f.name) || !f.name.startsWith(d.name)) continue;
          const durum = await ekDuzDosya(join(kok, d.name, f.name)).catch(() => null);
          if (durum !== null) liste.push({ ozet: f.name, bayt: durum.size });
        }
      }
      return liste;
    },

    yarimDurumu,

    yarimaEkle: async (ozet, ofset, veri) => {
      ozetli(ozet);
      await ekDizinHazirla(kok);
      await ekDizinHazirla(yarimDizini);
      const mevcut = (await yarimDurumu(ozet)) ?? 0;
      if (mevcut !== ofset) throw new Error("ofset_uyusmuyor");
      const f = await open(yarimYolu(ozet), dosyaSabitleri.O_RDWR | dosyaSabitleri.O_CREAT);
      try {
        await f.truncate(ofset);
        let yazilan = 0;
        while (yazilan < veri.length) {
          const { bytesWritten } = await f.write(veri, yazilan, veri.length - yazilan, ofset + yazilan);
          if (bytesWritten === 0) throw new Error("yazilamadi");
          yazilan += bytesWritten;
        }
        await f.sync();
      } finally {
        await f.close().catch(bos);
      }
      const yeni = ofset + veri.length;
      await ekAtomikYaz(onayYolu(ozet), String(yeni));
      return yeni;
    },

    yarimOzeti: async (ozet) => {
      const n = (await yarimDurumu(ozet)) ?? 0;
      const h = createHash("sha256");
      if (n > 0) {
        const f = await open(yarimYolu(ozet), "r");
        try {
          const tampon = Buffer.alloc(EK_OKUMA_PARCASI);
          let ofset = 0;
          while (ofset < n) {
            const { bytesRead } = await f.read(tampon, 0, Math.min(tampon.length, n - ofset), ofset);
            if (bytesRead === 0) break;
            h.update(tampon.subarray(0, bytesRead));
            ofset += bytesRead;
          }
          if (ofset !== n) throw new Error("yarim_kisaldi");
        } finally {
          await f.close().catch(bos);
        }
      }
      return { bayt: n, ozet: h.digest("hex") };
    },

    yarimiTamamla: async (ozet) => {
      ozetli(ozet);
      await ekDizinHazirla(kok);
      await ekDizinHazirla(tamDizini(ozet));
      const hedef = tamYolu(ozet);
      if ((await ekDuzDosya(hedef)) !== null) {
        // İçerik adresli: aynı özetli dosya zaten tam.
        await ekVarsaSil(yarimYolu(ozet));
      } else {
        if ((await ekDuzDosya(yarimYolu(ozet))) === null) throw new Error("yarim_yok");
        await ekYenidenAdlandir(yarimYolu(ozet), hedef);
      }
      await ekVarsaSil(onayYolu(ozet));
    },

    yarimSil: async (ozet) => {
      ozetli(ozet);
      if (!(await ekDizinVar(kok)) || !(await ekDizinVar(yarimDizini))) return;
      await ekVarsaSil(yarimYolu(ozet));
      await ekVarsaSil(onayYolu(ozet));
      await ekVarsaSil(onayYolu(ozet) + EK_GECICI);
    },

    yarimListesi: async () => {
      if (!(await ekDizinVar(kok)) || !(await ekDizinVar(yarimDizini))) return [];
      const ozetler = new Map<string, { bayt: number; degisme_ms: number }>();
      for (const d of await ekDizinListesi(yarimDizini)) {
        if (!d.isFile()) continue;
        const ozet = d.name.slice(0, 64);
        const kuyruk = d.name.slice(64);
        if (!EK_OZETI.test(ozet) || (kuyruk !== "" && kuyruk !== EK_ONAY && kuyruk !== EK_ONAY + EK_GECICI)) continue;
        const durum = await ekDuzDosya(join(yarimDizini, d.name)).catch(() => null);
        if (durum === null) continue;
        const o = ozetler.get(ozet) ?? { bayt: 0, degisme_ms: 0 };
        if (kuyruk === "") o.bayt = durum.size;
        o.degisme_ms = Math.max(o.degisme_ms, durum.mtimeMs);
        ozetler.set(ozet, o);
      }
      return [...ozetler].map(([ozet, o]): AjandaEkYarimi => ({ ozet, ...o }));
    },

    isaretleriOku: async () => {
      const sonuc = new Map<string, number>();
      if (!(await ekDizinVar(kok))) return sonuc;
      const yol = join(kok, EK_ISARET_DOSYASI);
      let metin: string;
      try {
        if ((await ekDuzDosya(yol)) === null) return sonuc;
        metin = await readFile(yol, "utf8");
      } catch (e) {
        if (hataKodu(e) === "ENOENT") return sonuc;
        throw e;
      }
      let deger: unknown;
      try {
        deger = JSON.parse(metin);
      } catch {
        return sonuc;
      }
      if (typeof deger !== "object" || deger === null || Array.isArray(deger)) return sonuc;
      for (const [ozet, ms] of Object.entries(deger as Record<string, unknown>)) {
        if (EK_OZETI.test(ozet) && typeof ms === "number" && Number.isFinite(ms)) sonuc.set(ozet, ms);
      }
      return sonuc;
    },

    isaretleriYaz: async (isaretler) => {
      const nesne: Record<string, number> = {};
      for (const ozet of [...isaretler.keys()].sort()) nesne[ozetli(ozet)] = isaretler.get(ozet) as number;
      await ekDizinHazirla(kok);
      await ekAtomikYaz(join(kok, EK_ISARET_DOSYASI), JSON.stringify(nesne));
    },
  };
};

// ---------------------------------------------------------------------------------------------
// Fabrika
// ---------------------------------------------------------------------------------------------

export const disDunyaKur: DisDunyaFabrikasi = async ({ yollar }): Promise<DisDunya> => ({
  transkript: transkriptKur(yollar.claudeProjeleri),
  saat: saatKur(),
  zamanlayici: zamanlayiciKur(),
  rastgele: rastgeleKur(),
  dosya: dosyaPortuKur(),
  kayit: kayitKur(yollar.log),
  surec: surecKur(),
  sistem: sistemKur(),
  ws: wsKur(),
  boru: boruKur(),
  http: httpKur(),
  anahtar: await anahtarKur(yollar.anahtar),
  tekilKilit: tekilKilitKur(),
});
