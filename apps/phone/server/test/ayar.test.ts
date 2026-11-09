import assert from "node:assert/strict";
import { test } from "node:test";
import { asistanAdiUret, ayarKur, yollariUret } from "../src/ayar.ts";
import { sahteDosya } from "./sahte.ts";

async function kur(ek: Record<string, string> = {}) {
  const dosya = sahteDosya();
  dosya.yaz("C:\\bin\\claude.exe", "x");
  return ayarKur({
    dosya,
    ortam: { LOCALAPPDATA: "C:\\Yerel", PATH: "C:\\bin", ...ek },
    execPath: "C:\\bin\\node.exe",
    platform: "win32",
  });
}

test("asistan adı EREN_KIT_ASSISTANT_NAME'den gelir, yoksa nötr varsayılan", async () => {
  assert.equal((await kur()).asistanAdi, "Claude");
  assert.equal((await kur({ EREN_KIT_ASSISTANT_NAME: "  " })).asistanAdi, "Claude");
  assert.equal((await kur({ EREN_KIT_ASSISTANT_NAME: "Örnek Asistan" })).asistanAdi, "Örnek Asistan");
});

test("veri kökü LOCALAPPDATA altında proje ad alanıdır", async () => {
  const a = await kur();
  assert.equal(a.yollar.kok, "C:\\Yerel\\eren-kit");
  assert.equal(a.claudeExe, "C:\\bin\\claude.exe");
});

test("asistan adı bellek/asistan.py kuralıyla temizlenir", () => {
  assert.equal(asistanAdiUret(undefined), "Claude");
  assert.equal(asistanAdiUret("\t\n\u0007"), "Claude");
  assert.equal(asistanAdiUret("  Örnek   Asistan  "), "Örnek Asistan");
  // Kontrol, biçim ve boşluk dışı ayırıcılar atılır; sekme boşluğa dönmez.
  assert.equal(asistanAdiUret("Ör\u0000nek\u200b\tAd\u00a0\u2028x"), "ÖrnekAdx");
  assert.equal(asistanAdiUret("a".repeat(39) + " b"), "a".repeat(39));
  assert.equal(asistanAdiUret("ş".repeat(45)), "ş".repeat(40));
  assert.equal(asistanAdiUret("\u{1F600}".repeat(41)), "\u{1F600}".repeat(40));
});

test("EREN_KIT_DATA_DIR veri kökünü belirler, göreli yol reddedilir", async () => {
  const a = await kur({ EREN_KIT_DATA_DIR: "D:\\Veri\\kit" });
  assert.equal(a.yollar.kok, "D:\\Veri\\kit");
  assert.equal(a.yollar.vt, "D:\\Veri\\kit\\eren.db");
  assert.equal(a.yollar.anahtar, "D:\\Veri\\kit\\sunucu-anahtar.pem");
  assert.equal(a.yollar.yerelAyar, "D:\\Veri\\kit\\ayar.local.json");
  // Paylaşılan Claude limit kilidi veri kökünü izlemez.
  assert.equal(a.yollar.limitKilit, "C:\\Yerel\\ClaudeLimitKilit\\kilit.json");
  assert.equal(yollariUret({ LOCALAPPDATA: "C:\\Yerel", EREN_KIT_DATA_DIR: "E:/a/../b" }, "win32").kok, "E:\\b");
  assert.throws(() => yollariUret({ LOCALAPPDATA: "C:\\Yerel", EREN_KIT_DATA_DIR: "veri" }, "win32"), /EREN_KIT_DATA_DIR mutlak yol olmalı/);
  // Yerel ayar dosyası da özel kökten okunur.
  const dosya = sahteDosya();
  dosya.yaz("C:\\bin\\claude.exe", "x");
  dosya.yaz("D:\\Veri\\ayar.local.json", JSON.stringify({ ws_port: 50001 }));
  const b = await ayarKur({
    dosya,
    ortam: { LOCALAPPDATA: "C:\\Yerel", PATH: "C:\\bin", EREN_KIT_DATA_DIR: "D:\\Veri" },
    execPath: "C:\\bin\\node.exe",
    platform: "win32",
  });
  assert.equal(b.wsPort, 50001);
});

test("macOS: veri kökü Application Support altında, claude PATH'ten ya da ~/.local/bin'den bulunur", async () => {
  const dosya = sahteDosya();
  dosya.yaz("/Users/k/.local/bin/claude", "x");
  const a = await ayarKur({ dosya, ortam: { HOME: "/Users/k", PATH: "/usr/bin:/bin" }, execPath: "/opt/homebrew/bin/node", platform: "darwin" });
  assert.equal(a.yollar.kok, "/Users/k/Library/Application Support/eren-kit");
  assert.equal(a.yollar.vt, "/Users/k/Library/Application Support/eren-kit/eren.db");
  assert.equal(a.yollar.limitKilit, "/Users/k/Library/Application Support/ClaudeLimitKilit/kilit.json");
  assert.equal(a.claudeExe, "/Users/k/.local/bin/claude");
  assert.equal(a.isYollari(7).out, "/Users/k/Library/Application Support/eren-kit/isler/7/out.jsonl");
  // PATH'teki claude önce gelir; .exe kuralı POSIX'te aranmaz.
  dosya.yaz("/usr/bin/claude", "x");
  const b = await ayarKur({ dosya, ortam: { HOME: "/Users/k", PATH: "/usr/bin:/bin" }, execPath: "/n", platform: "darwin" });
  assert.equal(b.claudeExe, "/usr/bin/claude");
});

test("POSIX: EREN_KIT_DATA_DIR mutlak olmalı; HOME yoksa açık hata; Linux XDG kökü", () => {
  assert.equal(yollariUret({ HOME: "/h", EREN_KIT_DATA_DIR: "/v/a/../b" }, "darwin").kok, "/v/b");
  assert.throws(() => yollariUret({ HOME: "/h", EREN_KIT_DATA_DIR: "veri" }, "darwin"), /EREN_KIT_DATA_DIR mutlak yol olmalı/);
  assert.throws(() => yollariUret({}, "darwin"), /HOME tanımlı/);
  assert.equal(yollariUret({ HOME: "/h", XDG_DATA_HOME: "/x" }, "linux").kok, "/x/eren-kit");
  assert.equal(yollariUret({ HOME: "/h" }, "linux").kok, "/h/.local/share/eren-kit");
});

test("POSIX: claude bulunamazsa ya da claude_exe göreli ise açık hata", async () => {
  const dosya = sahteDosya();
  await assert.rejects(
    ayarKur({ dosya, ortam: { HOME: "/h", PATH: "/yok" }, execPath: "/n", platform: "darwin" }),
    /claude bulunamadı/,
  );
});
