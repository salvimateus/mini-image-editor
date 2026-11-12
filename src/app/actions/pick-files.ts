import { IMAGE_ACCEPT } from '../state.svelte.ts';

/** Opens the system file picker for images. Resolves an empty list when the user cancels. */
export function pickImageFiles(multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = IMAGE_ACCEPT;
    input.multiple = multiple;
    input.className = 'visually-hidden';
    input.tabIndex = -1;
    const done = (files: File[]): void => {
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => done(Array.from(input.files ?? [])), { once: true });
    input.addEventListener('cancel', () => done([]), { once: true });
    document.body.append(input);
    input.click();
  });
}
