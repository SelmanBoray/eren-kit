"""defter.py: bağlam defteri — özet + kayıttan beri yalnız fark."""
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
DEFTER = os.path.join(HERE, "..", "defter", "defter.py")


def git(cwd, *args):
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True)


class GeciciDepo(unittest.TestCase):
    """Geçici git deposu kalıbı; test içermez, alt sınıflar paylaşır."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.d = os.path.realpath(self.tmp.name)
        git(self.d, "init", "-q")
        git(self.d, "config", "user.email", "t@example.invalid")
        git(self.d, "config", "user.name", "t")
        self.yaz_dosya("a.py", "def topla(x, y):\n    return x + y\n")
        git(self.d, "add", "-A")
        git(self.d, "commit", "-qm", "ilk")

    def tearDown(self):
        self.tmp.cleanup()

    def yaz_dosya(self, ad, metin):
        with open(os.path.join(self.d, ad), "w", encoding="utf-8") as f:
            f.write(metin)

    def run_d(self, *args):
        p = subprocess.run([sys.executable, DEFTER, *args], cwd=self.d, capture_output=True,
                           text=True, encoding="utf-8")
        return p.returncode, p.stdout, p.stderr


class DefterTest(GeciciDepo):
    def test_kayitsiz_dosya_okumaya_yonlendirir(self):
        rc, out, _ = self.run_d("oku", "a.py")
        self.assertEqual(rc, 0)
        self.assertIn("kayıt yok", out)

    def test_degismeyen_dosya_icin_yalniz_ozet(self):
        self.assertEqual(self.run_d("yaz", "--dosya", "a.py", "--ozet", "topla(x, y) iki sayıyı toplar")[0], 0)
        rc, out, _ = self.run_d("oku", "a.py")
        self.assertIn("topla(x, y) iki sayıyı toplar", out)
        self.assertIn("DEĞİŞMEDİ", out)
        self.assertNotIn("return x + y", out)  # kod tekrar gönderilmez

    def test_commitlenmemis_degisiklik_yalniz_fark_olarak_gelir(self):
        self.run_d("yaz", "--dosya", "a.py", "--ozet", "toplama")
        self.yaz_dosya("a.py", "def topla(x, y):\n    return x + y\n\n\ndef cikar(x, y):\n    return x - y\n")
        rc, out, _ = self.run_d("oku", "a.py")
        self.assertEqual(rc, 0)
        self.assertIn("DEĞİŞTİ", out)
        self.assertIn("+def cikar(x, y):", out)
        self.assertNotIn("diff --git", out)

    def test_fark_siniri_uygulanir(self):
        self.run_d("yaz", "--dosya", "a.py", "--ozet", "x")
        self.yaz_dosya("a.py", "".join(f"satir{i} = {i}\n" for i in range(300)))
        rc, out, _ = self.run_d("oku", "a.py", "--sinir", "20")
        self.assertIn("satır daha", out)
        self.assertLess(len(out.splitlines()), 40)

    def test_silinen_dosya(self):
        self.run_d("yaz", "--dosya", "a.py", "--ozet", "x")
        os.remove(os.path.join(self.d, "a.py"))
        self.assertIn("artık YOK", self.run_d("oku", "a.py")[1])

    def test_kavramlar_son_tanim_kazanir(self):
        self.run_d("yaz", "--kavram", "Sepet: kullanıcının seçtikleri")
        self.run_d("yaz", "--kavram", "Sepet: ödeme öncesi ürün listesi", "--kavram", "Kupon: indirim kodu")
        out = self.run_d("kavram")[1]
        self.assertIn("- Kupon: indirim kodu", out)
        self.assertIn("- Sepet: ödeme öncesi ürün listesi", out)
        self.assertNotIn("kullanıcının seçtikleri", out)

    def test_defter_depoya_girmez_ve_worktree_ortak(self):
        self.run_d("yaz", "--dosya", "a.py", "--ozet", "x")
        durum = subprocess.run(["git", "status", "--porcelain"], cwd=self.d, capture_output=True, text=True).stdout
        self.assertEqual(durum.strip(), "")
        self.assertTrue(os.path.exists(os.path.join(self.d, ".git", "orkestra", "defter.jsonl")))
        wt = os.path.join(self.d + "-wt")
        git(self.d, "worktree", "add", "-q", wt)
        try:
            out = subprocess.run([sys.executable, DEFTER, "oku", "a.py"], cwd=wt, capture_output=True,
                                 text=True, encoding="utf-8").stdout
            self.assertIn("DEĞİŞMEDİ", out)
        finally:
            git(self.d, "worktree", "remove", "--force", wt)

    def test_hatali_girdiler(self):
        self.assertEqual(self.run_d("yaz", "--dosya", "a.py")[0], 2)  # özet yok
        self.assertEqual(self.run_d("yaz", "--dosya", "yok.py", "--ozet", "x")[0], 2)
        self.assertEqual(self.run_d("yaz", "--ozet", "x" * 2000)[0], 2)
        self.assertEqual(self.run_d("yaz", "--kavram", "iki noktasız")[0], 2)
        dis = tempfile.mkdtemp()
        p = subprocess.run([sys.executable, DEFTER, "durum"], cwd=dis, capture_output=True, text=True)
        self.assertEqual(p.returncode, 2)
        self.assertIn("git deposu", p.stderr)

    def test_ozetle_girdisi_ve_temizle(self):
        for i in range(3):
            self.run_d("yaz", "--dosya", "a.py", "--ozet", f"sürüm {i}", "--gorev", f"iş {i}")
        out = self.run_d("ozetle", "--eski", "1")[1]
        self.assertIn("sürüm 0", out)
        self.assertNotIn("sürüm 2", out)  # son kart dışarıda
        self.assertEqual(self.run_d("temizle", "--tut", "1")[0], 0)
        self.assertIn("kart: 1", self.run_d("durum")[1])
        self.assertIn("sürüm 2", self.run_d("oku", "a.py")[1])

    def test_ozet_karti_ve_kavramlar_temizlikten_sonra_okunur(self):
        # Kullanıcının yeniden ürettiği akış: kart + özet kartı, sonra temizle --tut 1.
        self.run_d("yaz", "--dosya", "a.py", "--ozet", "topla modülü", "--kavram", "Sepet: ürün listesi")
        self.assertEqual(self.run_d("yaz", "--tur", "ozet", "--ozet", "PROJE ÖZETİ: toplama aracı")[0], 0)
        self.assertEqual(self.run_d("temizle", "--tut", "1")[0], 0)
        out = self.run_d("oku")[1]
        self.assertIn("PROJE ÖZETİ: toplama aracı", out)
        self.assertNotIn("defter boş", out)
        tek = self.run_d("oku", "a.py")[1]
        self.assertIn("topla modülü", tek)
        self.assertNotIn("kayıt yok", tek)
        self.assertIn("`defter oku`", tek)  # yol verilince özetin varlığı tek satırla bildirilir
        self.assertNotIn("PROJE ÖZETİ", tek)
        self.assertIn("- Sepet: ürün listesi", self.run_d("kavram")[1])

    def test_ozetle_temizle_akisi_bilgi_kaybetmez(self):
        self.yaz_dosya("b.py", "KUPON = 'X'\n")
        self.run_d("yaz", "--dosya", "a.py", "--ozet", "a sürüm 1", "--kavram", "Sepet: eski tanım")
        self.run_d("yaz", "--dosya", "b.py", "--ozet", "b modülü kuponları tutar", "--kavram", "Kupon: indirim kodu")
        self.run_d("yaz", "--dosya", "a.py", "--ozet", "a sürüm 2", "--kavram", "Sepet: yeni tanım")
        self.run_d("yaz", "--dosya", "a.py", "--ozet", "a sürüm 3")
        girdi = self.run_d("ozetle", "--eski", "1")[1]
        self.assertIn("a sürüm 1", girdi)
        self.assertNotIn("a sürüm 3", girdi)
        self.run_d("yaz", "--tur", "ozet", "--ozet", "ÖZET-1: a ve b modülleri")
        rc, out, _ = self.run_d("temizle", "--tut", "1")
        self.assertEqual(rc, 0)
        self.assertIn("1 kart silindi", out)  # yalnız tamamen eskimiş "a sürüm 1" kartı gider
        self.assertIn("ÖZET-1: a ve b modülleri", self.run_d("oku")[1])
        b = self.run_d("oku", "b.py")[1]
        self.assertIn("b modülü kuponları tutar", b)
        self.assertIn("DEĞİŞMEDİ", b)
        self.assertIn("a sürüm 3", self.run_d("oku", "a.py")[1])
        kv = self.run_d("kavram")[1]
        self.assertIn("- Kupon: indirim kodu", kv)
        self.assertIn("- Sepet: yeni tanım", kv)
        self.assertNotIn("eski tanım", kv)
        # İkinci tur: önceki özet sıkıştırma girdisine girer, yeni özet onun yerini alır.
        self.run_d("yaz", "--dosya", "a.py", "--ozet", "a sürüm 4")
        self.assertIn("ÖZET-1: a ve b modülleri", self.run_d("ozetle", "--eski", "1")[1])
        self.run_d("yaz", "--tur", "ozet", "--ozet", "ÖZET-2: hepsi")
        self.run_d("temizle", "--tut", "1")
        out = self.run_d("oku")[1]
        self.assertIn("ÖZET-2: hepsi", out)
        self.assertNotIn("ÖZET-1", out)

    def test_budanmis_eski_icerik_acikca_bildirilir(self):
        self.yaz_dosya("c.py", "x = 1\n")  # commit edilmemiş: blob yalnız defterin yazdığı nesnede
        self.run_d("yaz", "--dosya", "c.py", "--ozet", "c ayarı")
        self.yaz_dosya("c.py", "x = 2\n")
        # Korumasız (eski sürümle yazılmış) defteri ya da korumanın kurulamadığı durumu taklit et.
        git(self.d, "update-ref", "-d", "refs/orkestra/defter")
        git(self.d, "gc", "-q", "--prune=now")
        rc, out, _ = self.run_d("oku", "c.py")
        self.assertEqual(rc, 0)
        self.assertNotIn("DEĞİŞTİ (0 satır fark)", out)
        self.assertIn("git'te artık yok", out)
        self.assertIn("dosyayı oku", out)
        self.assertNotIn("DEĞİŞMEDİ", out)

    def git_cikti(self, *args):
        return subprocess.run(["git", *args], cwd=self.d, check=True, capture_output=True, text=True).stdout

    def nesne_var(self, sha):
        return subprocess.run(["git", "cat-file", "-e", sha], cwd=self.d, capture_output=True).returncode == 0

    def test_kayit_icerigi_gc_ile_budanmaz_ve_temizle_ile_serbest_kalir(self):
        git(self.d, "tag", "v1")
        izler = lambda: [self.git_cikti(*a) for a in (("status", "--porcelain"), ("branch", "-a"),
                                                       ("tag",), ("log", "--all", "--oneline"),
                                                       ("stash", "list"), ("ls-files", "-s"))]
        self.yaz_dosya("c.py", "x = 1\n")  # hiç commit edilmeyecek içerik
        once = izler()
        self.assertEqual(self.run_d("yaz", "--dosya", "c.py", "--ozet", "c ayarı")[0], 0)
        v1 = self.git_cikti("hash-object", "c.py").strip()
        self.yaz_dosya("c.py", "x = 2\n")
        v2 = self.git_cikti("hash-object", "c.py").strip()
        self.assertIn("+x = 2", self.run_d("oku", "c.py")[1])
        self.assertFalse(self.nesne_var(v2))  # `oku` güncel içeriği depoya yazmadı
        self.yaz_dosya("c.py", "x = 1\n")
        self.assertEqual(izler(), once)  # dal, etiket, index, çalışma ağacı, log --all değişmez
        self.assertIn("budanma koruması: refs/orkestra/defter (1 içerik)", self.run_d("durum")[1])
        self.yaz_dosya("c.py", "x = 3\n")
        v3 = self.git_cikti("hash-object", "c.py").strip()
        git(self.d, "gc", "-q", "--prune=now")
        self.assertTrue(self.nesne_var(v1))  # commit edilmemiş kayıt içeriği budanmadı
        out = self.run_d("oku", "c.py")[1]
        self.assertIn("DEĞİŞTİ", out)
        self.assertIn("-x = 1", out)
        self.assertIn("+x = 3", out)
        self.assertFalse(self.nesne_var(v3))
        # İkinci kayıt c.py'nin en son kaydı olur; temizle ilk kartı siler ve v1 serbest kalır.
        self.assertEqual(self.run_d("yaz", "--dosya", "c.py", "--ozet", "c ayarı 3")[0], 0)
        self.assertEqual(self.run_d("temizle", "--tut", "0")[0], 0)
        git(self.d, "gc", "-q", "--prune=now")
        self.assertFalse(self.nesne_var(v1))
        self.assertTrue(self.nesne_var(v3))
        self.assertIn("DEĞİŞMEDİ", self.run_d("oku", "c.py")[1])
        # Defter hiçbir içeriğe başvurmayınca ref de kalkar.
        with open(os.path.join(self.d, ".git", "orkestra", "defter.jsonl"), "w", encoding="utf-8") as f:
            f.write("")
        self.assertEqual(self.run_d("temizle", "--tut", "0")[0], 0)
        self.assertEqual(self.git_cikti("for-each-ref", "refs/orkestra"), "")

    def test_koruma_kurulamazsa_kart_yine_yazilir(self):
        # Kayıp nesneye işaret eden kart (ör. budanmış eski defter): ref ağacına girmez, gc bozulmaz.
        os.makedirs(os.path.join(self.d, ".git", "orkestra"))
        with open(os.path.join(self.d, ".git", "orkestra", "defter.jsonl"), "w", encoding="utf-8") as f:
            f.write(json.dumps({"zaman": "2026-01-01T00:00:00+00:00", "tur": "kart", "ozet": "eski",
                                "dosyalar": [{"yol": "z.py", "blob": "1" * 40}], "kavramlar": []}) + "\n")
        self.assertEqual(self.run_d("yaz", "--dosya", "a.py", "--ozet", "a")[0], 0)
        self.assertIn("(1 içerik)", self.run_d("durum")[1])
        git(self.d, "gc", "-q", "--prune=now")
        # Ref güncellenemiyor (kilitli ref dosyası): kart yazılır, uyarı verilir.
        kilit = os.path.join(self.d, ".git", "refs", "orkestra", "defter.lock")
        os.makedirs(os.path.dirname(kilit), exist_ok=True)
        open(kilit, "w").close()
        self.yaz_dosya("b.py", "y = 1\n")
        rc, out, err = self.run_d("yaz", "--dosya", "b.py", "--ozet", "b modülü")
        os.remove(kilit)
        self.assertEqual(rc, 0)
        self.assertIn("kart yazıldı", out)
        self.assertIn("korunamadı", err)
        self.assertIn("b modülü", self.run_d("oku", "b.py")[1])

    def test_bozuk_satir_sayilir_ve_yarim_satir_sonraki_karti_bozmaz(self):
        self.run_d("yaz", "--dosya", "a.py", "--ozet", "ilk")
        with open(os.path.join(self.d, ".git", "orkestra", "defter.jsonl"), "a", encoding="utf-8") as f:
            f.write('{"bozuk": \n{"zaman": "yarım')  # bozuk satır + ölen yazıcının yarım bıraktığı satır
        self.assertEqual(self.run_d("yaz", "--kavram", "Sepet: ürün listesi")[0], 0)
        rc, out, err = self.run_d("kavram")
        self.assertIn("- Sepet: ürün listesi", out)  # yarım satır yeni kartı yutmadı
        self.assertIn("2 bozuk satır", err)
        self.assertIn("bozuk satır: 2", self.run_d("durum")[1])
        self.assertIn("2 bozuk satır atıldı", self.run_d("temizle", "--tut", "5")[1])
        self.assertNotIn("bozuk", self.run_d("durum")[1])


# Eşzamanlılık testleri gerçek süreçlerle çalışır. Süreçler önce "hazır" işareti bırakır, hepsi
# hazır olunca tek bir başlangıç işaretiyle aynı anda bırakılır; böylece çakışma olasılığı yüksek
# olur. Doğruluk kontrolleri sıralamadan bağımsızdır: hangi süreç önce kilidi alırsa alsın sonuç
# aynı olmalıdır.
BASLAT = (
    "import os, sys, time\n"
    "isaret, dizin = sys.argv[1], sys.argv[2]\n"
    "sys.path.insert(0, dizin)\n"
    "import defter\n"
    "open(isaret + '.hazir.' + str(os.getpid()), 'w').close()\n"
    "while not os.path.exists(isaret):\n"
    "    time.sleep(0.002)\n"
    "sys.exit(defter.main(sys.argv[3:]))\n"
)
DEFTER_DIZIN = os.path.dirname(os.path.abspath(DEFTER))


class EszamanlilikTest(GeciciDepo):
    def setUp(self):
        super().setUp()
        self.isaret_tmp = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.isaret_tmp.cleanup()
        super().tearDown()

    def defter_dosyasi(self):
        return os.path.join(self.d, ".git", "orkestra", "defter.jsonl")

    def ayni_anda(self, komutlar, tur=0):
        """Komutları ayrı süreçlerde aynı anda başlatır; (rc, stdout, stderr) listesi döner."""
        isaret = os.path.join(self.isaret_tmp.name, f"basla{tur}")
        surecler = [subprocess.Popen([sys.executable, "-c", BASLAT, isaret, DEFTER_DIZIN, *k], cwd=self.d,
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                     encoding="utf-8") for k in komutlar]
        try:
            bitis = time.monotonic() + 30
            while time.monotonic() < bitis:
                hazir = [a for a in os.listdir(self.isaret_tmp.name) if a.startswith(f"basla{tur}.hazir.")]
                if len(hazir) >= len(surecler) or any(p.poll() is not None for p in surecler):
                    break
                time.sleep(0.005)
            open(isaret, "w").close()
            ciktilar = [p.communicate(timeout=60) for p in surecler]
            return [(p.returncode, *c) for p, c in zip(surecler, ciktilar)]
        finally:
            for p in surecler:
                if p.poll() is None:
                    p.kill()

    def gecerli_satirlar(self):
        with open(self.defter_dosyasi(), encoding="utf-8") as f:
            satirlar = [s for s in f.read().split("\n") if s.strip()]
        for s in satirlar:
            self.assertIsInstance(json.loads(s), dict, s[:80])  # her satır geçerli JSON nesnesi
        return [json.loads(s) for s in satirlar]

    def test_eszamanli_yazlar_kart_kaybetmez(self):
        n = 12
        uzun = "x" * 200  # büyük satırlar: yazma penceresi genişler, karışma olasılığı artar
        komutlar = []
        for i in range(n):
            self.yaz_dosya(f"f{i}.py", f"DEGER = {i}\n")
            kv = [a for j in range(15) for a in ("--kavram", f"k{i}_{j}: {uzun}")]
            komutlar.append(["yaz", "--dosya", f"f{i}.py", "--ozet", f"kart {i}", *kv])
        sonuc = self.ayni_anda(komutlar)
        for rc, out, err in sonuc:
            self.assertEqual(rc, 0, err)
        ks = self.gecerli_satirlar()
        self.assertEqual(sorted(k["ozet"] for k in ks), sorted(f"kart {i}" for i in range(n)))

    def test_tutulan_ya_da_terk_edilen_kilit_asili_birakmaz(self):
        tut = ("import sys, time\n"
               "sys.path.insert(0, sys.argv[1])\n"
               "import defter\n"
               "with defter.kilit(sys.argv[2]):\n"
               "    print('hazir', flush=True)\n"
               "    time.sleep(120)\n")
        self.run_d("yaz", "--dosya", "a.py", "--ozet", "önceki kart")
        tutan = subprocess.Popen([sys.executable, "-c", tut, DEFTER_DIZIN, self.defter_dosyasi()],
                                 stdout=subprocess.PIPE, text=True)
        env = dict(os.environ, DEFTER_KILIT_SURE="1")
        try:
            self.assertEqual(tutan.stdout.readline().strip(), "hazir")
            for komut in (["yaz", "--ozet", "bekleyen"], ["temizle", "--tut", "0"]):
                t0 = time.monotonic()
                p = subprocess.run([sys.executable, DEFTER, *komut], cwd=self.d, env=env, capture_output=True,
                                   text=True, encoding="utf-8", timeout=30)
                self.assertEqual(p.returncode, 2, p.stderr)
                self.assertIn("kilidi 1 sn içinde alınamadı", p.stderr)
                self.assertIn("tutan: pid ", p.stderr)
                self.assertLess(time.monotonic() - t0, 15)
            self.assertIn("önceki kart", self.run_d("oku", "a.py")[1])  # okuyan komut kilit beklemez
        finally:
            tutan.kill()
            tutan.wait()
            tutan.stdout.close()
        # Kilidi tutan süreç öldü; kilit dosyası diskte duruyor ama kilit işletim sisteminde kalktı.
        self.assertTrue(os.path.exists(os.path.join(os.path.dirname(self.defter_dosyasi()), "defter.kilit")))
        env["DEFTER_KILIT_SURE"] = "20"
        p = subprocess.run([sys.executable, DEFTER, "yaz", "--ozet", "sonraki"], cwd=self.d, env=env,
                           capture_output=True, text=True, encoding="utf-8", timeout=60)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual([k["ozet"] for k in self.gecerli_satirlar()], ["önceki kart", "sonraki"])

    def test_temizle_ile_yarisan_yaz_son_kaydi_kaybetmez(self):
        # Büyük bir defter: temizle'nin oku-yaz penceresi uzar.
        os.makedirs(os.path.dirname(self.defter_dosyasi()), exist_ok=True)
        with open(self.defter_dosyasi(), "w", encoding="utf-8") as f:
            for i in range(3000):
                f.write(json.dumps({"zaman": "2026-01-01T00:00:00+00:00", "tur": "kart", "gorev": None,
                                    "ozet": f"dolgu {i} " + "y" * 100, "dosyalar": [],
                                    "kavramlar": [{"ad": "dolgu", "aciklama": str(i)}], "head": None}) + "\n")
        n = 6
        for tur in range(3):
            komutlar = [["temizle", "--tut", "0"]]
            for i in range(n):
                self.yaz_dosya(f"t{tur}_{i}.py", f"DEGER = {tur * 100 + i}\n")
                komutlar.append(["yaz", "--dosya", f"t{tur}_{i}.py", "--ozet", f"tur {tur} kart {i}",
                                 "--kavram", f"kv{tur}_{i}: tur {tur} kavram {i}"])
            for rc, out, err in self.ayni_anda(komutlar, tur):
                self.assertEqual(rc, 0, err)
        self.gecerli_satirlar()
        kv = self.run_d("kavram")[1]
        self.assertIn("- dolgu: 2999", kv)
        yollar = [f"t{tur}_{i}.py" for tur in range(3) for i in range(n)]
        out = self.run_d("oku", *yollar)[1]
        self.assertNotIn("kayıt yok", out)
        self.assertEqual(out.count("DEĞİŞMEDİ"), len(yollar))
        for tur in range(3):
            for i in range(n):
                self.assertIn(f"## t{tur}_{i}.py", out)
                self.assertIn(f"tur {tur} kart {i}\n", out)
                self.assertIn(f"- kv{tur}_{i}: tur {tur} kavram {i}", kv)


if __name__ == "__main__":
    unittest.main()
