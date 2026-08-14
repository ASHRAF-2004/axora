# Third-party notices

Axora's V2 interaction architecture was independently implemented after studying Txema Albero's MIT-licensed `3d-portfolio` project at https://github.com/Txemalon/3d-portfolio (reference commit `52cfcb8f8e1c192d9dc44edb3cb70feae79d49d7`). No identity, copy, personal model, image, logo, audio or portfolio content was copied. The reference informed high-level patterns such as scroll-linked scene states, bounded pointer parallax, theme persistence, progressive WebGL loading and opt-in sound.

The upstream MIT licence is available at https://github.com/Txemalon/3d-portfolio/blob/main/LICENSE.

## Development audit tooling

Lighthouse 12.8.2 is used only in continuous integration to produce performance,
accessibility, best-practice and SEO evidence. Lighthouse is maintained by the
Chrome team and distributed under the Apache License 2.0:
https://github.com/GoogleChrome/lighthouse/blob/v12.8.2/LICENSE

Runtime model, sound, category-artwork and map-data provenance is recorded
per file in `third-party-assets.json` and summarized in
`THIRD_PARTY_ASSETS.md`.
