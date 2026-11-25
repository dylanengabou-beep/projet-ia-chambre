"""Sarah — assistante vocale de ma chambre, version bureau.

Toujours à l'écoute : quand je dis « Hey Sarah », son visage apparaît en plein écran,
elle écoute ma demande, Home Assistant (Whisper + Claude + ElevenLabs) exécute l'action,
puis elle répond à voix haute et disparaît.

Configuration : config.ini (adresse de Home Assistant) + token.txt (jeton d'accès, jamais sur GitHub).
"""
import asyncio
import configparser
import ctypes
import io
import json
import math
import queue
import sys
import threading
import time
import urllib.request
from collections import deque
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
        demande = {"id": 1, "type": "assist_pipeline/run", "start_stage": "stt", "end_stage": "tts",
                   "input": {"sample_rate": RATE}, "timeout": 60}
        if PIPELINE:
            demande["pipeline"] = PIPELINE
        if conversation_id:
            demande["conversation_id"] = conversation_id  # garde le fil de la discussion
        await ws.send(json.dumps(demande))

        handler = None
        envoi_fini = asyncio.Event()
        resultat = {"moi": "", "sarah": "", "url": None, "erreur": None, "conversation_id": None}

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
    with urllib.request.urlopen(url, timeout=20) as r:
        return r.read()


# ------------------------------------------------------- boucle d'écoute
def boucle_ecoute():
    SetLogLevel(-1)
    token = TOKEN_FICHIER.read_text(encoding="utf-8-sig").strip()
    modele = Model(str(next((ICI / "modeles").glob("vosk-model-*"))))
    grammaire = json.dumps(MOTS_REVEIL + ["[unk]"], ensure_ascii=False)
    rec = KaldiRecognizer(modele, RATE, grammaire)
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
        if not any(m in texte for m in MOTS_REVEIL if m != "[unk]"):
            continue
        rec.Reset()
        # --- réveil ---
        changer("ecoute", texte_moi="", texte_sarah="")
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
        elif r["url"]:
            changer("parle", texte_moi=r["moi"], texte_sarah=r["sarah"])
            fin_parole.clear()
            t1 = time.time()
            a_jouer.put(telecharger(r["url"]))
            print(f"   voix téléchargée en {time.time() - t1:.1f} s", flush=True)
            fin_parole.wait(60)
        with audio_q.mutex:
            audio_q.queue.clear()  # ne pas s'entendre elle-même
        rec.Reset()
        recents.clear()
        sourd_jusqua = time.time() + 2.0
        changer("veille")


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

    horloge = pygame.time.Clock()
    visible = False
    apparition = 0.0
    canal_voix, env, voix_debut = None, None, 0.0
    lisse = 0.0  # niveau lissé pour l'animation
    while True:
        for ev in pygame.event.get():
            if ev.type == pygame.QUIT:
                return
            if ev.type == pygame.KEYDOWN and ev.key == pygame.K_ESCAPE:
                pygame.mixer.stop()
        if not a_jouer.empty():
            son = pygame.mixer.Sound(file=io.BytesIO(a_jouer.get()))
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
        if lire("mode") == "parle" and canal_voix is not None and not canal_voix.get_busy() and a_jouer.empty():
            canal_voix = None
            fin_parole.set()

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
