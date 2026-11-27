// PC'deki normal Claude Code oturumlarının ajanda kaydı: komut satırı girişi (docs/SERVIS.md "Claude Code
// oturumları"). İçerik Claude Code uyarlayıcısındadır (`harness/claude-code.ts`; harness arayüzü
// `harness/tur.ts`); bu dosya onun bütün dışa verimlerini aynı adlarla verir (`server/src/eslestir.ts`
// `kayitYonergesi` ve `kancaDurumu`'nu buradan yükler) ve komut satırını çalıştırır:
//
//   node --disable-warning=ExperimentalWarning kurulum/claude-code.ts goster          (varsayılan; hiçbir şey değiştirmez)
//   node --disable-warning=ExperimentalWarning kurulum/claude-code.ts kanca-ekle  [--ayar <settings.json>]
//   node --disable-warning=ExperimentalWarning kurulum/claude-code.ts kanca-kaldir [--ayar <settings.json>]
//
// Yolların tek kaynağı uyarlayıcının `yollar`'ıdır (veri kökünden `uygulama\guncel\...`); bu dosyanın ya da
// çalışan herhangi bir dosyanın kendi yolu hiçbir komuta girmez.
import { calis } from "./harness/claude-code.ts";

export * from "./harness/claude-code.ts";

if (import.meta.main) process.exitCode = calis(process.argv.slice(2));
