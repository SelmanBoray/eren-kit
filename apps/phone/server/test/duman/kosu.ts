/**
 * H4 duman koşusu (HARNESS-H4-PLAN.md bölüm 6 ve 8): gerçek servis + gerçek `claude`, ayrı ve geçici veri
 * kökünde; bir mesaj, bir PC hafif işi, bir kesme. Gerçek süreçlerin argv/ortam/stdin kaydı H4.0 altın
 * kayıtlarıyla karşılaştırılır (`karsilastir.ts`).
 *
 *   node --disable-warning=ExperimentalWarning test/duman/kosu.ts --kuru            ne yapacağını yazar, çalıştırmaz
 *   node --disable-warning=ExperimentalWarning test/duman/kosu.ts --evet            koşar (model çağrısı yapar)
 *   node --disable-warning=ExperimentalWarning test/duman/kosu.ts --sahte-claude    prova: aynı akış, sahte claude ile
 *   node --disable-warning=ExperimentalWarning test/duman/kosu.ts --temizle <belirteç>  yarıda kalan koşuyu temizler
 *
 * Seçenekler: `--claude <claude.exe>` (yoksa PATH, sonra npm yolu; `ayar.ts` sırası), `--is-modeli-koru`
 * (PC hafif işi servisin sabit modeliyle koşar; varsayılan: kaydedici gerçek sürece `haiku` verir),
 * `--cikti <dizin>` (kayıt ve rapor; yoksa `%TEMP%\eren-duman-sonuc-<belirteç>`), `--sakla` (geçici kök silinmez).
 *
 * Çalışma dizini `apps/phone/server`. `--evet` olmadan model çağrısı yapan hiçbir adım çalışmaz.
 * `--sahte-claude` model çağrısı yapmaz: kaydedicinin arkasında `sahte-claude.ts` durur. Servis, borular,
 * eşleştirme, senaryolar, kayıt, karşılaştırma ve temizlik gerçek; yalnız claude'un çıktısı sahte.
 */
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import win32 from "node:path/win32";
import { fileURLToPath, pathToFileURL } from "node:url";
import { veriKokuIzniniSagla } from "../../../kurulum/izin.ts";
import { bosPort, surecler, tekOldur, uyu } from "../../e2e/ortak.ts";
import { Baglanti, elSik, eslestir, kimlikUret, msgId, ustMesaj } from "../../e2e/telefon.ts";
import type { Msg } from "../../e2e/telefon.ts";
import { basarili, gozlemle, karsilastir, raporla } from "./karsilastir.ts";
import { kayitlariTopla } from "./kaydedici.ts";
import type { DumanServisAyari } from "./servis.ts";
import type { DumanKaydi, KaydediciAyari, SurecKaydi } from "./tipler.ts";
import { DUMAN_KAYIT_SURUMU, DUMAN_ONEKI } from "./tipler.ts";

const DUMAN = dirname(fileURLToPath(import.meta.url));
const SERVER = join(DUMAN, "..", "..");
const SERVIS_GIRISI = join(DUMAN, "servis.ts");
const KAYDEDICI = join(DUMAN, "kaydedici.ts");
const BASLATICI_CS = join(DUMAN, "baslatici.cs");
const ONYUKLEME = join(DUMAN, "boru-yonlendir.ts");
const ESLESTIR_KOD = join(SERVER, "e2e", "eslestir-kod.ts");
const SAHTE_CLAUDE = join(DUMAN, "sahte-claude.ts");
const NODE_BAYRAK = "--disable-warning=ExperimentalWarning";

/** Modele giden metinler: kısa, kişisel veri yok. İkincisi altının kesme senaryosuyla aynı metin. */
export const METINLER = {
  mesaj: "Merhaba. Bu bir bağlantı denemesi; tek kısa cümleyle cevap ver.",
  kesme: "Uzun bir şey anlat.",
  gorev_metni: "Bu bir duman denemesi. Hicbir arac kullanma, hicbir dosyaya dokunma; raporda yapildi alanina yalniz 'tamam' yaz.",
} as const;
const UCUZ_MODEL = "haiku";

const SURE = { servisHazir: 90_000, tur: 180_000, is: 300_000, kesmeParca: 60_000, kapanis: 40_000 } as const;

// ---------------------------------------------------------------------------------------------
// Argümanlar ve günlük
// ---------------------------------------------------------------------------------------------

const arg = (ad: string): string | null => {
  const i = process.argv.indexOf(ad);
  return i >= 0 && i + 1 < process.argv.length ? (process.argv[i + 1] ?? null) : null;
};
const bayrak = (ad: string): boolean => process.argv.includes(ad);
const log = (s: string): void => {
  process.stdout.write(`${new Date().toISOString().slice(11, 19)} ${s}\n`);
};

// ---------------------------------------------------------------------------------------------
// Yoklamalar (salt okunur)
// ---------------------------------------------------------------------------------------------

/** `ayar.ts` `claudeExeBul` sırası: PATH'te `claude.exe`, sonra `%APPDATA%\npm\...\claude.exe`. */
function gercekClaudeBul(verilen: string | null): string | null {
  if (verilen !== null) return existsSync(verilen) ? verilen : null;
  for (const ham of (process.env["PATH"] ?? "").split(";")) {
    const d = ham.trim().replace(/^"(.*)"$/, "$1");
    if (d === "" || !win32.isAbsolute(d)) continue;
    const aday = win32.join(d, "claude.exe");
    if (existsSync(aday)) return aday;
  }
  const appdata = process.env["APPDATA"];
  if (appdata !== undefined && win32.isAbsolute(appdata)) {
    const aday = win32.join(appdata, "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
    if (existsSync(aday)) return aday;
  }
  return null;
}

function cscBul(): string | null {
  const w = process.env["WINDIR"] ?? "C:\\Windows";
  for (const f of ["Framework64", "Framework"]) {
    const y = win32.join(w, "Microsoft.NET", f, "v4.0.30319", "csc.exe");
    if (existsSync(y)) return y;
  }
  return null;
}

/** `\\.\pipe\` altındaki `eren*` adları: yalnız listeleme, bağlanma yok (canlı borulara dokunulmaz). */
function erenBorulari(): string[] {
  const r = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", "[System.IO.Directory]::GetFiles('\\\\.\\pipe\\') | Where-Object { $_ -like '*eren*' }"],
    { encoding: "utf8", windowsHide: true },
  );
  return (r.stdout ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim().replace(/^\\\\\.\\pipe\\/, ""))
    .filter((s) => s !== "");
}

interface Yoklama {
  node: string;
  nodeUygun: boolean;
  windows: boolean;
  claude: string | null;
  csc: string | null;
  canliBorular: string[];
  eslestirKodu: boolean;
}

function yokla(): Yoklama {
  const ana = Number(process.versions.node.split(".")[0]);
  return {
    node: process.versions.node,
    nodeUygun: ana >= 24,
    windows: process.platform === "win32",
    claude: gercekClaudeBul(arg("--claude")),
    csc: cscBul(),
    canliBorular: process.platform === "win32" ? erenBorulari().filter((b) => !b.startsWith(DUMAN_ONEKI)) : [],
    eslestirKodu: existsSync(ESLESTIR_KOD),
  };
}

// ---------------------------------------------------------------------------------------------
// Düzen
// ---------------------------------------------------------------------------------------------

interface Duzen {
  belirtec: string;
  kok: string;
  veriKoku: string;
  bin: string;
  stub: string;
  kayitDizini: string;
  proje: string;
  duman: string;
  cikti: string;
  onyukleme: string;
}

function duzenKur(belirtec: string, kokTabani = tmpdir()): Duzen {
  const kok = join(kokTabani, `${DUMAN_ONEKI}${belirtec}`);
  return {
    belirtec,
    kok,
    veriKoku: join(kok, "eren-kit"),
    bin: join(kok, "bin"),
    stub: join(kok, "bin", "claude.exe"),
    kayitDizini: join(kok, "kayit"),
    proje: join(kok, "proje"),
    duman: join(kok, "duman"),
    cikti: arg("--cikti") ?? join(kokTabani, `${DUMAN_ONEKI}sonuc-${belirtec}`),
    onyukleme: `${pathToFileURL(ONYUKLEME).href}?onek=${belirtec}`,
  };
}

const yerelAyar = (d: Duzen, port: number): Record<string, unknown> => ({
  // Altının `ayarHazirla`'sıyla aynı ad: sistem istemi bayt bayt karşılaştırılabilsin.
  kullanici_adi: "Ornek",
  eren_modeli: UCUZ_MODEL,
  ws_port: port,
  claude_exe: d.stub,
  // Var olmayan mutlak yol: medya kapalı (altının `yeni_takvim`'i medyasız). PATH'teki ffmpeg kullanılmaz.
  ffmpeg_yolu: join(d.kok, "yok", "ffmpeg.exe"),
});

/** Servisin ortamı: kullanıcının veri kökü, asistan adı ve NODE_OPTIONS'ı ezilir; LOCALAPPDATA geçici köke. */
function servisOrtami(d: Duzen): NodeJS.ProcessEnv {
  const at = new Set(["EREN_KIT_DATA_DIR", "EREN_KIT_ASSISTANT_NAME", "NODE_OPTIONS"]);
  const temel = Object.fromEntries(Object.entries(process.env).filter(([k]) => !at.has(k.toUpperCase())));
  return { ...temel, LOCALAPPDATA: d.kok, EREN_KIT_DATA_DIR: d.veriKoku };
}

function kuruYaz(y: Yoklama, d: Duzen): void {
  const satir = (s = ""): void => {
    process.stdout.write(`${s}\n`);
  };
  satir("DUMAN KOŞUSU — KURU KİP (hiçbir şey başlatılmaz, model çağrısı yok)");
  satir();
  satir("Yoklama (salt okunur):");
  satir(`  node ${y.node} ${y.nodeUygun ? "(uygun)" : "(>=24 gerekir)"}; windows: ${y.windows}`);
  satir(`  gerçek claude.exe: ${y.claude ?? "BULUNAMADI (--claude <yol>)"}`);
  satir(`  csc.exe (.NET Framework 4): ${y.csc ?? "BULUNAMADI"}`);
  satir(`  e2e/eslestir-kod.ts: ${y.eslestirKodu ? "var" : "YOK"}`);
  satir(`  canlı eren boruları: ${y.canliBorular.join(", ") || "yok"}`);
  satir(
    y.canliBorular.includes("eren-servis-tekil")
      ? "  → canlı servis çalışıyor: src/ana.ts bu makinede ikinci örnek olarak açılamaz (tekil kilit borusu sabit; açılsa `ikinci_ornek` ile çıkar)."
      : "  → tekil kilit borusu boşta; yine de sabit adlar kullanılmaz (bekçi canlı servisi her an başlatabilir).",
  );
  satir();
  satir("Engeller ve çözüm:");
  satir("  - Sabit borular (eren-servis-tekil, eren-kopru, eren-ajanda): servis ve köprüler `--import boru-yonlendir.ts?onek=<belirteç>`");
  satir(`    ile \\\\.\\pipe\\eren-duman-${d.belirtec}-* adlarını kullanır. Köprülere önyüklemeyi kaydedicinin mcp kopyası verir.`);
  satir("  - Tailscale adresi ve uzak IP denetimi: e2e/servis-giris.ts gibi sarılır (127.0.0.1:<boş port>).");
  satir("  - Bekçi ve Görev Zamanlayıcı: kullanılmaz; duman servisi düzeneğin çocuğudur, IPC yok, kapanış stdin'den.");
  satir("  - Limit kilidi (%LOCALAPPDATA%\\ClaudeLimitKilit): LOCALAPPDATA geçici köke çevrilir, canlı kilit okunmaz.");
  satir("  - ws_port: boş port; telegram/computer_use/rea ayarı yok; medya ffmpeg_yolu ile kapalı.");
  satir("  - ~/.claude: ayarlara dokunulmaz (iki oturum da --setting-sources \"\"). Gerçek claude oturum dökümünü");
  satir("    ~/.claude/projects/<geçici cwd'nin adı>'na yazar; temizlik yalnız adında belirteç geçen klasörleri siler.");
  satir();
  satir("Dizinler:");
  for (const [k, v] of Object.entries({ kok: d.kok, veriKoku: d.veriKoku, baslatici: d.stub, kayit: d.kayitDizini, proje: d.proje, cikti: d.cikti })) {
    satir(`  ${k}: ${v}`);
  }
  satir();
  satir("Adımlar:");
  satir(`  1. Kök ve ayar.local.json: ${JSON.stringify(yerelAyar(d, 0)).replace('"ws_port":0', '"ws_port":<boş port>')}`);
  satir(`  2. Başlatıcı: "${y.csc ?? "csc.exe"}" /nologo /target:exe /out:${d.stub} ${BASLATICI_CS}`);
  satir(`     + ${d.stub}.duman (node.exe, kaydedici.ts, kaydedici ayarı)`);
  const ka: KaydediciAyari = {
    gercekClaude: y.claude ?? "<claude.exe>",
    kayitDizini: d.kayitDizini,
    model: bayrak("--is-modeli-koru") ? null : UCUZ_MODEL,
    onyukleme: d.onyukleme,
  };
  satir(`     kaydedici ayarı: ${JSON.stringify(ka)}`);
  satir(`  3. Servis: node ${NODE_BAYRAK} --import ${d.onyukleme} ${SERVIS_GIRISI} <duman\\servis-ayar.json>`);
  satir(`     ortam: kullanıcınınki; EREN_KIT_DATA_DIR=${d.veriKoku}, LOCALAPPDATA=${d.kok}; EREN_KIT_ASSISTANT_NAME ve NODE_OPTIONS silinir`);
  satir("  4. Eşleştirme: e2e/eslestir-kod.ts (aynı ortam) → sahte telefon /sohbet el sıkışma.");
  satir(`  5. Mesaj: "${METINLER.mesaj}" → tur sonu bekle.`);
  satir(`  6. PC hafif işi (servis stdin'i, isler.baslat profil hafif): cwd ${d.proje}, görev "${METINLER.gorev_metni}"`);
  satir("     → job_finished, ardından ana oturumun sentetik turu.");
  satir(`  7. Kesme: "${METINLER.kesme}" → ilk metin parçasında interrupt → aborted_* bekle.`);
  satir(`  8. Kayıt: ${d.kayitDizini}\\<pid>.jsonl → ${join(d.cikti, "kayit.json")}; karşılaştırma → ${join(d.cikti, "rapor.txt")}`);
  satir("  9. Temizlik: servis kapat ({\"komut\":\"kapat\"}, 40 sn sonra ağaç öldürme), komut satırında belirteç geçen süreçler,");
  satir(`     ${d.kok} (--sakla yoksa), ~/.claude/projects/*${DUMAN_ONEKI}${d.belirtec}*.`);
  satir();
  satir(
    `Model: ana oturum ${UCUZ_MODEL} (ayar eren_modeli); PC hafif işi ${ka.model === null ? "servisin sabiti (sonnet)" : `${UCUZ_MODEL} (kaydedici gerçek argv'de değiştirir)`}.`,
  );
  satir("Beklenen model isteği: mesaj 1, iş 1-3, sentetik iş turu 1-2, kesme 1 (yarıda) → toplam yaklaşık 4-7.");
  satir("Gerçek koşu: --evet ile. Model çağrısız prova: --sahte-claude (aynı akış, kaydedicinin arkasında sahte-claude.ts).");
}

// ---------------------------------------------------------------------------------------------
// Gerçek koşu
// ---------------------------------------------------------------------------------------------

class Kosu {
  readonly d: Duzen;
  readonly y: Yoklama;
  servis: ChildProcess | null = null;
  servisPid = 0;
  sohbet: Baglanti | null = null;
  readonly kontrolYolu: string;

  constructor(d: Duzen, y: Yoklama) {
    this.d = d;
    this.y = y;
    this.kontrolYolu = join(d.duman, "kontrol.jsonl");
  }

  kur(port: number): void {
    const d = this.d;
    for (const x of [d.kok, d.bin, d.kayitDizini, d.proje, d.duman, d.cikti]) mkdirSync(x, { recursive: true });
    // Veri kökü kurulumun kuralıyla doğar (yalnız bu hesap, SYSTEM, Administrators): %TEMP%'ten kalıtılan
    // izinlerle servis açılmaz (`kok-izni.ts`). Yoksa tek adımda dar ACL ile oluşturur; kök henüz boştur.
    veriKokuIzniniSagla(d.veriKoku);
    writeFileSync(join(d.veriKoku, "ayar.local.json"), JSON.stringify(yerelAyar(d, port), null, 2));
    const csc = spawnSync(this.y.csc!, ["/nologo", "/target:exe", `/out:${d.stub}`, BASLATICI_CS], { encoding: "utf8", windowsHide: true });
    if (csc.status !== 0 || !existsSync(d.stub)) throw new Error(`baslatici_derlenemedi ${csc.stdout ?? ""}${csc.stderr ?? ""}`);
    let gercekClaude = this.y.claude!;
    if (bayrak("--sahte-claude")) {
      const sahte = join(d.kok, "sahte", "claude.exe");
      mkdirSync(dirname(sahte), { recursive: true });
      copyFileSync(d.stub, sahte);
      writeFileSync(`${sahte}.duman`, [process.execPath, SAHTE_CLAUDE, "-"].join("\r\n"), "utf8");
      gercekClaude = sahte;
    }
    const ka: KaydediciAyari = {
      gercekClaude,
      kayitDizini: d.kayitDizini,
      model: bayrak("--is-modeli-koru") ? null : UCUZ_MODEL,
      onyukleme: d.onyukleme,
    };
    const kaYolu = join(d.duman, "kaydedici-ayar.json");
    writeFileSync(kaYolu, JSON.stringify(ka, null, 2));
    writeFileSync(`${d.stub}.duman`, [process.execPath, KAYDEDICI, kaYolu].join("\r\n"), "utf8");
  }

  kontrolOlaylari(): Array<Record<string, unknown>> {
    if (!existsSync(this.kontrolYolu)) return [];
    return readFileSync(this.kontrolYolu, "utf8")
      .split("\n")
      .filter((s) => s.trim() !== "")
      .flatMap((s) => {
        try {
          return [JSON.parse(s) as Record<string, unknown>];
        } catch {
          return [];
        }
      });
  }

  async servisBaslat(port: number): Promise<void> {
    const d = this.d;
    const durum = join(d.duman, "durum.json");
    const sa: DumanServisAyari = { port, durumYolu: durum, kontrolYolu: this.kontrolYolu };
    const saYolu = join(d.duman, "servis-ayar.json");
    writeFileSync(saYolu, JSON.stringify(sa));
    const cocuk = spawn(process.execPath, [NODE_BAYRAK, "--import", d.onyukleme, SERVIS_GIRISI, saYolu], {
      cwd: SERVER,
      env: servisOrtami(d),
      stdio: ["pipe", "ignore", "pipe"],
      windowsHide: true,
    });
    cocuk.stderr?.pipe(createWriteStream(join(d.duman, "servis-stderr.log"), { flags: "a" }));
    cocuk.stdin?.on("error", () => {});
    this.servis = cocuk;
    this.servisPid = cocuk.pid ?? 0;
    const son = Date.now() + SURE.servisHazir;
    while (!existsSync(durum)) {
      if (cocuk.exitCode !== null) throw new Error(`servis_cikti kod=${cocuk.exitCode} (bkz. ${join(d.duman, "servis-stderr.log")})`);
      if (Date.now() > son) throw new Error("servis_hazir_olmadi");
      await uyu(200);
    }
    log(`duman servisi hazır pid=${this.servisPid} port=${port}`);
  }

  servisKomutu(k: Record<string, unknown>): void {
    this.servis?.stdin?.write(`${JSON.stringify(k)}\n`);
  }

  async telefonBagla(port: number): Promise<void> {
    const r = spawnSync(process.execPath, [NODE_BAYRAK, "--import", this.d.onyukleme, ESLESTIR_KOD], {
      cwd: SERVER,
      env: servisOrtami(this.d),
      encoding: "utf8",
      windowsHide: true,
    });
    if (r.status !== 0) throw new Error(`eslestirme_kodu_uretilemedi ${(r.stderr ?? "").slice(0, 300)}`);
    const { kod } = JSON.parse(r.stdout.trim()) as { kod: string };
    const b = await Baglanti.ac(`ws://127.0.0.1:${port}/sohbet`, "sohbet");
    const kimlik = kimlikUret();
    const p = await eslestir(b, kod, kimlik);
    await elSik(b, { device_id: p.device_id, kimlik, sunucuAcik: p.server_public_key, last_seq: 0 });
    this.sohbet = b;
    log("sahte telefon eşleşti ve bağlandı");
  }

  // ---- kayıttan gözlem ----

  surecler(): SurecKaydi[] {
    return kayitlariTopla(this.d.kayitDizini);
  }

  ana(): SurecKaydi | undefined {
    return this.surecler().find((s) => s.argv.includes("--input-format"));
  }

  /** Ana oturumun kullanıcı satırı ve `result` sayısı. */
  anaSayac(): { kullanici: number; sonuc: number; satir: number } {
    const a = this.ana();
    if (a === undefined) return { kullanici: 0, sonuc: 0, satir: 0 };
    const tur = (s: string): unknown => {
      try {
        return (JSON.parse(s) as { type?: unknown }).type;
      } catch {
        return null;
      }
    };
    return { kullanici: a.stdin.filter((s) => tur(s) === "user").length, sonuc: a.stdout.filter((s) => tur(s) === "result").length, satir: a.stdout.length };
  }

  async bekle(aciklama: string, ms: number, kosul: () => boolean): Promise<void> {
    const son = Date.now() + ms;
    while (!kosul()) {
      if (Date.now() > son) throw new Error(`zaman_asimi: ${aciklama}`);
      if (this.servis !== null && this.servis.exitCode !== null) throw new Error(`servis_cikti: ${aciklama}`);
      await uyu(250);
    }
  }

  /** Ana oturum boşta: her kullanıcı satırına bir `result` geldi ve 2 sn yeni satır yok. */
  async anaBosta(aciklama: string, ms = SURE.tur): Promise<void> {
    let son = this.anaSayac();
    let sabitBas = Date.now();
    await this.bekle(aciklama, ms, () => {
      const s = this.anaSayac();
      if (s.satir !== son.satir || s.kullanici !== son.kullanici) {
        son = s;
        sabitBas = Date.now();
        return false;
      }
      return s.kullanici > 0 && s.sonuc >= s.kullanici && Date.now() - sabitBas >= 2000;
    });
  }

  mesajGonder(text: string): string {
    const id = msgId("u");
    this.sohbet!.gonder(ustMesaj.userMessage(text, "ana", id));
    return id;
  }

  olayBekle(kosul: (e: Msg) => boolean, ms: number, aciklama: string): Promise<unknown> {
    return this.sohbet!.bekle((m) => m.type === "event" && kosul(m.event as Msg), ms, aciklama, 0);
  }

  // ---- senaryolar ----

  async mesaj(): Promise<void> {
    log(`senaryo 1: mesaj`);
    const once = this.anaSayac();
    this.mesajGonder(METINLER.mesaj);
    await this.bekle("mesaj stdin'e yazıldı", SURE.tur, () => this.anaSayac().kullanici > once.kullanici);
    await this.anaBosta("mesaj turu bitti");
  }

  async isHafif(): Promise<void> {
    log("senaryo 2: PC hafif işi");
    const once = this.kontrolOlaylari().length;
    this.servisKomutu({ komut: "is_hafif", plan_id: "plan_duman1", baslik: "Duman isi", cwd: this.d.proje, gorev_metni: METINLER.gorev_metni });
    await this.bekle("is_basladi", 30_000, () => this.kontrolOlaylari().slice(once).some((o) => o["olay"] === "is_basladi" || o["olay"] === "is_baslamadi"));
    const k = this.kontrolOlaylari().slice(once).find((o) => o["olay"] === "is_basladi" || o["olay"] === "is_baslamadi");
    if (k?.["olay"] !== "is_basladi") throw new Error(`is_baslamadi ${String(k?.["kod"])}`);
    await this.olayBekle((e) => e.type === "job_finished" && e.is_id === k["is_id"], SURE.is, "job_finished");
    log("  iş bitti; ana oturumun sentetik turu bekleniyor");
    // Sentetik satır işin bitişinden sonra gelir; birkaç saniye içinde yazılmazsa yine de boşta denetimi geçer.
    const kul = this.anaSayac().kullanici;
    await this.bekle("sentetik satır", 30_000, () => this.anaSayac().kullanici > kul).catch(() => log("  sentetik satır 30 sn içinde gelmedi"));
    await this.anaBosta("sentetik tur bitti");
  }

  async kesme(): Promise<void> {
    log("senaryo 3: kesme");
    const once = this.anaSayac();
    this.mesajGonder(METINLER.kesme);
    await this.bekle("kesme mesajı stdin'e yazıldı", SURE.tur, () => this.anaSayac().kullanici > once.kullanici);
    const satirBasi = this.ana()?.stdout.length ?? 0;
    await this.bekle("ilk metin parçası", SURE.kesmeParca, () =>
      (this.ana()?.stdout.slice(satirBasi) ?? []).some((s) => s.includes('"text_delta"') || s.includes('"type":"result"')),
    );
    this.sohbet!.gonder(ustMesaj.interrupt("ana"));
    log("  interrupt gönderildi");
    await this.anaBosta("kesilen tur bitti");
    await this.olayBekle((e) => e.type === "turn_aborted", 10_000, "turn_aborted").then(
      () => log("  telefon turn_aborted aldı"),
      () => log("  telefon turn_aborted almadı (tur kesilmeden bitmiş olabilir)"),
    );
  }

  kayitTopla(): DumanKaydi {
    const gorev = this.kontrolOlaylari().find((o) => o["olay"] === "is_basladi")?.["gorev_yolu"];
    return {
      surum: DUMAN_KAYIT_SURUMU,
      esleme: { veriKoku: this.d.veriKoku, localAppData: this.d.kok, proje: this.d.proje, claudeExe: this.d.stub, nodeExe: process.execPath },
      gonderilen: { ...METINLER },
      surecler: this.surecler(),
      gorev_txt: typeof gorev === "string" && existsSync(gorev) ? readFileSync(gorev, "utf8") : null,
    };
  }

  async kapat(): Promise<void> {
    this.sohbet?.kapat();
    const s = this.servis;
    if (s === null || s.exitCode !== null) return;
    this.servisKomutu({ komut: "kapat" });
    const son = Date.now() + SURE.kapanis;
    while (s.exitCode === null && Date.now() < son) await uyu(200);
    if (s.exitCode === null) {
      log("servis düzenli kapanmadı: ağaç öldürülüyor");
      spawnSync("taskkill.exe", ["/F", "/T", "/PID", String(this.servisPid)], { windowsHide: true });
    } else log(`servis kapandı (kod ${s.exitCode})`);
  }
}

// ---------------------------------------------------------------------------------------------
// Temizlik
// ---------------------------------------------------------------------------------------------

/** Komut satırında belirteç geçen süreçler (başlatıcı, kaydedici, gerçek claude, köprüler); düzeneğin atası hariç. */
function belirtecSurecleri(belirtec: string): Array<{ pid: number; ad: string }> {
  const liste = surecler();
  const atalar = new Set<number>();
  for (let p: number | undefined = process.pid; p !== undefined && !atalar.has(p); p = liste.find((x) => x.pid === p)?.ppid) atalar.add(p);
  const iz = `${DUMAN_ONEKI}${belirtec}`.toLowerCase();
  return liste
    .filter((s) => !atalar.has(s.pid) && (s.komut.toLowerCase().includes(iz) || s.komut.includes(`onek=${belirtec}`)))
    .filter((s) => !s.komut.includes("kosu.ts"))
    .map((s) => ({ pid: s.pid, ad: s.ad }));
}

async function temizle(belirtec: string, sakla: boolean): Promise<string[]> {
  const rapor: string[] = [];
  for (let tur = 0; tur < 3; tur++) {
    const kalan = belirtecSurecleri(belirtec);
    if (kalan.length === 0) break;
    for (const s of kalan) {
      tekOldur(s.pid);
      rapor.push(`öldürüldü pid=${s.pid} ${s.ad}`);
    }
    await uyu(1000);
  }
  rapor.push(`belirteçli süreç kalmadı: ${belirtecSurecleri(belirtec).length === 0}`);
  const kalanBoru = erenBorulari().filter((b) => b.startsWith(`${DUMAN_ONEKI}${belirtec}-`));
  rapor.push(`duman boruları: ${kalanBoru.join(", ") || "kapandı"}`);
  const kok = join(realpathSync.native(tmpdir()), `${DUMAN_ONEKI}${belirtec}`);
  if (!sakla && existsSync(kok)) {
    for (let i = 0; i < 5; i++) {
      try {
        rmSync(kok, { recursive: true, force: true });
        break;
      } catch {
        await uyu(1000);
      }
    }
    rapor.push(`geçici kök silindi: ${!existsSync(kok)}`);
  } else if (sakla) rapor.push(`geçici kök saklandı: ${kok}`);
  // Gerçek claude'un geçici cwd'ler için açtığı döküm klasörleri (ad, yolun harf-rakam dışı karakterleri '-' ile).
  const projeler = join(homedir(), ".claude", "projects");
  if (existsSync(projeler)) {
    const iz = `${DUMAN_ONEKI}${belirtec}`.toLowerCase();
    for (const ad of readdirSync(projeler).filter((a) => a.toLowerCase().includes(iz))) {
      rmSync(join(projeler, ad), { recursive: true, force: true });
      rapor.push(`~/.claude/projects/${ad} silindi`);
    }
  }
  return rapor;
}

// ---------------------------------------------------------------------------------------------
// Giriş
// ---------------------------------------------------------------------------------------------

async function ana(): Promise<number> {
  const temizlenecek = arg("--temizle");
  if (temizlenecek !== null) {
    if (!/^[0-9a-f]{12}$/.test(temizlenecek)) throw new Error("--temizle <12 hane onaltılık belirteç>");
    for (const s of await temizle(temizlenecek, false)) log(s);
    return 0;
  }
  const y = yokla();
  const belirtec = randomBytes(6).toString("hex");
  const kokTabani = realpathSync.native(tmpdir());
  const d = duzenKur(belirtec, kokTabani);
  const sahte = bayrak("--sahte-claude");
  if (bayrak("--kuru") || (!bayrak("--evet") && !sahte)) {
    kuruYaz(y, d);
    if (!bayrak("--kuru")) process.stdout.write("\n--evet verilmedi: koşu başlatılmadı.\n");
    return 0;
  }
  const eksik = [
    !y.windows && "windows",
    !y.nodeUygun && "node>=24",
    y.claude === null && !sahte && "claude.exe",
    y.csc === null && "csc.exe",
    !y.eslestirKodu && "e2e/eslestir-kod.ts",
  ].filter((x): x is string => typeof x === "string");
  if (eksik.length > 0) throw new Error(`ön koşul eksik: ${eksik.join(", ")}`);

  if (sahte) {
    y.claude = SAHTE_CLAUDE;
    log("PROVA: sahte claude (model çağrısı yok; davranış denetimleri kanıt değildir)");
  }
  log(`belirteç ${belirtec}; kök ${d.kok}`);
  log(`canlı eren boruları (dokunulmaz): ${y.canliBorular.join(", ") || "yok"}`);
  const k = new Kosu(d, y);
  let kayit: DumanKaydi | null = null;
  let hata: string | null = null;
  try {
    const port = await bosPort();
    k.kur(port);
    await k.servisBaslat(port);
    const borular = erenBorulari().filter((b) => b.startsWith(`${DUMAN_ONEKI}${belirtec}-`));
    log(`duman boruları: ${borular.join(", ")}`);
    await k.telefonBagla(port);
    await k.bekle("ana oturum süreci", SURE.tur, () => k.ana() !== undefined).catch(() => log("ana oturum açılışta başlamadı; ilk mesajla başlayacak"));
    await k.mesaj();
    await k.isHafif();
    await k.kesme();
  } catch (e) {
    hata = e instanceof Error ? e.message : String(e);
    log(`HATA: ${hata}`);
  } finally {
    try {
      kayit = k.kayitTopla();
    } catch (e) {
      log(`kayıt toplanamadı: ${e instanceof Error ? e.message : String(e)}`);
    }
    await k.kapat();
    // Teşhis dosyaları kök silinmeden çıktıya (servis günlüğü değer değil alan adı yazar; jeton yok).
    const teshis = join(d.cikti, "teshis");
    mkdirSync(teshis, { recursive: true });
    for (const [ad, yol] of [
      ["servis-stderr.log", join(d.duman, "servis-stderr.log")],
      ["kontrol.jsonl", join(d.duman, "kontrol.jsonl")],
      ["servis.log", join(d.veriKoku, "logs", "servis.log")],
    ] as const) {
      if (existsSync(yol)) copyFileSync(yol, join(teshis, ad));
    }
    // Boru listesi kapanıştan sonra: canlı borular yerinde mi.
    const sonra = erenBorulari().filter((b) => !b.startsWith(DUMAN_ONEKI));
    log(`canlı eren boruları kapanıştan sonra: ${sonra.join(", ") || "yok"} (önce: ${y.canliBorular.join(", ") || "yok"})`);
    for (const s of await temizle(belirtec, bayrak("--sakla"))) log(`temizlik: ${s}`);
  }
  if (kayit === null) return 1;
  mkdirSync(d.cikti, { recursive: true });
  writeFileSync(join(d.cikti, "kayit.json"), JSON.stringify(kayit, null, 2));
  const s = karsilastir(kayit);
  const g = gozlemle(kayit);
  const rapor = `${sahte ? "PROVA (sahte claude): stdout sahte, davranış denetimleri kanıt değildir\n" : ""}${raporla("argv / stdin / ortam / mcp ↔ altın", s)}\n${raporla("davranış (stdout)", g)}\n${hata === null ? "" : `koşu hatası: ${hata}\n`}`;
  writeFileSync(join(d.cikti, "rapor.txt"), rapor);
  process.stdout.write(`\n${rapor}`);
  const ok = hata === null && basarili(s) && basarili(g);
  process.stdout.write(`SONUC: ${ok ? "BASARILI" : "BASARISIZ"} (kayıt ve rapor: ${d.cikti})\n`);
  return ok ? 0 : 1;
}

if (import.meta.main) {
  ana().then(
    (kod) => process.exit(kod),
    (e: unknown) => {
      process.stderr.write(`duman: ${e instanceof Error ? e.message : String(e)}\n`);
      process.exit(2);
    },
  );
}
