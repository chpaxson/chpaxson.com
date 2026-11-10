import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: "/",
      name: "home",
      component: HomeView,
    },
    {
      path: "/projects",
      name: "projects",
      component: () => import("../views/ProjectsView.vue"),
    },
    {
      path: "/projects/:id",
      name: "project-detail",
      component: () => import("../views/ProjectDetailView.vue"),
    },
    {
      path: "/tools",
      name: "tools",
      component: () => import("../views/ToolsView.vue"),
      meta: { title: "Tools | Charles Paxson" },
    },
    {
      path: "/bradym211",
      alias: "/bradym211.html",
      name: "label-studio",
      component: () => import("../brady/LabelStudio.vue"),
      meta: { title: "M211 Label Studio" },
    },
    {
      path: "/serialconsole",
      alias: "/serialconsole.html",
      name: "serial-console",
      component: () => import("../serial/SerialConsole.vue"),
      meta: { fullHeight: true, title: "Web Serial Console" },
    },
    {
      path: "/resume",
      name: "resume",
      component: () => import("../views/ResumeView.vue"),
    },
    {
      path: "/about",
      name: "about",
      // route level code-splitting
      // this generates a separate chunk (About.[hash].js) for this route
      // which is lazy-loaded when the route is visited.
      component: () => import("../views/AboutView.vue"),
    },
    {
      path: "/amc",
      name: "amc-home",
      component: () => import("../views/AMCHomeView.vue"),
    },
    {
      path: "/amc/:id",
      name: "amc-problem",
      component: () => import("../views/AMCProblemPage.vue"),
    },
  ],
});

export default router
