/**
 * Gerçek ffmpeg/ffprobe ile `medya-isle` (S3a). ffmpeg PATH'te yoksa bütün dosya, whisper modeli yoksa döküm
 * testleri atlanır. Girdiler geçici dizinde lavfi ile üretilir (repoya ikili dosya konmaz); süreç, `cwd` = veri
 * kökü ve göreli yollarla, gerçek `aracCalistir`'ın anlamıyla (stdin kapalı, zaman aşımında öldür) çalışır.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { medyaIsleyiciKur } from "../src/medya-isle.ts";
import type { AracIstegi, AracSonucu, MedyaAyari, MedyaBicimi, MedyaDosyaAdi, MedyaIsleyici } from "../src/sozlesme.ts";
import { SAHTE_MEDYA_SINIRLARI } from "./sahte.ts";

const nerede = (ad: string): string | null => {
  const r = spawnSync("where.exe", [ad], { encoding: "utf8", windowsHide: true });
  const ilk = r.status === 0 ? r.stdout.split(/\r?\n/)[0]?.trim() : undefined;
  return ilk !== undefined && ilk !== "" ? ilk : null;
};
const FFMPEG = process.platform === "win32" ? nerede("ffmpeg") : null;
const FFPROBE = process.platform === "win32" ? nerede("ffprobe") : null;
const ARAC_YOK = FFMPEG === null || FFPROBE === null ? "ffmpeg/ffprobe PATH'te yok" : false;

const MODEL_ADI = "ggml-large-v3-turbo-q5_0.bin";
const MODEL = process.env["LOCALAPPDATA"] === undefined ? null : join(process.env["LOCALAPPDATA"], "eren-kit", "modeller", MODEL_ADI);
const MODEL_YOK = ARAC_YOK || (MODEL === null || !existsSync(MODEL) ? "whisper modeli yok" : false);

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

let kok = "";
const yol = (no: number, ad: MedyaDosyaAdi): string => join(kok, "medya", String(no), ad);
const dosya = {
  yol,
  goreliYol: (no: number, ad: MedyaDosyaAdi): string => `medya/${no}/${ad}`,
};
const isleyiciKur = (ust: Partial<MedyaAyari> = {}): MedyaIsleyici =>
  medyaIsleyiciKur({
    surec: { aracCalistir },
    ayar: {
      kok: join(kok, "medya"),
      ffmpeg: FFMPEG ?? "",
      ffprobe: FFPROBE ?? "",
      dokumModeli: null,
      dokumVadModeli: null,
      dokumDili: "auto",
      kotaBayt: 1024 * 1024 * 1024,
      sinirlar: SAHTE_MEDYA_SINIRLARI,
      ...ust,
    },
    veriKoku: kok,
    dosya,
  });

let sayac = 0;
/** Yeni `medya/<no>/` dizini; `uret` ffmpeg argv'siyle `asil.<bicim>`'i üretir. */
const ek = (bicim: MedyaBicimi, uret: (cikti: string) => readonly string[]): number => {
  const no = ++sayac;
  mkdirSync(join(kok, "medya", String(no)), { recursive: true });
  ffmpeg(uret(yol(no, `asil.${bicim}`)));
  return no;
};
const ffmpeg = (argv: readonly string[]): void => {
  const r = spawnSync(FFMPEG as string, ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", ...argv], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(r.status, 0, `girdi üretilemedi: ${r.stderr}`);
};
const boyut = (p: string): { genislik: number; yukseklik: number } => {
  const r = spawnSync(FFPROBE as string, ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", p], {
    encoding: "utf8",
    windowsHide: true,
  });
  const [w, h] = r.stdout.trim().split(",").map(Number);
  return { genislik: w as number, yukseklik: h as number };
};
const basBaytlari = (p: string): Uint8Array => readFileSync(p).subarray(0, 64);
const var_ = (p: string): boolean => existsSync(p) && statSync(p).size > 0;

/** En küçük EXIF APP1 (big-endian TIFF): `Make` = "ErenTestMake", `Orientation` = `yon`. SOI'nin hemen ardına. */
const exifEkle = (jpeg: Uint8Array, yon: number): Uint8Array => {
  const make = Buffer.from("ErenTestMake\0", "ascii");
  const ifdBoy = 2 + 2 * 12 + 4;
  const tiff = Buffer.alloc(8 + ifdBoy + make.length);
  tiff.write("MM", 0, "ascii");
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4);
  tiff.writeUInt16BE(2, 8);
  tiff.writeUInt16BE(0x010f, 10);
  tiff.writeUInt16BE(2, 12);
  tiff.writeUInt32BE(make.length, 14);
  tiff.writeUInt32BE(8 + ifdBoy, 18);
  tiff.writeUInt16BE(0x0112, 22);
  tiff.writeUInt16BE(3, 24);
  tiff.writeUInt32BE(1, 26);
  tiff.writeUInt16BE(yon, 30);
  tiff.writeUInt32BE(0, 34);
  make.copy(tiff, 8 + ifdBoy);
  const govde = Buffer.concat([Buffer.from("Exif\0\0", "ascii"), tiff]);
  const bas = Buffer.alloc(4);
  bas.writeUInt16BE(0xffe1, 0);
  bas.writeUInt16BE(govde.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), bas, govde, jpeg.subarray(2)]);
};
const icerir = (b: Uint8Array, s: string): boolean => Buffer.from(b).includes(Buffer.from(s, "latin1"));

describe("medya-isle: gerçek ffmpeg", { skip: ARAC_YOK }, () => {
  before(() => {
    kok = mkdtempSync(join(tmpdir(), "eren-medya-isle-"));
  });
  after(() => {
    if (kok !== "") rmSync(kok, { recursive: true, force: true });
  });

  it("20 sn video: ölçüm, 3 kare, kare boyutu 768x432, kareler farklı", async () => {
    const i = isleyiciKur();
    const no = ek("mp4", (c) => [
      "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=20",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=20",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", c,
    ]);
    assert.equal(i.kokla(basBaytlari(yol(no, "asil.mp4"))), "mp4");
    const o = await i.olc(no, "mp4");
    assert.ok(o !== null);
    assert.ok(o.sure_ms !== null && Math.abs(o.sure_ms - 20_000) <= 100, String(o.sure_ms));
    assert.deepEqual({ ...o, sure_ms: 0 }, { sure_ms: 0, genislik: 1280, yukseklik: 720, video_akisi: true, ses_akisi: true });

    const zamanlar = i.kareZamanlari(o.sure_ms);
    assert.equal(zamanlar.length, 3);
    const kareler: Uint8Array[] = [];
    for (const [k, z] of zamanlar.entries()) {
      const sira = (k + 1) as 1 | 2 | 3;
      assert.deepEqual(await i.kareUret(no, "mp4", sira, z), { zamanAsimi: false });
      const p = yol(no, `kare-0${sira}.jpg`);
      assert.ok(var_(p), p);
      assert.deepEqual(boyut(p), { genislik: 768, yukseklik: 432 });
      kareler.push(readFileSync(p));
    }
    assert.ok(!Buffer.from(kareler[0] as Uint8Array).equals(Buffer.from(kareler[2] as Uint8Array)));
  });

  it("portre video (görüntü matrisi 90°): ölçüm 720x1280, kare 432x768", async () => {
    const i = isleyiciKur();
    const no = ek("mp4", (c) => [
      "-display_rotation:v", "90", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=15:duration=3",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", c,
    ]);
    const o = await i.olc(no, "mp4");
    assert.equal(o?.genislik, 720);
    assert.equal(o?.yukseklik, 1280);
    assert.equal(o?.ses_akisi, false);
    assert.deepEqual(await i.kareUret(no, "mp4", 1, 1500), { zamanAsimi: false });
    assert.deepEqual(boyut(yol(no, "kare-01.jpg")), { genislik: 432, yukseklik: 768 });
  });

  it("demuxer tablosu: mov, 3gp, webm koklanır, ölçülür, kare verir", async () => {
    const i = isleyiciKur();
    const durumlar: [MedyaBicimi, string[]][] = [
      ["mov", ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-f", "mov"]],
      ["3gp", ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-f", "3gp"]],
      ["webm", ["-c:v", "libvpx-vp9", "-b:v", "300k", "-f", "webm"]],
    ];
    for (const [bicim, kodlama] of durumlar) {
      const no = ek(bicim, (c) => ["-f", "lavfi", "-i", "testsrc2=size=640x480:rate=15:duration=2", ...kodlama, c]);
      assert.equal(i.kokla(basBaytlari(yol(no, `asil.${bicim}`))), bicim, bicim);
      const o = await i.olc(no, bicim);
      assert.ok(o !== null && o.video_akisi && o.genislik === 640 && o.yukseklik === 480, bicim);
      assert.ok(o.sure_ms !== null && Math.abs(o.sure_ms - 2000) <= 100, `${bicim} ${o.sure_ms}`);
      assert.deepEqual(await i.kareUret(no, bicim, 1, 1000), { zamanAsimi: false });
      assert.deepEqual(boyut(yol(no, "kare-01.jpg")), { genislik: 640, yukseklik: 480 }, bicim);
    }
  });

  it("fotoğraf biçimleri: jpg, png, webp → gorsel.jpg; büyük görsel uzun kenar ve alan sınırına iner", async () => {
    const i = isleyiciKur();
    for (const [bicim, kodlama] of [
      ["jpg", ["-c:v", "mjpeg", "-f", "image2"]],
      ["png", ["-c:v", "png", "-f", "image2"]],
      ["webp", ["-c:v", "libwebp", "-f", "webp"]],
    ] as [MedyaBicimi, string[]][]) {
      const no = ek(bicim, (c) => ["-f", "lavfi", "-i", "testsrc2=size=800x600", "-frames:v", "1", "-update", "1", ...kodlama, c]);
      assert.equal(i.kokla(basBaytlari(yol(no, `asil.${bicim}`))), bicim, bicim);
      assert.deepEqual(await i.gorselUret(no, bicim), { zamanAsimi: false });
      const g = yol(no, "gorsel.jpg");
      assert.equal(i.kokla(basBaytlari(g)), "jpg");
      assert.deepEqual(boyut(g), { genislik: 800, yukseklik: 600 }, bicim);
    }
    const no = ek("png", (c) => ["-f", "lavfi", "-i", "testsrc2=size=4000x3000", "-frames:v", "1", "-update", "1", c]);
    assert.deepEqual(await i.gorselUret(no, "png"), { zamanAsimi: false });
    const b = boyut(yol(no, "gorsel.jpg"));
    assert.deepEqual(b, { genislik: 1238, yukseklik: 928 });
    assert.ok(b.genislik * b.yukseklik <= SAHTE_MEDYA_SINIRLARI.gorselPiksel);
  });

  it("portre JPEG'de yön: doğal portre korunur; EXIF yönü 6 olan yatay JPEG portreye döner, 3 yatay kalır", async () => {
    const i = isleyiciKur();
    const portre = ek("jpg", (c) => ["-f", "lavfi", "-i", "testsrc2=size=600x800", "-frames:v", "1", "-update", "1", c]);
    assert.deepEqual(await i.gorselUret(portre, "jpg"), { zamanAsimi: false });
    assert.deepEqual(boyut(yol(portre, "gorsel.jpg")), { genislik: 600, yukseklik: 800 });

    for (const [yon, beklenen] of [
      [6, { genislik: 600, yukseklik: 800 }],
      [8, { genislik: 600, yukseklik: 800 }],
      [3, { genislik: 800, yukseklik: 600 }],
    ] as const) {
      const no = ek("jpg", (c) => ["-f", "lavfi", "-i", "testsrc2=size=800x600", "-frames:v", "1", "-update", "1", c]);
      writeFileSync(yol(no, "asil.jpg"), exifEkle(readFileSync(yol(no, "asil.jpg")), yon));
      const o = await i.olc(no, "jpg");
      assert.deepEqual(o, { sure_ms: null, ...beklenen, video_akisi: true, ses_akisi: false }, `yön ${yon}`);
      assert.deepEqual(await i.gorselUret(no, "jpg"), { zamanAsimi: false });
      assert.deepEqual(boyut(yol(no, "gorsel.jpg")), beklenen, `yön ${yon}`);
    }
  });

  it("EXIF'li girdinin gorsel.jpg'sinde EXIF yok (APP1, 'Exif', Make değeri)", async () => {
    const i = isleyiciKur();
    const no = ek("jpg", (c) => ["-f", "lavfi", "-i", "testsrc2=size=640x480", "-frames:v", "1", "-update", "1", c]);
    const girdi = exifEkle(readFileSync(yol(no, "asil.jpg")), 6);
    writeFileSync(yol(no, "asil.jpg"), girdi);
    assert.ok(icerir(girdi, "Exif\0\0") && icerir(girdi, "ErenTestMake"), "girdi EXIF'li");
    assert.deepEqual(await i.gorselUret(no, "jpg"), { zamanAsimi: false });
    const cikti = readFileSync(yol(no, "gorsel.jpg"));
    assert.ok(!icerir(cikti, "Exif"), "Exif imzası kaldı");
    assert.ok(!icerir(cikti, "ErenTestMake"), "Make değeri kaldı");
    assert.ok(!icerir(cikti, "\xff\xe1"), "APP1 bölümü kaldı");
  });

  it("ikinci savunma: asil.mp4 adlı HLS listesi koklanmaz ve mov demuxer'ı onu açmaz", async () => {
    const i = isleyiciKur();
    const no = ++sayac;
    mkdirSync(join(kok, "medya", String(no)), { recursive: true });
    const hls = "#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\nhttp://127.0.0.1:9/a.ts\n#EXT-X-ENDLIST\n";
    writeFileSync(yol(no, "asil.mp4"), hls);
    assert.equal(i.kokla(basBaytlari(yol(no, "asil.mp4"))), null);
    assert.equal(await i.olc(no, "mp4"), null);
    assert.deepEqual(await i.kareUret(no, "mp4", 1, 0), { zamanAsimi: false });
    assert.ok(!existsSync(yol(no, "kare-01.jpg")));
  });

  it("zaman aşımı: araç öldürülür, { zamanAsimi: true }", async () => {
    const i = isleyiciKur({ sinirlar: { ...SAHTE_MEDYA_SINIRLARI, olcumZamanAsimiMs: 1, kareZamanAsimiMs: 1 } });
    const no = ek("mp4", (c) => ["-f", "lavfi", "-i", "testsrc2=size=320x240:rate=15:duration=2", "-c:v", "libx264", c]);
    assert.deepEqual(await i.kareUret(no, "mp4", 1, 500), { zamanAsimi: true });
    assert.equal(await i.olc(no, "mp4"), null);
  });

  it("döküm: model dosyası yoksa dokum.srt üretilmez, atmaz", async () => {
    const no = ek("mp4", (c) => [
      "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=15:duration=2",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
      "-c:v", "libx264", "-c:a", "aac", "-shortest", c,
    ]);
    const i = isleyiciKur({ dokumModeli: "modeller/olmayan.bin" });
    assert.deepEqual(await i.dokumUret(no, "mp4", 2000), { zamanAsimi: false });
    assert.ok(!existsSync(yol(no, "dokum.srt")));
  });

  describe("whisper dökümü", { skip: MODEL_YOK }, () => {
    let ses: { dosya: string; tr: boolean } | null = null;
    before(() => {
      // Model veri köküne göreli verilir (`modeller/...`): geçici köke sabit bağ (kopya değil, aynı birimde anında).
      mkdirSync(join(kok, "modeller"), { recursive: true });
      try {
        linkSync(MODEL as string, join(kok, "modeller", MODEL_ADI));
      } catch {
        // farklı birim: göreli test atlanır, mutlak yol testi sürer
      }
      ses = konusmaUret(join(kok, "ses.wav"));
    });

    const sesliVideo = (): number =>
      ek("mp4", (c) => [
        "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=15",
        "-i", ses?.dosya as string,
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", c,
      ]);
    const denetle = (i: MedyaIsleyici, no: number): string => {
      const srt = readFileSync(yol(no, "dokum.srt"), "utf8");
      const d = i.dokumMetni(srt);
      assert.equal(d.kirpildi, false);
      assert.match(d.metin, /^\[00:0\d\] \S/m, d.metin);
      const kucuk = d.metin.toLocaleLowerCase("tr");
      if (ses?.tr === true) for (const k of ["merhaba", "hava", "güzel"]) assert.ok(kucuk.includes(k), `${k}: ${d.metin}`);
      else assert.ok(kucuk.includes("hello"), d.metin);
      return d.metin;
    };

    it("göreli model yolu, cwd veri kökü: kısa konuşma dökülür", { timeout: 300_000 }, async (t) => {
      if (ses === null) return t.skip("SAPI ile ses üretilemedi");
      if (!existsSync(join(kok, "modeller", MODEL_ADI))) return t.skip("sabit bağ kurulamadı");
      const i = isleyiciKur({ dokumModeli: `modeller/${MODEL_ADI}` });
      const no = sesliVideo();
      const o = await i.olc(no, "mp4");
      assert.ok(o?.ses_akisi === true && o.sure_ms !== null);
      assert.deepEqual(await i.dokumUret(no, "mp4", o.sure_ms), { zamanAsimi: false });
      t.diagnostic(denetle(i, no));
    });

    it("ses akışı yoksa dokum.srt üretilmez (model yüklenmeden düşer)", async () => {
      const i = isleyiciKur({ dokumModeli: (MODEL as string).replaceAll("\\", "/") });
      const no = ek("mp4", (c) => ["-f", "lavfi", "-i", "testsrc2=size=320x240:rate=15:duration=2", "-c:v", "libx264", c]);
      assert.equal((await i.olc(no, "mp4"))?.ses_akisi, false);
      assert.deepEqual(await i.dokumUret(no, "mp4", 2000), { zamanAsimi: false });
      assert.ok(!existsSync(yol(no, "dokum.srt")));
    });

    it("mutlak Windows model yolu (':' kaçışı) da açılır", { timeout: 300_000 }, async (t) => {
      if (ses === null) return t.skip("SAPI ile ses üretilemedi");
      const i = isleyiciKur({ dokumModeli: (MODEL as string).replaceAll("\\", "/"), dokumDili: ses.tr ? "tr" : "auto" });
      const no = sesliVideo();
      assert.deepEqual(await i.dokumUret(no, "mp4", 6000), { zamanAsimi: false });
      denetle(i, no);
    });
  });
});

const TR_METIN = "Merhaba, bugün hava çok güzel. Yarın sabah toplantıya gideceğim.";
/**
 * Windows SAPI ile wav: Türkçe ses (ör. "Microsoft Tolga") varsa Türkçe metin, yoksa ilk sesle İngilizce.
 * Metin ve yol ortam değişkeniyle geçer (tırnak kaçışı yok). Üretilemezse `null`.
 */
function konusmaUret(cikti: string): { dosya: string; tr: boolean } | null {
  const betik = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.Speech",
    "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer",
    "$tr = $s.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'tr-TR' } | Select-Object -First 1",
    "if ($tr) { $s.SelectVoice($tr.VoiceInfo.Name); $m = $env:EREN_TEST_METIN; 'tr' } else { $m = 'Hello, this is a short test of the transcription.'; 'en' }",
    "$s.SetOutputToWaveFile($env:EREN_TEST_CIKTI); $s.Speak($m); $s.Dispose()",
  ].join("\n");
  // [ölçüm] OneCore Türkçe sesi ("Microsoft Tolga") System.Speech'te yalnız pwsh 7'de listelenir; Windows
  // PowerShell 5.1 yalnız masaüstü SAPI seslerini (Zira) görür. Bu yüzden önce pwsh.
  let sonuc: { dosya: string; tr: boolean } | null = null;
  for (const kabuk of ["pwsh.exe", "powershell.exe"]) {
    const r = spawnSync(kabuk, ["-NoProfile", "-NonInteractive", "-Command", betik], {
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, EREN_TEST_METIN: TR_METIN, EREN_TEST_CIKTI: cikti },
      timeout: 60_000,
    });
    if (r.status !== 0 || !existsSync(cikti) || statSync(cikti).size < 1000) continue;
    sonuc = { dosya: cikti, tr: r.stdout.trim().split(/\r?\n/).includes("tr") };
    if (sonuc.tr) break;
  }
  return sonuc;
}
