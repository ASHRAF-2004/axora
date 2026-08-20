"use client";

import { useGLTF } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import {
  Box3,
  BufferAttribute,
  MathUtils,
  Vector3,
  type Group,
  type Material,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  type PointsMaterial,
} from "three";
import type { AppearanceMode } from "@/lib/appearance";
import {
  PUBLIC_APPEARANCE_SCENES,
  SEMANTIC_MODEL_PATHS,
  type SemanticModelId,
} from "@/lib/immersive-public-experience";
import {
  cameraDistanceForBounds,
  normalizationScale,
  projectedBoundsAreUsable,
  type ImmersiveSceneBounds,
  type ImmersiveSceneRuntime,
} from "@/lib/immersive-scene-runtime";

const MODEL_LONGEST_SIDE = 3.2;
const TRANSITION_SECONDS = 1.08;

type PreparedModel = {
  root: Object3D;
  materials: Material[];
  meshes: Mesh[];
  wheels: Object3D[];
  door: Object3D | null;
  doorRestY: number;
  center: Vector3;
  dimensions: Vector3;
  scale: number;
};

function prepareOwnedModel(source: Object3D): PreparedModel {
  const root = source.clone(true);
  const materials: Material[] = [];
  const meshes: Mesh[] = [];
  const wheels: Object3D[] = [];
  let door: Object3D | null = null;
  root.traverse((object: Object3D) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry = mesh.geometry.clone();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const sourceMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const ownedMaterials = sourceMaterials.map((material) => {
      const owned = material.clone() as MeshStandardMaterial;
      owned.transparent = true;
      materials.push(owned);
      return owned;
    });
    mesh.material = Array.isArray(mesh.material) ? ownedMaterials : ownedMaterials[0];
    meshes.push(mesh);
    if (/wheel/i.test(object.name)) wheels.push(object);
    if (/door/i.test(object.name)) door = object;
  });
  root.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(root);
  const dimensions = bounds.getSize(new Vector3());
  const center = bounds.getCenter(new Vector3());
  const scale = normalizationScale(dimensions, MODEL_LONGEST_SIDE);
  const ownedDoor = door as Object3D | null;
  return {
    root,
    materials,
    meshes,
    wheels,
    door: ownedDoor,
    doorRestY: ownedDoor?.rotation.y ?? 0,
    center,
    dimensions: dimensions.multiplyScalar(scale),
    scale,
  };
}

function opacityForRole(role: "settled" | "incoming", progress: number, transitioning: boolean) {
  if (!transitioning) return role === "settled" ? 1 : 0;
  return role === "settled"
    ? 1 - MathUtils.smoothstep(progress, 0.08, 0.58) * 0.9
    : MathUtils.smoothstep(progress, 0.42, 0.96);
}

function SemanticModel({
  model,
  role,
  transitionProgressRef,
  transitioning,
  reducedMotion,
  direction,
  onPrepared,
  onRendered,
}: {
  model: SemanticModelId;
  role: "settled" | "incoming";
  transitionProgressRef: MutableRefObject<number>;
  transitioning: boolean;
  reducedMotion: boolean;
  direction: "ltr" | "rtl";
  onPrepared: (model: SemanticModelId, dimensions: Vector3) => void;
  onRendered: (model: SemanticModelId, bounds: ImmersiveSceneBounds, insideFrustum: boolean) => void;
}) {
  const group = useRef<Group>(null);
  const { scene } = useGLTF(SEMANTIC_MODEL_PATHS[model], false, true);
  const ownedModel = useMemo(() => prepareOwnedModel(scene), [scene]);
  const animationTargetsRef = useRef({
    wheels: ownedModel.wheels,
    door: ownedModel.door,
    doorRestY: ownedModel.doorRestY,
    meshes: ownedModel.meshes,
  });
  useEffect(() => {
    animationTargetsRef.current = {
      wheels: ownedModel.wheels,
      door: ownedModel.door,
      doorRestY: ownedModel.doorRestY,
      meshes: ownedModel.meshes,
    };
    return () => {
      ownedModel.meshes.forEach((mesh) => mesh.geometry.dispose());
      ownedModel.materials.forEach((material) => material.dispose());
    };
  }, [ownedModel]);
  useEffect(() => onPrepared(model, ownedModel.dimensions.clone()), [model, onPrepared, ownedModel.dimensions]);
  const entryElapsed = useRef(0);
  const proofFrames = useRef(0);
  const proofSent = useRef(false);

  useEffect(() => {
    entryElapsed.current = 0;
    proofFrames.current = 0;
    proofSent.current = false;
  }, [model, role, transitioning]);

  useFrame(({ camera, gl }, delta) => {
    if (!group.current) return;
    const progress = reducedMotion ? 1 : transitionProgressRef.current;
    const animationTargets = animationTargetsRef.current;
    const opacity = opacityForRole(role, progress, transitioning);
    const sign = direction === "rtl" ? -1 : 1;
    const transitionOffset = transitioning
      ? role === "settled" ? progress * 0.28 * sign : (1 - progress) * -0.28 * sign
      : 0;
    group.current.position.x = transitionOffset;
    group.current.position.y = transitioning && !reducedMotion
      ? (role === "settled" ? progress * 0.12 : (1 - progress) * -0.12)
      : 0;
    group.current.scale.setScalar(role === "incoming" && transitioning ? 0.88 + progress * 0.12 : 1);

    if (role === "settled" && !transitioning) {
      entryElapsed.current = Math.min(2.2, entryElapsed.current + delta);
      if (model === "deliver" && !reducedMotion) {
        const entry = MathUtils.smoothstep(entryElapsed.current, 0, 0.72);
        group.current.position.x = MathUtils.lerp(-1.05 * sign, 0, entry);
        animationTargets.wheels.forEach((wheel) => { wheel.rotation.x -= delta * 5.2 * (1 - MathUtils.smoothstep(entryElapsed.current, 0.55, 0.9)); });
        if (animationTargets.door) {
          const open = MathUtils.smoothstep(entryElapsed.current, 0.72, 1.02)
            - MathUtils.smoothstep(entryElapsed.current, 1.5, 1.85);
          animationTargets.door.rotation.y = animationTargets.doorRestY + open * 0.88 * sign;
        }
      } else if (!reducedMotion) {
        group.current.rotation.y += delta * 0.1;
      }
    }
    animationTargets.meshes.forEach((mesh) => {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((material) => { material.opacity = opacity; });
    });

    const stageAnimationReady = model !== "deliver" || reducedMotion || entryElapsed.current >= 0.78;
    const visibleForProof = stageAnimationReady
      && opacity >= 0.96
      && (!transitioning || role === "incoming" && progress >= 0.96);
    if (!visibleForProof || proofSent.current || gl.info.render.calls <= 0) return;
    proofFrames.current += 1;
    if (proofFrames.current < 3) return;
    const bounds = new Box3().setFromObject(group.current);
    const min = bounds.min;
    const max = bounds.max;
    const corners = [
      new Vector3(min.x, min.y, min.z), new Vector3(min.x, min.y, max.z),
      new Vector3(min.x, max.y, min.z), new Vector3(min.x, max.y, max.z),
      new Vector3(max.x, min.y, min.z), new Vector3(max.x, min.y, max.z),
      new Vector3(max.x, max.y, min.z), new Vector3(max.x, max.y, max.z),
    ].map((point) => point.project(camera));
    const ndcLeft = Math.min(...corners.map((point) => point.x));
    const ndcRight = Math.max(...corners.map((point) => point.x));
    const ndcTop = Math.max(...corners.map((point) => point.y));
    const ndcBottom = Math.min(...corners.map((point) => point.y));
    const projected: ImmersiveSceneBounds = {
      left: (ndcLeft + 1) / 2,
      right: (ndcRight + 1) / 2,
      top: (1 - ndcTop) / 2,
      bottom: (1 - ndcBottom) / 2,
      width: (ndcRight - ndcLeft) / 2,
      height: (ndcTop - ndcBottom) / 2,
    };
    if (!projectedBoundsAreUsable(projected)) {
      proofFrames.current = 0;
      return;
    }
    proofSent.current = true;
    onRendered(model, projected, true);
  });

  return (
    <group ref={group} dispose={null} userData={{ semanticAssetId: model, semanticAssetRole: role }}>
      <group scale={ownedModel.scale}>
        <group position={[-ownedModel.center.x, -ownedModel.center.y, -ownedModel.center.z]}>
          <primitive object={ownedModel.root} />
        </group>
      </group>
    </group>
  );
}

function sampleMeshPoints(root: Object3D, count: number) {
  root.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(root);
  const dimensions = bounds.getSize(new Vector3());
  const center = bounds.getCenter(new Vector3());
  const scale = normalizationScale(dimensions, MODEL_LONGEST_SIDE);
  const meshes: Mesh[] = [];
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (mesh.isMesh && mesh.geometry.getAttribute("position")?.count) meshes.push(mesh);
  });
  const sampled = new Float32Array(count * 3);
  const point = new Vector3();
  for (let index = 0; index < count; index += 1) {
    const mesh = meshes[index % Math.max(meshes.length, 1)];
    if (!mesh) continue;
    const positions = mesh.geometry.getAttribute("position");
    const vertex = (index * 97 + (index % 11) * 13) % positions.count;
    point.fromBufferAttribute(positions, vertex).applyMatrix4(mesh.matrixWorld).sub(center).multiplyScalar(scale);
    sampled[index * 3] = point.x;
    sampled[index * 3 + 1] = point.y;
    sampled[index * 3 + 2] = point.z;
  }
  return sampled;
}

function DissolveReassembly({
  from,
  to,
  appearance,
  reducedMotion,
  direction,
  progressRef,
}: {
  from: SemanticModelId;
  to: SemanticModelId;
  appearance: AppearanceMode;
  reducedMotion: boolean;
  direction: "ltr" | "rtl";
  progressRef: MutableRefObject<number>;
}) {
  const fromScene = useGLTF(SEMANTIC_MODEL_PATHS[from], false, true).scene;
  const toScene = useGLTF(SEMANTIC_MODEL_PATHS[to], false, true).scene;
  const width = useThree((state) => state.size.width);
  const count = reducedMotion ? 0 : width < 720 ? 320 : 680;
  const material = useRef<PointsMaterial>(null);
  const positionAttribute = useRef<BufferAttribute>(null);
  const transition = useMemo(() => {
    const source = sampleMeshPoints(fromScene, count);
    const target = sampleMeshPoints(toScene, count);
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
  }, [count, direction, fromScene, toScene]);

  useEffect(() => { positionAttribute.current?.setUsage(35048); }, [transition]);

  useFrame(() => {
    if (!count) return;
    const eased = MathUtils.smoothstep(progressRef.current, 0, 1);
    const first = Math.min(1, eased * 2);
    const second = Math.max(0, (eased - 0.5) * 2);
    const attribute = positionAttribute.current;
    if (!attribute) return;
    const positions = attribute.array as Float32Array;
    for (let index = 0; index < positions.length; index += 1) {
      const sourceToField = MathUtils.lerp(transition.source[index], transition.field[index], first);
      positions[index] = MathUtils.lerp(sourceToField, transition.target[index], second);
    }
    attribute.needsUpdate = true;
    if (material.current) material.current.opacity = Math.sin(eased * Math.PI) * 0.96;
  });

  if (!count) return null;
  const colour = PUBLIC_APPEARANCE_SCENES.find((item) => item.id === appearance)?.scene.glow ?? "#8aa8be";
  return <points userData={{ transitionKind: "sampled-mesh-dissolve-reassembly", sourceModel: from, targetModel: to }}>
    <bufferGeometry>
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

function TransitionClock({ progressRef, reducedMotion, onComplete }: {
  progressRef: MutableRefObject<number>;
  reducedMotion: boolean;
  onComplete: () => void;
}) {
  const completed = useRef(false);
  useEffect(() => {
    progressRef.current = reducedMotion ? 1 : 0;
    completed.current = false;
  }, [progressRef, reducedMotion]);
  useFrame((_, delta) => {
    if (completed.current) return;
    progressRef.current = reducedMotion ? 1 : Math.min(1, progressRef.current + delta / TRANSITION_SECONDS);
    if (progressRef.current < 1) return;
    completed.current = true;
    onComplete();
  });
  return null;
}

function CameraRig({
  dimensions,
  reducedMotion,
  direction,
}: {
  dimensions: Vector3;
  reducedMotion: boolean;
  direction: "ltr" | "rtl";
}) {
  const camera = useThree((state) => state.camera);
  const cameraRef = useRef(camera);
  useEffect(() => { cameraRef.current = camera; }, [camera]);
  useFrame((state,delta) => {
    const activeCamera = cameraRef.current;
    const directionSign = direction === "rtl" ? -1 : 1;
    const pointerX = reducedMotion ? 0 : state.pointer.x * 0.28;
    const pointerY = reducedMotion ? 0 : state.pointer.y * 0.16;
    activeCamera.position.x = MathUtils.damp(
      activeCamera.position.x,directionSign * 0.08 + pointerX,6,delta,
    );
    activeCamera.position.y = MathUtils.damp(activeCamera.position.y,0.35 + pointerY,6,delta);
    activeCamera.position.z = MathUtils.damp(
      activeCamera.position.z,cameraDistanceForBounds(dimensions, state.size.width / Math.max(1, state.size.height)),6,delta,
    );
    activeCamera.lookAt(0,0,0);
  });
  return null;
}

function ContextLossGuard({ onContextLost, onReady }: { onContextLost: () => void; onReady: () => void }) {
  const canvas = useThree((state) => state.gl.domElement);
  useEffect(() => {
    const handle = (event: Event) => {
      event.preventDefault();
      onContextLost();
    };
    canvas.addEventListener("webglcontextlost",handle);
    onReady();
    return () => {
      canvas.removeEventListener("webglcontextlost",handle);
    };
  }, [canvas,onContextLost,onReady]);
  return null;
}

function Scene({
  model,
  appearance,
  reducedMotion,
  direction,
  onRuntime,
}: {
  model: SemanticModelId;
  appearance: AppearanceMode;
  reducedMotion: boolean;
  direction: "ltr" | "rtl";
  onRuntime: (runtime: ImmersiveSceneRuntime) => void;
}) {
  const palette = PUBLIC_APPEARANCE_SCENES.find((item) => item.id === appearance)?.scene ?? PUBLIC_APPEARANCE_SCENES[0].scene;
  const [settledModel, setSettledModel] = useState(model);
  const [transitionTarget, setTransitionTarget] = useState<SemanticModelId | null>(null);
  const [dimensions, setDimensions] = useState(() => new Vector3(MODEL_LONGEST_SIDE, MODEL_LONGEST_SIDE, MODEL_LONGEST_SIDE));
  const transitionProgressRef = useRef(0);
  const settledModelRef = useRef(model);
  const targetReady = transitionTarget === model;

  useEffect(() => {
    transitionProgressRef.current = 0;
    const attachedModel = settledModelRef.current;
    const frame = window.requestAnimationFrame(() => {
      onRuntime({
        phase: "loading",
        requestedAsset: model,
        attachedAsset: attachedModel,
        renderedAsset: attachedModel,
        transitionFrom: model === attachedModel ? null : attachedModel,
        bounds: null,
        insideFrustum: false,
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [model, onRuntime]);

  const prepared = useCallback((asset: SemanticModelId, nextDimensions: Vector3) => {
    if (asset === settledModel) {
      setDimensions(nextDimensions);
      return;
    }
    if (asset !== model) return;
    setDimensions(nextDimensions);
    setTransitionTarget(asset);
    onRuntime({
      phase: "transitioning",
      requestedAsset: asset,
      attachedAsset: asset,
      renderedAsset: settledModel,
      transitionFrom: settledModel,
      bounds: null,
      insideFrustum: false,
    });
  }, [model, onRuntime, settledModel]);

  const rendered = useCallback((asset: SemanticModelId, bounds: ImmersiveSceneBounds, insideFrustum: boolean) => {
    if (asset !== model || asset !== settledModel || targetReady) return;
    onRuntime({
      phase: "ready",
      requestedAsset: asset,
      attachedAsset: asset,
      renderedAsset: asset,
      transitionFrom: null,
      bounds,
      insideFrustum,
    });
  }, [model, onRuntime, settledModel, targetReady]);

  const completeTransition = useCallback((target: SemanticModelId) => {
    if (model !== target) return;
    settledModelRef.current = target;
    setSettledModel(target);
    setTransitionTarget(null);
    onRuntime({
      phase: "loading",
      requestedAsset: target,
      attachedAsset: target,
      renderedAsset: null,
      transitionFrom: null,
      bounds: null,
      insideFrustum: false,
    });
  }, [model, onRuntime]);

  return (
    <>
      <color attach="background" args={[palette.background]} />
      <fog attach="fog" args={[palette.background, 8, 18]} />
      <ambientLight intensity={1.25} />
      <directionalLight castShadow position={[4, 7, 5]} intensity={2.4} color={palette.ink} />
      <pointLight position={[-4, 1, 4]} intensity={18} distance={9} color={palette.primary} />
      <pointLight position={[4, -2, 2]} intensity={13} distance={8} color={palette.secondary} />
      <CameraRig dimensions={dimensions} reducedMotion={reducedMotion} direction={direction} />
      <Suspense fallback={null}>
        <SemanticModel
          key={`settled-${settledModel}`}
          model={settledModel}
          role="settled"
          transitionProgressRef={transitionProgressRef}
          transitioning={targetReady}
          reducedMotion={reducedMotion}
          direction={direction}
          onPrepared={prepared}
          onRendered={rendered}
        />
      </Suspense>
      {model !== settledModel ? <Suspense fallback={null}>
        <SemanticModel
          key={`incoming-${model}`}
          model={model}
          role="incoming"
          transitionProgressRef={transitionProgressRef}
          transitioning={targetReady}
          reducedMotion={reducedMotion}
          direction={direction}
          onPrepared={prepared}
          onRendered={() => undefined}
        />
        {targetReady ? <>
          <DissolveReassembly
            key={`transition-${settledModel}-${model}`}
            from={settledModel}
            to={model}
            appearance={appearance}
            reducedMotion={reducedMotion}
            direction={direction}
            progressRef={transitionProgressRef}
          />
          <TransitionClock progressRef={transitionProgressRef} reducedMotion={reducedMotion} onComplete={() => completeTransition(model)} />
        </> : null}
      </Suspense> : null}
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
  appearance,
  reducedMotion,
  active,
  onContextLost,
  direction,
  onRuntimeChange,
}: {
  model: SemanticModelId;
  nextModel?: SemanticModelId;
  appearance: AppearanceMode;
  reducedMotion: boolean;
  active: boolean;
  onContextLost: () => void;
  direction: "ltr" | "rtl";
  onRuntimeChange: (runtime: ImmersiveSceneRuntime) => void;
}) {
  const [contextLossReady, setContextLossReady] = useState(false);
  const [runtime, setRuntime] = useState<ImmersiveSceneRuntime>({
    phase: "loading",
    requestedAsset: model,
    attachedAsset: null,
    renderedAsset: null,
    transitionFrom: null,
    bounds: null,
    insideFrustum: false,
  });
  const handleRuntime = useCallback((next: ImmersiveSceneRuntime) => setRuntime(next), []);
  useEffect(() => onRuntimeChange(runtime), [onRuntimeChange, runtime]);
  useEffect(() => {
    useGLTF.preload(SEMANTIC_MODEL_PATHS[model], false, true);
    if (nextModel) useGLTF.preload(SEMANTIC_MODEL_PATHS[nextModel], false, true);
  }, [model, nextModel]);
  const serializedBounds = runtime.bounds
    ? [runtime.bounds.left, runtime.bounds.top, runtime.bounds.right, runtime.bounds.bottom]
      .map((value) => value.toFixed(4)).join(",")
    : undefined;
  return (
    <Canvas
      data-testid="workflow-webgl"
      data-context-loss-ready={contextLossReady ? "true" : "false"}
      data-scene-phase={runtime.phase}
      data-requested-asset={runtime.requestedAsset}
      data-attached-asset={runtime.attachedAsset ?? undefined}
      data-rendered-asset={runtime.renderedAsset ?? undefined}
      data-transition-from={runtime.transitionFrom ?? undefined}
      data-model-bounds={serializedBounds}
      data-model-inside-frustum={runtime.insideFrustum ? "true" : "false"}
      aria-hidden="true"
      camera={{ position: [0, 0.35, 7.2], fov: 42 }}
      dpr={[1, 1.35]}
      frameloop={active ? "always" : "never"}
      gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
      shadows={reducedMotion ? false : "basic"}
    >
      <ContextLossGuard onContextLost={onContextLost} onReady={() => setContextLossReady(true)} />
      <Scene model={model} appearance={appearance} reducedMotion={reducedMotion} direction={direction} onRuntime={handleRuntime} />
    </Canvas>
  );
}

export const immersiveSceneCanvasInternals = {
  MODEL_LONGEST_SIDE,
  TRANSITION_SECONDS,
  opacityForRole,
  prepareOwnedModel,
  sampleMeshPoints,
};
