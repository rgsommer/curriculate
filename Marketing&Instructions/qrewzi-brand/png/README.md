# Qrewzi PNG exports

All exports rendered from the SVG masters in `../` at 1× resolution
(no upscaling — SVG is the source of truth; re-render for new sizes).

## Favicons — use `favicon-*.png` on the web

| File               | Size    | Use                                     |
|--------------------|---------|-----------------------------------------|
| `favicon-16.png`   | 16×16   | Browser tab                             |
| `favicon-32.png`   | 32×32   | Browser tab @ 2× · Windows              |
| `favicon-48.png`   | 48×48   | Windows taskbar                         |

**HTML:** `<link rel="icon" type="image/svg+xml" href="/qrewzi-favicon.svg">`
plus PNG fallbacks. Modern browsers prefer the SVG.

## Mark — standalone, transparent background

| File           | Size      | Use                                          |
|----------------|-----------|----------------------------------------------|
| `mark-64.png`  | 64×64     | Small UI chip                                |
| `mark-128.png` | 128×128   | Medium UI                                    |
| `mark-256.png` | 256×256   | Card / hero decoration                       |
| `mark-512.png` | 512×512   | Print, slides, social profile picture bg-off |

## App icon — coral rounded square (store-ready)

| File                | Size        | Use                                       |
|---------------------|-------------|-------------------------------------------|
| `app-icon-180.png`  | 180×180     | iOS `apple-touch-icon`                    |
| `app-icon-192.png`  | 192×192     | Android chrome, PWA manifest              |
| `app-icon-512.png`  | 512×512     | Google Play feature icon, PWA manifest    |
| `app-icon-1024.png` | 1024×1024   | Google Play hi-res + Apple App Store      |

## Wordmark — three treatments, three widths

| File                            | Size       | Use                          |
|---------------------------------|------------|------------------------------|
| `wordmark-color-600.png`        | 600×150    | Standard header              |
| `wordmark-color-1200.png`       | 1200×300   | Retina header, social banner |
| `wordmark-color-2400.png`       | 2400×600   | Hero, print                  |
| `wordmark-navy-600.png`         | 600×150    | Mono on cream/light          |
| `wordmark-navy-1200.png`        | 1200×300   | Same, retina                 |
| `wordmark-cream-600.png`        | 600×150    | Mono on dark ground          |
| `wordmark-cream-1200.png`       | 1200×300   | Same, retina                 |

## Re-rendering

To change sizes or add new ones, edit and re-run the loop in the last
`Bash` block of the conversation, or drop this recipe:

```bash
cd Marketing\&Instructions/qrewzi-brand
BRAVE="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
# Inline the SVG into a tiny HTML wrapper, then screenshot at exact size.
# (See earlier session for the full render_svg helper.)
```
