# 🏠🤖 Une IA pour ma chambre

Projet personnel : une **IA avec qui je peux parler**, qui **contrôle ma chambre** (lumières, prises) et qui servira de **système de sécurité** (caméra, capteurs, alertes sur mon téléphone).

Le « cerveau » est **Home Assistant**, une plateforme open source de maison intelligente. Pour apprendre avant d'acheter du matériel, je l'ai d'abord installé gratuitement dans une **machine virtuelle VirtualBox** sur mon PC portable.

Je dis **« Hey Sarah, mets les LED en bleu »** : son visage apparaît en plein écran, les LED de ma chambre passent au bleu, et elle me répond à voix haute, en **moins de 2 secondes**.

![Sarah répond](captures/13_Sarah_repond_plein_ecran.png)

## Comment ça marche

```
🎙️ Ma voix : « Hey Sarah… »
   │
   ▼
👂 Vosk (sur le PC, hors ligne)       → détecte le mot « Sarah » et affiche son visage
   │
   ▼
📝 ElevenLabs Scribe                   → transforme ma voix en texte
   │
   ▼
🧠 Claude (Anthropic)                  → comprend et agit dans Home Assistant (LED Govee…)
   │
   ▼
🗣️ ElevenLabs (voix « Sarah »)         → me répond à voix haute, son visage s'anime au rythme de sa voix
```

## Technologies

| Outil | Rôle |
|---|---|
| **Home Assistant OS 18.4** | Plateforme de maison intelligente (le cerveau) |
| **Oracle VirtualBox 7.2** | Machine virtuelle sur Windows 11 |
| **Claude (Anthropic)** | Agent de conversation (IA) |
| **ElevenLabs** | Reconnaissance vocale (Scribe) et voix réaliste (Flash v2.5) |
| **Govee lights local** | Contrôle des LED de ma chambre sur le réseau local |
| **Python** : Vosk, pygame, websockets | Programme « Sarah » : mot de réveil, visage animé |
| Whisper + Piper | Première version de la voix, en local (partie 3) |

## Documentation

1. [Installation de Home Assistant dans VirtualBox](docs/01-installation-vm.md)
2. [Brancher l'IA Claude](docs/02-integration-claude.md)
3. [Assistant vocal : Whisper + Piper](docs/03-assistant-vocal.md)
4. [Voix réaliste ElevenLabs et LED Govee](docs/04-voix-elevenlabs-et-led-govee.md)
5. [Sarah : une IA toujours active, avec un visage](docs/05-sarah-programme-bureau.md)

Chaque partie contient les étapes, les captures d'écran, et surtout **les problèmes rencontrés avec leur solution** (23 problèmes au total).

- 📄 Toute la documentation en Word : [`docs/Documentation_Projet_IA_Chambre.docx`](docs/Documentation_Projet_IA_Chambre.docx) (générée par [`scripts/generer-word.py`](scripts/generer-word.py))
- Script pour recréer la VM : [`scripts/creer-vm-homeassistant.ps1`](scripts/creer-vm-homeassistant.ps1)
- Relais localhost (micro dans Chrome) : [`scripts/relais-localhost.py`](scripts/relais-localhost.py)
- Programme Sarah : [`sarah-desktop/`](sarah-desktop/)

## État du projet

- [x] Home Assistant installé dans une VM
- [x] IA Claude branchée et en français
- [x] Je parle à l'IA et elle me répond à voix haute
- [x] Voix réaliste (ElevenLabs)
- [x] LED de ma chambre contrôlées à la voix (Govee)
- [x] Mot de réveil « Hey Sarah » et visage animé en plein écran
- [x] Volume du PC contrôlé à la voix
- [x] Démarrage automatique avec Windows
- [ ] Ampoules et prises connectées (TP-Link Tapo)
- [ ] Boîtier dédié Home Assistant Green (24 h/24)
- [ ] Micro Home Assistant Voice
- [ ] Sécurité : caméra, capteurs de porte, alertes

## Auteur

Joris Dylane Touossock Ngabou, étudiant au Collège Boréal.
