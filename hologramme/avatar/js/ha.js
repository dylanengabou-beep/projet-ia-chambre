// Connexion à l'API WebSocket de Home Assistant (jeton longue durée dans ../config.json).
// Événements suivis :
//   « sarah_etat »      { etat: veille|ecoute|pense|parle, enveloppe?: [volumes 30/s], debut?: ms }  — envoyés par sarah.py
//   « sarah_animation » { animation: saluer|danser|applaudir }                                  — script HA « Sarah : animation »
// Reconnexion automatique (1 s, 2 s, 4 s… max 15 s) et petit indicateur si la connexion est perdue.

export function connecterHA({ surEtat, surAnimation }) {
  const indicateur = document.getElementById("connexion");
  const texte = indicateur.querySelector("span");
  let essai = 0;

  async function connecter() {
    let cfg;
    try { cfg = await (await fetch("../config.json", { cache: "no-store" })).json(); }
    catch { indicateur.style.display = "flex"; texte.textContent = "config.json manquant"; return; }
    const ws = new WebSocket(cfg.ha_url.replace(/^http/, "ws").replace(/\/$/, "") + "/api/websocket");
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.type === "auth_required") ws.send(JSON.stringify({ type: "auth", access_token: cfg.token }));
      else if (msg.type === "auth_invalid") { texte.textContent = "jeton refusé"; ws.close(); }
      else if (msg.type === "auth_ok") {
        essai = 0; indicateur.style.display = "none";
        ws.send(JSON.stringify({ id: 1, type: "subscribe_events", event_type: "sarah_etat" }));
        ws.send(JSON.stringify({ id: 2, type: "subscribe_events", event_type: "sarah_animation" }));
      } else if (msg.type === "event") {
        const d = msg.event.data || {};
        if (msg.event.event_type === "sarah_etat") surEtat(d);
        else if (msg.event.event_type === "sarah_animation") surAnimation(d.animation);
      }
    };
    ws.onclose = () => {
      indicateur.style.display = "flex";
      if (texte.textContent !== "jeton refusé") texte.textContent = "Home Assistant déconnecté";
      setTimeout(connecter, Math.min(15000, 1000 * 2 ** essai++));
    };
    ws.onerror = () => ws.close();
  }
  connecter();
}
