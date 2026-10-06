<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { ProductCanvas } from '@photo-studio/editor';
import type { EditorDocument } from '@photo-studio/shared';
import { request } from '../api';
const props = defineProps<{ resultId: string; zoom: number }>();
const emit = defineEmits<{ size: [value: { width: number; height: number }] }>();
const root = ref<HTMLDivElement | null>(null); const error = ref('');
let canvas: ProductCanvas | null = null; let content: EditorDocument | null = null; let closed = false;
function paint() { if (canvas && content) canvas.render({ name: content.name, width: content.width, height: content.height, background: content.background, layers: content.layers }, content.width, content.height, props.zoom, false).catch((reason: Error) => { error.value = reason.message; }); }
onMounted(() => {
  canvas = new ProductCanvas(root.value!, () => {}, () => {});
  request<EditorDocument>('/editor/documents', { method: 'POST', body: JSON.stringify({ resultId: props.resultId }) }).then(document => { if (closed) return; content = document; emit('size', { width: document.width, height: document.height }); paint(); }).catch((reason: Error) => { error.value = reason.message; });
});
watch(() => props.zoom, paint);
onUnmounted(() => { closed = true; canvas?.destroy(); });
</script>
<template><div class="board-preview"><div ref="root" /><p v-if="error" role="alert">{{ error }}</p></div></template>
<style scoped lang="scss">.board-preview { pointer-events: none; p { font-size: 11px; color: var(--error); } }</style>
