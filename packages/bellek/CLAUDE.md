# Bellek: bu pakette çalışan AI ajanları için geliştirici rehberi

Bellek: Claude Code için yerel, oturumlar arası hafıza bileşeni (not/arama hattı, beyin bilgi grafı, oturum devri). Kullanıcıdan "kullanıcı" diye söz edilir; kişisel ad, makine adı ve mutlak kişisel yol kod, belge ve testlere yazılmaz.

## 1. Önce oku
- `DESIGN.md` paketin tasarım sözleşmesidir; durum ve aşamalar orada.
- Ona aykırı değişiklik yapma. Gerekirse önce DESIGN.md'nin güncellenmesini öner, sonra kodla.
- Göreve başlamadan DESIGN.md'deki güncel aşamayı ve açık kararları kontrol et.
- Kullanıcıya dönük kurulum ve yapılandırma bilgisi `README.md`'dedir.

## 2. Ortam
- venv: paket klasöründe `.venv` (Python 3.12+).
- Testler: `.venv\Scripts\python -m pytest`
  - `tests/conftest.py` her testi kullanıcı verisinden yalıtır (veri kökü ve `BELLEK_*` yolları geçici klasöre yönlenir); yeni test gerçek vault, beyin.db ya da devir klasörüne giden bir varsayılan yola dayanmamalı.
- CLI: `.venv\Scripts\bellek doktor`
- Beyin yedeği: `.venv\Scripts\python -m bellek.beyin yedekle | yedekler | geri-yukle`.
- Ayar: `bellek.toml` (veya `BELLEK_CONFIG` ortam değişkeni). Şablon: `bellek.example.toml`. `bellek.toml` kişiye özeldir, git'te yok sayılır.
- Paket düzenlenebilir kurulumla kullanılır: `pip install -e ".[dev]"`.
  - Varsayılan ayar yolu paket kökündeki `bellek.toml`'a göre bulunur; normal (editable olmayan) kurulum desteklenmez.
- Eval komutları:
  - `.venv\Scripts\python -m eval.corpus snapshot|verify --version V`
  - `.venv\Scripts\python -m eval.queries extract [--stats-only]`
  - Kurallar `eval/PROTOCOL.md`'de; `eval/data/` kişisel veridir, git dışıdır.
  - Gerçek veriyle çıkarma/dondurma yalnız kullanıcının açık talimatıyla yapılır.
- Beyin MCP: `python -m bellek.beyin mcp`. Devir hook'u: `python -I -S src/bellek/devir/hook.py`. Devir skill'i: `skills/devir/SKILL.md`.
- Kökteki `install.ps1` kurulumu yapar; bu paketi etkileyen yol/ayar değişikliklerinde kurulum betiği ve kök README ile tutarlılık gözetilir.

## 3. Kod kuralları
- Çekirdek (`src/bellek/`) yalnız standart kütüphane kullanır.
- Yeni bağımlılık DESIGN.md kararı gerektirir.
- Ağır bağımlılıklar (embedding vb.) yalnız servis tarafında ve yalnız opsiyonel `embed` extra'sında.
- İstemci tarafı kod (hook'lar, ikinci istemci eklentileri): yalnız standart kütüphane, Python 3.14 ile de uyumlu.
- Hook'lar fail-open: hata veya zaman aşımında boş çıktı verir, oturumu asla bozmaz.
- Kod tanımlayıcıları İngilizce ve tip ipuçlu olur (beyin alt sistemi bilinçli sapmadır: tanımlayıcıları Türkçe, bkz. DESIGN.md §12 ve §16.6).
- Kullanıcıya görünen mesajlar Türkçe, doğru karakterlerle (ç ğ ı ö ş ü).
- Dosyalar UTF-8; Windows konsolunda Türkçe çıktı bozulmamalı (stdout/stderr kodlamasını açıkça ayarla).
- Her davranış değişikliğine test yaz.
- Hata düzeltmede önce başarısız olan regresyon testini ekle.

## 4. Veri kuralları (kesin)
- Salt-okunur kaynaklara (`bellek.toml`'daki `[[source]]` yolları, ör. Claude Code auto-memory klasörleri `~/.claude/projects/*/memory`) Bellek kodu ASLA yazmaz.
- Başka bir aracın dosyalarına (ör. ikinci bir ajanın kimlik/ayar dosyaları) kullanıcının açık onayı olmadan dokunulmaz. Dokunmadan önce içine bak ve yedekle.
- `vault/` ve `eval/data/` git'e girmez (kişisel veri).
- Testler gerçek vault'u ve gerçek beyin veritabanını değil `tmp_path` ve geçici `BELLEK_*` değişkenlerini kullanır.
- `private: true` notlar hiçbir otomatik bağlama girmez.
- Durum (indeks, loglar) `%LOCALAPPDATA%\Bellek\` altında (ya da `state_dir`) tutulur; vault'a ya da bulut senkron klasörüne konmaz.
- Sır içeren metin hiçbir indekse, nota, logda ya da çıktıda yer almaz (DESIGN.md §11).

## 5. Ölçüm kuralları
- Arama ve bağlam kararları eval ile verilir; "çalışıyor" demek yetmez, sayı göster.
- Held-out bölümü yalnız karar için açılır; ayar dev bölümünde yapılır.
- GT değişikliği yeni sürüm dosyasıyla yapılır; eski set dondurulmuş kalır.
- İki GT sürümü yan yana raporlanır (korpus büyümesi sahte regresyon üretir).
- Bir değişikliğin etkisini önce/sonra aynı sette ölçerek göster.

## 6. Git
- Commit yalnız kullanıcı isteyince atılır.
- Paralel çalışan agent'lar git komutu çalıştırmaz.
- `vault/` ve `eval/data/` içeriğini asla stage'leme.
