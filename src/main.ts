import '@fontsource-variable/nunito';
import './styles/tokens.css';
import './styles/themes.css';
import './styles/reset.css';
import './styles/base.css';
import { mount } from 'svelte';
import App from './ui/App.svelte';
import { initLanguage, setLanguage } from './app/i18n/language.svelte.ts';
import { installAudioUnlock } from './app/sfx.ts';
import { app } from './app/state.svelte.ts';
import { initTheme, setTheme } from './app/theme.svelte.ts';
import { initUiSize } from './app/ui-size.svelte.ts';
import { TOOLS } from './app/tools/index.ts';
import { runAction } from './app/actions/index.ts';

initLanguage();
installAudioUnlock();
initTheme();

if (import.meta.env.DEV) (window as unknown as { __mie: unknown }).__mie = { app, TOOLS, runAction, setTheme, setLanguage };

// The desktop webview zoom is native and async: it lands before the first render, so the interface never jumps.
await initUiSize();

const target = document.getElementById('app');
if (!target) throw new Error('#app is missing in index.html');

export default mount(App, { target });
