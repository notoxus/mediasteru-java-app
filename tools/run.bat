@echo off
setlocal EnableDelayedExpansion

set "JRE_DIR=%~dp0jre"
set "JAVA_EXE=%JRE_DIR%\bin\javaw.exe"
set "JAR=%~dp0MediaSteru.jar"

:: JREs checker
if exist "%JAVA_EXE%" goto :launch

:: Auto download if that hasnt existed yet
echo [Bootstrapper] JRE not found. Downloading Java 21 runtime...

:: Check with PowerShell
where powershell >nul 2>&1
if errorlevel 1 (
    echo [Bootstrapper] ERROR: PowerShell not found. Cannot auto-download JRE.
    echo Please download and extract a JRE 21 manually to the "jre" folder beside this script.
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop';" ^
  "$api = 'https://api.adoptium.net/v3/assets/latest/21/hotspot?os=windows&architecture=x64&image_type=jre';" ^
  "Write-Host '[Bootstrapper] Fetching download URL from Adoptium...';" ^
  "$json = Invoke-RestMethod -Uri $api -UseBasicParsing;" ^
  "$url  = $json[0].binary.package.link;" ^
  "$file = $json[0].binary.package.name;" ^
  "$dest = Join-Path $env:TEMP $file;" ^
  "Write-Host \"[Bootstrapper] Downloading $file...\";" ^
  "Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing;" ^
  "Write-Host '[Bootstrapper] Extracting JRE...';" ^
  "$jreParent = '%JRE_DIR%';" ^
  "Add-Type -AssemblyName System.IO.Compression.FileSystem;" ^
  "[System.IO.Compression.ZipFile]::ExtractToDirectory($dest, $env:TEMP + '\jre_tmp');" ^
  "$extracted = Get-ChildItem ($env:TEMP + '\jre_tmp') -Directory | Select-Object -First 1;" ^
  "Move-Item $extracted.FullName $jreParent -Force;" ^
  "Remove-Item $dest, ($env:TEMP + '\jre_tmp') -Recurse -Force -ErrorAction SilentlyContinue;" ^
  "Write-Host '[Bootstrapper] JRE installed successfully!'"

if errorlevel 1 (
    echo.
    echo [Bootstrapper] ERROR: Failed to download or extract JRE.
    echo Please check your internet connection or manually place a JRE 21 in the "jre" folder.
    pause
    exit /b 1
)

:: Kiểm tra lại sau khi tải
if not exist "%JAVA_EXE%" (
    echo [Bootstrapper] ERROR: JRE extraction succeeded but java.exe not found at expected path.
    echo Expected: %JAVA_EXE%
    pause
    exit /b 1
)

echo [Bootstrapper] JRE ready!

:: ── Launch ──────────────────────────────────────────────────────────────────
:launch
start "" "%JAVA_EXE%" -jar "%JAR%"
exit /b 0