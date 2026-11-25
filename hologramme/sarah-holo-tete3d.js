// Hologramme de Sarah : une tête-sculpture sombre traversée de lignes lumineuses (style de l'image de référence),
// qui nage sur l'écran comme un poisson, parle (bouche animée par sa voix), regarde autour d'elle et suit la souris.
import * as THREE from "three";
import { GLTFLoader } from "./vendor/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "./vendor/examples/jsm/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "./vendor/examples/jsm/libs/meshopt_decoder.module.js";

const MODELE = "./vendor/examples/models/gltf/facecap.glb";

// ------------------------------------------------------------------ scène
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 0, 6);
const rendu = new THREE.WebGLRenderer({ antialias: true });
rendu.setPixelRatio(Math.min(devicePixelRatio, 2));
rendu.setSize(innerWidth, innerHeight);
rendu.setClearColor(0x000000, 1);
rendu.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(rendu.domElement);

// lumière de sculpture : une lumière principale à gauche, un contre-jour derrière, très peu d'ambiance
scene.add(new THREE.AmbientLight(0xffffff, 0.04));
const cle = new THREE.DirectionalLight(0xffffff, 2.2); cle.position.set(-3, 2, 3); scene.add(cle);
const contre = new THREE.DirectionalLight(0xcfe6ff, 1.6); contre.position.set(3, 1, -3); scene.add(contre);

// demi-largeur / hauteur visibles à la distance de la tête (pour qu'elle reste dans l'écran)
function bordsEcran() {
  const h = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
  return { x: (h * camera.aspect) / 2, y: h / 2 };
}
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  rendu.setSize(innerWidth, innerHeight);
});

// ------------------------------------------------------------------ matériau « sculpture + lignes lumineuses »
const uniformes = {
  uTemps: { value: 0 },
  uForme: { value: 0 },    // 0 = dissoute (veille), 1 = entière
  uPense: { value: 0 },
  uVoix: { value: 0 },
  uLueur: { value: 0.55 },   // eclat des lignes : plus faible quand elle nage seule, fort quand on lui parle
  uBas: { value: -1 }, uHaut: { value: 1 },   // hauteur de la tête (pour l'espacement des lignes)
  uInvTete: { value: new THREE.Matrix4() },   // pour calculer les lignes dans le repère de la tête (horizontales)
};

function materiauHologramme(base = 0x101012) {
  const m = new THREE.MeshStandardMaterial({ color: base, roughness: 0.32, metalness: 0.15 });
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniformes);
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vLocal; varying vec3 vMonde; varying vec3 vNormaleMonde;")
      .replace("#include <project_vertex>", `#include <project_vertex>
        vLocal = transformed;
        vMonde = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vNormaleMonde = normalize(mat3(modelMatrix) * objectNormal);`);
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", `#include <common>
        uniform float uTemps, uForme, uPense, uVoix, uBas, uHaut, uLueur; uniform mat4 uInvTete;
        varying vec3 vLocal; varying vec3 vMonde; varying vec3 vNormaleMonde;
        float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float bruit(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
          return mix(mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x), mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
                     mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x), mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace("#include <dithering_fragment>", `#include <dithering_fragment>
        vec3 pt = (uInvTete * vec4(vMonde, 1.0)).xyz;                 // position dans le repere de la tete
        float h = clamp((pt.y + 2.6) / 3.8, 0.0, 1.0);                // 0 en bas du cou, 1 en haut du crane
        // dissolution : la tete apparait / disparait par morceaux, avec un lisere lumineux
        float n = bruit(pt * 4.0) * 0.75 + h * 0.25;
        float seuil = 1.0 - uForme;
        if (n < seuil) discard;
        float lisere = smoothstep(seuil + 0.06, seuil, n) * step(0.001, seuil);
        // fines lignes horizontales qui suivent la surface, comme sur l'image
        float yl = pt.y * 34.0 + sin(pt.x * 2.5 + pt.z * 1.5) * 0.35;  // lignes horizontales, legerement ondulees
        float dl = abs(fract(yl + 0.5) - 0.5);                   // distance a la ligne la plus proche
        float ligne = 1.0 - smoothstep(0.0, fwidth(yl) * 1.2, dl); // ligne fine et nette (anti-crenelage)
        vec3 V = normalize(cameraPosition - vMonde);
        float face = clamp(abs(normalize(normal).z), 0.0, 1.0);        // 1 = peau vue de face, 0 = de profil
        float profil = pow(1.0 - face, 1.4);                         // lignes surtout sur les cotes, le crane et le cou
        float vague = uPense * exp(-pow((h - fract(uTemps * 0.4)) * 10.0, 2.0));
        float intensite = ligne * (0.02 + 1.3 * profil + 0.6 * smoothstep(0.95, 1.0, h) + 0.9 * smoothstep(0.37, 0.30, h)) * (0.8 + vague * 2.5);
        vec3 bleu = vec3(0.78, 0.9, 1.0);
        gl_FragColor.rgb += bleu * intensite * 1.4 * uLueur + bleu * pow(1.0 - face, 4.0) * 0.6 + bleu * lisere * 3.0;`);
  };
  return m;
}

// ------------------------------------------------------------------ poussière qui se détache (traînée)
const N_POUSSIERE = 5000;
const pPos = new Float32Array(N_POUSSIERE * 3), pVit = new Float32Array(N_POUSSIERE * 3), pVie = new Float32Array(N_POUSSIERE);
const pTaille = new Float32Array(N_POUSSIERE);
for (let i = 0; i < N_POUSSIERE; i++) { pVie[i] = 0; pTaille[i] = Math.random() < 0.08 ? 3.5 : 1.4; }
const gPoussiere = new THREE.BufferGeometry();
gPoussiere.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
gPoussiere.setAttribute("aVie", new THREE.BufferAttribute(pVie, 1));
gPoussiere.setAttribute("aTaille", new THREE.BufferAttribute(pTaille, 1));
const poussiere = new THREE.Points(gPoussiere, new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { uEchelle: { value: rendu.getPixelRatio() } },
  vertexShader: `attribute float aVie; attribute float aTaille; uniform float uEchelle; varying float vVie;
    void main(){ vVie = aVie; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
      gl_PointSize = aTaille * uEchelle * (6.0 / -mv.z) * (0.4 + 0.6 * aVie); }`,
  fragmentShader: `varying float vVie; void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c); if (d > 0.5 || vVie <= 0.0) discard;
      gl_FragColor = vec4(vec3(0.85, 0.94, 1.0), vVie * (1.0 - d * 2.0)); }`,
}));
poussiere.frustumCulled = false;
scene.add(poussiere);
let prochaine = 0;

// ------------------------------------------------------------------ chargement de la tête
const tete = new THREE.Group();     // position et orientation (nage)
scene.add(tete);
let visage = null, morph = {}, sommets = null, echelle = 1;

const ktx2 = new KTX2Loader().setTranscoderPath("./vendor/examples/jsm/libs/basis/").detectSupport(rendu);
new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder).load(MODELE, (gltf) => {
  const modele = gltf.scene;
  // taille normalisée : la tête fait 2,2 unités de haut, centrée
  const boite = new THREE.Box3().setFromObject(modele);
  const taille = boite.getSize(new THREE.Vector3());
  echelle = 2.2 / taille.y;
  modele.scale.setScalar(echelle);
  modele.position.sub(boite.getCenter(new THREE.Vector3()).multiplyScalar(echelle));
  modele.traverse((o) => {
    if (!o.isMesh) return;
    o.material = materiauHologramme(o.morphTargetDictionary ? 0x101012 : 0x050506);
    if (o.morphTargetDictionary && Object.keys(o.morphTargetDictionary).length > 40) {
      visage = o; morph = o.morphTargetDictionary;
      o.geometry.computeBoundingBox();
      uniformes.uBas.value = o.geometry.boundingBox.min.y; uniformes.uHaut.value = o.geometry.boundingBox.max.y;
      sommets = o.geometry.attributes.position;
    }
  });
  tete.add(modele);

  // le modèle s'arrête au menton : on ajoute un cou (même matière, mêmes lignes), comme sur l'image
  const profil = [];
  for (let i = 0; i <= 24; i++) {
    const y = -i / 24;                                   // de 0 (menton) à -1 (bas du cou)
    const r = 0.34 + 0.05 * Math.sin(i / 24 * Math.PI) + Math.pow(i / 24, 6) * 0.45;   // s'évase vers les épaules
    profil.push(new THREE.Vector2(r, y));
  }
  const geoCou = new THREE.LatheGeometry(profil, 64);
  const cou = new THREE.Mesh(geoCou, materiauHologramme(0x0c0c0e));
  cou.scale.set(1, 1.25, 0.9);
  cou.position.set(0, -0.62, -0.25);
  cou.rotation.x = 0.15;
  tete.add(cou);
  window.sarah = { changerEtat, get etat() { return etat; }, morph: Object.keys(morph), rendu, tete, uniformes };
  boucle();
});

function expression(nom, valeur) {
  if (!visage) return;
  // le modèle nomme les côtés « _L » / « _R » (ex. eyeBlink_L) au lieu de « Left » / « Right »
  const i = morph[nom] ?? morph[nom.replace(/Left$/, "_L").replace(/Right$/, "_R")];
  if (i !== undefined) visage.morphTargetInfluences[i] = valeur;
}

// ------------------------------------------------------------------ états
const ETATS = ["veille", "ecoute", "pense", "parle"];
let etat = "veille", enveloppe = null, debutVoix = 0, voixSimulee = false, minuteur = null;

function changerEtat(nouvel, donnees = {}) {
  if (!ETATS.includes(nouvel)) return;
  clearTimeout(minuteur);
  if (nouvel === "veille" && etat !== "veille") {
    etat = "apres";                                        // elle reste visible ~4 s après sa réponse
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

// ------------------------------------------------------------------ interaction : souris / doigt
const souris = new THREE.Vector2(0, 0); let sourisActive = 0;
let destination = null;   // clic : elle nage vers ce point
addEventListener("pointermove", (e) => {
  souris.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  sourisActive = performance.now();
});
addEventListener("pointerdown", (e) => {
  if (document.body.classList.contains("debug") && e.target.closest("#debug")) return;
  const b = bordsEcran();
  destination = new THREE.Vector3(((e.clientX / innerWidth) * 2 - 1) * b.x * 0.8, (-(e.clientY / innerHeight) * 2 + 1) * b.y * 0.8, 0);
  sourisActive = performance.now();
});

// ------------------------------------------------------------------ boucle d'animation
const horloge = new THREE.Clock();
let forme = 0, voix = 0, pense = 0, jaw = 0;
const vitesse = new THREE.Vector3(), cible = new THREE.Vector3(), regard = new THREE.Vector2();
let lacet = 0, tangage = 0, roulis = 0, clignement = 0, prochainClignement = 2, regardLibre = new THREE.Vector2(), changeRegard = 0;
const tmp = new THREE.Vector3();

function boucle() {
  requestAnimationFrame(boucle);
  const dt = Math.min(0.05, horloge.getDelta()), t = horloge.elapsedTime;
  const b = bordsEcran();
  const presente = etat !== "veille";

  // apparition / dissolution
  // elle reste toujours visible (elle nage) ; elle se forme en particules au lancement de la page
  forme += (1 - forme) * 0.8 * dt;
  uniformes.uLueur.value += ((presente ? 1.0 : 0.55) - uniformes.uLueur.value) * 2.0 * dt;
  pense += ((etat === "pense" ? 1 : 0) - pense) * 2.5 * dt;
  const v = niveauVoix(t); voix += (v - voix) * (v > voix ? 0.6 : 0.3);
  tete.updateMatrixWorld(); uniformes.uInvTete.value.copy(tete.matrixWorld).invert();
  uniformes.uTemps.value = t; uniformes.uForme.value = forme; uniformes.uPense.value = pense; uniformes.uVoix.value = voix;

  // --- nage : en veille elle erre lentement ; appelée, elle vient au centre et te fait face ; un clic l'attire
  if (destination) cible.copy(destination);
  else if (presente) cible.set(Math.sin(t * 0.3) * b.x * 0.12, Math.sin(t * 0.47) * b.y * 0.08, 0.6);
  else cible.set(Math.sin(t * 0.11) * b.x * 0.7 + Math.sin(t * 0.37) * b.x * 0.15,
                 Math.sin(t * 0.17 + 1.3) * b.y * 0.55 + Math.sin(t * 0.53) * b.y * 0.1, Math.sin(t * 0.13) * 0.8 - 0.4);
  tmp.subVectors(cible, tete.position);
  if (destination && tmp.length() < 0.15) destination = null;
  vitesse.addScaledVector(tmp, dt * (presente ? 1.6 : 0.6));      // ressort doux
  vitesse.multiplyScalar(Math.pow(0.35, dt));                      // frottement de l'eau
  tete.position.addScaledVector(vitesse, dt);

  // orientation : elle regarde là où elle va, ou vers toi quand elle t'écoute / te parle
  const versToi = presente && !destination;
  const lacetVise = versToi ? -tete.position.x * 0.12 : THREE.MathUtils.clamp(vitesse.x * 1.4, -0.9, 0.9);
  const tangageVise = versToi ? tete.position.y * 0.1 - 0.05 : THREE.MathUtils.clamp(-vitesse.y * 1.0, -0.5, 0.5) - 0.15;
  const roulisVise = THREE.MathUtils.clamp(-vitesse.x * 0.5, -0.35, 0.35);   // elle s'incline dans les virages
  lacet += (lacetVise - lacet) * 2.0 * dt; tangage += (tangageVise - tangage) * 2.0 * dt; roulis += (roulisVise - roulis) * 1.5 * dt;
  tete.rotation.set(tangage + Math.sin(t * 1.1) * 0.03, lacet + Math.sin(t * 0.7) * 0.05, roulis);

  // --- yeux : suivent la souris si tu la bouges, sinon regardent autour (ou en l'air quand elle réfléchit)
  if (performance.now() - sourisActive < 3000) {
    tmp.set(souris.x * b.x, souris.y * b.y, 0).sub(tete.position);
    regard.set(THREE.MathUtils.clamp(tmp.x * 0.6, -1, 1), THREE.MathUtils.clamp(tmp.y * 0.8, -1, 1));
  } else {
    if (t > changeRegard) { regardLibre.set(Math.random() * 1.6 - 0.8, Math.random() * 1.0 - 0.4); changeRegard = t + 1 + Math.random() * 2.5; }
    if (etat === "pense") regardLibre.set(0.5, 0.8);
    if (etat === "ecoute" || etat === "parle") regardLibre.multiplyScalar(0.92);
    regard.lerp(regardLibre, Math.min(1, dt * 6));
  }
  const gauche = Math.max(0, -regard.x), droite = Math.max(0, regard.x), haut = Math.max(0, regard.y), bas = Math.max(0, -regard.y);
  expression("eyeLookOutLeft", droite); expression("eyeLookInRight", droite);
  expression("eyeLookInLeft", gauche); expression("eyeLookOutRight", gauche);
  expression("eyeLookUpLeft", haut); expression("eyeLookUpRight", haut);
  expression("eyeLookDownLeft", bas); expression("eyeLookDownRight", bas);
  // clignements
  if (t > prochainClignement) { clignement = 1; prochainClignement = t + 2.5 + Math.random() * 4; }
  clignement = Math.max(0, clignement - dt * 7);
  const paupieres = Math.sin(clignement * Math.PI);
  expression("eyeBlinkLeft", paupieres); expression("eyeBlinkRight", paupieres);

  // --- bouche : s'ouvre au rythme de la voix
  jaw += (voix * 0.55 - jaw) * Math.min(1, dt * 18);
  expression("jawOpen", jaw);
  expression("mouthFunnel", voix * 0.25 * (0.5 + 0.5 * Math.sin(t * 7)));
  expression("mouthClose", 0);
  expression("mouthSmileLeft", etat === "ecoute" ? 0.25 : 0.08); expression("mouthSmileRight", etat === "ecoute" ? 0.25 : 0.08);
  expression("browInnerUp", pense * 0.5 + (etat === "ecoute" ? 0.2 : 0));

  // --- poussière : des grains se détachent de la tête et restent derrière elle (traînée)
  if (sommets) {
    visage.updateMatrixWorld();
    const debit = (presente ? 160 : 40) * (0.5 + forme) + vitesse.length() * 200;
    prochaine += debit * dt;
    while (prochaine > 1) {
      prochaine--;
      const i = Math.floor(Math.random() * N_POUSSIERE), s = Math.floor(Math.random() * sommets.count);
      tmp.fromBufferAttribute(sommets, s);
      if (tmp.x < 0 && Math.random() < 0.7) continue;           // surtout du côté droit / arrière, comme sur l'image
      visage.localToWorld(tmp);
      pPos.set([tmp.x, tmp.y, tmp.z], i * 3);
      pVit.set([0.15 + Math.random() * 0.25 - vitesse.x * 0.3, -0.05 - Math.random() * 0.15 - vitesse.y * 0.3, (Math.random() - 0.5) * 0.2], i * 3);
      pVie[i] = 0.6 + Math.random() * 0.4;
    }
    for (let i = 0; i < N_POUSSIERE; i++) {
      if (pVie[i] <= 0) continue;
      pVie[i] -= dt * 0.35;
      pPos[i * 3] += pVit[i * 3] * dt; pPos[i * 3 + 1] += pVit[i * 3 + 1] * dt; pPos[i * 3 + 2] += pVit[i * 3 + 2] * dt;
    }
    gPoussiere.attributes.position.needsUpdate = true; gPoussiere.attributes.aVie.needsUpdate = true;
  }

  rendu.render(scene, camera);
}

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
    else if (msg.type === "event" && msg.event.event_type === "sarah_etat") { const d = msg.event.data || {}; changerEtat(d.etat, d); }
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
