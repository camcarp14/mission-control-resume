// Load a GLB through the EXACT loader stack the site uses — three-stdlib's
// GLTFLoader with the meshopt decoder drei wires by default — and print the
// numbers Dressing.tsx actually derives from the file: the world-space bbox
// (which `fitGltfScene` turns into scale + recentring offset) and the mesh
// inventory. If EXT_meshopt_compression were unreadable this throws; if the
// quantisation node transform were dropped the bbox would explode.
import { readFileSync } from 'node:fs';
import * as THREE from '/home/user/hyperscaler/node_modules/three/build/three.module.js';
import { GLTFLoader, MeshoptDecoder } from '/home/user/hyperscaler/node_modules/three-stdlib/index.js';

// GLTFLoader resolves textures through the DOM image path; Node has none, and
// a stub is enough because nothing here measures pixels.
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
globalThis.self = globalThis;
globalThis.URL.createObjectURL = () => 'blob:stub';
globalThis.URL.revokeObjectURL = () => {};
THREE.ImageBitmapLoader.prototype.load = function (_u, onLoad) {
  onLoad({ width: 1, height: 1, close() {} });
};
THREE.TextureLoader.prototype.load = function (_u, onLoad) {
  const t = new THREE.Texture();
  if (onLoad) onLoad(t);
  return t;
};

const path = process.argv[2];
const buf = readFileSync(path);
const loader = new GLTFLoader();
loader.setMeshoptDecoder(typeof MeshoptDecoder === 'function' ? MeshoptDecoder() : MeshoptDecoder);

const gltf = await new Promise((res, rej) =>
  loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej),
);

const box = new THREE.Box3().setFromObject(gltf.scene);
const size = new THREE.Vector3();
const center = new THREE.Vector3();
box.getSize(size);
box.getCenter(center);
let tris = 0;
let meshes = 0;
gltf.scene.traverse((o) => {
  if (!o.isMesh) return;
  meshes++;
  const g = o.geometry;
  tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
});
console.log(JSON.stringify({
  file: path,
  bboxMin: box.min.toArray().map((v) => +v.toFixed(5)),
  bboxMax: box.max.toArray().map((v) => +v.toFixed(5)),
  size: size.toArray().map((v) => +v.toFixed(5)),
  center: center.toArray().map((v) => +v.toFixed(5)),
  // What LostAstronaut ends up applying: fitGltfScene(scene, 2.5, byHeight).
  fitScale: +(2.5 / size.y).toFixed(6),
  meshes,
  tris,
  animations: gltf.animations.length,
}, null, 2));
