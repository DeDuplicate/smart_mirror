# Photo frame images

Drop photos here and the **slideshow** screensaver turns into a digital photo
frame — your pictures behind the clock, weather, agenda, news and player that
are already on the screensaver.

```
backend/data/photos/
├── README.md          <- committed
├── beach-2024.jpg     <- your photos, NOT committed
└── trips/             <- subfolders work too (up to 3 levels deep)
    └── eilat.jpg
```

- **Formats:** `.jpg`, `.jpeg`, `.png`, `.webp`, `.avif`, `.gif`
- **Size:** the screen is 1920x1080. Anything much bigger just costs the Pi
  memory — resizing to ~2000px on the long edge is plenty.
- **Order:** shuffled on every screensaver start, so it never opens on the
  same picture twice in a row.
- **Empty folder:** the slideshow falls back to the built-in gradients, so
  nothing breaks if you never add a photo.
- **No restart or rebuild needed.** Files are served straight from this
  directory at `/api/photos/<name>`, so you can copy photos onto a running Pi
  over SSH and just let the screensaver come up.

Interval and fit (full photo on a blurred backdrop vs. fill the screen) are in
**Settings → תצוגה**.

## Privacy

Everything here except `README.md` is gitignored on purpose — family photos
should stay on your device and out of a public repo or a shared `.img`.
