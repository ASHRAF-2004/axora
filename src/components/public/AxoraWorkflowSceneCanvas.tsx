"use client";

import { Float, RoundedBox } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import type { Group, Mesh } from "three";
import type { PublicAtmosphereId } from "@/lib/immersive-public-experience";
import { PUBLIC_ATMOSPHERES } from "@/lib/immersive-public-experience";

interface SceneProps {
  activeIndex: number;
  atmosphere: PublicAtmosphereId;
  active: boolean;
  compact: boolean;
  onSelect: (index: number) => void;
  onContextLost: () => void;
}

const controlPositions: Array<[number, number, number]> = [
  [-2.55, 0.95, 0.42], [-.86, 1.06, .48], [.86, 1.06, .48], [2.55, .95, .42],
  [-2.55, -.92, .42], [-.86, -1.04, .48], [.86, -1.04, .48], [2.55, -.92, .42],
];

function Route({ color }: { color: string }) {
  return (
    <group position={[0, 0, .36]}>
      <mesh>
        <boxGeometry args={[5.15, .045, .045]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2.2} />
      </mesh>
      <mesh position={[0, -1.02, 0]}>
        <boxGeometry args={[5.15, .045, .045]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.5} />
      </mesh>
      <mesh position={[-2.56, -.5, 0]}>
        <boxGeometry args={[.045, 1.05, .045]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.5} />
      </mesh>
      <mesh position={[2.56, -.5, 0]}>
        <boxGeometry args={[.045, 1.05, .045]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.5} />
      </mesh>
    </group>
  );
}

function Particles({ color, compact }: { color: string; compact: boolean }) {
  const positions = useMemo(() => {
    const count = compact ? 42 : 88;
    const values = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const angle = index * 2.39996;
      const radius = 2.6 + (index % 13) * .22;
      values[index * 3] = Math.cos(angle) * radius;
      values[index * 3 + 1] = ((index * 17) % 41) / 8 - 2.5;
      values[index * 3 + 2] = Math.sin(angle) * radius - 1.2;
    }
    return values;
  }, [compact]);

  const points = useRef<Mesh>(null);
  useFrame((_, delta) => {
    if (points.current) points.current.rotation.z += delta * .018;
  });

  return (
    <points ref={points}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color={color} size={compact ? .035 : .045} transparent opacity={.68} sizeAttenuation />
    </points>
  );
}

function Console({ activeIndex, atmosphere, compact, onSelect }: Omit<SceneProps, "active" | "onContextLost">) {
  const group = useRef<Group>(null);
  const palette = PUBLIC_ATMOSPHERES.find((item) => item.id === atmosphere)?.scene
    ?? PUBLIC_ATMOSPHERES[0].scene;

  useFrame((state, delta) => {
    if (!group.current) return;
    const targetX = compact ? 0 : state.pointer.y * .09;
    const targetY = compact ? 0 : state.pointer.x * .13;
    group.current.rotation.x += (targetX - group.current.rotation.x) * Math.min(1, delta * 2.4);
    group.current.rotation.y += (targetY - group.current.rotation.y) * Math.min(1, delta * 2.4);
  });

  return (
    <group ref={group} rotation={[-.08, 0, 0]}>
      <RoundedBox args={[6.7, 3.45, .46]} radius={.28} smoothness={4}>
        <meshStandardMaterial color={palette.base} metalness={.68} roughness={.28} />
      </RoundedBox>
      <RoundedBox args={[6.16, 2.92, .24]} position={[0, 0, .31]} radius={.2} smoothness={4}>
        <meshStandardMaterial color={palette.surface} metalness={.4} roughness={.36} />
      </RoundedBox>
      <Route color={palette.route} />
      {controlPositions.map((position, index) => {
        const selected = index === activeIndex;
        return (
          <Float key={index} speed={selected ? 2 : 1} rotationIntensity={.05} floatIntensity={selected ? .12 : .035}>
            <RoundedBox
              args={[1.12, .72, .28]}
              position={position}
              radius={.13}
              smoothness={4}
              onPointerDown={(event) => {
                event.stopPropagation();
                onSelect(index);
              }}
              onPointerEnter={() => { document.body.style.cursor = "pointer"; }}
              onPointerLeave={() => { document.body.style.cursor = ""; }}
            >
              <meshStandardMaterial
                color={selected ? palette.active : palette.base}
                emissive={selected ? palette.active : palette.route}
                emissiveIntensity={selected ? 1.15 : .08}
                metalness={.45}
                roughness={.24}
              />
            </RoundedBox>
          </Float>
        );
      })}
      <Float speed={1.4} rotationIntensity={.16} floatIntensity={.18}>
        <group position={[0, .02, .92]}>
          <RoundedBox args={[1.08, .74, .46]} radius={.1} smoothness={3}>
            <meshStandardMaterial color={palette.accent} roughness={.62} />
          </RoundedBox>
          <mesh position={[0, 0, .27]}>
            <boxGeometry args={[.56, .08, .04]} />
            <meshStandardMaterial color={palette.base} />
          </mesh>
        </group>
      </Float>
      {!compact ? (
        <>
          <Float speed={1.1} rotationIntensity={.2} floatIntensity={.3}>
            <RoundedBox args={[.54, .54, .54]} position={[-3.1, 2.04, -.45]} radius={.08} smoothness={3}>
              <meshStandardMaterial color={palette.accent} roughness={.7} />
            </RoundedBox>
          </Float>
          <Float speed={1.3} rotationIntensity={.24} floatIntensity={.28}>
            <RoundedBox args={[.42, .42, .42]} position={[3.12, -1.95, -.65]} radius={.06} smoothness={3}>
              <meshStandardMaterial color={palette.active} roughness={.62} />
            </RoundedBox>
          </Float>
        </>
      ) : null}
      <Particles color={palette.particle} compact={compact} />
    </group>
  );
}

export function AxoraWorkflowSceneCanvas(props: SceneProps) {
  const palette = PUBLIC_ATMOSPHERES.find((item) => item.id === props.atmosphere)?.scene
    ?? PUBLIC_ATMOSPHERES[0].scene;
  return (
    <Canvas
      aria-hidden="true"
      camera={{ position: [0, 0, props.compact ? 7.9 : 7.2], fov: props.compact ? 49 : 44 }}
      dpr={props.compact ? [1, 1.15] : [1, 1.6]}
      frameloop={props.active ? "always" : "never"}
      gl={{ alpha: true, antialias: !props.compact, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.domElement.dataset.testid = "workflow-webgl";
        gl.domElement.addEventListener("webglcontextlost", (event) => {
          event.preventDefault();
          document.body.style.cursor = "";
          props.onContextLost();
        }, { once: true });
      }}
    >
      <ambientLight intensity={.62} />
      <directionalLight position={[4, 5, 7]} intensity={2.3} color="#dceeff" />
      <pointLight position={[-4, -2, 3]} intensity={24} distance={10} color={palette.active} />
      <pointLight position={[4, 2, 2]} intensity={17} distance={9} color={palette.accent} />
      <Console
        activeIndex={props.activeIndex}
        atmosphere={props.atmosphere}
        compact={props.compact}
        onSelect={props.onSelect}
      />
    </Canvas>
  );
}
