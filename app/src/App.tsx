import { ThemeProvider } from '@amazon-devices/kepler-ui-components';
import { useHideSplashScreenCallback } from '@amazon-devices/react-native-kepler';
import React, { useEffect, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { COLORS } from './styles/palette';
import { createTheme } from './styles/theme';
import { scaleUxToDp } from './utils/pixelUtils';

const App = () => {
  const hideSplashScreen = useHideSplashScreenCallback();
  const theme = useMemo(() => createTheme(), []);

  useEffect(() => {
    hideSplashScreen();
  }, [hideSplashScreen]);

  return (
    <ThemeProvider theme={theme}>
      <View style={styles.root}>
        <Text style={styles.title}>Every Seat</Text>
      </View>
    </ThemeProvider>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.BACKGROUND,
  },
  title: {
    color: COLORS.TEXT,
    fontSize: scaleUxToDp(72),
  },
});

export default App;
