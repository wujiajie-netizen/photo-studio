import { createRouter, createWebHistory } from 'vue-router';
import HomeView from './views/HomeView.vue';
import CommerceView from './views/CommerceView.vue';
import ProductImageView from './views/ProductImageView.vue';
import EditorView from './views/EditorView.vue';
import AgentExecutionView from './views/AgentExecutionView.vue';
import ProjectsView from './views/ProjectsView.vue';
import ProjectDetailView from './views/ProjectDetailView.vue';
import SettingsView from './views/SettingsView.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: HomeView, meta: { title: '工作台' } },
    { path: '/product-image', component: ProductImageView, meta: { title: 'AI 商品图' } },
    { path: '/product-kit', component: CommerceView, meta: { title: '商品套图' } },
    { path: '/detail-page', component: CommerceView, meta: { title: '商品详情页' } },
    { path: '/projects', component: ProjectsView, meta: { title: '项目与资产' } },
    { path: '/projects/:projectId', component: ProjectDetailView, meta: { title: '项目详情' } },
    { path: '/settings', component: SettingsView, meta: { title: '本地设置' } },
    { path: '/editor/:resultId', component: EditorView, meta: { title: '图片编辑器' } },
    { path: '/agent/execute/:planTaskId', component: AgentExecutionView, meta: { title: '确认计划并执行' } },
    { path: '/:pathMatch(.*)*', redirect: '/' }
  ],
  scrollBehavior: () => ({ top: 0 })
});

router.afterEach((to) => {
  document.title = `${to.meta.title} · Photo Studio`;
});
