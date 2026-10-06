<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { validateAgentStep, PRODUCT_UPLOAD_LIMIT, type AgentExecution, type AgentResult, type AgentStepInput, type ProductAsset, type Project } from '@photo-studio/shared';
import { request } from '../api';
import ProjectDialog from '../components/ProjectDialog.vue';

const route = useRoute(); const router = useRouter();
const plan = ref<AgentResult | null>(null); const steps = ref<AgentStepInput[]>([]);
const assets = ref<ProductAsset[]>([]); const projects = ref<Project[]>([]); const projectId = ref(''); const assetId = ref('');
const executions = ref<AgentExecution[]>([]); const execution = ref<AgentExecution | null>(null);
const loading = ref(false); const submitting = ref(false); const uploading = ref(false); const confirmed = ref(false); const creating = ref(false);
const error = ref(''); const connection = ref(''); let version = 0; let stream: EventSource | null = null;
const busy = computed(() => submitting.value || !!execution.value && ['queued', 'running'].includes(execution.value.status));
const labels = { queued: '等待执行', running: '执行和检查中', succeeded: '完成并保存', failed: '需要处理', cancelled: '已取消' };
const toolLabels = { 'product-image': '商品图', 'product-kit': '商品套图', 'detail-page': '详情页' };
const total = computed(() => steps.value.reduce((count, step) => count + (step.tool === 'product-image' ? step.parameters.count : step.parameters.sections.length), 0));
function disconnect() { ++version; stream?.close(); stream = null; connection.value = ''; }
function selectAsset() { for (const step of steps.value) step.parameters.sourceAssetId = assetId.value; }
function load() {
  disconnect(); const current = version; loading.value = true; error.value = ''; confirmed.value = false; execution.value = null;
  const id = String(route.params.planTaskId);
  return Promise.all([request<AgentResult>(`/agent/tasks/${id}/result`), request<AgentExecution[]>(`/agent/tasks/${id}/executions`), request<ProductAsset[]>('/assets'), request<Project[]>('/projects')])
    .then(([result, saved, sources, savedProjects]) => {
      if (current !== version) return;
      plan.value = result; executions.value = saved; assets.value = sources; projects.value = savedProjects;
      steps.value = result.plan.filter(item => item.tool !== null).map(item => item.tool === 'product-image'
        ? { title: item.title, tool: item.tool, parameters: { sourceAssetId: '', subject: 'keep', scene: 'white', description: item.description, ratio: '1:1', count: 1, quality: 'standard' } }
        : { title: item.title, tool: item.tool as 'product-kit' | 'detail-page', parameters: { sourceAssetId: '', subject: 'keep', scene: 'white', ratio: '1:1', quality: 'standard', productName: '', platform: 'general', region: 'CN', language: 'zh-CN', sellingPoints: [], sections: [{ type: 'hero', title: item.title, content: item.description }] } });
      const selected = typeof route.query.execution === 'string' ? saved.find(item => item.id === route.query.execution) : saved[0];
      if (route.query.execution && !selected) throw new Error('执行记录不属于当前计划。');
      if (!selected) { projectId.value = ''; assetId.value = ''; return; }
      execution.value = selected; projectId.value = selected.projectId;
      steps.value = selected.steps.map(step => JSON.parse(JSON.stringify({ title: step.title, tool: step.tool, parameters: step.parameters })) as AgentStepInput);
      assetId.value = steps.value[0]?.parameters.sourceAssetId ?? '';
      stream = new EventSource(`/api/agent/executions/${selected.id}/events`);
      stream.onopen = () => { if (current === version) connection.value = ''; };
      stream.onerror = () => { if (current === version) connection.value = '实时连接暂时中断，正在重连…'; };
      stream.addEventListener('execution', (event: MessageEvent<string>) => {
        if (current !== version) return;
        execution.value = JSON.parse(event.data) as AgentExecution;
        const index = executions.value.findIndex(item => item.id === selected.id); if (index !== -1) executions.value[index] = execution.value;
        if (!['queued', 'running'].includes(execution.value.status)) { stream?.close(); stream = null; }
      });
    }).catch((reason: Error) => { if (current === version) error.value = reason.message; })
    .finally(() => { if (current === version) loading.value = false; });
}
function submit() {
  if (busy.value || !confirmed.value) return;
  error.value = '';
  try { if (!projectId.value || !steps.value.length || total.value > 32) throw new Error('请选择项目，确认 1 到 32 张图片的执行参数。'); steps.value.forEach(validateAgentStep); }
  catch (reason) { error.value = (reason as Error).message; return; }
  submitting.value = true;
  request<AgentExecution>('/agent/executions', { method: 'POST', body: JSON.stringify({ planTaskId: route.params.planTaskId, projectId: projectId.value, steps: steps.value }) })
    .then(result => router.replace({ path: route.path, query: { execution: result.id } }))
    .catch((reason: Error) => { error.value = reason.message; }).finally(() => { submitting.value = false; });
}
function cancel() {
  if (!execution.value) return;
  return request<AgentExecution>(`/agent/executions/${execution.value.id}/cancel`, { method: 'POST' }).then(result => { execution.value = result; }).catch((reason: Error) => { error.value = reason.message; });
}
function retry() {
  if (!execution.value || busy.value) return;
  submitting.value = true;
  return request<AgentExecution>(`/agent/executions/${execution.value.id}/retry`, { method: 'POST' }).then(result => router.replace({ path: route.path, query: { execution: result.id } })).catch((reason: Error) => { error.value = reason.message; }).finally(() => { submitting.value = false; });
}
function upload(event: Event) {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; if (!file) return;
  if (file.size > PRODUCT_UPLOAD_LIMIT) { error.value = '商品原图不超过 20 MB。'; input.value = ''; return; }
  const form = new FormData(); form.append('file', file); form.append('name', file.name); uploading.value = true; error.value = '';
  request<ProductAsset>('/assets', { method: 'POST', body: form }).then(asset => { assets.value.unshift(asset); assetId.value = asset.id; selectAsset(); }).catch((reason: Error) => { error.value = reason.message; }).finally(() => { uploading.value = false; input.value = ''; });
}
function created(project: Project) { projects.value.unshift(project); projectId.value = project.id; creating.value = false; }
watch(() => [route.params.planTaskId, route.query.execution], load, { immediate: true });
onBeforeUnmount(disconnect);
</script>

<template>
  <div class="page execution-page">
    <RouterLink to="/">← 返回工作台</RouterLink><div class="page-title"><h1>确认计划并执行</h1><p>核对素材、作图参数与保存项目，Agent 将执行工具、检查图片并保存合格结果。</p></div>
    <p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="loading" role="status">正在读取计划…</p>
    <div v-else-if="plan" class="execution-layout">
      <form class="execution-form" @submit.prevent="submit">
        <p class="summary">{{ plan.summary }}</p>
        <fieldset :disabled="busy || uploading">
          <legend>素材与保存位置</legend>
          <label>上传商品原图<input type="file" aria-label="上传商品原图" accept="image/jpeg,image/png,image/webp" @change="upload" /></label>
          <label>商品素材<select v-model="assetId" @change="selectAsset"><option value="" disabled>选择已上传商品原图</option><option v-for="asset in assets" :key="asset.id" :value="asset.id">{{ asset.name }}</option></select></label>
          <img v-if="assetId" class="asset-preview" :src="`/api/assets/${assetId}/file`" alt="执行计划使用的商品原图" />
          <label>保存到项目<select v-model="projectId"><option value="" disabled>选择项目</option><option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option></select></label><button type="button" class="button secondary" @click="creating = true">新建项目</button>
        </fieldset>
        <fieldset v-for="(step, index) in steps" :key="index" :disabled="busy || uploading">
          <legend>{{ index + 1 }} · {{ step.title }} · {{ toolLabels[step.tool] }}</legend>
          <div class="paired"><label>主体处理<select v-model="step.parameters.subject"><option value="keep">保留商品</option><option value="trim">裁去空白边缘</option></select></label><label>背景场景<select v-model="step.parameters.scene"><option value="white">白底</option><option value="warm">暖色</option><option value="cool">冷色</option></select></label></div>
          <div class="paired"><label>画面比例<select v-model="step.parameters.ratio"><option>1:1</option><option>3:4</option><option>4:3</option><option>9:16</option></select></label><label>图片质量<select v-model="step.parameters.quality"><option value="standard">标准 · 长边 1024</option><option value="high">高清 · 长边 2048</option></select></label></div>
          <template v-if="step.tool === 'product-image'"><label>生成数量<select v-model.number="step.parameters.count"><option v-for="count in 4" :key="count" :value="count">{{ count }} 张</option></select></label><label>创作描述<textarea v-model="step.parameters.description" maxlength="1000" rows="3" /></label></template>
          <template v-else>
            <label>商品名称<input v-model="step.parameters.productName" maxlength="80" /></label>
            <div class="paired"><label>平台<select v-model="step.parameters.platform"><option value="general">通用</option><option value="taobao">淘宝</option><option value="jd">京东</option><option value="amazon">Amazon</option><option value="shopify">Shopify</option></select></label><label>地区<select v-model="step.parameters.region"><option value="CN">中国</option><option value="US">美国</option><option value="GB">英国</option><option value="EU">欧洲</option><option value="JP">日本</option></select></label></div>
            <label>语言<select v-model="step.parameters.language"><option value="zh-CN">中文</option><option value="en-US">英语</option><option value="ja-JP">日语</option><option value="de-DE">德语</option></select></label>
            <label>商品卖点<textarea :value="step.parameters.sellingPoints.join('\n')" placeholder="每行一条，最多 8 条" rows="3" @input="step.parameters.sellingPoints = ($event.target as HTMLTextAreaElement).value.split('\n').filter(item => item.trim())" /></label>
            <div v-for="(section, sectionIndex) in step.parameters.sections" :key="sectionIndex" class="module">
              <label>模块类型<select v-model="section.type"><option value="hero">商品展示</option><option value="features">核心卖点</option><option value="usage">使用场景</option><option value="specification">规格信息</option><option value="comparison">商品对比</option></select></label>
              <label>模块标题<input v-model="section.title" maxlength="80" /></label><label>模块内容<textarea v-model="section.content" maxlength="600" rows="3" /></label><button type="button" :disabled="step.parameters.sections.length === 1" @click="step.parameters.sections.splice(sectionIndex, 1)">删除模块</button>
            </div>
            <button type="button" class="button secondary" :disabled="step.parameters.sections.length >= 8" @click="step.parameters.sections.push({ type: 'features', title: '核心卖点', content: '' })">添加模块</button>
          </template>
        </fieldset>
        <p class="help">共 {{ total }} 张图片，每个步骤最多自动重试一次；会消耗 Codex 额度。规格、对比和包装文字以你提供并核对的事实为准，高清表示导出尺寸。</p>
        <label class="confirmation"><input v-model="confirmed" type="checkbox" :disabled="busy" />我已核对以上参数，同意生成、检查并将合格图片保存到所选项目</label>
        <button class="button" type="submit" :disabled="busy || uploading || !confirmed || !steps.length">{{ submitting ? '提交中…' : busy ? '执行中…' : '确认参数并执行' }}</button>
      </form>
      <section class="execution-progress" aria-label="执行进度">
        <h2>执行记录</h2>
        <label v-if="executions.length">历史执行<select :value="execution?.id ?? ''" @change="router.replace({ path: route.path, query: { execution: ($event.target as HTMLSelectElement).value } })"><option v-for="item in executions" :key="item.id" :value="item.id">{{ new Date(item.createdAt).toLocaleString('zh-CN') }} · {{ labels[item.status] }}</option></select></label>
        <p v-if="connection" class="help" role="status">{{ connection }}</p>
        <template v-if="execution">
          <p role="status">{{ labels[execution.status] }} · {{ execution.progress }}%</p><progress :value="execution.progress" max="100" aria-label="执行进度" />
          <p v-if="execution.error" class="error" role="alert">{{ execution.error }}</p>
          <button v-if="busy" type="button" class="button secondary" @click="cancel">取消执行</button><button v-else-if="['failed', 'cancelled'].includes(execution.status)" type="button" class="button secondary" @click="retry">重试未完成步骤</button>
          <article v-for="step in execution.steps" :key="step.id"><h3>{{ step.title }}</h3><p>{{ labels[step.status] }}<span v-if="step.retryCount"> · 自动重试 {{ step.retryCount }} 次</span></p><p class="observation">{{ step.observation }}</p><RouterLink v-if="step.taskId" :to="{ path: `/${step.tool}`, query: { task: step.taskId } }">查看图片与作图记录</RouterLink></article>
          <RouterLink :to="`/projects/${execution.projectId}`">查看保存项目</RouterLink>
        </template>
        <p v-else class="help">确认后开始执行。结果检查未通过时只重试当前步骤，其他已保存图片保留。</p>
      </section>
    </div>
    <ProjectDialog v-if="creating" :project="null" @close="creating = false" @saved="created" />
  </div>
</template>

<style scoped lang="scss">
.execution-page > a { font-size: 12px; color: var(--muted); }
.execution-layout { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 28px; align-items: start; }
.execution-form, .execution-progress { padding: 24px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
.execution-form { fieldset { margin: 20px 0; padding: 16px; border: 1px solid var(--border); border-radius: var(--radius-sm); min-width: 0; } legend { padding: 0 5px; font-size: 13px; } > button { margin-top: 14px; } }
.execution-page { label { display: grid; gap: 6px; margin-bottom: 12px; font-size: 12px; } select, input:not([type='checkbox']), textarea { width: 100%; min-width: 0; padding: 9px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text); background: var(--surface); font: inherit; } textarea { resize: vertical; } }
.paired { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.asset-preview { display: block; width: 100%; max-height: 150px; object-fit: contain; margin-bottom: 14px; }
.summary { font-size: 13px; line-height: 1.8; white-space: pre-wrap; }
.module { border-top: 1px solid var(--border); padding: 16px 0; button { border: 0; background: transparent; text-decoration: underline; color: var(--muted); } }
.execution-page .confirmation { display: flex; align-items: flex-start; gap: 8px; line-height: 1.8; margin-top: 14px; input { margin-top: 4px; } }
.execution-progress { position: sticky; top: 24px; h2 { font-size: 18px; margin-bottom: 18px; } > p { font-size: 13px; margin: 14px 0; } progress { width: 100%; accent-color: var(--text); margin-bottom: 14px; } article { padding: 18px 0; border-bottom: 1px solid var(--border); } h3 { font-size: 14px; } article p { font-size: 12px; margin-top: 6px; } a { display: inline-block; margin-top: 12px; font-size: 12px; text-decoration: underline; } }
.observation { white-space: pre-wrap; line-height: 1.8; color: var(--text-secondary); overflow-wrap: anywhere; }
.help { font-size: 12px; line-height: 1.8; color: var(--muted); }
.error { color: var(--error); font-size: 13px; margin-bottom: 16px; }
@media (max-width: 1000px) { .execution-layout { grid-template-columns: minmax(0, 1fr) 300px; gap: 18px; } }
@media (max-width: 760px) { .execution-layout { grid-template-columns: 1fr; } .execution-progress { position: static; } }
</style>
