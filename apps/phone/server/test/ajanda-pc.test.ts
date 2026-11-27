/**
 * PC oturumları (`docs/AJANDA.md` "PC oturumları"): ajanda modülünün PC defteri (`ajanda-pc.ts`) ve
 * araçların `pc_oturumu` yolu, gerçek depoyla. Kancalar (`pcKanca`) turu kurar: istem (mesaj anı, insan
 * metni), araç tasdiki (çağrı kimliği, alt agent), tur sonu. Kaynak izi, kullanıcı emri/otomasyon ve
 * taslak kararı, dayanak, gece kuralı ve tekilleştirme PC yolunda da sözleşmedeki gibidir.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  AJANDA_ARACLARI,
  AJANDA_PC_SINIRLARI,
  type AjandaFiili,
  type AjandaKaydi,
  AjandaKaydi as AjandaKaydiSemasi,
  ajandaTekilAnahtari,
  PC_ISTEM_KAYNAGI_DEGERLERI,
  PC_KANCA_ARACLARI,
  PC_TEKIL_KAPSAMI,
  type PcIstemKaynagi,
  type PcTurKarari,
} from "@eren/protocol";
import { ajandaKur } from "../src/ajanda.ts";
import { depoAc } from "../src/depo.ts";
import type { CihazYonetimliDepo } from "../src/depo.ts";
import type { AjandaFiilCiktisi, AjandaFiilGirdisi, AjandaKopruBaglami, AjandaTurBaglami } from "../src/sozlesme.ts";
import { sahteGunluk, sahteRastgele, sahteTakvim, sahteZaman } from "./sahte.ts";

// 2026-11-25 14:30 Europe/Istanbul.
const T0 = 1_795_606_200_000;
const DILIM = "Europe/Istanbul";
const DAKIKA = 60_000;
const OTURUM = "3f1c2a9e-7b4d-4c1a-9e2f-0a1b2c3d4e5f";
const OTURUM_2 = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const ISTEM = "istem-0001";
const DAYANAK = { tarih: "2026-11-25", saat: "14:30" };
const MESAJ_ANI = { tarih: "2026-11-25", saat: "14:30", saat_dilimi: DILIM };

const acik: CihazYonetimliDepo[] = [];
afterEach(() => {
  for (const d of acik.splice(0)) d.kapat();
});

const DISCI: AjandaFiilGirdisi<"ajanda_ekle"> = {
  tur: "randevu",
  baslik: "Dişçi ☕️",
  zaman: { kesinlik: "an", tarih: "2026-11-26", saat: "15:00", ifade: "yarın 3'te" },
  alinti: "yarın 3'te dişçi",
  dayanak: DAYANAK,
};

let aracNo = 0;

const kur = (simdi = T0) => {
  const zaman = sahteZaman(simdi);
  const gunluk = sahteGunluk();
  const depo = depoAc({ yol: ":memory:", saat: zaman.saat, gunluk });
  acik.push(depo);
  const telefonTuru: { tur: AjandaTurBaglami | null } = { tur: null };
  const ajanda = ajandaKur({
    depo,
    takvim: sahteTakvim(DILIM),
    saat: zaman.saat,
    rastgele: sahteRastgele(),
    gunluk,
    turBaglami: () => telefonTuru.tur,
  });
  ajanda.baslat();

  /** UserPromptSubmit kancası (şemadan geçen girdi): şemadan geçen yanıt (mesaj anı). */
  const istem = (metin: string, oturum_id = OTURUM, istem_id: string | null = ISTEM, kaynak: PcIstemKaynagi = "user") => {
    const girdi = PC_KANCA_ARACLARI.pc_istem.girdi.parse({
      oturum_id,
      kaynak,
      ...(kaynak === "user" ? { metin } : {}),
      ...(istem_id === null ? {} : { istem_id }),
    });
    return PC_KANCA_ARACLARI.pc_istem.cikti.parse(ajanda.pcKanca.pc_istem(girdi));
  };
  /** PreToolUse kancası: tasdik; çağrı kimliğini döner. */
  const tasdik = (sec: { oturum_id?: string; istem_id?: string | null; alt_agent?: boolean } = {}): string => {
    const arac_cagri_id = `toolu_${++aracNo}`;
    const istem_id = sec.istem_id === null ? {} : { istem_id: sec.istem_id ?? ISTEM };
    ajanda.pcKanca.pc_arac({ oturum_id: sec.oturum_id ?? OTURUM, arac_cagri_id, alt_agent: sec.alt_agent ?? false, ...istem_id });
    return arac_cagri_id;
  };
  const turSonu = (oturum_id = OTURUM) => ajanda.pcKanca.pc_tur_sonu({ oturum_id });

  const pcBaglam = (arac_cagri_id?: string, oturum_id?: string): AjandaKopruBaglami => ({
    rol: "pc_oturumu",
    baglanti_id: "pcb_baglanti1",
    ...(arac_cagri_id === undefined ? {} : { arac_cagri_id }),
    ...(oturum_id === undefined ? {} : { oturum_id }),
  });

  let sonKarar: PcTurKarari | undefined;
  const cagir = async <F extends AjandaFiili>(fiil: F, girdi: AjandaFiilGirdisi<F>, baglam: AjandaKopruBaglami): Promise<AjandaFiilCiktisi<F>> => {
    const isleyici = ajanda.araclar[fiil] as (g: unknown, b: AjandaKopruBaglami, s: AbortSignal) => Promise<
      { ok: true; deger: AjandaFiilCiktisi<F>; pc_karar?: PcTurKarari } | { ok: false; code: string }
    >;
    const s = await isleyici(girdi, baglam, new AbortController().signal);
    assert.ok(s.ok, `boru hatası: ${s.ok ? "" : s.code}`);
    AJANDA_ARACLARI[fiil].cikti.parse(s.deger);
    // PC çağrısında karar her zaman döner; telefon çağrısında hiç dönmez.
    assert.equal(s.pc_karar === undefined, baglam.rol !== "pc_oturumu");
    sonKarar = s.pc_karar;
    return s.deger;
  };
  const karar = (): PcTurKarari | undefined => sonKarar;
  const ekle = (girdi: AjandaFiilGirdisi<"ajanda_ekle">, baglam: AjandaKopruBaglami) => cagir("ajanda_ekle", girdi, baglam);
  const guncelle = (girdi: AjandaFiilGirdisi<"ajanda_guncelle">, baglam: AjandaKopruBaglami) => cagir("ajanda_guncelle", girdi, baglam);
  const kayit = (id: string): AjandaKaydi => {
    const k = depo.ajandaKaydiGetir(id);
    assert.ok(k !== null);
    return AjandaKaydiSemasi.parse(k);
  };
  return { zaman, gunluk, depo, ajanda, telefonTuru, istem, tasdik, turSonu, pcBaglam, ekle, guncelle, cagir, kayit, karar };
};

const kimlik = (c: AjandaFiilCiktisi<"ajanda_ekle">): string => {
  assert.notEqual(c.sonuc, "ret", JSON.stringify(c));
  return (c as Extract<AjandaFiilCiktisi<"ajanda_ekle">, { kayit: unknown }>).kayit.kayit_id;
};

describe("PC oturumu: kancayla tasdik edilen insan turu", () => {
  it("istem → tasdik → ekleme: kullanıcı emri, taslak değil; kaynak pc_araci, oturum, istem kimliği, alıntı", async () => {
    const o = kur();
    assert.deepEqual(o.istem("yarın 3'te dişçi ☕️ randevum var, ekle"), { mesaj_ani: MESAJ_ANI });
    o.zaman.ilerlet(2 * DAKIKA);
    const c = await o.ekle(DISCI, o.pcBaglam(o.tasdik()));
    assert.equal(c.sonuc, "eklendi");
    // Mesaj anı istemin varışıdır (çağrının anı değil).
    assert.deepEqual(c.mesaj_ani, MESAJ_ANI);
    const k = o.kayit(kimlik(c));
    assert.equal(k.taslak, false);
    assert.deepEqual(k.kaynak, {
      yol: "pc_araci",
      tur_kokeni: "insan",
      oturum_id: OTURUM,
      kaynak_msg_id: ISTEM,
      alinti: "yarın 3'te dişçi",
      tekil_anahtar: ajandaTekilAnahtari({ kapsam: PC_TEKIL_KAPSAMI, tur: "randevu", baslik: "Dişçi ☕️", zaman: k.zaman }),
    });
    assert.deepEqual(k.elle_alanlar, ["tur", "baslik", "zaman"]);
    const g = o.depo.ajandaGecmisi({ kayit_id: k.kayit_id, adet: 5 });
    assert.deepEqual(g[0]!.yazar, { yol: "pc_araci", tur_kokeni: "insan", oturum_id: OTURUM });
  });

  it("alıntı istem metninde birebir geçmiyorsa saklanmaz", async () => {
    const o = kur();
    o.istem("pazartesi dişçiye gideceğim");
    const c = await o.ekle({ ...DISCI, alinti: "yarın 3'te dişçi" }, o.pcBaglam(o.tasdik()));
    assert.equal(o.kayit(kimlik(c)).kaynak.alinti, undefined);
  });

  it("insan turunda taslağı onaylar ve korunan alanı değiştirir (emir)", async () => {
    const o = kur();
    // Kancasız çağrı: taslak doğar.
    const c = await o.ekle(DISCI, o.pcBaglam(undefined, OTURUM));
    const id = kimlik(c);
    assert.equal(o.kayit(id).taslak, true);
    o.istem("dişçiyi onayla, 4'e al");
    const g = await o.guncelle(
      { kayit_id: id, dayanak: DAYANAK, degisiklik: { onayla: true, zaman: { kesinlik: "an", tarih: "2026-11-26", saat: "16:00" } } },
      o.pcBaglam(o.tasdik()),
    );
    assert.equal(g.sonuc, "guncellendi");
    const k = o.kayit(id);
    assert.equal(k.taslak, false);
    assert.equal(k.zaman?.kesinlik === "an" ? k.zaman.saat : null, "16:00");
  });
});

describe("PC oturumu: tasdik yoksa ya da tur insan değilse sentetik (taslak)", () => {
  it("kancasız çağrı: taslak doğar, mesaj anı çağrının anı, oturum köprünün bildirdiği ya da bağlantı kimliği", async () => {
    const o = kur();
    o.zaman.ilerlet(5 * DAKIKA);
    const simdi = { tarih: "2026-11-25", saat: "14:35", saat_dilimi: DILIM };
    const c = await o.ekle({ ...DISCI, dayanak: { tarih: "2026-11-25", saat: "14:35" } }, o.pcBaglam(undefined, OTURUM_2));
    assert.deepEqual(c.mesaj_ani, simdi);
    const k = o.kayit(kimlik(c));
    assert.equal(k.taslak, true);
    assert.deepEqual(k.elle_alanlar, []);
    assert.deepEqual(
      { yol: k.kaynak.yol, tur_kokeni: k.kaynak.tur_kokeni, oturum_id: k.kaynak.oturum_id, msg: k.kaynak.kaynak_msg_id, alinti: k.kaynak.alinti },
      { yol: "pc_araci", tur_kokeni: "sentetik", oturum_id: OTURUM_2, msg: undefined, alinti: undefined },
    );
    const yok = await o.ekle({ ...DISCI, baslik: "Başka", dayanak: { tarih: "2026-11-25", saat: "14:35" } }, o.pcBaglam());
    assert.equal(o.kayit(kimlik(yok)).kaynak.oturum_id, "pcb_baglanti1");
  });

  it("çağrı kimliği tasdikle eşleşmiyorsa, alt agent'tan geliyorsa ya da tur sona erdiyse taslak; taslak olmayana dokunamaz", async () => {
    const o = kur();
    o.istem("yarın 3'te dişçi");
    const emir = await o.ekle(DISCI, o.pcBaglam(o.tasdik()));
    const id = kimlik(emir);

    // Başka kimlik (tasdik yok).
    o.tasdik();
    const baska = await o.ekle({ ...DISCI, baslik: "B1" }, o.pcBaglam("toolu_tasdiksiz"));
    assert.equal(o.kayit(kimlik(baska)).taslak, true);
    // Alt agent.
    const alt = await o.ekle({ ...DISCI, baslik: "B2" }, o.pcBaglam(o.tasdik({ alt_agent: true })));
    assert.equal(o.kayit(kimlik(alt)).taslak, true);
    assert.deepEqual(
      await o.guncelle({ kayit_id: id, degisiklik: { durum: "tamam" } }, o.pcBaglam(o.tasdik({ alt_agent: true }))),
      { sonuc: "ret", mesaj_ani: MESAJ_ANI, neden: "sentetik_turda_izinsiz" },
    );
    // Başka istemin kimliği (eski tasdik) insan sayılmaz.
    const eski = await o.ekle({ ...DISCI, baslik: "B3" }, o.pcBaglam(o.tasdik({ istem_id: "istem-eski" })));
    assert.equal(o.kayit(kimlik(eski)).taslak, true);
    // Tur sonu: sonraki tasdikli çağrı da sentetik (arka plan, bildirim turu).
    o.turSonu();
    const sonra = await o.ekle({ ...DISCI, baslik: "B4" }, o.pcBaglam(o.tasdik()));
    assert.equal(o.kayit(kimlik(sonra)).taslak, true);
    assert.equal(o.kayit(id).taslak, false);
    assert.equal(o.kayit(id).durum, "acik");
  });

  it("tasdik tek kullanımlıktır ve ömrü sınırlıdır; insan turu istemden sonra INSAN_TURU_DK sürer", async () => {
    const o = kur();
    o.istem("yarın 3'te dişçi");
    const id = o.tasdik();
    assert.equal(o.kayit(kimlik(await o.ekle(DISCI, o.pcBaglam(id)))).taslak, false);
    // Aynı kimlik ikinci kez: tasdiksiz.
    assert.equal(o.kayit(kimlik(await o.ekle({ ...DISCI, baslik: "Tekrar" }, o.pcBaglam(id)))).taslak, true);

    const eskiTasdik = o.tasdik();
    o.zaman.ilerlet((AJANDA_PC_SINIRLARI.TASDIK_OMRU_DK + 1) * DAKIKA);
    const dayanak = { tarih: "2026-11-25", saat: "14:41" };
    const c1 = await o.ekle({ ...DISCI, baslik: "Geç tasdik", dayanak }, o.pcBaglam(eskiTasdik));
    assert.equal(o.kayit(kimlik(c1)).taslak, true);

    const o2 = kur();
    o2.istem("uzun bir iş, arada yarın 3'te dişçi");
    o2.zaman.ilerlet((AJANDA_PC_SINIRLARI.INSAN_TURU_DK + 1) * DAKIKA);
    const c2 = await o2.ekle({ ...DISCI, dayanak: { tarih: "2026-11-25", saat: "15:01" } }, o2.pcBaglam(o2.tasdik()));
    assert.equal(o2.kayit(kimlik(c2)).taslak, true);
  });

  it("istem kimliği istemde ya da tasdikte yoksa güvenli taraf: taslak (istem_kimligi_yok)", async () => {
    const o = kur();
    o.istem("yarın 3'te dişçi", OTURUM, null);
    const c = await o.ekle(DISCI, o.pcBaglam(o.tasdik({ istem_id: null })));
    assert.equal(o.kayit(kimlik(c)).taslak, true);
    assert.equal(o.karar(), "istem_kimligi_yok");
    o.istem("yarın 3'te dişçi");
    await o.ekle({ ...DISCI, baslik: "T2" }, o.pcBaglam(o.tasdik({ istem_id: null })));
    assert.equal(o.karar(), "istem_kimligi_yok");
  });

  it("her karar nedeni ayrı: tasdik yok, alt agent, istem yok, tur bitti, kimlik uyuşmuyor, süre doldu; insan", async () => {
    const o = kur();
    await o.ekle({ ...DISCI, baslik: "K1" }, o.pcBaglam());
    assert.equal(o.karar(), "tasdik_yok");
    await o.ekle({ ...DISCI, baslik: "K2" }, o.pcBaglam(o.tasdik()));
    assert.equal(o.karar(), "istem_yok", "servis bu oturumun istemini görmedi");
    o.istem("yarın 3'te dişçi");
    await o.ekle({ ...DISCI, baslik: "K3" }, o.pcBaglam(o.tasdik({ alt_agent: true })));
    assert.equal(o.karar(), "alt_agent");
    await o.ekle({ ...DISCI, baslik: "K4" }, o.pcBaglam(o.tasdik({ istem_id: "istem-baska" })));
    assert.equal(o.karar(), "istem_kimligi_uyusmuyor");
    await o.ekle({ ...DISCI, baslik: "K5" }, o.pcBaglam(o.tasdik()));
    assert.equal(o.karar(), "insan");
    o.turSonu();
    await o.ekle({ ...DISCI, baslik: "K6" }, o.pcBaglam(o.tasdik()));
    assert.equal(o.karar(), "tur_bitti");
    o.istem("yarın 3'te dişçi", OTURUM, "istem-0002");
    o.zaman.ilerlet((AJANDA_PC_SINIRLARI.INSAN_TURU_DK + 1) * DAKIKA);
    await o.ekle({ ...DISCI, baslik: "K7", dayanak: { tarih: "2026-11-25", saat: "14:30" } }, o.pcBaglam(o.tasdik({ istem_id: "istem-0002" })));
    assert.equal(o.karar(), "sure_doldu");
  });
});

describe("PC oturumu: istemin kaynağı (yalnız kullanıcının yazdığı istem insan turu açar)", () => {
  /** Kaynağın her değeri ve yokluğu için beklenen karar (`kaynak` dışında her şey insan turu için tamam). */
  const BEKLENEN: Readonly<Record<PcIstemKaynagi, PcTurKarari>> = {
    user: "insan",
    sdk: "kaynak_kullanici_degil",
    system: "kaynak_kullanici_degil",
    loop_wakeup: "kaynak_kullanici_degil",
    schedule_wakeup: "kaynak_kullanici_degil",
    poll_event: "kaynak_kullanici_degil",
    diger: "kaynak_kullanici_degil",
    yok: "kaynak_yok",
  };

  it("her kaynak değeri ve yokluğu: yalnız user insan, öteki hepsi taslak", async () => {
    assert.deepEqual(Object.keys(BEKLENEN).sort(), [...PC_ISTEM_KAYNAGI_DEGERLERI].sort());
    for (const kaynak of PC_ISTEM_KAYNAGI_DEGERLERI) {
      const o = kur();
      o.istem("yarın 3'te dişçi", OTURUM, ISTEM, kaynak);
      const c = await o.ekle(DISCI, o.pcBaglam(o.tasdik()));
      assert.equal(o.karar(), BEKLENEN[kaynak], kaynak);
      assert.equal(o.kayit(kimlik(c)).taslak, kaynak !== "user", kaynak);
      assert.equal(o.kayit(kimlik(c)).kaynak.tur_kokeni, kaynak === "user" ? "insan" : "sentetik", kaynak);
    }
  });

  it("bulgu senaryosu: arka plan bildirimi (source:system) turunda ana ajanın eklemesi insan değil, hatırlatma emir değil", async () => {
    const o = kur();
    // Bildirim turu kendi prompt_id'siyle gelir; tasdik aynı kimliği taşır, alt agent kimliği yoktur.
    o.istem("<task-notification>arka plan: yarın 09:00 toplantı</task-notification>", OTURUM, "p2", "system");
    const c = await o.ekle({ ...DISCI, alinti: "yarın 09:00 toplantı" }, o.pcBaglam(o.tasdik({ istem_id: "p2" })));
    assert.equal(o.karar(), "kaynak_kullanici_degil");
    const k = o.kayit(kimlik(c));
    assert.equal(k.taslak, true);
    assert.equal(k.kaynak.tur_kokeni, "sentetik");
    assert.equal(k.kaynak.alinti, undefined, "güvenilmez metinle alıntı saklanmadı");
  });

  it("kullanıcı dışı istem açık insan turunu kapatır (kesilen turdan sonra gelen bildirim, uyanış, zamanlanmış görev)", async () => {
    for (const kaynak of ["system", "loop_wakeup", "schedule_wakeup", "poll_event", "sdk", "diger", "yok"] as const) {
      const o = kur();
      o.istem("yarın 3'te dişçi");
      // Kullanıcının turu kesildi (Stop gelmedi); sonra makine yeni bir tur açtı.
      o.istem("", OTURUM, "istem-makine", kaynak);
      // Eski kullanıcı isteminin kimliğiyle gelen tasdik de artık insan değildir.
      await o.ekle(DISCI, o.pcBaglam(o.tasdik()));
      assert.equal(o.karar(), BEKLENEN[kaynak], kaynak);
      // Kullanıcının sonraki gerçek mesajı yeni insan turu açar.
      o.istem("dişçi yarın 4'te", OTURUM, "istem-0003");
      await o.ekle({ ...DISCI, baslik: "Yeni" }, o.pcBaglam(o.tasdik({ istem_id: "istem-0003" })));
      assert.equal(o.karar(), "insan", kaynak);
    }
  });

  it("günlükte kararın nedenleri var, istem metni ve istem kimliği yok", async () => {
    const o = kur();
    o.istem("GIZLI-ISTEM yarın", OTURUM, "istem-GIZLIKIMLIK");
    o.istem("", OTURUM, "istem-GIZLIKIMLIK2", "system");
    await o.ekle(DISCI, o.pcBaglam(o.tasdik({ istem_id: "istem-GIZLIKIMLIK2" })));
    const g = o.gunluk.girdiler as ReadonlyArray<{ olay: string; alanlar?: Record<string, unknown> }>;
    const istemler = g.filter((x) => x.olay === "pc_istem").map((x) => x.alanlar);
    assert.deepEqual(istemler, [
      { oturum_id: OTURUM, kaynak: "user", istem_kimligi: "var", acik_tur_kapandi: false },
      { oturum_id: OTURUM, kaynak: "system", istem_kimligi: "var", acik_tur_kapandi: true },
    ]);
    const arac = g.find((x) => x.olay === "arac")?.alanlar;
    assert.equal(arac?.["pc_karar"], "kaynak_kullanici_degil");
    assert.equal(arac?.["cagri_kimligi"], "var");
    const metin = JSON.stringify(g);
    assert.ok(!metin.includes("GIZLI"), "günlükte istem metni ya da istem kimliği var");
  });
});

describe("PC oturumu: mesaj anı, dayanak ve gece kuralı", () => {
  it("23:58'de yazılan, 00:01'de çağrılan 'yarın': dayanak istem anıdır; şimdiye göre çözülen reddedilir", async () => {
    // 2026-11-25 23:58 Europe/Istanbul.
    const o = kur(Date.UTC(2026, 10, 25, 20, 58));
    assert.deepEqual(o.istem("yarın 3'te dişçi").mesaj_ani, { tarih: "2026-11-25", saat: "23:58", saat_dilimi: DILIM });
    o.zaman.ilerlet(3 * DAKIKA);
    const ret = await o.ekle({ ...DISCI, dayanak: { tarih: "2026-11-26", saat: "00:01" } }, o.pcBaglam(o.tasdik()));
    assert.deepEqual(ret, { sonuc: "ret", mesaj_ani: { tarih: "2026-11-25", saat: "23:58", saat_dilimi: DILIM }, neden: "dayanak_uyusmuyor" });
    const tamam = await o.ekle({ ...DISCI, dayanak: { tarih: "2026-11-25", saat: "23:58" } }, o.pcBaglam(o.tasdik()));
    assert.equal(tamam.sonuc, "eklendi");
  });

  it("gece aralığında insan turu teyit ister; aynı turda soruldu kabul edilmez, sonraki istemde edilir; sentetikte yok", async () => {
    // 2026-11-27 01:45 Europe/Istanbul.
    const o = kur(Date.UTC(2026, 10, 26, 22, 45));
    const aksam = { tur: "gorev" as const, baslik: "Araba yıkama", zaman: { kesinlik: "gun" as const, tarih: "2026-11-28", gun_bolumu: "aksam" as const } };
    o.istem("Yarın akşama araba yıkama oluştur ajandada");
    const gece = { tarih: "2026-11-27", saat: "01:45" };
    const r1 = await o.ekle({ ...aksam, dayanak: gece }, o.pcBaglam(o.tasdik()));
    assert.equal(r1.sonuc === "ret" ? r1.neden : null, "gece_teyidi_gerekli");
    const r2 = await o.ekle({ ...aksam, dayanak: { ...gece, gece_teyidi: "soruldu" } }, o.pcBaglam(o.tasdik()));
    assert.deepEqual(r2, { sonuc: "ret", mesaj_ani: { ...gece, saat_dilimi: DILIM }, neden: "gece_teyidi_gerekli", ayni_tur: true });
    // Kullanıcının cevabı yeni istemdir (yeni tur).
    o.turSonu();
    o.zaman.ilerlet(2 * DAKIKA);
    o.istem("cuma akşamı", OTURUM, "istem-0002");
    const cevap = { tarih: "2026-11-27", saat: "01:47", gece_teyidi: "soruldu" as const };
    const r3 = await o.ekle(
      { ...aksam, zaman: { ...aksam.zaman, tarih: "2026-11-27", ifade: "cuma akşamı" }, dayanak: cevap },
      o.pcBaglam(o.tasdik({ istem_id: "istem-0002" })),
    );
    assert.equal(r3.sonuc, "eklendi");
    // Sentetik turda gece kuralı yoktur; kayıt taslak doğar.
    const r4 = await o.ekle({ ...aksam, baslik: "Başka iş", dayanak: cevap }, o.pcBaglam());
    assert.equal(r4.sonuc, "eklendi");
    assert.equal(o.kayit(kimlik(r4)).taslak, true);
  });
});

describe("PC oturumu: tekilleştirme kapsamı ve telefon yolu", () => {
  it("iki PC oturumunda aynı kayıt tek kalır (kapsam pc); telefon sohbetinin kaydıyla birleşmez", async () => {
    const o = kur();
    o.istem("yarın 3'te dişçi");
    const ilk = kimlik(await o.ekle(DISCI, o.pcBaglam(o.tasdik())));
    o.istem("yarın 3'te dişçi", OTURUM_2, "istem-b");
    const ikinci = await o.ekle(DISCI, o.pcBaglam(o.tasdik({ oturum_id: OTURUM_2, istem_id: "istem-b" })));
    assert.equal(ikinci.sonuc, "zaten_var");
    assert.equal(kimlik(ikinci), ilk);
    // Telefon sohbetinin turu (aynı servis, aynı modül): ayrı kapsam, ayrı kayıt, kaynak bugünkü gibi.
    o.telefonTuru.tur = { tur_kokeni: "insan", turn_id: "t1", mesaj_ani: MESAJ_ANI, insan_metni: "yarın 3'te dişçi", kaynak_msg_id: "m_1" };
    const tel = await o.ekle(DISCI, { rol: "ana_oturum", sohbet_id: "ana", nesil: 1 });
    assert.equal(tel.sonuc, "eklendi");
    const k = o.kayit(kimlik(tel));
    assert.equal(k.kaynak.yol, "sohbet_araci");
    assert.equal(k.kaynak.sohbet_id, "ana");
    assert.equal(k.kaynak.oturum_id, undefined);
  });

  it("PC defteri yoksa (araçlar tek başına kurulursa) PC çağrısı tur_gecersiz; telefon çağrısı etkilenmez", async () => {
    const { ajandaAraclariKur } = await import("../src/ajanda-araclar.ts");
    const zaman = sahteZaman(T0);
    const depo = depoAc({ yol: ":memory:", saat: zaman.saat, gunluk: sahteGunluk() });
    acik.push(depo);
    const araclar = ajandaAraclariKur({
      depo,
      takvim: sahteTakvim(DILIM),
      saat: zaman.saat,
      rastgele: sahteRastgele(),
      gunluk: sahteGunluk(),
      turBaglami: () => null,
    });
    const s = await (araclar.ajanda_listele as (g: unknown, b: AjandaKopruBaglami, s: AbortSignal) => Promise<unknown>)(
      {},
      { rol: "pc_oturumu", baglanti_id: "pcb_x" },
      new AbortController().signal,
    );
    assert.deepEqual(s, { ok: false, code: "tur_gecersiz" });
  });

  it("kayıt metni ve istem metni günlüğe girmez", async () => {
    const o = kur();
    o.istem("GIZLI-ISTEM yarın 3'te dişçi");
    await o.ekle({ ...DISCI, aciklama: "GIZLI-ACIKLAMA" }, o.pcBaglam(o.tasdik()));
    const satirlar = JSON.stringify(o.gunluk.girdiler);
    assert.ok(!satirlar.includes("GIZLI"), "günlükte metin var");
    assert.ok(!satirlar.includes("Dişçi"), "günlükte başlık var");
    assert.match(satirlar, /pc_karar/);
  });
});
