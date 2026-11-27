/**
 * ajanda-geri.ts testleri: geri almada ajanda sürümü koruması (AJANDA.md "Geri alma kısıtı").
 * Her test os.tmpdir() altında sahte sürüm dizini ve geçici eren.db kurar; canlı veri köküne dokunmaz.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ajandaGeriAlmaUyarisi, ajandaSurumuOku, depoyuDenetle, eskiSurumunSorunlari } from "../ajanda-geri.ts";
import { AJANDA_GOVDE_SEMALARI } from "../../protocol/src/ajanda.ts";

const kokler: string[] = [];
const gecici = (onek: string): string => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `eren-ajgeri-${onek}-`)));
  kokler.push(d);
  return d;
};
const temizle = (): void => {
  while (kokler.length > 0) fs.rmSync(kokler.pop() as string, { recursive: true, force: true });
};

/** v2 ve v3 şemasına uyan kayıt (protokol vektörü). */
const v2Kaydi = (): Record<string, unknown> => ({
  kayit_id: "k_dis01",
  revizyon: 12,
  tur: "randevu",
  baslik: "Dişçi",
  zaman: { kesinlik: "an", tarih: "2026-11-26", saat: "15:00", saat_dilimi: "Europe/Istanbul", ifade: "yarın 3'te" },
  hatirlatmalar: [{ tur: "once", dk: 60 }],
  ornekler: [],
  durum: "acik",
  taslak: false,
  silindi: false,
  elle_alanlar: [],
  kaynak: { yol: "elle", tur_kokeni: "insan", device_id: "d_telefon01" },
  olusturma_ms: 1795000000000,
  guncelleme_ms: 1795000000000,
});
const v3Kaydi = (kayit_id: string): Record<string, unknown> => ({ ...v2Kaydi(), kayit_id, bolge: "market", simge: "alisveris" });

const surumDizini = (ajandaSurumu: number | null): string => {
  const d = gecici("surum");
  fs.mkdirSync(path.join(d, "protocol", "src"), { recursive: true });
  const govde = ajandaSurumu === null ? "export const SOHBET_SURUMU = 4 as const;\n" : `export const AJANDA_SURUMU = ${ajandaSurumu} as const;\n`;
  fs.writeFileSync(path.join(d, "protocol", "src", "sinirlar.ts"), `/** sahte */\n${govde}`);
  return d;
};

/** Servisin tablosunun (depo.ts ek göç 6) okunan sütunlarıyla geçici depo; WAL kipinde, servis gibi. */
const depoKur = (kayitlar: readonly Record<string, unknown>[], acikKalsin = false): { yol: string; db: DatabaseSync | null } => {
  const yol = path.join(gecici("vt"), "eren.db");
  const db = new DatabaseSync(yol);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`CREATE TABLE ajanda_kayitlari (kayit_id TEXT PRIMARY KEY, revizyon INTEGER NOT NULL, olusturma_rev INTEGER NOT NULL,
    tekil_anahtar TEXT, tur TEXT NOT NULL, durum TEXT NOT NULL, silindi INTEGER NOT NULL, veri TEXT NOT NULL) STRICT`);
  const ekle = db.prepare("INSERT INTO ajanda_kayitlari VALUES (?, ?, ?, NULL, ?, ?, ?, ?)");
  kayitlar.forEach((k, i) => ekle.run(String(k.kayit_id), i + 1, i + 1, String(k.tur), String(k.durum), k.silindi === true ? 1 : 0, JSON.stringify(k)));
  if (!acikKalsin) {
    db.close();
    return { yol, db: null };
  }
  return { yol, db };
};

test("örnek kayıtlar: v2 kaydı iki şemaya uyar, v3 kaydı yalnız v3'e", () => {
  assert.equal(AJANDA_GOVDE_SEMALARI[2].Kaydi.safeParse(v2Kaydi()).success, true);
  assert.equal(AJANDA_GOVDE_SEMALARI[3].Kaydi.safeParse(v3Kaydi("k_v3")).success, true);
  assert.equal(AJANDA_GOVDE_SEMALARI[2].Kaydi.safeParse(v3Kaydi("k_v3")).success, false);
});

test("ajandaSurumuOku: sinirlar.ts metninden; sabit ya da dosya yoksa null", () => {
  try {
    assert.equal(ajandaSurumuOku(surumDizini(2)), 2);
    assert.equal(ajandaSurumuOku(surumDizini(null)), null);
    assert.equal(ajandaSurumuOku(gecici("bos")), null);
  } finally {
    temizle();
  }
});

test("eskiSurumunSorunlari: v2'de v3 alanlarını, v1'de gun_bolumu'nu adlandırır; güncel sürümde boş", () => {
  assert.deepEqual(eskiSurumunSorunlari(v2Kaydi(), 2), []);
  assert.deepEqual(eskiSurumunSorunlari(v3Kaydi("k"), 2), ["bolge", "simge"]);
  assert.deepEqual(eskiSurumunSorunlari(v3Kaydi("k"), 3), []);
  const bolumlu = { ...v2Kaydi(), zaman: { kesinlik: "gun", tarih: "2026-11-26", gun_bolumu: "sabah", saat_dilimi: "Europe/Istanbul" } };
  assert.equal(AJANDA_GOVDE_SEMALARI[2].Kaydi.safeParse(bolumlu).success, true, "örnek v2'de geçerli olmalı");
  assert.deepEqual(eskiSurumunSorunlari(bolumlu, 2), []);
  assert.deepEqual(eskiSurumunSorunlari(bolumlu, 1), ["zaman.gun_bolumu"]);
});

test("depoyuDenetle: v3 kayıt (silinmiş dahil) sayılır; depo ya da tablo yoksa uyumlu; salt okur", () => {
  try {
    const { yol } = depoKur([v2Kaydi(), v3Kaydi("k_a"), { ...v3Kaydi("k_b"), silindi: true }]);
    const once = fs.readFileSync(yol);
    const d = depoyuDenetle(yol, 2);
    assert.deepEqual(d, { tur: "uyumsuz", toplam: 3, adet: 2, silinmis: 1, alanlar: ["bolge", "simge"] });
    assert.deepEqual(depoyuDenetle(yol, 3), { tur: "uyumlu", toplam: 0 }, "güncel sürüm depo açmadan uyumlu");
    assert.deepEqual(fs.readFileSync(yol), once, "depo değişmemeli");

    assert.deepEqual(depoyuDenetle(depoKur([v2Kaydi()]).yol, 2), { tur: "uyumlu", toplam: 1 });
    assert.deepEqual(depoyuDenetle(path.join(gecici("yok"), "eren.db"), 2), { tur: "uyumlu", toplam: 0 });

    const tablosuz = path.join(gecici("tablosuz"), "eren.db");
    new DatabaseSync(tablosuz).close();
    assert.deepEqual(depoyuDenetle(tablosuz, 2), { tur: "uyumlu", toplam: 0 });

    const bozuk = path.join(gecici("bozuk"), "eren.db");
    fs.writeFileSync(bozuk, "veritabanı değil".repeat(100));
    assert.equal(depoyuDenetle(bozuk, 2).tur, "okunamadi");
  } finally {
    temizle();
  }
});

test("depoyuDenetle: servis depoyu açık tutarken (WAL, yazılmamış satır) de okur", () => {
  try {
    const { yol, db } = depoKur([v2Kaydi()], true);
    assert.ok(db !== null);
    try {
      db.prepare("INSERT INTO ajanda_kayitlari VALUES ('k_yeni', 99, 99, NULL, 'gorev', 'acik', 0, ?)").run(JSON.stringify(v3Kaydi("k_yeni")));
      const d = depoyuDenetle(yol, 2);
      assert.equal(d.tur, "uyumsuz");
      assert.equal(d.tur === "uyumsuz" ? d.adet : -1, 1);
      // okuyucu yazıcıyı kilitlemez
      db.prepare("UPDATE ajanda_kayitlari SET revizyon = 100 WHERE kayit_id = 'k_yeni'").run();
    } finally {
      db.close();
    }
  } finally {
    temizle();
  }
});

test("ajandaGeriAlmaUyarisi: v3 kayıt varken v2'ye dönüş uyarır; yokken, aynı sürümde ve ajanda öncesinde susar", () => {
  try {
    const v3li = depoKur([v2Kaydi(), v3Kaydi("k_a")]).yol;
    const u = ajandaGeriAlmaUyarisi("abc1234", surumDizini(2), v3li);
    assert.ok(u !== null);
    assert.match(u, /abc1234, ajanda v2/);
    assert.match(u, /2 ajanda kaydından 1'ini çözemez/);
    assert.match(u, /alanlar: bolge, simge/);
    assert.match(u, /ic_hata/);
    assert.match(u, /ajanda v3 servisine dönülene kadar/);

    assert.equal(ajandaGeriAlmaUyarisi("abc1234", surumDizini(2), depoKur([v2Kaydi()]).yol), null);
    assert.equal(ajandaGeriAlmaUyarisi("abc1234", surumDizini(3), v3li), null);
    assert.equal(ajandaGeriAlmaUyarisi("abc1234", surumDizini(null), v3li), null);

    const bozuk = path.join(gecici("bozuk"), "eren.db");
    fs.writeFileSync(bozuk, "veritabanı değil".repeat(100));
    assert.match(ajandaGeriAlmaUyarisi("abc1234", surumDizini(2), bozuk) ?? "", /denetlenemedi/);
  } finally {
    temizle();
  }
});
