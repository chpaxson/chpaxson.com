export function selectionCell(node: Node | null) {
  const element = node instanceof Element ? node : node?.parentElement
  return element?.closest<HTMLElement>('.meta-cell, .text-cell, .hex-cell') ?? null
}

export function selectedCopyText(element: HTMLElement, selection: Selection) {
  if (selection.isCollapsed || !selection.rangeCount ||
      !element.contains(selection.anchorNode) || !element.contains(selection.focusNode)) return null
  const cell = selectionCell(selection.anchorNode)
  if (!cell || cell.contains(selection.focusNode)) return null
  const selector = cell.classList.contains('meta-cell') ? '.meta-cell' :
    cell.classList.contains('hex-cell') ? '.hex-cell' : '.text-cell'
  const cells = selection.getRangeAt(0).cloneContents().querySelectorAll(selector)
  if (!cells.length) return null
  const separator = selector === '.hex-cell' ? ' ' : selector === '.meta-cell' ? '\n' : ''
  return Array.from(cells, (item) => item.textContent ?? '').join(separator)
}
