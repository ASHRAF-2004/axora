"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Shape, type Group } from "three";
import styles from "./ImmersiveWorld.module.css";

function Emblem({ activation }: { activation: number }) {
  const group = useRef<Group>(null);
  const progress = useRef(1);
  const previous = useRef(activation);
  const invalidate = useThree((state) => state.invalidate);
  const geometry = useMemo(() => {
    const circle = (x: number,y: number,radius: number) => {
      const shape = new Shape();
      shape.absarc(x,y,radius,0,Math.PI * 2,false);
      return shape;
    };
    const rectangle = (x: number,y: number,width: number,height: number) => {
      const shape = new Shape();
      shape.moveTo(x - width / 2,y - height / 2);
      shape.lineTo(x + width / 2,y - height / 2);
      shape.lineTo(x + width / 2,y + height / 2);
      shape.lineTo(x - width / 2,y + height / 2);
      shape.closePath();
      return shape;
    };
    return {
      navy: [
        rectangle(0,0,0.45,0.45),
        rectangle(0,0.42,0.13,0.58),
        rectangle(-0.42,0,0.58,0.13),
        rectangle(0,-0.42,0.13,0.58),
        rectangle(0.42,0,0.58,0.13),
        circle(0,0.78,0.23),
        circle(-0.78,0,0.23),
        circle(0,-0.78,0.23),
      ],
      gold: circle(0.78,0,0.23),
    };
  }, []);
  useEffect(() => {
    if (activation === previous.current) return;
    previous.current = activation;
    progress.current = 0;
    invalidate();
  }, [activation, invalidate]);
  useFrame((_state, delta) => {
    const node = group.current;
    if (!node || progress.current >= 1) return;
    progress.current = Math.min(1, progress.current + delta / 0.72);
    const t = progress.current;
    const eased = 1 - Math.pow(1 - t, 3);
    node.rotation.y = eased * Math.PI * 2;
    node.position.y = Math.sin(t * Math.PI) * 0.18;
    if (t < 1) invalidate();
  });
  return <group ref={group} scale={0.72} rotation={[0,0,Math.PI / 4]}>
    <mesh castShadow>
      <extrudeGeometry args={[geometry.navy,{ depth: 0.18,bevelEnabled: true,bevelSegments: 3,bevelSize: 0.035,bevelThickness: 0.035 }]} />
      <meshStandardMaterial color="#0a2748" metalness={0.64} roughness={0.25} />
    </mesh>
    <mesh castShadow position={[0,0,0.015]}>
      <extrudeGeometry args={[geometry.gold,{ depth: 0.2,bevelEnabled: true,bevelSegments: 3,bevelSize: 0.035,bevelThickness: 0.035 }]} />
      <meshStandardMaterial color="#f4be36" emissive="#7a4d00" emissiveIntensity={0.3} metalness={0.48} roughness={0.24} />
    </mesh>
  </group>;
}

export default function AxoraBrandEmblemCanvas({ activation, onReady }: { activation: number; onReady: () => void }) {
  return <span className={styles.brandEmblemCanvas} aria-hidden="true">
    <Canvas camera={{ position: [0, 0, 2.45], fov: 42 }} dpr={[1, 1.35]} frameloop="demand" gl={{ alpha: true, antialias: true, powerPreference: "low-power" }} onCreated={({ invalidate }) => { onReady(); invalidate(); }}>
      <ambientLight intensity={1.25} /><directionalLight position={[2, 3, 4]} intensity={2.1} color="#8ee8ff" />
      <Emblem activation={activation} />
    </Canvas>
  </span>;
}
