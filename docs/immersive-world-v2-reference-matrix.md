# Immersive World V2 reference matrix

Reference inspection date: 2026-08-14. The live Txema experience and MIT-licensed `Txemalon/3d-portfolio` repository were studied for interaction architecture only. No identity, copy, model, screenshot, logo, sound or portfolio content was copied.

| Capability | Reference observation | Axora V2 implementation |
| --- | --- | --- |
| Recognizable objects | A tactile object anchors interaction. | Eight licensed semantic objects represent Request, Approve, Pay, Invoice, Prepare, Deliver, Track and Complete. |
| Scene quality | Strong depth, restrained atmosphere and purposeful lighting. | Route-specific key/fill/rim lighting, floor shadows, particles and atmosphere-token colours. |
| Camera movement | Pointer and state changes influence the camera. | Bounded pointer parallax, stage framing and scroll-linked camera easing; disabled for reduced motion. |
| Materials | Materials reinforce the selected atmosphere. | Source materials remain recognizable while lights, floor and transition fragments inherit the active atmosphere. |
| Hover/focus | Physical controls react immediately. | HTML stage controls and 3D objects share focus/selection state with keyboard parity. |
| Click/touch | Object interaction changes content. | Click, tap, Enter and Space select stages and update an accessible semantic panel. |
| Keyboard | Keyboard can drive the focal experience. | Number keys and semantic controls activate stages without placing focus inside the canvas. |
| Scroll animation | Scrolling changes scene composition. | Intersection-driven stage progression disassembles the outgoing model and reassembles the next; this is documented as a dissolve transition, not a mesh morph. |
| Theme transitions | Atmosphere changes affect the full composition. | Aurora, Solar, Ember and Midnight update centralized tokens, scene lighting and interface surfaces without layout shift. |
| Sound | Optional cues reinforce interactions. | Eight distinct stage cues plus theme, van engine and door cues; muted by default and self-hosted. |
| Mobile | Interaction is simplified rather than removed. | Reduced geometry/DPR, touch controls, no cursor effects, static fallback under constrained-device signals. |
| Loading | Content remains legible before 3D. | Server-rendered semantic content and a fixed-size fallback render immediately; route scene is dynamically imported. |
| Failure fallback | The experience remains understandable without WebGL. | WebGL detection, context-loss fallback and the complete localized HTML workflow. |
| Creative richness | Multiple coordinated sensory systems. | Six page-specific scene sequences, stage-specific models/sounds, themes, a 3D brand emblem and semantic operational transitions. |

## Direct adaptation

No source file was copied directly. Axora uses the general patterns of progressive WebGL enhancement, explicit sound opt-in, pointer-bounded motion and state-driven scene changes. The reference MIT notice is retained in `THIRD_PARTY_NOTICES.md` for transparency.
