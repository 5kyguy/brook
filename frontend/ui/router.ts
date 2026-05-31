import type { RouteDefinition, RouteId } from "../types";

export const ROUTES: RouteDefinition[] = [
  { id: "library", path: "/library", label: "Library" },
  { id: "recent", path: "/recent", label: "Recent" },
  { id: "stats", path: "/stats", label: "Stats" },
  { id: "settings", path: "/settings", label: "Settings" },
  { id: "playlist", path: "/userplaylist", label: "Playlist" },
  { id: "search", path: "/search", label: "Search" },
  { id: "artist", path: "/artist", label: "Artist" },
  { id: "album", path: "/album", label: "Album" },
];

const routeByPath = new Map(ROUTES.map((route) => [route.path, route]));
const routeById = new Map(ROUTES.map((route) => [route.id, route]));

export type RouteHandler = (route: RouteDefinition, params: RouteParams) => void;

export interface RouteParams {
  playlistId: string | null;
  entityName: string | null;
  searchQuery: string | null;
}

export class Router {
  private handler: RouteHandler | null = null;
  private playlistId: string | null = null;
  private entityName: string | null = null;
  private searchQuery: string | null = null;

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
      path = `/userplaylist/${encodeURIComponent(this.playlistId)}`;
    } else if (routeId === "artist" && this.entityName) {
      path = `/artist/${encodeURIComponent(this.entityName)}`;
    } else if (routeId === "album" && this.entityName) {
      path = `/album/${encodeURIComponent(this.entityName)}`;
    } else if (routeId === "search") {
      path = this.searchQuery
        ? `/search?q=${encodeURIComponent(this.searchQuery)}`
        : "/search";
    }
    if (push && window.location.pathname + window.location.search !== path) {
      window.history.pushState({}, "", path);
    }
    this.dispatch(route);
  }

  openPlaylist(id: string): void {
    this.playlistId = id;
    this.entityName = null;
    const path = `/userplaylist/${encodeURIComponent(id)}`;
    if (window.location.pathname !== path) {
      window.history.pushState({}, "", path);
    }
    this.dispatch(routeById.get("playlist")!);
  }

  openArtist(name: string): void {
    this.entityName = name;
    this.playlistId = null;
    const path = `/artist/${encodeURIComponent(name)}`;
    window.history.pushState({}, "", path);
    this.dispatch(routeById.get("artist")!);
  }

  openAlbum(name: string): void {
    this.entityName = name;
    this.playlistId = null;
    const path = `/album/${encodeURIComponent(name)}`;
    window.history.pushState({}, "", path);
    this.dispatch(routeById.get("album")!);
  }

  openSearch(query: string): void {
    this.searchQuery = query;
    this.playlistId = null;
    this.entityName = null;
    const path = `/search?q=${encodeURIComponent(query)}`;
    window.history.pushState({}, "", path);
    this.dispatch(routeById.get("search")!);
  }

  getParams(): RouteParams {
    return {
      playlistId: this.playlistId,
      entityName: this.entityName,
      searchQuery: this.searchQuery,
    };
  }

  private dispatchCurrent(): void {
    this.dispatch(pathToRoute(window.location.pathname, window.location.search));
  }

  private dispatch(route: RouteDefinition): void {
    const path = window.location.pathname;
    const search = window.location.search;

    const playlistMatch = path.match(/^\/userplaylist\/([^/]+)/);
    if (playlistMatch) {
      this.playlistId = decodeURIComponent(playlistMatch[1]);
      route = routeById.get("playlist")!;
    }

    const artistMatch = path.match(/^\/artist\/([^/]+)/);
    if (artistMatch) {
      this.entityName = decodeURIComponent(artistMatch[1]);
      route = routeById.get("artist")!;
    }

    const albumMatch = path.match(/^\/album\/([^/]+)/);
    if (albumMatch) {
      this.entityName = decodeURIComponent(albumMatch[1]);
      route = routeById.get("album")!;
    }

    if (route.id === "search") {
      this.searchQuery = new URLSearchParams(search).get("q");
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
      let active = false;
      if (route.id === "playlist") active = page.id === "page-playlist";
      else if (route.id === "artist") active = page.id === "page-artist";
      else if (route.id === "album") active = page.id === "page-album";
      else if (route.id === "search") active = page.id === "page-search";
      else active = page.id === `page-${route.id}`;
      page.classList.toggle("active", active);
    });

    this.handler?.(route, this.getParams());
  }
}

function pathToRoute(pathname: string, search: string): RouteDefinition {
  if (pathname.startsWith("/userplaylist/")) return routeById.get("playlist")!;
  if (pathname.startsWith("/artist/")) return routeById.get("artist")!;
  if (pathname.startsWith("/album/")) return routeById.get("album")!;
  if (pathname === "/search" || pathname.startsWith("/search")) {
    return routeById.get("search")!;
  }
  return routeByPath.get(pathname) ?? routeById.get("library")!;
}

export function bindSidebarNavigation(router: Router): void {
  document.querySelectorAll(".sidebar-nav .nav-item a").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const href = link.getAttribute("href");
      if (!href) return;
      if (
        href.startsWith("/userplaylist") ||
        href.startsWith("/artist") ||
        href.startsWith("/album") ||
        href.startsWith("/search")
      ) {
        return;
      }
      const route = routeByPath.get(href);
      if (route) router.navigate(route.id);
    });
  });
}
