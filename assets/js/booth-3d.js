import * as THREE from 'three';
import { GLTFLoader } from '../vendor/three/GLTFLoader.js';

const host = document.getElementById('booth-3d');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const models = new Map();
const loading = new Map();
const paths = { invizible: '/assets/models/doom-booth.glb', maverick: '/assets/models/maverick-booth.glb' };
let persona = document.body.classList.contains('theme-maverick') ? 'maverick' : 'invizible';
let merchOpen = document.body.classList.contains('merch-open');
let active;
let renderer;
let lastFrame;
let nextScratch = 15;
let elapsed = 0;
let failed = false;
let inView = true;
const axis = new THREE.Vector3(0, 0, 1);
const rotation = new THREE.Quaternion();
const scratchQuaternion = new THREE.Quaternion();
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-.54, .54, .5, -.5, .01, 10);
camera.position.set(0, .46, 3);
camera.lookAt(0, .46, 0);
scene.add(new THREE.HemisphereLight(0xe8f0ff, 0x62594e, 2.2));
const key = new THREE.DirectionalLight(0xffffff, 3.2);
key.position.set(-1, 2, 3);
scene.add(key);
const fill = new THREE.DirectionalLight(0xb5d9cf, 1.2);
fill.position.set(2, 1, 1);
scene.add(fill);

function play(model, mode, instant = false) {
  const action = model.actions[mode];
  if (!action) return;
  const previous = model.action;
  model.mode = mode;
  model.action = action;
  model.contact = false;
  action.reset().setEffectiveTimeScale(1).setEffectiveWeight(1);
  action.setLoop(mode === 'idle' ? THREE.LoopRepeat : THREE.LoopOnce, mode === 'idle' ? Infinity : 1);
  action.clampWhenFinished = mode !== 'idle';
  action.play();
  if (instant || reduced.matches) {
    model.mixer.stopAllAction();
    action.reset().play();
    action.time = mode === 'merch' ? action.getClip().duration : 0;
    action.paused = true;
    model.mixer.update(0);
  } else if (previous && previous !== action) {
    action.crossFadeFrom(previous, .18, false);
  }
  host.dataset.animation = mode;
}

async function loadModel(id) {
  if (models.has(id)) return models.get(id);
  if (loading.has(id)) return loading.get(id);
  const promise = (async () => {
    const gltf = await new GLTFLoader().loadAsync(paths[id]);
    const mixer = new THREE.AnimationMixer(gltf.scene);
    const right = gltf.scene.getObjectByName('Vinyl_Right');
    const left = gltf.scene.getObjectByName('Vinyl_Left');
    if (!right || !left) throw new Error('The booth records are missing.');
    const clips = {};
    let scratchTrack;
    for (const source of gltf.animations) {
      const clip = source.clone();
      const mode = /MERCH_CLOSE$/i.test(clip.name) ? 'close' : /MERCH$/i.test(clip.name) ? 'merch' : /Scratch$/i.test(clip.name) ? 'scratch' : /Idle$/i.test(clip.name) ? 'idle' : null;
      if (!mode) continue;
      const discTrack = clip.tracks.find(track => track.name === `${right.name}.quaternion`);
      if (mode === 'scratch') scratchTrack = discTrack;
      clip.tracks = clip.tracks.filter(track => track !== discTrack);
      clips[mode] = clip;
    }
    if (['idle','scratch','merch','close'].some(mode => !clips[mode]) || !scratchTrack) {
      throw new Error('A required booth animation is missing.');
    }
    const model = {
      root: gltf.scene, mixer, actions: Object.fromEntries(Object.entries(clips).map(([mode, clip]) => [mode, mixer.clipAction(clip)])),
      right, left, baseRight: right.quaternion.clone(), baseLeft: left.quaternion.clone(),
      scratch: scratchTrack.createInterpolant(), angle: 0, leftAngle: 0, contact: false,
      contactStart: .875, contactEnd: 2.333333, mode: 'idle'
    };
    gltf.scene.traverse(object => {
      if (!object.isMesh) return;
      // Transparent PNG edges stay cut out while the booth can occlude legs.
      if (object.name === 'Deck_reference_plane' || object.name.startsWith('Vinyl_')) {
        object.material.alphaTest = .03;
        object.material.depthWrite = true;
      }
      if (object.name.startsWith('Vinyl_')) object.renderOrder = 1;
    });
    mixer.addEventListener('finished', event => {
      if (event.action !== model.action) return;
      if (model.mode === 'scratch' || model.mode === 'close') {
        play(model, merchOpen ? 'merch' : 'idle');
        nextScratch = elapsed + 12 + Math.random() * 10;
      }
      // Merch remains clamped on its final pose until the close event.
    });
    gltf.scene.visible = false;
    scene.add(gltf.scene);
    models.set(id, model);
    return model;
  })();
  loading.set(id, promise);
  try { return await promise; } finally { loading.delete(id); }
}

async function selectModel(id) {
  persona = id;
  // Keep the old image booth hidden while the requested model loads.
  document.body.classList.add('booth-3d-loading');
  document.body.classList.remove('booth-3d-ready');
  host.style.visibility = 'hidden';
  try {
    const model = await loadModel(id);
    if (persona !== id || failed) return;
    for (const other of models.values()) other.root.visible = other === model;
    active = model;
    play(model, merchOpen ? 'merch' : 'idle');
    host.dataset.persona = id;
    resize();
    model.mixer.update(0);
    renderer.render(scene, camera);
    host.style.visibility = '';
    document.body.classList.add('booth-3d-ready');
    document.body.classList.remove('booth-3d-loading');
    clearTimeout(window.boothFallbackTimer);
    nextScratch = elapsed + 12 + Math.random() * 10;
  } catch (error) {
    if (persona !== id) return;
    document.body.classList.remove('booth-3d-ready', 'booth-3d-loading');
    clearTimeout(window.boothFallbackTimer);
    host.style.visibility = 'hidden';
    console.error('[3D booth]', error);
  }
}

function updateRecords(model, dt) {
  if (reduced.matches) return;
  const t = model.action.time;
  const contact = model.mode === 'scratch' && t >= model.contactStart && t <= model.contactEnd;
  if (contact) {
    if (!model.contact) model.contactAngle = model.angle;
    scratchQuaternion.fromArray(model.scratch.evaluate(t));
    const local = model.baseRight.clone().invert().multiply(scratchQuaternion);
    model.angle = model.contactAngle + 2 * Math.atan2(local.z, local.w);
  } else {
    model.angle += dt * Math.PI * 2 * (33 + 1/3) / 60;
  }
  model.contact = contact;
  model.leftAngle += dt * Math.PI * 2 * (33 + 1/3) / 60;
  model.right.quaternion.copy(model.baseRight).multiply(rotation.setFromAxisAngle(axis, model.angle));
  model.left.quaternion.copy(model.baseLeft).multiply(rotation.setFromAxisAngle(axis, model.leftAngle));
  host.dataset.record = contact ? 'scratch' : 'spin';
}

function resize() {
  const { width, height } = host.getBoundingClientRect();
  if (!width || !height || !renderer) return;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.setSize(width, height, false);
  camera.left = -.5 * width / height;
  camera.right = .5 * width / height;
  camera.updateProjectionMatrix();
}
function frame(now) {
  requestAnimationFrame(frame);
  const dt = lastFrame == null ? 0 : Math.min((now-lastFrame)/1000, .05);
  lastFrame = now;
  if (document.hidden || !inView || failed || !active || !document.body.classList.contains('booth-3d-ready')) return;
  elapsed += dt;
  if (!reduced.matches && !merchOpen && active.mode === 'idle' && elapsed >= nextScratch) play(active, 'scratch');
  active.mixer.update(dt);
  updateRecords(active, dt);
  renderer.render(scene, camera);
}

window.addEventListener('booth-persona', event => selectModel(event.detail.persona));
window.addEventListener('booth-merch', event => {
  merchOpen = event.detail.open;
  if (active) play(active, merchOpen ? 'merch' : reduced.matches ? 'idle' : 'close');
});
window.addEventListener('booth-interact', () => {
  if (active?.mode === 'idle' && !merchOpen && !reduced.matches) play(active, 'scratch');
});
reduced.addEventListener('change', () => {
  if (active) play(active, merchOpen ? 'merch' : 'idle');
});
try {
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  host.appendChild(renderer.domElement);
  renderer.domElement.addEventListener('webglcontextlost', event => {
    event.preventDefault(); failed = true;
    document.body.classList.remove('booth-3d-ready', 'booth-3d-loading');
    clearTimeout(window.boothFallbackTimer);
    host.style.visibility = 'hidden';
  });
  renderer.domElement.addEventListener('webglcontextrestored', () => {
    failed = false; selectModel(persona);
  });
  new ResizeObserver(resize).observe(host);
  new IntersectionObserver(entries => { inView = entries[0].isIntersecting; }).observe(host);
  resize();
  selectModel(persona).then(() => {
    // Load the alternate DJ after the initial booth is interactive.
    const preload = () => loadModel(persona === 'invizible' ? 'maverick' : 'invizible').catch(() => {});
    if ('requestIdleCallback' in window) requestIdleCallback(preload); else setTimeout(preload, 1500);
  });
  requestAnimationFrame(frame);
} catch (error) {
  document.body.classList.remove('booth-3d-loading');
  clearTimeout(window.boothFallbackTimer);
  host.style.visibility = 'hidden';
  console.error('[3D booth]', error);
}
