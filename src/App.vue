<script setup lang="ts">
import { ref } from 'vue'

const count = ref(0)
</script>

<template>
  <main class="app">
    <img src="/logo.svg" alt="App logo" class="logo" width="96" height="96" />
    <h1>It works — and it's installable.</h1>
    <p class="tagline">
      Vue + Vite, served as a PWA. Add it to your home screen for a native-like
      experience, or wrap it with Capacitor for the app stores.
    </p>
    <button type="button" @click="count++">Clicked {{ count }} times</button>
    <p class="hint">Edit <code>src/App.vue</code> to start building.</p>
  </main>
</template>

<style scoped>
.app {
  max-width: 36rem;
  margin: 0 auto;
  padding: max(2rem, env(safe-area-inset-top)) 1.5rem 2rem;
  text-align: center;
}
.logo {
  margin-bottom: 1rem;
}
h1 {
  font-size: 1.6rem;
  line-height: 1.2;
}
.tagline {
  color: #555;
  margin-bottom: 1.5rem;
}
button {
  font: inherit;
  padding: 0.6rem 1.2rem;
  border: none;
  border-radius: 0.5rem;
  background: #42b883;
  color: #fff;
  cursor: pointer;
}
button:hover {
  background: #369b6f;
}
.hint {
  margin-top: 2rem;
  color: #888;
  font-size: 0.9rem;
}
</style>
