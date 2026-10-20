<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowLeft, FolderOpen, Pencil, Sparkles } from '@lucide/vue';
import type { Project, ProductImageResult, ProjectCreationContext } from '@photo-studio/shared';
import { request } from '../api';
import ProjectDialog from '../components/ProjectDialog.vue';
import ProductResultCards from '../components/ProductResultCards.vue';
import DeleteDialog from '../components/DeleteDialog.vue';
import ResultPreviewDialog from '../components/ResultPreviewDialog.vue';
import { useProjectsStore } from '../stores/projects';
import { useAgentStore } from '../stores/agent';

const route = useRoute();
const router = useRouter(); const projects = useProjectsStore(); const agent = useAgentStore();
const project = ref<Project | null>(null);
const results = ref<ProductImageResult[]>([]);
const loading = ref(false);
const error = ref('');
const renameOpen = ref(false);
const opening = ref(false); const creationError = ref(''); const previewId = ref('');
const deleting = ref<ProductImageResult | null>(null); const removing = ref(false); const deleteError = ref('');
const dateFormatter = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
let loadVersion = 0;

function openCreation(resultId: string | null = null) {
  if (!project.value || opening.value || removing.value) return;
  const version = loadVersion; opening.value = true; creationError.value = '';
  /* 先由服务端确认项目与来源会话，再携带作品定位进入创作页，避免丢失项目保存位置。 */
  request<ProjectCreationContext>(`/projects/${project.value.id}/creation`, { method: 'POST', body: JSON.stringify({ resultId }) }).then(context => {
    if (version !== loadVersion) return;
    return router.push({ path: '/', query: { session: context.sessionId, project: context.projectId, ...(context.resultId ? { result: context.resultId } : {}) } });
  }).catch((reason: Error) => { if (version === loadVersion) creationError.value = reason.message; }).finally(() => { opening.value = false; });
}

function confirmDelete() {
  if (!project.value || !deleting.value || removing.value) return;
  const target = deleting.value; const id = project.value.id; const version = loadVersion;
  removing.value = true; deleteError.value = '';
  /* 最后一张连同项目删除后返回列表；并发导致范围变化时重新读取数量，留在弹窗再次确认。 */
  request<{ id: string; projectDeleted: boolean }>(`/projects/${id}/results/${target.id}`, { method: 'DELETE', body: JSON.stringify({ deleteProjectWhenEmpty: results.value.length === 1 }) }).then(saved => {
    if (version !== loadVersion) return;
    deleting.value = null;
    results.value = results.value.filter(result => result.id !== target.id);
    projects.load();
    if (saved.projectDeleted) { agent.list().catch(() => {}); return router.replace('/projects'); }
  }).catch((reason: Error) => {
    if (version !== loadVersion) return;
    deleteError.value = reason.message;
    return request<ProductImageResult[]>(`/projects/${id}/results`).then(saved => { if (version === loadVersion) results.value = saved; }).catch(() => {});
  }).finally(() => { removing.value = false; });
}

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

watch(() => route.params.projectId, () => { renameOpen.value = false; deleting.value = null; previewId.value = ''; creationError.value = ''; load(); }, { immediate: true });
</script>

<template>
  <div class="page project-detail-page">
    <RouterLink to="/projects" class="back-link"><ArrowLeft :size="15" /> 返回全部项目</RouterLink>
    <div v-if="loading" class="empty-state" role="status"><p>正在读取项目…</p></div>
    <div v-else-if="error" class="empty-state" role="alert"><h3>无法打开项目</h3><p>{{ error }}</p><button type="button" class="button secondary" @click="load">重新读取</button></div>
    <template v-else-if="project">
      <div class="project-heading"><div class="page-title"><h1>{{ project.name }}</h1><p>你的本地创作项目</p></div><div class="project-actions"><button type="button" class="button secondary" @click="renameOpen = true"><Pencil :size="14" /> 重命名</button><button type="button" class="button" :disabled="opening || removing" @click="openCreation()"><Sparkles :size="14" />{{ opening ? '正在打开…' : results.length ? '继续创作' : '开始创作' }}</button></div></div>
      <p v-if="creationError" class="creation-error" role="alert">{{ creationError }}</p>
      <dl class="project-info"><div><dt>创建时间</dt><dd><time :datetime="project.createdAt">{{ dateFormatter.format(new Date(project.createdAt)) }}</time></dd></div><div><dt>最近保存</dt><dd><time :datetime="project.updatedAt">{{ dateFormatter.format(new Date(project.updatedAt)) }}</time></dd></div></dl>
      <ProductResultCards v-if="results.length" :results="results" deletable creation :busy="removing || opening" @edit="openCreation($event.id)" @preview="previewId = $event.id" @delete="deleteError = ''; deleting = $event" />
      <div v-else class="empty-state"><FolderOpen :size="36" :stroke-width="1" /><h3>新的创作空间已准备好</h3><p>从一个想法开始，生成的作品会保存到当前项目。</p><button type="button" class="button secondary" :disabled="opening" @click="openCreation()">开始创作</button></div>
      <ResultPreviewDialog v-if="previewId" :results="results" :initial-id="previewId" @close="previewId = ''" />
      <ProjectDialog v-if="renameOpen" :project="project" @close="renameOpen = false" @saved="project = $event; renameOpen = false" />
      <DeleteDialog v-if="deleting" :name="deleting.name" description="将永久删除这张图片及其编辑记录，无法恢复。项目、对话文字和其他图片保留。" :busy="removing" :error="deleteError" @close="deleting = null" @confirm="confirmDelete">
        <template v-if="results.length === 1" #description>这是当前项目的<strong>最后一张图片</strong>。删除后，<strong>当前项目及关联的整段对话</strong>也将一起<strong>永久删除，无法恢复</strong>。</template>
      </DeleteDialog>
    </template>
  </div>
</template>

<style scoped lang="scss">
.back-link { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; color: var(--muted); margin-bottom: 28px; &:hover { color: var(--text); } }
.project-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; h1 { overflow-wrap: anywhere; } }
.project-actions { display: flex; flex-wrap: wrap; gap: 10px; flex-shrink: 0; }
.creation-error { margin-bottom: 16px; color: var(--error); font-size: 13px; }
.project-info { display: flex; gap: 48px; margin: 0 0 28px; padding: 20px 24px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); dt { color: var(--muted); font-size: 11px; } dd { margin: 6px 0 0; font-size: 13px; } }
@media (max-width: 760px) { .project-heading { flex-wrap: wrap; margin-bottom: 24px; .page-title { margin-bottom: 0; } } .project-info { gap: 24px; flex-wrap: wrap; } }
</style>
