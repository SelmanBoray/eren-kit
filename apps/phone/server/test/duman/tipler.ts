/**
 * Duman koşusunun ortak tipleri ve sabitleri (HARNESS-H4-PLAN.md bölüm 6, "Altın kaydın kör noktası").
 * Yalnız düzenek kullanır; servis kodu bunları görmez. Bu dizindeki hiçbir dosya `.test.ts` ile bitmez:
 * `npm test` (`test/**\/*.test.ts`) onları koşturmaz.
 */

/** Gerçek ve sahte süreçler arasında karşılaştırılan kaydın biçim sürümü. */
export const DUMAN_KAYIT_SURUMU = 1 as const;

/** Geçici dizinlerin ve boru adlarının ortak öneki; temizlik bu önek + koşu belirteciyle eşler. */
export const DUMAN_ONEKI = "eren-duman-";

/**
 * Kaydedicinin (`kaydedici.ts`) ayar dosyası. Başlatıcı (`baslatici.cs`) bu dosyanın yolunu kaydediciye
 * ilk argüman olarak verir; servisin ortamına hiçbir şey eklenmez (kayıttaki ortam servisinkidir).
 */
export interface KaydediciAyari {
  /** Gerçek `claude.exe`. */
  gercekClaude: string;
  /** Süreç başına `<pid>.jsonl` ve değiştirilmiş mcp kopyaları buraya yazılır. */
  kayitDizini: string;
  /**
   * `null`: argv'deki model olduğu gibi gerçek sürece gider. Dolu: gerçek sürecin argv'sinde `--model`
   * değeri bununla değişir (servisin verdiği argv kayda değişmeden girer).
   */
  model: string | null;
  /** Köprü süreçlerine (`node kopru.ts`) `--import` ile verilen boru yönlendirme önyüklemesi (URL). */
  onyukleme: string;
}

/** Kaydedicinin `--mcp-config` için verdiği karar. */
export type YonlendirmeKaydi =
  | { tur: "mcp_yok" }
  | { tur: "aynen" }
  | { tur: "kopya"; koprular: string[]; kopya: string }
  | { tur: "hata"; neden: string };

/** Boru yönlendirme önyüklemesinin denetim günlüğü satırı (`<kök>\boru\<pid>.jsonl`, `boru-yonlendir.ts`). */
export type BoruOlayi =
  | { ms: number; pid: number; t: "yuklendi"; betik: string | null; rol: string | null; ppid: number }
  | { ms: number; pid: number; t: "baglan"; hedef: string }
  | { ms: number; pid: number; t: "dinle"; hedef: string }
  | { ms: number; pid: number; t: "baglan_cevrildi" | "dinle_cevrildi"; istenen: string; hedef: string }
  | { ms: number; pid: number; t: "kabul"; hedef: string }
  | { ms: number; pid: number; t: "red"; islem: "baglan" | "dinle"; katman: "net" | "yerel"; istenen: string };

/** Kaydedicinin süreç başına yazdığı olay satırları (`<kayitDizini>\<pid>.jsonl`). */
export type KaydediciOlayi =
  | {
      t: "baslat";
      ms: number;
      pid: number;
      /** Servisin verdiği argv (başlatıcıdan bayt bayt geçer). */
      argv: string[];
      /** Gerçek `claude`'a giden argv (model ve mcp yolu değişmiş olabilir). */
      gercek_argv: string[];
      cwd: string;
      /** Bütün anahtarlar (sıralı); değerler yalnız `ORTAM_DEGERI_KAYDEDILEN` için. */
      ortam_anahtarlari: string[];
      ortam_degerleri: Record<string, string>;
      /** `--mcp-config` yolu ve servisin yazdığı ham metin (köprü jetonları geçici köke aittir). */
      mcp: { yol: string; icerik: string | null } | null;
      /** Köprü yönlendirmesinin sonucu; `hata` ise gerçek claude başlatılmadı (çıkış 91). */
      yonlendirme?: YonlendirmeKaydi;
    }
  | { t: "stdin"; ms: number; s: string }
  | { t: "stdout"; ms: number; s: string }
  | { t: "stderr"; ms: number; s: string }
  | { t: "cikis"; ms: number; kod: number | null; sinyal: string | null };

/**
 * Kayıtta `degerler`'e giren ortam anahtarları; geri kalanların yalnız adı yazılır (PATH, kullanıcı yolları,
 * başka araçların jetonları kayda girmez). Bunlardan da yalnız `DEGERI_YAZILAN`'ın değeri yazılır; ötekiler
 * `DEGER_YAZILMADI` olur: servisin silmesi gereken bir anahtar (ör. `ANTHROPIC_API_KEY`) sızarsa karşılaştırma
 * farkı gösterir, sırrın kendisi kayda geçmez.
 */
export const ORTAM_DEGERI_KAYDEDILEN = /^(claude|anthropic|eren_|node_options$)/i;
export const DEGERI_YAZILAN = /^(claude_code_disable_[a-z_]+|eren_kit_servis_oturumu|eren_kit_data_dir)$/i;
export const DEGER_YAZILMADI = "<değer yazılmadı>";

/** Bir sürecin toplanmış kaydı. */
export interface SurecKaydi {
  pid: number;
  baslangic_ms: number;
  argv: string[];
  gercek_argv: string[];
  cwd: string;
  ortam: { anahtarlar: string[]; degerler: Record<string, string> };
  mcp: { yol: string; icerik: string | null } | null;
  yonlendirme?: YonlendirmeKaydi;
  stdin: string[];
  stdout: string[];
  stderr: string;
  /** Süreç ağacı öldürüldüyse `null` (kayıt yarıda kalır). */
  cikis: number | null;
}

/** Koşunun bütün kaydı: karşılaştırmanın girdisi (`karsilastir.ts`). */
export interface DumanKaydi {
  surum: typeof DUMAN_KAYIT_SURUMU;
  /** Gerçek değer → altın kaydın sahte değeri eşlemesinin gerçek tarafı. */
  esleme: {
    /** `<geçici>\eren-kit` (altında `C:\ornek\Yerel\eren-kit`). */
    veriKoku: string;
    /** Servisin `LOCALAPPDATA`'sı (altında `C:\ornek\Yerel`). */
    localAppData: string;
    /** PC işinin cwd'si (altında `C:\ornek\proje`). */
    proje: string;
    /** Servisin `claude_exe`'si: başlatıcı (altında `C:\ornek\bin\claude.exe`). */
    claudeExe: string;
    /** Servisin `process.execPath`'i (altında `C:\ornek\node\node.exe`). */
    nodeExe: string;
  };
  /** Düzeneğin gönderdiği metinler: normalleştirilen alanların ayrı eşitlik denetimi. */
  gonderilen: { mesaj: string; kesme: string; gorev_metni: string };
  surecler: SurecKaydi[];
  /** PC işinin `gorev.txt`'si (servisin yazdığı dosya; koşu sonunda okunur). */
  gorev_txt: string | null;
}
