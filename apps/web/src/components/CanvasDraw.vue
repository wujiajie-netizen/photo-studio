<script setup lang="ts">
import { computed, ref } from 'vue';
const props = defineProps<{ width: number; height: number; stroke: string; size: number }>();
const emit = defineEmits<{ draw: [points: number[]] }>();
const root = ref<SVGSVGElement | null>(null); const points = ref<number[]>([]);
const path = computed(() => points.value.map((point, index) => index % 2 ? `${point} ` : `${index ? 'L' : 'M'} ${point} `).join(''));
function point(event: PointerEvent) {
  const bounds = root.value!.getBoundingClientRect();
  return [Math.round(Math.max(0, Math.min(props.width, (event.clientX - bounds.left) / bounds.width * props.width))), Math.round(Math.max(0, Math.min(props.height, (event.clientY - bounds.top) / bounds.height * props.height)))];
}
function down(event: PointerEvent) { if (event.button !== 0) return; points.value = point(event); root.value!.setPointerCapture(event.pointerId); event.preventDefault(); }
function move(event: PointerEvent) { if (points.value.length && points.value.length < 20000) points.value.push(...point(event)); }
function finish() { if (points.value.length >= 4) emit('draw', [...points.value]); points.value = []; }
</script>
<template><svg ref="root" class="canvas-draw" :viewBox="`0 0 ${width} ${height}`" preserveAspectRatio="none" aria-label="画笔绘制区域" @pointerdown="down" @pointermove="move" @pointerup="finish" @pointercancel="points = []"><path :d="path" fill="none" :stroke="stroke" :stroke-width="size" stroke-linecap="round" stroke-linejoin="round" /></svg></template>
<style scoped lang="scss">.canvas-draw { position: absolute; inset: 0; z-index: 3; width: 100%; height: 100%; cursor: crosshair; touch-action: none; }</style>
