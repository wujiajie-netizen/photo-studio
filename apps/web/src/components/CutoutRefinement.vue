<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { Brush, Eraser, Undo2, Redo2, RotateCcw, X } from '@lucide/vue';

const props = defineProps<{ sourceUrl: string; imageUrl: string; busy: boolean; failure: string }>();
const emit = defineEmits<{ close: []; apply: [image: Blob] }>();
const surface = ref<HTMLCanvasElement | null>(null); const loading = ref(true); const error = ref('');
const dialog = ref<HTMLElement | null>(null);
const size = ref(30); const restore = ref(true); const original = ref(false); const position = ref(0);
const focused = ref(false); const canFocus = ref(false);
type Stroke = { points: number[]; size: number; restore: boolean };
const strokes = ref<Stroke[]>([]); let active: Stroke | null = null; let closed = false;
let image: ImageData; let source: ImageData; const ink = document.createElement('canvas');
let rendered: ImageData; let bounds = { x: 0, y: 0, width: 1, height: 1 };

function paint() {
  if (!surface.value || loading.value) return;
  const context = ink.getContext('2d')!; context.clearRect(0, 0, ink.width, ink.height);
  for (const stroke of [...strokes.value.slice(0, position.value), ...(active ? [active] : [])]) {
    context.strokeStyle = stroke.restore ? '#ffffff' : '#000000'; context.fillStyle = context.strokeStyle;
    context.lineWidth = stroke.size; context.lineCap = 'round'; context.lineJoin = 'round';
    context.beginPath(); context.moveTo(stroke.points[0], stroke.points[1]);
    for (let index = 2; index < stroke.points.length; index += 2) context.lineTo(stroke.points[index], stroke.points[index + 1]);
    if (stroke.points.length === 2) { context.arc(stroke.points[0], stroke.points[1], stroke.size / 2, 0, Math.PI * 2); context.fill(); } else context.stroke();
  }
  const view = focused.value ? bounds : { x: 0, y: 0, width: ink.width, height: ink.height };
  surface.value.width = view.width; surface.value.height = view.height;
  surface.value.style.width = `min(100%, ${560 * view.width / view.height}px, ${58 * view.width / view.height}vh)`;
  if (original.value) { surface.value.getContext('2d')!.putImageData(source, -view.x, -view.y); return; }
  const mask = context.getImageData(0, 0, ink.width, ink.height).data;
  const output = new ImageData(new Uint8ClampedArray(image.data), ink.width, ink.height);
  /* 擦除只减小透明度；恢复采用原素材颜色及 Alpha，未涂抹区域保持当前状态。 */
  for (let index = 0; index < mask.length; index += 4) if (mask[index + 3]) {
    const strength = mask[index + 3] / 255;
    output.data[index + 3] = Math.round(image.data[index + 3] * (1 - strength) + source.data[index + 3] * mask[index] / 255 * strength);
    if (mask[index]) for (let channel = 0; channel < 3; channel++) output.data[index + channel] = source.data[index + channel];
  }
  rendered = output; surface.value.getContext('2d')!.putImageData(output, -view.x, -view.y);
}
function point(event: PointerEvent) {
  const rectangle = surface.value!.getBoundingClientRect(); const view = focused.value ? bounds : { x: 0, y: 0 };
  return [Math.max(0, Math.min(ink.width, (event.clientX - rectangle.left) / rectangle.width * surface.value!.width + view.x)), Math.max(0, Math.min(ink.height, (event.clientY - rectangle.top) / rectangle.height * surface.value!.height + view.y))];
}
function down(event: PointerEvent) {
  if (event.button !== 0 || loading.value || props.busy || original.value || error.value) return;
  active = { points: point(event), size: size.value, restore: restore.value }; surface.value!.setPointerCapture(event.pointerId); event.preventDefault(); paint();
}
function move(event: PointerEvent) { if (active && active.points.length < 20000) { active.points.push(...point(event)); paint(); } }
function finish() { if (!active) return; strokes.value = [...strokes.value.slice(0, position.value), active]; position.value = strokes.value.length; active = null; paint(); }
function keyboard(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault(); if (props.busy) return;
    position.value = Math.max(0, Math.min(strokes.value.length, position.value + (event.shiftKey ? 1 : -1))); paint();
  }
  if (event.key !== 'Tab' || !dialog.value) return;
  const controls = Array.from(dialog.value.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'));
  const first = controls[0]; const last = controls[controls.length - 1];
  if (!first) { event.preventDefault(); return; }
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.value)) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
function apply() {
  if (!surface.value || props.busy || loading.value || !position.value || error.value) return;
  original.value = false; paint();
  const output = document.createElement('canvas'); output.width = ink.width; output.height = ink.height; output.getContext('2d')!.putImageData(rendered, 0, 0);
  output.toBlob(blob => { if (blob) emit('apply', blob); else error.value = '图片导出失败，请重试。'; }, 'image/png');
}
function load(url: string): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const value = new Image();
    value.onload = () => {
      const canvas = document.createElement('canvas'); canvas.width = value.naturalWidth; canvas.height = value.naturalHeight;
      const context = canvas.getContext('2d')!; context.drawImage(value, 0, 0); resolve(context.getImageData(0, 0, canvas.width, canvas.height));
    };
    value.onerror = () => reject(new Error('图片读取失败，请关闭后重试。')); value.src = url;
  });
}
onMounted(() => {
  dialog.value?.focus();
  /* 同时读取当前透明图和原素材；关闭弹窗后不再写入过期页面状态。 */
  Promise.all([load(props.imageUrl), load(props.sourceUrl)]).then(([current, raw]) => {
    if (closed) return;
    if (current.width !== raw.width || current.height !== raw.height) throw new Error('原素材与抠图尺寸不一致，无法修整。');
    image = current; source = raw; ink.width = current.width; ink.height = current.height;
    /* 小前景默认聚焦其可见轮廓，避免在整张大图上用几个屏幕像素修整；导出仍保持原画幅。 */
    let left = current.width; let top = current.height; let right = -1; let bottom = -1;
    for (let index = 3; index < current.data.length; index += 4) if (current.data[index] > 8) {
      const pixel = (index - 3) / 4; const x = pixel % current.width; const y = Math.floor(pixel / current.width);
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
    const padding = Math.max(20, Math.round(Math.min(current.width, current.height) * .04));
    if (right >= 0) { left = Math.max(0, left - padding); top = Math.max(0, top - padding); bounds = { x: left, y: top, width: Math.min(current.width, right + padding + 1) - left, height: Math.min(current.height, bottom + padding + 1) - top }; }
    canFocus.value = right >= 0 && bounds.width < current.width * .7 && bounds.height < current.height * .7; focused.value = canFocus.value;
    size.value = Math.max(10, Math.min(120, Math.round(current.width * .04))); loading.value = false; paint();
  }).catch((failure: Error) => { if (!closed) error.value = failure.message; });
});
onUnmounted(() => { closed = true; });
</script>

<template>
  <div class="cutout-refinement" @keydown.stop="keyboard" @keydown.esc="!busy && emit('close')">
    <section ref="dialog" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="cutout-refinement-title">
      <header><div><h2 id="cutout-refinement-title">修整抠图</h2><p>恢复漏掉的主体，或擦除多余区域。完成后保存到当前图层。</p></div><button type="button" aria-label="关闭抠图修整" :disabled="busy" @click="emit('close')"><X :size="18" /></button></header>
      <div class="refinement-preview"><canvas ref="surface" aria-label="修整透明区域" :class="{ comparing: original }" @pointerdown="down" @pointermove="move" @pointerup="finish" @pointercancel="active = null; paint()" /><span v-if="loading && !error">正在读取图片…</span></div>
      <p v-if="error || failure" role="alert">{{ error || failure }}</p>
      <div class="refinement-tools" role="toolbar" aria-label="抠图修整工具">
        <button type="button" :aria-pressed="restore" :disabled="loading || busy" @click="restore = true; original = false; paint()"><Brush :size="15" />恢复主体</button>
        <button type="button" :aria-pressed="!restore" :disabled="loading || busy" @click="restore = false; original = false; paint()"><Eraser :size="15" />擦除多余</button>
        <label>笔刷大小<input v-model.number="size" type="range" min="5" max="200" aria-label="修整笔刷大小" :disabled="loading || busy" />{{ size }}</label>
        <button type="button" aria-label="撤销抠图修整" :disabled="busy || position === 0" @click="position--; paint()"><Undo2 :size="16" /></button>
        <button type="button" aria-label="重做抠图修整" :disabled="busy || position >= strokes.length" @click="position++; paint()"><Redo2 :size="16" /></button>
        <button type="button" aria-label="重置抠图修整" :disabled="busy || position === 0" @click="strokes = []; position = 0; paint()"><RotateCcw :size="16" /></button>
        <button type="button" :aria-pressed="original" :disabled="loading || busy" @click="original = !original; paint()">{{ original ? '查看修整' : '对比原图' }}</button>
        <button v-if="canFocus" type="button" :aria-pressed="focused" :disabled="loading || busy" @click="focused = !focused; paint()">{{ focused ? '查看整图' : '聚焦主体' }}</button>
      </div>
      <footer><span>{{ original ? '正在对比原图，切回修整后可继续涂抹。' : restore ? '涂抹需要恢复的部分。' : '涂抹需要去除的部分。' }}</span><button type="button" :disabled="busy" @click="emit('close')">取消</button><button type="button" class="primary" :disabled="loading || busy || position === 0 || !!error" @click="apply">{{ busy ? '正在保存…' : '完成修整' }}</button></footer>
    </section>
  </div>
</template>

<style scoped lang="scss">
.cutout-refinement { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; padding: 20px; background: #20202b66; section { display: flex; flex-direction: column; width: min(920px, 100%); max-height: calc(100vh - 40px); padding: 18px; border-radius: 16px; background: var(--surface); box-shadow: var(--shadow); } header { display: flex; align-items: start; justify-content: space-between; gap: 20px; } h2 { margin: 0; font-size: 17px; } p { margin: 6px 0 12px; color: var(--muted); font-size: 12px; } button { display: inline-flex; align-items: center; justify-content: center; gap: 5px; padding: 8px 10px; border: 0; border-radius: 7px; background: var(--page); font: inherit; font-size: 12px; } button:disabled { opacity: .4; } button[aria-pressed='true'] { background: var(--accent-soft); color: var(--accent); } footer { display: flex; align-items: center; justify-content: end; gap: 8px; margin-top: 12px; } footer span { margin-right: auto; color: var(--muted); font-size: 12px; } .primary { background: var(--text); color: var(--surface); } }
.refinement-preview { position: relative; min-height: 100px; flex: 1; overflow: auto; display: grid; place-items: center; background-color: #fff; background-image: linear-gradient(45deg, #ececf1 25%, transparent 25%), linear-gradient(-45deg, #ececf1 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ececf1 75%), linear-gradient(-45deg, transparent 75%, #ececf1 75%); background-size: 20px 20px; background-position: 0 0, 0 10px, 10px -10px, -10px 0; canvas { display: block; max-width: 100%; max-height: min(58vh, 560px); width: auto; height: auto; cursor: crosshair; touch-action: none; } canvas.comparing { cursor: default; } span { position: absolute; font-size: 13px; color: var(--muted); } }
.refinement-tools { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; padding-top: 12px; label { display: flex; align-items: center; gap: 6px; margin-inline: 5px; font-size: 12px; } input { width: 90px; } }
</style>
