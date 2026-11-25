// Style hologramme : corps cyan translucide (bords lumineux, lignes de balayage, scintillement),
// fil de fer superposé, particules qui s'échappent du corps, et bloom (halo lumineux).
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

export const QUALITES = {
  bas:   { pixelRatio: 0.75, bloom: false, particules: 500,  filDeFer: false },
  moyen: { pixelRatio: 1.0,  bloom: true,  particules: 1500, filDeFer: true },
  eleve: { pixelRatio: Math.min(devicePixelRatio, 2), bloom: true, particules: 3500, filDeFer: true },
};

// valeurs communes à tous les matériaux du corps
export const lueur = {
  uTemps: { value: 0 },
  uIntensite: { value: 0.8 },   // 0.8 au repos, plus fort quand elle écoute ou parle
  uCouleur: { value: new THREE.Color(0x35e0ff) },
};

// matériau hologramme : garde le squelette et les expressions du modèle (skinning + morph targets)
export function materiauHologramme() {
  const m = new THREE.MeshBasicMaterial({ color: 0x0a3a48, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.FrontSide });
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, lueur);
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vN; varying vec3 vV; varying vec3 vMonde;")
      .replace("#include <project_vertex>", `#include <project_vertex>
        vMonde = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vN = normalize(normalMatrix * objectNormal);
        vV = normalize(-mvPosition.xyz);`);
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", `#include <common>
        uniform float uTemps, uIntensite; uniform vec3 uCouleur;
        varying vec3 vN; varying vec3 vV; varying vec3 vMonde;`)
      .replace("#include <dithering_fragment>", `#include <dithering_fragment>
        float fresnel = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);   // bords lumineux
        float balayage = 0.55 + 0.45 * sin(vMonde.y * 140.0 - uTemps * 4.0);       // lignes horizontales qui defilent
        float bande = smoothstep(0.0, 0.04, abs(fract(vMonde.y * 0.35 - uTemps * 0.25) - 0.5) - 0.44);   // bande lumineuse qui monte
        float scint = 0.92 + 0.08 * sin(uTemps * 37.0 + vMonde.y * 9.0) * sin(uTemps * 11.0);
        vec3 c = uCouleur * (0.025 + fresnel * 0.55) * balayage + uCouleur * bande * 0.12;
        gl_FragColor = vec4(c * uIntensite * scint, 1.0);`);
  };
  return m;
}

export function materiauFilDeFer() {
  const m = new THREE.MeshBasicMaterial({ color: 0x1fb8e8, wireframe: true, transparent: true, opacity: 0.035,
    depthWrite: false, blending: THREE.AdditiveBlending });
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, lueur);
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uIntensite;")
      .replace("#include <dithering_fragment>", "#include <dithering_fragment>\ngl_FragColor.rgb *= uIntensite;");
  };
  return m;
}

// applique le style à tout le modèle ; ajoute un double « fil de fer » à chaque maillage
export function habiller(racine, qualite) {
  const filsDeFer = [];
  racine.traverse((o) => {
    if (!o.isMesh) return;
    o.material = materiauHologramme();
    o.frustumCulled = false;
    o.renderOrder = 1;
    if (QUALITES[qualite].filDeFer) {
      const f = o.isSkinnedMesh ? new THREE.SkinnedMesh(o.geometry, materiauFilDeFer()) : new THREE.Mesh(o.geometry, materiauFilDeFer());
      if (o.isSkinnedMesh) f.bind(o.skeleton, o.bindMatrix);
      f.morphTargetInfluences = o.morphTargetInfluences;      // suit aussi les expressions du visage
      f.morphTargetDictionary = o.morphTargetDictionary;
      f.frustumCulled = false; f.renderOrder = 2;
      o.parent.add(f); filsDeFer.push(f);
    }
  });
  return filsDeFer;
}

// ------------------------------------------------------------------ particules qui s'échappent du corps
export class Particules {
  constructor(scene, nombre) {
    this.n = nombre;
    this.pos = new Float32Array(nombre * 3); this.vit = new Float32Array(nombre * 3); this.vie = new Float32Array(nombre);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute("aVie", new THREE.BufferAttribute(this.vie, 1));
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { ...lueur, uTaille: { value: 3.0 } },
      vertexShader: `attribute float aVie; uniform float uTaille; varying float vVie;
        void main(){ vVie = aVie; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = uTaille * (2.0 / -mv.z) * (0.5 + aVie); }`,
      fragmentShader: `uniform vec3 uCouleur; uniform float uIntensite; varying float vVie;
        void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5 || vVie <= 0.0) discard;
          gl_FragColor = vec4(uCouleur * (1.2 - d * 2.0) * uIntensite, vVie); }`,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.reste = 0;
    this.tourbillon = 0;   // > 0 quand elle réfléchit : les particules tournent autour d'elle
  }
  // sources : positions des os (dans le monde), choisies au hasard
  maj(dt, sources, debit, centre) {
    this.reste += debit * dt;
    while (this.reste > 1 && sources.length) {
      this.reste--;
      const i = Math.floor(Math.random() * this.n), s = sources[Math.floor(Math.random() * sources.length)];
      this.pos[i * 3] = s.x + (Math.random() - 0.5) * 0.12; this.pos[i * 3 + 1] = s.y + (Math.random() - 0.5) * 0.12; this.pos[i * 3 + 2] = s.z + (Math.random() - 0.5) * 0.12;
      this.vit[i * 3] = (Math.random() - 0.5) * 0.08; this.vit[i * 3 + 1] = 0.05 + Math.random() * 0.15; this.vit[i * 3 + 2] = (Math.random() - 0.5) * 0.08;
      this.vie[i] = 0.5 + Math.random() * 0.5;
    }
    for (let i = 0; i < this.n; i++) {
      if (this.vie[i] <= 0) continue;
      this.vie[i] -= dt * 0.45;
      if (this.tourbillon > 0.01) {   // tourbillon autour de l'axe vertical du corps
        const dx = this.pos[i * 3] - centre.x, dz = this.pos[i * 3 + 2] - centre.z;
        this.vit[i * 3] += -dz * this.tourbillon * dt * 3; this.vit[i * 3 + 2] += dx * this.tourbillon * dt * 3;
      }
      this.pos[i * 3] += this.vit[i * 3] * dt; this.pos[i * 3 + 1] += this.vit[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vit[i * 3 + 2] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.aVie.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ rendu avec ou sans bloom
export function creerRendu(rendu, scene, camera, qualite) {
  const q = QUALITES[qualite];
  rendu.setPixelRatio(q.pixelRatio);
  if (!q.bloom) return { render: () => rendu.render(scene, camera), setSize: () => {} };
  const composer = new EffectComposer(rendu);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.7, 0.4, 0.12);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  return { render: () => composer.render(), setSize: (l, h) => { composer.setSize(l, h); bloom.setSize(l, h); }, bloom };
}
