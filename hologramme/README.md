# Hologramme de Sarah

Le visage de Sarah, tiré de sa photo, en **lignes horizontales lumineuses** qui suivent son relief. Le bas se défait en poussière. Inspiré d'une image de visage en lignes et particules.

| État | Ce qu'on voit |
|---|---|
| **veille** | un nuage de particules presque invisible |
| **écoute** (après « Hey Sarah ») | les particules se rassemblent et forment son visage, qui « respire » |
| **pense** | une vague de lumière parcourt les lignes de haut en bas |
| **parle** | les lignes ondulent autour de la bouche, **au rythme de sa vraie voix** |
| après la réponse | elle reste visible environ 4 s, puis se défait |

## Comment ça marche

```
sarah.py ──(événement « sarah_etat » : état + courbe de volume de la voix)──► Home Assistant
                                                                                  │ WebSocket
                                          page hologramme (three.js) ◄────────────┘
```

- **Pourquoi pas `assist_satellite` ni les événements du pipeline ?** Il n'y a aucune entité `assist_satellite` (Sarah n'est pas un satellite Home Assistant), et les événements du pipeline Assist ne sont envoyés qu'au programme qui a lancé la demande (`sarah.py`), pas sur le bus d'événements.
- C'est donc **`sarah.py`** qui publie son état à chaque changement. Quand elle parle, il ajoute la **courbe de volume de sa voix** (30 valeurs par seconde) et l'instant exact où elle commence. La voix est jouée par `sarah.py`, pas par le navigateur, mais la page anime quand même les lignes au vrai rythme. Sans courbe, l'animation est simulée.
- Ce sont de simples messages : **aucune configuration de Home Assistant n'est modifiée**.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html`, `sarah-holo.js` | La page et l'hologramme (three.js) |
| `vendor/three.module.min.js` | three.js 0.170, copie locale (marche hors ligne) |
| `serveur.py` | Petit serveur local : `http://127.0.0.1:8770` (ce PC seulement, sans cache) |
| `lancer-hologramme.ps1` | Lance le serveur et ouvre Edge en **plein écran (kiosque)** |
| `config.json` | Adresse de Home Assistant + jeton (**ignoré par git**) |
| `config.exemple.json` | Modèle de `config.json` |
| `visage.jpg` | Photo de Sarah (**ignorée par git**) |

## Installation
1. **Jeton :** Home Assistant → clic sur ton nom en bas à gauche → onglet **Sécurité** → **Jetons d'accès longue durée** → **Créer un jeton** (nom : `Hologramme`). Copie-le dans `config.json` (à partir de `config.exemple.json`).
2. **Photo :** mettre l'image du visage dans `visage.jpg`.
3. Dans `sarah-desktop/config.ini` : `affichage = hologramme` (la photo plein écran de `sarah.py` ne s'affiche plus).
4. Lancer : `powershell -File hologramme\lancer-hologramme.ps1`.

**Démarrage automatique :** `scripts/demarrer-sarah.ps1`, déjà lancé à chaque ouverture de session, ouvre aussi l'hologramme quand `affichage = hologramme`.

## Utilisation
- **D** : mode debug, avec des boutons pour forcer veille, écoute, pense ou parle.
- **Alt + F4** : fermer le plein écran.
- **Point rouge** en bas à droite : Home Assistant injoignable. La page se reconnecte seule (après 1 s, 2 s, 4 s… jusqu'à 15 s).
