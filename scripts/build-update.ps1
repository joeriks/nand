$ErrorActionPreference = 'Stop'
$nandRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $nandRoot
$nandKey = Join-Path $nandRoot '.data/update-signing/nand.key'
$nandPreviousKey = $env:TAURI_SIGNING_PRIVATE_KEY
if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
    if (-not (Test-Path -LiteralPath $nandKey)) { throw 'Set TAURI_SIGNING_PRIVATE_KEY to the existing release key. Do not generate a replacement key.' }
    $env:TAURI_SIGNING_PRIVATE_KEY = $nandKey
}
try {
    node scripts/tauri.mjs build
    if ($LASTEXITCODE -ne 0) { throw 'Desktop build failed.' }
    node scripts/prepare-update.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Update manifest generation failed.' }
} finally {
    if ($nandPreviousKey) { $env:TAURI_SIGNING_PRIVATE_KEY = $nandPreviousKey }
    else { Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue }
}
