# chpaxson.github.io

Personal website built with Vue 3, TypeScript, and Vite, and published to GitHub Pages.

## Requirements

- Node.js `^20.19.0` or `>=22.12.0`
- npm

## Run locally

Install dependencies and start the Vite development server:

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. The server supports hot reloading while you edit the site.

## Build and preview

Create and validate a production build:

```sh
npm run build
```

This runs the TypeScript/Vue type check and builds the site into `dist/`. To serve that build locally:

```sh
npm run preview
```

The standalone serial console is included in the build as `dist/serialconsole.html`. On the deployed site, it is available at `/serialconsole` (which redirects to that HTML page) and `/serialconsole.html`.

## Publish to GitHub Pages

The GitHub Actions workflow in `.github/workflows/static.yml` deploys the site when changes are pushed to the `main` branch:

1. It checks out the repository.
2. It builds the Vite project.
3. It publishes the build output (and the repository's `data/` directory) to GitHub Pages.

To publish a change, push or merge it to `main` and monitor the **Actions** tab for the “Deploy static site to GitHub Pages” workflow. In the repository's **Settings → Pages**, ensure the publishing source is set to **GitHub Actions**. The workflow URL will be shown after deployment completes.