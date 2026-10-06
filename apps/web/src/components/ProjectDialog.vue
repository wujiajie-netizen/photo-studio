<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { X } from '@lucide/vue';
import { getProjectNameError, PROJECT_NAME_LIMIT, type Project } from '@photo-studio/shared';
import { request } from '../api';
import { useProjectsStore } from '../stores/projects';

const props = defineProps<{ project: Project | null }>();
const emit = defineEmits<{ close: []; saved: [project: Project] }>();
const projects = useProjectsStore();
const dialog = ref<HTMLDialogElement | null>(null);
const name = ref(props.project?.name ?? '');
const saving = ref(false);
const error = ref('');
const nameError = computed(() => getProjectNameError(name.value));

function save() {
  if (saving.value) return;
  error.value = nameError.value;
  if (error.value) return;
  saving.value = true;
  /* 保存结果以服务端返回值为准；成功后重新读取共享列表，失败时保留名称便于重试。 */
  request<Project>(props.project ? `/projects/${props.project.id}` : '/projects', {
    method: props.project ? 'PATCH' : 'POST',
    body: JSON.stringify({ name: name.value.trim() })
  })
    .then((project) => {
      projects.load();
      emit('saved', project);
    })
    .catch((reason: unknown) => { error.value = reason instanceof Error ? reason.message : '保存失败，请重试。'; })
    .finally(() => { saving.value = false; });
}

onMounted(() => { dialog.value?.showModal(); });
</script>

<template>
  <dialog ref="dialog" class="project-dialog" aria-labelledby="project-dialog-title" @close="emit('close')" @cancel="saving && $event.preventDefault()">
    <header><h2 id="project-dialog-title">{{ project ? '重命名项目' : '新建项目' }}</h2><button type="button" :disabled="saving" aria-label="关闭" @click="dialog?.close()"><X :size="19" /></button></header>
    <p>{{ project ? '为这份创作换一个容易找到的名称。' : '给新的创作起个名字，方便之后继续。' }}</p>
    <form novalidate @submit.prevent="save">
      <label for="project-name">项目名称</label>
      <input id="project-name" v-model="name" autofocus required autocomplete="off" :disabled="saving" :aria-invalid="Boolean(error && nameError)" aria-describedby="project-name-help" placeholder="例如：春季咖啡上新" @input="error = ''" />
      <div id="project-name-help" class="name-help"><span>最多 {{ PROJECT_NAME_LIMIT }} 个字符</span><span>{{ [...name.trim()].length }} / {{ PROJECT_NAME_LIMIT }}</span></div>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <footer><button type="button" class="button secondary" :disabled="saving" @click="dialog?.close()">取消</button><button type="submit" class="button" :disabled="saving">{{ saving ? '保存中…' : project ? '保存名称' : '创建项目' }}</button></footer>
    </form>
  </dialog>
</template>

<style scoped lang="scss">
.project-dialog {
  width: min(460px, calc(100vw - 40px)); border: 1px solid var(--border); border-radius: var(--radius); padding: 28px; color: var(--text); box-shadow: 0 24px 80px rgb(0 0 0 / 15%);
  &::backdrop { background: rgb(0 0 0 / 25%); }
  header { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
  h2 { font-size: 20px; font-weight: 550; }
  header button { display: grid; place-items: center; padding: 4px; border: 0; background: transparent; border-radius: 4px; color: var(--muted); }
  > p { color: var(--muted); font-size: 12px; margin-top: 8px; }
  form { margin-top: 24px; }
  label { display: block; margin-bottom: 8px; font-size: 13px; }
  input { width: 100%; padding: 12px 14px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); color: var(--text); background: var(--surface); &[aria-invalid='true'] { border-color: var(--error); } }
  footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: 26px; }
}
.name-help { display: flex; justify-content: space-between; gap: 16px; color: var(--muted); font-size: 11px; margin-top: 8px; }
.form-error { color: var(--error); font-size: 12px; margin-top: 12px; }
</style>
