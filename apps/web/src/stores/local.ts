import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { LocalHealth } from '@photo-studio/shared';
import { request } from '../api';

export const useLocalStore = defineStore('local', () => {
  const health = ref<LocalHealth | null>(null);
  const loading = ref(false);
  const error = ref('');

  function refresh() {
    loading.value = true;
    error.value = '';
    return request<LocalHealth>('/health')
      .then((result) => { health.value = result; })
      .catch(() => {
        health.value = null;
        error.value = '无法连接本地服务，请检查服务是否启动后重试。';
      })
      .finally(() => { loading.value = false; });
  }

  return { health, loading, error, refresh };
});
