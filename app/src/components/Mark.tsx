import React from 'react';
import { Image, StyleSheet } from 'react-native';
import { radius } from '../styles/tokens';

const SOURCE = require('../../assets/image/EverySeat.png');

type Props = {
  size: number;
  rounded?: number;
};

/** The app mark: three armchairs, the middle one lit. Decorative, so it is hidden from readers. */
const Mark = ({ size, rounded = radius.md }: Props) => (
  <Image
    source={SOURCE}
    accessible={false}
    style={[styles.mark, { width: size, height: size, borderRadius: rounded }]}
  />
);

const styles = StyleSheet.create({
  mark: {
    resizeMode: 'cover',
  },
});

export default Mark;
