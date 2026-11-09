import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { baglantiKur, GERI_CEKILME } from "../../src/cekirdek/baglanti.ts";
import type { Baglanti, BaglantiHatasi, KimlikliCerceve } from "../../src/cekirdek/baglanti.ts";
import type { BaglantiDurumu } from "../../src/cekirdek/sozlesme.ts";
import { SOHBET_SURUMU } from "@eren/protocol";
import { ack, bosalt, challenge, chatClear, chatCreate, chatDelete, chatRename, delta, elSikis, IMZA, NONCE, OTURUM, SahteKimlik, SahteSaat, SahteWs, v, welcome, yankiOlayi, olayCercevesi } from "./sahte.ts";

const kur = (sonSeq = 0) => {
  const ws = new SahteWs();
  const kimlik = new SahteKimlik();
  const saat = new SahteSaat();
  const kayit = {
    durumlar: [] as BaglantiDurumu[],
    hatalar: [] as BaglantiHatasi[],
    kimlikTamam: 0,
    cerceveler: [] as KimlikliCerceve[],
    koptu: 0,
  };
  const b: Baglanti = baglantiKur({
    ws,
    kimlik,
    saat,
    sonSeq: () => sonSeq,
    dinleyici: {
      durumDegisti: (d) => kayit.durumlar.push(d),
      hata: (h) => kayit.hatalar.push(h),
      kimlikTamam: () => {
        kayit.kimlikTamam++;
      },
      cerceve: (c) => kayit.cerceveler.push(c),
      koptu: () => {
        kayit.koptu++;
      },
    },
  });
  return { ws, kimlik, saat, kayit, b };
};

type Yukari = Parameters<Baglanti["gonder"]>[0];
/** sahte.ts yardımcıları `type: string` döner; dar tipe bu noktada indirilir. */
const yukari = (m: unknown): Yukari => m as Yukari;

const IS_MESAJI = { v, type: "user_message", client_msg_id: "x-1", sohbet_id: "ana", input: "yazi", text: "gizli" } as const;

describe("baglanti: kimlik", () => {
  it("hello last_seq'i taşır, auth_response yalnız sınamadan sonra gider, welcome ile bağlanır", async () => {
    const { ws, kimlik, b, kayit } = kur(7);
    b.baslat();
    await bosalt();
    const c = ws.son();
    assert.equal(c.url, "ws://100.64.0.1:8443/sohbet");
    c.acildi();
    await bosalt();
    assert.deepEqual(c.giden(), [
      { v, type: "hello", device_id: "cihaz-1", last_seq: 7, client_nonce: NONCE },
    ]);
    c.gel(challenge());
    await bosalt();
    assert.deepEqual(kimlik.sinamaCagrilari, [{ oturum: OTURUM, server_nonce: NONCE, server_signature: IMZA }]);
    assert.deepEqual(c.tipler(), ["hello", "auth_response"]);
    assert.equal(b.durum(), "el_sikisma");
    c.gel(welcome(3));
    await bosalt();
    assert.equal(b.durum(), "bagli");
    assert.equal(kayit.kimlikTamam, 1);
  });

  it("kimlik bitmeden iş mesajı gitmez (her aşamada)", async () => {
    const { ws, b } = kur();
    b.baslat();
    assert.equal(b.gonder(IS_MESAJI), false);
    await bosalt();
    const c = ws.son();
    assert.equal(b.gonder(IS_MESAJI), false);
    c.acildi();
    await bosalt();
    assert.equal(b.gonder(IS_MESAJI), false);
    c.gel(challenge());
    await bosalt();
    assert.equal(b.gonder(IS_MESAJI), false);
    assert.ok(!c.tipler().includes("user_message"));
    c.gel(welcome(0));
    await bosalt();
    assert.equal(b.gonder(IS_MESAJI), true);
    assert.deepEqual(c.tipler(), ["hello", "auth_response", "user_message"]);
  });

  it("bağlıyken hello/auth_response gibi kimlik mesajı iş mesajı sayılıp yollanmaz", async () => {
    const { ws, b } = kur();
    b.baslat();
    await bosalt();
    await elSikis(ws.son());
    const once = ws.son().gidenler.length;
    assert.equal(b.gonder({ v, type: "auth_response", signature: IMZA }), false);
    assert.equal(ws.son().gidenler.length, once);
  });

  it("PC imzası geçersizse auth_response gitmez ve bağlantı kapanır", async () => {
    const { ws, kimlik, b, kayit } = kur();
    kimlik.sinamaSonucu = { hata: "imza_gecersiz" };
    b.baslat();
    await bosalt();
    const c = ws.son();
    c.acildi();
    await bosalt();
    c.gel(challenge());
    await bosalt();
    assert.deepEqual(c.tipler(), ["hello"]);
    assert.equal(c.kapatildi, true);
    assert.deepEqual(kayit.hatalar, ["pc_imzasi_gecersiz"]);
    assert.equal(kayit.kimlikTamam, 0);
    assert.equal(b.durum(), "kapali");
    // Sonradan gelen welcome kapanmış bağlantıda kabul edilmez.
    c.gel(welcome(0));
    await bosalt();
    assert.equal(kayit.kimlikTamam, 0);
  });

  it("oturum süresi bitmişse (oturum_yok) auth_response gitmez", async () => {
    const { ws, kimlik, b, kayit } = kur();
    kimlik.sinamaSonucu = { hata: "oturum_yok" };
    b.baslat();
    await bosalt();
    const c = ws.son();
    c.acildi();
    await bosalt();
    c.gel(challenge());
    await bosalt();
    assert.ok(!c.tipler().includes("auth_response"));
    assert.deepEqual(kayit.hatalar, ["oturum_yok"]);
  });

  it("Tailscale dışı adrese bağlanılmaz", async () => {
    for (const host of ["192.168.1.5", "8.8.8.8", "10.0.0.1", "100.63.255.1", "100.128.0.1", "example.com", "127.0.0.1", ""]) {
      const { ws, kimlik, b, kayit } = kur();
      kimlik.eslesmeDegeri = { device_id: "cihaz-1", host, port: 8443 };
      b.baslat();
      await bosalt();
      assert.equal(ws.baglantilar.length, 0, `host=${host}`);
      assert.deepEqual(kayit.hatalar, ["eslesme_gecersiz"], `host=${host}`);
    }
  });

  it("geçersiz port'a bağlanılmaz; Tailscale aralığının uçları kabul edilir", async () => {
    const a = kur();
    a.kimlik.eslesmeDegeri = { device_id: "cihaz-1", host: "100.64.0.1", port: 0 };
    a.b.baslat();
    await bosalt();
    assert.equal(a.ws.baglantilar.length, 0);

    for (const host of ["100.64.0.0", "100.127.255.255"]) {
      const k = kur();
      k.kimlik.eslesmeDegeri = { device_id: "cihaz-1", host, port: 1 };
      k.b.baslat();
      await bosalt();
      assert.equal(k.ws.son().url, `ws://${host}:1/sohbet`);
    }
  });

  it("eşleşme yoksa bağlanılmaz", async () => {
    const { ws, kimlik, b, kayit } = kur();
    kimlik.eslesmeDegeri = null;
    b.baslat();
    await bosalt();
    assert.equal(ws.baglantilar.length, 0);
    assert.deepEqual(kayit.hatalar, ["eslesme_yok"]);
  });
});

describe("baglanti: /sohbet v4", () => {
  it("giden hello ve auth_response v4 taşır", async () => {
    const { ws, b } = kur(4);
    b.baslat();
    await bosalt();
    await elSikis(ws.son());
    const giden = ws.son().giden();
    assert.equal(SOHBET_SURUMU, 4);
    assert.deepEqual(giden.map((m) => [m["type"], m["v"]]), [
      ["hello", 4],
      ["auth_response", 4],
    ]);
  });

  it("eski sürüm (v1, v2) sunucu çerçevesi reddedilir (challenge, welcome ve bağlıyken ack)", async () => {
    // Kimlik aşamasında v1 auth_challenge.
    const a = kur();
    a.b.baslat();
    await bosalt();
    a.ws.son().acildi();
    await bosalt();
    a.ws.son().gel({ ...challenge(), v: 1 });
    await bosalt();
    assert.equal(a.ws.son().kapatildi, true);
    assert.deepEqual(a.kayit.hatalar, ["protokol_uyumsuz"]);
    assert.deepEqual(a.ws.son().tipler(), ["hello"]);
    assert.equal(a.kayit.kimlikTamam, 0);

    // v1 welcome.
    const w = kur();
    w.b.baslat();
    await bosalt();
    w.ws.son().acildi();
    await bosalt();
    w.ws.son().gel(challenge());
    await bosalt();
    w.ws.son().gel({ ...welcome(0), v: 1 });
    await bosalt();
    assert.equal(w.ws.son().kapatildi, true);
    assert.equal(w.kayit.kimlikTamam, 0);
    assert.notEqual(w.b.durum(), "bagli");

    // Bağlıyken v1 ack.
    const k = kur();
    k.b.baslat();
    await bosalt();
    await elSikis(k.ws.son());
    k.ws.son().gel({ ...ack("x-1"), v: 1 });
    await bosalt();
    assert.equal(k.ws.son().kapatildi, true);
    assert.equal(k.kayit.cerceveler.length, 0);
    assert.deepEqual(k.kayit.hatalar, ["protokol_uyumsuz"]);
  });

  for (const eski of [2, 3]) {
    it(`v${eski} sunucu çerçevesi de reddedilir (challenge, welcome, bağlıyken ack)`, async () => {
      const a = kur();
      a.b.baslat();
      await bosalt();
      a.ws.son().acildi();
      await bosalt();
      a.ws.son().gel({ ...challenge(), v: eski });
      await bosalt();
      assert.equal(a.ws.son().kapatildi, true);
      assert.deepEqual(a.kayit.hatalar, ["protokol_uyumsuz"]);
      assert.equal(a.kayit.kimlikTamam, 0);

      const w = kur();
      w.b.baslat();
      await bosalt();
      w.ws.son().acildi();
      await bosalt();
      w.ws.son().gel(challenge());
      await bosalt();
      w.ws.son().gel({ ...welcome(0), v: eski });
      await bosalt();
      assert.equal(w.ws.son().kapatildi, true);
      assert.equal(w.kayit.kimlikTamam, 0);
      assert.notEqual(w.b.durum(), "bagli");

      const k = kur();
      k.b.baslat();
      await bosalt();
      await elSikis(k.ws.son());
      k.ws.son().gel({ ...ack("x-1"), v: eski });
      await bosalt();
      assert.equal(k.ws.son().kapatildi, true);
      assert.equal(k.kayit.cerceveler.length, 0);
      assert.deepEqual(k.kayit.hatalar, ["protokol_uyumsuz"]);
    });
  }

  it("chat_create, chat_rename, chat_delete kimlik sonrası gonder ile gider, kimlik öncesi gitmez", async () => {
    const { ws, b } = kur();
    const mesajlar = [chatCreate("n-1", "s-1", "Yeni"), chatRename("n-2", "s-1", "Ad"), chatDelete("n-3", "s-1")].map(yukari);
    b.baslat();
    for (const m of mesajlar) assert.equal(b.gonder(m), false);
    await bosalt();
    const c = ws.son();
    for (const m of mesajlar) assert.equal(b.gonder(m), false);
    c.acildi();
    await bosalt();
    for (const m of mesajlar) assert.equal(b.gonder(m), false);
    c.gel(challenge());
    await bosalt();
    for (const m of mesajlar) assert.equal(b.gonder(m), false);
    assert.deepEqual(c.tipler(), ["hello", "auth_response"]);
    c.gel(welcome(0));
    await bosalt();
    for (const m of mesajlar) assert.equal(b.gonder(m), true);
    assert.deepEqual(c.giden().slice(-3), mesajlar);
    assert.deepEqual(c.tipler().slice(-3), ["chat_create", "chat_rename", "chat_delete"]);
    // Koptuktan sonra yine gitmez.
    c.kopsun();
    for (const m of mesajlar) assert.equal(b.gonder(m), false);
    assert.equal(c.tipler().length, 5);
  });

  it("IS_TURLERI v3'ün 9 iş türünün hepsini yollar", async () => {
    const { ws, b } = kur();
    b.baslat();
    await bosalt();
    await elSikis(ws.son());
    const tumu = [
      IS_MESAJI,
      { v, type: "interrupt", client_msg_id: "i-1", sohbet_id: "ana" },
      { v, type: "plan_decision", client_msg_id: "p-1", plan_id: "plan1", decision: "approve" },
      { v, type: "question_answer", client_msg_id: "q-1", question_id: "q1", answer: "a" },
      { v, type: "job_cancel", client_msg_id: "j-1", job_id: "job1" },
      chatClear("c-1"),
      chatCreate("n-1", "s-1"),
      chatRename("n-2", "s-1", "Ad"),
      chatDelete("n-3", "s-1"),
    ];
    const gonderilen: string[] = [];
    for (const m of tumu) {
      if (b.gonder(yukari(m))) gonderilen.push(m.type);
    }
    assert.deepEqual(gonderilen, [
      "user_message", "interrupt", "plan_decision", "question_answer", "job_cancel",
      "chat_clear", "chat_create", "chat_rename", "chat_delete",
    ]);
  });

  it("chat_clear geçici iş olarak yalnız bağlıyken gider", async () => {
    const { ws, b } = kur();
    const CLEAR = yukari(chatClear("c-1"));
    b.baslat();
    assert.equal(b.gonder(CLEAR), false);
    await bosalt();
    const c = ws.son();
    assert.equal(b.gonder(CLEAR), false);
    c.acildi();
    await bosalt();
    assert.equal(b.gonder(CLEAR), false);
    c.gel(challenge());
    await bosalt();
    assert.equal(b.gonder(CLEAR), false);
    assert.ok(!c.tipler().includes("chat_clear"));
    c.gel(welcome(0));
    await bosalt();
    assert.equal(b.gonder(CLEAR), true);
    assert.deepEqual(c.giden().at(-1), { v: 4, type: "chat_clear", client_msg_id: "c-1", sohbet_id: "ana" });
    // Koptuktan sonra yine gitmez.
    c.kopsun();
    assert.equal(b.gonder(CLEAR), false);
    assert.equal(c.tipler().filter((t) => t === "chat_clear").length, 1);
  });
});

describe("baglanti: bozuk ve sıra dışı çerçeve", () => {
  it("kimlik öncesi sıra dışı çerçeve (welcome challenge'dan önce) bağlantıyı kapatır", async () => {
    const { ws, b, kayit } = kur();
    b.baslat();
    await bosalt();
    const c = ws.son();
    c.acildi();
    await bosalt();
    c.gel(welcome(0));
    await bosalt();
    assert.equal(c.kapatildi, true);
    assert.deepEqual(kayit.hatalar, ["sira_disi"]);
    assert.equal(kayit.kimlikTamam, 0);
  });

  it("kimlik öncesi gelen olay çerçevesi dinleyiciye geçmez", async () => {
    const { ws, b, kayit } = kur();
    b.baslat();
    await bosalt();
    const c = ws.son();
    c.acildi();
    await bosalt();
    c.gel(olayCercevesi(yankiOlayi(1)));
    await bosalt();
    assert.equal(kayit.cerceveler.length, 0);
    assert.equal(c.kapatildi, true);
    assert.deepEqual(kayit.hatalar, ["sira_disi"]);
  });

  it("bozuk JSON, bilinmeyen alan ve şema dışı çerçeve bağlantıyı kapatır", async () => {
    const bozuklar: unknown[] = [
      "{bozuk",
      { v, type: "ack", client_msg_id: "a", ok: true, fazla: 1 },
      { v, type: "bilinmeyen_tur" },
      { v, type: "event", event: { seq: 0, ts_ms: 1, type: "user_echo" } },
    ];
    for (const bozuk of bozuklar) {
      const { ws, b, kayit } = kur();
      b.baslat();
      await bosalt();
      await elSikis(ws.son());
      assert.equal(b.durum(), "bagli");
      ws.son().gel(bozuk);
      await bosalt();
      assert.equal(ws.son().kapatildi, true, JSON.stringify(bozuk));
      assert.equal(kayit.cerceveler.length, 0);
      assert.equal(kayit.koptu, 1);
      assert.deepEqual(kayit.hatalar, ["cozum_hatasi"]);
      assert.equal(b.durum(), "kapali");
    }
  });

  it("bağlıyken ikinci welcome ya da auth_challenge sıra dışıdır", async () => {
    for (const cerceve of [welcome(0), challenge()]) {
      const { ws, b, kayit } = kur();
      b.baslat();
      await bosalt();
      await elSikis(ws.son());
      ws.son().gel(cerceve);
      await bosalt();
      assert.equal(ws.son().kapatildi, true);
      assert.deepEqual(kayit.hatalar, ["sira_disi"]);
      assert.equal(kayit.cerceveler.length, 0);
    }
  });

  it("bağlıyken geçerli çerçeve dinleyiciye geçer", async () => {
    const { ws, b, kayit } = kur();
    b.baslat();
    await bosalt();
    await elSikis(ws.son());
    ws.son().gel(delta("t1", 0, "a"));
    ws.son().gel(ack("x-1"));
    assert.deepEqual(kayit.cerceveler.map((c) => c.type), ["assistant_delta", "ack"]);
  });

  it("bozuk çerçeveden sonra kapanan bağlantıdan gelen çerçeve yok sayılır", async () => {
    const { ws, b, kayit } = kur();
    b.baslat();
    await bosalt();
    await elSikis(ws.son());
    const c = ws.son();
    c.gel("{bozuk");
    c.gel(delta("t1", 0, "geç"));
    assert.equal(kayit.cerceveler.length, 0);
  });
});

describe("baglanti: geri çekilme", () => {
  const bekleme = (k: ReturnType<typeof kur>): number | null => {
    const s = k.b.sonrakiDenemeMs();
    return s === null ? null : s - k.saat.simdiMs();
  };

  it("1-2-4-8-16-30-30 sn", async () => {
    const k = kur();
    k.b.baslat();
    const beklenen = [1, 2, 4, 8, 16, 30, 30, 30].map((s) => s * 1000);
    assert.deepEqual(beklenen.slice(0, 6), [
      GERI_CEKILME.ILK_MS,
      2000,
      4000,
      8000,
      16000,
      GERI_CEKILME.AZAMI_MS,
    ]);
    for (const ms of beklenen) {
      await bosalt();
      k.ws.son().kopsun();
      assert.equal(bekleme(k), ms);
      k.saat.ilerlet(ms - 1);
      const sayi = k.ws.baglantilar.length;
      await bosalt();
      assert.equal(k.ws.baglantilar.length, sayi, "erken denendi");
      k.saat.ilerlet(1);
    }
  });

  it("welcome geri çekilmeyi sıfırlar", async () => {
    const k = kur();
    k.b.baslat();
    for (const ms of [1000, 2000, 4000]) {
      await bosalt();
      k.ws.son().kopsun();
      k.saat.ilerlet(ms);
    }
    await bosalt();
    await elSikis(k.ws.son());
    assert.equal(k.b.durum(), "bagli");
    k.ws.son().kopsun();
    assert.equal(bekleme(k), 1000);
  });

  it("welcome'a varmadan kopan bağlantı geri çekilmeyi sıfırlamaz", async () => {
    const k = kur();
    k.b.baslat();
    await bosalt();
    k.ws.son().kopsun();
    k.saat.ilerlet(1000);
    await bosalt();
    k.ws.son().acildi();
    await bosalt();
    k.ws.son().kopsun();
    assert.equal(bekleme(k), 2000);
  });

  it("el sıkışma 15 sn içinde bitmezse bağlantı kapanır", async () => {
    const k = kur();
    k.b.baslat();
    await bosalt();
    k.ws.son().acildi();
    await bosalt();
    k.saat.ilerlet(15_000);
    assert.equal(k.ws.son().kapatildi, true);
    assert.deepEqual(k.kayit.hatalar, ["el_sikisma_zaman_asimi"]);
  });

  it("durdur yeniden denemeyi iptal eder", async () => {
    const k = kur();
    k.b.baslat();
    await bosalt();
    k.ws.son().kopsun();
    k.b.durdur();
    k.saat.ilerlet(60_000);
    await bosalt();
    assert.equal(k.ws.baglantilar.length, 1);
    assert.equal(k.b.sonrakiDenemeMs(), null);
  });

  it("bağlıyken kopan bağlantı koptu bildirir ve yeniden dener", async () => {
    const k = kur();
    k.b.baslat();
    await bosalt();
    await elSikis(k.ws.son());
    k.ws.son().kopsun();
    assert.equal(k.kayit.koptu, 1);
    assert.equal(k.b.gonder(IS_MESAJI), false);
    k.saat.ilerlet(1000);
    await bosalt();
    assert.equal(k.ws.baglantilar.length, 2);
  });
});
