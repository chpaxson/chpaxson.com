import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'
import { keymap, EditorView } from '@codemirror/view'
import { insertNewline, indentWithTab } from '@codemirror/commands'

async function editorState(doc) {
  const component = await readFile(new URL('../TypstEditor.vue', import.meta.url), 'utf8')
  const script = component.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  let state
  function CaptureView(config) { state = config.state }
  Object.setPrototypeOf(CaptureView, EditorView)
  const context = vm.createContext({
    defineProps: () => ({ modelValue: doc, dark: false, disabled: false }),
    defineEmits: () => () => {},
  })
  const source = ts.transpileModule(script, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = new vm.SourceTextModule(source, { context })
  await module.link(async specifier => {
    const exports = specifier === 'vue'
      ? { ref: () => ({}), onMounted: callback => callback(), onUnmounted: () => {}, watch: () => {} }
      : { ...await import(specifier) }
    if (specifier === '@codemirror/view') exports.EditorView = CaptureView
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value)
    }, { context })
  })
  await module.evaluate()
  return state
}

test('plain Enter and indent Tab precede autocomplete acceptance in the actual editor setup', async () => {
  const state = await editorState('#pagebreak()')
  const bindings = state.facet(keymap).flat()
  const enter = bindings.find(binding => binding.key === 'Enter')
  const tab = bindings.find(binding => binding.key === 'Tab')
  assert.equal(enter.run, insertNewline)
  assert.equal(enter.shift, insertNewline)
  assert.equal(tab.run, indentWithTab.run)
  assert.equal(tab.shift, indentWithTab.shift)
  let next
  enter.run({
    state: state.update({ selection: { anchor: state.doc.length } }).state,
    dispatch: transaction => { next = transaction.state },
  })
  assert.equal(next.doc.toString(), '#pagebreak()\n')
})
