<script setup lang="ts">
import { ref } from 'vue';
import type { EditorShapeLayer } from '@photo-studio/shared';
const props = defineProps<{ width: number; height: number; shape: EditorShapeLayer['shape'] }>();
const emit = defineEmits<{ draw: [value: { x: number; y: number; width: number; height: number; rotation: number }] }>();
const root = ref<SVGSVGElement | null>(null); const box = ref<{ x: number; y: number; width: number; height: number } | null>(null);
const start = ref<{ x: number; y: number } | null>(null); const end = ref<{ x: number; y: number } | null>(null);
function point(event: PointerEvent) { const rect = root.value!.getBoundingClientRect(); return { x: Math.max(0, Math.min(props.width, (event.clientX - rect.left) / rect.width * props.width)), y: Math.max(0, Math.min(props.height, (event.clientY - rect.top) / rect.height * props.height)) }; }
function down(event: PointerEvent) { if (event.button !== 0) return; start.value = point(event); end.value = start.value; box.value = null; root.value!.setPointerCapture(event.pointerId); event.preventDefault(); }
function move(event: PointerEvent) { if (!start.value) return; end.value = point(event); box.value = { x: Math.min(start.value.x, end.value.x), y: Math.min(start.value.y, end.value.y), width: Math.abs(end.value.x - start.value.x), height: Math.abs(end.value.y - start.value.y) }; }
function up(event: PointerEvent) {
  if (!start.value) return; move(event); const value = box.value;
  if (value && (value.width >= 1 || value.height >= 1)) {
    /* 线条沿实际拖动方向，借用已有旋转字段，保留端点和箭头方向。 */
    if (['line', 'arrow'].includes(props.shape)) { const dx = end.value!.x - start.value.x; const dy = end.value!.y - start.value.y; const angle = Math.atan2(dy, dx); emit('draw', { x: start.value.x + Math.sin(angle) * 12, y: start.value.y - Math.cos(angle) * 12, width: Math.hypot(dx, dy), height: 24, rotation: angle * 180 / Math.PI }); }
    else emit('draw', { ...value, width: Math.max(1, value.width), height: Math.max(1, value.height), rotation: 0 });
  }
  start.value = null; end.value = null; box.value = null;
}
</script>
<template><svg ref="root" class="shape-draw" :viewBox="`0 0 ${width} ${height}`" aria-label="拖动绘制形状" @pointerdown.stop="down" @pointermove="move" @pointerup="up" @pointercancel="start = null; end = null; box = null"><defs><marker id="shape-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10" fill="none" stroke="#3b82f6" /></marker></defs><line v-if="start && end && ['line', 'arrow'].includes(shape)" :x1="start.x" :y1="start.y" :x2="end.x" :y2="end.y" :marker-end="shape === 'arrow' ? 'url(#shape-arrow)' : undefined" stroke="#3b82f6" stroke-width="2" vector-effect="non-scaling-stroke" /><ellipse v-else-if="box && shape === 'ellipse'" :cx="box.x + box.width / 2" :cy="box.y + box.height / 2" :rx="box.width / 2" :ry="box.height / 2" fill="none" stroke="#3b82f6" stroke-width="2" vector-effect="non-scaling-stroke" /><polygon v-else-if="box && shape === 'triangle'" :points="`${box.x + box.width / 2},${box.y} ${box.x + box.width},${box.y + box.height} ${box.x},${box.y + box.height}`" fill="none" stroke="#3b82f6" stroke-width="2" vector-effect="non-scaling-stroke" /><rect v-else-if="box" :x="box.x" :y="box.y" :width="box.width" :height="box.height" fill="none" stroke="#3b82f6" stroke-width="2" vector-effect="non-scaling-stroke" /></svg></template>
<style scoped lang="scss">.shape-draw { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 2; cursor: crosshair; touch-action: none; }</style>
