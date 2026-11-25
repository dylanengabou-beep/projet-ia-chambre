"""Relais http://localhost:8080 -> Home Assistant sur le réseau de la maison.

Pourquoi : en mode pont, Home Assistant a sa propre adresse (ex. 192.168.2.72),
mais Chrome n'autorise le micro que sur https ou sur "localhost".
Ce relais garde l'adresse http://localhost:8080, donc le micro reste utilisable.

Utilisation : python relais-localhost.py [adresse_HA] [port_HA]
"""
import asyncio
import sys

HA_HOTE = sys.argv[1] if len(sys.argv) > 1 else "192.168.2.72"
HA_PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 80
# IPv4 ET IPv6 : sous Windows, « localhost » est d'abord essayé en IPv6 (::1).
# N'écouter qu'en IPv4 faisait attendre 2 secondes chaque requête avant le repli en IPv4.
ECOUTE = (["127.0.0.1", "::1"], 8080)


async def copier(lecteur, ecrivain):
    try:
        while data := await lecteur.read(65536):
            ecrivain.write(data)
            await ecrivain.drain()
    except (ConnectionError, OSError):
        pass
    finally:
        ecrivain.close()


async def client(lecteur, ecrivain):
    try:
        ha_lecteur, ha_ecrivain = await asyncio.open_connection(HA_HOTE, HA_PORT)
    except OSError:
        ecrivain.close()
        return
    await asyncio.gather(copier(lecteur, ha_ecrivain), copier(ha_lecteur, ecrivain))


async def main():
    serveur = await asyncio.start_server(client, *ECOUTE)
    print(f"Relais actif : http://localhost:{ECOUTE[1]} -> {HA_HOTE}:{HA_PORT}")
    async with serveur:
        await serveur.serve_forever()


asyncio.run(main())
