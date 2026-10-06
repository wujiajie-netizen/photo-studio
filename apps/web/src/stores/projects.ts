import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Project } from '@photo-studio/shared';
import { request } from '../api';

export const useProjectsStore = defineStore('projects', () => {
  const projects = ref<Project[]>([]);
  const loading = ref(false);
  const error = ref('');
  let loadVersion = 0;

  function load() {
    const version = ++loadVersion;
    loading.value = true;
    error.value = '';
    /* 页面切换或保存后可能重新读取列表，只接受最近一次请求，避免旧响应覆盖新项目。 */
    return request<Project[]>('/projects')
      .then((result) => { if (version === loadVersion) projects.value = result; })
      .catch((reason: unknown) => {
        if (version === loadVersion) error.value = reason instanceof Error ? reason.message : '项目读取失败，请重试。';
      })
      .finally(() => { if (version === loadVersion) loading.value = false; });
  }

  return { projects, loading, error, load };
});
