"""defter.py: bağlam defteri — özet + kayıttan beri yalnız fark."""
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
DEFTER = os.path.join(HERE, "..", "defter", "defter.py")


def git(cwd, *args):
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True)


class DefterTest(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
