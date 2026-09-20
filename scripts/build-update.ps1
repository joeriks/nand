$ErrorActionPreference = 'Stop'
$nandRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $nandRoot
$nandKey = Join-Path $nandRoot '.data/update-signing/nand.key'
$nandPreviousKey = $env:TAURI_SIGNING_PRIVATE_KEY
$nandPreviousPassword = $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD
if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
    if (-not (Test-Path -LiteralPath $nandKey)) { throw 'Set TAURI_SIGNING_PRIVATE_KEY to the existing release key. Do not generate a replacement key.' }
    $env:TAURI_SIGNING_PRIVATE_KEY = $nandKey
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ''
}
try {
    node scripts/tauri.mjs build --ci
    if ($LASTEXITCODE -ne 0) { throw 'Desktop build failed.' }
    node scripts/prepare-update.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Update manifest generation failed.' }
} finally {
    if ($nandPreviousKey) { $env:TAURI_SIGNING_PRIVATE_KEY = $nandPreviousKey }
    else { Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue }
    if ($null -ne $nandPreviousPassword) { $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $nandPreviousPassword }
    else { Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue }
}
