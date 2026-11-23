import './style.css';
// Optional local file. Absence is expected in public checkouts and means Demo mode.
await new Promise(resolve => {
  const script = document.createElement('script');
  script.src = `${import.meta.env.BASE_URL}firebase-config.js`;
  script.onload = resolve;
  script.onerror = resolve;
  document.head.append(script);
});
await import('./app.js');
