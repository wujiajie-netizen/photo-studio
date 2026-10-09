<script setup lang="ts">
import { Bold, Italic, Underline, Strikethrough, SlidersHorizontal } from '@lucide/vue';
import { useEditorStore } from '../stores/editor';
import { EDITOR_FONT_FAMILIES } from '@photo-studio/shared';
const editor = useEditorStore();
defineProps<{ hideEdit?: boolean }>();
defineEmits<{ edit: [] }>();
function style(value: 'bold' | 'italic') {
  const layer = editor.layer; if (layer?.type !== 'text' || layer.locked) return;
  const bold = layer.fontStyle?.includes('bold') ?? false; const italic = layer.fontStyle?.includes('italic') ?? false;
  layer.fontStyle = (value === 'bold' ? !bold : bold) ? (value === 'italic' ? !italic : italic) ? 'bold italic' : 'bold' : (value === 'italic' ? !italic : italic) ? 'italic' : 'normal'; editor.fitText(); editor.commit();
}
function decoration(value: 'underline' | 'line-through') {
  const layer = editor.layer; if (layer?.type !== 'text' || layer.locked) return;
  layer.textDecoration = layer.textDecoration === value ? '' : value; editor.commit();
}
function colorMode(event: Event) {
  const layer = editor.layer; if (layer?.type !== 'text' || layer.locked) return;
  if ((event.target as HTMLSelectElement).value === 'gradient') layer.fillGradient = { colors: [layer.fill, '#ffffff'], angle: 0 };
  else delete layer.fillGradient;
  editor.commit();
}
</script>
<template>
  <fieldset v-if="editor.layer?.type === 'text'" class="text-tools" :disabled="editor.layer.locked" @pointerdown.stop>
    <select v-model="editor.layer.fontFamily" aria-label="文字字体" @change="editor.fitText(); editor.commit()"><option v-for="font in EDITOR_FONT_FAMILIES" :key="font">{{ font }}</option></select>
    <input v-model.number="editor.layer.fontSize" type="number" min="8" max="300" aria-label="文字字号" @change="editor.fitText(); editor.commit()" />
    <select :value="editor.layer.fillGradient ? 'gradient' : 'solid'" aria-label="文字填色方式" @change="colorMode"><option value="solid">单色</option><option value="gradient">线性渐变</option></select>
    <template v-if="editor.layer.fillGradient"><input v-model="editor.layer.fillGradient.colors[0]" type="color" aria-label="文字渐变起始色" @change="editor.commit" /><input v-model="editor.layer.fillGradient.colors[1]" type="color" aria-label="文字渐变结束色" @change="editor.commit" /><input v-model.number="editor.layer.fillGradient.angle" type="number" min="0" max="360" aria-label="文字渐变角度" @change="editor.commit" /></template>
    <input v-else v-model="editor.layer.fill" type="color" aria-label="文字颜色" @change="editor.commit" />
    <button type="button" aria-label="加粗" :aria-pressed="editor.layer.fontStyle?.includes('bold') ?? false" @click="style('bold')"><Bold :size="16" /></button>
    <button type="button" aria-label="斜体" :aria-pressed="editor.layer.fontStyle?.includes('italic') ?? false" @click="style('italic')"><Italic :size="16" /></button>
    <button type="button" aria-label="下划线" :aria-pressed="editor.layer.textDecoration === 'underline'" @click="decoration('underline')"><Underline :size="16" /></button>
    <button type="button" aria-label="删除线" :aria-pressed="editor.layer.textDecoration === 'line-through'" @click="decoration('line-through')"><Strikethrough :size="16" /></button>
    <select v-model="editor.layer.align" aria-label="文字对齐" @change="editor.commit"><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select>
    <button v-if="!hideEdit" type="button" @click="$emit('edit')"><SlidersHorizontal :size="14" /> 编辑</button>
  </fieldset>
</template>
<style scoped lang="scss">
.text-tools { margin: 0; border: 0; display: flex; flex-wrap: wrap; max-width: 100%; align-items: center; gap: 4px; padding: 0; select, input { min-width: 0; border: 1px solid var(--border); border-radius: 5px; background: var(--surface); font: inherit; padding: 5px; } select { max-width: 130px; } input[type='number'] { width: 52px; } input[type='color'] { width: 26px; height: 26px; padding: 2px; } button { display: inline-flex; align-items: center; gap: 4px; padding: 6px; border: 0; background: transparent; border-radius: 5px; white-space: nowrap; font: inherit; } button[aria-pressed='true'] { background: var(--page); } }
</style>
