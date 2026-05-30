import type { RouteDefinition, RouteId } from "../types";

export const ROUTES: RouteDefinition[] = [
  { id: "library", path: "/library", label: "Library" },
  { id: "search", path: "/search", label: "Search" },
  { id: "stats", path: "/stats", label: "Stats" },
  { id: "settings", path: "/settings", label: "Settings" },
];

const routeByPath = new Map(ROUTES.map((route) => [route.path, route]));
const routeById = new Map(ROUTES.map((route) => [route.id, route]));

export type RouteHandler = (route: RouteDefinition) => void;

export class Router {
  private handler: RouteHandler | null = null;

  start(handler: RouteHandler): void {
    this.handler = handler;
    window.addEventListener("popstate", () => this.dispatchCurrent());
    this.navigate(pathToRoute(window.location.pathname).id, false);
  }

  navigate(routeId: RouteId, push = true): void {
    const route = routeById.get(routeId);
    if (!route) return;
    if (push && window.location.pathname !== route.path) {
      window.history.pushState({}, "", route.path);
    }
    this.dispatch(route);
  }

  private dispatchCurrent(): void {
    this.dispatch(pathToRoute(window.location.pathname));
  }

  private dispatch(route: RouteDefinition): void {
    document.querySelectorAll(".sidebar-nav .nav-item a").forEach((link) => {
      link.classList.toggle("active", link.getAttribute("href") === route.path);
    });
    document.querySelectorAll(".page").forEach((page) => {
      page.classList.toggle("active", page.id === `page-${route.id}`);
    });
    this.handler?.(route);
  }
}

function pathToRoute(pathname: string): RouteDefinition {
  return routeByPath.get(pathname) ?? routeById.get("library")!;
}

export function bindSidebarNavigation(router: Router): void {
  document.querySelectorAll(".sidebar-nav .nav-item a").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const href = link.getAttribute("href");
      if (!href) return;
      const route = routeByPath.get(href);
      if (route) router.navigate(route.id);
    });
  });
}
