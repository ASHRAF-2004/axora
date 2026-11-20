# Handover PDF tools

Sources used to generate the PDFs in `handover/`. Output is HTML printed to PDF
with a Chromium browser (Chrome, Edge or Brave) through Playwright.

## Fonts (not included)

The PDFs use the **Thmanyah** typeface (Sans, Serif Display, Serif Text). Its
licence allows free personal and commercial use but **forbids redistributing the
font files**, so they are not in this repository. Download them free from
Thmanyah (https://ask.thmanyah.com/hc/en-001/articles/45993930027281) and place
the `woff2` folders like this:

```
tools/handover-pdf/fonts/thmanyahsans/woff2/thmanyahsans-Regular.woff2
tools/handover-pdf/fonts/thmanyahserifdisplay/woff2/thmanyahserifdisplay-Bold.woff2
tools/handover-pdf/fonts/thmanyahseriftext/woff2/thmanyahseriftext-Regular.woff2
```

(see `style.css` for every weight used). Without the fonts the PDFs still
render, with a fallback font.

## Generate

```bash
cd tools/handover-pdf
npm install --no-save playwright-core@1.61.1 marked@15
export CHROME_PATH="/path/to/chrome-or-edge-or-brave"
node build-guide.mjs ../../HANDOVER.md guide.html
node render.mjs guide.html ../../handover/1-Developer-Guide.pdf "Axora · Developer Handover Guide"
node render.mjs domain.html ../../handover/3-Domain-Transfer-Requirements.pdf "axora.management · Domain transfer requirements"
node shoot.mjs                 # tutorial images from mockups.html
node render.mjs extract.html ../../handover/How-To-Extract-Axora-Handover.pdf "How to extract the Axora handover file"
```

## Archive (maximum compression)

```bash
7z a -t7z -mx=9 -m0=LZMA2:d=64m:fb=273:mc=10000 -ms=on Axora-Handover-YYYY-MM-DD.7z Axora-Handover
```
