import React, { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from '../styles/tokens';
import Gradient from './Gradient';

type Props = {
  children: ReactNode;
  /** A flat base without the top wash, for screens whose picture fades into it. */
  plain?: boolean;
};

/** The shared screen base: near-black navy with the lighter logo field fading in from the top. */
const Backdrop = ({ children, plain }: Props) => (
  <View style={styles.root}>
    {!plain && (
      <Gradient
        color={colors.backgroundTop}
        from="top"
        style={styles.wash}
        steps={32}
      />
    )}
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
