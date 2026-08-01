# Axora interactive asset license inventory

This inventory covers every asset in the trusted interaction catalog. Publicly accessible or community-created assets are not approved automatically. New assets require an explicit license review and a local, non-hotlinked copy before they may be added to the catalog.

| Catalog ID | Asset/component | Source | Exact license and ownership | Commercial use | Attribution | Integrity source and SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| `axora-buddy-v1` | Axora Buddy mascot and static fallback | Original Axora work | Copyright Axora; original project asset | Approved | Not required | `public/interactions/axora-buddy-static.svg` · `f9faf1a5bf0389d09c6ad4047c0b847bc1252f8bdda354e6a464699e39470765` |
| `axora-restrained-motion-v1` | Restrained section-motion component | Original Axora work | Copyright Axora; original project component | Approved | Not required | `src/components/interactions/TrustedInteractionRenderer.tsx` · `9b34255aafac140af665b1fa1dd6e1b9c7759ffea24198992222c9eac327a5b6` |
| `axora-orbit-v1` | Axora Orbit abstract illustration component | Original Axora work | Copyright Axora; original project component | Approved | Not required | `src/components/interactions/TrustedInteractionRenderer.tsx` · `9b34255aafac140af665b1fa1dd6e1b9c7759ffea24198992222c9eac327a5b6` |
| `axora-mark-static-v1` | Axora static mark fallback | Modified Lucide `Boxes` icon | ISC License; Copyright (c) 2026 Lucide Icons and Contributors | Approved | Required and preserved in `THIRD_PARTY_NOTICES.md` | `public/brand/axora-mark.svg` · `6bb933938c6c5e484de658566e73a634184473c0739bfce1f26e2a5119e8a4ae` |

No third-party character, animation, sound, font, or runtime asset is included in this initial catalog. The existing Lucide-derived Axora brand mark is used only as a static fallback under its preserved ISC notice. The application renders every entry through reviewed local components and never hotlinks an animation file.
