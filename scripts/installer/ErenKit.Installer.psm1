# eren-kit kurulum yardımcıları. install.ps1 tarafından yüklenir.
# Windows PowerShell 5.1 ve PowerShell 7+ ile uyumlu tutulur (??, ?:, && yok).

Set-StrictMode -Version 2.0
# Çağıranın $ErrorActionPreference'ı modül fonksiyonlarına geçmez; burada ayrıca ayarlanır.
# Böylece her cmdlet hatası (ör. yedek alınamaması) fırlatılır ve adım ✖ olur.
$ErrorActionPreference = 'Stop'

$script:DryRun = $false
$script:BackupDir = $null
$script:BackupUsed = $false
$script:PythonCache = $null

function Set-InstallerOption {
    param([bool]$DryRun, [string]$BackupDir)
    $script:DryRun = $DryRun
    $script:BackupDir = $BackupDir
}

function Get-InstallerBackupDir {
    if ($script:BackupUsed) { return $script:BackupDir }
    return $null
}

# ---------------------------------------------------------------- çıktı

$script:Sym = @{
    Ok   = [string][char]0x2714   # ✔
    Fail = [string][char]0x2716   # ✖
    Warn = '!'
    Dry  = [string][char]0x2192   # →
    Skip = '-'
}

function Write-Title {
    param([string]$Text)
    Write-Host ''
    Write-Host $Text -ForegroundColor Cyan
}

function Write-StepLine {
    param(
        [ValidateSet('ok', 'fail', 'warn', 'dry', 'skip', 'info')][string]$Status,
        [string]$Text
    )
    switch ($Status) {
        'ok'   { Write-Host ('  {0} ' -f $script:Sym.Ok) -ForegroundColor Green -NoNewline }
        'fail' { Write-Host ('  {0} ' -f $script:Sym.Fail) -ForegroundColor Red -NoNewline }
        'warn' { Write-Host ('  {0} ' -f $script:Sym.Warn) -ForegroundColor Yellow -NoNewline }
        'dry'  { Write-Host ('  {0} ' -f $script:Sym.Dry) -ForegroundColor Magenta -NoNewline }
        'skip' { Write-Host ('  {0} ' -f $script:Sym.Skip) -ForegroundColor DarkGray -NoNewline }
        default { Write-Host '    ' -NoNewline }
    }
    if ($Status -eq 'info' -or $Status -eq 'skip') {
        Write-Host $Text -ForegroundColor DarkGray
    } else {
        Write-Host $Text
    }
}

function Get-StatusSymbol {
    param([string]$Status)
    switch ($Status) {
        'ok'   { return @($script:Sym.Ok, 'Green') }
        'fail' { return @($script:Sym.Fail, 'Red') }
        'warn' { return @($script:Sym.Warn, 'Yellow') }
        'dry'  { return @($script:Sym.Dry, 'Magenta') }
        default { return @($script:Sym.Skip, 'DarkGray') }
    }
}

# Bir adımın sonucu. Status: ok | warn | skip | dry
function New-StepResult {
    param([string]$Status = 'ok', [string]$Message = '')
    [pscustomobject]@{ IsStepResult = $true; Status = $Status; Message = $Message }
}

# ---------------------------------------------------------------- dış komutlar

# Yerel programı çalıştırır; stderr'i de toplar, hiçbir zaman PowerShell hatası fırlatmaz.
function Invoke-Native {
    param([string]$FilePath, [string[]]$ArgumentList = @())
    $ErrorActionPreference = 'Continue'
    $out = @()
    $code = -1
    try {
        $out = @(& $FilePath @ArgumentList 2>&1 | ForEach-Object { "$_" })
        $code = $LASTEXITCODE
        if ($null -eq $code) { $code = 0 }
    } catch {
        $out = @("$_")
        $code = -1
    }
    [pscustomobject]@{ ExitCode = $code; Output = $out }
}

function Format-OutputTail {
    param([string[]]$Lines, [int]$Count = 15)
    $l = @($Lines | Where-Object { $_ -and $_.Trim() })
    if ($l.Count -gt $Count) { $l = $l[($l.Count - $Count)..($l.Count - 1)] }
    return (($l | ForEach-Object { '      | ' + $_ }) -join [Environment]::NewLine)
}

# .ps1 sarmalayıcısını atlayıp gerçek uygulamayı (.exe/.cmd/.bat) bulur.
# (.ps1 üzerinden çağrıda PowerShell '--' argümanını yutabilir.)
function Find-Application {
    param([string]$Name)
    $order = @{ '.exe' = 0; '.cmd' = 1; '.bat' = 2 }
    $cands = @(Get-Command $Name -CommandType Application -All -ErrorAction SilentlyContinue |
        Where-Object { $order.ContainsKey([IO.Path]::GetExtension($_.Source).ToLowerInvariant()) } |
        Sort-Object { $order[[IO.Path]::GetExtension($_.Source).ToLowerInvariant()] })
    if ($cands.Count -gt 0) { return $cands[0].Source }
    return $null
}

# ---------------------------------------------------------------- Python

function Get-PythonCandidate {
    if ($null -ne $script:PythonCache) { return $script:PythonCache }
    $list = @()
    $probe = "import sys; print('.'.join(map(str, sys.version_info[:3])))"
    foreach ($c in @(@{ N = 'py'; A = @('-3') }, @{ N = 'python'; A = @() }, @{ N = 'python3'; A = @() })) {
        $exe = Find-Application $c.N
        if (-not $exe) { continue }
        $r = Invoke-Native $exe (@($c.A) + @('-c', $probe))
        if ($r.ExitCode -ne 0) { continue }
        $line = @($r.Output | Where-Object { $_ -match '^\d+\.\d+\.\d+$' })
        if ($line.Count -eq 0) { continue }
        $list += [pscustomobject]@{
            Exe     = $exe
            Args    = [string[]]$c.A
            Version = [version]$line[0]
            Display = ((@($c.N) + $c.A) -join ' ')
        }
    }
    $script:PythonCache = $list
    return $list
}

function Find-Python {
    param([version]$MinVersion = [version]'3.11')
    foreach ($p in @(Get-PythonCandidate)) {
        if ($p.Version -ge $MinVersion) { return $p }
    }
    return $null
}

# pyproject.toml'daki requires-python ">=X.Y" değerini okur; en az 3.11 döner.
function Get-RequiredPython {
    param([string]$PyProject)
    $min = [version]'3.11'
    if (Test-Path -LiteralPath $PyProject) {
        $m = Select-String -LiteralPath $PyProject -Pattern 'requires-python\s*=\s*"\s*>=\s*(\d+)\.(\d+)' |
            Select-Object -First 1
        if ($m) {
            $v = [version]('{0}.{1}' -f $m.Matches[0].Groups[1].Value, $m.Matches[0].Groups[2].Value)
            if ($v -gt $min) { $min = $v }
        }
    }
    return $min
}

function Get-PythonInstallHint {
    param([version]$MinVersion)
    return ("Python {0}+ gerekli. Kur: winget install Python.Python.3.12  (ya da https://www.python.org/downloads/ ; " +
        "kurulumda 'Add python.exe to PATH' seçili olsun), sonra yeni bir terminal aç.") -f $MinVersion
}

# Paketin venv'ini hazırlar ve paketi düzenlenebilir kurar. Paylaşılan venv için
# aynı çalıştırmada ikinci kez kurmaz.
$script:VenvDone = @{}
function Install-PackageVenv {
    param([string]$PackageDir, [string]$Label)
    $venv = Join-Path $PackageDir '.venv'
    $venvPy = Join-Path $venv 'Scripts\python.exe'
    $key = $PackageDir.ToLowerInvariant()
    if ($script:VenvDone.ContainsKey($key)) {
        $prev = $script:VenvDone[$key]
        if ($prev -eq 'ok') { return New-StepResult ok ('venv hazır, paket kurulu ({0}; bu çalıştırmada kuruldu)' -f $Label) }
        if ($prev -eq 'dry') { return New-StepResult dry ('venv/pip: yukarıdakiyle aynı ({0})' -f $Label) }
        throw ('bu çalıştırmada aynı venv kurulumu başarısız oldu ({0})' -f $Label)
    }
    $min = Get-RequiredPython (Join-Path $PackageDir 'pyproject.toml')
    $py = Find-Python $min
    $venvExists = Test-Path -LiteralPath $venvPy
    if (-not $venvExists -and -not $py) {
        $script:VenvDone[$key] = 'fail'
        throw (Get-PythonInstallHint $min)
    }
    if ($script:DryRun) {
        $script:VenvDone[$key] = 'dry'
        if ($venvExists) {
            return New-StepResult dry ('var olan venv kullanılır, sonra pip install -e {0}' -f $Label)
        }
        return New-StepResult dry ('venv oluşturulur ({0} -m venv {1}\.venv), sonra pip install -e {1}' -f $py.Display, $Label)
    }
    if (-not $venvExists) {
        Write-StepLine info ('venv oluşturuluyor ({0} {1})...' -f $py.Display, $py.Version)
        $r = Invoke-Native $py.Exe (@($py.Args) + @('-m', 'venv', $venv))
        if ($r.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $venvPy)) {
            $script:VenvDone[$key] = 'fail'
            throw ("venv oluşturulamadı:{0}{1}" -f [Environment]::NewLine, (Format-OutputTail $r.Output))
        }
    } else {
        $r = Invoke-Native $venvPy @('-c', "import sys; print('.'.join(map(str, sys.version_info[:3])))")
        $vl = @($r.Output | Where-Object { $_ -match '^\d+\.\d+\.\d+$' })
        if ($r.ExitCode -ne 0 -or $vl.Count -eq 0) {
            $script:VenvDone[$key] = 'fail'
            throw ('var olan venv bozuk görünüyor: {0} (klasörü silip yeniden çalıştır)' -f $venv)
        }
        if ([version]$vl[0] -lt $min) {
            $script:VenvDone[$key] = 'fail'
            throw ('var olan venv Python {0}, en az {1} gerekli: {2} klasörünü silip yeniden çalıştır' -f $vl[0], $min, $venv)
        }
    }
    Write-StepLine info ('pip install -e {0} (birkaç dakika sürebilir)...' -f $Label)
    $r = Invoke-Native $venvPy @('-m', 'pip', 'install', '--disable-pip-version-check', '--quiet', '-e', $PackageDir)
    if ($r.ExitCode -ne 0) {
        $script:VenvDone[$key] = 'fail'
        throw ("pip install başarısız (çıkış {0}):{1}{2}" -f $r.ExitCode, [Environment]::NewLine, (Format-OutputTail $r.Output))
    }
    $script:VenvDone[$key] = 'ok'
    return New-StepResult ok ('venv hazır, paket kurulu ({0})' -f $Label)
}

# ---------------------------------------------------------------- yedek

function Get-BackupPath {
    param([string]$Relative)
    $script:BackupUsed = $true
    $p = Join-Path $script:BackupDir $Relative
    $parent = Split-Path -Parent $p
    if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    return $p
}

# ---------------------------------------------------------------- skill

$script:MarkerName = '.eren-kit'

function Get-SkillFileList {
    param([string]$SourceDir, [string[]]$Files)
    if ($Files -and $Files.Count -gt 0) { return $Files }
    $root = (Resolve-Path -LiteralPath $SourceDir).Path.TrimEnd('\')
    return @(Get-ChildItem -LiteralPath $SourceDir -Recurse -File | ForEach-Object {
            $_.FullName.Substring($root.Length + 1)
        })
}

# Hedef klasör kaynakla birebir aynı mı (işaret dosyası hariç)?
function Test-SkillIdentical {
    param([string]$SourceDir, [string]$DestDir, [string[]]$Files)
    if (-not (Test-Path -LiteralPath $DestDir)) { return $false }
    $destRoot = (Resolve-Path -LiteralPath $DestDir).Path.TrimEnd('\')
    $destFiles = @(Get-ChildItem -LiteralPath $DestDir -Recurse -File -Force |
        ForEach-Object { $_.FullName.Substring($destRoot.Length + 1) } |
        Where-Object { $_ -ne $script:MarkerName })
    if ($destFiles.Count -ne $Files.Count) { return $false }
    foreach ($f in $Files) {
        $s = Join-Path $SourceDir $f
        $d = Join-Path $DestDir $f
        if (-not (Test-Path -LiteralPath $d)) { return $false }
        if ((Get-FileHash -LiteralPath $s -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $d -Algorithm SHA256).Hash) {
            return $false
        }
    }
    return $true
}

function Write-SkillMarker {
    param([string]$DestDir, [string]$Component, [string]$SourceDir)
    $o = [ordered]@{
        installedBy = 'eren-kit'
        component   = $Component
        source      = $SourceDir
        installedAt = (Get-Date).ToString('s')
    }
    $json = ($o | ConvertTo-Json)
    [IO.File]::WriteAllText((Join-Path $DestDir $script:MarkerName), $json + "`n", (New-Object Text.UTF8Encoding($false)))
}

function Install-Skill {
    param([string]$Component, [string]$Name, [string]$SourceDir, [string]$ClaudeHome, [string[]]$Files = @())
    if (-not (Test-Path -LiteralPath $SourceDir)) { throw ('skill kaynağı bulunamadı: {0}' -f $SourceDir) }
    $list = @(Get-SkillFileList $SourceDir $Files)
    foreach ($f in $list) {
        if (-not (Test-Path -LiteralPath (Join-Path $SourceDir $f))) { throw ('skill dosyası bulunamadı: {0}' -f (Join-Path $SourceDir $f)) }
    }
    $dest = Join-Path (Join-Path $ClaudeHome 'skills') $Name
    $shown = 'skills\{0}' -f $Name
    if (Test-SkillIdentical $SourceDir $dest $list) {
        if (-not $script:DryRun -and -not (Test-Path -LiteralPath (Join-Path $dest $script:MarkerName))) {
            Write-SkillMarker $dest $Component $SourceDir
        }
        return New-StepResult ok ('skill güncel: {0}' -f $shown)
    }
    $exists = Test-Path -LiteralPath $dest
    if ($script:DryRun) {
        if ($exists) { return New-StepResult dry ('skill yedeklenip yenilenir: {0}' -f $shown) }
        return New-StepResult dry ('skill kopyalanır: {0}' -f $shown)
    }
    $note = ''
    if ($exists) {
        Backup-AndRemoveDirectory -Path $dest -BackupRelative (Join-Path 'skills' $Name)
        $note = ' (eskisi yedeklendi)'
    }
    New-Item -ItemType Directory -Path $dest -Force | Out-Null
    foreach ($f in $list) {
        $target = Join-Path $dest $f
        $tparent = Split-Path -Parent $target
        if (-not (Test-Path -LiteralPath $tparent)) { New-Item -ItemType Directory -Path $tparent -Force | Out-Null }
        Copy-Item -LiteralPath (Join-Path $SourceDir $f) -Destination $target -Force
    }
    Write-SkillMarker $dest $Component $SourceDir
    return New-StepResult ok ('skill kopyalandı: {0}{1}' -f $shown, $note)
}

function Uninstall-Skill {
    param([string]$Name, [string]$SourceDir, [string]$ClaudeHome, [string[]]$Files = @())
    $dest = Join-Path (Join-Path $ClaudeHome 'skills') $Name
    $shown = 'skills\{0}' -f $Name
    if (-not (Test-Path -LiteralPath $dest)) { return New-StepResult skip ('skill zaten yok: {0}' -f $shown) }
    $ours = Test-Path -LiteralPath (Join-Path $dest $script:MarkerName)
    if (-not $ours -and (Test-Path -LiteralPath $SourceDir)) {
        $ours = Test-SkillIdentical $SourceDir $dest @(Get-SkillFileList $SourceDir $Files)
    }
    if (-not $ours) {
        return New-StepResult warn ('{0} eren-kit tarafından kurulmamış ya da elle değiştirilmiş; dokunulmadı' -f $shown)
    }
    if ($script:DryRun) { return New-StepResult dry ('skill yedeklenip kaldırılır: {0}' -f $shown) }
    Backup-AndRemoveDirectory -Path $dest -BackupRelative (Join-Path 'skills' $Name)
    return New-StepResult ok ('skill kaldırıldı: {0} (yedeği alındı)' -f $shown)
}

# Klasörü yedekler, yedeğin eksiksiz olduğunu doğrular, ancak ondan sonra siler.
# Yedek skills\ dışına alınır; yoksa Claude Code yedeği de skill olarak yükler.
function Backup-AndRemoveDirectory {
    param([string]$Path, [string]$BackupRelative)
    try {
        $bk = Get-BackupPath $BackupRelative
        Copy-Item -LiteralPath $Path -Destination $bk -Recurse -Force
    } catch {
        throw ('yedek alınamadı, hiçbir şey silinmedi ({0}): {1}' -f $Path, $_.Exception.Message)
    }
    $srcRoot = (Resolve-Path -LiteralPath $Path).Path.TrimEnd('\')
    foreach ($f in @(Get-ChildItem -LiteralPath $Path -Recurse -File -Force)) {
        $copy = Join-Path $bk $f.FullName.Substring($srcRoot.Length + 1)
        if (-not (Test-Path -LiteralPath $copy) -or (Get-Item -LiteralPath $copy -Force).Length -ne $f.Length) {
            throw ('yedek eksik, hiçbir şey silinmedi: {0}' -f $copy)
        }
    }
    Remove-Item -LiteralPath $Path -Recurse -Force
}

# ---------------------------------------------------------------- settings.json

function Invoke-SettingsHook {
    param([string]$Component, [string]$RepoRoot, [string]$ClaudeHome, [switch]$Uninstall, [string]$HelperPath,
        [switch]$ReplaceExisting, [switch]$KeepExisting)
    # Repo dışındaki eski kopyaların kayıtları varsayılanda (yedekli) değiştirilir;
    # -KeepExisting korur. -ReplaceExisting eski uyumluluk içindir (varsayılanla aynı).
    $py = Find-Python ([version]'3.8')
    if (-not $py) { throw (Get-PythonInstallHint ([version]'3.11')) }
    $settings = Join-Path $ClaudeHome 'settings.json'
    $a = @($py.Args) + @('-I', $HelperPath, '--settings', $settings, '--repo', $RepoRoot, '--components', $Component,
        '--backup-dir', $script:BackupDir)
    if ($Uninstall) { $a += '--uninstall' }
    if ($script:DryRun) { $a += '--dry-run' }
    if ($KeepExisting -and -not $Uninstall) { $a += '--keep-legacy' }
    elseif ($ReplaceExisting -and -not $Uninstall) { $a += '--replace-legacy' }
    $r = Invoke-Native $py.Exe $a
    $json = @($r.Output | Where-Object { $_ -match '^\s*\{' } | Select-Object -Last 1)
    if ($json.Count -eq 0) { throw ("settings.json yardımcısı yanıt vermedi:{0}{1}" -f [Environment]::NewLine, (Format-OutputTail $r.Output)) }
    $o = $json[0] | ConvertFrom-Json
    if ($o.PSObject.Properties['error']) { throw ('settings.json işlenemedi ({0}): {1}' -f $settings, $o.error) }
    if ($o.backup) { $script:BackupUsed = $true }
    $c = $o.components.$Component
    $legacy = @($c.legacy)

    if ($Uninstall) {
        if ($c.removed -eq 0) { $res = New-StepResult skip 'settings.json: kaldırılacak hook yok' }
        elseif ($script:DryRun) { $res = New-StepResult dry ('settings.json: {0} hook komutu kaldırılır' -f $c.removed) }
        else { $res = New-StepResult ok ('settings.json: {0} hook komutu kaldırıldı' -f $c.removed) }
    } else {
        if (-not $o.changed) { $res = New-StepResult ok ('settings.json: {0} hook zaten kayıtlı' -f $c.added) }
        else {
            if ($script:DryRun) {
                $msg = 'settings.json: {0} hook komutu eklenir' -f $c.added
                if (-not $o.existed) { $msg += ' (dosya oluşturulur)' }
                if ($c.removed -gt 0) { $msg += ('; eski {0} kayıt bunlarla değiştirilir' -f $c.removed) }
                $res = New-StepResult dry $msg
            } else {
                $msg = 'settings.json: {0} hook komutu eklendi' -f $c.added
                if ($c.removed -gt 0) { $msg += ('; eski {0} kayıt bunlarla değiştirildi' -f $c.removed) }
                $res = New-StepResult ok $msg
            }
        }
    }
    if (-not $Uninstall -and $c.legacy_removed -gt 0) {
        if ($script:DryRun) { $res.Message += ('; repo dışındaki eski kopyanın {0} hook kaydı kaldırılır (yedek alınarak; korumak için -KeepExisting)' -f $c.legacy_removed) }
        else { $res.Message += ('; repo dışındaki eski kopyanın {0} hook kaydı kaldırıldı (yedekli)' -f $c.legacy_removed) }
    }
    if ($legacy.Count -gt 0 -and -not $Uninstall) {
        foreach ($l in $legacy) {
            Write-StepLine warn ('aynı betiğin repo dışındaki eski kopyası da kayıtlı (-KeepExisting: dokunulmadı): {0}' -f $l)
        }
        if ($res.Status -eq 'ok' -or $res.Status -eq 'dry') {
            $res.Status = 'warn'
            $res.Message += ('; eski kopyanın {0} hook kaydı da duruyor: bu hook''lar iki kez çalışacak; kaldırmak için -KeepExisting olmadan yeniden çalıştır' -f $legacy.Count)
        }
    }
    # Bileşenin kendi olayları dışındaki bizim/eski kopya kayıtları: dokunulmaz, yalnız bildirilir.
    # Alan eski settings_hooks.py sürümünde yoktur; o zaman hiçbir şey yazılmaz.
    $other = @()
    if (-not $Uninstall -and $c -and $c.PSObject.Properties['other_events']) {
        $other = @($c.other_events | Where-Object { $null -ne $_ })
    }
    if ($other.Count -gt 0) {
        foreach ($o2 in $other) {
            Write-StepLine warn ('{0} olayında beklenmeyen kayıt: {1}' -f $o2.event, $o2.command)
        }
        if ($res.Status -eq 'ok' -or $res.Status -eq 'dry') { $res.Status = 'warn' }
        $res.Message += ('; {0} kayıt bileşenin olayları dışında duruyor: kurulum bu kayda dokunmadı; gerekmiyorsa settings.json''dan elle kaldırın' -f $other.Count)
    }
    return $res
}

# ---------------------------------------------------------------- MCP

# MCP çağrıları tek yerden geçer; testler Set-McpApi ile sahtesini verir.
#   Get(name)          -> kayıt nesnesi ({type, command, args, env, ...}) ya da $null (salt okunur)
#   Add(name, entry)   -> @{ ExitCode; Output }
#   Remove(name)       -> @{ ExitCode; Output }
$script:McpApi = $null
$script:ClaudeExe = $null
$script:McpHelper = $null

function Set-McpContext {
    param([string]$ClaudeExe, [string]$HelperPath)
    $script:ClaudeExe = $ClaudeExe
    $script:McpHelper = $HelperPath
}

function Set-McpApi {
    param([hashtable]$Api)
    $script:McpApi = $Api
}

function Get-McpApi {
    if (-not $script:McpApi) {
        $script:McpApi = @{
            Get    = { param($Name) Get-McpUserEntry $Name }
            Add    = { param($Name, $Entry) Invoke-McpAddEntry $Name $Entry }
            Remove = { param($Name) Invoke-Native $script:ClaudeExe @('mcp', 'remove', $Name, '-s', 'user') }
        }
    }
    return $script:McpApi
}

function Get-McpUserEntry {
    param([string]$Name)
    $py = Find-Python ([version]'3.8')
    if (-not $py) { throw 'MCP kaydını okumak için Python gerekli' }
    $r = Invoke-Native $py.Exe (@($py.Args) + @('-I', $script:McpHelper, '--name', $Name))
    $json = @($r.Output | Where-Object { $_ -match '^\s*\{' } | Select-Object -Last 1)
    if ($json.Count -eq 0) { throw ("MCP yapılandırması okunamadı:{0}{1}" -f [Environment]::NewLine, (Format-OutputTail $r.Output)) }
    $o = $json[0] | ConvertFrom-Json
    if ($o.PSObject.Properties['error']) { throw ('MCP yapılandırması okunamadı ({0}): {1}' -f $o.path, $o.error) }
    if (-not $o.found) { return $null }
    return $o.entry
}

function Get-EntryValue {
    param($Entry, [string]$Key)
    if ($null -eq $Entry) { return $null }
    if ($Entry -is [hashtable]) { if ($Entry.ContainsKey($Key)) { return $Entry[$Key] } else { return $null } }
    $p = $Entry.PSObject.Properties[$Key]
    if ($p) { return $p.Value }
    return $null
}

function Invoke-McpAddEntry {
    param([string]$Name, $Entry)
    $type = "$(Get-EntryValue $Entry 'type')"
    if ($type -and $type -ne 'stdio') {
        $json = $Entry | ConvertTo-Json -Depth 10 -Compress
        return Invoke-Native $script:ClaudeExe @('mcp', 'add-json', $Name, $json, '-s', 'user')
    }
    $a = @('mcp', 'add', $Name, '-s', 'user')
    $envObj = Get-EntryValue $Entry 'env'
    if ($envObj) {
        $pairs = @()
        if ($envObj -is [hashtable]) { $pairs = @($envObj.GetEnumerator() | ForEach-Object { '{0}={1}' -f $_.Key, $_.Value }) }
        else { $pairs = @($envObj.PSObject.Properties | ForEach-Object { '{0}={1}' -f $_.Name, $_.Value }) }
        foreach ($p in $pairs) { $a += @('-e', $p) }
    }
    $a += '--'
    $a += "$(Get-EntryValue $Entry 'command')"
    $a += @(Get-EntryValue $Entry 'args' | Where-Object { $null -ne $_ } | ForEach-Object { "$_" })
    return Invoke-Native $script:ClaudeExe $a
}

function Format-McpEntry {
    param($Entry)
    $cmd = Get-EntryValue $Entry 'command'
    if (-not $cmd) {
        $url = Get-EntryValue $Entry 'url'
        if ($url) { return ('{0} {1}' -f (Get-EntryValue $Entry 'type'), $url) }
        return ($Entry | ConvertTo-Json -Depth 10 -Compress)
    }
    $parts = @($cmd) + @(Get-EntryValue $Entry 'args' | Where-Object { $null -ne $_ })
    return (($parts | ForEach-Object { if ("$_" -match '\s') { '"' + $_ + '"' } else { "$_" } }) -join ' ')
}

# Kayıt bu repoyu mu gösteriyor? (komut ya da argümanlardan biri repo altında)
function Test-McpEntryOwned {
    param($Entry, [string]$RepoRoot)
    $root = ($RepoRoot.TrimEnd('\', '/') -replace '/', '\').ToLowerInvariant() + '\'
    $vals = @(Get-EntryValue $Entry 'command') + @(Get-EntryValue $Entry 'args')
    foreach ($v in $vals) {
        if ($null -eq $v) { continue }
        if (("$v" -replace '/', '\').ToLowerInvariant().StartsWith($root)) { return $true }
    }
    return $false
}

function Test-McpEntrySame {
    param($Entry, [string[]]$ServerCommand)
    if (-not $Entry) { return $false }
    $type = "$(Get-EntryValue $Entry 'type')"
    if ($type -and $type -ne 'stdio') { return $false }
    if (Get-EntryValue $Entry 'env') {
        $e = Get-EntryValue $Entry 'env'
        $n = 0
        if ($e -is [hashtable]) { $n = $e.Count } else { $n = @($e.PSObject.Properties).Count }
        if ($n -gt 0) { return $false }
    }
    $have = @("$(Get-EntryValue $Entry 'command')") + @(Get-EntryValue $Entry 'args' | Where-Object { $null -ne $_ } | ForEach-Object { "$_" })
    if ($have.Count -ne $ServerCommand.Count) { return $false }
    for ($i = 0; $i -lt $have.Count; $i++) { if ($have[$i] -ne $ServerCommand[$i]) { return $false } }
    return $true
}

function Register-McpServer {
    param([string]$Name, [string[]]$ServerCommand, [string]$RepoRoot)
    $api = Get-McpApi
    $old = & $api.Get $Name
    $display = Format-McpEntry ([pscustomobject]@{ command = $ServerCommand[0]; args = @($ServerCommand | Select-Object -Skip 1) })
    if ($old -and (Test-McpEntrySame $old $ServerCommand)) {
        return New-StepResult ok ('MCP zaten kayıtlı: {0}' -f $Name)
    }
    $foreign = $old -and -not (Test-McpEntryOwned $old $RepoRoot)
    $oldText = $null
    if ($old) { $oldText = Format-McpEntry $old }
    if ($script:DryRun) {
        if ($foreign) {
            return New-StepResult warn ('MCP: "{0}" şu an repo DIŞINI gösteriyor ve DEĞİŞTİRİLECEK (eski: {1}; yedeklenir) -> {2}' -f $Name, $oldText, $display)
        }
        if ($old) { return New-StepResult dry ('MCP: "{0}" güncellenir (eski: {1}; yedeklenir) -> {2}' -f $Name, $oldText, $display) }
        return New-StepResult dry ('MCP: claude mcp add {0} -s user -- {1}' -f $Name, $display)
    }
    if (-not (Test-Path -LiteralPath $ServerCommand[0])) {
        throw ('MCP sunucu programı yok: {0}' -f $ServerCommand[0])
    }
    $bkFile = $null
    if ($old) {
        $bkFile = Get-BackupPath (Join-Path 'mcp' ($Name + '.json'))
        $bkJson = [ordered]@{ name = $Name; scope = 'user'; entry = $old } | ConvertTo-Json -Depth 10
        [IO.File]::WriteAllText($bkFile, $bkJson + "`n", (New-Object Text.UTF8Encoding($false)))
        Write-StepLine info ('eski MCP kaydı ({0}): {1}  [yedek: {2}]' -f $Name, $oldText, $bkFile)
        $r = & $api.Remove $Name
        if ($r.ExitCode -ne 0) {
            throw ("eski MCP kaydı kaldırılamadı (çıkış {0}); hiçbir şey değiştirilmedi:{1}{2}" -f $r.ExitCode, [Environment]::NewLine, (Format-OutputTail $r.Output))
        }
    }
    $new = [pscustomobject]@{ type = 'stdio'; command = $ServerCommand[0]; args = @($ServerCommand | Select-Object -Skip 1) }
    $r = & $api.Add $Name $new
    if ($r.ExitCode -ne 0) {
        $why = "MCP kaydı başarısız (çıkış {0}):{1}{2}" -f $r.ExitCode, [Environment]::NewLine, (Format-OutputTail $r.Output)
        if ($old) {
            $rr = & $api.Add $Name $old
            if ($rr.ExitCode -eq 0) { throw ('{0}{1}      eski kayıt geri yüklendi: {2}' -f $why, [Environment]::NewLine, $oldText) }
            throw ('{0}{1}      eski kayıt GERİ YÜKLENEMEDİ; yedek: {2}' -f $why, [Environment]::NewLine, $bkFile)
        }
        throw $why
    }
    if ($foreign) {
        return New-StepResult warn ('MCP kaydedildi: {0}; repo dışını gösteren eski kayıt değiştirildi (eski: {1}; yedek: {2})' -f $Name, $oldText, $bkFile)
    }
    if ($old) { return New-StepResult ok ('MCP kaydı güncellendi: {0} (eski kaydın yedeği: {1})' -f $Name, $bkFile) }
    return New-StepResult ok ('MCP kaydedildi: {0} (kullanıcı kapsamı)' -f $Name)
}

function Unregister-McpServer {
    param([string]$Name, [string]$RepoRoot)
    $api = Get-McpApi
    $old = & $api.Get $Name
    if (-not $old) { return New-StepResult skip ('MCP kaydı yok: {0}' -f $Name) }
    $oldText = Format-McpEntry $old
    if (-not (Test-McpEntryOwned $old $RepoRoot)) {
        return New-StepResult warn ('MCP kaydı "{0}" bu repoyu göstermiyor ({1}); dokunulmadı' -f $Name, $oldText)
    }
    if ($script:DryRun) { return New-StepResult dry ('MCP: claude mcp remove {0} -s user ({1})' -f $Name, $oldText) }
    $r = & $api.Remove $Name
    if ($r.ExitCode -ne 0) {
        throw ("MCP kaydı kaldırılamadı (çıkış {0}):{1}{2}" -f $r.ExitCode, [Environment]::NewLine, (Format-OutputTail $r.Output))
    }
    return New-StepResult ok ('MCP kaydı kaldırıldı: {0}' -f $Name)
}

# ---------------------------------------------------------------- arka plan servisi (Scheduled Task)

# Görev Zamanlayıcı çağrıları tek yerden geçer; testler Set-TaskApi ile sahtesini verir.
function New-RealTaskApi {
    @{
        Get        = { param($Name) Get-ScheduledTask -TaskName $Name -TaskPath '\' -ErrorAction SilentlyContinue }
        List       = { Get-ScheduledTask -ErrorAction SilentlyContinue }
        Register   = { param($Name, $Task) Register-ScheduledTask -TaskName $Name -TaskPath '\' -InputObject $Task -Force | Out-Null }
        Start      = { param($Name) Start-ScheduledTask -TaskName $Name -TaskPath '\' }
        Stop       = { param($Name) Stop-ScheduledTask -TaskName $Name -TaskPath '\' }
        Unregister = { param($Name) Unregister-ScheduledTask -TaskName $Name -TaskPath '\' -Confirm:$false }
    }
}
$script:TaskApi = $null

function Set-TaskApi {
    param([hashtable]$Api)
    $script:TaskApi = $Api
}

function Get-TaskApi {
    if (-not $script:TaskApi) {
        if (-not (Get-Command Register-ScheduledTask -ErrorAction SilentlyContinue)) {
            throw 'ScheduledTasks modülü yok (Windows 8+ gerekir); servis elle başlatılmalı'
        }
        $script:TaskApi = New-RealTaskApi
    }
    return $script:TaskApi
}

function Get-CurrentUserId {
    if ($env:USERDOMAIN) { return ('{0}\{1}' -f $env:USERDOMAIN, $env:USERNAME) }
    return $env:USERNAME
}

# Kullanıcı düzeyinde (yönetici gerektirmeyen), oturum açılışında başlayan görev tanımı.
function New-ServiceTaskDefinition {
    param([string]$PythonW, [string]$Arguments, [string]$WorkingDirectory, [string]$Description)
    $user = Get-CurrentUserId
    $action = New-ScheduledTaskAction -Execute $PythonW -Argument $Arguments -WorkingDirectory $WorkingDirectory
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew `
        -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    return New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description $Description
}

# Aynı servisi çalıştıran başka adlı görevler (aynı portu kullanır, çakışır).
# Her öğe: Id (yol+ad) ve Disabled (görev devre dışıysa çakışma sayılmaz).
function Find-ConflictingServiceTask {
    param([string]$Name, [string]$ArgumentPattern)
    $api = Get-TaskApi
    $found = @()
    foreach ($t in @(& $api.List)) {
        if (-not $t -or $t.TaskName -eq $Name) { continue }
        foreach ($a in @($t.Actions)) {
            if ($a -and $a.PSObject.Properties['Arguments'] -and "$($a.Arguments)" -match $ArgumentPattern) {
                $found += [pscustomobject]@{
                    Id       = ('{0}{1}' -f $t.TaskPath, $t.TaskName)
                    Disabled = ("$($t.State)" -eq 'Disabled')
                }
                break
            }
        }
    }
    return $found
}

function Install-ServiceTask {
    param([string]$Name, [string]$PythonW, [string]$Arguments, [string]$WorkingDirectory, [string]$Description,
        [string]$ConflictPattern)
    $api = Get-TaskApi
    $existing = & $api.Get $Name
    $others = @(Find-ConflictingServiceTask $Name $ConflictPattern)
    # Yalnız etkin görevler çakışır; devre dışı görev port tutmaz.
    $conflicts = @($others | Where-Object { -not $_.Disabled } | ForEach-Object { $_.Id })
    foreach ($d in @($others | Where-Object { $_.Disabled })) {
        Write-StepLine info ('aynı servisi çalıştıran başka bir görev var ama devre dışı: {0} (çakışma sayılmaz)' -f $d.Id)
    }
    foreach ($c in $conflicts) {
        Write-StepLine warn ('aynı servisi çalıştıran başka bir görev var: {0} (aynı portu kullanır; birini devre dışı bırak)' -f $c)
    }
    $res = Install-ServiceTaskCore -Name $Name -Existing $existing -PythonW $PythonW -Arguments $Arguments `
        -WorkingDirectory $WorkingDirectory -Description $Description
    if ($conflicts.Count -gt 0 -and ($res.Status -eq 'ok' -or $res.Status -eq 'dry')) {
        if ($res.Status -eq 'ok') { $res.Status = 'warn' }
        $res.Message += ('; dikkat: başka bir beyin servisi görevi var ({0}), port çakışabilir' -f ($conflicts -join ', '))
    }
    return $res
}

function Install-ServiceTaskCore {
    param([string]$Name, $Existing, [string]$PythonW, [string]$Arguments, [string]$WorkingDirectory, [string]$Description)
    $api = Get-TaskApi
    $existing = $Existing
    if ($script:DryRun) {
        $verb = 'oluşturulur'
        if ($existing) { $verb = 'güncellenir' }
        return New-StepResult dry ('servis görevi "{0}" {1} (oturum açılışında: {2} {3}) ve hemen başlatılır' -f $Name, $verb, $PythonW, $Arguments)
    }
    if (-not (Test-Path -LiteralPath $PythonW)) { throw ('servis programı yok: {0}' -f $PythonW) }
    $task = New-ServiceTaskDefinition -PythonW $PythonW -Arguments $Arguments -WorkingDirectory $WorkingDirectory -Description $Description
    $wasRunning = $existing -and ("$($existing.State)" -eq 'Running')
    if ($wasRunning) { & $api.Stop $Name }   # güncel kodla yeniden başlasın
    & $api.Register $Name $task
    & $api.Start $Name
    $state = "$((& $api.Get $Name).State)"
    $verb = 'oluşturuldu'
    if ($existing) { $verb = 'güncellendi' }
    if ($state -ne 'Running' -and $state -ne 'Queued') {
        return New-StepResult warn ('servis görevi "{0}" {1} ama çalışmıyor (durum: {2}); Görev Zamanlayıcı''da geçmişine bak' -f $Name, $verb, $state)
    }
    return New-StepResult ok ('servis görevi "{0}" {1} ve başlatıldı (her oturum açılışında başlar)' -f $Name, $verb)
}

function Uninstall-ServiceTask {
    param([string]$Name)
    $api = Get-TaskApi
    $existing = & $api.Get $Name
    if (-not $existing) { return New-StepResult skip ('servis görevi zaten yok: {0}' -f $Name) }
    if ($script:DryRun) { return New-StepResult dry ('servis görevi "{0}" durdurulup kaldırılır' -f $Name) }
    if ("$($existing.State)" -eq 'Running') { & $api.Stop $Name }
    & $api.Unregister $Name
    return New-StepResult ok ('servis görevi kaldırıldı: {0}' -f $Name)
}

Export-ModuleMember -Function Set-InstallerOption, Get-InstallerBackupDir, Write-Title, Write-StepLine,
    Get-StatusSymbol, New-StepResult, Invoke-Native, Format-OutputTail, Find-Application, Get-PythonCandidate,
    Find-Python, Get-RequiredPython, Get-PythonInstallHint, Install-PackageVenv, Install-Skill, Uninstall-Skill,
    Invoke-SettingsHook, Register-McpServer, Unregister-McpServer, Set-McpContext, Set-McpApi, Set-TaskApi, New-ServiceTaskDefinition,
    Install-ServiceTask, Uninstall-ServiceTask
