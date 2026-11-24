# Crée la machine virtuelle Home Assistant OS dans VirtualBox (Windows / PowerShell)
#
# Réglages finaux du projet :
#   - 4 Go de RAM et 4 processeurs (2 de chaque ne suffisaient pas pour la reconnaissance vocale)
#   - démarrage EFI (obligatoire pour Home Assistant OS)
#   - disque de 32 Go
#   - réseau NAT + redirection de ports (le mode pont ne marchait pas sur le Wi-Fi du collège)
#
# Après le premier démarrage : ouvrir http://localhost:8080

$ErrorActionPreference = 'Stop'

$Version = '18.4'   # 18.5 n'existe que pour Raspberry Pi : vérifier qu'une image "ova" existe pour la version voulue
$VBox    = 'C:\Program Files\Oracle\VirtualBox\VBoxManage.exe'
$Dossier = Join-Path $env:USERPROFILE 'VirtualBox VMs'
$Nom     = 'HomeAssistant'
$Vdi     = Join-Path $Dossier "$Nom\haos_ova-$Version.vdi"

# 1. Télécharger et décompresser l'image officielle
New-Item -ItemType Directory -Force (Join-Path $Dossier $Nom) | Out-Null
$Zip = "$Vdi.zip"
curl.exe -L --fail -o $Zip "https://github.com/home-assistant/operating-system/releases/download/$Version/haos_ova-$Version.vdi.zip"
Expand-Archive $Zip -DestinationPath (Join-Path $Dossier $Nom) -Force
Remove-Item $Zip

# 2. Créer la VM
& $VBox createvm --name $Nom --ostype Linux_64 --basefolder $Dossier --register
& $VBox modifyvm $Nom --memory 4096 --cpus 4 --firmware efi --graphicscontroller vmsvga --audio-enabled off

# 3. Réseau NAT + redirections de ports (PC -> VM)
& $VBox modifyvm $Nom --nic1 nat --nictype1 82540EM
& $VBox modifyvm $Nom --natpf1 "web80,tcp,127.0.0.1,8080,,80"
& $VBox modifyvm $Nom --natpf1 "ha,tcp,127.0.0.1,8123,,8123"
& $VBox modifyvm $Nom --natpf1 "observer,tcp,127.0.0.1,4357,,4357"

# 4. Disque de 32 Go
& $VBox modifymedium disk $Vdi --resize 32768
& $VBox storagectl $Nom --name SATA --add sata --controller IntelAhci --portcount 1
& $VBox storageattach $Nom --storagectl SATA --port 0 --device 0 --type hdd --medium $Vdi

# 5. Démarrer
& $VBox startvm $Nom --type gui
Write-Host "VM démarrée. Attendre environ 20 minutes au premier démarrage, puis ouvrir http://localhost:8080"
