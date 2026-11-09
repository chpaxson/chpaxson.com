<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { basicSetup } from 'codemirror'
import { Compartment, EditorState, Prec } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { indentWithTab, insertNewline } from '@codemirror/commands'
import { oneDark } from '@codemirror/theme-one-dark'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { TypstHighlightSytle, typst_lezer, typstTags,
  typstLezerFoldService } from 'codemirror-lang-typst/lezer'

const props = defineProps<{ modelValue: string; dark: boolean; disabled: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const host = ref<HTMLDivElement>()
const theme = new Compartment()
const editable = new Compartment()
let view: EditorView | undefined
const darkTypst = syntaxHighlighting(HighlightStyle.define([
  { tag: [typstTags.interpolated, typstTags.listMarker], color: '#c678dd' },
  { tag: typstTags.mathDelimiter, color: '#98c379' },
]))
function editorTheme(dark: boolean) {
  return dark ? [oneDark, darkTypst] : [syntaxHighlighting(TypstHighlightSytle)]
}

onMounted(() => {
  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        // Completion also uses highest priority, so plain Enter/Tab must be registered first.
        Prec.highest(keymap.of([{ key: 'Enter', run: insertNewline, shift: insertNewline }, indentWithTab])),
        // The package's full support installs light-only colors even in dark mode.
        basicSetup, typst_lezer().language, typstLezerFoldService,
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ 'aria-label': 'Typst source', spellcheck: 'false' }),
        theme.of(editorTheme(props.dark)),
        editable.of(EditorState.readOnly.of(props.disabled)),
        EditorView.updateListener.of(update => {
          if (update.docChanged) emit('update:modelValue', update.state.doc.toString())
        }),
      ],
    }),
  })
})
watch(() => props.modelValue, value => {
  if (view && value !== view.state.doc.toString()) {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
  }
})
watch(() => props.dark, value => view?.dispatch({ effects: theme.reconfigure(editorTheme(value)) }))
watch(() => props.disabled, value => view?.dispatch({ effects: editable.reconfigure(EditorState.readOnly.of(value)) }))
onUnmounted(() => view?.destroy())
</script>

<template><div ref="host" class="typst-code-editor"></div></template>
