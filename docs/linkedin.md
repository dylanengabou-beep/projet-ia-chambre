# Brouillon de publication LinkedIn

[← Retour au README](../README.md)

> 🏠🤖 **Projet perso : je construis une IA pour ma chambre**
>
> Mon objectif : une IA avec qui je peux parler, qui contrôle ma chambre et qui sert de système de sécurité.
>
> **Étape 1 :** installer Home Assistant (open source) dans une machine virtuelle VirtualBox, pour apprendre avant d'acheter le matériel.
>
> Ça ne s'est pas passé sans obstacles 👇
> 🔸 Sur le Wi-Fi du collège, la VM en mode pont n'avait pas de réseau → j'ai basculé la VM en **NAT avec redirection de ports**.
> 🔸 La VM gardait son ancienne adresse → un **redémarrage** a tout réglé.
> 🔸 « localhost refused to connect » → Home Assistant redirigeait vers le port 80, que je n'avais pas relié → j'ai utilisé le bon port.
> 🔸 La dernière version (18.5) n'existait que pour Raspberry Pi → j'ai pris la 18.4.
>
> Ce que je retiens : bien comprendre le réseau (pont vs NAT, ports) fait gagner beaucoup de temps.
>
> **Mise à jour :** mon IA m'écoute et me répond à voix haute en français 🎙️🔊
> 🧠 Cerveau : Claude (Anthropic) · 👂 Écoute : Whisper · 🗣️ Voix : Piper. Whisper et Piper tournent **en local** sur ma machine.
>
> D'autres obstacles en chemin 👇
> 🔸 Whisper comprenait du charabia → en mode « auto », il avait choisi un modèle anglais. Je l'ai forcé en français.
> 🔸 Ça marchait une fois puis plus rien → le modèle était trop lourd pour mon portable. J'ai pris un modèle plus léger et donné 4 processeurs à la VM.
> 🔸 Il répondait par écrit mais restait muet → j'ai testé chaque maillon (serveur, fichier audio, Windows, navigateur). C'était Chrome qui bloquait le son du site.
>
> Prochaine étape : acheter mes premières ampoules connectées pour lui dire « allume ma chambre ». 💡
>
> #HomeAssistant #VirtualBox #DomotiqueIntelligente #IA #Réseautique #Étudiant #CollègeBoréal
