import { openExternal } from "../api/open";

const PROFILE_URL = "https://github.com/5kyguy";
const REPO_URL = "https://github.com/5kyguy/brook";

export function initAboutPage(): void {
  const version = document.getElementById("about-version");
  if (version) version.textContent = `v${__BROOK_VERSION__}`;

  for (const link of document.querySelectorAll<HTMLAnchorElement>("#page-about a[href]")) {
    const href = link.getAttribute("href") ?? "";
    if (href !== PROFILE_URL && href !== REPO_URL) continue;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      void openExternal(href);
    });
  }
}
