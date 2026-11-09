# Bellek — Eval Protokolü v1

Durum: M1 taslağı, 2026-10-24. Üst sözleşme `DESIGN.md` §10; bu belge onu uygulanabilir ayrıntıya indirir. 2026-10-24 itibarıyla
DESIGN.md ile fark yoktur (§12 sonu). Etiketler DESIGN ile aynı:
*ölçüldü*, *tahmin*, *bilinmiyor*, *açık (Mx)*. Bu dosya repoya girer: içinde gerçek prompt ya da not içeriği **yoktur**; örnekler uydurmadır.

## 1. Amaç, kapsam, sürümleme, gizlilik

**Amaç.** Kullanıcının gerçek prompt'larıyla üç soruyu sayıyla cevaplamak: (1) *sıralama* — sistem gereken notu ilk sıralarda getiriyor mu;
(2) *enjeksiyon* — bütçe içinde ajana giden metne o notun içeriği giriyor mu, karşılığı olmayan prompt'ta susuyor mu; (3) *maliyet* — bunu
mevcut düzene (S0) göre kaç karakter ve milisaniyeyle yapıyor. **Kapsam dışı:** ajanın nihai cevap kalitesi (M7'de gözlenir); paragraf GT'si (§4).

**Sürüm v1** = korpus v1 (2026-10-24 anlık görüntüsü) + sorgu seti v1 (history.jsonl, 2026-03-27 → 2026-10-24) + bölme v1 +
rubrik r1 (pilotta en çok r3) + GT v1. Bir bileşen değişirse §12 geçerli. **Akış (sıra bağlayıcı):** (1) korpusu dondur, doğrula →
(2) sorguları çıkar → (3) bölmeyi dondur (digest) → (4) pilot, rubrik kesinleşir → (5) iki jüri tam etiketler → (6) hakem → (7) değerlendirici
kontrolü → (8) GT donar (digest) → (9) ölçüm (M3+). Gerekçe: bölme GT'den önce donar; etiketleme bölmeyi, bölme de rubrik ayarını
etkileyemez (pilot yalnız dev'den).

**Gizlilik.**
- Prompt'lar, not kopyaları, jüri çıktıları ve GT yalnız `eval/data/` altında (gitignored). Manifest'ler (`eval/manifests/`: digest, sayı,
  seed, sorgu id'leri) yerelde üretilir, repoya girmez (`.gitignore`'da yok sayılır); repoya yalnız sayısal raporlar girer. Not yolu da kişisel bilgi taşır; manifest'e yol değil yalnız toplam digest yazılır.
- Jüri ve hakem agent'ları prompt'ları ve notları okur (kullanıcı onayı: DESIGN §10); metinler Anthropic'e gider ama prompt'lar yazıldıkları anda,
  notlar auto-memory yoluyla zaten gidiyordu, yeni alıcı yok. Eval verisi başka sağlayıcıya gönderilmez.
- Değerlendirici kontrolü yerel dosyayla yapılır (artifact, Claude Docs, web **yok**). Prompt metni gereken hata analizleri `eval/data/reports/`
  altına; `eval/reports/` yalnız sayı ve `qid` taşır.

## 2. Korpus v1

| Kaynak | Yol | Not sayısı |
|---|---|---|
| ana auto-memory | `~/.claude/projects/C--/memory` | 46 `.md`, MEMORY.md dahil (*ölçüldü*) |
| proje auto-memory'leri (11 klasör) | `~/.claude/projects/<slug>/memory` | 56 `.md`, kökteki 11 MEMORY.md dahil (*ölçüldü*) |
| asistan | `~/.claude/asistan` | 1 |
| vault | `<vault yolu>` | BELLEK.md + klasör README'leri |

- Ham sayılar kökteki MEMORY.md'leri (12) içerir; korpus notu sayılmazlar. Kesin not sayısı ve boyut snapshot manifest'inden okunur
  (burada yazılmaz); büyüklük mertebesi ~90 not: not düzeyinde **tam** (havuzlamasız) etiketleme yapılabilir. Yalnız `.md`, alt klasörler dahil.
- **Hariç:** kaynak kökündeki `MEMORY.md` (işaretçi listesi; GT birimi olsa her notun özeti ikinci kez sayılırdı), adı `.` ile başlayan
  dosya/klasör, `.md` dışı her şey, boş ya da yalnız boşluk içeren dosya, boş klasör (kodda uygulanır). S0 için kökteki `MEMORY.md`'ler
  korpus dışında, **aynı anda** `eval/data/corpus/v1/index/<kaynak>/MEMORY.md` altında dondurulur; manifest'te `index_files`, `verify` bunları da denetler. GT birimi değildirler.
- Vault README'leri dahil: indekslenip indekslenmeyecekleri açık (DESIGN §13, M2). Gerçekçi dikkat dağıtıcıdırlar; indekslenmezlerse
  sistemler zaten döndürmez; GT'de ≥ 1 almaları beklenmez (*tahmin*).
- `note_id` = `<kaynak>/<göreli yol>` (ileri eğik çizgi) = `eval/data/corpus/v1/files/<note_id>`. Frontmatter `name` kimlik değildir.
- `private: true`, `status: archived` ya da `supersedes` ile düşen not: etiketlenir ama skorlamada beklenmez (ideal sıralamadan çıkar);
  sistem onu eklerse **kapı ihlali** sayılır, hedef 0. v1'de böyle not sayısı *bilinmiyor*.

**Dondurma.** `python -m eval.corpus snapshot --version v1`, ardından `python -m eval.corpus verify --version v1` temiz çıkmalı.
`manifest.json` dosya başına sha256 taşır; manifest'in kendi sha256'sı `eval/manifests/v1.json`'a `corpus_digest` olarak yazılır.
Her ölçüm koşusu önce verify çalıştırır; uyuşmazlıkta durur. Sistemler canlı kaynakları değil **snapshot'ı** indeksler (eval'e özel
ayar ve state klasörüyle; uygulama *açık, M2/M3*). Gerekçe: canlı hafıza her gün büyür; GT snapshot'a bağlıdır (önceki ölçüm dersleri).

## 3. Sorgu seti v1

`python -m eval.queries extract` → `eval/data/queries-v1.jsonl` (alanlar: `id` q001…, `text`, `project`, `stratum`,
`kind` normal|short, `timestamp`, `session_id`).

**Filtreler (sırayla):** (1) `/` slash ve `!` kabuk komutları çıkar — arama niyeti taşımazlar; (2) `[Pasted` / `[Image` içerenler
çıkar — asıl içerik yer tutucunun arkasında; (3) boş satırlar çıkar; (4) tekilleştirme: anahtar = casefold + boşluk sıkıştırma + baş/son boşluk
kırpma (kodda böyle; noktalama kırpma ve Türkçe'ye özgü küçük harf yok); farklı cwd'lerde aynı metin tek sorgudur, aynı metnin örneklerinden
**en yeni** (timestamp en büyük) olan ve onun cwd'si kalır — birebir tekrar %19,9 (*ölçüldü*). Gerekçe: karşı-olgusal okuma "bugün"dür (§4);
en yeni örnek dondurulmuş hafızaya zamanca en yakın olandır; RNG gerektirmez; (5) ≤ 3 kelime → `kind: short`, diğerleri `normal`.

**Tabakalar ve kota** (normal 170 + short 30 = 200):

| Tabaka | Proje yolu | Ham satır (*ölçüldü*) | Normal kota |
|---|---|---|---|
| root | `C:\` | 692 | 50 |
| proje_a | `C:\proje_a`, `C:\proje_a_asama2\proje_a`, `C:\proje_a_asama2\proje_a_proto` | 383 | 30 |
| proje_b | `C:\Proje_B` | 202 | 20 |
| proje_c | `C:\PROJE_C` | 150 | 20 |
| n8n | `C:\n8n` | 137 | 20 |
| proje_d | `C:\Proje_D` | 45 | 15 |
| odev | `C:\ödev`, `C:\prog1odev`, `C:\analiz`, `C:\unity ödev`, `C:\java\...`, `C:\prog` | 14–24'er | 10 |
| other | kalan proje yolları | kalan | 5 |

Gerekçe: kotalar kabaca hacimle orantılı ama root daraltıldı (ham %39 → kota %29), küçük projelere taban verildi. Root prompt'ları çok
konulu; ana MEMORY.md'nin kolay kazanımı setin tamamını domine etmesin, cwd → proje sinyali ölçülebilsin.

**Kısa sorgular (30):** tabakadan bağımsız, uygun kısa havuzdan seed'li düz rastgele (`random.Random(seed)`). Prompt'ların %29,9'u ≤ 3 kelime (*ölçüldü*);
kapının bunlarda susması ölçülmeli. DESIGN §10'daki "negatiflerin bilinçli eklenmesi" budur ve seçim içeriğe bakmadan yapılır. Yine de
tam etiketlenirler: "proje b ne durumda" gibi kısa ama konulu olanlar pozitif çıkabilir.
**Seed** `20261024`; ayrı RNG örnekleri: çıkarma `random.Random(seed)` (tuzsuz), bölme `random.Random(f"{seed}-split")`, pilot
`random.Random(f"{seed}-pilot-1")`, hakem sıralaması `random.Random(f"{seed}-adjudicate")`. Seed ve araç sürümü manifest'te.

**Kota açığı:** tabakanın uygun havuzu kotasından azsa kod açığı başka tabakaya **aktarmaz**; tabakanın tamamını alır, açığı `shortfall`
olarak raporlar. Açık oluşursa manifest'e `quota_shortfall` yazılır ve raporda görünür; aktarım yapılmaz, elle seçim yapılmaz (seçim içerik
görülerek yapılmış olurdu), sentetik sorgu eklenmez. v1'de açık oluşmadı (*ölçüldü*): tabaka başına uygun normal sorgu root 431,
proje_a 286, proje_b 149, proje_c 96, n8n 80, proje_d 18, odev 71, other 9; kısa 248; tekilleştirme sonrası normal+kısa 1.388;
toplam satır 1.787. Kısa havuz 30'dan azsa hepsi alınır. `eval.queries` bu bölümden saparsa sapma tarih ve gerekçeyle buraya yazılır.

## 4. Sorgu ve GT birimi

- **Sorgu** = (`text`, `project` = cwd). Hook'un gördüğü de budur: UserPromptSubmit payload'ında `prompt` + `cwd` (DESIGN §7). Önceki
  mesajlar, tarih ve `session_id` sorgunun parçası **değildir**; jüri bunları görmez, history.jsonl'u okumaz. Gerekçe: GT sistemin
  erişebileceği bilgiyle tanımlanmalı; "evet"in neye evet olduğunu hiçbir arama sistemi bilemez.
- **Karşı-olgusal okuma:** "Bu prompt bugün, bu cwd'de, dondurulmuş v1 hafızasıyla yazılsaydı." Prompt'tan sonra yazılmış (hatta o
  prompt'un sonucu olan) notlar da içeriklerine göre etiketlenir. Yan etki: bu notlar prompt'la aynı kelimeleri paylaşır, sözcüksel
  aramayı kayırabilir (*tahmin*); ölçümü (sorgu tarihi × notun ilk görülme tarihi) *açık, M3*, not tarihlerinin güvenilirliği *bilinmiyor*.
- **GT birimi NOT.** Paragraf döndüren sistemde her parça notuna eşlenir; notun sırası = ilk parçasının sırası; sonraki parçaları atlanır.
  Gerekçe: ~90 not × 200 sorgu tam etiketlenebilir; paragraf sınırları M2'de belirlenecek, bugün etiketlenemez. **Paragraf GT** gerekirse
  M3'te türetilir: GT ≥ 1 çiftlerde jüri, M2 parça kimlikleriyle gereken parçayı işaretler; ayrı sürüm `gt/v1-para/` (*açık, M3*).

## 5. İlgililik rubriği (r1)

| Etiket | Ad | Tanım |
|---|---|---|
| 2 | gerekli | Ajanın bu prompt'a bu projede doğru yanıt vermesi ya da doğru işi yapması için notun içeriğindeki bir bilgi **gerekli**: not olmadan ajan yanlış yapar, eksik yapar ya da kullanıcıya zaten söylenmiş bir şeyi yeniden sorar. |
| 1 | yararlı | Not doğru konudadır, işe yarar arka plan verir (proje bağlamı, ilgili geçmiş karar) ama ajan onsuz da işi doğru yapabilir. |
| 0 | ilgisiz | Konu farklı ya da yalnız kelime benzerliği var. |

**Test sorusu** (her aday için): "Bu not bağlama girse ajanın cevabı ya da yaptığı iş değişir mi?" Değişir ve doğruya gider → 2;
daha iyi yönlenir ama sonuç aynı → 1; değişmez → 0.

- **R1** Etiket içeriğe göre verilir; ad ve açıklama yalnız aday bulmak içindir. ≥ 1 verilen her not baştan sona okunmuş olmalı.
- **R2 İçeriksiz devam** ("evet", "devam", "tamam yap", "olur", "hepsini düzelt"): bilgi ihtiyacı prompt'ta değil oturumda → tüm notlar
  0, `contentless: true`. Proje kartı da 0: kart SessionStart diliminin işidir (DESIGN §9), prompt hook'unun değil. Kısa ama konu adı
  taşıyan prompt içeriklidir, normal etiketlenir.
- **R3 cwd projesinin genel kartı** (projenin ana durum notu): **2** prompt kartta yazan bir bilgiyi (durum, karar, sıradaki iş, yol,
  sürüm) istiyorsa ya da iş o bilgi olmadan yanlış yapılırsa; **1** prompt o projede içerikli bir işse ve kart yalnız yön veriyorsa;
  **0** R2 durumunda ya da prompt projeyle ilgisizse (proje klasöründen genel bir Python sorusu). `C:\` (root) proje değildir; root
  sorgularında hiçbir kart cwd yüzünden puan almaz.
- **R4 Kural ve feedback notları:** her zaman geçerli genel kurallar başka katmanla yüklenir (CLAUDE.md, SessionStart). **2** yalnız
  prompt kuralın kendisine dokunuyorsa (soruyor, değiştiriyor, çiğnemeye çağırıyor); **1** kural o projeye ya da görev türüne özgüyse ve
  prompt tam o görevse; sıradan iş isteğinde genel kural **0**. Gerekçe: yoksa tek bir kural notu kod içeren her prompt'ta ≥ 1 alır,
  GT'yi tek nota boğar ve ayrım gücü kalmaz.
- **R5 Çok notlu ilgililik:** her not bağımsız etiketlenir; 2 sayısına sınır yok. Aynı gerekli bilgi iki notta varsa ikisi de 2
  (hangisi gelse yeter; hit bunu doğru sayar, nDCG ideali ikisini de içerir — bilinen bedel).
- **R6 Kimlik ve kişi notları** (`asistan`, `type: user`): prompt kişiyi, ilişkiyi ya da kimliği konu ediyorsa ≥ 1; selamlaşma ve genel
  sohbette 0 (kimlik CLAUDE.md / SessionStart katmanında). **R7 Belirsiz gönderme** ("onu yap"): konu yoksa R2, varsa yalnız o konuya göre.
- **R8 Eskimiş bilgi:** aşılmış bilgi taşıyan not prompt'a hâlâ cevapsa etiketlenir, gerekçeye "güncel olmayabilir" yazılır (ilgililik, doğruluk değil).

**Negatif sorgu:** final GT'de hiçbir not ≥ 1 almamış sorgu. İki alt tür ayrı raporlanır: `contentless` (R2) ve **içerikli negatif**
(konu var, hafızada karşılığı yok). Gerekçe: kapı (DESIGN §8.6) asıl ikincide zorlanır; birinciler kolaydır ve oranı şişirir.

**Sınır örnekleri** (uydurma; A ve B birer proje):

| Prompt (cwd) | Not | Etiket | Neden |
|---|---|---|---|
| "mağaza başvurusunda neredeydik" (A) | A'nın durum kartı | 2 | Durum ve sıradaki iş kartta (R3) |
| "giriş ekranında taşma var, düzelt" (A) | A'nın durum kartı / A'nın arayüz kuralları notu | 1 / 2 | Kart yön verir; düzeltme kurallara uymalı |
| "python'da sözlük nasıl sıralanır" (A) | A'nın durum kartı | 0 | İçerikli negatif |
| "devam" (A) | hepsi | 0 | R2 |
| "agent'lara dağıtmadan kendin yaz" (root) / "README'yi güncelle" (B) | orkestra kural notu | 2 / 0 | Kuralın kendisi / genel kural başka katmanda (R4) |
| "geçen ay o başvuru için ne demiştik" (root) | başvuru notu | 2 | Cevap notta |
| "oyunun yeni sürümünü de incele" (root) | oyunun eski RE notu | 2 ya da 1 | Eski bulgular kullanılacaksa 2, yalnız bağlamsa 1 |

Rubrik değişiklikleri yalnız §6 pilot kuralı ya da §7 sistematik hata bulgusuyla yapılır; belge sonundaki günlüğe yazılır.

## 6. Jüri prosedürü

**Roller:** Jüri A ve B (iki bağımsız Opus agent), Hakem H (üçüncü Opus agent), şef (Fable: dağıtır, doğrular, birleştirir; etiket vermez).

**Girdi:** rubrik (o anki sürüm); not listesi (her not için `note_id`, `name`, `description` — yoksa ilk başlık + ilk 150 karakter —,
`type`, kaynak, karakter sayısı; snapshot'tan `python -m eval.notelist` ile üretilir → `eval/data/corpus/v1/notes.jsonl` + `notes.md`); batch
dosyası (`qid`, `text`, `project`; tarih ve oturum yok). Okuma izni yalnız
`eval/data/corpus/v1/files/` (canlı `~/.claude` **değil**) ve kendi batch'i; öteki jürinin ve hakemin dosyalarını görmez. Gönderilen tam
jüri prompt'u `eval/data/gt/v1/prompts/` altında saklanır. **Yöntem** (her sorgu): listeyi tara, aday çıkar → cwd projesinin notlarını
ve her adayı tam oku → rubriğe göre etiketle → ≥ 1 her etiket için tek cümle gerekçe (hangi bilgi, neden gerekli/yararlı).

**Batch:** 20 sorgu, mümkünse aynı tabakadan (o projenin notları bir kez okunur); küçük tabakalar birleşir. 200 sorgu → 10 batch × 2 jüri
= 20 koşu (+ pilot). Araç: `python -m eval.batches main` → `eval/data/gt/v1/batches/`. Jüri B batch'leri ters sırada alır (sıra etkisi). Gerekçe: 20, notları tam okuyan dikkatli yargının tek bağlamda
tutulabileceği iş (*tahmin*); pilotta görülene göre değişirse günlüğe yazılır.

**Çıktı** `eval/data/gt/v1/juror-a.jsonl`, `juror-b.jsonl`; sorgu başına bir satır:

```json
{"qid": "q001", "juror": "a", "model": "<model id>", "rubric": "r1", "batch": 3, "contentless": false,
 "labels": [{"note": "<kaynak>/<yol>.md", "grade": 2, "why": "tek cümle"}], "read": ["<kaynak>/<yol>.md"], "comment": ""}
```

`labels` yalnız ≥ 1 taşır; listelenmeyen not 0'dır. `read` denetim izidir: ≥ 1 verilen not `read`'de yoksa satır geçersiz, sorgu yeniden
koşulur (R1). Şef her dosyayı şema, `qid` (200 satır, setle birebir) ve `note_id` (snapshot'ta var) için doğrular.

**Uyum** (hakemden önce, A ve B ham etiketleriyle; `python -m eval.agreement`, çıkış 0 = eşik geçti, 3 = geçmedi, 1 = doğrulama hatası):

| Ölçü | Tanım | Neden |
|---|---|---|
| Ağırlıklı Cohen κ_w | Tüm (sorgu × not) çiftleri; doğrusal ağırlık w_ij = 1 − \|i − j\| / 2; κ_w = (p_o − p_e) / (1 − p_e), p_o = Σ w_ij·o_ij, p_e = Σ w_ij·a_i·b_j (o gözlenen oran; a, b jüri marjinalleri) | Rubriğin tekrarlanabilirliği |
| Ham uyum | Aynı etiket oranı: tüm çiftlerde **ve** "en az bir jüri ≥ 1" çiftlerinde | ~18.000 çiftin çoğu 0-0; ilki şişer, ikincisi gerçeği gösterir |
| Pozitif özgül uyum (PSA) | 2·\|A≥1 ∩ B≥1\| / (\|A≥1\| + \|B≥1\|) | Yaygınlıktan etkilenmez |
| Negatiflik κ | Sorgu düzeyinde "negatif mi" ikilisi için Cohen κ | Kapı kalibrasyonu buna dayanır |

**Kabul eşiği** (başlangıç değeri, pilottan önce sabit): κ_w ≥ 0,60 **ve** negatiflik κ ≥ 0,60 (Landis–Koch "önemli" alt sınırı).

**Pilot ve rubrik revizyonu:**
1. Dev'den tabakalı 20 sorgu (pilot-1; `python -m eval.batches pilot` → `eval/data/gt/v1/pilot-1/`, `random.Random(f"{seed}-pilot-1")`); A ve B r1 ile etiketler. Eşik geçilirse rubrik kesinleşir. Pilot etiketleri GT'ye girmez (rubriği
   yazan onları gördü); bu sorgular ana koşuda yeni agent'larca yeniden etiketlenir.
2. Geçilmezse şef anlaşmazlıkları kurala göre sınıflar, rubriği düzeltir → r2, günlüğe yazar; **yeni** 20 dev sorgusuyla (pilot-2) ve yeni
   agent'larla yeniden dener (aynı 20'de denemek rubriği o sorgulara uydurur). En çok r3; o da geçmezse ana koşu yapılır, GT "düşük uyum"
   diye işaretlenir, durum değerlendiriciye sunulur. Ana koşuda eşik tutmazsa rubrik değişmez (GT'yi sonuca uydurma riski); düşük κ raporlanır.

**Hakemlik:** A ile B'nin farklı etiketlediği her çift H'ye gider. H sorguyu, notun tamamını, iki etiketi ve iki gerekçeyi görür (jüri
kimliği gizli, sıra rastgele: `random.Random(f"{seed}-adjudicate")`), 0/1/2'den birini gerekçeyle verir; ikisinden biri olmak zorunda değil. Araç: `python -m eval.adjudicate prepare` (hakem batch'leri `adj-NN.jsonl`, öğede jüri kimliği yok) ve `merge` (→ `qrels.jsonl`, `gt-queries.jsonl`). Batch 40 çift; ayrışan `contentless`
kararını da H verir. Çıktı `adjudication.jsonl`:
`{"qid": "q001", "note": "<kaynak>/<yol>.md", "grades": [0, 2], "final": 1, "why": "tek cümle", "model": "<model id>"}`.
H'nin A'ya / B'ye / üçüncü değere gitme oranı raporlanır (sistematik jüri sapması). Final GT taslağı = uyuşan çiftler + hakem kararları
(+ değerlendirici, §7). **Bilinen sınır:** iki jüri aynı model; hataları ilişkili olabilir, κ abartabilir. Bağımsız ölçü değerlendirici kontrolüdür (§7).

## 7. Değerlendirici örneklem kontrolü

**Örneklem: 30 sorgu.** 20 **rastgele** (tabakalı, bölme oranında 12 dev + 8 held-out, seed'li) GT doğruluğunun tarafsız tahminidir.
10 **hedefli** (hakemin müdahale ettiği, jürilerin negatiflikte ayrıştığı, tek pozitif notu 1 olan sınır sorgular) düzeltme içindir,
uyum tahminine girmez. Held-out'tan örnek almak held-out'u açmak değildir: sistem sonucu görülmez, yalnız GT doğrulanır.

**Sunum:** yerel dosya `eval/data/gt/v1/degerlendirici-kontrol.md` (artifact ve web yok). (1) **Kör tur** (20 rastgele): prompt + cwd ve not
listesi (ad + açıklama); değerlendirici gerekli (2) ve yararlı (1) notları işaretler, GT'yi görmez. (2) **Açık tur:** aynı dosyanın ikinci
bölümünde GT etiketleri ve gerekçeleri; her farka "GT doğru / ben haklıyım / ikisi de olur" yazılır; hedefli 10 doğrudan burada.
Tahmini süre 45–60 dk (*tahmin*); uzun gelirse kör tur 15'e iner ve rapor bunu yazar. **Uyum raporu:** kör turdaki değerlendirici etiketleri ×
final GT; κ_w, PSA, negatiflik uyumu (§6 tanımları); n = 20 olduğundan "kaba tahmin" diye yazılır.

**Düzeltmenin GT'ye girişi:**
- GT donmadan önce (M1 içinde): "ben haklıyım" denen çiftler `degerlendirici.jsonl`'a (eski, yeni, gerekçe) yazılır, final GT'de değerlendiricinin
  etiketini alır (`source: "degerlendirici"`). Değerlendirici otoritedir.
- Aynı türden hata ≥ 3 kez görülürse (kural düzeyinde hata) yalnız bakılan sorgular düzeltilmez, GT tutarsızlaşırdı: rubrik bir sürüm
  artar, kuralın etkilediği çiftler tüm sette jürilerce yeniden yargılanır. GT donduktan sonra her düzeltme **yeni sürümdür** (§12).
- Kabul: kör tur PSA ≥ 0,70 ve sistematik hata yok → GT v1 donar. Altındaysa neden yazılır, kararı değerlendirici verir (eşik başlangıç değeri).

## 8. Dev / held-out bölme

- **Oran 60/40:** 200 → dev 120, held-out 80. Gerekçe: dev'de 3 BM25 varyantı, 3 embedding, RRF `k` ve kapı eşiği ayarlanacak, dev küçük
  olmamalı; 80 karar için alt sınır (§11: daha azıyla +5 puan hiç ayırt edilemez).
- **Tabakalı:** hücre = (`stratum`, `kind`); hücrede held-out = round(0,4 × n), toplam 80'e en büyük kalan yöntemiyle tamamlanır; hücre
  içinde seed'li karıştırma (`random.Random("20261024-split")`). Araç: `python -m eval.split` → `eval/manifests/v1.json`. Negatiflik kullanılamaz (bölme GT'den önce donar); negatif oranı sonradan raporlanır.
- **Dondurma:** `eval/manifests/v1.json` (yerel, repoya girmez): `corpus_digest`, `queries_digest` (queries-v1.jsonl sha256), `dev_ids`, `heldout_ids`,
  `split_digest`, seed'ler, `quota_shortfall`, araç sürümleri; GT donunca `gt_digest`, rubrik sürümü, uyum sayıları. Metin ve not yolu yok.
- **Held-out açılışı:** yalnız bir **karar** için (ilki M4 embedding kararı; M5 kapı eşiği ayrı karar). Önkoşul: karşılaştırılan sistemler
  ve ayarları dev'de dondurulmuş, ayar digest'leri yazılmış. Şef açar, değerlendiricinin açık onayıyla; her açılış `eval/manifests/heldout-log.json`'a
  yazılır (tarih, karar, sistemler + ayar digest'leri, onaylayan). Bir held-out sürümü en çok 3 karar için açılır, sonra "aşınmış" sayılır ve
  yeni prompt'lardan held-out v2 kurulur. Ayar yapan agent'lar held-out metnini görmez; araçların varsayılanı `dev` (uygulama *açık, M3*).

## 9. Metrikler

**Gösterim.** R_q = (d_1, d_2, …) sistemin not sıralaması (parçalar §4'e göre nota indirgenir, ilk 10 not); g(q, d) ∈ {0, 1, 2} final GT;
P_t = {q : bir d için g(q, d) ≥ t}; N = negatif sorgular. Sıralama metrikleri P_t üzerinden ve **kapı öncesi** sıralamadan; enjeksiyon
metrikleri kapı ve bütçe uygulanmış **son** çıktıdan hesaplanır. "Puan" = 0–1 ölçeğinde 0,01.

| Metrik | Formül | Sözle |
|---|---|---|
| hit@k^t (k = 1, 3, 5; t = 1, 2) | (1/\|P_t\|) Σ_{q∈P_t} 1[∃ i ≤ k : g(q, d_i) ≥ t] | İlk k notta ilgili (t = 1) / gerekli (t = 2) not var mı |
| MRR | (1/\|P_1\|) Σ 1/r_q; r_q ilk g ≥ 1 notun sırası, > 10 ise terim 0 | İlk ilgilinin yüksekliği; ≥ 2 türevi ekte |
| nDCG@5 | DCG@5 / IDCG@5; DCG@5 = Σ_{i=1..5} g(q, d_i) / log2(i + 1); IDCG: GT etiketlerinin azalan ideal dizilişi | Dereceli sıralama; kazanç doğrusal 0/1/2 |
| İçerik isabeti@B^t (B = 1500, 2500) | (1/\|P_t\|) Σ 1[∃ d : g(q, d) ≥ t ve kaps(q, d, B) ≥ min(200, \|d\|)] | Bütçe B'de ajana giden metne gerekli notun ≥ 200 karakteri (kısa notun tamamı) girdi mi |
| Yanlış ekleme oranı (FIR) | \|{q ∈ N : enjeksiyon boş değil}\| / \|N\|; contentless ve içerikli negatif ayrı | Karşılığı yokken ekleme |
| Çekimserlik doğruluğu | (\|P_1 ∩ ekledi\| + \|N ∩ eklemedi\|) / tüm sorgular; 2×2 tablo + isabetsiz ekleme (pozitifte ekledi, eklenende g ≥ 1 not yok) | Ekle / ekleme kararı |
| Eklenen karakter | \|enjeksiyon\| (Unicode karakter, sarmalayıcı dahil); ortalama (tümü ve yalnız eklenenler), p95; negatiflerde ayrı | Bağlam maliyeti |
| Gecikme p50 / p95 | aşağıda | Hissedilen bekleme |
| Kapı ihlali | private / archived / superseded not eklenme sayısı | Hedef 0 |

- **Kazanç doğrusal:** üç düzeyli ölçekte "yararlı" gerçekten yararlı; üstel kazanç (0/1/3) 2'yi aşırı ağırlar. Üstel nDCG ekte verilebilir.
- **kaps(q, d, B):** sistem her enjekte parça için (`note_id`, başlangıç, bitiş) kaydeder; kaps = B'ye kırpılmış enjeksiyonda d'den gelen
  karakter sayısı; test, kaydın metinde birebir alt dize olduğunu doğrular. 200 başlangıç değeri; paragraf GT gelirse "gerekli parça girdi
  mi"ye döner (*açık, M3*). B: 1500 Hermes prefetch, 2500 Claude Code UserPromptSubmit (DESIGN §9); avenox kıyası için 2000 ekte opsiyonel.
- **Gecikme, ölçüm yeri.** (a) *Sistem içi* (S1–S5 kıyası): arama + bağlam fonksiyonu süreç içinde `perf_counter`, ısınmış, 200 sorgu × 3;
  karar kuralına girmez. (b) *Hook uçtan uca* (karar kuralı): harici koşucu hook betiğini Claude Code gibi başlatır (exec form, mutlak Python,
  payload stdin'de), süreç çıkışına kadar duvar saatini ölçer; bellekd ayakta ve ısınmış, 10 ısınma, 200 × 5 = 1000 ölçüm; soğuk başlangıç
  ayrı satır; DESIGN §8.7 makinesi, prize takılı, arka plan yükü not edilir. GT gerektirmez: tüm sorgularla ölçülür, held-out açılışı sayılmaz.
- **Birincil metrik** (tek sayı gerekirse): pozitif sorgularda **nDCG@5**. Gerekçe: dereceli GT'nin bütün bilgisini kullanır, sıraya duyarlı,
  DESIGN karar kuralındaki iki metrikten biri; hit@3 ikili ve daha gürültülü (§11). Dev'deki ayar seçimi nDCG@5 ile yapılır. Uçtan uca
  özet için ikincil çift: içerik isabeti@2500^1 **ve** içerikli-negatif FIR, birlikte okunur (biri ötekinin pahasına iyileşebilir).
- **Referans satır B-cwd** (aday değil): yalnız cwd projesinin auto-memory klasöründeki notları döndürür; GT'nin ne kadarının cwd'den
  açıklandığını gösterir.

## 10. S0 (mevcut düzen)

**Tanım:** sorgunun `project`'ine karşılık gelen auto-memory klasörünün `MEMORY.md`'si, ilk 200 satır ya da 25 KB'ta (hangisi önce) kesilip
oturum başında bir kez yüklenir; konu notları yüklenmez; klasör yoksa hiçbir şey yüklenmez. Yol → klasör eşlemesi Claude Code adlandırmasıyla
(`C:\` → `C--`); Türkçe karakterli ve iç içe yollarda kural *bilinmiyor* → snapshot klasör adlarıyla elle doğrulanmış eşleme tablosu (M1).

| Metrik | Tanım |
|---|---|
| İşaretçi isabeti^t | Kesilmiş MEMORY.md en az bir g ≥ t notu bağlantı ya da dosya adıyla listeliyor mu; ayrıca işaretçi kapsaması = listelenen GT≥t not / tüm GT≥t not |
| İçerik isabeti | Konu notunun gövdesi bağlamda değil → tanım gereği 0 (MEMORY.md korpusta olmadığından istisna yok) |
| FIR | MEMORY.md'si olan cwd'lerdeki bütün negatifler (S0 her zaman yükler) |
| Sabit maliyet | Oturum başına yüklenen karakter (kesilmiş MEMORY.md uzunluğu), prompt'tan bağımsız |

**Adil karşılaştırmanın sınırları:**
1. **Farklı şey teslim ederler.** S0 tek satırlık özet + işaretçi verir; ajan isterse notu bir araç çağrısıyla okur; Bellek içeriği doğrudan
   verir. İşaretçi isabeti ajanın bir ek adımla ulaşabileceğinin **üst sınırıdır**; o adımı gerçekten atıp atmadığı ölçülmez (*bilinmiyor*; M7).
2. **Maliyet birimi farklı.** S0 oturum başına bir kez öder; Bellek SessionStart (~3000) + her prompt'ta enjeksiyon öder ve enjeksiyonlar
   transkriptte birikir. Kıyas oturum başına: S0 = \|MEMORY.md\|, Bellek = SessionStart + Σ_prompt eklenen karakter; oturum başına prompt
   dağılımı history.jsonl'dan `session_id` ile ölçülür (*açık, M3*).
3. **Tabaka eğilimi.** Root'ta ana MEMORY.md ana klasörün bütün notlarını listeler → işaretçi isabeti yapısal olarak yüksek; projelerde küçük
   MEMORY.md yalnız kendi notlarını listeler. S0 yalnız tabaka kırılımıyla okunur.
4. **Zaman.** S0 sorgu tarihindeki değil snapshot'taki MEMORY.md ile ölçülür (bütün sistemler gibi). Prompt başı gecikmesi 0 sayılır.
5. **Sonuç:** S0 ile Bellek tek metrikte "kazanan" diye karşılaştırılmaz; rapor maliyet, işaretçi erişimi ve içerik teslimini yan yana verir.

## 11. Karar kuralı ve istatistiksel belirsizlik

Eski DESIGN kuralı (değiştirildi; yerine aşağıdaki karar kuralı geçerli): embedding, held-out'ta en iyi BM25'e göre nDCG@5 **veya** hit@3'te ≥ +5 puan **ve** hook p95 ≤ 150 ms ise kalır.

**Gürültü hesabı** (*tahmin*; dev ölçülünce gerçek sapmalarla güncellenir): held-out 80 sorgunun %25–35'i negatif çıkarsa sıralama
metrikleri ~55–60 pozitif sorguda hesaplanır. Sorgu başına nDCG@5 farkının standart sapması ~0,25 ise %95 aralığın yarı genişliği
≈ 1,96 × 0,25 / √58 ≈ ±6,4 puan; hit@3'te uyuşmayan sorgu oranı %15 ise ≈ 1,96 × √0,15 / √58 ≈ ±10 puan. Yani +5 puanlık nokta farkı tek
başına gürültüden ayrılamaz; +5'i güvenle görmek için nDCG@5'te ~100, hit@3'te ~230 pozitif held-out sorgu gerekirdi (*tahmin*).

**Karar kuralı** (değerlendirici 2026-10-24'te onayladı; DESIGN §10 ile aynı):
1. **Adaylar dev'de seçilir.** En iyi BM25 (S1–S3) ve tek embedding koşusu (S4'ün 3 adayından dev nDCG@5'i en yüksek olan) dev'de seçilir,
   ayarları dondurulur; held-out'ta yalnız bu ikisi karşılaştırılır (3 aday × 2 metriği held-out'ta denemek en şanslıyı seçer). S5 ayrı karar.
2. **Eşleştirilmiş bootstrap:** held-out pozitif sorguları yerine koyarak 10.000 kez örnekle (seed `20261024`); her örneklemde
   Δ = metrik(embedding) − metrik(BM25); yüzdelik güven aralığı. İki metrik "veya" ile bağlı → Bonferroni: her biri için %97,5 aralık.
3. **Embedding kalır** ⇔ ([nDCG@5'te Δ ≥ +5 puan **ve** %97,5 alt sınır > 0] **veya** [hit@3^1'de aynısı]) **ve** hook p95 (§9 b) ≤ 150 ms.
4. Nokta ≥ +5 ama alt sınır ≤ 0 → **"kanıt yetersiz"**: varsayılan yalnız BM25 (embedding bağımlılık ve gecikme getirir, ispat yükü ondadır).
   Değerlendirici isterse karar, yeni prompt'larla kurulacak held-out v2'ye ertelenir.
5. Destekleyici rapor (kurala girmez): hit@3 için kesin işaret testi (McNemar; uyuşmayan sorgular b, c üzerinde iki yönlü binom p); FIR farkı
   (negatif az olduğundan yalnız raporlanır); tabaka kırılımı (n < 10 hücreler "gürültü" işaretli).

## 12. Sürümleme, değişiklik kuralları, raporlama

**Kimlikler:** korpus `v1`, sorgu `v1`, bölme `v1`, rubrik `r1…r3`, GT `v1`; aynı korpus ve sorgularda GT düzeltmesi `v1.1`, `v1.2`…;
korpus ya da sorgu seti değişirse `v2` (her şey yeniden).

```
eval/data/ (gitignored): corpus/v1/{files/<kaynak>/<yol>, index/<kaynak>/MEMORY.md, manifest.json, notes.jsonl, notes.md} · queries-v1.jsonl · reports/ (metin içeren analizler)
  gt/v1/   pilot-N/ batches/ prompts/ juror-a.jsonl juror-b.jsonl adjudication.jsonl degerlendirici-kontrol.md degerlendirici.jsonl
           qrels.jsonl gt-queries.jsonl agreement.json
  gt/v1.1/ qrels.jsonl changes.jsonl rejected.jsonl
repoda: eval/PROTOCOL.md · eval/reports/*.md (yerel, repoya girmez: eval/manifests/v1.json · eval/manifests/heldout-log.json)
```

`qrels.jsonl`: yalnız ≥ 1 çiftler, `{"qid", "note", "grade", "source": "agree|hakem|degerlendirici", "why"}`. `gt-queries.jsonl`: her sorgu için
bir satır, `{"qid", "negative", "contentless", "degerlendirici_checked"}` (negatiflik açıkça kayıtlı).

**Kurallar (önceki ölçüm dersleri):**
1. **Dondurulmuş dosyaya dokunulmaz.** v1 dosyaları digest'le kilitli; her koşu önce verify + digest kontrolü yapar, uyuşmazlıkta durur.
2. **Korpus büyümesi = yeni sürüm.** Hafızaya not eklendi diye v1 GT güncellenmez (eski GT eksik kalır → sahte regresyon). Yeni snapshot
   `v2` + bütün sorgular için yeni etiketleme; v1 ve v2 sonuçları yan yana raporlanır.
3. **GT düzeltmesi = v1.1.** Değişen her çift `changes.jsonl`'a: eski, yeni, gerekçe, kim, tarih.
4. **Genişletme içerikten, körlemesine.** Sistem çıktısında görülen "GT'de 0 ama ilgili olabilir" çiftler doğrudan eklenmez: eşit sayıda
   rastgele 0-çiftle (tuzak) karıştırılır, kaynağı bilmeyen yeni jüri §5 rubriğiyle yeniden yargılar; kabul edilenler v1.1'e, reddedilenler
   gerekçesiyle `rejected.jsonl`'a. Bu denetim (havuzlama) dev'de serbest; held-out'ta yalnız karar anında, bütün aday sistemlerin top-3
   birleşimiyle simetrik yapılır. Karar v1 ile verilir, v1.1 yan yana raporlanır; farklı karar çıkarsa "kararsız" yazılır, değerlendirici karar verir.
5. **Sayı kurtarmak için GT oynatılmaz.** Rubrik ya da GT bir metriği iyileştirmek için değişmez; rubrik değişikliğini yalnız uyum ölçüsü
   (§6) ya da değerlendiricinin sistematik hata bulgusu (§7) tetikler.
6. 2026-10-24 sonrası prompt'lar birikince `queries-v2` ve yeni held-out kurulur; v1 held-out aşınınca (§8) buna geçilir.

**Rapor** `eval/reports/YYYY-AA-GG-<konu>.md`, yalnız sayı ve `qid` (prompt metni yok). Bölümler: (1) başlık — tarih, kod sürümü, korpus /
sorgu / bölme / rubrik / GT sürümleri ve digest'leri, sistemler + ayar digest'leri; (2) dev tablosu — sistem × metrik (§9), %95 bootstrap
aralığı, n'ler; (3) held-out tablosu — yalnız açılış kaydı varsa, kayda atıfla, dev ile asla birleştirilmez; (4) tabaka kırılımı (8 tabaka +
short; n < 10 hücreler işaretli); (5) negatifler — contentless ve içerikli FIR ayrı, çekimserlik 2×2; (6) maliyet ve gecikme (oturum başı
maliyet S0 dahil, p50/p95 ölçüm yeri a/b); (7) GT sürümleri yan yana (v1 | v1.1 | v2); (8) referans satırlar S0, B-cwd; (9) açık maddeler.

2026-10-24 itibarıyla DESIGN.md ile fark yoktur; üç fark (tam etiketleme, korpus yolu, karar kuralı) DESIGN §10 ve §12 sapma kaydına işlendi.

**Rubrik değişiklik günlüğü:**

| Tarih | Sürüm | Değişiklik | Gerekçe |
|---|---|---|---|
| 2026-10-24 | r1 | İlk sürüm | — |

**Protokol değişiklik günlüğü:**

| Tarih | Değişiklik |
|---|---|
| 2026-10-24 | Kod ile uzlaştırma: (1) tekilleştirme anahtarı casefold, en yeni örnek kalır; (2) kota açığı aktarılmaz, `shortfall` raporlanır, v1 sayıları eklendi; (3) RNG/seed adları; (4) kök MEMORY.md'ler `index/` altında dondurulur, `index_files`; (5) araç adları (split, notelist, batches, agreement, adjudicate); (6) DESIGN farkları tablosundan kaynak satırı silindi; (7) korpus not sayıları ölçülen ham `.md` sayılarına çevrildi |
| 2026-10-24 | Karar kuralı (§11) değerlendirici onayıyla kesinleşti; DESIGN farkları kapandı, "DESIGN.md ile farklar" tablosu kaldırıldı |
