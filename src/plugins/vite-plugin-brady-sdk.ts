import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

// Serve the SDK unchanged, with its sibling WASM assets and license notices.
export default function bradySdkAssets(): Plugin {
  const packageRoot = new URL('../../node_modules/@bradycorporation/brady-web-sdk/', import.meta.url)
  const files = new Map<string, Buffer>()
  return {
    name: 'brady-sdk-assets',
    async buildStart() {
      files.clear()
      for (const name of await readdir(new URL('dist/', packageRoot))) {
        files.set(name, await readFile(new URL(`dist/${name}`, packageRoot)))
      }
      files.set('LICENSE.md', await readFile(new URL('LICENSE.md', packageRoot)))
      const modules = new URL('../../node_modules/', import.meta.url)
      files.set('typst-0.7.0.wasm', await readFile(new URL('@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm', modules)))
      files.set('typst-LICENSE', await readFile(new URL('@myriaddreamin/typst.ts/LICENSE', modules)))
      files.set('pdfjs-6.5.438.worker.mjs', await readFile(new URL('pdfjs-dist/build/pdf.worker.min.mjs', modules)))
      files.set('pdfjs-LICENSE', await readFile(new URL('pdfjs-dist/LICENSE', modules)))
      for (const [directory, output] of [['standard_fonts', 'pdf-fonts'], ['wasm', 'pdf-wasm'], ['cmaps', 'pdf-cmaps']]) {
        for (const name of await readdir(new URL(`pdfjs-dist/${directory}/`, modules))) {
          files.set(`${output}/${name}`, await readFile(new URL(`pdfjs-dist/${directory}/${name}`, modules)))
        }
      }
    },
    configureServer(server) {
      server.middlewares.use('/brady-sdk', (req, res, next) => {
        const name = req.url?.split('?')[0]?.slice(1)
        const content = name && files.get(name)
        if (!content) return next()
        res.setHeader('Content-Type', name.endsWith('.wasm')
          ? 'application/wasm'
          : /\.(js|mjs)$/.test(name) ? 'text/javascript' : 'text/plain')
        res.end(content)
      })
      server.watcher.add(fileURLToPath(packageRoot))
    },
    generateBundle() {
      for (const [name, source] of files) {
        this.emitFile({ type: 'asset', fileName: `brady-sdk/${name}`, source })
      }
    },
  }
}
