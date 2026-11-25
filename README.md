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

The website and both tools are served by the same Vue Router application.

## Tools

The **Tools** page (`/tools`) links to tools that now live in their own repositories and GitHub Pages sites:

- [Brady M211 Label Studio](https://chpaxson.com/brady-m211-studio/) ([source](https://github.com/chpaxson/brady-m211-studio))
- [Multichannel Serial Console](https://chpaxson.com/multichannel-serial-console/) ([source](https://github.com/chpaxson/multichannel-serial-console)), including its Windows Telnet gateway

The old `/bradym211`, `/bradym211.html`, `/serialconsole`, and `/serialconsole.html` URLs redirect to the new locations.

## Publish to GitHub Pages

The GitHub Actions workflow in `.github/workflows/static.yml` deploys the site when changes are pushed to the `main` branch:

1. It checks out the repository.
2. It builds the Vite project.
3. It publishes the build output (and the repository's `data/` directory) to GitHub Pages.

To publish a change, push or merge it to `main` and monitor the **Actions** tab for the “Deploy static site to GitHub Pages” workflow. In the repository's **Settings → Pages**, ensure the publishing source is set to **GitHub Actions**. The workflow URL will be shown after deployment completes.
