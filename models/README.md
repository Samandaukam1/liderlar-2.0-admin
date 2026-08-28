# Post Studio segmentation model

`silueta.onnx` — the model that removes the background from candidate portraits.
It runs **inside our own server** (ONNX Runtime, CPU); Post Studio no longer
calls remove.bg, PhotoRoom or any other third-party image API.

| | |
|---|---|
| Architecture | U²-Net (Silueta — the size-reduced U²-Net release) |
| Task | salient-object / person segmentation, soft alpha output |
| Input | `float32[1,3,320,320]`, ImageNet-normalised RGB |
| Output | 7 side maps of `float32[1,1,320,320]`; only the fused `d0` is used |
| File size | 44,173,029 bytes (44.2 MB) |
| SHA-256 | `75da6c8d2f8096ec743d071951be73b4a8bc7b3e51d9a6625d63644f90ffeedb` |
| Origin | <https://github.com/danielgatis/rembg/releases/download/v0.0.0/silueta.onnx> |
| Licence | Apache-2.0 (U²-Net, <https://github.com/xuebinqin/U-2-Net>), redistributed by rembg (MIT) |

It is a **discriminative** model: it predicts a per-pixel mask and nothing else.
It cannot repaint a face, a hairline, clothing or skin tone — the poster always
shows the candidate's own pixels with an alpha channel attached.

The file is committed rather than downloaded at build time so a deploy never
depends on a third-party host being reachable. It is kept outside `public/` so
Vercel does not serve 44 MB as a static asset; `next.config.ts` traces it into
the two functions that need it.

Why this one, measured on real portraits (see `tests/post-studio-portrait.test.ts`):
`u2netp` is only 4.6 MB and ~40 ms faster, but on a portrait with a busy
background it keeps bright background objects as part of the subject. Silueta
cut the same photo cleanly, and 44 MB fits the function budget with ~130 MB to
spare.
