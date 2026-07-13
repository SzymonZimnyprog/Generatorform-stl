import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

const r = (p) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: r('index.html'),
        litofania: r('litofania.html'),
        napis: r('napis.html'),
        stempel: r('stempel.html'),
        brelok: r('brelok.html'),
        wykrawacz: r('wykrawacz.html'),
        forma: r('forma.html'),
        doniczka: r('doniczka.html'),
        tacka: r('tacka.html'),
      },
    },
  },
})
