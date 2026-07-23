import { StyleProp, ViewStyle } from 'react-native';
import { SvgXml } from 'react-native-svg';

import { BS_ICONS, type BSIconName } from './bsIcons.generated';

type BSIconProps = {
  name: BSIconName;
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
};

// Ionicons-style wrapper around the custom BioSynCare icon set in assets/icons/.
// Icons are normalized at build time (npm run icons:generate) so their glyph
// follows `currentColor`; the `color` prop tints them.
export default function BSIcon({
  name,
  size = 24,
  color = '#012953',
  style,
}: BSIconProps) {
  const xml = BS_ICONS[name];
  if (!xml) {
    if (__DEV__) {
      console.warn(`BSIcon: unknown icon "${name}"`);
    }
    return null;
  }

  return (
    <SvgXml xml={xml} width={size} height={size} color={color} style={style} />
  );
}

export type { BSIconName };
