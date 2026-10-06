<script setup lang="ts">
import { Database, FolderOpen, Image, RefreshCw, Terminal } from '@lucide/vue';
import { computed, onMounted, ref } from 'vue';
import type { CodexStatus } from '@photo-studio/shared';
import { request } from '../api';
import { useLocalStore } from '../stores/local';

const local = useLocalStore();
const codex = ref<CodexStatus | null>(null);
const checking = ref(false);
const codexError = ref('');
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
}

onMounted(inspect);
</script>

<template>
  <div class="page settings-page">
    <div class="page-title"><h1>本地设置</h1><p>检查工作空间的连接状态与数据位置。</p></div>
    <section class="settings-panel" aria-label="本地环境">
      <div class="settings-row"><Database :size="22" :stroke-width="1.5" /><div><h2>本地存储</h2><p>项目数据库使用 SQLite，运行数据保存在本机。</p></div><span :class="{ ready: local.health }">{{ local.loading ? '检查中' : local.health ? '已连接' : '未连接' }}</span></div>
      <div class="settings-row"><FolderOpen :size="22" :stroke-width="1.5" /><div><h2>数据目录</h2><p class="directory">{{ local.health?.dataDirectory ?? '连接本地服务后显示' }}</p></div></div>
      <div class="settings-row"><Terminal :size="22" :stroke-width="1.5" /><div><h2>Codex CLI<span v-if="codex?.version"> · {{ codex.version }}</span></h2><p :role="codexError || (codex && codex.status !== 'ready') ? 'alert' : undefined">{{ checking ? '正在检查安装与 ChatGPT 登录状态…' : codexError || codex?.message }}</p></div><span :class="{ ready: codex?.status === 'ready' && !checking }" role="status">{{ codexLabel }}</span></div>
      <div class="settings-row"><Image :size="22" :stroke-width="1.5" /><div><h2>Codex 图片生成</h2><p>商品图、套图和详情模块通过 Codex 内置生图生成，需联网并使用账户额度。实际生图权限以任务结果为准，无需安装本地模型。</p></div><span :class="{ ready: codex?.status === 'ready' && !checking }">{{ checking ? '检查中' : codex?.status === 'ready' ? '登录就绪' : '检查 Codex' }}</span></div>
      <footer><p>会话、素材和生成结果保存在本机，可在项目中继续查看。</p><button type="button" class="button secondary" :disabled="local.loading || checking" @click="refresh()"><RefreshCw :size="14" /> {{ local.loading || checking ? '检查中…' : '刷新状态' }}</button></footer>
    </section>
  </div>
</template>

<style scoped lang="scss">
.settings-panel { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 28px; footer { display: flex; justify-content: space-between; gap: 20px; align-items: center; padding: 22px 0; p { color: var(--muted); font-size: 12px; } } }
.settings-row { display: flex; align-items: center; gap: 18px; padding: 26px 0; border-bottom: 1px solid var(--border); > svg { color: var(--muted); } > div { flex: 1; min-width: 0; } h2 { font-size: 15px; font-weight: 500; } p { color: var(--muted); font-size: 12px; margin-top: 5px; } > span { color: var(--muted); font-size: 12px; white-space: nowrap; &.ready { color: var(--success); } } }
.directory { overflow-wrap: anywhere; font-family: 'Consolas', monospace; }
@media (max-width: 760px) { .settings-panel { padding-inline: 18px; footer { flex-wrap: wrap; } } }
</style>
