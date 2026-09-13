import { chromium } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// SVG sources are independent copies; regeneration never reads or writes temp/.
// Native tabBar uses PNG assets, with its standard large icon / small label layout.
const directory = resolve(import.meta.dirname, '../apps/miniprogram/assets/icons')
const variants = [
  ['home', 'home', '#70786f'],
  ['home-filled', 'home-filled', '#24754c'],
  ['list', 'list', '#70786f'],
  ['list-filled', 'list-filled', '#24754c'],
  ['settings', 'settings', '#70786f'],
  ['settings-filled', 'settings-filled', '#24754c'],
  ['home-navigation', 'home', '#2e6240'],
  ['right', 'right', '#738076'],
  ['left', 'left', '#2e6240'],
  ['down', 'down', '#2e6240'],
  ['plus', 'plus', '#2e6240'],
  ['delete', 'delete', '#2e6240'],
  ['edit', 'edit', '#2e6240'],
]

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  for (const [name, source, color] of variants) {
    const svg = (await readFile(resolve(directory, `${source}.svg`), 'utf8'))
      .replace(/^[\s\S]*?(<svg\b)/, '$1')
      .replace('<path ', `<path fill="${color}" `)
    const png = await page.evaluate(async (markup) => {
      const image = new Image()
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup)
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 84
      canvas.getContext('2d').drawImage(image, 0, 0, 84, 84)
      return canvas.toDataURL('image/png').split(',')[1]
    }, svg)
    await writeFile(resolve(directory, `${name}.png`), Buffer.from(png, 'base64'))
  }
  console.log(`Generated ${variants.length} WeChat icons from copied SVG sources.`)
} finally {
  await browser.close()
}
