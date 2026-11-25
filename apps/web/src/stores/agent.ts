import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { AgentAutoFlow, AgentExecution, AgentMessage, AgentResult, AgentSession, AgentTask } from '@photo-studio/shared';
import { request } from '../api';

export const useAgentStore = defineStore('agent', () => {
  const sessions = ref<AgentSession[]>([]);
  const session = ref<AgentSession | null>(null);
  const messages = ref<AgentMessage[]>([]);
  const tasks = ref<AgentTask[]>([]);
  const results = ref<Record<string, AgentResult>>({});
  const flows = ref<AgentAutoFlow[]>([]);
  const flowExecutions = ref<AgentExecution[]>([]);
  const loading = ref(false);
  const submitting = ref(false);
  const error = ref('');
  const connection = ref('');
  const flowConnection = ref('');
  const busy = computed(() => submitting.value || tasks.value.some((task) => ['queued', 'running'].includes(task.status)) || flows.value.some(flow => ['planning', 'preparing', 'executing'].includes(flow.status)));
  let version = 0;
  let listVersion = 0;
  let stream: EventSource | null = null;
  let flowStream: EventSource | null = null;

  function disconnect() { ++version; stream?.close(); stream = null; flowStream?.close(); flowStream = null; connection.value = ''; flowConnection.value = ''; }
  function list() {
    const current = ++listVersion;
    return request<AgentSession[]>('/agent/sessions').then((value) => { if (current === listVersion) sessions.value = value; });
  }

  function renameSession(id: string, title: string) {
    return request<AgentSession>(`/agent/sessions/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) }).then(saved => {
      ++listVersion;
      sessions.value = sessions.value.map(item => item.id === id ? saved : item);
      if (session.value?.id === id) session.value = saved;
    });
  }

  function manageSessions(ids: string[], action: 'pin' | 'unpin' | 'delete') {
    return request<AgentSession[]>('/agent/sessions/actions', { method: 'POST', body: JSON.stringify({ ids, action }) }).then(saved => {
      ++listVersion; sessions.value = saved;
      if (session.value) session.value = saved.find(item => item.id === session.value?.id) ?? null;
    });
  }

  function loadResult(task: AgentTask, current: number) {
    if (task.status !== 'succeeded') return Promise.resolve();
    return request<AgentResult>(`/agent/tasks/${task.id}/result`).then((value) => {
      if (current === version) results.value[task.id] = value;
    });
  }

  function load(id: string | null) {
    disconnect();
    const current = version;
    session.value = null; messages.value = []; tasks.value = []; results.value = {}; flows.value = []; flowExecutions.value = []; error.value = '';
    loading.value = !!id;
    if (!id) return Promise.resolve();
    /* 切换会话时丢弃旧请求；先读取持久化记录再订阅快照，断线重连仍由服务端补齐状态。 */
    return Promise.all([
      request<AgentSession>(`/agent/sessions/${id}`),
      request<AgentMessage[]>(`/agent/sessions/${id}/messages`),
      request<AgentTask[]>(`/agent/sessions/${id}/tasks`),
      request<AgentAutoFlow[]>(`/agent/sessions/${id}/flows`)
    ]).then(([saved, savedMessages, savedTasks, savedFlows]) => {
      if (current !== version) return;
      session.value = saved; messages.value = savedMessages; tasks.value = savedTasks; flows.value = savedFlows;
      flowStream = new EventSource(`/api/agent/sessions/${id}/flow/events`);
      flowStream.onopen = () => { if (current === version) flowConnection.value = ''; };
      flowStream.onerror = () => { if (current === version) flowConnection.value = '创作进度连接暂时中断，正在重连…'; };
      flowStream.addEventListener('flow', (event: MessageEvent<string>) => {
        if (current !== version) return;
        const flow = JSON.parse(event.data) as AgentAutoFlow;
        const index = flows.value.findIndex(item => item.taskId === flow.taskId);
        if (index === -1) flows.value.push(flow); else flows.value[index] = flow;
      });
      flowStream.addEventListener('execution', (event: MessageEvent<string>) => {
        if (current !== version) return;
        const execution = JSON.parse(event.data) as AgentExecution;
        const index = flowExecutions.value.findIndex(item => item.id === execution.id);
        if (index === -1) flowExecutions.value.push(execution); else flowExecutions.value[index] = execution;
      });
      stream = new EventSource(`/api/agent/sessions/${id}/events`);
      stream.onopen = () => { if (current === version) connection.value = ''; };
      stream.onerror = () => { if (current === version) connection.value = '实时连接暂时中断，正在重连…'; };
      stream.addEventListener('task', (event: MessageEvent<string>) => {
        if (current !== version) return;
        const task = JSON.parse(event.data) as AgentTask;
        const index = tasks.value.findIndex((item) => item.id === task.id);
        const previous = tasks.value[index]?.status;
        if (index === -1) tasks.value.push(task);
        else tasks.value[index] = task;
        if (task.status === 'succeeded' && (previous !== 'succeeded' || !results.value[task.id])) {
          Promise.all([loadResult(task, current), request<AgentMessage[]>(`/agent/sessions/${id}/messages`), list()])
            .then(([, saved]) => { if (current === version) messages.value = saved; })
            .catch((failure: Error) => { if (current === version) error.value = failure.message; });
        }
      });
      return Promise.all(savedTasks.map((task) => loadResult(task, current)));
    }).catch((failure: Error) => { if (current === version) error.value = failure.message; })
      .finally(() => { if (current === version) loading.value = false; });
  }

  function submit(content: string, id: string | null, sourceAssetId: string | null, projectId: string | null): Promise<AgentTask> {
    submitting.value = true; error.value = '';
    return request<AgentTask>(id ? `/agent/sessions/${id}/messages` : '/agent/sessions', { method: 'POST', body: JSON.stringify({ content, sourceAssetId, projectId }) })
      .catch((failure: Error) => { error.value = failure.message; throw failure; })
      .finally(() => { submitting.value = false; });
  }

  function cancel(id: string) {
    return request<AgentTask>(`/agent/tasks/${id}/cancel`, { method: 'POST' })
      .then((task) => { const index = tasks.value.findIndex((item) => item.id === id); if (index !== -1) tasks.value[index] = task; })
      .catch((failure: Error) => { error.value = failure.message; });
  }

  function flowAction(id: string, action: 'cancel' | 'retry') {
    return request(`/agent/tasks/${id}/flow/${action}`, { method: 'POST' })
      .catch((failure: Error) => { error.value = failure.message; });
  }

  return { sessions, session, messages, tasks, results, flows, flowExecutions, loading, submitting, error, connection, flowConnection, busy, list, renameSession, manageSessions, load, submit, cancel, flowAction, disconnect };
});
