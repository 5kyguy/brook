declare module "*?svg&icon" {
  const icon: (size?: number, attrs?: Record<string, string>) => string;
  export default icon;
}

declare module "*?svg&icon&class=*" {
  const icon: (size?: number, attrs?: Record<string, string>) => string;
  export default icon;
}

declare module "!lucide/*.svg?svg&icon&class=heart-icon" {
  const icon: (size?: number, attrs?: Record<string, string>) => string;
  export default icon;
}

declare module "!lucide/*.svg?svg&icon&class=heart-icon+filled" {
  const icon: (size?: number, attrs?: Record<string, string>) => string;
  export default icon;
}

declare module "!lucide/*.svg?svg&icon" {
  const icon: (size?: number, attrs?: Record<string, string>) => string;
  export default icon;
}
