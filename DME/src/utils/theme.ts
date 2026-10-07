// DME app theme system — WhatsApp-style light/dark mode
// ────────────────────────────────────────────────────────────

/** Shape of a resolved color palette (used by ThemeContext) */
export interface ThemeColors {
  // Primary / accent
  primary: string;
  primaryDark: string;
  primaryLight: string;
  secondary: string;
  accent: string;

  // Backgrounds
  background: string;
  surface: string;
  card: string;
  tabBar: string;

  // Chat
  chatBackground: string;
  myMessage: string;
  theirMessage: string;

  // Text
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textOnPrimary: string;

  // Borders / separators
  border: string;
  borderLight: string;
  separator: string;

  // Icons
  icon: string;
  iconMuted: string;

  // Input
  inputBackground: string;
  inputText: string;
  placeholder: string;

  // Status bar / nav bar
  statusBar: string;
  navBar: string;
  statusBarStyle: 'light-content' | 'dark-content';

  // Status colours (shared)
  success: string;
  error: string;
  warning: string;
  info: string;

  // Message status
  messageRead: string;
  messageSent: string;
  messageDelivered: string;

  // Modal / overlay
  modalOverlay: string;
  modalBackground: string;

  // Misc
  skeleton: string;
  ripple: string;
  headerTint: string;
}

// ─── Brand Gradient ─────────────────────────────────────────────────────────────
export const brandGradient = ['#020912', '#050f1e', '#071524'];
export const brandGradientDark = ['#020912', '#050f1e', '#071524'];

// ─── Light Theme ─────────────────────────────────────────────────────────────────

export const lightTheme: ThemeColors = {
  // Brand accents
  primary:      '#0F62FE',
  primaryDark:  '#020912',
  primaryLight: '#38BDF8',
  secondary:    '#38BDF8',
  accent:       '#071524',

  // Backgrounds
  background:   '#FFFFFF',
  surface:      '#FFFFFF',
  card:         '#FFFFFF',
  tabBar:       '#FFFFFF',

  // Chat
  chatBackground: '#F0F2F5',
  myMessage:      '#243B53',   // Plain Matte Faded Navy Blue
  theirMessage:   '#EAECEF',   // elegant light grayish received bubble

  // Text
  textPrimary:   '#111827',
  textSecondary: '#374151',
  textMuted:     '#4B5563',
  textOnPrimary: '#FFFFFF',

  // Borders
  border:      '#E5E7EB',
  borderLight: '#F3F4F6',
  separator:   '#F3F4F6',

  // Icons
  icon:      '#1F2937',
  iconMuted: '#4B5563',

  // Inputs
  inputBackground: '#F3F4F6',
  inputText:       '#111827',
  placeholder:     '#6B7280',

  // Bars
  statusBar:      '#FFFFFF',
  navBar:         '#00000000',
  statusBarStyle: 'dark-content',

  // Semantic
  success: '#22C55E',
  error:   '#EF4444',
  warning: '#F59E0B',
  info:    '#3B82F6',

  // Message ticks
  messageRead:      '#0F62FE',
  messageSent:      '#9CA3AF',
  messageDelivered: '#9CA3AF',

  // Modal
  modalOverlay:    'rgba(0,0,0,0.45)',
  modalBackground: '#FFFFFF',

  // Misc
  skeleton:  '#E5E7EB',
  ripple:    'rgba(15,98,254,0.1)',
  headerTint: '#111827',
};

// ─── Dark Theme — Midnight Obsidian (#020912 / #050f1e / #071524) ─────────────

export const darkTheme: ThemeColors = {
  // Brand accents
  primary:      '#38BDF8',
  primaryDark:  '#071524',
  primaryLight: '#60A5FA',
  secondary:    '#38BDF8',
  accent:       '#050F1E',

  // Backgrounds — Obsidian Navy Palette
  background:   '#050F1E',
  surface:      '#050F1E',
  card:         '#050F1E',
  tabBar:       '#050F1E',

  // Chat
  chatBackground: '#050F1E',
  myMessage:      '#243B53',   // Plain Matte Faded Navy Blue
  theirMessage:   '#0B1B2D',   // neutral dark received bubble

  // Text
  textPrimary:   '#F1F5F9',
  textSecondary: '#94A3B8',
  textMuted:     '#64748B',
  textOnPrimary: '#FFFFFF',

  // Borders
  border:      '#0E2238',
  borderLight: '#0C1A2B',
  separator:   '#081726',

  // Icons
  icon:      '#94A3B8',
  iconMuted: '#64748B',

  // Inputs
  inputBackground: '#0B1B2D',
  inputText:       '#F1F5F9',
  placeholder:     '#64748B',

  // Bars
  statusBar:      '#020912',
  navBar:         '#00000000',
  statusBarStyle: 'light-content',

  // Semantic
  success: '#22C55E',
  error:   '#FF453A',
  warning: '#FBBF24',
  info:    '#60A5FA',

  // Message ticks
  messageRead:      '#38BDF8',
  messageSent:      '#64748B',
  messageDelivered: '#64748B',

  // Modal
  modalOverlay:    'rgba(0,0,0,0.75)',
  modalBackground: '#050F1E',

  // Misc
  skeleton:  '#0B1B2D',
  ripple:    'rgba(56,189,248,0.15)',
  headerTint: '#F1F5F9',
};

// ─── Legacy exports (backward compatibility) ─────────────────────────────────────
export const colors = {
  primary:      '#0F62FE',
  primaryDark:  '#020912',
  primaryLight: '#38BDF8',
  secondary:    '#38BDF8',
  accent:       '#071524',

  background:     '#FAFAFC',
  backgroundDark: '#020912',
  surface:        '#FFFFFF',
  surfaceDark:    '#050F1E',

  chatBackground:    '#F2F2F7',
  myMessage:         '#0F62FE',
  theirMessage:      '#F2F2F7',
  myMessageDark:     '#0B3C68',
  theirMessageDark:  '#0B1B2D',

  textPrimary:   '#111827',
  textSecondary: '#6B7280',
  textLight:     '#FFFFFF',
  textDark:      '#111827',

  success: '#22C55E',
  error:   '#EF4444',
  warning: '#F59E0B',
  info:    '#3B82F6',

  border:     '#E5E7EB',
  borderDark: '#0E2238',

  icon:      '#6B7280',
  iconLight: '#94A3B8',

  messageRead:      '#0F62FE',
  messageSent:      '#9CA3AF',
  messageDelivered: '#9CA3AF',
};

export const spacing = {
  xs:  4,
  sm:  8,
  md:  12,
  lg:  16,
  xl:  20,
  xxl: 24,
};

export const borderRadius = {
  sm:   4,
  md:   8,
  lg:   12,
  xl:   16,
  xxl:  24,
  full: 9999,
};

export const fontSize = {
  xs:   10,
  sm:   12,
  md:   14,
  lg:   16,
  xl:   18,
  xxl:  20,
  xxxl: 24,
};

export const shadows = {
  small: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  medium: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  large: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
};
