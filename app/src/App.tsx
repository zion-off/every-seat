import { ThemeProvider } from '@amazon-devices/kepler-ui-components';
import { useHideSplashScreenCallback } from '@amazon-devices/react-native-kepler';
import React, { useEffect, useMemo } from 'react';
import { DEFAULT_TITLE } from './config';
import PlayerScreen from './screens/PlayerScreen';
import { createTheme } from './styles/theme';

const App = () => {
  const hideSplashScreen = useHideSplashScreenCallback();
  const theme = useMemo(() => createTheme(), []);

  useEffect(() => {
    hideSplashScreen();
  }, [hideSplashScreen]);

  return (
    <ThemeProvider theme={theme}>
      <PlayerScreen title={DEFAULT_TITLE} />
    </ThemeProvider>
  );
};

export default App;
