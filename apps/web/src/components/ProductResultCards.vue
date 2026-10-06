<script setup lang="ts">
import type { ProductImageResult } from '@photo-studio/shared';
defineProps<{ results: ProductImageResult[]; actions?: boolean; busy?: boolean }>();
defineEmits<{ save: [result: ProductImageResult]; retry: [result: ProductImageResult] }>();
</script>

<template>
  <div class="product-results">
    <article v-for="result in results" :key="result.id">
      <a class="preview" :href="`/api/product-image/results/${result.id}/file`" target="_blank" rel="noopener" :aria-label="`预览 ${result.name}`"><img :src="`/api/product-image/results/${result.id}/file`" :alt="result.name" /></a>
      <div class="result-info"><h3>{{ result.name }}</h3><p>{{ result.width }} × {{ result.height }} · PNG</p><RouterLink v-if="result.projectId" :to="`/projects/${result.projectId}`" class="saved">已保存到项目 ↗</RouterLink></div>
      <footer>
        <RouterLink class="button secondary" :to="`/editor/${result.id}`">编辑</RouterLink>
        <button v-if="actions" class="button secondary" type="button" :disabled="busy" @click="$emit('save', result)">{{ result.projectId ? '更换项目' : '保存到项目' }}</button>
        <a class="button secondary" :href="`/api/product-image/results/${result.id}/file?download=1`" download>下载</a>
        <button v-if="actions" type="button" class="retry" :disabled="busy" @click="$emit('retry', result)">重新生成</button>
      </footer>
    </article>
  </div>
</template>

<style scoped lang="scss">
.product-results {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 20px;
  article { overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); }
  .preview { display: block; background: #f1f0ed; height: 270px; padding: 14px; }
  img { width: 100%; height: 100%; object-fit: contain; }
  .result-info { padding: 16px 16px 0; }
  h3 { font-size: 14px; font-weight: 550; overflow-wrap: anywhere; }
  p, .saved { font-size: 12px; color: var(--muted); }
  .saved { color: var(--success); display: block; margin-top: 5px; }
  footer { display: flex; flex-wrap: wrap; gap: 8px; padding: 14px 16px 16px; }
  .button { padding: 7px 11px; font-size: 12px; }
  .retry { padding: 7px 0; border: 0; background: transparent; font-size: 12px; color: var(--muted); }
}
</style>
