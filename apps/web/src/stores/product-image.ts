import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import type { ProductAsset, ProductImageParameters, ProductImageResult, ProductImageTask } from '@photo-studio/shared';
import { request } from '../api';

export const useProductImageStore = defineStore('product-image', () => {
  const assets = ref<ProductAsset[]>([]);
  const tasks = ref<ProductImageTask[]>([]);
  const task = ref<ProductImageTask | null>(null);
  const results = ref<ProductImageResult[]>([]);
  const source = ref<ProductAsset | null>(null);
  const loading = ref(false);
  const submitting = ref(false);
  const error = ref('');
  const connection = ref('');
  const busy = computed(() => submitting.value || !!task.value && ['queued', 'running'].includes(task.value.status));
  let version = 0;
  let stream: EventSource | null = null;

  function disconnect() { ++version; stream?.close(); stream = null; connection.value = ''; }
  function list() {
    return Promise.all([request<ProductAsset[]>('/assets'), request<ProductImageTask[]>('/product-image/tasks')])
      .then(([savedAssets, savedTasks]) => { assets.value = savedAssets; tasks.value = savedTasks; });
  }
  function load(id: string | null) {
    disconnect();
    const current = version;
    task.value = null; results.value = []; error.value = ''; loading.value = !!id;
    if (!id) return Promise.resolve();
    /* 切换历史任务时丢弃旧响应；先读取结果，再订阅持久化快照，刷新与重连可继续查看进度。 */
    return request<ProductImageTask>(`/product-image/tasks/${id}`).then((saved) => {
      return Promise.all([saved.parameters.sourceAssetId === null ? Promise.resolve(null) : request<ProductAsset>(`/assets/${saved.parameters.sourceAssetId}`), request<ProductImageResult[]>(`/product-image/tasks/${id}/results`)]).then(([asset, savedResults]) => {
        if (current !== version) return;
        task.value = saved; source.value = asset; results.value = savedResults;
        stream = new EventSource(`/api/product-image/tasks/${id}/events`);
        stream.onopen = () => { if (current === version) connection.value = ''; };
        stream.onerror = () => { if (current === version) connection.value = '实时连接暂时中断，正在重连…'; };
        stream.addEventListener('task', (event: MessageEvent<string>) => {
          if (current !== version) return;
          task.value = JSON.parse(event.data) as ProductImageTask;
          const index = tasks.value.findIndex((item) => item.id === id);
          if (index === -1) tasks.value.unshift(task.value);
          else tasks.value[index] = task.value;
          request<ProductImageResult[]>(`/product-image/tasks/${id}/results`).then((value) => {
            if (current === version && value.length >= results.value.length) results.value = value;
          }).catch((failure: Error) => { if (current === version) error.value = failure.message; });
        });
      });
    }).catch((failure: Error) => { if (current === version) error.value = failure.message; })
      .finally(() => { if (current === version) loading.value = false; });
  }
  function upload(file: File) {
    const body = new FormData(); body.append('file', file); body.append('name', file.name);
    return request<ProductAsset>('/assets', { method: 'POST', body }).then((asset) => {
      assets.value.unshift(asset); source.value = asset; return asset;
    });
  }
  function submit(parameters: ProductImageParameters) {
    submitting.value = true; error.value = '';
    return request<ProductImageTask>('/product-image/tasks', { method: 'POST', body: JSON.stringify(parameters) })
      .finally(() => { submitting.value = false; });
  }
  function retry(id: string, result = false) {
    submitting.value = true;
    return request<ProductImageTask>(`/product-image/${result ? 'results' : 'tasks'}/${id}/retry`, { method: 'POST' })
      .finally(() => { submitting.value = false; });
  }
  function cancel() {
    if (!task.value) return;
    return request<ProductImageTask>(`/product-image/tasks/${task.value.id}/cancel`, { method: 'POST' })
      .then((saved) => { task.value = saved; }).catch((failure: Error) => { error.value = failure.message; });
  }
  return { assets, tasks, task, results, source, loading, submitting, error, connection, busy, list, load, upload, submit, retry, cancel, disconnect };
});
