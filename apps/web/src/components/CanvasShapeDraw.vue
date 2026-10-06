<script setup lang="ts">
import { ref } from 'vue';
import type { EditorShapeLayer } from '@photo-studio/shared';
const props = defineProps<{ width: number; height: number; shape: EditorShapeLayer['shape'] }>();
const emit = defineEmits<{ draw: [value: { x: number; y: number; width: number; height: number }] }>();
const root = ref<SVGSVGElement | null>(null); const box = ref<{ x: number; y: number; width: number; height: number } | null>(null);
let start: { x: number; y: number } | null = null;
function point(event: PointerEvent) { const rect = root.value!.getBoundingClientRect(); return { x: Math.max(0, Math.min(props.width, (event.clientX - rect.left) / rect.width * props.width)), y: Math.max(0, Math.min(props.height, (event.clientY - rect.top) / rect.height * props.height)) }; }
function down(event: PointerEvent) { if (event.button !== 0) return; start = point(event); box.value = null; root.value!.setPointerCapture(event.pointerId); event.preventDefault(); }
function move(event: PointerEvent) { if (!start) return; const end = point(event); box.value = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) }; }
function up(event: PointerEvent) { if (!start) return; move(event); const value = box.value; if (value && (value.width >= 1 || value.height >= 1)) emit('draw', { ...value, width: Math.max(1, value.width), height: Math.max(['line', 'arrow'].includes(props.shape) ? 24 : 1, value.height) }); start = null; box.value = null; }
</script>
<template><svg ref="root" class="shape-draw" :viewBox="`0 0 ${width} ${height}`" aria-label="拖动绘制形状" @pointerdown.stop="down" @pointermove="move" @pointerup="up" @pointercancel="start = null; box = null"><ellipse v-if="box && shape === 'ellipse'" :cx="box.x + box.width / 2" :cy="box.y + box.height / 2" :rx="box.width / 2" :ry="box.height / 2" fill="none" stroke="#3b82f6" stroke-width="2" vector-effect="non-scaling-stroke" /><rect v-else-if="box" :x="box.x" :y="box.y" :width="box.width" :height="box.height" fill="none" stroke="#3b82f6" stroke-width="2" vector-effect="non-scaling-stroke" /></svg></template>
<style scoped lang="scss">.shape-draw { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 2; cursor: crosshair; touch-action: none; }</style>
