"""Recherche Spotify (API Web, identifiants de l'app développeur dans spotify.txt).

Utilisé par sarah.py pour trouver le lien Spotify (URI) d'un titre, d'un artiste, d'un album ou d'une playlist.
Test : python spotify_recherche.py "Tiakola Meuda" titre
"""
import base64
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ICI = Path(__file__).resolve().parent
_jeton = {"valeur": None, "expire": 0.0}
TYPES = {"titre": "track", "artiste": "artist", "album": "album", "playlist": "playlist"}


def _identifiants():
    vals = {}
    for ligne in (ICI / "spotify.txt").read_text(encoding="utf-8-sig").splitlines():
        cle, _, val = ligne.partition("=")
        vals[cle.strip()] = val.strip()
    if not vals.get("client_id") or not vals.get("client_secret"):
        raise RuntimeError("spotify.txt incomplet (client_id / client_secret)")
    return vals["client_id"], vals["client_secret"]


def jeton():
    """Jeton « client credentials » (recherche seulement, pas d'accès au compte)."""
    if _jeton["valeur"] and time.time() < _jeton["expire"] - 60:
        return _jeton["valeur"]
    cid, secret = _identifiants()
    req = urllib.request.Request(
        "https://accounts.spotify.com/api/token", method="POST",
        data=urllib.parse.urlencode({"grant_type": "client_credentials"}).encode(),
        headers={"Authorization": "Basic " + base64.b64encode(f"{cid}:{secret}".encode()).decode(),
                 "Content-Type": "application/x-www-form-urlencoded"})
    r = json.loads(urllib.request.urlopen(req, timeout=15).read())
    _jeton.update(valeur=r["access_token"], expire=time.time() + r.get("expires_in", 3600))
    return _jeton["valeur"]


def chercher(texte, genre="titre"):
    """Renvoie (uri, description) du meilleur résultat, ou lève une erreur."""
    t = TYPES.get(genre, "track")
    url = "https://api.spotify.com/v1/search?" + urllib.parse.urlencode(
        {"q": texte, "type": t, "limit": 10, "market": "CA"})  # 10 : Spotify renvoie parfois des cases vides
    r = json.loads(urllib.request.urlopen(
        urllib.request.Request(url, headers={"Authorization": "Bearer " + jeton()}), timeout=15).read())
    items = [x for x in (r.get(t + "s") or {}).get("items", []) if x]
    if not items:
        raise RuntimeError(f"rien trouvé sur Spotify pour « {texte} »")
    x = items[0]
    if t == "track":
        desc = f"{x['name']} de {', '.join(a['name'] for a in x['artists'])}"
    elif t == "album":
        desc = f"l'album {x['name']} de {', '.join(a['name'] for a in x['artists'])}"
    elif t == "playlist":
        desc = f"la playlist {x['name']}"
    else:
        desc = x["name"]
    return x["uri"], desc


if __name__ == "__main__":
    t0 = time.time()
    print(chercher(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "titre"), f"({time.time() - t0:.1f} s)")
