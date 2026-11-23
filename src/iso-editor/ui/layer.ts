// Where the editor puts what floats over it (menus, dialogs, the keyboard sheet): inside its own root, so its styles
// apply and disposing the editor removes them. The root of the editor last used (mount.ts sets it on focus and at
// mount); document.body only when no editor is mounted (the Node tests).

let current: HTMLElement | null = null;
export function setLayer(el: HTMLElement | null) { current = el; }
export function layer(): HTMLElement { return current && current.isConnected ? current : document.body; }
