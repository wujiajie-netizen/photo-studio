<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { EDITOR_FONT_FAMILIES, PROJECT_NAME_LIMIT, type BrandPreset, type BrandStyle } from '@photo-studio/shared';
import { request } from '../api';

const presets = ref<BrandPreset[]>([]); const selectedId = ref(''); const name = ref('');
const draft = ref<BrandStyle>({ fontFamily: 'Microsoft YaHei', primaryColor: '#7845ce', textColor: '#24202c', backgroundColor: '#ffffff', styleDescription: '' });
const loading = ref(false); const busy = ref(false); const deleting = ref(false); const error = ref(''); const notice = ref('');
function load() {
  loading.value = true; error.value = '';
  request<BrandPreset[]>('/brand-presets').then(items => { presets.value = items; }).catch((failure: Error) => { error.value = failure.message; }).finally(() => { loading.value = false; });
}
function select() {
  const item = presets.value.find(value => value.id === selectedId.value); name.value = item?.name ?? ''; notice.value = ''; deleting.value = false;
  draft.value = item ? { fontFamily: item.fontFamily, primaryColor: item.primaryColor, textColor: item.textColor, backgroundColor: item.backgroundColor, styleDescription: item.styleDescription } : { fontFamily: 'Microsoft YaHei', primaryColor: '#7845ce', textColor: '#24202c', backgroundColor: '#ffffff', styleDescription: '' };
}
function save(update: boolean) {
  if (busy.value || !name.value.trim()) return;
  busy.value = true; error.value = ''; notice.value = '';
  request<BrandPreset>(update ? `/brand-presets/${selectedId.value}` : '/brand-presets', { method: update ? 'PATCH' : 'POST', body: JSON.stringify({ name: name.value.trim(), ...draft.value }) })
    .then(item => { const index = presets.value.findIndex(value => value.id === item.id); if (index === -1) presets.value.unshift(item); else presets.value[index] = item; selectedId.value = item.id; notice.value = '品牌预设已保存，新任务可选择使用。'; })
    .catch((failure: Error) => { error.value = failure.message; }).finally(() => { busy.value = false; });
}
function remove() {
  const id = selectedId.value; if (!id || busy.value) return;
  busy.value = true; error.value = '';
  request(`/brand-presets/${id}`, { method: 'DELETE' }).then(() => { presets.value = presets.value.filter(item => item.id !== id); selectedId.value = ''; select(); notice.value = '品牌预设已删除，现有任务中的品牌快照保留。'; })
    .catch((failure: Error) => { error.value = failure.message; }).finally(() => { busy.value = false; });
}
onMounted(load);
</script>

<template>
  <section class="brand-manager" aria-label="品牌预设管理">
    <header><div><h2>品牌预设</h2><p>统一套图和详情页的字体、配色与视觉风格。已提交任务保存独立快照。</p></div><button type="button" class="button secondary" :disabled="busy || loading" @click="load">刷新预设</button></header>
    <fieldset :disabled="busy || loading">
      <label>选择预设<select v-model="selectedId" @change="select"><option value="">新建品牌预设</option><option v-for="preset in presets" :key="preset.id" :value="preset.id">{{ preset.name }}</option></select></label>
      <label>名称<input v-model="name" :maxlength="PROJECT_NAME_LIMIT" placeholder="例如：自然家居品牌" /></label><label>字体<select v-model="draft.fontFamily"><option v-for="font in EDITOR_FONT_FAMILIES" :key="font">{{ font }}</option></select></label>
      <div class="colors"><label>主色<input v-model="draft.primaryColor" type="color" /></label><label>文字色<input v-model="draft.textColor" type="color" /></label><label>背景色<input v-model="draft.backgroundColor" type="color" /></label></div>
      <label>统一风格描述<textarea v-model="draft.styleDescription" rows="3" maxlength="1000" placeholder="例如：自然光、简洁留白、暖色家居氛围" /></label>
      <div class="actions"><button type="button" class="button" :disabled="!name.trim()" @click="save(false)">保存新预设</button><button type="button" class="button secondary" :disabled="!selectedId || !name.trim()" @click="save(true)">更新预设</button><button type="button" class="button secondary" :disabled="!selectedId" @click="deleting = true">删除预设</button></div>
    </fieldset><div v-if="deleting" class="delete-confirm" role="alert"><p>确认删除此品牌预设？已有任务的快照不会改变。</p><button type="button" class="button secondary" :disabled="busy" @click="deleting = false">取消</button><button type="button" class="button" :disabled="busy" @click="remove">确认删除</button></div>
    <p v-if="loading || busy" role="status">{{ loading ? '正在读取品牌预设…' : '正在保存…' }}</p><p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p>
  </section>
</template>

<style scoped lang="scss">
.brand-manager { margin-top: 28px; padding: 28px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); header { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 16px; } h2 { font-size: 17px; } p { font-size: 12px; color: var(--muted); margin-top: 8px; } fieldset { border: 0; padding: 0; margin: 18px 0 0; max-width: 680px; min-width: 0; } label { display: grid; gap: 7px; margin-top: 14px; font-size: 12px; } input, select, textarea { width: 100%; padding: 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); font: inherit; } input[type='color'] { height: 42px; padding: 4px; } .error { color: var(--error); } }
.colors { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.actions, .delete-confirm { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 18px; }
</style>
