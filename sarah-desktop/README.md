# Sarah — programme de bureau

Assistante vocale **toujours à l'écoute** : dire « Hey Sarah », et son visage apparaît en plein écran, écoute la demande, la fait exécuter par Home Assistant, puis répond à voix haute.

Documentation complète : [docs/05-sarah-programme-bureau.md](../docs/05-sarah-programme-bureau.md)

## Installation (Windows)

```powershell
cd sarah-desktop
python -m pip install -r requirements.txt

# Modèle français pour le mot de réveil (41 Mo)
curl.exe -L -o modeles\vosk-fr.zip https://alphacephei.com/vosk/models/vosk-model-small-fr-0.22.zip
Expand-Archive modeles\vosk-fr.zip modeles
```

Ensuite :
1. Mettre une image de visage dans `visage.jpg`.
2. Dans Home Assistant : **Profil → Sécurité → Jetons d'accès longue durée → Créer un jeton**, puis le coller dans `token.txt`.
3. Vérifier `config.ini` : adresse de Home Assistant et micro.

```powershell
python sarah.py
```

`Échap` coupe sa voix.

## Démarrage automatique avec Windows
Le script [`scripts/demarrer-sarah.ps1`](../scripts/demarrer-sarah.ps1) lance, dans l'ordre :
1. la VM Home Assistant, **sans fenêtre** (`--type headless`) ;
2. le relais `localhost:8080`, seulement si la VM est en mode pont. Il trouve l'adresse de Home Assistant tout seul grâce à `homeassistant.local` ;
3. Sarah, une fois que Home Assistant répond.

Il est lancé à chaque ouverture de session par un raccourci placé dans le dossier **Démarrage** de Windows (`Win + R` → `shell:startup`) :

```
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "...\scripts\demarrer-sarah.ps1"
```

Les journaux sont dans `sarah-desktop/journaux/` (`demarrage.log`, `sarah.log`). Pour **désactiver** le démarrage automatique, il suffit de supprimer le raccourci « Sarah - IA de ma chambre » du dossier Démarrage.

## Fichiers

| Fichier | Sur GitHub ? | Rôle |
|---|---|---|
| `sarah.py` | ✅ | Le programme |
| `config.ini` | ✅ | Adresse de Home Assistant, mot de réveil, micro |
| `requirements.txt` | ✅ | Bibliothèques Python |
| `token.txt` | ❌ (secret) | Jeton d'accès à Home Assistant |
| `visage.jpg` | ❌ | Photo du visage |
| `modeles/` | ❌ (41 Mo) | Modèle Vosk français |

## Choisir le micro
Dans `config.ini`, `micro =` accepte une partie du nom du micro. Pour lister les micros :

```powershell
python -c "import sounddevice as sd; print(sd.query_devices())"
```
