<script setup lang="ts">
import { computed, watch } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import NavigationBar from './components/NavigationBar.vue'

const route = useRoute()
const showNav = computed(() => !route.path.startsWith('/amc'))
const fullHeight = computed(() => !!route.meta.fullHeight)
watch(() => route.meta.title, (title) => {
  document.title = typeof title === 'string' ? title : 'Charles Paxson - Mechanical Engineer'
}, { immediate: true })
</script>

<template>
  <div class="app-container" :class="{ 'full-height': fullHeight }">
    <NavigationBar v-if="showNav" />
    <main class="main-content">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.app-container {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.main-content {
  flex: 1;
}

.full-height {
  height: 100dvh;
  min-height: 0;
}

.full-height > .navigation-bar {
  flex-shrink: 0;
}

.full-height > .main-content {
  display: flex;
  min-height: 0;
  overflow: hidden;
}
</style>
