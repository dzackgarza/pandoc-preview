// Svelte action that relocates an element's DOM node into a target container.
//
// Used to mount Svelte-owned component subtrees (EditorPane, PreviewPane,
// FileTree) into dockview panel elements without re-mounting the components:
// Svelte keeps full ownership (binds, reactive props, callbacks all intact);
// only the DOM node is moved. On destroy the node is returned to its original
// parent so Svelte's own teardown can remove it cleanly.

export function portal(node: HTMLElement, target: HTMLElement | null) {
  const originalParent = node.parentNode;
  const originalNextSibling = node.nextSibling;

  function mount(into: HTMLElement | null) {
    if (into) {
      into.appendChild(node);
    }
  }

  mount(target);

  return {
    update(next: HTMLElement | null) {
      mount(next);
    },
    destroy() {
      // Return the node whence it came so Svelte can unmount it normally.
      if (originalParent) {
        originalParent.insertBefore(node, originalNextSibling);
      }
    },
  };
}
