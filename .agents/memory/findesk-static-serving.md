---
name: FinDesk dev serves a static build
description: Why source edits to artifacts/findesk don't show until you rebuild, and the layout gotcha with shadcn Button absolute positioning
---

# FinDesk dev preview serves a STATIC build

The `findesk` artifact's dev workflow runs `node serve-static.cjs`, which serves the pre-built bundle from `artifacts/findesk/dist/public`. It is NOT a Vite dev server.

**Why:** source edits are invisible in the preview until the bundle is rebuilt. A confusing symptom is "my change did nothing / the page looks unchanged or broken."

**How to apply:** after editing any `artifacts/findesk` source, run `pnpm --filter @workspace/findesk run build` then `restart_workflow("artifacts/findesk: web")`, then screenshot to verify. Base path defaults to `/` (matches previewPath), so a plain build is fine.

# shadcn Button + absolute positioning gotcha

Absolutely positioning a shadcn `Button` (e.g. `absolute right-2 top-1/2`) over an input did NOT take effect here — the button (it's `inline-flex`) fell into normal flow and got centered by a parent `text-center`, even though the same `absolute` classes worked fine on a plain `<svg>` icon.

**Why:** caused a visible bug where a hero "Analyze" button rendered centered below the search input instead of right-aligned inside it.

**How to apply:** for input + adjacent button, use a flex row (input in a `flex-1` wrapper, button as a `shrink-0` sibling) instead of absolutely positioning the button over the input.
