export type ThemeKey = 'blue' | 'green' | 'purple' | 'orange';

export interface Theme {
  key: ThemeKey;
  bg: string;
  card: string;
  cardHi: string;
  surface: string;
  border: string;
  text: string;
  textDim: string;
  textMute: string;
  primary: string;
  primaryDark: string;
  primaryDim: string;
  success: string;
  warning: string;
  danger: string;
}
