// Telefon servisinin bekçisini oturum açılışında ve 5 dakikada bir başlatan Görev Zamanlayıcı görevi.
// Kullanım: node --disable-warning=ExperimentalWarning kurulum/gorev-kaydet.ts [--goster | --sil] [--eski-koku-yoksay]
// Görev adı EREN_KIT_PHONE_TASK_NAME (yoksa eren-kit-telefon), uygulama kökü <veri kökü>\uygulama: ortam.ts.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ESKI_KOK_BAYRAGI,
  eskiKurulumSorunlari,
  gorevAdi,
  kaliciOrtamKarsilastir,
  kaliciOrtamOku,
  uygulamaKoku,
  veriKoku,
} from "./ortam.ts";

// Ana blokta SystemRoot'tan türetmek imzayı bozardı; sözleşme bu sabit kalıbı ister.
const CONHOST = "C:\\Windows\\System32\\conhost.exe";

const kacis = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

// baslangic: yerel saat, YYYY-MM-DDTHH:MM:SS (kayıt anı). LogonTrigger tekrarı yalnız sonraki oturum
// açılışında başlar; TimeTrigger kayıttan hemen sonra 5 dakikalık tekrarı başlatır.
export const gorevXml = (o: {
  kullanici: string;
  nodeExe: string;
  uygulamaKok: string;
  baslangic: string;
}): string => {
  const kok = o.uygulamaKok.replace(/[\\/]+$/, "");
  const guncel = `${kok}\\guncel`;
  const bekci = `${guncel}\\server\\src\\bekci-ana.ts`;
  const ana = `${guncel}\\server\\src\\ana.ts`;
  const argumanlar =
    `--headless "${o.nodeExe}" --disable-warning=ExperimentalWarning "${bekci}" --ana "${ana}"`;
  const kullanici = kacis(o.kullanici);
  return [
    `<?xml version="1.0" encoding="UTF-16"?>`,
    `<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">`,
    `  <RegistrationInfo><Description>eren-kit telefon bekçisi: oturum açılışında ve 5 dakikada bir başlatır</Description></RegistrationInfo>`,
    `  <Triggers>`,
    `    <LogonTrigger>`,
    `      <Enabled>true</Enabled>`,
    `      <UserId>${kullanici}</UserId>`,
    `    </LogonTrigger>`,
    `    <TimeTrigger>`,
    `      <Repetition><Interval>PT5M</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition>`,
    `      <StartBoundary>${kacis(o.baslangic)}</StartBoundary>`,
    `      <Enabled>true</Enabled>`,
    `    </TimeTrigger>`,
    `  </Triggers>`,
    `  <Principals>`,
    `    <Principal id="Author"><UserId>${kullanici}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal>`,
    `  </Principals>`,
    `  <Settings>`,
    `    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>`,
    `    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>`,
    `    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>`,
    `    <AllowHardTerminate>true</AllowHardTerminate>`,
    `    <StartWhenAvailable>true</StartWhenAvailable>`,
    `    <AllowStartOnDemand>true</AllowStartOnDemand>`,
    `    <Enabled>true</Enabled>`,
    `    <Hidden>true</Hidden>`,
    `    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>`,
    `    <Priority>5</Priority>`, // 4-6 = normal sınıf; 7-8 normalin altı olurdu ve çocuklara geçerdi
    `  </Settings>`,
    `  <Actions Context="Author">`,
    `    <Exec>`,
    `      <Command>${kacis(CONHOST)}</Command>`,
    `      <Arguments>${kacis(argumanlar)}</Arguments>`,
    `      <WorkingDirectory>${kacis(guncel)}</WorkingDirectory>`,
    `    </Exec>`,
    `  </Actions>`,
    `</Task>`,
    ``,
  ].join("\r\n");
};

const calistir = (komut: string, args: readonly string[]): { kod: number; cikti: Buffer; hata: string } => {
  try {
    const cikti = execFileSync(komut, [...args], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { kod: 0, cikti, hata: "" };
  } catch (e) {
    const h = e as { status?: number | null; stdout?: Buffer; stderr?: Buffer };
    return {
      kod: typeof h.status === "number" ? h.status : 1,
      cikti: h.stdout ?? Buffer.alloc(0),
      hata: `${h.stderr?.toString("latin1") ?? ""}${h.stdout?.toString("latin1") ?? ""}`.trim(),
    };
  }
};

const yerelZaman = (d: Date): string => {
  const i = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${i(d.getMonth() + 1)}-${i(d.getDate())}T${i(d.getHours())}:${i(d.getMinutes())}:${i(d.getSeconds())}`;
};

const kullaniciAl =(): string => {
  // PATH'teki (ör. Git Bash) başka bir whoami'ye düşmemek için Windows'unkini yolundan çağır.
  const kok = process.env["SystemRoot"] ?? process.env["windir"] ?? "C:\\Windows";
  const s = calistir(join(kok, "System32", "whoami.exe"), []);
  const k = s.cikti.toString("utf8").trim();
  if (s.kod !== 0 || k === "") throw new Error("whoami çalışmadı");
  return k;
};

const metin = (b: Buffer): string =>
  b.length >= 2 && ((b[0] === 0xff && b[1] === 0xfe) || (b.length > 3 && b[1] === 0))
    ? b.toString("utf16le").replace(/^\uFEFF/, "")
    : b.toString("utf8");

if (import.meta.main) {
  const argumanlar = process.argv.slice(2);
  const eskiKokuYoksay = argumanlar.includes(ESKI_KOK_BAYRAGI);
  const digerleri = argumanlar.filter((a) => a !== ESKI_KOK_BAYRAGI);
  const bayrak = digerleri[0];
  const hataCik = (mesaj: string): never => {
    process.stderr.write(`${mesaj}\n`);
    process.exit(1);
  };
  const erisimHatasi = (m: string): boolean => /eri.im engellendi|access is denied/i.test(m);
  let gorev = "";
  let kok = "";
  try {
    gorev = gorevAdi(process.env);
    kok = uygulamaKoku(veriKoku(process.env));
  } catch (e) {
    hataCik(e instanceof Error ? e.message : String(e));
  }
  if (digerleri.length > 1) hataCik("Kullanım: gorev-kaydet.ts [--goster | --sil] [--eski-koku-yoksay]");

  if (bayrak === "--sil") {
    const s = calistir("schtasks", ["/delete", "/tn", gorev, "/f"]);
    if (s.kod !== 0) {
      hataCik(erisimHatasi(s.hata) ? "Erişim engellendi: görev silinemedi." : `Görev silinemedi: ${s.hata}`);
    }
    process.stdout.write(`Görev silindi: ${gorev}\n`);
  } else if (bayrak === undefined || bayrak === "--goster") {
    const xml = gorevXml({
      kullanici: kullaniciAl(),
      nodeExe: process.execPath,
      uygulamaKok: kok,
      baslangic: yerelZaman(new Date()),
    });
    if (bayrak === "--goster") {
      process.stdout.write(xml);
    } else {
      // Kaydetmeden önce: ikinci görev (iki servis) ya da ikinci veri kökü (bölünmüş veri) doğmasın;
      // görevin başlatacağı servis kalıcı ortamı görür, bu kabuktakini değil.
      const gorevVar = (ad: string): boolean => calistir("schtasks", ["/query", "/tn", ad]).kod === 0;
      const cakismalar = eskiKurulumSorunlari(process.env, { gorevVar, varMi: existsSync }, { eskiKokuYoksay });
      const { hatalar, uyarilar } = kaliciOrtamKarsilastir(process.env, kaliciOrtamOku());
      for (const u of uyarilar) process.stderr.write(`UYARI: ${u}\n`);
      const tum = [...cakismalar, ...hatalar];
      if (tum.length > 0) hataCik(`Görev kaydedilmedi, hiçbir şey değişmedi:\n- ${tum.join("\n- ")}`);
      const dizin = mkdtempSync(join(tmpdir(), "eren-gorev-"));
      const dosya = join(dizin, "gorev.xml");
      try {
        writeFileSync(dosya, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, "utf16le")]));
        const s = calistir("schtasks", ["/create", "/xml", dosya, "/tn", gorev, "/f"]);
        if (s.kod !== 0) {
          hataCik(erisimHatasi(s.hata) ? "Erişim engellendi: görev kaydedilemedi." : `Görev kaydedilemedi: ${s.hata}`);
        }
      } finally {
        rmSync(dizin, { recursive: true, force: true });
      }
      const q = calistir("schtasks", ["/query", "/tn", gorev, "/xml"]);
      if (q.kod !== 0) hataCik(`Kayıt doğrulanamadı: ${q.hata}`);
      const kayit = metin(q.cikti);
      const blok = (etiket: string): string | null =>
        new RegExp(`<${etiket}(?:\\s[^>]*)?>([\\s\\S]*?)</${etiket}>`).exec(kayit)?.[1] ?? null;
      const deger = (kapsam: string | null, etiket: string): string | null =>
        kapsam === null ? null : (new RegExp(`<${etiket}>([^<]*)</${etiket}>`).exec(kapsam)?.[1]?.trim() ?? null);
      // Windows varsayılan değeri /query /xml çıktısına yazmaz: yok = varsayılan.
      const kontrol = (ad: string, kapsam: string | null, etiket: string, beklenenDeger: string, varsayilan: string | null): string | null => {
        const v = deger(kapsam, etiket) ?? varsayilan;
        return v === beklenenDeger ? null : `${ad} (bulunan: ${v ?? "yok"})`;
      };
      const mantik = blok("LogonTrigger");
      const zaman = blok("TimeTrigger");
      const ayarlar = blok("Settings");
      const asil = blok("Principal");
      const tekrar = zaman === null ? null : (/<Repetition>([\s\S]*?)<\/Repetition>/.exec(zaman)?.[1] ?? null);
      const sorunlar: (string | null)[] = [
        mantik === null ? "LogonTrigger yok" : /<Repetition>/.test(mantik) ? "LogonTrigger tekrarsız olmalı" : null,
        zaman === null ? "TimeTrigger yok" : null,
        kontrol("TimeTrigger Repetition Interval=PT5M", tekrar, "Interval", "PT5M", null),
        kontrol("TimeTrigger StopAtDurationEnd=false", tekrar, "StopAtDurationEnd", "false", "false"),
        tekrar !== null && /<Duration>/.test(tekrar) ? "TimeTrigger tekrarının süre sınırı olmamalı" : null,
        zaman !== null && !/<StartBoundary>/.test(zaman) ? "TimeTrigger StartBoundary yok" : null,
        kontrol("TimeTrigger Enabled=true", zaman, "Enabled", "true", "true"),
        kontrol("LogonType=InteractiveToken", asil, "LogonType", "InteractiveToken", null),
        kontrol("RunLevel=LeastPrivilege", asil, "RunLevel", "LeastPrivilege", "LeastPrivilege"),
        kontrol("ExecutionTimeLimit=PT0S", ayarlar, "ExecutionTimeLimit", "PT0S", "PT72H"),
        kontrol("DisallowStartIfOnBatteries=false", ayarlar, "DisallowStartIfOnBatteries", "false", "true"),
        kontrol("StopIfGoingOnBatteries=false", ayarlar, "StopIfGoingOnBatteries", "false", "true"),
        kontrol("MultipleInstancesPolicy=IgnoreNew", ayarlar, "MultipleInstancesPolicy", "IgnoreNew", "IgnoreNew"),
        kontrol("StartWhenAvailable=true", ayarlar, "StartWhenAvailable", "true", "false"),
        kontrol("Hidden=true", ayarlar, "Hidden", "true", "false"),
        kontrol("Enabled=true", ayarlar, "Enabled", "true", "true"),
      ];
      const eksik = sorunlar.filter((s): s is string => s !== null);
      if (eksik.length > 0) hataCik(`Kayıt beklenenle uyuşmuyor, eksik: ${eksik.join(", ")}`);
      process.stdout.write(`Görev kaydedildi ve doğrulandı: ${gorev}\n`);
    }
  } else {
    hataCik("Kullanım: gorev-kaydet.ts [--goster | --sil] [--eski-koku-yoksay]");
  }
}
