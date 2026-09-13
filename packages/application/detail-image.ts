// Capture rendered WXML geometry and computed styles, rather than maintaining
// a second report template with its own layout and typography.
export const DETAIL_IMAGE_STYLE_FIELDS = [
  'backgroundColor', 'color', 'fontSize', 'fontWeight', 'fontFamily', 'lineHeight', 'letterSpacing', 'textAlign', 'display',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderRadius',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
]
export interface ReportBounds { left: number; top: number; width: number; height: number; right?: number; bottom?: number }
export interface ReportNode extends ReportBounds {
  dataset?: { exportText?: string | number }
  [property: string]: unknown
}
export interface ImageFont { size: number; weight: string; family: string; spacing: number }
export type ImageCommand =
  | { kind: 'text'; text: string; x: number; y: number; color: string; font: ImageFont }
  | { kind: 'rect'; x: number; y: number; width: number; height: number; radius: number; color: string }
const px = (value: unknown, fallback = 0): number => {
  const result = parseFloat(String(value))
  return Number.isFinite(result) ? result : fallback
}
const visibleColor = (value: unknown): value is string => typeof value === 'string' && value !== 'transparent' && !/^rgba\([^)]*,\s*0\s*\)$/.test(value)

export function detailImageLayout(bounds: ReportBounds, nodes: ReportNode[], measure: (text: string, font: ImageFont) => number) {
  if (!(bounds.width > 0 && bounds.height > 0) || !nodes.length) throw new Error('明细页面尚未准备好，请稍后重试')
  // Prefer rectangle edges to size fields: native component measurements can
  // differ from the outer box, and children may extend past their container.
  nodes = nodes.map(node => ({ ...node,
    width: typeof node.right === 'number' ? node.right - node.left : node.width,
    height: typeof node.bottom === 'number' ? node.bottom - node.top : node.height,
  }))
  const visible = nodes.filter(node => node.width > 0 && node.height > 0 && node.display !== 'none')
  const left = Math.min(bounds.left, ...visible.map(node => node.left))
  const topEdge = Math.min(bounds.top, ...visible.map(node => node.top))
  const right = Math.max(bounds.right ?? bounds.left + bounds.width, ...visible.map(node => node.left + node.width))
  const bottom = Math.max(bounds.bottom ?? bounds.top + bounds.height, ...visible.map(node => node.top + node.height))
  const commands: ImageCommand[] = []
  const insetX = 16, insetTop = 20
  let width = right - left + insetX * 2, height = bottom - topEdge + insetTop + 32
  for (const node of nodes) {
    if (!node.width || !node.height || node.display === 'none') continue
    const x = node.left - left + insetX, y = node.top - topEdge + insetTop
    if (visibleColor(node.backgroundColor)) commands.push({ kind: 'rect', x, y, width: node.width, height: node.height,
      radius: Math.min(px(node.borderRadius), node.width / 2, node.height / 2), color: node.backgroundColor })
    const borders = ['Top', 'Right', 'Bottom', 'Left'].map(side => ({ width: px(node[`border${side}Width`]), color: node[`border${side}Color`] }))
    const uniform = borders.every(border => border.width === borders[0].width && border.color === borders[0].color)
    if (uniform && borders[0].width && visibleColor(borders[0].color)) {
      const border = borders[0].width, radius = Math.min(px(node.borderRadius), node.width / 2, node.height / 2)
      commands.push({ kind: 'rect', x, y, width: node.width, height: node.height, radius, color: borders[0].color })
      commands.push({ kind: 'rect', x: x + border, y: y + border, width: node.width - border * 2, height: node.height - border * 2,
        radius: Math.max(0, radius - border), color: visibleColor(node.backgroundColor) ? node.backgroundColor : '#f5f7f4' })
    } else {
      borders.forEach((border, side) => {
        if (!border.width || !visibleColor(border.color)) return
        commands.push({ kind: 'rect', radius: 0, color: border.color,
          x: x + (side === 1 ? node.width - border.width : 0), y: y + (side === 2 ? node.height - border.width : 0),
          width: side % 2 ? border.width : node.width, height: side % 2 ? node.height : border.width })
      })
    }
    if (node.dataset?.exportText === undefined) continue
    const font: ImageFont = { size: px(node.fontSize, 16), weight: String(node.fontWeight || '400'), family: String(node.fontFamily || 'sans-serif'), spacing: px(node.letterSpacing) }
    const paddingLeft = px(node.paddingLeft) + borders[3].width, paddingRight = px(node.paddingRight) + borders[1].width
    const available = node.width - paddingLeft - paddingRight
    if (available <= 0) continue
    const lineHeight = px(node.lineHeight, font.size * 1.55)
    const lines: string[] = []
    const textWidth = (value: string) => measure(value, font) + Math.max(0, Array.from(value).length - 1) * font.spacing
    for (const paragraph of String(node.dataset.exportText).split('\n')) {
      let line = ''
      for (const character of paragraph) {
        if (line && textWidth(line + character) > available + .5) { lines.push(line); line = '' }
        line += character
      }
      lines.push(line)
    }
    const top = y + px(node.paddingTop) + borders[0].width + Math.max(0, (lineHeight - font.size) / 2)
    lines.forEach((line, index) => {
      const alignment = node.textAlign === 'center' ? (available - textWidth(line)) / 2 : node.textAlign === 'right' ? available - textWidth(line) : 0
      commands.push({ kind: 'text', text: line, x: x + paddingLeft + alignment, y: top + index * lineHeight, font, color: String(node.color || '#24332a') })
      width = Math.max(width, x + paddingLeft + alignment + textWidth(line) + insetX)
      height = Math.max(height, top + index * lineHeight + font.size + 32)
    })
  }
  return { width, height, background: '#f5f7f4', commands }
}

export function detailImageScale(width: number, height: number, maxSide = 4096) {
  return Math.min(3, maxSide / Math.max(width, height), Math.sqrt(12_000_000 / (width * height)))
}
