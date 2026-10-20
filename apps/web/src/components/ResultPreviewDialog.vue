<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ChevronLeft, ChevronRight, X } from '@lucide/vue';
import type { ProductImageResult } from '@photo-studio/shared';

const props = defineProps<{ results: ProductImageResult[]; initialId: string }>();
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLDialogElement | null>(null);
const index = ref(props.results.findIndex(result => result.id === props.initialId));
const result = computed(() => props.results[index.value]);
onMounted(() => { dialog.value?.showModal(); });
</script>

<template>
  <dialog ref="dialog" class="result-preview-dialog" aria-labelledby="result-preview-title" @close="emit('close')" @click="$event.target === dialog && dialog?.close()" @keydown.left.prevent="index > 0 && index--" @keydown.right.prevent="index < results.length - 1 && index++">
    <template v-if="result">
      <header><h2 id="result-preview-title">{{ result.name }}</h2><span>{{ index + 1 }} / {{ results.length }}</span><button type="button" autofocus aria-label="关闭预览" @click="dialog?.close()"><X :size="20" /></button></header>
      <div class="preview-stage"><button type="button" :disabled="index === 0" aria-label="上一张" @click="index--"><ChevronLeft :size="24" /></button><img :key="result.id" :src="`/api/editor/results/${result.id}/file`" :alt="result.name" /><button type="button" :disabled="index === results.length - 1" aria-label="下一张" @click="index++"><ChevronRight :size="24" /></button></div>
      <footer><span>方向键切换 · Esc 关闭</span><a class="button secondary" :href="`/api/editor/results/${result.id}/file`" :download="result.name">下载</a></footer>
    </template>
  </dialog>
</template>

<style scoped lang="scss">
.result-preview-dialog {
  width: min(1100px, calc(100vw - 48px)); max-height: calc(100dvh - 48px); padding: 20px; border: 1px solid var(--border); border-radius: var(--radius); color: var(--text); background: var(--surface);
  &::backdrop { background: rgb(0 0 0 / 55%); }
  header, footer { display: flex; align-items: center; gap: 16px; }
  h2 { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: 15px; }
  span { color: var(--muted); font-size: 12px; }
  button { display: grid; place-items: center; padding: 8px; border: 0; border-radius: 8px; background: var(--page); color: var(--text); }
  button:disabled { opacity: .3; }
  footer { justify-content: space-between; margin-top: 16px; }
}
.preview-stage {
  display: grid; grid-template-columns: 40px minmax(0, 1fr) 40px; align-items: center; gap: 12px; margin-top: 16px;
  img { width: 100%; height: min(70dvh, 760px); object-fit: contain; }
}
</style>
