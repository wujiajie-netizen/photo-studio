<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowLeft, ImagePlus } from '@lucide/vue';
import { PRODUCT_UPLOAD_LIMIT, validateProductImageParameters, type ProductImageParameters, type ProductImageResult, type ProductImageTask } from '@photo-studio/shared';
import { useProductImageStore } from '../stores/product-image';
import ProductResultCards from '../components/ProductResultCards.vue';
import SaveResultDialog from '../components/SaveResultDialog.vue';

const store = useProductImageStore();
const route = useRoute();
const router = useRouter();
const parameters = ref<ProductImageParameters>({ sourceAssetId: '', subject: 'keep', scene: 'white', description: '', ratio: '1:1', count: 2, quality: 'standard' });
const uploading = ref(false);
const saving = ref<ProductImageResult | null>(null);
const notice = ref('');
const statusLabels = { queued: '等待执行', running: '正在生成', succeeded: '生成完成', failed: '生成失败', cancelled: '已取消' };
const status = computed(() => store.task ? statusLabels[store.task.status] : '准备开始');
const date = new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

function upload(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file || uploading.value) return;
  notice.value = '';
  if (file.size > PRODUCT_UPLOAD_LIMIT) { store.error = '图片不能超过 20 MB。'; return; }
  uploading.value = true; store.error = '';
  store.upload(file).then((asset) => { parameters.value.sourceAssetId = asset.id; })
    .catch((failure: Error) => { store.error = failure.message; }).finally(() => { uploading.value = false; input.value = ''; });
}
function open(task: ProductImageTask) { return router.push({ path: '/product-image', query: { task: task.id } }); }
function generate() {
  if (store.busy || uploading.value) return;
  store.error = ''; notice.value = '';
  try { validateProductImageParameters(parameters.value); }
  catch (failure) { store.error = failure instanceof Error ? failure.message : '请检查生成参数。'; return; }
  store.submit({ ...parameters.value }).then(open).catch((failure: Error) => { store.error = failure.message; });
}
function retry(result?: ProductImageResult) {
  const id = result?.id ?? store.task?.id;
  if (!id || store.busy) return;
  notice.value = ''; store.error = '';
  store.retry(id, !!result).then(open).catch((failure: Error) => { store.error = failure.message; });
}
function saved(result: ProductImageResult) {
  const index = store.results.findIndex((item) => item.id === result.id);
  if (index !== -1) store.results[index] = result;
  saving.value = null; notice.value = '图片已保存到项目。';
}
store.list().catch((failure: Error) => { store.error = failure.message; });
watch(() => route.query.task, (id) => {
  notice.value = ''; saving.value = null;
  store.load(typeof id === 'string' ? id : null).then(() => {
    if (store.task) parameters.value = { ...store.task.parameters };
    else parameters.value.sourceAssetId = store.source?.id ?? '';
  });
}, { immediate: true });
onBeforeUnmount(() => store.disconnect());
</script>

<template>
  <div class="product-image-page">
    <header class="workflow-heading"><RouterLink to="/" class="back"><ArrowLeft :size="16" /> 返回工作台</RouterLink><h1>AI 商品图</h1><p>上传商品原图，选择背景与画幅，生成可下载的商品展示图。</p></header>
    <div class="workflow-layout">
      <form class="configuration" @submit.prevent="generate">
        <h2>生成设置</h2>
        <fieldset :disabled="store.loading || store.busy || uploading">
          <legend>商品原图</legend>
          <div v-if="store.source" class="source-preview"><img :src="`/api/assets/${store.source.id}/file`" :alt="store.source.name" /><p>{{ store.source.name }} · {{ store.source.width }} × {{ store.source.height }}</p></div>
          <label class="upload"><ImagePlus :size="22" /><span>{{ uploading ? '正在上传…' : store.source ? '更换商品原图' : '上传商品原图' }}</span><input type="file" accept="image/jpeg,image/png,image/webp" aria-label="上传商品原图" @change="upload" /></label>
          <p class="help">JPG / PNG / WebP，单张不超过 20 MB、1600 万像素。</p>
          <label v-if="store.assets.length" class="field">已上传素材<select :value="store.source?.id ?? ''" @change="store.source = store.assets.find(item => item.id === ($event.target as HTMLSelectElement).value) ?? null; parameters.sourceAssetId = store.source?.id ?? ''"><option value="" disabled>选择素材</option><option v-for="asset in store.assets" :key="asset.id" :value="asset.id">{{ asset.name }}</option></select></label>
          <label class="field">主体处理<select v-model="parameters.subject"><option value="keep">保留原图</option><option value="trim">裁去空白边缘</option></select></label>
          <label class="field">背景场景<select v-model="parameters.scene"><option value="white">白底</option><option value="warm">暖色</option><option value="cool">冷色</option></select></label>
          <label class="field">补充描述<textarea v-model="parameters.description" rows="3" maxlength="1000" placeholder="记录商品卖点与希望呈现的效果" /></label>
          <div class="paired"><label class="field">画面比例<select v-model="parameters.ratio"><option>1:1</option><option>3:4</option><option>4:3</option><option>9:16</option></select></label><label class="field">生成数量<select v-model.number="parameters.count"><option v-for="count in 4" :key="count" :value="count">{{ count }} 张</option></select></label></div>
          <label class="field">图片质量<select v-model="parameters.quality"><option value="standard">标准 · 长边 1024</option><option value="high">高清 · 长边 2048</option></select></label>
        </fieldset>
        <p class="generation-notice">使用 Codex 根据商品原图与描述生成图片，需联网并消耗账户额度。请核对商品外观和包装文字；高清表示导出长边 2048，原生细节取决于生成结果。</p>
        <button class="button generate" type="submit" :disabled="!store.source || store.loading || store.busy || uploading">{{ store.submitting ? '提交中…' : store.busy ? '任务执行中…' : '生成商品图' }}</button>
      </form>
      <section class="generation" aria-label="生成结果">
        <div class="result-heading"><div><h2>生成结果</h2><p>{{ status }}<span v-if="store.task"> · {{ store.task.parameters.count }} 张</span></p></div><label v-if="store.tasks.length" class="history">历史任务<select :value="store.task?.id ?? ''" :disabled="store.submitting" aria-label="历史任务" @change="router.push({ path: '/product-image', query: { task: ($event.target as HTMLSelectElement).value } })"><option value="" disabled>选择任务</option><option v-for="task in store.tasks" :key="task.id" :value="task.id">{{ date.format(new Date(task.createdAt)) }} · {{ statusLabels[task.status] }}</option></select></label></div>
        <p v-if="store.error" class="error" role="alert">{{ store.error }} <button v-if="route.query.task" type="button" @click="store.load(String(route.query.task))">重新读取</button></p>
        <p v-if="notice" class="notice" role="status">{{ notice }}</p>
        <p v-if="store.connection" class="help" role="status">{{ store.connection }}</p>
        <div v-if="store.task" class="task-status" role="status"><div><span>{{ status }} · {{ store.task.progress }}%</span><button v-if="store.busy" type="button" @click="store.cancel">取消任务</button><button v-else-if="['failed', 'cancelled'].includes(store.task.status)" type="button" @click="retry()">重试任务</button></div><progress :value="store.task.progress" max="100" :aria-label="status" /><p v-if="store.task.error" class="error">{{ store.task.error }}</p></div>
        <div v-if="store.loading" class="empty-state"><p>正在读取任务…</p></div>
        <ProductResultCards v-else-if="store.results.length" :results="store.results" actions :busy="store.busy" @save="saving = $event" @retry="retry" />
        <div v-else class="empty-state"><ImagePlus :size="40" :stroke-width="1" /><h3>{{ store.busy ? '正在制作商品展示图' : '从一张商品原图开始' }}</h3><p>{{ store.busy ? '生成结果会随任务进度自动显示。' : '生成后可预览、重新生成、保存到项目并下载 PNG。' }}</p></div>
      </section>
    </div>
    <SaveResultDialog v-if="saving" :result="saving" @close="saving = null" @saved="saved" />
  </div>
</template>

<style scoped lang="scss">
.product-image-page { padding: 24px 32px 48px; max-width: 1600px; margin: 0 auto; }
.workflow-heading { margin-bottom: 26px; h1 { font-size: 26px; font-weight: 600; margin-top: 12px; } p { color: var(--muted); font-size: 13px; margin-top: 6px; } .back { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); } }
.workflow-layout { display: grid; grid-template-columns: 360px minmax(0, 1fr); gap: 28px; align-items: start; }
.configuration {
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 24px;
  h2 { font-size: 17px; margin-bottom: 20px; } fieldset { border: 0; padding: 0 4px 0 0; margin: 0; min-width: 0; max-height: calc(100vh - 470px); min-height: 240px; overflow-y: auto; } legend { font-size: 13px; margin-bottom: 10px; }
  .upload { display: flex; justify-content: center; gap: 9px; align-items: center; position: relative; padding: 18px 12px; border: 1px dashed var(--border-strong); border-radius: var(--radius-sm); cursor: pointer; }
  .upload input { position: absolute; inset: 0; width: 100%; opacity: 0; cursor: pointer; }
  fieldset:disabled .upload { opacity: .5; cursor: not-allowed; }
  .field { display: grid; gap: 7px; margin-top: 18px; font-size: 12px; }
  select, textarea { width: 100%; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); font: inherit; color: var(--text); background: var(--surface); }
  textarea { resize: vertical; min-height: 85px; } .paired { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; } .generate { width: 100%; margin-top: 18px; }
}
.source-preview { margin-bottom: 12px; img { display: block; width: 100%; height: 140px; object-fit: contain; background: var(--page); border-radius: var(--radius-sm); } p { font-size: 11px; color: var(--muted); margin-top: 6px; overflow-wrap: anywhere; } }
.help, .generation-notice { font-size: 11px; color: var(--muted); margin-top: 8px; }
.generation-notice { padding: 12px; background: var(--page); border-radius: var(--radius-sm); margin-top: 20px; }
.result-heading { display: flex; justify-content: space-between; gap: 18px; align-items: center; margin-bottom: 22px; h2 { font-size: 19px; } p { font-size: 12px; color: var(--muted); } }
.history { font-size: 11px; color: var(--muted); display: grid; gap: 4px; select { max-width: 240px; padding: 8px; font: inherit; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); } }
.task-status { padding: 16px; margin-bottom: 20px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); div { display: flex; justify-content: space-between; gap: 12px; font-size: 12px; } button { border: 0; background: transparent; color: var(--muted); text-decoration: underline; } progress { width: 100%; height: 6px; accent-color: var(--text); display: block; margin-top: 12px; } }
.error { color: var(--error); font-size: 12px; margin-bottom: 16px; button { color: inherit; border: 0; background: transparent; text-decoration: underline; } }
.notice { color: var(--success); margin-bottom: 16px; font-size: 12px; }
@media (max-width: 1000px) { .workflow-layout { grid-template-columns: 300px minmax(0, 1fr); gap: 20px; } .configuration { padding: 18px; } .result-heading { flex-wrap: wrap; } }
@media (max-width: 760px) { .product-image-page { padding-inline: 20px; } .workflow-layout { grid-template-columns: 1fr; } .configuration fieldset { max-height: none; } }
</style>
