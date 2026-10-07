<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute } from 'vue-router';
import { ArrowLeft, Plus, Type, Trash2, Undo2, Redo2, Download, Save, Eye, EyeOff, Lock, Unlock, ArrowUp, ArrowDown } from '@lucide/vue';
import { ProductCanvas } from '@photo-studio/editor';
import { validateEditorContent, type EditorLayer, type ProductImageResult } from '@photo-studio/shared';
import { request } from '../api';
import { useEditorStore } from '../stores/editor';
import SaveResultDialog from '../components/SaveResultDialog.vue';
import CanvasTextTools from '../components/CanvasTextTools.vue';
import CanvasImageAdjustments from '../components/CanvasImageAdjustments.vue';
import CanvasExport from '../components/CanvasExport.vue';

const store = useEditorStore(); const route = useRoute();
const canvasElement = ref<HTMLDivElement | null>(null); const canvasArea = ref<HTMLDivElement | null>(null);
const results = ref<ProductImageResult[]>([]); const imageId = ref('');
const exporting = ref(false); const savingProject = ref<ProductImageResult | null>(null); const renderError = ref('');
const exportOptions = ref(false);
let canvas: ProductCanvas | null = null; let observer: ResizeObserver | null = null;
let painting: Promise<void> = Promise.resolve(); let mounted = false; let loadVersion = 0;
const saveStatus = computed(() => store.saving ? '正在保存…' : store.error ? '保存失败，修改保留在页面' : store.dirty ? '等待自动保存…' : '所有修改已保存');
const selectedIndex = computed(() => store.content?.layers.findIndex((item) => item.id === store.selected) ?? -1);

function paint() {
  if (!canvas || !canvasArea.value || !store.content) return Promise.resolve();
  renderError.value = '';
  try { validateEditorContent(store.content); } catch (failure) { renderError.value = (failure as Error).message; return Promise.resolve(); }
  painting = canvas.render(store.content, canvasArea.value.clientWidth, canvasArea.value.clientHeight).catch((failure: Error) => { renderError.value = failure.message; });
  return painting;
}
function load() {
  const current = ++loadVersion;
  return store.load(String(route.params.resultId)).then(() => {
    if (current !== loadVersion || !store.document) return;
    return request<ProductImageResult>(`/product-image/results/${store.document.resultId}`).then((result) => {
      if (current !== loadVersion) return;
      if (result.projectId) return request<ProductImageResult[]>(`/projects/${result.projectId}/results`).then((value) => { if (current === loadVersion) results.value = value; });
      results.value = [result];
    });
  }).catch((failure: Error) => { if (current === loadVersion) store.error = failure.message; });
}
function addText() {
  if (!store.content || store.content.layers.length >= 50) return;
  const layer: EditorLayer = { id: crypto.randomUUID(), type: 'text', name: '新文字', x: store.content.width * .10, y: store.content.height * .10, width: store.content.width * .8, height: 150, rotation: 0, opacity: 1, visible: true, locked: false, text: '输入商品文案', fontSize: Math.min(72, Math.round(store.content.width * .06)), fontFamily: 'Microsoft YaHei', fill: '#202020', align: 'left' };
  store.content.layers.push(layer); store.selected = layer.id; store.commit();
}
function addImage() {
  if (!store.content || !imageId.value || store.content.layers.length >= 50) return;
  const result = results.value.find((value) => value.id === imageId.value); if (!result) return;
  const width = store.content.width * .5;
  const layer: EditorLayer = { id: crypto.randomUUID(), type: 'image', name: result.name, resultId: result.id, x: store.content.width * .25, y: store.content.height * .25, width, height: result.height / result.width * width, rotation: 0, opacity: 1, visible: true, locked: false };
  store.content.layers.push(layer); store.selected = layer.id; store.commit();
}
function remove() {
  if (!store.content || selectedIndex.value === -1 || store.layer?.locked) return;
  store.content.layers.splice(selectedIndex.value, 1); store.selected = null; store.commit();
}
function move(direction: number) {
  if (!store.content || store.layer?.locked) return;
  const index = selectedIndex.value; const target = index + direction;
  if (index < 0 || target < 0 || target >= store.content.layers.length) return;
  const layers = store.content.layers; [layers[index], layers[target]] = [layers[target], layers[index]]; store.commit();
}
function align(position: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') {
  const layer = store.layer; const content = store.content; if (!layer || !content || layer.locked) return;
  if (position === 'left') layer.x = 0; if (position === 'center') layer.x = (content.width - layer.width) / 2; if (position === 'right') layer.x = content.width - layer.width;
  if (position === 'top') layer.y = 0; if (position === 'middle') layer.y = (content.height - layer.height) / 2; if (position === 'bottom') layer.y = content.height - layer.height;
  store.commit();
}
function download(format: 'png' | 'jpeg', scale: number, name: string) {
  if (!canvas || exporting.value) return;
  exporting.value = true;
  painting.then(() => { if (renderError.value) throw new Error(renderError.value); return canvas!.export(format, scale); }).then((blob) => {
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `${name}.${format === 'jpeg' ? 'jpg' : 'png'}`; link.click(); exportOptions.value = false; setTimeout(() => URL.revokeObjectURL(url), 1000);
  }).catch((failure: Error) => { renderError.value = failure.message; }).finally(() => { exporting.value = false; });
}
function saveProject() {
  if (!store.document) return;
  request<ProductImageResult>(`/product-image/results/${store.document.resultId}`).then((result) => { savingProject.value = result; })
    .catch((failure: Error) => { store.error = failure.message; });
}
function keyboard(event: KeyboardEvent) {
  if (exportOptions.value) { if (event.key === 'Escape' && !exporting.value) exportOptions.value = false; return; }
  const target = event.target as HTMLElement; if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) store.redo(); else store.undo(); }
  else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); store.save().catch(() => {}); }
  else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); remove(); }
}
function beforeUnload(event: BeforeUnloadEvent) { if (store.dirty) { event.preventDefault(); event.returnValue = ''; } }
watch(() => route.params.resultId, () => { results.value = []; imageId.value = ''; load(); }, { immediate: true });
watch(() => store.content, () => { if (mounted) nextTick(paint); }, { deep: true });
watch(() => store.selected, (id) => canvas?.select(id));
onMounted(() => {
  mounted = true;
  canvas = new ProductCanvas(canvasElement.value!, (id) => { store.selected = id; }, (id, values) => store.updateLayer(id, values));
  observer = new ResizeObserver(paint); observer.observe(canvasArea.value!); paint();
  window.addEventListener('keydown', keyboard); window.addEventListener('beforeunload', beforeUnload);
});
onBeforeRouteLeave(() => store.save().then(() => true).catch(() => false));
onBeforeRouteUpdate(() => store.save().then(() => true).catch(() => false));
onBeforeUnmount(() => { ++loadVersion; mounted = false; observer?.disconnect(); canvas?.destroy(); store.close(); window.removeEventListener('keydown', keyboard); window.removeEventListener('beforeunload', beforeUnload); });
</script>

<template>
  <div class="editor-page">
    <header class="editor-heading"><RouterLink :to="store.document?.projectId ? `/projects/${store.document.projectId}` : '/product-image'" class="back"><ArrowLeft :size="16" /> 返回</RouterLink><h1>{{ store.content?.name ?? '图片编辑器' }}</h1><span role="status">{{ store.loading ? '正在读取作品…' : saveStatus }}</span><button type="button" class="button secondary" :disabled="!store.document || store.saving" @click="store.save().catch(() => {})"><Save :size="15" /> 保存</button><button type="button" class="button" :disabled="!store.document || exporting || !!renderError" @click="exportOptions = true"><Download :size="15" /> 下载作品</button></header>
    <CanvasExport v-if="exportOptions && store.content" :width="store.content.width" :height="store.content.height" :name="store.content.name" :busy="exporting" @close="exportOptions = false" @download="download" />
    <p v-if="store.error || renderError" class="error" role="alert">{{ store.error || renderError }} <button type="button" @click="load">重新读取作品</button></p>
    <div class="editor-layout">
      <aside class="layers-panel" aria-label="图层面板">
        <h2>图层</h2><div class="history-actions"><button type="button" :disabled="!store.canUndo" aria-label="撤销" @click="store.undo"><Undo2 :size="17" /></button><button type="button" :disabled="!store.canRedo" aria-label="重做" @click="store.redo"><Redo2 :size="17" /></button><button type="button" :disabled="!store.content || store.content.layers.length >= 50" @click="addText"><Type :size="15" /> 添加文字</button></div>
        <label class="field">添加项目图片<select v-model="imageId"><option value="">选择图片</option><option v-for="result in results" :key="result.id" :value="result.id">{{ result.name }}</option></select></label><button class="button secondary" type="button" :disabled="!imageId || !store.content || store.content.layers.length >= 50" @click="addImage"><Plus :size="14" /> 添加图片</button>
        <ul><li v-for="layer in [...(store.content?.layers ?? [])].reverse()" :key="layer.id" :class="{ selected: store.selected === layer.id }"><button type="button" class="layer-name" @click="store.selected = layer.id">{{ { image: '图片', 'asset-image': '素材', text: '文字', shape: '形状', path: '画笔' }[layer.type] }} · {{ layer.name }}</button><button type="button" :aria-label="`${layer.visible ? '隐藏' : '显示'} ${layer.name}`" @click="layer.visible = !layer.visible; store.commit()"><component :is="layer.visible ? Eye : EyeOff" :size="14" /></button><button type="button" :aria-label="`${layer.locked ? '解锁' : '锁定'} ${layer.name}`" @click="layer.locked = !layer.locked; store.commit()"><component :is="layer.locked ? Lock : Unlock" :size="14" /></button></li></ul>
        <div class="layer-actions"><button type="button" :disabled="selectedIndex < 0 || !!store.layer?.locked" @click="move(1)"><ArrowUp :size="14" /> 上移</button><button type="button" :disabled="selectedIndex < 0 || !!store.layer?.locked" @click="move(-1)"><ArrowDown :size="14" /> 下移</button><button type="button" :disabled="selectedIndex < 0 || !!store.layer?.locked" @click="remove"><Trash2 :size="14" /> 删除</button></div>
        <p>点击图层或画布选中；拖动调整位置，拖动边框缩放，顶部手柄旋转。</p>
      </aside>
      <section ref="canvasArea" class="canvas-area" aria-label="图片画布"><div ref="canvasElement" class="canvas" /></section>
      <aside class="properties-panel" aria-label="属性面板">
        <template v-if="store.content"><h2>画布</h2><label class="field">作品名称<input v-model="store.content.name" maxlength="200" @input="store.commit" /></label><div class="paired"><label class="field">宽<input v-model.number="store.content.width" type="number" min="1" max="16384" @change="store.commit" /></label><label class="field">高<input v-model.number="store.content.height" type="number" min="1" max="16384" @change="store.commit" /></label></div><label class="field">背景<select v-if="store.content.background === 'transparent'" aria-label="背景" @change="store.content.background = '#ffffff'; store.commit()"><option>透明背景</option><option>使用颜色</option></select><template v-else><input v-model="store.content.background" type="color" @change="store.commit" /><button type="button" @click="store.content.background = 'transparent'; store.commit()">透明背景</button></template></label><button type="button" class="button secondary" @click="saveProject">保存到项目</button></template>
        <fieldset v-if="store.layer" :disabled="store.layer.locked">
          <legend>当前图层</legend><label class="field">图层名称<input v-model="store.layer.name" maxlength="200" @input="store.commit" /></label>
          <CanvasTextTools v-if="store.layer.type === 'text'" hide-edit />
          <CanvasImageAdjustments />
          <div v-if="store.layer.type === 'shape' || store.layer.type === 'path'" class="paired"><label class="field">线条颜色<input v-model="store.layer.stroke" type="color" @change="store.commit" /></label><label class="field">线条粗细<input v-model.number="store.layer.strokeWidth" type="number" :min="store.layer.type === 'path' ? 1 : 0" max="300" @change="store.commit" /></label></div>
          <label v-if="store.layer.type === 'shape'" class="field">填充<select v-if="store.layer.fill === 'transparent'" @change="store.layer.fill = '#3b82f6'; store.commit()"><option>无填充</option><option>使用颜色</option></select><template v-else><input v-model="store.layer.fill" type="color" @change="store.commit" /><button type="button" @click="store.layer.fill = 'transparent'; store.commit()">无填充</button></template></label>
          <div class="paired"><label class="field">X<input v-model.number="store.layer.x" type="number" @change="store.commit" /></label><label class="field">Y<input v-model.number="store.layer.y" type="number" @change="store.commit" /></label></div>
          <div class="paired"><label class="field">宽度<input v-model.number="store.layer.width" type="number" min="1" max="16384" @change="store.commit" /></label><label class="field">高度<input v-model.number="store.layer.height" type="number" min="1" max="16384" @change="store.commit" /></label></div>
          <div class="paired"><label class="field">旋转<input v-model.number="store.layer.rotation" type="number" min="-360" max="360" @change="store.commit" /></label><label class="field">透明度<input v-model.number="store.layer.opacity" type="number" min="0" max="1" step="0.1" @change="store.commit" /></label></div>
          <div v-if="store.layer.type === 'text'"><label class="field">文字内容<textarea v-model="store.layer.text" rows="4" maxlength="2000" @input="store.fitText(); store.commit()" /></label><div class="paired"><label class="field">字间距<input :value="store.layer.letterSpacing ?? 0" type="number" min="-20" max="100" step=".5" @input="store.layer.letterSpacing = Number(($event.target as HTMLInputElement).value); store.fitText(); store.commit()" /></label><label class="field">行高<input :value="store.layer.lineHeight ?? 1" type="number" min=".5" max="5" step=".1" @input="store.layer.lineHeight = Number(($event.target as HTMLInputElement).value); store.fitText(); store.commit()" /></label></div></div>
          <div class="align-actions"><button type="button" @click="align('left')">左对齐</button><button type="button" @click="align('center')">水平居中</button><button type="button" @click="align('right')">右对齐</button><button type="button" @click="align('top')">顶对齐</button><button type="button" @click="align('middle')">垂直居中</button><button type="button" @click="align('bottom')">底对齐</button></div>
        </fieldset>
        <p v-else class="help">选中图层后可调整位置、大小与文字属性。</p>
      </aside>
    </div>
    <SaveResultDialog v-if="savingProject" :result="savingProject" @close="savingProject = null" @saved="if (store.document) store.document.projectId = $event.projectId; savingProject = null" />
  </div>
</template>

<style scoped lang="scss">
.editor-page { padding: 16px 24px 24px; }
.editor-heading { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 16px; h1 { font-size: 17px; font-weight: 550; flex: 1; min-width: 160px; overflow-wrap: anywhere; } span { font-size: 11px; color: var(--muted); } .back { display: inline-flex; gap: 6px; align-items: center; font-size: 12px; color: var(--muted); } .button { padding: 8px 12px; font-size: 12px; } }
.editor-layout { display: grid; grid-template-columns: 220px minmax(250px, 1fr) 250px; gap: 16px; height: calc(100vh - 180px); min-height: 500px; }
.layers-panel, .properties-panel {
  overflow-y: auto; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 16px;
  h2 { font-size: 14px; } p { font-size: 11px; color: var(--muted); margin-top: 16px; } .field { display: grid; gap: 5px; margin-top: 12px; font-size: 11px; }
  input, select, textarea { width: 100%; min-width: 0; border: 1px solid var(--border); border-radius: 6px; padding: 7px; background: var(--surface); color: var(--text); font: inherit; }
  input[type='color'] { padding: 3px; height: 32px; } .paired { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; } .button { margin-top: 12px; font-size: 11px; width: 100%; padding: 8px; }
  fieldset { margin: 18px 0 0; padding: 0; border: 0; min-width: 0; } legend { font-size: 13px; font-weight: 550; }
}
.layers-panel { ul { list-style: none; padding: 0; margin: 18px 0 0; } li { display: flex; align-items: center; gap: 5px; border: 1px solid var(--border); padding: 8px; margin-bottom: 8px; border-radius: 6px; } li.selected { border-color: var(--text); background: var(--page); } li button { border: 0; background: transparent; padding: 0; display: flex; color: var(--text-secondary); } .layer-name { flex: 1; overflow-wrap: anywhere; text-align: left; font-size: 11px; } }
.history-actions, .layer-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; button { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; border: 1px solid var(--border); border-radius: 5px; background: var(--surface); padding: 6px; } }
.align-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 16px; button { font-size: 10px; border: 1px solid var(--border); border-radius: 5px; padding: 6px; background: var(--surface); } }
.canvas-area { display: flex; justify-content: center; align-items: center; overflow: hidden; background: #e9e9e7; border: 1px solid var(--border); border-radius: var(--radius-sm); }
.canvas { box-shadow: 0 3px 16px rgb(0 0 0 / 12%); }
.error { padding: 12px; margin-bottom: 16px; color: var(--error); font-size: 12px; background: var(--surface); border: 1px solid var(--error); border-radius: 8px; button { border: 0; background: transparent; text-decoration: underline; color: inherit; } }
@media (max-width: 1100px) { .editor-layout { grid-template-columns: 180px minmax(200px, 1fr) 210px; gap: 10px; } .editor-page { padding-inline: 16px; } .layers-panel, .properties-panel { padding: 12px; } }
@media (max-width: 760px) { .editor-layout { grid-template-columns: 1fr; height: auto; } .canvas-area { min-height: 500px; } .layers-panel, .properties-panel { max-height: 400px; } }
</style>
