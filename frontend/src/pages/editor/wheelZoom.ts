export const bindCanvasWheelZoom = (container: HTMLDivElement | null) => {
  const handleWheel = (event: WheelEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const isCanvas = target.tagName?.toLowerCase() === "canvas";
    const isEditorUi =
      target.closest(".layer-ui__wrapper") !== null || target.closest(".App-menu") !== null;
    if (!isCanvas || isEditorUi || event.ctrlKey || event.metaKey || (event as any)._isFakeZoom) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const zoomEvent = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: event.clientX,
      clientY: event.clientY,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaMode: event.deltaMode,
      ctrlKey: true,
    });
    (zoomEvent as any)._isFakeZoom = true;
    target.dispatchEvent(zoomEvent);
  };
  container?.addEventListener("wheel", handleWheel, {
    capture: true,
    passive: false,
  });
  return () => container?.removeEventListener("wheel", handleWheel, { capture: true });
};
