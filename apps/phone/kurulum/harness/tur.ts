// PC ajanı (harness) uyarlayıcılarının kurulum arayüzü (docs/HARNESS.md 4.3). Her harness'ın kurulum
// tarafı (MCP kaydı yönergesi, araç öncesi kancasının kurulması, kaldırılması ve durumu) bir uyarlayıcının
// arkasındadır; servis (`eren eslestir`) uyarlayıcıyı adıyla bulur. Kapalı ad listesi: bugün yalnız Claude
// Code. Yeni harness ölçülüp uyarlayıcısı yazılınca buraya eklenir.
import type { Ortam } from "../ortam.ts";
import type { Kabuk } from "./kabuk.ts";
import { CLAUDE_CODE } from "./claude-code.ts";

export const PC_AJAN_ADLARI = ["claude-code"] as const;
export type PcAjanAdi = (typeof PC_AJAN_ADLARI)[number];

/**
 * Kullanıcı ayarındaki kanca durumu (`eren eslestir --teshis`; yalnız okunur). Şekil `server/src/eslestir.ts`
 * `ClaudeCodeKancaDurumu` ile uyumludur: `arac` araç öncesi kancası kurulu mu (`null`: ayar okunamadı, `hata`
 * nedeni); `eski` bu aracın artık kullanılmayan kancaları; `kabuk` kurulu araç kancalarından kaçı kabuğa bağlı
 * eski biçimde; `kapatan` kancaları kapatan, okunabilen ayarlar.
 */
export interface KancaDurumu {
  ayarYolu: string;
  arac: boolean | null;
  eski: number;
  kabuk: number;
  kapatan: string[];
  hata?: string;
}

/** Kanca kurma/kaldırma seçenekleri: varsayılan ayar yolu yerine verilen (mutlak) yol ve saat (yedek damgası). */
export interface KancaSecenegi {
  ayarYolu?: string;
  simdiMs?: number;
}

/** Kanca kurma/kaldırmanın sonucu: hangi dosya, değişti mi, yedeği ve kullanıcıya yazılacak satırlar. */
export interface KancaSonucu {
  ayarYolu: string;
  degisti: boolean;
  yedek: string | null;
  satirlar: string[];
}

export interface PcAjani {
  readonly ad: PcAjanAdi;
  /** Kullanıcıya görünen ad (ör. "Claude Code"). */
  readonly gorunenAd: string;
  /**
   * MCP köprüsünün harness'a kaydı için kullanıcıya gösterilecek satırlar (çalıştırılmaz). `kabuk` verilirse
   * yalnız o kabuğun satırı; verilmezse desteklenen bütün kabuklar, etiketli. Kayıt komut değil dosyaysa
   * (ör. TOML) kabuk yok sayılabilir.
   */
  mcpKaydiYonergesi(ortam: Ortam, nodeExe: string, kabuk?: Kabuk): string;
  /** `eren eslestir`'in anahtardan sonra yazdığı tam kayıt yönergesi (MCP kaydı, kanca, sınama, kaldırma). */
  kayitYonergesi(ortam: Ortam, nodeExe: string): string;
  /** Kullanıcı ayarındaki kanca durumu; hiç atmaz. */
  kancaDurumu(ortam: Ortam): KancaDurumu;
  /** Araç öncesi kancayı kurar (idempotent, yedekli); hata durumunda atar, dosya değişmez. */
  kancaKur(ortam: Ortam, nodeExe: string, secenek?: KancaSecenegi): KancaSonucu;
  /** Bu aracın kancalarını kaldırır (yalnız kendisininkileri, yedekli); hata durumunda atar. */
  kancaKaldir(ortam: Ortam, secenek?: KancaSecenegi): KancaSonucu;
}

const UYARLAYICILAR: Readonly<Record<PcAjanAdi, PcAjani>> = { "claude-code": CLAUDE_CODE };

/** Adı kapalı listede olan uyarlayıcı; değilse `null` (nesne anahtarları ve büyük/küçük harf farkı ad sayılmaz). */
export const pcAjani = (ad: string): PcAjani | null =>
  (PC_AJAN_ADLARI as readonly string[]).includes(ad) ? UYARLAYICILAR[ad as PcAjanAdi] : null;
