<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { request } from '../api';
import { useAuthStore } from '../stores/auth';

interface PublicationCopy {
  executionId: string; status: 'queued' | 'running' | 'succeeded' | 'failed';
  title: string; alternatives: string[]; body: string; tags: string[]; engagement: string; cta: string; error: string | null;
}

const props = defineProps<{ executionId: string }>();
const auth = useAuthStore();
const copy = ref<PublicationCopy | null>(null); const expanded = ref(false); const notice = ref(''); const retrying = ref(false);
const fullText = computed(() => copy.value ? [copy.value.title, copy.value.body, copy.value.tags.join(' '), copy.value.engagement, copy.value.cta, copy.value.alternatives.length ? `备选标题：${copy.value.alternatives.join(' / ')}` : ''].filter(Boolean).join('\n\n') : '');
let stream: EventSource | null = null; let version = 0;
function load() {
  const current = ++version; stream?.close(); stream = null; copy.value = null; expanded.value = false; notice.value = '';
  /* 文案与作品各自保存，切换执行记录时丢弃迟到的请求和事件。 */
  return auth.ensure().then(() => fetch(`/api/agent/executions/${props.executionId}/copy`, { credentials: 'same-origin', signal: AbortSignal.timeout(10000) })).then(response => {
    if (response.status === 404) return null;
    if (response.status === 401) auth.expire();
    if (!response.ok) return response.json().then((body: { message: string }) => { throw new Error(body.message); });
    return response.json() as Promise<PublicationCopy>;
  }).then(saved => {
    if (current !== version || !saved) return;
    copy.value = saved;
    stream = new EventSource(`/api/agent/executions/${props.executionId}/copy/events`);
    stream.addEventListener('copy', (event: MessageEvent<string>) => { if (current === version) copy.value = JSON.parse(event.data) as PublicationCopy; });
    stream.onerror = () => { if (current === version) notice.value = '文案实时连接中断，正在重连…'; };
    stream.onopen = () => { if (current === version && notice.value === '文案实时连接中断，正在重连…') notice.value = ''; };
  }).catch((reason: Error) => { if (current === version) notice.value = reason.message; });
}
function retry() {
  const current = version; retrying.value = true; notice.value = '';
  request<PublicationCopy>(`/agent/executions/${props.executionId}/copy/retry`, { method: 'POST' })
    .then(saved => { if (current === version) copy.value = saved; })
    .catch((reason: Error) => { if (current === version) notice.value = reason.message; })
    .finally(() => { if (current === version) retrying.value = false; });
}
function copyText() {
  if (!navigator.clipboard) { notice.value = '当前环境无法复制，请手动选择文案。'; expanded.value = true; return; }
  navigator.clipboard.writeText(fullText.value).then(() => { notice.value = '已复制全文'; }).catch(() => { notice.value = '复制失败，请手动选择文案。'; expanded.value = true; });
}
watch(() => props.executionId, load, { immediate: true });
onUnmounted(() => { ++version; stream?.close(); });
</script>

<template>
  <section v-if="copy || notice" class="publication-copy" aria-label="配套发布文案">
    <header><strong>配套发布文案</strong><span v-if="copy && ['queued', 'running'].includes(copy.status)">正在撰写…</span><span v-else-if="copy?.status === 'failed'">生成未完成</span></header>
    <template v-if="copy?.status === 'succeeded'">
      <p>{{ copy.title }}</p>
      <div class="copy-actions"><button type="button" :aria-expanded="expanded" @click="expanded = !expanded">{{ expanded ? '收起详情' : '查看详情' }}</button><button type="button" @click="copyText">复制全文</button></div>
      <div v-if="expanded" class="copy-detail"><p>{{ copy.body }}</p><p v-if="copy.tags.length">{{ copy.tags.join(' ') }}</p><p v-if="copy.engagement">{{ copy.engagement }}</p><p v-if="copy.cta">{{ copy.cta }}</p><p v-if="copy.alternatives.length">备选标题：{{ copy.alternatives.join(' / ') }}</p></div>
    </template>
    <template v-else-if="copy?.status === 'failed'"><p>{{ copy.error }}</p><button type="button" :disabled="retrying" @click="retry">{{ retrying ? '重试中…' : '重试文案' }}</button></template>
    <p v-if="notice" role="status">{{ notice }}</p>
  </section>
</template>

<style scoped lang="scss">
.publication-copy { padding: 12px; border: 1px solid var(--border); border-radius: 10px; font-size: 12px; line-height: 1.7; header { display: flex; justify-content: space-between; gap: 8px; } header span { color: var(--muted); } p { margin: 8px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; } button { border: 0; background: transparent; color: var(--accent); padding: 4px 0; cursor: pointer; } }
.copy-actions { display: flex; gap: 16px; margin-top: 4px; }
.copy-detail { margin-top: 8px; border-top: 1px solid var(--border); }
</style>
