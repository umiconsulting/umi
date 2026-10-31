# Umi landing page

The public page presents Umi as one connected operation for independent restaurants. The current direction is **Editorial Tide**. Read [DESIGN.md](DESIGN.md) for the layout rules, image sources, and publication gate.

## Local commands

Run commands from the repository root:

```sh
pnpm --filter @umi/landing dev
pnpm --filter @umi/landing build
```

The app uses Next.js 15.5.20 and exports static pages to `out`. Cloudflare Pages serves the pages and images. A Pages Function at `/api/contact` forwards the form to the central Umi API. The central API sends the team notification and visitor confirmation. The old Next API routes are archived in `archive/next-api`; they are not deployed.

Use `pnpm dlx wrangler@4.129.0 pages dev out --binding API_ORIGIN=https://api-staging.umiconsulting.co` to test the Pages Function locally. The `wrangler.toml` file points preview deployments at the staging API and production deployments at the production API.

## Client material

The page names ONCA for the full integration and Kalala Café and El Gran Ribera for Umi Cash. The images in `public/editorial` come from Umi product evidence and existing client brand files. The ONCA team photo is pending; do not substitute stock or generated people imagery for it.

## Publication gate

The page at `/aviso-de-privacidad` is a draft. Confirm the responsible legal entity, address, processors, transfers, and retention period, then update the public notice. The production deploy keeps the demo form enabled as requested. The source for the current notice draft is the [Mexican personal data law](https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf), articles 14 to 16.
