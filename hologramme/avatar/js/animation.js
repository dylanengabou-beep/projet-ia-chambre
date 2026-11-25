// Moteur de mouvements de Sarah (sans fichier d'animation : tout est calculé en temps réel).
// Chaque état (repos, écoute, réflexion, parole) donne une « pose » qui bouge avec le temps ;
// les poses sont mélangées avec des poids qui évoluent doucement → transitions fluides, aucun saut.
// Les os sont les os « normalisés » VRM : en pose de référence (T-pose), le modèle regarde vers +Z.
import * as THREE from "three";

const OS = ["hips", "spine", "chest", "upperChest", "neck", "head",
  "leftShoulder", "leftUpperArm", "leftLowerArm", "leftHand",
  "rightShoulder", "rightUpperArm", "rightLowerArm", "rightHand",
  "leftUpperLeg", "leftLowerLeg", "rightUpperLeg", "rightLowerLeg"];

const lisse = (x) => x * x * (3 - 2 * x);

// pose de base : bras le long du corps, coudes légèrement pliés
function poseBase() {
  return {
    leftUpperArm: [0, 0, -1.2], rightUpperArm: [0, 0, 1.2],
    leftLowerArm: [0, -0.25, 0], rightLowerArm: [0, 0.25, 0],
    leftHand: [0, 0, -0.1], rightHand: [0, 0, 0.1],
  };
}

// ------------------------------------------------------------------ poses des états (fonctions du temps)
const POSES = {
  // repos : respiration lente, poids du corps d'une jambe à l'autre, petits mouvements de tête
  repos: (t) => ({
    chest: [Math.sin(t * 1.3) * 0.025, 0, 0],
    hips: [0, Math.sin(t * 0.21) * 0.06, Math.sin(t * 0.33) * 0.035],
    spine: [0, 0, -Math.sin(t * 0.33) * 0.03],
    neck: [Math.sin(t * 0.4) * 0.03, Math.sin(t * 0.27) * 0.08, 0],
    head: [Math.sin(t * 0.55) * 0.03, Math.sin(t * 0.37) * 0.06, Math.sin(t * 0.29) * 0.04],
    leftUpperArm: [0, 0, Math.sin(t * 1.3) * 0.02], rightUpperArm: [0, 0, -Math.sin(t * 1.3) * 0.02],
  }),
  // écoute : se tourne vers la caméra, lève légèrement la tête, attentive
  ecoute: (t) => ({
    chest: [Math.sin(t * 1.6) * 0.02 - 0.03, 0, 0],
    hips: [0, 0, Math.sin(t * 0.5) * 0.015],
    neck: [-0.06, 0, 0],
    head: [-0.1 + Math.sin(t * 0.8) * 0.015, 0, 0.06],
    leftUpperArm: [0, 0, 0.05], rightUpperArm: [0, 0, -0.05],
  }),
  // réflexion : regard qui se détourne, main droite au menton
  pense: (t) => ({
    chest: [0.02, -0.05, 0],
    neck: [0.04, -0.1, 0],
    head: [0.06 + Math.sin(t * 0.7) * 0.02, -0.18, -0.08],
    rightUpperArm: [0.25, 0.7, -0.75], rightLowerArm: [0, 1.9, 0], rightHand: [0, 0, -0.4],
    leftUpperArm: [0, 0.35, 0.05], leftLowerArm: [0, -0.9, 0],
  }),
  // parole : hochements de tête et gestes des mains au rythme de la voix (v = volume 0..1)
  parle: (t, v) => ({
    chest: [Math.sin(t * 1.5) * 0.02, Math.sin(t * 0.9) * 0.05, 0],
    neck: [Math.sin(t * 5.1) * 0.03 * v, 0, 0],
    head: [Math.sin(t * 6.2) * 0.06 * v - 0.03, Math.sin(t * 1.1) * 0.08, Math.sin(t * 2.3) * 0.04],
    rightUpperArm: [0, 0.35 + Math.sin(t * 2.1) * 0.15 * v, -0.15 + Math.sin(t * 2.9) * 0.12 * v],
    rightLowerArm: [0, 0.7 + Math.sin(t * 3.3) * 0.3 * v, 0],
    rightHand: [Math.sin(t * 4.1) * 0.25 * v, 0, 0],
    leftUpperArm: [0, -0.25 - Math.sin(t * 1.7 + 1) * 0.12 * v, 0.1],
    leftLowerArm: [0, -0.55 - Math.sin(t * 2.7 + 2) * 0.25 * v, 0],
    leftHand: [Math.sin(t * 3.7 + 1) * 0.2 * v, 0, 0],
  }),
};

// ------------------------------------------------------------------ animations ponctuelles (déclenchées par HA)
const GESTES = {
  saluer: { duree: 3.2, pose: (t) => ({
    rightUpperArm: [0, 0, -1.25 - 0.35], rightLowerArm: [0, 0, -0.9 + Math.sin(t * 9) * 0.35], rightHand: [0, 0, Math.sin(t * 9) * 0.2],
    head: [-0.04, 0, 0.08], chest: [0, 0.08, 0],
  }) },
  applaudir: { duree: 3.0, pose: (t) => {
    const k = Math.sin(t * 11) * 0.12;
    return {
      leftUpperArm: [0, -0.8 + k, 0.55], leftLowerArm: [0, -1.3, 0], leftHand: [0, 0, 0.3],
      rightUpperArm: [0, 0.8 - k, -0.55], rightLowerArm: [0, 1.3, 0], rightHand: [0, 0, -0.3],
      head: [-0.05 + Math.sin(t * 11) * 0.02, 0, 0],
    };
  } },
  danser: { duree: 6.0, pose: (t) => {
    const b = Math.sin(t * 6.3);   // ~1 battement par seconde
    return {
      hips: [0, Math.sin(t * 3.15) * 0.25, b * 0.12], spine: [0, 0, -b * 0.1], chest: [0, -Math.sin(t * 3.15) * 0.15, -b * 0.08],
      head: [Math.abs(b) * 0.08 - 0.04, Math.sin(t * 3.15) * 0.15, b * 0.1],
      leftUpperArm: [0, -0.3, 1.0 + Math.sin(t * 6.3) * 0.35], leftLowerArm: [0, -1.0 - Math.sin(t * 6.3) * 0.3, 0],
      rightUpperArm: [0, 0.3, -1.0 + Math.sin(t * 6.3 + 3.14) * 0.35], rightLowerArm: [0, 1.0 + Math.sin(t * 6.3) * 0.3, 0],
      leftUpperLeg: [Math.max(0, b) * 0.2, 0, 0], leftLowerLeg: [-Math.max(0, b) * 0.35, 0, 0],
      rightUpperLeg: [Math.max(0, -b) * 0.2, 0, 0], rightLowerLeg: [-Math.max(0, -b) * 0.35, 0, 0],
    };
  } },
};

export class Animateur {
  constructor(vrm, camera) {
    this.vrm = vrm;
    this.camera = camera;
    this.os = {};
    for (const n of OS) { const o = vrm?.humanoid?.getNormalizedBoneNode(n); if (o) this.os[n] = o; }
    this.poids = { repos: 1, ecoute: 0, pense: 0, parle: 0 };
    this.etat = "repos";
    this.geste = null;
    this.voix = 0;
    this.bouche = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
    this.clignement = 0; this.prochainClignement = 2;
    this.regard = new THREE.Object3D();            // le point que ses yeux et sa tête suivent
    this.cibleRegard = new THREE.Vector3(0, 1.4, 3);
    if (vrm?.lookAt) vrm.lookAt.target = this.regard;
    this.qTmp = new THREE.Quaternion(); this.eTmp = new THREE.Euler();
  }

  changerEtat(e) { if (this.poids[e] !== undefined) this.etat = e; }
  jouer(nom) { if (GESTES[nom]) this.geste = { nom, debut: performance.now() / 1000 }; }
  // point regardé : souris (coordonnées écran -1..1), ou centre de l'écran
  regarderEcran(x, y) {
    const v = new THREE.Vector3(x, y, 0.5).unproject(this.camera).sub(this.camera.position).normalize();
    const d = (1.3 - this.camera.position.z) / v.z;   // plan devant le visage
    this.cibleRegard.copy(this.camera.position).addScaledVector(v, Math.max(0.5, Math.abs(d)));
  }

  maj(dt, t, volume) {
    // poids des états : chacun glisse doucement vers 0 ou 1 → transitions fluides
    for (const e in this.poids) this.poids[e] += ((e === this.etat ? 1 : 0) - this.poids[e]) * Math.min(1, dt * 2.2);
    this.voix += (volume - this.voix) * Math.min(1, dt * (volume > this.voix ? 25 : 10));

    // pose cible = base + Σ (poids × pose de l'état) + geste ponctuel
    const cible = {};
    const ajouter = (pose, k) => { for (const n in pose) { const c = cible[n] || (cible[n] = [0, 0, 0]); c[0] += pose[n][0] * k; c[1] += pose[n][1] * k; c[2] += pose[n][2] * k; } };
    ajouter(poseBase(), 1);
    for (const e in this.poids) if (this.poids[e] > 0.001) ajouter(POSES[e](t, this.voix), this.poids[e]);
    if (this.geste) {
      const g = GESTES[this.geste.nom], tg = t - (this.geste.debut - (performance.now() / 1000 - t));
      const ecoule = performance.now() / 1000 - this.geste.debut;
      if (ecoule > g.duree) this.geste = null;
      else {
        // entrée et sortie en douceur (0,5 s), et le geste remplace en partie la pose de l'état
        const k = lisse(Math.min(1, ecoule / 0.5)) * lisse(Math.min(1, (g.duree - ecoule) / 0.5));
        const pg = g.pose(ecoule);
        for (const n in pg) if (cible[n]) for (let i = 0; i < 3; i++) cible[n][i] *= 1 - k * 0.7;
        ajouter(pg, k);
      }
    }
    // regard : la souris (ou le centre de l'écran), ailleurs quand elle réfléchit
    const cibleR = this.cibleRegard.clone();
    if (this.poids.pense > 0.5) cibleR.set(-0.8, 2.3, 2);
    this.regard.position.lerp(cibleR, Math.min(1, dt * 4));
    // la tête suit un peu le regard (en plus des yeux), sauf quand elle réfléchit
    if (this.os.head) {
      const tete = new THREE.Vector3(); this.os.head.getWorldPosition(tete);
      const d = this.regard.position.clone().sub(tete);
      const k = 1 - this.poids.pense;
      const c = cible.head || (cible.head = [0, 0, 0]);
      c[1] += THREE.MathUtils.clamp(Math.atan2(d.x, d.z), -0.6, 0.6) * 0.45 * k;
      c[0] += THREE.MathUtils.clamp(-Math.atan2(d.y, Math.hypot(d.x, d.z)), -0.4, 0.4) * 0.35 * k;
    }

    // applique : chaque os tourne doucement vers sa cible (lissage) → aucun saut brusque
    const lissage = 1 - Math.pow(0.0005, dt);
    for (const n in this.os) {
      const c = cible[n] || [0, 0, 0];
      this.qTmp.setFromEuler(this.eTmp.set(c[0], c[1], c[2]));
      this.os[n].quaternion.slerp(this.qTmp, lissage);
    }

    // expressions : clignements, lèvres synchronisées sur le volume de la voix, petit sourire
    const em = this.vrm?.expressionManager;
    if (em) {
      if (t > this.prochainClignement) { this.clignement = 1; this.prochainClignement = t + 2 + Math.random() * 4; }
      this.clignement = Math.max(0, this.clignement - dt * 8);
      em.setValue("blink", Math.sin(this.clignement * Math.PI));
      // la voix ouvre la bouche ; on varie les voyelles pour un mouvement naturel
      const v = this.voix;
      const cibles = v < 0.05 ? { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 } : {
        aa: v * (0.55 + 0.45 * Math.sin(t * 13.0)), oh: v * 0.5 * Math.max(0, Math.sin(t * 7.3)),
        ih: v * 0.4 * Math.max(0, Math.sin(t * 9.1 + 1)), ou: v * 0.3 * Math.max(0, Math.sin(t * 5.7 + 2)), ee: v * 0.3 * Math.max(0, Math.sin(t * 11.3 + 3)),
      };
      for (const k in this.bouche) { this.bouche[k] += (cibles[k] - this.bouche[k]) * Math.min(1, dt * 18); em.setValue(k, Math.min(1, this.bouche[k])); }
      em.setValue("happy", 0.15 * this.poids.ecoute + 0.1 * this.poids.repos + (this.geste?.nom === "danser" ? 0.4 : 0));
      em.setValue("relaxed", 0.25 * this.poids.pense);
    }
    this.vrm?.update(dt);
  }
}
