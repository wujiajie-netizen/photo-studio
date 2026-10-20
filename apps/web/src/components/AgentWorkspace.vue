<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowDown, ArrowUp, ArrowLeft, Plus, Sparkles, Square, X, ImagePlus, FolderOpen } from '@lucide/vue';
import { PRODUCT_UPLOAD_LIMIT, type AgentExecution, type ProductAsset, type ProductImageResult } from '@photo-studio/shared';
import { request } from '../api';
import { useAgentStore } from '../stores/agent';
import AgentCanvas from './AgentCanvas.vue';
import AgentCreation from './AgentCreation.vue';
import ConversationHistory from './ConversationHistory.vue';
import AccountMenu from './AccountMenu.vue';

const prompt = defineModel<string>({ required: true });
const agent = useAgentStore(); const route = useRoute(); const router = useRouter();
const id = computed(() => typeof route.query.session === 'string' ? route.query.session : null);
const projectId = computed(() => typeof route.query.project === 'string' ? route.query.project : agent.session?.projectId ?? null);
const resultId = computed(() => typeof route.query.result === 'string' ? route.query.result : null);
const latest = computed(() => agent.tasks.at(-1));
const completedTaskIds = computed(() => agent.tasks.filter(task => task.status === 'succeeded').map(task => task.id));
const transcript = ref<HTMLDivElement | null>(null); const atBottom = ref(true); const historyOpen = ref(false);
const canvas = ref<InstanceType<typeof AgentCanvas> | null>(null);
const canvasState = ref<{ executions: AgentExecution[]; results: ProductImageResult[]; selectedId: string; loading: boolean }>({ executions: [], results: [], selectedId: '', loading: true });
const nextSource = ref<string | null | undefined>(undefined); const sourceName = ref(''); const composer = ref<HTMLTextAreaElement | null>(null);
const assetsOpen = ref(false); const assets = ref<ProductAsset[]>([]); const uploading = ref(false); const assetError = ref('');
const labels = { queued: '正在排队', running: '正在整理创作方案', succeeded: '方案已就绪', failed: '这次请求未完成', cancelled: '已停止' };
const tools = { 'product-image': '商品图', 'product-kit': '商品套图', 'detail-page': '详情页' };
/* 每个任务与用户消息在同一次提交中使用同一时间；方案直接放回本轮回复，避免消息和计划分成两份列表。 */
const turns = computed(() => agent.tasks.map(task => {
  const executions = canvasState.value.executions.filter(execution => execution.planTaskId === task.id);
  return { task, message: agent.messages.find(message => message.role === 'user' && message.createdAt === task.createdAt), result: agent.results[task.id], execution: executions[0], images: canvasState.value.results.filter(result => executions.some(execution => execution.steps.some(step => step.taskId === result.taskId))) };
}));
const initialSource = computed(() => nextSource.value !== undefined ? nextSource.value : canvasState.value.executions[0]?.steps[0]?.parameters.sourceAssetId ?? null);
function reference(asset: ProductAsset, modifying = false) { nextSource.value = asset.id; sourceName.value = asset.name; assetsOpen.value = false; if (modifying && !prompt.value.trim()) prompt.value = '请基于这张图片修改：'; nextTick(() => composer.value?.focus()); }
function showAssets() {
  assetsOpen.value = !assetsOpen.value; if (!assetsOpen.value) return;
  assetError.value = ''; request<ProductAsset[]>('/assets').then(saved => { assets.value = saved; }).catch((reason: Error) => { assetError.value = reason.message; });
}
function upload(event: Event) {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; if (!file) return;
  if (file.size > PRODUCT_UPLOAD_LIMIT) { assetError.value = '图片不超过 20 MB。'; input.value = ''; return; }
  const session = id.value; const form = new FormData(); form.append('file', file); form.append('name', file.name); uploading.value = true; assetError.value = '';
  request<ProductAsset>('/assets', { method: 'POST', body: form }).then(asset => { if (session === id.value) reference(asset); }).catch((reason: Error) => { if (session === id.value) assetError.value = reason.message; }).finally(() => { uploading.value = false; input.value = ''; });
}
function selectSession(value: string) { historyOpen.value = false; atBottom.value = true; nextSource.value = undefined; sourceName.value = ''; return router.replace({ path: '/', query: value ? { session: value } : {} }); }
function scrollBottom() { nextTick(() => { if (transcript.value) transcript.value.scrollTop = transcript.value.scrollHeight; atBottom.value = true; }); }
function scrolled() { const element = transcript.value; if (element) atBottom.value = element.scrollHeight - element.scrollTop - element.clientHeight < 70; }
function arrive(resultId: string) {
  nextTick(() => {
    const image = transcript.value?.querySelector<HTMLImageElement>(`[data-result-id="${resultId}"] img`);
    if (!image || !transcript.value) return;
    const source = image.getBoundingClientRect(); const visible = transcript.value.getBoundingClientRect();
    if (source.top >= visible.top && source.bottom <= visible.bottom) canvas.value?.animateResult(resultId, source);
  });
}
function showResult(resultId: string) { canvas.value?.select(resultId)?.then(() => arrive(resultId)); }
function submit() {
  if (agent.busy || agent.loading || uploading.value || !prompt.value.trim()) return;
  atBottom.value = true;
  agent.submit(prompt.value, id.value).then(task => {
    prompt.value = '';
    if (id.value === task.sessionId) return agent.load(task.sessionId).then(() => {});
    return router.replace({ path: '/', query: { session: task.sessionId } }).then(() => {});
  }).then(() => agent.list()).catch(() => {});
}
function enter(event: KeyboardEvent) { if (event.isComposing || event.shiftKey) return; event.preventDefault(); submit(); }
function retry() { const message = agent.messages.filter(item => item.role === 'user').at(-1); if (message) { prompt.value = message.content; submit(); } }
watch(id, (value, previous) => { atBottom.value = true; historyOpen.value = false; assetsOpen.value = false; if (previous) { nextSource.value = undefined; sourceName.value = ''; } canvasState.value = { executions: [], results: [], selectedId: '', loading: true }; agent.load(value); }, { immediate: true });
watch(() => [agent.loading, turns.value.length, latest.value?.status, latest.value && agent.results[latest.value.id], canvasState.value.results.length], () => { if (atBottom.value) scrollBottom(); }, { deep: true });
onUnmounted(agent.disconnect);
</script>

<template>
  <section class="agent-workspace" :class="{ active: !!id }" aria-label="创作助手" @keydown.esc="historyOpen = false; assetsOpen = false">
    <ConversationHistory v-if="id" v-model="historyOpen" standalone />
    <div class="conversation-main">
      <header v-if="id" class="conversation-heading"><RouterLink :to="projectId ? `/projects/${projectId}` : '/'" :aria-label="projectId ? '返回项目' : '返回工作台'" :title="projectId ? '返回项目' : '返回工作台'"><ArrowLeft :size="16" /></RouterLink><div class="conversation-title"><Sparkles :size="18" /><h1 :title="agent.session?.title">{{ agent.session?.title ?? '创作对话' }}</h1></div><button type="button" class="history-toggle" :aria-expanded="historyOpen" aria-controls="conversation-history" @click="historyOpen = !historyOpen">最近对话</button><button type="button" :disabled="agent.submitting" @click="selectSession('')"><Plus :size="15" /> 新建</button><AccountMenu /></header>
      <div v-if="agent.loading" class="agent-notice" role="status">正在恢复对话…</div>
      <div v-if="agent.error" class="agent-notice error" role="alert">{{ agent.error }} <button v-if="id" type="button" @click="agent.load(id)">重新读取</button></div>
      <p v-if="agent.connection" class="agent-notice" role="status">{{ agent.connection }}</p>
      <div v-if="id" ref="transcript" class="conversation" aria-label="会话记录" aria-live="polite" @scroll="scrolled">
        <section v-for="turn in turns" :key="turn.task.id" class="conversation-turn">
          <article class="user"><p>{{ turn.message?.content }}</p></article>
          <article class="assistant">
            <div class="assistant-label"><Sparkles :size="15" /><strong>Photo Studio</strong></div>
            <template v-if="turn.result">
              <p>{{ turn.result.summary }}</p>
              <div v-if="turn.result.questions.length" class="clarification"><p v-for="question in turn.result.questions" :key="question">{{ question }}</p><span>直接在下方回复，也可以说“你决定”。</span></div>
              <div v-else class="creation-plan">
                <header><h2>创作方案</h2><span>{{ turn.result.plan.filter(step => step.tool).length }} 个制作步骤</span></header>
                <ol><li v-for="(step, index) in turn.result.plan" :key="index"><span class="step-number">{{ index + 1 }}</span><div><strong>{{ step.title }}</strong><p>{{ step.description }}</p></div><span v-if="step.tool" class="tool-label">{{ tools[step.tool] }}</span></li></ol>
                <AgentCreation v-if="turn.result.plan.some(step => step.tool)" :task-id="turn.task.id" :execution="turn.execution" :active="latest?.id === turn.task.id" :loading="canvasState.loading" :initial-source="initialSource" :initial-project="projectId" @started="canvas?.addExecution($event)" @ready="atBottom && scrollBottom()" />
              </div>
              <div v-if="turn.images.length" class="conversation-results"><button v-for="image in turn.images" :key="image.id" :data-result-id="image.id" type="button" :class="{ selected: canvasState.selectedId === image.id }" :aria-pressed="canvasState.selectedId === image.id" :aria-label="`在画板查看 ${image.name}`" @click="showResult(image.id)"><img :src="`/api/editor/results/${image.id}/file`" :alt="image.name" /></button><span>点击作品定位到画布</span></div>
            </template>
            <div v-else class="task-status" role="status"><span v-if="['queued', 'running'].includes(turn.task.status)" class="working-dot" />{{ labels[turn.task.status] }}<button v-if="['queued', 'running'].includes(turn.task.status)" type="button" @click="agent.cancel(turn.task.id)">停止</button></div>
            <p v-if="turn.task.error" class="error" role="alert">{{ turn.task.error }}</p>
            <button v-if="latest?.id === turn.task.id && ['failed', 'cancelled'].includes(turn.task.status)" type="button" class="button secondary" :disabled="agent.busy || agent.loading" @click="retry">重新尝试</button>
          </article>
        </section>
      </div>
      <button v-if="id && !atBottom" type="button" class="jump-bottom" @click="scrollBottom"><ArrowDown :size="14" /> 查看最新回复</button>
      <form class="agent-composer" @submit.prevent="submit">
        <div v-if="assetsOpen" class="composer-assets" aria-label="选择已有素材"><header><strong>素材库</strong><button type="button" aria-label="关闭素材库" @click="assetsOpen = false"><X :size="14" /></button></header><div><button v-for="asset in assets" :key="asset.id" type="button" :aria-label="`引用素材 ${asset.name}`" @click="reference(asset)"><img :src="`/api/assets/${asset.id}/file`" :alt="asset.name" /><span>{{ asset.name }}</span></button><p v-if="!assets.length">还没有素材，可点击下方加号上传。</p></div></div>
        <div v-if="initialSource" class="composer-source"><img :src="`/api/assets/${initialSource}/file`" :alt="sourceName || '上一轮素材'" /><span>{{ sourceName ? '下轮基于这张图创作' : '沿用上一轮素材，可移除后文字创作' }}</span><button type="button" aria-label="移除下轮素材" @click="nextSource = null; sourceName = ''"><X :size="13" /></button></div>
        <label class="sr-only" for="agent-prompt">描述你的电商视觉任务</label>
        <textarea id="agent-prompt" ref="composer" v-model="prompt" maxlength="2000" rows="3" :disabled="agent.submitting" :placeholder="initialSource ? '说说要改什么、保留什么，再确认生成方案…' : id ? '继续说说你的想法，例如：改成暖色，其他你决定…' : '描述想制作的商品图，例如：做一张高级感咖啡宣传图，其他你决定…'" @keydown.enter="enter" />
        <p v-if="assetError" class="asset-error" role="alert">{{ assetError }}</p>
        <footer><span><label class="composer-upload" :title="uploading ? '上传中…' : '上传图片' "><input type="file" aria-label="上传创作素材" accept="image/jpeg,image/png,image/webp" :disabled="uploading || agent.submitting" @change="upload" /><ImagePlus :size="17" /></label><button type="button" aria-label="选择已有素材" title="素材库" :aria-expanded="assetsOpen" @click="showAssets"><FolderOpen :size="17" /></button><Sparkles :size="14" /> {{ uploading ? '上传中…' : 'Agent' }}<small>Enter 发送 · Shift + Enter 换行</small></span><button v-if="agent.busy && latest" type="button" class="button" aria-label="停止当前请求" @click="agent.cancel(latest.id)"><Square :size="13" /> 停止</button><button v-else type="submit" class="button" :disabled="agent.loading || uploading || !prompt.trim()" aria-label="发送需求"><ArrowUp :size="18" /></button></footer>
      </form>
    </div>
    <AgentCanvas v-if="id && agent.session?.id === id" :key="`${id}:${projectId}`" ref="canvas" :session-id="id" :project-id="projectId" :result-id="resultId" :task-ids="completedTaskIds" @update="canvasState = $event" @reference="reference" @reveal="arrive" />
  </section>
</template>

<style scoped lang="scss">
.agent-workspace { display: flex; gap: 24px; margin-top: 24px; text-align: left; min-width: 0; }
.agent-workspace.active { --conversation-width: 390px; height: 100dvh; min-height: 430px; margin-top: 0; gap: 0; position: relative; overflow: hidden; background: #f5f6fa; }
.active > .conversation-main { position: absolute; z-index: 3; inset: 10px auto 10px 10px; width: var(--conversation-width); padding: 16px 10px 10px; border: 1px solid rgb(255 255 255 / 90%); border-radius: 24px; background: var(--surface); box-shadow: 0 1px 3px rgb(35 40 60 / 3%), 0 8px 32px rgb(35 40 60 / 5%); }
.active > .agent-canvas { position: absolute; inset: 0; }
.composer-source { display: flex; align-items: center; gap: 8px; padding: 10px 12px 0; img { width: 38px; height: 38px; object-fit: contain; border-radius: 5px; border: 1px solid var(--border); } span { flex: 1; font-size: 12px; color: var(--muted); } button { display: grid; place-items: center; border: 0; background: transparent; padding: 4px; } }
.composer-upload { display: grid; place-items: center; position: relative; padding: 4px; cursor: pointer; input { position: absolute; inset: 0; width: 100%; opacity: 0; cursor: pointer; } }
.composer-assets { position: absolute; bottom: calc(100% + 8px); left: 0; right: 0; padding: 12px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); box-shadow: var(--shadow); z-index: 3; header { display: flex; align-items: center; justify-content: space-between; font-size: 12px; } button { border: 0; background: transparent; color: var(--text-secondary); padding: 4px; } > div { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 8px; max-height: 220px; overflow-y: auto; } img { width: 100%; height: 62px; object-fit: contain; background: var(--page); border-radius: 5px; } span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; } p { grid-column: 1 / -1; font-size: 12px; color: var(--muted); } }
.asset-error { padding: 6px 12px; color: var(--error); font-size: 11px; }
.conversation-results { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 14px; button { padding: 3px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); } button.selected { border-color: #b9abe6; box-shadow: 0 0 0 2px var(--accent-soft); } img { width: 82px; height: 82px; object-fit: cover; display: block; border-radius: 5px; } span { width: 100%; font-size: 12px; color: var(--muted); } }
.active .conversation-heading .history-toggle { display: inline-flex; }
.active .conversation-heading { gap: 8px; padding-bottom: 14px; }
.active .conversation-heading h1 { font-size: 14px; line-height: 20px; font-weight: 600; }
.active .conversation { padding: 20px 4px 16px 0; }
.active .creation-plan { padding: 12px; }
.active .creation-plan footer { flex-wrap: wrap; }
.active .tool-label, .active .agent-composer small { display: none; }
.active .agent-composer textarea { padding: 12px; font-size: 14px; }
.active .agent-composer footer { padding-left: 12px; }
.conversation-main { flex: 1; min-width: 0; display: flex; flex-direction: column; position: relative; }
.conversation-heading { display: flex; gap: 12px; align-items: center; padding-bottom: 20px; border-bottom: 1px solid var(--border); .conversation-title { display: flex; gap: 10px; align-items: center; flex: 1; min-width: 0; } h1 { font-size: 15px; font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } button { display: inline-flex; gap: 5px; align-items: center; border: 0; background: transparent; color: var(--text-secondary); font-size: 12px; padding: 4px; border-radius: 6px; &:hover { background: var(--nav-hover); color: var(--accent); } } .history-toggle { display: none; } }
.agent-notice { padding: 10px 14px; font-size: 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); margin: 12px 0; button { background: none; border: 0; text-decoration: underline; margin-left: 6px; } }
.conversation { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; padding: 28px 12px 20px 0; }
.conversation-turn { display: grid; gap: 22px; margin-bottom: 30px; }
.user { max-width: 85%; justify-self: end; border-radius: 16px 16px 4px 16px; background: var(--accent-soft); padding: 12px 18px; p { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; line-height: 1.75; } }
.assistant { min-width: 0; > p { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; line-height: 1.8; margin-top: 10px; } > .button { margin-top: 12px; font-size: 12px; } }
.assistant-label { display: flex; gap: 8px; align-items: center; > svg { color: var(--accent); } strong { font-size: 13px; font-weight: 500; letter-spacing: .01em; } }
.clarification { margin-top: 14px; border-left: 2px solid var(--border-strong); padding-left: 14px; p { font-size: 14px; line-height: 1.8; } span { display: block; margin-top: 6px; font-size: 12px; color: var(--muted); } }
.creation-plan { margin-top: 16px; border: 1px solid var(--border); border-radius: 12px; padding: 18px; background: #fdfdff; header { display: flex; align-items: center; justify-content: space-between; gap: 12px; } h2 { font-size: 14px; font-weight: 600; line-height: 1.6; } header span, footer span { font-size: 12px; color: var(--muted); } ol { list-style: none; padding: 0; margin: 16px 0; display: grid; gap: 16px; } li { display: flex; align-items: flex-start; gap: 10px; } li > div { flex: 1; min-width: 0; } strong { font-size: 13px; font-weight: 500; } li p { font-size: 13px; color: var(--text-secondary); margin-top: 4px; line-height: 1.75; overflow-wrap: anywhere; } footer { display: flex; gap: 12px; justify-content: space-between; align-items: center; border-top: 1px solid var(--border); padding-top: 14px; } .button { padding: 8px 12px; font-size: 12px; } }
.step-number { flex-shrink: 0; width: 20px; height: 20px; border-radius: 50%; background: var(--accent-soft); color: var(--accent); font-size: 11px; font-weight: 500; display: grid; place-items: center; }
.tool-label { font-size: 10px; color: var(--muted); white-space: nowrap; padding: 2px 5px; border: 1px solid var(--border); border-radius: 4px; }
.task-status { display: flex; align-items: center; gap: 9px; margin-top: 12px; color: var(--muted); font-size: 12px; button { border: 0; background: transparent; margin-left: 8px; font-size: 12px; text-decoration: underline; } }
.working-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 4px var(--accent-soft); animation: pulse 1.2s infinite alternate; }
@keyframes pulse { to { opacity: .3; } }
.jump-bottom { position: absolute; bottom: 185px; left: 50%; transform: translateX(-50%); display: inline-flex; gap: 6px; align-items: center; padding: 8px 12px; border: 1px solid var(--border); border-radius: 20px; background: var(--surface); box-shadow: var(--shadow); font-size: 11px; }
.agent-composer { position: relative; flex-shrink: 0; background: #fcfcfe; border: 1px solid #e3e6ee; border-radius: 18px; box-shadow: 0 2px 8px rgb(35 40 60 / 3%); transition: border-color .2s, box-shadow .2s; &:focus-within { border-color: #b9a8e9; background: var(--surface); box-shadow: 0 0 0 3px rgb(118 89 214 / 6%); } textarea { width: 100%; min-height: 100px; max-height: 200px; border: 0; resize: vertical; background: transparent; padding: 20px 22px 8px; outline: none; color: var(--text); line-height: 1.75; font-size: 13px; box-shadow: none; } textarea:focus-visible { outline: none; } textarea::placeholder { color: #858a98; } footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 4px 14px 14px 20px; } footer > span { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; color: var(--muted); font-size: 12px; line-height: 17.6px; } footer button:not(.button) { display: grid; place-items: center; padding: 5px; border: 0; border-radius: 6px; background: transparent; color: inherit; &:hover { background: var(--accent-soft); color: var(--accent); } } small { font-size: 10px; margin-left: 8px; } .button { border-radius: 11px; min-height: 36px; min-width: 36px; padding: 7px 10px; font-size: 11px; } }
.conversation-heading, .assistant-label, .agent-composer { :deep(svg) { stroke-width: 1.7; } }
.error { color: var(--error); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
@media (max-width: 1100px) { .agent-workspace { gap: 18px; } .agent-workspace.active { --conversation-width: 320px; } .tool-label { display: none; } }
@media (max-width: 760px) { .conversation-heading .history-toggle { display: inline-flex; } .agent-composer small { display: none; } .creation-plan footer { flex-wrap: wrap; } }
</style>
