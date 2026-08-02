"use client";

import { ChevronRight, LogIn, Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

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
  const [isOpen, setIsOpen] = useState(false);

  function closeMenu() {
    setIsOpen(false);
  }

  return (
    <details
      key={pathname}
      className="public-mobile-menu"
      open={isOpen}
      onToggle={(event) => {
        setIsOpen(event.currentTarget.open);
      }}
    >
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
