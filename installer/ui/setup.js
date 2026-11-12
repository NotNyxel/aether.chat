// Aether Setup window: drives the silent install and shows progress.
(() => {
  const { invoke } = window.__TAURI__.core;
  const win = window.__TAURI__.window.getCurrentWindow();
  const $ = (id) => document.getElementById(id);

  const tips = [
    'Tip: press Ctrl+K anywhere to jump to a friend, server or channel.',
    'Tip: click your name at the bottom left to switch status or accounts.',
    'Tip: share an invite as aether.chat/inv/yourcode, or just the code.',
    'Tip: Profile Studio has nameplates, frames and a profile board.',
    'Tip: Aether updates itself every time it starts.',
  ];
  let tipIndex = Math.floor(Math.random() * tips.length);
  const showTip = () => {
    $('tip').style.opacity = 0;
    setTimeout(() => {
      $('tip').textContent = tips[tipIndex++ % tips.length];
      $('tip').style.opacity = 1;
    }, 300);
  };

  let pct = 0;
  let timer = 0;
  const setPct = (v) => {
    pct = v;
    $('fill').style.width = `${v}%`;
  };
  // The installer runs silently, so progress is an honest estimate that eases toward 92% and
  // completes when the installer actually exits.
  const creep = () => {
    clearInterval(timer);
    timer = setInterval(() => setPct(pct + (92 - pct) * 0.06), 120);
  };
  const step = (n) => {
    ['s1', 's2', 's3'].forEach((id, i) => {
      $(id).className = i + 1 < n ? 'ok' : i + 1 === n ? 'on' : '';
    });
  };

  async function run() {
    document.body.classList.remove('err', 'done');
    $('close').disabled = true;
    setPct(4);
    step(1);
    $('status').textContent = 'Unpacking…';
    creep();
    setTimeout(() => {
      if (!document.body.classList.contains('err')) {
        step(2);
        $('status').textContent = 'Installing Aether…';
      }
    }, 700);
    try {
      const path = await invoke('install');
      clearInterval(timer);
      setPct(100);
      step(3);
      document.body.classList.add('done');
      $('status').textContent = 'All set! Opening Aether…';
      setTimeout(() => invoke('launch', { path }), 1100);
    } catch (e) {
      clearInterval(timer);
      document.body.classList.add('err');
      $('status').textContent = String(e);
      $('close').disabled = false;
    }
  }

  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.key === 'F5' || e.key === 'F12') e.preventDefault();
  });
  $('min').onclick = () => win.minimize();
  $('close').onclick = () => invoke('quit');
  $('cancel').onclick = () => invoke('quit');
  $('retry').onclick = () => run();

  showTip();
  setInterval(showTip, 4500);
  setTimeout(run, 450);
})();
