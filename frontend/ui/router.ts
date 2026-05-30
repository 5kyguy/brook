import type { RouteDefinition, RouteId } from "../types";

export const ROUTES: RouteDefinition[] = [
  { id: "library", path: "/library", label: "Library" },
  { id: "recent", path: "/recent", label: "Recent" },
  { id: "stats", path: "/stats", label: "Stats" },
  { id: "settings", path: "/settings", label: "Settings" },
  { id: "playlist", path: "/userplaylist", label: "Playlist" },
];

const routeByPath = new Map(ROUTES.map((route) => [route.path, route]));
const routeById = new Map(ROUTES.map((route) => [route.id, route]));

export type RouteHandler = (route: RouteDefinition) => void;

export class Router {
  private handler: RouteHandler | null = null;
  private playlistId: string | null = null;

  start(handler: RouteHandler): void {
    this.handler = handler;
    window.addEventListener("popstate", () => this.dispatchCurrent());
    this.dispatchCurrent();
  }

  navigate(routeId: RouteId, push = true): void {
    const route = routeById.get(routeId);
    if (!route) return;
    let path = route.path;
    if (routeId === "playlist" && this.playlistId) {
      path = `/userplaylist/${this.playlistId}`;
    }
    if (push && window.location.pathname !== path) {
      window.history.pushState({}, "", path);
    }
    this.dispatch(route);
  }

  openPlaylist(id: string): void {
    this.playlistId = id;
    if (window.location.pathname !== `/userplaylist/${id}`) {
      window.history.pushState({}, "", `/userplaylist/${id}`);
    }
    this.dispatch(routeById.get("playlist")!);
  }

  private dispatchCurrent(): void {
    this.dispatch(pathToRoute(window.location.pathname));
  }

  private dispatch(route: RouteDefinition): void {
    const path = window.location.pathname;
    const playlistMatch = path.match(/^\/userplaylist\/([^/]+)/);
    if (playlistMatch) {
      this.playlistId = playlistMatch[1];
      route = routeById.get("playlist")!;
    }

    document.querySelectorAll(".sidebar-nav .nav-item a").forEach((link) => {
      const href = link.getAttribute("href");
      const active =
        route.id === "playlist"
          ? path.startsWith("/userplaylist/")
          : href === route.path;
      link.classList.toggle("active", active);
    });

    document.querySelectorAll(".page").forEach((page) => {
      const active =
        route.id === "playlist"
          ? page.id === "page-playlist"
          : page.id === `page-${route.id}`;
      page.classList.toggle("active", active);
    });

    this.handler?.(route);
  }
}

function pathToRoute(pathname: string): RouteDefinition {
  if (pathname.startsWith("/userplaylist/")) {
    return routeById.get("playlist")!;
  }
  return routeByPath.get(pathname) ?? routeById.get("library")!;
}

export function bindSidebarNavigation(router: Router): void {
  document.querySelectorAll(".sidebar-nav .nav-item a").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const href = link.getAttribute("href");
      if (!href) return;
      if (href.startsWith("/userplaylist")) return;
      const route = routeByPath.get(href);
      if (route) router.navigate(route.id);
    });
  });
}
