import '@fontsource-variable/nunito';
import './styles/tokens.css';
import './styles/reset.css';
import './styles/base.css';
import { mount } from 'svelte';
import App from './ui/App.svelte';
import { locale } from './app/i18n/index.ts';
import { installAudioUnlock } from './app/sfx.ts';
import { app } from './app/state.svelte.ts';
import { TOOLS } from './app/tools/index.ts';
import { runAction } from './app/actions/index.ts';

document.documentElement.lang = locale;
installAudioUnlock();

if (import.meta.env.DEV) (window as unknown as { __mie: unknown }).__mie = { app, TOOLS, runAction };

const target = document.getElementById('app');
if (!target) throw new Error('#app is missing in index.html');

export default mount(App, { target });
