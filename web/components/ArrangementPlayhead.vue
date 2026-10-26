<script setup lang="ts">
import type { useStudio } from '../useStudio'
const { studio: s, scale } = defineProps<{ studio: ReturnType<typeof useStudio>; scale: number }>()
</script>

<template>
  <div class="studio-arrangement-playhead" :style="{ left: `${170 + s.arrangementTick.value * scale}px` }"></div>
</template>
