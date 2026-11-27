/**
 * PC oturumları (`docs/AJANDA.md` "PC oturumları"): ajanda modülünün PC defteri (`ajanda-pc.ts`) ve
 * araçların `pc_oturumu` yolu, gerçek depoyla. Yalın yol: tek kanca (`pcKanca.pc_arac`, araç öncesi
 * tasdik: çağrı kimliği, alt agent, etkileşimsiz). Ana ajanın tasdikli çağrısı insan turudur; alt
 * agent'ın ve tasdiksiz ya da eşleşmeyen çağrının hiçbiri doğrudan kayıt üretemez (taslak). Kaynak izi,
 * kullanıcı emri/otomasyon, dayanak (mesaj anı çağrının anı), gece kuralı ve tekilleştirme.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  AJANDA_PC_SINIRLARI,
  ajandaAraclari,
  type AjandaFiili,
  type AjandaKaydi,
  AjandaKaydi as AjandaKaydiSemasi,
  ajandaTekilAnahtari,
  PC_KANCA_ARACLARI,
  PC_TEKIL_KAPSAMI,
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

/** `aracV3`: ayar `ajanda_arac_v3` (bu dosyanın testleri bugünkü v3 yüzüyle; kapalı yüz ayrıca sınanır). */
const kur = (simdi = T0, aracV3 = true) => {
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
    aracV3,
  });
  ajanda.baslat();

  /** PreToolUse kancası (şemadan geçen girdi, şemadan geçen yanıt): tasdik; çağrı kimliğini döner. */
  const tasdik = (sec: { oturum_id?: string; istem_id?: string | null; alt_agent?: boolean; etkilesimsiz?: boolean } = {}): string => {
    const arac_cagri_id = `toolu_${++aracNo}`;
    const istem_id = sec.istem_id === null ? {} : { istem_id: sec.istem_id ?? ISTEM };
    const girdi = PC_KANCA_ARACLARI.pc_arac.girdi.parse({
      oturum_id: sec.oturum_id ?? OTURUM,
      arac_cagri_id,
      alt_agent: sec.alt_agent ?? false,
      etkilesimsiz: sec.etkilesimsiz ?? false,
      ...istem_id,
    });
    PC_KANCA_ARACLARI.pc_arac.cikti.parse(ajanda.pcKanca.pc_arac(girdi));
    return arac_cagri_id;
  };

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
    ajandaAraclari(aracV3)[fiil].cikti.parse(s.deger);
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
  const listele = (baglam: AjandaKopruBaglami) => cagir("ajanda_listele", { en_fazla: 1 }, baglam);
  return { zaman, gunluk, depo, ajanda, telefonTuru, tasdik, pcBaglam, ekle, guncelle, listele, cagir, kayit, karar };
};

const kimlik = (c: AjandaFiilCiktisi<"ajanda_ekle">): string => {
  assert.notEqual(c.sonuc, "ret", JSON.stringify(c));
  return (c as Extract<AjandaFiilCiktisi<"ajanda_ekle">, { kayit: unknown }>).kayit.kayit_id;
};

describe("PC oturumu: ana ajanın tasdikli çağrısı insan turudur", () => {
  it("tasdik → ekleme: kullanıcı emri, taslak değil, varsayılan hatırlatma; kaynak pc_araci, oturum, istem kimliği; alıntı saklanmaz", async () => {
    const o = kur();
    const c = await o.ekle(DISCI, o.pcBaglam(o.tasdik()));
    assert.equal(c.sonuc, "eklendi");
    assert.equal(o.karar(), "insan");
    assert.deepEqual(c.mesaj_ani, MESAJ_ANI);
    const k = o.kayit(kimlik(c));
    assert.equal(k.taslak, false);
    assert.deepEqual(k.hatirlatmalar, [{ tur: "once", dk: 60 }]);
    // Kullanıcının mesaj metni servise gelmez: modelin verdiği alıntı doğrulanamaz, saklanmaz.
    assert.deepEqual(k.kaynak, {
      yol: "pc_araci",
      tur_kokeni: "insan",
      oturum_id: OTURUM,
      kaynak_msg_id: ISTEM,
      tekil_anahtar: ajandaTekilAnahtari({ kapsam: PC_TEKIL_KAPSAMI, tur: "randevu", baslik: "Dişçi ☕️", zaman: k.zaman }),
    });
    assert.deepEqual(k.elle_alanlar, ["tur", "baslik", "zaman"]);
    const g = o.depo.ajandaGecmisi({ kayit_id: k.kayit_id, adet: 5 });
    assert.deepEqual(g[0]!.yazar, { yol: "pc_araci", tur_kokeni: "insan", oturum_id: OTURUM });
  });

  it("istem kimliği yoksa da insan: kaynak_msg_id yok", async () => {
    const o = kur();
    const k = o.kayit(kimlik(await o.ekle(DISCI, o.pcBaglam(o.tasdik({ istem_id: null })))));
    assert.equal(o.karar(), "insan");
    assert.equal(k.taslak, false);
    assert.equal(k.kaynak.kaynak_msg_id, undefined);
  });

  it("insan turunda taslağı onaylar ve korunan alanı değiştirir (emir)", async () => {
    const o = kur();
    // Tasdiksiz çağrı: taslak doğar.
    const c = await o.ekle(DISCI, o.pcBaglam("toolu_tasdiksiz", OTURUM));
    const id = kimlik(c);
    assert.equal(o.kayit(id).taslak, true);
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

describe("PC oturumu, güvenlik tabanı: alt agent ve tasdiksiz çağrı doğrudan kayıt üretemez", () => {
  it("kancasız çağrı: taslak doğar, mesaj anı çağrının anı, oturum köprünün bildirdiği ya da bağlantı kimliği", async () => {
    const o = kur();
    o.zaman.ilerlet(5 * DAKIKA);
    const simdi = { tarih: "2026-11-25", saat: "14:35", saat_dilimi: DILIM };
    const c = await o.ekle({ ...DISCI, dayanak: { tarih: "2026-11-25", saat: "14:35" } }, o.pcBaglam(undefined, OTURUM_2));
    assert.equal(o.karar(), "cagri_kimligi_yok");
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

  it("alt agent: ekleme taslak doğar; taslak olmayana dokunamaz, taslağı onaylayamaz, kullanıcının kaydını yeniden ekleyemez", async () => {
    const o = kur();
    const id = kimlik(await o.ekle(DISCI, o.pcBaglam(o.tasdik())));
    assert.equal(o.kayit(id).taslak, false);

    const alt = await o.ekle({ ...DISCI, baslik: "Alt" }, o.pcBaglam(o.tasdik({ alt_agent: true })));
    assert.equal(o.karar(), "alt_agent");
    const altK = o.kayit(kimlik(alt));
    assert.equal(altK.taslak, true);
    assert.equal(altK.kaynak.tur_kokeni, "sentetik");
    assert.equal(altK.kaynak.kaynak_msg_id, undefined);
    // Taslak olmayan kayda değişiklik ve taslağa onay: ikisi de ret, hiçbir şey yazılmaz.
    assert.deepEqual(
      await o.guncelle({ kayit_id: id, degisiklik: { durum: "tamam" } }, o.pcBaglam(o.tasdik({ alt_agent: true }))),
      { sonuc: "ret", mesaj_ani: MESAJ_ANI, neden: "sentetik_turda_izinsiz" },
    );
    assert.deepEqual(
      await o.guncelle({ kayit_id: altK.kayit_id, degisiklik: { onayla: true } }, o.pcBaglam(o.tasdik({ alt_agent: true }))),
      { sonuc: "ret", mesaj_ani: MESAJ_ANI, neden: "sentetik_turda_izinsiz" },
    );
    assert.equal(o.kayit(id).durum, "acik");
    assert.equal(o.kayit(altK.kayit_id).taslak, true);
    // Alt agent kullanıcının kaydını yeniden ekleyemez de (otomasyonda her eş engeller).
    const yine = await o.ekle(DISCI, o.pcBaglam(o.tasdik({ alt_agent: true })));
    assert.equal(yine.sonuc, "zaten_var");
    assert.equal(o.kayit(id).taslak, false);
  });

  it("her karar nedeni ayrı: çağrı kimliği yok, tasdik yok (başka kimlik, kullanılmış, eskimiş), alt agent, etkileşimsiz; insan", async () => {
    const o = kur();
    await o.ekle({ ...DISCI, baslik: "K1" }, o.pcBaglam());
    assert.equal(o.karar(), "cagri_kimligi_yok");
    o.tasdik();
    await o.ekle({ ...DISCI, baslik: "K2" }, o.pcBaglam("toolu_eslesmeyen"));
    assert.equal(o.karar(), "tasdik_yok", "başka kimliğin tasdiki bu çağrıya geçmez");
    const id = o.tasdik();
    await o.ekle({ ...DISCI, baslik: "K3" }, o.pcBaglam(id));
    assert.equal(o.karar(), "insan");
    await o.ekle({ ...DISCI, baslik: "K4" }, o.pcBaglam(id));
    assert.equal(o.karar(), "tasdik_yok", "tasdik tek kullanımlık");
    await o.ekle({ ...DISCI, baslik: "K5" }, o.pcBaglam(o.tasdik({ alt_agent: true })));
    assert.equal(o.karar(), "alt_agent");
    await o.ekle({ ...DISCI, baslik: "K6" }, o.pcBaglam(o.tasdik({ etkilesimsiz: true })));
    assert.equal(o.karar(), "etkilesimsiz");
    // Alt agent işareti etkileşimsizden önce gelir (ikisi birden: alt agent).
    await o.ekle({ ...DISCI, baslik: "K7" }, o.pcBaglam(o.tasdik({ alt_agent: true, etkilesimsiz: true })));
    assert.equal(o.karar(), "alt_agent");
    const eski = o.tasdik();
    o.zaman.ilerlet((AJANDA_PC_SINIRLARI.TASDIK_OMRU_DK + 1) * DAKIKA);
    await o.ekle({ ...DISCI, baslik: "K8", dayanak: { tarih: "2026-11-25", saat: "14:41" } }, o.pcBaglam(eski));
    assert.equal(o.karar(), "tasdik_yok", "eskimiş tasdik (izin sorusu uzun bekledi)");
  });

  it("servis yeniden başladı (defter boş): önceki ömrün tasdiki geçmez", async () => {
    const o1 = kur();
    const id = o1.tasdik();
    const o2 = kur();
    await o2.ekle(DISCI, o2.pcBaglam(id));
    assert.equal(o2.karar(), "tasdik_yok");
  });

  it("bütün durumlar: doğrudan kayıt YALNIZ çağrı kimliği + taze, kullanılmamış tasdik + ana ajan + etkileşimli iken", async () => {
    let sayi = 0;
    for (const kimlikVar of [true, false]) {
      for (const tasdikVar of [true, false]) {
        for (const alt_agent of [true, false]) {
          for (const etkilesimsiz of [true, false]) {
            for (const eskimis of [true, false]) {
              const o = kur();
              const id = tasdikVar ? o.tasdik({ alt_agent, etkilesimsiz }) : "toolu_tasdiksiz";
              if (eskimis) o.zaman.ilerlet((AJANDA_PC_SINIRLARI.TASDIK_OMRU_DK + 1) * DAKIKA);
              const simdi = eskimis ? { tarih: "2026-11-25", saat: "14:41" } : DAYANAK;
              const c = await o.ekle({ ...DISCI, dayanak: simdi }, o.pcBaglam(kimlikVar ? id : undefined, OTURUM));
              const dogrudan = kimlikVar && tasdikVar && !alt_agent && !etkilesimsiz && !eskimis;
              const durum = JSON.stringify({ kimlikVar, tasdikVar, alt_agent, etkilesimsiz, eskimis });
              const k = o.kayit(kimlik(c));
              assert.equal(k.taslak, !dogrudan, durum);
              assert.equal(k.kaynak.tur_kokeni, dogrudan ? "insan" : "sentetik", durum);
              assert.equal(o.karar() === "insan", dogrudan, durum);
              sayi++;
            }
          }
        }
      }
    }
    assert.equal(sayi, 32);
  });
});

describe("PC oturumu: mesaj anı (çağrının anı), dayanak ve gece kuralı", () => {
  it("'şimdi' araç yolundan: listele mesaj anını verir; bayat dayanak (10 dk'dan eski ya da önceki gün) reddedilir ve şimdiki an döner", async () => {
    const o = kur();
    // Oturum başındaki tarihe ya da önceki turun saatine dayanan model: listele şimdiki anı verir.
    const l = await o.listele(o.pcBaglam(o.tasdik()));
    assert.deepEqual(l.mesaj_ani, MESAJ_ANI);
    o.zaman.ilerlet(12 * DAKIKA);
    const bayat = await o.ekle(DISCI, o.pcBaglam(o.tasdik()));
    assert.deepEqual(bayat, { sonuc: "ret", mesaj_ani: { tarih: "2026-11-25", saat: "14:42", saat_dilimi: DILIM }, neden: "dayanak_uyusmuyor" });
    const dun = await o.ekle({ ...DISCI, dayanak: { tarih: "2026-11-24", saat: "14:42" } }, o.pcBaglam(o.tasdik()));
    assert.equal(dun.sonuc === "ret" ? dun.neden : null, "dayanak_uyusmuyor");
    assert.equal(o.depo.ajandaKayitlari({}).length, 0, "bayat dayanakla kayıt yazıldı");
    const tamam = await o.ekle({ ...DISCI, dayanak: { tarih: "2026-11-25", saat: "14:42" } }, o.pcBaglam(o.tasdik()));
    assert.equal(tamam.sonuc, "eklendi");
    // Sentetik çağrının mesaj anı da çağrının anıdır, aynı denetimden geçer.
    const alt = await o.ekle({ ...DISCI, baslik: "Alt" }, o.pcBaglam(o.tasdik({ alt_agent: true })));
    assert.equal(alt.sonuc === "ret" ? alt.neden : null, "dayanak_uyusmuyor");
  });

  it("gece yarısını geçen tur: 23:58'in dayanağı 00:01'de reddedilir; şimdiye göre çözülen 'yarın' gece teyidine düşer", async () => {
    // 2026-11-25 23:58 Europe/Istanbul: model listele ile anı öğrendi, işi 00:01'e sarktı.
    const o = kur(Date.UTC(2026, 10, 25, 20, 58));
    assert.deepEqual((await o.listele(o.pcBaglam(o.tasdik()))).mesaj_ani, { tarih: "2026-11-25", saat: "23:58", saat_dilimi: DILIM });
    o.zaman.ilerlet(3 * DAKIKA);
    const ret = await o.ekle({ ...DISCI, dayanak: { tarih: "2026-11-25", saat: "23:58" } }, o.pcBaglam(o.tasdik()));
    assert.deepEqual(ret, { sonuc: "ret", mesaj_ani: { tarih: "2026-11-26", saat: "00:01", saat_dilimi: DILIM }, neden: "dayanak_uyusmuyor" });
    // Yeni anla göreli gün: gece aralığında insan turu teyit ister (kullanıcıya hangi gün sorulur).
    const gece = await o.ekle({ ...DISCI, dayanak: { tarih: "2026-11-26", saat: "00:01" } }, o.pcBaglam(o.tasdik()));
    assert.equal(gece.sonuc === "ret" ? gece.neden : null, "gece_teyidi_gerekli");
    assert.equal(o.depo.ajandaKayitlari({}).length, 0);
  });

  it("gece aralığında insan turu teyit ister; aynı istemde soruldu kabul edilmez, sonraki istemde edilir; sentetikte yok", async () => {
    // 2026-11-27 01:45 Europe/Istanbul.
    const o = kur(Date.UTC(2026, 10, 26, 22, 45));
    const aksam = { tur: "gorev" as const, baslik: "Araba yıkama", zaman: { kesinlik: "gun" as const, tarih: "2026-11-28", gun_bolumu: "aksam" as const } };
    const gece = { tarih: "2026-11-27", saat: "01:45" };
    const r1 = await o.ekle({ ...aksam, dayanak: gece }, o.pcBaglam(o.tasdik()));
    assert.equal(r1.sonuc === "ret" ? r1.neden : null, "gece_teyidi_gerekli");
    // Aynı istem kimliği aynı turdur: kullanıcı bu turda cevap vermiş olamaz.
    const r2 = await o.ekle({ ...aksam, dayanak: { ...gece, gece_teyidi: "soruldu" } }, o.pcBaglam(o.tasdik()));
    assert.deepEqual(r2, { sonuc: "ret", mesaj_ani: { ...gece, saat_dilimi: DILIM }, neden: "gece_teyidi_gerekli", ayni_tur: true });
    // Başka oturumun aynı istem kimliği bu oturumun turu değildir.
    const r2b = await o.ekle({ ...aksam, baslik: "Öteki", dayanak: { ...gece, gece_teyidi: "soruldu" } }, o.pcBaglam(o.tasdik({ oturum_id: OTURUM_2 })));
    assert.equal(r2b.sonuc, "eklendi");
    // Kullanıcının cevabı yeni istemdir (yeni tur).
    o.zaman.ilerlet(2 * DAKIKA);
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

  it("istem kimliği bildirilmezse her çağrı ayrı turdur: aynı tur kuralı uygulanamaz (teşhis istem_kimligi=yok)", async () => {
    const o = kur(Date.UTC(2026, 10, 26, 22, 45));
    const aksam = { tur: "gorev" as const, baslik: "Araba yıkama", zaman: { kesinlik: "gun" as const, tarih: "2026-11-27", gun_bolumu: "aksam" as const } };
    const gece = { tarih: "2026-11-27", saat: "01:45" };
    const r1 = await o.ekle({ ...aksam, dayanak: gece }, o.pcBaglam(o.tasdik({ istem_id: null })));
    assert.equal(r1.sonuc === "ret" ? r1.neden : null, "gece_teyidi_gerekli");
    const r2 = await o.ekle({ ...aksam, dayanak: { ...gece, gece_teyidi: "soruldu" } }, o.pcBaglam(o.tasdik({ istem_id: null })));
    assert.equal(r2.sonuc, "eklendi");
    const pcArac = (o.gunluk.girdiler as ReadonlyArray<{ olay: string; alanlar?: Record<string, unknown> }>).filter((x) => x.olay === "pc_arac");
    assert.equal(pcArac.at(-1)?.alanlar?.["istem_kimligi"], "yok");
  });
});

describe("PC oturumu: tekilleştirme kapsamı ve telefon yolu", () => {
  it("iki PC oturumunda aynı kayıt tek kalır (kapsam pc); telefon sohbetinin kaydıyla birleşmez", async () => {
    const o = kur();
    const ilk = kimlik(await o.ekle(DISCI, o.pcBaglam(o.tasdik())));
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

  it("günlükte kararın nedenleri var; kayıt metni ve istem kimliği yok", async () => {
    const o = kur();
    await o.ekle({ ...DISCI, aciklama: "GIZLI-ACIKLAMA" }, o.pcBaglam(o.tasdik({ istem_id: "istem-GIZLIKIMLIK" })));
    await o.ekle({ ...DISCI, baslik: "Alt" }, o.pcBaglam(o.tasdik({ alt_agent: true, istem_id: "istem-GIZLIKIMLIK" })));
    const g = o.gunluk.girdiler as ReadonlyArray<{ olay: string; alanlar?: Record<string, unknown> }>;
    assert.deepEqual(
      g.filter((x) => x.olay === "pc_arac").map((x) => x.alanlar),
      [
        { oturum_id: OTURUM, alt_agent: false, etkilesimsiz: false, istem_kimligi: "var" },
        { oturum_id: OTURUM, alt_agent: true, etkilesimsiz: false, istem_kimligi: "var" },
      ],
    );
    assert.deepEqual(
      g.filter((x) => x.olay === "arac").map((x) => [x.alanlar?.["pc_karar"], x.alanlar?.["cagri_kimligi"]]),
      [
        ["insan", "var"],
        ["alt_agent", "var"],
      ],
    );
    const satirlar = JSON.stringify(g);
    assert.ok(!satirlar.includes("GIZLI"), "günlükte metin ya da istem kimliği var");
    assert.ok(!satirlar.includes("Dişçi"), "günlükte başlık var");
  });
});

describe("PC oturumu: başka oturumun eş taslağı (oturumlar arası tekilleştirme)", () => {
  /** Alt agent'ın taslağı: insanın görmediği açıklama, hatırlatma, bağlantı, simge, varış. */
  const ALT_EKI = {
    aciklama: "ALT-AGENT-ACIKLAMASI",
    hatirlatmalar: [{ tur: "once" as const, dk: 15 }],
    baglantilar: [{ url: "https://alt-agent.example/x" }],
    simge: "is",
    bolge: "İŞ YERİ",
    varis: { cikista: true as const },
  };
  const INSAN: AjandaFiilGirdisi<"ajanda_ekle"> = { ...DISCI, bolge: "iş yeri", zaman: { ...DISCI.zaman!, ifade: "26'sı 15:00" } as typeof DISCI.zaman };

  it("başka oturumun ana ajanı onaylar ama taslağın alanları taşınmaz: kayıt insanın çağrısının doğuracağı hal; kimlik ve geçmiş korunur", async () => {
    const o = kur();
    const taslakC = await o.ekle({ ...DISCI, ...ALT_EKI }, o.pcBaglam(o.tasdik({ alt_agent: true })));
    const id = kimlik(taslakC);
    const taslak = o.kayit(id);
    assert.equal(taslak.taslak, true);

    const c = await o.ekle(INSAN, o.pcBaglam(o.tasdik({ oturum_id: OTURUM_2, istem_id: "istem-b" })));
    assert.equal(c.sonuc, "onaylandi");
    assert.equal(kimlik(c), id, "aynı kayıt");
    assert.ok(c.sonuc === "onaylandi");
    assert.deepEqual(c.uygulanan_alanlar, ["zaman", "bolge"], "yalnız insanın söylediği");
    const k = o.kayit(id);
    // İnsanın çağrısı tek başına ne doğuracaksa (yeni bir depoda aynı çağrı).
    const tek = kur();
    const tekK = tek.kayit(kimlik(await tek.ekle(INSAN, tek.pcBaglam(tek.tasdik({ oturum_id: OTURUM_2, istem_id: "istem-b" })))));
    for (const a of ["tur", "baslik", "aciklama", "zaman", "hatirlatmalar", "tekrar", "simge", "bolge", "bolge_konumu", "varis", "baglantilar", "ekler", "durum", "elle_alanlar", "ornekler"] as const) {
      assert.deepEqual(k[a], tekK[a], a);
    }
    assert.equal(k.taslak, false);
    assert.deepEqual(k.hatirlatmalar, [{ tur: "once", dk: 60 }]);
    assert.equal(k.aciklama, undefined);
    // Kimlik, kaynak izi (taslağı doğuran alt agent) ve oluşturma anı korunur.
    assert.deepEqual(k.kaynak, taslak.kaynak);
    assert.equal(k.olusturma_ms, taslak.olusturma_ms);
    // Geçmiş: doğum satırı yerinde; onay satırı taşınmayanları öncesi ve sonrasıyla (kalkan null) gösterir.
    const g = o.depo.ajandaGecmisi({ kayit_id: id, adet: 5 });
    assert.equal(g.length, 2);
    const onay = g.find((x) => x.islem === "onayla");
    assert.ok(onay !== undefined);
    assert.deepEqual(onay.yazar, { yol: "pc_araci", tur_kokeni: "insan", oturum_id: OTURUM_2 });
    assert.deepEqual(onay.onceki, {
      aciklama: "ALT-AGENT-ACIKLAMASI",
      zaman: taslak.zaman,
      hatirlatmalar: [{ tur: "once", dk: 15 }],
      simge: "is",
      bolge: "İŞ YERİ",
      varis: { cikista: true },
      baglantilar: [{ url: "https://alt-agent.example/x" }],
      taslak: true,
    });
    assert.deepEqual(onay.sonraki, {
      aciklama: null,
      zaman: k.zaman,
      hatirlatmalar: [{ tur: "once", dk: 60 }],
      simge: null,
      bolge: "iş yeri",
      varis: null,
      baglantilar: null,
      taslak: false,
    });
    assert.ok(g.some((x) => x.islem === "ekle" && x.yazar.tur_kokeni === "sentetik" && x.yazar.oturum_id === OTURUM));
  });

  it("aynı oturumun ana ajanı kendi alt agent'ının taslağını onaylayınca alanlar taşınır (bugünkü kural)", async () => {
    const o = kur();
    const id = kimlik(await o.ekle({ ...DISCI, ...ALT_EKI }, o.pcBaglam(o.tasdik({ alt_agent: true }))));
    const c = await o.ekle(INSAN, o.pcBaglam(o.tasdik()));
    assert.equal(c.sonuc, "onaylandi");
    assert.ok(c.sonuc === "onaylandi");
    assert.deepEqual(c.uygulanan_alanlar, []);
    const k = o.kayit(id);
    assert.equal(k.taslak, false);
    assert.equal(k.aciklama, "ALT-AGENT-ACIKLAMASI");
    assert.deepEqual(k.hatirlatmalar, [{ tur: "once", dk: 15 }]);
    assert.deepEqual(k.varis, { cikista: true });
    assert.equal(k.bolge, "İŞ YERİ", "aynı yer, taslağın yazılışı");
    assert.equal(k.zaman?.kesinlik === "an" && k.zaman.ifade, "yarın 3'te", "eşin sözü korunur");
  });

  it("başka oturumun tasdiksiz (sentetik) taslağı da: insan hatırlatma verirse o yazılır; varışlıda varsayılan zamana göre", async () => {
    const o = kur();
    const sut = { tur: "gorev" as const, baslik: "Süt al", bolge: "market" };
    const id = kimlik(await o.ekle({ ...sut, aciklama: "taslak", varis: {}, hatirlatmalar: [{ tur: "once", dk: 5 }] }, o.pcBaglam(undefined, OTURUM)));
    assert.equal(o.karar(), "cagri_kimligi_yok");
    const c = await o.ekle({ ...sut, varis: {} }, o.pcBaglam(o.tasdik({ oturum_id: OTURUM_2 })));
    assert.equal(c.sonuc, "onaylandi");
    const k = o.kayit(id);
    assert.deepEqual(k.hatirlatmalar, [], "zamansız varışlı: varsayılan []");
    assert.equal(k.aciklama, undefined);
    assert.deepEqual(k.elle_alanlar, ["tur", "baslik", "bolge", "varis"]);
  });
});

describe("PC oturumu: v3 araç yüzü kapalı (ayar ajanda_arac_v3 verilmedi)", () => {
  /** Alt agent'ın v2 taslağı: insanın görmediği açıklama ve hatırlatma. */
  const ALT_V2 = { aciklama: "ALT-AGENT-ACIKLAMASI", hatirlatmalar: [{ tur: "once" as const, dk: 15 }] };
  const INSAN: AjandaFiilGirdisi<"ajanda_ekle"> = { ...DISCI, zaman: { ...DISCI.zaman!, ifade: "26'sı 15:00" } as typeof DISCI.zaman };

  it("ana ajanın v3 alanlı çağrısı (bölge, varış, simge, bağlantı) işleyiciye geçmez, kayıt doğmaz", async () => {
    const o = kur(T0, false);
    for (const g of [
      { ...DISCI, bolge: "iş yeri", varis: {} },
      { ...DISCI, simge: "saglik" },
      { ...DISCI, baglantilar: [{ url: "https://ornek.com" }] },
    ]) {
      const isleyici = o.ajanda.araclar.ajanda_ekle as (g: unknown, b: AjandaKopruBaglami, s: AbortSignal) => Promise<unknown>;
      assert.deepEqual(await isleyici(g, o.pcBaglam(o.tasdik()), new AbortController().signal), { ok: false, code: "ic_hata" });
    }
    assert.equal(o.depo.ajandaKayitlari({}).length, 0);
    const c = await o.ekle(DISCI, o.pcBaglam(o.tasdik()));
    assert.equal(c.sonuc, "eklendi");
    assert.equal(o.karar(), "insan");
    assert.equal("bolge_yeni" in c, false);
  });

  it("başka oturumun eş taslağı (9b85b09) kapalıyken de: insanın vermediği alan taşınmaz, varsayılan hatırlatma yazılır", async () => {
    const o = kur(T0, false);
    const id = kimlik(await o.ekle({ ...DISCI, ...ALT_V2 }, o.pcBaglam(o.tasdik({ alt_agent: true }))));
    assert.equal(o.kayit(id).taslak, true);
    const c = await o.ekle(INSAN, o.pcBaglam(o.tasdik({ oturum_id: OTURUM_2, istem_id: "istem-b" })));
    assert.equal(c.sonuc, "onaylandi");
    assert.ok(c.sonuc === "onaylandi");
    assert.deepEqual(c.uygulanan_alanlar, ["zaman"]);
    const k = o.kayit(id);
    assert.equal(k.taslak, false);
    assert.equal(k.aciklama, undefined);
    assert.deepEqual(k.hatirlatmalar, [{ tur: "once", dk: 60 }]);
    // Aynı oturumun ana ajanı onaylarsa taslağın alanları taşınır (bugünkü kural).
    const p = kur(T0, false);
    const id2 = kimlik(await p.ekle({ ...DISCI, ...ALT_V2 }, p.pcBaglam(p.tasdik({ alt_agent: true }))));
    assert.equal((await p.ekle(INSAN, p.pcBaglam(p.tasdik()))).sonuc, "onaylandi");
    assert.equal(p.kayit(id2).aciklama, "ALT-AGENT-ACIKLAMASI");
    assert.deepEqual(p.kayit(id2).hatirlatmalar, [{ tur: "once", dk: 15 }]);
  });
});
