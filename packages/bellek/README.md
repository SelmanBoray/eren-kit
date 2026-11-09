# Bellek

**English summary.** Bellek is a local, cross-session memory component for Claude Code. It has three parts: (1) a note/search pipeline (Markdown vault, rebuildable SQLite FTS5 index, token-budgeted context retrieval; early milestones), (2) *beyin* ("brain"), a hierarchical personal knowledge graph stored in a single SQLite file, served by a local single-writer service and exposed to Claude Code as a stdio MCP server (`beyin_ara`, `beyin_gez`, `beyin_oku`, `beyin_yaz`, `beyin_duzelt`, `beyin_gelen`) plus a read-mostly web UI (`beyin ac`), and (3) *devir* ("handover"), a stdlib-only set of Claude Code hooks and a `/devir` skill that write session handover notes and warn about expensive long contexts. Everything is fail-open, runs on localhost, and is configured through `bellek.toml` and `BELLEK_*` environment variables. Documentation is in Turkish; the design contract is [DESIGN.md](DESIGN.md). Part of the [eren-kit](../../README.md) monorepo (installer: `install.ps1` at the repository root).

---

Bellek, Claude Code için yerel ve oturumlar arası bir hafıza bileşenidir. Claude Code auto-memory'sinin `MEMORY.md` dosyası her oturumda tamamen bağlama yüklenir; not sayısı arttıkça bu hem pahalı hem verimsiz olur. Bellek bunun yerine, o anki işle ilgili bilgiyi bütçe içinde ve istek üzerine getirir. Notlar Markdown'dır ve gerçek kaynaktır; arama indeksi türetilmiş veridir.

- Tasarım sözleşmesi: [DESIGN.md](DESIGN.md)
- Bu pakette çalışan agent için kurallar: [CLAUDE.md](CLAUDE.md)
- Kök dizin ve kurulum betiği (`install.ps1`): [../../README.md](../../README.md)
- Esin kaynağı: avenoxai/avenoxbeyin (MIT). Kod sıfırdan yazıldı.

## Bileşenler

| Bileşen | Yol | Ne işe yarar |
| --- | --- | --- |
| Çekirdek | `src/bellek/` | Ayar yükleyici, `bellek` CLI'ı (`yollar`, `doktor`), sağlık kontrolü |
| Beyin | `src/bellek/beyin/` | Kişisel bilgi grafı: SQLite, yerel servis, MCP köprüsü, web arayüzü |
| Devir | `src/bellek/devir/` | Oturum devri: Stop/SessionStart/UserPromptSubmit hook'u |
| Devir skill'i | `skills/devir/SKILL.md` | `/devir` ile zengin devir notu yazar |
| Eval | `eval/` | Arama kalitesini ölçen değerlendirme seti ([eval/PROTOCOL.md](eval/PROTOCOL.md)) |

## Beyin (bilgi grafı)

Hiyerarşik bir "beyin haritası": düğümler (başlık, özet, ayrıntı), ekleme-yalnız olgular, gelen kutusu ve değişiklik geçmişi tek bir SQLite dosyasında (`beyin.db`) durur. Bilgiye kökten aşağı inilerek ya da aramayla ulaşılır. Veritabanını yalnız yerel servis yazar. Mimari ve güvenlik modeli: [DESIGN.md §16](DESIGN.md).

```powershell
python -m bellek.beyin servis          # yerel servisi başlat (127.0.0.1)
python -m bellek.beyin mcp             # stdio MCP köprüsü (Claude Code başlatır)
python -m bellek.beyin ice-al DOSYA.jsonl
python -m bellek.beyin disa-aktar --bicim md|jsonl [--ozelsiz]
python -m bellek.beyin ara "sorgu" | gez [ID] | oku ID
python -m bellek.beyin ac              # web arayüzünü aç
```

`pip install -e .` sonrası `beyin` komutu da aynı girişe bağlıdır.

### MCP araçları

Köprü altı araç sunar (`src/bellek/beyin/mcp_kopru.py` içindeki `ARACLAR` listesi):

| Araç | Tür | İş |
| --- | --- | --- |
| `beyin_ara` | okuma | Kısa yoldan arar; en uygun düğümleri yolu ve id'siyle döndürür. İsteğe bağlı `alt_agac` (dal id'si) ve `k` (1-20) |
| `beyin_gez` | okuma | Bir düğümü ve çocuklarını gösterir; `id` yoksa kök dallar |
| `beyin_oku` | okuma | Bir düğümün ayrıntısını ve olgularını gösterir |
| `beyin_yaz` | yazma | Kalıcı yeni bir olguyu doğru düğüme ekler (`dugum_id`, ya da yeni konu için `ebeveyn` + `baslik`); `gizlilik`: `normal` / `ozel`. Sır içeren metin reddedilir |
| `beyin_duzelt` | yazma | Düğümün `ozet` / `ayrinti` alanını tam metin değiştirir; `eskit` ile bir olguyu eskitir (olgu silinmez, "eskidi" olur). Eski değerler geçmişte kalır |
| `beyin_gelen` | yazma | Gelen kutusu (yeri belirsiz öneriler): `islem=liste` bekleyenleri gösterir, `islem=karar` öneriyi kabul/red eder |

Servis kapalıyken okumalar salt-okunur veritabanından yapılır, `beyin_yaz` kuyruk dosyasına düşer ve servis açılınca işlenir. Claude Code'a kullanıcı kapsamlı kaydı:

```powershell
claude mcp add beyin -s user -- "<repo>\packages\bellek\.venv\Scripts\python.exe" -m bellek.beyin mcp
```

### Web arayüzü

`beyin ac` (ya da `python -m bellek.beyin ac`) arayüz belirtecini hazırlar, servisin ayakta olduğunu doğrular ve varsayılan tarayıcıda `http://127.0.0.1:<port>/#t=<belirteç>` adresini açar. Arayüz, beyin grafını zaman içinde büyüyen bir ağ olarak gösterir; yazma yetkisi yalnız gelen kutusu kararlarıyla sınırlıdır. Seçenekler: `--port`, `--yazdir` (açmadan adresi yaz), `--taban <adres>` (başka bir cihazdan erişim için adres tabanı). Güvenlik modeli ve ek `Host` izni: [DESIGN.md §16.7](DESIGN.md).

## Devir (oturum devri)

Uzun oturumlarda biriken bağlam maliyetini düşürmek için, süreklilik kaybetmeden kısa oturumlara geçmeyi sağlar. Tek giriş noktası `src/bellek/devir/hook.py`'dir (yalnız standart kütüphane):

- **Stop hook'u:** oturum başına tek, kısa bir otomatik not yazar.
- **SessionStart:** oturum kimliğini ve son notların dizinini bağlama ekler.
- **UserPromptSubmit:** uzun bekleme sonrası yeniden yazım maliyeti ve çok büyük bağlam için uyarı verir (bağlama metin eklemez).
- **`/devir` skill'i:** [skills/devir/SKILL.md](skills/devir/SKILL.md). Kurulumda `~/.claude/skills/devir/` altına kopyalanır.

Hook kaydı (hata durumunda oturumu kilitlememek için `|| true` zorunludur):

```
python -I "<repo>/packages/bellek/src/bellek/devir/hook.py" || true
```

Ayrıntı: [DESIGN.md §15](DESIGN.md).

## Yapılandırma

### `bellek.toml`

Kişiye özel ayar dosyasıdır, git'te yok sayılır. Şablon: [bellek.example.toml](bellek.example.toml). `~`, `%VAR%` ve `$VAR` açılır; göreli yollar dosyanın klasörüne göre çözülür. Bilinmeyen tablo ya da anahtar hatadır.

| Tablo | Anahtar | Varsayılan | Anlam |
| --- | --- | --- | --- |
| `[bellek]` | `vault` | yok (zorunlu) | Notların gerçek kaynak klasörü |
| `[bellek]` | `state_dir` | `%LOCALAPPDATA%/Bellek` | İndeks ve günlükler; vault'un içine konmaz |
| `[server]` | `host` | `127.0.0.1` | Yerel servis adresi (yalnız bu makine önerilir) |
| `[server]` | `port` | `47321` | 1-65535 |
| `[[source]]` | `name`, `path` | yok | Salt-okunur ek not kaynağı; Bellek bu yollara asla yazmaz. `name` benzersiz olmalı |
| `[projects]` | `"<klasör>" = "<ad>"` | boş | Çalışma klasöründen proje adına eşleme (en uzun önek kazanır) |

Ayar dosyası sırasıyla `--config YOL`, `BELLEK_CONFIG`, paket kökündeki `bellek.toml` ile bulunur.

### Ortam değişkenleri

| Değişken | Varsayılan | Anlam |
| --- | --- | --- |
| `BELLEK_CONFIG` | paket kökündeki `bellek.toml` | Ayar dosyasının yolu |
| `BELLEK_BEYIN_DB` | `%LOCALAPPDATA%\Bellek\beyin.db` | Beyin veritabanı |
| `BELLEK_BEYIN_PORT` | `47321` | Beyin servisi portu (servis, köprü ve `ac` okur) |
| `BELLEK_BEYIN_KUYRUK` | `%LOCALAPPDATA%\Bellek\beyin_kuyruk.jsonl` | Servis kapalıyken yazmaların biriktiği kuyruk dosyası |
| `BELLEK_BEYIN_KUYRUK_ARALIK` | `60` (sn) | Servisin kuyruğu boşaltma aralığı (en az 0,05) |
| `BELLEK_BEYIN_LOG` | `%LOCALAPPDATA%\Bellek\beyin_servis.log` | Servis günlüğü |
| `BELLEK_BEYIN_KOPRU_LOG` | `%LOCALAPPDATA%\Bellek\beyin_kopru.log` | MCP köprüsü günlüğü |
| `BELLEK_BEYIN_TOKEN_DOSYA` | `%LOCALAPPDATA%\Bellek\beyin_token` | API belirteci dosyası (servis yazar, köprü okur) |
| `BELLEK_BEYIN_ARAYUZ_TOKEN_DOSYA` | `%LOCALAPPDATA%\Bellek\beyin_arayuz_token` | Web arayüzü belirteci dosyası |
| `BELLEK_BEYIN_IZINLI_HOST` | boş | Servisin kabul edeceği ek `Host` değerleri (virgülle ayrılmış, tam eşleşme); başka cihazdan erişimde kullanılır |
| `BELLEK_DEVIR_DIR` | vault altındaki `devir` klasörü | Devir notlarının kökü (otomatik notlar `oto/` altında) |
| `BELLEK_DEVIR_STATE` | `%LOCALAPPDATA%\Bellek\devir` | Devir hook'unun uyarı durumu ve `hook.log` |
| `BELLEK_DEVIR_UYARI` | `durdur` | Uyarı kipi: `durdur` / `uyar` / `kapali` |

## Elle kurulum

Kökteki `install.ps1` tüm kurulumu yapar ([kök README](../../README.md)). Yalnız bu paketi elle kurmak için (Windows, PowerShell, Python 3.12+):

```powershell
cd packages\bellek
py -3.12 -m venv .venv
.venv\Scripts\python -m pip install -e ".[dev]"
Copy-Item bellek.example.toml bellek.toml    # sonra kendi yollarınla düzenle
.venv\Scripts\bellek doktor
```

Ardından:

1. **Beyin servisini çalışır tutun** (`python -m bellek.beyin servis`). Servis kapalıyken yazmalar kuyrukta bekler, `beyin ac` çalışmaz. Kökteki `install.ps1` bunu `eren-kit-beyin-servis` adlı, oturum açılınca başlayan bir zamanlanmış görevle yapar; `-NoService` ile atlanabilir. Elle kurulumda aynı görev `pythonw` ile şöyle kurulur:

   ```powershell
   $py = "<repo>\packages\bellek\.venv\Scripts\pythonw.exe"
   $a = New-ScheduledTaskAction -Execute $py -Argument "-m bellek.beyin servis"
   Register-ScheduledTask -TaskName eren-kit-beyin-servis -Action $a -Trigger (New-ScheduledTaskTrigger -AtLogOn)
   ```

2. MCP köprüsünü venv python'uyla kaydedin (yukarıdaki `claude mcp add` komutu).
3. Devir hook'unu `~/.claude/settings.json` içinde Stop, SessionStart ve UserPromptSubmit olaylarına `python -I "<repo>/packages/bellek/src/bellek/devir/hook.py" || true` komutuyla kaydedin (`install.ps1` ile aynı komut) ve `skills/devir/` klasörünü `~/.claude/skills/devir/` altına kopyalayın.

## Komutlar

```powershell
bellek --version
bellek yollar [--json]       # çözülmüş ayar ve yollar
bellek doktor [--json]       # kurulum sağlık kontrolü
```

Genel seçenek `--config PATH`. Eval komutları ve kurallar: [eval/PROTOCOL.md](eval/PROTOCOL.md). Testler: `.venv\Scripts\python -m pytest`.

## Durum

Not/arama hattı (aşamalar M0-M7, bkz. [DESIGN.md §12](DESIGN.md)) şu an M1 (eval seti) aşamasındadır. Beyin ve Devir alt sistemleri ayrı olarak çalışır durumdadır.

## Klasörler

| Yol | İçerik |
| --- | --- |
| `src/bellek/` | çekirdek, beyin, devir |
| `skills/` | Claude Code skill'leri (`devir`) |
| `eval/` | değerlendirme seti; `eval/data/` yereldir, git'e girmez |
| `tests/` | testler |
| `vault/` | kullanıcının notları, git'e girmez |

## Gizlilik

Vault ve eval verisi git'e girmez. `private: true` işaretli notlar otomatik olarak bağlama alınmaz. Beyinde `ozel` ve `sir_icerir` gizlilik düzeyleri vardır; sır içeren metin yazılmaz. Ajana eklenen her şey, kullanılan modelin sağlayıcısına gider; buna göre karar verin. Hook'lar fail-open'dır: hata durumunda boş çıktı verir, oturumu bozmaz.
