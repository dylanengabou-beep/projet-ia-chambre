"""Petit serveur local pour l'hologramme : http://127.0.0.1:8770 (accessible seulement depuis ce PC)."""
import functools
import http.server
from pathlib import Path

ICI = Path(__file__).resolve().parent
PORT = 8770


class SansCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")  # toujours la dernière version des fichiers
        super().end_headers()

    def log_message(self, *args):
        pass  # pas de journal à chaque fichier servi


if __name__ == "__main__":
    serveur = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), functools.partial(SansCache, directory=str(ICI)))
    print(f"Hologramme servi sur http://127.0.0.1:{PORT}", flush=True)
    serveur.serve_forever()
