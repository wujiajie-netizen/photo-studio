<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { ProductImageResult, Project } from '@photo-studio/shared';
import { request } from '../api';
import ProjectDialog from './ProjectDialog.vue';

const props = defineProps<{ result: ProductImageResult }>();
const emit = defineEmits<{ close: []; saved: [result: ProductImageResult] }>();
const dialog = ref<HTMLDialogElement | null>(null);
const projects = ref<Project[]>([]);
const selected = ref(props.result.projectId ?? '');
const creating = ref(false);
const saving = ref(false);
const loading = ref(true);
const error = ref('');

function load() {
  loading.value = true; error.value = '';
  return request<Project[]>('/projects').then((value) => { projects.value = value; })
    .catch((failure: Error) => { error.value = failure.message; }).finally(() => { loading.value = false; });
}
function save() {
  if (!selected.value || saving.value) return;
  saving.value = true; error.value = '';
  request<ProductImageResult>(`/product-image/results/${props.result.id}`, { method: 'PATCH', body: JSON.stringify({ projectId: selected.value }) })
    .then((value) => { emit('saved', value); dialog.value?.close(); })
    .catch((failure: Error) => { error.value = failure.message; }).finally(() => { saving.value = false; });
}
onMounted(() => { dialog.value?.showModal(); load(); });
</script>

<template>
  <dialog ref="dialog" class="save-result-dialog" aria-labelledby="save-result-title" @close="emit('close')" @cancel="saving && $event.preventDefault()">
    <h2 id="save-result-title">保存到项目</h2><p>{{ result.name }} 将保存在本机项目中。</p>
    <form @submit.prevent="save">
      <label for="save-project">选择项目</label>
      <select id="save-project" v-model="selected" :disabled="loading || saving"><option value="" disabled>{{ loading ? '正在读取项目…' : '请选择项目' }}</option><option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option></select>
      <button type="button" class="create" :disabled="saving || loading" @click="creating = true">＋ 新建项目</button>
      <p v-if="!loading && !projects.length">还没有项目，可以先新建一个。</p>
      <p v-if="error" role="alert" class="error">{{ error }} <button v-if="!projects.length" type="button" @click="load">重新读取</button></p>
      <footer><button class="button secondary" type="button" :disabled="saving" @click="dialog?.close()">取消</button><button class="button" type="submit" :disabled="!selected || saving || loading">{{ saving ? '保存中…' : '保存图片' }}</button></footer>
    </form>
    <ProjectDialog v-if="creating" :project="null" @close="creating = false" @saved="projects.unshift($event); selected = $event.id; creating = false" />
  </dialog>
</template>

<style scoped lang="scss">
.save-result-dialog {
  width: min(460px, calc(100vw - 40px)); padding: 28px; border: 1px solid var(--border); border-radius: var(--radius); color: var(--text);
  &::backdrop { background: rgb(0 0 0 / 25%); }
  h2 { font-size: 20px; } p { color: var(--muted); font-size: 12px; margin: 8px 0 20px; }
  label { display: block; margin-bottom: 8px; }
  select { width: 100%; padding: 12px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); font: inherit; background: var(--surface); }
  .create { border: 0; background: transparent; padding: 12px 0; color: var(--text); }
  .error { color: var(--error); }
  footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
}
</style>
