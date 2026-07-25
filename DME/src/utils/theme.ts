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
// Use anywhere a gradient is needed: ['#6A00F4', '#8F00FF', '#B026FF']

// ─── Light Theme ─────────────────────────────────────────────────────────────────

export const lightTheme: ThemeColors = {
  // Violet brand
  primary:      '#8F00FF',
  primaryDark:  '#7B00E6',
  primaryLight: '#B026FF',
  secondary:    '#B026FF',
  accent:       '#D580FF',

  // Backgrounds — clean off-white, not pure white
  background:   '#FAFAFC',
  surface:      '#FFFFFF',
  card:         '#FFFFFF',
  tabBar:       '#FFFFFF',

  // Chat
  chatBackground: '#F2F2F7',
  myMessage:      '#8F00FF',   // violet sent bubble
  theirMessage:   '#F2F2F7',   // neutral received bubble

  // Text
  textPrimary:   '#111827',
  textSecondary: '#6B7280',
  textMuted:     '#9CA3AF',
  textOnPrimary: '#FFFFFF',    // white text on violet bubbles

  // Borders
  border:      '#E5E7EB',
  borderLight: '#F3F4F6',
  separator:   '#F3F4F6',

  // Icons
  icon:      '#6B7280',
  iconMuted: '#9CA3AF',

  // Inputs
  inputBackground: '#F3F4F6',
  inputText:       '#111827',
  placeholder:     '#9CA3AF',

  // Bars
  statusBar:      '#FAFAFC',
  navBar:         '#00000000',
  statusBarStyle: 'dark-content',

  // Semantic
  success: '#22C55E',
  error:   '#EF4444',
  warning: '#F59E0B',
  info:    '#3B82F6',

  // Message ticks
  messageRead:      '#8F00FF',
  messageSent:      '#9CA3AF',
  messageDelivered: '#9CA3AF',

  // Modal
  modalOverlay:    'rgba(0,0,0,0.45)',
  modalBackground: '#FFFFFF',

  // Misc
  skeleton:  '#E5E7EB',
  ripple:    'rgba(143,0,255,0.1)',
  headerTint: '#111827',
};

// ─── Dark Theme — deep dark with violet identity ──────────────────────────────────

export const darkTheme: ThemeColors = {
  // Violet brand (slightly lighter for dark bg contrast)
  primary:      '#A940FF',
  primaryDark:  '#8F00FF',
  primaryLight: '#C26EFF',
  secondary:    '#C26EFF',
  accent:       '#D580FF',

  // Backgrounds — deep dark, not pitch black
  background:   '#0D0D14',
  surface:      '#181824',
  card:         '#181824',
  tabBar:       '#181824',

  // Chat
  chatBackground: '#0D0D14',
  myMessage:      '#8F00FF',   // violet sent bubble (same brand)
  theirMessage:   '#262636',   // dark neutral received bubble

  // Text
  textPrimary:   '#F5F5F5',
  textSecondary: '#A0A0B0',
  textMuted:     '#6B6B80',
  textOnPrimary: '#FFFFFF',

  // Borders
  border:      '#2A2A3D',
  borderLight: '#222232',
  separator:   '#1E1E2E',

  // Icons
  icon:      '#A0A0B0',
  iconMuted: '#6B6B80',

  // Inputs
  inputBackground: '#1E1E2E',
  inputText:       '#F5F5F5',
  placeholder:     '#6B6B80',

  // Bars
  statusBar:      '#0D0D14',
  navBar:         '#00000000',
  statusBarStyle: 'light-content',

  // Semantic
  success: '#22C55E',
  error:   '#FF453A',
  warning: '#FBBF24',
  info:    '#60A5FA',

  // Message ticks
  messageRead:      '#A940FF',
  messageSent:      '#6B6B80',
  messageDelivered: '#6B6B80',

  // Modal
  modalOverlay:    'rgba(0,0,0,0.75)',
  modalBackground: '#1E1E2E',

  // Misc
  skeleton:  '#1E1E2E',
  ripple:    'rgba(169,64,255,0.15)',
  headerTint: '#F5F5F5',
};

// ─── Legacy exports (backward compatibility) ─────────────────────────────────────
// Still used by files not yet on useTheme(). Mirrors the light theme values.

export const colors = {
  primary:      '#8F00FF',
  primaryDark:  '#7B00E6',
  primaryLight: '#B026FF',
  secondary:    '#B026FF',
  accent:       '#D580FF',

  background:     '#FAFAFC',
  backgroundDark: '#0D0D14',
  surface:        '#FFFFFF',
  surfaceDark:    '#181824',

  chatBackground:    '#F2F2F7',
  myMessage:         '#8F00FF',
  theirMessage:      '#F2F2F7',
  myMessageDark:     '#8F00FF',
  theirMessageDark:  '#262636',

  textPrimary:   '#111827',
  textSecondary: '#6B7280',
  textLight:     '#FFFFFF',
  textDark:      '#111827',

  success: '#22C55E',
  error:   '#EF4444',
  warning: '#F59E0B',
  info:    '#3B82F6',

  border:     '#E5E7EB',
  borderDark: '#2A2A3D',

  icon:      '#6B7280',
  iconLight: '#A0A0B0',

  messageRead:      '#8F00FF',
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
  xxl:  24,   // cards & bubbles — Material 3 style
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

// Violet brand gradient — use in LinearGradient components
export const brandGradient = ['#6A00F4', '#8F00FF', '#B026FF'];
export const brandGradientDark = ['#7B00E6', '#A940FF', '#C26EFF'];

export const shadows = {
  small: {
    shadowColor: '#8F00FF',
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
