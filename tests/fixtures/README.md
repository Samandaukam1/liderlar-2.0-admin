# Test fixtures

Real photographs, used by `tests/post-studio-portrait.test.ts` to check the
self-hosted background removal against something the model has to actually
segment — a synthetic silhouette would pass a matte that fails on a real face.

Both are official US Congress portraits, i.e. works of the US federal
government and therefore **public domain**.

| File | Source |
|---|---|
| `portrait-plain-background.jpg` | [Angie Craig, official portrait (119th Congress)](https://commons.wikimedia.org/wiki/File:Angie_Craig,_official_portrait_(119th_Congress).jpg) — plain studio backdrop |
| `portrait-busy-background.jpg` | [Lee Zeldin, official portrait, 114th Congress (cropped)](https://commons.wikimedia.org/wiki/File:Lee_Zeldin,_official_portrait,_114th_Congress_(cropped).jpg) — flag and office behind the subject |

Both were downscaled and re-encoded to keep the repository small; nothing else
about them was edited.

`portrait-background-fragments.jpg` is `portrait-plain-background.jpg` with two
crops of the other fixture's flag-and-office background composited beside the
subject's head and shoulder. It reproduces the production failure — a fragment
of background left hanging next to a candidate's ear — which the plain photos
are too clean to trigger. The upper fragment deliberately overlaps her hair, so
part of it is *inside* the person's silhouette and is expected to survive; the
detached fragments are the ones cleanup must remove.
