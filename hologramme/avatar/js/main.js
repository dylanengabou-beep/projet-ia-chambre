// Avatar hologramme de Sarah — page principale.
// Paramètres d'adresse (optionnels) :
//   ?qualite=bas|moyen|eleve   (défaut : moyen)       ?test=1 : fait défiler les 5 états sans micro
//   ?transparent=1 : fond transparent                 ?modele=chemin.vrm : autre modèle
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import { QUALITES, lueur, habiller, Particules, creerRendu } from "./hologramme.js";
import { Animateur } from "./animation.js";
import { creerMannequin } from "./secours.js";
import { connecterHA } from "./ha.js";

const params = new URLSearchParams(location.search);
let qualite = QUALITES[params.get("qualite")] ? params.get("qualite") : (localStorage.getItem("sarah-qualite") || "moyen");
const transparent = params.get("transparent") === "1";
const MODELES = [params.get("modele"), "../modeles/sarah.vrm", "../modeles/exemple.vrm"].filter(Boolean);

// ------------------------------------------------------------------ scène
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(28, innerWidth / innerHeight, 0.1, 50);
camera.position.set(0, 1.0, 4.2);
camera.lookAt(0, 0.92, 0);
const rendu = new THREE.WebGLRenderer({ antialias: qualite !== "bas", alpha: transparent });
rendu.setClearColor(0x000000, transparent ? 0 : 1);
rendu.setSize(innerWidth, innerHeight);
if (transparent) document.body.classList.add("transparent");
document.body.appendChild(rendu.domElement);
let pipeline = creerRendu(rendu, scene, camera, qualite);
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  rendu.setSize(innerWidth, innerHeight); pipeline.setSize(innerWidth, innerHeight);
});

// ------------------------------------------------------------------ modèle : sarah.vrm, sinon exemple, sinon mannequin
async function chargerVRM(url) {
  const chargeur = new GLTFLoader();
  chargeur.register((p) => new VRMLoaderPlugin(p));
  const gltf = await chargeur.loadAsync(url);
  const vrm = gltf.userData.vrm;
  if (!vrm) throw new Error("pas un fichier VRM");
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.combineSkeletons?.(gltf.scene);
  if (vrm.meta?.metaVersion === "0") VRMUtils.rotateVRM0(vrm);   // les anciens VRM regardent dans l'autre sens
  return vrm;
}
let vrm = null, source = "";
for (const url of MODELES) {
  try { vrm = await chargerVRM(url); source = url.split("/").pop(); break; }
  catch (e) { console.info(`Modèle ${url} indisponible (${e.message || e})`); }
}
if (!vrm) { vrm = creerMannequin(); source = "mannequin de secours"; }
scene.add(vrm.scene);
habiller(vrm.scene, qualite);
const animateur = new Animateur(vrm, camera);
let particules = new Particules(scene, QUALITES[qualite].particules);

// os d'où partent les particules
const sourcesOs = ["head", "chest", "spine", "hips", "leftHand", "rightHand", "leftLowerArm", "rightLowerArm", "leftUpperLeg", "rightUpperLeg", "leftLowerLeg", "rightLowerLeg"]
  .map((n) => vrm.humanoid.getNormalizedBoneNode(n)).filter(Boolean);

// ------------------------------------------------------------------ états (venant de Home Assistant ou du mode test)
const CORRESPONDANCE = { veille: "repos", ecoute: "ecoute", pense: "pense", parle: "parle" };
let etat = "repos", enveloppe = null, debutVoix = 0, voixSimulee = false, minuteurFin = null;
function changerEtat(e, donnees = {}) {
  clearTimeout(minuteurFin);
  const nouvel = CORRESPONDANCE[e] || e;
  if (nouvel === "repos" && etat !== "repos" && !donnees.immediat) {
    // fin : elle reste un instant attentive, puis revient au repos en douceur
    minuteurFin = setTimeout(() => appliquer("repos", {}), 2500);
    appliquer("ecoute", {});
    return;
  }
  appliquer(nouvel, donnees);
}
function appliquer(nouvel, d) {
  etat = nouvel;
  animateur.changerEtat(nouvel);
  if (nouvel === "parle") {
    if (d.enveloppe?.length) { enveloppe = d.enveloppe; debutVoix = d.debut || Date.now(); voixSimulee = false; }
    else if (!enveloppe) voixSimulee = true;
  } else { enveloppe = null; voixSimulee = false; }
  document.querySelectorAll("#debug [data-etat]").forEach((b) => b.classList.toggle("actif", CORRESPONDANCE[b.dataset.etat] === nouvel));
}
function volume(t) {
  if (etat !== "parle") return 0;
  if (enveloppe) { const i = Math.floor((Date.now() - debutVoix) / 1000 * 30); return i >= 0 && i < enveloppe.length ? Math.min(1, enveloppe[i]) : 0; }
  if (voixSimulee) return Math.max(0, 0.55 + 0.45 * Math.sin(t * 11) * Math.sin(t * 3.7)) * (Math.sin(t * 0.9) > -0.7 ? 1 : 0.1);
  return 0;
}
connecterHA({ surEtat: (d) => changerEtat(d.etat, d), surAnimation: (nom) => animateur.jouer(nom) });

// ------------------------------------------------------------------ regard : souris / doigt, sinon centre de l'écran
let sourisX = 0, sourisY = 0.1, derniereSouris = -99;
addEventListener("pointermove", (e) => { sourisX = (e.clientX / innerWidth) * 2 - 1; sourisY = -(e.clientY / innerHeight) * 2 + 1; derniereSouris = performance.now(); });

// ------------------------------------------------------------------ mode test : les 5 états défilent sans micro
if (params.get("test") === "1") {
  const etapes = [["veille", 4], ["ecoute", 4], ["pense", 5], ["parle", 7], ["veille", 6]];
  let i = 0;
  const suivant = () => {
    const [e, d] = etapes[i % etapes.length];
    changerEtat(e, { immediat: i % etapes.length === 0 });
    if (i % etapes.length === etapes.length - 1) setTimeout(() => animateur.jouer(["saluer", "applaudir", "danser"][Math.floor(i / etapes.length) % 3]), 1500);
    i++; setTimeout(suivant, d * 1000);
  };
  suivant();
}

// ------------------------------------------------------------------ boucle d'animation (+ mesure des images/seconde)
const horloge = new THREE.Clock();
const infos = document.getElementById("infos");
let images = 0, chrono = 0, fps = 0, intensite = 0.8;
const tmp = new THREE.Vector3(), centre = new THREE.Vector3();
function boucle() {
  requestAnimationFrame(boucle);
  const dt = Math.min(0.05, horloge.getDelta()), t = horloge.elapsedTime;
  // regard : la souris si elle a bougé il y a moins de 4 s, sinon le centre de l'écran (vers toi)
  if (performance.now() - derniereSouris < 4000) animateur.regarderEcran(sourisX, sourisY);
  else animateur.regarderEcran(0, 0.15);
  animateur.maj(dt, t, volume(t));

  // lueur : plus forte quand elle écoute ou parle ; pulse avec la voix
  const cibleI = { repos: 0.75, ecoute: 1.25, pense: 1.0, parle: 1.15 }[etat] + animateur.voix * 0.5;
  intensite += (cibleI - intensite) * Math.min(1, dt * 3);
  lueur.uIntensite.value = intensite; lueur.uTemps.value = t;

  // particules : faibles au repos, plus nombreuses quand elle parle, en tourbillon quand elle réfléchit
  const sources = sourcesOs.map((o) => o.getWorldPosition(new THREE.Vector3()));
  vrm.humanoid.getNormalizedBoneNode("hips")?.getWorldPosition(centre);
  particules.tourbillon += ((etat === "pense" ? 1 : 0) - particules.tourbillon) * dt * 2;
  particules.maj(dt, sources, { repos: 40, ecoute: 120, pense: 160, parle: 140 }[etat] * (QUALITES[qualite].particules / 1500), centre);

  pipeline.render();
  images++; chrono += dt;
  if (chrono >= 1) { fps = Math.round(images / chrono); images = 0; chrono = 0;
    infos.textContent = `modèle : ${source}\nqualité : ${qualite}\nimages/s : ${fps}\nétat : ${etat}${animateur.geste ? " + " + animateur.geste.nom : ""}`; }
}
boucle();

// ------------------------------------------------------------------ mode debug (touche D) et qualité
addEventListener("keydown", (e) => { if (e.key === "d" || e.key === "D") document.body.classList.toggle("debug"); });
document.querySelectorAll("#debug [data-etat]").forEach((b) => b.addEventListener("click", () => changerEtat(b.dataset.etat, { immediat: true })));
document.querySelectorAll("#debug [data-anim]").forEach((b) => b.addEventListener("click", () => animateur.jouer(b.dataset.anim)));
document.querySelectorAll("#debug [data-qualite]").forEach((b) => b.addEventListener("click", () => {
  localStorage.setItem("sarah-qualite", b.dataset.qualite); location.reload();   // la qualité s'applique au rechargement
}));
window.sarah = { changerEtat, jouer: (n) => animateur.jouer(n), get fps() { return fps; }, source, animateur };
