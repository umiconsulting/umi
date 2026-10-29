# Umi landing page

The public page presents Umi as one connected operation for independent restaurants. The current direction is **Editorial Tide**. Read [DESIGN.md](DESIGN.md) for the layout rules, image sources, and publication gate.

## Local commands

Run commands from the repository root:

```sh
pnpm --filter @umi/landing dev
pnpm --filter @umi/landing build
pnpm --filter @umi/landing exec jest --config jest.config.js --runInBand src/app/api/contact/__tests__/route.test.ts
```

The app uses Next.js 15.5.20. Its local route at `/api/contact` sends a demo request by email. If `NEXT_PUBLIC_UMI_API_BASE` is set at build time, the form sends the same request to the central Umi API. Both routes require the team notification to succeed before they report success.

## Client material

The page names ONCA for the full integration and Kalala Café and El Gran Ribera for Umi Cash. The images in `public/editorial` come from Umi product evidence and existing client brand files. The ONCA team photo is pending; do not substitute stock or generated people imagery for it.

## Publication gate

The page at `/aviso-de-privacidad` is a draft. Confirm the responsible legal entity, address, processors, transfers, and retention period. Approve the final notice before the demo form collects public submissions. The source for the current notice draft is the [Mexican personal data law](https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf), articles 14 to 16.
