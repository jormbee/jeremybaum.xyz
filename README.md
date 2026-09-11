# welcome to my website
it's simple, but it works :)

## adding gallery photos

1. Add `.jpg`, `.jpeg`, or `.png` files to `images/gallery/`.
2. Run `node scripts/sync-gallery.mjs` to preview them locally.
3. Edit the generated `aria-label` and `data-location` in `index.html` when a nicer caption is wanted. Future syncs preserve those edits.

When gallery files are pushed to GitHub, the gallery sync workflow runs automatically and commits the updated photo list. The browser gives every filename a stable shuffle value, then arranges the shuffled pool into the varied orientation cadence—so there is no photo-order list to maintain. New photos automatically receive the same equal-area sizing and vertical rhythm. The layout allows up to three portraits in succession but no more than two landscapes when the folder contains a mathematically workable mix.

If the mix cannot satisfy those limits, the ordering minimizes and spreads unavoidable excess runs while retaining every photo. Base photo sizing is calculated only by the sync script; the browser applies the decorative size and position variations. Loading priority follows the first displayed photo automatically. Hover and keyboard-focus highlights are controlled by CSS.
