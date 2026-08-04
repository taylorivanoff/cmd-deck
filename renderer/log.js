(() => {
  const list = document.getElementById('list');

  function renderEmpty() {
    list.innerHTML = '<div class="empty">No activity yet. Run a macro to see events here.</div>';
  }

  function appendEntry(entry, { scroll } = { scroll: true }) {
    if (list.querySelector('.empty')) list.innerHTML = '';
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.id = entry.id;

    const time = document.createElement('div');
    time.className = 'time';
    time.textContent = entry.time;

    const level = document.createElement('div');
    level.className = `level ${entry.level || 'info'}`;
    level.textContent = entry.level || 'info';

    const message = document.createElement('div');
    message.className = 'message';
    message.textContent = entry.message || '';

    row.append(time, level, message);
    list.appendChild(row);

    if (scroll) {
      list.scrollTop = list.scrollHeight;
    }
  }

  async function init() {
    const entries = await window.cmdDeckLog.getLogs();
    if (!entries?.length) {
      renderEmpty();
    } else {
      list.innerHTML = '';
      for (const entry of entries) appendEntry(entry, { scroll: false });
      list.scrollTop = list.scrollHeight;
    }

    window.cmdDeckLog.onEntry((entry) => {
      if (!entry) return;
      appendEntry(entry, { scroll: true });
    });
  }

  document.getElementById('btn-clear').addEventListener('click', async () => {
    await window.cmdDeckLog.clearLogs();
    renderEmpty();
  });

  document.getElementById('btn-close').addEventListener('click', () => window.close());

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') window.close();
  });

  init().catch((err) => console.error(err));
})();
