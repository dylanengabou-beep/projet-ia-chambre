# Hologramme de Sarah

Sarah apparaît en plein écran **quand on l'appelle** : une tête sculptée en lignes lumineuses, avec des particules qui s'envolent de la nuque. L'image de référence (`tete.jpg`) est affichée telle quelle et animée en temps réel par un shader three.js.

| État | Ce qu'on voit |
|---|---|
| **veille** | rien : la fenêtre est cachée, on voit son bureau |
| **écoute** (après « Sarah » ou Ctrl+Espace) | elle apparaît en fondu, baisse le menton et regarde droit devant elle |
| **pense** | une lumière parcourt plus vite les lignes du crâne et du cou |
| **parle** | la bouche s'ouvre **au rythme de sa vraie voix**, elle hoche la tête, les particules s'accélèrent |
| après la réponse | elle reste environ 4 s, s'efface en fondu, puis la fenêtre se cache |

La souris éclaire les lignes là où elle passe et écarte les particules.

## Comment ça marche

```
sarah.py ──(événement « sarah_etat » : état + courbe de volume de la voix)──► Home Assistant
   │                                                                              │ WebSocket
   └── affiche / cache la fenêtre                 page hologramme (three.js) ◄────┘
```

- **`sarah.py`** publie son état à chaque changement. Quand elle parle, il ajoute la **courbe de volume de sa voix** (30 valeurs par seconde) et l'instant exact où elle commence : la bouche suit la vraie voix.
- **`sarah.py`** affiche aussi la fenêtre « Sarah — hologramme » par-dessus tout quand on l'appelle, et la cache 6 s après le retour en veille (`surveiller_hologramme`).
- Il n'y a ni `assist_satellite` ni événements du pipeline sur le bus de Home Assistant : c'est pour ça que `sarah.py` publie lui-même son état. Ce sont de simples messages : **aucune configuration de Home Assistant n'est modifiée**.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html`, `sarah-holo.js` | La page et l'hologramme actuel |
| `tete.jpg` | Image de référence (**ignorée par git**) |
| `vendor/` | three.js 0.170 et ses modules, copies locales (marche hors ligne) |
| `serveur.py` | Petit serveur local : `http://127.0.0.1:8770` (ce PC seulement, sans cache) |
| `lancer-hologramme.ps1` | Lance le serveur et ouvre Edge en **plein écran (kiosque)** |
| `config.json` | Adresse de Home Assistant + jeton (**ignoré par git**) ; modèle : `config.exemple.json` |
| `sarah-holo-lignes.js`, `sarah-holo-tete3d.js`, `sarah-holo-silhouette.js` | Anciennes versions (voir `docs/06-hologramme.md`) |
| `avatar/` | Essai d'avatar 3D en corps entier (VRM) ; le modèle `.vrm` va dans `modeles/` (**ignoré par git**) |

## Installation
1. **Jeton :** Home Assistant → clic sur ton nom en bas à gauche → onglet **Sécurité** → **Jetons d'accès longue durée** → **Créer un jeton** (nom : `Hologramme`). Copie-le dans `config.json` (à partir de `config.exemple.json`).
2. **Image :** mettre l'image de référence dans `tete.jpg`.
3. Dans `sarah-desktop/config.ini` : `affichage = hologramme`.
4. Lancer : `powershell -File hologramme\lancer-hologramme.ps1` (ou redémarrer Sarah avec `scripts/demarrer-sarah.ps1`, lancé automatiquement à l'ouverture de session).

## Utilisation
- **D** : mode debug (la rend visible même en veille, avec des boutons veille / écoute / pense / parle).
- **Alt + F4** : fermer le plein écran.
- **Point rouge** en bas à droite : Home Assistant injoignable. La page se reconnecte seule (après 1 s, 2 s, 4 s… jusqu'à 15 s).
