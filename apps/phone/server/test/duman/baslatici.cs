// Duman koşusunun başlatıcısı: servisin `claude_exe`'si olarak geçici dizine `claude.exe` adıyla derlenir
// (`kosu.ts`, .NET Framework `csc.exe`). `ayar.ts` yalnız `.exe` kabul eder; `.cmd` kabuk ister.
//
// Yaptığı tek şey: yanındaki `claude.exe.duman` dosyasından (UTF-8, üç satır: node.exe, kaydedici.ts,
// kaydedici ayarı) yolları okur ve komut satırının GERİ KALANINI DEĞİŞTİRMEDEN
//   "<node>" --disable-warning=ExperimentalWarning "<kaydedici.ts>" "<ayar.json>" <geri kalan>
// olarak başlatır. Argümanlar yeniden tırnaklanmaz: servisin (libuv) tırnakladığı metin node'un CRT
// ayrıştırmasına aynen gider, argv bayt bayt korunur. Standart tanıtıcılar (boru ya da dosya) devredilir,
// çıkış kodu geri döner. Ağaç öldürmede (`taskkill /T`) torunlar da gider.
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

static class Baslatici
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct STARTUPINFO
    {
        public int cb;
        public string lpReserved, lpDesktop, lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct PROCESS_INFORMATION
    {
        public IntPtr hProcess, hThread;
        public int dwProcessId, dwThreadId;
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CreateProcessW(string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags,
        IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);

    [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int n);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h, uint ms);
    [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr h, out uint kod);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);

    const int STARTF_USESTDHANDLES = 0x100;
    const uint CREATE_NO_WINDOW = 0x08000000;

    static string Tirnak(string s) { return "\"" + s + "\""; }

    /** CreateProcess'in program adı kuralı: tırnakla başlıyorsa kapanan tırnağa, yoksa ilk boşluğa kadar. */
    static string Kalan(string satir)
    {
        int i = 0;
        if (satir.StartsWith("\""))
        {
            int k = satir.IndexOf('"', 1);
            i = k < 0 ? satir.Length : k + 1;
        }
        else
        {
            while (i < satir.Length && satir[i] != ' ' && satir[i] != '\t') i++;
        }
        return satir.Substring(i);
    }

    static int Main()
    {
        string kendi = System.Reflection.Assembly.GetExecutingAssembly().Location;
        string[] y = File.ReadAllLines(kendi + ".duman", new UTF8Encoding(false));
        if (y.Length < 3) return 94;
        StringBuilder komut = new StringBuilder(Tirnak(y[0]) + " --disable-warning=ExperimentalWarning " + Tirnak(y[1]) + " " +
            Tirnak(y[2]) + Kalan(Environment.CommandLine));
        STARTUPINFO si = new STARTUPINFO();
        si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
        si.dwFlags = STARTF_USESTDHANDLES;
        si.hStdInput = GetStdHandle(-10);
        si.hStdOutput = GetStdHandle(-11);
        si.hStdError = GetStdHandle(-12);
        PROCESS_INFORMATION pi;
        if (!CreateProcessW(null, komut, IntPtr.Zero, IntPtr.Zero, true, CREATE_NO_WINDOW,
            IntPtr.Zero, null, ref si, out pi))
        {
            return 93;
        }
        WaitForSingleObject(pi.hProcess, 0xFFFFFFFF);
        uint kod;
        if (!GetExitCodeProcess(pi.hProcess, out kod)) kod = 92;
        CloseHandle(pi.hThread);
        CloseHandle(pi.hProcess);
        return unchecked((int)kod);
    }
}
