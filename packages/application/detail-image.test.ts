import { expect, it } from 'vitest'
import { detailImageLayout, detailImageScale } from './detail-image'
import type { ImageFont, ReportNode } from './detail-image'

const measure = (text: string, font: ImageFont) => Array.from(text).reduce((width, char) => width + (char.charCodeAt(0) > 255 ? font.size : font.size * .6), 0)
const textNode = (text: string, overrides: Partial<ReportNode> = {}): ReportNode => ({ left: 35, top: 120, width: 140, height: 44, fontSize: '14px', lineHeight: '22px', color: '#728075', dataset: { exportText: text }, ...overrides })
it('按页面真实卡片位置、圆角、标签颜色及两列文字位置生成长图', () => {
  const nodes: ReportNode[] = [
    { left: 16, top: 100, width: 343, height: 160, backgroundColor: '#fff', borderRadius: '18px', borderTopWidth: '1px', borderRightWidth: '1px', borderBottomWidth: '1px', borderLeftWidth: '1px', borderTopColor: '#e4eae2', borderRightColor: '#e4eae2', borderBottomColor: '#e4eae2', borderLeftColor: '#e4eae2' },
    textNode('六年级、初一、初二'),
    textNode('初三、高一', { left: 194 }),
    textNode('已保存', { left: 270, top: 180, width: 70, height: 28, fontSize: '13px', lineHeight: '20px', backgroundColor: '#edf4ec', color: '#32754d', borderRadius: '30px', paddingTop: '4px', paddingLeft: '10px', paddingRight: '10px' }),
  ]
  const layout = detailImageLayout({ left: 16, top: 80, width: 343, height: 400 }, nodes, measure)
  expect(layout).toMatchObject({ width: 375, height: 452, background: '#f5f7f4' })
  expect(layout.commands).toContainEqual(expect.objectContaining({ kind: 'rect', x: 16, y: 40, radius: 18, color: '#e4eae2' }))
  const text = layout.commands.filter(c => c.kind === 'text')
  expect(text.find(c => c.text === '六年级、初一、初二')?.x).toBe(35)
  expect(text.find(c => c.text === '初三、高一')?.x).toBe(194)
  expect(text.find(c => c.text === '已保存')).toMatchObject({ x: 280, color: '#32754d', font: { size: 13 } })
})
it('滚动到页面底部再导出仍使用完整页面坐标，保留底部规则及所有文本', () => {
  const bounds = { left: 16, top: 72, width: 343, height: 12000 }
  const nodes = Array.from({ length: 200 }, (_, i) => textNode(`第${i + 1}项课时和单价`, { top: 90 + i * 59 }))
  nodes.push(textNode('课时费仅供核对，不代表工资已发放。', { top: 11980, width: 343 }))
  const layout = detailImageLayout(bounds, nodes, measure)
  const scrolled = detailImageLayout({ ...bounds, top: bounds.top - 10000 }, nodes.map(node => ({ ...node, top: node.top - 10000 })), measure)
  expect(scrolled).toEqual(layout)
  expect(layout.commands.filter(c => c.kind === 'text').map(c => c.text).join('')).toContain('课时费仅供核对，不代表工资已发放。')
  const scale = detailImageScale(layout.width, layout.height)
  expect(layout.height * scale).toBeLessThanOrEqual(4096)
  expect(layout.width * layout.height * scale * scale).toBeLessThanOrEqual(12_000_001)
})
it('组件外边框和底部规则超出容器测量时，按全部节点保留左右16px和底部32px', () => {
  const node = textNode('一对一：1\n一对二：1.2\n一对三：1.3\n完整规则', {
    left: 16, top: 3900, width: 311, right: 359, height: 50, bottom: 4020,
  })
  const layout = detailImageLayout({ left: 16, top: 80, width: 327, height: 3880 }, [node], measure)
  expect(layout.width).toBe(375)
  expect(layout.height).toBe(3992)
  const text = layout.commands.filter(c => c.kind === 'text')
  expect(text[0].x).toBe(16)
  expect(text.at(-1)?.text).toBe('完整规则')
  expect(text.at(-1)!.y + text.at(-1)!.font.size).toBeLessThanOrEqual(layout.height - 32)
})
it('Canvas换行比原生节点更高时也包含最后一行和底部留白', () => {
  const layout = detailImageLayout({ left: 16, top: 80, width: 343, height: 50 }, [textNode('底部说明'.repeat(20), { left: 16, top: 80, width: 100, height: 40 })], measure)
  const last = layout.commands.filter(c => c.kind === 'text').at(-1)!
  expect(layout.height).toBeGreaterThan(200)
  expect(layout.height - last.y - last.font.size).toBeGreaterThanOrEqual(32)
})
it('长文字按实际字体与字距换行，空布局拒绝导出而不退回简化版', () => {
  const node = textNode('完整的计费表说明不会截断', { width: 100, height: 80, letterSpacing: '1px' })
  const layout = detailImageLayout({ left: 16, top: 80, width: 343, height: 400 }, [node], measure)
  const lines = layout.commands.filter(c => c.kind === 'text')
  expect(lines.length).toBeGreaterThan(1)
  expect(lines.map(c => c.text).join('')).toBe(node.dataset!.exportText)
  for (const line of lines) expect(measure(line.text, line.font) + (line.text.length - 1)).toBeLessThanOrEqual(100)
  expect(() => detailImageLayout({ left: 0, top: 0, width: 0, height: 0 }, [], measure)).toThrow('尚未准备好')
})
