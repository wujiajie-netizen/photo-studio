<script setup lang="ts">
import { computed, ref } from 'vue';
import { X, Download } from '@lucide/vue';
const props = defineProps<{ width: number; height: number; name: string; busy: boolean }>();
const emit = defineEmits<{ close: []; download: [format: 'png' | 'jpeg', scale: number, name: string] }>();
const format = ref<'png' | 'jpeg'>('png'); const scale = ref(1); const name = ref(props.name.replace(/\.(png|jpe?g|webp)$/i, ''));
const tooLarge = computed(() => props.width * scale.value > 8192 || props.height * scale.value > 8192 || props.width * props.height * scale.value ** 2 > 32_000_000);
</script>
<template>
  <div class="canvas-export" @click.self="!busy && emit('close')" @keydown.esc.stop="!busy && emit('close')">
    <section role="dialog" aria-modal="true" aria-label="下载作品" @pointerdown.stop>
      <header><h3>下载作品</h3><button type="button" :disabled="busy" aria-label="关闭下载设置" @click="emit('close')"><X :size="16" /></button></header>
      <label>文件名<input v-model="name" autofocus maxlength="200" :disabled="busy" /></label>
      <label>格式<select v-model="format" :disabled="busy"><option value="png">PNG · 保留透明背景</option><option value="jpeg">JPG · 适合商品发布</option></select></label>
      <label>尺寸<select v-model.number="scale" :disabled="busy"><option :value="1">原尺寸</option><option :value="2">2 倍尺寸</option><option :value="4">4 倍尺寸</option></select></label>
      <p>{{ Math.round(width * scale) }} × {{ Math.round(height * scale) }} 像素 · 包含当前编辑</p><p v-if="tooLarge" role="alert">尺寸过大，请选择较小尺寸（最长边 8192 像素、总计 3200 万像素以内）。</p>
      <footer><button type="button" :disabled="busy" @click="emit('close')">取消</button><button type="button" class="primary" :disabled="busy || tooLarge || !name.trim()" @click="emit('download', format, scale, name.trim().replace(/[\\/:*?&quot;&lt;&gt;|]/g, '_'))"><Download :size="14" />{{ busy ? '正在导出…' : '下载' }}</button></footer>
    </section>
  </div>
</template>
<style scoped lang="scss">
.canvas-export { position: fixed; inset: 0; z-index: 40; display: grid; place-items: center; background: rgb(0 0 0 / 20%); section { width: min(340px, calc(100vw - 32px)); padding: 20px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); box-shadow: var(--shadow); } header, footer { display: flex; align-items: center; gap: 10px; justify-content: space-between; } h3 { font-size: 15px; } label { display: grid; gap: 7px; margin: 16px 0; font-size: 12px; } input, select { width: 100%; padding: 9px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); font: inherit; } p { margin: 14px 0; color: var(--muted); font-size: 11px; line-height: 1.7; } [role='alert'] { color: var(--error); } footer { justify-content: end; } button { display: inline-flex; align-items: center; gap: 5px; border: 0; padding: 8px 12px; border-radius: 6px; background: var(--page); font: inherit; font-size: 12px; } .primary { color: white; background: var(--text); } }
</style>
