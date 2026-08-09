"use client";

import Image from "next/image";
import { useMemo, useState, type CSSProperties } from "react";

interface UserAvatarProps {
  name: string;
  userId?: string;
  deliveryJobId?: string;
  version?: string;
  size?: number;
  className?: string;
  alt?: string;
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2)
    .map((part) => part[0]?.toUpperCase()).join("") || "AX";
}

export function UserAvatar({
  name, userId, deliveryJobId, version, size = 40, className, alt = "",
}: UserAvatarProps) {
  const [failedSrc, setFailedSrc] = useState<string>();
  const src = useMemo(() => {
    if (!userId) return undefined;
    const variant = size <= 64 ? 64 : size <= 128 ? 128 : 256;
    const query = new URLSearchParams({ size: String(variant) });
    if (deliveryJobId) query.set("deliveryJobId", deliveryJobId);
    if (version) query.set("v", version);
    return `/api/profile/avatar/${encodeURIComponent(userId)}?${query}`;
  }, [deliveryJobId, size, userId, version]);
  return <span
    className={["user-avatar", className].filter(Boolean).join(" ")}
    style={{ "--avatar-size": `${size}px` } as CSSProperties}
  >
    {src && failedSrc !== src ? <Image alt={alt} height={size} onError={() => setFailedSrc(src)} src={src} unoptimized width={size} />
      : <span aria-hidden="true">{initials(name)}</span>}
  </span>;
}
