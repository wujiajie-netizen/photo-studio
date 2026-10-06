import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import type { CommerceKind, CommerceTask, ProductAsset, ProductImageResult } from '@photo-studio/shared';
import { request } from '../api';

export const useCommerceStore = defineStore('commerce', () => {
  const assets = ref<ProductAsset[]>([]);
  const tasks = ref<CommerceTask[]>([]);
  const task = ref<CommerceTask | null>(null);
  const results = ref<ProductImageResult[]>([]);
  const loading = ref(false);
  const error = ref('');
  const connection = ref('');
  const busy = computed(() => !!task.value && ['queued', 'running'].includes(task.value.status));
  let version = 0; let resultsVersion = 0; let stream: EventSource | null = null;
  function disconnect() { ++version; stream?.close(); stream = null; connection.value = ''; }
  function list(kind: CommerceKind) {
    return Promise.all([request<ProductAsset[]>('/assets'), request<CommerceTask[]>(`/commerce/tasks?kind=${kind}`)])
      .then(([savedAssets, savedTasks]) => { assets.value = savedAssets; tasks.value = savedTasks; });
  }
  function load(id: string | null, kind: CommerceKind) {
    disconnect(); const current = version;
    task.value = null; results.value = []; error.value = ''; loading.value = !!id;
    if (!id) return Promise.resolve();
    /* 切换流程或任务时关闭旧订阅，丢弃旧请求；快照与逐项状态驱动结果卡片。 */
    return Promise.all([request<CommerceTask>(`/commerce/tasks/${id}`), request<ProductImageResult[]>(`/commerce/tasks/${id}/results`)]).then(([saved, savedResults]) => {
      if (current !== version) return;
      if (saved.kind !== kind) throw new Error('该任务属于另一条生成流程，请从历史任务中重新选择。');
      task.value = saved; results.value = savedResults;
      stream = new EventSource(`/api/commerce/tasks/${id}/events`);
      stream.onopen = () => { if (current === version) connection.value = ''; };
      stream.onerror = () => { if (current === version) connection.value = '实时连接暂时中断，正在重连…'; };
      stream.addEventListener('task', (event: MessageEvent<string>) => {
        if (current !== version) return;
        const value = JSON.parse(event.data) as CommerceTask; task.value = value;
        const index = tasks.value.findIndex((entry) => entry.id === id);
        if (index === -1) tasks.value.unshift(value); else tasks.value[index] = value;
        const resultRequest = ++resultsVersion;
        request<ProductImageResult[]>(`/commerce/tasks/${id}/results`).then((images) => { if (current === version && resultRequest === resultsVersion) results.value = images; })
          .catch((failure: Error) => { if (current === version) error.value = failure.message; });
      });
    }).catch((failure: Error) => { if (current === version) error.value = failure.message; })
      .finally(() => { if (current === version) loading.value = false; });
  }
  return { assets, tasks, task, results, loading, error, connection, busy, list, load, disconnect };
});
