import { ImageSourcePropType } from 'react-native';

export type AvatarCategory = 'all';

export interface PresetAvatar {
  id: string;
  label: string;
  category: AvatarCategory;
  bgColor: string;
  gradient: [string, string];
  image: ImageSourcePropType;
}

export const PRESET_AVATARS: Record<string, ImageSourcePropType> = {
  // 32 Unified Apple 3D Memoji Avatars
  h1: require('../assets/avatars/human_1.png'),
  h2: require('../assets/avatars/human_2.png'),
  h3: require('../assets/avatars/human_3.png'),
  h4: require('../assets/avatars/human_4.png'),
  h5: require('../assets/avatars/human_5.png'),
  h6: require('../assets/avatars/human_6.png'),
  h7: require('../assets/avatars/human_7.png'),
  h8: require('../assets/avatars/human_8.png'),
  h9: require('../assets/avatars/human_9.png'),
  h10: require('../assets/avatars/human_10.png'),
  h11: require('../assets/avatars/human_11.png'),
  h12: require('../assets/avatars/human_12.png'),
  h13: require('../assets/avatars/human_13.png'),
  h14: require('../assets/avatars/human_14.png'),
  h15: require('../assets/avatars/human_15.png'),
  h16: require('../assets/avatars/human_16.png'),
  h17: require('../assets/avatars/human_17.png'),
  h18: require('../assets/avatars/human_18.png'),
  h19: require('../assets/avatars/human_19.png'),
  h20: require('../assets/avatars/human_20.png'),
  h21: require('../assets/avatars/human_21.png'),
  h22: require('../assets/avatars/human_22.png'),
  h23: require('../assets/avatars/human_23.png'),
  h24: require('../assets/avatars/human_24.png'),
  h25: require('../assets/avatars/human_25.png'),
  h26: require('../assets/avatars/human_26.png'),
  h27: require('../assets/avatars/human_27.png'),
  h28: require('../assets/avatars/human_28.png'),
  h29: require('../assets/avatars/human_29.png'),
  h30: require('../assets/avatars/human_30.png'),
  h31: require('../assets/avatars/human_31.png'),
  h32: require('../assets/avatars/human_32.png'),
};

// 32 Unified 100% Apple 3D Memoji Avatars with Soft, Elegant Pastel Gradients
export const ALL_PRESET_AVATARS: PresetAvatar[] = [
  // Row 1: The Top 4 requested avatars
  { id: 'h3', label: 'Marcus', category: 'all', bgColor: '#FDE68A', gradient: ['#FDE68A', '#F59E0B'], image: PRESET_AVATARS.h3 },
  { id: 'h30', label: 'Isla', category: 'all', bgColor: '#FBCFE8', gradient: ['#FBCFE8', '#F472B6'], image: PRESET_AVATARS.h30 },
  { id: 'h6', label: 'Leo', category: 'all', bgColor: '#FED7AA', gradient: ['#FED7AA', '#FB923C'], image: PRESET_AVATARS.h6 },
  { id: 'h9', label: 'Noah', category: 'all', bgColor: '#BAE6FD', gradient: ['#BAE6FD', '#38BDF8'], image: PRESET_AVATARS.h9 },

  // Remaining 28 avatars with curated soft paired gradients
  { id: 'h16', label: 'Ava', category: 'all', bgColor: '#DDD6FE', gradient: ['#DDD6FE', '#A78BFA'], image: PRESET_AVATARS.h16 },
  { id: 'h1', label: 'Julian', category: 'all', bgColor: '#BFDBFE', gradient: ['#BFDBFE', '#60A5FA'], image: PRESET_AVATARS.h1 },
  { id: 'h2', label: 'Zayn', category: 'all', bgColor: '#C7D2FE', gradient: ['#C7D2FE', '#818CF8'], image: PRESET_AVATARS.h2 },
  { id: 'h4', label: 'Maya', category: 'all', bgColor: '#E9D5FF', gradient: ['#E9D5FF', '#C084FC'], image: PRESET_AVATARS.h4 },
  { id: 'h5', label: 'Alex', category: 'all', bgColor: '#99F6E4', gradient: ['#99F6E4', '#2DD4BF'], image: PRESET_AVATARS.h5 },
  { id: 'h7', label: 'Liam', category: 'all', bgColor: '#A7F3D0', gradient: ['#A7F3D0', '#34D399'], image: PRESET_AVATARS.h7 },
  { id: 'h8', label: 'Chloe', category: 'all', bgColor: '#FECDD3', gradient: ['#FECDD3', '#FB7185'], image: PRESET_AVATARS.h8 },
  { id: 'h10', label: 'Zoe', category: 'all', bgColor: '#FBCFE8', gradient: ['#FBCFE8', '#F472B6'], image: PRESET_AVATARS.h10 },
  { id: 'h11', label: 'Ethan', category: 'all', bgColor: '#6EE7B7', gradient: ['#6EE7B7', '#10B981'], image: PRESET_AVATARS.h11 },
  { id: 'h12', label: 'Kai', category: 'all', bgColor: '#BAE6FD', gradient: ['#BAE6FD', '#38BDF8'], image: PRESET_AVATARS.h12 },
  { id: 'h13', label: 'Lucas', category: 'all', bgColor: '#BFDBFE', gradient: ['#BFDBFE', '#60A5FA'], image: PRESET_AVATARS.h13 },
  { id: 'h14', label: 'Mia', category: 'all', bgColor: '#FECDD3', gradient: ['#FECDD3', '#FB7185'], image: PRESET_AVATARS.h14 },
  { id: 'h15', label: 'Oliver', category: 'all', bgColor: '#FDE68A', gradient: ['#FDE68A', '#F59E0B'], image: PRESET_AVATARS.h15 },
  { id: 'h17', label: 'Sophia', category: 'all', bgColor: '#FBCFE8', gradient: ['#FBCFE8', '#F472B6'], image: PRESET_AVATARS.h17 },
  { id: 'h18', label: 'Aria', category: 'all', bgColor: '#E9D5FF', gradient: ['#E9D5FF', '#C084FC'], image: PRESET_AVATARS.h18 },
  { id: 'h19', label: 'Elena', category: 'all', bgColor: '#99F6E4', gradient: ['#99F6E4', '#2DD4BF'], image: PRESET_AVATARS.h19 },
  { id: 'h20', label: 'Daniel', category: 'all', bgColor: '#C7D2FE', gradient: ['#C7D2FE', '#818CF8'], image: PRESET_AVATARS.h20 },
  { id: 'h21', label: 'Jayden', category: 'all', bgColor: '#BAE6FD', gradient: ['#BAE6FD', '#38BDF8'], image: PRESET_AVATARS.h21 },
  { id: 'h22', label: 'Caleb', category: 'all', bgColor: '#DDD6FE', gradient: ['#DDD6FE', '#A78BFA'], image: PRESET_AVATARS.h22 },
  { id: 'h23', label: 'Mason', category: 'all', bgColor: '#A7F3D0', gradient: ['#A7F3D0', '#34D399'], image: PRESET_AVATARS.h23 },
  { id: 'h24', label: 'Logan', category: 'all', bgColor: '#FED7AA', gradient: ['#FED7AA', '#FB923C'], image: PRESET_AVATARS.h24 },
  { id: 'h25', label: 'Stella', category: 'all', bgColor: '#FECDD3', gradient: ['#FECDD3', '#FB7185'], image: PRESET_AVATARS.h25 },
  { id: 'h26', label: 'Ruby', category: 'all', bgColor: '#E9D5FF', gradient: ['#E9D5FF', '#C084FC'], image: PRESET_AVATARS.h26 },
  { id: 'h27', label: 'Gabriel', category: 'all', bgColor: '#6EE7B7', gradient: ['#6EE7B7', '#10B981'], image: PRESET_AVATARS.h27 },
  { id: 'h28', label: 'Nora', category: 'all', bgColor: '#FBCFE8', gradient: ['#FBCFE8', '#F472B6'], image: PRESET_AVATARS.h28 },
  { id: 'h29', label: 'Arthur', category: 'all', bgColor: '#FDE68A', gradient: ['#FDE68A', '#F59E0B'], image: PRESET_AVATARS.h29 },
  { id: 'h31', label: 'Benjamin', category: 'all', bgColor: '#BFDBFE', gradient: ['#BFDBFE', '#60A5FA'], image: PRESET_AVATARS.h31 },
  { id: 'h32', label: 'Clara', category: 'all', bgColor: '#99F6E4', gradient: ['#99F6E4', '#2DD4BF'], image: PRESET_AVATARS.h32 },
];

export const AVATAR_FILTER_CHIPS: { key: AvatarCategory; label: string }[] = [
  { key: 'all', label: 'All 3D Memojis (32)' },
];

// Lookup map by ID
const AVATAR_MAP = new Map<string, PresetAvatar>();
ALL_PRESET_AVATARS.forEach(a => AVATAR_MAP.set(a.id, a));

// Aliases for backward compatibility with earlier presets & legacy emojis
const LEGACY_ID_MAP: Record<string, string> = {
  // Legacy category mappings to 3D Memojis
  cat: 'h1', dog: 'h2', panda: 'h3', fox: 'h5', lion: 'h6', bear: 'h7', rabbit: 'h8',
  owl: 'h9', eagle: 'h11', parrot: 'h12', penguin: 'h13', flamingo: 'h14', peacock: 'h16',
  ninja: 'h1', doctor: 'h5', doc: 'h5', health: 'h5', king: 'h2', prince: 'h2',
  princess: 'h17', queen: 'h17', astro: 'h11', cosmo: 'h11',
  mage: 'h3', wizard: 'h3', detect: 'h7', detective: 'h7', pilot: 'h15', aviator: 'h15',
  vampire: 'h18', elf: 'h19', robot: 'h13', alien: 'h12',
  // Legacy IDs
  s1: 'h1', s2: 'h5', s3: 'h17', s4: 'h11', s5: 'h3', s6: 'h7', s7: 'h15', s8: 'h18',
  a1: 'h1', a2: 'h2', a3: 'h3', a4: 'h5', a5: 'h6', a6: 'h7',
  b1: 'h9', b2: 'h11', b3: 'h12', b4: 'h13', b5: 'h14', b6: 'h16',
  boy: 'h1', girl: 'h4', man: 'h6', woman: 'h5', dev_m: 'h3', dev_w: 'h8', artist: 'h4',
  sophia: 'h17', alex: 'h5', alexa: 'h5', elena: 'h19', aria: 'h18', julian: 'h1', zayn: 'h2', kai: 'h12',
  marcus: 'h3', isla: 'h30', ava: 'h16', leo: 'h6', noah: 'h9',
  m1: 'h3', m2: 'h30', m3: 'h6', m4: 'h9', m5: 'h16', m6: 'h1',
  f1: 'h4', f2: 'h8', f3: 'h10', f4: 'h14', f5: 'h16', f6: 'h17',
  // Unicode emojis
  '🐱': 'h1', '🐶': 'h2', '🐼': 'h3', '🦊': 'h5', '🦁': 'h6', '🐻': 'h7',
  '🦉': 'h9', '🦅': 'h11', '🦜': 'h12', '🐧': 'h13', '🦩': 'h14', '🦚': 'h16',
  '🥷': 'h1', '🩺': 'h5', '👨‍⚕️': 'h5', '👩‍⚕️': 'h8', '👑': 'h17', '👸': 'h17', '🤴': 'h2',
  '🚀': 'h11', '🧙‍♂️': 'h3', '🧙': 'h3',
  '🕵️': 'h7', '🕵️‍♂️': 'h7', '👨‍✈️': 'h15', '🧛‍♀️': 'h18', '🧛': 'h18',
  '👨': 'h3', '👦': 'h9', '🧔': 'h6', '👨‍🎓': 'h3', '👨‍💼': 'h7', '👨‍💻': 'h9',
  '👩': 'h4', '👧': 'h8', '👩‍🦰': 'h10', '👩‍🎓': 'h14', '👩‍💼': 'h19', '👩‍💻': 'h16',
};

export const getPresetAvatarItem = (key?: string | null): PresetAvatar | null => {
  if (!key) return null;
  if (AVATAR_MAP.has(key)) return AVATAR_MAP.get(key)!;
  const mappedId = LEGACY_ID_MAP[key];
  if (mappedId && AVATAR_MAP.has(mappedId)) return AVATAR_MAP.get(mappedId)!;
  return null;
};

export const getPresetAvatar = (key?: string | null): ImageSourcePropType | null => {
  const item = getPresetAvatarItem(key);
  return item ? item.image : null;
};
