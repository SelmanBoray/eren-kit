<#
.SYNOPSIS
    eren-kit kurulum betiği: Claude Code araç takımını tek komutla kurar ya da kaldırır.
.DESCRIPTION
    Ayrıntılı kullanım için: .\install.ps1 -Help
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string[]]$Components = @('beyin', 'devir', 'kapi', 'orkestra', 'computer-use'),
    [string]$AssistantName,
    # Claude Code ile aynı kural: CLAUDE_CONFIG_DIR ayarlıysa orası, değilse ~\.claude.
    [string]$ClaudeHome = $(if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }),
    [switch]$DryRun,
    [switch]$Uninstall,
    [switch]$SkipMcp,
    [switch]$NoService,
    [switch]$ReplaceExisting,
    [switch]$KeepExisting,
    [switch]$Doctor,
    [switch]$Json,
    [switch]$Help,
    # Test anahtarları (yardımda gösterilmez):
    # -SkipEnv: kullanıcı ortam değişkenine yazmaz.
    # -SkipRepoSetup: repo içinde ya da sistemde değişiklik yapan adımları (venv/pip, bellek.toml,
    #   npm ci, beyin servis görevi) atlar.
    [Parameter(DontShow)][switch]$SkipEnv,
    [Parameter(DontShow)][switch]$SkipRepoSetup
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$AllComponents = @('beyin', 'devir', 'kapi', 'orkestra', 'computer-use', 'phone')

function Show-Usage {
    $text = @'
eren-kit kurulum betiği

Kullanım:
  .\install.ps1 [-Components <liste>] [-AssistantName <ad>] [-ClaudeHome <klasör>]
                [-DryRun] [-Uninstall] [-SkipMcp] [-NoService] [-KeepExisting] [-Help]
  .\install.ps1 -Doctor [-Json] [-ClaudeHome <klasör>]

Bileşenler (varsayılan: beyin, devir, kapi, orkestra, computer-use):
  beyin          Yerel ikinci beyin (bellek), "beyin" MCP sunucusu ve arka plan servisi
  devir          Oturum devri hook'ları ve devir skill'i (beyin ile aynı venv)
  kapi           Belge kapısı: büyük .md okumalarında önce başlık haritası döndüren PreToolUse hook'u
  orkestra       Opus Orkestra skill'i ve SessionStart hook'ları
  computer-use   Windows computer use MCP sunucusu
  phone          Telefon uygulaması: geliştirme bağımlılıkları (npm ci); servis kaydı yapılmaz,
                 sonunda elle kurulum yönlendirmesi verilir. Yalnız açıkça istenirse kurulur

Parametreler:
  -Components     Bileşen listesi, virgülle:  -Components beyin,devir
  -AssistantName  Asistan adı; EREN_KIT_ASSISTANT_NAME kullanıcı ortam değişkenine yazılır
                  (verilmezse var olan değer korunur, yoksa "Claude")
  -ClaudeHome     Claude Code ayar klasörü (varsayılan: CLAUDE_CONFIG_DIR ortam değişkeni
                  ayarlıysa o klasör, değilse %USERPROFILE%\.claude)
  -DryRun         Hiçbir şeyi değiştirmez, yapılacakları listeler
  -Uninstall      Seçili bileşenlerin MCP kaydını, hook'larını, kopyalanan skill'lerini, beyin
                  servis görevini ve (phone için) telefon zamanlanmış görevini kaldırır; venv'leri
                  ve kullanıcı verisini silmez
  -SkipMcp        "claude mcp add/remove" adımlarını atlar
  -NoService      Zamanlanmış görevlere dokunmaz: beyin servis görevini kurmaz/kaldırmaz, kaldırmada
                  telefon görevini silmez (servisleri elle yönetirsin)
  -KeepExisting   Aynı hook betiklerinin repo dışındaki eski kopyalarının (ör. başka klasördeki
                  bellek\devir\hook.py, bellek\kapi\hook.py, ~\.claude\hooks\opus-orkestra-sessionstart.py)
                  settings.json kayıtlarını korur. Verilmezse bunlar (yedek alınarak) yenisiyle
                  değiştirilir; verilirse eskiler kalır ve o hook'lar iki kez çalışır.
  -ReplaceExisting  Eski uyumluluk anahtarı: eski kopyaların değiştirilmesi artık varsayılan, etkisi yok.
  -Doctor         Kurulum yapmaz; yalnız kurulum doktorunu (scripts\installer\doktor.py, salt okunur)
                  çalıştırır ve onun çıkış koduyla çıkar: 0 her şey tamam, 1 uyarı, 2 hata.
                  -ClaudeHome verilirse doktora geçirilir. Gerçek kurulumun sonunda doktor zaten
                  bir kez kendiliğinden çalışır (sonucu kurulumun çıkış kodunu değiştirmez).
  -Json           -Doctor ile: doktor çıktısını JSON olarak verir
  -Help           Bu yardımı gösterir

Örnekler:
  .\install.ps1
  .\install.ps1 -DryRun
  .\install.ps1 -Components beyin,devir -AssistantName Ada
  .\install.ps1 -Components phone
  .\install.ps1 -Uninstall -Components orkestra
  .\install.ps1 -Doctor

Gerekenler: Python 3.11+ (bellek için 3.12+), Claude Code CLI ("claude"), phone için Node 24+.
Yürütme ilkesi engellerse:  powershell -ExecutionPolicy Bypass -File .\install.ps1
Yedekler <ClaudeHome>\backups\eren-kit\<zaman> altına alınır; değiştirilen settings.json ve MCP
kayıtlarının (env değerleri dahil) düz metin kopyalarıdır, sır içerebilir ve kaldırmada silinmez.
MCP kayıtları "claude" CLI'nin kendi kullanıcı yapılandırmasına yazılır (-ClaudeHome'dan bağımsızdır).

Beyin servisi: beyin MCP'si yazmaları yerel servise (python -I -m bellek.beyin servis) bırakır;
servis kapalıyken yazmalar kuyrukta bekler. Kurulum, kullanıcı düzeyinde (yönetici gerekmez)
"eren-kit-beyin-servis" adlı bir Görev Zamanlayıcı görevi kaydeder: her oturum açılışında
pythonw ile sessizce başlar, kurulumdan hemen sonra da başlatılır. Tekrar kurulumda görev
güncellenip yeniden başlatılır; "-Uninstall -Components beyin" görevi durdurup kaldırır;
-NoService bu adımı atlar.
'@
    Write-Host $text
}

if ($Help) {
    Show-Usage
    exit 0
}

try { [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false) } catch { $null = $_ }

# ---------------------------------------------------------------- argümanlar

$selected = @()
foreach ($c in $Components) {
    foreach ($part in ("$c" -split ',')) {
        $k = $part.Trim().ToLowerInvariant()
        if (-not $k) { continue }
        if ($AllComponents -notcontains $k) {
            Write-Host ("Bilinmeyen bileşen: '{0}'. Geçerli olanlar: {1}" -f $k, ($AllComponents -join ', ')) -ForegroundColor Red
            Write-Host 'Yardım için: .\install.ps1 -Help'
            exit 2
        }
        if ($selected -notcontains $k) { $selected += $k }
    }
}
if ($selected.Count -eq 0) {
    Write-Host 'Hiç bileşen seçilmedi. Yardım için: .\install.ps1 -Help' -ForegroundColor Red
    exit 2
}
$selected = @($AllComponents | Where-Object { $selected -contains $_ })   # kurulum sırası sabit

if ($PSBoundParameters.ContainsKey('AssistantName')) {
    $AssistantName = "$AssistantName".Trim()
    if (-not $AssistantName) {
        Write-Host '-AssistantName boş olamaz.' -ForegroundColor Red
        exit 2
    }
}
if (-not $ClaudeHome) {
    Write-Host '-ClaudeHome boş olamaz.' -ForegroundColor Red
    exit 2
}
$ClaudeHome = [IO.Path]::GetFullPath($ClaudeHome)
if ($KeepExisting -and $ReplaceExisting) {
    Write-Host '-KeepExisting ile -ReplaceExisting birlikte verilemez.' -ForegroundColor Red
    exit 2
}
if ($Json -and -not $Doctor) {
    Write-Host '-Json yalnız -Doctor ile kullanılır.' -ForegroundColor Red
    exit 2
}

# ---------------------------------------------------------------- hazırlık

$RepoRoot = $PSScriptRoot
Import-Module (Join-Path $RepoRoot 'scripts\installer\ErenKit.Installer.psm1') -Force -DisableNameChecking

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
Set-InstallerOption -DryRun ([bool]$DryRun) -BackupDir (Join-Path $ClaudeHome ('backups\eren-kit\' + $stamp))

$P = @{
    Bellek         = Join-Path $RepoRoot 'packages\bellek'
    ComputerUse    = Join-Path $RepoRoot 'packages\computer-use-windows'
    Orkestra       = Join-Path $RepoRoot 'packages\opus-orkestra'
    Phone          = Join-Path $RepoRoot 'apps\phone'
    SettingsHelper = Join-Path $RepoRoot 'scripts\installer\settings_hooks.py'
}
$P.BellekPy = Join-Path $P.Bellek '.venv\Scripts\python.exe'
$P.CuwExe = Join-Path $P.ComputerUse '.venv\Scripts\computer-use-windows.exe'
# Beyin MCP komutu (bkz. 'MCP' adımı: -I neden zorunlu). Testler bu satırı okur.
$P.BeyinMcp = [string[]]@($P.BellekPy, '-I', '-m', 'bellek.beyin', 'mcp')
$P.DevirHook = Join-Path $P.Bellek 'src\bellek\devir\hook.py'
$P.DevirSkill = Join-Path $P.Bellek 'skills\devir'
$P.KapiHook = Join-Path $P.Bellek 'src\bellek\kapi\hook.py'
$P.OrkHook = Join-Path $P.Orkestra 'hooks\opus-orkestra-sessionstart.py'
$P.OrkSkill = Join-Path $P.Orkestra 'skill'
$P.Doctor = Join-Path $RepoRoot 'scripts\installer\doktor.py'

# ---------------------------------------------------------------- kurulum doktoru

# Doktor (salt okunur) için Python ve argümanlar; Python ya da betik yoksa $null.
function Get-DoctorCommand {
    param([switch]$AsJson)
    if (-not (Test-Path -LiteralPath $P.Doctor)) { return $null }
    $py = Find-Python ([version]'3.11')
    if (-not $py) { return $null }
    # -B: doktor depoda __pycache__ bırakmasın (salt okunur sözü).
    $a = @($py.Args) + @('-I', '-B', $P.Doctor, '--claude-home', $ClaudeHome)
    if ($AsJson) { $a += '--json' }
    return [pscustomobject]@{ Exe = $py.Exe; Args = [string[]]$a }
}

function Format-DoctorCommand {
    param($Cmd)
    return ((@($Cmd.Exe) + $Cmd.Args) | ForEach-Object { if ("$_" -match '\s') { '"' + $_ + '"' } else { "$_" } }) -join ' '
}

if ($Doctor) {
    if (-not (Test-Path -LiteralPath $P.Doctor)) {
        Write-Host ('Kurulum doktoru bulunamadı: {0}' -f $P.Doctor) -ForegroundColor Red
        exit 2
    }
    $dc = Get-DoctorCommand -AsJson:$Json
    if (-not $dc) {
        Write-Host (Get-PythonInstallHint ([version]'3.11')) -ForegroundColor Red
        exit 2
    }
    if ($DryRun) {
        Write-Host ('DryRun: kurulum doktoru çalıştırılmadı. Çalıştırılacak komut: {0}' -f (Format-DoctorCommand $dc)) -ForegroundColor Magenta
        exit 0
    }
    $ErrorActionPreference = 'Continue'
    & $dc.Exe @($dc.Args)
    $code = $LASTEXITCODE
    if ($null -eq $code) { $code = 2 }
    exit $code
}

$mode = 'Kurulum'
if ($Uninstall) { $mode = 'Kaldırma' }
if ($DryRun) { $mode += ' (DryRun: hiçbir şey değiştirilmeyecek)' }

Write-Host ''
Write-Host 'eren-kit' -ForegroundColor Cyan -NoNewline
Write-Host (' - {0}' -f $mode)
Write-StepLine info ('Repo:        {0}' -f $RepoRoot)
$homeSource = ''
if (-not $PSBoundParameters.ContainsKey('ClaudeHome') -and $env:CLAUDE_CONFIG_DIR) { $homeSource = '  (CLAUDE_CONFIG_DIR)' }
Write-StepLine info ('Claude Home: {0}{1}' -f $ClaudeHome, $homeSource)
if ($PSBoundParameters.ContainsKey('ClaudeHome') -and $env:CLAUDE_CONFIG_DIR -and
    ([IO.Path]::GetFullPath($env:CLAUDE_CONFIG_DIR).TrimEnd('\') -ne $ClaudeHome.TrimEnd('\'))) {
    Write-StepLine warn ('CLAUDE_CONFIG_DIR = {0}; Claude Code ayarları oradan yükler, -ClaudeHome ile verilen klasörü değil.' -f $env:CLAUDE_CONFIG_DIR)
}
Write-StepLine info ('Bileşenler:  {0}' -f ($selected -join ', '))

# ---------------------------------------------------------------- önkoşullar

Write-Title 'Önkoşullar'
$needPython = @($selected | Where-Object { $_ -ne 'phone' }).Count -gt 0
$pythonBest = Find-Python ([version]'3.11')
if ($needPython) {
    if ($pythonBest) {
        Write-StepLine ok ('Python {0} ({1})' -f $pythonBest.Version, $pythonBest.Display)
    } else {
        $found = @(Get-PythonCandidate)
        if ($found.Count -gt 0) {
            Write-StepLine fail ('Python çok eski: {0}' -f (($found | ForEach-Object { '{0} ({1})' -f $_.Version, $_.Display }) -join ', '))
        } else {
            Write-StepLine fail 'Python bulunamadı (py ya da python).'
        }
        Write-StepLine info (Get-PythonInstallHint ([version]'3.11'))
    }
}

$claudeExe = Find-Application 'claude'
Set-McpContext -ClaudeExe $claudeExe -HelperPath (Join-Path $RepoRoot 'scripts\installer\mcp_config.py')
$needMcp = (@($selected | Where-Object { $_ -eq 'beyin' -or $_ -eq 'computer-use' }).Count -gt 0) -and -not $SkipMcp
if ($SkipMcp) {
    Write-StepLine skip 'claude CLI denetlenmedi (-SkipMcp)'
} elseif ($claudeExe) {
    Write-StepLine ok ('claude CLI ({0})' -f $claudeExe)
} elseif ($needMcp) {
    Write-StepLine warn 'claude CLI bulunamadı: MCP kayıt adımları atlanacak.'
    Write-StepLine info "Kur: irm https://claude.ai/install.ps1 | iex   (ayrıntı: https://docs.claude.com/en/docs/claude-code/setup)"
}

$nodeOk = $false
$npmExe = $null
if ($selected -contains 'phone' -and -not $Uninstall) {
    $nodeExe = Find-Application 'node'
    $npmExe = Find-Application 'npm'
    $nodeVer = $null
    if ($nodeExe) {
        $r = Invoke-Native $nodeExe @('--version')
        $m = [regex]::Match(($r.Output -join ' '), 'v(\d+)\.(\d+)\.(\d+)')
        if ($m.Success) { $nodeVer = [version]('{0}.{1}.{2}' -f $m.Groups[1].Value, $m.Groups[2].Value, $m.Groups[3].Value) }
    }
    if ($nodeVer -and $nodeVer.Major -ge 24 -and $npmExe) {
        $nodeOk = $true
        Write-StepLine ok ('Node {0}, npm ({1})' -f $nodeVer, $npmExe)
    } else {
        if (-not $nodeVer) { Write-StepLine fail 'Node bulunamadı.' }
        elseif ($nodeVer.Major -lt 24) { Write-StepLine fail ('Node {0} çok eski, 24+ gerekli.' -f $nodeVer) }
        else { Write-StepLine fail 'npm bulunamadı.' }
        Write-StepLine info 'Kur: winget install OpenJS.NodeJS.LTS  (ya da https://nodejs.org ; Node 24+), sonra yeni bir terminal aç.'
    }
}

# Hook'lar PATH'teki "python" komutuyla çalışır.
# Devir hook'u tomllib kullanır: en az 3.11 gerekir (py launcher'ın sürümü yetmez).
function Test-HookPython {
    $min = [version]'3.11'
    $exe = Find-Application 'python'
    if ($exe) {
        $r = Invoke-Native $exe @('-c', "import sys; print('.'.join(map(str, sys.version_info[:3])))")
        $m = [regex]::Match(($r.Output -join ' '), '(\d+)\.(\d+)\.(\d+)')
        if ($r.ExitCode -eq 0 -and $m.Success) {
            $v = [version]$m.Value
            if ($v -ge $min) {
                return New-StepResult ok ('hook''lar için "python" PATH''te: {0} ({1})' -f $v, $exe)
            }
            return New-StepResult warn ('hook''lar PATH''teki "python" ile çalışır ama o Python {0} ({1}); en az {2} gerekli, yoksa hook''lar doğru çalışmaz (devir notları yanlış yere düşer). Python 3.12 kur (winget install Python.Python.3.12) ve PATH''te eski Python''dan önce gelmesini sağla; sonra yeni terminalde "python --version" ile doğrula.' -f $v, $exe, $min)
        }
    }
    return New-StepResult warn 'hook''lar "python" komutunu çağırır ama PATH''te çalışan bir python yok; Python kurulumunda "Add python.exe to PATH" seçeneğini aç.'
}

function Get-McpSkipReason {
    if ($SkipMcp) { return 'skip' }
    if (-not $claudeExe) { return 'nocli' }
    return $null
}

function Invoke-McpRegister {
    param([string]$Name, [string[]]$ServerCommand)
    $why = Get-McpSkipReason
    $manual = 'claude mcp add {0} -s user -- {1}' -f $Name, (($ServerCommand | ForEach-Object {
                if ($_ -match '\s|\\') { '"' + $_ + '"' } else { $_ } }) -join ' ')
    if ($why -eq 'skip') { return New-StepResult skip 'MCP kaydı atlandı (-SkipMcp)' }
    if ($why -eq 'nocli') { return New-StepResult warn ('claude CLI yok, MCP kaydı atlandı. Sonra elle: {0}' -f $manual) }
    return Register-McpServer -Name $Name -ServerCommand $ServerCommand -RepoRoot $RepoRoot
}

function Invoke-McpUnregister {
    param([string]$Name)
    $why = Get-McpSkipReason
    if ($why -eq 'skip') { return New-StepResult skip 'MCP kaldırma atlandı (-SkipMcp)' }
    if ($why -eq 'nocli') { return New-StepResult warn ('claude CLI yok; MCP kaydı kaldırılamadı. Sonra elle: claude mcp remove {0} -s user' -f $Name) }
    return Unregister-McpServer -Name $Name -RepoRoot $RepoRoot
}

function Invoke-Venv {
    param([string]$Dir, [string]$Label)
    if ($SkipRepoSetup) { return New-StepResult skip ('venv/pip atlandı (-SkipRepoSetup): {0}' -f $Label) }
    return Install-PackageVenv -PackageDir $Dir -Label $Label
}

function Test-SourceFile {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { throw ('repoda beklenen dosya yok: {0}' -f $Path) }
}

function Invoke-Hooks {
    param([string]$Key, [string]$Script)
    # Kaldırma repo dosyasına ihtiyaç duymaz (kayıtlar yol kalıbından tanınır).
    if (-not $Uninstall) { Test-SourceFile $Script }
    return Invoke-SettingsHook -Component $Key -RepoRoot $RepoRoot -ClaudeHome $ClaudeHome -HelperPath $P.SettingsHelper -Uninstall:$Uninstall -KeepExisting:$KeepExisting
}

# Beyin arka plan servisi: kullanıcı düzeyinde, oturum açılışında başlayan zamanlanmış görev.
$ServiceTaskName = 'eren-kit-beyin-servis'
$script:ServiceNote = $null
function Invoke-BeyinService {
    if ($NoService) { return New-StepResult skip 'servis görevi atlandı (-NoService)' }
    if ($SkipRepoSetup) { return New-StepResult skip 'servis görevi atlandı (-SkipRepoSetup)' }
    if ($Uninstall) {
        $r = Uninstall-ServiceTask -Name $ServiceTaskName
        if ($r.Status -eq 'ok') {
            $script:ServiceNote = ('Beyin servisi: "{0}" görevi durduruldu ve kaldırıldı.' -f $ServiceTaskName)
        }
        return $r
    }
    $r = Install-ServiceTask -Name $ServiceTaskName -PythonW (Join-Path $P.Bellek '.venv\Scripts\pythonw.exe') `
        -Arguments '-I -m bellek.beyin servis' -WorkingDirectory $P.Bellek `
        -Description 'eren-kit: beyin yerel servisi (beyin MCP yazmalarını işler). Kaldırmak: install.ps1 -Uninstall -Components beyin' `
        -ConflictPattern 'bellek\.beyin\s+servis'
    if ($r.Status -eq 'ok' -or $r.Status -eq 'warn') {
        $script:ServiceNote = ('Beyin servisi: "{0}" görevi her oturum açılışında başlar ve şimdi başlatıldı. Kaldırmak: .\install.ps1 -Uninstall -Components beyin' -f $ServiceTaskName)
    } elseif ($r.Status -eq 'dry') {
        $script:ServiceNote = ('Beyin servisi: "{0}" görevi kaydedilecek (her oturum açılışında başlar). Atlamak için -NoService.' -f $ServiceTaskName)
    }
    return $r
}

# Telefon servisinin zamanlanmış görevi kurulumda install.ps1 ile değil elle (apps\phone\kurulum\kur.ts)
# kaydedilir; kaldırmada telefonun kendi silme yolu (gorev-kaydet.ts --sil) kullanılır.
function Invoke-PhoneTaskRemoval {
    $name = "$env:EREN_KIT_PHONE_TASK_NAME".Trim()
    if (-not $name) { $name = 'eren-kit-telefon' }
    $tsFile = Join-Path $P.Phone 'kurulum\gorev-kaydet.ts'
    $manualNode = ('cd apps\phone; node --disable-warning=ExperimentalWarning kurulum/gorev-kaydet.ts --sil')
    $manual = ('{0}   (ya da: schtasks /delete /tn "{1}" /f)' -f $manualNode, $name)
    if ($NoService) { return New-StepResult skip ('telefon görevi silinmedi (-NoService). Elle: {0}' -f $manual) }
    if ($SkipRepoSetup) { return New-StepResult skip 'telefon görevi atlandı (-SkipRepoSetup)' }
    $schtasks = Find-Application 'schtasks'
    if (-not $schtasks) { return New-StepResult warn ('schtasks bulunamadı; telefon görevi denetlenemedi. Elle: {0}' -f $manual) }
    $q = Invoke-Native $schtasks @('/query', '/tn', $name)
    if ($q.ExitCode -ne 0) { return New-StepResult skip ('telefon görevi kayıtlı değil: {0} (node_modules silinmez)' -f $name) }
    if ($DryRun) {
        return New-StepResult dry ('telefon görevi "{0}" silinir (gorev-kaydet.ts --sil; node_modules silinmez)' -f $name)
    }
    $nodeExe = Find-Application 'node'
    if (-not $nodeExe -or -not (Test-Path -LiteralPath $tsFile)) {
        return New-StepResult warn ('telefon görevi "{0}" kayıtlı ama Node ya da gorev-kaydet.ts yok; silinmedi. Elle: {1}' -f $name, $manual)
    }
    Push-Location -LiteralPath $P.Phone
    try { $r = Invoke-Native $nodeExe @('--disable-warning=ExperimentalWarning', 'kurulum/gorev-kaydet.ts', '--sil') } finally { Pop-Location }
    if ($r.ExitCode -ne 0) {
        throw ("telefon görevi silinemedi (çıkış {0}):{1}{2}{1}      Elle: {3}" -f $r.ExitCode, [Environment]::NewLine, (Format-OutputTail $r.Output), $manual)
    }
    $script:PhoneNote = 'Telefon: zamanlanmış görev silindi; o an çalışan servis oturum kapanana dek sürebilir (durdurmak için kur.ts kurulumunun "eren dur" komutu). Veri ve node_modules silinmedi.'
    return New-StepResult ok ('telefon görevi silindi: {0} (node_modules silinmez)' -f $name)
}
$script:PhoneNote = $null

# ---------------------------------------------------------------- adım tanımları

$S = @{}
if (-not $Uninstall) {
    $S['beyin'] = @(
        @{ Name = 'venv'; Run = { Invoke-Venv $P.Bellek 'packages\bellek' } },
        @{ Name = 'bellek.toml'; Run = {
                $cfg = Join-Path $P.Bellek 'bellek.toml'
                $ex = Join-Path $P.Bellek 'bellek.example.toml'
                if (Test-Path -LiteralPath $cfg) { return New-StepResult ok 'bellek.toml var, korunuyor' }
                Test-SourceFile $ex
                if ($SkipRepoSetup) { return New-StepResult skip 'bellek.toml kopyalama atlandı (-SkipRepoSetup)' }
                if ($DryRun) { return New-StepResult dry 'bellek.example.toml -> bellek.toml kopyalanır' }
                Copy-Item -LiteralPath $ex -Destination $cfg
                New-StepResult ok ('bellek.toml oluşturuldu: {0} (vault yolunu kendine göre düzenle)' -f $cfg)
            }
        },
        @{ Name = 'doğrulama'; Run = {
                if ($DryRun -or $SkipRepoSetup) { return New-StepResult skip 'import denetimi atlandı' }
                $r = Invoke-Native $P.BellekPy @('-c', 'import bellek.beyin')
                if ($r.ExitCode -ne 0) { throw ("bellek.beyin içe aktarılamadı:{0}{1}" -f [Environment]::NewLine, (Format-OutputTail $r.Output)) }
                New-StepResult ok 'bellek.beyin içe aktarılıyor'
            }
        },
        @{ Name = 'servis'; Run = { Invoke-BeyinService } },
        # -I zorunlu: MCP sunucusu Claude Code'un açıldığı (güvenilmeyebilecek) klasörde başlar; -I'siz
        # "-m" o klasörü sys.path'in başına koyar ve oradaki bir "bellek" paketi bizimkinin yerine
        # çalışır. -I ayrıca PYTHONPATH gibi ortam değişkenlerini yok sayar. Eski (-I'siz) kayıt
        # yeniden kurulumda bu komutla değiştirilir; doktor onu "güvensiz" diye işaretler.
        @{ Name = 'MCP'; Run = { Invoke-McpRegister 'beyin' $P.BeyinMcp } }
    )
    $S['devir'] = @(
        @{ Name = 'venv'; Run = { Invoke-Venv $P.Bellek 'packages\bellek' } },
        @{ Name = 'python'; Run = { Test-HookPython } },
        @{ Name = 'hook'; Run = { Invoke-Hooks 'devir' $P.DevirHook } },
        @{ Name = 'skill'; Run = { Install-Skill -Component 'devir' -Name 'devir' -SourceDir $P.DevirSkill -ClaudeHome $ClaudeHome } }
    )
    $S['kapi'] = @(
        @{ Name = 'python'; Run = { Test-HookPython } },
        @{ Name = 'hook'; Run = { Invoke-Hooks 'kapi' $P.KapiHook } }
    )
    $S['orkestra'] = @(
        @{ Name = 'python'; Run = { Test-HookPython } },
        @{ Name = 'skill'; Run = { Install-Skill -Component 'orkestra' -Name 'opus-orkestra' -SourceDir $P.OrkSkill -ClaudeHome $ClaudeHome -Files @('SKILL.md') } },
        @{ Name = 'hook'; Run = { Invoke-Hooks 'orkestra' $P.OrkHook } }
    )
    $S['computer-use'] = @(
        @{ Name = 'venv'; Run = { Invoke-Venv $P.ComputerUse 'packages\computer-use-windows' } },
        @{ Name = 'MCP'; Run = { Invoke-McpRegister 'computer-use-windows' @($P.CuwExe) } }
    )
    $S['phone'] = @(
        @{ Name = 'Node'; Run = {
                if (-not $nodeOk) { throw 'Node 24+ ve npm gerekli (yukarıdaki önkoşullara bak)' }
                New-StepResult ok 'Node 24+ hazır'
            }
        },
        @{ Name = 'npm ci'; Run = {
                Test-SourceFile (Join-Path $P.Phone 'package.json')
                Test-SourceFile (Join-Path $P.Phone 'package-lock.json')
                if ($SkipRepoSetup) { return New-StepResult skip 'npm ci atlandı (-SkipRepoSetup)' }
                if ($DryRun) { return New-StepResult dry 'apps\phone içinde npm ci çalıştırılır' }
                Write-StepLine info 'npm ci (apps\phone) çalışıyor...'
                Push-Location -LiteralPath $P.Phone
                try { $r = Invoke-Native $npmExe @('ci', '--no-audit', '--no-fund') } finally { Pop-Location }
                if ($r.ExitCode -ne 0) { throw ("npm ci başarısız (çıkış {0}):{1}{2}" -f $r.ExitCode, [Environment]::NewLine, (Format-OutputTail $r.Output)) }
                New-StepResult ok 'bağımlılıklar kuruldu (apps\phone)'
            }
        },
        @{ Name = 'npm ci (app)'; Run = {
                $appDir = Join-Path $P.Phone 'app'
                Test-SourceFile (Join-Path $appDir 'package.json')
                Test-SourceFile (Join-Path $appDir 'package-lock.json')
                if ($SkipRepoSetup) { return New-StepResult skip 'npm ci (app) atlandı (-SkipRepoSetup)' }
                if ($DryRun) { return New-StepResult dry 'apps\phone\app içinde (kendi package-lock.json''ıyla) npm ci çalıştırılır' }
                Write-StepLine info 'npm ci (apps\phone\app) çalışıyor...'
                Push-Location -LiteralPath $appDir
                try { $r = Invoke-Native $npmExe @('ci', '--no-audit', '--no-fund') } finally { Pop-Location }
                if ($r.ExitCode -ne 0) { throw ("npm ci (app) başarısız (çıkış {0}):{1}{2}" -f $r.ExitCode, [Environment]::NewLine, (Format-OutputTail $r.Output)) }
                New-StepResult ok 'bağımlılıklar kuruldu (apps\phone\app)'
            }
        },
        @{ Name = 'servis'; Run = { New-StepResult skip 'servis kaydı yapılmaz (bilinçli); elle kurulum yönlendirmesi kurulum sonunda verilir' } }
    )
} else {
    $S['beyin'] = @(
        @{ Name = 'MCP'; Run = { Invoke-McpUnregister 'beyin' } },
        @{ Name = 'servis'; Run = { Invoke-BeyinService } }
    )
    $S['devir'] = @(
        @{ Name = 'hook'; Run = { Invoke-Hooks 'devir' $P.DevirHook } },
        @{ Name = 'skill'; Run = { Uninstall-Skill -Name 'devir' -SourceDir $P.DevirSkill -ClaudeHome $ClaudeHome } }
    )
    $S['kapi'] = @(@{ Name = 'hook'; Run = { Invoke-Hooks 'kapi' $P.KapiHook } })
    $S['orkestra'] = @(
        @{ Name = 'hook'; Run = { Invoke-Hooks 'orkestra' $P.OrkHook } },
        @{ Name = 'skill'; Run = { Uninstall-Skill -Name 'opus-orkestra' -SourceDir $P.OrkSkill -ClaudeHome $ClaudeHome -Files @('SKILL.md') } }
    )
    $S['computer-use'] = @(@{ Name = 'MCP'; Run = { Invoke-McpUnregister 'computer-use-windows' } })
    $S['phone'] = @(@{ Name = 'görev'; Run = { Invoke-PhoneTaskRemoval } })
}

$Titles = @{
    'beyin'        = 'Beyin (bellek + MCP)'
    'devir'        = 'Devir (hook + skill)'
    'kapi'         = 'Belge kapısı (hook)'
    'orkestra'     = 'Opus Orkestra (skill + hook)'
    'computer-use' = 'Computer use (MCP)'
    'phone'        = 'Phone (telefon uygulaması)'
}

# ---------------------------------------------------------------- çalıştırıcı

$rank = @{ skip = 0; ok = 1; dry = 2; warn = 3; fail = 4 }
$results = New-Object System.Collections.Generic.List[object]

function Invoke-Component {
    param([string]$Key, [string]$Title, [object[]]$Steps)
    Write-Title ('[{0}] {1}' -f $Key, $Title)
    $status = 'skip'
    $note = ''
    foreach ($s in $Steps) {
        try {
            $out = @(& $s.Run)
            $r = @($out | Where-Object { $_ -is [psobject] -and $_.PSObject.Properties['IsStepResult'] }) | Select-Object -Last 1
            if (-not $r) { $r = New-StepResult ok $s.Name }
            Write-StepLine $r.Status $r.Message
            if ($rank[$r.Status] -gt $rank[$status]) {
                $status = $r.Status
                if ($r.Status -eq 'warn') { $note = $r.Message }
            }
        } catch {
            $msg = $_.Exception.Message
            Write-StepLine fail ('"{0}" adımında hata: {1}' -f $s.Name, $msg)
            $status = 'fail'
            $note = ('"{0}" adımı başarısız' -f $s.Name)
            break
        }
    }
    $results.Add([pscustomobject]@{ Component = $Key; Status = $status; Note = $note })
}

# ---------------------------------------------------------------- asistan adı

if (-not $Uninstall) {
    Write-Title 'Asistan adı'
    $envName = 'EREN_KIT_ASSISTANT_NAME'
    try {
        if ($SkipEnv) {
            Write-StepLine skip ('{0} yazımı atlandı (-SkipEnv)' -f $envName)
        } else {
            $current = [Environment]::GetEnvironmentVariable($envName, 'User')
            $target = $AssistantName
            if (-not $target) { $target = $current }
            if (-not $target) { $target = 'Claude' }
            if ($current -ceq $target) {
                Write-StepLine ok ('{0} = "{1}" (zaten ayarlı)' -f $envName, $target)
            } elseif ($DryRun) {
                Write-StepLine dry ('{0} = "{1}" kullanıcı ortam değişkenine yazılır' -f $envName, $target)
            } else {
                [Environment]::SetEnvironmentVariable($envName, $target, 'User')
                Set-Item -Path ('Env:' + $envName) -Value $target
                Write-StepLine ok ('{0} = "{1}" yazıldı' -f $envName, $target)
            }
        }
    } catch {
        Write-StepLine fail ('ortam değişkeni yazılamadı: {0}' -f $_.Exception.Message)
        $results.Add([pscustomobject]@{ Component = 'asistan-adı'; Status = 'fail'; Note = 'ortam değişkeni yazılamadı' })
    }
}

foreach ($k in $selected) {
    Invoke-Component -Key $k -Title $Titles[$k] -Steps $S[$k]
}

# ---------------------------------------------------------------- özet

Write-Title 'Özet'
foreach ($r in $results) {
    $sym = Get-StatusSymbol $r.Status
    Write-Host ('  {0} ' -f $sym[0]) -ForegroundColor $sym[1] -NoNewline
    $label = $r.Component.PadRight(13)
    switch ($r.Status) {
        'ok'   { $txt = 'tamam' }
        'dry'  { $txt = 'yapılacaklar listelendi' }
        'warn' { $txt = 'uyarıyla tamamlandı: ' + $r.Note }
        'fail' { $txt = 'HATA: ' + $r.Note }
        default { $txt = 'yapılacak bir şey yok' }
    }
    Write-Host ('{0} {1}' -f $label, $txt)
}

if ($script:ServiceNote) { Write-StepLine info $script:ServiceNote }
if ($script:PhoneNote) { Write-StepLine info $script:PhoneNote }
$bk = Get-InstallerBackupDir
if ($bk) {
    Write-StepLine info ('Yedekler: {0} (eski settings.json ve MCP kayıtları, env değerleri dahil düz metin; sır içerebilir, kaldırma silmez; gerekmiyorsa sil)' -f $bk)
}

# Gerçek kurulumun sonunda doktor bir kez çalışır. Sonucu yalnız bilgi içindir: kurulumun çıkış
# kodunu değiştirmez; doktor yoksa ya da çökerse kurulum yine de olduğu gibi biter.
if (-not $Uninstall) {
    Write-Title 'Kurulum doktoru'
    try {
        $dc = $null
        if ($DryRun) {
            $dc = Get-DoctorCommand
            if ($dc) { Write-StepLine dry ('kurulumdan sonra doktor çalıştırılır: {0}' -f (Format-DoctorCommand $dc)) }
            else { Write-StepLine skip 'doktor çalıştırılamaz (doktor.py ya da Python 3.11+ yok)' }
        } else {
            $dc = Get-DoctorCommand
            if (-not $dc) {
                Write-StepLine skip ('doktor çalıştırılamadı (doktor.py ya da Python 3.11+ yok): {0}' -f $P.Doctor)
            } else {
                $dr = Invoke-Native $dc.Exe $dc.Args
                foreach ($l in @($dr.Output)) { if ("$l".Trim()) { Write-Host ('    ' + $l) } }
                switch ($dr.ExitCode) {
                    0 { Write-StepLine ok 'doktor: her şey yolunda' }
                    1 { Write-StepLine warn 'doktor uyarı buldu (yukarıda); kurulum yine de tamamlandı. Yeniden denetim: .\install.ps1 -Doctor' }
                    2 { Write-StepLine warn 'doktor hata buldu (yukarıda); kurulum adımları yine de bitti. Yeniden denetim: .\install.ps1 -Doctor' }
                    default { Write-StepLine warn ('doktor beklenmedik biçimde bitti (çıkış {0}); kurulumu etkilemez. Elle: .\install.ps1 -Doctor' -f $dr.ExitCode) }
                }
            }
        }
    } catch {
        Write-StepLine warn ('doktor çalıştırılamadı: {0} (kurulumu etkilemez)' -f $_.Exception.Message)
    }
}

$failed = @($results | Where-Object { $_.Status -eq 'fail' }).Count
Write-Host ''
if ($DryRun) {
    Write-Host 'DryRun: hiçbir şey değiştirilmedi.' -ForegroundColor Magenta
} elseif ($failed -gt 0) {
    Write-Host ('{0} bileşende hata var; ayrıntı yukarıda. Düzeltip betiği yeniden çalıştırabilirsin (tekrar çalıştırmak güvenli).' -f $failed) -ForegroundColor Red
}
if (-not $DryRun) {
    Write-Host "Değişikliklerin etkili olması için Claude Code'u yeniden başlat." -ForegroundColor Cyan
}
if ($selected -contains 'phone' -and -not $Uninstall) {
    Write-Host ''
    Write-Host 'Telefon servisi (phone): install.ps1 servisi KAYDETMEZ; elle kur:' -ForegroundColor Yellow
    Write-Host '  cd apps\phone'
    Write-Host '  node --disable-warning=ExperimentalWarning kurulum/kur.ts'
    Write-Host '  Ayrıntı ve işletim: apps/phone/docs/SERVIS.md'
    Write-Host '  Kurulum şu ortam değişkenlerini okur (kalıcı kullanıcı ortamında olmalı):'
    Write-Host '    EREN_KIT_ASSISTANT_NAME     asistan adı (varsayılan "Claude"; bu betik -AssistantName ile yazar)'
    Write-Host '    EREN_KIT_DATA_DIR           veri kökü, mutlak yol (varsayılan %LOCALAPPDATA%\eren-kit)'
    Write-Host '    EREN_KIT_PHONE_TASK_NAME    zamanlanmış görev adı (varsayılan "eren-kit-telefon")'
    Write-Host '  Mevcut bir kurulumu aynen sürdürmek için bu üçünü eski değerlerine ayarla (ayrıntı: SERVIS.md).'
}

if ($failed -gt 0) { exit 1 }
exit 0
