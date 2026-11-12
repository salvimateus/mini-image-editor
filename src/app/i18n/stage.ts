/** UI text of the stage: the image area, the Hand and Zoom tools. */
export const ptBR = {
  'stage.label': 'Área da imagem',
  'stage.hint.handDrag': 'Mover a vista',
  'stage.hint.zoomIn': 'Aproximar no ponto',
  'stage.hint.zoomOut': 'Afastar no ponto',
  'stage.hint.wheel': 'Zoom no ponteiro',
  'stage.hint.pan': 'Mover a vista',
} as const;

export const en: Record<keyof typeof ptBR, string> = {
  'stage.label': 'Image area',
  'stage.hint.handDrag': 'Move the view',
  'stage.hint.zoomIn': 'Zoom in at the point',
  'stage.hint.zoomOut': 'Zoom out at the point',
  'stage.hint.wheel': 'Zoom at the pointer',
  'stage.hint.pan': 'Move the view',
};
