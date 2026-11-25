"""Envoi de la voix de Sarah vers un HomePod (AirPlay / RAOP) avec pyatv.

Le PC envoie lui-même le son : il sait donc à quel moment l'envoi commence. Le HomePod joue
avec un retard fixe imposé par AirPlay (environ 1,5 s dans pyatv). sarah.py retarde l'animation
du visage d'autant, puis l'ajuste sur le moment où le micro entend vraiment la voix sortir du HomePod.

Test : python homepod.py "HomePod Blue"      (cherche l'appareil, sans rien jouer)
"""
import asyncio
import io
import sys
import threading
import time
import wave

import numpy as np
import pyatv


class HomePod:
    def __init__(self, nom):
        self.nom = nom
        self.boucle = asyncio.new_event_loop()
        threading.Thread(target=self.boucle.run_forever, daemon=True).start()
        self.appareil = None
        self.config = None

    def _executer(self, coro, delai=60):
        return asyncio.run_coroutine_threadsafe(coro, self.boucle).result(delai)

    async def _connecter(self):
        if self.appareil is not None:
            return
        if self.config is None:
            # seulement la partie audio (RAOP) : pas besoin d'appairer la télécommande du HomePod
            trouves = await pyatv.scan(self.boucle, timeout=5, protocol=pyatv.const.Protocol.RAOP)
            self.config = next((a for a in trouves if a.name.lower() == self.nom.lower()), None)
            if self.config is None:
                raise RuntimeError(f"« {self.nom} » introuvable sur le réseau")
        self.appareil = await pyatv.connect(self.config, self.boucle)

    def connecter(self):
        self._executer(self._connecter())

    async def _jouer(self, wav, au_debut):
        await self._connecter()
        try:
            au_debut()  # le flux part maintenant
            await self.appareil.stream.stream_file(io.BytesIO(wav))
        except Exception:
            # connexion perdue (HomePod en veille, Wi-Fi…) : on se reconnecte une fois
            self.appareil.close()
            self.appareil = None
            await self._connecter()
            au_debut()
            await self.appareil.stream.stream_file(io.BytesIO(wav))

    def jouer(self, wav, au_debut=lambda: None, delai=120):
        """Joue un fichier WAV (bytes) sur le HomePod. Bloque jusqu'à la fin de l'envoi."""
        self._executer(self._jouer(wav, au_debut), delai)


def en_wav(echantillons, frequence, canaux):
    """Tableau int16 (n,) ou (n, canaux) → fichier WAV en mémoire."""
    sortie = io.BytesIO()
    with wave.open(sortie, "wb") as w:
        w.setnchannels(canaux)
        w.setsampwidth(2)
        w.setframerate(frequence)
        w.writeframes(np.ascontiguousarray(echantillons, dtype=np.int16).tobytes())
    return sortie.getvalue()


if __name__ == "__main__":
    nom = sys.argv[1] if len(sys.argv) > 1 else "HomePod Blue"
    t0 = time.time()
    hp = HomePod(nom)
    hp.connecter()
    print(f"connecté à {hp.config.name} ({hp.config.address}) en {time.time() - t0:.1f} s — rien n'a été joué")
