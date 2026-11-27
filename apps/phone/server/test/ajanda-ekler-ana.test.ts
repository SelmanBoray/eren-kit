/**
 * `ana` bağlaması (ek yedeği): `ServisGirdisi.ajandaEkDiski` verilince ek modülü kurulur, ajanda modülü
 * `ek_yedegi`'ni sunar, açılışta ilk temizlik turu arkada koşar, kapanış onu bekler. Verilmezse (bugünkü
 * testler, eski çağıranlar) modül yoktur ve sunulan küme `AJANDA_SUNULAN_YETENEKLER`'dir.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AJANDA_SUNULAN_YETENEKLER } from "../src/ajanda.ts";
import { servisKur } from "../src/ana.ts";
import { ayarKur } from "../src/ayar.ts";
import type { Ayar } from "../src/sozlesme.ts";
import { sahteEkDiski } from "./sahte-ek-diski.ts";
import { sahteDunya } from "./sahte.ts";

const T0 = Date.UTC(2026, 10, 27, 9, 0, 0);
const YEREL = "C:\\ornek\\Yerel";
const CLAUDE_EXE = "C:\\ornek\\bin\\claude.exe";

async function ortam() {
  const d = sahteDunya({ baslangicMs: T0, servisPid: 4000 });
  d.dosya.yaz(CLAUDE_EXE, "");
  d.dosya.yaz(`${YEREL}\\eren-kit\\ayar.local.json`, JSON.stringify({ kullanici_adi: "Deneme", claude_exe: CLAUDE_EXE, tam_yetki: false }));
  const ayar: Ayar = await ayarKur({
    dosya: d.dosya,
    ortam: { LOCALAPPDATA: YEREL, USERPROFILE: "C:\\ornek\\Kullanici", PATH: "C:\\ornek\\bin" },
    execPath: "C:\\ornek\\node.exe",
    baslangicMs: T0 - 5_000,
  });
  return { d, ayar };
}

describe("ana: ek yedeği bağlaması", () => {
  it("ajandaEkDiski verilince modül kurulur, ek_yedegi sunulur, açılışta temizlik turu koşar", async () => {
    const { d, ayar } = await ortam();
    const sd = sahteEkDiski(() => d.zaman.saat.simdiMs());
    const s = servisKur({ dunya: d.dunya, ayar, depoYolu: ":memory:", ajanda: { sistemDilimi: () => "Europe/Istanbul" }, ajandaEkDiski: sd.disk });
    try {
      assert.ok(s.ajandaEkleri !== null);
      assert.deepEqual(s.ajanda!.yetenekler, ["ek_yedegi"]);
      s.ajandaEkleri.baslat();
      await s.ajandaEkleri.bekle();
      assert.ok(sd.cagrilar.includes("tamListesi"));
    } finally {
      await s.ajandaEkleri?.kapat();
      s.depo.kapat();
    }
  });

  it("verilmezse ya da ajanda kapalıysa modül yok, sunulan küme değişmez", async () => {
    const { d, ayar } = await ortam();
    const s1 = servisKur({ dunya: d.dunya, ayar, depoYolu: ":memory:", ajanda: { sistemDilimi: () => "Europe/Istanbul" } });
    try {
      assert.equal(s1.ajandaEkleri, null);
      assert.deepEqual(s1.ajanda!.yetenekler, AJANDA_SUNULAN_YETENEKLER);
    } finally {
      s1.depo.kapat();
    }
    const sd = sahteEkDiski(() => 0);
    const s2 = servisKur({ dunya: d.dunya, ayar, depoYolu: ":memory:", ajanda: false, ajandaEkDiski: sd.disk });
    try {
      assert.equal(s2.ajandaEkleri, null);
      assert.equal(s2.ajanda, null);
    } finally {
      s2.depo.kapat();
    }
  });
});
