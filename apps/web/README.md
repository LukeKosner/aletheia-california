# @aletheia/web

Next.js App Router app (TypeScript strict, Tailwind 4, shadcn/ui, AI Elements).

```bash
bun run dev   # http://localhost:3001 (override with PORT)
```

- UI primitives: `src/components/ui` (shadcn/ui). AI Elements: `src/components/ai-elements`.
  Add more with `bunx --bun shadcn@latest add <name>` or `@ai-elements/<name>`.
- Feature flags: `src/lib/flags.ts`.
- Colors only from theme tokens in `src/app/globals.css`. CI fails on raw hex or `rgb(`.
