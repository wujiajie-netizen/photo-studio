<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { Brush, Eraser, Undo2, Redo2, RotateCcw } from '@lucide/vue';
const props = defineProps<{ width: number; height: number; mode: 'edit' | 'erase' | 'replace-text'; busy: boolean }>();
const emit = defineEmits<{ cancel: []; apply: [mask: Blob, prompt: string] }>();
const surface = ref<HTMLCanvasElement | null>(null); const size = ref(30); const erase = ref(false); const prompt = ref('');
const error = ref('');
type Stroke = { points: number[]; size: number; erase: boolean };
const strokes = ref<Stroke[]>([]); const position = ref(0); let active: Stroke | null = null;
const title = computed(() => props.mode === 'edit' ? 'AI 改图' : props.mode === 'erase' ? '无痕消除' : '无痕改字');
function render(context: CanvasRenderingContext2D, mask = false) {
  context.clearRect(0, 0, props.width, props.height);
  if (mask) { context.fillStyle = '#000000'; context.fillRect(0, 0, props.width, props.height); }
  for (const stroke of [...strokes.value.slice(0, position.value), ...(active ? [active] : [])]) {
    context.globalCompositeOperation = !mask && stroke.erase ? 'destination-out' : 'source-over';
    context.strokeStyle = mask ? stroke.erase ? '#000000' : '#ffffff' : '#ec4899'; context.fillStyle = context.strokeStyle;
    context.lineWidth = stroke.size; context.lineCap = 'round'; context.lineJoin = 'round';
    context.beginPath(); context.moveTo(stroke.points[0], stroke.points[1]);
    for (let index = 2; index < stroke.points.length; index += 2) context.lineTo(stroke.points[index], stroke.points[index + 1]);
    if (stroke.points.length === 2) { context.arc(stroke.points[0], stroke.points[1], stroke.size / 2, 0, Math.PI * 2); context.fill(); } else context.stroke();
  }
  context.globalCompositeOperation = 'source-over';
}
function paint() { if (surface.value) render(surface.value.getContext('2d')!); }
function point(event: PointerEvent) {
  const bounds = surface.value!.getBoundingClientRect();
  return [Math.round(Math.max(0, Math.min(props.width, (event.clientX - bounds.left) / bounds.width * props.width))), Math.round(Math.max(0, Math.min(props.height, (event.clientY - bounds.top) / bounds.height * props.height)))];
}
function down(event: PointerEvent) { if (event.button !== 0 || props.busy) return; error.value = ''; active = { points: point(event), size: size.value, erase: erase.value }; surface.value!.setPointerCapture(event.pointerId); event.preventDefault(); paint(); }
function move(event: PointerEvent) { if (active && active.points.length < 20000) { active.points.push(...point(event)); paint(); } }
function finish() { if (!active) return; strokes.value = [...strokes.value.slice(0, position.value), active]; position.value = strokes.value.length; active = null; paint(); }
function apply() {
  if (props.busy) return;
  const mask = document.createElement('canvas'); mask.width = props.width; mask.height = props.height;
  const context = mask.getContext('2d')!; render(context, true);
  const pixels = context.getImageData(0, 0, props.width, props.height).data;
  if (!pixels.some((value, index) => index % 4 === 0 && value > 0)) { error.value = '当前没有选区，请先涂抹需要处理的区域。'; return; }
  mask.toBlob(blob => { if (blob) emit('apply', blob, prompt.value.trim()); }, 'image/png');
}
watch(position, () => { error.value = ''; paint(); }); onMounted(paint);
</script>
<template>
  <div class="canvas-mask">
    <canvas ref="surface" :width="width" :height="height" aria-label="涂抹处理区域" @pointerdown="down" @pointermove="move" @pointerup="finish" @pointercancel="active = null; paint()" />
    <section class="mask-controls" :aria-label="title">
      <div class="mask-brush"><strong>{{ title }}</strong><button type="button" :aria-pressed="!erase" aria-label="涂抹画笔" :disabled="busy" @click="erase = false"><Brush :size="16" /></button><button type="button" :aria-pressed="erase" aria-label="擦除选区" :disabled="busy" @click="erase = true"><Eraser :size="16" /></button><label>大小<input v-model.number="size" type="range" min="5" max="200" aria-label="选区笔刷大小" :disabled="busy" />{{ size }}</label><button type="button" aria-label="撤销选区" :disabled="busy || position === 0" @click="position--"><Undo2 :size="15" /></button><button type="button" aria-label="重做选区" :disabled="busy || position >= strokes.length" @click="position++"><Redo2 :size="15" /></button><button type="button" aria-label="重置选区" :disabled="busy || position === 0" @click="strokes = []; position = 0; paint()"><RotateCcw :size="15" /></button></div>
      <p>涂抹需要{{ mode === 'erase' ? '消除' : mode === 'replace-text' ? '替换文字' : '修改' }}的区域，粉色区域以外保持原样。</p>
      <p v-if="error" role="alert">{{ error }}</p>
      <textarea v-if="mode !== 'erase'" v-model="prompt" rows="2" maxlength="1000" :aria-label="mode === 'replace-text' ? '替换文字' : '改图要求'" :placeholder="mode === 'replace-text' ? '输入替换后的文字' : '描述希望怎样修改所选区域'" :disabled="busy" />
      <div class="mask-actions"><button type="button" :disabled="busy" @click="emit('cancel')">取消</button><button type="button" class="primary" :disabled="busy || position === 0 || mode !== 'erase' && !prompt.trim()" @click="apply">{{ busy ? '正在提交…' : mode === 'erase' ? '消除' : mode === 'replace-text' ? '改字' : '改图' }}</button></div>
    </section>
  </div>
</template>
<style scoped lang="scss">
.canvas-mask { position: absolute; inset: 0; z-index: 5; > canvas { width: 100%; height: 100%; opacity: .45; touch-action: none; cursor: crosshair; } }
.mask-controls { position: absolute; top: calc(100% + 12px); left: 50%; transform: translateX(-50%); width: 470px; max-width: calc(100vw - 430px); padding: 10px 12px; border: 1px solid var(--border); background: var(--surface); border-radius: 12px; box-shadow: var(--shadow); font-size: 11px; p { color: var(--muted); margin: 6px 0; } button { border: 0; background: transparent; padding: 6px 8px; border-radius: 6px; } textarea { width: 100%; resize: none; padding: 8px; border: 1px solid var(--border); border-radius: 6px; font: inherit; } }
.mask-brush { display: flex; align-items: center; gap: 6px; label { display: flex; align-items: center; gap: 5px; } input { width: 75px; } button[aria-pressed='true'] { background: var(--page); } }
.mask-actions { display: flex; justify-content: end; gap: 8px; margin-top: 7px; .primary { background: var(--text); color: white; padding-inline: 15px; } }
</style>
