"use client";

import { ChevronRight, LogIn, Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

interface PublicMobileMenuProps {
  navigation: Array<{ href: string; label: string }>;
  navigationLabel: string;
  menuLabel: string;
  contactHref: string;
  contactLabel: string;
  loginLabel: string;
}

export function PublicMobileMenu({
  navigation,
  navigationLabel,
  menuLabel,
  contactHref,
  contactLabel,
  loginLabel,
}: PublicMobileMenuProps) {
  const pathname = usePathname();
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    detailsRef.current?.removeAttribute("open");
  }, [pathname]);

  function closeMenu() {
    detailsRef.current?.removeAttribute("open");
  }

  return (
    <details ref={detailsRef} className="public-mobile-menu">
      <summary aria-label={menuLabel}><Menu size={22} aria-hidden="true" /></summary>
      <nav aria-label={navigationLabel}>
        {navigation.map((item) => (
          <Link key={item.href} href={item.href} onClick={closeMenu}>
            {item.label}<ChevronRight className="public-directional-icon" size={16} aria-hidden="true" />
          </Link>
        ))}
        <Link href={contactHref} onClick={closeMenu}>
          {contactLabel}<ChevronRight className="public-directional-icon" size={16} aria-hidden="true" />
        </Link>
        <Link href="/login" onClick={closeMenu}>{loginLabel}<LogIn size={16} aria-hidden="true" /></Link>
      </nav>
    </details>
  );
}
