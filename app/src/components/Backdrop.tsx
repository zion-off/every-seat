import React, { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from '../styles/tokens';
import Gradient from './Gradient';

/** The shared screen base: near-black navy with the lighter logo field fading in from the top. */
const Backdrop = ({ children }: { children: ReactNode }) => (
  <View style={styles.root}>
    <Gradient
      color={colors.backgroundTop}
      from="top"
      style={styles.wash}
      steps={32}
    />
    {children}
  </View>
);

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  wash: {
    top: 0,
    left: 0,
    right: 0,
    height: '60%',
  },
});

export default Backdrop;
