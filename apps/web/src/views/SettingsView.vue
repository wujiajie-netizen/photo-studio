<script setup lang="ts">
import { Database, FolderOpen, Image, RefreshCw, Terminal } from '@lucide/vue';
import { computed, onMounted, ref } from 'vue';
import type { CodexStatus, LocalImageToolsStatus, LocalTaskSummary } from '@photo-studio/shared';
import { request } from '../api';
import { useLocalStore } from '../stores/local';
import BrandPresetManager from '../components/BrandPresetManager.vue';

const local = useLocalStore();
const codex = ref<CodexStatus | null>(null);
const checking = ref(false);
const codexError = ref('');
const imageTools = ref<LocalImageToolsStatus | null>(null); const imageToolsError = ref('');
const taskSummary = ref<LocalTaskSummary | null>(null); const tasksError = ref(''); const statusLoading = ref(false);
const taskLabels = { agent: 'Agent 规划', execution: '工作流执行', 'product-image': '商品图', commerce: '套图与详情', 'image-tool': '图片工具' };
const codexLabel = computed(() => {
  if (checking.value) return '检查中';
  if (!codex.value) return '检测失败';
  return { ready: '已登录', missing: '未安装', not_logged_in: '未登录', unsupported: '需要调整', error: '检测失败' }[codex.value.status];
});

function inspect() {
  if (checking.value) return;
  checking.value = true;
  codexError.value = '';
  return request<CodexStatus>('/codex/status')
    .then((result) => { codex.value = result; })
    .catch((error: Error) => { codex.value = null; codexError.value = error.message; })
    .finally(() => { checking.value = false; });
}

function refresh() {
  local.refresh();
  inspect();
  inspectLocal();
}
function inspectLocal() {
  if (statusLoading.value) return;
  statusLoading.value = true; imageToolsError.value = ''; tasksError.value = '';
  /* 环境与任务分开读取，一项失败不隐藏另一项的真实状态。 */
  Promise.all([
    request<LocalImageToolsStatus>('/image-tools/status').then(value => { imageTools.value = value; }).catch((failure: Error) => { imageTools.value = null; imageToolsError.value = failure.message; }),
    request<LocalTaskSummary>('/tasks/status').then(value => { taskSummary.value = value; }).catch((failure: Error) => { taskSummary.value = null; tasksError.value = failure.message; })
  ]).finally(() => { statusLoading.value = false; });
}
onMounted(() => { inspect(); inspectLocal(); });
</script>

<template>
  <div class="page settings-page">
    <div class="page-title"><h1>本地设置</h1><p>检查工作空间的连接状态与数据位置。</p></div>
    <section class="settings-panel" aria-label="本地环境">
      <div class="settings-row"><Database :size="22" :stroke-width="1.5" /><div><h2>本地存储</h2><p>项目数据库使用 SQLite，运行数据保存在本机。</p></div><span :class="{ ready: local.health }">{{ local.loading ? '检查中' : local.health ? '已连接' : '未连接' }}</span></div>
      <div class="settings-row"><FolderOpen :size="22" :stroke-width="1.5" /><div><h2>数据目录</h2><p class="directory">{{ local.health?.dataDirectory ?? '连接本地服务后显示' }}</p></div></div>
      <div class="settings-row"><Terminal :size="22" :stroke-width="1.5" /><div><h2>Codex CLI<span v-if="codex?.version"> · {{ codex.version }}</span></h2><p :role="codexError || (codex && codex.status !== 'ready') ? 'alert' : undefined">{{ checking ? '正在检查安装与 ChatGPT 登录状态…' : codexError || codex?.message }}</p></div><span :class="{ ready: codex?.status === 'ready' && !checking }" role="status">{{ codexLabel }}</span></div>
      <div class="settings-row"><Image :size="22" :stroke-width="1.5" /><div><h2>Codex 图片生成</h2><p>商品图、套图和详情模块通过 Codex 内置生图生成，需联网并使用账户额度。实际生图权限以任务结果为准，无需安装本地模型。</p></div><span :class="{ ready: codex?.status === 'ready' && !checking }">{{ checking ? '检查中' : codex?.status === 'ready' ? '登录就绪' : '检查 Codex' }}</span></div>
      <div class="settings-row"><Image :size="22" :stroke-width="1.5" /><div><h2>本地识字、抠图与拆层</h2><p :role="imageToolsError || imageTools?.status !== 'ready' ? 'alert' : undefined">{{ statusLoading ? '正在检查运行环境和模型文件…' : imageToolsError || imageTools?.message }}</p></div><span :class="{ ready: imageTools?.status === 'ready' && !statusLoading }">{{ statusLoading ? '检查中' : imageTools?.status === 'ready' ? '环境就绪' : imageTools?.status === 'missing' ? '需要安装' : '检测失败' }}</span></div>
      <section class="task-summary" aria-label="本地任务状态"><h2>任务状态</h2><p>按任务类型独立统计，规划与执行可能属于同一工作流。</p><p v-if="statusLoading" role="status">正在读取任务状态…</p><p v-else-if="tasksError" class="error" role="alert">{{ tasksError }}</p><table v-else-if="taskSummary"><thead><tr><th>任务类型</th><th>排队</th><th>执行中</th><th>失败</th><th>完成</th><th>取消</th></tr></thead><tbody><tr v-for="group in taskSummary.groups" :key="group.kind"><th>{{ taskLabels[group.kind] }}</th><td>{{ group.counts.queued }}</td><td>{{ group.counts.running }}</td><td>{{ group.counts.failed }}</td><td>{{ group.counts.succeeded }}</td><td>{{ group.counts.cancelled }}</td></tr></tbody></table><div class="task-links"><RouterLink to="/product-image">查看商品图任务</RouterLink><RouterLink to="/product-kit">查看套图任务</RouterLink><RouterLink to="/detail-page">查看详情任务</RouterLink></div></section>
      <footer><p>会话、素材和生成结果保存在本机，可在项目中继续查看。</p><button type="button" class="button secondary" :disabled="local.loading || checking || statusLoading" @click="refresh()"><RefreshCw :size="14" /> {{ local.loading || checking || statusLoading ? '检查中…' : '刷新状态' }}</button></footer>
    </section>
    <BrandPresetManager />
  </div>
</template>

<style scoped lang="scss">
.settings-panel { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 28px; box-shadow: var(--shadow); footer { display: flex; justify-content: space-between; gap: 20px; align-items: center; padding: 22px 0; p { color: var(--muted); font-size: 12px; } } }
.settings-row { display: flex; align-items: center; gap: 18px; padding: 26px 0; border-bottom: 1px solid var(--border); > svg { color: var(--accent); background: var(--accent-soft); padding: 10px; width: 44px; height: 44px; border-radius: 12px; } > div { flex: 1; min-width: 0; } h2 { font-size: 15px; font-weight: 550; } p { color: var(--muted); font-size: 12px; margin-top: 5px; } > span { color: var(--muted); font-size: 11px; white-space: nowrap; padding: 5px 10px; border-radius: 30px; background: var(--page); &.ready { color: var(--success); background: #eef8f3; } } }
.directory { overflow-wrap: anywhere; font-family: 'Consolas', monospace; }
.task-summary { padding: 24px 0; border-bottom: 1px solid var(--border); overflow-x: auto; h2 { font-size: 15px; } p { font-size: 12px; color: var(--muted); margin: 8px 0; } table { width: 100%; border-collapse: collapse; margin-top: 14px; font-size: 12px; } th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--border); white-space: nowrap; } .error { color: var(--error); } }
.task-links { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 14px; font-size: 12px; color: var(--accent); }
@media (max-width: 760px) { .settings-panel { padding-inline: 18px; footer { flex-wrap: wrap; } } }
</style>
