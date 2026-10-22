import { createThemeFromPartialTheme } from '@amazon-devices/kepler-ui-components';
import { COLORS } from './palette';

export const createTheme = () =>
  createThemeFromPartialTheme({
    typography: {
      text: {
        color: {
          display: COLORS.TEXT,
          headline: COLORS.TEXT,
          title: COLORS.TEXT,
          body: COLORS.TEXT,
          label: COLORS.TEXT,
        },
      },
    },
  });
