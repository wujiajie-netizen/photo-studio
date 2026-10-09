<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { PROJECT_NAME_LIMIT, type CommerceParameters, type CreationPreset, type ProductImageParameters } from '@photo-studio/shared';
import { request } from '../api';

const props = defineProps<{ kind: CreationPreset['kind']; parameters: ProductImageParameters | CommerceParameters; disabled?: boolean }>();
const emit = defineEmits<{ apply: [preset: CreationPreset, restoreCopy: boolean] }>();
const presets = ref<CreationPreset[]>([]); const selectedId = ref(''); const name = ref('');
const loading = ref(false); const busy = ref(false); const error = ref(''); const notice = ref('');
const preview = ref(false); const deleting = ref(false); const restoreCopy = ref(false);
const selected = computed(() => presets.value.find(item => item.id === selectedId.value));
let version = 0;
function load() {
  const current = ++version; loading.value = true; error.value = '';
  request<CreationPreset[]>(`/creation-presets?kind=${props.kind}`).then(items => { if (current === version) presets.value = items; })
    .catch((failure: Error) => { if (current === version) error.value = failure.message; }).finally(() => { if (current === version) loading.value = false; });
}
watch(() => props.kind, () => {
  selectedId.value = ''; name.value = ''; preview.value = false; deleting.value = false; presets.value = []; load();
}, { immediate: true });
watch(selectedId, () => { name.value = selected.value?.name ?? ''; });
function save(update: boolean) {
  if (busy.value || props.disabled || !name.value.trim()) return;
  const current = version; const id = selectedId.value; busy.value = true; error.value = ''; notice.value = '';
  /* 方案仅保存参数快照，不保存商品图片；应用前明确确认文案的复制范围。 */
  const body = { name: name.value.trim(), kind: props.kind, parameters: { ...props.parameters, sourceAssetId: null } };
  request<CreationPreset>(update ? `/creation-presets/${id}` : '/creation-presets', { method: update ? 'PATCH' : 'POST', body: JSON.stringify(body) })
    .then(item => { if (current !== version) return; const index = presets.value.findIndex(value => value.id === item.id); if (index === -1) presets.value.unshift(item); else presets.value[index] = item; selectedId.value = item.id; notice.value = update ? '方案已更新。' : '方案已保存。'; })
    .catch((failure: Error) => { if (current === version) error.value = failure.message; }).finally(() => { busy.value = false; });
}
function remove() {
  if (!selected.value || busy.value) return;
  const id = selected.value.id; const current = version; busy.value = true; error.value = '';
  request(`/creation-presets/${id}`, { method: 'DELETE' }).then(() => { if (current !== version) return; presets.value = presets.value.filter(item => item.id !== id); selectedId.value = ''; deleting.value = false; notice.value = '方案已删除。'; })
    .catch((failure: Error) => { if (current === version) error.value = failure.message; }).finally(() => { busy.value = false; });
}
</script>

<template>
  <section class="creation-presets" aria-label="创作方案">
    <h3>创作方案</h3>
    <p>复用视觉设置，无需重复配置。商品素材始终保留。</p>
    <label>已保存方案<select v-model="selectedId" :disabled="disabled || loading || busy" @change="notice = ''"><option value="">{{ loading ? '正在读取…' : '选择方案' }}</option><option v-for="preset in presets" :key="preset.id" :value="preset.id">{{ preset.name }}</option></select></label>
    <div class="actions"><button type="button" :disabled="!selected || disabled || busy" @click="preview = true; restoreCopy = false">预览并应用</button><button type="button" :disabled="!selected || disabled || busy" @click="deleting = true">删除方案</button><button type="button" :disabled="disabled || busy || loading" @click="load">刷新方案</button></div>
    <label>方案名称<input v-model="name" :maxlength="PROJECT_NAME_LIMIT" placeholder="例如：暖色家居三张套图" :disabled="disabled || busy" /></label>
    <div class="actions"><button type="button" :disabled="!name.trim() || disabled || busy || loading" @click="save(false)">{{ busy ? '保存中…' : '另存为新方案' }}</button><button type="button" :disabled="!selected || !name.trim() || disabled || busy" @click="save(true)">用当前设置更新</button></div>
    <p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p>
    <Teleport to="body">
      <div v-if="(preview || deleting) && selected" class="preset-overlay" @click.self="preview = false; deleting = false">
      <section class="preset-dialog" role="dialog" aria-modal="true" :aria-label="deleting ? '删除创作方案' : '应用创作方案'">
        <h2>{{ deleting ? '删除方案' : '应用方案' }}：{{ selected.name }}</h2>
        <template v-if="!deleting">
          <p>场景：{{ { white: '白底', warm: '暖色', cool: '冷色' }[selected.parameters.scene] }} · 比例 {{ selected.parameters.ratio }} · {{ selected.parameters.quality === 'high' ? '高清' : '标准' }}</p>
          <template v-if="selected.kind !== 'product-image'"><p>平台 {{ selected.parameters.platform }} · 地区 {{ selected.parameters.region }} · 语言 {{ selected.parameters.language }}</p><ol><li v-for="(section, index) in selected.parameters.sections" :key="index"><strong>{{ section.title }}</strong><p>{{ section.content || '未填写文案' }}</p></li></ol><p>方案商品：{{ selected.parameters.productName || '未填写' }}</p><p>方案卖点：{{ selected.parameters.sellingPoints.join('；') || '未填写' }}</p></template>
          <template v-else><p>生成数量：{{ selected.parameters.count }} 张</p><p>方案描述：{{ selected.parameters.description || '未填写' }}</p></template>
          <label class="restore-copy"><input v-model="restoreCopy" type="checkbox" />{{ selected.kind === 'product-image' ? '同时恢复方案中的补充描述' : '同时恢复方案中的商品名称、卖点和文案' }}</label>
          <p>{{ restoreCopy ? '将覆盖当前文案，请核对与当前商品一致后再生成。' : selected.kind === 'product-image' ? '保留当前商品描述，只复制场景、比例、数量和质量。' : '保留商品名称、卖点和同类模块文案；结构按方案替换，未包含的模块会移除，新模块需填写内容。' }}</p>
        </template><p v-else>删除后无法恢复，已生成的任务与作品不受影响。</p>
        <div class="actions"><button type="button" class="button secondary" :disabled="busy" @click="preview = false; deleting = false">取消</button><button type="button" class="button" :disabled="busy || disabled" @click="deleting ? remove() : (emit('apply', JSON.parse(JSON.stringify(selected)), restoreCopy), preview = false)">{{ deleting ? '确认删除' : '应用到当前设置' }}</button></div>
      </section>
      </div>
    </Teleport>
  </section>
</template>

<style scoped lang="scss">
.creation-presets { padding-bottom: 18px; margin-bottom: 18px; border-bottom: 1px solid var(--border); h3 { font-size: 14px; } p { font-size: 11px; color: var(--muted); margin: 8px 0; } label { display: grid; gap: 6px; margin-top: 10px; font-size: 12px; } input, select { width: 100%; min-width: 0; padding: 9px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); } .error { color: var(--error); } }
.actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; button { font: inherit; font-size: 12px; border: 1px solid var(--border); background: var(--surface); color: var(--text); padding: 7px 10px; border-radius: var(--radius-sm); } }
.preset-overlay { position: fixed; inset: 0; z-index: 200; display: grid; place-items: center; padding: 24px; background: rgb(20 15 32 / 45%); }
.preset-dialog { width: min(540px, 100%); max-height: 85dvh; overflow-y: auto; padding: 24px; background: var(--surface); border-radius: var(--radius); h2 { font-size: 18px; } p, li { font-size: 13px; margin: 12px 0; overflow-wrap: anywhere; } .restore-copy { display: flex; gap: 8px; align-items: start; font-size: 13px; padding: 12px 0; } }
</style>
