<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { FolderOpen, Plus, RefreshCw } from '@lucide/vue';
import ProjectCards from '../components/ProjectCards.vue';
import ProjectDialog from '../components/ProjectDialog.vue';
import { useProjectsStore } from '../stores/projects';
import { PRODUCT_UPLOAD_LIMIT, type ProductAsset } from '@photo-studio/shared';
import { request } from '../api';

const router = useRouter();
const projects = useProjectsStore();
const createOpen = ref(false);
const assets = ref<ProductAsset[]>([]); const assetsLoading = ref(false); const uploading = ref(false); const assetError = ref('');
function loadAssets() {
  assetsLoading.value = true; assetError.value = '';
  return request<ProductAsset[]>('/assets').then(value => { assets.value = value; }).catch((failure: Error) => { assetError.value = failure.message; }).finally(() => { assetsLoading.value = false; });
}
function upload(event: Event) {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; if (!file) return;
  if (file.size > PRODUCT_UPLOAD_LIMIT) { assetError.value = '素材不超过 20 MB。'; input.value = ''; return; }
  const body = new FormData(); body.append('file', file); body.append('name', file.name); uploading.value = true; assetError.value = '';
  request<ProductAsset>('/assets', { method: 'POST', body }).then(asset => { assets.value.unshift(asset); }).catch((failure: Error) => { assetError.value = failure.message; }).finally(() => { uploading.value = false; input.value = ''; });
}
onMounted(() => { projects.load(); loadAssets(); });
</script>

<template>
  <div class="page projects-page">
    <div class="projects-heading"><div class="page-title"><h1>项目与资产</h1><p>属于你的商品素材与创作记录，保存在本地。</p></div><button type="button" class="button" :disabled="projects.loading" @click="createOpen = true"><Plus :size="16" /> 新建项目</button></div>
    <div class="section-heading"><div><h2>全部项目</h2><p>{{ projects.loading ? '正在读取本地项目…' : projects.error ? '本地项目暂时无法读取' : `共 ${projects.projects.length} 个项目 · 按最近保存排序` }}</p></div><button type="button" class="button secondary" :disabled="projects.loading" @click="projects.load()"><RefreshCw :size="14" /> 刷新</button></div>
    <div v-if="projects.loading" class="empty-state" role="status"><p>正在读取本地项目…</p></div>
    <div v-else-if="projects.error" class="empty-state" role="alert"><h3>项目读取失败</h3><p>{{ projects.error }}</p><button type="button" class="button secondary" @click="projects.load()">重新读取</button></div>
    <ProjectCards v-else-if="projects.projects.length" :projects="projects.projects" />
    <div v-else class="empty-state"><FolderOpen :size="38" :stroke-width="1" /><h3>还没有项目</h3><p>为你的商品创建第一个项目，之后可以从这里继续。</p><button type="button" class="button secondary" @click="createOpen = true"><Plus :size="15" /> 创建第一个项目</button></div>
    <section class="asset-library" aria-label="商品素材">
      <div class="section-heading"><div><h2>商品素材</h2><p>上传商品原图与创作参考，生成时可直接选择。</p></div><button type="button" class="button secondary" :disabled="assetsLoading || uploading" @click="loadAssets"><RefreshCw :size="14" /> 刷新素材</button></div>
      <label class="upload">{{ uploading ? '正在上传…' : '上传素材 · JPG / PNG / WebP，最多 20 MB' }}<input type="file" aria-label="上传素材" accept="image/jpeg,image/png,image/webp" :disabled="uploading || assetsLoading" @change="upload" /></label>
      <p v-if="assetError" role="alert">{{ assetError }}</p><p v-if="assetsLoading" role="status">正在读取素材…</p>
      <div v-else-if="assets.length" class="asset-grid"><article v-for="asset in assets" :key="asset.id"><a :href="`/api/assets/${asset.id}/file`" target="_blank" rel="noopener"><img :src="`/api/assets/${asset.id}/file`" :alt="asset.name" loading="lazy" /></a><h3>{{ asset.name }}</h3><p>{{ asset.width }} × {{ asset.height }} · {{ (asset.size / 1024).toFixed(0) }} KB</p><a :href="`/api/assets/${asset.id}/file`" :download="asset.name">下载素材</a></article></div>
      <p v-else-if="!assetError">还没有素材，上传商品原图后即可开始创作。</p>
    </section>
    <ProjectDialog v-if="createOpen" :project="null" @close="createOpen = false" @saved="createOpen = false; router.push(`/projects/${$event.id}`)" />
  </div>
</template>

<style scoped lang="scss">
.projects-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
.asset-library { margin-top: 36px; > p { font-size: 12px; color: var(--muted); margin: 16px 0; } .upload { display: grid; gap: 10px; padding: 16px; border: 1px dashed var(--border); border-radius: var(--radius-sm); font-size: 12px; color: var(--muted); } }
.asset-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 18px; margin-top: 20px; article { padding: 14px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); } img { width: 100%; height: 170px; object-fit: contain; } h3 { font-size: 13px; overflow-wrap: anywhere; margin-top: 12px; } p { font-size: 11px; color: var(--muted); margin: 7px 0; } a { font-size: 12px; } }
@media (max-width: 760px) { .projects-heading { flex-wrap: wrap; margin-bottom: 28px; .page-title { margin-bottom: 0; } } }
</style>
