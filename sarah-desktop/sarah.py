"""Sarah — assistante vocale de ma chambre, version bureau.

Toujours à l'écoute : quand je dis « Hey Sarah », son visage apparaît en plein écran,
elle écoute ma demande, Home Assistant (Whisper + Claude + ElevenLabs) exécute l'action,
puis elle répond à voix haute et disparaît.

Configuration : config.ini (adresse de Home Assistant) + token.txt (jeton d'accès, jamais sur GitHub).
"""
import asyncio
import configparser
import ctypes
import hashlib
import io
import json
import math
import os
import queue
import subprocess
import sys
import threading
import time
import re
import urllib.request
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import pygame
import sounddevice as sd
import websockets
from vosk import KaldiRecognizer, Model, SetLogLevel

ICI = Path(__file__).resolve().parent
cfg = configparser.ConfigParser()
cfg.read(ICI / "config.ini", encoding="utf-8")
HA_URL = cfg.get("home_assistant", "url", fallback="http://localhost:8080").rstrip("/")
PIPELINE = cfg.get("home_assistant", "pipeline_id", fallback="").strip() or None
IMAGE = ICI / cfg.get("sarah", "image", fallback="visage.jpg")
MOTS_REVEIL = [m.strip() for m in cfg.get("sarah", "mots_reveil", fallback="sarah").split(",") if m.strip()]
MICRO = cfg.get("sarah", "micro", fallback="").strip() or None
TOKEN_FICHIER = ICI / "token.txt"

RATE = 16000
BLOC = 1600  # 0,1 s d'audio

# --- état partagé entre l'écoute (thread) et l'affichage (thread principal) ---
etat = {"mode": "veille", "texte_moi": "", "texte_sarah": "", "depuis": time.time()}
verrou = threading.Lock()
audio_q: "queue.Queue[bytes]" = queue.Queue()
a_jouer: "queue.Queue[bytes]" = queue.Queue()
fin_parole = threading.Event()


def changer(mode, **textes):
    with verrou:
        etat["mode"] = mode
        etat["depuis"] = time.time()
        etat.update(textes)
    print(f"[{time.strftime('%H:%M:%S')}] {mode} {textes if textes else ''}", flush=True)


def lire(cle):
    with verrou:
        return etat[cle]


# ----------------------------------------------------------------- micro
niveau_micro = {"v": 0.0, "bruit": 200.0}


def rappel_micro(indata, frames, t, status):
    b = bytes(indata)
    audio_q.put(b)
    n = float(np.sqrt(np.mean(np.frombuffer(b, dtype=np.int16).astype(np.float32) ** 2)))
    niveau_micro["v"] = n
    if n < niveau_micro["bruit"] * 3:
        niveau_micro["bruit"] = 0.97 * niveau_micro["bruit"] + 0.03 * n


# --------------------------------------------------------- Home Assistant
def niveau(bloc):
    return float(np.sqrt(np.mean(np.frombuffer(bloc, dtype=np.int16).astype(np.float32) ** 2)))


async def demander_a_home_assistant(token, debut_audio, bruit, conversation_id):
    """Envoie la voix au pipeline Assist (reconnaissance → Claude → ElevenLabs) et récupère la réponse."""
    ws_url = HA_URL.replace("http", "ws", 1) + "/api/websocket"
    async with websockets.connect(ws_url, max_size=None) as ws:
        await ws.recv()
        await ws.send(json.dumps({"type": "auth", "access_token": token}))
        rep = json.loads(await ws.recv())
        if rep.get("type") != "auth_ok":
            raise RuntimeError("Jeton refusé par Home Assistant (vérifie token.txt)")
        # On s'arrête après la réponse de Claude : la voix est fabriquée ensuite phrase par phrase
        # (voir parler()), pour que Sarah commence à parler sans attendre la fin de la réponse.
        demande = {"id": 1, "type": "assist_pipeline/run", "start_stage": "stt", "end_stage": "intent",
                   "input": {"sample_rate": RATE}, "timeout": 60}
        if PIPELINE:
            demande["pipeline"] = PIPELINE
        if conversation_id:
            demande["conversation_id"] = conversation_id  # garde le fil de la discussion
        await ws.send(json.dumps(demande))

        handler = None
        envoi_fini = asyncio.Event()
        resultat = {"moi": "", "sarah": "", "url": None, "erreur": None, "conversation_id": None, "deja_dit": None}
        appels = {}  # outils demandés par Claude : id -> (nom, arguments)

        async def envoyer_audio():
            while handler is None:
                await asyncio.sleep(0.01)
            for bloc in debut_audio:  # ce qui a été dit juste après « Sarah »
                await ws.send(bytes([handler]) + bloc)
            # Détection locale de fin de phrase (plus rapide que d'attendre Home Assistant)
            seuil_parole = max(bruit * 2.5, 250)
            seuil_silence = max(bruit * 1.6, 180)
            a_parle = any(niveau(b) > seuil_parole for b in debut_audio[-5:])
            silence = 0
            debut = time.time()
            while not envoi_fini.is_set():
                ecoule = time.time() - debut
                if ecoule > 8 or (not a_parle and ecoule > 4):
                    break
                try:
                    bloc = audio_q.get(timeout=0.05)
                except queue.Empty:
                    await asyncio.sleep(0)
                    continue
                await ws.send(bytes([handler]) + bloc)
                n = niveau(bloc)
                if n > seuil_parole:
                    a_parle, silence = True, 0
                elif n < seuil_silence:
                    silence += 1
                if a_parle and silence >= 8:  # 0,8 s de silence = fin de la phrase
                    break
            await ws.send(bytes([handler]))  # fin de l'audio
            if not envoi_fini.is_set():
                changer("reflexion")

        tache = asyncio.create_task(envoyer_audio())
        async for brut in ws:
            msg = json.loads(brut)
            if msg.get("type") == "result" and not msg.get("success"):
                resultat["erreur"] = msg.get("error", {}).get("message")
                break
            if msg.get("type") != "event":
                continue
            ev = msg["event"]
            t, d = ev["type"], ev.get("data") or {}
            if t == "run-start":
                handler = d["runner_data"]["stt_binary_handler_id"]
            elif t == "stt-vad-end":
                envoi_fini.set()
            elif t == "stt-end":
                envoi_fini.set()
                resultat["moi"] = d["stt_output"]["text"].strip()
                changer("reflexion", texte_moi=resultat["moi"])
            elif t == "intent-progress":
                delta = d.get("chat_log_delta") or {}
                for appel in delta.get("tool_calls") or []:
                    appels[appel.get("id")] = (appel.get("tool_name", ""), appel.get("tool_args") or {})
                if delta.get("role") == "tool_result" and not resultat["deja_dit"]:
                    nom, args = appels.get(delta.get("tool_call_id"), (delta.get("tool_name", ""), {}))
                    phrase = confirmation(nom, args) if action_reussie(delta) else None
                    audio = voix_en_cache(phrase) if phrase else None
                    if audio:  # l'action est faite : Sarah le dit tout de suite, sans attendre Claude
                        resultat["deja_dit"] = phrase
                        fin_parole.clear()
                        a_jouer.put(audio)
                        changer("parle", texte_moi=resultat["moi"], texte_sarah=phrase)
                    elif phrase:
                        threading.Thread(target=mettre_en_cache, args=(phrase,), daemon=True).start()
            elif t == "intent-end":
                resultat["sarah"] = d["intent_output"]["response"]["speech"]["plain"]["speech"]
                resultat["conversation_id"] = d["intent_output"].get("conversation_id")
            elif t == "tts-end":
                resultat["url"] = d["tts_output"]["url"]
            elif t == "error":
                resultat["erreur"] = d.get("message") or d.get("code")
                envoi_fini.set()
            elif t == "run-end":
                break
        envoi_fini.set()
        await tache
        return resultat


def telecharger(url):
    if url.startswith("/"):
        url = HA_URL + url
    with urllib.request.urlopen(url, timeout=30) as r:
        return r.read()


# ------------------------------------------------ voix : phrase par phrase
_voix = {}


def reglages_voix(token):
    """Moteur, langue et voix de l'assistant vocal préféré (lus une fois dans Home Assistant)."""
    if not _voix:
        async def lire_pipeline():
            async with websockets.connect(HA_URL.replace("http", "ws", 1) + "/api/websocket") as ws:
                await ws.recv()
                await ws.send(json.dumps({"type": "auth", "access_token": token}))
                await ws.recv()
                await ws.send(json.dumps({"id": 1, "type": "assist_pipeline/pipeline/list"}))
                res = json.loads(await ws.recv())["result"]
                return next(p for p in res["pipelines"] if p["id"] == (PIPELINE or res["preferred_pipeline"]))
        p = asyncio.run(lire_pipeline())
        _voix.update(engine_id=p["tts_engine"], language=p["tts_language"], voice=p["tts_voice"])
    return _voix


def morceaux(texte, taille=160):
    """Découpe la réponse en morceaux d'une ou deux phrases."""
    phrases = re.split(r"(?<=[.!?…])\s+", texte.strip())
    blocs, courant = [], ""
    for ph in phrases:
        if courant and len(courant) + len(ph) > taille:
            blocs.append(courant)
            courant = ph
        else:
            courant = (courant + " " + ph).strip()
    if courant:
        blocs.append(courant)
    return blocs


def voix_de(token, texte):
    v = reglages_voix(token)
    req = urllib.request.Request(HA_URL + "/api/tts_get_url", method="POST",
                                 headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
                                 data=json.dumps({"engine_id": v["engine_id"], "message": texte, "language": v["language"],
                                                  "options": {"voice": v["voice"]}}).encode())
    return telecharger(json.loads(urllib.request.urlopen(req, timeout=30).read())["path"])


# ------------------------------- confirmations immédiates (voix enregistrée à l'avance)
# Dès que Home Assistant confirme une action, Sarah joue une courte phrase déjà fabriquée
# dans sa voix, au lieu d'attendre la phrase de Claude puis ElevenLabs (1 à 3 s de gagnées).
CACHE_VOIX = ICI / "cache_voix"
COULEURS = {"blue": "bleu", "red": "rouge", "green": "vert", "yellow": "jaune", "white": "blanc",
            "purple": "violet", "orange": "orange", "pink": "rose"}
PHRASES_VOLUME = {"muet": "Son coupé.", "son": "Le son est revenu.", "monter": "Je monte le volume.",
                  "baisser": "Je baisse le volume.", "niveau": "Volume réglé."}
OUTILS_ACTION = {"HassTurnOn", "HassTurnOff", "HassToggle", "HassLightSet", "HassSetVolume",
                 "HassMediaPause", "HassMediaUnpause", "HassMediaNext", "HassMediaPrevious", "HassSetPosition"}


def confirmation(nom_outil, args):
    """Phrase courte qui confirme l'action, ou None si l'outil ne fait que lire une information."""
    court = nom_outil.split("__")[-1]
    if nom_outil.startswith("script__"):
        if court == "volume_du_pc":
            return PHRASES_VOLUME.get(str(args.get("action", "")), "Volume réglé.")
        return "C'est fait."
    if court not in OUTILS_ACTION:
        return None  # GetLiveContext, HassGetState… : pas une action
    if court == "HassTurnOn":
        return "C'est allumé."
    if court == "HassTurnOff":
        return "C'est éteint."
    if court == "HassLightSet":
        couleur = COULEURS.get(str(args.get("color", "")).lower())
        if couleur:
            return f"C'est fait, la lumière est en {couleur}."
        if "brightness" in args:
            return "C'est fait, j'ai réglé la luminosité."
    return "C'est fait."


def toutes_les_confirmations():
    phrases = {"C'est allumé.", "C'est éteint.", "C'est fait.", "C'est fait, j'ai réglé la luminosité."}
    phrases |= {f"C'est fait, la lumière est en {c}." for c in COULEURS.values()}
    return sorted(phrases | set(PHRASES_VOLUME.values()))


def action_reussie(delta):
    res = delta.get("tool_result")
    if not isinstance(res, dict) or (delta.get("result") or {}).get("error"):
        return False
    if "response_type" in res:  # intentions de Home Assistant
        return res["response_type"] == "action_done" and not (res.get("data") or {}).get("failed")
    return "error" not in res  # scripts


def fichier_voix(phrase):
    v = _voix or {}
    cle = f"{v.get('engine_id')}|{v.get('voice')}|{v.get('language')}|{phrase}"
    return CACHE_VOIX / (hashlib.sha1(cle.encode("utf-8")).hexdigest()[:16] + ".mp3")


def voix_en_cache(phrase):
    if not _voix:
        return None
    f = fichier_voix(phrase)
    return f.read_bytes() if f.exists() else None


def mettre_en_cache(phrase, token=None):
    token = token or TOKEN_FICHIER.read_text(encoding="utf-8-sig").strip()
    try:
        audio = voix_de(token, phrase)  # remplit aussi _voix
        CACHE_VOIX.mkdir(exist_ok=True)
        fichier_voix(phrase).write_bytes(audio)
        return True
    except Exception as e:
        print(f"   cache voix : « {phrase} » impossible ({e})", flush=True)
        return False


def preparer_confirmations(token):
    """Fabrique une seule fois les confirmations qui manquent (elles restent ensuite sur le disque)."""
    try:
        reglages_voix(token)
    except Exception as e:
        print(f"   cache voix : Home Assistant injoignable ({e})", flush=True)
        return
    manquantes = [p for p in toutes_les_confirmations() if not fichier_voix(p).exists()]
    faites = sum(mettre_en_cache(p, token) for p in manquantes)
    print(f"   confirmations immédiates prêtes ({faites} nouvelles, {len(toutes_les_confirmations())} au total)", flush=True)


def parler(token, texte):
    """Fabrique la voix de chaque morceau en parallèle et les joue dans l'ordre dès qu'ils sont prêts."""
    t0 = time.time()
    fin_parole.clear()
    blocs = morceaux(texte)
    with ThreadPoolExecutor(max_workers=3) as pool:
        futurs = [pool.submit(voix_de, token, b) for b in blocs]
        for i, f in enumerate(futurs):
            try:
                a_jouer.put(f.result(timeout=40))
            except Exception as e:
                print(f"   voix : morceau {i + 1} en erreur ({e})", flush=True)
            if i == 0:
                print(f"   première phrase prête en {time.time() - t0:.1f} s ({len(blocs)} morceaux)", flush=True)
    a_jouer.put(None)  # fin de la réponse
    fin_parole.wait(120)


# ------------------------------------------------------- boucle d'écoute
# ------------------------------------------------ actions sur le PC (volume)
VOLUME_ACTIONS = {"niveau", "monter", "baisser", "muet", "son"}  # seules actions autorisées


def regler_volume(action, valeur):
    if action not in VOLUME_ACTIONS:
        print(f"   action de volume refusée : {action!r}", flush=True)
        return
    valeur = max(0, min(100, int(valeur or 10)))
    r = subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                        str(ICI / "volume.ps1"), "-Action", action, "-Valeur", str(valeur)],
                       capture_output=True, text=True, creationflags=0x08000000)  # sans fenêtre
    print(f"   volume : {action} {valeur} -> {r.stdout.strip()}", flush=True)


# ------------------------------------------------ musique (Spotify)
SPOTIFY_LECTEUR = cfg.get("musique", "lecteur", fallback="media_player.ma_chambre_spotify_toosie")
SPOTIFY_APPAREIL = cfg.get("musique", "appareil", fallback=os.environ.get("COMPUTERNAME", "JORIS"))
MUSIQUE_PENDANT_SARAH = cfg.getint("musique", "volume_pendant_sarah", fallback=20)


def volume_musique(pourcent):
    """Baisse / remonte seulement le son de Spotify (pas celui de Sarah), sans bloquer."""
    subprocess.Popen(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(ICI / "musique.ps1"),
                      "-Action", "volume", "-Appli", "spotify", "-Valeur", str(pourcent)],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=0x08000000)


async def service_ha(ws, num, domaine, service, data=None, cible=None):
    await ws.send(json.dumps({"id": num, "type": "call_service", "domain": domaine, "service": service,
                              "service_data": data or {}, **({"target": cible} if cible else {})}))
    while True:
        r = json.loads(await ws.recv())
        if r.get("id") == num:
            return r


async def lancer_spotify(token, uri, genre):
    """Réveille Spotify sur le PC puis lance l'URI (titre, artiste, album ou playlist)."""
    async with websockets.connect(HA_URL.replace("http", "ws", 1) + "/api/websocket", max_size=None) as ws:
        await ws.recv()
        await ws.send(json.dumps({"type": "auth", "access_token": token}))
        await ws.recv()
        cible = {"entity_id": SPOTIFY_LECTEUR}
        await service_ha(ws, 1, "media_player", "select_source", {"source": SPOTIFY_APPAREIL}, cible)
        num = 2
        for _ in range(10):  # attendre que Home Assistant voie Spotify actif sur le PC
            await asyncio.sleep(1.2)
            await service_ha(ws, num, "homeassistant", "update_entity", cible=cible)
            await ws.send(json.dumps({"id": num + 1, "type": "get_states"}))
            while True:
                r = json.loads(await ws.recv())
                if r.get("id") == num + 1:
                    etat = next(x for x in r["result"] if x["entity_id"] == SPOTIFY_LECTEUR)
                    break
            num += 2
            if (etat["attributes"].get("supported_features") or 0) & 512:  # lecture disponible
                break
        r = await service_ha(ws, num, "media_player", "play_media",
                             # titre → liste de titres ; artiste / album / playlist → « contexte » Spotify
                             # (envoyer un artiste comme un titre était ignoré sans erreur)
                             {"media_content_id": uri,
                              "media_content_type": {"artiste": "artist", "album": "album", "playlist": "playlist"}.get(genre, "music")},
                             cible)
        if not r.get("success"):
            raise RuntimeError(r.get("error", {}).get("message", "lecture refusée"))


def jouer_musique(token, recherche, genre):
    t0 = time.time()
    try:
        import spotify_recherche
        uri, desc = spotify_recherche.chercher(recherche, genre)
        asyncio.run(lancer_spotify(token, uri, genre))
        print(f"   musique : {desc} ({uri}) lancée en {time.time() - t0:.1f} s", flush=True)
    except Exception as e:
        print(f"   musique : erreur pour « {recherche} » ({e})", flush=True)
        if lire("mode") == "veille":  # Sarah prévient elle-même si ça n'a pas marché
            changer("parle", texte_sarah="Désolée, je n'ai pas réussi à lancer cette musique.")
            parler(token, "Désolée, je n'ai pas réussi à lancer cette musique.")
            changer("veille")


async def ecouter_commandes_pc(token):
    """Reçoit les commandes envoyées par Home Assistant (événement « sarah_pc_volume »)."""
    ws_url = HA_URL.replace("http", "ws", 1) + "/api/websocket"
    while True:
        try:
            async with websockets.connect(ws_url) as ws:
                await ws.recv()
                await ws.send(json.dumps({"type": "auth", "access_token": token}))
                await ws.recv()
                await ws.send(json.dumps({"id": 1, "type": "subscribe_events", "event_type": "sarah_pc_volume"}))
                await ws.send(json.dumps({"id": 2, "type": "subscribe_events", "event_type": "sarah_musique"}))
                async for brut in ws:
                    msg = json.loads(brut)
                    if msg.get("type") == "event":
                        ev = msg["event"]
                        d = ev.get("data") or {}
                        if ev.get("event_type") == "sarah_musique":
                            threading.Thread(target=jouer_musique, daemon=True,
                                             args=(token, str(d.get("recherche", ""))[:200], str(d.get("type", "titre")))).start()
                        else:
                            await asyncio.to_thread(regler_volume, str(d.get("action", "")), d.get("valeur", 10))
        except Exception as e:  # Home Assistant redémarre, réseau coupé… on réessaie
            print(f"   commandes PC : connexion perdue ({e}), nouvel essai dans 10 s", flush=True)
            await asyncio.sleep(10)


def boucle_ecoute():
    SetLogLevel(-1)
    token = TOKEN_FICHIER.read_text(encoding="utf-8-sig").strip()
    modele = Model(str(next((ICI / "modeles").glob("vosk-model-*"))))
    # Vocabulaire français complet : avec une grammaire limitée à « sarah », Vosk forçait
    # n'importe quelle phrase à ressembler à « sarah » (faux réveils). Ici, « sarah » doit
    # vraiment être reconnu parmi tous les mots français.
    rec = KaldiRecognizer(modele, RATE)
    print(f"Sarah est prête. Dis : « Hey Sarah » (mots surveillés : {MOTS_REVEIL})", flush=True)

    recents = deque(maxlen=12)  # 1,2 s d'audio gardées en mémoire
    bruit = 200.0  # niveau du bruit de fond, mis à jour en continu
    sourd_jusqua = 0.0  # ignore sa propre voix juste après avoir parlé
    conv_id, conv_heure = None, 0.0

    while True:
        bloc = audio_q.get()
        if lire("mode") != "veille":
            continue
        recents.append(bloc)
        n = niveau(bloc)
        if n < bruit * 3:
            bruit = 0.97 * bruit + 0.03 * n
        if time.time() < sourd_jusqua:
            continue
        fini = rec.AcceptWaveform(bloc)
        texte = json.loads(rec.Result() if fini else rec.PartialResult()).get("text" if fini else "partial", "")
        if not any(m in texte.split() for m in MOTS_REVEIL):
            continue
        rec.Reset()
        print(f"   réveillée par : « {texte} »", flush=True)
        # --- réveil ---
        changer("ecoute", texte_moi="", texte_sarah="")
        volume_musique(MUSIQUE_PENDANT_SARAH)  # la musique baisse pendant qu'on se parle
        debut_audio = list(recents)[-8:]  # « Sarah » + le début de la demande
        recents.clear()
        if time.time() - conv_heure > 300:
            conv_id = None
        t0 = time.time()
        try:
            r = asyncio.run(demander_a_home_assistant(token, debut_audio, bruit, conv_id))
        except Exception as e:  # réseau, jeton…
            r = {"moi": "", "sarah": "", "url": None, "erreur": str(e), "conversation_id": None}
        print(f"   réponse prête en {time.time() - t0:.1f} s (bruit de fond {bruit:.0f})", flush=True)
        if r.get("conversation_id"):
            conv_id, conv_heure = r["conversation_id"], time.time()
        if r["erreur"] and not r["sarah"]:
            changer("parle", texte_sarah="Désolée, je n'ai pas réussi : " + str(r["erreur"]))
            time.sleep(4)
        elif r["sarah"]:
            changer("parle", texte_moi=r["moi"], texte_sarah=r["sarah"])
            if r["deja_dit"] and "?" not in r["sarah"]:
                # la confirmation immédiate suffit : on affiche la phrase de Claude sans la répéter
                print(f"   confirmation immédiate : « {r['deja_dit']} »", flush=True)
                a_jouer.put(None)
                fin_parole.wait(30)
            else:
                parler(token, r["sarah"])
        elif r["deja_dit"]:
            a_jouer.put(None)
            fin_parole.wait(30)
        with audio_q.mutex:
            audio_q.queue.clear()  # ne pas s'entendre elle-même
        rec.Reset()
        recents.clear()
        sourd_jusqua = time.time() + 2.0
        changer("veille")
        volume_musique(100)  # la musique remonte


# ------------------------------------------------------------- affichage
def preparer_visage(taille):
    img = pygame.image.load(str(IMAGE)).convert()
    w, h = img.get_size()
    cote = min(w, h)
    img = img.subsurface(((w - cote) // 2, (h - cote) // 2, cote, cote))
    img = pygame.transform.smoothscale(img, (taille, taille)).convert_alpha()
    # masque rond aux bords adoucis
    y, x = np.ogrid[:taille, :taille]
    r = np.sqrt((x - taille / 2) ** 2 + (y - taille / 2) ** 2) / (taille / 2)
    alpha = np.clip((1.0 - r) / 0.12, 0, 1) * 255
    pygame.surfarray.pixels_alpha(img)[:] = alpha.T.astype(np.uint8)
    return img


def halo(taille, couleur, force):
    s = pygame.Surface((taille, taille), pygame.SRCALPHA)
    c = taille // 2
    for i in range(40, 0, -1):
        a = int(force * 6 * (1 - i / 40) ** 1.5)
        pygame.draw.circle(s, (*couleur, a), (c, c), int(c * (0.55 + i / 40 * 0.45)))
    return s


def texte_centre(ecran, police, txt, y, couleur):
    mots, lignes, ligne = txt.split(), [], ""
    for m in mots:
        essai = (ligne + " " + m).strip()
        if police.size(essai)[0] > ecran.get_width() * 0.8:
            lignes.append(ligne)
            ligne = m
        else:
            ligne = essai
    if ligne:
        lignes.append(ligne)
    for i, l in enumerate(lignes[:3]):
        s = police.render(l, True, couleur)
        ecran.blit(s, s.get_rect(center=(ecran.get_width() // 2, y + i * (police.get_height() + 6))))


def main():
    if not TOKEN_FICHIER.exists() or not TOKEN_FICHIER.read_text(encoding="utf-8-sig").strip():
        print("Il manque token.txt : crée un jeton longue durée dans Home Assistant (Profil → Sécurité).")
        sys.exit(1)
    ctypes.windll.user32.SetProcessDPIAware()
    pygame.init()
    pygame.mixer.init()
    info = pygame.display.Info()
    W, H = info.current_w, info.current_h
    ecran = pygame.display.set_mode((W, H), pygame.NOFRAME)
    pygame.display.set_caption("Sarah")
    hwnd = pygame.display.get_wm_info()["window"]
    u32 = ctypes.windll.user32

    def montrer(oui):
        if oui:
            u32.ShowWindow(hwnd, 5)
            u32.SetWindowPos(hwnd, -1, 0, 0, 0, 0, 0x0001 | 0x0002)  # au premier plan
            u32.SetForegroundWindow(hwnd)
        else:
            u32.ShowWindow(hwnd, 0)

    montrer(False)
    taille = int(min(W, H) * 0.62)
    visage = preparer_visage(taille)
    halos = {
        "ecoute": halo(int(taille * 1.5), (60, 160, 255), 1.0),
        "reflexion": halo(int(taille * 1.5), (150, 90, 255), 1.0),
        "parle": halo(int(taille * 1.5), (255, 255, 255), 1.0),
    }
    police = pygame.font.SysFont("segoeui", max(22, H // 32))
    petite = pygame.font.SysFont("segoeui", max(16, H // 48))
    etiquettes = {"ecoute": "Je t'écoute…", "reflexion": "Je réfléchis…", "parle": ""}

    flux = sd.RawInputStream(samplerate=RATE, blocksize=BLOC, channels=1, dtype="int16",
                             device=MICRO, callback=rappel_micro)
    flux.start()
    threading.Thread(target=boucle_ecoute, daemon=True).start()
    jeton = TOKEN_FICHIER.read_text(encoding="utf-8-sig").strip()
    threading.Thread(target=lambda: asyncio.run(ecouter_commandes_pc(jeton)), daemon=True).start()
    threading.Thread(target=preparer_confirmations, args=(jeton,), daemon=True).start()

    horloge = pygame.time.Clock()
    visible = False
    apparition = 0.0
    canal_voix, env, voix_debut = None, None, 0.0
    lisse = 0.0  # niveau lissé pour l'animation
    while True:
        for ev in pygame.event.get():
            if ev.type == pygame.QUIT:
                return
            if ev.type == pygame.KEYDOWN and ev.key == pygame.K_ESCAPE:  # Échap : elle se tait
                pygame.mixer.stop()
                with a_jouer.mutex:
                    a_jouer.queue.clear()
                fin_parole.set()
        libre = canal_voix is None or not canal_voix.get_busy()
        if libre and not a_jouer.empty():  # morceau suivant, seulement quand le précédent est fini
            morceau = a_jouer.get()
            if morceau is None:  # fin de la réponse
                canal_voix = None
                fin_parole.set()
                continue
            son = pygame.mixer.Sound(file=io.BytesIO(morceau))
            # enveloppe de sa voix (volume toutes les 1/30 s) pour animer le visage
            freq, _, canaux = pygame.mixer.get_init()
            ech = pygame.sndarray.array(son).astype(np.float32)
            if ech.ndim > 1:
                ech = ech.mean(axis=1)
            pas = max(1, freq // 30)
            env = np.sqrt(np.add.reduceat(ech ** 2, np.arange(0, len(ech), pas)) / pas)
            env = env / (np.percentile(env, 95) + 1e-6)
            canal_voix = son.play()
            voix_debut = time.time()

        mode = lire("mode")
        if mode != "veille" and not visible:
            visible, apparition = True, time.time()
            montrer(True)
        elif mode == "veille" and visible:
            visible = False
            montrer(False)
        if not visible:
            horloge.tick(15)
            continue

        t = time.time()
        ecran.fill((0, 0, 0))
        # cible d'animation : ma voix quand elle écoute, sa voix quand elle parle
        if mode == "ecoute":
            cible = min(1.0, niveau_micro["v"] / max(niveau_micro["bruit"] * 6, 1500))
        elif mode == "parle" and env is not None and canal_voix is not None:
            i = int((t - voix_debut) * 30)
            cible = float(min(1.0, env[i])) if i < len(env) else 0.0
        elif mode == "reflexion":
            cible = 0.35 + 0.25 * math.sin(t * 5)
        else:
            cible = 0.3
        lisse += (cible - lisse) * (0.6 if cible > lisse else 0.25)
        pulse = 0.25 + 0.75 * lisse
        entree = min(1.0, (t - apparition) / 0.25)
        cx, cy = W // 2, int(H * 0.44)
        echelle = 1.0 + 0.25 * lisse
        h_s = halos.get(mode, halos["ecoute"])
        h_s = pygame.transform.smoothscale(h_s, (int(h_s.get_width() * echelle), int(h_s.get_height() * echelle)))
        h_s.set_alpha(int(255 * pulse * entree))
        ecran.blit(h_s, h_s.get_rect(center=(cx, cy)))
        v = visage
        if mode == "parle" and lisse > 0.05:
            k = 1.0 + 0.03 * lisse
            v = pygame.transform.smoothscale(visage, (int(taille * k), int(taille * k)))
        v = v.copy()
        v.set_alpha(int(255 * entree))
        ecran.blit(v, v.get_rect(center=(cx, cy)))
        if mode == "ecoute":  # petites barres qui suivent ma voix
            for j in range(9):
                hb = int(8 + 70 * lisse * (0.5 + 0.5 * math.sin(t * 12 + j * 0.9)))
                pygame.draw.rect(ecran, (90, 170, 255), (cx - 90 + j * 20, cy + taille // 2 + 10 - hb // 2, 10, hb), border_radius=5)

        y_txt = cy + taille // 2 + H // 20
        if etiquettes.get(mode):
            texte_centre(ecran, petite, etiquettes[mode], y_txt, (140, 170, 220))
            y_txt += petite.get_height() + 10
        moi, elle = lire("texte_moi"), lire("texte_sarah")
        if moi:
            texte_centre(ecran, petite, "« " + moi + " »", y_txt, (150, 150, 150))
            y_txt += petite.get_height() + 14
        if elle and mode == "parle":
            texte_centre(ecran, police, elle, y_txt, (255, 255, 255))
        pygame.display.flip()
        horloge.tick(30)


if __name__ == "__main__":
    main()
