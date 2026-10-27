<script setup lang="ts">
import { useEditorStore } from '../stores/editor';
import CanvasImageAdjustments from './CanvasImageAdjustments.vue';
import { EDITOR_FONT_FAMILIES } from '@photo-studio/shared';
const editor = useEditorStore();
function align(axis: 'x' | 'y') {
  if (!editor.content || !editor.layer || editor.layer.locked) return;
  editor.layer[axis] = axis === 'x' ? (editor.content.width - editor.layer.width) / 2 : (editor.content.height - editor.layer.height) / 2; editor.commit();
}
function order(direction: number) {
  if (!editor.content || !editor.layer || editor.layer.locked) return;
  const layers = editor.content.layers; const index = layers.findIndex(layer => layer.id === editor.selected); const target = index + direction;
  if (target < 0 || target >= layers.length) return;
  [layers[index], layers[target]] = [layers[target], layers[index]]; editor.commit();
}
</script>
<template>
  <div class="canvas-properties">
    <fieldset v-if="editor.layer" :disabled="editor.layer.locked">
      <legend>当前图层</legend><label>名称<input v-model="editor.layer.name" maxlength="200" @change="editor.commit" /></label>
      <CanvasImageAdjustments />
      <template v-if="editor.layer.type === 'text'">
        <label>文字内容<textarea v-model="editor.layer.text" rows="3" maxlength="2000" @input="editor.fitText(); editor.commit()" /></label>
        <div class="paired"><label>字号<input v-model.number="editor.layer.fontSize" type="number" min="8" max="300" @change="editor.fitText(); editor.commit()" /></label><label v-if="!editor.layer.fillGradient">颜色<input v-model="editor.layer.fill" type="color" @change="editor.commit" /></label></div>
        <template v-if="editor.layer.fillGradient"><div class="paired"><label>渐变起始色<input v-model="editor.layer.fillGradient.colors[0]" type="color" @change="editor.commit" /></label><label>渐变结束色<input v-model="editor.layer.fillGradient.colors[1]" type="color" @change="editor.commit" /></label></div><label>渐变角度<input v-model.number="editor.layer.fillGradient.angle" type="number" min="0" max="360" @change="editor.commit" /></label></template>
        <label>字体<select v-model="editor.layer.fontFamily" @change="editor.fitText(); editor.commit()"><option v-for="font in EDITOR_FONT_FAMILIES" :key="font">{{ font }}</option></select></label>
        <label>文字对齐<select v-model="editor.layer.align" @change="editor.commit"><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select></label>
        <div class="paired"><label>字间距<input :value="editor.layer.letterSpacing ?? 0" type="number" min="-20" max="100" step=".5" @input="editor.layer.letterSpacing = Number(($event.target as HTMLInputElement).value); editor.fitText(); editor.commit()" /></label><label>行高<input :value="editor.layer.lineHeight ?? 1" type="number" min=".5" max="5" step=".1" @input="editor.layer.lineHeight = Number(($event.target as HTMLInputElement).value); editor.fitText(); editor.commit()" /></label></div>
      </template>
      <template v-if="editor.layer.type === 'shape' || editor.layer.type === 'path'"><div class="paired"><label>线条颜色<input v-model="editor.layer.stroke" type="color" @change="editor.commit" /></label><label>线条粗细<input v-model.number="editor.layer.strokeWidth" type="number" :min="editor.layer.type === 'path' ? 1 : 0" max="300" @change="editor.commit" /></label></div><label v-if="editor.layer.type === 'shape'">填充<select v-if="editor.layer.fill === 'transparent'" @change="editor.layer.fill = '#3b82f6'; editor.commit()"><option>无填充</option><option>使用颜色</option></select><template v-else><input v-model="editor.layer.fill" type="color" @change="editor.commit" /><button type="button" @click="editor.layer.fill = 'transparent'; editor.commit()">无填充</button></template></label></template>
      <div class="paired"><label>X<input v-model.number="editor.layer.x" type="number" @change="editor.commit" /></label><label>Y<input v-model.number="editor.layer.y" type="number" @change="editor.commit" /></label><label>宽度<input v-model.number="editor.layer.width" type="number" min="1" max="16384" @change="editor.commit" /></label><label>高度<input v-model.number="editor.layer.height" type="number" min="1" max="16384" @change="editor.commit" /></label><label>旋转<input v-model.number="editor.layer.rotation" type="number" min="-360" max="360" @change="editor.commit" /></label><label>透明度<input v-model.number="editor.layer.opacity" type="number" min="0" max="1" step=".1" @change="editor.commit" /></label></div>
      <div class="paired"><button type="button" @click="align('x')">水平居中</button><button type="button" @click="align('y')">垂直居中</button><button type="button" @click="order(1)">上移一层</button><button type="button" @click="order(-1)">下移一层</button></div>
    </fieldset><p v-else>选中图层后可编辑；拖动图片或文字调整位置，拖动边框缩放、旋转。</p>
    <fieldset v-if="editor.content"><legend>画布</legend><label>作品名称<input v-model="editor.content.name" maxlength="200" @change="editor.commit" /></label><div class="paired"><label>画布宽<input v-model.number="editor.content.width" type="number" min="1" max="16384" :disabled="!!editor.fixedCanvasImage" @change="editor.commit" /></label><label>画布高<input v-model.number="editor.content.height" type="number" min="1" max="16384" :disabled="!!editor.fixedCanvasImage" @change="editor.commit" /></label></div><label v-if="!editor.fixedCanvasImage">背景<select v-if="editor.content.background === 'transparent'" aria-label="背景" @change="editor.content.background = '#ffffff'; editor.commit()"><option>透明背景</option><option>使用颜色</option></select><template v-else><input v-model="editor.content.background" type="color" @change="editor.commit" /><button type="button" @click="editor.content.background = 'transparent'; editor.commit()">透明背景</button></template></label></fieldset>
  </div>
</template>
<style scoped lang="scss">
.canvas-properties { fieldset { border: 0; padding: 0; margin: 16px 0 0; min-width: 0; } legend { font-size: 13px; font-weight: 500; color: var(--text); } label { display: grid; gap: 5px; margin: 10px 0; color: var(--text-secondary); } input, select, textarea { width: 100%; min-width: 0; border: 1px solid var(--border); border-radius: 5px; padding: 6px; background: var(--surface); color: var(--text); font: inherit; } input[type='color'] { padding: 2px; height: 29px; } p { color: var(--muted); line-height: 1.8; } button { border: 1px solid var(--border); background: var(--surface); color: var(--text-secondary); font: inherit; padding: 6px; border-radius: 5px; &:hover { background: var(--nav-hover); border-color: var(--border-strong); color: var(--accent); } }
}
.paired { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 6px; }
</style>
