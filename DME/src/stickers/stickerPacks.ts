/**
 * stickerPacks.ts
 * Curated sticker packs using real public Google Noto Emoji Animated Lottie JSON URLs.
 * 
 * Total: 4 packs of 12 stickers each = 48 premium animated stickers.
 */

export interface Sticker {
  id: string;
  name: string;
  url: string; // Direct Lottie JSON URL
}

export interface StickerPack {
  id: string;
  name: string;
  emoji: string; // Tab icon emoji
  stickers: Sticker[];
}

export const BUILT_IN_STICKER_PACKS: StickerPack[] = [
  {
    id: 'reactions',
    name: 'Reactions',
    emoji: '❤️',
    stickers: [
      { id: 'heart', name: 'Heart ❤️', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/2764_fe0f/lottie.json' },
      { id: 'sparkles', name: 'Sparkles ✨', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/2728/lottie.json' },
      { id: 'fire', name: 'Fire 🔥', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f525/lottie.json' },
      { id: 'hundred', name: '100 💯', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f4af/lottie.json' },
      { id: 'collision', name: 'Boom 💥', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f4a5/lottie.json' },
      { id: 'thumbsup', name: 'Like 👍', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f44d/lottie.json' },
      { id: 'thumbsdown', name: 'Dislike 👎', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f44e/lottie.json' },
      { id: 'clap', name: 'Clap 👏', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f44f/lottie.json' },
      { id: 'handshake', name: 'Shake 🤝', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f91d/lottie.json' },
      { id: 'biceps', name: 'Flex 💪', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f4aa/lottie.json' },
      { id: 'hearthands', name: 'Love 🫶', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1faf6/lottie.json' },
      { id: 'eyes', name: 'Eyes 👀', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f440/lottie.json' },
    ],
  },
  {
    id: 'faces',
    name: 'Faces',
    emoji: '😄',
    stickers: [
      { id: 'grin', name: 'Grin 😀', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f600/lottie.json' },
      { id: 'joy', name: 'Joy 😂', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f602/lottie.json' },
      { id: 'lovehearts', name: 'Hearts 🥰', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f970/lottie.json' },
      { id: 'hearteyes', name: 'Adore 😍', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f60d/lottie.json' },
      { id: 'kiss', name: 'Kiss 😘', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f618/lottie.json' },
      { id: 'tonguewink', name: 'Wink 😜', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f61c/lottie.json' },
      { id: 'shush', name: 'Shh 🤫', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f92b/lottie.json' },
      { id: 'thinking', name: 'Think 🤔', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f914/lottie.json' },
      { id: 'cool', name: 'Cool 😎', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f60e/lottie.json' },
      { id: 'nerd', name: 'Nerd 🤓', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f913/lottie.json' },
      { id: 'woozy', name: 'Woozy 🥴', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f974/lottie.json' },
      { id: 'party', name: 'Party 🥳', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f973/lottie.json' },
    ],
  },
  {
    id: 'greetings',
    name: 'Greetings',
    emoji: '👋',
    stickers: [
      { id: 'wave', name: 'Hi 👋', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f44b/lottie.json' },
      { id: 'raisinghands', name: 'Yay 🙌', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f64c/lottie.json' },
      { id: 'pray', name: 'Pray 🙏', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f64f/lottie.json' },
      { id: 'write', name: 'Write ✍️', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/270d_fe0f/lottie.json' },
      { id: 'selfie', name: 'Selfie 🤳', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f933/lottie.json' },
      { id: 'nails', name: 'Nails 💅', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f485/lottie.json' },
      { id: 'balloon', name: 'Balloon 🎈', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f388/lottie.json' },
      { id: 'popper', name: 'Popper 🎉', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f389/lottie.json' },
      { id: 'trophy', name: 'Win 🏆', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f3c6/lottie.json' },
      { id: 'ribbon', name: 'Gift 🎀', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f380/lottie.json' },
      { id: 'gift', name: 'Present 🎁', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f381/lottie.json' },
      { id: 'ok', name: 'OK 👌', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f44c/lottie.json' },
    ],
  },
  {
    id: 'emotions',
    name: 'Emotions',
    emoji: '😭',
    stickers: [
      { id: 'pleading', name: 'Please 🥺', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f97a/lottie.json' },
      { id: 'cry', name: 'Cry 😢', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f622/lottie.json' },
      { id: 'loudlycry', name: 'Sob 😭', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f62d/lottie.json' },
      { id: 'scream', name: 'Shock 😱', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f631/lottie.json' },
      { id: 'sweatgrin', name: 'Phew 😅', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f605/lottie.json' },
      { id: 'angry', name: 'Angry 😡', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f621/lottie.json' },
      { id: 'cursing', name: 'Swear 🤬', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f92c/lottie.json' },
      { id: 'explode', name: 'Boom 🤯', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f92f/lottie.json' },
      { id: 'sleepy', name: 'Zzz 😴', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f634/lottie.json' },
      { id: 'mask', name: 'Sick 😷', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f637/lottie.json' },
      { id: 'dizzy', name: 'Dizzy 😵', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f635/lottie.json' },
      { id: 'facepalm', name: 'Oops 🤦', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f926/lottie.json' },
    ],
  },
];
