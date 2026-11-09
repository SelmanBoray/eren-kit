# eren-kit — öneriler

Durum: öneri listesi, 2026-11-09. Hiçbiri henüz uygulanmadı; her biri ayrı PR olarak ele alınabilir.

Kaynaklar:
- `packages/bellek/DESIGN.md` içinde açık kalan aşamalar (M2–M7).
- Kardeş proje **AURA Desktop**'ta (Tauri, yerel ikinci beyin) ölçülüp kanıtlanmış teknikler.
- macOS portu (#1) ve Opus Orkestra çekirdek modu / bağlam defteri (#3) sırasında görülenler.

İlke: önce ölçüm, sonra karar. "Çalışıyor" demek gerçek ortamda gözlemlemek demektir. Her önerinin yanında ne ile doğrulanacağı yazılıdır.

Etiketler:
- **Etki:** yüksek / orta / düşük
- **Maliyet:** S (gün), M (birkaç gün), L (hafta+)
- **⚠ doğrula:** dayandığı bir olgu henüz teyit edilmedi

## Özet tablo

| # | Öneri | Alan | Etki | Maliyet |
| --- | --- | --- | --- | --- |
| 1 | Otomatik hatırlama hook'u (sıkı kapılı, bütçeli) | bellek | yüksek | M |
| 2 | Hibrit arama: FTS5 + vektör → RRF, sqlite-vec | bellek | yüksek | M |
| 3 | Token/maliyet ölçümü: oturum dökümünden rapor | orkestra, devir | yüksek | S |
| 4 | Sahiplik haritasını hook ile zorlamak | orkestra | yüksek | M |
| 5 | Kod dosyaları için "önce harita" (sembol haritası) | kapi | yüksek | M |
| 6 | Defter → beyin konsolidasyonu (gece işi) | bellek, orkestra | orta | M |
| 7 | Yerel model şeridi (Ollama / MLX) | orkestra, bellek | orta | M |
| 8 | `eren doktor`: tek komutla sağlık denetimi | kurulum | orta | S |
| 9 | Gizlilik kapısı CI'da (kişisel yol/ad taraması) | repo | orta | S |
| 10 | Çift görüşe dış modeller (Codex, Gemini) | orkestra | orta | S |
| 11 | Bağımlılık-hash'li semantik önbellek | bellek | orta | M |
| 12 | Beyin yedekleme ve geri yükleme | bellek | orta | S |
| 13 | Proje kapsamlı hafıza (cwd → proje sinyali) | bellek | orta | S |
| 14 | `.erenignore` / `.gitignore` duyarlı indeksleme | bellek | düşük | S |
| 15 | Linux desteği (systemd user unit) | kurulum | düşük | S |
| 16 | Telefon: iOS/iPad sohbet istemcisi + macOS sunucu | phone | orta | L |
| 17 | Beyin web arayüzünden düzenleme | bellek | düşük | M |
| 18 | Uzaktan erişim bileşeni (Tailscale/LAN köprüsü) | kurulum | düşük | S |
| 19 | Sürüm ve dağıtım hijyeni | repo | düşük | S |

---

## 1. Otomatik hatırlama hook'u (DESIGN §8–9, M5)

- **Sorun:** Beyin MCP'si yalnızca model aradığında devreye giriyor. Model aramayı unutursa hafıza boşa durur.
- **Öneri:**
  - `UserPromptSubmit` hook'u istemi sorgu olarak kullanır, beyinden ilgili paragrafları getirir.
  - En fazla 2.500 karakteri `additionalContext` olarak ekler.
  - **Sıkı kapı:** eşiği geçen sonuç yoksa hiçbir şey eklenmez. Eşik, eval'deki negatif sorgularla (hafızada karşılığı olmayanlar) kalibre edilir.
  - Kısa ya da sentetik istemler atlanır.
  - Fail-open zinciri: servis → doğrudan FTS5 → boş çıktı.
- **Doğrulama:** M1 eval seti üzerinde hit@3, nDCG@5, yanlış ekleme oranı ve hook p95 ≤ 150 ms.

## 2. Hibrit arama: FTS5 + vektör → RRF (DESIGN §8.4–8.5)

AURA Desktop'ta ölçülmüş yaklaşım:
- **Gömme modeli:** e5 (Apple Silicon'da candle/Metal; Python tarafında sentence-transformers ya da MLX).
- **Vektör indeksi:** `sqlite-vec` vec0 ile KNN. Beyin zaten SQLite, ayrı bir vektör veritabanına gerek yok. Kırılırsa kaba kuvvet aramaya düşer.
- **Birleştirme:** BM25 ve vektör sıralamaları RRF ile birleştirilir.
- **Model yükleme:** tembel. Model önbellekte yoksa açılışta indirilmez; servis yalnız FTS5 ile çalışır.
- **Karar kuralı:** DESIGN §10'daki gibi; embedding ancak held-out'ta nDCG@5'i ≥ +5 puan artırıyorsa kalır.

## 3. Token ve maliyet ölçümü

- **Sorun:** Çekirdek mod ve bağlam defteri (#3) token tasarrufu iddia ediyor, ama eren-kit'te bunu ölçen bir araç yok.
- **Öneri:** `bellek olcum` (ya da `defter olcum`) Claude Code oturum dökümlerini (`~/.claude/projects/*/*.jsonl`) okur ve oturum başına şunları raporlar:
  - cache okuma ve yazma,
  - araç çıktısı payı,
  - tekrar okunan dosyalar,
  - alt agent dağılımı.
  - Devir hook'u bu dökümü zaten okuyor, ayrıştırıcı paylaşılabilir.
- **Doğrulama:** aynı görev çekirdek ve tam modda koşulur, iki ölçüm yan yana konur. Bu, #3'ün "Açık noktalar" kısmını kapatır.

## 4. Sahiplik haritasını hook ile zorlamak

- **Sorun:** Opus Orkestra'nın iki kuralı yalnızca modelin uymasına dayanıyor: "şef kod yazmaz" ve "agent kendi alanı dışına yazmaz".
- **Öneri:**
  - Şef dağıtımdan önce sahiplik haritasını `.git/orkestra/sahiplik.json` dosyasına yazar.
  - Bir `PreToolUse` hook'u Edit/Write çağrılarını bu haritaya göre denetler; alan dışı yazmayı nedeniyle reddeder.
  - Şefin kendi oturumunda Edit/Write tamamen reddedilir.
- **⚠ doğrula:** hook girdisinde çağrının ana oturumdan mı alt agent'tan mı geldiğini ayırt eden bir alan olup olmadığı (`agent_id` benzeri) Claude Code belgelerinden teyit edilmeli. Yoksa ayrım `transcript_path` üzerinden yapılabilir.

## 5. Kod dosyaları için "önce harita"

- **Fikir:** kapı şu an yalnızca büyük Markdown dosyalarına harita döndürüyor. Aynı fikir büyük kaynak dosyalara uygulanır.
- **Öneri:**
  - İlk tam okuma reddedilir ve yerine sembol haritası döner: sınıflar ve fonksiyonlar, satır aralıklarıyla.
  - Python için stdlib `ast` yeter.
  - Diğer diller için `ctags` varsa o kullanılır, yoksa basit regex.
  - Hedefli okumalar (≤ 80 satır) ve ikinci deneme her zaman geçer.
- **Doğrulama:** kapının kendi ölçüm günlüğüyle, okunan bayt önce/sonra.

## 6. Defter → beyin konsolidasyonu

- **Fikir:** Bağlam defteri kısa ömürlü proje bilgisi tutuyor, beyin kalıcı bilgi. Aralarında bir köprü yok.
- **Öneri:**
  - Gece çalışan bir iş: macOS'ta launchd, Windows'ta Görev Zamanlayıcı.
  - Defterdeki yeni kavram ve kararları özetleyip ilgili proje düğümüne **gelen kutusu önerisi** olarak yazar; beyne doğrudan yazmaz.
  - Kullanıcı web arayüzünden onaylar.
  - Özeti Haiku ya da yerel model (#7) üretir.

## 7. Yerel model şeridi (AURA Desktop "Lane 0")

- **Öneri:**
  - Ollama ya da MLX ile yerel bir model; varsayılan kapalı, ayarla açılır.
  - İşi yalnızca ucuz görevler: özetleme, sınıflandırma, defter sıkıştırma (#3'te deneysel olarak var), hatırlama kapısında "bu istem hafıza gerektiriyor mu" ön elemesi.
  - İptal edilebilir, zaman aşımlı ve fail-open.
- **Doğrulama:** aynı özetleme görevinde Haiku ile kalite karşılaştırması ve gecikme.

## 8. `eren doktor`

Tek komut tüm bileşenlerin durumunu denetler ve `--json` çıktısı verir (AURA'daki `doctor --json` gibi):
- hook'lar `settings.json`'da ve dosyaları var mı;
- hook yorumlayıcısının sürümü;
- MCP kaydı ve bağlantısı;
- servisin sağlığı (`/api/saglik`) ve servis görevi (launchd / Görev Zamanlayıcı);
- veri klasörünün boyutu;
- devir ve kapı günlüklerinde son hata.

Kurulum betikleri sonunda bunu çalıştırır.

## 9. Gizlilik kapısı CI'da

AURA Desktop'taki `soul_check` gibi:
- Bir CI adımı depoda kişisel mutlak yol, kullanıcı adı, e-posta, token biçimli dizi ve büyük ikili dosya arar.
- İzin listesi (örnek veri, noreply adresleri) dosyada tutulur.
- Bu, şu an elle uygulanan "kişisel veri repoya girmez" kuralını mekanik hale getirir.

## 10. Çift görüşe dış modeller

- **Şu an:** Opus Orkestra'nın çift görüşü iki Claude modelini kullanıyor (opus + fable).
- **Öneri:** isteğe bağlı üçüncü görüş olarak `codex exec -s read-only` ve Antigravity CLI (`agy -p`). AURA Desktop'taki Consensus modunun karşılığı; varsayılan kapalı.
- **⚠ doğrula:** dış CLI'lar oturum ya da model kısıtıyla düşebilir (ör. Codex ChatGPT hesabında `model_not_found` verdi). Düşünce sessizce iki görüşle devam etmeli ve bunu raporlamalı.

## 11. Bağımlılık-hash'li semantik önbellek (AURA Desktop'ta ölçüldü)

- **Öneri:**
  - Beyin aramalarında ve hatırlama hook'unda (#1) sorgu sonucu önbelleğe alınır.
  - Önbellek anahtarı sorgu vektörüdür (cosine ≥ eşik). Buna ek olarak, sonucu oluşturan düğümlerin içerik hash'i yeniden doğrulanır.
  - Bir düğüm değişir ya da silinirse ona bağlı önbellek kaydı düşer. AURA'daki kritik hata dersi: silmede CASCADE, bayat cevabı "geçerli" bırakıyordu.
- **Eşik:** varsayılan kapalı. Eşik eval ile seçilir; AURA'da yanlış pozitif 0 hedefiyle ölçüldü.

## 12. Beyin yedekleme ve geri yükleme

- `beyin yedekle`: `disa-aktar --bicim jsonl` ve SQLite `.backup` ile, zaman damgalı.
- Kurulumda isteğe bağlı günlük yedek görevi açılabilir.
- Geri yükleme için `ice-al` zaten idempotent.
- Uzak yedek (DESIGN §16.5) şifreli olmalı.

## 13. Proje kapsamlı hafıza (DESIGN §8.5)

- Hook payload'undaki `cwd` bir proje düğümüne eşlenir; o projenin düğümleri aramada artı puan alır.
- Eşleme `bellek.toml`'daki `[projects]` bölümünden okunur, yoksa repo kök adından türetilir.

## 14. `.erenignore` / `.gitignore` duyarlı indeksleme

M2 not/vault indeksi geldiğinde `.gitignore` ve ayrı bir `.erenignore` dosyasına uyulur (AURA'daki `.auraignore`). Böylece `.venv`, `node_modules`, gizli klasörler indekse girmez.

## 15. Linux desteği

- Yollar zaten hazır: `bellek.platform_dirs`, XDG.
- `install.sh` Linux'ta servis için `systemd --user` birimi yazar (`~/.config/systemd/user/eren-kit-beyin.service`).
- CI'a `ubuntu-latest` işi eklenir.

## 16. Telefon: iOS/iPad ve macOS sunucu

- `apps/phone/app` Expo, yani iOS derlemesi teknik olarak açık. MIMARI.md'deki plan iPad için yalnızca sohbetti.
- Sunucu tarafında macOS için gerekenler:
  - yol çözümü: `veri-koku.ts`, `ayar.ts`;
  - `claude` araması: `.exe` yerine PATH;
  - adlandırılmış boru yerine Unix soketi;
  - Görev Zamanlayıcı yerine launchd.
- #1'de bunun ilk sürümü yazılmıştı. Telefon kodu hızla değiştiği için geri çekildi; sunucu oturunca ayrı bir PR olarak gelmeli.

## 17. Beyin web arayüzünden düzenleme

- **Şu an:** web arayüzü okuma ve gelen kutusu kararları içindir.
- **Öneri:** düğüm özetini düzeltme ve bir olguyu eskitme (`duzelt` ucu zaten var) arayüze eklenir. Böylece telefondan da hafıza temizlenebilir.

## 18. Uzaktan erişim bileşeni

- **Şu an:** iPhone'dan erişim için Tailscale serve ya da elle kurulan bir LAN köprüsü gerekiyor.
- **Öneri:** `install.sh --components uzak` (ve PowerShell karşılığı). Yalnızca izinli istemci IP'lerine açık, servis plist'ine izinli Host'u yazan, kaldırılabilir bir köprü.
- HTTPS için Tailscale sertifikası kullanılır.

## 19. Sürüm ve dağıtım hijyeni

- İkili dosyalar repoya girmez; GitHub Releases ile dağıtılır.
- Rust/derlenmiş bileşenler `--remap-path-prefix` ile derlenir (kullanıcı adı sızmasın). `strings` ile doğrulanır.
- `CHANGELOG` her PR'da güncellenir.
- Sürüm etiketleri gizlilik temizliğinden sonra yeniden yazılır: eski etiketler eski nesneleri tutar (AURA'da yaşandı).
