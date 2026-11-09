import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { cihazYukariCoz } from "../../../../../protocol/src/index.ts";

// Dosya yolu: .jsonl ile biten ilk argüman ya da ERENCIKTI ortam değişkeni. Kotlin testleri
// (`SahteCikti`) yazar.
const verilen = process.argv.slice(2).find((a) => a.endsWith(".jsonl")) ?? process.env.ERENCIKTI;
const yol = resolve(verilen ?? "build/cikti.jsonl");

test("Kotlin'in ürettiği her giden çerçeve cihazYukariCoz'dan geçer", () => {
  assert.ok(existsSync(yol), `çıktı dosyası yok: ${yol}`);
  const satirlar = readFileSync(yol, "utf8").split("\n").filter((s) => s.length > 0);
  assert.ok(satirlar.length > 0, "çıktı dosyası boş");
  const turler = new Set<string>();
  satirlar.forEach((satir, i) => {
    const s = cihazYukariCoz(satir);
    assert.equal(
      s.ok,
      true,
      `satır ${i + 1} geçersiz: ${s.ok ? "" : s.yollar.join(",")} :: ${satir.slice(0, 200)}`,
    );
    if (s.ok) turler.add(s.mesaj.type);
  });
  for (const t of [
    "hello",
    "auth_response",
    "cmd_result",
    "grant_issued",
    "grant_revoked",
    "device_state",
    "app_list",
    "notify_ack",
  ]) {
    assert.ok(turler.has(t), `çıktıda ${t} türü yok`);
  }
});
