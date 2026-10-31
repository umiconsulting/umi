# Editorial Tide

## Decision

The landing page speaks first to independent restaurant operators. Its promise is one clear operation: a connected path from the order to the next visit.

The page uses [Dusk](https://lexingtonthemes.com/templates/dusk) as a reference for strong type, a strict grid, and deliberate image scale. It uses the Umi dashboard fish image as its only atmospheric hero image. A quiet shader adds movement on wider screens. The fish image carries the narrow layout. The shader stops when the hero leaves the viewport or the visitor asks for reduced motion.

## Directions considered

| Direction       | Purpose                                                                    | Decision                                                                                                |
| --------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Full dark sea   | Make the fish image and shader the whole experience                        | Rejected by design judgment. It would give product views and client brands less contrast and hierarchy. |
| Light editorial | Make the client stories and copy easy to scan                              | Rejected as a complete direction. It would give the Umi image too little space.                         |
| Editorial Tide  | Use the dark image for entry, then use light sections for proof and action | Selected. Each visual layer has one job.                                                                |

The first browser pass showed that the form's optional labels had insufficient contrast. The labels now use the body muted color. The shader ships one program. Browser instrumentation confirms that it pauses off screen, unmounts on narrow screens, and stays off under reduced motion. The client panels use actual brand art at a scale that reads without taking over the page.

Lighthouse 13.4.1 on the local production build measured mobile performance at 84 before the narrow-screen shader change and 96 after it. Total blocking time fell from 510 ms to 10 ms. Desktop performance stayed at 100. These are synthetic runs in headless Chromium, not field measurements. The remaining mobile LCP was 2.7 s; the hero image was its largest element. The optimized image transfer was about 21 KiB, so further compression offers little gain. Keep Next.js 15 for now; the measured cost came from the shader work on narrow screens, not a need to replace the app framework.

## Visual principles

- Use a dark blue hero and light paper sections. Let the product and client evidence carry the detail.
- Use Inter Tight for headings, Source Sans 3 for copy, and JetBrains Mono for labels.
- Use generous space to separate ideas. Use rules and alignment to keep the page full without making a card for every sentence.
- Use Umi blue for actions and a small number of useful accents. Avoid decorative glow.
- Keep images at a size that shows what the reader should understand. The ONCA product views show order, kitchen, and checkout. The Cash brand panels show client identity.
- Name the real client and the real product scope. Do not claim results or quote a client without evidence and approval.
- Keep the form short. Require an email address. Treat WhatsApp as optional.

## Content and image rules

ONCA represents the full integration. Kalala Café and El Gran Ribera represent Umi Cash. The ONCA people photo can replace or join the main product image after the approved file arrives. Review its crop before that change; a large human photo will shift the page tone.

The source files for the current images are:

| Public asset           | Source                                                                                                                   | Use                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| `sea-hero.jpg`         | `apps/umi-dashboard/public/login-bg.jpg`                                                                                 | Hero atmosphere                 |
| `onca-pos.png`         | `docs/reports/evidence/2026-10-11-onca-logo/20-pos-onca-catalogue.png`                                                   | ONCA order view                 |
| `onca-kitchen.png`     | `docs/reports/evidence/2026-10-13-prueba-pizza-kds/margarita-en-preparacion.png`                                         | ONCA kitchen view               |
| `onca-checkout.png`    | `docs/reports/evidence/2026-10-22-local-first-checkout/01-single-cash-action.png`                                        | ONCA checkout view              |
| `kalala-*`, `ribera-*` | `apps/umi-dashboard/public/logos/kalala-logo.png`, `kalala-strip.png`, `ribera-logo-transparent.png`, `ribera-strip.png` | Client identity and pass design |

## Publication gate

The privacy notice is a draft. Confirm the legal identity, address, data processors, transfers, and retention period. Review the notice before public form collection. The current legal basis is the [Mexican personal data law](https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf), articles 14 to 16, as published by the Chamber of Deputies.

The browser sends the name, restaurant, email, optional WhatsApp number, optional message, and notice acceptance to `/api/contact`. On Cloudflare Pages, a Pages Function forwards this request to the central API. Preview uses the staging API; production uses the production API. The central API sends the team notification and then attempts visitor confirmation. It does not create a lead row for this form. Brevo is the intended mail provider; its deployed credentials and delivery remain unverified.

Before release, check the deployed API target, hosting provider, mail provider, inbox owner, retention periods, and any transfers with the legal owner. Then replace every pending section in the notice and obtain approval for the final text.

## Lead delivery check

On 2026-10-24, a real browser submission to the local Next route reached Mailpit. The team and visitor messages arrived. The team message kept the restaurant, WhatsApp number, request text, and visitor reply address. A second browser submission used `NEXT_PUBLIC_UMI_API_BASE` and reached the central API on a local port. Its team message also arrived in Mailpit. A direct API request with `privacyAccepted: false` returned 400. These checks used a local mail sink and test addresses; they do not prove delivery through the production SMTP provider.
