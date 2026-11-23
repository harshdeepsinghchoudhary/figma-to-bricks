# Rules derived from the edited draft

Reference: read-only saved snapshot of page 4955 at `.review-work/user-edits/page-4955.json`. Compared to the last import in job `64e7ec0e-b6f2-4197-882b-b40b235bbffa`.

Implemented reusable compiler behavior:
- Compact text-label lists wrap instead of stacking into tall columns.
- Short CTA groups remain rows on tablet, with wrapping; narrow mobile may stack them.
- Symmetric large padding around a single short heading becomes centering.
- Logo/menu grouping stays together beside the header actions; small-screen groups may wrap to preserve readable labels without hiding content.
- Identical padding-cap CSS is not repeated at every smaller breakpoint.

Independent candidate: `.review-work/manual-rules-candidate/merged/bricks-template-import.json`.
No changes to WordPress, no AI calls, and no GitHub pushes.

Validation: 120 tests passed; candidate has 349 elements, 34 assets, zero validation errors/warnings. Local captures at 1440/1024/390/320 had no horizontal overflow or broken images. Header was recaptured and visually inspected after fixing phone-label squeezing. Local previews do not initialize the real WordPress menu or prove live fidelity.

Not generalized: hiding this site's quote CTA on mobile, manually regrouping its photo collage, or treating all images as height 100%. Those edits need semantic/source evidence and live comparison before becoming universal rules.

Keep page 4955 as the manual reference. Do not retry/import into it merely to test these rules: that would replace the user's saved edits. Use the separate candidate for review or a separately authorized staging page.
