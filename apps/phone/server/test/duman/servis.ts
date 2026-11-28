/**
 * Duman koşusunun servis girişi. Sıra `src/ana.ts` `giris` ile aynıdır (ayar, kök izni, dış dünya,
 * dizinler, tekil kilit, `servisKur` ek yedeğiyle, `baslat`); farklar yalnız düzeneğin gereği:
 *
 * - Boru adları: süreç `--import boru-yonlendir.ts?onek=<belirteç>` ile açılır; tekil kilit, köprü ve
 *   ajanda boruları canlı servisinkilerden ayrışır (kaynakta ad ayarı yok).
 * - Ağ: `e2e/servis-giris.ts` gibi. `sistem.tailscaleAdresi()` sabit `100.64.0.1`, WebSocket gerçekte
 *   `127.0.0.1:<port>`'ta, her bağlantının `uzakIp`'i `100.64.0.2`. Gateway'in ağ denetimleri birim testlerde.
 * - Bekçi yok: IPC kanalı kurulmaz. Kapanış stdin'deki `{"komut":"kapat"}` satırıyla (Windows'ta dışarıdan
 *   sinyal yollanamaz).
 * - `{"komut":"is_hafif", ...}`: onaylı bir PC planını depoya yazıp `isler.baslat(..., "hafif")` çağırır
 *   (`altin-duzen.ts` `islerDuzeni.baslat` ile aynı yol). Planı modele önerdirmek pahalı ve belirsiz olurdu;
 *   ölçülen iş sürecinin argv'si ve ortamıdır, plan önerme yolu değil.
 * - Transkript silme portu sahtedir (`transkriptSar`): ürününki gerçek `~/.claude/projects`'te siler.
 *
 * Ayar argv'den gelir (`servis.ts <ayar.json>`); servisin ortamına düzenek değişkeni eklenmez, çünkü ortam
 * `claude` süreçlerine geçer ve kayda girer.
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import win32 from "node:path/win32";
import { createInterface } from "node:readline";
import { planHash } from "@eren/protocol";
import type { Plan } from "@eren/protocol";
import { AJANDA_EK_KLASORU } from "../../src/ajanda-ekler.ts";
import { servisKur } from "../../src/ana.ts";
import { AyarHatasi, ayarKur } from "../../src/ayar.ts";
import { ajandaEkDiskiKur, disDunyaKur, dosyaPortuKur, veriKokuIzniHazirla } from "../../src/dis-dunya.ts";
import { gunlukKur } from "../../src/gunluk.ts";
import { kokIzniHataMetni } from "../../src/kok-izni.ts";
import type { DisDunya, Ortam, WsBaglantisi } from "../../src/sozlesme.ts";

export interface DumanServisAyari {
  port: number;
  /** Hazır işareti: `{hazir, pid, port}`. */
  durumYolu: string;
  /** Komut cevapları (jsonl). */
  kontrolYolu: string;
}

const SAHTE_PC_IP = "100.64.0.1";
const SAHTE_TELEFON_IP = "100.64.0.2";
const KAPANIS_SINIRI_MS = 30_000;

const baglantiSar = (b: WsBaglantisi): WsBaglantisi => ({
  yol: b.yol,
  uzakIp: SAHTE_TELEFON_IP,
  yetenekler: b.yetenekler,
  gonder: (m) => b.gonder(m),
  kapat: (k, n) => b.kapat(k, n),
  mesajDinle: (f) => b.mesajDinle(f),
  kapanisDinle: (f) => b.kapanisDinle(f),
  kimlikDogrulandi: () => b.kimlikDogrulandi(),
});

const agSar = (d: DisDunya, port: number): DisDunya => ({
  ...d,
  sistem: { ...d.sistem, tailscaleAdresi: () => SAHTE_PC_IP },
  ws: { dinle: (istek) => d.ws.dinle({ ...istek, host: "127.0.0.1", port, baglanti: (b) => istek.baglanti(baglantiSar(b)) }) },
});

/**
 * Transkript silme portunun duman karşılığı. Ürün portunun kökü gerçek `~/.claude/projects`'tir
 * (`ayar.ts` `claudeProjeleri`); yalnız duman oturumlarının UUID'lerini silerdi ve senaryo onu tetiklemez
 * (yeni sayfa yok). Yine de duman `~/.claude`'da yalnız `--izleri-sil` ile siler: bu port hiçbir şey silmez,
 * çağrıyı kontrol günlüğüne sayar ve her kimliği `silinemeyen` döner (temizlik oturum kayıtlarını korur,
 * üründeki "silinemedi" yolu). Bedeli: duman bu yolun gerçek dosya sistemi davranışını sınamaz
 * (`dis-dunya.test.ts` "transkript.sil" sınar).
 */
const transkriptSar = (d: DisDunya, kontrol: (o: Record<string, unknown>) => void): DisDunya => ({
  ...d,
  transkript: {
    sil: async (oturumlar) => {
      kontrol({ olay: "transkript_sil_engellendi", adet: oturumlar.length });
      return { silinen: 0, bulunamayan: 0, silinemeyen: oturumlar.length, reddedilen: 0 };
    },
  },
});

const ortamKopyasi = (): Ortam => {
  const kopya: Record<string, string> = {};
  for (const [ad, deger] of Object.entries(process.env)) if (deger !== undefined) kopya[ad] = deger;
  return kopya;
};

const giris = async (): Promise<void> => {
  const baslangicMs = Date.now();
  const ayarYolu = process.argv[2];
  if (ayarYolu === undefined) throw new Error("duman servis: ayar yolu yok");
  const da = JSON.parse(readFileSync(ayarYolu, "utf8")) as DumanServisAyari;
  const kontrol = (o: Record<string, unknown>): void => {
    try {
      appendFileSync(da.kontrolYolu, `${JSON.stringify({ ms: Date.now(), ...o })}\n`);
    } catch {
      // gözlem kaybı servisi durdurmaz
    }
  };
  process.on("uncaughtException", (e) => {
    kontrol({ olay: "yakalanmamis_hata", ad: e instanceof Error ? e.name : typeof e, ileti: e instanceof AyarHatasi ? e.message : "" });
    process.exit(1);
  });
  process.stdout.on("error", () => {});
  process.stderr.on("error", () => {});

  const ayar = await ayarKur({ dosya: dosyaPortuKur(), ortam: ortamKopyasi(), execPath: process.execPath, baslangicMs });
  const izin = await veriKokuIzniHazirla(ayar.yollar.kok);
  if (!izin.guvenli) throw new AyarHatasi(kokIzniHataMetni(izin.sorunlar));
  const dunya = transkriptSar(agSar(await disDunyaKur({ yollar: ayar.yollar }), da.port), kontrol);
  const g = gunlukKur({ kayit: dunya.kayit, saat: dunya.saat, azamiBayt: 10 * 1024 * 1024, azamiDosya: 5 });
  const { kok, log, islerDizini, erenCwd, erenMcpDizini, vt } = ayar.yollar;
  for (const dizin of [kok, win32.dirname(log), islerDizini, erenCwd, erenMcpDizini]) await dunya.dosya.dizinOlustur(dizin);

  if (!(await dunya.tekilKilit.al())) {
    // Yönlendirilmiş adla tekil kilit tutuluyorsa aynı belirteçle ikinci duman servisi açılmış demektir.
    kontrol({ olay: "ikinci_ornek" });
    process.exit(3);
  }

  const servis = servisKur({
    dunya,
    ayar,
    depoYolu: vt,
    ajandaEkDiski: ajandaEkDiskiKur(win32.join(kok, AJANDA_EK_KLASORU)),
    ajandaEkKotaBayt: ayar.ajandaEkKotaBayt,
    ajandaAracV3: ayar.ajandaAracV3,
  });

  let kapaniyor = false;
  const kapat = (neden: string): void => {
    if (kapaniyor) return;
    kapaniyor = true;
    g.bilgi("duman", "kapaniyor", { neden });
    kontrol({ olay: "kapaniyor", neden });
    setTimeout(() => process.exit(1), KAPANIS_SINIRI_MS).unref();
    void servis.kapat().finally(() => process.exit(0));
  };

  const isHafif = async (k: { plan_id?: string; baslik?: string; cwd?: string; gorev_metni?: string }): Promise<void> => {
    const plan = {
      plan_id: k.plan_id ?? "plan_duman1",
      baslik: k.baslik ?? "Duman isi",
      tur: "pc",
      cwd: k.cwd ?? "",
      gorev_metni: k.gorev_metni ?? "",
    } as unknown as Plan;
    const hash = planHash(plan);
    servis.depo.planEkle({ plan, plan_hash: hash, durum: "onaylandi", profil: "hafif", is_id: null, olusturma_ms: Date.now(), sohbet_id: "ana" });
    const r = await servis.isler.baslat({ plan, plan_hash: hash, profil: "hafif", sohbet_id: "ana" });
    kontrol(r.ok ? { olay: "is_basladi", is_id: r.deger, gorev_yolu: ayar.isYollari(r.deger).gorev } : { olay: "is_baslamadi", kod: r.code });
  };

  createInterface({ input: process.stdin }).on("line", (s) => {
    let k: { komut?: unknown };
    try {
      k = JSON.parse(s) as { komut?: unknown };
    } catch {
      return;
    }
    if (k.komut === "kapat") kapat("stdin");
    else if (k.komut === "is_hafif") void isHafif(k as Parameters<typeof isHafif>[0]).catch((e: unknown) => kontrol({ olay: "is_hatasi", ad: e instanceof Error ? e.name : typeof e }));
  });

  await servis.baslat();
  g.bilgi("duman", "basladi", { pid: process.pid, port: da.port });
  kontrol({ olay: "basladi", pid: process.pid });
  writeFileSync(da.durumYolu, JSON.stringify({ hazir: true, pid: process.pid, port: da.port }));
};

if (import.meta.main) {
  try {
    await giris();
  } catch (e) {
    // Hata metni yalnız `AyarHatasi` için yazılır (alan adı taşır, değer taşımaz; `ana.ts` gibi).
    process.stderr.write(`duman servis: baslatma_hatasi ${e instanceof Error ? e.name : typeof e} ${e instanceof AyarHatasi ? e.message : ""}\n`);
    process.exit(1);
  }
}
