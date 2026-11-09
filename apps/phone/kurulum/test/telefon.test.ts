import { test } from "node:test";
import assert from "node:assert/strict";

const t0 = Date.now();
const { adbCihazlari, izinVerildiMi, appopModu } = await import("../telefon.ts");
const iceAktarmaMs = Date.now() - t0;

test("içe aktarma yan etkisiz ve hızlı", () => {
  assert.ok(iceAktarmaMs < 1000);
});

test("adbCihazlari: tek cihaz, CRLF, daemon satırı", () => {
  const c = adbCihazlari("* daemon not running; starting now\r\n* daemon started successfully\r\nList of devices attached\r\nABC123\tdevice\r\n\r\n");
  assert.deepEqual(c, [{ seri: "ABC123", durum: "device" }]);
});

test("adbCihazlari: boş, unauthorized, çoklu", () => {
  assert.deepEqual(adbCihazlari("List of devices attached\n\n"), []);
  assert.deepEqual(adbCihazlari("List of devices attached\nX\tunauthorized\n"), [{ seri: "X", durum: "unauthorized" }]);
  assert.equal(adbCihazlari("List of devices attached\nA\tdevice\nB\toffline\n").length, 2);
});

test("izinVerildiMi", () => {
  const izin = "android.permission.WRITE_SECURE_SETTINGS";
  assert.equal(izinVerildiMi(`    install permissions:\n      ${izin}: granted=true\n`, izin), true);
  assert.equal(izinVerildiMi(`      ${izin}: granted=false, flags=[ ]\n`, izin), false);
  assert.equal(izinVerildiMi(`      android.permission.INTERNET: granted=true\n`, izin), null);
  assert.equal(izinVerildiMi(`${izin}: granted=false\n${izin}: granted=true\n`, izin), true);
});

test("appopModu", () => {
  assert.equal(appopModu("GET_USAGE_STATS: allow\n", "GET_USAGE_STATS"), "allow");
  assert.equal(appopModu("GET_USAGE_STATS: allow; time=+1d; rejectTime=+2h\r\n", "GET_USAGE_STATS"), "allow");
  assert.equal(appopModu("GET_USAGE_STATS: default\n", "GET_USAGE_STATS"), "default");
  assert.equal(appopModu("No operations.\n", "GET_USAGE_STATS"), null);
});
