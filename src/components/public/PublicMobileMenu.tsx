"use client";

import { ChevronRight, LogIn, Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { SupportedLocale } from "@/lib/i18n";
import { AtmosphereSelector } from "./AtmosphereSelector";

interface PublicMobileMenuProps {
  navigation: Array<{ href: string; label: string }>;
  navigationLabel: string;
  menuLabel: string;
  contactHref: string;
  contactLabel: string;
  loginLabel: string;
  locale: SupportedLocale;
}

export function PublicMobileMenu({
  navigation,
  navigationLabel,
  menuLabel,
  contactHref,
  contactLabel,
  loginLabel,
  locale,
}: PublicMobileMenuProps) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  function closeMenu() {
    setIsOpen(false);
  }

  return (
    <div
      key={pathname}
      className="public-mobile-menu"
    >
      <button
        aria-controls="public-mobile-navigation"
        aria-expanded={isOpen}
        aria-label={menuLabel}
        onClick={() => setIsOpen((open) => !open)}
        type="button"
      >
        <Menu size={22} aria-hidden="true" />
      </button>
      {isOpen ? <nav aria-label={navigationLabel} id="public-mobile-navigation">
        <div className="public-mobile-atmosphere"><AtmosphereSelector locale={locale} compact /></div>
        {navigation.map((item) => (
          <Link key={item.href} href={item.href} onClick={closeMenu}>
            {item.label}<ChevronRight className="public-directional-icon" size={16} aria-hidden="true" />
          </Link>
        ))}
        <Link href={contactHref} onClick={closeMenu}>
          {contactLabel}<ChevronRight className="public-directional-icon" size={16} aria-hidden="true" />
        </Link>
        <Link href="/login" onClick={closeMenu}>{loginLabel}<LogIn size={16} aria-hidden="true" /></Link>
      </nav> : null}
    </div>
  );
}
