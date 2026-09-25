# Demo video

The product video in the main README, built with [Remotion](https://www.remotion.dev): React components rendered frame by frame to MP4. The chat UI is redrawn from the real app's tokens and layout (`app/app/globals.css`, `app/components/*`), so it matches the product without depending on a live model.

This folder has its own `package.json` on purpose. None of it is imported by the app or by `src/`, and the app's dependency set stays untouched (D-59).

## Commands

```bash
cd docs/demo-video
npm install
npm run soundtrack      # music and sound effects -> public/soundtrack.wav
npm run studio          # live preview and scrubbing at localhost:3000
npm run render          # full cut with sound -> docs/media/demo.mp4
npm run render:teaser   # README GIF -> docs/media/demo-teaser.gif
npm run render:poster   # still      -> docs/media/demo-poster.png
```

## Layout

```
src/
  Root.tsx        the two compositions: Demo (full cut) and Teaser (GIF)
  Demo.tsx        scene order and lengths
  Teaser.tsx      slices of the full cut, for the README loop
  timeline.ts     scene lengths, shared by the video and the soundtrack
  data.ts         every figure shown on screen
  theme.ts        fonts, the app's colour tokens, the stage palette
  scenes/         Hook, Brand, Upload, Analysis, Conflict, Agents, Artifacts, Features, Outro
  ui/             AppShell (the chat UI), FilesPanel, thread pieces, motion helpers, icons
scripts/
  make-soundtrack.ts   synthesises the soundtrack into public/soundtrack.wav
```

## Sound

The soundtrack is original and made entirely in code by `scripts/make-soundtrack.ts`: no samples, no dependencies, so there is nothing to license. It has a 112 BPM music bed (an Am, F, C, G pad progression with bass, drums and an arpeggio that build through the scenes and drop for the conflict), plus sound effects placed on the same scene frames the animation uses: whooshes on cuts and zooms, pops as files land, key clicks while a question is typed, a low thud when the conflict appears, and chimes when the files are generated. The noise is seeded, so it regenerates identically. The WAV is not committed; `studio` and `render` generate it first.

## The numbers are real

Every figure on screen (1,203 rows, 14 duplicates, 36 missing revenue values, revenue per dollar by channel, the Paid Social trend) was computed from `samples/campaigns.xlsx`, and the customer notes quote is taken word for word from `scripts/make-customer-notes.ts`. If the sample data is regenerated, recompute `src/data.ts` rather than editing it by hand.

## Licence note

Remotion is free for individuals and companies of up to three people. A larger company needs a Remotion company licence to use it; see remotion.dev/license.
