$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$taskRoot = Split-Path $PSScriptRoot -Parent
$toolRoot = Join-Path $taskRoot '.tools'
$sdkRoot = Join-Path $toolRoot 'android-sdk'
New-Item -ItemType Directory -Force -Path $sdkRoot | Out-Null

function Get-VerifiedArchive($url, $destination, $checksum, $algorithm) {
  if (!(Test-Path -LiteralPath $destination)) { Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $destination }
  if ((Get-FileHash -LiteralPath $destination -Algorithm $algorithm).Hash.ToLowerInvariant() -ne $checksum.ToLowerInvariant()) { throw "Checksum mismatch: $destination" }
}
if (!(Test-Path -LiteralPath (Join-Path $toolRoot 'jdk'))) {
  $jdk = (Invoke-RestMethod 'https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=x64&image_type=jdk&os=windows&vendor=eclipse')[0].binary.package
  $archive = Join-Path $toolRoot 'android-jdk.zip'
  Get-VerifiedArchive $jdk.link $archive $jdk.checksum 'SHA256'
  Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $toolRoot 'jdk') -Force
}
$env:JAVA_HOME = (Get-ChildItem (Join-Path $toolRoot 'jdk') -Directory | Select-Object -First 1).FullName
$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_USER_HOME = Join-Path $toolRoot 'android-user'
$env:ANDROID_AVD_HOME = Join-Path $toolRoot 'avd'
$env:GRADLE_USER_HOME = Join-Path $toolRoot 'gradle'
if (!(Test-Path -LiteralPath (Join-Path $sdkRoot 'cmdline-tools/latest/bin/sdkmanager.bat'))) {
  [xml]$repository = (Invoke-WebRequest -UseBasicParsing 'https://dl.google.com/android/repository/repository2-3.xml').Content
  $package = $repository.SelectNodes('//*[local-name()="remotePackage"]') | Where-Object { $_.path -eq 'cmdline-tools;latest' } | Select-Object -First 1
  $download = $package.archives.archive | Where-Object { $_.'host-os' -eq 'windows' } | Select-Object -First 1
  $archive = Join-Path $toolRoot 'android-commandline.zip'
  Get-VerifiedArchive ('https://dl.google.com/android/repository/' + $download.complete.url) $archive $download.complete.checksum.InnerText 'SHA1'
  $extract = Join-Path $toolRoot 'android-commandline'
  Expand-Archive -LiteralPath $archive -DestinationPath $extract -Force
  New-Item -ItemType Directory -Force -Path (Join-Path $sdkRoot 'cmdline-tools/latest') | Out-Null
  Copy-Item -Path (Join-Path $extract 'cmdline-tools/*') -Destination (Join-Path $sdkRoot 'cmdline-tools/latest') -Recurse -Force
}
$manager = Join-Path $sdkRoot 'cmdline-tools/latest/bin/android.exe'
& $manager --no-metrics "--sdk=$sdkRoot" sdk install 'platform-tools' 'platforms/android-36' 'build-tools/36.0.0' 'ndk/29.0.14206865' 'emulator' 'system-images/android-35/google_apis/x86_64'
if ($LASTEXITCODE -ne 0) { throw 'Android SDK setup failed' }
$env:CARGO_HOME = Join-Path $toolRoot 'cargo'
$env:RUSTUP_HOME = Join-Path $toolRoot 'rustup'
& (Join-Path $toolRoot 'cargo/bin/rustup.exe') target add aarch64-linux-android x86_64-linux-android
if ($LASTEXITCODE -ne 0) { throw 'Rust Android target setup failed' }
Write-Output 'Project-local Android toolchain ready.'
