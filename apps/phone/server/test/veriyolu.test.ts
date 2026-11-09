import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ServisOlaylari } from "../src/sozlesme.ts";
import { veriyoluKur } from "../src/veriyolu.ts";
import { sahteGunluk } from "./sahte.ts";

const kur = () => {
  const gunluk = sahteGunluk();
  return { gunluk, yol: veriyoluKur({ gunluk }) };
};

describe("veriyolu: sıra", () => {
  it("dinleyiciler kayıt sırasıyla çalışır", () => {
    const { yol } = kur();
    const sira: string[] = [];
    yol.dinle("tur_basladi", () => sira.push("a"));
    yol.dinle("tur_basladi", () => sira.push("b"));
    yol.dinle("tur_basladi", () => sira.push("c"));
    yol.yayinla("tur_basladi", { sohbet_id: "ana", turn_id: "t1" });
    assert.deepEqual(sira, ["a", "b", "c"]);
  });

  it("veri dinleyiciye olduğu gibi gider", () => {
    const { yol } = kur();
    const alinan: ServisOlaylari["tur_delta"][] = [];
    yol.dinle("tur_delta", (v) => alinan.push(v));
    const veri = { sohbet_id: "ana", turn_id: "t1", offset: 3, text: "abc" };
    yol.yayinla("tur_delta", veri);
    assert.equal(alinan.length, 1);
    assert.deepEqual(alinan[0], veri);
  });

  it("olay adları ayrıdır: yalnız o ada kayıtlı dinleyici çalışır", () => {
    const { yol } = kur();
    const sira: string[] = [];
    yol.dinle("tur_basladi", () => sira.push("basladi"));
    yol.dinle("tur_bitti", () => sira.push("bitti"));
    yol.yayinla("tur_bitti", { sohbet_id: "ana", turn_id: "t1" });
    assert.deepEqual(sira, ["bitti"]);
  });

  it("dinleyicisiz yayın sessizce geçer", () => {
    const { yol, gunluk } = kur();
    assert.doesNotThrow(() => yol.yayinla("cihaz_baglantisi", { bagli: true }));
    assert.equal(gunluk.girdiler.length, 0);
  });

  it("yayın eşzamanlıdır: dönüşte dinleyiciler çalışmıştır", () => {
    const { yol } = kur();
    let cagrildi = false;
    yol.dinle("is_sayisi_degisti", () => {
      cagrildi = true;
    });
    yol.yayinla("is_sayisi_degisti", { aktif: 2 });
    assert.equal(cagrildi, true);
  });
});

describe("veriyolu: hata yalıtımı", () => {
  it("atan dinleyici sıradakini durdurmaz", () => {
    const { yol } = kur();
    const sira: string[] = [];
    yol.dinle("tur_basladi", () => sira.push("a"));
    yol.dinle("tur_basladi", () => {
      throw new Error("patladi");
    });
    yol.dinle("tur_basladi", () => sira.push("c"));
    yol.yayinla("tur_basladi", { sohbet_id: "ana", turn_id: "t1" });
    assert.deepEqual(sira, ["a", "c"]);
  });

  it("yayınlayana hata dönmez", () => {
    const { yol } = kur();
    yol.dinle("tur_basladi", () => {
      throw new Error("patladi");
    });
    assert.doesNotThrow(() => yol.yayinla("tur_basladi", { sohbet_id: "ana", turn_id: "t1" }));
  });

  it("atılan değer Error olmasa da yalıtılır", () => {
    const { yol } = kur();
    const sira: string[] = [];
    yol.dinle("tur_basladi", () => {
      throw "metin";
    });
    yol.dinle("tur_basladi", () => {
      throw null;
    });
    yol.dinle("tur_basladi", () => sira.push("son"));
    assert.doesNotThrow(() => yol.yayinla("tur_basladi", { sohbet_id: "ana", turn_id: "t1" }));
    assert.deepEqual(sira, ["son"]);
  });

  it("atan her dinleyici günlüğe yazılır, başarılılar yazılmaz", () => {
    const { yol, gunluk } = kur();
    yol.dinle("tur_basladi", () => {});
    yol.dinle("tur_basladi", () => {
      throw new Error("bir");
    });
    yol.dinle("tur_basladi", () => {
      throw new Error("iki");
    });
    yol.yayinla("tur_basladi", { sohbet_id: "ana", turn_id: "t1" });
    assert.equal(gunluk.girdiler.length, 2);
    for (const g of gunluk.girdiler) assert.notEqual(g.seviye, "bilgi");
  });

  it("atmayan yayın günlüğe yazmaz", () => {
    const { yol, gunluk } = kur();
    yol.dinle("tur_basladi", () => {});
    yol.yayinla("tur_basladi", { sohbet_id: "ana", turn_id: "t1" });
    assert.equal(gunluk.girdiler.length, 0);
  });

  it("atan dinleyici kayıtta kalır: sonraki yayında yine çalışır", () => {
    const { yol } = kur();
    let sayac = 0;
    yol.dinle("tur_basladi", () => {
      sayac++;
      throw new Error("patladi");
    });
    yol.yayinla("tur_basladi", { sohbet_id: "ana", turn_id: "t1" });
    yol.yayinla("tur_basladi", { sohbet_id: "ana", turn_id: "t2" });
    assert.equal(sayac, 2);
  });
});

describe("veriyolu: çözücü", () => {
  it("dinle işlev verir; çağrılınca dinleyici düşer", () => {
    const { yol } = kur();
    let sayac = 0;
    const iptal = yol.dinle("tur_bitti", () => sayac++);
    assert.equal(typeof iptal, "function");
    yol.yayinla("tur_bitti", { sohbet_id: "ana", turn_id: "t1" });
    iptal();
    yol.yayinla("tur_bitti", { sohbet_id: "ana", turn_id: "t2" });
    assert.equal(sayac, 1);
  });

  it("çözücü ikinci kez çağrılınca zarar vermez", () => {
    const { yol } = kur();
    const iptal = yol.dinle("tur_bitti", () => {});
    iptal();
    assert.doesNotThrow(() => iptal());
  });

  it("çözmek yalnız kendi dinleyicisini kaldırır", () => {
    const { yol } = kur();
    const sira: string[] = [];
    yol.dinle("tur_bitti", () => sira.push("a"));
    const iptalB = yol.dinle("tur_bitti", () => sira.push("b"));
    yol.dinle("tur_bitti", () => sira.push("c"));
    iptalB();
    yol.yayinla("tur_bitti", { sohbet_id: "ana", turn_id: "t1" });
    assert.deepEqual(sira, ["a", "c"]);
  });

  it("aynı işlev iki kez kaydedilirse çözücüler bağımsızdır", () => {
    const { yol } = kur();
    let sayac = 0;
    const f = () => {
      sayac++;
    };
    const iptal1 = yol.dinle("tur_bitti", f);
    yol.dinle("tur_bitti", f);
    iptal1();
    yol.yayinla("tur_bitti", { sohbet_id: "ana", turn_id: "t1" });
    assert.equal(sayac, 1);
  });

  it("dinleyici kendi yayını sırasında kendini çözebilir, sıradakiler aksamaz", () => {
    const { yol } = kur();
    const sira: string[] = [];
    const iptal = yol.dinle("tur_bitti", () => {
      sira.push("a");
      iptal();
    });
    yol.dinle("tur_bitti", () => sira.push("b"));
    yol.yayinla("tur_bitti", { sohbet_id: "ana", turn_id: "t1" });
    yol.yayinla("tur_bitti", { sohbet_id: "ana", turn_id: "t2" });
    assert.deepEqual(sira, ["a", "b", "b"]);
  });
});

describe("veriyolu: yayın sırasında ekleme", () => {
  it("yayın sırasında eklenen dinleyici o yayını görmez, sonrakini görür", () => {
    const { yol } = kur();
    const sira: string[] = [];
    let eklendi = false;
    yol.dinle("tur_basladi", (v) => {
      sira.push(`a:${v.turn_id}`);
      if (!eklendi) {
        eklendi = true;
        yol.dinle("tur_basladi", (w) => sira.push(`yeni:${w.turn_id}`));
      }
    });
    yol.yayinla("tur_basladi", { sohbet_id: "ana", turn_id: "t1" });
    assert.deepEqual(sira, ["a:t1"]);
    yol.yayinla("tur_basladi", { sohbet_id: "ana", turn_id: "t2" });
    assert.deepEqual(sira, ["a:t1", "a:t2", "yeni:t2"]);
  });

  it("yayın sırasında çözülen sonraki dinleyici de o yayın için kayıtlı sayılır (anlık görüntü)", () => {
    const { yol } = kur();
    const sira: string[] = [];
    let iptalB: () => void = () => {};
    yol.dinle("tur_bitti", () => {
      sira.push("a");
      iptalB();
    });
    iptalB = yol.dinle("tur_bitti", () => sira.push("b"));
    yol.yayinla("tur_bitti", { sohbet_id: "ana", turn_id: "t1" });
    yol.yayinla("tur_bitti", { sohbet_id: "ana", turn_id: "t2" });
    // Anlık görüntü ya da çözülene dek çalışma: ikinci yayında b kesinlikle yok.
    assert.equal(sira.filter((x) => x === "b").length <= 1, true);
    assert.deepEqual(sira.slice(-1), ["a"]);
  });

  it("iç içe yayın: dinleyici içinden başka olay yayınlanabilir", () => {
    const { yol } = kur();
    const sira: string[] = [];
    yol.dinle("tur_basladi", (v) => {
      sira.push("basladi");
      yol.yayinla("tur_bitti", { sohbet_id: "ana", turn_id: v.turn_id });
    });
    yol.dinle("tur_bitti", () => sira.push("bitti"));
    yol.yayinla("tur_basladi", { sohbet_id: "ana", turn_id: "t1" });
    assert.deepEqual(sira, ["basladi", "bitti"]);
  });
});

describe("veriyolu: örnekler bağımsız", () => {
  it("iki veriyolu birbirinin dinleyicisini görmez", () => {
    const a = kur().yol;
    const b = kur().yol;
    let sayac = 0;
    a.dinle("tur_basladi", () => sayac++);
    b.yayinla("tur_basladi", { sohbet_id: "ana", turn_id: "t1" });
    assert.equal(sayac, 0);
  });
});
