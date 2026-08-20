/**
 * Finding the toolbar this editor rendered.
 *
 * Both the note button and its colours hang off that element, and it is
 * unmounted and rebuilt whenever the editor changes shape — entering zen mode,
 * crossing the mobile breakpoint — so anything anchored to it has to be told.
 */
import { useEffect, useState } from "react";
import type React from "react";

/**
 * The toolbar belonging to this editor.
 *
 * Scoped to the container rather than found with a document-wide search: two
 * editors on one page would otherwise both hang their button on the first one.
 */
export function useToolbarElement(containerRef: React.RefObject<HTMLElement>): HTMLElement | null {
  const [toolbar, setToolbar] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const find = () => {
      // The row of tools, not the toolbar's outer box: the outer box stacks its
      // children vertically, so a button appended there lands on a second row
      // underneath the tools rather than beside them.
      const toolbar = container.querySelector<HTMLElement>(".App-toolbar");
      const found =
        toolbar?.querySelector<HTMLElement>(".Stack_horizontal") ?? toolbar ?? null;
      setToolbar((current) => (current === found ? current : found));
    };

    find();
    // The toolbar is unmounted and rebuilt on things like entering zen mode or
    // crossing the mobile breakpoint, and the portal has to follow it.
    const observer = new MutationObserver(find);
    observer.observe(container, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [containerRef]);

  return toolbar;
}
