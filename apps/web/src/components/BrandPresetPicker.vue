<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { EDITOR_FONT_FAMILIES, type BrandPreset, type BrandStyle } from '@photo-studio/shared';
import { request } from '../api';
const props = defineProps<{ modelValue: BrandStyle | null; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: BrandStyle | null] }>();
const presets = ref<BrandPreset[]>([]); const loading = ref(false); const error = ref(''); const selectedId = ref('');
function load() { loading.value = true; error.value = ''; request<BrandPreset[]>('/brand-presets').then(items => { presets.value = items; }).catch((failure: Error) => { error.value = failure.message; }).finally(() => { loading.value = false; }); }
function select() {
  const item = presets.value.find(value => value.id === selectedId.value);
  emit('update:modelValue', item ? { fontFamily: item.fontFamily, primaryColor: item.primaryColor, textColor: item.textColor, backgroundColor: item.backgroundColor, styleDescription: item.styleDescription } : null);
  selectedId.value = '';
}
function change(field: keyof BrandStyle, event: Event) { if (props.modelValue) emit('update:modelValue', { ...props.modelValue, [field]: (event.target as HTMLInputElement).value }); }
onMounted(load);
</script>

<template>
  <section class="brand-picker" aria-label="使用品牌预设">
    <h3>品牌风格</h3><label>品牌预设<select v-model="selectedId" :disabled="disabled || loading" @change="select"><option value="">选择预设</option><option v-for="preset in presets" :key="preset.id" :value="preset.id">{{ preset.name }}</option></select></label><div class="actions"><RouterLink to="/settings">管理品牌预设</RouterLink><button type="button" :disabled="disabled || loading" @click="load">刷新</button><button v-if="modelValue" type="button" :disabled="disabled" @click="emit('update:modelValue', null); selectedId = ''">清除品牌风格</button></div>
    <template v-if="modelValue"><p>当前使用独立快照，可修改后生成；更新品牌预设不会改变这里的内容。</p><label>字体<select :value="modelValue.fontFamily" :disabled="disabled" @change="change('fontFamily', $event)"><option v-for="font in EDITOR_FONT_FAMILIES" :key="font">{{ font }}</option></select></label><div class="colors"><label>主色<input :value="modelValue.primaryColor" type="color" :disabled="disabled" @input="change('primaryColor', $event)" /></label><label>文字色<input :value="modelValue.textColor" type="color" :disabled="disabled" @input="change('textColor', $event)" /></label><label>背景色<input :value="modelValue.backgroundColor" type="color" :disabled="disabled" @input="change('backgroundColor', $event)" /></label></div><label>风格描述<textarea :value="modelValue.styleDescription" maxlength="1000" rows="3" :disabled="disabled" @input="change('styleDescription', $event)" /></label></template><p v-if="error" class="error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped lang="scss">
.brand-picker { border-top: 1px solid var(--border); margin-top: 18px; padding-top: 16px; h3 { font-size: 14px; } p { font-size: 11px; color: var(--muted); margin-top: 10px; } label { display: grid; gap: 6px; margin-top: 10px; font-size: 12px; } input, select, textarea { width: 100%; min-width: 0; border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 9px; background: var(--surface); color: var(--text); } input[type='color'] { height: 36px; padding: 3px; } .error { color: var(--error); } }
.actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 10px; a, button { font-size: 11px; color: var(--accent); } button { border: 0; background: none; } }
.colors { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
</style>
