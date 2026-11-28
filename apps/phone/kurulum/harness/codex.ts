// Codex CLI uyarlayıcısı (`PcAjani`, harness/tur.ts): YALNIZ TASLAK (docs/HARNESS.md 3.1 T6, 4.3;
// ölçüm docs/HARNESS-H3-OLCUM.md bölüm 6). Codex kullanıcısı ajanda araçlarını kullanır, ama Codex'ten gelen
// her kayıt taslak doğar ve telefondan onaylanır. Neden: Codex'in araç öncesi kancası (`PreToolUse`) review
// alt oturumunu ana agent'tan ayıramıyor (kancada `agent_id` yok) ve etkileşimli oturumu `codex exec`'ten
// ayıramıyor (kanca girdisi alan alana aynı). Bu yüzden:
//
// - Kanca kurulmaz; bu modülde kanca kurma, kaldırma ve durum işlevi yoktur. Kurulsaydı bile etkileşimli
//   arayüz, kurulumun yazamadığı bir güven onayı isterdi (`trusted_hash`).
// - Köprü `--uyarlayici codex` ile başlar ve çağrı kimliğini hiç okumaz (`server/src/kopru.ts`
//   `PC_KOPRU_UYARLAYICILARI.codex`): servis her Codex çağrısında `cagri_kimligi_yok` der, kayıt taslaktır.
//   `codex`, tasdik çerçevesinin uyarlayıcı listesinde (`protocol` `PC_UYARLAYICILARI`) bilerek yoktur.
// - Bu modül kullanıcının Codex yapılandırmasına (`~/.codex`, `CODEX_HOME`) hiçbir şey yazmaz ve dosya
//   okumaz: `codex mcp add` komutunu kabuk başına (harness/kabuk.ts) yazar, kullanıcı kendisi çalıştırır.
//
// Yolların tek kaynağı Claude Code uyarlayıcısınınkiyle aynı `yollar`'dır (veri kökünden
// `uygulama\guncel\server\src\kopru.ts`); çalışan dosyanın kendi yolu kullanılmaz.
import { VERI_KOKU_ORTAMI, veriKoku } from "../ortam.ts";
import type { Ortam } from "../ortam.ts";
import { MCP_ADI, yollar } from "./claude-code.ts";
import type { Yollar } from "./claude-code.ts";
import { KABUK_ADI, KABUKLAR, KabukHatasi, komutSatiri } from "./kabuk.ts";
import type { Kabuk } from "./kabuk.ts";
import type { TaslakPcAjani } from "./tur.ts";

/** Köprünün uyarlayıcı adı (`kopru.ts --uyarlayici codex`). */
export const KOPRU_UYARLAYICISI = "codex";

/**
 * Kayıtların neden hep taslak doğduğu (teşhis ve yönerge bunu yazar). Ölçüme dayanır: Codex 0.172.0,
 * docs/HARNESS-H3-OLCUM.md bölüm 6 (Ö5, Ö6).
 */
export const TASLAK_NEDENI =
  "Codex'in araç öncesi kancası çağrının ana agent'tan mı yoksa bir alt oturumdan (review) mı geldiğini ve " +
  "oturumun etkileşimli mi etkileşimsiz mi (codex exec) olduğunu ayıramıyor (ölçüldü: Codex 0.172.0). Bu yüzden " +
  "kanca kurulmaz, köprü çağrı kimliğini okumaz: Codex'ten gelen bütün kayıtlar taslak doğar, telefondan onaylanır.";

/**
 * `codex mcp add` argümanları (programsız). Köprü sarmalayıcısız başlar (`--`'dan sonra node.exe'nin kendisi).
 * Veri kökü `--env` ile açıkça verilir: köprü anahtarı veri kökünden okur ve Codex MCP sunucusunu kendi
 * ortamıyla başlatır; kök böylece `eren eslestir`'in anahtarı yazdığı yerdir.
 */
export const mcpEkleArgumanlari = (y: Pick<Yollar, "nodeExe" | "kopruBetigi">, kok: string): string[] => [
  "mcp", "add", MCP_ADI, "--env", `${VERI_KOKU_ORTAMI}=${kok}`,
  "--", y.nodeExe, "--disable-warning=ExperimentalWarning", y.kopruBetigi, "--rol", "pc_oturumu", "--uyarlayici", KOPRU_UYARLAYICISI,
];

export const MCP_KALDIR_KOMUTU = `codex mcp remove ${MCP_ADI}`;

/** Codex'te yalnız PowerShell 7 satırı ölçüldü (bölüm 6 "Uçtan uca"); cmd satırı tırnak kuralıyla yazılır, ölçülmedi. */
const OLCULMEYEN: ReadonlySet<Kabuk> = new Set(["cmd"]);

/** `codex mcp add` satırı, verilen kabuğa yapıştırılacak hali; yazılamıyorsa `KabukHatasi`. */
export const mcpKaydiSatiri = (y: Pick<Yollar, "nodeExe" | "kopruBetigi">, kok: string, kabuk: Kabuk): string =>
  komutSatiri(kabuk, "codex", mcpEkleArgumanlari(y, kok));

/**
 * MCP kaydı satırları (girintili). `kabuk` verilirse yalnız o kabuğun satırı; verilmezse PowerShell, Git Bash
 * ve cmd için etiketli birer satır. Bir kabukta güvenli satır yazılamıyorsa satır yerine nedeni yazılır.
 */
export function mcpKaydiSatirlari(y: Pick<Yollar, "nodeExe" | "kopruBetigi">, kok: string, kabuk?: Kabuk): string[] {
  const satir = (k: Kabuk): string => {
    try {
      return mcpKaydiSatiri(y, kok, k);
    } catch (e) {
      if (!(e instanceof KabukHatasi)) throw e;
      return `(bu yollarla ${KABUK_ADI[k]} için güvenli satır yazılamıyor: ${e.message}; başka bir kabuk kullanın)`;
    }
  };
  if (kabuk !== undefined) return [`   ${satir(kabuk)}`];
  return KABUKLAR.flatMap((k) => [`   ${KABUK_ADI[k]}${OLCULMEYEN.has(k) ? " (Codex'te ölçülmedi)" : ""}:`, `     ${satir(k)}`]);
}

/**
 * `eren eslestir --pc-ajan codex`'in anahtardan sonra yazdığı yönerge (`--yonerge` anahtarsız yazar). Hiçbir şey
 * değiştirmez, dosya okumaz. "Onaylanmış kayda dokunamaz" dürüst köprü varsayımıyladır ve metin bunu söyler; gerçek
 * köprünün Codex 0.172.0 altında kayıt yazması test servisine karşı ölçüldü; ölçülmeyenler metinde açıkça yazılı.
 */
export function gosterMetni(y: Yollar, kok: string): string {
  return [
    "PC'deki Codex CLI oturumlarının ajanda kaydı (yalnız taslak; kullanıcının onayıyla, bir kez):",
    "",
    "Codex'ten gelen kayıtlar TASLAK doğar ve telefondan (Ajanda uygulaması) onaylanır.",
    "Neden: Codex'in araç öncesi kancası çağrının ana agent'tan mı yoksa bir alt oturumdan (review) mı geldiğini",
    "ve oturumun etkileşimli mi etkileşimsiz mi (codex exec) olduğunu ayıramıyor (ölçüldü: Codex 0.172.0;",
    "docs/HARNESS-H3-OLCUM.md bölüm 6). Bu yüzden kanca kurulmaz ve köprü çağrı kimliğini okumaz.",
    "",
    "1. MCP köprüsü (Codex kullanıcı yapılandırması: ~\\.codex\\config.toml, CODEX_HOME tanımlıysa orası).",
    "   Bu kurulum oraya yazmaz; komutu kendiniz çalıştırın. Yapıştıracağınız kabuğa göre seçin:",
    ...mcpKaydiSatirlari(y, kok),
    "   Köprü sarmalayıcısız başlar (cmd /c, npx yok). --env veri kökünü verir: köprü anahtarı oradan okur.",
    "   Ölçüldü (Codex 0.172.0): PowerShell 7 satırı çalıştı (\"Added global MCP server\"; config.toml'a",
    "   [mcp_servers.eren-ajanda] ve .env yazıldı). Ölçülmedi: PowerShell 5.1 ve Git Bash satırları.",
    "",
    "2. Kanca yok: kurmayın. Kayıtlar taslak doğar. Ölçüldü (Codex 0.172.0, gerçek köprü, test servisine karşı;",
    "   docs/HARNESS-H3-OLCUM.md bölüm 6, \"Uçtan uca\"): kayıt taslak doğdu, araç çıktısındaki not ve teşhis doğru",
    "   çıktı. Ölçülmedi: tam servis ve telefondan onay akışı, etkileşimli arayüz; 4. adımdaki sınama gerçek",
    "   kurulumda bunu gösterir.",
    "   Codex onaylanmış (taslak olmayan) kayda dokunamaz: \"dişçiyi 11'e al\" gibi bir değişiklik, kayıt telefonda",
    "   onaylandıysa reddedilir (sentetik_turda_izinsiz). Yalnız hâlâ taslak olan kayıt değiştirilebilir;",
    "   onaylanmış kaydı telefondan değiştirin.",
    "   Bu, köprülerin dürüst olduğu varsayımına dayanır. Güven sınırı Windows kullanıcısıdır: kabuk erişimi olan bir",
    "   model (sandbox izin verirse) kancaya sahte girdi verip kendi başlattığı Claude Code köprüsüyle insan turu",
    "   üretebilir.",
    "",
    '3. codex exec (etkileşimsiz) ile kullanılacaksa: approval_policy = "never" iken ajanda araçları onay isteyip',
    '   düşer ("MCP tool call requires approval, but approval policy is never"). Ölçülen (Codex 0.172.0,',
    "   docs/HARNESS-H3-OLCUM.md bölüm 6) iki yol, config.toml'da; bu kurulum hiçbirini yazmaz, siz eklersiniz:",
    "   - Araç başına, her araç için (ajanda_ekle, ajanda_listele, ajanda_guncelle):",
    "       [mcp_servers.eren-ajanda.tools.ajanda_ekle]",
    '       approval_mode = "approve"',
    "   - Sunucu geneli:",
    "       [mcp_servers.eren-ajanda]",
    '       default_tools_approval_mode = "approve"',
    '   default_tools_approval_mode kök düzeye yazılırsa Codex "unknown configuration field" ile reddeder; yeri',
    '   sunucu tablosudur. "approve" dışındaki değerler denenmedi.',
    "   Ayarla exec'te çalışan çağrının kaydı da, etkileşimli oturumdaki gibi, taslak doğar.",
    "",
    "4. Sınama: yeni bir Codex oturumu açın, bir kayıt isteyin (\"yarın 10'da dişçi, ajandaya ekle\"); kayıt telefonda",
    "   taslak olarak görünür. Sonra: eren eslestir --pc-ajan codex --teshis  (Codex çağrısının kararı cagri_kimligi_yok:",
    "   beklenen, kayıt taslak).",
    "",
    "Bu yönergeyi anahtara dokunmadan yeniden görmek: eren eslestir --pc-ajan codex --yonerge",
    `Kaldırma: ${MCP_KALDIR_KOMUTU}; anahtar bütün PC ajanlarında ortaktır (eren eslestir --pc-ajan codex --kaldir hepsini kapatır).`,
    "",
  ].join("\n");
}

export const kayitYonergesi = (ortam: Ortam, nodeExe: string): string => gosterMetni(yollar(ortam, nodeExe), veriKoku(ortam));

/** Codex uyarlayıcısı (`pcAjani("codex")`): yalnız taslak, kancasız. */
export const CODEX: TaslakPcAjani = {
  ad: "codex",
  gorunenAd: "Codex CLI",
  tasdik: "yalniz_taslak",
  taslakNedeni: TASLAK_NEDENI,
  mcpKaydiYonergesi: (ortam, nodeExe, kabuk) => mcpKaydiSatirlari(yollar(ortam, nodeExe), veriKoku(ortam), kabuk).join("\n"),
  kayitYonergesi,
};
