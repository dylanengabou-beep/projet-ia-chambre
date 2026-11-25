# Partie 6 — L'hologramme de Sarah

Sarah n'a plus de photo plein écran : elle apparaît en **hologramme** quand on l'appelle, puis disparaît après sa réponse. L'hologramme est une page web (three.js) affichée en plein écran par Edge, en mode kiosque.

## Le principe
- L'hologramme part d'**une image de référence** : une tête sculptée en lignes lumineuses, avec des particules qui s'envolent de la nuque. L'image n'est pas redessinée : un *shader* (petit programme exécuté par la carte graphique) la déforme et l'éclaire en temps réel.
- `sarah.py` publie son état dans Home Assistant (événement `sarah_etat` : veille, écoute, pense, parle, avec la courbe de volume de sa voix). La page s'y abonne par WebSocket.
- Aucune configuration de Home Assistant n'est modifiée : ce sont de simples messages.

| Sarah… | L'hologramme… |
|---|---|
| dort | la fenêtre est cachée : on voit son bureau normal |
| est appelée | la fenêtre apparaît au premier plan, l'image s'allume en fondu, elle baisse le menton et **regarde droit devant elle** |
| réfléchit | une lumière parcourt plus vite les lignes du crâne et du cou |
| parle | **la bouche s'ouvre au rythme de sa vraie voix** (en amande, plus au centre qu'aux coins), elle hoche la tête, les particules s'accélèrent |
| a fini | elle reste environ 4 s, s'efface en fondu, puis la fenêtre se cache |

La souris éclaire les lignes là où elle passe et écarte les particules. **D** affiche des boutons de test.

## Apparition et disparition
`sarah.py` surveille la fenêtre « Sarah — hologramme » (fonction `surveiller_hologramme`) : il l'affiche par-dessus tout dès que Sarah n'est plus en veille, et la cache 6 s après son retour en veille (le temps du fondu de la page).

## Versions essayées
Plusieurs rendus ont été construits avant d'arriver à celui-ci. Ils sont gardés dans le dossier `hologramme/` :

| Fichier | Rendu |
|---|---|
| `sarah-holo-lignes.js` | visage tiré de la photo, en lignes horizontales |
| `sarah-holo-tete3d.js` | tête 3D (modèle facecap de three.js) en lignes |
| `sarah-holo-silhouette.js` | silhouette en particules qui nage sur l'écran, avec bras et main articulés |
| `avatar/` | avatar 3D en corps entier (format VRM, three-vrm), avec gestes saluer, danser et applaudir |
| `sarah-holo.js` | **version actuelle** : l'image de référence animée |

Une vraie rotation de la tête face à l'écran est impossible à partir d'une seule image de profil (on ne voit pas l'autre côté du visage) : il faudrait une tête 3D ou une deuxième image de face. J'ai choisi de garder l'image telle quelle.

## Problèmes rencontrés

### Problème 32 — « Désolée, je n'ai pas réussi : Unexpected error during speech-to-text »
**Symptôme :** Sarah se réveille mais ne comprend plus rien. Spotify et la météo ne marchent plus non plus.
**Cause :** les journaux de Home Assistant montrent `ConnectError: [Errno -3] Try again` : la machine virtuelle n'arrivait plus à résoudre les noms Internet (DNS), probablement après une mise en veille ou un changement de réseau du PC. Le Supervisor ne répondait plus, et l'arrêt normal (bouton ACPI) était ignoré.
**Solution :** redémarrage forcé de la VM : `VBoxManage controlvm HomeAssistant reset`. Home Assistant répond de nouveau en moins d'une minute, avec Internet.

### Problème 33 — Sarah coupe l'écoute juste après son nom
**Symptôme :** on dit « Sarah », on attend qu'elle apparaisse, on pose la question… et elle répond « Je ne t'ai pas entendu », ou ne garde que le début de la phrase.
**Cause :** `sarah.py` envoyait à Home Assistant le morceau d'audio contenant « Sarah ». Avec la pause naturelle qu'on fait en la regardant apparaître, Home Assistant entendait « Sarah » suivi d'un silence et considérait la phrase comme finie.
**Solution :** si les 0,3 dernière seconde avant le réveil est silencieuse, ce morceau n'est plus envoyé. On a 5 s pour commencer à parler et 10 s au maximum par phrase. « Sarah, mets de la musique » d'une seule traite marche toujours.

## Ce que j'ai appris
- Animer une image avec un **shader** : déformer les coordonnées (bouche, tête) plutôt que redessiner.
- Piloter une fenêtre Windows depuis Python (`EnumWindows`, `ShowWindow`, `SetWindowPos`).
- Un changement d'interface (l'apparition à l'écran) peut changer la façon dont on parle à l'assistant : il faut adapter la détection de fin de phrase.
