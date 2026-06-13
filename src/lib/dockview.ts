// Fixed resizable-pane layout via dockview-core's SplitviewComponent.
//
// The layout is a horizontal Splitview of editor | preview (the sidebar is a
// sibling OUTSIDE the splitview — see App.svelte). dockview owns the sashes
// (`.dv-sash`), the proportional relayout on container resize (SplitviewComponent
// extends Resizable, which carries its own ResizeObserver), and disabling iframe
// pointer-events during a sash drag (splitview.js calls disableIframePointEvents
// on sash pointerdown and releases on pointerup).
//
// Each panel exposes a child element carrying `data-pane="..."`; that element is
// the portal target the Svelte components are relocated into, and the element the
// proof harness (tests/proof/support/layout.ts) measures.

import {
  SplitviewComponent,
  SplitviewPanel,
  Orientation,
} from 'dockview-core';
import 'dockview-core/dist/styles/dockview.css';

export type PaneId = 'editor' | 'preview';

// A SplitviewPanel whose body is a single data-pane element. getComponent()
// returns the IFrameworkPart dockview drives: update/dispose are no-ops because
// the panel's content is owned by Svelte via the portal action, not by dockview.
class PanePanel extends SplitviewPanel {
  readonly pane: HTMLElement;

  constructor(id: string, component: string) {
    super(id, component);
    const pane = document.createElement('div');
    pane.dataset.pane = component;
    pane.style.height = '100%';
    pane.style.width = '100%';
    this.pane = pane;
  }

  getComponent() {
    this.element.appendChild(this.pane);
    return {
      update: () => {
        // No params flow through dockview; Svelte owns the portal contents.
      },
      dispose: () => {
        // The portal action removes its node on its own destroy.
      },
    };
  }
}

export interface SplitLayout {
  component: SplitviewComponent;
  editorPane: HTMLElement;
  previewPane: HTMLElement;
  dispose: () => void;
}

// Build the editor|preview splitview inside `container`. The two pane elements
// (carrying data-pane) are returned for the portal action to mount into.
export function createSplitLayout(container: HTMLElement): SplitLayout {
  const panes = new Map<PaneId, HTMLElement>();

  const component = new SplitviewComponent(container, {
    orientation: Orientation.HORIZONTAL,
    proportionalLayout: true,
    createComponent: (options) => {
      const panel = new PanePanel(options.id, options.name);
      panes.set(options.name as PaneId, panel.pane);
      return panel;
    },
  });

  // Editor and preview split the available width 50/50 initially. minimumSize
  // keeps either pane from collapsing entirely under a drag.
  component.addPanel({ id: 'editor', component: 'editor', minimumSize: 120 });
  component.addPanel({ id: 'preview', component: 'preview', minimumSize: 120 });

  const editorPane = panes.get('editor');
  const previewPane = panes.get('preview');
  if (!editorPane || !previewPane) {
    throw new Error('dockview: editor/preview panes were not created');
  }

  // Initial layout against the container's current box; the Resizable
  // ResizeObserver tracks every subsequent resize (including sidebar toggles).
  const rect = container.getBoundingClientRect();
  component.layout(rect.width, rect.height);

  return {
    component,
    editorPane,
    previewPane,
    dispose: () => component.dispose(),
  };
}
