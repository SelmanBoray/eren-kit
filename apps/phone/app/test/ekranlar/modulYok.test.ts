import assert from "node:assert/strict";
import { test } from "node:test";
import { modulYokMetni } from "../../src/ekranlar/modulYok.ts";

test("iOS'ta yalnız sohbet olduğu ve cihaz yönetiminin Android'e özgü olduğu söylenir", () => {
  const m = modulYokMetni("ios");
  assert.match(m, /yalnız sohbet/);
  assert.match(m, /Android'e özgü/);
  assert.match(m, /iOS kimlik modülü/);
});

test("Android'de (Expo Go / geliştirme) eski anlam korunur, iOS söylenmez", () => {
  const m = modulYokMetni("android");
  assert.match(m, /yerel modül yok/);
  assert.doesNotMatch(m, /iPhone|iOS/);
});
