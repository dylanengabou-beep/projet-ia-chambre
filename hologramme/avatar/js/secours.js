// Mannequin de secours (si aucun fichier .vrm n'est trouvé) : un corps humain simple, construit par le code,
// avec les mêmes noms d'os que VRM pour que le moteur de mouvements fonctionne pareil.
import * as THREE from "three";

export function creerMannequin() {
  const racine = new THREE.Group();
  const os = {};
  const geo = (r, l) => new THREE.CapsuleGeometry(r, l, 6, 14);
  const mat = new THREE.MeshBasicMaterial();

  function membre(nom, parent, position, rayon, longueur, axe) {
    const g = new THREE.Group(); g.name = nom; g.position.copy(position); parent.add(g); os[nom] = g;
    if (longueur > 0) {
      const m = new THREE.Mesh(geo(rayon, longueur), mat);
      // la capsule part de l'articulation dans la direction de l'os
      if (axe === "x+") { m.rotation.z = -Math.PI / 2; m.position.x = longueur / 2 + rayon; }
      if (axe === "x-") { m.rotation.z = Math.PI / 2; m.position.x = -longueur / 2 - rayon; }
      if (axe === "y+") m.position.y = longueur / 2 + rayon;
      if (axe === "y-") m.position.y = -longueur / 2 - rayon;
      g.add(m);
    }
    return g;
  }
  const v = (x, y, z = 0) => new THREE.Vector3(x, y, z);
  const hips = membre("hips", racine, v(0, 0.95), 0.13, 0.08, "y+");
  const spine = membre("spine", hips, v(0, 0.12), 0.12, 0.08, "y+");
  const chest = membre("chest", spine, v(0, 0.14), 0.14, 0.1, "y+");
  const upperChest = membre("upperChest", chest, v(0, 0.14), 0, 0);
  const neck = membre("neck", upperChest, v(0, 0.1), 0.045, 0.06, "y+");
  const head = membre("head", neck, v(0, 0.1), 0, 0);
  const crane = new THREE.Mesh(new THREE.SphereGeometry(0.11, 24, 18), mat); crane.scale.set(0.9, 1.1, 1); crane.position.y = 0.1; head.add(crane);
  for (const [cote, s] of [["left", 1], ["right", -1]]) {
    const epaule = membre(cote + "Shoulder", upperChest, v(0.06 * s, 0.05), 0, 0);
    const haut = membre(cote + "UpperArm", epaule, v(0.12 * s, 0), 0.045, 0.2, s > 0 ? "x+" : "x-");
    const bas = membre(cote + "LowerArm", haut, v(0.29 * s, 0), 0.038, 0.18, s > 0 ? "x+" : "x-");
    membre(cote + "Hand", bas, v(0.26 * s, 0), 0.035, 0.06, s > 0 ? "x+" : "x-");
    const cuisse = membre(cote + "UpperLeg", hips, v(0.09 * s, -0.04), 0.065, 0.32, "y-");
    membre(cote + "LowerLeg", cuisse, v(0, -0.44), 0.05, 0.34, "y-");
  }
  // objet qui imite l'interface VRM utilisée par le moteur de mouvements
  return { scene: racine, humanoid: { getNormalizedBoneNode: (n) => os[n] || null }, update() {}, expressionManager: null, lookAt: null };
}
