# Immersive public experience

Axora's localized public homepage presents the procurement route as an
interactive workflow console. It does not change authenticated business
workflows, permissions, company themes, database behavior or Turnstile.

## Runtime architecture

- The localized HTML hero, workflow controls and all explanatory content render
  immediately and remain the semantic source of truth.
- The React Three Fiber scene is a client-only dynamic chunk. It is requested
  only after capability checks pass.
- Reduced-motion users, data-saver users, low-capability devices and browsers
  without WebGL receive the designed static console.
- WebGL context loss or a scene import/render failure switches to the same
  static console without removing navigation or content.
- Rendering pauses while the console is offscreen or the tab is hidden.
- Public atmosphere preferences use `axora-public-atmosphere-v1` in local
  storage and are scoped to the public experience. They never write company
  theme tokens.
- Sound uses a short original Web Audio tone, is muted by default, never
  autoplays and uses `axora-public-sound-v1` for the explicit preference.

## Dependencies and assets

- `three@0.185.1` (MIT)
- `@react-three/fiber@9.7.0` (MIT)
- `@react-three/drei@10.7.8` (MIT)

The console, particles, product packages and route are procedural geometry.
No model, texture, remote font, remote script or audio file is loaded. The
interface sound is original runtime synthesis and has no third-party license.
The Txema Albero portfolio influenced the architecture of theme switching,
ambient depth, interaction controls and progressive fallbacks. Axora code and
visuals are original; attribution is recorded in `THIRD_PARTY_NOTICES.md`.

## Accessibility and performance

- All workflow stages are keyboard- and touch-operable HTML controls.
- The canvas is decorative to assistive technology and cannot trap focus.
- Arabic labels remain in HTML; no multilingual text is embedded in WebGL.
- RTL direction mirrors directional icons and spatial preview treatment.
- Fine-pointer ambience and magnetic movement are disabled for touch, coarse
  pointers and reduced motion.
- Forced-colors and increased-contrast modes retain visible controls and text.
- The Visitor Choice Challenge remains in ordinary document flow above all
  effects and is usable before or without the 3D chunk.
