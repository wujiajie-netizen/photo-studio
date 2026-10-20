<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { FolderOpen, Plus, RefreshCw, Trash2 } from '@lucide/vue';
import ProjectCards from '../components/ProjectCards.vue';
import ProjectDialog from '../components/ProjectDialog.vue';
import DeleteDialog from '../components/DeleteDialog.vue';
import { useProjectsStore } from '../stores/projects';
import { useAgentStore } from '../stores/agent';
import { PRODUCT_UPLOAD_LIMIT, type ProductAsset, type Project } from '@photo-studio/shared';
import { request } from '../api';

const router = useRouter();
const projects = useProjectsStore();
const createOpen = ref(false);
const editingProject = ref<Project | null>(null);
const deleting = ref<{ kind: 'project' | 'asset'; id: string; name: string } | null>(null);
const removing = ref(false); const deleteError = ref('');
const assets = ref<ProductAsset[]>([]); const assetsLoading = ref(false); const uploading = ref(false); const assetError = ref('');
const search = ref('');
const filteredProjects = computed(() => projects.projects.filter(item => item.name.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase())));
const filteredAssets = computed(() => assets.value.filter(item => item.name.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase())));
const agent = useAgentStore();
let assetVersion = 0;
function confirmDelete() {
  if (!deleting.value || removing.value) return;
  const target = deleting.value; removing.value = true; deleteError.value = '';
  /* 删除成功后同步列表；失败保留弹窗，便于用户处理任务或引用后重试。 */
  const action = target.kind === 'project' ? projects.remove(target.id) : request<{ id: string }>(`/assets/${target.id}`, { method: 'DELETE' }).then(() => {
    ++assetVersion; assetsLoading.value = false; assets.value = assets.value.filter(asset => asset.id !== target.id);
  });
  action.then(() => { deleting.value = null; if (target.kind === 'project') agent.list().catch(() => {}); }).catch((reason: Error) => { deleteError.value = reason.message; }).finally(() => { removing.value = false; });
}
function loadAssets() {
  const current = ++assetVersion;
  assetsLoading.value = true; assetError.value = '';
  return request<ProductAsset[]>('/assets').then(value => { if (current === assetVersion) assets.value = value; }).catch((failure: Error) => { if (current === assetVersion) assetError.value = failure.message; }).finally(() => { if (current === assetVersion) assetsLoading.value = false; });
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
    <label class="library-search">按名称搜索项目与素材<input v-model="search" type="search" placeholder="输入项目或素材名称" /><span v-if="search.trim()">找到 {{ filteredProjects.length }} 个项目、{{ filteredAssets.length }} 张素材</span></label>
    <div class="section-heading"><div><h2>全部项目</h2><p>{{ projects.loading ? '正在读取本地项目…' : projects.error ? '本地项目暂时无法读取' : `共 ${projects.projects.length} 个项目 · 按最近保存排序` }}</p></div><button type="button" class="button secondary" :disabled="projects.loading" @click="projects.load()"><RefreshCw :size="14" /> 刷新</button></div>
    <div v-if="projects.loading" class="empty-state" role="status"><p>正在读取本地项目…</p></div>
    <div v-else-if="projects.error" class="empty-state" role="alert"><h3>项目读取失败</h3><p>{{ projects.error }}</p><button type="button" class="button secondary" @click="projects.load()">重新读取</button></div>
    <ProjectCards v-else-if="filteredProjects.length" :projects="filteredProjects" manageable @rename="editingProject = $event; createOpen = true" @delete="deleteError = ''; deleting = { kind: 'project', id: $event.id, name: $event.name }" />
    <div v-else-if="search.trim() && projects.projects.length" class="empty-state"><h3>没有匹配的项目</h3><p>尝试其他名称，或清空搜索查看全部项目。</p><button type="button" class="button secondary" @click="search = ''">清空搜索</button></div>
    <div v-else class="empty-state"><FolderOpen :size="38" :stroke-width="1" /><h3>还没有项目</h3><p>为你的商品创建第一个项目，之后可以从这里继续。</p><button type="button" class="button secondary" @click="createOpen = true"><Plus :size="15" /> 创建第一个项目</button></div>
    <section class="asset-library" aria-label="商品素材">
      <div class="section-heading"><div><h2>商品素材</h2><p>上传商品原图与创作参考，生成时可直接选择。</p></div><button type="button" class="button secondary" :disabled="assetsLoading || uploading" @click="loadAssets"><RefreshCw :size="14" /> 刷新素材</button></div>
      <label class="upload">{{ uploading ? '正在上传…' : '上传素材 · JPG / PNG / WebP，最多 20 MB' }}<input type="file" aria-label="上传素材" accept="image/jpeg,image/png,image/webp" :disabled="uploading || assetsLoading" @change="upload" /></label>
      <p v-if="assetError" role="alert">{{ assetError }}</p><p v-if="assetsLoading" role="status">正在读取素材…</p>
      <div v-else-if="filteredAssets.length" class="asset-grid"><article v-for="asset in filteredAssets" :key="asset.id"><a :href="`/api/assets/${asset.id}/file`" target="_blank" rel="noopener"><img :src="`/api/assets/${asset.id}/file`" :alt="asset.name" loading="lazy" /></a><button type="button" class="asset-delete" :aria-label="`删除素材：${asset.name}`" @click="deleteError = ''; deleting = { kind: 'asset', id: asset.id, name: asset.name }"><Trash2 :size="16" /></button><h3>{{ asset.name }}</h3><p>{{ asset.width }} × {{ asset.height }} · {{ (asset.size / 1024).toFixed(0) }} KB</p><a :href="`/api/assets/${asset.id}/file`" :download="asset.name">下载素材</a></article></div>
      <p v-else-if="search.trim() && assets.length">没有匹配的素材，尝试其他名称或清空搜索。</p>
      <p v-else-if="!assetError">还没有素材，上传商品原图后即可开始创作。</p>
    </section>
    <ProjectDialog v-if="createOpen" :project="editingProject" @close="createOpen = false; editingProject = null" @saved="createOpen = false; editingProject = null; router.push(`/projects/${$event.id}`)" />
    <DeleteDialog v-if="deleting" :name="deleting.name" :description="deleting.kind === 'project' ? '将永久删除整个项目、项目内全部图片、编辑记录及关联的整段对话，无法恢复。' : '将永久删除这张商品素材，无法恢复。正在被任务或编辑图层使用的素材需先解除使用。'" :busy="removing" :error="deleteError" @close="deleting = null" @confirm="confirmDelete" />
  </div>
</template>

<style scoped lang="scss">
.projects-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
.library-search { display: grid; gap: 8px; margin-bottom: 24px; font-size: 12px; color: var(--muted); input { width: min(520px, 100%); padding: 12px 14px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); font: inherit; } }
.asset-library { margin-top: 36px; > p { font-size: 12px; color: var(--muted); margin: 16px 0; } .upload { display: grid; gap: 10px; padding: 22px; border: 1px dashed #d3c5ef; background: linear-gradient(120deg, #fcfaff, #fff); border-radius: var(--radius-sm); font-size: 12px; color: var(--text-secondary); } }
.asset-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 18px; margin-top: 20px; article { position: relative; padding: 14px; border: 1px solid var(--border); border-radius: 16px; background: var(--surface); transition: transform .2s, box-shadow .2s; &:hover { transform: translateY(-3px); box-shadow: var(--shadow); } } img { width: 100%; height: 170px; object-fit: contain; background: #f7f5fa; border-radius: 10px; } h3 { font-size: 13px; overflow-wrap: anywhere; margin-top: 12px; } p { font-size: 11px; color: var(--muted); margin: 7px 0; } a { font-size: 12px; color: var(--accent); } }
.asset-delete { position: absolute; top: 20px; right: 20px; display: grid; place-items: center; width: 32px; height: 32px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--error); opacity: 0; }
.asset-grid article:hover .asset-delete, .asset-grid article:focus-within .asset-delete { opacity: 1; }
@media (hover: none) { .asset-delete { opacity: 1; } }
@media (max-width: 760px) { .projects-heading { flex-wrap: wrap; margin-bottom: 28px; .page-title { margin-bottom: 0; } } }
</style>
