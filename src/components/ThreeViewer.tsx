import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RotateCcw, Pause, Play, ZoomIn, ZoomOut, Box } from 'lucide-react';
import type { Product } from '../types';

interface ThreeViewerProps {
  products: Product[];
  selectedModel: string;
  onSelectModel: (model: string) => void;
}

function makeMat(color: number, metal = 0, rough = 0.45) {
  return new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough });
}

function addBox(
  parent: THREE.Group,
  w: number,
  h: number,
  d: number,
  m: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
  rx = 0,
  ry = 0,
  rz = 0
) {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  o.position.set(x, y, z);
  o.rotation.set(rx, ry, rz);
  parent.add(o);
  return o;
}

function addCyl(
  parent: THREE.Group,
  r1: number,
  r2: number,
  h: number,
  m: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
  segments = 32
) {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, segments), m);
  o.position.set(x, y, z);
  parent.add(o);
  return o;
}

function addTorus(
  parent: THREE.Group,
  r: number,
  t: number,
  m: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
  rx = 0
) {
  const o = new THREE.Mesh(new THREE.TorusGeometry(r, t, 12, 64), m);
  o.position.set(x, y, z);
  o.rotation.x = rx;
  parent.add(o);
  return o;
}

function addSphere(
  parent: THREE.Group,
  r: number,
  m: THREE.Material,
  x = 0,
  y = 0,
  z = 0
) {
  const o = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), m);
  o.position.set(x, y, z);
  parent.add(o);
  return o;
}

function buildProductMesh(type: string): THREE.Group {
  const root = new THREE.Group();
  const dark = makeMat(0x1e293b, 0.65, 0.38);
  const black = makeMat(0x0f172a, 0.35, 0.5);
  const silver = makeMat(0xcbd5e1, 0.78, 0.28);
  const glass = makeMat(0x1e3a5f, 0.7, 0.14);
  const teal = makeMat(0x0d9488, 0.35, 0.35);
  const amber = makeMat(0xf59e0b, 0.25, 0.4);
  const rubber = makeMat(0x334155, 0.1, 0.8);

  if (type === 'camera' || type === 'webcam') {
    addBox(root, 1.65, 0.95, 0.72, dark);
    addBox(root, 0.85, 0.18, 0.76, black, 0, 0.56, 0);
    addCyl(root, 0.48, 0.48, 0.35, black, 0, 0, 0.48, 48);
    addCyl(root, 0.34, 0.34, 0.37, glass, 0, 0, 0.69, 48);
    addCyl(root, 0.22, 0.22, 0.39, teal, 0, 0, 0.73, 48);
    addSphere(root, 0.09, makeMat(0x67e8f9, 0.6, 0.1), -0.47, 0.2, 0.37);
    addBox(root, 0.25, 0.12, 0.16, silver, 0.5, 0.42, 0.18);
    if (type === 'webcam') {
      addBox(root, 0.5, 0.12, 0.18, black, 0, -0.58, 0);
      addBox(root, 0.14, 0.35, 0.13, silver, 0, -0.78, 0);
    }
  } else if (type === 'laptop') {
    addBox(root, 1.9, 0.12, 1.25, silver, 0, -0.45, 0);
    addBox(root, 1.78, 1.1, 0.09, dark, 0, 0.12, -0.57, -0.08);
    addBox(root, 1.57, 0.88, 0.025, glass, 0, 0.14, -0.51, -0.08);
    addBox(root, 0.42, 0.018, 0.25, makeMat(0x64748b), 0, -0.37, 0.05);
  } else if (type === 'projector') {
    addBox(root, 1.7, 0.65, 1.25, makeMat(0xe2e8f0, 0.25));
    addCyl(root, 0.37, 0.37, 0.18, black, 0, 0.02, 0.67, 48);
    addCyl(root, 0.28, 0.28, 0.2, glass, 0, 0.02, 0.76, 48);
    addBox(root, 0.35, 0.08, 0.22, dark, -0.52, -0.37, 0.35);
    for (let i = -2; i <= 2; i++) addBox(root, 0.06, 0.22, 0.04, rubber, i * 0.2, -0.05, -0.65);
  } else if (type === 'mic') {
    addCyl(root, 0.24, 0.28, 1.35, dark, 0, 0.05, 0, 40);
    addCyl(root, 0.26, 0.26, 0.42, silver, 0, 0.78, 0, 40);
    addSphere(root, 0.25, black, 0, 0.98, 0);
    for (let i = 0; i < 5; i++) addTorus(root, 0.2, 0.018, silver, 0, 0.85 + i * 0.045, 0, Math.PI / 2);
    addCyl(root, 0.1, 0.1, 0.45, black, 0, -0.83, 0);
  } else if (type === 'speaker') {
    addBox(root, 1.15, 1.65, 0.72, dark);
    addCyl(root, 0.37, 0.37, 0.12, black, 0, 0.35, 0.4);
    addCyl(root, 0.29, 0.29, 0.13, silver, 0, 0.35, 0.48);
    addCyl(root, 0.19, 0.19, 0.14, black, 0, 0.35, 0.55);
    addCyl(root, 0.19, 0.19, 0.12, black, 0, -0.35, 0.4);
    addCyl(root, 0.11, 0.11, 0.13, teal, 0, -0.35, 0.48);
    addBox(root, 0.24, 0.07, 0.03, amber, 0, 0.68, 0.38);
  } else if (type === 'tripod') {
    addCyl(root, 0.12, 0.12, 1.35, silver, 0, 0.15, 0);
    addCyl(root, 0.2, 0.2, 0.16, dark, 0, 0.85, 0);
    for (let a = 0; a < 3; a++) {
      const ang = (a * Math.PI * 2) / 3;
      addBox(
        root,
        0.11,
        1.55,
        0.12,
        silver,
        Math.sin(ang) * 0.5,
        -0.48,
        Math.cos(ang) * 0.5,
        Math.cos(ang) * 0.45,
        0,
        -Math.sin(ang) * 0.45
      );
    }
    addBox(root, 0.65, 0.12, 0.45, black, 0, 1.0, 0);
    addCyl(root, 0.12, 0.12, 0.25, teal, 0, 1.2, 0);
  } else if (type === 'ring') {
    addCyl(root, 0.08, 0.08, 1.65, silver, 0, -0.05, 0);
    for (let a = 0; a < 3; a++) {
      const ang = (a * Math.PI * 2) / 3;
      addBox(
        root,
        0.09,
        1.2,
        0.09,
        silver,
        Math.sin(ang) * 0.43,
        -0.78,
        Math.cos(ang) * 0.43,
        Math.cos(ang) * 0.5,
        0,
        -Math.sin(ang) * 0.5
      );
    }
    addTorus(root, 0.83, 0.11, makeMat(0xfef3c7, 0.2), 0, 1.05, 0, Math.PI / 2);
    addTorus(root, 0.68, 0.045, makeMat(0xffffff, 0.1), 0, 1.05, 0.02, Math.PI / 2);
    addCyl(root, 0.12, 0.12, 0.22, black, 0, 1.05, 0);
  } else if (type === 'workstation') {
    addBox(root, 1.25, 1.65, 0.9, dark);
    addBox(root, 1.12, 0.12, 0.78, black, 0, -0.82, 0);
    for (let i = 0; i < 3; i++) addBox(root, 0.09, 0.09, 0.04, teal, -0.35 + i * 0.3, 0.45, 0.47);
    for (let i = 0; i < 5; i++) addBox(root, 0.035, 0.55, 0.035, silver, -0.45 + i * 0.22, -0.05, 0.47);
    addBox(root, 1.25, 0.09, 0.9, silver, 0, 0.88, 0);
  } else if (type === 'server' || type === 'nas' || type === 'firewall') {
    const h = type === 'server' ? 2.15 : 1.25;
    addBox(root, 1.45, h, 0.85, dark);
    const bays = type === 'server' ? 5 : 3;
    for (let i = 0; i < bays; i++) {
      const y = -h / 2 + 0.22 + (i * (h - 0.42)) / (bays - 1);
      addBox(root, 1.18, 0.27, 0.045, black, 0, y, 0.45);
      for (let j = 0; j < 4; j++) addBox(root, 0.07, 0.12, 0.035, j % 2 ? teal : silver, -0.45 + j * 0.22, y, 0.49);
      for (let j = 0; j < 3; j++) addCyl(root, 0.035, 0.035, 0.035, amber, 0.35 + j * 0.13, y, 0.5, 16);
    }
  } else if (type === 'router' || type === 'switch') {
    addBox(root, 2.05, 0.38, 0.9, dark);
    addBox(root, 1.95, 0.08, 0.82, silver, 0, -0.2, 0);
    const ports = type === 'switch' ? 24 : 6;
    for (let i = 0; i < ports; i++) {
      const x = -0.9 + (i % 12) * 0.16;
      const y = i < 12 ? 0.02 : -0.08;
      addBox(root, 0.09, 0.12, 0.04, black, x, y, 0.47);
      addBox(root, 0.035, 0.035, 0.02, teal, x, y + 0.06, 0.5);
    }
    for (let i = 0; i < 2; i++) addCyl(root, 0.035, 0.035, 0.55, silver, -0.75 + i * 1.5, 0.4, -0.2, 16);
  } else if (type === 'splicer') {
    addBox(root, 1.45, 0.32, 0.95, dark, 0, -0.2, 0);
    addBox(root, 1.15, 0.65, 0.08, black, 0, 0.25, -0.25, -0.25);
    addBox(root, 0.8, 0.38, 0.035, glass, 0, 0.28, -0.19, -0.25);
    addBox(root, 0.45, 0.08, 0.4, silver, 0, 0.35, 0.32);
    addCyl(root, 0.08, 0.08, 0.25, teal, -0.48, -0.34, 0.35, 24);
    addCyl(root, 0.08, 0.08, 0.25, teal, 0.48, -0.34, 0.35, 24);
  } else if (type === 'otdr') {
    addBox(root, 1.15, 1.45, 0.28, dark);
    addBox(root, 0.9, 0.68, 0.035, glass, 0, 0.25, 0.16);
    addBox(root, 0.45, 0.08, 0.025, teal, 0, -0.3, 0.17);
    for (let i = 0; i < 4; i++) addBox(root, 0.12, 0.08, 0.04, silver, -0.3 + i * 0.2, -0.53, 0.17);
    addCyl(root, 0.07, 0.07, 0.08, amber, -0.42, -0.72, 0.17, 20);
  } else if (type === 'pickplace') {
    addBox(root, 2.1, 0.18, 1.35, silver, 0, -0.65, 0);
    addBox(root, 1.8, 0.12, 1.05, dark, 0, -0.48, 0);
    addBox(root, 0.14, 1.35, 0.14, silver, -0.72, 0.2, 0);
    addBox(root, 0.14, 1.35, 0.14, silver, 0.72, 0.2, 0);
    addBox(root, 1.6, 0.12, 0.14, dark, 0, 0.82, 0);
    addBox(root, 0.18, 0.75, 0.18, teal, 0.25, 0.35, 0);
    addCyl(root, 0.08, 0.08, 0.5, silver, 0.25, -0.2, 0, 20);
    addBox(root, 0.55, 0.06, 0.4, black, 0, -0.3, 0.35);
  } else if (type === 'cnc') {
    addBox(root, 1.8, 0.18, 1.5, dark, 0, -0.65, 0);
    for (const x of [-0.78, 0.78]) addBox(root, 0.12, 1.5, 0.12, silver, x, 0.1, 0);
    addBox(root, 1.65, 0.12, 0.15, silver, 0, 0.83, 0);
    addBox(root, 0.35, 0.55, 0.35, teal, 0, 0.48, 0);
    addCyl(root, 0.08, 0.08, 0.48, black, 0, 0.05, 0, 24);
    addBox(root, 1.25, 0.06, 0.85, makeMat(0x64748b, 0.3), 0, -0.52, 0);
  } else if (type === 'bga') {
    addBox(root, 1.5, 0.4, 1.05, dark, 0, -0.35, 0);
    addBox(root, 0.85, 0.75, 0.55, black, 0, 0.25, 0);
    addBox(root, 0.6, 0.08, 0.4, glass, 0, 0.62, 0);
    addCyl(root, 0.12, 0.12, 0.5, silver, -0.52, 0.28, 0, 24);
    addCyl(root, 0.12, 0.12, 0.5, silver, 0.52, 0.28, 0, 24);
    addBox(root, 0.6, 0.1, 0.6, teal, 0, -0.08, 0.62);
  } else if (type === 'thermal') {
    addBox(root, 1.15, 0.85, 0.55, dark);
    addBox(root, 0.68, 0.5, 0.035, glass, 0, 0.05, 0.3);
    addCyl(root, 0.2, 0.2, 0.22, black, 0, -0.1, 0.48, 32);
    addCyl(root, 0.13, 0.13, 0.24, amber, 0, -0.1, 0.58, 32);
    addBox(root, 0.35, 0.1, 0.25, silver, 0, -0.5, 0);
  } else if (type === 'printer') {
    addBox(root, 1.8, 1.9, 1.35, dark);
    addBox(root, 1.35, 1.25, 0.05, glass, 0, 0.05, 0.7);
    addBox(root, 1.1, 0.08, 0.85, silver, 0, -0.7, 0.05);
    for (const x of [-0.5, 0.5]) addBox(root, 0.08, 1.35, 0.08, silver, x, 0.08, 0.35);
    addBox(root, 0.25, 0.18, 0.25, teal, 0, 0.25, 0.2);
    addBox(root, 0.55, 0.08, 0.45, amber, 0, -0.58, 0.1);
  } else {
    // oscilloscope, spectrum, functiongen, powersupply, vna, electronicload, logicanalyzer
    addBox(root, 1.75, 1.2, 0.72, dark);
    addBox(root, 1.05, 0.7, 0.035, glass, -0.28, 0.18, 0.38);
    addBox(root, 0.82, 0.035, 0.025, teal, -0.28, 0.18, 0.41);
    for (let i = 0; i < 5; i++) addBox(root, 0.13, 0.05, 0.025, i % 2 ? amber : silver, -0.6 + i * 0.16, 0.43, 0.42);
    for (let i = 0; i < 3; i++) addCyl(root, 0.11, 0.11, 0.07, silver, 0.55, 0.34 - i * 0.28, 0.4, 24);
    for (let i = 0; i < 4; i++) addCyl(root, 0.055, 0.055, 0.05, amber, 0.35 + i * 0.17, -0.43, 0.4, 16);
    addBox(root, 1.8, 0.08, 0.75, silver, 0, -0.64, 0);
  }

  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return root;
}

export const ThreeViewer: React.FC<ThreeViewerProps> = ({
  products,
  selectedModel,
  onSelectModel,
}) => {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rootRef = useRef<THREE.Group | null>(null);
  const spinRef = useRef(true);
  const dragRef = useRef({ active: false, lastX: 0, lastY: 0 });

  const [spinning, setSpinning] = useState(true);
  const [webglError, setWebglError] = useState(false);

  const activeProduct = products.find((p) => p.model === selectedModel) || products[0];

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    } catch {
      setWebglError(true);
      return;
    }

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(3.7, 2.6, 5.2);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Three-point studio lighting
    scene.add(new THREE.HemisphereLight(0xffffff, 0x1e293b, 1.6));
    const keyLight = new THREE.DirectionalLight(0xfffbeb, 2.0);
    keyLight.position.set(4, 6, 5);
    keyLight.castShadow = true;
    scene.add(keyLight);

    const fillLight = new THREE.PointLight(0x0d9488, 1.4);
    fillLight.position.set(-4, 1, 2);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0x94a3b8, 1.1);
    rimLight.position.set(-3, 4, -5);
    scene.add(rimLight);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(2.3, 64),
      new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.85, transparent: true, opacity: 0.45 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.5;
    scene.add(floor);

    const grid = new THREE.GridHelper(5, 18, 0x0d9488, 0x334155);
    grid.position.y = -1.49;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.22;
    scene.add(grid);

    const mesh = buildProductMesh(selectedModel || 'camera');
    rootRef.current = mesh;
    scene.add(mesh);

    const resize = () => {
      if (!stage) return;
      const w = stage.clientWidth;
      const h = stage.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();

    let animId = 0;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      if (rootRef.current && spinRef.current && !dragRef.current.active) {
        rootRef.current.rotation.y += 0.0055;
      }
      renderer.render(scene, camera);
    };
    animate();

    const onContextLost = (e: Event) => {
      e.preventDefault();
      setWebglError(true);
    };
    const onContextRestored = () => {
      setWebglError(false);
    };

    canvas.addEventListener('webglcontextlost', onContextLost);
    canvas.addEventListener('webglcontextrestored', onContextRestored);
    window.addEventListener('resize', resize);

    return () => {
      cancelAnimationFrame(animId);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      window.removeEventListener('resize', resize);
      renderer.dispose();
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (rootRef.current) {
      scene.remove(rootRef.current);
    }
    const nextMesh = buildProductMesh(selectedModel || 'camera');
    rootRef.current = nextMesh;
    scene.add(nextMesh);
  }, [selectedModel]);

  const handleReset = () => {
    if (rootRef.current) rootRef.current.rotation.set(0, 0, 0);
    if (cameraRef.current) {
      cameraRef.current.position.set(3.7, 2.6, 5.2);
      cameraRef.current.lookAt(0, 0, 0);
    }
  };

  const handleZoom = (factor: number) => {
    if (!cameraRef.current) return;
    cameraRef.current.position.multiplyScalar(1 / factor);
    cameraRef.current.position.clampLength(3, 10);
  };

  const toggleSpin = () => {
    spinRef.current = !spinRef.current;
    setSpinning(spinRef.current);
  };

  return (
    <div className="grid gap-10 lg:grid-cols-12 items-center">
      <div className="lg:col-span-5 space-y-5">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-cyan-500 text-white shadow-lg shadow-indigo-950/50">
            <Box className="h-7 w-7" />
          </div>
          <div>
            <p className="text-xs font-semibold tracking-wider uppercase text-cyan-300">
              Inspeksi 3D Interaktif
            </p>
            <h2 className="mt-0.5 text-2xl sm:text-3xl font-bold tracking-tight text-white text-balance">
              Lihat perlengkapan dari segala sudut sebelum meminjam.
            </h2>
          </div>
        </div>
        <p className="text-indigo-100/85 text-sm leading-relaxed">
          Pilih salah satu dari {products.length} peralatan laboratorium dan multimedia di bawah ini. Geser viewport untuk memutar objek 360 derajat atau gunakan kontrol zoom.
        </p>

        <div>
          <label htmlFor="modelSelect" className="block text-xs font-medium text-indigo-200 mb-2">
            Pilih Model Peralatan
          </label>
          <select
            id="modelSelect"
            value={selectedModel}
            onChange={(e) => onSelectModel(e.target.value)}
            className="w-full max-w-sm rounded-xl border border-indigo-400/35 bg-indigo-950/70 px-3.5 py-2.5 text-sm text-white focus:border-cyan-400 focus:outline-none"
          >
            {products.map((p) => (
              <option key={p.id} value={p.model}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="lg:col-span-7">
        <div className="rounded-2xl border border-indigo-400/25 bg-indigo-950/60 p-4 shadow-2xl backdrop-blur-sm">
          <div className="flex items-center justify-between pb-3 text-xs text-indigo-200">
            <span className="font-semibold text-white">{activeProduct?.name || 'Kamera DSLR'}</span>
            <span className="font-mono-tabular text-cyan-300">360° WebGL Preview</span>
          </div>

          <div
            ref={stageRef}
            onPointerDown={(e) => {
              dragRef.current = { active: true, lastX: e.clientX, lastY: e.clientY };
              (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!dragRef.current.active || !rootRef.current) return;
              rootRef.current.rotation.y += (e.clientX - dragRef.current.lastX) * 0.012;
              rootRef.current.rotation.x += (e.clientY - dragRef.current.lastY) * 0.009;
              dragRef.current.lastX = e.clientX;
              dragRef.current.lastY = e.clientY;
            }}
            onPointerUp={() => {
              dragRef.current.active = false;
            }}
            onPointerCancel={() => {
              dragRef.current.active = false;
            }}
            onWheel={(e) => {
              e.preventDefault();
              handleZoom(e.deltaY > 0 ? 0.92 : 1.08);
            }}
            className="relative h-80 w-full overflow-hidden rounded-xl bg-gradient-to-b from-slate-800 to-slate-950 cursor-grab active:cursor-grabbing touch-none"
          >
            {webglError ? (
              <div className="flex h-full flex-col items-center justify-center p-6 text-center text-slate-300">
                <img
                  src={activeProduct?.image}
                  alt={activeProduct?.name}
                  referrerPolicy="no-referrer"
                  className="mb-3 h-40 w-56 rounded-lg object-cover opacity-85"
                />
                <p className="text-xs">Mode pratinjau 2D aktif (WebGL tidak tersedia).</p>
              </div>
            ) : (
              <canvas ref={canvasRef} className="h-full w-full block" />
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-indigo-200/80">
              Geser untuk memutar · Scroll untuk zoom
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-400/30 bg-indigo-900/60 px-3.5 py-2 text-xs font-medium text-indigo-100 hover:bg-indigo-800/80 whitespace-nowrap shrink-0"
              >
                <RotateCcw className="h-4 w-4 text-cyan-300" /> Reset
              </button>
              <button
                type="button"
                onClick={toggleSpin}
                className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-400/30 bg-indigo-900/60 px-3.5 py-2 text-xs font-medium text-indigo-100 hover:bg-indigo-800/80 whitespace-nowrap shrink-0"
              >
                {spinning ? <Pause className="h-4 w-4 text-amber-300" /> : <Play className="h-4 w-4 text-emerald-300" />}
                {spinning ? 'Jeda' : 'Putar'}
              </button>
              <button
                type="button"
                onClick={() => handleZoom(1.15)}
                aria-label="Perbesar"
                className="inline-flex items-center justify-center rounded-xl border border-indigo-400/30 bg-indigo-900/60 p-2 text-indigo-100 hover:bg-indigo-800/80"
              >
                <ZoomIn className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => handleZoom(0.87)}
                aria-label="Perkecil"
                className="inline-flex items-center justify-center rounded-xl border border-indigo-400/30 bg-indigo-900/60 p-2 text-indigo-100 hover:bg-indigo-800/80"
              >
                <ZoomOut className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
