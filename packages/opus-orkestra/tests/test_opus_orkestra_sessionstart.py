"""opus-orkestra-sessionstart.py icin sozlesme testleri (betigi okumadan, sozlesmeden yazildi).

Calistirma: python -m unittest test_opus_orkestra_sessionstart -v
"""
import json
import os
import random
import re
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", "hooks", "opus-orkestra-sessionstart.py")
REAL_SKILL = os.path.join(HERE, "..", "skill", "SKILL.md")
LIMIT = 9500
HARD = 10000
TIMEOUT = 30
LABEL_RE = re.compile(r"^# ZORUNLU CALISMA KURALI: OPUS ORKESTRA \(par[cç]a (\d+)/(\d+)\)$")
HEAD_RE = re.compile(r"^## .*$", re.M)
FM = "---\nname: opus-orkestra\ndescription: GIZLIFRONTMATTER\n---\n"


def run(args, stdin_data=b"", mod="tam"):
    """Sözleşme testleri tam modu sınar; çekirdek mod ayrı testlerde (mod=None: varsayılan)."""
    cmd = [sys.executable, SCRIPT] + list(args)
    env = dict(os.environ)
    env.pop("OPUS_ORKESTRA_MOD", None)
    if mod is not None:
        env["OPUS_ORKESTRA_MOD"] = mod
    return subprocess.run(cmd, input=stdin_data, capture_output=True, timeout=TIMEOUT, env=env)


def ctx_of(proc):
    """stdout'u UTF-8 coz, JSON'u dogrula, additionalContext don."""
    text = proc.stdout.decode("utf-8")
    data = json.loads(text)
    out = data["hookSpecificOutput"]
    assert out["hookEventName"] == "SessionStart"
    return out["additionalContext"]


class Base(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self._i = 0

    def skill(self, text):
        self._i += 1
        p = os.path.join(self._tmp.name, "skill%d.md" % self._i)
        with open(p, "w", encoding="utf-8", newline="") as f:
            f.write(text)
        return p

    def part(self, path, n=None):
        args = ["--skill", path]
        if n is not None:
            args += ["--parca", str(n)]
        p = run(args)
        self.assertEqual(p.returncode, 0, p.stderr.decode("utf-8", "replace"))
        return p

    def parts(self, text):
        """1..4 icin calistir, bos donene kadar parcalari topla."""
        path = self.skill(text)
        res = []
        for n in range(1, 5):
            p = self.part(path, n)
            if not p.stdout.strip():
                break
            res.append(ctx_of(p))
        return res

    def overhead(self):
        """Etiket+sabit paragraf yuku: kucuk govdeyle olc."""
        body = "## A\nx"
        ctxs = self.parts(FM + body)
        self.assertEqual(len(ctxs), 1)
        oh = len(ctxs[0]) - len(body)
        self.assertGreater(oh, 0)
        self.assertLess(oh, 2000)
        return oh

    def assertNoLoss(self, ctxs, expected_headings):
        found = []
        for c in ctxs:
            found += HEAD_RE.findall(c)
        self.assertEqual(found, expected_headings)


def last(title, size, ch="a"):
    """Sonda \n olmayan blok; uzunluk == size."""
    return block(title, size, ch)[:-1] + ch


def block(title, size, ch="a"):
    """'## title\\n' + dolgu + '\\n' ; toplam uzunluk == size (sondaki \\n dahil)."""
    head = "## %s\n" % title
    return head + ch * (size - len(head) - 1) + "\n"


class TestSmall(Base):
    def test_single_part_and_label(self):
        body = "## Bir\nmerhaba\n## Iki\ndunya\n"
        ctxs = self.parts(FM + body)
        self.assertEqual(len(ctxs), 1)
        c = ctxs[0]
        m = LABEL_RE.match(c.split("\n")[0])
        self.assertIsNotNone(m, c.split("\n")[0])
        self.assertEqual((m.group(1), m.group(2)), ("1", "1"))
        self.assertIn("/skill1.md", c)  # gosterilen yol --skill ile verilen dosya
        self.assertIn("Read", c)
        self.assertTrue(c.endswith(body))
        self.assertNotIn("UYARI", c)

    def test_output_is_json_utf8_exit0(self):
        p = self.part(self.skill(FM + "## A\nx\n"), 1)
        out = json.loads(p.stdout.decode("utf-8"))
        self.assertEqual(out["hookSpecificOutput"]["hookEventName"], "SessionStart")
        self.assertIsInstance(out["hookSpecificOutput"]["additionalContext"], str)

    def test_intro_before_first_heading_kept(self):
        body = "Giris metni burada.\n\n## Bir\nx\n"
        ctxs = self.parts(FM + body)
        self.assertEqual(len(ctxs), 1)
        self.assertTrue(ctxs[0].endswith(body))

    def test_frontmatter_excluded(self):
        ctxs = self.parts(FM + "## A\nx\n")
        self.assertNotIn("GIZLIFRONTMATTER", ctxs[0])
        self.assertNotIn("description:", ctxs[0])

    def test_no_frontmatter_works(self):
        body = "## A\nx\n## B\ny\n"
        ctxs = self.parts(body)
        self.assertEqual(len(ctxs), 1)
        self.assertTrue(ctxs[0].endswith(body))


class TestBoundary(Base):
    def test_exact_limit_fits_one_part(self):
        oh = self.overhead()
        total = LIMIT - oh
        body = block("A", 4000) + last("B", total - 4000)
        self.assertEqual(len(body), total)
        ctxs = self.parts(FM + body)
        self.assertEqual(len(ctxs), 1)
        self.assertEqual(len(ctxs[0]), LIMIT)

    def test_one_char_over_splits(self):
        oh = self.overhead()
        total = LIMIT - oh + 1
        body = block("A", 4000) + last("B", total - 4000)
        self.assertEqual(len(body), total)
        ctxs = self.parts(FM + body)
        self.assertEqual(len(ctxs), 2)
        self.assertNoLoss(ctxs, ["## A", "## B"])
        for c in ctxs:
            self.assertLessEqual(len(c), LIMIT)
            self.assertNotIn("UYARI", c)
        self.assertEqual(LABEL_RE.match(ctxs[0].split("\n")[0]).group(2), "2")
        self.assertEqual(LABEL_RE.match(ctxs[1].split("\n")[0]).group(1), "2")

    def test_single_block_exactly_at_limit(self):
        oh = self.overhead()
        body = last("A", LIMIT - oh)
        ctxs = self.parts(FM + body)
        self.assertEqual(len(ctxs), 1)
        self.assertEqual(len(ctxs[0]), LIMIT)
        self.assertNotIn("UYARI", ctxs[0])

    def test_greedy_order_preserved(self):
        # birinci-uygun (first-fit) 2000'i 1. parcaya koyardi; acgozlu koymaz.
        body = block("A", 6000) + block("B", 5000) + block("C", 3000) + block("D", 2000)[:-1]
        ctxs = self.parts(FM + body)
        self.assertEqual(len(ctxs), 3)
        self.assertNoLoss(ctxs, ["## A", "## B", "## C", "## D"])
        self.assertEqual(HEAD_RE.findall(ctxs[0]), ["## A"])
        self.assertEqual(HEAD_RE.findall(ctxs[1]), ["## B", "## C"])
        self.assertEqual(HEAD_RE.findall(ctxs[2]), ["## D"])
        for c in ctxs:
            self.assertLessEqual(len(c), LIMIT)

    def test_reassembly_equals_original_body(self):
        blocks = [block("H%d" % i, 3300, chr(97 + i)) for i in range(7)]
        blocks[-1] = blocks[-1][:-1]
        body = "".join(blocks)
        ctxs = self.parts(FM + body)
        self.assertGreaterEqual(len(ctxs), 2)
        rebuilt = ""
        for c in ctxs:
            # govde, parcanin sonunda blok(lar) olarak durur: ilk '## ' satirindan sonrasi
            m = HEAD_RE.search(c)
            self.assertIsNotNone(m)
            rebuilt += c[m.start():]
        self.assertEqual(rebuilt, body)
        for c in ctxs:
            self.assertLessEqual(len(c), LIMIT)
            self.assertLess(len(c), HARD)


class TestHeadings(Base):
    def test_no_heading_lost_or_duplicated(self):
        names = ["Alfa", "Beta", "Gama", "Delta", "Epsilon", "Zeta"]
        body = "".join(block(n, 2900, "k") for n in names)
        ctxs = self.parts(FM + body)
        self.assertGreaterEqual(len(ctxs), 2)
        self.assertNoLoss(ctxs, ["## " + n for n in names])

    def test_midline_double_hash_not_heading(self):
        a_text = "## A\n" + "x" * 2500 + " metin ## x bolunmez " + "y" * 2500 + "\n"
        body = block("P", 5000) + a_text + last("Z", 5000)
        ctxs = self.parts(FM + body)
        self.assertEqual(len(ctxs), 3)
        holders = [c for c in ctxs if a_text in c]
        self.assertEqual(len(holders), 1)
        self.assertNoLoss(ctxs, ["## P", "## A", "## Z"])

    def test_triple_hash_not_split_point(self):
        a_text = "## A\n" + "x" * 2300 + "\n### alt\n" + "y" * 2300 + "\n"
        body = block("P", 5000) + a_text + last("Z", 5000)
        ctxs = self.parts(FM + body)
        self.assertEqual(len(ctxs), 3)
        holders = [c for c in ctxs if a_text in c]
        self.assertEqual(len(holders), 1)
        self.assertNoLoss(ctxs, ["## P", "## A", "## Z"])


class TestTurkish(Base):
    def test_chars_not_bytes(self):
        oh = self.overhead()
        total = LIMIT - oh
        body = last("Şöyle İğüÇ", total, "ş")
        self.assertEqual(len(body), total)
        self.assertGreater(len(body.encode("utf-8")), LIMIT)  # bayt olarak sinirin ustunde
        ctxs = self.parts(FM + body)
        self.assertEqual(len(ctxs), 1)
        self.assertEqual(len(ctxs[0]), LIMIT)
        self.assertTrue(ctxs[0].endswith(body))

    def test_one_char_over_turkish_splits(self):
        oh = self.overhead()
        total = LIMIT - oh + 1
        body = block("Çğ", 3000, "ı") + last("İş", total - 3000, "ö")
        ctxs = self.parts(FM + body)
        self.assertEqual(len(ctxs), 2)
        self.assertNoLoss(ctxs, ["## Çğ", "## İş"])

    def test_stdout_decodes_utf8(self):
        body = "## Başlık ğüşiöç ĞÜŞİÖÇ\nTürkçe içerik\n"
        p = self.part(self.skill(FM + body), 1)
        p.stdout.decode("utf-8")  # ham stdout hatasiz UTF-8 olmali (strict)
        self.assertIn("Türkçe içerik", ctx_of(p))
        self.assertIn("## Başlık ğüşiöç ĞÜŞİÖÇ", ctx_of(p))


class TestParcaArg(Base):
    def setUp(self):
        super().setUp()
        self.path = self.skill(FM + "## A\nx\n")

    def test_n_greater_than_m_empty(self):
        for n in (2, 3, 4):
            p = self.part(self.path, n)
            self.assertEqual(p.stdout.strip(), b"")

    def test_default_is_part_one(self):
        d = self.part(self.path)
        self.assertEqual(d.stdout, self.part(self.path, 1).stdout)
        self.assertRegex(ctx_of(d), r"\(par[cç]a 1/1\)")

    def test_invalid_values_mean_one(self):
        ref = self.part(self.path, 1).stdout
        for bad in ("abc", "0", "5", "-1", "99", ""):
            p = run(["--skill", self.path, "--parca", bad])
            self.assertEqual(p.returncode, 0)
            self.assertEqual(p.stdout, ref, "parca=%r" % bad)

    def test_parca_without_value(self):
        p = run(["--skill", self.path, "--parca"])
        self.assertEqual(p.returncode, 0)
        self.assertEqual(p.stdout, self.part(self.path, 1).stdout)


class TestOverflow(Base):
    def test_giant_block_warns(self):
        body = (block("Kucuk Bir", 500) + block("DEV BASLIK ADI", 12000, "d")
                + block("Kucuk Iki", 500)[:-1])
        ctxs = self.parts(FM + body)
        self.assertGreaterEqual(len(ctxs), 1)
        first = ctxs[0]
        lines = first.split("\n")
        self.assertIsNotNone(LABEL_RE.match(lines[0]))
        widx = [i for i, l in enumerate(lines) if l.startswith("UYARI:")]
        self.assertEqual(len(widx), 1, first[:600])
        w = lines[widx[0]]
        self.assertIn("DEV BASLIK ADI", w)
        self.assertNotIn("Kucuk Bir", w)
        self.assertIn("Read ile oku", w)
        # uyari govdeden once
        first_head = HEAD_RE.search(first)
        self.assertLess(first.index(w), first_head.start())
        for c in ctxs:
            self.assertLessEqual(len(c), LIMIT)
            self.assertLess(len(c), HARD)
        # uyari yalniz 1. parcada; sigmayan blok govdede yok; digerleri duruyor
        for c in ctxs[1:]:
            self.assertNotIn("UYARI", c)
        found = []
        for c in ctxs:
            found += HEAD_RE.findall(c)
        self.assertEqual(found, ["## Kucuk Bir", "## Kucuk Iki"])
        self.assertNotIn("d" * 1000, "".join(ctxs))

    def test_more_than_four_parts_warns(self):
        names = ["P%d_ADI" % i for i in range(1, 6)]
        body = "".join(block(n, 8000, "m") for n in names)[:-1]
        ctxs = self.parts(FM + body)
        self.assertEqual(len(ctxs), 4)
        first = ctxs[0]
        warn = [l for l in first.split("\n") if l.startswith("UYARI:")]
        self.assertEqual(len(warn), 1)
        self.assertIn("P5_ADI", warn[0])
        for kept in names[:4]:
            self.assertNotIn(kept, warn[0])
        for i, c in enumerate(ctxs, 1):
            self.assertLessEqual(len(c), LIMIT)
            self.assertLess(len(c), HARD)
            self.assertEqual(LABEL_RE.match(c.split("\n")[0]).groups(), (str(i), "4"))
        found = []
        for c in ctxs:
            found += HEAD_RE.findall(c)
        self.assertEqual(found, ["## " + n for n in names[:4]])
        # 5. parca yok
        p = self.part(self.skill(FM + body), 4)
        self.assertTrue(p.stdout.strip())

    def test_no_silent_loss_invariant(self):
        # her baslik ya govdede ya uyarida gorunmeli
        names = ["S%d_ISIM" % i for i in range(7)]
        sizes = [3000, 12000, 9000, 4000, 9400, 2000, 9000]
        body = "".join(block(n, s, "q") for n, s in zip(names, sizes))[:-1]
        ctxs = self.parts(FM + body)
        joined = "\n".join(ctxs)
        warn0 = warn_line(ctxs[0]) or ""
        for n in names:
            self.assertTrue(n in joined or re.search(r"b[öo]l[üu]m daha", warn0), n)
        kept = HEAD_RE.findall(joined)
        warn = [l for l in ctxs[0].split("\n") if l.startswith("UYARI:")]
        for n in names:
            if "## " + n not in kept:
                self.assertEqual(len(warn), 1)
                self.assertIn(n, warn[0])
        for c in ctxs:
            self.assertLessEqual(len(c), LIMIT)


class TestWarningExact(Base):
    def test_warning_literal_text(self):
        body = block("Kucuk", 500) + last("DEV BASLIK ADI", 12000, "d")
        first = self.parts(FM + body)[0]
        want = ("UYARI: kuralların bir kısmı hook sınırına sığmadı (DEV BASLIK ADI). "
                "İşe başlamadan dosyanın tamamını Read ile oku.")
        self.assertTrue(any(l.startswith(want) for l in first.splitlines()), first[:900])


class TestRobustness(Base):
    def test_missing_file_exit0(self):
        p = run(["--skill", os.path.join(self._tmp.name, "yok.md")])
        self.assertEqual(p.returncode, 0)

    def test_unreadable_path_exit0(self):
        p = run(["--skill", self._tmp.name])  # dizin: okunamaz
        self.assertEqual(p.returncode, 0)

    def test_stdin_json_ignored(self):
        path = self.skill(FM + "## A\nx\n")
        hook = json.dumps({"session_id": "s", "hook_event_name": "SessionStart", "source": "startup"}).encode()
        p = run(["--skill", path], stdin_data=hook)
        self.assertEqual(p.returncode, 0)
        self.assertEqual(p.stdout, self.part(path, 1).stdout)

    def test_stdin_closed_no_hang(self):
        path = self.skill(FM + "## A\nx\n")
        p = subprocess.run([sys.executable, SCRIPT, "--skill", path], stdin=subprocess.DEVNULL,
                           capture_output=True, timeout=TIMEOUT)
        self.assertEqual(p.returncode, 0)
        self.assertTrue(p.stdout.strip())

    def test_stdin_open_never_written_no_hang(self):
        path = self.skill(FM + "## A\nx\n")
        proc = subprocess.Popen([sys.executable, SCRIPT, "--skill", path], stdin=subprocess.PIPE,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            try:
                rc = proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                self.fail("stdin acik ama bos iken betik takildi")
            self.assertEqual(rc, 0)
        finally:
            if proc.poll() is None:
                proc.kill()
            for s in (proc.stdin, proc.stdout, proc.stderr):
                try:
                    s.close()
                except Exception:
                    pass
            proc.wait()


class Extra(Base):
    def skill_bytes(self, data):
        self._i += 1
        p = os.path.join(self._tmp.name, "skillb%d.md" % self._i)
        with open(p, "wb") as f:
            f.write(data)
        return p

    def assertEmptyParts(self, path, ns=(2, 3, 4)):
        for n in ns:
            p = self.part(path, n)
            self.assertEqual(p.stdout.strip(), b"", "parca %d" % n)


class TestSoleGiantBlock(Extra):
    def check(self, text, title=None):
        path = self.skill(text)
        c = ctx_of(self.part(path, 1))
        self.assertRegex(c.split("\n")[0], r"^# ZORUNLU CALISMA KURALI: OPUS ORKESTRA \(par[cç]a 1/1\)$")
        self.assertIn("UYARI:", c)
        self.assertLessEqual(len(c), LIMIT)
        if title:
            warn = [l for l in c.split("\n") if l.startswith("UYARI:")]
            self.assertEqual(len(warn), 1)
            self.assertIn(title, warn[0])
        self.assertEmptyParts(path)

    def test_headed_sole_giant(self):
        self.check(FM + last("TEK DEV BASLIK", 12000, "g"), "TEK DEV BASLIK")

    def test_headless_sole_giant(self):
        self.check(FM + "g" * 12000)

    def test_headed_sole_giant_no_frontmatter(self):
        self.check(last("TEK DEV 2", 11000, "g"), "TEK DEV 2")


class TestBadEncoding(Extra):
    def check(self, data):
        path = self.skill_bytes(data)
        p = self.part(path, 1)
        c = ctx_of(p)
        self.assertRegex(c, r"(?i)okunamad")
        self.assertIn("Read", c)
        self.assertRegex(c, r"(?i)kullan[ıi]c[ıi]")
        self.assertEmptyParts(path)

    def test_cp1254(self):
        self.check((FM + "## Başlık ğüşıİ\nçalışma kuralı\n").encode("cp1254"))

    def test_utf16(self):
        self.check((FM + "## A\nx\n").encode("utf-16"))


class TestBomAndBrokenFrontmatter(Extra):
    def test_bom_frontmatter_stripped(self):
        body = "## A\nx\n## B\ny\n"
        path = self.skill_bytes((FM + body).encode("utf-8-sig"))
        c = ctx_of(self.part(path, 1))
        self.assertNotIn("name:", c)
        self.assertNotIn("description:", c)
        self.assertNotIn("GIZLIFRONTMATTER", c)
        self.assertNoLoss([c], ["## A", "## B"])

    def test_dashes_with_text_first_line(self):
        ctxs = self.parts("---- B ----\n## A\nx\n## B\ny\n")
        self.assertNoLoss(ctxs, ["## A", "## B"])

    def test_unclosed_frontmatter(self):
        ctxs = self.parts("---\nname: x\n## A\nx\n## B\ny\n")
        self.assertNoLoss(ctxs, ["## A", "## B"])

    def test_unclosed_frontmatter_heading_right_after(self):
        ctxs = self.parts("---\n## A\nx\n## B\ny\n")
        self.assertNoLoss(ctxs, ["## A", "## B"])


class TestFixedParagraph(Extra):
    def test_paragraph_mentions_count_and_order(self):
        c = self.parts(FM + "## A\nx\n")[0]
        para = c.split("\n\n")[1]
        self.assertRegex(para, r"(?i)par[cç]a")
        self.assertRegex(para, r"(?i)s[ıi]ra")
        self.assertRegex(para, r"(?i)kar[ıi][sş]")
        self.assertRegex(para, r"\d")  # parca sayisi


def sysmsg_of(proc):
    """systemMessage: ust duzeyde; yoksa hookSpecificOutput icinde; yoksa ''."""
    data = json.loads(proc.stdout.decode("utf-8"))
    v = data.get("systemMessage")
    if v is None:
        v = data.get("hookSpecificOutput", {}).get("systemMessage")
    return v or ""


def warn_line(ctx):
    w = [l for l in ctx.split("\n") if l.startswith("UYARI:")]
    return w[0] if w else None


class TestLossBranches(Extra):
    def first(self, text):
        p = self.part(self.skill(text), 1)
        return ctx_of(p), sysmsg_of(p)

    def test_loss_sets_eksik(self):
        c, s = self.first(FM + block("Kucuk", 500) + last("DEV", 12000, "d"))
        self.assertIn("UYARI:", c)
        self.assertIn("eksik", s)

    def test_no_loss_no_eksik(self):
        c, s = self.first(FM + "## A\nx\n## B\ny\n")
        self.assertNotIn("UYARI:", c)
        self.assertNotIn("eksik", s)

    def test_only_truly_unfitting_blocks_dropped(self):
        body = block("A", 8900, "a") + block("B", 8900, "b") + block("C", 8900, "c") + last("G", 12000, "g")
        ctxs = self.parts(FM + body)
        self.assertLessEqual(len(ctxs), 4)
        for c in ctxs:
            self.assertLessEqual(len(c), LIMIT)
        self.assertNoLoss(ctxs, ["## A", "## B", "## C"])
        w = warn_line(ctxs[0])
        self.assertIsNotNone(w)
        self.assertRegex(w, r"\bG\b")
        for k in "ABC":
            self.assertNotRegex(w, r"\(%s\b|, %s\b" % (k, k))

    def test_warning_titles_truncated_to_60(self):
        titles = ["%02d" % i + "ĞşÇ" * 40 for i in range(30)]  # 122 karakter
        body = "".join(block(t, 9800, "z") for t in titles)[:-1]
        c = ctx_of(self.part(self.skill(FM + body), 1))
        self.assertLessEqual(len(c), LIMIT)
        w = warn_line(c)
        self.assertIsNotNone(w)
        self.assertRegex(w, r"b[öo]l[üu]m daha")
        self.assertRegex(w, r"ve \d+ b[öo]l[üu]m daha")
        # hicbir baslik 60 karakterden uzun gecmez
        for t in titles:
            self.assertNotIn(t[:61], w)
        self.assertTrue(any(t[:50] in w for t in titles))  # 60 sinirinda … payi birakilabilir

    def test_empty_like_files(self):
        cases = {
            "bos0": b"",
            "yalniz_bom": b"\xef\xbb\xbf",
            "yalniz_frontmatter": FM.encode("utf-8"),
            "yalniz_bosluk": b"   \n\n \t \n",
        }
        for name, data in cases.items():
            path = self.skill_bytes(data)
            p = self.part(path, 1)
            self.assertTrue(p.stdout.strip(), name)
            c = ctx_of(p)
            self.assertTrue(c.strip(), name)
            self.assertLessEqual(len(c), LIMIT)
            self.assertTrue(sysmsg_of(p).strip(), name + ": systemMessage bos")
            self.assertEmptyParts(path)


class TestInvariants(Extra):
    SEED = 20261105
    ALPHA = "abcçdefgğhıiİjklmnoöprsştuüvyzŞĞÜÖÇ"
    SIZES = [20, 60, 300, 1500, 4000, 7000, 8900, 9300, 9800, 12000]

    def gen(self, rnd):
        blocks = []  # (metin, baslik|None)
        if rnd.random() < 0.3:
            blocks.append(("INTRO " + "ş" * rnd.choice([10, 500, 9000, 11000]) + "\n", None))
        for i in range(rnd.choice([0, 1, 2, 3, 5, 8, 12])):
            tl = rnd.choice([3, 10, 40, 70, 120])
            title = "%02d-" % i + "".join(rnd.choice(self.ALPHA) for _ in range(tl))
            size = rnd.choice(self.SIZES)
            head = "## " + title + "\n"
            fill = "".join(rnd.choice("aşğüİ x") for _ in range(max(size - len(head) - 1, 1)))
            fill = "q" + fill[1:]
            blocks.append((head + fill + "\n", title))
        if not blocks:
            blocks.append(("INTRO tek\n", None))
        t, h = blocks[-1]
        blocks[-1] = (t[:-1], h)  # son blokta sondaki \n yok
        return blocks

    def run_all(self, path):
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(4) as ex:
            return list(ex.map(lambda n: run(["--skill", path, "--parca", str(n)]), range(1, 5)))

    def one(self, idx, blocks):
        body = "".join(t for t, _ in blocks)
        desc = "seed=%d dosya#%d bloklar=%s govde=%d" % (
            self.SEED, idx, [(len(t), h and h[:12]) for t, h in blocks], len(body))
        # paralel calisirken self.skill'in ortak sayaci yaris yaratir: dosya adi idx'e ozgu
        path = os.path.join(self._tmp.name, "inv%d.md" % idx)
        with open(path, "w", encoding="utf-8", newline="") as fh:
            fh.write(FM + body)
        procs = self.run_all(path)
        ctxs, first_sys = [], ""
        for n, p in enumerate(procs, 1):
            self.assertEqual(p.returncode, 0, desc)
            if p.stdout.strip():
                c = ctx_of(p)  # gecerli JSON
                self.assertLessEqual(len(c), LIMIT, desc + " parca %d" % n)
                ctxs.append(c)
                if n == 1:
                    first_sys = sysmsg_of(p)
            else:
                self.assertGreater(n, 1, desc + ": parca 1 bos")
        self.assertGreaterEqual(len(ctxs), 1, desc)
        # parcalar ardisik, bos olan sonra bos kalir
        for n in range(len(ctxs), 4):
            self.assertEqual(procs[n].stdout.strip(), b"", desc)
        # blok bulunurlugu ve sira
        placed, last_pos = [], (-1, -1)
        lost = []
        for bi, (t, h) in enumerate(blocks):
            where = [ci for ci, c in enumerate(ctxs) if t in c]
            self.assertLessEqual(len(where), 1, desc + " blok #%d coklandi" % bi)
            if where:
                pos = (where[0], ctxs[where[0]].index(t))
                self.assertGreater(pos, last_pos, desc + " sira bozuk blok #%d" % bi)
                last_pos = pos
            else:
                lost.append((bi, h))
        heads_in_bodies = []
        for c in ctxs:
            heads_in_bodies += [x[3:] for x in HEAD_RE.findall(c)]
        w = warn_line(ctxs[0])
        if lost:
            self.assertIsNotNone(w, desc + ": kayip var, UYARI yok")
            self.assertIn("eksik", first_sys, desc)
            for bi, h in lost:
                if h is not None:
                    self.assertNotIn(h, heads_in_bodies, desc + " kirpilmis blok govdede")
                    self.assertTrue(h[:50] in w or re.search(r"b[öo]l[üu]m daha", w),
                                    desc + " baslik UYARI'da yok: " + h[:20])
        else:
            self.assertIsNone(w, desc)
            self.assertNotIn("eksik", first_sys, desc)
        for c in ctxs[1:]:
            self.assertIsNone(warn_line(c), desc)

    def test_random_inputs_invariants(self):
        rnd = random.Random(self.SEED)
        files = [self.gen(rnd) for _ in range(40)]
        from concurrent.futures import ThreadPoolExecutor
        # uretim (yukaridaki rnd) ardisik; yalniz self.one cagrilari 8 is parcacigiyla paralel
        # (her dosya kendi adli gecici dosyada; her one() ayrica 4 alt surec baslatir)
        def job(item):
            idx, blocks = item
            try:
                self.one(idx, blocks)
            except Exception as e:
                raise AssertionError("dosya#%d basarisiz: %s" % (idx, e)) from e

        with ThreadPoolExecutor(8) as ex:
            for fut in [ex.submit(job, it) for it in enumerate(files)]:
                fut.result()


class TestRealSkill(Base):
    """Koruma testi: metin buyuyup sigmayinca kirilir (65 oturumluk sessiz kesilme tekrarlanmasin)."""

    def test_real_skill_fits_without_warning(self):
        self.assertTrue(os.path.isfile(REAL_SKILL), REAL_SKILL)
        with open(REAL_SKILL, "r", encoding="utf-8") as f:
            raw = f.read()
        m = re.match(r"\A---\r?\n.*?\r?\n---\r?\n", raw, re.S)
        body = raw[m.end():] if m else raw
        headings = HEAD_RE.findall(body.replace("\r\n", "\n"))

        ctxs = []
        for n in range(1, 5):
            p = run(["--skill", REAL_SKILL, "--parca", str(n)])
            self.assertEqual(p.returncode, 0, p.stderr.decode("utf-8", "replace"))
            if not p.stdout.strip():
                break
            ctxs.append(ctx_of(p))
        self.assertGreaterEqual(len(ctxs), 1)
        total = len(ctxs)
        for i, c in enumerate(ctxs, 1):
            self.assertNotIn("UYARI", c, "kurallar sigmadi: SKILL.md hook sinirini asti")
            self.assertLessEqual(len(c), LIMIT, "parca %d" % i)
            self.assertLess(len(c), HARD)
            self.assertEqual(LABEL_RE.match(c.split("\n")[0]).groups(), (str(i), str(total)))
        # n = m+1 bos
        if total < 4:
            self.assertEqual(run(["--skill", REAL_SKILL, "--parca", str(total + 1)]).stdout.strip(), b"")
        # her baslik tam bir parcada, tam bir kez
        for h in headings:
            holders = sum(len(re.findall(r"^%s$" % re.escape(h), c, re.M)) for c in ctxs)
            self.assertEqual(holders, 1, "baslik %r %d kez" % (h, holders))
        found = []
        for c in ctxs:
            found += HEAD_RE.findall(c)
        self.assertEqual(found, headings)


class TestSkillResolution(Base):
    """Bulma sirasi: --skill > OPUS_ORKESTRA_SKILL > ~/.claude kurulumu > ../skill/SKILL.md."""

    def run_env(self, args, env_skill=None, home=None):
        env = dict(os.environ)
        env.pop("OPUS_ORKESTRA_SKILL", None)
        env["OPUS_ORKESTRA_MOD"] = "tam"
        if env_skill is not None:
            env["OPUS_ORKESTRA_SKILL"] = env_skill
        if home is not None:
            env["HOME"] = home
            env["USERPROFILE"] = home
        return subprocess.run([sys.executable, SCRIPT] + args, capture_output=True, timeout=TIMEOUT, env=env)

    def fake_home(self, text=None):
        home = os.path.join(self._tmp.name, "home")
        d = os.path.join(home, ".claude", "skills", "opus-orkestra")
        os.makedirs(d, exist_ok=True)
        if text is not None:
            with open(os.path.join(d, "SKILL.md"), "w", encoding="utf-8", newline="") as f:
                f.write(text)
        return home

    def test_arg_beats_env_and_home(self):
        a = self.skill("## A\nARGMARK\n")
        e = self.skill("## E\nENVMARK\n")
        home = self.fake_home("## H\nHOMEMARK\n")
        c = ctx_of(self.run_env(["--skill", a], env_skill=e, home=home))
        self.assertIn("ARGMARK", c)
        self.assertNotIn("ENVMARK", c)
        self.assertNotIn("HOMEMARK", c)

    def test_env_beats_home(self):
        e = self.skill("## E\nENVMARK\n")
        home = self.fake_home("## H\nHOMEMARK\n")
        c = ctx_of(self.run_env([], env_skill=e, home=home))
        self.assertIn("ENVMARK", c)
        self.assertNotIn("HOMEMARK", c)

    def same_as_package(self):
        """Depodaki SKILL.md'nin CRLF + BOM'lu kopyasi: icerikce ayni sayilir (bayat degil)."""
        with open(REAL_SKILL, "rb") as f:
            veri = f.read().replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
        return "﻿" + veri.decode("utf-8")

    def test_home_beats_package(self):
        # icerik ayniyken kurulu kopya secilir (gosterilen yol ~ ile); farkliysa bkz. TestBayatKurulum
        home = self.fake_home(self.same_as_package())
        p = self.run_env([], home=home)
        c = ctx_of(p)
        self.assertIn("~/.claude/skills/opus-orkestra/SKILL.md", c)
        self.assertNotIn(os.path.normpath(REAL_SKILL).replace(os.sep, "/"), c)
        self.assertNotIn("bayat", sysmsg_of(p))

    def test_package_relative_fallback(self):
        home = self.fake_home(None)
        c = ctx_of(self.run_env([], home=home))
        with open(REAL_SKILL, "r", encoding="utf-8") as f:
            first_heading = HEAD_RE.findall(f.read())[0]
        self.assertIn(first_heading, c)

    def test_missing_env_falls_through(self):
        home = self.fake_home(self.same_as_package())
        c = ctx_of(self.run_env([], env_skill=os.path.join(self._tmp.name, "yok.md"), home=home))
        self.assertIn("~/.claude/skills/opus-orkestra/SKILL.md", c)


    def test_default_install_shows_tilde_path(self):
        home = self.fake_home(self.same_as_package())
        c = ctx_of(self.run_env([], home=home))
        self.assertIn("~/.claude/skills/opus-orkestra/SKILL.md", c)

    def test_env_path_shown(self):
        e = self.skill("## E\nENVMARK\n")
        c = ctx_of(self.run_env([], env_skill=e, home=self.fake_home(None)))
        self.assertIn(os.path.abspath(e).replace(os.sep, "/"), c)
        self.assertNotIn("~/.claude/skills/opus-orkestra/SKILL.md", c)

    def test_package_path_shown(self):
        c = ctx_of(self.run_env([], home=self.fake_home(None)))
        pkg = os.path.normpath(REAL_SKILL).replace(os.sep, "/")
        self.assertIn(pkg, c)
        self.assertNotIn("~/.claude/skills/opus-orkestra/SKILL.md", c)


class TestLabelExact(Base):
    def test_label_literal_has_cedilla(self):
        c = self.parts(FM + "## A\nx\n")[0]
        self.assertEqual(c.split("\n")[0], "# ZORUNLU CALISMA KURALI: OPUS ORKESTRA (parça 1/1)")


if __name__ == "__main__":
    unittest.main()


class CekirdekMod(unittest.TestCase):
    """Varsayılan mod: yalnız kısa çekirdek kural enjekte edilir (her oturumda ~33 KB yerine ~3 KB)."""

    def test_varsayilan_cekirdek_tek_parca_ve_kisa(self):
        p1 = run(["--skill", REAL_SKILL, "--parca", "1"], mod=None)
        self.assertEqual(p1.returncode, 0)
        ctx = ctx_of(p1)
        self.assertIn("core rule", ctx)
        self.assertIn("defter oku", ctx)
        self.assertRegex(ctx, r"`defter` command here: `.+defter/defter\.py`")
        self.assertLess(len(ctx), 4000)
        self.assertIn("çekirdek", json.loads(p1.stdout.decode("utf-8"))["systemMessage"])
        for n in ("2", "3", "4"):
            p = run(["--skill", REAL_SKILL, "--parca", n], mod=None)
            self.assertEqual(p.returncode, 0)
            self.assertEqual(p.stdout.strip(), b"")

    def test_cekirdek_secilen_skill_yolunu_gosterir(self):
        with tempfile.TemporaryDirectory() as d:
            yol = os.path.join(d, "SKILL.md")
            with open(yol, "w", encoding="utf-8") as f:
                f.write(FM + "## A\nx\n")
            ctx = ctx_of(run(["--skill", yol], mod="cekirdek"))
            self.assertIn(yol.replace(os.sep, "/").split("/")[-1], ctx)
            self.assertNotIn("~/.claude/skills/opus-orkestra/SKILL.md", ctx.replace(yol, ""))

    def test_tam_mod_eski_davranis(self):
        p = run(["--skill", REAL_SKILL, "--parca", "1"], mod="tam")
        self.assertTrue(LABEL_RE.match(ctx_of(p).split("\n", 1)[0]))
        p = run(["--skill", REAL_SKILL, "--parca", "1", "--mod", "tam"], mod=None)
        self.assertTrue(LABEL_RE.match(ctx_of(p).split("\n", 1)[0]))

    def test_cekirdek_yoksa_tam_moda_duser(self):
        env = dict(os.environ)
        env["OPUS_ORKESTRA_MOD"] = "cekirdek"
        env["OPUS_ORKESTRA_CEKIRDEK"] = os.path.join(tempfile.gettempdir(), "yok-cekirdek.md")
        p = subprocess.run([sys.executable, SCRIPT, "--skill", REAL_SKILL], capture_output=True,
                           timeout=TIMEOUT, env=env)
        self.assertTrue(LABEL_RE.match(ctx_of(p).split("\n", 1)[0]))


class TestBayatKurulum(Base):
    """Kurulu ~/.claude kopyasi betigin yanindaki ../skill/SKILL.md'den farkliysa sessiz gecilmez.
    Ev dizini her testte gecici dizin (HOME/USERPROFILE); gercek ~/.claude'a dokunulmaz."""

    fake_home = TestSkillResolution.fake_home
    same_as_package = TestSkillResolution.same_as_package

    STALE = "## H\r\nHOMEMARK eski kural\r\n"  # depodakinden farkli icerik
    PKG = os.path.normpath(REAL_SKILL).replace(os.sep, "/")
    TILDE = "~/.claude/skills/opus-orkestra/SKILL.md"

    def run_mod(self, args, mod, home, env_skill=None, script=SCRIPT):
        env = dict(os.environ)
        for k in ("OPUS_ORKESTRA_SKILL", "OPUS_ORKESTRA_MOD", "OPUS_ORKESTRA_CEKIRDEK"):
            env.pop(k, None)
        if mod is not None:
            env["OPUS_ORKESTRA_MOD"] = mod
        if env_skill is not None:
            env["OPUS_ORKESTRA_SKILL"] = env_skill
        env["HOME"] = home
        env["USERPROFILE"] = home
        p = subprocess.run([sys.executable, script] + args, input=b"{}", capture_output=True,
                           timeout=TIMEOUT, env=env)
        self.assertEqual(p.returncode, 0, p.stderr.decode("utf-8", "replace"))
        return p

    def all_parts(self, mod, home, **kw):
        return [self.run_mod(["--parca", str(n)], mod, home, **kw) for n in range(1, 5)]

    def assertNoStaleWarning(self, procs):
        for p in procs:
            if p.stdout.strip():
                self.assertNotIn("bayat", sysmsg_of(p))
                self.assertNotIn("bayat", ctx_of(p))

    def test_farkli_cekirdek_guncel_yolu_gosterir_ve_uyarir(self):
        home = self.fake_home(self.STALE)
        procs = self.all_parts(None, home)
        c, s = ctx_of(procs[0]), sysmsg_of(procs[0])
        self.assertIn(self.PKG, c)  # model guncel (depo) kopyaya yonlenir
        self.assertNotIn(self.TILDE + " dosyasını oku", c)
        self.assertIn("bayat", c)
        self.assertIn("Skill", c)  # Skill araciyla bayat kopyayi yuklememesi soylenir
        self.assertLessEqual(len(c), LIMIT)
        self.assertIn("bayat", s)
        self.assertIn(self.TILDE, s)
        self.assertRegex(s, r"install\.(ps1|sh)")
        self.assertNotIn("—", c[c.index("bayat") - 60:] + s)  # hook'un ekledigi metinde uzun tire yok
        for p in procs[1:]:  # uyari bir kez: 2-4 bos
            self.assertEqual(p.stdout.strip(), b"")

    def test_farkli_tam_mod_guncel_icerik_uyari_bir_kez(self):
        home = self.fake_home(self.STALE)
        procs = self.all_parts("tam", home)
        ctxs = [ctx_of(p) for p in procs if p.stdout.strip()]
        joined = "".join(ctxs)
        self.assertNotIn("HOMEMARK", joined)
        with open(REAL_SKILL, "r", encoding="utf-8") as f:
            headings = HEAD_RE.findall(f.read())
        self.assertEqual(HEAD_RE.findall(joined), headings)
        self.assertIn(self.PKG, ctxs[0])
        self.assertIn("bayat", sysmsg_of(procs[0]))
        for p in procs[1:]:
            if p.stdout.strip():
                self.assertNotIn("bayat", sysmsg_of(p))
        for c in ctxs:
            self.assertNotIn("UYARI", c)  # sinir sozlesmesi bozulmaz
            self.assertLessEqual(len(c), LIMIT)

    def test_yalniz_satir_sonu_ve_bom_farki_sayilmaz(self):
        home = self.fake_home(self.same_as_package())
        for mod in (None, "tam"):
            procs = self.all_parts(mod, home)
            self.assertNoStaleWarning(procs)
            self.assertIn(self.TILDE, ctx_of(procs[0]))

    def test_depo_kopyasi_yoksa_bugunku_davranis(self):
        # ~/.claude/hooks altina kopyalanmis hook: yaninda ../skill/SKILL.md yok
        hooks = os.path.join(self._tmp.name, "kopya", "hooks")
        os.makedirs(hooks)
        script = os.path.join(hooks, "opus-orkestra-sessionstart.py")
        with open(SCRIPT, "rb") as src, open(script, "wb") as dst:
            dst.write(src.read())
        home = self.fake_home(self.STALE)
        for mod in (None, "tam"):
            procs = self.all_parts(mod, home, script=script)
            self.assertNoStaleWarning(procs)
            c = ctx_of(procs[0])
            self.assertIn("HOMEMARK", c)  # cekirdek yok -> tam moda duser, kurulu kopya kullanilir
            self.assertIn(self.TILDE, c)

    def test_acik_skill_secimine_karisilmaz(self):
        home = self.fake_home(self.STALE)
        a = self.skill("## A\nARGMARK\n")
        for mod in (None, "tam"):
            p = self.run_mod(["--skill", a, "--parca", "1"], mod, home)
            self.assertNoStaleWarning([p])
        kurulu = os.path.join(home, ".claude", "skills", "opus-orkestra", "SKILL.md")
        p = self.run_mod(["--skill", kurulu], "tam", home)
        self.assertIn("HOMEMARK", ctx_of(p))  # bayat kopya acikca secildiyse o kullanilir
        self.assertNoStaleWarning([p])

    def test_ortam_degiskeni_secimine_karisilmaz(self):
        home = self.fake_home(self.STALE)
        e = self.skill("## E\nENVMARK\n")
        procs = self.all_parts("tam", home, env_skill=e)
        self.assertIn("ENVMARK", ctx_of(procs[0]))
        self.assertNoStaleWarning(procs)

    def test_kurulu_kopya_okunamazsa_cokmez(self):
        # SKILL.md bir dizin: isfile False -> depo kopyasi, uyari yok
        home = os.path.join(self._tmp.name, "home")
        os.makedirs(os.path.join(home, ".claude", "skills", "opus-orkestra", "SKILL.md"))
        procs = self.all_parts("tam", home)
        self.assertIn(self.PKG, ctx_of(procs[0]))
        self.assertNoStaleWarning(procs)
