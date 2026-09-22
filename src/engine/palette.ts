// Soft pastel palette shared by every scene (Make Way-style clean arcade look:
// sage grass, cream sidewalks, friendly mint/peach/butter buildings — nothing
// harsh or muddy). Values are sRGB hex.
export const C = {
  skyTop: 0x93cdeb,
  skyBottom: 0xfdf4e3,
  sun: 0xfff4d6,
  grass: 0xa9c88b,
  grassAlt: 0x9abd7d,
  road: 0x8f97a3,
  roadLine: 0xf9f6ee,
  sidewalk: 0xe9e1cf,
  red: 0xe25c5c, // friendly service red
  redDeep: 0xc24747,
  orange: 0xf2984c,
  yellow: 0xf6c952,
  lime: 0x9cc76a,
  green: 0x7fae6a,
  teal: 0x63b0a8,
  blue: 0x7fb2d9,
  blueDeep: 0x5a92c4,
  purple: 0xa794cc,
  pink: 0xf0b6c6,
  cream: 0xf3ead6,
  white: 0xfaf7ef,
  brown: 0xa9805a,
  brownDark: 0x83624a,
  leaf: 0x8fbf72,
  leafLight: 0xa4cf85,
  dark: 0x5f6774,
  tire: 0x3c424c,
  silver: 0xd9dde2,
  glass: 0xc4e2ef,
  skin: 0xe8b992,
  fire1: 0xf4661f,
  fire2: 0xfb9224,
  fire3: 0xffd166,
  smoke: 0xb9c3cc,
  water: 0x7fc4de,
} as const;

export type Palette = typeof C;
