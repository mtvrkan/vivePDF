import { gsap } from "gsap";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { vp } from "./hero-state";

export function boot() {
  if (vp.still || vp.started || !vp.bg) return;
  const root = document.documentElement;
  const hero = document.querySelector<HTMLElement>(".hero") as HTMLElement;
  const canvas = document.getElementById("gl") as HTMLCanvasElement;
  const bg = vp.bg;
  const mobile = matchMedia("(max-width:959px)").matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.25 : 1.75));
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(root.dataset.theme === "dark" ? 0x060b15 : 0xeaf2fb, 1);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0, 0, 14);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.95;
  const tanH = Math.tan(THREE.MathUtils.degToRad(15));
  const vis0 = 2 * 14 * tanH;
  const visB = 2 * 19 * tanH;
  let tex: THREE.CanvasTexture | null = null;
  const planeMat = new THREE.MeshBasicMaterial({ toneMapped: false });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), planeMat);
  plane.position.z = -5;
  scene.add(plane);
  function setTex() {
    tex?.dispose();
    tex = new THREE.CanvasTexture(bg);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    planeMat.map = tex;
    planeMat.needsUpdate = true;
  }
  const P: Array<Array<[number, number]>> = [
    [
      [60, 60],
      [104, 60],
      [148, 196],
      [104, 196],
    ],
    [
      [152, 60],
      [176, 60],
      [189.6, 80],
      [152, 196],
      [108, 196],
    ],
    [
      [176, 60],
      [176, 80],
      [189.6, 80],
    ],
  ];
  const ext = { depth: 22, bevelEnabled: true, bevelThickness: 7, bevelSize: 4, bevelSegments: mobile ? 3 : 7, curveSegments: 2, steps: 1 };
  const geos = P.map((pts) => {
    const s = new THREE.Shape();
    pts.forEach(([x, y], i) => (i ? s.lineTo(x, -y) : s.moveTo(x, -y)));
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, ext);
    g.translate(-124.8, 128, -11);
    g.scale(1 / 40, 1 / 40, 1 / 40);
    return g;
  });
  const mk = (o: THREE.MeshPhysicalMaterialParameters) =>
    new THREE.MeshPhysicalMaterial({
      transmission: 1,
      thickness: 1.1,
      roughness: 0.06,
      metalness: 0,
      ior: 1.46,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      specularIntensity: 1,
      envMapIntensity: 1.3,
      attenuationDistance: 2.6,
      dispersion: mobile ? 0 : 3,
      ...o,
    });
  const mats = [
    mk({ color: 0xffffff, attenuationColor: new THREE.Color(0xe2f0ff) }),
    mk({ color: 0xcdeaff, attenuationColor: new THREE.Color(0x4aa8ff), attenuationDistance: 1.8 }),
    mk({ color: 0xf2f9ff, attenuationColor: new THREE.Color(0xbfe3ff), thickness: 0.7 }),
  ];
  const Z = [-0.47, 0.47, 0.62];
  const group = new THREE.Group();
  scene.add(group);
  const meshes = geos.map((g, i) => {
    const m = new THREE.Mesh(g, mats[i]);
    m.position.z = Z[i];
    group.add(m);
    return m;
  });
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(3, 4, 6);
  scene.add(key);
  const skyL = new THREE.PointLight(0x7fd0ff, 40, 30);
  skyL.position.set(-5, 2, 4);
  scene.add(skyL);
  const blueL = new THREE.PointLight(0x2f8fe6, 30, 30);
  blueL.position.set(5, -3, 2);
  scene.add(blueL);
  const amberL = new THREE.PointLight(0xffc46b, 26, 30);
  amberL.position.set(1.5, -5, 4);
  scene.add(amberL);
  const sweep = new THREE.PointLight(0xffffff, 0, 14);
  sweep.position.set(-6, 2, 3);
  scene.add(sweep);
  let W = 1;
  let H = 1;
  function resize() {
    W = hero.clientWidth;
    H = hero.clientHeight;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    plane.scale.set((visB * W) / H, visB, 1);
  }
  vp.onBg = () => {
    setTex();
    resize();
    kick();
  };
  vp.onTheme = (t) => {
    renderer.setClearColor(t === "dark" ? 0x060b15 : 0xeaf2fb, 1);
    mats.forEach((m) => {
      m.envMapIntensity = t === "dark" ? 1.7 : 1.3;
    });
    kick();
  };
  setTex();
  resize();
  const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  let nx = 0;
  let ny = 0;
  let rx = 0;
  let ry = 0;
  addEventListener(
    "pointermove",
    (e) => {
      nx = e.clientX / innerWidth - 0.5;
      ny = e.clientY / innerHeight - 0.5;
    },
    { passive: true },
  );
  let onScreen = true;
  let raf = 0;
  let lastO = -1;
  const t0 = performance.now();
  function frame() {
    raf = 0;
    const t = (performance.now() - t0) / 1000;
    const m = vp.mark;
    const lg = vp.logo;
    const p = vp.heroP || 0;
    const e = ease(Math.min(1, p / 0.82));
    rx += (ny * 0.22 - rx) * 0.05;
    ry += (nx * 0.32 - ry) * 0.05;
    const px = lerp(m.x, lg.x, e);
    const py = lerp(m.y, lg.y + p * H, e) + Math.sin(t * 0.9) * m.s * 0.012 * (1 - e);
    const sp = lerp(m.s, lg.s, e);
    group.position.set((px / W - 0.5) * vis0 * (W / H), -(py / H - 0.5) * vis0, 0);
    group.scale.setScalar(Math.max(0.001, ((sp / H) * vis0) / 3.4));
    group.rotation.set(rx + Math.sin(t * 0.5) * 0.05 + e * 0.5, ry + Math.sin(t * 0.35) * 0.12 + e * Math.PI * 2, Math.sin(t * 0.3) * 0.02);
    key.position.set(3 + nx * 6, 4 - ny * 4, 6);
    const o = 1 - Math.min(1, Math.max(0, (p - 0.6) / 0.28));
    if (Math.abs(o - lastO) > 0.004) {
      canvas.style.opacity = o.toFixed(3);
      lastO = o;
    }
    renderer.render(scene, camera);
    if (onScreen && !document.hidden && o > 0) raf = requestAnimationFrame(frame);
  }
  const kick = () => {
    if (!raf && onScreen && !document.hidden) raf = requestAnimationFrame(frame);
  };
  new IntersectionObserver((es) => {
    onScreen = es[0].isIntersecting;
    kick();
  }).observe(hero);
  document.addEventListener("visibilitychange", kick);
  addEventListener("scroll", kick, { passive: true });
  const F = [
    { p: [-7, 4.2, 3], r: [0.8, -1.4, 0.9] },
    { p: [7.4, -3.8, 2.4], r: [-0.7, 1.5, -0.8] },
    { p: [3.8, 5.8, 4.4], r: [1.7, 0.7, 1.2] },
  ];
  meshes.forEach((me, i) => {
    me.position.set(F[i].p[0], F[i].p[1], F[i].p[2]);
    me.rotation.set(F[i].r[0], F[i].r[1], F[i].r[2]);
  });
  renderer.render(scene, camera);
  if (renderer.getContext().isContextLost()) throw new Error("lost");
  if (vp.started) return;
  vp.started = true;
  clearTimeout(vp.timer);
  root.classList.add("gl-on");
  const tl = gsap.timeline({ delay: 0.15 });
  meshes.forEach((me, i) => {
    tl.to(me.position, { x: 0, y: 0, z: Z[i], duration: 1.6, ease: "elastic.out(.9,.68)" }, i * 0.09).to(me.rotation, { x: 0, y: 0, z: 0, duration: 1.4, ease: "expo.out" }, i * 0.09);
  });
  tl.fromTo(sweep.position, { x: -5, y: 2.5 }, { x: 5, y: -1.5, duration: 1.2, ease: "power2.inOut" }, 0.95).fromTo(sweep, { intensity: 0 }, { intensity: 140, duration: 0.45, yoyo: true, repeat: 1, ease: "sine.inOut" }, 0.95);
  vp.intro = tl;
  kick();
}
