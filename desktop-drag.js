(() => {
  const desktop = window.easyTickerDesktop;
  if (!desktop?.beginDrag || !desktop?.moveDrag || !desktop?.endDrag) return;

  let dragging = false;

  function pointFromEvent(event) {
    return { x: Math.round(event.screenX), y: Math.round(event.screenY) };
  }

  document.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    const row = event.target.closest("#list li:not(.tip)");
    if (!row) return;

    dragging = true;
    event.preventDefault();
    desktop.beginDrag(pointFromEvent(event));
  });

  document.addEventListener("mousemove", (event) => {
    if (!dragging) return;
    event.preventDefault();
    desktop.moveDrag(pointFromEvent(event));
  });

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    desktop.endDrag();
  }

  document.addEventListener("mouseup", endDrag);
  window.addEventListener("blur", endDrag);
})();
