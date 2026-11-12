/** UI text of the shared shell: app name, toasts, dialogs, base fields and the welcome screen. */
export const ptBR = {
  'app.name': 'Mini Image Editor',
  'app.logoAlt': 'Logo do Mini Image Editor',
  'app.mainLabel': 'Área de trabalho',

  'common.cancel': 'Cancelar',
  'common.close': 'Fechar',

  'sound.mute': 'Desligar sons',
  'sound.unmute': 'Ligar sons',

  'toast.close': 'Fechar aviso',
  'toast.notImage': 'Não deu para abrir este arquivo como imagem. Use PNG, JPG, WebP, GIF ou BMP.',
  'toast.skippedFiles': '{count} arquivos ficaram de fora porque não são imagens.',
  'toast.nothingToPaste': 'Não há imagem na área de transferência. Copie uma imagem e tente de novo.',

  'error.read': 'Não deu para abrir este arquivo. Tente outro arquivo de imagem.',

  'confirm.cancel': 'Cancelar',

  'fileName.label': 'Nome do arquivo',
  'fileName.rename': 'Renomear arquivo',
  'fileName.empty': 'Digite um nome.',
  'fileName.chars': 'O nome não pode ter estes caracteres: \\ / : * ? " < > |',
  'fileName.end': 'O nome não pode terminar com ponto ou espaço.',
  'fileName.reserved': 'O Windows reserva este nome (CON, PRN, AUX, NUL, COM1 a COM9, LPT1 a LPT9). Escolha outro.',
  'fileName.long': 'Use no máximo {max} caracteres.',

  'size.pending': 'Calculando…',
  'size.plain': 'Peso do arquivo: {size}',
  'size.delta': 'Sem otimizar: {before}. Otimizado: {after}, {pct}% menor.',

  'progress.working': 'Trabalhando…',

  'slider.reset': 'Clique duas vezes no nome para voltar a {value}.',

  'welcome.title': 'Mini Image Editor',
  'welcome.tagline': 'Abra uma imagem, edite rapidinho e exporte.',
  'welcome.zone': 'Arraste uma imagem para cá',
  'welcome.zoneRelease': 'Pode soltar!',
  'welcome.open': 'Abrir imagem',
  'welcome.new': 'Nova imagem',
  'welcome.paste': 'Ou cole uma imagem com',
  'welcome.formats': 'PNG, JPG, WebP, GIF ou BMP',
  'welcome.privacy': 'Sua imagem nunca sai do seu computador.',
  'welcome.inputLabel': 'Escolher uma imagem',
} as const;

export const en: Record<keyof typeof ptBR, string> = {
  'app.name': 'Mini Image Editor',
  'app.logoAlt': 'Mini Image Editor logo',
  'app.mainLabel': 'Workspace',

  'common.cancel': 'Cancel',
  'common.close': 'Close',

  'sound.mute': 'Turn sounds off',
  'sound.unmute': 'Turn sounds on',

  'toast.close': 'Close message',
  'toast.notImage': 'This file could not be opened as an image. Use PNG, JPG, WebP, GIF or BMP.',
  'toast.skippedFiles': '{count} files were left out because they are not images.',
  'toast.nothingToPaste': 'There is no image on the clipboard. Copy an image and try again.',

  'error.read': 'This file could not be opened. Try another image file.',

  'confirm.cancel': 'Cancel',

  'fileName.label': 'File name',
  'fileName.rename': 'Rename file',
  'fileName.empty': 'Type a name.',
  'fileName.chars': 'The name cannot have these characters: \\ / : * ? " < > |',
  'fileName.end': 'The name cannot end with a dot or a space.',
  'fileName.reserved': 'Windows reserves this name (CON, PRN, AUX, NUL, COM1 to COM9, LPT1 to LPT9). Choose another.',
  'fileName.long': 'Use {max} characters or fewer.',

  'size.pending': 'Calculating…',
  'size.plain': 'File size: {size}',
  'size.delta': 'Not optimized: {before}. Optimized: {after}, {pct}% smaller.',

  'progress.working': 'Working…',

  'slider.reset': 'Double-click the name to go back to {value}.',

  'welcome.title': 'Mini Image Editor',
  'welcome.tagline': 'Open an image, make a quick edit and export it.',
  'welcome.zone': 'Drag an image here',
  'welcome.zoneRelease': 'Drop it!',
  'welcome.open': 'Open image',
  'welcome.new': 'New image',
  'welcome.paste': 'Or paste an image with',
  'welcome.formats': 'PNG, JPG, WebP, GIF or BMP',
  'welcome.privacy': 'Your image never leaves your computer.',
  'welcome.inputLabel': 'Choose an image',
};
