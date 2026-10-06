<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { ChevronLeft, ChevronRight, Download, Expand, Hand, Image, Layers3, Minus, MousePointer2, Plus, RefreshCw, Type, Undo2, Redo2, Eye, EyeOff, Lock, Unlock, Copy, Trash2, X, Sparkles, Grid2X2, HelpCircle, Crop, SlidersHorizontal, Brush, Shapes, Upload } from '@lucide/vue';
import { ProductCanvas } from '@photo-studio/editor';
import { validateEditorContent, type AgentExecution, type CommerceTask, type ProductAsset, type ProductImageResult, type EditorShapeLayer, type ImageToolTask, type ImageToolInput, type CreationScene } from '@photo-studio/shared';
import { request } from '../api';
import { useEditorStore } from '../stores/editor';
import CanvasProperties from './CanvasProperties.vue';
import CanvasCrop from './CanvasCrop.vue';
import CanvasDraw from './CanvasDraw.vue';
import CanvasMask from './CanvasMask.vue';
import CanvasTextTools from './CanvasTextTools.vue';
import CanvasBoardPreview from './CanvasBoardPreview.vue';
import CanvasShapeDraw from './CanvasShapeDraw.vue';
import CanvasLibrary from './CanvasLibrary.vue';

const props = defineProps<{ sessionId: string; taskIds: string[] }>();
const emit = defineEmits<{ update: [state: { executions: AgentExecution[]; results: ProductImageResult[]; selectedId: string; loading: boolean }]; reference: [asset: ProductAsset, modifying: boolean] }>();
const executions = ref<AgentExecution[]>([]); const results = ref<ProductImageResult[]>([]);
const activeExecution = computed(() => executions.value.find(execution => ['queued', 'running'].includes(execution.status)));
const selectedId = ref(''); const selected = computed(() => results.value.find(result => result.id === selectedId.value));
const loading = ref(false); const error = ref(''); const zoom = ref(1);
const hand = ref(false); const dragging = ref(false); const offset = ref({ x: 0, y: 0 });
const boards = ref<CreationScene['boards']>([]); const boardSizes = ref<Record<string, { width: number; height: number }>>({});
const board = computed(() => boards.value.find(item => item.resultId === selectedId.value));
const specialMode = computed(() => !!maskMode.value || cropping.value || !!toolSettings.value);
const canvasScale = ref(1); const sceneReady = ref(false); const sceneError = ref('');
let sceneRevision = 0; let sceneChanges = 0; let savedSceneChanges = 0; let sceneTimer: ReturnType<typeof setTimeout> | null = null; let scenePending: Promise<void> | null = null;
let sceneSession = props.sessionId;
let boardDrag: { id: string; x: number; y: number; clientX: number; clientY: number } | null = null; let renderError = ''; let spaceHand: boolean | null = null;
const referencing = ref(false);
const editor = useEditorStore(); const editing = ref(false); const panel = ref(false); const overview = ref(false); const help = ref(false); const exporting = ref(false);
const imageId = ref('');
const cropping = ref(false); const tools = ref(false); const picked = ref(false);
const maskMode = ref<'edit' | 'erase' | 'replace-text' | null>(null); const toolSubmitting = ref(false); const toolTasks = ref<ImageToolTask[]>([]);
const activeTool = computed(() => toolTasks.value.find(task => task.status === 'running') ?? toolTasks.value.find(task => task.status === 'queued'));
const textMenu = ref(false); const toolSettings = ref<'upscale' | 'expand' | null>(null); const upscale = ref<2 | 4>(2);
const expandBox = ref({ x: 0, y: 0, width: 1, height: 1 });
const toolNames = { edit: 'AI 改图', erase: '无痕消除', 'replace-text': '无痕改字', cutout: '抠图', upscale: 'AI 超清', expand: 'AI 扩图', 'split-layers': '拆分图层', 'recognize-text': '编辑文字' };
const drawing = ref(false); const shapeMenu = ref(false); const brushColor = ref('#202020'); const brushSize = ref(12); const importing = ref(false);
const placingText = ref(false); const editingText = ref(false); const toolHistory = ref(false);
const drawingShape = ref<EditorShapeLayer['shape'] | null>(null);
const libraryOpen = ref(false);
const shownTools = computed(() => toolHistory.value ? toolTasks.value : [activeTool.value ?? toolTasks.value[0]].filter((task): task is ImageToolTask => !!task));
const shapeNames = { rectangle: '矩形', ellipse: '圆形', triangle: '三角形', star: '星形', line: '线条', arrow: '箭头' };
const selectedIndex = computed(() => results.value.findIndex(result => result.id === selectedId.value));
const saveStatus = computed(() => editor.loading ? '正在读取编辑内容…' : editor.saving ? '正在保存…' : editor.error ? '保存失败，请重试' : editor.dirty ? '等待保存…' : '修改已保存');
let painting: Promise<void> = Promise.resolve();
let start: { x: number; y: number; offsetX: number; offsetY: number } | null = null;
const area = ref<HTMLDivElement | null>(null); const container = ref<HTMLDivElement | null>(null);
let canvas: ProductCanvas | null = null; let observer: ResizeObserver | null = null; let version = 0; let resultVersion = 0;
const streams = new Map<string, EventSource>();
const labels = { queued: '等待生成', running: '生成和检查中', succeeded: '作品已保存', failed: '生成需要处理', cancelled: '生成已停止' };
function paint() {
  const result = selected.value; if (!canvas || !area.value || !result) return;
  const content = editing.value && editor.content ? editor.content : { name: result.name, width: result.width, height: result.height, background: '#ffffff', layers: [{ id: result.id, type: 'image' as const, name: result.name, resultId: result.id, x: 0, y: 0, width: result.width, height: result.height, rotation: 0, opacity: 1, visible: true, locked: true }] };
  try { validateEditorContent(content); } catch (reason) { error.value = (reason as Error).message; return; }
  const scale = specialMode.value ? Math.min((area.value.clientWidth - 80) / (toolSettings.value === 'expand' ? expandBox.value.width : content.width), (area.value.clientHeight - (maskMode.value ? 260 : 170)) / (toolSettings.value === 'expand' ? expandBox.value.height : content.height), 1) : zoom.value;
  canvasScale.value = Math.max(.03, scale); boardSizes.value[result.id] = { width: content.width, height: content.height }; renderError = '';
  painting = canvas.render(content, area.value.clientWidth, area.value.clientHeight, Math.max(.03, scale), !hand.value && !cropping.value && !drawing.value && !drawingShape.value && !placingText.value && !maskMode.value && !toolSettings.value)
    .then(() => { if (editing.value && !hand.value && !cropping.value && !drawing.value && !maskMode.value && !toolSettings.value) canvas?.select(editor.selected); }).catch((reason: Error) => { renderError = reason.message; error.value = reason.message; });
}
function fit(all = false) {
  if (!area.value || !selected.value || !board.value) return;
  if (specialMode.value) { offset.value = { x: 0, y: 0 }; paint(); return; }
  const targets = all ? boards.value : [board.value];
  const left = Math.min(...targets.map(item => item.x)); const top = Math.min(...targets.map(item => item.y));
  const right = Math.max(...targets.map(item => item.x + (boardSizes.value[item.resultId]?.width ?? results.value.find(result => result.id === item.resultId)!.width)));
  const bottom = Math.max(...targets.map(item => item.y + (boardSizes.value[item.resultId]?.height ?? results.value.find(result => result.id === item.resultId)!.height)));
  zoom.value = Math.max(.03, Math.min(1, (area.value.clientWidth - 100) / (right - left), (area.value.clientHeight - 140) / (bottom - top)));
  offset.value = { x: (area.value.clientWidth - (right - left) * zoom.value) / 2 - left * zoom.value, y: (area.value.clientHeight - (bottom - top) * zoom.value) / 2 - top * zoom.value + 20 };
}
function saveScene(): Promise<void> {
  if (sceneTimer) { clearTimeout(sceneTimer); sceneTimer = null; }
  if (scenePending) return scenePending.then(() => saveScene());
  if (!sceneReady.value || sceneChanges === savedSceneChanges) return Promise.resolve();
  const current = version; const change = sceneChanges;
  /* 布局保存排队；保留保存期间的新拖动，不使用服务器响应覆盖本地视口。 */
  const snapshot: CreationScene = { boards: boards.value.map(item => ({ ...item })), viewport: { ...offset.value, zoom: zoom.value }, selectedId: selectedId.value || null, revision: sceneRevision };
  scenePending = request<CreationScene>(`/editor/scenes/${sceneSession}`, { method: 'PATCH', body: JSON.stringify(snapshot) }).then(value => { if (current === version) { sceneRevision = value.revision; savedSceneChanges = change; sceneError.value = ''; } }).catch((reason: Error) => { if (current === version) sceneError.value = reason.message; throw reason; }).finally(() => { scenePending = null; });
  return scenePending;
}
function scheduleScene() { if (!sceneReady.value || specialMode.value) return; ++sceneChanges; if (sceneTimer) clearTimeout(sceneTimer); sceneTimer = setTimeout(() => { saveScene().catch(() => {}); }, 500); }
function select(id: string, focus = true) {
  if (cropping.value || drawing.value || drawingShape.value || placingText.value || maskMode.value || toolSubmitting.value || toolSettings.value) return;
  if (id === selectedId.value) { overview.value = false; return; }
  /* 切换作品前保存当前编辑文档；保存失败留在原作品，避免刷新或切换丢失修改。 */
  const current = version;
  return editor.save().then(() => {
    if (current !== version) return;
    selectedId.value = id; editing.value = false; panel.value = false; overview.value = false; tools.value = false; picked.value = false; placingText.value = false; editingText.value = false;
    return editor.load(id).then(() => { if (current === version && selectedId.value === id && editor.content) { editing.value = true; boardSizes.value[id] = { width: editor.content.width, height: editor.content.height }; if (focus) fit(); scheduleScene(); } });
  }).catch((reason: Error) => { error.value = reason.message; });
}
function crop() {
  if (!editor.content || editor.loading) return;
  cropping.value = true; drawing.value = false; tools.value = false; picked.value = false; panel.value = false; hand.value = false; fit();
}
function openTool(operation: ImageToolInput['operation']) {
  if (!editor.content || toolSubmitting.value || activeTool.value) return;
  tools.value = false; textMenu.value = false; picked.value = false; drawing.value = false; hand.value = false; panel.value = false; error.value = ''; fit();
  if (operation === 'edit' || operation === 'erase' || operation === 'replace-text') maskMode.value = operation;
  else if (operation === 'upscale' || operation === 'expand') {
    toolSettings.value = operation;
  } else submitTool({ operation });
}
function submitTool(parameters: { operation: ImageToolInput['operation']; mask?: Blob; prompt?: string; text?: string; scale?: 2 | 4; width?: number; height?: number; x?: number; y?: number }) {
  if (!selected.value || !editor.content || toolSubmitting.value) return;
  const current = version; const resultId = selectedId.value; toolSubmitting.value = true; error.value = '';
  /* 处理当前编辑画面；上传原图和遮罩后只提交一次，切换会话丢弃迟到响应。 */
  painting.then(() => { if (renderError) throw new Error(renderError); return canvas!.export(); }).then(blob => {
    const form = new FormData(); form.append('file', blob, 'tool-source.png'); form.append('name', '处理原图');
    return request<ProductAsset>('/assets', { method: 'POST', body: form });
  }).then<{ source: ProductAsset; mask: ProductAsset | null }>(source => {
    if (!parameters.mask) return { source, mask: null };
    const form = new FormData(); form.append('file', parameters.mask, 'tool-mask.png'); form.append('name', '处理选区');
    return request<ProductAsset>('/assets', { method: 'POST', body: form }).then(mask => ({ source, mask }));
  }).then(({ source, mask }) => {
    if (current !== version) return;
    const values = { ...parameters }; delete values.mask; const input = { ...values, sourceAssetId: source.id, ...(['edit', 'erase', 'replace-text'].includes(parameters.operation) ? { maskAssetId: mask?.id ?? null } : {}) };
    return request<ImageToolTask>('/image-tools/tasks', { method: 'POST', body: JSON.stringify({ sessionId: props.sessionId, resultId, input }) });
  }).then(task => {
    if (!task || current !== version) return;
    maskMode.value = null; toolSettings.value = null; toolTasks.value.unshift(task); subscribeTool(task, current); fit();
  }).catch((reason: Error) => { if (current === version) error.value = reason.message; }).finally(() => { toolSubmitting.value = false; });
}
function applyMask(mask: Blob, prompt: string) {
  if (maskMode.value === 'replace-text') submitTool({ operation: maskMode.value, mask, text: prompt });
  else if (maskMode.value === 'erase') submitTool({ operation: maskMode.value, mask });
  else submitTool({ operation: 'edit', mask, prompt });
}
function changeTool(task: ImageToolTask, operation: 'cancel' | 'retry') {
  request<ImageToolTask>(`/image-tools/tasks/${task.id}/${operation}`, { method: 'POST' }).then(update => {
    if (operation === 'retry') { toolTasks.value.unshift(update); subscribeTool(update, version); }
    else { const index = toolTasks.value.findIndex(item => item.id === update.id); if (index >= 0) toolTasks.value[index] = update; }
  }).catch((reason: Error) => { error.value = reason.message; });
}
function subscribeTool(_task: ImageToolTask | null, current: number) {
  if (streams.has('image-tools')) return;
  /* 同一会话只占一条工具进度连接，为保存、读取和图片请求留出浏览器连接。 */
  const stream = new EventSource(`/api/image-tools/tasks/session/${props.sessionId}/events`); streams.set('image-tools', stream);
  stream.addEventListener('task', (event: MessageEvent<string>) => {
    if (current !== version) return;
    const update = JSON.parse(event.data) as ImageToolTask; const index = toolTasks.value.findIndex(item => item.id === update.id);
    if (index < 0) { toolTasks.value.unshift(update); if (update.status === 'succeeded') readResults(current).catch((reason: Error) => { if (current === version) error.value = reason.message; }); return; }
    const previous = toolTasks.value[index]; toolTasks.value[index] = update;
    if (update.status === 'succeeded' && previous.status !== 'succeeded') readResults(current).catch((reason: Error) => { if (current === version) error.value = reason.message; });
  });
  stream.onerror = () => { if (current === version) error.value = '图片处理状态连接中断，正在重连…'; };
}
function addShape(shape: EditorShapeLayer['shape'], rect: { x: number; y: number; width: number; height: number }) {
  const content = editor.content; if (!content || content.layers.length >= 50) return;
  const id = crypto.randomUUID();
  content.layers.push({ id, type: 'shape', name: shapeNames[shape], shape, ...rect, rotation: 0, opacity: 1, visible: true, locked: false, fill: ['line', 'arrow'].includes(shape) ? 'transparent' : '#3b82f6', stroke: '#202020', strokeWidth: ['line', 'arrow'].includes(shape) ? 8 : 0 });
  drawingShape.value = null; shapeMenu.value = false; hand.value = false; drawing.value = false; editor.selected = id; panel.value = true; editor.commit();
}
function draw(points: number[]) {
  const content = editor.content; if (!content || content.layers.length >= 50) return;
  const xs = points.filter((_, index) => index % 2 === 0); const ys = points.filter((_, index) => index % 2 === 1); const x = Math.min(...xs); const y = Math.min(...ys); const id = crypto.randomUUID();
  content.layers.push({ id, type: 'path', name: '画笔', x, y, width: Math.max(1, Math.max(...xs) - x), height: Math.max(1, Math.max(...ys) - y), rotation: 0, opacity: 1, visible: true, locked: false, points: points.map((value, index) => value - (index % 2 ? y : x)), stroke: brushColor.value, strokeWidth: brushSize.value });
  editor.selected = id; editor.commit();
}
function uploadImage(event: Event) {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; input.value = '';
  if (!file || importing.value || !editor.content) return;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024) { error.value = '请上传 20MB 内的 PNG、JPEG 或 WebP 图片。'; return; }
  importing.value = true; error.value = ''; const current = version; const documentId = editor.document?.id;
  const form = new FormData(); form.append('file', file); form.append('name', file.name);
  /* 上传结束再检查当前文档；切换会话不会将迟到的素材插入其他作品。 */
  request<ProductAsset>('/assets', { method: 'POST', body: form }).then(asset => {
    const content = editor.content; if (current !== version || editor.document?.id !== documentId || !content || content.layers.length >= 50) return;
    insertAsset(asset);
  }).catch((reason: Error) => { error.value = reason.message; }).finally(() => { importing.value = false; });
}
function insertAsset(asset: ProductAsset) {
  const content = editor.content; if (!content || content.layers.length >= 50) return;
  const id = crypto.randomUUID(); const scale = Math.min(content.width * .6 / asset.width, content.height * .6 / asset.height, 1); const width = asset.width * scale; const height = asset.height * scale;
  content.layers.push({ id, type: 'asset-image', name: asset.name, assetId: asset.id, x: (content.width - width) / 2, y: (content.height - height) / 2, width, height, rotation: 0, opacity: 1, visible: true, locked: false }); editor.selected = id; panel.value = true; libraryOpen.value = false; editor.commit();
}
function applyTemplate(value: 'clean' | 'banner' | 'features' | 'specification') {
  const content = editor.content; if (!content) return;
  if (content.layers.length > 47) { error.value = '最多使用 50 个图层，请先删除不需要的图层。'; return; }
  const fill = { clean: '#eef3f9', banner: '#f9ede1', features: '#eaf4ef', specification: '#f1edf8' }[value]; const top = ['clean', 'banner'].includes(value) ? 0 : content.height * .72;
  const fontSize = Math.min(72, Math.max(16, Math.round(content.width * .06))); const titleId = crypto.randomUUID();
  content.layers.push({ id: crypto.randomUUID(), type: 'shape', name: '版式底色', shape: 'rectangle', x: 0, y: top, width: content.width, height: content.height * .28, rotation: 0, opacity: .96, visible: true, locked: false, fill, stroke: 'transparent', strokeWidth: 0 },
    { id: titleId, type: 'text', name: '商品标题', text: value === 'specification' ? '规格信息' : value === 'features' ? '商品卖点' : '商品名称', x: content.width * .08, y: top + content.height * .04, width: content.width * .84, height: fontSize * 1.5, fontSize, fontFamily: 'Microsoft YaHei', fontStyle: 'bold', fill: '#202020', align: 'left', rotation: 0, opacity: 1, visible: true, locked: false },
    { id: crypto.randomUUID(), type: 'text', name: '商品说明', text: '双击填写真实商品信息', x: content.width * .08, y: top + content.height * .16, width: content.width * .84, height: fontSize, fontSize: Math.max(12, Math.round(fontSize * .55)), fontFamily: 'Microsoft YaHei', fill: '#525967', align: 'left', rotation: 0, opacity: 1, visible: true, locked: false });
  libraryOpen.value = false; editor.selected = titleId; panel.value = false; editor.commit();
}
function applyCrop(rect: { x: number; y: number; width: number; height: number }) {
  const content = editor.content; if (!content) return;
  /* 确认裁剪时一次提交尺寸和图层位置；取消保持文档原样，撤销能恢复完整画幅。 */
  for (const layer of content.layers) { layer.x -= rect.x; layer.y -= rect.y; }
  content.width = rect.width; content.height = rect.height; editor.commit(); cropping.value = false; picked.value = true; fit();
}
function edit(add = false) {
  if (!selected.value || editor.loading) return;
  hand.value = false; panel.value = true;
  const current = version; const resultId = selectedId.value;
  const ready = editing.value ? Promise.resolve() : editor.load(resultId);
  return ready.then(() => { if (current !== version || resultId !== selectedId.value || !editor.content) return; editing.value = true; if (add) addText(); }).catch((reason: Error) => { error.value = reason.message; });
}
function addText(point?: { x: number; y: number }) {
  if (!editor.content || editor.content.layers.length >= 50) return;
  const content = editor.content; const id = crypto.randomUUID();
  const fontSize = Math.min(72, Math.round(content.width * .06));
  content.layers.push({ id, type: 'text', name: '新文字', x: point?.x ?? content.width * .1, y: point?.y ?? content.height * .1, width: Math.min(content.width * .6, content.width - (point?.x ?? content.width * .1)), height: fontSize * 3, rotation: 0, opacity: 1, visible: true, locked: false, text: '输入商品文案', fontSize, fontFamily: 'Microsoft YaHei', fill: '#202020', align: 'left' });
  editor.selected = id; editor.commit(); placingText.value = false; editingText.value = true; picked.value = true; panel.value = false;
}
function placeText(event: PointerEvent) {
  const content = editor.content; const bounds = container.value?.getBoundingClientRect(); if (!content || !bounds) return;
  addText({ x: Math.max(0, Math.min(content.width - 1, (event.clientX - bounds.left) / bounds.width * content.width)), y: Math.max(0, Math.min(content.height - 1, (event.clientY - bounds.top) / bounds.height * content.height)) });
}
function updateText() {
  const layer = editor.layer; if (layer?.type !== 'text') return;
  /* 延长文案时随换行增高文字框，保留用户设置的宽度，避免新文字被固定高度截断。 */
  const context = document.createElement('canvas').getContext('2d')!; context.font = `${layer.fontStyle ?? 'normal'} ${layer.fontSize}px "${layer.fontFamily}"`;
  const lines = layer.text.split('\n').reduce((count, text) => count + Math.max(1, Math.ceil((context.measureText(text).width + Math.max(0, layer.letterSpacing ?? 0) * text.length) / layer.width)), 0);
  layer.height = Math.min(16384, Math.max(layer.height, Math.ceil((lines + 1) * layer.fontSize * (layer.lineHeight ?? 1)))); editor.commit();
}
function addImage() {
  const result = results.value.find(item => item.id === imageId.value); const content = editor.content;
  if (!result || !content || content.layers.length >= 50) return;
  const id = crypto.randomUUID(); const width = content.width * .5;
  content.layers.push({ id, type: 'image', name: result.name, resultId: result.id, x: content.width * .25, y: content.height * .25, width, height: result.height / result.width * width, rotation: 0, opacity: 1, visible: true, locked: false }); editor.selected = id; editor.commit();
}
function removeLayer() {
  if (!editor.content || !editor.layer || editor.layer.locked) return;
  editor.content.layers = editor.content.layers.filter(layer => layer.id !== editor.selected); editor.selected = null; editor.commit();
}
function duplicate() {
  if (!editor.content || !editor.layer || editor.layer.locked || editor.content.layers.length >= 50) return;
  const layer = { ...editor.layer, id: crypto.randomUUID(), name: `${editor.layer.name} 副本`, x: editor.layer.x + 20, y: editor.layer.y + 20 };
  editor.content.layers.push(layer); editor.selected = layer.id; editor.commit();
}
function download() {
  if (!canvas || exporting.value || !selected.value) return;
  exporting.value = true; error.value = '';
  painting.then(() => canvas!.export()).then(blob => {
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `${selected.value!.name.replace(/\.(png|jpe?g)$/i, '')}${editing.value ? '_编辑' : ''}.png`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }).catch((reason: Error) => { error.value = reason.message; }).finally(() => { exporting.value = false; });
}
function reference(modifying = false) {
  const result = selected.value; if (!result || referencing.value) return;
  const current = version; referencing.value = true; error.value = '';
  /* 将选中结果通过已有素材接口加入下一轮；复用 sourceAssetId，不增加隐含的图片关联字段。 */
  const image = editing.value ? painting.then(() => canvas!.export()) : fetch(`/api/product-image/results/${result.id}/file`).then(response => { if (!response.ok) throw new Error('当前作品无法读取。'); return response.blob(); });
  image.then(blob => {
    if (current !== version) return;
    const form = new FormData(); form.append('file', blob, result.name); form.append('name', result.name);
    return request<ProductAsset>('/assets', { method: 'POST', body: form });
  }).then(asset => { if (current === version && asset) emit('reference', asset, modifying); }).catch((reason: Error) => { if (current === version) error.value = reason.message; }).finally(() => { referencing.value = false; });
}
function keyboard(event: KeyboardEvent) {
  if (event.key === 'Escape') libraryOpen.value = false;
  if (event.key === 'Escape') drawingShape.value = null;
  if (event.key === 'Escape' && !toolSubmitting.value) { placingText.value = false; editingText.value = false; toolHistory.value = false; maskMode.value = null; toolSettings.value = null; cropping.value = false; drawing.value = false; tools.value = false; textMenu.value = false; shapeMenu.value = false; picked.value = false; overview.value = false; help.value = false; panel.value = false; return; }
  const target = event.target as HTMLElement; if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) return;
  if (cropping.value || maskMode.value || toolSettings.value || toolSubmitting.value) return;
  else if (event.key.toLowerCase() === 'v') { hand.value = false; drawing.value = false; placingText.value = false; drawingShape.value = null; }
  else if (event.key.toLowerCase() === 't' && selected.value) { placingText.value = true; hand.value = false; drawing.value = false; }
  else if (event.code === 'Space') { event.preventDefault(); if (spaceHand === null) spaceHand = hand.value; hand.value = true; }
  else if (event.key.toLowerCase() === 'h') { hand.value = true; drawing.value = false; placingText.value = false; drawingShape.value = null; }
  else if (event.key === '0') fit();
  else if (event.key === '+' || event.key === '=') setZoom(zoom.value * 1.25);
  else if (event.key === '-') setZoom(zoom.value / 1.25);
  else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && editing.value) { event.preventDefault(); if (event.shiftKey) editor.redo(); else editor.undo(); }
  else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && editing.value) { event.preventDefault(); editor.save().catch(() => {}); }
  else if ((event.key === 'Delete' || event.key === 'Backspace') && editing.value) { event.preventDefault(); removeLayer(); }
  else if (event.key === 'ArrowLeft' && selectedIndex.value > 0) select(results.value[selectedIndex.value - 1].id);
  else if (event.key === 'ArrowRight' && selectedIndex.value < results.value.length - 1) select(results.value[selectedIndex.value + 1].id);
}
function releaseSpace(event: KeyboardEvent) { if (event.code === 'Space' && spaceHand !== null) { hand.value = spaceHand; spaceHand = null; } }
function wheel(event: WheelEvent) {
  if (!selected.value || cropping.value || maskMode.value || toolSettings.value) return;
  if (event.ctrlKey || event.metaKey) { event.preventDefault(); const bounds = area.value!.getBoundingClientRect(); setZoom(zoom.value * (event.deltaY > 0 ? .9 : 1.1), { x: event.clientX - bounds.left, y: event.clientY - bounds.top }); }
  else { event.preventDefault(); offset.value = { x: offset.value.x - event.deltaX, y: offset.value.y - event.deltaY }; }
}
function setZoom(value: number, point = { x: (area.value?.clientWidth ?? 0) / 2, y: (area.value?.clientHeight ?? 0) / 2 }) {
  const next = Math.max(.03, Math.min(3, value)); const ratio = next / zoom.value; offset.value = { x: point.x - (point.x - offset.value.x) * ratio, y: point.y - (point.y - offset.value.y) * ratio }; zoom.value = next;
}
function beforeUnload(event: BeforeUnloadEvent) { if (editor.dirty || sceneChanges !== savedSceneChanges) { event.preventDefault(); event.returnValue = ''; } }
function pan(event: PointerEvent) {
  if (!hand.value || !selected.value || event.button !== 0) return;
  start = { x: event.clientX, y: event.clientY, offsetX: offset.value.x, offsetY: offset.value.y }; dragging.value = true;
  area.value?.setPointerCapture(event.pointerId); event.preventDefault();
}
function startBoard(event: PointerEvent, id: string) {
  if (hand.value || specialMode.value || event.button !== 0) return;
  const target = boards.value.find(item => item.resultId === id); if (!target) return;
  boardDrag = { id, x: target.x, y: target.y, clientX: event.clientX, clientY: event.clientY }; area.value?.setPointerCapture(event.pointerId); event.preventDefault(); event.stopPropagation();
}
function move(event: PointerEvent) {
  if (start) offset.value = { x: start.offsetX + event.clientX - start.x, y: start.offsetY + event.clientY - start.y };
  if (boardDrag) { const target = boards.value.find(item => item.resultId === boardDrag!.id); if (target) { target.x = Math.max(-1_000_000, Math.min(1_000_000, boardDrag.x + (event.clientX - boardDrag.clientX) / zoom.value)); target.y = Math.max(-1_000_000, Math.min(1_000_000, boardDrag.y + (event.clientY - boardDrag.clientY) / zoom.value)); } }
}
function release() { start = null; boardDrag = null; dragging.value = false; scheduleScene(); }
function subscribe(execution: AgentExecution, current: number) {
  streams.get(execution.id)?.close(); streams.delete(execution.id);
  if (!['queued', 'running'].includes(execution.status)) return;
  const stream = new EventSource(`/api/agent/executions/${execution.id}/events`); streams.set(execution.id, stream);
  stream.addEventListener('execution', (event: MessageEvent<string>) => {
    if (current !== version) return;
    const update = JSON.parse(event.data) as AgentExecution;
    const index = executions.value.findIndex(item => item.id === update.id); if (index === -1) return;
    const previous = executions.value[index]; executions.value[index] = update;
    if (JSON.stringify(previous.steps.map(step => [step.taskId, step.status])) !== JSON.stringify(update.steps.map(step => [step.taskId, step.status])) || !['queued', 'running'].includes(update.status)) readResults(current).catch((reason: Error) => { if (current === version) error.value = reason.message; });
    if (!['queued', 'running'].includes(update.status)) { stream.close(); streams.delete(update.id); }
  });
  stream.onerror = () => { if (current === version) error.value = '画板实时连接中断，正在重连…'; };
  stream.onopen = () => { if (current === version) error.value = ''; };
}
function addExecution(execution: AgentExecution) {
  const index = executions.value.findIndex(item => item.id === execution.id);
  if (index === -1) executions.value.unshift(execution); else executions.value[index] = execution;
  subscribe(execution, version); readResults(version).catch((reason: Error) => { error.value = reason.message; });
}
defineExpose({ addExecution, select });
function readResults(current: number) {
  const revision = ++resultVersion;
  /* 只读取本会话执行步骤实际引用的结果，套图过滤旧重试图片；切换会话后丢弃未完成请求。 */
  return Promise.all([...executions.value.flatMap(execution => execution.steps.filter(step => step.taskId).map(step => step.tool === 'product-image'
    ? request<ProductImageResult[]>(`/product-image/tasks/${step.taskId}/results`)
    : Promise.all([request<CommerceTask>(`/commerce/tasks/${step.taskId}`), request<ProductImageResult[]>(`/commerce/tasks/${step.taskId}/results`)]).then(([task, saved]) => saved.filter(result => task.items.some(item => item.resultId === result.id))))), Promise.all(toolTasks.value.filter(task => task.status === 'succeeded').flatMap(task => task.outputResultIds.slice(0, 1).map(id => request<ProductImageResult>(`/product-image/results/${id}`))))])
    .then(values => {
      if (current !== version || revision !== resultVersion) return;
      const existing = new Set(results.value.map(result => result.id));
      results.value = [...new Map(values.flat().map(result => [result.id, result])).values()];
      boards.value = boards.value.filter(item => results.value.some(result => result.id === item.resultId));
      for (const result of results.value) if (!boards.value.some(item => item.resultId === result.id)) { const right = Math.max(0, ...boards.value.map(item => item.x + (boardSizes.value[item.resultId]?.width ?? results.value.find(value => value.id === item.resultId)!.width) + 160)); boards.value.push({ resultId: result.id, x: right, y: 0 }); }
      const added = results.value.filter(result => !existing.has(result.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (!existing.size && selectedId.value && results.value.some(result => result.id === selectedId.value)) { const id = selectedId.value; selectedId.value = ''; select(id, false); }
      else if (added && (!selected.value || added.createdAt > selected.value.createdAt)) select(added.id);
      else if (!results.value.some(result => result.id === selectedId.value)) {
        if (results.value[0]) select(results.value[0].id);
        else { selectedId.value = ''; editing.value = false; panel.value = false; }
      }
    });
}
function load() {
  const current = ++version; ++resultVersion; for (const stream of streams.values()) stream.close(); streams.clear();
  sceneSession = props.sessionId; sceneReady.value = false; if (sceneTimer) clearTimeout(sceneTimer); sceneTimer = null; sceneChanges = 0; savedSceneChanges = 0; sceneError.value = ''; boards.value = []; boardSizes.value = {}; placingText.value = false; editingText.value = false; drawingShape.value = null;
  executions.value = []; toolTasks.value = []; maskMode.value = null; toolSettings.value = null; results.value = []; selectedId.value = ''; editing.value = false; panel.value = false; cropping.value = false; drawing.value = false; tools.value = false; shapeMenu.value = false; picked.value = false; error.value = ''; loading.value = true;
  return Promise.all([Promise.all(props.taskIds.map(id => request<AgentExecution[]>(`/agent/tasks/${id}/executions`))), request<ImageToolTask[]>(`/image-tools/tasks?sessionId=${props.sessionId}`), request<CreationScene>(`/editor/scenes/${props.sessionId}`)])
    .then(([values, tasks, scene]) => {
      if (current !== version) return;
      boards.value = scene.boards; offset.value = { x: scene.viewport.x, y: scene.viewport.y }; zoom.value = scene.viewport.zoom; selectedId.value = scene.selectedId ?? ''; sceneRevision = scene.revision; sceneReady.value = true;
      executions.value = values.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      toolTasks.value = tasks; subscribeTool(null, current);
      for (const execution of executions.value) subscribe(execution, current);
      return readResults(current);
    }).catch((reason: Error) => { if (current === version) error.value = reason.message; })
    .finally(() => { if (current === version) loading.value = false; });
}
watch(() => props.sessionId, () => editor.save().then(saveScene).then(load).catch((reason: Error) => { error.value = reason.message; }), { immediate: true });
watch(() => props.taskIds, () => { const current = version; if (!sceneReady.value) return; Promise.all(props.taskIds.map(id => request<AgentExecution[]>(`/agent/tasks/${id}/executions`))).then(values => { if (current !== version) return; executions.value = values.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt)); for (const execution of executions.value) subscribe(execution, current); return readResults(current); }).catch((reason: Error) => { error.value = reason.message; }); });
watch([executions, results, selectedId, loading], () => emit('update', { executions: executions.value, results: results.value, selectedId: selectedId.value, loading: loading.value }), { deep: true, immediate: true });
watch([selected, zoom, editing, hand, cropping, drawing, drawingShape, placingText, maskMode, toolSettings, () => editor.content], () => nextTick(paint), { deep: true });
onMounted(() => window.addEventListener('keyup', releaseSpace));
onUnmounted(() => window.removeEventListener('keyup', releaseSpace));
watch(() => editor.selected, id => { if (editing.value) canvas?.select(id); });
watch(() => editor.selected, id => { picked.value = !!id; });
watch([boards, offset, zoom], scheduleScene, { deep: true });
onMounted(() => { canvas = new ProductCanvas(container.value!, id => { if (editing.value && !hand.value && !cropping.value) { editor.selected = id; picked.value = !!id; tools.value = false; } }, (id, values) => editor.updateLayer(id, values)); observer = new ResizeObserver(paint); observer.observe(area.value!); paint(); window.addEventListener('keydown', keyboard); window.addEventListener('beforeunload', beforeUnload); });
onBeforeRouteLeave(() => editor.save().then(saveScene).then(() => true).catch(() => false));
onBeforeRouteUpdate(() => editor.save().then(saveScene).then(() => true).catch(() => false));
onUnmounted(() => { saveScene().catch(() => {}); ++version; if (sceneTimer) clearTimeout(sceneTimer); for (const stream of streams.values()) stream.close(); observer?.disconnect(); canvas?.destroy(); editor.close(); window.removeEventListener('keydown', keyboard); window.removeEventListener('beforeunload', beforeUnload); });
</script>

<template>
  <section class="agent-canvas" aria-label="作品画板">
    <header><div><h2>作品画板</h2><span>{{ editing ? saveStatus : results.length ? `${results.length} 张作品 · 已自动保存到项目` : '生成作品会展示在这里' }}</span></div><button type="button" :disabled="loading || editor.dirty || editor.saving || cropping || !!maskMode || toolSubmitting || !!toolSettings" aria-label="刷新作品" title="刷新作品" @click="load"><RefreshCw :size="15" /></button><button v-if="selected" class="button" :disabled="exporting || editor.loading || cropping || !!maskMode || toolSubmitting || !!toolSettings" @click="download"><Download :size="14" /> {{ exporting ? '导出中…' : '下载 PNG' }}</button></header>
    <p v-if="error" class="canvas-notice" role="alert">{{ error }}</p>
    <p v-if="sceneError" class="canvas-notice" role="alert">{{ sceneError }}<button type="button" @click="saveScene().catch(() => {})">重试保存布局</button></p>
    <div class="canvas-body">
    <div ref="area" class="canvas-area" :class="{ hand, dragging }" tabindex="0" aria-label="画板操作区域" @click.self="picked = false; tools = false; editor.selected = null" @wheel="wheel" @pointerdown="pan" @pointermove="move" @pointerup="release" @pointercancel="release" @lostpointercapture="release">
      <p v-if="placingText || drawingShape" class="placement-hint">{{ placingText ? '点击作品放置文字' : `在作品上拖动绘制${shapeNames[drawingShape!]}` }} · Esc 取消</p>
      <CanvasLibrary v-if="libraryOpen && !specialMode" :results="results" @close="libraryOpen = false" @template="applyTemplate" @asset="insertAsset" @result="imageId = $event; addImage(); libraryOpen = false" @shape="drawingShape = $event; libraryOpen = false; drawing = false; placingText = false; hand = false; picked = false; panel = false" />
      <template v-if="!specialMode"><div v-for="item in boards.filter(item => item.resultId !== selectedId)" :key="item.resultId" class="canvas-board" :style="{ transform: `translate(${offset.x + item.x * zoom}px, ${offset.y + item.y * zoom}px)` }" @click="select(item.resultId, false)"><button type="button" class="board-title" :aria-label="`移动画板 ${results.find(result => result.id === item.resultId)?.name}`" @pointerdown="startBoard($event, item.resultId)">{{ results.find(result => result.id === item.resultId)?.name }}</button><CanvasBoardPreview :result-id="item.resultId" :zoom="zoom" @size="boardSizes[item.resultId] = $event" /></div></template>
      <div v-show="selected" class="canvas-content" :style="specialMode ? { left: '50%', top: '50%', transform: `translate(${-((toolSettings === 'expand' ? expandBox.x + expandBox.width / 2 : (editor.content?.width ?? 0) / 2) * canvasScale)}px, ${-((toolSettings === 'expand' ? expandBox.y + expandBox.height / 2 : (editor.content?.height ?? 0) / 2) * canvasScale) - (maskMode ? 80 : 45)}px)` } : { left: '0', top: '0', transform: `translate(${offset.x + (board?.x ?? 0) * zoom}px, ${offset.y + (board?.y ?? 0) * zoom}px)` }">
        <button v-if="selected && !specialMode" type="button" class="board-title" :aria-label="`移动画板 ${selected.name}`" @pointerdown="startBoard($event, selected.id)">{{ editing && editor.content ? editor.content.name : selected.name }} · {{ editing && editor.content ? editor.content.width : selected.width }} × {{ editing && editor.content ? editor.content.height : selected.height }}</button>
        <div v-if="picked && !hand && !cropping && !drawing && !maskMode && !toolSettings" class="selected-actions" role="toolbar" aria-label="当前作品操作" @pointerdown.stop>
          <template v-if="editor.layer?.type === 'image' || editor.layer?.type === 'asset-image'">
            <button type="button" :disabled="toolSubmitting || !!activeTool" @click="openTool('split-layers')"><Layers3 :size="14" /> 拆分图层</button>
            <div class="tool-menu"><button type="button" :aria-expanded="textMenu" :disabled="toolSubmitting || !!activeTool" @click="textMenu = !textMenu; tools = false"><Type :size="14" /> 编辑文字</button><div v-if="textMenu" role="menu"><button type="button" role="menuitem" @click="openTool('recognize-text')">直接编辑</button><button type="button" role="menuitem" @click="openTool('replace-text')">无痕改字</button><button type="button" role="menuitem" @click="textMenu = false; edit(true)">添加文字</button></div></div>
            <button type="button" :disabled="toolSubmitting || !!activeTool" @click="openTool('edit')"><Sparkles :size="14" /> AI 改图</button><button type="button" :disabled="toolSubmitting || !!activeTool" @click="openTool('upscale')">AI 超清</button>
            <div class="tool-menu"><button type="button" :aria-expanded="tools" :disabled="toolSubmitting || !!activeTool" @click="tools = !tools; textMenu = false"><Crop :size="14" /> 工具</button><div v-if="tools" role="menu"><button type="button" role="menuitem" @click="crop">调整尺寸</button><button type="button" role="menuitem" @click="openTool('erase')">AI 无痕消除</button><button type="button" role="menuitem" @click="openTool('cutout')">抠图</button><button type="button" role="menuitem" @click="openTool('expand')">AI 扩图</button><button type="button" role="menuitem" :disabled="referencing" @click="tools = false; reference(false)">引用图片</button></div></div>
          </template>
          <CanvasTextTools v-else-if="editor.layer?.type === 'text'" @edit="editingText = true" />
          <template v-else><button type="button" :disabled="!editor.layer || editor.layer.locked" @click="duplicate"><Copy :size="14" /> 复制</button><button type="button" :disabled="!editor.layer || editor.layer.locked" @click="removeLayer"><Trash2 :size="14" /> 删除</button></template>
          <button type="button" :aria-pressed="panel" aria-label="编辑属性" title="编辑属性" @click="panel ? panel = false : edit()"><SlidersHorizontal :size="15" /></button>
        </div>
        <div ref="container" role="img" :aria-label="selected?.name" @dblclick="editingText = editor.layer?.type === 'text'" />
        <div v-if="placingText" class="text-placement" aria-label="点击画板添加文字" @pointerdown.stop="placeText" />
        <CanvasShapeDraw v-if="drawingShape && editor.content" :shape="drawingShape" :width="editor.content.width" :height="editor.content.height" @draw="addShape(drawingShape!, $event)" />
        <div v-if="editingText && editor.layer?.type === 'text'" class="text-entry" @pointerdown.stop><textarea v-model="editor.layer.text" aria-label="编辑文字内容" rows="2" maxlength="2000" :disabled="editor.layer.locked" @input="updateText" /><button type="button" @click="editingText = false">完成</button></div>
        <CanvasCrop v-if="cropping && editor.content" :width="editor.content.width" :height="editor.content.height" @cancel="cropping = false; picked = true; fit()" @apply="applyCrop" />
        <CanvasDraw v-if="drawing && editor.content" :width="editor.content.width" :height="editor.content.height" :stroke="brushColor" :size="brushSize" @draw="draw" />
        <CanvasMask v-if="maskMode && editor.content" :width="editor.content.width" :height="editor.content.height" :mode="maskMode" :busy="toolSubmitting" @cancel="maskMode = null; picked = true; fit()" @apply="applyMask" />
        <CanvasCrop v-if="toolSettings === 'expand' && editor.content" :width="editor.content.width" :height="editor.content.height" expanding :busy="toolSubmitting" @resize="expandBox = $event; paint()" @cancel="toolSettings = null; picked = true; fit()" @apply="submitTool({ operation: 'expand', width: $event.width, height: $event.height, x: -$event.x, y: -$event.y, prompt: '' })" />
      </div>
      <div v-if="overview" class="canvas-overview" aria-label="全部作品"><header><strong>全部作品 · {{ results.length }} 张</strong><button type="button" aria-label="关闭作品总览" @click="overview = false"><X :size="14" /></button></header><div><button v-for="result in results" :key="result.id" type="button" :aria-label="`选择作品 ${result.name}`" @click="select(result.id)"><img :src="`/api/product-image/results/${result.id}/file`" :alt="result.name" /><span>{{ result.name }}</span></button></div></div>
      <div v-if="!selected" class="canvas-empty"><Image :size="38" :stroke-width="1" /><h3>{{ loading ? '正在读取作品…' : activeExecution ? '正在制作你的作品' : '从一个想法，开始创作' }}</h3><p v-if="activeExecution">生成与检查完成后，作品会出现在这里。<br />可以在左侧查看进度或停止当前任务。</p><p v-else>在左侧描述需求，确认方案后开始生成。<br />作品会进入画板，支持继续创作、编辑和下载。</p></div>
    </div>
    <aside v-if="panel && selected" class="canvas-panel" aria-label="画板图层与属性">
      <header><h3>图层与属性</h3><button type="button" aria-label="关闭图层面板" @click="panel = false"><X :size="15" /></button></header><p v-if="editor.loading">正在读取…</p>
      <template v-if="editor.content && editing">
        <ul><li v-for="layer in [...editor.content.layers].reverse()" :key="layer.id" :class="{ selected: editor.selected === layer.id }"><button type="button" class="layer-name" @click="editor.selected = layer.id">{{ { image: '图片', 'asset-image': '素材', text: '文字', shape: '形状', path: '画笔' }[layer.type] }} · {{ layer.name }}</button><button type="button" :aria-label="`${layer.visible ? '隐藏' : '显示'} ${layer.name}`" @click="layer.visible = !layer.visible; editor.commit()"><component :is="layer.visible ? Eye : EyeOff" :size="13" /></button><button type="button" :aria-label="`${layer.locked ? '解锁' : '锁定'} ${layer.name}`" @click="layer.locked = !layer.locked; editor.commit()"><component :is="layer.locked ? Lock : Unlock" :size="13" /></button></li></ul>
        <div class="layer-controls"><button type="button" :disabled="!editor.layer || editor.layer.locked || editor.content.layers.length >= 50" @click="duplicate"><Copy :size="13" /> 复制</button><button type="button" :disabled="!editor.layer || editor.layer.locked" @click="removeLayer"><Trash2 :size="13" /> 删除</button></div>
        <label class="image-picker">添加会话作品<select v-model="imageId" aria-label="添加会话作品"><option value="">选择图片</option><option v-for="result in results" :key="result.id" :value="result.id">{{ result.name }}</option></select><button type="button" :disabled="!imageId || editor.content.layers.length >= 50" @click="addImage"><Plus :size="13" /> 添加图片图层</button></label><CanvasProperties />
      </template><p v-if="editor.error" class="canvas-notice" role="alert">{{ editor.error }}<button type="button" @click="editor.save().catch(() => {})">重试保存</button></p>
    </aside>
    </div>
    <div v-if="activeExecution" class="canvas-progress"><span>{{ labels[activeExecution.status] }} · {{ activeExecution.progress }}% · 进度与停止操作在左侧对话</span></div>
<section v-if="toolSettings === 'upscale'" class="tool-settings" aria-label="AI 超清"><strong>AI 超清</strong><label>清晰度<select v-model.number="upscale" :disabled="toolSubmitting"><option :value="2">2 倍</option><option :value="4">4 倍</option></select></label><p>增强细节，处理结果作为新作品保存。</p><div><button type="button" :disabled="toolSubmitting" @click="toolSettings = null; picked = true">取消</button><button type="button" :disabled="toolSubmitting" @click="submitTool({ operation: 'upscale', scale: upscale })">{{ toolSubmitting ? '正在提交…' : '开始超清' }}</button></div></section>
    <div v-if="toolTasks.length && !maskMode && !cropping && !toolSettings" class="tool-status" :class="{ expanded: toolHistory }" aria-label="图片处理记录"><header><span>图片处理</span><button type="button" :aria-expanded="toolHistory" @click="toolHistory = !toolHistory">{{ toolHistory ? '收起记录' : `全部记录 · ${toolTasks.length}` }}</button></header><article v-for="task in shownTools" :key="task.id"><span>{{ toolNames[task.input.operation] }} · {{ { queued: '等待处理', running: '处理中', succeeded: '已完成', failed: '处理失败', cancelled: '已停止' }[task.status] }}{{ ['queued', 'running'].includes(task.status) ? ` ${task.progress}%` : '' }}</span><p v-if="task.error" role="alert">{{ task.error }}</p><button v-if="['queued', 'running'].includes(task.status)" type="button" @click="changeTool(task, 'cancel')">停止</button><button v-if="['failed', 'cancelled'].includes(task.status)" type="button" @click="changeTool(task, 'retry')">重试</button><button v-if="task.status === 'succeeded'" type="button" @click="select(task.outputResultIds[0]); toolHistory = false">查看结果</button></article></div>
    <div v-if="!cropping && !maskMode && !toolSettings && !toolSubmitting" class="canvas-toolbar" role="toolbar" aria-label="画板工具">
      <button type="button" :class="{ selected: !hand && !drawing }" :aria-pressed="!hand && !drawing" aria-label="选择工具" title="选择工具 V" @click="hand = false; drawing = false"><MousePointer2 :size="17" /></button><button type="button" :class="{ selected: hand }" :aria-pressed="hand" aria-label="抓手平移" title="抓手 H" @click="hand = true; drawing = false"><Hand :size="17" /></button><i />
      <button type="button" :disabled="!selected || editor.loading" :aria-pressed="placingText" aria-label="添加文字" title="添加文字 T，点击画板放置" @click="placingText = !placingText; drawing = false; hand = false; picked = false; panel = false"><Type :size="17" /></button><button type="button" :disabled="!selected || editor.loading" :aria-pressed="drawing" aria-label="画笔" title="画笔" @click="drawing = !drawing; placingText = false; hand = false; picked = false; panel = false"><Brush :size="17" /></button>
      <div class="shape-menu"><button type="button" :disabled="!selected || editor.loading" :aria-expanded="shapeMenu" aria-label="形状" title="形状，选择后拖动绘制" @click="shapeMenu = !shapeMenu"><Shapes :size="17" /></button><div v-if="shapeMenu"><button v-for="(name, shape) in shapeNames" :key="shape" type="button" @click="drawingShape = shape; shapeMenu = false; placingText = false; drawing = false; hand = false; picked = false; panel = false">{{ name }}</button></div></div>
      <button type="button" :disabled="!selected || editor.loading" :aria-expanded="libraryOpen" aria-label="创作素材库" title="模板、素材与图片" @click="libraryOpen = !libraryOpen; picked = false; placingText = false; drawingShape = null; drawing = false"><Image :size="17" /></button>
      <label class="image-upload" :class="{ disabled: !selected || importing || editor.loading }" title="导入图片"><Upload :size="17" /><input type="file" accept="image/png,image/jpeg,image/webp" aria-label="导入图片图层" :disabled="!selected || importing || editor.loading" @change="uploadImage" /></label><button type="button" :disabled="!selected || editor.loading" aria-label="图层与属性" title="图层与属性" @click="drawing = false; edit()"><Layers3 :size="17" /></button><i />
      <button type="button" :disabled="!editing || !editor.canUndo" aria-label="撤销" title="撤销 Ctrl+Z" @click="editor.undo"><Undo2 :size="17" /></button><button type="button" :disabled="!editing || !editor.canRedo" aria-label="重做" title="重做 Ctrl+Shift+Z" @click="editor.redo"><Redo2 :size="17" /></button><button type="button" :aria-expanded="help" aria-label="操作帮助" title="操作帮助" @click="help = !help"><HelpCircle :size="16" /></button>
      <div v-if="drawing" class="brush-controls"><label>颜色<input v-model="brushColor" type="color" aria-label="画笔颜色" /></label><label>大小<input v-model.number="brushSize" type="range" min="1" max="100" aria-label="画笔大小" />{{ brushSize }}</label></div>
    </div>
    <p v-if="help" class="canvas-help">V 选择 · H 抓手 · 滚轮平移 · Ctrl + 滚轮缩放 · 0 适应窗口<br />左右方向键切换作品；文字和图片可拖动、缩放、旋转。修改自动保存，下载包含当前编辑内容。</p>
    <footer><div class="canvas-results"><button v-for="result in results" :key="result.id" type="button" :class="{ selected: result.id === selectedId }" :aria-pressed="result.id === selectedId" :aria-label="`查看 ${result.name}`" @click="select(result.id)"><img :src="`/api/product-image/results/${result.id}/file`" :alt="result.name" /></button></div><div class="canvas-navigation"><button type="button" :disabled="selectedIndex <= 0" aria-label="上一张作品" @click="select(results[selectedIndex - 1].id)"><ChevronLeft :size="14" /></button><span>{{ selectedIndex + 1 }} / {{ results.length }}</span><button type="button" :disabled="selectedIndex < 0 || selectedIndex >= results.length - 1" aria-label="下一张作品" @click="select(results[selectedIndex + 1].id)"><ChevronRight :size="14" /></button><button type="button" :disabled="!results.length" :aria-pressed="overview" aria-label="全部作品" title="全部作品" @click="overview = !overview"><Grid2X2 :size="15" /></button></div><div class="canvas-zoom"><button type="button" :disabled="!selected || zoom <= .03" aria-label="缩小画板" @click="setZoom(zoom / 1.25)"><Minus :size="15" /></button><label><input :value="Math.round(zoom * 100)" type="number" min="3" max="300" aria-label="画板缩放百分比" :disabled="!selected" @change="setZoom(Number(($event.target as HTMLInputElement).value) / 100 || 1)" />%</label><button type="button" :disabled="!selected || zoom >= 3" aria-label="放大画板" @click="setZoom(zoom * 1.25)"><Plus :size="15" /></button><button type="button" :disabled="!selected" aria-label="适应画板" title="适应画板 0" @click="fit()"><Expand :size="15" /></button><button type="button" :disabled="!selected" aria-label="查看全部画板" title="查看全部画板" @click="fit(true)"><Grid2X2 :size="15" /></button></div></footer>
  </section>
</template>

<style scoped lang="scss">
.agent-canvas { position: relative; min-width: 0; display: flex; flex-direction: column; overflow: hidden; background: #f0f2f5; > header { display: flex; align-items: center; gap: 10px; padding: 14px 18px; background: var(--surface); border-bottom: 1px solid var(--border); } header > div { flex: 1; min-width: 0; } h2 { font-size: 13px; font-weight: 600; } header span { font-size: 11px; color: var(--muted); } button { display: inline-flex; align-items: center; justify-content: center; border: 0; background: transparent; padding: 7px; border-radius: 6px; } .button { padding: 8px 10px; font-size: 11px; background: var(--text); color: white; } .button.secondary { background: var(--surface); color: var(--text); } > footer { display: flex; align-items: center; gap: 12px; padding: 10px 14px; min-height: 62px; background: var(--surface); border-top: 1px solid var(--border); } }
.canvas-area { flex: 1; min-width: 0; min-height: 0; display: grid; place-items: center; overflow: clip; position: relative; background-image: radial-gradient(#d8dce3 1px, transparent 1px); background-size: 18px 18px; &.hand { cursor: grab; touch-action: none; } &.dragging { cursor: grabbing; } }
.canvas-content, .canvas-board { position: absolute; left: 0; top: 0; background: repeating-conic-gradient(#e6e9ef 0% 25%, #ffffff 0% 50%) 0 / 16px 16px; box-shadow: 0 4px 24px rgb(0 0 0 / 8%); outline: 1px solid #8b9cbb; }
.canvas-board { cursor: pointer; }
.placement-hint { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); z-index: 4; padding: 7px 10px; border-radius: 6px; background: var(--surface); font-size: 11px; color: var(--muted); pointer-events: none; white-space: nowrap; }
.board-title { position: absolute; top: -29px; left: 0; max-width: 100%; font-size: 10px; color: var(--muted); cursor: move; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.canvas-body { display: flex; flex: 1; min-height: 0; }
.canvas-toolbar { position: relative; align-self: center; display: flex; align-items: center; justify-content: center; gap: 6px; background: var(--surface); padding: 6px; margin: 8px; border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); button.selected, button[aria-pressed='true'] { background: var(--page); } i { height: 18px; width: 1px; background: var(--border); margin: 0 4px; } }
.shape-menu { position: relative; > div { position: absolute; bottom: calc(100% + 10px); left: 0; z-index: 4; display: grid; grid-template-columns: 1fr 1fr; min-width: 160px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 6px; box-shadow: var(--shadow); } }
.image-upload { position: relative; display: flex; padding: 7px; border-radius: 6px; overflow: hidden; cursor: pointer; input { position: absolute; inset: 0; opacity: 0; width: 100%; cursor: pointer; } &.disabled { opacity: .4; cursor: default; } }
.brush-controls { position: absolute; bottom: calc(100% + 10px); left: 50%; transform: translateX(-50%); display: flex; gap: 12px; align-items: center; padding: 8px 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 9px; box-shadow: var(--shadow); font-size: 11px; label { display: flex; align-items: center; gap: 6px; white-space: nowrap; } input[type='color'] { width: 24px; height: 24px; padding: 1px; border: 0; } input[type='range'] { width: 80px; } }
.canvas-panel { flex: 0 0 230px; overflow-y: auto; padding: 12px; background: var(--surface); border-left: 1px solid var(--border); font-size: 11px; header { display: flex; align-items: center; justify-content: space-between; } h3 { font-size: 12px; } ul { list-style: none; padding: 0; margin: 12px 0; display: grid; gap: 6px; } li { display: flex; align-items: center; gap: 2px; border: 1px solid var(--border); border-radius: 6px; padding: 3px; } li.selected { border-color: var(--text-secondary); background: var(--page); } .layer-name { flex: 1; min-width: 0; text-align: left; justify-content: start; overflow-wrap: anywhere; font-size: 11px; } }
.layer-controls { display: flex; gap: 8px; border-bottom: 1px solid var(--border); padding-bottom: 8px; button { font-size: 11px; gap: 5px; } }
.image-picker { display: grid; gap: 6px; margin-top: 12px; color: var(--muted); select { width: 100%; padding: 6px; border: 1px solid var(--border); border-radius: 5px; font: inherit; background: var(--surface); } button { justify-content: start; gap: 5px; font-size: 11px; } }
.canvas-navigation { display: flex; align-items: center; gap: 2px; font-size: 10px; color: var(--muted); }
.canvas-overview { position: absolute; inset: 12px; z-index: 2; overflow-y: auto; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 16px; box-shadow: var(--shadow); cursor: default; header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; font-size: 12px; } > div { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 12px; } button { display: grid; gap: 6px; font-size: 11px; } img { width: 100%; height: 120px; object-fit: contain; background: var(--page); } }
.canvas-help { padding: 10px 16px; background: var(--surface); font-size: 11px; line-height: 1.8; color: var(--muted); }
.canvas-empty { margin: auto; text-align: center; color: var(--muted); h3 { color: var(--text-secondary); font-size: 15px; margin: 16px 0 10px; font-weight: 500; } p { font-size: 12px; line-height: 2; } }
.canvas-results { display: flex; flex: 1; min-width: 0; gap: 8px; overflow-x: auto; button { flex-shrink: 0; padding: 2px; border: 1px solid transparent; } button.selected { border-color: var(--text); } img { display: block; width: 38px; height: 38px; object-fit: cover; border-radius: 3px; } }
.canvas-zoom { display: flex; align-items: center; gap: 2px; flex-shrink: 0; label { display: flex; align-items: center; font-size: 10px; color: var(--muted); } input { width: 38px; border: 0; background: transparent; text-align: right; font: inherit; appearance: textfield; } input::-webkit-inner-spin-button { appearance: none; } }
.canvas-progress { display: flex; flex-wrap: wrap; gap: 12px; padding: 8px 16px; background: var(--surface); font-size: 11px; color: var(--muted); a { text-decoration: underline; margin-left: 4px; } }
.canvas-notice { background: var(--surface); padding: 10px 16px; font-size: 12px; color: var(--error); }
.selected-actions { position: absolute; bottom: calc(100% + 10px); left: 50%; transform: translateX(-50%); z-index: 4; display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 4px; width: max-content; max-width: min(580px, 58vw); padding: 5px 8px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; box-shadow: var(--shadow); white-space: nowrap; button { gap: 5px; color: var(--text-secondary); font-size: 11px; } }
.text-placement { position: absolute; inset: 0; z-index: 2; cursor: text; touch-action: none; }
.text-entry { position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%); z-index: 5; width: min(320px, 100%); display: flex; gap: 6px; padding: 8px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); box-shadow: var(--shadow); textarea { min-width: 0; flex: 1; padding: 5px; border: 1px solid var(--border); font: inherit; resize: vertical; } }
.tool-menu { position: relative; > div { position: absolute; top: calc(100% + 8px); right: 0; display: grid; min-width: 115px; padding: 5px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; box-shadow: var(--shadow); } }
.tool-settings { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 6; display: grid; gap: 10px; width: 300px; padding: 18px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); font-size: 12px; label { display: grid; gap: 5px; } input, select, textarea { width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 6px; font: inherit; } > div { display: flex; justify-content: end; gap: 8px; } }
.tool-status { padding: 6px 16px; background: var(--surface); font-size: 11px; border-top: 1px solid var(--border); header { display: flex; justify-content: space-between; align-items: center; } article { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 3px 0; } p { flex: 1; color: var(--error); } button { padding: 3px 7px; text-decoration: underline; } &.expanded { position: absolute; bottom: 124px; left: 12px; right: 12px; z-index: 7; max-height: 50%; overflow: auto; border: 1px solid var(--border); border-radius: 10px; box-shadow: var(--shadow); } }
@media (max-width: 1100px) { .agent-canvas header { padding: 12px; gap: 6px; } .agent-canvas header span { display: none; } .canvas-zoom > span:first-child { display: none; } }
</style>
