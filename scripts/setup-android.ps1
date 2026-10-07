# Prepare Android build environment: JDK 21 + Android SDK (cmdline-tools)
# Usage: powershell -ExecutionPolicy Bypass -File scripts/setup-android.ps1
# NOTE: ASCII-only on purpose. PowerShell 5.1 parses BOM-less UTF-8 as ANSI,
# which garbles non-ASCII characters and breaks the script.
$ErrorActionPreference = 'Stop'

# Default install root follows the current user's home; override with ANDROID_BUILD_ROOT.
$root = if ($env:ANDROID_BUILD_ROOT) { $env:ANDROID_BUILD_ROOT } else { Join-Path $env:USERPROFILE '.android-build' }
$sdkRoot = "$root\android-sdk"
$jdkDir = "$root\jdk21"
$latestDir = "$sdkRoot\cmdline-tools\latest"

# System curl.exe does not read http_proxy env vars, so pass --proxy explicitly.
# -sS keeps the progress meter out of stderr (PowerShell treats stderr as errors).
$proxy = if ($env:http_proxy) { $env:http_proxy } elseif ($env:HTTP_PROXY) { $env:HTTP_PROXY } else { '' }
$curlArgs = @('-L', '-sS', '--retry', '5', '--retry-delay', '3')
if ($proxy) { $curlArgs += @('--proxy', $proxy) }
Write-Output "Using proxy: $(if ($proxy) { $proxy } else { 'none' })"

New-Item -ItemType Directory -Force -Path $root | Out-Null
New-Item -ItemType Directory -Force -Path $sdkRoot | Out-Null

# ---------- 1. JDK 21 ----------
if (-not (Test-Path "$jdkDir\extracted")) {
    $jdkZip = "$root\jdk21.zip"
    if (-not (Test-Path $jdkZip)) {
        Write-Output "[1/5] Downloading JDK 21 (~200MB)..."
        # api.adoptium.net is unreachable through this environment's proxy
        # (schannel close_notify), so use the Microsoft build of OpenJDK instead.
        & curl.exe @curlArgs -o $jdkZip 'https://aka.ms/download-jdk/microsoft-jdk-21-windows-x64.zip'
        if ($LASTEXITCODE -ne 0) { throw "JDK download failed" }
    }
    Write-Output "[2/5] Extracting JDK..."
    Expand-Archive -Path $jdkZip -DestinationPath $jdkDir -Force
    New-Item -ItemType File -Force -Path "$jdkDir\extracted" | Out-Null
}

$javaHome = (Get-ChildItem -Path $jdkDir -Directory |
    Where-Object { Test-Path (Join-Path $_.FullName 'bin\java.exe') } |
    Select-Object -First 1).FullName
if (-not $javaHome) { throw "JDK home not found after extraction" }
Write-Output "JAVA_HOME = $javaHome"

# ---------- 2. Android cmdline-tools ----------
if (-not (Test-Path "$latestDir\bin\sdkmanager.bat")) {
    $toolsZip = "$root\cmdline-tools.zip"
    if (-not (Test-Path $toolsZip)) {
        Write-Output "[3/5] Downloading Android cmdline-tools..."
        & curl.exe @curlArgs -o $toolsZip 'https://dl.google.com/android/repository/commandlinetools-win-13114758_latest.zip'
        if ($LASTEXITCODE -ne 0) { throw "cmdline-tools download failed" }
    }
    Write-Output "[4/5] Extracting cmdline-tools..."
    $ctDir = Join-Path $sdkRoot 'cmdline-tools'
    New-Item -ItemType Directory -Force -Path $ctDir | Out-Null
    Expand-Archive -Path $toolsZip -DestinationPath $ctDir -Force
    $inner = Join-Path $ctDir 'cmdline-tools'
    if (Test-Path $inner) {
        if (Test-Path $latestDir) { Remove-Item $latestDir -Recurse -Force }
        Rename-Item $inner 'latest'
    }
}
if (-not (Test-Path "$latestDir\bin\sdkmanager.bat")) { throw "sdkmanager not in place" }

# ---------- 3. Pre-seed SDK licenses ----------
$licDir = Join-Path $sdkRoot 'licenses'
New-Item -ItemType Directory -Force -Path $licDir | Out-Null
$hashes = @(
    '8933bad161af4178b1185d1a37fbf41ea5269c55',
    'd56f5187479451eabf01fb78af6dfcb131a6481e',
    '24333f8a63b6825ea9c5514f83c2829b004d1fee',
    '84831b9409646a918e30573bab4c9c91346d8abd'
)
Set-Content -Encoding ASCII -Path (Join-Path $licDir 'android-sdk-license') -Value $hashes
Set-Content -Encoding ASCII -Path (Join-Path $licDir 'android-sdk-preview-license') -Value $hashes

# ---------- 4. Install SDK components ----------
$env:JAVA_HOME = $javaHome
$env:PATH = "$javaHome\bin;$env:PATH"
$sdkman = Join-Path $latestDir 'bin\sdkmanager.bat'

Write-Output "[5/5] Installing platform-tools / platforms;android-34 / build-tools;34.0.0 (~1.5GB)..."
& cmd.exe /c "`"$sdkman`" --sdk_root=`"$sdkRoot`" `"platform-tools`" `"platforms;android-34`" `"build-tools;34.0.0`""

Write-Output ""
Write-Output "===== DONE ====="
Write-Output "JAVA_HOME=$javaHome"
Write-Output "ANDROID_SDK_ROOT=$sdkRoot"
"JAVA_HOME=$javaHome`r`nANDROID_SDK_ROOT=$sdkRoot" | Set-Content -Encoding ASCII -Path (Join-Path $root 'env.txt')
