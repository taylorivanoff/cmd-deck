const { app } = require('electron');

/**
 * Log native window dimensions while developing. Packaged builds stay quiet.
 */
function attachResizeLogging(win, label) {
  if (app.isPackaged || !win || win.isDestroyed()) return;

  win.on('resize', () => {
    if (win.isDestroyed()) return;
    const { x, y, width, height } = win.getBounds();
    console.log(`[CmdDeck] ${label} resized: ${width}x${height} at ${x},${y}`);
  });
}

module.exports = { attachResizeLogging };
