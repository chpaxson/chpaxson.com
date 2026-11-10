<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<template>
  <nav class="navigation-bar">
    <div class="nav-container">
      <RouterLink to="/" class="nav-link">Home</RouterLink>
      <RouterLink to="/projects" class="nav-link">Projects</RouterLink>
      <RouterLink to="/tools" class="nav-link">Tools</RouterLink>
      <RouterLink to="/resume" class="nav-link">Resume</RouterLink>
    </div>
  </nav>
</template>

<style scoped>
.navigation-bar {
  display: flex;
  justify-content: center;
  padding: 1.5rem 0;
  position: sticky;
  top: 0;
  background: var(--color-background);
  z-index: 100;
  border-bottom: 1px solid rgba(128, 128, 128, 0.1);
}

.nav-container {
  display: flex;
  gap: 0;
  background: var(--color-background-soft);
  border-radius: 9999px;
  padding: 0.5rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.nav-link {
  padding: 0.5rem 1.5rem;
  text-decoration: none;
  color: var(--color-text);
  font-weight: 500;
  border-radius: 9999px;
  transition: all 0.3s ease;
  position: relative;
}

.nav-link:hover {
  background: rgba(0, 0, 0, 0.05);
}

.nav-link.router-link-active {
  background: var(--color-background);
  color: var(--color-text);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

@media (prefers-color-scheme: dark) {
  .nav-link:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  @media (max-width: 480px) {
    .nav-link {
      padding: 0.5rem 0.75rem;
    }
  }
}
</style>
