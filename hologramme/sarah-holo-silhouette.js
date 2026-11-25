// Hologramme de Sarah : silhouette noire dessinée par des particules scintillantes (cheveux, épaule, bras, main),
// deux yeux lumineux, des étoiles. Les particules réagissent à la souris / au doigt, et à l'état de Sarah.
import * as THREE from "three";

const IMAGE = "./silhouette.jpg";
const MAX_PARTICULES = 90000;

// ------------------------------------------------------------------ scène (vue 2D, l'image remplit la hauteur)
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
const rendu = new THREE.WebGLRenderer({ antialias: true });
rendu.setPixelRatio(Math.min(devicePixelRatio, 2));
rendu.setClearColor(0x000000, 1);
document.body.appendChild(rendu.domElement);
let ratioImage = 0.5625;
const corps = new THREE.Group();
scene.add(corps);

// ------------------------------------------------------------------ uniformes partagés
const uniformes = {
  uTemps: { value: 0 }, uForme: { value: 0 }, uVoix: { value: 0 }, uPense: { value: 0 }, uLueur: { value: 0.6 },
  uSouris: { value: new THREE.Vector2(9, 9) }, uOnde: { value: new THREE.Vector3(9, 9, -10) }, uPixel: { value: 500 },
  // articulations (angles en radians) : la silhouette bouge comme une marionnette
  uTete: { value: 0 }, uBras: { value: 0 }, uMain: { value: 0 }, uDoigts: { value: 1 },
};
// articulations repérées sur l'image (pixels de l'image 1152 x 2048) → coordonnées de la scène
const px = (x, y) => new THREE.Vector2((x / 1152 - 0.5) * 1.125, (0.5 - y / 2048) * 2);
const COU = px(680, 960), EPAULE = px(250, 1080), POIGNET = px(820, 1420);
function redimensionner() {
  rendu.setSize(innerWidth, innerHeight);
  const a = innerWidth / innerHeight;
  camera.left = -a; camera.right = a; camera.top = 1; camera.bottom = -1;   // hauteur visible = 2 unités
  camera.updateProjectionMatrix();
  uniformes.uPixel.value = innerHeight * rendu.getPixelRatio() / 2;          // pixels par unité
}
redimensionner();
addEventListener("resize", redimensionner);

// ------------------------------------------------------------------ image → particules
function chargerImage(url) {
  return new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = url; });
}

function analyser(img) {
  const L = 720, H = Math.round(L * img.height / img.width);
  ratioImage = img.width / img.height;
  const c = document.createElement("canvas"); c.width = L; c.height = H;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, L, H);
  const d = ctx.getImageData(0, 0, L, H).data;
  const lum = new Float32Array(L * H);
  for (let i = 0; i < L * H; i++) lum[i] = (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 765;

  // les yeux : les deux plus grosses taches très lumineuses et compactes dans le haut de l'image
  const vu = new Uint8Array(L * H), taches = [];
  for (let y = 0; y < H * 0.5; y++) for (let x = 0; x < L; x++) {
    const i = y * L + x;
    if (vu[i] || lum[i] < 0.85) continue;
    const pile = [i]; vu[i] = 1; let n = 0, sx = 0, sy = 0, minx = x, maxx = x, miny = y, maxy = y;
    while (pile.length) {
      const k = pile.pop(), kx = k % L, ky = (k / L) | 0;
      n++; sx += kx; sy += ky; minx = Math.min(minx, kx); maxx = Math.max(maxx, kx); miny = Math.min(miny, ky); maxy = Math.max(maxy, ky);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = kx + dx, ny = ky + dy, j = ny * L + nx;
        if (nx >= 0 && ny >= 0 && nx < L && ny < H && !vu[j] && lum[j] >= 0.85) { vu[j] = 1; pile.push(j); }
      }
    }
    if (n > 15 && maxx - minx < 60 && maxy - miny < 30) taches.push({ n, x: sx / n, y: sy / n, l: maxx - minx + 1, h: maxy - miny + 1 });
  }
  taches.sort((a, b) => b.n - a.n);
  // 1er œil = la plus grosse tache ; 2e œil = la plus grosse tache proche du premier (pas un reflet dans les cheveux)
  const yeuxPx = taches.length ? [taches[0]] : [];
  const second = taches.slice(1).find((e) => Math.hypot(e.x - taches[0].x, e.y - taches[0].y) < L * 0.2);
  if (second) yeuxPx.push(second);

  // particules : chaque pixel lumineux a une chance de devenir un grain (plus il brille, plus il a de chances)
  const vers = (x, y) => ({ x: ((x / L) - 0.5) * 2 * ratioImage, y: (0.5 - y / H) * 2 });
  const pos = [], lumi = [], alea = [];
  for (let y = 0; y < H && pos.length / 3 < MAX_PARTICULES; y++) for (let x = 0; x < L; x++) {
    const l = lum[y * L + x];
    if (l < 0.09) continue;
    if (yeuxPx.some((e) => Math.hypot(x - e.x, (y - e.y) * 1.6) < e.l * 0.9)) continue;   // les yeux sont dessinés à part
    if (Math.random() > Math.min(1, l * 1.6)) continue;
    const p = vers(x + Math.random() - 0.5, y + Math.random() - 0.5);
    pos.push(p.x, p.y, (Math.random() - 0.5) * 0.04);
    lumi.push(Math.min(1, l * 1.25));
    alea.push(Math.random());
  }
  const yeux = yeuxPx.map((e) => ({ ...vers(e.x, e.y), l: e.l / L * 2 * ratioImage, h: e.h / H * 2 }));
  return { pos, lumi, alea, yeux };
}

// ------------------------------------------------------------------ matériau des particules
uniformes.uCou = { value: COU }; uniformes.uEpaule = { value: EPAULE }; uniformes.uPoignet = { value: POIGNET };
const matParticules = new THREE.ShaderMaterial({
  uniforms: uniformes, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  vertexShader: /* glsl */`
    attribute float aLum; attribute float aAlea;
    uniform float uTemps, uForme, uVoix, uPense, uLueur, uPixel; uniform vec2 uSouris; uniform vec3 uOnde;
    uniform float uTete, uBras, uMain, uDoigts; uniform vec2 uCou, uEpaule, uPoignet;
    varying float vA;
    vec2 tourne(vec2 v, float a){ float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
    void main(){
      vec3 p = position;
      // --- marionnette : a quelle partie du corps appartient ce grain ? (en pixels de l'image d'origine)
      vec2 ip = vec2((p.x / 1.125 + 0.5) * 1152.0, (0.5 - p.y * 0.5) * 2048.0);
      float wTete = smoothstep(950.0, 860.0, ip.y) * smoothstep(380.0, 470.0, ip.x);
      float limiteBras = 1050.0 + ip.x / 900.0 * 230.0;
      float wBras = smoothstep(limiteBras - 30.0, limiteBras + 40.0, ip.y);
      float wMain = smoothstep(1400.0, 1470.0, ip.y) * smoothstep(520.0, 600.0, ip.x);
      // doigts : chacun ondule a son rythme, plus fort vers le bout
      p.x += wMain * max(0.0, (ip.y - 1450.0) / 300.0) * 0.025 * sin(uTemps * 2.2 + ip.x * 0.025) * uDoigts;
      // main autour du poignet, puis bras entier autour de l'epaule, puis tete autour du cou
      p.xy = mix(p.xy, tourne(p.xy - uPoignet, uMain) + uPoignet, wMain);
      p.xy = mix(p.xy, tourne(p.xy - uEpaule, uBras) + uEpaule, wBras);
      p.xy = mix(p.xy, tourne(p.xy - uCou, uTete) + uCou, wTete);
      // nuage disperse en veille, rassemble quand on l'appelle
      float f = smoothstep(aAlea * 0.5, aAlea * 0.5 + 0.5, uForme);
      vec3 loin = p + vec3(sin(aAlea * 91.0), cos(aAlea * 57.0), 0.0) * (0.25 + aAlea * 0.6);
      p = mix(loin, p, f);
      // ondulation douce, comme dans l'eau
      p.x += sin(uTemps * 0.9 + p.y * 6.0 + aAlea * 6.28) * 0.004;
      p.y += cos(uTemps * 0.7 + p.x * 5.0 + aAlea * 6.28) * 0.004;
      // la souris ou le doigt ecarte les grains, qui reviennent ensuite
      vec2 ds = p.xy - uSouris; float dd = length(ds);
      p.xy += normalize(ds + 1e-5) * 0.13 * exp(-dd * dd / 0.012);
      // onde du clic
      float age = uTemps - uOnde.z; float r = length(p.xy - uOnde.xy);
      p.xy += normalize(p.xy - uOnde.xy + 1e-5) * 0.03 * exp(-pow((r - age * 0.9) * 14.0, 2.0)) * exp(-age * 1.2);
      // la voix fait vibrer les grains
      p.xy += vec2(sin(aAlea * 50.0 + uTemps * 30.0), cos(aAlea * 70.0 + uTemps * 27.0)) * 0.004 * uVoix;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      // scintillement, vague de reflexion, pulsation de la voix
      float scint = 0.6 + 0.4 * sin(uTemps * (2.0 + aAlea * 5.0) + aAlea * 40.0);
      float vague = uPense * exp(-pow((p.y - (1.2 - fract(uTemps * 0.35) * 2.6)) * 6.0, 2.0));
      vA = aLum * scint * f * uLueur * (1.0 + uVoix * 0.9) + vague * 0.8 + (1.0 - f) * 0.05;
      gl_PointSize = (1.2 + 1.8 * aLum * aLum + uVoix * 0.8) * uPixel / 500.0 * 1.6;
    }`,
  fragmentShader: /* glsl */`
    varying float vA;
    void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c); if (d > 0.5) discard;
      gl_FragColor = vec4(vec3(0.92, 0.95, 1.0), vA * (1.0 - d * 2.0)); }`,
});

// ------------------------------------------------------------------ yeux et étoiles (sprites lumineux)
function textureEclat(etoile) {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d");
  const rad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  rad.addColorStop(0, "rgba(255,255,255,1)"); rad.addColorStop(0.2, "rgba(220,235,255,0.6)"); rad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = rad; g.fillRect(0, 0, 128, 128);
  if (etoile) {   // rayons fins en croix, comme les étincelles de l'image
    g.globalCompositeOperation = "lighter";
    for (const [w, h] of [[128, 3], [3, 128]]) {
      const lin = g.createLinearGradient(64 - w / 2, 64 - h / 2, 64 + w / 2, 64 + h / 2);
      lin.addColorStop(0, "rgba(255,255,255,0)"); lin.addColorStop(0.5, "rgba(255,255,255,0.9)"); lin.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = lin; g.fillRect(64 - w / 2, 64 - h / 2, w, h);
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function textureOeil() {
  // œil en amande, net au centre avec un halo, comme sur l'image
  const c = document.createElement("canvas"); c.width = 256; c.height = 128;
  const g = c.getContext("2d");
  g.shadowColor = "rgba(210,230,255,0.9)"; g.shadowBlur = 24;
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.moveTo(40, 64); g.quadraticCurveTo(128, 18, 216, 64); g.quadraticCurveTo(128, 100, 40, 64);
  g.fill(); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const texOeil = textureOeil(), texEtoile = textureEclat(true);
const yeux = [], etoiles = [];

function creerYeux(infos) {
  for (const e of infos) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texOeil, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    s.userData = { x: e.x, y: e.y, l: Math.max(e.l, 0.03), h: Math.max(e.h, 0.012) };
    s.position.set(e.x, e.y, 0.1);
    corps.add(s); yeux.push(s);
  }
}

function creerEtoiles(d) {
  // positions : des grains très brillants dans les cheveux (haut de l'image)
  const candidats = [];
  for (let i = 0; i < d.lumi.length; i++) if (d.lumi[i] > 0.7 && d.pos[i * 3 + 1] > 0.15) candidats.push(i);
  for (let k = 0; k < 7 && candidats.length; k++) {
    const i = candidats[Math.floor(Math.random() * candidats.length)];
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texEtoile, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    s.position.set(d.pos[i * 3], d.pos[i * 3 + 1], 0.2);
    s.userData = { phase: Math.random() * 10, vitesse: 0.4 + Math.random() * 0.5, taille: 0.06 + Math.random() * 0.08, x: d.pos[i * 3], y: d.pos[i * 3 + 1] };
    corps.add(s); etoiles.push(s);
  }
}

// ------------------------------------------------------------------ états
const ETATS = ["veille", "ecoute", "pense", "parle"];
let etat = "veille", enveloppe = null, debutVoix = 0, voixSimulee = false, minuteur = null;
function changerEtat(nouvel, donnees = {}) {
  if (!ETATS.includes(nouvel)) return;
  clearTimeout(minuteur);
  if (nouvel === "veille" && etat !== "veille") {   // elle reste visible ~4 s après sa réponse
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

// ------------------------------------------------------------------ interactions : souris / doigt
const horloge = new THREE.Clock();
const souris = new THREE.Vector2(9, 9), sourisLisse = new THREE.Vector2(9, 9);
let derniereSouris = -99;
function versScene(e) {
  return new THREE.Vector2(((e.clientX / innerWidth) * 2 - 1) * (innerWidth / innerHeight) - corps.position.x,
                           -(e.clientY / innerHeight) * 2 + 1 - corps.position.y);
}
addEventListener("pointermove", (e) => { souris.copy(versScene(e)); derniereSouris = horloge.elapsedTime; });
addEventListener("pointerleave", () => souris.set(9, 9));
addEventListener("pointerdown", (e) => {
  if (e.target.closest && e.target.closest("#debug")) return;
  const p = versScene(e);
  uniformes.uOnde.value.set(p.x, p.y, horloge.elapsedTime);
});

// ------------------------------------------------------------------ mouvements du corps
const articulations = { tete: 0, bras: 0, main: 0 };
const ciblePos = new THREE.Vector2(), vitesseCorps = new THREE.Vector2();
let destination = null, momentClic = -99;
const pointClic = new THREE.Vector2();
addEventListener("pointerdown", (e) => {
  if (e.target.closest && e.target.closest("#debug")) return;
  // elle nage un peu vers l'endroit touché et tend le bras vers lui
  const x = ((e.clientX / innerWidth) * 2 - 1) * (innerWidth / innerHeight), y = -(e.clientY / innerHeight) * 2 + 1;
  destination = new THREE.Vector2(corps.position.x + (x - corps.position.x) * 0.35, corps.position.y + (y - corps.position.y) * 0.35);
  pointClic.set(x - corps.position.x, y - corps.position.y);
  momentClic = horloge.elapsedTime;
});
// même rotation que la tête dans le shader (cou = pivot), pour les yeux et les étoiles
function suitTete(x, y) {
  const ipx = (x / 1.125 + 0.5) * 1152, ipy = (0.5 - y * 0.5) * 2048;
  const w = 1 - THREE.MathUtils.smoothstep(ipy, 860, 950);
  const a = articulations.tete * w * THREE.MathUtils.smoothstep(ipx, 380, 470), c = Math.cos(a), s = Math.sin(a);
  const vx = x - COU.x, vy = y - COU.y;
  return { x: COU.x + c * vx - s * vy, y: COU.y + s * vx + c * vy };
}

// ------------------------------------------------------------------ boucle
let forme = 0, voix = 0, pense = 0, clignement = 0, prochainClignement = 2, changeRegard = 0;
const regard = new THREE.Vector2(), regardLibre = new THREE.Vector2();
function boucle() {
  requestAnimationFrame(boucle);
  const dt = Math.min(0.05, horloge.getDelta()), t = horloge.elapsedTime;
  const presente = etat !== "veille";
  forme += ((presente ? 1 : 0.35) - forme) * (presente ? 1.5 : 0.5) * dt;
  pense += ((etat === "pense" ? 1 : 0) - pense) * 2.5 * dt;
  const v = niveauVoix(t); voix += (v - voix) * (v > voix ? 0.6 : 0.3);
  uniformes.uLueur.value += ((presente ? 1.0 : 0.55) - uniformes.uLueur.value) * 2 * dt;
  uniformes.uTemps.value = t; uniformes.uForme.value = forme; uniformes.uPense.value = pense; uniformes.uVoix.value = voix;
  if (t - derniereSouris > 4) souris.set(9, 9);
  sourisLisse.lerp(souris, Math.min(1, dt * 8));
  uniformes.uSouris.value.copy(sourisLisse);

  // --- nage : en veille elle se promène sur l'écran ; appelée, elle revient au centre ; un clic l'attire
  const a = innerWidth / innerHeight, marge = Math.max(0, a - 0.75);
  if (destination) ciblePos.copy(destination);
  else if (presente) ciblePos.set(Math.sin(t * 0.25) * 0.05, Math.sin(t * 0.31) * 0.03);
  else ciblePos.set(Math.sin(t * 0.09) * marge * 0.85 + Math.sin(t * 0.23) * 0.1, Math.sin(t * 0.13 + 1) * 0.12);
  if (destination && ciblePos.distanceTo(new THREE.Vector2(corps.position.x, corps.position.y)) < 0.05) destination = null;
  vitesseCorps.x += (ciblePos.x - corps.position.x) * dt * 1.2; vitesseCorps.y += (ciblePos.y - corps.position.y) * dt * 1.2;
  vitesseCorps.multiplyScalar(Math.pow(0.3, dt));                 // frottement de l'eau
  corps.position.x += vitesseCorps.x * dt; corps.position.y += vitesseCorps.y * dt;
  corps.rotation.z += (THREE.MathUtils.clamp(-vitesseCorps.x * 0.5, -0.2, 0.2) + Math.sin(t * 0.17) * 0.02 - corps.rotation.z) * 2 * dt;  // elle s'incline dans les virages
  const souffle = 1 + Math.sin(t * 1.1) * 0.006;
  corps.scale.set(souffle, souffle, 1);

  // --- tête : penche, acquiesce, se lève vers toi quand elle écoute, se baisse quand elle réfléchit
  let tete = Math.sin(t * 0.5) * 0.05 + Math.sin(t * 1.3) * 0.015;
  if (etat === "ecoute" || etat === "apres") tete += 0.09;
  if (etat === "pense") tete += -0.1 + Math.sin(t * 0.8) * 0.03;
  if (etat === "parle") tete += 0.05 + voix * 0.07 * Math.sin(t * 6.5);
  if (t - derniereSouris < 4) tete += THREE.MathUtils.clamp((sourisLisse.y - COU.y) * 0.12, -0.08, 0.08);
  // --- bras : se balance, gesticule quand elle parle, se tend vers l'endroit où tu cliques
  let bras = Math.sin(t * 0.4) * 0.035;
  if (etat === "parle") bras += voix * 0.09 * Math.sin(t * 3.1) + 0.02;
  if (t - momentClic < 2.5) {
    const k = Math.sin(Math.min(1, (t - momentClic) / 2.5) * Math.PI);   // se tend puis revient
    bras += THREE.MathUtils.clamp(Math.atan2(pointClic.y - EPAULE.y, pointClic.x - EPAULE.x) - Math.atan2(POIGNET.y - EPAULE.y, POIGNET.x - EPAULE.x), -0.45, 0.45) * k;
  }
  // --- main : pivote doucement, plus quand elle parle ; doigts qui bougent
  const main = Math.sin(t * 0.7) * 0.07 + (etat === "parle" ? Math.sin(t * 4.2) * 0.12 * voix : 0);
  articulations.tete += (tete - articulations.tete) * 3 * dt;
  articulations.bras += (bras - articulations.bras) * 3 * dt;
  articulations.main += (main - articulations.main) * 4 * dt;
  uniformes.uTete.value = articulations.tete; uniformes.uBras.value = articulations.bras; uniformes.uMain.value = articulations.main;
  uniformes.uDoigts.value = 0.6 + voix * 1.2 + (etat === "ecoute" ? 0.4 : 0);

  // yeux : suivent la souris, sinon regardent autour ; clignent ; brillent plus quand elle parle
  if (t - derniereSouris < 4) regardLibre.copy(sourisLisse);
  else if (t > changeRegard) { regardLibre.set(Math.random() * 1.2 - 0.6, Math.random() * 0.8); changeRegard = t + 1.5 + Math.random() * 3; }
  regard.lerp(regardLibre, Math.min(1, dt * 5));
  if (t > prochainClignement) { clignement = 1; prochainClignement = t + 2.5 + Math.random() * 4; }
  clignement = Math.max(0, clignement - dt * 7);
  const ouverture = 1 - Math.sin(clignement * Math.PI) * 0.95;
  for (const o of yeux) {
    const u = o.userData;
    const dx = THREE.MathUtils.clamp((regard.x - u.x) * 0.025, -0.012, 0.012), dy = THREE.MathUtils.clamp((regard.y - u.y) * 0.02, -0.008, 0.008);
    const p = suitTete(u.x, u.y);                                   // les yeux suivent les mouvements de la tête
    o.position.set(p.x + dx, p.y + dy, 0.1);
    o.scale.set(u.l * 3.0 * (1 + voix * 0.15), u.l * 1.5 * ouverture * (pense > 0.5 ? 0.6 : 1), 1);
    o.material.rotation = -0.45;   // yeux inclinés, comme la tête penchée de l'image
    o.material.opacity = Math.min(1, forme * (0.7 + 0.3 * uniformes.uLueur.value) * (1 + voix * 0.5));
  }
  // étoiles qui scintillent dans les cheveux
  for (const s of etoiles) {
    const u = s.userData, k = Math.max(0, Math.sin(t * u.vitesse + u.phase));
    s.material.opacity = Math.pow(k, 6) * forme * uniformes.uLueur.value;
    s.scale.setScalar(u.taille * (0.6 + k));
    s.material.rotation = t * 0.1 + u.phase;
    const p = suitTete(u.x, u.y); s.position.set(p.x, p.y, 0.2);      // les étoiles des cheveux suivent la tête
  }
  rendu.render(scene, camera);
}

// ------------------------------------------------------------------ démarrage
(async () => {
  const d = analyser(await chargerImage(IMAGE));
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(d.pos, 3));
  g.setAttribute("aLum", new THREE.Float32BufferAttribute(d.lumi, 1));
  g.setAttribute("aAlea", new THREE.Float32BufferAttribute(d.alea, 1));
  const points = new THREE.Points(g, matParticules); points.frustumCulled = false;
  corps.add(points);
  creerYeux(d.yeux);
  creerEtoiles(d);
  window.sarah = { changerEtat, get etat() { return etat; }, particules: d.pos.length / 3, yeux: d.yeux };
  boucle();
})();

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
