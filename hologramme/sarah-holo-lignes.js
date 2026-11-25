// Hologramme de Sarah : son visage (à partir de sa photo) découpé en lignes lumineuses horizontales,
// qui se rassemblent ou se dispersent en particules selon son état.
import * as THREE from "three";

// ------------------------------------------------------------------ réglages
const LIGNES = 150;          // nombre de lignes horizontales
const POINTS_PAR_LIGNE = 260; // finesse de chaque ligne
const IMAGE = "./visage.jpg";

// ------------------------------------------------------------------ scène
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.1, 50);
camera.position.set(0, 0.05, 3.4);
const rendu = new THREE.WebGLRenderer({ antialias: true });
rendu.setPixelRatio(Math.min(devicePixelRatio, 2));
rendu.setSize(innerWidth, innerHeight);
rendu.setClearColor(0x000000, 1);
document.body.appendChild(rendu.domElement);
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  rendu.setSize(innerWidth, innerHeight);
});
const tete = new THREE.Group();
scene.add(tete);

// ------------------------------------------------------------------ photo → relief
function chargerImage(url) {
  return new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = url; });
}

function analyserPhoto(img) {
  const L = 240, H = 240;
  const c = document.createElement("canvas");
  c.width = L; c.height = H;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  // recadrage carré centré
  const cote = Math.min(img.width, img.height);
  ctx.drawImage(img, (img.width - cote) / 2, (img.height - cote) / 2, cote, cote, 0, 0, L, H);
  const px = ctx.getImageData(0, 0, L, H).data;
  const lum = new Float32Array(L * H);
  for (let i = 0; i < L * H; i++) lum[i] = (px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11) / 255;
  // couleur du fond = moyenne des bords du haut
  let fond = 0, n = 0;
  for (let x = 0; x < L; x++) for (let y = 0; y < 6; y++) { fond += lum[y * L + x]; n++; }
  fond /= n;
  // masque : ce qui s'écarte du fond, rempli ligne par ligne entre le premier et le dernier point de Sarah
  const masque = new Uint8Array(L * H);
  for (let y = 0; y < H; y++) {
    let g = -1, d = -1;
    for (let x = 0; x < L; x++) if (Math.abs(lum[y * L + x] - fond) > 0.12) { if (g < 0) g = x; d = x; }
    if (g >= 0 && d - g > 3) for (let x = g; x <= d; x++) masque[y * L + x] = 1;
  }
  // flou de la luminance (relief doux)
  const flou = new Float32Array(L * H);
  const R = 4;
  for (let y = 0; y < H; y++) for (let x = 0; x < L; x++) {
    let s = 0, k = 0;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const xx = Math.min(L - 1, Math.max(0, x + dx)), yy = Math.min(H - 1, Math.max(0, y + dy));
      s += lum[yy * L + xx]; k++;
    }
    flou[y * L + x] = s / k;
  }
  return { L, H, lum, flou, masque };
}

// ------------------------------------------------------------------ géométrie : lignes + particules
function construire(p) {
  const { L, H, lum, flou, masque } = p;
  const pos = [], disp = [], alea = [], lumi = [], ligne = [], detache = [];
  const segA = [], segB = [];
  let index = 0;
  for (let j = 0; j < LIGNES; j++) {
    const y = Math.floor((j + 0.5) * H / LIGNES);
    let precedent = -1;
    for (let i = 0; i < POINTS_PAR_LIGNE; i++) {
      const x = Math.floor((i + 0.5) * L / POINTS_PAR_LIGNE);
      const m = masque[y * L + x];
      if (!m) { precedent = -1; continue; }
      // coordonnées : largeur ~1.6, centrées
      const X = (x / L - 0.5) * 1.6, Y = (0.5 - y / H) * 1.6;
      // relief : un ovale (volume de la tête) + les détails donnés par la lumière de la photo
      const ov = Math.max(0, 1 - Math.pow((x / L - 0.5) / 0.32, 2));
      const Z = 0.30 * Math.sqrt(ov) + 0.025 * (flou[y * L + x] - 0.35);
      pos.push(X, Y, Z);
      // position dispersée : nuage autour, décalé vers la droite et le bas (comme le corps qui se défait)
      const a = Math.random() * Math.PI * 2, r = 0.6 + Math.random() * 1.4;
      disp.push(X + Math.cos(a) * r * 0.9 + 0.25, Y + Math.sin(a) * r * 0.7 - 0.2, Z + (Math.random() - 0.5) * 1.2);
      alea.push(Math.random());
      // éclat de la ligne : fort sur les reliefs (front, nez, joues, cou) et sur les bords de la silhouette
      const gx = flou[y * L + Math.min(L - 1, x + 2)] - flou[y * L + Math.max(0, x - 2)];
      const gy = flou[Math.min(H - 1, y + 2) * L + x] - flou[Math.max(0, y - 2) * L + x];
      const bordSilhouette = (!masque[y * L + Math.max(0, x - 3)] || !masque[y * L + Math.min(L - 1, x + 3)]) ? 1 : 0;
      const eclat = Math.min(1, 0.06 + 1.5 * Math.pow(lum[y * L + x], 1.6) + 1.5 * Math.hypot(gx, gy) + 0.5 * bordSilhouette);
      lumi.push(eclat);
      ligne.push(j / LIGNES);
      // en bas à droite, une partie des points se détache de sa ligne et part en poussière (comme sur l'image)
      const zone = Math.max(0, (j / LIGNES - 0.5) / 0.5) * Math.max(0, (x / L - 0.35) / 0.65);
      const d = Math.random() < zone * 0.9 ? 1 : 0;
      detache.push(d);
      if (precedent >= 0 && !d) { segA.push(precedent); segB.push(index); }
      precedent = d ? -1 : index;
      index++;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aDisp", new THREE.Float32BufferAttribute(disp, 3));
  g.setAttribute("aAlea", new THREE.Float32BufferAttribute(alea, 1));
  g.setAttribute("aLum", new THREE.Float32BufferAttribute(lumi, 1));
  g.setAttribute("aLigne", new THREE.Float32BufferAttribute(ligne, 1));
  g.setAttribute("aDetache", new THREE.Float32BufferAttribute(detache, 1));
  const indices = [];
  for (let k = 0; k < segA.length; k++) indices.push(segA[k], segB[k]);
  const gl = g.clone();
  gl.setIndex(indices);
  return { points: g, lignes: gl };
}

// ------------------------------------------------------------------ shaders
const uniformes = {
  uTemps: { value: 0 },
  uForme: { value: 0 },      // 0 = nuage, 1 = visage formé
  uVoix: { value: 0 },       // volume de sa voix (0..1)
  uPense: { value: 0 },      // vague lumineuse quand elle réfléchit
  uEcoute: { value: 0 },
  uTaille: { value: rendu.getPixelRatio() },
};

const vertexCommun = /* glsl */`
  attribute vec3 aDisp; attribute float aAlea; attribute float aLum; attribute float aLigne; attribute float aDetache;
  uniform float uTemps, uForme, uVoix, uPense, uEcoute, uTaille;
  varying float vAlpha; varying float vLum; varying float vF;
  vec3 calcul() {
    // chaque point rejoint le visage à son rythme
    float f = smoothstep(aAlea * 0.45, aAlea * 0.45 + 0.55, uForme);
    vF = f;
    vec3 p = mix(aDisp, position, f);
    // dérive douce du nuage
    p += 0.03 * vec3(sin(uTemps * 0.7 + aAlea * 40.0), cos(uTemps * 0.5 + aAlea * 30.0), sin(uTemps * 0.6 + aAlea * 20.0)) * (1.0 - f);
    // le corps se défait en bas à droite, même formé (comme sur l'image)
    // les points détachés dérivent lentement vers la droite et le bas, puis reviennent (boucle douce)
    float cycle = fract(uTemps * 0.06 + aAlea * 7.0);
    p += vec3(0.45, -0.18, 0.12) * aDetache * cycle * (0.4 + aAlea);
    // la voix fait onduler les lignes, surtout autour de la bouche
    float bouche = exp(-pow((position.y + 0.05) / 0.18, 2.0)) * exp(-pow(position.x / 0.3, 2.0));
    p.z += uVoix * (0.02 + 0.05 * bouche) * sin(aLigne * 90.0 - uTemps * 12.0);
    // en écoute, une légère respiration
    p *= 1.0 + uEcoute * 0.008 * sin(uTemps * 3.0);
    vLum = aLum;
    float vague = uPense * exp(-pow((aLigne - fract(uTemps * 0.35)) * 12.0, 2.0));
    vAlpha = f * (0.55 + 0.45 * aLum) * (1.0 - aDetache * cycle * 0.8) + vague * 0.8 + uVoix * 0.25 * bouche
             + aDetache * f * 0.9;   // la poussière brille un peu plus
    return p;
  }
`;

const matLignes = new THREE.ShaderMaterial({
  uniforms: uniformes, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  vertexShader: vertexCommun + `void main(){ vec3 p = calcul(); gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0); }`,
  fragmentShader: `uniform float uForme; varying float vAlpha; varying float vLum; varying float vF;
    // un morceau de ligne n'apparaît que quand ses deux points sont arrivés (sinon : gribouillis)
    void main(){ float a = vAlpha * smoothstep(0.93, 1.0, vF) * (0.35 + 0.9 * vLum * vLum);
      gl_FragColor = vec4(vec3(0.82, 0.92, 1.0) * (0.7 + 0.8 * vLum), a); }`,
});

const matPoints = new THREE.ShaderMaterial({
  uniforms: uniformes, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  vertexShader: vertexCommun + `void main(){ vec3 p = calcul();
      vec4 mv = modelViewMatrix * vec4(p,1.0); gl_Position = projectionMatrix * mv;
      gl_PointSize = uTaille * (1.6 + 3.0 * step(0.93, aAlea)) * (3.4 / -mv.z); }`,
  fragmentShader: `uniform float uTemps, uForme; varying float vAlpha; varying float vLum; varying float vF;
    void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c); if (d > 0.5) discard;
      float nuage = 0.10 * (1.0 - uForme);   // en veille : presque invisible
      float a = (vAlpha * 0.35 * vLum + nuage) * (1.0 - d * 2.0);
      gl_FragColor = vec4(vec3(0.85, 0.95, 1.0) * (0.7 + 0.5 * vLum), a); }`,
});

// ------------------------------------------------------------------ états
const ETATS = ["veille", "ecoute", "pense", "parle"];
let etat = "veille";
let cibleForme = 0, voixSimulee = false, enveloppe = null, debutVoix = 0, minuteurVeille = null;

function changerEtat(nouvel, donnees = {}) {
  if (!ETATS.includes(nouvel)) return;
  clearTimeout(minuteurVeille);
  if (nouvel === "veille" && etat !== "veille") {
    // après la réponse, elle reste visible ~4 s avant de se défaire
    minuteurVeille = setTimeout(() => appliquer("veille", {}), donnees.immediat ? 0 : 4000);
    appliquer("apres", {});
    return;
  }
  appliquer(nouvel, donnees);
}

function appliquer(nouvel, donnees) {
  etat = nouvel === "apres" ? "apres" : nouvel;
  cibleForme = nouvel === "veille" ? 0 : 1;
  if (nouvel === "parle") {
    if (donnees.enveloppe && donnees.enveloppe.length) {
      enveloppe = donnees.enveloppe;                       // vraie voix : courbe de volume envoyée par sarah.py
      debutVoix = donnees.debut ? donnees.debut : Date.now();
      voixSimulee = false;
    } else if (!enveloppe) {
      voixSimulee = true;                                  // pas de courbe : animation simulée
    }
  } else {
    enveloppe = null; voixSimulee = false;
  }
  document.querySelectorAll("#debug button").forEach(b => b.classList.toggle("actif", b.dataset.etat === nouvel));
  window.dispatchEvent(new CustomEvent("sarah-etat", { detail: nouvel }));
}

function niveauVoix(t) {
  if (etat !== "parle") return 0;
  if (enveloppe) {
    const i = Math.floor((Date.now() - debutVoix) / 1000 * 30);
    return i >= 0 && i < enveloppe.length ? Math.min(1, enveloppe[i]) : 0;
  }
  if (voixSimulee) return 0.5 + 0.5 * Math.abs(Math.sin(t * 9.0) * Math.sin(t * 3.7));
  return 0;
}

// ------------------------------------------------------------------ boucle
let forme = 0, voix = 0, pense = 0, ecoute = 0;
const horloge = new THREE.Clock();
function boucle() {
  requestAnimationFrame(boucle);
  const dt = Math.min(0.05, horloge.getDelta()), t = horloge.elapsedTime;
  // rassemblement rapide à l'appel, dispersion plus lente
  forme += (cibleForme - forme) * (cibleForme > forme ? 1.8 : 0.9) * dt;
  const v = niveauVoix(t);
  voix += (v - voix) * (v > voix ? 0.6 : 0.25);
  pense += ((etat === "pense" ? 1 : 0) - pense) * 2.0 * dt;
  ecoute += ((etat === "ecoute" ? 1 : 0) - ecoute) * 2.0 * dt;
  Object.assign(uniformes, {});
  uniformes.uTemps.value = t; uniformes.uForme.value = forme; uniformes.uVoix.value = voix;
  uniformes.uPense.value = pense; uniformes.uEcoute.value = ecoute;
  // la tête flotte et regarde légèrement vers le haut, comme sur l'image
  tete.rotation.y = -0.12 + 0.06 * Math.sin(t * 0.25);
  tete.rotation.x = -0.06 + 0.02 * Math.sin(t * 0.33);
  tete.position.y = 0.02 * Math.sin(t * 0.6);
  rendu.render(scene, camera);
}

// ------------------------------------------------------------------ démarrage
(async () => {
  const img = await chargerImage(IMAGE);
  const geo = construire(analyserPhoto(img));
  tete.add(new THREE.LineSegments(geo.lignes, matLignes));
  tete.add(new THREE.Points(geo.points, matPoints));
  window.sarah = { changerEtat, get etat() { return etat; }, get forme() { return forme; } };
  boucle();
})();

// ------------------------------------------------------------------ connexion à Home Assistant
// Écoute les événements « sarah_etat » envoyés par sarah.py : { etat, enveloppe?, debut? }
const indicateur = document.getElementById("connexion");
let essai = 0;

async function lireConfig() {
  const r = await fetch("./config.json", { cache: "no-store" });
  if (!r.ok) throw new Error("config.json introuvable");
  return r.json();
}

async function connecter() {
  let cfg;
  try { cfg = await lireConfig(); }
  catch (e) { indicateur.style.display = "flex"; indicateur.querySelector("span").textContent = "config.json manquant"; return; }
  const url = cfg.ha_url.replace(/^http/, "ws").replace(/\/$/, "") + "/api/websocket";
  const ws = new WebSocket(url);
  let idCommande = 1;
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.type === "auth_required") ws.send(JSON.stringify({ type: "auth", access_token: cfg.token }));
    else if (msg.type === "auth_invalid") { indicateur.querySelector("span").textContent = "jeton refusé"; ws.close(); }
    else if (msg.type === "auth_ok") {
      essai = 0;
      indicateur.style.display = "none";
      ws.send(JSON.stringify({ id: idCommande++, type: "subscribe_events", event_type: "sarah_etat" }));
    } else if (msg.type === "event" && msg.event.event_type === "sarah_etat") {
      const d = msg.event.data || {};
      changerEtat(d.etat, d);
    }
  };
  ws.onclose = () => {
    // Home Assistant redémarre ou réseau coupé : petit indicateur et nouvel essai (1 s, 2 s, 4 s… max 15 s)
    indicateur.style.display = "flex";
    if (indicateur.querySelector("span").textContent !== "jeton refusé")
      indicateur.querySelector("span").textContent = "Home Assistant déconnecté";
    setTimeout(connecter, Math.min(15000, 1000 * 2 ** essai++));
  };
  ws.onerror = () => ws.close();
}
connecter();

// ------------------------------------------------------------------ mode debug (touche D)
addEventListener("keydown", e => { if (e.key === "d" || e.key === "D") document.body.classList.toggle("debug"); });
document.querySelectorAll("#debug button").forEach(b => b.addEventListener("click", () => changerEtat(b.dataset.etat, { immediat: true })));

export { changerEtat };
