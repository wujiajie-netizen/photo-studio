<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ArrowLeft, FolderOpen, Pencil } from '@lucide/vue';
import type { Project, ProductImageResult } from '@photo-studio/shared';
import { request } from '../api';
import ProjectDialog from '../components/ProjectDialog.vue';
import ProductResultCards from '../components/ProductResultCards.vue';

const route = useRoute();
const project = ref<Project | null>(null);
const results = ref<ProductImageResult[]>([]);
const loading = ref(false);
const error = ref('');
const renameOpen = ref(false);
const dateFormatter = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
let loadVersion = 0;

function load() {
  const version = ++loadVersion;
  loading.value = true;
  error.value = '';
  /* 快速切换项目时丢弃旧响应，避免标题与当前地址中的项目不一致。 */
  return Promise.all([request<Project>(`/projects/${route.params.projectId}`), request<ProductImageResult[]>(`/projects/${route.params.projectId}/results`)])
    .then(([saved, savedResults]) => { if (version === loadVersion) { project.value = saved; results.value = savedResults; } })
    .catch((reason: unknown) => {
      if (version === loadVersion) error.value = reason instanceof Error ? reason.message : '项目读取失败，请重试。';
    })
    .finally(() => { if (version === loadVersion) loading.value = false; });
}

watch(() => route.params.projectId, () => { renameOpen.value = false; load(); }, { immediate: true });
</script>

<template>
  <div class="page project-detail-page">
    <RouterLink to="/projects" class="back-link"><ArrowLeft :size="15" /> 返回全部项目</RouterLink>
    <div v-if="loading" class="empty-state" role="status"><p>正在读取项目…</p></div>
    <div v-else-if="error" class="empty-state" role="alert"><h3>无法打开项目</h3><p>{{ error }}</p><button type="button" class="button secondary" @click="load">重新读取</button></div>
    <template v-else-if="project">
      <div class="project-heading"><div class="page-title"><h1>{{ project.name }}</h1><p>你的本地创作项目</p></div><button type="button" class="button secondary" @click="renameOpen = true"><Pencil :size="14" /> 重命名</button></div>
      <dl class="project-info"><div><dt>创建时间</dt><dd><time :datetime="project.createdAt">{{ dateFormatter.format(new Date(project.createdAt)) }}</time></dd></div><div><dt>最近保存</dt><dd><time :datetime="project.updatedAt">{{ dateFormatter.format(new Date(project.updatedAt)) }}</time></dd></div></dl>
      <ProductResultCards v-if="results.length" :results="results" />
      <div v-else class="empty-state"><FolderOpen :size="36" :stroke-width="1" /><h3>新的创作空间已准备好</h3><p>项目已保存在本机。生成商品图后，可将结果保存到这里。</p><RouterLink to="/product-image" class="button secondary">开始制作商品图</RouterLink></div>
      <ProjectDialog v-if="renameOpen" :project="project" @close="renameOpen = false" @saved="project = $event; renameOpen = false" />
    </template>
  </div>
</template>

<style scoped lang="scss">
.back-link { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; color: var(--muted); margin-bottom: 28px; &:hover { color: var(--text); } }
.project-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; h1 { overflow-wrap: anywhere; } }
.project-info { display: flex; gap: 48px; margin: 0 0 28px; padding: 20px 24px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); dt { color: var(--muted); font-size: 11px; } dd { margin: 6px 0 0; font-size: 13px; } }
@media (max-width: 760px) { .project-heading { flex-wrap: wrap; margin-bottom: 24px; .page-title { margin-bottom: 0; } } .project-info { gap: 24px; flex-wrap: wrap; } }
</style>
