# eren-kit telefon: servis işletimi

Durum: v1 (servis bilgisi ve şema kuralı Dilim 1'den; ajanda ve `eren eslestir` ajanda dalgasından). Bu belge servisin otomatik başlatma, bekçi ve kurulum düzenini anlatır; kullanıcı ve sonraki geliştirici oturumları için işletim kılavuzudur. Mimari kararlar `MIMARI.md`, modül sözleşmeleri `server/MODULLER.md` (`ana` ve `bekci` bölümleri), ölçümler `masaustu.md` raporundadır (`runtime/olcumler`). Yollarda `%LOCALAPPDATA%`, `<kullanıcı>`, `<veri kökü>` ve `<görev adı>` gibi yer tutucular kullanılır (anlamları "Ortam değişkenleri ve mevcut kurulum" bölümünde). Belge kişilik adı yerine "ana oturum" der.

## Zincir

```
Görev Zamanlayıcı "eren-kit-telefon"   (oturum açılışı + her 5 dakika; ad varsayılandır)
  conhost.exe --headless node.exe bekci-ana.ts --ana ana.ts
    bekçi (server/src/bekci-ana.ts)
      ana (server/src/ana.ts)  ->  gateway, ana oturum süreci, iş oturumları...
```

Her katman bir önceki katmanın bırakacağı boşluğu toparlar:

| Katman | Ne yapar | Neyi toparlar |
|---|---|---|
| Görev Zamanlayıcı | Oturum açılınca ve 5 dakikada bir `conhost`'u başlatır. | PC yeniden başlayınca, bekçi ölünce (çökme, elle öldürme). Bekçi canlıysa tetik zararsızdır: yeni bekçi kontrol borusunu alamaz, `bekci_ikinci_ornek` yazıp `exit(0)` yapar. Görev `MultipleInstancesPolicy=IgnoreNew` de taşır, ama tek başına yetmez (aşağıya bakın). |
| `conhost --headless` | Pencere açmadan Node'u başlatır. | Yalnız pencereyi. Hiçbir şeyi yeniden başlatmaz. |
| Bekçi | Ana'yı başlatır, nabız yoklar, çökünce ya da donunca yeniden başlatır, kontrol borusunu sunar. | Ana'nın çökmesi, donması, yetim kalması. |
| Ana | Servisin kendisi; tekil kilit (`\\.\pipe\eren-servis-tekil`) tutar. | İş oturumlarını (`detached`) sonraki açılışta sahiplenir. |

Neden `conhost --headless`: ölçümde (`masaustu.md` 2.1) `.cmd`, doğrudan `node` ve `powershell -WindowStyle Hidden` ölçüm makinesinde görünür Windows Terminal penceresi açtı; `conhost --headless` açmadı (pencere açmayan diğer yollar `wscript` ve `pythonw` idi; ek dosya istedikleri için seçilmedi). `--headless` geniş belgelenmiş bir arayüz değildir; kırılırsa alternatif `pythonw` + `.pyw` yoludur (ölçülmüş ama uygulanmamış seçenek: kodda yedek yok, geçiş elle yapılır).

Görev iki tetik taşır: oturum açılışında çalışan tekrarsız bir `LogonTrigger` ve kayıt anından başlayıp 5 dakikada bir süresiz tekrarlayan bir `TimeTrigger`. Tekrar neden `LogonTrigger`'da değil: oradaki tekrar kayıttan sonra bir sonraki oturum açılışına kadar başlamıyor (ölçüldü: `NextRunTime` boştu).

Neden bekçi kendi tekil kilidini tutuyor: `schtasks /end` yalnız `conhost`'u öldürür, Node ve çocukları yaşar, görev `Ready` görünür; sonraki tetik ikinci bir servis başlatırdı. Bekçi `\\.\pipe\eren-bekci` borusunu hem komut kanalı hem tekil kilit olarak kullanır. Bu yüzden servisi durdurmak için `schtasks /end` değil `eren dur` kullanılır.

Neden `LastResult` çöküşü göstermez: `conhost` çocuğunun çıkış kodunu taşımaz. Ölçümde Node 7 döndü, `LastResult` 0 kaldı; Node öldürülünce de 0. Çöküşü anlamak için `bekci.log` ve `servis.log` okunur.

## Kurulum dizini

Çalışan kod geliştirme klasöründen ayrıdır. `kur.ts` sürümleri şu düzene kopyalar:

```
<veri kökü>\uygulama\
  surumler\<sürüm>\          <sürüm> = `apps/phone`'a dokunan son commit'in kısa sha'sı (10 hane); aynı içerikte kurulu sürüm varsa onun adı; --kirli kurulumda <ad>-k<zaman>
    surum.json               {"sha","dal","tarih_ms","agac"}  (agac: yalnız temiz kurulumda)
    package.json
    server\package.json, server\src\**
    protocol\package.json, protocol\src\**
    kurulum\**               (test klasörü hariç)
    node_modules\**          yalnız çalışma zamanı paketleri
    node_modules\@eren\protocol  -> junction: <sürüm>\protocol
  guncel                     -> junction: surumler\<etkin sürüm>
  gecmis.json                [{"sha","tarih_ms"}, ...]  (en yeni sonda)
```

- `node_modules` paketleri `package-lock.json`'dan seçilir (`dev` ve `link` olmayanlar); kilitte olmayan yabancı paketler, `typescript`, `@types/*`, `.bin` ve `@eren` kopyalanmaz. Kilit dosyası yoksa `node_modules` altındaki her şey (bu hariç tutmalarla) kopyalanır.
- `protocol` gerçek dizin olarak `node_modules` dışında durur, `node_modules\@eren\protocol` ona junction'dır: Node `node_modules` içindeki `.ts` dosyasını çalıştırmaz, junction'ın realpath'ini izler. Junction yönetici yetkisi istemez.
- **Sürüm adı içeriğe bağlıdır, depo HEAD'ine değil.** Ad, `apps/phone` ağacına dokunan son commit'in kısa sha'sıdır (`git log -1 --abbrev=10 -- .`); toplu depoya giren ilgisiz bir commit yeni sürüm üretmez. Aynı içerikte kurulu bir sürüm varsa (`surum.json`'daki `agac`, yani `apps/phone` ağacının git ağaç kimliği aynıysa) yeni ad üretilmez, onun adı yeniden kullanılır ("Sürüm zaten kurulu, yeniden kullanılıyor"). Önce `guncel`, sonra önceki, sonra kurulu sürümler en yeniden eskiye bakılır; `agac` alanı olmayan eski adlar (kurulumdaki HEAD kısa sha'sı) git'ten çözülüp tanınır. Kirli (`-k`) sürümler hiç eşleştirilmez.
- Sürüm önce `<sürüm>.yeni` olarak kurulur, tamamlanınca adı değişir; yarım kalan kopya `guncel`'e girmez. `guncel` de önce `guncel.yeni` olarak hazırlanıp eski junction'ın yerine geçirilir.
- Görev ve bekçi hep `guncel` yolundan çalışır. Bekçi sürümü `guncel`'in realpath'indeki `surum.json`'dan okur (`eren durum` çıktısındaki sürüm budur).
- Veri ve loglar `uygulama\` dizininin dışındadır: `<veri kökü>\` (`eren.db`, `logs\`, `isler\`, `eren-mcp\`, `ayar.local.json`...). Sürüm değişimi veriyi etkilemez.
- `eren-mcp\` ana oturum süreçlerinin mcp dosyalarını tutar: nesil başına bir dosya, `eren-mcp\<nesil>.json` (Dilim 1'deki tek `eren-mcp.json`'un yerine); içinde `eren` ve `eren-ajanda` köprüleri (jetonları ortamda) ve ayarda varsa `computer-use-windows`. Dosya süreç çıkınca silinir; servis açılırken kurtarma da son neslin dosyasını siler. Dizini `ana` açılışta kurar. Elle silmek gerekmez; çalışan servisin altındaki dosyaya dokunulmaz.

## Ortam değişkenleri ve mevcut kurulum

Servis, bekçi ve kurulum betikleri aynı üç değişkeni okur; değişken yoksa varsayılan geçerlidir.

| Değişken | Varsayılan | Anlamı |
|---|---|---|
| `EREN_KIT_DATA_DIR` | `%LOCALAPPDATA%\eren-kit` | Veri kökü (`<veri kökü>`): `eren.db`, `logs\`, `isler\`, `eren-mcp\`, `ayar.local.json` ve kurulum klasörü `uygulama\` burada durur. Mutlak yol olmalıdır; göreli yol ayar hatasıdır. Kural `server/src/veri-koku.ts`'te (`veriKokuCoz`) tek yerde tanımlıdır; `server/src/ayar.ts` ve `server/src/bekci-ana.ts` ondan alır, `kurulum/ortam.ts` birebir kopyasını uygular (davranış aynıdır). Bekçi günlüğü `<veri kökü>\logs` altındadır. |
| `EREN_KIT_PHONE_TASK_NAME` | `eren-kit-telefon` | Görev Zamanlayıcı görev adı (`<görev adı>`). `schtasks ... /tn` çağrıları, `gorev-kaydet.ts`, `kur.ts` ve `eren` komutu aynı adı kullanır. |
| `EREN_KIT_ASSISTANT_NAME` | `Claude` | Kullanıcıya görünen asistan adı (en çok 40 karakter); persona, bildirim metinleri ve yeni oluşturulan ana sohbetin adı bunu kullanır. Var olan veritabanındaki ad yeniden adlandırılmaz. Telefon uygulamasında aynı ad derleme anında verilir. |

**Değişkenleri kalıcı kullanıcı ortamına yazın.** Görev Zamanlayıcı'nın başlattığı servis yalnız kalıcı ortamı görür; bir kabukta geçici verilen değişken servise ulaşmaz. Değişkenler kalıcı kullanıcı ortamına yazılır, sonra yeni bir kabuk açılır, sonra `kur.ts` çalıştırılır:

```
[Environment]::SetEnvironmentVariable("EREN_KIT_DATA_DIR", "<yol>", "User")
[Environment]::SetEnvironmentVariable("EREN_KIT_PHONE_TASK_NAME", "<ad>", "User")
[Environment]::SetEnvironmentVariable("EREN_KIT_ASSISTANT_NAME", "<ad>", "User")
```

Yeni kabuk gereklidir: açık bir kabuk kalıcı ortama sonradan yazılan değeri görmez. `kur.ts` (`--geri-al` dahil) ve `gorev-kaydet.ts` (görevi kaydederken), hiçbir şeye dokunmadan önce kabuğun değerlerini kalıcı ortamla karşılaştırır (kullanıcı kapsamı, yoksa makine kapsamı):

- `EREN_KIT_DATA_DIR` kabukta ve kalıcı ortamda farklıysa (biri yoksa da) kurulum DURUR ("kurulum durdu, hiçbir şey değişmedi"); aksi halde servis başka köke yazar ve veri bölünür. Çözüm: kalıcı ortama yazmak ya da kabuktaki değeri kaldırmak, sonra yeni bir kabuk açmak.
- `EREN_KIT_PHONE_TASK_NAME` ve `EREN_KIT_ASSISTANT_NAME` farkı yalnız uyarıdır (`UYARI:`), kurulum sürer.
- Kalıcı ortam okunamazsa (Windows PowerShell çalışmazsa) karşılaştırma yapılamaz; bu da yalnız uyarıdır.

Görev adı değişirse eski adla kayıtlı görev, o adı veren değişkenle `gorev-kaydet.ts --sil` ile kaldırılıp yenisi kaydedilir. Görev Zamanlayıcı'nın yeni kalıcı ortamı oturumu kapatıp açmadan görüp görmediği ölçülmedi; çalışan bekçi ve servisin sonradan değişen kalıcı değeri görüp görmediği de ölçülmedi.

**Eski kurulum korumaları.** Önceki sürümler veriyi `%LOCALAPPDATA%\Eren` altına yazıyor, görevi `Eren` adıyla kaydediyordu. Değişken verilmeden yeni sürümle kurulursa ikinci bir görev (iki servis) ya da ikinci bir veri kökü (bölünmüş veri) doğardı; bu yüzden `kur.ts` (`--geri-al` dahil), `gorev-kaydet.ts` (kaydederken), `eren dur` ve `eren baslat`, hiçbir şeye dokunmadan önce şunları denetler:

1. Eski `Eren` görevi kayıtlıysa ve etkin görev adı başkaysa kurulum durur. Bayrakla geçilemez: ya görev adı eskiye bağlanır ya da eski görev önce silinir.
2. `%LOCALAPPDATA%\Eren` altında `uygulama` ya da `eren.db` varsa ve etkin veri kökü başkaysa kurulum durur. Yeni kökle bilerek kurmak için `--eski-koku-yoksay` verilir (`kur.ts`, `kur.ts --geri-al`, `gorev-kaydet.ts`, `eren dur` ve `eren baslat` ile).

Hata iletisi, mevcut kurulumu sürdürmek için kalıcı kullanıcı ortamına `EREN_KIT_PHONE_TASK_NAME=Eren` ve `EREN_KIT_DATA_DIR=<eski kök>` yazılıp yeni kabuk açılmasını söyler.

**Mevcut bir kurulumu aynen sürdürmek.** Eski düzen (veri kökü `%LOCALAPPDATA%\Eren`, görev adı `Eren`, asistan adı `Eren`) şu kalıcı değerlerle hiçbir veri taşımadan çalışmaya devam eder (`EREN_KIT_DATA_DIR` için `%LOCALAPPDATA%` yerine açılmış mutlak yol yazılır; ardından yeni kabuk açılır):

```
[Environment]::SetEnvironmentVariable("EREN_KIT_DATA_DIR", "C:\Users\<kullanıcı>\AppData\Local\Eren", "User")
[Environment]::SetEnvironmentVariable("EREN_KIT_PHONE_TASK_NAME", "Eren", "User")
[Environment]::SetEnvironmentVariable("EREN_KIT_ASSISTANT_NAME", "Eren", "User")
```

Değişkenler hiç verilmezse yeni bir kurulum gibi davranılır: `%LOCALAPPDATA%\eren-kit` kökü, `eren-kit-telefon` görevi, `Claude` adı.

**Durum.** `kur.ts --durum` (salt okunur) veri kökünü, uygulama kökünü ve eski kurulumla olası çakışmaları (`UYARI:`), güncel ve önceki sürümü, kurulu sürümleri ve geçmişi gösterir; kabuk ile kalıcı ortamı karşılaştırmaz. `eren durum` veri kökünü, bekçinin çalıştığı veri kökünü (bildiriyorsa), görev adı ve durumunu ve aynı çakışma uyarılarını da gösterir (ayrıntı: "`eren` komutu").

Veritabanı şeması ve boru adları (`eren-servis-tekil`, `eren-bekci`) bu seçimlerden bağımsızdır; iki düzen arasında geçiş için veri kopyalanması gerekir ve bu belge otomatik taşıma anlatmaz.

## İlk kurulum

Önce Görev Zamanlayıcı kaydı, sonra ilk sürüm. Her ikisi de yönetici istemez (`InteractiveToken`, kendi kullanıcın, `LeastPrivilege`).

```
node --disable-warning=ExperimentalWarning kurulum/gorev-kaydet.ts --goster
node --disable-warning=ExperimentalWarning kurulum/gorev-kaydet.ts
node --disable-warning=ExperimentalWarning kurulum/kur.ts
```

1. `gorev-kaydet.ts --goster` yalnız XML'i basar (kaydetmez). Argümansız çalıştırınca `whoami` ile kullanıcıyı alır, XML'i geçici dosyaya UTF-16LE yazar, `schtasks /create /xml ... /tn <görev adı> /f` ile kaydeder ve `schtasks /query /tn <görev adı> /xml` ile `LogonType`, `RunLevel`, `PT5M` tekrarı, `ExecutionTimeLimit=PT0S`, pil ayarları, `IgnoreNew`, `Hidden`, tekrarsız `LogonTrigger` ve `TimeTrigger`'ı doğrular; Windows'un kayda yazmadığı varsayılan değerleri (ör. `RunLevel`) eksik saymaz. `--sil` görevi siler. "Erişim engellendi" çıkarsa komut bunu açıkça yazıp sıfırdan farklı kodla çıkar.
2. Görev, normal öncelik sınıfında (`Priority` 5) çalışır; 7-8 normalin altı olur ve çocuk süreçlere geçerdi. Görev, kayıt anındaki Node'u (`process.execPath`) ve `<veri kökü>\uygulama\guncel\...` yollarını yazar. Node'un yeri değişirse (başka sürüm, başka dizin) görev yeniden kaydedilmelidir.
3. `kur.ts` temiz bir commit'i test eder, kopyalar, `guncel`'i çevirir ve görevi çalıştırır (aşağıya bakın). `gorev-kaydet.ts` çalışmamışsa ve bekçi de yoksa `kur.ts` kopyalamayı yapar, ama başlatmaz; kaydetmek için çalıştırılacak komutu yazdırır.

Bundan sonra servis her oturum açılışında kendiliğinden başlar; elle başlatmak için `schtasks /run /tn <görev adı>` ya da `eren baslat`.

## Güncelleme ve geri alma

```
node --disable-warning=ExperimentalWarning kurulum/kur.ts
node --disable-warning=ExperimentalWarning kurulum/kur.ts --geri-al
node --disable-warning=ExperimentalWarning kurulum/kur.ts --durum
node --disable-warning=ExperimentalWarning kurulum/kur.ts --izin-duzelt
```

`--izin-duzelt` yalnız veri kökünün iznini daraltır (eren-kit'e ait görünmeyen klasörü de, bilerek) ve çıkar; kurmaz. Daralttığı kök servisin gerçekten kullanacağı köktür: kalıcı `EREN_KIT_DATA_DIR` (önce kullanıcı kapsamı, orada yoksa makine kapsamı; ikisinde de yoksa `%LOCALAPPDATA%\eren-kit`), bu kabuktaki değer değil; çünkü Görev Zamanlayıcı'nın başlattığı servis kalıcı ortamı görür. Önce hedeflediği kökü (`Hedef veri kökü …`), daraltmadan sonra sonucu terminale yazar: `Sonuç: düzeltildi`, `Sonuç: değişiklik gerekmedi` (kök zaten güvenliydi), kök yoksa oluşturulduğu, ya da başarısızlıkta `Sonuç: veri kökü düzeltilemedi` ve ardından nedeni veren `kur:` satırı (çıkış kodu 1); kabuktaki değer farklıysa `UYARI:` satırıyla söyler (servisin açılma hatası bilerek yol yazmaz, bu satır yazar). Kalıcı ortam okunamazsa bu kabuğun kökünü uyarıyla düzeltir; kalıcı değer göreliyse hiçbir şeye dokunmadan durur.

`kur.ts` (seçeneksiz) sırayla şunları yapar; biri düşerse durur, `guncel` değişmez ve çıkış kodu sıfırdan farklıdır:

1. `git status --porcelain -- .` boş değilse durur; denetim yalnız `apps/phone` ağacına bakar, toplu depodaki başka paketlerin değişikliği sayılmaz. `--kirli` ile geçilir; sürüm adı `<ad>-k<zaman>` olur (`<ad>` yukarıdaki kural), aynı adın temiz kopyasını gölgelemez.
2. Test kapısı: `npm run typecheck -w server`, server testleri (`dis-dunya.test.ts` hariç: canlı servisle aynı tekil boruyu kullanır), `dis-dunya.test.ts`'ten yalnız transkript testleri (`--test-name-pattern=transkript`; tekil boruyu kullanan gruplar koşmaz), `npm test -w protocol`, kurulum tip denetimi (`kurulum/tsconfig.json`), kurulum testleri. `--testsiz` kapıyı atlar. `--yalniz-test` yalnız kapıyı çalıştırır, kurmaz.
3. Kopyadan önce veri kökünün iznini sağlar (`kurulum/izin.ts`, kural `server/src/kok-izni.ts`): kök yoksa yalnız bu hesaba, SYSTEM'e ve Administrators'a açık oluşturur; varsa ve başka hesaplara açıksa eren-kit'e ait kökü (içinde `uygulama` ya da `eren.db` var ya da boş) daraltır ve sırları yenileme uyarısı yazar, başka klasörde ve sürücü kökünde durur (bilerek daraltmak için `--izin-duzelt`; sürücü kökü hiç daraltılmaz). `--geri-al` da aynısını yapar. Sonra sürümü `surumler\<sürüm>`'e kopyalar. Testten sonra `apps/phone` ağacı değiştiyse (temiz kurulumda: ağaç kimliği `HEAD:./` ya da `status -- .` farklıysa) kopyayı silip durur; depoya giren ve bu ağacı değiştirmeyen ilgisiz commit durdurmaz.
4. Duman testi: yeni sürümde `server/src` altındaki tüm modülleri yeni dizinden içe aktarır. Dört giriş dosyası (`ana.ts`, `kopru.ts`, `eslestir.ts`, `bekci-ana.ts`) `if (import.meta.main)` korumalıysa onlar da girer; korumasız olan olursa yalnız dış paketleri yüklenir ve bu yazdırılır. `@eren/protocol`'ün sürümün kendi `protocol`'üne çözüldüğünü denetler.
5. `guncel`'i yeni sürüme çevirir, `gecmis.json`'a ekler. Görev kapalıysa (Disabled) `guncel` değişmeden durur ve önce `eren baslat` denir (`--geri-al` için de aynı). Bundan önce (ve en başta da) bekçisiz çalışan servis denetlenir: bekçi borusu yok ama `\\.\pipe\eren-servis-tekil` açıksa elle başlatılmış bir servis vardır; `kur.ts` `guncel`'i değiştirmeden durur. Önce o servis `/T`'siz durdurulmalıdır (`/T` `detached` iş oturumlarını da öldürür).
6. Servisi yeniler. Bekçi çalışıyor ve görev kayıtlıysa bekçiye `kapan` der, bekçi borusu kaybolana ve bekçi süreci gerçekten bitene kadar bekler (en çok 60 sn), `schtasks /run /tn <görev adı>` ile yeni bekçiyi başlatır; böylece bekçinin kendisi de yeni sürümden gelir. Boru 10 sn içinde gelmezse (ya da `/run` sıfır dışı dönerse) (`IgnoreNew` eski görev örneği bitmeden isteği yutabilir) `/run` en çok 2 kez yinelenir. Bekçi çalışıyor ama görev kayıtlı değilse yalnız `yenile` gönderir (bekçi eski sürümde kalır; uyarı yazar). Bekçi yoksa ve görev kayıtlıysa görevi çalıştırır.
7. En çok 60 sn `durum` yoklar. Başarı: ana çalışıyor, `surum` yeni sürümle aynı, ana tetikten sonra başlamış, en az 5 sn ayakta ve servis beklenen veri kökünde çalışıyor; kurulum bu kök doğrulanmadan başarı bildirmez. Kanıt bekçinin `durum` cevabındaki `veri_koku`'dur. Bunu bildirmeyen eski bekçide (geri alınan sürüm ya da görevsiz yenileme) kanıt, beklenen kökteki `logs\servis.log`'da (dönmüşse `servis.1.log`) ana pid'inin `basladi` kaydıdır; kayıt yoksa 60 sn sonunda "doğrulanamadı" hatası verilir. `veri_koku` beklenenden farklıysa kararlılık beklenmeden, ilk cevapta düşer (yanlış kökte açılan ana orada `eren.db` ve `sunucu-anahtar.pem` oluşturabilir).
8. Servis yanlış veri kökündeyse (adım 7) yeniden başlatmak çözmez, çünkü önceki sürüm de aynı ortamla aynı köke açılırdı. Sıra şöyledir: önce servis durdurulur (görev kapatılır, sonra bekçiye `kapan` gönderilir ve bekçinin bitmesi beklenir), sonra önceki sürüm varsa `guncel` ona geri alınır (yoksa `guncel` yeni sürümde kalır). Durdurma geri almadan önce yapılır: geri alma düşse bile servis yanlış kökte çalışmayı sürdürmez. Geri alma başarısız olursa servis yine durmuş kalır; hata mesajı hem durdurmayı hem `guncel`'in şimdiki durumunu söyler ve elle yapılacak adımı verir (`kur.ts --durum`, gerekirse `kur.ts --geri-al`). Servis yeniden başlatılmaz; yanlış kökte oluşmuş olabilecek `eren.db` ve `sunucu-anahtar.pem`'e dokunulmaz. Ortam düzeltilince (oturumu kapatıp açın) `eren baslat` çalıştırılır, `eren durum` ile veri kökü denetlenir, sonra kurulum yinelenir. `--geri-al` da aynı durumda `guncel`'i bir daha geri almaz (hedef sürümde kalır), yalnız servisi durdurur.
9. Adım 6-7 başka bir sebeple düşerse ve önceki sürüm varsa otomatik geri alma yapar: `guncel` önceki sürüme döner ve servis bir kez daha yenilenir (eski bekçi hiç kapanmadıysa yeniden başlatılmaz). Düşen sürümün geçmiş kaydı geri çekilir, yani "önceki sürüm" bozuk sürümü göstermez; otomatik geri almadan sonra `--geri-al` önerilmez (zaten geri alınmıştır). Geri alınan sürüm de ayakta kalmazsa durum söylenip durulur, döngü yoktur (geri alınan sürümde de kök yanlışsa servis yine durdurulur, adım 8). Geri alınan sürümün `/sohbet` protokolü (`protocol/src/sinirlar.ts` içindeki `SOHBET_SURUMU`, dosya metin olarak okunur) şimdikinden eskiyse tek satır uyarı yazılır (aşağıdaki "Geri alma ve telefon" sınırı); geri alma engellenmez. Her başarısızlıkta çıkış kodu sıfırdan farklıdır ve temizlik atlanır.
10. Eski sürümleri temizler: en yeni 3 sürüm, `guncel` ve önceki korunur.

`--geri-al` `gecmis.json`'daki, güncelden farklı son sürüme döner, bekçisiz servis denetimini yapar ve 6-7. adımları (veri kökü doğrulaması dahil) yineler; düşerse kendiliğinden yeniden geri almaz; protokollü sürümden eskisine dönülüyorsa aynı uyarıyı verir. Önceki sürüm yoksa hata verir. `--durum` salt okunurdur: güncel ve önceki sürüm, kurulu sürümler, geçmişin son 10 kaydı, görev, servis tekil kilidi (açık/kapalı) ve bekçi durumu; bekçisiz servis varsa uyarır.

## `eren` komutu

`kurulum\eren.cmd` (içinde `node ... eren.ts`) konsoldan çalıştırılır; PATH'e eklemek kullanıcının işidir, eklenmediyse tam yolla ya da `guncel\kurulum\eren.cmd` ile çağrılır.

| Komut | Ne yapar |
|---|---|
| `eren durum` | Görev kayıtlı mı ve durumu, bekçi (pid, durum, bildirdiği veri kökü; bu kabuğun veri kökünden farklıysa `UYARI:`), ana (pid, çalışma süresi), yeniden başlatma sayısı, son çıkış kodu (taze bekçide "yok"), çalışan ve güncel sürüm, 47821 portunun dinlenmesi, `servis.log` ve `bekci.log` son 5 olay. |
| `eren yeniden-baslat` | Bekçiye `yenile` der: ana nazikçe kapanır, `guncel`'den hemen yeniden başlar, geri çekilme sıfırlanır. Bekçi kendisi yeniden başlamaz. |
| `eren dur` | Görev kayıtlıysa önce kapatır (`schtasks /change /tn <görev adı> /disable`), sonra bekçiye `kapan` der ve bekçi süreci bitene kadar en çok 60 sn bekler. Görev kapalı olduğu için 5 dakikalık tetik servisi geri getirmez. Görev kayıtlı değilse doğrudan `kapan` gönderir. |
| `eren baslat` | Önce kalıcı ortamı kabuğunkiyle karşılaştırır (`kur.ts` ile aynı kural: `EREN_KIT_DATA_DIR` farkı hiçbir şeye dokunmadan durdurur, diğer ikisi uyarıdır). Sonra görevi açar (`/enable`), `schtasks /run /tn <görev adı>` çalıştırır, bekçi borusunu 10 sn içinde doğrular; gelmezse en çok 3 deneme yapar. Bekçi zaten çalışıyorsa görevi açar ve yine kökü doğrular. Başlattıktan sonra servisin beklenen veri kökünde açıldığını `kur.ts` ile aynı yöntemle doğrular (bekçinin bildirdiği `veri_koku`; bildirmeyen eski bekçide beklenen kökteki `servis.log`): ana en az 5 sn ayakta kalana dek, en çok 60 sn bekler. Kök yanlışsa servisi durdurur ve görevi kapatır (`eren dur` ile aynı yol). Kökü kanıtlayamazsa (kanıt yok ya da servis 60 sn içinde kararlı olmadı) 1 ile çıkar ama servisi durdurmaz. `eren dur` sonrası servisi kaldırmanın yolu budur. |
| `eren log [n] [--bekci]` | `servis.log` ya da `bekci.log`'un son n (varsayılan 20) olayı; yalnız saat, seviye, modül, olay. |
| `eren eslestir [seçenek]` | Seçenekleri olduğu gibi güncel sürümün `server\src\eslestir.ts`'ine verir (aynı Node, aynı ortam; çıkış kodu aynen döner): seçeneksiz telefon (sohbet) için 5 dk'lık kod ve QR, `--ajanda` ajanda uygulaması için, `--liste`, `--kaldir <kimlik>`, `--claude-code [--liste|--kaldir|--teshis]` PC'deki Claude Code oturumlarının ajanda anahtarı ve teşhisi ("Claude Code oturumları") (ayrıntı `eren eslestir --yardim`). Önce `eren baslat` gibi kabuktaki `EREN_KIT_DATA_DIR`'i kalıcı ortamla karşılaştırır: farklıysa hiçbir şeye dokunmaz (kod servisin okumadığı veritabanına yazılırdı). Kurulu sürüm yoksa 1 ile çıkar. Depodaki kaynaktan değil güncel sürümden çalışır: servisle aynı kod aynı veritabanına yazar. |

`eren dur` ve `eren baslat` de eski kurulum korumasına ("Eski kurulum korumaları") tabidir: koruma bir sorun bulursa hiçbir şeye dokunmadan durur ("eren dur durdu, hiçbir şey değişmedi") ve sıfırdan farklı kodla çıkar. Eski veri kökü doluyken bilerek sürdürmek için ikisi de `--eski-koku-yoksay` alır (başka seçenek "Bilinmeyen seçenek" hatasıdır). Servis yanlış veri kökünde bulunduğu için kurulum ya da `eren baslat` görevi kapattıysa servis `eren baslat` ile, ortam düzeltildikten sonra açılır; bu kez kök doğrulaması geçerse servis kalır.

Bekçi çalışmıyorsa `yeniden-baslat` ve `dur` "Bekçi çalışmıyor" der (`dur` görevi yine de kapatmış olur); `eren baslat` ile kaldırılır. `eren durum` kapalı görevi "görev kapalı" diye belirtir.

## Telefon kurulumu

Telefon uygulamasının erişilebilirlik servisini kendisi açabilmesi ve kısayolda ön plandaki uygulamayı görebilmesi için bir kerelik adb kurulumu gerekir. Telefonu USB ile bağla ve çalıştır:

```
node --disable-warning=ExperimentalWarning kurulum/telefon.ts
```

Önce telefonda "USB hata ayıklama" açık olmalıdır; bazı üretici arayüzlerinde ayrıca "USB hata ayıklama (Güvenlik ayarları)" açılır (aksi halde izin verilemez). Komut `WRITE_SECURE_SETTINGS` iznini ve `GET_USAGE_STATS` kullanım erişimini verir ve sonucu `dumpsys`/`appops` ile doğrular. Bittikten sonra USB hata ayıklamayı kapat (servis `device_state.adb_enabled` açıldığında uyarır). Telefona kurulan release APK kendi keystore'unuzla imzalanmış olmalıdır (`README.md` "Release derlemesi ve imza"); debug imzalı eski bir kurulumdan geçerken uygulama kaldırılıp yeniden kurulur. Uygulama kaldırılıp yeniden kurulursa izinler gitmiş olabilir; `kurulum/telefon.ts` doğrulamayı yeniden yapar, gerekirse tekrar çalıştır. İzinler olmadan telefon planları onay ekranında kalır (`erisim_acilamadi`) ve kısayol bağlam almaz.

## Servis bilgisi telefonda

`server_status.servis` (`/sohbet` v2'den beri; şimdiki sürüm v5) `{surum, baslangic_ms}` taşır ve telefonun durum ekranında görünür. `surum`, çalışan sürümün `surum.json` dosyasındaki `sha` değeridir (sürüm adı; `kur.ts` yazar; geliştirme kopyasından çalışıyorsa dosya yoktur ve `surum` `null` olur). `baslangic_ms` servis sürecinin başladığı andır (epoch ms). Güncelleme ya da geri almadan sonra telefondan "doğru sürüm mü, ne zaman başladı" bakılabilir; `eren durum` aynı bilgiyi terminalde verir.

## Çoklu sohbet ve ayarlar

Dilim 2'den beri her sohbetin kendi ana oturum konuşması (kendi Claude oturum zinciri) vardır; ana oturum süreci sohbet başına geçicidir: süreci olmayan sohbet `uyuyor` durumundadır, mesaj gelince `--resume` ile açılır. Aynı anda canlı süreç sayısı sınırlıdır. Sınır iki alanla ayarlanır, ikisi de `<veri kökü>\ayar.local.json` içindedir:

| Alan | Varsayılan | Aralık | Anlamı |
|---|---|---|---|
| `eren_canli_azami` | 2 | 1-4 (tam sayı) | Aynı anda süreci olan (açılan dahil) en çok ana oturum sayısı. Devirde bir sohbet geçici olarak +1 kullanır (devir adayı yuva saymaz). |
| `eren_bosta_kapat_dk` | 30 | 1-1440 (tam sayı, dakika) | Tur yok, kuyruk boş, devir ve yeni sayfa yokken bu kadar boşta kalan sohbetin süreci kapanır. Mesaj gelince aynı nesil `--resume` ile açılır. |

Aralık dışı ya da tam sayı olmayan değer ayar hatasıdır: servis açılışta kalkmaz (bekçinin erken çıkış kuralı geri çekilir, `servis.log`'da `baslatma_hatasi`). Değişiklik servis yeniden başlayınca geçerli olur (`eren yeniden-baslat`).

- **Sıra.** Yuvalar doluysa yeni sohbet beklemeye girer (durum `sirada`); mesajlar kuyrukta kalır ve ilk boşalan yuvada FIFO sırasıyla açılır. Yönetici bekleyen için en uzun boşta kalan canlı sohbeti uyutur (hiçbiri boşta değilse en eski etkinlikli olanı; tur sürüyorsa tur bitince kapanır).
- **RAM kapısı.** Boş RAM `ramDusukMb + 768` MB'ın altındaysa yeni süreç açılmaz; sohbet `sirada` kalır ve RAM `ramYoklamaMs` arayla yeniden sınanır. Devir bu sınırdan muaftır ama kendi RAM sınamasından geçer.
- **Boşta kapatma servis kararıdır:** hata sayılmaz, olay yazılmaz, jeton iptal edilir, nesil mcp dosyası silinir. Yoklama dakikada bir yapılır, yani kapanma en çok yaklaşık 1 dk geç olur.
- **Kilit.** Limit kilidi aktifken bütün ana oturum süreçleri kapanır ve sohbetler `kapali` olur; kilit açılınca süreci ya da kuyruğu olanlar yeniden açılır.

Tam yetki anahtarı da aynı dosyadadır:

- **`tam_yetki`** (mantık değeri, varsayılan `true`): `ayar.local.json` içindeki PC tarafı tam yetki anahtarı. Doğruysa PC planları (insan turu ya da sentetik, kirli kaynaklı dahil) onay beklemeden başlar; limit kilidi yine önce gelir. `rapor_oku` kirli raporun gövdesini de çitli verir (`kirli: true` ve `kirli_okundu` kalır). Telefon planlarını etkilemez; telefonun tam yetkisi ayrı bir bayraktır ve telefondan açılır. Kapatmak için `"tam_yetki": false` yazıp `eren yeniden-baslat`; kapalıyken eski davranış (PC planı kullanıcıdan onay bekler, kirli rapor gövdesi verilmez). Mantık değeri olmayan değer ayar hatasıdır.

Telefonun durum ekranındaki sohbet durumları `server_status.sohbetler` içindedir: silinmemiş her sohbet için `{sohbet_id, eren}`; `eren` değerleri `baslatiliyor`, `hazir`, `tur_suruyor`, `kapali`, `uyuyor`, `sirada`. Küresel alanlar (`kilitli`, `aktif_is`, RAM, `servis`, `limit`) ortak kalır.

## Ajanda

Ayrı ajanda uygulaması (yapılacaklar ve takvim) servise aynı porttan `/ajanda` yoluyla bağlanır; kayıtları telefondaki sohbetin ana oturumu da araçla ekler (`docs/AJANDA.md`). Servis tarafında ayar yoktur; sürüm kurulunca açıktır.

- **Eşleştirme.** PC'de `eren eslestir --ajanda` 5 dakikalık tek kullanımlık kod ve QR üretir (QR'da `kanal:"ajanda"`; sohbet uygulaması bu QR'ı, ajanda uygulaması sohbet QR'ını reddeder). Ajanda uygulamasında okutulur; cihaz ajanda kapsamıyla kaydedilir ve yalnız `/ajanda`'yı açabilir. Aynı anda tek pencere açıktır: yeni kod, hangi kapsamda olursa olsun, öncekini geçersiz kılar. Ajanda cihazlarını görmek `eren eslestir --ajanda --liste`, kaldırmak `eren eslestir --ajanda --kaldir <kimlik>` (sohbet cihazına dokunmaz; kapsamsız `--kaldir` her ikisinde çalışır).
- **Ana oturum.** Her nesil mcp dosyasında `eren`'in yanında `eren-ajanda` köprüsü durur (`kopru.ts --rol ana_oturum`, boru `\\.\pipe\eren-ajanda`, nesil kapsamlı jeton). Ana oturuma giden her kullanıcı satırı `[mesaj_ani: <tarih> <gün> <saat> <dilim>]` damgasıyla başlar; telefona ve olay günlüğüne girmez. Dilim PC'nin sistem dilimidir: servis her hesapta `Intl`'e yeniden sorar, ama Node (V8/ICU) varsayılan dilimi süreç içinde önbellekte tutar ve Windows ayarı değişince yenilemez. Servis çalışırken Windows saat dilimi değişirse damga ve ondan dilim alan yeni girdiler (dilimsiz zaman, `mutlak` hatırlatma) servis yeniden başlatılana kadar eski dilimle hesaplanır; dilim değişince servisi yeniden başlat. Var olan ana oturum `--resume` ile eski sistem istemini korur (`GUVENLIK.md` 15e); ajanda araçları ve damga yine gelir.
- **Açılış ve kapanış.** `ana`: kilit → ajanda modülü (depo kimliği) → eski ajanda jetonlarının silinmesi → ajanda borusu → `eren` borusu → (bugünkü sıra) → gateway (`/ajanda` dahil) → sohbetler. Ajanda borusu açılamazsa (ad başka süreçte) servis açılmaz, `servis.log`'da `baslatma_hatasi`. Kapanışta `/ajanda` bağlantıları gateway'le, ajanda borusu `eren` borusundan sonra kapanır.
- **Veri.** Ajanda tabloları `eren.db`'dedir (ek göç 6): kayıtlar, geçmiş (budanmaz), işlem sonuçları, ajanda cihazları ve penceresi, ajanda jetonları ve kuyruk satırlarının varış anı (`kuyruk_ekleri`; metin yok). "Geçmişi sil" ve "sohbeti sil" ajandaya dokunmaz. Kayıt metni `servis.log`'a yazılmaz; günlükte yalnız kimlik, revizyon ve kod görünür (`ajanda_esitlendi`, `baglanti_ret`, `eslestirme_ret`).
- **Geri alma.** `kur.ts --geri-al` güvenlidir: eski sürüm ek göç 6'nın tablolarını görmez, veritabanını açar ve ajanda cihazına hiçbir kanal açmaz (cihaz ayrı tablodadır). Geri alınmışken ajanda uygulaması bağlanamaz (yol yoktur), ana oturumun ajanda araçları ve damga yoktur; sohbet uygulaması etkilenmez (`/sohbet` v5 değişmedi). Yeniden ileri alınca kayıtlar, revizyon sayacı ve depo kimliği yerindedir; uygulama artımlı telafiyle sürer. Eski kodun bu arada yazdığı kuyruk satırlarının varış anı yoktur: o satırların damgası satırın oluşturma anından hesaplanır.
- **Ajanda sürüm 2 (`AJANDA_SURUMU` 2).** Saatsiz gün kaydında hatırlatma o günün sabit saatinde çalar (gün bölümüne göre 08:00-20:00, bölüm yoksa 09:00; hesap uygulamadadır, servis listeye bir şey eklemez); kayıt zamanına isteğe bağlı gün bölümü (`gun_bolumu`) girdi; araç çıktısı günü adıyla taşır; mesaj anı 00:00-04:00 arasındaysa insan turundaki tarihe bağlı ajanda çağrısı teyit ister (yoksa `gece_teyidi_gerekli`, kayıt yazılmaz; sentetik turda istenmez). Göç yoktur: v1'de yazılmış kayıtlar, geçmiş ve tekrarsızlık satırları olduğu gibi okunur, yayınlanır ve güncellenir (`test/ajanda-v1-veri.test.ts`); tek davranış farkı, v1'in saatsiz gün kayıtlarının `once`'ları artık o günün 09:00'ında çalar. **Kurulum sırası:** servis ve ajanda uygulaması birlikte güncellenir, sıra önemli değildir. Servis önce kurulursa v1 uygulaması her bağlanışta el sıkışmada `{v:2, error, protokol_uyumsuz}` + 1002 alır ("uygulamayı güncelle"): eşitleme olmaz, yerel kopyası, alarmları (v1 kuralıyla) ve işlem kuyruğu durur; ana oturum bu arada kayıt eklemeyi sürdürür, uygulama güncellenince aynı eşleşmeyle (yeniden eşleştirme yok) artımlı telafiyle alır. Uygulama önce güncellenirse eski servis de simetrik olarak `protokol_uyumsuz` verir. Sohbet uygulaması ve `/sohbet`, `/cihaz` hiçbir sırada etkilenmez. **v2'den v1 servise geri alma** veritabanını bozmaz (şema değişmedi), ama v2'nin yazdığı `gun_bolumu`'lu kayıtları v1 kodu katı şemasıyla tanımaz: v1 serviste o kayıtlar güncellenemez (`tutarsiz_kayit`), içinde böyle kayıt olan `ajanda_listele` ve eş bulunan `ajanda_ekle` çıktısı köprüde `ic_hata` olur, v1 uygulamasına giden `kayit` çerçevesi ve böyle kaydın geçmiş sayfası uygulamada çözülemez. Geri alınacaksa ajanda uygulaması da v1'e alınmalı ve bölümlü kayıtlardan bölüm (uygulamadan saat ya da bölümsüz gün vererek) önce kaldırılmalıdır (geçmiş satırlarında bölüm kalır); ileri alınca her şey yerindedir.

## Claude Code oturumları

PC'deki normal Claude Code oturumları (terminal ya da masaüstü uygulaması) ajandanın üç aracını (`ajanda_ekle`, `ajanda_guncelle`, `ajanda_listele`) kullanabilir. Kurallar `AJANDA.md` "PC oturumları", güvenlik `GUVENLIK.md` "Ajanda" ve 47-55. Kayıt kullanıcı kapsamındadır (her proje, her oturum). Ana oturumun ajanda çağrısı kayıt doğrudan (taslaksız) yazar; alt agent'ınki, `-p`/SDK oturumununki ve kancayla eşleşmeyen her çağrı taslak doğar. Servisin kendi açtığı oturumlar MCP köprüsünü görmez (`--strict-mcp-config`); kanca ise ayardadır: telefon sohbeti ve telefon işleri kullanıcı ayarlarını hiç yüklemez (`--setting-sources ""`), `tam` profilli PC işleri yükler, ama ortamlarındaki `EREN_KIT_SERVIS_OTURUMU=1` ile kanca orada hiçbir şey yapmaz (`AJANDA.md` "Servisin kendi oturumları"). Komutların ve yolların tek kaynağı `kurulum/claude-code.ts`'tir (`yollar`: veri kökünden `uygulama\guncel\...`); `eren eslestir --claude-code` aynı metni yazar. Üç parça vardır:

1. **Anahtar** (servisin veri kökünde): `eren eslestir --claude-code`. Güvenli üreteçten anahtar üretir, `eren.db`'ye yalnız özetini yazar (önceki anahtar aynı anda geçersiz), düz anahtarı `<veri kökü>\ajanda-pc.anahtar`'a yazar ve aşağıdaki iki adımın tam komutlarını bu makinenin yollarıyla basar (metin kurulu sürümün `kurulum/claude-code.ts` `kayitYonergesi`'nden; yollar `guncel` bağlantısından, sürüm dizininden değil: güncellemeden sonra da geçerli kalır). Servis çalışırken yapılabilir; yeniden başlatma gerekmez.
2. **MCP köprüsü** (kullanıcının `~/.claude.json`'una bir girdi): `claude mcp add eren-ajanda -s user -- <node.exe> --disable-warning=ExperimentalWarning <veri kökü>\uygulama\guncel\server\src\kopru.ts --rol pc_oturumu`. Yol kurulu sürümdür (`guncel` junction'ı dağıtımla döner, kayıt değişmez); `node.exe` servisin Node'u (24+). Köprü `EREN_KOPRU_JETON` istemez, anahtarı her bağlanışta dosyadan okur.
3. **Kanca** (kullanıcının `~/.claude\settings.json` `hooks`'una tek girdi): PreToolUse, matcher `mcp__eren-ajanda__.*`, yürütme biçiminde (kabuksuz): `"command": "<node.exe>"`, `"args": ["--disable-warning=ExperimentalWarning", "<veri kökü>\\uygulama\\guncel\\server\\src\\kanca.ts", "arac"]`, `timeout` 10 sn. Claude Code süreci doğrudan başlatır; Git Bash'e ya da PowerShell'e bağlı değildir (ölçüm: önceki kabuk biçimi Git Bash'te çalışıyor, PowerShell'de ayrıştırılamıyordu; `AJANDA.md` "Ölçüm"). Yalnız ajanda araçlarından önce çalışır; mesajlarda, öteki araçlarda ve tur sonunda çalışmaz, mesaj metnini ve araç girdisini okumaz. Ana oturumun çağrısını alt agent'ınkinden ayıran budur. `kanca.ts` hafif girişdir (MCP kitaplığını ve zod'u yüklemez; ölçüm: kanca 84 ms, çıplak Node 44 ms). Kancanın 2 ile çıkışı Claude Code'da "engelle" demektir (aracı durdurur); `kanca.ts` her durumda 0 döner, stdout ve stderr'e yazmaz, Node'un kendisi hiçbir hatada 2 ile çıkmaz (betik yoksa 1: engellemeyen hata), bu yüzden `|| true` gerekmez. `apps/phone` içinde (ya da kurulu `guncel\kurulum\`) `node --disable-warning=ExperimentalWarning kurulum/claude-code.ts goster` tam metni hiçbir şeye dokunmadan yazar; `... claude-code.ts kanca-ekle` ayar dosyasını yedekleyip (`settings.json.yedek-<zaman, ms>`; aynı anda ikinci işlem `-1`, `-2` … ekler, hiçbir yedek ezilmez) yalnız bu girdiyi ekler, başka anahtara ve kancaya dokunmaz, tekrar çalıştırmak aynıdır (`--ayar <yol>` başka dosya için); önceki kurulumun istem (UserPromptSubmit) ve tur sonu (Stop) kancalarını ve eski biçimli girdileri (`kopru.ts --kanca`) çıkarır, kabuk biçimli araç kancasını yürütme biçimine çevirir. `settings.json` sembolik bağsa ya da `.claude` bir junction ise yazma bağın hedefine yapılır, bağ kalır; UTF-8 BOM'lu dosya BOM'lu kalır (Claude Code okur); UTF-16 dosya, bozuk JSON (ayrıştırıcının iletisiyle) ve hedefi olmayan bağ adıyla reddedilir, dosyaya dokunulmaz. Kancasız da çalışır, ama o zaman her ekleme taslak doğar (uygulamadan onay ister); araç çıktısı ve teşhis bunu söyler.

İsteğe bağlı: araçlar her çağrıda izin sormasın diye `settings.json` `permissions.allow`'a `mcp__eren-ajanda__ajanda_ekle`, `mcp__eren-ajanda__ajanda_guncelle`, `mcp__eren-ajanda__ajanda_listele`. Açık oturumlar MCP sunucusunu ve kancayı yeniden açılınca görür. Saat: PC oturumunda mesaj damgası yoktur; asistan "şimdi"yi tarihli kayıttan önce `ajanda_listele` çıktısından öğrenir (araç açıklaması söyler), bayat saatle verilen dayanak reddedilir.

- **Doğrulama (varsayımların sınanması).** Yeni bir oturumda `claude mcp list` `eren-ajanda` için `Connected` demeli. "Yarın 10'da deneme randevusu, ajandaya ekle" deyin: asistan günü adıyla söylemeli, ajanda uygulamasında kayıt taslaksız görünmeli; kaynağı `pc_araci`. Sonra `eren eslestir --claude-code --teshis`: önce kanca kurulumu (araç öncesi kanca kullanıcı ayarında kurulu mu, önceki kurulumdan kalan istem/tur sonu kancası var mı), sonra servis günlüğünden son PC olayları (izinli alanlar: alt agent mı, etkileşimsiz mi, istem kimliği var mı, çağrı kimliği var mı, karar, sonuç; metin, kayıt alanı ve tam kimlik yok) ve bir özet: son kararın kullanıcıya anlamıyla. Beklenen: kanca kurulu, araç öncesi kanca servise ulaşıyor, çağrı kimliği MCP isteğinde geliyor, son karar `insan`. Bir alt agent'a kayıt ekletin: karar `alt_agent`, kayıt taslak olmalı. Taslak doğduysa araç çıktısındaki `pc_tur: sentetik (<karar>)` satırı ve teşhis nedeni söyler (`AJANDA.md` "Kurulumdan sonra sınama").
- **Kaldırma.** Sırayla: `node --disable-warning=ExperimentalWarning kurulum/claude-code.ts kanca-kaldir` (yedekleyip yalnız bu aracın kancalarını, eskileri dahil, çıkarır), `claude mcp remove eren-ajanda -s user`, `eren eslestir --claude-code --kaldir` (anahtar geçersiz, dosya silinir; açık oturumların köprüsü bir sonraki çağrıda reddedilir). Yalnız anahtarı yenilemek (sızdıysa): `eren eslestir --claude-code` (kayıt ve kanca aynı kalır). Durum: `eren eslestir --claude-code --liste`.
- **Önceki kurulumdan geçiş.** İstem ve tur sonu kancalı kurulum güncellenince o iki girdi hiçbir şey yapmaz (kanca o olaylarda stdin'i okumadan çıkar, damga yazmaz) ama her mesajda bir Node süreci başlatır: `kanca-ekle`'yi bir kez yeniden çalıştırın; teşhis kalan eski kanca sayısını gösterir.
- **Servis kapalıyken.** Oturum bozulmaz: köprü açılır, araçlar listelenir; çağrı en çok 3 sn bekler ve "hiçbir şey yazılmadı" der (kuyruk yok, bilinçli). Kanca sessizce geçer. Servis gelince köprü kendiliğinden bağlanır; araya düşen tasdik kaybolduğu için o çağrı taslak doğar.
- **Geri alma.** `kur.ts --geri-al` PC yolundan önceki bir sürüme dönerse: eski köprü `--rol pc_oturumu`'yu tanımaz ve 2 ile çıkar (Claude Code `eren-ajanda`'yı `Failed` gösterir, oturum çalışır), `guncel\server\src\kanca.ts` bulunamaz ve Node 1 ile çıkar; 1 engellemeyen kanca hatasıdır, araç engellenmez (Claude Code hatayı gösterir; `kanca-kaldir` ile susturulur). Yürütme biçimini (`args`) tanımayan eski bir Claude Code'da beklenen (denenmedi): `command` kabukta tek başına çalışır, boşluklu Node yolu bölünür ve kanca 2 dışı bir kodla, engellemeden düşer; kayıtlar taslak doğar, teşhis "kurulu görünüyor ama tasdik gelmedi" der. İstem/tur sonu kancalı önceki PC sürümüne dönülürse o sürüm yalnız araç öncesi kancayla her kaydı taslak doğurur (güvenli taraf); onun kurulumu için o sürümün `kanca-ekle`'si gerekir. Veritabanı bozulmaz (ek göç 7 yalnız yeni tablo). İleri alınca anahtar yerindedir.

## Bekçinin kuralları

Kararlar `server/src/bekci.ts` içindeki saf çekirdektedir; sayılar oradaki varsayılanlardır ve G/Ç katmanı (`bekci-ana.ts`) bunları değiştirmez.

- **Geri çekilme.** Ana istemeden çıkarsa bekçi bekler, sonra yeniden başlatır. Ardışık başarısız denemede bekleme 1, 2, 5, 10, 30, 60 sn olur ve 60 sn'de sabitlenir. Ana 10 dakika ayakta kalmışsa (kararlı) sayaç sıfırlanır. Başlatılamama (`ana_baslatilamadi`) aynı kuralla sayılır.
- **Nabız ve donma.** Bekçi 30 sn'de bir ana'ya IPC ile `nabiz` yollar; ana aynı `n` ile cevap verir. Üst üste 3 cevapsız nabızdan sonra (başlangıçtan yaklaşık 2 dk) ana donmuş sayılır: `ana_donmus` yazılır ve ana zorla öldürülür, ardından geri çekilmeyle yeniden başlar. Yalnız en son gönderilen `n`'in cevabı sayacı sıfırlar.
- **Erken çıkış.** Ana 15 sn dolmadan çıkarsa (ikinci örnek, bozuk ayar gibi) `ana_erken_cikti` yazılır ve bekleme en az 30 sn olur.
- **Fırtına.** 10 dakika içinde 8 yeniden başlatma olursa `firtina` yazılır ve her deneme arası 5 dakika beklenir; pencere içindeki sayı 8'in altına inene dek sürer.
- **İstenen kapanış.** `yenile` ve `kapan` ana'ya IPC ile `kapat` yollar. Ana 40 sn içinde çıkmazsa zorla öldürülür; öldürme çıkış gelmezse 40 sn'de bir yinelenir. `yenile` ile gelen çıkış geri çekilmeyi ve yeniden başlatma sayısını artırmaz. Kapanış sürerken ikinci komutta `kapan` her zaman kazanır.
- **Öldürme ağaç değildir.** Zorla öldürme `/T`'siz yapılır (önce süreç tutamacı, olmazsa `taskkill /PID <pid> /F`): `/T` `detached` iş oturumlarını da öldürürdü. İş oturumları servis ölünce yaşar, sonraki açılış onları sahiplenir.
- **Ana çocuğu.** Ana, bekçinin çocuğu olarak IPC kanalıyla başlar (`detached` değil). Bekçi nazikçe çıkarken ana'ya `kapat` gönderir. Bekçi dışarıdan ya da sert ölürse durum farklıdır (aşağıda "Bilinen sınırlar").
- **Bekçinin kendi kapanışı.** SIGINT, SIGTERM, SIGBREAK ve SIGHUP `kapan` gibi işlenir. Yakalanmamış hata olursa ana'ya `kapat` gönderilir (en çok 35 sn beklenir: ana'nın kendi 30 sn kapanış sınırından uzun) ve `exit(1)`.
- **Log.** Bekçi `gunluk.ts`'i kullanmaz; kendi küçük kaydedicisi `<veri kökü>\logs\bekci.log`'a `servis.log` ile aynı JSON satır biçiminde yazar (`modul:"bekci"`), 1 MB'ta döner, `bekci.1.log` ve `bekci.2.log` tutulur. Neden ayrı: `gunluk.ts` `kod` anahtarını gizler, oysa çıkış kodu burada yazılması gereken değerdir. Günlüğe yalnız sayı, kimlik ve kapalı liste değeri girer; yol ve hata iletisi girmez. Stdout ve stderr'e yazılmaz.

Önemli bekçi olayları: `bekci_basladi`, `ana_baslatildi`, `ana_cikti {kod, yasam_ms, bekleme_ms}`, `ana_erken_cikti`, `ana_donmus`, `firtina`, `ana_zorla_olduruldu`, `komut_alindi`, `bekci_ikinci_ornek`, `bekci_cikiyor`.

## Bilinen sınırlar

- **Hesapta oturum açılmazsa hiçbir şey çalışmaz.** Görev `InteractiveToken` ve oturum açılış tetiğiyle çalışır; oturum olmadan bekçi de ana da başlamaz. Referans makinede parolasız yerel hesap kullanıldığı ve otomatik oturum açıldığı için yeniden başlatma sonrası servis kendiliğinden kalkar. Hesaba parola konursa ya da otomatik oturum açma kapanırsa durum değişir: oturum açılana kadar servis kapalı kalır (Windows Update yeniden başlatması dahil). Otomatik oturum açma kullanıcının kararıdır, repo bunu ayarlamaz.
- **Bekçi dışarıdan ya da sert ölürse ana da hemen ölür.** Ana `detached` değil; bekçi sert ölünce Node'un libuv iş nesnesi yüzünden ana da anında sonlanır. Ana'daki IPC `disconnect` ile nazik kapanış bu durumda çalışmaz (nazik kapanış yalnız bekçi kendi eliyle çıkarken `kapat` gönderebildiğinde olur). Geri getiren 5 dakikalık Görev Zamanlayıcı tetiğidir, kesinti en çok yaklaşık 5 dakika sürer. Toparlanma sonraki açılışta olur: ana oturum süreci için `konusma`'daki `eskiSurecTemiz`, iş oturumları için `isler.uzlastir`. İş oturumları (`detached`) bu sırada yaşar.
- **Geri alma veritabanı şemasını geri almaz, ama ek göçlü şemayı eski sürüm açar.** `PRAGMA user_version` yalnız geriye uyumsuz göçte artar ve bugün 1'dir; yalnız ekleme yapan göçler `sema_ek` tablosunda sayılır (Dilim 1: `planlar.profil`, varsayılanlı sütun; ek göç 2: `eren_oturumlari` tablosu ve `events(type)` dizini, eski kod ikisini de görmez ya da SQLite kendisi günceller; Dilim 2, ek göç 3: `sohbetler` tablosu ve diğer tablolara varsayılanı `ana` olan `sohbet_id` sütunu, eski kod hepsini tek sohbet gibi görür: `--resume` bütün sohbetlerin en büyük neslini açar, geçmiş silme bütün sohbetleri temizler, veri bozulmaz; ek göç 4: `tuketim` tablosu (token tüketimi kaydı) ve dizinleri, yeni tablodur, eski kod görmez ve dokunmaz, veri bozulmaz; ek göç 6: ajanda tabloları, yalnız yeni tablo ve dizin, `ALTER` yok, bkz. "Ajanda" > "Geri alma"). Eski sürümün kodu `user_version` aynı kaldığı için bu veritabanını açar ve eski `INSERT`'leri geçer (hepsi sütun adı yazar, yeni sütun varsayılanlıdır); depo agent'ı bunu deneyle doğruladı (eski kod yeni şemalı veritabanını açtı, `profil` satırı `tam` okundu). Geri alınan eski sürüm yeni sütunu bilmez ve yok sayar. `user_version` artıran geriye uyumsuz bir göç gelirse bu garanti geçerli olmaz: eski kod o veritabanını açamaz, geri almadan önce yedekten dönmek gerekir.
- **Geri alma ve telefon: eski sohbet protokollü sürüme dönünce telefon bağlanamaz.** `SOHBET_SURUMU` şu an 5 (v5: plandan `kesin_yapilacaklar`/`kesin_yapilmayacaklar` kalktı, `usage_request`/`usage_report`; v4: telefon kullanma, kısayol `baglam`'ı; v3: çoklu sohbet, `sohbet_id`, `server_status.sohbetler`; v2: `chat_clear`, `server_status.servis`). Sürüm eşleşmesi tam olmalıdır (v5 ↔ v5; uygulama 0.5.0 ve 0.6.0 ikisi de v5'tir, 0.6.0 sürümü artırmadı): sürümü artırmayan eklemeler (canlı etkinlik, `?yetenek=etkinlik1`) yetenek jetonuyla gelir, bu yüzden 0.6.0 uygulama v5 konuşan eski servise bağlanır ve bugünkü gibi çalışır (etkinlik gösterimi ve sesli cevap yoktur), 0.5.0 uygulama 0.6.0 servise bağlanır ve etkinlik çerçevesi görmez. Ama v0.5.0 (v5) telefon uygulaması v4 konuşan servise, v0.4.0 (v4) telefon uygulaması v3 konuşan servise, v0.3.0 (v3) uygulama da v4 servise bağlanamaz (`protokol_uyumsuz`); telefon uygulaması ve servis aynı `/sohbet` sürümünde olmalıdır. Servisi geri alırsan (v4 → v3) telefon da v0.3.0'a dönmelidir; tersi için (uygulama v0.3.0, servis v4) servis ya da uygulama ileri sürüme getirilene kadar sohbet kapalıdır. `kur.ts` geri alırken (`--geri-al` ve otomatik geri alma) bunu uyarı olarak yazar, geri almayı engellemez. Servisi geri alıp telefonu eski uygulamaya çevirmek ayrı bir iştir; `/cihaz` v1 olduğu için o kanal etkilenmez.
- **İki `kur.ts` aynı anda çalıştırılmamalı.** Kilit yoktur; çakışan çalıştırmalar aynı `guncel` ve `gecmis.json` üzerinde yarışır.
- **Üç kurulum, süren işin köprü dosyasını silebilir.** Bir iş sürerken üç kurulum yapılırsa, işin köprü dosyasını taşıyan sürüm eski sürüm temizliğinde (en yeni 3 tutulur) silinebilir.
- **Görev Zamanlayıcı geçmişi çöküşü göstermez.** `LastResult` 0 olur, görev `Ready` görünür. Çöküşe `bekci.log` ve `servis.log` bakılarak karar verilir.
- **Kopuk masaüstü oturumu.** Oturum `Disc` durumundayken servis, OAuth ve `claude -p` çalışır; `computer-use-windows` pencere listesini okur ama ekran görüntüsü alamaz (`masaustu.md` 4).
- **Pil.** Referans makine taşınabilir bilgisayardır; prizde uyku kapalıdır, pilde 4 dk'da uyur ve servis askıya kalır.
- **`dis-dunya.test.ts` canlı servisle çakışır.** Aynı tekil boruyu kullanır; servis açıkken bu test dosyası çalıştırılmaz. `kur.ts` test kapısı onu zaten dışarıda bırakır.
- **Tek kilit.** Bekçi için `\\.\pipe\eren-bekci`, ana için `\\.\pipe\eren-servis-tekil`. Ana elle başlatılırsa (bekçisiz) bekçi onu kontrol edemez; `eren durum` "bekçi çalışmıyor" der ve ana'nın tekil kilidi yüzünden bekçinin başlattığı ana `ikinci_ornek` ile çıkar, erken çıkış kuralı geri çekilir.
- **Ölçülmeyenler:** oturum açılış tetiğinin gerçek ateşlenmesi (`masaustu.md`), saatlerce `conhost --headless` altında çalışma, `Active` oturumda gözle doğrulama.

## Ölçülenler

Referans makinede canlı ölçümler:

- Ana zorla öldürüldü: bekçi 2,0 sn'de yeniden kaldırdı.
- Bekçi zorla öldürüldü: ana da 2 sn içinde öldü. 5 dakikalık zaman tetiği 3 dk 14 sn sonra her şeyi geri getirdi; en kötü kesinti yaklaşık 5 dk.
- Süreç ağacının hepsi Normal öncelikte.
- Güncelleme dağıtımı test kapısı dahil 57 sn sürdü.
- `--geri-al` ve ileri dönüş birkaç saniye sürdü.
- `eren dur` ardından `eren baslat` 1 sn altında tamamlandı (kök doğrulaması eklenmeden önceki ölçüm; `eren baslat` artık ana 5 sn ayakta kalana dek bekler, yeniden ölçülmedi).

## Sorun giderme

| Belirti | Bak |
|---|---|
| Servis çalışıyor mu, hangi sürümde? | `eren durum` ya da `kur.ts --durum` |
| Ana neden yeniden başladı? | `eren log --bekci`: `ana_cikti` (çıkış kodu, yaşam süresi), `ana_donmus`, `ana_erken_cikti`, `firtina` |
| Servisin kendi hatası | `eren log` (`servis.log`: `yakalanmamis_hata`, `baslatma_hatasi`, `ikinci_ornek`, `kapaniyor`) |
| Bekçi hiç yok | `eren baslat`; olmazsa görev kayıtlı mı (`eren durum`), kayıtlı değilse `gorev-kaydet.ts` |
| `kur.ts` "servis kararlı çalışmadı" dedi | Mesaj "otomatik geri alındı" diyorsa servis önceki sürümde çalışıyordur (`kur.ts --durum` ile doğrula), `--geri-al` gerekmez; nedeni `eren log --bekci` ve `eren log` ile bul. "Önceki sürüm de ayakta kalmadı" ya da "önceki sürüm yok" diyorsa servis kapalı olabilir, elle bak |
| `kur.ts` "görev kapalı" dedi | `eren baslat` (önce `eren dur` ile kapatılmıştır), sonra yeniden dene |
| `eren baslat` "veri kökünde çalıştığı doğrulanamadı" dedi | Servis durdurulmamıştır. `eren durum` (bekçinin veri kökü, `UYARI:`) ve `eren log` ile bak; "kararlı çalışmadı" ise nedeni `eren log --bekci`. Kök yanlışsa servis durdurulmuş ve görev kapatılmıştır: ortamı düzeltip (oturumu kapatıp açın) yeniden `eren baslat` |
| Servis açılmıyor, `servis.log`'da `baslatma_hatasi` + "veri kökü başka hesaplara açık" | Veri kökü yalnız bu hesaba, SYSTEM'e ve Administrators'a açık olmalı. `apps/phone` içinde `node --disable-warning=ExperimentalWarning kurulum/kur.ts --izin-duzelt`; o hesaplara güvenmiyorsanız eşleşmeleri ve sunucu anahtarını yenileyin (`docs/GUVENLIK.md` "Denetimde kapatılan bulgular") |
| Çok sık yeniden başlıyor | `bekci.log`'da `firtina` var mı; sebebi `servis.log`'da (bozuk ayar, kilitli dosya) |
| Ana ikinci örnek diyor | Başka bir ana (elle başlatılmış) tekil kilidi tutuyor; `eren durum` ve `Get-Process node` ile bak, elle başlatılanı kapat |
| Görev kayıtlı mı, ayarı doğru mu? | `schtasks /query /tn <görev adı> /xml`; yeniden kaydetmek için `gorev-kaydet.ts` |
| Pencere açıldı | Görev `conhost --headless` ile başlamıyordur; `gorev-kaydet.ts --goster` çıktısıyla kaydı karşılaştır |
| Kısayol bağlam taşımıyor | `kurulum/telefon.ts` çalıştı mı (`GET_USAGE_STATS`); telefonda kullanım erişimi izinli mi |
| Telefon planı yine onay ekranı istiyor | Telefonda tam yetki kapalı olabilir; ya da `erisim_acilamadi` (`WRITE_SECURE_SETTINGS` verilmemiş, `kurulum/telefon.ts`), `uygulama_listede_degil` ya da `hassas` |
| PC planları hâlâ onay bekliyor | `ayar.local.json`'da `"tam_yetki": false` mı; değişiklikten sonra `eren yeniden-baslat` |
| Ajanda uygulaması bağlanamıyor ya da eşleşemiyor | `eren durum` (çalışan sürüm ajandalı mı); `eren eslestir --ajanda --liste`; `eren log`'da `gateway` `baglanti_ret` ya da `eslestirme_ret` varsa nedeni `servis.log` satırının `kanal:"ajanda"` ve `code` alanında (`kanal_desteklenmiyor`: cihaz ajanda kapsamlı değil; `eslestirme_kapali`: pencere yok, süresi geçti ya da sohbet penceresi; `cihaz_bilinmiyor`: kaldırılmış) |
| `eren eslestir --ajanda` "bilinmeyen seçenek" dedi | Güncel sürüm ajandadan eski; `kur.ts` ile güncelleyin |
| Claude Code: `eren-ajanda` `Failed` ya da araç yok | `claude mcp list`; komuttaki `node.exe` ve `kopru.ts` yolu var mı (`kurulum/claude-code.ts goster` ile karşılaştırın); köprünün hatası Claude Code'un MCP günlüğündedir (`claude --debug`) |
| Claude Code: araç "anahtar yok" ya da "anahtar geçersiz" diyor | `eren eslestir --claude-code --liste`; yoksa ya da dosya yoksa `eren eslestir --claude-code` (köprü yeni dosyayı kendiliğinden okur) |
| Claude Code: araç "eren servisine ulaşılamıyor" diyor | Servis kapalı ya da yeniden başlıyor: `eren durum`; `eren log`'da `ajanda-kopru-sunucu` `el_sikisma_ret` (`pc_baglanti_siniri`: çok açık oturum, köprü sınırı; `pc_kanca_siniri`: kanca sınırı, köprülerden ayrı sayılır) |
| Claude Code: kayıtlar hep taslak doğuyor | Araç çıktısındaki `pc_tur: sentetik (<karar>)` satırı ve `eren eslestir --claude-code --teshis` (kanca kurulumunu da gösterir). Kararlar: `tasdik_yok` (araç öncesi kanca kurulu değil, matcher `mcp__eren-ajanda__.*` değil, kanca servise ulaşamadı, izin sorusu 10 dk'dan uzun sürdü ya da servis arada yeniden başladı: `kurulum/claude-code.ts kanca-ekle`, Claude Code'u yeniden açın; kanca ayarda kuruluysa teşhis "kurulu görünüyor ama tasdik gelmedi" der ve olası nedenleri sayar: `disableAllHooks`/`allowManagedHooksOnly`, günlükteki kanca reddi ve nedeni, yeniden açılmamış oturum, proje ayarı), `cagri_kimligi_yok` (Claude Code MCP isteğinde çağrı kimliğini göndermiyor: güvenli taraf, kanca düzeltemez), `alt_agent` (alt agent'ın çağrısı: beklenen), `etkilesimsiz` (`-p` ya da Agent SDK oturumu: beklenen) |
| Ajanda uygulaması "uygulamayı/servisi güncelle" diyor (`protokol_uyumsuz`) | Uygulamanın ve servisin ajanda sürümü (`AJANDA_SURUMU`) farklı; `servis.log`'da `gateway` `cozum_hatasi` `kanal:"ajanda"`, `code:"protokol_uyumsuz"`. Geride kalanı güncelleyin; eşleşme ve veri yerinde kalır |

Log dosyaları `<veri kökü>\logs\` altındadır: `servis.log` (10 MB'ta döner) ve `bekci.log` (1 MB'ta döner, `bekci.1.log`, `bekci.2.log`).
