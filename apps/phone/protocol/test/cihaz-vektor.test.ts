import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { cihazAsagiCoz, cihazYukariCoz } from "../src/index.ts";

type Oge = { ad: string; ham: string; gecerli: boolean; tur?: string; kod?: string };
type Dosya = { surum: number; asagi: Oge[]; yukari: Oge[] };

const dosya = JSON.parse(
  readFileSync(new URL("../vektorler/cihaz-mesaj.json", import.meta.url), "utf8"),
) as Dosya;

function dene(yon: Oge[], coz: (ham: string) => { ok: boolean; mesaj?: { type: string }; kod?: string }) {
  assert.ok(yon.length > 0);
  for (const o of yon) {
    const s = coz(o.ham);
    if (o.gecerli) {
      assert.equal(s.ok, true, o.ad);
      assert.equal(s.mesaj?.type, o.tur, o.ad);
      assert.equal(o.kod, undefined, o.ad);
    } else {
      assert.equal(s.ok, false, o.ad);
      assert.equal(s.kod, o.kod, o.ad);
      assert.equal(o.tur, undefined, o.ad);
    }
  }
}

test("vektör dosyası sürüm 1 ve ad'lar yön içinde tekil", () => {
  assert.equal(dosya.surum, 1);
  for (const yon of [dosya.asagi, dosya.yukari]) {
    assert.equal(new Set(yon.map((o) => o.ad)).size, yon.length);
  }
});

test("aşağı yön vektörleri Zod çözümüyle aynı sonucu verir", () => {
  dene(dosya.asagi, cihazAsagiCoz);
});

test("yukarı yön vektörleri Zod çözümüyle aynı sonucu verir", () => {
  dene(dosya.yukari, cihazYukariCoz);
});

test("her mesaj türünden en az bir geçerli örnek var", () => {
  const asagi = new Set(dosya.asagi.filter((o) => o.gecerli).map((o) => o.tur));
  for (const t of ["auth_challenge", "welcome", "cmd", "notify", "grant_revoke", "error"]) {
    assert.ok(asagi.has(t), t);
  }
  const yukari = new Set(dosya.yukari.filter((o) => o.gecerli).map((o) => o.tur));
  for (const t of ["hello", "auth_response", "cmd_result", "grant_issued", "grant_revoked", "device_state", "app_list", "notify_ack"]) {
    assert.ok(yukari.has(t), t);
  }
});

test("her komut adından geçerli cmd örneği var", () => {
  const adlar = new Set<string>();
  for (const o of dosya.asagi) {
    if (!o.gecerli || o.tur !== "cmd") continue;
    const m = JSON.parse(o.ham) as { name: string };
    adlar.add(m.name);
  }
  for (const a of ["foreground", "elements", "screenshot", "zoom", "click", "type_text", "key", "scroll", "drag", "wait", "open_app"]) {
    assert.ok(adlar.has(a), a);
  }
});
