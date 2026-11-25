# Démarre tout le système au lancement de Windows :
#   1. la VM Home Assistant (sans fenêtre)
#   2. le relais http://localhost:8080 (si la VM est en mode pont)
#   3. Sarah (mot de réveil + visage plein écran)
# Les journaux sont dans sarah-desktop\journaux\.

$ErrorActionPreference = 'Continue'
$Projet  = Split-Path -Parent $PSScriptRoot
$Sarah   = Join-Path $Projet 'sarah-desktop'
$Journal = Join-Path $Sarah 'journaux'
$VBox    = 'C:\Program Files\Oracle\VirtualBox\VBoxManage.exe'
New-Item -ItemType Directory -Force $Journal | Out-Null
$log = Join-Path $Journal 'demarrage.log'
function Noter($m) { "[{0:yyyy-MM-dd HH:mm:ss}] $m" -f (Get-Date) | Add-Content $log -Encoding utf8 }

# Déjà lancé ? (évite deux Sarah en même temps)
if (Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'sarah\.py' }) { Noter 'Sarah tourne déjà'; exit }

# 1. VM Home Assistant
if (-not (& $VBox list runningvms | Select-String 'HomeAssistant')) {
    Noter 'Démarrage de la VM HomeAssistant'
    & $VBox startvm HomeAssistant --type headless | Out-Null
}
$modeReseau = (& $VBox showvminfo HomeAssistant --machinereadable | Select-String '^nic1=').ToString()
Noter "Réseau de la VM : $modeReseau"

# 2. Relais (seulement en mode pont : en NAT, VirtualBox fournit déjà localhost:8080)
if ($modeReseau -match 'bridged') {
    $ip = $null
    for ($i = 0; $i -lt 60 -and -not $ip; $i++) {
        try { $ip = ([Net.Dns]::GetHostAddresses('homeassistant.local') | Where-Object AddressFamily -eq 'InterNetwork' | Select-Object -First 1).IPAddressToString } catch {}
        if (-not $ip) { Start-Sleep 5 }
    }
    if (-not $ip) { $ip = '192.168.2.72'; Noter "homeassistant.local introuvable, adresse par défaut $ip" }
    Noter "Relais localhost:8080 -> $ip`:80"
    Start-Process python -ArgumentList @("`"$Projet\scripts\relais-localhost.py`"", $ip, '80') -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $Journal 'relais.log') -RedirectStandardError (Join-Path $Journal 'relais-erreurs.log')
}

# 3. Attendre que Home Assistant réponde (au plus 5 minutes), puis lancer Sarah
for ($i = 0; $i -lt 60; $i++) {
    try { if ((Invoke-WebRequest 'http://localhost:8080' -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200) { break } } catch {}
    Start-Sleep 5
}
Noter 'Lancement de Sarah'
$env:PYTHONIOENCODING = 'utf-8'
Start-Process python -ArgumentList @('-u', "`"$Sarah\sarah.py`"") -WorkingDirectory $Sarah -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $Journal 'sarah.log') -RedirectStandardError (Join-Path $Journal 'sarah-erreurs.log')
