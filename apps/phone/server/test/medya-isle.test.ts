import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MEDYA_MIME, type MedyaMime, type MedyaTuru } from "@eren/protocol";
import {
  BICIM_DEMUXER,
  dokumArgv,
  dokumMetniKur,
  dokumZamanAsimiMs,
  gorselArgv,
  kareArgv,
  kareSayisi,
  kareZamanlari,
  kokla,
  beyanaUyar,
  medyaIsleyiciKur,
  olcekBoyutu,
  olcekSuzgeci,
  olcumArgv,
  olcumCoz,
  srtCoz,
  ssDegeri,
  suzgecDegeriKacir,
  whisperSuzgeci,
} from "../src/medya-isle.ts";
import type { AracIstegi, AracSonucu, MedyaBicimi } from "../src/sozlesme.ts";
import {
  SAHTE_MEDYA_BICIMLERI,
  SAHTE_MEDYA_SINIRLARI,
  SAHTE_VERI_KOKU,
  sahteMedyaAyari,
  sahteMedyaBaytlari,
  sahteMedyaDosya,
  sahteMedyaIsleyici,
} from "./sahte.ts";

const S = SAHTE_MEDYA_SINIRLARI;
const bayt = (...p: (number | string)[]): Uint8Array => {
  const l: number[] = [];
  for (const x of p) {
    if (typeof x === "number") l.push(x);
    else for (const c of x) l.push(c.charCodeAt(0));
  }
  const b = new Uint8Array(64).fill(0x2a);
  b.set(l);
  return b;
};
const ftyp = (marka: string): Uint8Array => bayt(0, 0, 0, 0x18, "ftyp", marka, 0, 0, 0, 0);

describe("medya-isle: kokla", () => {
  it("her biçimin baş baytları tanınır (sahte tablo ile aynı)", () => {
    for (const b of SAHTE_MEDYA_BICIMLERI) assert.equal(kokla(sahteMedyaBaytlari(b, 64)), b, b);
  });

  it("ftyp markaları", () => {
    const beklenen: Record<string, MedyaBicimi> = {
      heic: "heic",
      heix: "heic",
      mif1: "heic",
      msf1: "heic",
      isom: "mp4",
      iso2: "mp4",
      mp41: "mp4",
      mp42: "mp4",
      avc1: "mp4",
      "qt  ": "mov",
      "3gp4": "3gp",
      "3gp5": "3gp",
      "3gp6": "3gp",
    };
    for (const [marka, bicim] of Object.entries(beklenen)) assert.equal(kokla(ftyp(marka)), bicim, marka);
    for (const marka of ["avif", "M4V ", "M4A ", "crx ", "dash", "iso5", "HEIC"]) assert.equal(kokla(ftyp(marka)), null, marka);
  });

  it("metin, HLS/concat listesi, boş ve kısa girdi null", () => {
    const metin = (s: string): Uint8Array => new TextEncoder().encode(s);
    assert.equal(kokla(metin("#EXTM3U\n#EXT-X-VERSION:3\nhttp://ornek/a.ts\n")), null);
    assert.equal(kokla(metin("ffconcat version 1.0\nfile 'C:/gizli.mp4'\n")), null);
    assert.equal(kokla(metin("<?xml version='1.0'?><MPD></MPD>")), null);
    assert.equal(kokla(new Uint8Array(0)), null);
    assert.equal(kokla(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), null);
    assert.equal(kokla(sahteMedyaBaytlari("jpg", 11)), null);
    assert.equal(kokla(sahteMedyaBaytlari("jpg", 12)), "jpg");
    assert.equal(kokla(new Uint8Array(64)), null);
  });

  it("yakın ama yanlış imzalar tanınmaz", () => {
    assert.equal(kokla(bayt(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x00)), null);
    assert.equal(kokla(bayt("RIFF", 0, 0, 0, 0, "WAVE")), null);
    assert.equal(kokla(bayt(0xff, 0xd8, 0x00)), null);
    assert.equal(kokla(bayt(0, 0, 0, 0x18, "ftyq", "isom")), null);
  });

  it("en çok 64 bayt okunur: 64. bayttan sonrası etkisiz", () => {
    const b = new Uint8Array(4096).fill(0x2a);
    b.set([0, 0, 0, 0x18], 64);
    assert.equal(kokla(b), null);
    const j = new Uint8Array(4096);
    j.set(sahteMedyaBaytlari("jpg", 4));
    assert.equal(kokla(j), "jpg");
  });
});

describe("medya-isle: beyanaUyar", () => {
  it("tür ve mime birlikte uyuşmalı", () => {
    const uyanlar: [MedyaBicimi, MedyaTuru, MedyaMime][] = [
      ["jpg", "foto", "image/jpeg"],
      ["png", "foto", "image/png"],
      ["webp", "foto", "image/webp"],
      ["heic", "foto", "image/heic"],
      ["heic", "foto", "image/heif"],
      ["mp4", "video", "video/mp4"],
      ["mov", "video", "video/quicktime"],
      ["3gp", "video", "video/3gpp"],
      ["3gp", "video", "video/mp4"],
      ["mp4", "video", "video/quicktime"],
      ["webm", "video", "video/webm"],
    ];
    for (const [b, t, m] of uyanlar) assert.equal(beyanaUyar(b, t, m), true, `${b} ${t} ${m}`);
    const uymayanlar: [MedyaBicimi, MedyaTuru, MedyaMime][] = [
      ["jpg", "foto", "image/png"],
      ["png", "foto", "image/jpeg"],
      ["jpg", "video", "video/mp4"],
      ["mp4", "foto", "image/jpeg"],
      ["mp4", "video", "video/webm"],
      ["webm", "video", "video/mp4"],
      ["heic", "foto", "image/jpeg"],
    ];
    for (const [b, t, m] of uymayanlar) assert.equal(beyanaUyar(b, t, m), false, `${b} ${t} ${m}`);
  });

  it("her protokol mime'ı en az bir biçimle uyuşur, türü dışındakiyle hiç", () => {
    for (const [tur, mimeler] of Object.entries(MEDYA_MIME) as [MedyaTuru, readonly MedyaMime[]][]) {
      for (const m of mimeler) {
        assert.ok(SAHTE_MEDYA_BICIMLERI.some((b) => beyanaUyar(b, tur, m)), m);
        const obur: MedyaTuru = tur === "foto" ? "video" : "foto";
        assert.ok(!SAHTE_MEDYA_BICIMLERI.some((b) => beyanaUyar(b, obur, m)), m);
      }
    }
  });
});

describe("medya-isle: kare sayısı ve zamanları", () => {
  it("N = clamp(ceil(sure / 10 sn), 3, 8)", () => {
    assert.equal(kareSayisi(1, S), 3);
    assert.equal(kareSayisi(20_000, S), 3);
    assert.equal(kareSayisi(30_000, S), 3);
    assert.equal(kareSayisi(30_001, S), 4);
    assert.equal(kareSayisi(50_000, S), 5);
    assert.equal(kareSayisi(80_000, S), 8);
    assert.equal(kareSayisi(300_000, S), 8);
    assert.equal(kareSayisi(0, S), 0);
    assert.equal(kareSayisi(-5, S), 0);
    assert.equal(kareSayisi(Number.NaN, S), 0);
  });

  it("zamanlar (i + 0,5) * sure / N, tam sayı, artan, süre içinde", () => {
    assert.deepEqual(kareZamanlari(20_000, S), [3333, 10000, 16666]);
    assert.deepEqual(kareZamanlari(300_000, S), [18750, 56250, 93750, 131250, 168750, 206250, 243750, 281250]);
    assert.deepEqual(kareZamanlari(0, S), []);
    for (const sure of [1, 999, 10_000, 45_123, 330_000]) {
      const z = kareZamanlari(sure, S);
      assert.equal(z.length, kareSayisi(sure, S));
      for (let i = 0; i < z.length; i++) {
        assert.ok(Number.isInteger(z[i]) && (z[i] as number) >= 0 && (z[i] as number) < sure);
        if (i > 0) assert.ok((z[i] as number) >= (z[i - 1] as number));
      }
    }
  });

  it("sahte işleyiciyle aynı formül", () => {
    const sahte = sahteMedyaIsleyici(sahteMedyaDosya());
    for (const sure of [1, 20_000, 61_000, 300_000]) assert.deepEqual(kareZamanlari(sure, S), [...sahte.kareZamanlari(sure)]);
  });

  it("-ss değeri", () => {
    assert.equal(ssDegeri(3333), "3.333");
    assert.equal(ssDegeri(0), "0.000");
    assert.equal(ssDegeri(-4), "0.000");
    assert.equal(ssDegeri(Number.NaN), "0.000");
  });
});

describe("medya-isle: ölçek", () => {
  it("uzun kenar ve alan sınırı, hiç büyütmez", () => {
    assert.deepEqual(olcekBoyutu(4000, 3000, 1568, 1_150_000), { genislik: 1238, yukseklik: 928 });
    assert.deepEqual(olcekBoyutu(301, 5001, 1568, 1_150_000), { genislik: 94, yukseklik: 1568 });
    assert.deepEqual(olcekBoyutu(800, 600, 1568, 1_150_000), { genislik: 800, yukseklik: 600 });
    assert.deepEqual(olcekBoyutu(1280, 720, 768, null), { genislik: 768, yukseklik: 432 });
    assert.deepEqual(olcekBoyutu(720, 1280, 768, null), { genislik: 432, yukseklik: 768 });
    assert.deepEqual(olcekBoyutu(1, 50_000, 768, null), { genislik: 1, yukseklik: 768 });
    for (const [w, h] of [
      [4032, 3024],
      [3024, 4032],
      [1568, 1568],
      [12000, 9000],
    ] as const) {
      const o = olcekBoyutu(w, h, 1568, 1_150_000);
      assert.ok(Math.max(o.genislik, o.yukseklik) <= 1568);
      assert.ok(o.genislik * o.yukseklik <= 1_150_000);
    }
  });

  it("süzgeç dizgesi: döndürmeden sonraki iw/ih ile, virgüller tırnak içinde", () => {
    assert.equal(
      olcekSuzgeci(1568, 1_150_000),
      "scale=w='max(1,trunc(iw*min(1,min(1568/max(iw,ih),sqrt(1150000/(iw*ih))))))'" +
        ":h='max(1,trunc(ih*min(1,min(1568/max(iw,ih),sqrt(1150000/(iw*ih))))))'",
    );
    assert.equal(olcekSuzgeci(768, null), "scale=w='max(1,trunc(iw*min(1,768/max(iw,ih))))':h='max(1,trunc(ih*min(1,768/max(iw,ih))))'");
    assert.throws(() => olcekSuzgeci(0, null));
    assert.throws(() => olcekSuzgeci(768.5, null));
    assert.throws(() => olcekSuzgeci(768, Number.NaN));
  });
});

describe("medya-isle: süzgeç kaçışı ve whisper", () => {
  it("iki düzeyli kaçış", () => {
    assert.equal(suzgecDegeriKacir("modeller/ggml.bin"), "modeller/ggml.bin");
    assert.equal(suzgecDegeriKacir("C:/m/x.bin"), "C\\\\:/m/x.bin");
    assert.equal(suzgecDegeriKacir("a,b;c[d]e"), "a\\,b\\;c\\[d\\]e");
    assert.equal(suzgecDegeriKacir("it's"), "it\\\\\\'s");
    assert.equal(suzgecDegeriKacir("a\\b"), "a\\\\\\\\b");
    // ffmpeg belgesindeki örnek: `this is a 'string': may contain one, or more, special characters`
    assert.equal(
      suzgecDegeriKacir("this is a 'string': may contain one, or more, special characters"),
      "this is a \\\\\\'string\\\\\\'\\\\: may contain one\\, or more\\, special characters",
    );
  });

  it("whisper süzgeci: sabit sıra, srt, queue 20, VAD isteğe bağlı", () => {
    assert.equal(
      whisperSuzgeci({ model: "modeller/ggml-large-v3-turbo-q5_0.bin", dil: "auto", hedef: "medya/7/dokum.srt", vadModeli: null }),
      "aresample=16000,whisper=model=modeller/ggml-large-v3-turbo-q5_0.bin:language=auto:queue=20:format=srt:destination=medya/7/dokum.srt",
    );
    assert.equal(
      whisperSuzgeci({ model: "C:/m.bin", dil: "tr", hedef: "medya/7/dokum.srt", vadModeli: "modeller/silero,v5.bin" }),
      "aresample=16000,whisper=model=C\\\\:/m.bin:language=tr:queue=20:format=srt:destination=medya/7/dokum.srt:vad_model=modeller/silero\\,v5.bin",
    );
  });

  it("döküm zaman aşımı max(120 sn, 3 × süre)", () => {
    assert.equal(dokumZamanAsimiMs(10_000, S), 120_000);
    assert.equal(dokumZamanAsimiMs(40_000, S), 120_000);
    assert.equal(dokumZamanAsimiMs(60_000, S), 180_000);
    assert.equal(dokumZamanAsimiMs(300_000, S), 900_000);
    assert.equal(dokumZamanAsimiMs(Number.NaN, S), 120_000);
  });
});

describe("medya-isle: argv", () => {
  const ortak = (argv: readonly string[], bicim: MedyaBicimi, girdi: string): void => {
    const i = argv.indexOf("-i");
    assert.ok(i > 0, "-i var");
    assert.equal(argv[i + 1], girdi);
    const once = argv.slice(0, i);
    // Girdi seçenekleri -i'den önce: protokol listesi yalnız file, demuxer açık.
    assert.equal(once[once.indexOf("-protocol_whitelist") + 1], "file");
    assert.equal(once[once.indexOf("-f") + 1], BICIM_DEMUXER[bicim]);
    assert.ok(once.includes("-loglevel") && once.includes("-hide_banner"));
    for (const a of argv) assert.ok(!/^[A-Za-z]:/.test(a) && !a.includes("\\"), `mutlak/ters eğik yol yok: ${a}`);
  };
  const ffmpegOrtak = (argv: readonly string[], bicim: MedyaBicimi, girdi: string): void => {
    ortak(argv, bicim, girdi);
    assert.deepEqual(argv.slice(0, 5), ["-nostdin", "-hide_banner", "-loglevel", "error", "-y"]);
    const i = argv.indexOf("-map_metadata");
    assert.ok(i > argv.indexOf("-i"), "-map_metadata çıktı seçeneği");
    assert.equal(argv[i + 1], "-1");
  };

  it("demuxer tablosu", () => {
    assert.deepEqual(BICIM_DEMUXER, {
      jpg: "jpeg_pipe",
      png: "png_pipe",
      webp: "webp_pipe",
      heic: "mov",
      mp4: "mov",
      mov: "mov",
      "3gp": "mov",
      webm: "matroska",
    });
  });

  it("ölçüm: JSON, fotoğrafta ilk kare, videoda kare okunmaz, -nostdin yok (ffprobe tanımaz)", () => {
    const v = olcumArgv("medya/3/asil.mp4", "mp4");
    ortak(v, "mp4", "medya/3/asil.mp4");
    assert.ok(!v.includes("-nostdin"));
    assert.equal(v[v.indexOf("-of") + 1], "json");
    assert.ok(!v.includes("-read_intervals"));
    assert.ok(!(v[v.indexOf("-show_entries") + 1] as string).includes("frame="));
    const f = olcumArgv("medya/3/asil.jpg", "jpg");
    ortak(f, "jpg", "medya/3/asil.jpg");
    assert.equal(f[f.indexOf("-read_intervals") + 1], "%+#1");
    assert.ok((f[f.indexOf("-show_entries") + 1] as string).includes("frame_side_data=rotation"));
  });

  it("görsel: tek JPEG kare, -q:v 3, ölçek süzgeci, ses/altyazı/veri yok", () => {
    const a = gorselArgv("medya/3/asil.heic", "medya/3/gorsel.jpg", "heic", S);
    ffmpegOrtak(a, "heic", "medya/3/asil.heic");
    assert.equal(a.at(-1), "medya/3/gorsel.jpg");
    assert.equal(a[a.indexOf("-q:v") + 1], "3");
    assert.equal(a[a.indexOf("-frames:v") + 1], "1");
    assert.equal(a[a.indexOf("-vf") + 1], olcekSuzgeci(S.gorselUzunKenar, S.gorselPiksel));
    assert.equal(a.at(-2), "image2");
    for (const x of ["-an", "-sn", "-dn"]) assert.ok(a.includes(x));
  });

  it("kare: -ss girişten önce, -q:v 4, uzun kenar 768", () => {
    const a = kareArgv("medya/3/asil.webm", "medya/3/kare-02.jpg", "webm", 10_000, S);
    ffmpegOrtak(a, "webm", "medya/3/asil.webm");
    assert.ok(a.indexOf("-ss") < a.indexOf("-i"));
    assert.equal(a[a.indexOf("-ss") + 1], "10.000");
    assert.equal(a[a.indexOf("-q:v") + 1], "4");
    assert.equal(a[a.indexOf("-vf") + 1], olcekSuzgeci(768, null));
    assert.equal(a.at(-1), "medya/3/kare-02.jpg");
  });

  it("döküm: -vn, -af süzgeç, -f null -", () => {
    const s = whisperSuzgeci({ model: "m.bin", dil: "auto", hedef: "medya/3/dokum.srt", vadModeli: null });
    const a = dokumArgv("medya/3/asil.mov", "mov", s);
    ffmpegOrtak(a, "mov", "medya/3/asil.mov");
    assert.ok(a.includes("-vn"));
    assert.equal(a[a.indexOf("-af") + 1], s);
    assert.deepEqual(a.slice(-3), ["-f", "null", "-"]);
  });
});

describe("medya-isle: ffprobe JSON", () => {
  const json = (o: unknown): string => JSON.stringify(o);

  it("video: süre, boyut, ses", () => {
    const o = olcumCoz(
      json({
        streams: [
          { index: 0, codec_type: "video", width: 1280, height: 720, disposition: { attached_pic: 0 } },
          { index: 1, codec_type: "audio" },
        ],
        format: { duration: "20.000000" },
      }),
    );
    assert.deepEqual(o, { sure_ms: 20_000, genislik: 1280, yukseklik: 720, video_akisi: true, ses_akisi: true });
  });

  it("dönme ±90/270: görüntü boyutu yer değiştirir; 180 değiştirmez", () => {
    for (const [r, w, h] of [
      [90, 720, 1280],
      [-90, 720, 1280],
      [270, 720, 1280],
      [180, 1280, 720],
      [0, 1280, 720],
    ] as const) {
      const o = olcumCoz(
        json({
          streams: [{ codec_type: "video", width: 1280, height: 720, side_data_list: [{ rotation: r }] }],
          format: { duration: "1.5" },
        }),
      );
      assert.equal(o?.genislik, w, String(r));
      assert.equal(o?.yukseklik, h, String(r));
    }
  });

  it("fotoğraf: EXIF yönü karenin yan verisinden; süre yok", () => {
    const o = olcumCoz(
      json({
        frames: [{ width: 800, height: 600, side_data_list: [{ rotation: -90 }, {}] }],
        streams: [{ codec_type: "video", width: 800, height: 600, disposition: { attached_pic: 0 } }],
        format: {},
      }),
    );
    assert.deepEqual(o, { sure_ms: null, genislik: 600, yukseklik: 800, video_akisi: true, ses_akisi: false });
  });

  it("kapak resmi video sayılmaz; en büyük video akışı seçilir; süre akıştan", () => {
    const o = olcumCoz(
      json({
        streams: [
          { codec_type: "audio", duration: "3.0" },
          { codec_type: "video", width: 3000, height: 3000, disposition: { attached_pic: 1 } },
        ],
        format: {},
      }),
    );
    assert.deepEqual(o, { sure_ms: null, genislik: null, yukseklik: null, video_akisi: false, ses_akisi: true });
    const p = olcumCoz(
      json({
        streams: [
          { codec_type: "video", width: 320, height: 240, duration: "4.25" },
          { codec_type: "video", width: 1920, height: 1080, duration: "4.25" },
        ],
      }),
    );
    assert.deepEqual(p, { sure_ms: 4250, genislik: 1920, yukseklik: 1080, video_akisi: true, ses_akisi: false });
  });

  it("bozuk, boş, akışsız ya da tuhaf alanlı JSON", () => {
    assert.equal(olcumCoz(""), null);
    assert.equal(olcumCoz("{"), null);
    assert.equal(olcumCoz("[]"), null);
    assert.equal(olcumCoz("null"), null);
    assert.equal(olcumCoz(json({ streams: [] })), null);
    assert.equal(olcumCoz(json({ format: { duration: "3" } })), null);
    const o = olcumCoz(json({ streams: [{ codec_type: "video", width: "x", height: -4 }], format: { duration: "N/A" } }));
    assert.deepEqual(o, { sure_ms: null, genislik: null, yukseklik: null, video_akisi: true, ses_akisi: false });
  });
});

describe("medya-isle: SRT", () => {
  it("temel ve whisper çıktısı (0'dan sayan sıra, virgüllü ms)", () => {
    const srt = "0\n00:00:00,000 --> 00:00:05,180\nMerhaba, bugün hava çok güzel.\n\n1\n00:00:05,180 --> 00:00:09,840\nToplantıya gideceğim.\n\n";
    assert.deepEqual(srtCoz(srt), [
      { bas_ms: 0, metin: "Merhaba, bugün hava çok güzel." },
      { bas_ms: 5180, metin: "Toplantıya gideceğim." },
    ]);
    assert.deepEqual(dokumMetniKur(srt, 20_000), {
      metin: "[00:00] Merhaba, bugün hava çok güzel.\n[00:05] Toplantıya gideceğim.",
      kirpildi: false,
    });
  });

  it("çok satırlı altyazı birleşir, CRLF ve BOM, noktalı ms, boşluk sadeleşir", () => {
    const srt = "\uFEFF1\r\n00:01:02.500 --> 00:01:04.000\r\n  birinci   satır \r\nikinci\tsatır\r\n\r\n";
    assert.deepEqual(srtCoz(srt), [{ bas_ms: 62_500, metin: "birinci satır ikinci satır" }]);
  });

  it("bozuk satır ve bloklar atlanır", () => {
    const srt = [
      "çöp satır",
      "",
      "1",
      "00:00:01,000 -> 00:00:02,000",
      "ok yanlış",
      "",
      "2",
      "00:00:61,000 --> 00:00:62,000",
      "saniye 61",
      "",
      "3",
      "00:00:03,000 --> 00:00:04,000",
      "",
      "4",
      "00:00:05,000 --> 00:00:06,000",
      "geçerli",
      "",
    ].join("\n");
    assert.deepEqual(srtCoz(srt), [{ bas_ms: 5000, metin: "geçerli" }]);
  });

  it("boş satır eksikse sıra numarası metne karışmaz; sayı olan metin satırı kalır", () => {
    const srt = "1\n00:00:01,000 --> 00:00:02,000\nbir\n2\n00:00:03,000 --> 00:00:04,000\n42\nson\n";
    assert.deepEqual(srtCoz(srt), [
      { bas_ms: 1000, metin: "bir" },
      { bas_ms: 3000, metin: "42 son" },
    ]);
  });

  it("bir saati aşan videoda bütün satırlar [s:mm:ss]", () => {
    const srt = "1\n00:59:59,999 --> 01:00:01,000\nönce\n\n2\n01:02:03,000 --> 01:02:04,000\nsonra\n";
    assert.equal(dokumMetniKur(srt, 1000).metin, "[0:59:59] önce\n[1:02:03] sonra");
    assert.equal(dokumMetniKur("1\n00:12:07,000 --> 00:12:08,000\nx\n", 1000).metin, "[12:07] x");
  });

  it("kırpma: sığan tam satırlar; hiçbiri sığmazsa vekil çifti bölünmez", () => {
    const srt = "1\n00:00:01,000 --> 00:00:02,000\naaaa\n\n2\n00:00:03,000 --> 00:00:04,000\nbbbb\n";
    // "[00:01] aaaa" 12 birim, ikinci satırla 25.
    assert.deepEqual(dokumMetniKur(srt, 25), { metin: "[00:01] aaaa\n[00:03] bbbb", kirpildi: false });
    assert.deepEqual(dokumMetniKur(srt, 24), { metin: "[00:01] aaaa", kirpildi: true });
    assert.deepEqual(dokumMetniKur(srt, 10), { metin: "[00:01] aa", kirpildi: true });
    const emoji = dokumMetniKur("1\n00:00:01,000 --> 00:00:02,000\n😀😀\n", 9);
    assert.deepEqual(emoji, { metin: "[00:01] ", kirpildi: true });
    assert.deepEqual(dokumMetniKur(srt, 0), { metin: "", kirpildi: true });
  });

  it("boş ya da altyazısız SRT boş metin", () => {
    assert.deepEqual(dokumMetniKur("", 100), { metin: "", kirpildi: false });
    assert.deepEqual(dokumMetniKur("rastgele\nmetin\n", 100), { metin: "", kirpildi: false });
  });
});

describe("medya-isle: işleyici (sahte süreç)", () => {
  const kur = (davranis: (i: AracIstegi) => Promise<AracSonucu> = async () => ({ zamanAsimi: false, stdout: "", stderr: "" })) => {
    const istekler: AracIstegi[] = [];
    const ayar = sahteMedyaAyari();
    const isleyici = medyaIsleyiciKur({
      surec: {
        aracCalistir: async (i) => {
          istekler.push(i);
          return davranis(i);
        },
      },
      ayar,
      veriKoku: SAHTE_VERI_KOKU,
      dosya: sahteMedyaDosya(),
    });
    return { isleyici, istekler, ayar };
  };

  it("olc: ffprobe, cwd veri kökü, ölçüm zaman aşımı, JSON çözülür", async () => {
    const { isleyici, istekler, ayar } = kur(async () => ({
      zamanAsimi: false,
      stdout: JSON.stringify({ streams: [{ codec_type: "video", width: 640, height: 480 }], format: { duration: "2" } }),
      stderr: "",
    }));
    assert.deepEqual(await isleyici.olc(5, "mp4"), {
      sure_ms: 2000,
      genislik: 640,
      yukseklik: 480,
      video_akisi: true,
      ses_akisi: false,
    });
    assert.equal(istekler.length, 1);
    assert.equal(istekler[0]?.exe, ayar.ffprobe);
    assert.equal(istekler[0]?.cwd, SAHTE_VERI_KOKU);
    assert.equal(istekler[0]?.zamanAsimiMs, S.olcumZamanAsimiMs);
    assert.deepEqual(istekler[0]?.argv, olcumArgv("medya/5/asil.mp4", "mp4"));
  });

  it("olc: zaman aşımı, başlatma hatası ve geçersiz no null; atmaz", async () => {
    assert.equal(await kur(async () => ({ zamanAsimi: true, stdout: "{}", stderr: "" })).isleyici.olc(1, "mp4"), null);
    assert.equal(await kur(async () => Promise.reject(new Error("ENOENT"))).isleyici.olc(1, "mp4"), null);
    const k = kur();
    assert.equal(await k.isleyici.olc(0, "mp4"), null);
    assert.equal(k.istekler.length, 0);
  });

  it("gorselUret ve kareUret: göreli yollar, doğru zaman aşımı, zamanAsimi aynen döner", async () => {
    const { isleyici, istekler, ayar } = kur(async (i) => ({ zamanAsimi: i.argv.includes("-ss"), stdout: "", stderr: "" }));
    assert.deepEqual(await isleyici.gorselUret(9, "png"), { zamanAsimi: false });
    assert.deepEqual(await isleyici.kareUret(9, "mp4", 3, 12_345), { zamanAsimi: true });
    assert.equal(istekler[0]?.exe, ayar.ffmpeg);
    assert.equal(istekler[0]?.zamanAsimiMs, S.gorselZamanAsimiMs);
    assert.deepEqual(istekler[0]?.argv, gorselArgv("medya/9/asil.png", "medya/9/gorsel.jpg", "png", S));
    assert.equal(istekler[1]?.zamanAsimiMs, S.kareZamanAsimiMs);
    assert.deepEqual(istekler[1]?.argv, kareArgv("medya/9/asil.mp4", "medya/9/kare-03.jpg", "mp4", 12_345, S));
    for (const i of istekler) assert.equal(i.cwd, SAHTE_VERI_KOKU);
  });

  it("başlatılamayan araç ya da geçersiz sıra: { zamanAsimi: false }, atmaz", async () => {
    const k = kur(async () => Promise.reject(new Error("ENOENT")));
    assert.deepEqual(await k.isleyici.gorselUret(1, "jpg"), { zamanAsimi: false });
    assert.deepEqual(await k.isleyici.kareUret(1, "mp4", 9 as 1, 0), { zamanAsimi: false });
    assert.equal(k.istekler.length, 1);
  });

  it("dokumUret: whisper süzgeci, süreye göre zaman aşımı; model yoksa hiç çağırmaz", async () => {
    const { isleyici, istekler, ayar } = kur();
    assert.deepEqual(await isleyici.dokumUret(4, "mp4", 90_000), { zamanAsimi: false });
    assert.equal(istekler[0]?.exe, ayar.ffmpeg);
    assert.equal(istekler[0]?.cwd, SAHTE_VERI_KOKU);
    assert.equal(istekler[0]?.zamanAsimiMs, 270_000);
    const af = istekler[0]?.argv[(istekler[0]?.argv.indexOf("-af") ?? 0) + 1];
    assert.equal(
      af,
      "aresample=16000,whisper=model=modeller/ggml-large-v3-turbo-q5_0.bin:language=auto:queue=20:format=srt:destination=medya/4/dokum.srt",
    );

    const istekler2: AracIstegi[] = [];
    const modelsiz = medyaIsleyiciKur({
      surec: { aracCalistir: async (i) => (istekler2.push(i), { zamanAsimi: false, stdout: "", stderr: "" }) },
      ayar: sahteMedyaAyari({ dokumModeli: null }),
      veriKoku: SAHTE_VERI_KOKU,
      dosya: sahteMedyaDosya(),
    });
    assert.deepEqual(await modelsiz.dokumUret(4, "mp4", 90_000), { zamanAsimi: false });
    assert.equal(istekler2.length, 0);
  });

  it("saf yüz: kokla, beyanaUyar, kareZamanlari, dokumMetni sınırla", () => {
    const { isleyici } = kur();
    assert.equal(isleyici.kokla(sahteMedyaBaytlari("webm", 64)), "webm");
    assert.equal(isleyici.beyanaUyar("jpg", "foto", "image/jpeg"), true);
    assert.deepEqual([...isleyici.kareZamanlari(20_000)], [3333, 10000, 16666]);
    const uzun = Array.from({ length: 3000 }, (_, i) => `${i}\n00:00:01,000 --> 00:00:02,000\nkelime kelime\n`).join("\n");
    const d = isleyici.dokumMetni(uzun);
    assert.equal(d.kirpildi, true);
    assert.ok(d.metin.length <= S.dokumMetni);
    assert.ok(d.metin.endsWith("kelime kelime"));
  });
});
