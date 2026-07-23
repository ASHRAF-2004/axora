import Image from "next/image";

export function Brand({ compact = false }: { compact?: boolean }) {
  if (compact) return <Image src="/brand/axora-mark.svg" width={42} height={42} alt="Axora" priority />;
  return (
    <div className="brand-lockup">
      <Image src="/brand/axora-mark.svg" width={44} height={44} alt="" priority />
      <div>
        <strong>Axora</strong>
        <span>Operations</span>
      </div>
    </div>
  );
}
