# NEXOR CLIP: сборка установщика в один клик.
# Устанавливает недостающие инструменты (через winget), собирает .exe и открывает папку с ним.
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

function Has($cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
              [Environment]::GetEnvironmentVariable("Path", "User") + ";" +
              "$env:USERPROFILE\.cargo\bin"
}

Write-Host "=== NEXOR CLIP: сборка установщика ===" -ForegroundColor White

if (-not (Has "winget")) {
  Write-Host "Не найден winget. Обновите «Установщик приложений» (App Installer) в Microsoft Store." -ForegroundColor Yellow
  exit 1
}

if (-not (Has "node")) {
  Write-Host "[1/3] Установка Node.js LTS..."
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  Refresh-Path
} else { Write-Host "[1/3] Node.js найден: $(node -v)" }

# --- Компоновщик Microsoft C++ (link.exe) ---
$vsWhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vsInstaller = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\setup.exe"
$vcComp = "Microsoft.VisualStudio.Component.VC.Tools.x86.x64"
function Get-VcPath {
  if (-not (Test-Path $vsWhere)) { return $null }
  $p = & $vsWhere -latest -products * -requires $vcComp -property installationPath
  if ($p) { return $p } else { return $null }
}

if (-not (Get-VcPath)) {
  Write-Host "[2/3] Не найден компилятор C++ (link.exe). Установка..." -ForegroundColor Yellow
  Write-Host "      Windows попросит разрешение администратора - нажмите «Да». Это займёт 5-20 минут."
  $existing = $null
  if (Test-Path $vsWhere) { $existing = & $vsWhere -latest -products * -property installationPath }
  $vsArgs = "--add Microsoft.VisualStudio.Workload.VCTools --add $vcComp --add Microsoft.VisualStudio.Component.Windows11SDK.22621 --includeRecommended --passive --norestart --wait"
  if ($existing -and (Test-Path $vsInstaller)) {
    # Build Tools / Visual Studio уже стоят, но без C++ - добавляем нужный компонент.
    Start-Process -FilePath $vsInstaller -ArgumentList "modify --installPath `"$existing`" $vsArgs" -Verb RunAs -Wait
  } else {
    winget install -e --id Microsoft.VisualStudio.2022.BuildTools --accept-source-agreements --accept-package-agreements --override "$vsArgs"
  }
  if (-not (Get-VcPath)) {
    Write-Host ""
    Write-Host "Компилятор C++ всё ещё не найден. Установите вручную:" -ForegroundColor Yellow
    Write-Host " 1. Откройте «Visual Studio Installer» (через Пуск)."
    Write-Host " 2. У «Build Tools 2022» нажмите «Изменить»."
    Write-Host " 3. Отметьте «Разработка классических приложений на C++» и нажмите «Изменить/Установить»."
    Write-Host " 4. Перезагрузите компьютер и снова запустите BUILD-INSTALLER.bat."
    Write-Host "Если Visual Studio Installer нет: https://aka.ms/vs/17/release/vs_BuildTools.exe"
    exit 1
  }
  Write-Host "[2/3] Компилятор C++ установлен" -ForegroundColor Green
} else { Write-Host "[2/3] Компилятор C++ найден" }

if (-not (Has "cargo")) {
  Write-Host "[3/3] Установка Rust..."
  winget install -e --id Rustlang.Rustup --accept-source-agreements --accept-package-agreements
  Refresh-Path
  rustup default stable-msvc
} else { Write-Host "[3/3] Rust найден: $(cargo -V)" }

# --- Папка сборки ---
# Сборка идёт ВНЕ OneDrive и вне путей с кириллицей: на диск, где больше всего места.
$drives = Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Free -gt 0 -and $_.Root -match '^[A-Z]:\\$' } | Sort-Object Free -Descending
$best = $drives | Select-Object -First 1
$targetDir = Join-Path $best.Root "nexor-build"
$env:CARGO_TARGET_DIR = $targetDir
$env:CARGO_BUILD_JOBS = "4"
$env:CARGO_INCREMENTAL = "0"
$freeGb = [math]::Round($best.Free / 1GB, 1)
Write-Host "Папка сборки: $targetDir (свободно $freeGb ГБ)"

# Старые сборки внутри проекта больше не нужны (они лежат в OneDrive и занимают место).
$oldTarget = Join-Path $PSScriptRoot "src-tauri\target"
if (Test-Path $oldTarget) {
  Write-Host "Удаление старой папки сборки из проекта..."
  Remove-Item $oldTarget -Recurse -Force -ErrorAction SilentlyContinue
}
$debugDir = Join-Path $targetDir "debug"
if (Test-Path $debugDir) { Remove-Item $debugDir -Recurse -Force -ErrorAction SilentlyContinue }

if ($freeGb -lt 6) {
  Write-Host "Для сборки нужно минимум 6 ГБ свободного места (лучше 10). Сейчас: $freeGb ГБ." -ForegroundColor Yellow
  Write-Host "Очистите Корзину, запустите cleanmgr, удалите содержимое %TEMP% и повторите." -ForegroundColor Yellow
  exit 1
}

Write-Host "Установка зависимостей проекта..."
npm install
if ($LASTEXITCODE -ne 0) { throw "npm install завершился с ошибкой" }

Write-Host "Сборка установщика (первый раз 10-20 минут)..."
$log = Join-Path $PSScriptRoot "build-log.txt"
cmd /c "npm run app:build 2>&1" | Tee-Object -FilePath $log
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "=== ПЕРВАЯ ОШИБКА (её нужно прислать) ===" -ForegroundColor Yellow
  $lines = Get-Content $log
  $i = ($lines | Select-String -Pattern '^error' | Select-Object -First 1).LineNumber
  if ($i) { $lines[($i - 1)..([math]::Min($i + 25, $lines.Count - 1))] | ForEach-Object { Write-Host $_ } }
  Write-Host ""
  Write-Host "Полный журнал сохранён: $log" -ForegroundColor Yellow
  exit 1
}

$out = Join-Path $targetDir "release\bundle\nsis"
$exe = Get-ChildItem $out -Filter *.exe | Select-Object -First 1
$dest = Join-Path ([Environment]::GetFolderPath("Desktop")) $exe.Name
Copy-Item $exe.FullName $dest -Force
Write-Host ""
Write-Host "Готово! Установщик скопирован на рабочий стол: $dest" -ForegroundColor Green
Start-Process explorer.exe "/select,`"$dest`""
