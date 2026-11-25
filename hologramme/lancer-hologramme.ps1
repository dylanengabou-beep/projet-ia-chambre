# Lance l'hologramme de Sarah en plein écran (mode kiosque de Microsoft Edge).
# Pour le fermer : Alt+F4.   Mode debug (boutons de test) : touche D.
$ErrorActionPreference = 'Continue'
$Ici = $PSScriptRoot
$Url = 'http://127.0.0.1:8770/'

# 1. le petit serveur local, s'il ne tourne pas déjà
$enMarche = Get-NetTCPConnection -LocalPort 8770 -State Listen -ErrorAction SilentlyContinue
if (-not $enMarche) {
    Start-Process python -ArgumentList @("`"$Ici\serveur.py`"") -WindowStyle Hidden
    for ($i = 0; $i -lt 20 -and -not (Get-NetTCPConnection -LocalPort 8770 -State Listen -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 300 }
}

# 2. un seul hologramme à la fois : on ferme l'ancien s'il est ouvert
$profil = Join-Path $env:LOCALAPPDATA 'SarahHologramme'
Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -match [regex]::Escape($profil) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

# 3. Edge en kiosque plein écran, avec un profil à part (n'affecte pas ton navigateur habituel)
$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { Write-Host "Microsoft Edge introuvable"; exit 1 }
Start-Process $edge -ArgumentList @("--kiosk", $Url, "--edge-kiosk-type=fullscreen", "--no-first-run",
    "--user-data-dir=`"$profil`"", "--autoplay-policy=no-user-gesture-required",
    "--disable-features=Translate,msEdgeTranslate", "--no-default-browser-check", "--disable-pinch")
