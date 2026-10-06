<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowLeft, ImagePlus, Plus, Trash2, ArrowUp, ArrowDown } from '@lucide/vue';
import { PRODUCT_UPLOAD_LIMIT, validateCommerceParameters, type CommerceCopy, type CommerceKind, type CommerceParameters, type CommerceTask, type ProductAsset, type ProductImageResult } from '@photo-studio/shared';
import { request } from '../api';
import { useCommerceStore } from '../stores/commerce';
import ProductResultCards from '../components/ProductResultCards.vue';
import SaveResultDialog from '../components/SaveResultDialog.vue';

const route = useRoute(); const router = useRouter(); const store = useCommerceStore();
const kind = computed(() => route.path.slice(1) as CommerceKind);
const title = computed(() => kind.value === 'product-kit' ? '商品套图' : '商品详情页');
const parameters = ref<CommerceParameters>({ sourceAssetId: '', subject: 'trim', scene: 'white', ratio: '1:1', quality: 'standard', productName: '', platform: 'general', region: 'CN', language: 'zh-CN', sellingPoints: [], sections: [] });
const sellingPoints = ref('');
const uploading = ref(false); const submitting = ref(false); const assisting = ref(false);
const saving = ref<ProductImageResult | null>(null); const notice = ref('');
let copySignal: AbortController | null = null; let version = 0;
const labels = { queued: '等待中', running: '执行中', succeeded: '已完成', failed: '失败', cancelled: '已取消' };
const sectionLabels = { hero: '主图', features: '卖点', usage: '使用场景', specification: '规格', comparison: '对比' };
const currentResults = computed(() => store.task?.items.flatMap((item) => store.results.filter((result) => result.id === item.resultId)) ?? []);
const date = new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

function reset() {
  parameters.value = { sourceAssetId: '', subject: 'trim', scene: 'white', ratio: kind.value === 'detail-page' ? '3:4' : '1:1', quality: 'standard', productName: '', platform: 'general', region: 'CN', language: 'zh-CN', sellingPoints: [], sections: [{ type: 'hero', title: '商品展示', content: '' }, { type: 'features', title: '核心卖点', content: '' }, { type: 'usage', title: '使用场景', content: '' }] };
  sellingPoints.value = '';
}
function upload(event: Event) {
  const input = event.target as HTMLInputElement; const file = input.files?.[0];
  if (!file || uploading.value) return;
  if (file.size > PRODUCT_UPLOAD_LIMIT) { store.error = '图片不能超过 20 MB。'; return; }
  uploading.value = true; store.error = '';
  const body = new FormData(); body.append('file', file); body.append('name', file.name);
  request<ProductAsset>('/assets', { method: 'POST', body }).then((asset) => { store.assets.unshift(asset); parameters.value.sourceAssetId = asset.id; })
    .catch((failure: Error) => { store.error = failure.message; }).finally(() => { uploading.value = false; input.value = ''; });
}
function inputParameters() {
  return validateCommerceParameters({ ...parameters.value, sellingPoints: sellingPoints.value.split('\n').map((line) => line.trim()).filter(Boolean) });
}
function generate() {
  if (store.busy || submitting.value || uploading.value || assisting.value) return;
  store.error = ''; notice.value = '';
  let value: CommerceParameters;
  try { value = inputParameters(); } catch (failure) { store.error = (failure as Error).message; return; }
  submitting.value = true;
  request<CommerceTask>(`/commerce/tasks/${kind.value}`, { method: 'POST', body: JSON.stringify(value) })
    .then((task) => router.push({ path: `/${task.kind}`, query: { task: task.id } }))
    .catch((failure: Error) => { store.error = failure.message; }).finally(() => { submitting.value = false; });
}
function assist() {
  let value: CommerceParameters;
  try { value = inputParameters(); } catch (failure) { store.error = (failure as Error).message; return; }
  assisting.value = true; store.error = ''; notice.value = '';
  const current = version; copySignal = new AbortController(); const signal = copySignal;
  const timeout = setTimeout(() => signal.abort(), 190000);
  /* 文案整理保留原始输入，只有完整结构校验通过才替换；切换页面或取消时丢弃迟到回复。 */
  request<CommerceCopy>('/commerce/assist', { method: 'POST', body: JSON.stringify(value), signal: signal.signal }).then((copy) => {
    if (current !== version) return;
    parameters.value.sections = copy.sections; sellingPoints.value = copy.sellingPoints.join('\n'); notice.value = '文案已整理，请核对商品事实后再生成。';
  }).catch((failure: Error) => { if (current === version) store.error = signal.signal.aborted ? '文案整理已取消或超时，原始内容保留。' : failure.message; })
    .finally(() => { clearTimeout(timeout); if (current === version) { assisting.value = false; copySignal = null; } });
}
function retry(itemId?: string) {
  if (!store.task || store.busy || submitting.value) return;
  submitting.value = true; store.error = ''; notice.value = '';
  request<CommerceTask>(`/commerce/tasks/${store.task.id}/${itemId ? `items/${itemId}/retry` : 'retry'}`, { method: 'POST' })
    .then((task) => store.load(task.id, task.kind)).catch((failure: Error) => { store.error = failure.message; }).finally(() => { submitting.value = false; });
}
function retryResult(result: ProductImageResult) {
  const item = store.task?.items.find((value) => value.resultId === result.id); if (item) retry(item.id);
}
function cancel() {
  if (!store.task) return;
  request<CommerceTask>(`/commerce/tasks/${store.task.id}/cancel`, { method: 'POST' })
    .then((task) => { store.task = task; }).catch((failure: Error) => { store.error = failure.message; });
}
function move(index: number, direction: number) {
  const sections = parameters.value.sections; const target = index + direction;
  if (target < 0 || target >= sections.length) return;
  [sections[index], sections[target]] = [sections[target], sections[index]];
}
function add() { if (parameters.value.sections.length < 8) parameters.value.sections.push({ type: 'features', title: '新的卖点模块', content: '' }); }
function saved(result: ProductImageResult) {
  const index = store.results.findIndex((value) => value.id === result.id); if (index !== -1) store.results[index] = result;
  saving.value = null; notice.value = '图片已保存到项目。';
}
watch(() => [route.path, route.query.task], () => {
  const current = ++version; copySignal?.abort(); assisting.value = false; notice.value = ''; saving.value = null;
  const id = typeof route.query.task === 'string' ? route.query.task : null; reset();
  Promise.all([store.list(kind.value), store.load(id, kind.value)]).then(() => {
    if (current === version && store.task) { parameters.value = { ...store.task.parameters, sellingPoints: [...store.task.parameters.sellingPoints], sections: store.task.parameters.sections.map((section) => ({ ...section })) }; sellingPoints.value = store.task.parameters.sellingPoints.join('\n'); }
  }).catch((failure: Error) => { if (current === version) store.error = failure.message; });
}, { immediate: true });
onBeforeUnmount(() => { ++version; copySignal?.abort(); store.disconnect(); });
</script>

<template>
  <div class="commerce-page">
    <header class="workflow-heading"><RouterLink to="/" class="back"><ArrowLeft :size="16" /> 返回工作台</RouterLink><h1>{{ title }}</h1><p>{{ kind === 'product-kit' ? '按商品卖点组织一套上架图片，保持构图和文案一致。' : '分模块展示商品信息，按顺序组合成完整详情长图。' }}</p></header>
    <div class="workflow-layout">
      <form class="configuration" @submit.prevent="generate">
        <h2>商品与规格</h2>
        <fieldset :disabled="store.busy || submitting || uploading || assisting || store.loading">
          <legend>素材和内容</legend>
          <img v-if="parameters.sourceAssetId" class="source" :src="`/api/assets/${parameters.sourceAssetId}/file`" alt="商品原图" />
          <label class="upload"><ImagePlus :size="18" /> {{ uploading ? '上传中…' : '上传商品原图' }}<input type="file" accept="image/jpeg,image/png,image/webp" aria-label="上传商品原图" @change="upload" /></label>
          <p class="help">静态 JPG / PNG / WebP，20 MB 以内、1600 万像素以内。</p>
          <label v-if="store.assets.length" class="field">已上传素材<select v-model="parameters.sourceAssetId"><option value="" disabled>选择素材</option><option v-for="asset in store.assets" :key="asset.id" :value="asset.id">{{ asset.name }}</option></select></label>
          <label class="field">商品名称<input v-model="parameters.productName" maxlength="80" placeholder="填写实际商品名称" /></label>
          <div class="paired"><label class="field">平台<select v-model="parameters.platform"><option value="general">通用</option><option value="taobao">淘宝</option><option value="jd">京东</option><option value="amazon">Amazon</option><option value="shopify">Shopify</option></select></label><label class="field">地区<select v-model="parameters.region"><option value="CN">中国</option><option value="US">美国</option><option value="GB">英国</option><option value="EU">欧盟</option><option value="JP">日本</option></select></label></div>
          <div class="paired"><label class="field">语言<select v-model="parameters.language"><option value="zh-CN">中文</option><option value="en-US">英文</option><option value="ja-JP">日文</option><option value="de-DE">德文</option></select></label><label class="field">比例<select v-model="parameters.ratio"><option>1:1</option><option>3:4</option><option>4:3</option><option>9:16</option></select></label></div>
          <div class="paired"><label class="field">主体处理<select v-model="parameters.subject"><option value="keep">保留原图</option><option value="trim">裁去空白边缘</option></select></label><label class="field">背景<select v-model="parameters.scene"><option value="white">白底</option><option value="warm">暖色</option><option value="cool">冷色</option></select></label></div>
          <label class="field">质量<select v-model="parameters.quality"><option value="standard">标准 · 长边 1024</option><option value="high">高清 · 长边 2048</option></select></label>
          <label class="field">商品卖点<textarea v-model="sellingPoints" rows="4" placeholder="每行一条，最多 8 条；只填写已确认的信息" /></label>
          <button type="button" class="button secondary" @click="assist">让 Codex 整理文案</button>
          <h2 class="module-heading">{{ kind === 'product-kit' ? '套图结构' : '详情模块' }}</h2>
          <article v-for="(section, index) in parameters.sections" :key="index" class="module">
            <header><strong>模块 {{ index + 1 }}</strong><button type="button" :disabled="index === 0" :aria-label="`上移模块 ${index + 1}`" @click="move(index, -1)"><ArrowUp :size="14" /></button><button type="button" :disabled="index === parameters.sections.length - 1" :aria-label="`下移模块 ${index + 1}`" @click="move(index, 1)"><ArrowDown :size="14" /></button><button type="button" :disabled="parameters.sections.length === 1" :aria-label="`删除模块 ${index + 1}`" @click="parameters.sections.splice(index, 1)"><Trash2 :size="14" /></button></header>
            <label class="field">模块类型<select v-model="section.type"><option v-for="(label, type) in sectionLabels" :key="type" :value="type">{{ label }}</option></select></label>
            <label class="field">模块标题<input v-model="section.title" maxlength="80" /></label>
            <label class="field">模块内容<textarea v-model="section.content" rows="3" maxlength="600" :placeholder="['specification', 'comparison'].includes(section.type) ? '填写准确规格或有依据的对比内容，不能留空' : '填写本张图片需要呈现的内容'" /></label>
          </article>
          <button type="button" class="button secondary" :disabled="parameters.sections.length >= 8" @click="add"><Plus :size="14" /> 添加模块</button>
        </fieldset>
        <p class="help">Codex 生成商品画面，模块文案按确认内容排版。平台与地区保存为上架要求，尺寸以所选比例为准；请核对文案、商品外观和包装文字。</p>
        <button v-if="assisting" class="button secondary" type="button" @click="copySignal?.abort()">取消文案整理</button>
        <button class="button generate" type="submit" :disabled="!parameters.sourceAssetId || !parameters.productName.trim() || store.busy || submitting || uploading || assisting || store.loading">{{ assisting ? '正在整理文案…' : submitting ? '提交中…' : store.busy ? '正在生成…' : `生成${title}` }}</button>
      </form>
      <section class="generation" aria-label="批量生成结果">
        <div class="result-heading"><h2>生成结果</h2><label v-if="store.tasks.length" class="history">历史任务<select :value="store.task?.id ?? ''" aria-label="历史任务" :disabled="submitting" @change="router.push({ path: `/${kind}`, query: { task: ($event.target as HTMLSelectElement).value } })"><option value="" disabled>选择任务</option><option v-for="task in store.tasks" :key="task.id" :value="task.id">{{ date.format(new Date(task.createdAt)) }} · {{ task.parameters.productName }} · {{ labels[task.status] }}</option></select></label></div>
        <p v-if="store.error" class="error" role="alert">{{ store.error }}</p><p v-if="notice" class="notice" role="status">{{ notice }}</p><p v-if="store.connection" class="help">{{ store.connection }}</p>
        <div v-if="store.task" class="task-status"><header><span>{{ labels[store.task.status] }} · {{ store.task.progress }}%</span><button v-if="store.busy" type="button" @click="cancel">取消任务</button><button v-else-if="store.task.status === 'failed' || store.task.status === 'cancelled'" type="button" :disabled="submitting" @click="retry()">重试未完成模块</button></header><progress :value="store.task.progress" max="100" aria-label="批量进度" /><p v-if="store.task.error" class="error">{{ store.task.error }}</p><ul><li v-for="item in store.task.items" :key="item.id"><span>{{ item.index + 1 }}. {{ item.title }}</span><span>{{ labels[item.status] }}</span><button v-if="!store.busy && (item.status === 'failed' || item.status === 'cancelled')" type="button" :disabled="submitting" @click="retry(item.id)">单项重试</button><small v-if="item.error">{{ item.error }}</small></li></ul></div>
        <div v-if="store.task?.status === 'succeeded'" class="export-actions"><a class="button secondary" :href="`/api/commerce/tasks/${store.task.id}/export?format=zip`" download>整套下载 ZIP</a><a v-if="kind === 'detail-page'" class="button" :href="`/api/commerce/tasks/${store.task.id}/export?format=long`" download>下载详情长图</a></div>
        <div v-if="store.loading" class="empty-state"><p>正在读取历史任务…</p></div>
        <ProductResultCards v-else-if="currentResults.length" :results="currentResults" actions :busy="store.busy || submitting" @save="saving = $event" @retry="retryResult" />
        <div v-else class="empty-state"><ImagePlus :size="40" :stroke-width="1" /><h3>{{ store.busy ? '正在生成图片模块' : '先配置商品与模块' }}</h3><p>每张图片独立显示进度，可单独重试、保存、编辑和下载。</p></div>
      </section>
    </div>
    <SaveResultDialog v-if="saving" :result="saving" @close="saving = null" @saved="saved" />
  </div>
</template>

<style scoped lang="scss">
.commerce-page { padding: 24px 32px 48px; max-width: 1600px; margin: 0 auto; }
.workflow-heading { margin-bottom: 26px; h1 { font-size: 26px; margin-top: 12px; } p { color: var(--muted); font-size: 13px; margin-top: 6px; } .back { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); } }
.workflow-layout { display: grid; grid-template-columns: 360px minmax(0, 1fr); gap: 28px; align-items: start; }
.configuration {
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 24px;
  h2 { font-size: 17px; margin-bottom: 20px; } fieldset { border: 0; padding: 0 4px 0 0; margin: 0; min-width: 0; max-height: calc(100vh - 445px); min-height: 240px; overflow-y: auto; } legend { font-size: 12px; }
  .source { display: block; width: 100%; height: 120px; object-fit: contain; background: var(--page); margin: 8px 0 12px; }
  .upload { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 18px; border: 1px dashed var(--border-strong); border-radius: var(--radius-sm); position: relative; }
  .upload input { position: absolute; inset: 0; width: 100%; opacity: 0; cursor: pointer; }
  .field { display: grid; gap: 6px; margin-top: 14px; font-size: 12px; }
  select, input, textarea { min-width: 0; width: 100%; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); font: inherit; background: var(--surface); color: var(--text); }
  textarea { resize: vertical; } .paired { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; } .generate { width: 100%; margin-top: 16px; } .module-heading { margin: 24px 0 12px; }
  fieldset > .button { margin-top: 12px; width: 100%; font-size: 12px; }
}
.module { border: 1px solid var(--border); background: var(--page); border-radius: var(--radius-sm); padding: 12px; margin-bottom: 14px; header { display: flex; align-items: center; gap: 8px; } strong { flex: 1; font-size: 12px; } button { display: grid; place-items: center; border: 0; padding: 3px; background: transparent; } }
.help { font-size: 11px; color: var(--muted); margin-top: 10px; }
.result-heading { display: flex; justify-content: space-between; gap: 16px; align-items: center; margin-bottom: 22px; h2 { font-size: 19px; } }
.history { font-size: 11px; color: var(--muted); display: grid; gap: 4px; select { max-width: 260px; font: inherit; padding: 8px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); } }
.task-status { padding: 16px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); margin-bottom: 20px; header { display: flex; justify-content: space-between; font-size: 12px; } button { border: 0; background: transparent; text-decoration: underline; font-size: 12px; } progress { display: block; width: 100%; height: 6px; accent-color: var(--text); margin-top: 12px; } ul { list-style: none; padding: 0; margin: 14px 0 0; } li { display: flex; gap: 12px; flex-wrap: wrap; padding: 7px 0; font-size: 12px; border-top: 1px solid var(--border); } small { color: var(--error); flex-basis: 100%; } }
.export-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 20px; }
.error { color: var(--error); font-size: 12px; margin-bottom: 16px; }.notice { color: var(--success); font-size: 12px; margin-bottom: 16px; }
@media (max-width: 1000px) { .workflow-layout { grid-template-columns: 300px minmax(0, 1fr); gap: 20px; } .configuration { padding: 18px; } .result-heading { flex-wrap: wrap; } }
@media (max-width: 760px) { .commerce-page { padding-inline: 20px; } .workflow-layout { grid-template-columns: 1fr; } .configuration fieldset { max-height: none; } }
</style>
