<script setup lang="ts">
import { RouterLink } from 'vue-router'

const tools = [
  {
    title: 'Brady M211 Label Studio',
    href: '/bradym211',
    symbol: 'M211',
    description: 'Create labels from images, PDFs, or Typst and print directly to a Brady M211 over Bluetooth.',
    requirement: 'Chrome or Edge · Web Bluetooth',
  },
  {
    title: 'Serial Console',
    href: '/serialconsole',
    symbol: '>_',
    description: 'Connect to serial devices in your browser with multiple ports, text and hex views, and downloadable logs.',
    requirement: 'Chrome or Edge · Web Serial',
  },
]
</script>

<template>
  <div class="tools">
    <div class="container">
      <h1>Tools</h1>
      <p class="intro">Browser-based utilities for working with hardware. No installation required.</p>
      <div class="tools-grid">
        <RouterLink v-for="tool in tools" :key="tool.href" :to="tool.href" class="tool-card">
          <div class="tool-symbol" aria-hidden="true">{{ tool.symbol }}</div>
          <div class="tool-content">
            <h2>{{ tool.title }} <span aria-hidden="true">&rarr;</span></h2>
            <p>{{ tool.description }}</p>
            <span class="requirement">{{ tool.requirement }}</span>
          </div>
        </RouterLink>
      </div>
      <p class="note">Device connections require HTTPS or localhost and your permission.</p>
    </div>
  </div>
</template>

<style scoped>
.tools { padding: 2rem; }
.container { max-width: 1200px; margin: 0 auto; }
h1 { font-size: 2.5rem; text-align: center; margin-bottom: 0.75rem; }
.intro, .note { text-align: center; color: var(--color-text); }
.tools-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2rem; margin: 2rem 0; }
.tool-card {
  display: flex;
  flex-direction: column;
  color: inherit;
  text-decoration: none;
  background: var(--color-background-soft);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  transition: transform 0.3s ease, box-shadow 0.3s ease;
}
.tool-card:hover, .tool-card:focus-visible { transform: translateY(-4px); box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15); }
.tool-card:focus-visible { outline: 2px solid var(--color-heading); outline-offset: 4px; }
.tool-symbol {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 160px;
  font: bold 3rem monospace;
  color: var(--color-heading);
  background: linear-gradient(135deg, var(--color-background-mute), var(--color-background-soft));
}
.tool-content { padding: 1.5rem; }
h2 { font-size: 1.5rem; color: var(--color-heading); margin-bottom: 0.75rem; }
h2 span { display: inline-block; transition: transform 0.3s ease; }
.tool-card:hover h2 span { transform: translateX(4px); }
.tool-content p { margin-bottom: 1rem; line-height: 1.6; }
.requirement { display: inline-block; border-radius: 999px; padding: 0.25rem 0.75rem; background: var(--color-background-mute); font-size: 0.85rem; }
.note { font-size: 0.9rem; }
@media (max-width: 768px) {
  .tools { padding: 1rem; }
  .tools-grid { grid-template-columns: 1fr; gap: 1rem; }
  h1 { font-size: 2rem; }
}
@media (prefers-reduced-motion: reduce) {
  .tool-card, h2 span { transition: none; }
}
</style>
