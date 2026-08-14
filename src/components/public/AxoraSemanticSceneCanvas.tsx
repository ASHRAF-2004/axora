"use client";

import { Float, useGLTF } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { Group, Material, Mesh, MeshStandardMaterial, Object3D, PointsMaterial } from "three";
import { BufferAttribute, BufferGeometry, MathUtils, Vector3 } from "three";
import {
  PUBLIC_ATMOSPHERE_SCENES,
  SEMANTIC_MODEL_PATHS,
  type PublicAtmosphereId,
  type SemanticModelId,
} from "@/lib/immersive-public-experience";

function modelScale(model: SemanticModelId) {
  if (model === "deliver") return 1.55;
  if (model === "company") return 0.9;
  if (model === "person") return 1.45;
  if (model === "road") return 2.2;
  if (model === "network" || model === "track") return 1.35;
  return 1.8;
}

function SemanticModel({
  model,
  outgoing,
  reducedMotion,
}: {
  model: SemanticModelId;
  outgoing: boolean;
  reducedMotion: boolean;
}) {
  const group = useRef<Group>(null);
  const { scene } = useGLTF(SEMANTIC_MODEL_PATHS[model]);
  const clone = useMemo(() => {
    const next = scene.clone(true);
    const materials: Material[] = [];
    const meshes: Mesh[] = [];
    const wheels: Object3D[] = [];
    next.traverse((object: Object3D) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry = mesh.geometry.clone();
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const sourceMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const clonedMaterials = sourceMaterials.map((material) => {
        const cloned = material.clone() as MeshStandardMaterial;
        cloned.transparent = true;
        materials.push(cloned);
        return cloned;
      });
      mesh.material = Array.isArray(mesh.material) ? clonedMaterials : clonedMaterials[0];
      meshes.push(mesh);
      if (/wheel/i.test(object.name)) wheels.push(object);
    });
    return { root: next, materials, meshes, wheels };
  }, [scene]);
  useEffect(() => () => {
    clone.meshes.forEach((mesh) => mesh.geometry.dispose());
    clone.materials.forEach((material) => material.dispose());
  }, [clone]);
  const progress = useRef(outgoing ? 1 : 0);

  useFrame((state, delta) => {
    if (!group.current) return;
    const target = outgoing ? 0 : 1;
    progress.current = MathUtils.damp(progress.current, target, reducedMotion ? 20 : 6, delta);
    const eased = progress.current;
    const baseScale = modelScale(model);
    group.current.scale.setScalar(baseScale * (0.72 + eased * 0.28));
    group.current.rotation.y += reducedMotion ? 0 : delta * (model === "deliver" ? 0.08 : 0.16);
    group.current.position.y = (1 - eased) * (outgoing ? 0.6 : -0.7);
    if (model === "deliver" && !reducedMotion) {
      group.current.position.x = Math.sin(state.clock.elapsedTime * 0.8) * 0.65;
      clone.wheels.forEach((wheel) => { wheel.rotation.x -= delta * 4; });
    }
    clone.meshes.forEach((mesh) => {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((material) => {
        material.opacity = outgoing ? eased : Math.min(1, eased * 1.45);
      });
    });
  });

  return (
    <group ref={group} dispose={null}>
      <primitive object={clone.root} />
    </group>
  );
}

function sampleMeshPoints(root: Object3D, model: SemanticModelId, count: number) {
  root.updateMatrixWorld(true);
  const meshes: Mesh[] = [];
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (mesh.isMesh && mesh.geometry.getAttribute("position")?.count) meshes.push(mesh);
  });
  const sampled = new Float32Array(count * 3);
  const point = new Vector3();
  const scale = modelScale(model);
  for (let index = 0; index < count; index += 1) {
    const mesh = meshes[index % Math.max(meshes.length, 1)];
    if (!mesh) continue;
    const positions = mesh.geometry.getAttribute("position");
    const vertex = (index * 97 + (index % 11) * 13) % positions.count;
    point.fromBufferAttribute(positions, vertex).applyMatrix4(mesh.matrixWorld).multiplyScalar(scale);
    sampled[index * 3] = point.x;
    sampled[index * 3 + 1] = point.y;
    sampled[index * 3 + 2] = point.z;
  }
  return sampled;
}

function DissolveReassembly({
  from,
  to,
  atmosphere,
  reducedMotion,
  direction,
}: {
  from: SemanticModelId;
  to: SemanticModelId;
  atmosphere: PublicAtmosphereId;
  reducedMotion: boolean;
  direction: "ltr" | "rtl";
}) {
  const fromScene = useGLTF(SEMANTIC_MODEL_PATHS[from]).scene;
  const toScene = useGLTF(SEMANTIC_MODEL_PATHS[to]).scene;
  const width = useThree((state) => state.size.width);
  const count = reducedMotion ? 0 : width < 720 ? 320 : 680;
  const material = useRef<PointsMaterial>(null);
  const geometry = useRef<BufferGeometry>(null);
  const positionAttribute = useRef<BufferAttribute>(null);
  const elapsed = useRef(0);
  const transition = useMemo(() => {
    const source = sampleMeshPoints(fromScene, from, count);
    const target = sampleMeshPoints(toScene, to, count);
    const field = new Float32Array(count * 3);
    const positions = source.slice();
    const sign = direction === "rtl" ? -1 : 1;
    for (let index = 0; index < count; index += 1) {
      const phase = index * 2.399963229728653;
      const radius = 0.45 + (index % 23) * 0.025;
      field[index * 3] = Math.cos(phase) * radius + sign * Math.sin(index * 0.19) * 0.55;
      field[index * 3 + 1] = Math.sin(phase * 1.7) * 1.15;
      field[index * 3 + 2] = Math.sin(phase) * radius;
    }
    return { source, target, field, positions };
  }, [count, direction, from, fromScene, to, toScene]);

  useEffect(() => {
    elapsed.current = 0;
    positionAttribute.current?.setUsage(35048);
    const activeGeometry = geometry.current;
    return () => activeGeometry?.dispose();
  }, [transition]);

  useFrame((_, delta) => {
    if (!count) return;
    elapsed.current = Math.min(1, elapsed.current + delta / 0.92);
    const progress = MathUtils.smoothstep(elapsed.current, 0, 1);
    const first = Math.min(1, progress * 2);
    const second = Math.max(0, (progress - 0.5) * 2);
    const attribute = positionAttribute.current;
    if (!attribute) return;
    const positions = attribute.array as Float32Array;
    for (let index = 0; index < positions.length; index += 1) {
      const sourceToField = MathUtils.lerp(transition.source[index], transition.field[index], first);
      positions[index] = MathUtils.lerp(sourceToField, transition.target[index], second);
    }
    attribute.needsUpdate = true;
    if (material.current) material.current.opacity = Math.sin(progress * Math.PI) * 0.92;
  });

  if (!count) return null;
  const colour = PUBLIC_ATMOSPHERE_SCENES.find((item) => item.id === atmosphere)?.scene.glow ?? "#92fff1";
  return <points userData={{ transitionKind: "sampled-mesh-dissolve-reassembly", sourceModel: from, targetModel: to }}>
    <bufferGeometry ref={geometry}>
      <bufferAttribute
        attach="attributes-position"
        args={[transition.positions, 3]}
        key={`${from}-${to}-${count}-${direction}`}
        ref={positionAttribute}
      />
    </bufferGeometry>
    <pointsMaterial ref={material} color={colour} size={width < 720 ? 0.045 : 0.036} transparent depthWrite={false} opacity={0} sizeAttenuation />
  </points>;
}

function CameraRig({
  model,
  reducedMotion,
  direction,
}: {
  model: SemanticModelId;
  reducedMotion: boolean;
  direction: "ltr" | "rtl";
}) {
  const camera = useThree((state) => state.camera);
  const cameraRef = useRef(camera);
  useEffect(() => { cameraRef.current = camera; }, [camera]);
  useFrame((state,delta) => {
    const activeCamera = cameraRef.current;
    const directionSign = direction === "rtl" ? -1 : 1;
    const modelOffset = model === "deliver" || model === "road"
      ? 0.45
      : model === "shield" || model === "vault" ? -0.22 : 0.12;
    const pointerX = reducedMotion ? 0 : state.pointer.x * 0.28;
    const pointerY = reducedMotion ? 0 : state.pointer.y * 0.16;
    activeCamera.position.x = MathUtils.damp(
      activeCamera.position.x,directionSign * modelOffset + pointerX,6,delta,
    );
    activeCamera.position.y = MathUtils.damp(activeCamera.position.y,0.35 + pointerY,6,delta);
    activeCamera.position.z = MathUtils.damp(
      activeCamera.position.z,model === "road" ? 7.8 : 7.2,6,delta,
    );
    activeCamera.lookAt(0,0,0);
  });
  return null;
}

function ContextLossGuard({ onContextLost }: { onContextLost: () => void }) {
  const canvas = useThree((state) => state.gl.domElement);
  useEffect(() => {
    const handle = (event: Event) => {
      event.preventDefault();
      onContextLost();
    };
    canvas.addEventListener("webglcontextlost",handle);
    return () => canvas.removeEventListener("webglcontextlost",handle);
  }, [canvas,onContextLost]);
  return null;
}

function Scene({
  model,
  previousModel,
  atmosphere,
  reducedMotion,
  direction,
}: {
  model: SemanticModelId;
  previousModel: SemanticModelId | null;
  atmosphere: PublicAtmosphereId;
  reducedMotion: boolean;
  direction: "ltr" | "rtl";
}) {
  const palette = PUBLIC_ATMOSPHERE_SCENES.find((item) => item.id === atmosphere)?.scene ?? PUBLIC_ATMOSPHERE_SCENES[0].scene;
  return (
    <>
      <color attach="background" args={[palette.background]} />
      <fog attach="fog" args={[palette.background, 8, 18]} />
      <ambientLight intensity={1.25} />
      <directionalLight castShadow position={[4, 7, 5]} intensity={2.4} color={palette.ink} />
      <pointLight position={[-4, 1, 4]} intensity={18} distance={9} color={palette.primary} />
      <pointLight position={[4, -2, 2]} intensity={13} distance={8} color={palette.secondary} />
      <CameraRig model={model} reducedMotion={reducedMotion} direction={direction} />
      <Suspense fallback={null}>
        <Float speed={reducedMotion ? 0 : 1.1} rotationIntensity={reducedMotion ? 0 : 0.08} floatIntensity={reducedMotion ? 0 : 0.22}>
          {previousModel && previousModel !== model ? <SemanticModel key={`old-${previousModel}`} model={previousModel} outgoing reducedMotion={reducedMotion} /> : null}
          <SemanticModel key={model} model={model} outgoing={false} reducedMotion={reducedMotion} />
          {previousModel && previousModel !== model ? <DissolveReassembly
            key={`transition-${previousModel}-${model}`}
            from={previousModel}
            to={model}
            atmosphere={atmosphere}
            reducedMotion={reducedMotion}
            direction={direction}
          /> : null}
        </Float>
      </Suspense>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.15, 0]} receiveShadow>
        <circleGeometry args={[5.2, 64]} />
        <meshStandardMaterial color={palette.surface} roughness={0.82} metalness={0.14} />
      </mesh>
    </>
  );
}

export default function AxoraSemanticSceneCanvas({
  model,
  nextModel,
  atmosphere,
  reducedMotion,
  active,
  onContextLost,
  direction,
}: {
  model: SemanticModelId;
  nextModel?: SemanticModelId;
  atmosphere: PublicAtmosphereId;
  reducedMotion: boolean;
  active: boolean;
  onContextLost: () => void;
  direction: "ltr" | "rtl";
}) {
  const [previousModel, setPreviousModel] = useState<SemanticModelId | null>(null);
  const currentRef = useRef(model);
  useEffect(() => {
    if (currentRef.current === model) return;
    setPreviousModel(currentRef.current);
    currentRef.current = model;
    const timer = window.setTimeout(() => setPreviousModel(null), reducedMotion ? 120 : 1_100);
    return () => window.clearTimeout(timer);
  }, [model, reducedMotion]);
  useEffect(() => {
    if (!nextModel) return;
    const controller = new AbortController();
    void fetch(SEMANTIC_MODEL_PATHS[nextModel], {
      cache: "force-cache",
      credentials: "same-origin",
      signal: controller.signal,
    }).catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === "AbortError")) return;
    });
    return () => controller.abort();
  }, [nextModel]);
  return (
    <Canvas
      data-testid="workflow-webgl"
      aria-hidden="true"
      camera={{ position: [0, 0.35, 7.2], fov: 42 }}
      dpr={[1, 1.35]}
      frameloop={active ? "always" : "never"}
      gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
      shadows={!reducedMotion}
    >
      <ContextLossGuard onContextLost={onContextLost} />
      <Scene model={model} previousModel={previousModel} atmosphere={atmosphere} reducedMotion={reducedMotion} direction={direction} />
    </Canvas>
  );
}
