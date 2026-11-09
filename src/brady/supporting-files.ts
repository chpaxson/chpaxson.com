export function mergeSupportingFiles(current: File[], uploads: File[]) {
  const files = new Map(current.map(file => [file.name, file]))
  const replaced: string[] = []
  for (const file of uploads) {
    if (file.name === 'main.typ') throw new Error('main.typ is reserved for the source editor. Rename this supporting file.')
    if (files.has(file.name)) replaced.push(file.name)
    files.set(file.name, file)
  }
  const result = [...files.values()]
  if (result.reduce((size, file) => size + file.size, 0) > 50 * 1024 * 1024) {
    throw new Error('Supporting files must total at most 50 MiB. No files were changed.')
  }
  return { files: result, replaced }
}
