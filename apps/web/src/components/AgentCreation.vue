<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { ChevronDown, ImagePlus, LoaderCircle, Play, Square, X } from '@lucide/vue';
import { PRODUCT_UPLOAD_LIMIT, type AgentExecution, type AgentParameters, type AgentStepInput, type CreationPreset, type ProductAsset, type Project } from '@photo-studio/shared';
import { request } from '../api';
import BrandPresetPicker from './BrandPresetPicker.vue';
import CreationPresetPanel from './CreationPresetPanel.vue';

const props = defineProps<{ taskId: string; execution?: AgentExecution; active: boolean; loading: boolean; initialSource: string | null }>();
const emit = defineEmits<{ started: [execution: AgentExecution]; ready: [] }>();
const steps = ref<AgentStepInput[]>([]); const assetId = ref<string | null>(props.initialSource); const projectId = ref<string | null>(null);
const assets = ref<ProductAsset[]>([]); const projects = ref<Project[]>([]); const optionsOpen = ref(false);
const preparing = ref(false); const submitting = ref(false); const uploading = ref(false); const error = ref('');
const busy = computed(() => submitting.value || !!props.execution && ['queued', 'running'].includes(props.execution.status));
const total = computed(() => steps.value.reduce((count, step) => count + (step.tool === 'product-image' ? step.parameters.count : step.parameters.sections.length), 0));
const labels = { queued: '等待生成', running: '正在生成与检查', succeeded: '作品已保存', failed: '本次生成未完成', cancelled: '已停止生成' };
const scenes = { white: '白色影棚', warm: '暖色自然光', cool: '冷色柔光' };
function applyPreset(index: number, preset: CreationPreset, restoreCopy: boolean) {
  const step = steps.value[index];
  if (step.tool !== preset.kind) return;
  if (step.tool === 'product-image' && preset.kind === 'product-image') {
    step.parameters = { ...preset.parameters, sourceAssetId: assetId.value, description: restoreCopy ? preset.parameters.description : step.parameters.description };
  } else if (step.tool !== 'product-image' && preset.kind !== 'product-image') {
    const current = step.parameters; const remaining = [...current.sections];
    /* 默认只复用模块结构与视觉设置，当前商品事实保留，新增模块不带入旧商品文案。 */
    const sections = restoreCopy ? preset.parameters.sections : preset.parameters.sections.map(section => {
      const index = remaining.findIndex(item => item.type === section.type);
      return index === -1 ? { type: section.type, title: { hero: '商品展示', features: '核心卖点', usage: '使用场景', specification: '商品规格', comparison: '商品对比' }[section.type], content: '' } : remaining.splice(index, 1)[0];
    });
    step.parameters = { ...preset.parameters, sourceAssetId: assetId.value, productName: restoreCopy ? preset.parameters.productName : current.productName, sellingPoints: restoreCopy ? preset.parameters.sellingPoints : current.sellingPoints, sections };
  }
}
let version = 0; let controller: AbortController | null = null;
function prepare() {
  controller?.abort(); const current = ++version; controller = new AbortController();
  preparing.value = true; error.value = ''; steps.value = [];
  return request<AgentParameters>(`/agent/tasks/${props.taskId}/parameters`, { method: 'POST', body: JSON.stringify({ sourceAssetId: assetId.value }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(130000)]) })
    .then(result => { if (current === version) { steps.value = result.steps; emit('ready'); } })
    .catch((reason: Error) => { if (current === version) error.value = reason.message; })
    .finally(() => { if (current === version) preparing.value = false; });
}
function restore() {
  const current = ++version; controller = new AbortController(); preparing.value = true;
  /* 先读取本轮草案，恢复素材与参数；只有尚未整理过的方案才发起模型补全。 */
  fetch(`/api/agent/tasks/${props.taskId}/parameters`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) }).then(response => {
    if (response.status === 404) return null;
    if (!response.ok) return response.json().then((body: { message: string }) => { throw new Error(body.message); });
    return response.json() as Promise<AgentParameters>;
  }).then(result => {
    if (current !== version) return;
    if (result) { steps.value = result.steps; assetId.value = result.steps[0].parameters.sourceAssetId; emit('ready'); }
    else return prepare();
  }).catch((reason: Error) => { if (current === version) error.value = reason.message; }).finally(() => { if (current === version) preparing.value = false; });
}
function start() {
  if (busy.value || preparing.value || uploading.value || !steps.value.length) return;
  const current = version; submitting.value = true; error.value = '';
  request<AgentExecution>('/agent/executions', { method: 'POST', body: JSON.stringify({ planTaskId: props.taskId, projectId: projectId.value, steps: steps.value }) })
    .then(execution => { if (current === version) emit('started', execution); })
    .catch((reason: Error) => { if (current === version) error.value = reason.message; }).finally(() => { if (current === version) submitting.value = false; });
}
function action(kind: 'cancel' | 'retry') {
  if (!props.execution || submitting.value) return;
  const current = version; submitting.value = true; error.value = '';
  request<AgentExecution>(`/agent/executions/${props.execution.id}/${kind}`, { method: 'POST' })
    .then(execution => { if (current === version) emit('started', execution); })
    .catch((reason: Error) => { if (current === version) error.value = reason.message; }).finally(() => { if (current === version) submitting.value = false; });
}
function options() {
  optionsOpen.value = !optionsOpen.value; if (!optionsOpen.value) return;
  const current = version;
  Promise.all([request<ProductAsset[]>('/assets'), request<Project[]>('/projects')]).then(([sources, saved]) => { if (current === version) { assets.value = sources; projects.value = saved; } }).catch((reason: Error) => { if (current === version) error.value = reason.message; });
}
function upload(event: Event) {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; if (!file) return;
  if (file.size > PRODUCT_UPLOAD_LIMIT) { error.value = '商品原图不超过 20 MB。'; input.value = ''; return; }
  const current = version; const form = new FormData(); form.append('file', file); form.append('name', file.name); uploading.value = true; error.value = '';
  request<ProductAsset>('/assets', { method: 'POST', body: form }).then(asset => { if (current === version) { assets.value.unshift(asset); assetId.value = asset.id; return prepare(); } }).catch((reason: Error) => { if (current === version) error.value = reason.message; }).finally(() => { uploading.value = false; input.value = ''; });
}
/* 最新方案自动补齐参数，生成仍由用户点击；已执行方案直接恢复记录，不重复规划或生图。 */
watch(() => [props.loading, props.active, props.execution] as const, () => {
  if (props.loading) return;
  if (props.execution) { steps.value = props.execution.steps; assetId.value = props.execution.steps[0]?.parameters.sourceAssetId ?? null; projectId.value = props.execution.projectId; }
  else if (props.active && !steps.value.length && !preparing.value && !error.value) restore();
}, { immediate: true });
onUnmounted(() => { ++version; controller?.abort(); });
watch(() => props.initialSource, value => { if (!props.execution && value !== assetId.value) { assetId.value = value; if (props.active && !props.loading) prepare(); } });
</script>

<template>
  <div class="agent-creation">
    <template v-if="execution">
      <div class="execution-status" role="status"><LoaderCircle v-if="busy" :size="14" class="spinning" /><span>{{ labels[execution.status] }}</span><strong>{{ execution.progress }}%</strong></div>
      <progress :value="execution.progress" max="100" :aria-label="labels[execution.status]" />
      <p v-for="step in execution.steps" :key="step.id" class="observation">{{ step.title }} · {{ step.observation || '等待执行' }}</p>
      <p v-if="execution.error" class="error" role="alert">{{ execution.error }}</p>
      <footer><RouterLink :to="`/projects/${execution.projectId}`">查看项目</RouterLink><button v-if="busy" type="button" class="button secondary" :disabled="submitting" @click="action('cancel')"><Square :size="12" /> 停止</button><button v-else-if="['failed', 'cancelled'].includes(execution.status)" type="button" class="button" :disabled="submitting" @click="action('retry')">重试未完成步骤</button></footer>
    </template>
    <template v-else>
      <p v-if="preparing || loading" class="preparation" role="status"><LoaderCircle :size="14" class="spinning" /> 正在补齐生成参数…</p>
      <div v-if="steps.length" class="generation-specs"><span v-for="(step, index) in steps" :key="index">{{ step.parameters.ratio }} · {{ scenes[step.parameters.scene] }} · {{ step.parameters.quality === 'high' ? '高清' : '标准' }}</span><span>{{ total }} 张 · {{ assetId ? '使用商品原图' : '文字生成示意' }}</span></div>
      <button type="button" class="options-toggle" :disabled="busy || preparing || uploading || loading" :aria-expanded="optionsOpen" @click="options"><ImagePlus :size="14" /> 素材与参数（可选）<ChevronDown :size="13" /></button>
      <div v-if="optionsOpen" class="generation-options">
        <label>商品素材<select v-model="assetId" :disabled="preparing || uploading" @change="prepare"><option :value="null">不上传，按文字创作</option><option v-for="asset in assets" :key="asset.id" :value="asset.id">{{ asset.name }}</option></select></label>
        <label class="upload-label">{{ uploading ? '正在上传…' : '上传商品原图' }}<input type="file" aria-label="添加商品原图" accept="image/jpeg,image/png,image/webp" :disabled="uploading || preparing" @change="upload" /></label>
        <div v-if="assetId" class="source-preview"><img :src="`/api/assets/${assetId}/file`" alt="本次创作使用的商品原图" /><button type="button" :disabled="preparing || uploading" aria-label="移除商品原图" @click="assetId = null; prepare()"><X :size="13" /></button></div>
        <label>保存位置<select v-model="projectId"><option :value="null">自动保存到本次会话项目</option><option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option></select></label>
        <div v-for="(step, index) in steps" :key="index" class="step-options"><span v-if="steps.length > 1">{{ step.title }}</span><label>画幅<select v-model="step.parameters.ratio"><option>1:1</option><option>3:4</option><option>4:3</option><option>9:16</option></select></label><label>质量<select v-model="step.parameters.quality"><option value="standard">标准</option><option value="high">高清</option></select></label><label v-if="step.tool === 'product-image'">数量<select v-model="step.parameters.count"><option v-for="count in 4" :key="count" :value="count">{{ count }} 张</option></select></label></div>
        <div v-for="(step, index) in steps" :key="`reuse-${index}`">
          <CreationPresetPanel :kind="step.tool" :parameters="step.parameters" :disabled="busy || preparing || uploading || loading" @apply="(preset, restoreCopy) => applyPreset(index, preset, restoreCopy)" />
          <label v-if="step.tool === 'product-image'">创作描述<textarea v-model="step.parameters.description" maxlength="1000" rows="3" :disabled="busy || preparing || uploading || loading" /></label>
          <template v-else>
            <BrandPresetPicker :model-value="step.parameters.brand ?? null" :disabled="busy || preparing || uploading || loading" @update:model-value="step.parameters.brand = $event" />
            <label>商品名称<input v-model="step.parameters.productName" maxlength="80" :disabled="busy || preparing || uploading || loading" /></label>
            <label>商品卖点<textarea :value="step.parameters.sellingPoints.join('\n')" rows="3" :disabled="busy || preparing || uploading || loading" @input="step.parameters.sellingPoints = ($event.target as HTMLTextAreaElement).value.split('\n').map(line => line.trim()).filter(Boolean)" /></label>
            <div v-for="(section, sectionIndex) in step.parameters.sections" :key="sectionIndex"><label>模块 {{ sectionIndex + 1 }} 标题<input v-model="section.title" maxlength="80" :disabled="busy || preparing || uploading || loading" /></label><label>模块 {{ sectionIndex + 1 }} 文案<textarea v-model="section.content" maxlength="600" rows="3" :disabled="busy || preparing || uploading || loading" /></label></div>
          </template>
        </div>
      </div>
      <p v-if="steps.length" class="observation">预计 {{ total }} 次生图、{{ steps.length }} 次结果检查；自动重试会增加调用，具体额度以账户实际使用为准。</p>
      <footer><span>Codex 生图 · 使用账户额度</span><button v-if="steps.length || preparing || loading" type="button" class="button" :disabled="busy || preparing || uploading || loading" @click="start"><Play :size="13" />{{ submitting ? '提交中…' : '开始生成' }}</button><button v-else type="button" class="button secondary" @click="prepare">{{ error ? '重试参数整理' : '使用这个方案' }}</button></footer>
    </template>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped lang="scss">
.agent-creation { margin-top: 12px; border-top: 1px solid var(--border); padding-top: 12px; font-size: 12px; line-height: 1.7; footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 12px; } footer > span, footer > a { color: var(--muted); font-size: 12px; } .button { padding: 8px 12px; font-size: 12px; font-weight: 500; } progress { width: 100%; height: 5px; accent-color: var(--accent); margin-top: 8px; border: 0; border-radius: 20px; overflow: hidden; } progress::-webkit-progress-bar { background: #eeedf5; border-radius: 20px; } progress::-webkit-progress-value { background: var(--accent); border-radius: 20px; } progress::-moz-progress-bar { background: var(--accent); border-radius: 20px; } }
.generation-specs { display: flex; flex-wrap: wrap; gap: 6px; span { padding: 4px 7px; border-radius: 5px; background: var(--page); color: var(--text-secondary); } }
.options-toggle { display: flex; gap: 6px; align-items: center; border: 0; background: transparent; color: var(--text-secondary); font-size: 12px; padding: 10px 0 0; &:hover { color: var(--accent); } }
.generation-options { display: grid; gap: 10px; margin-top: 12px; label { display: grid; gap: 5px; color: var(--text-secondary); } select, input, textarea { width: 100%; min-width: 0; padding: 7px; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font: inherit; } .upload-label { display: block; position: relative; padding: 8px; border: 1px dashed var(--border-strong); border-radius: 6px; cursor: pointer; text-align: center; } input[type='file'] { position: absolute; inset: 0; opacity: 0; width: 100%; cursor: pointer; } }
.step-options { display: flex; flex-wrap: wrap; gap: 8px; > span { flex-basis: 100%; } label { flex: 1; } }
.source-preview { position: relative; width: 72px; img { width: 72px; height: 72px; object-fit: contain; border: 1px solid var(--border); border-radius: 6px; } button { position: absolute; right: -5px; top: -5px; border: 1px solid var(--border); border-radius: 50%; background: var(--surface); display: grid; place-items: center; padding: 3px; } }
.preparation, .execution-status { display: flex; align-items: center; gap: 8px; color: var(--text-secondary); strong { margin-left: auto; font-weight: 500; } }
.observation { margin-top: 8px; color: var(--text-secondary); line-height: 1.75; overflow-wrap: anywhere; }
.error { margin-top: 10px; color: var(--error); line-height: 1.7; }
.spinning { animation: spin 1.2s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
