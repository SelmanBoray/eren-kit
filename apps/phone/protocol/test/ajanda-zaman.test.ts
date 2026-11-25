import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AJANDA_GORUNMEZ_ARALIKLARI,
  AJANDA_SINIRLARI,
  AJANDA_VARSAYILAN_HATIRLATMALAR,
  ajandaGorunmezMi,
  ajandaMetni,
  ajandaSatiri,
  AjandaZamani,
  AjandaZamaniGirdisi,
  gorunmezBirimMi,
  gunNoTarih,
  HAFTA_GUNLERI,
  haftaGunuNo,
  ornekGunleriMi,
  ornekGunuMu,
  tekrarOrnekleri,
  gercekTarihMi,
  Hatirlatma,
  Hatirlatmalar,
  Saat,
  SaatDilimi,
  tarihGunNo,
  Tekrar,
} from "../src/index.ts";

test("takvim geçerliliği: artık yıl, ay sonları, yıl sınırları", () => {
  for (const t of ["2024-02-29", "2000-02-29", "2026-01-31", "2026-04-30", "1900-01-01", "2199-12-31"]) {
    assert.equal(gercekTarihMi(t), true, t);
  }
  for (const t of ["1900-02-29", "2100-02-29", "2026-02-29", "2026-04-31", "2026-00-10", "2026-01-00", "1899-12-31", "2200-01-01", "2026-1-01", "26-01-01", "2026-01-01T00:00", ""]) {
    assert.equal(gercekTarihMi(t), false, t);
  }
});

test("gün numarası Date.UTC ile aynıdır", () => {
  assert.equal(tarihGunNo("1970-01-01"), 0);
  for (let gun = Date.UTC(1900, 0, 1); gun <= Date.UTC(2199, 11, 31); gun += 86_400_000 * 37) {
    const tarih = new Date(gun).toISOString().slice(0, 10);
    assert.equal(tarihGunNo(tarih), gun / 86_400_000, tarih);
  }
  assert.throws(() => tarihGunNo("2026-02-30"));
});

test("saat ve saat dilimi biçimi", () => {
  for (const s of ["00:00", "09:05", "23:59"]) assert.equal(Saat.safeParse(s).success, true, s);
  for (const s of ["24:00", "9:05", "12:60", "12:00:00", "12.00"]) assert.equal(Saat.safeParse(s).success, false, s);
  for (const d of ["UTC", "Europe/Istanbul", "America/Argentina/Buenos_Aires", "Etc/GMT+3", "America/Port-au-Prince"]) {
    assert.equal(SaatDilimi.safeParse(d).success, true, d);
  }
  for (const d of ["", "utc", "Europe", "Europe/", "/Istanbul", "Europe/Istanbul/A/B", "Europe/Is tanbul", "+03:00", "A".repeat(AJANDA_SINIRLARI.SAAT_DILIMI) + "/B"]) {
    assert.equal(SaatDilimi.safeParse(d).success, false, d);
  }
});

test("araç zamanında dilim isteğe bağlı, kayıtta zorunlu; belirsiz yalnız ifade taşır", () => {
  const an = { kesinlik: "an", tarih: "2026-11-26", saat: "15:00" };
  assert.equal(AjandaZamaniGirdisi.safeParse(an).success, true);
  assert.equal(AjandaZamani.safeParse(an).success, false);
  assert.equal(AjandaZamani.safeParse({ ...an, saat_dilimi: "UTC" }).success, true);
  assert.equal(AjandaZamani.safeParse({ kesinlik: "belirsiz", ifade: "bir ara" }).success, true);
  assert.equal(AjandaZamani.safeParse({ kesinlik: "belirsiz", ifade: "bir ara", saat_dilimi: "UTC" }).success, false);
  assert.equal(AjandaZamani.safeParse({ ...an, saat_dilimi: "UTC", sure_dk: 0 }).success, false);
  assert.equal(AjandaZamani.safeParse({ ...an, saat_dilimi: "UTC", sure_dk: AJANDA_SINIRLARI.SURE_DK + 1 }).success, false);
  assert.equal(AjandaZamani.safeParse({ ...an, saat_dilimi: "UTC", ifade: "x".repeat(AJANDA_SINIRLARI.ZAMAN_IFADESI + 1) }).success, false);
});

test("hatırlatma listesi ve varsayılan", () => {
  assert.equal(Hatirlatmalar.safeParse(AJANDA_VARSAYILAN_HATIRLATMALAR).success, true);
  for (const h of AJANDA_VARSAYILAN_HATIRLATMALAR) assert.equal(Hatirlatma.parse(h).tur, "once");
  assert.equal(Hatirlatmalar.safeParse([]).success, true);
  assert.equal(Hatirlatma.safeParse({ tur: "once", dk: -1 }).success, false);
  assert.equal(Hatirlatma.safeParse({ tur: "once", dk: 1.5 }).success, false);
  assert.equal(Hatirlatma.safeParse({ tur: "mutlak", tarih: "2026-11-26", saat: "09:00" }).success, false);
  assert.equal(Hatirlatma.safeParse({ tur: "alarm", dk: 1 }).success, false);
});

test("görünmez tablo: Default_Ignorable ve kontrol karakterlerinin tamamını, eski birim denetimini kapsar", () => {
  const di = /^\p{Default_Ignorable_Code_Point}$/u;
  const cc = /^\p{Cc}$/u;
  const eksik: string[] = [];
  for (let kod = 0; kod <= 0x10ffff; kod++) {
    if (kod >= 0xd800 && kod <= 0xdfff) continue;
    if (kod === 0x09 || kod === 0x0a || kod === 0x0d) {
      assert.equal(ajandaGorunmezMi(kod), false);
      continue;
    }
    const k = String.fromCodePoint(kod);
    const gerekli = di.test(k) || cc.test(k) || (kod <= 0xffff && gorunmezBirimMi(kod));
    if (gerekli && !ajandaGorunmezMi(kod)) eksik.push(kod.toString(16));
  }
  assert.deepEqual(eksik, []);
  // Aralıklar sıralı ve ayrık (ikili arama yerine erken çıkış buna dayanır).
  for (let i = 1; i < AJANDA_GORUNMEZ_ARALIKLARI.length; i++) {
    assert.ok(AJANDA_GORUNMEZ_ARALIKLARI[i]![0] > AJANDA_GORUNMEZ_ARALIKLARI[i - 1]![1]);
  }
});

test("ajanda metni görünmez kod noktasını reddeder, görünür birleşik karakteri kabul eder", () => {
  const satir = ajandaSatiri(1, 50);
  const metin = ajandaMetni(50);
  for (const kod of [0xe0049, 0xe0001, 0xe0100, 0xe01ef, 0xfe0f, 0x3164, 0x034f, 0x180e, 0xffa0, 0x1d173, 0x115f, 0x1160]) {
    const s = "Diş" + String.fromCodePoint(kod) + "çi";
    assert.equal(satir.safeParse(s).success, false, kod.toString(16));
    assert.equal(metin.safeParse(s).success, false, kod.toString(16));
  }
  assert.equal(satir.safeParse("Café \u{1F44D}\u{1F3FD} 日本").success, true);
  assert.equal(metin.safeParse("iki\nsatır\tsekme").success, true);
  assert.equal(gorunmezBirimMi(0xdb40), false, "eski birim denetimi etiketleri görmez (bulgu; eski kanallar değişmedi)");
});

test("gunNoTarih tarihGunNo'nun tersidir; hafta günü", () => {
  for (let n = tarihGunNo("1900-01-01"); n <= tarihGunNo("2199-12-31"); n += 13) assert.equal(tarihGunNo(gunNoTarih(n)), n);
  assert.equal(gunNoTarih(0), "1970-01-01");
  assert.equal(haftaGunuNo("2026-11-25"), 2, "çarşamba");
  assert.equal(haftaGunuNo("2026-11-30"), 0, "pazartesi");
  assert.equal(haftaGunuNo("1900-01-01"), 0, "pazartesi");
});

/** Tanımın gün gün kaba hali: `tekrarOrnekleri` ile karşılaştırılır. */
function kabaOrnekler(capa: string, t: Tekrar, bitis: string): string[] {
  const c = tarihGunNo(capa);
  const cy = Number(capa.slice(0, 4));
  const cm = Number(capa.slice(5, 7));
  const cd = Number(capa.slice(8, 10));
  const cikti: string[] = [];
  for (let n = c; n <= tarihGunNo(bitis); n++) {
    const g = gunNoTarih(n);
    const y = Number(g.slice(0, 4));
    const m = Number(g.slice(5, 7));
    const d = Number(g.slice(8, 10));
    let uyar: boolean;
    if (t.siklik === "gunluk") uyar = (n - c) % t.aralik === 0;
    else if (t.siklik === "haftalik" && t.gunler === undefined) uyar = (n - c) % (7 * t.aralik) === 0;
    else if (t.siklik === "haftalik") {
      const hafta = Math.floor((n - (c - haftaGunuNo(capa))) / 7);
      uyar = hafta % t.aralik === 0 && t.gunler!.includes(HAFTA_GUNLERI[haftaGunuNo(g)]!);
    } else if (t.siklik === "aylik") uyar = d === cd && ((y - cy) * 12 + (m - cm)) % t.aralik === 0;
    else uyar = d === cd && m === cm && (y - cy) % t.aralik === 0;
    if (t.bitis_tarihi !== undefined && g > t.bitis_tarihi) break;
    if (uyar) cikti.push(g);
    if (t.adet !== undefined && cikti.length === t.adet) break;
  }
  return cikti;
}

test("tekrar örnekleri gün gün tanımla aynıdır (en_az ile atlama dahil)", () => {
  const kurallar: Tekrar[] = [
    { siklik: "gunluk", aralik: 1 },
    { siklik: "gunluk", aralik: 5, adet: 40 },
    { siklik: "haftalik", aralik: 1 },
    { siklik: "haftalik", aralik: 3, gunler: ["sal", "cmt", "paz"] },
    { siklik: "haftalik", aralik: 2, gunler: ["pzt"], adet: 7 },
    { siklik: "aylik", aralik: 1 },
    { siklik: "aylik", aralik: 5, bitis_tarihi: "2031-06-30" },
    { siklik: "aylik", aralik: 1, adet: 20 },
    { siklik: "yillik", aralik: 1 },
    { siklik: "yillik", aralik: 3, adet: 6 },
  ];
  const bitis = "2034-12-31";
  for (const capa of ["2024-02-29", "2026-01-31", "2026-11-25", "2027-03-30"]) {
    for (const t of kurallar) {
      const kaba = kabaOrnekler(capa, t, bitis);
      const hizli = [...takeWhile(tekrarOrnekleri(capa, t), (g) => g <= bitis)];
      assert.deepEqual(hizli, kaba, `${capa} ${JSON.stringify(t)}`);
      for (const enAz of ["2026-12-15", "2029-03-01", "2033-07-04"]) {
        const beklenen = kaba.filter((g) => g >= enAz);
        const atlamali = [...takeWhile(tekrarOrnekleri(capa, t, enAz), (g) => g <= bitis)];
        assert.deepEqual(atlamali, beklenen, `${capa} ${JSON.stringify(t)} en_az=${enAz}`);
      }
      for (const g of kaba.slice(0, 30)) assert.equal(ornekGunuMu(capa, t, g), true, `${capa} ${g}`);
      assert.equal(ornekGunleriMi(capa, t, kaba.slice(0, 30)), true);
      const disari = gunNoTarih(tarihGunNo(kaba[0] ?? capa) + 1);
      if (!kaba.includes(disari)) {
        assert.equal(ornekGunuMu(capa, t, disari), false, `${capa} ${disari}`);
        assert.equal(ornekGunleriMi(capa, t, [...kaba.slice(0, 1), disari].sort()), false);
      }
    }
  }
});

function* takeWhile<T>(it: Iterable<T>, kosul: (x: T) => boolean): Generator<T> {
  for (const x of it) {
    if (!kosul(x)) return;
    yield x;
  }
}

test("tekrar kuralı", () => {
  assert.equal(Tekrar.safeParse({ siklik: "haftalik", aralik: 2, gunler: ["pzt", "car", "cum"], adet: 10 }).success, true);
  assert.equal(Tekrar.safeParse({ siklik: "aylik", aralik: 1, bitis_tarihi: "2027-12-31" }).success, true);
  assert.equal(Tekrar.safeParse({ siklik: "haftalik", aralik: 1, gunler: ["pzt", "pzt"] }).success, false);
  assert.equal(Tekrar.safeParse({ siklik: "haftalik", aralik: 1, gunler: [] }).success, false);
  assert.equal(Tekrar.safeParse({ siklik: "haftalik", aralik: 0 }).success, false);
  assert.equal(Tekrar.safeParse({ siklik: "haftalik", aralik: AJANDA_SINIRLARI.TEKRAR_ARALIK + 1 }).success, false);
  assert.equal(Tekrar.safeParse({ siklik: "saatlik", aralik: 1 }).success, false);
});
