interface SavePickerOptions {
  suggestedName: string
  excludeAcceptAllOption: boolean
  types: { description: string; accept: Record<string, string[]> }[]
}

declare global {
  interface Window {
    showSaveFilePicker?: (options: SavePickerOptions) => Promise<FileSystemFileHandle>
  }
}

export async function saveTypstSource(source: string, filename: string) {
  const suggestedName = /\.typ$/i.test(filename) ? filename : `${filename}.typ`
  if (window.showSaveFilePicker) {
    let handle: FileSystemFileHandle
    try {
      handle = await window.showSaveFilePicker({
        suggestedName,
        excludeAcceptAllOption: true,
        types: [{ description: 'Typst source', accept: { 'text/plain': ['.typ'] } }],
      })
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      throw cause
    }
    const writable = await handle.createWritable()
    await writable.write(source)
    await writable.close()
    return { filename: handle.name, downloaded: false }
  }
  const url = URL.createObjectURL(new Blob([source], { type: 'text/plain;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = suggestedName
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return { filename: suggestedName, downloaded: true }
}
