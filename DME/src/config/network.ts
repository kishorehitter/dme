/**
 * Network Configuration for the app
 *
 * IMPORTANT: Update this file when your backend IP changes
 *
 * Common scenarios:
 * - Android Emulator: Use '10.0.2.2' (special alias to host loopback)
 * - iOS Simulator: Use 'localhost'
 * - Physical device on same WiFi: Use your PC's IP (e.g., '10.113.164.240')
 * - Production: Use your domain (e.g., 'dme-19zq.onrender.com')
 */

// ═══════════════════════════════════════════════════════════
// BACKEND SERVER CONFIGURATION
// ═══════════════════════════════════════════════════════════

// Production (your Render backend)
const PRODUCTION_HOST = 'dme-19zq.onrender.com';
const PRODUCTION_PORT = ''; // HTTPS default port 443 – leave empty

// Development (local machine)
const DEVELOPMENT_HOST = '172.22.134.180';
const DEVELOPMENT_PORT = '8000';

// Auto‑switch based on environment
// __DEV__ is true only in development mode (Metro bundler)
// It is false in release/production builds
const IS_DEV = __DEV__;

export const BACKEND_HOST = IS_DEV ? DEVELOPMENT_HOST : PRODUCTION_HOST;
export const BACKEND_PORT = IS_DEV ? DEVELOPMENT_PORT : PRODUCTION_PORT;

// Use HTTP/WS for development, HTTPS/WSS for production
const PROTOCOL = IS_DEV ? 'http' : 'https';
const WS_PROTOCOL = IS_DEV ? 'ws' : 'wss';

export const API_BASE_URL = IS_DEV
  ? `${PROTOCOL}://${BACKEND_HOST}:${BACKEND_PORT}/api`
  : `${PROTOCOL}://${BACKEND_HOST}/api`;

export const WS_BASE_URL = IS_DEV
  ? `${WS_PROTOCOL}://${BACKEND_HOST}:${BACKEND_PORT}/ws`
  : `${WS_PROTOCOL}://${BACKEND_HOST}/ws`;

// ═══════════════════════════════════════════════════════════
// Helper functions
// ═══════════════════════════════════════════════════════════

/**
 * Get the full WebSocket URL for a specific endpoint
 * @param {string} endpoint - WebSocket endpoint (e.g., 'chat/123', 'call')
 * @param {string} token - JWT token for authentication
 * @returns {string} Complete WebSocket URL
 */
export function getWebSocketUrl(endpoint: string, token: string): string {
  return `${WS_BASE_URL}/${endpoint}/?token=${token}`;
}

/**
 * Get the full API URL for a specific endpoint
 * @param {string} endpoint - API endpoint (e.g., 'calls/initiate')
 * @returns {string} Complete API URL
 */
export function getApiUrl(endpoint: string): string {
  return `${API_BASE_URL}/${endpoint}`;
}

// Log current configuration (useful for debugging)
if (__DEV__) {
  console.log('🔧 Network Config:');
  console.log(`   Mode: ${IS_DEV ? 'Development' : 'Production'}`);
  console.log(`   API: ${API_BASE_URL}`);
  console.log(`   WS:  ${WS_BASE_URL}`);
}
