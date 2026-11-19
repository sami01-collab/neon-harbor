// NEON HARBOR — keyboard and mouse state. Tracks held keys, edge-triggered
// presses (consumed once per frame by the game loop), and the mouse position
// in canvas pixels plus the button state used for aiming and shooting.

export function createInput(canvas) {
  const down = new Set();
  const pressed = new Set();
  const mouse = { x: 0, y: 0, down: false, clicked: false };

  function onKeyDown(e) {
    // Ignore repeats: a held key is not a new press.
    if (!e.repeat) pressed.add(e.code);
    down.add(e.code);
    // Stop the page scrolling on game keys.
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      e.preventDefault();
    }
  }
  function onKeyUp(e) {
    down.delete(e.code);
  }
  function onMouseMove(e) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = e.clientX - rect.left;
    mouse.y = e.clientY - rect.top;
  }
  function onMouseDown(e) {
    if (e.button === 0) {
      mouse.down = true;
      mouse.clicked = true;
    }
  }
  function onMouseUp(e) {
    if (e.button === 0) mouse.down = false;
  }
  function onBlur() {
    down.clear();
    mouse.down = false;
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);

  return {
    mouse,
    isDown(code) {
      return down.has(code);
    },
    // True only on the frame the key went down.
    wasPressed(code) {
      return pressed.has(code);
    },
    // True if any of the given codes is held.
    anyDown(...codes) {
      return codes.some((c) => down.has(c));
    },
    // True if any of the given codes was pressed this frame.
    anyPressed(...codes) {
      return codes.some((c) => pressed.has(c));
    },
    // Call at the end of each frame so presses do not linger.
    endFrame() {
      pressed.clear();
      mouse.clicked = false;
    },
    // Test helper: pretend a key is held or pressed.
    _testSet(code, held) {
      if (held) down.add(code);
      else down.delete(code);
    },
  };
}
