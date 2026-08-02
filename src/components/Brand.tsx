import Image from "next/image";

export function Brand({ compact = false }: { compact?: boolean }) {
  if (compact) return <Image src="/brand/axora-mark-512.png" width={42} height={42} alt="Axora" priority />;
  return (
    <Image
      className="brand-approved-lockup"
      src="/brand/axora-logo.png"
      width={190}
      height={35}
      alt="Axora"
      priority
    />
  );
}
