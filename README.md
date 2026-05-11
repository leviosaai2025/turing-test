# Leviosa Turing Test

Simple exhibition quiz: visitors get 10 seconds per image to guess whether it is AI-generated or human-made.

## Photo Workflow

Put images into these folders:

- `public/ai/` for AI-generated images
- `public/human/` for human/real images

Both folders need at least one image before the exhibition quiz will start.

Supported formats: `.jpg`, `.jpeg`, `.png`, `.webp`, `.avif`.

The app generates its quiz manifest automatically before `dev`, `build`, and `lint`.

## Commands

```bash
npm run dev
npm run build
npm run lint
```

Deploy on Vercel as a normal Next.js project.
