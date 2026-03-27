import { createRoot } from 'react-dom/client';
import { TranslationPanel } from './content/TranslationPanel';

if (!document.getElementById('realtime-translator-root')) {
  const container = document.createElement('div');
  container.id = 'realtime-translator-root';
  const shadow = container.attachShadow({ mode: 'open' });
  const mountPoint = document.createElement('div');
  shadow.appendChild(mountPoint);
  document.body.appendChild(container);

  createRoot(mountPoint).render(<TranslationPanel />);
}
