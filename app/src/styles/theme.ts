import { createThemeFromPartialTheme } from '@amazon-devices/kepler-ui-components';
import { colors, radius, size, space, type, weight } from './tokens';

const text = (color: string) => ({
  display: color,
  headline: color,
  title: color,
  body: color,
  label: color,
});

const sizes = (value: number) => ({ sm: value, md: value, lg: value });

/** Focus is drawn by the shared focus frame, so a button's fill does not change with it. */
const fills = (enabled: string, pressed: string) => ({
  contained: { enabled, pressed, disabled: colors.line },
  outlined: { enabled },
  transparent: { enabled },
});

const borders = (color: string) => ({
  contained: { enabled: color, focused: color, pressed: color },
  outlined: { enabled: color },
  transparent: { enabled: color },
});

const labels = (color: string) => ({
  contained: { enabled: color, pressed: color, disabled: colors.textMuted },
  outlined: { enabled: color, focused: color },
  transparent: { enabled: color, focused: color },
});

export const createTheme = () =>
  createThemeFromPartialTheme({
    typography: {
      text: {
        color: text(colors.text),
        fontWeight: { bold: weight.bold },
      },
      size: {
        fontSize: {
          display: sizes(type.display.fontSize),
          headline: sizes(type.title.fontSize),
          title: sizes(type.title.fontSize),
          body: sizes(type.body.fontSize),
          label: sizes(type.small.fontSize),
        },
      },
    },
    button: {
      container: {
        color: {
          backgroundColor: {
            primary: fills(colors.accent, colors.accentDeep),
            secondary: fills(colors.surfaceRaised, colors.surfaceFocused),
            tertiary: fills(colors.surface, colors.surfaceFocused),
          },
          borderColor: {
            primary: borders(colors.transparent),
            secondary: borders(colors.line),
            tertiary: borders(colors.line),
          },
          textColor: {
            primary: labels(colors.onAccent),
            secondary: labels(colors.text),
            tertiary: labels(colors.text),
          },
        },
        size: {
          height: { sm: size.buttonMd, md: size.buttonMd, lg: size.buttonLg },
          horizontalPadding: sizes(space.lg),
          borderWidth: sizes(size.border),
          borderRadius: sizes(radius.md),
          fontSize: sizes(type.body.fontSize),
        },
        text: { fontWeight: weight.bold },
      },
    },
    seekBar: {
      track: {
        color: { backgroundColor: colors.line },
        size: { borderRadius: radius.sm, height: size.seekTrack },
      },
      indicator: {
        color: { backgroundColor: colors.text },
        size: { borderRadius: radius.sm },
      },
      timeShift: {
        color: { backgroundColor: colors.textMuted },
        size: { borderRadius: radius.sm },
      },
    },
  });
