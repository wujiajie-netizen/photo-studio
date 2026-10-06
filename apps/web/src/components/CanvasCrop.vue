<script setup lang="ts">
import { computed, ref, watch } from 'vue';
const props = defineProps<{ width: number; height: number; expanding?: boolean; busy?: boolean }>();
const emit = defineEmits<{ cancel: []; apply: [rect: { x: number; y: number; width: number; height: number }]; resize: [rect: { x: number; y: number; width: number; height: number }] }>();
const box = ref(props.expanding ? { x: -Math.round(props.width * .1), y: -Math.round(props.height * .1), width: props.width + 2 * Math.round(props.width * .1), height: props.height + 2 * Math.round(props.height * .1) } : { x: 0, y: 0, width: props.width, height: props.height });
const ratio = ref(''); const root = ref<SVGSVGElement | null>(null);
const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const outline = computed(() => ({ left: `${box.value.x / props.width * 100}%`, top: `${box.value.y / props.height * 100}%`, width: `${box.value.width / props.width * 100}%`, height: `${box.value.height / props.height * 100}%` }));
let start: { x: number; y: number; mode: string; box: typeof box.value; scaleX: number; scaleY: number } | null = null;
watch(box, rect => { if (props.expanding) emit('resize', rect); }, { immediate: true });
function proportion() {
  if (!ratio.value) return;
  const value = ratio.value === 'original' ? props.width / props.height : Number(ratio.value);
  const width = Math.round(props.expanding ? Math.max(box.value.width, box.value.height * value, props.width, props.height * value) : Math.min(box.value.width, box.value.height * value)); const height = Math.round(width / value);
  box.value = { x: Math.round(box.value.x + (box.value.width - width) / 2), y: Math.round(box.value.y + (box.value.height - height) / 2), width, height };
}
function dimensions(axis: 'width' | 'height', event: Event) {
  const value = Math.round(Number((event.target as HTMLInputElement).value)); if (!Number.isFinite(value)) return;
  const current = box.value;
  const factor = ratio.value === 'original' ? props.width / props.height : Number(ratio.value);
  const width = axis === 'width' ? value : factor ? value * factor : current.width;
  const height = axis === 'height' ? value : factor ? value / factor : current.height;
  if (props.expanding) { const wide = Math.max(props.width, Math.min(16384, Math.round(width))); const tall = Math.max(props.height, Math.min(16384, Math.round(height))); box.value = { x: Math.min(0, Math.max(props.width - wide, current.x)), y: Math.min(0, Math.max(props.height - tall, current.y)), width: wide, height: tall }; }
  else box.value = { ...current, width: Math.max(1, Math.min(props.width - current.x, Math.round(width))), height: Math.max(1, Math.min(props.height - current.y, Math.round(height))) };
  proportion();
}
function down(event: PointerEvent, mode: string) {
  if (event.button !== 0 || props.busy || !root.value) return;
  const bounds = root.value.getBoundingClientRect();
  start = { x: event.clientX, y: event.clientY, mode, box: { ...box.value }, scaleX: props.width / bounds.width, scaleY: props.height / bounds.height }; root.value.setPointerCapture(event.pointerId); event.preventDefault();
}
function move(event: PointerEvent) {
  if (!start || !root.value) return;
  /* 裁剪框使用原图坐标，拖动时只更新草案；确认才交给现有编辑文档保存。 */
  const dx = (event.clientX - start.x) * start.scaleX; const dy = (event.clientY - start.y) * start.scaleY;
  const original = start.box; const mode = start.mode;
  if (props.expanding) {
    /* 外扩边框始终包含原图；固定开始拖动时的比例，预览自适应缩放不改变本次坐标增量。 */
    let left = original.x; let top = original.y; let right = left + original.width; let bottom = top + original.height;
    if (mode === 'move') { left = Math.max(props.width - original.width, Math.min(0, left + dx)); top = Math.max(props.height - original.height, Math.min(0, top + dy)); right = left + original.width; bottom = top + original.height; }
    else { if (mode.includes('w')) left = Math.min(0, Math.max(right - 16384, left + dx)); if (mode.includes('e')) right = Math.max(props.width, Math.min(left + 16384, right + dx)); if (mode.includes('n')) top = Math.min(0, Math.max(bottom - 16384, top + dy)); if (mode.includes('s')) bottom = Math.max(props.height, Math.min(top + 16384, bottom + dy)); }
    box.value = { x: Math.round(left), y: Math.round(top), width: Math.round(right - left), height: Math.round(bottom - top) }; proportion(); return;
  }
  if (mode === 'move') { box.value = { ...original, x: Math.round(Math.max(0, Math.min(props.width - original.width, original.x + dx))), y: Math.round(Math.max(0, Math.min(props.height - original.height, original.y + dy))) }; return; }
  let left = original.x; let top = original.y; let right = left + original.width; let bottom = top + original.height;
  if (mode.includes('w')) left = Math.max(0, Math.min(right - 8, left + dx));
  if (mode.includes('e')) right = Math.min(props.width, Math.max(left + 8, right + dx));
  if (mode.includes('n')) top = Math.max(0, Math.min(bottom - 8, top + dy));
  if (mode.includes('s')) bottom = Math.min(props.height, Math.max(top + 8, bottom + dy));
  const factor = ratio.value === 'original' ? props.width / props.height : Number(ratio.value);
  if (factor) {
    const width = Math.min(right - left, (bottom - top) * factor); const height = width / factor;
    if (mode.includes('w')) left = right - width; else right = left + width;
    if (mode.includes('n')) top = bottom - height; else bottom = top + height;
  }
  box.value = { x: Math.round(left), y: Math.round(top), width: Math.max(8, Math.round(right - left)), height: Math.max(8, Math.round(bottom - top)) };
}
</script>

<template>
  <div class="canvas-crop" :class="{ expanding }" :aria-label="expanding ? '扩图操作' : '裁剪操作'">
    <svg ref="root" :viewBox="`0 0 ${width} ${height}`" preserveAspectRatio="none" @pointermove="move" @pointerup="start = null" @pointercancel="start = null" @lostpointercapture="start = null">
      <defs><mask id="crop-window"><rect :width="width" :height="height" fill="white" /><rect v-bind="box" fill="black" /></mask></defs>
      <defs v-if="expanding"><pattern id="expand-checks" :width="width / 20" :height="width / 20" patternUnits="userSpaceOnUse"><rect :width="width / 20" :height="width / 20" fill="#ffffff" /><path :d="`M 0 0 h ${width / 40} v ${width / 40} h ${-width / 40} Z M ${width / 40} ${width / 40} h ${width / 40} v ${width / 40} h ${-width / 40} Z`" fill="#e6e9ef" /></pattern><mask id="expand-window"><rect v-bind="box" fill="white" /><rect :width="width" :height="height" fill="black" /></mask></defs>
      <rect v-if="expanding" v-bind="box" fill="url(#expand-checks)" mask="url(#expand-window)" /><rect v-else :width="width" :height="height" fill="#000000" fill-opacity=".45" mask="url(#crop-window)" />
      <rect v-bind="box" fill="transparent" stroke="#3b82f6" :stroke-width="width / 400" @pointerdown="down($event, 'move')" />
      <path :d="`M ${box.x + box.width / 3} ${box.y} v ${box.height} M ${box.x + box.width * 2 / 3} ${box.y} v ${box.height} M ${box.x} ${box.y + box.height / 3} h ${box.width} M ${box.x} ${box.y + box.height * 2 / 3} h ${box.width}`" stroke="white" stroke-opacity=".55" :stroke-width="width / 700" pointer-events="none" />
    </svg>
    <div class="crop-handles" :style="outline"><button v-for="handle in handles" :key="handle" type="button" :class="handle" :disabled="busy" :aria-label="`${expanding ? '扩图' : '裁剪'}边框 ${handle}`" @pointerdown="down($event, handle)" /></div>
    <div class="crop-controls" :style="expanding ? { top: `${(box.y + box.height) / height * 100}%`, marginTop: '12px' } : {}" role="toolbar" :aria-label="expanding ? '扩图控制' : '裁剪控制'" @pointerdown.stop>
      <strong>{{ expanding ? '扩图' : '裁剪' }}</strong><select v-model="ratio" :aria-label="expanding ? '扩图比例' : '裁剪比例'" :disabled="busy" @change="proportion"><option value="">自由</option><option value="original">原比例</option><option value="1">1:1</option><option :value="2 / 3">2:3</option><option :value="3 / 2">3:2</option><option :value="3 / 4">3:4</option><option :value="4 / 3">4:3</option><option :value="9 / 16">9:16</option><option :value="16 / 9">16:9</option></select>
      <label>W<input :value="box.width" type="number" :min="expanding ? width : 1" :max="expanding ? 16384 : width" :aria-label="expanding ? '扩图宽度' : '裁剪宽度'" :disabled="busy" @change="dimensions('width', $event)" /></label><label>H<input :value="box.height" type="number" :min="expanding ? height : 1" :max="expanding ? 16384 : height" :aria-label="expanding ? '扩图高度' : '裁剪高度'" :disabled="busy" @change="dimensions('height', $event)" /></label><button type="button" :disabled="busy" @click="emit('cancel')">取消</button><button type="button" class="apply" :disabled="busy || box.width * box.height > 16000000" @click="emit('apply', box)">{{ busy ? '提交中…' : expanding ? '扩图' : '裁剪' }}</button><span v-if="box.width * box.height > 16000000">最多 1600 万像素</span>
    </div>
  </div>
</template>

<style scoped lang="scss">
.canvas-crop { position: absolute; inset: 0; z-index: 3; touch-action: none; svg { display: block; width: 100%; height: 100%; } }
.expanding svg { overflow: visible; }
.crop-handles { position: absolute; pointer-events: none; button { position: absolute; width: 10px; height: 10px; background: white; border: 1px solid #3b82f6; padding: 0; border-radius: 50%; pointer-events: auto; transform: translate(-50%, -50%); touch-action: none; } .nw, .n, .ne { top: 0; } .w, .e { top: 50%; } .sw, .s, .se { top: 100%; } .nw, .w, .sw { left: 0; } .n, .s { left: 50%; } .ne, .e, .se { left: 100%; } .nw, .se { cursor: nwse-resize; } .ne, .sw { cursor: nesw-resize; } .n, .s { cursor: ns-resize; } .w, .e { cursor: ew-resize; } }
.crop-controls { position: absolute; top: calc(100% + 12px); left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 6px; padding: 8px; border-radius: 10px; background: white; box-shadow: 0 4px 24px #00000018; white-space: nowrap; font-size: 12px; color: #202020; label { display: flex; align-items: center; gap: 4px; padding-left: 6px; background: #f6f7f9; border-radius: 5px; } input { width: 60px; border: 0; background: transparent; font: inherit; padding: 6px 0; } select, button { font: inherit; border: 0; background: #f6f7f9; padding: 7px 9px; border-radius: 5px; } .apply { background: #3b82f6; color: white; } }
@media (max-width: 1100px) { .crop-controls { gap: 3px; padding: 6px; font-size: 11px; input { width: 45px; } select, button { padding: 6px; } } }
</style>
