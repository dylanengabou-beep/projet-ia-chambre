// Hologramme de Sarah — V4 : l'image de référence (tete.jpg) telle quelle, rendue vivante.
// L'image n'est pas redessinée : un shader la déforme et l'éclaire en temps réel.
//   - la bouche s'ouvre au rythme de la voix (la lèvre inférieure et le menton descendent)
//   - la tête bouge doucement autour du cou (respiration, se lève quand elle écoute, se baisse quand elle réfléchit)
//   - une lumière parcourt les lignes du crâne et du cou ; les points scintillent
//   - des particules s'échappent de la nuque, comme sur l'image, et fuient la souris
import * as THREE from "three";

const IMAGE = "./tete.jpg";
const L = 735, H = 1105;                 // taille de l'image en pixels
const RATIO = L / H;

// ------------------------------------------------------------------ scène 2D : l'image remplit la hauteur de l'écran
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
const rendu = new THREE.WebGLRenderer({ antialias: true });
rendu.setPixelRatio(Math.min(devicePixelRatio, 2));
document.body.appendChild(rendu.domElement);
function redimensionner() {
  const a = innerWidth / innerHeight;
  camera.left = -a; camera.right = a; camera.top = 1; camera.bottom = -1; camera.updateProjectionMatrix();
  rendu.setSize(innerWidth, innerHeight);
}
redimensionner();
addEventListener("resize", redimensionner);
// pixel de l'image → coordonnées de la scène
const versScene = (x, y) => new THREE.Vector2((x / L - 0.5) * 2 * RATIO, (0.5 - y / H) * 2);

// ------------------------------------------------------------------ uniformes
const uniformes = {
  uImage: { value: null }, uTemps: { value: 0 },
  uBouche: { value: 0 },                 // ouverture de la bouche (0..1)
  uTete: { value: 0 }, uTeteY: { value: 0 },   // rotation de la tête autour du cou, et légère élévation
  uLueur: { value: 1 },                  // luminosité générale selon l'état
  uBalayage: { value: 0.3 },             // vitesse de la lumière qui parcourt les lignes
  uPense: { value: 0 },
  uSouris: { value: new THREE.Vector2(-9, -9) },   // en pixels de l'image
};

// ------------------------------------------------------------------ l'image animée
const matImage = new THREE.ShaderMaterial({
  uniforms: uniformes, transparent: false,
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D uImage; uniform float uTemps, uBouche, uTete, uTeteY, uLueur, uBalayage, uPense; uniform vec2 uSouris;
    varying vec2 vUv;
    const vec2 TAILLE = vec2(${L}.0, ${H}.0);
    const vec2 COU = vec2(380.0, 760.0);
    vec2 tourne(vec2 v, float a){ float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
    float hasard(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 p = vec2(vUv.x, 1.0 - vUv.y) * TAILLE;       // pixel de l'écran, en pixels de l'image
      vec2 q = p;                                         // pixel de l'image a afficher ici

      // tete : tourne autour du cou (le bas du cou et les epaules restent fixes)
      float wTete = smoothstep(980.0, 600.0, p.y);         // transition longue : le cou se plie sans cassure
      q = COU + tourne(q - COU, -uTete * wTete);
      q.y += uTeteY * wTete;

      // bouche : ouverture douce, plus grande au centre qu'aux coins (forme d'amande), sans coupure nette.
      // La levre inferieure et le menton descendent ensemble, la transition est progressive.
      float ouverture = uBouche * 11.0;
      float ligne = 427.0 + (q.x - 165.0) * 0.06;          // ligne entre les levres (legerement inclinee)
      float dessous = q.y - ligne;
      float amande = smoothstep(150.0, 200.0, q.x) * smoothstep(262.0, 212.0, q.x);   // 0 aux coins, 1 au centre
      float profil = 0.25 + 0.75 * amande;
      float wBas = smoothstep(-3.0, 6.0, dessous) * smoothstep(130.0, 40.0, dessous) * smoothstep(340.0, 250.0, q.x);
      float wHaut = smoothstep(-22.0, -2.0, dessous) * (1.0 - smoothstep(-2.0, 2.0, dessous));
      q.y -= ouverture * profil * wBas;                     // levre inferieure + menton descendent
      q.y += ouverture * 0.18 * amande * wHaut;             // la levre superieure remonte a peine

      vec3 c = texture2D(uImage, clamp(vec2(q.x, TAILLE.y - q.y) / TAILLE, 0.001, 0.999)).rgb;
      // interieur de la bouche : ombre douce en amande entre les levres
      float h = ouverture * amande;
      float interieur = amande * smoothstep(-1.5, 1.5, dessous) * (1.0 - smoothstep(h * 0.35, h * 0.9 + 0.5, dessous)) * smoothstep(0.5, 3.0, ouverture);
      c *= 1.0 - 0.9 * interieur;
      float lum = dot(c, vec3(0.299, 0.587, 0.114));

      // lumiere qui parcourt les lignes fines (crane et cou) : seulement sur les traits clairs
      float trait = smoothstep(0.35, 0.8, lum);
      float onde = 0.5 + 0.5 * sin((q.x * 0.6 + q.y * 1.0) * 0.012 - uTemps * (1.5 + uBalayage * 5.0));
      onde = pow(onde, 6.0);
      c += vec3(0.85, 0.92, 1.0) * trait * onde * (0.35 + uPense * 0.6);

      // points de la dispersion (a droite) : scintillent
      float zone = smoothstep(420.0, 520.0, q.x) * smoothstep(250.0, 380.0, q.y);
      float s = hasard(floor(q / 3.0));
      c *= 1.0 + zone * trait * (0.6 * sin(uTemps * (2.0 + s * 6.0) + s * 40.0));

      // la souris eclaire doucement la ou elle passe
      float d = length(q - uSouris);
      c += vec3(0.7, 0.85, 1.0) * trait * exp(-d * d / 9000.0) * 0.5;

      gl_FragColor = vec4(c * uLueur, 1.0);
    }`,
});
const plan = new THREE.Mesh(new THREE.PlaneGeometry(2 * RATIO, 2), matImage);
scene.add(plan);

// ------------------------------------------------------------------ particules qui s'échappent de la nuque (comme sur l'image)
const N = 520;
const pos = new Float32Array(N * 3), vit = new Float32Array(N * 2), vie = new Float32Array(N), taille = new Float32Array(N);
const geoP = new THREE.BufferGeometry();
geoP.setAttribute("position", new THREE.BufferAttribute(pos, 3));
geoP.setAttribute("aVie", new THREE.BufferAttribute(vie, 1));
geoP.setAttribute("aTaille", new THREE.BufferAttribute(taille, 1));
const matP = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { uPixel: { value: 1 }, uLueur: uniformes.uLueur },
  vertexShader: `attribute float aVie, aTaille; uniform float uPixel; varying float vVie;
    void main(){ vVie = aVie; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = aTaille * uPixel; }`,
  // petits traits horizontaux, comme les éclats de l'image
  fragmentShader: `uniform float uLueur; varying float vVie;
    void main(){ vec2 d = abs(gl_PointCoord - 0.5); if (d.y > 0.12 || d.x > 0.5) discard;
      float a = smoothstep(0.0, 0.3, vVie) * (1.0 - d.x * 1.6);
      gl_FragColor = vec4(vec3(1.0) * a * uLueur, a); }`,
});
const nuage = new THREE.Points(geoP, matP); nuage.frustumCulled = false; nuage.position.z = 0.1;
scene.add(nuage);
// zone d'émission : arrière de la tête, nuque et cou (pixels de l'image)
function emettre(i) {
  const k = Math.random();
  const x = 480 + Math.random() * 110, y = 400 + k * 440;
  const s = versScene(x - (y > 600 ? (y - 600) * 0.35 : 0), y);
  pos[i * 3] = s.x; pos[i * 3 + 1] = s.y; pos[i * 3 + 2] = 0;
  vit[i * 2] = 0.03 + Math.random() * 0.07; vit[i * 2 + 1] = (Math.random() - 0.6) * 0.03;
  vie[i] = 0.4 + Math.random() * 0.6; taille[i] = 1.5 + Math.random() * 4.5;
}
for (let i = 0; i < N; i++) { emettre(i); vie[i] *= Math.random(); }

// ------------------------------------------------------------------ états (venant de sarah.py par Home Assistant)
const ETATS = ["veille", "ecoute", "pense", "parle"];
let etat = "veille", enveloppe = null, debutVoix = 0, voixSimulee = false, minuteur = null;
function changerEtat(nouvel, donnees = {}) {
  if (!ETATS.includes(nouvel)) return;
  clearTimeout(minuteur);
  if (nouvel === "veille" && etat !== "veille") {   // elle reste attentive ~4 s après sa réponse
    etat = "apres";
    minuteur = setTimeout(() => { etat = "veille"; majBoutons("veille"); }, donnees.immediat ? 0 : 4000);
    return;
  }
  etat = nouvel;
  if (nouvel === "parle") {
    if (donnees.enveloppe && donnees.enveloppe.length) { enveloppe = donnees.enveloppe; debutVoix = donnees.debut || Date.now(); voixSimulee = false; }
    else if (!enveloppe) voixSimulee = true;
  } else { enveloppe = null; voixSimulee = false; }
  majBoutons(nouvel);
}
function niveauVoix(t) {
  if (etat !== "parle") return 0;
  if (enveloppe) { const i = Math.floor((Date.now() - debutVoix) / 1000 * 30); return i >= 0 && i < enveloppe.length ? Math.min(1, enveloppe[i]) : 0; }
  if (voixSimulee) return Math.max(0, Math.sin(t * 11) * Math.sin(t * 3.3) * 0.9 + 0.15);
  return 0;
}

// ------------------------------------------------------------------ souris
const souris = new THREE.Vector2(-9, -9);   // coordonnées de la scène
let derniereSouris = -99;
const horloge = new THREE.Clock();
addEventListener("pointermove", (e) => {
  const a = innerWidth / innerHeight;
  souris.set(((e.clientX / innerWidth) * 2 - 1) * a, -(e.clientY / innerHeight) * 2 + 1);
  derniereSouris = horloge.elapsedTime;
});
addEventListener("pointerleave", () => souris.set(-9, -9));

// ------------------------------------------------------------------ boucle
const DEVANT = -0.26;   // rotation de la tete pour regarder droit devant (radians)
let voix = 0, tete = 0, teteY = 0, lueur = 0, pense = 0;   // en veille elle est invisible : elle apparaît quand on l appelle
function boucle() {
  requestAnimationFrame(boucle);
  const dt = Math.min(0.05, horloge.getDelta()), t = horloge.elapsedTime;
  const v = niveauVoix(t);
  voix += (v - voix) * Math.min(1, dt * (v > voix ? 30 : 14));

  // tête : respiration lente ; se lève quand elle écoute ; se baisse quand elle réfléchit ; petits hochements en parlant
  let cible = Math.sin(t * 0.45) * 0.012 + Math.sin(t * 0.21) * 0.008, cibleY = Math.sin(t * 0.9) * 2;
  // quand on l'appelle, elle baisse le menton et regarde droit devant elle (vers toi)
  if (etat !== "veille" || document.body.classList.contains("debug")) cible += DEVANT;
  if (etat === "pense") cible += 0.025;
  if (etat === "parle") cible += voix * 0.012 * Math.sin(t * 5.5);
  tete += (cible - tete) * Math.min(1, dt * 2.5); teteY += (cibleY - teteY) * Math.min(1, dt * 2);
  pense += ((etat === "pense" ? 1 : 0) - pense) * Math.min(1, dt * 2);
  const cibleL = { veille: (document.body.classList.contains("debug") ? 0.95 : 0), ecoute: 1.15, pense: 1.05, parle: 1.08, apres: 1.08 }[etat] + voix * 0.12;
  lueur += (cibleL - lueur) * Math.min(1, dt * 2.5);

  uniformes.uTemps.value = t; uniformes.uBouche.value = Math.min(1, voix * 1.3);
  uniformes.uTete.value = tete; uniformes.uTeteY.value = teteY; uniformes.uLueur.value = lueur; uniformes.uPense.value = pense;
  uniformes.uBalayage.value = etat === "pense" ? 1 : etat === "parle" ? 0.5 + voix : 0.2;
  const actif = t - derniereSouris < 3;
  uniformes.uSouris.value.set(actif ? (souris.x / (2 * RATIO) + 0.5) * L : -999, actif ? (0.5 - souris.y / 2) * H : -999);

  // particules : dérivent vers la droite ; plus vite et plus nombreuses quand elle parle ou réfléchit ; fuient la souris
  matP.uniforms.uPixel.value = rendu.getPixelRatio() * innerHeight / 1100;
  const vitesse = 0.6 + voix * 1.5 + pense * 0.8 + (etat === "ecoute" ? 0.4 : 0);
  for (let i = 0; i < N; i++) {
    vie[i] -= dt * 0.18 * vitesse;
    if (vie[i] <= 0) { emettre(i); continue; }
    let x = pos[i * 3], y = pos[i * 3 + 1];
    x += vit[i * 2] * dt * vitesse; y += vit[i * 2 + 1] * dt * vitesse + (pense ? Math.sin(t * 2 + i) * 0.01 * pense * dt * 10 : 0);
    if (actif) {
      const dx = x - souris.x, dy = y - souris.y, d2 = dx * dx + dy * dy;
      if (d2 < 0.04) { const k = (0.04 - d2) * 6 * dt; x += dx * k * 10; y += dy * k * 10; }
    }
    pos[i * 3] = x; pos[i * 3 + 1] = y;
  }
  geoP.attributes.position.needsUpdate = true; geoP.attributes.aVie.needsUpdate = true; geoP.attributes.aTaille.needsUpdate = true;

  rendu.render(scene, camera);
}

// ------------------------------------------------------------------ démarrage
new THREE.TextureLoader().load(IMAGE, (tex) => {
  tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  uniformes.uImage.value = tex;
  window.sarah = { changerEtat, get etat() { return etat; } };
  boucle();
});

// ------------------------------------------------------------------ connexion à Home Assistant (événements « sarah_etat »)
const indicateur = document.getElementById("connexion");
let essai = 0;
async function connecter() {
  let cfg;
  try { cfg = await (await fetch("./config.json", { cache: "no-store" })).json(); }
  catch { indicateur.style.display = "flex"; indicateur.querySelector("span").textContent = "config.json manquant"; return; }
  const ws = new WebSocket(cfg.ha_url.replace(/^http/, "ws").replace(/\/$/, "") + "/api/websocket");
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.type === "auth_required") ws.send(JSON.stringify({ type: "auth", access_token: cfg.token }));
    else if (msg.type === "auth_invalid") { indicateur.querySelector("span").textContent = "jeton refusé"; ws.close(); }
    else if (msg.type === "auth_ok") { essai = 0; indicateur.style.display = "none"; ws.send(JSON.stringify({ id: 1, type: "subscribe_events", event_type: "sarah_etat" })); }
    else if (msg.type === "event" && msg.event.event_type === "sarah_etat") { const dd = msg.event.data || {}; changerEtat(dd.etat, dd); }
  };
  ws.onclose = () => {
    indicateur.style.display = "flex";
    if (indicateur.querySelector("span").textContent !== "jeton refusé") indicateur.querySelector("span").textContent = "Home Assistant déconnecté";
    setTimeout(connecter, Math.min(15000, 1000 * 2 ** essai++));
  };
  ws.onerror = () => ws.close();
}
connecter();

// ------------------------------------------------------------------ mode debug (touche D)
function majBoutons(e) { document.querySelectorAll("#debug button").forEach((b) => b.classList.toggle("actif", b.dataset.etat === e)); }
addEventListener("keydown", (e) => { if (e.key === "d" || e.key === "D") document.body.classList.toggle("debug"); });
document.querySelectorAll("#debug button").forEach((b) => b.addEventListener("click", () => changerEtat(b.dataset.etat, { immediat: true })));
