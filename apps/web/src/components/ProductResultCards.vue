<script setup lang="ts">
import type { ProductImageResult } from '@photo-studio/shared';
import { Trash2 } from '@lucide/vue';
defineProps<{ results: ProductImageResult[]; actions?: boolean; busy?: boolean; deletable?: boolean; creation?: boolean }>();
defineEmits<{ save: [result: ProductImageResult]; retry: [result: ProductImageResult]; delete: [result: ProductImageResult]; edit: [result: ProductImageResult]; preview: [result: ProductImageResult] }>();
</script>

<template>
  <div class="product-results">
    <article v-for="result in results" :key="result.id">
      <a class="preview" :href="`/api/editor/results/${result.id}/file`" target="_blank" rel="noopener" :aria-label="`预览 ${result.name}`" @click="if (creation) { $event.preventDefault(); $emit('preview', result); }"><img :src="`/api/editor/results/${result.id}/file`" :alt="result.name" loading="lazy" /></a>
      <button v-if="deletable" type="button" class="result-delete" :disabled="busy" :aria-label="`删除图片：${result.name}`" @click="$emit('delete', result)"><Trash2 :size="16" /></button>
      <div class="result-info"><h3>{{ result.name }}</h3><p>{{ result.width }} × {{ result.height }} · PNG</p><RouterLink v-if="result.projectId" :to="`/projects/${result.projectId}`" class="saved">已保存到项目 ↗</RouterLink></div>
      <footer>
        <button v-if="creation" type="button" class="button secondary" :disabled="busy" @click="$emit('edit', result)">编辑</button>
        <RouterLink v-else class="button secondary" :to="`/editor/${result.id}`">编辑</RouterLink>
        <button v-if="actions" class="button secondary" type="button" :disabled="busy" @click="$emit('save', result)">{{ result.projectId ? '更换项目' : '保存到项目' }}</button>
        <a class="button secondary" :href="`/api/editor/results/${result.id}/file`" :download="result.name">下载</a>
        <button v-if="actions" type="button" class="retry" :disabled="busy" @click="$emit('retry', result)">重新生成</button>
      </footer>
    </article>
  </div>
</template>

<style scoped lang="scss">
.product-results {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 20px;
  article { position: relative; overflow: hidden; border: 1px solid var(--border); border-radius: 18px; background: var(--surface); transition: box-shadow .25s, transform .25s; &:hover { box-shadow: var(--shadow-hover); transform: translateY(-3px); } }
  .preview { display: block; background: linear-gradient(135deg, #f2eff8, #f5f6fa); height: 270px; padding: 14px; overflow: hidden; &:hover img { transform: scale(1.025); } }
  img { width: 100%; height: 100%; object-fit: contain; transition: transform .4s; }
  .result-info { padding: 16px 16px 0; }
  h3 { font-size: 14px; font-weight: 550; overflow-wrap: anywhere; }
  p, .saved { font-size: 12px; color: var(--muted); }
  .saved { color: var(--success); display: block; margin-top: 5px; }
  footer { display: flex; flex-wrap: wrap; gap: 8px; padding: 14px 16px 16px; }
  .button { padding: 7px 11px; font-size: 12px; }
  .retry { padding: 7px 0; border: 0; background: transparent; font-size: 12px; color: var(--muted); }
}
.result-delete { position: absolute; top: 14px; right: 14px; display: grid; place-items: center; width: 32px; height: 32px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--error); opacity: 0; }
article:hover .result-delete, article:focus-within .result-delete { opacity: 1; }
@media (hover: none) { .result-delete { opacity: 1; } }
</style>
