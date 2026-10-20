<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Trash2, X } from '@lucide/vue';

defineProps<{ name: string; description: string; busy: boolean; error: string }>();
const emit = defineEmits<{ close: []; confirm: [] }>();
const dialog = ref<HTMLDialogElement | null>(null);
onMounted(() => { dialog.value?.showModal(); });
</script>

<template>
  <dialog ref="dialog" class="delete-dialog" aria-labelledby="delete-title" aria-describedby="delete-description" @close="emit('close')" @cancel="busy && $event.preventDefault()">
    <header><h2 id="delete-title">确认删除</h2><button type="button" :disabled="busy" aria-label="关闭" @click="dialog?.close()"><X :size="19" /></button></header>
    <p class="delete-name">{{ name }}</p>
    <p id="delete-description"><slot name="description">{{ description }}</slot></p>
    <p v-if="error" class="delete-error" role="alert">{{ error }}</p>
    <footer><button type="button" class="button secondary" autofocus :disabled="busy" @click="dialog?.close()">取消</button><button type="button" class="button delete-confirm" :disabled="busy" @click="emit('confirm')"><Trash2 :size="15" />{{ busy ? '正在删除…' : '确认删除' }}</button></footer>
  </dialog>
</template>

<style scoped lang="scss">
.delete-dialog {
  width: min(460px, calc(100vw - 40px)); padding: 28px; border: 1px solid var(--border); border-radius: var(--radius); color: var(--text); box-shadow: 0 24px 80px rgb(0 0 0 / 15%);
  &::backdrop { background: rgb(0 0 0 / 25%); }
  header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
  h2 { font-size: 20px; font-weight: 550; }
  header button { display: grid; place-items: center; border: 0; background: transparent; color: var(--muted); padding: 4px; border-radius: 4px; }
  p { font-size: 13px; color: var(--muted); line-height: 1.7; }
  :slotted(strong) { color: var(--error); font-weight: 600; }
  .delete-name { color: var(--text); overflow-wrap: anywhere; font-weight: 500; margin: 22px 0 8px; }
  .delete-error { color: var(--error); margin-top: 16px; }
  footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: 26px; }
  .delete-confirm { background: var(--error); color: #fff; }
}
</style>
