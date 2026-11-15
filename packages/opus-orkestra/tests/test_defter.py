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


class GuvenlikTest(GeciciDepo):
    """Defter, kullanıcının git dışında tuttuğu içeriği git'e sabitlemez; deponun yapılandırmasındaki
    dış komutları ve çalışma klasöründeki `git`i çalıştırmaz."""

    GIZLILER = {".env": b"API_KEY=GIZLI_ENV_DEGERI\n", "gizli/anahtar.txt": b"GIZLI_KLASOR_DEGERI\n"}
    DIS_ICERIK = b"GIZLI_DIS_DEGER\n"

    def setUp(self):
        super().setUp()
        self.dis = tempfile.TemporaryDirectory()
        self.dis_d = os.path.realpath(self.dis.name)

    def tearDown(self):
        self.dis.cleanup()
        super().tearDown()

    def git_cikti(self, *args, cwd=None, girdi=None):
        return subprocess.run(["git", *args], cwd=cwd or self.d, check=True, capture_output=True,
                              input=girdi).stdout.decode("utf-8", "replace")

    def sha(self, icerik: bytes) -> str:
        return self.git_cikti("hash-object", "--stdin", girdi=icerik).strip()

    def nesne_var(self, sha, cwd=None):
        return subprocess.run(["git", "cat-file", "-e", sha], cwd=cwd or self.d, capture_output=True).returncode == 0

    def gizli_dosyalar(self):
        self.yaz_dosya(".gitignore", ".env\ngizli/\n*.log\n")
        self.yaz_dosya("izli.log", "izlenen ama desene uyan dosya\n")
        git(self.d, "add", ".gitignore")
        git(self.d, "add", "-f", "izli.log")
        git(self.d, "commit", "-qm", "ignore")
        os.makedirs(os.path.join(self.d, "gizli"))
        for ad, icerik in self.GIZLILER.items():
            with open(os.path.join(self.d, ad), "wb") as f:
                f.write(icerik)
        self.dis_dosya = os.path.join(self.dis_d, "disari.txt")
        with open(self.dis_dosya, "wb") as f:
            f.write(self.DIS_ICERIK)
        self.yaz_dosya("yeni.py", "YENI = 1\n")  # izlenmeyen ama yok sayılmayan: kabul edilir

    def test_yok_sayilan_depo_disi_ve_git_ici_dosyalar_kaydedilmez(self):
        self.gizli_dosyalar()
        rc, out, err = self.run_d("yaz", "--dosya", ".env", "--dosya", "gizli/anahtar.txt", "--dosya",
                                  self.dis_dosya, "--dosya", ".git/config", "--dosya", "izli.log",
                                  "--dosya", "yeni.py", "--dosya", "a.py", "--ozet", "karışık iş")
        self.assertEqual(rc, 0, err)  # reddedilen dosya çağıranın işini düşürmez
        self.assertIn("kart yazıldı (3 dosya, 0 kavram; 4 dosya kaydedilmedi)", out)
        for ad in (".env", "gizli/anahtar.txt", ".git/config"):
            self.assertIn(f"{ad} kaydedilmedi", err)
        self.assertIn("depo dışında", err)
        self.assertIn("yok sayıyor", err)
        gizli_shalar = [self.sha(x) for x in (*self.GIZLILER.values(), self.DIS_ICERIK)]
        for s in gizli_shalar:
            self.assertFalse(self.nesne_var(s))  # nesne deposuna hiç yazılmadı
        self.assertEqual(len(self.git_cikti("ls-tree", "refs/orkestra/defter").splitlines()), 3)
        # Ayna push'u (ve ayna klon) gizli içeriği taşımaz.
        ayna = os.path.join(self.dis_d, "ayna.git")
        git(self.dis_d, "init", "-q", "--bare", ayna)
        git(self.d, "push", "-q", "--mirror", ayna)
        self.assertIn("refs/orkestra/defter", self.git_cikti("for-each-ref", cwd=ayna))
        for s in gizli_shalar:
            self.assertFalse(self.nesne_var(s, cwd=ayna))
        out = self.run_d("oku", ".env", "a.py")[1]
        self.assertIn("## .env\ndefter bu dosyayı kaydetmez", out)
        self.assertIn("DEĞİŞMEDİ", out)
        rc, out, err = self.run_d("yaz", "--dosya", ".env", "--ozet", "yalnız gizli dosya")
        self.assertEqual(rc, 0, err)
        self.assertIn("kart yazıldı (0 dosya, 0 kavram; 1 dosya kaydedilmedi)", out)

    def test_sembolik_bag_gercek_hedefine_gore_degerlendirilir(self):
        self.gizli_dosyalar()
        try:
            os.symlink(os.path.join(self.d, ".env"), os.path.join(self.d, "bag.txt"))
            os.symlink(self.dis_dosya, os.path.join(self.d, "dis_bag.txt"))
        except (OSError, NotImplementedError):
            self.skipTest("bu sistemde sembolik bağ oluşturulamıyor")
        rc, out, err = self.run_d("yaz", "--dosya", "bag.txt", "--dosya", "dis_bag.txt", "--ozet", "bağlar")
        self.assertEqual(rc, 0, err)
        self.assertIn("bag.txt kaydedilmedi: git yok sayıyor", err)
        self.assertIn("dis_bag.txt kaydedilmedi: depo dışında", err)
        self.assertFalse(self.nesne_var(self.sha(self.GIZLILER[".env"])))
        self.assertFalse(self.nesne_var(self.sha(self.DIS_ICERIK)))

    def test_eski_git_disi_kayitlar_sabitlenmez_ve_temizle_cikarir(self):
        self.gizli_dosyalar()
        # Eski sürüm .env'yi ve depo dışı dosyayı kabul edip sabitliyordu: o durumu elle kur.
        env_sha = self.git_cikti("hash-object", "-w", "--stdin", girdi=self.GIZLILER[".env"]).strip()
        dis_sha = self.git_cikti("hash-object", "-w", "--stdin", girdi=self.DIS_ICERIK).strip()
        a_sha = self.git_cikti("hash-object", "a.py").strip()
        dis_yol = os.path.relpath(self.dis_dosya, self.d).replace(os.sep, "/")
        os.makedirs(os.path.join(self.d, ".git", "orkestra"))
        with open(os.path.join(self.d, ".git", "orkestra", "defter.jsonl"), "w", encoding="utf-8") as f:
            f.write(json.dumps({"zaman": "2026-01-01T00:00:00+00:00", "tur": "kart", "ozet": "eski kart",
                                "dosyalar": [{"yol": ".env", "blob": env_sha}, {"yol": dis_yol, "blob": dis_sha},
                                             {"yol": "a.py", "blob": a_sha}], "kavramlar": []}) + "\n")
        agac = self.git_cikti("mktree", girdi="".join(f"100644 blob {s}\t{s}\n" for s in
                                                       sorted({env_sha, dis_sha, a_sha})).encode()).strip()
        git(self.d, "update-ref", "refs/orkestra/defter", agac)
        self.assertIn("git dışı kayıt: 2", self.run_d("durum")[1])
        # Depo dışını gösteren eski kayıt `oku`yu düşürmez, içeriği karşılaştırılmaz.
        for args in ((), (dis_yol, "a.py")):
            rc, out, err = self.run_d("oku", *args)
            self.assertEqual(rc, 0, err)
            self.assertIn(f"## {dis_yol}\ndefter bu dosyayı kaydetmez (depo dışında)", out)
            self.assertIn("DEĞİŞMEDİ", out)
        # Sonraki her yaz/temizle koruma ağacını yeniden kurar: git dışı içerik ref'ten düşer.
        self.assertEqual(self.run_d("yaz", "--dosya", "yeni.py", "--ozet", "yeni")[0], 0)
        tutulan = self.git_cikti("ls-tree", "refs/orkestra/defter")
        self.assertIn(a_sha, tutulan)
        self.assertNotIn(env_sha, tutulan)
        self.assertNotIn(dis_sha, tutulan)
        git(self.d, "gc", "-q", "--prune=now")
        self.assertFalse(self.nesne_var(env_sha))
        self.assertFalse(self.nesne_var(dis_sha))
        rc, out, err = self.run_d("temizle", "--tut", "5")
        self.assertEqual(rc, 0, err)
        self.assertIn("2 git dışı dosya kaydı çıkarıldı", out)
        self.assertNotIn("git dışı kayıt", self.run_d("durum")[1])
        self.assertIn("defter bu dosyayı kaydetmez", self.run_d("oku", ".env")[1])
        self.assertIn("eski kart", self.run_d("oku", "a.py")[1])  # izlenen dosyanın kaydı kalır

    def test_depo_yapilandirmasindaki_dis_komutlar_calismaz(self):
        isaretler = os.path.join(self.dis_d, "isaret")
        os.makedirs(isaretler)
        betik = os.path.join(self.dis_d, "isaret.py")
        with open(betik, "w", encoding="utf-8") as f:
            f.write("import os, sys\n"
                    f"open(os.path.join({isaretler!r}, 'isaret-' + sys.argv[1]), 'a').close()\n"
                    "if sys.argv[1] in ('clean', 'textconv'):\n"
                    "    sys.stdout.write(sys.stdin.read() if sys.argv[1] == 'clean' else open(sys.argv[2]).read())\n")
        komut = lambda tur: '"%s" "%s" %s' % (sys.executable.replace(os.sep, "/"), betik.replace(os.sep, "/"), tur)
        git(self.d, "config", "diff.external", komut("diff"))
        git(self.d, "config", "diff.kotu.textconv", komut("textconv"))
        git(self.d, "config", "filter.kotu.clean", komut("clean"))
        git(self.d, "config", "core.fsmonitor", komut("fsmon"))
        with open(os.path.join(self.d, ".git", "info", "attributes"), "w", encoding="utf-8") as f:
            f.write("*.py filter=kotu diff=kotu\n* diff=kotu\n")
        kanca = os.path.join(self.d, ".git", "hooks", "reference-transaction")
        os.makedirs(os.path.dirname(kanca), exist_ok=True)
        with open(kanca, "w", encoding="utf-8", newline="\n") as f:
            f.write("#!/bin/sh\n" + komut("hook") + "\n")
        os.chmod(kanca, 0o755)
        # Ayarlar gerçekten etkin: düz git çağrıları dış komutları çalıştırıyor.
        git(self.d, "update-ref", "refs/deneme/x", "HEAD")
        git(self.d, "hash-object", "a.py")
        git(self.d, "status")
        self.yaz_dosya("a.py", "def topla(x, y):\n    return x + y\n# degisti\n")
        git(self.d, "diff", "HEAD")
        self.assertLessEqual({"isaret-clean", "isaret-diff", "isaret-fsmon", "isaret-hook"},
                             set(os.listdir(isaretler)))
        for ad in os.listdir(isaretler):
            os.remove(os.path.join(isaretler, ad))
        self.assertEqual(self.run_d("yaz", "--dosya", "a.py", "--ozet", "toplama")[0], 0)
        self.assertIn("DEĞİŞMEDİ", self.run_d("oku", "a.py")[1])
        self.yaz_dosya("a.py", "def topla(x, y):\n    return x + y\n\n\ndef cikar(x, y):\n    return x - y\n")
        rc, out, err = self.run_d("oku", "a.py")
        self.assertEqual(rc, 0, err)
        self.assertIn("+def cikar(x, y):", out)
        self.assertEqual(self.run_d("temizle", "--tut", "0")[0], 0)
        self.assertEqual(self.run_d("durum")[0], 0)
        self.assertEqual(os.listdir(isaretler), [])

    def _defter_modulu(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location("defter_cozum_deneme", DEFTER)
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        return m

    def test_git_calisma_klasorunden_ya_da_goreli_path_girdisinden_cozulmez(self):
        from unittest import mock
        m = self._defter_modulu()
        os.makedirs(os.path.join(self.d, "goreli"))
        for klasor in (self.d, os.path.join(self.d, "goreli")):
            sahte = os.path.join(klasor, "git.exe" if os.name == "nt" else "git")
            with open(sahte, "w") as f:
                f.write("#!/bin/sh\nexit 3\n")
            os.chmod(sahte, 0o755)
        onceki = os.getcwd()
        yol = os.pathsep.join([".", "", "goreli", os.environ.get("PATH", "")])
        try:
            os.chdir(self.d)
            with mock.patch.dict(os.environ, {"PATH": yol}):
                m._CALISTIRILABILIR.clear()
                bulunan = m.calistirilabilir("git")
        finally:
            os.chdir(onceki)
        self.assertIsNotNone(bulunan)
        self.assertTrue(os.path.isabs(bulunan))
        self.assertFalse(os.path.normcase(os.path.realpath(bulunan)).startswith(os.path.normcase(self.d)))

    def test_calisma_klasorundeki_sahte_git_calismaz(self):
        import shutil
        env = {a: d for a, d in os.environ.items() if a.lower() != "nodefaultcurrentdirectoryinexepath"}
        env["PATH"] = os.pathsep.join([".", env.get("PATH", "")])
        if os.name == "nt":
            shutil.copy(os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32", "hostname.exe"),
                        os.path.join(self.d, "git.exe"))
        else:
            with open(os.path.join(self.d, "git"), "w") as f:
                f.write("#!/bin/sh\necho SAHTE\nexit 3\n")
            os.chmod(os.path.join(self.d, "git"), 0o755)
        # Windows'ta arama, çağıran sürecin ortamına bakar: düz çağrıyı o ortamla çalışan bir alt süreçte dene.
        duz = subprocess.run([sys.executable, "-c", "import subprocess; print(subprocess.run(['git', '--version'], "
                              "capture_output=True, text=True, errors='replace').stdout)"],
                             cwd=self.d, env=env, capture_output=True, text=True, errors="replace")
        if "git version" in duz.stdout:
            self.skipTest("bu sistemde düz çağrı da çalışma klasöründeki git'i seçmiyor; senaryo kurulamadı")
        ciktilar = {}
        for komut in ("yaz", "oku", "durum"):
            ek = {"yaz": ["--dosya", "a.py", "--ozet", "toplama"], "oku": ["a.py"], "durum": []}[komut]
            p = subprocess.run([sys.executable, DEFTER, komut, *ek], cwd=self.d, env=env, capture_output=True,
                               text=True, encoding="utf-8")
            self.assertEqual(p.returncode, 0, p.stderr)
            ciktilar[komut] = p.stdout
        self.assertIn("DEĞİŞMEDİ", ciktilar["oku"])
        self.assertIn("budanma koruması: refs/orkestra/defter (1 içerik)", ciktilar["durum"])


class IcDepoTest(GeciciDepo):
    """Alt modüldeki yol alt modülün kendi kurallarıyla, index'te olmayan iç içe depodaki yol iki deponun
    kurallarıyla değerlendirilir; git'in değerlendiremediği bir yol toplu sorguyu yol başına sorguya
    çevirmez ve `temizle` onu belirsizlik yüzünden silmez."""

    def setUp(self):
        super().setUp()
        self.kaynak = tempfile.TemporaryDirectory()
        s = os.path.realpath(self.kaynak.name)
        git(s, "init", "-q")
        git(s, "config", "user.email", "t@example.invalid")
        git(s, "config", "user.name", "t")
        for ad, metin in (("s.txt", "alt modül\n"), (".gitignore", "*.gizli\n"), ("izli.gizli", "izlenen\n")):
            with open(os.path.join(s, ad), "w", encoding="utf-8") as f:
                f.write(metin)
        git(s, "add", "s.txt", ".gitignore")
        git(s, "add", "-f", "izli.gizli")
        git(s, "commit", "-qm", "alt")
        git(self.d, "-c", "protocol.file.allow=always", "submodule", "add", "-q", s, "sub")
        git(self.d, "commit", "-qm", "alt modül")

    def tearDown(self):
        super().tearDown()
        self.kaynak.cleanup()

    def cikti(self, *args, girdi=None):
        return subprocess.run(["git", *args], cwd=self.d, check=True, capture_output=True,
                              input=girdi).stdout.decode("utf-8", "replace")

    def koruma(self):
        return self.cikti("ls-tree", "refs/orkestra/defter")

    def test_alt_moduldeki_izlenen_dosya_kaydedilir_okunur_temizlenmez(self):
        self.yaz_dosya("sub/yeni.txt", "izlenmeyen, yok sayılmayan\n")
        self.yaz_dosya("sub/x.gizli", "GIZLI_ALT_DEGER\n")
        rc, out, err = self.run_d("yaz", "--dosya", "sub/s.txt", "--dosya", "sub/izli.gizli", "--dosya",
                                  "sub/yeni.txt", "--dosya", "sub/x.gizli", "--ozet", "alt modül işi")
        self.assertEqual(rc, 0, err)
        self.assertIn("kart yazıldı (3 dosya, 0 kavram; 1 dosya kaydedilmedi)", out)
        self.assertIn("sub/x.gizli kaydedilmedi: git yok sayıyor", err)  # alt modülün kendi .gitignore'u
        gizli = self.cikti("hash-object", "--stdin", girdi=b"GIZLI_ALT_DEGER\n").strip()
        self.assertNotEqual(subprocess.run(["git", "cat-file", "-e", gizli], cwd=self.d,
                                           capture_output=True).returncode, 0)
        s_sha = self.cikti("hash-object", "sub/s.txt").strip()
        self.assertIn(s_sha, self.koruma())
        out = self.run_d("oku", "sub/s.txt")[1]
        self.assertIn("alt modül işi", out)
        self.assertIn("DEĞİŞMEDİ", out)
        rc, out, err = self.run_d("temizle", "--tut", "0")
        self.assertEqual(rc, 0, err)
        self.assertNotIn("git dışı", out)
        self.assertIn("DEĞİŞMEDİ", self.run_d("oku", "sub/s.txt")[1])
        self.assertIn(s_sha, self.koruma())
        self.assertNotIn("git dışı kayıt", self.run_d("durum")[1])

    def test_ic_ice_deponun_kendi_kurallari_da_uygulanir(self):
        ic = os.path.join(self.d, "ic")
        os.makedirs(ic)
        git(ic, "init", "-q")
        self.yaz_dosya("ic/n.txt", "iç depo\n")
        self.yaz_dosya("ic/ex.txt", "GIZLI_IC_DEGER\n")
        with open(os.path.join(ic, ".git", "info", "exclude"), "a", encoding="utf-8") as f:
            f.write("\nex.txt\n")
        rc, out, err = self.run_d("yaz", "--dosya", "ic/n.txt", "--dosya", "ic/ex.txt", "--ozet", "iç")
        self.assertEqual(rc, 0, err)
        self.assertIn("kart yazıldı (1 dosya, 0 kavram; 1 dosya kaydedilmedi)", out)
        self.assertIn("ic/ex.txt kaydedilmedi: git yok sayıyor", err)
        gizli = self.cikti("hash-object", "--stdin", girdi=b"GIZLI_IC_DEGER\n").strip()
        self.assertNotEqual(subprocess.run(["git", "cat-file", "-e", gizli], cwd=self.d,
                                           capture_output=True).returncode, 0)

    def test_degerlendirilemeyen_yol_toplu_sorguyu_bozmaz_ve_temizlenmez(self):
        import importlib.util
        from unittest import mock
        os.makedirs(os.path.join(self.d, "src"))
        yollar = [f"src/f{i:03}.py" for i in range(150)]
        for y in yollar:
            self.yaz_dosya(y, f"x = {y!r}\n")
        git(self.d, "add", "src")
        git(self.d, "commit", "-qm", "src")
        s_sha = self.cikti("hash-object", "-w", "sub/s.txt").strip()
        git(self.d, "submodule", "deinit", "-q", "-f", "sub")  # sub/ boş kalır, gitlink index'te
        kartlar = [{"yol": s.split("\t")[1], "blob": s.split()[1]}
                   for s in self.cikti("ls-files", "-s", "src").splitlines()]
        self.assertEqual([d["yol"] for d in kartlar], yollar)
        os.makedirs(os.path.join(self.d, ".git", "orkestra"), exist_ok=True)
        with open(os.path.join(self.d, ".git", "orkestra", "defter.jsonl"), "w", encoding="utf-8") as f:
            for ozet, ds in (("hepsi", kartlar), ("alt eski", [{"yol": "sub/s.txt", "blob": s_sha}])):
                f.write(json.dumps({"zaman": "2026-01-01T00:00:00+00:00", "tur": "kart", "ozet": ozet,
                                    "dosyalar": ds, "kavramlar": []}) + "\n")
        # Ayrı bir git süreci sayacıyla: yol başına bir check-ignore açılmaz.
        spec = importlib.util.spec_from_file_location("defter_ic_depo_deneme", DEFTER)
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        komutlar = []
        asil = m._git_calistir

        def sayan(args, *a, **kw):
            komutlar.append(args[0])
            return asil(args, *a, **kw)

        with mock.patch.object(m, "_git_calistir", sayan):
            sonuc = m.git_disi(self.d, yollar + ["sub/s.txt"])
        self.assertEqual(list(sonuc), ["sub/s.txt"])
        self.assertIn("değerlendiremedi", sonuc["sub/s.txt"])
        self.assertLessEqual(komutlar.count("check-ignore"), 3)
        # Komut satırından: yaz çalışır, değerlendirilemeyen içerik korunmaz ama kaydı silinmez.
        rc, out, err = self.run_d("yaz", "--dosya", "src/f000.py", "--ozet", "x")
        self.assertEqual(rc, 0, err)
        self.assertEqual(len(self.koruma().splitlines()), 150)
        self.assertNotIn(s_sha, self.koruma())
        self.assertIn("değerlendiremediği kayıt: 1 (sub/s.txt)", self.run_d("durum")[1])
        rc, out, err = self.run_d("temizle", "--tut", "0")
        self.assertEqual(rc, 0, err)
        self.assertNotIn("git dışı dosya kaydı çıkarıldı", out)
        self.assertIn("alt eski", self.run_d("oku", "sub/s.txt")[1])

    def sayan_modul(self):
        """Ayrı yüklenmiş defter modülü ve açtığı git süreçlerinin (komut adı) listesi."""
        import importlib.util
        spec = importlib.util.spec_from_file_location("defter_surec_sayaci", DEFTER)
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        komutlar = []
        asil = m._git_calistir

        def sayan(args, *a, **kw):
            komutlar.append(next(x for x in args if not x.startswith("-")))
            return asil(args, *a, **kw)

        m._git_calistir = sayan
        return m, komutlar

    def test_calismayan_ic_depo_yol_basina_surec_acmaz(self):
        """Taşınmış ana deponun worktree'si: `.git` dosyası artık olmayan bir yolu gösterir, git o klasörde
        hiç çalışmaz. Oradaki yollar değerlendirilemez sayılır; açılan süreç yol sayısıyla büyümez."""
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        eski = os.path.join(os.path.realpath(tmp.name), "eski")
        os.makedirs(eski)
        git(eski, "init", "-q")
        with open(os.path.join(eski, ".gitignore"), "w", encoding="utf-8") as f:
            f.write("zz.gizli\n")
        with open(os.path.join(eski, "a.py"), "w", encoding="utf-8") as f:
            f.write("x = 1\n")
        git(eski, "add", "-A")
        git(eski, "-c", "user.email=t@example.invalid", "-c", "user.name=t", "commit", "-qm", "ilk")
        git(eski, "worktree", "add", "-q", ".worktrees/x", "-b", "x")
        os.makedirs(os.path.join(eski, ".worktrees", "x", "src"))
        yollar = [f".worktrees/x/src/f{i:03}.py" for i in range(100)]
        for y in yollar:
            with open(os.path.join(eski, *y.split("/")), "w", encoding="utf-8") as f:
                f.write("y = 2\n")
        yeni = os.path.join(os.path.realpath(tmp.name), "yeni")
        os.rename(eski, yeni)
        self.assertNotEqual(subprocess.run(["git", "status"], cwd=os.path.join(yeni, ".worktrees", "x"),
                                           capture_output=True).returncode, 0)
        m, komutlar = self.sayan_modul()
        sonuc = m.git_disi(yeni, ["a.py"] + yollar + ["zz.gizli"])
        self.assertEqual(sorted(sonuc), sorted(yollar + ["zz.gizli"]))
        self.assertEqual({sonuc[y] for y in yollar}, {m.DEGERLENDIRILEMEDI})
        self.assertEqual(sonuc["zz.gizli"], m.YOK_SAYILAN)
        self.assertLessEqual(len(komutlar), 6, komutlar)
        # Komut satırından: yaz kaydetmez, uyarır; kalan dosya kaydedilir.
        p = subprocess.run([sys.executable, DEFTER, "yaz", "--dosya", "a.py", "--dosya", yollar[0], "--ozet", "x"],
                           cwd=yeni, capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("kart yazıldı (1 dosya, 0 kavram; 1 dosya kaydedilmedi)", p.stdout)
        self.assertIn("değerlendiremedi", p.stderr)

    def test_ilklenmemis_alt_moduldeki_kayitlar_yol_basina_surec_acmaz(self):
        """Defter worktree'ler arasında ortaktır; alt modülü ilklenmemiş bir worktree'de (gitlink index'te,
        `.git` yok) oradaki kayıtlar değerlendirilemez. Açılan süreç bu kayıtların sayısıyla büyümez,
        alt modülden sonra gelen yollar yine değerlendirilir."""
        self.yaz_dosya(".gitignore", "zz.gizli\n")
        git(self.d, "submodule", "deinit", "-q", "-f", "sub")
        yollar = [f"sub/src/f{i:03}.py" for i in range(100)]
        m, komutlar = self.sayan_modul()
        sonuc = m.git_disi(self.d, ["a.py"] + yollar + ["zz.gizli"])
        self.assertEqual(sorted(sonuc), sorted(yollar + ["zz.gizli"]))
        self.assertEqual({sonuc[y] for y in yollar}, {m.DEGERLENDIRILEMEDI})
        self.assertEqual(sonuc["zz.gizli"], m.YOK_SAYILAN)
        self.assertLessEqual(len(komutlar), 6, komutlar)


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
