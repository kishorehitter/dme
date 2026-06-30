import Config from 'react-native-config';

const PRODUCTION_HOST = 'dme-19zq.onrender.com'; // not a secret → hardcode fine
const PRODUCTION_PORT = '';

const DEVELOPMENT_HOST = Config.DEVELOPMENT_HOST ?? '';
// const DEVELOPMENT_HOST = '10.36.7.51';

const DEVELOPMENT_PORT = Config.DEVELOPMENT_PORT ?? '8000'; // fallback to 8000 if missing

const IS_DEV = __DEV__;

export const BACKEND_HOST = IS_DEV ? DEVELOPMENT_HOST : PRODUCTION_HOST;
export const BACKEND_PORT = IS_DEV ? DEVELOPMENT_PORT : PRODUCTION_PORT;

const PROTOCOL = IS_DEV ? 'http' : 'https';
const WS_PROTOCOL = IS_DEV ? 'ws' : 'wss';

// Helpers: only append :port if port is non-empty
function withPort(host: string, port: string): string {
  return port ? `${host}:${port}` : host;
}

export const API_BASE_URL = IS_DEV
  ? `${PROTOCOL}://${withPort(DEVELOPMENT_HOST, DEVELOPMENT_PORT)}/api`
  : `${PROTOCOL}://${withPort(PRODUCTION_HOST, PRODUCTION_PORT)}/api`;

export const WS_BASE_URL = IS_DEV
  ? `${WS_PROTOCOL}://${withPort(DEVELOPMENT_HOST, DEVELOPMENT_PORT)}/ws`
  : `${WS_PROTOCOL}://${withPort(PRODUCTION_HOST, PRODUCTION_PORT)}/ws`;

export function getWebSocketUrl(endpoint: string, token: string): string {
  return `${WS_BASE_URL}/${endpoint}/?token=${token}`;
}

export function getApiUrl(endpoint: string): string {
  return `${API_BASE_URL}/${endpoint}`;
}

if (__DEV__) {
  console.log('🔧 Network Config:');
  console.log(`   Mode: ${IS_DEV ? 'Development' : 'Production'}`);
  console.log(`   API: ${API_BASE_URL}`);
  console.log(`   WS:  ${WS_BASE_URL}`);

  // Warn if critical .env values are missing
  if (!DEVELOPMENT_HOST) {
    console.warn('⚠️  [network.ts] DEVELOPMENT_HOST is not set in .env — API calls will fail!');
  }
  if (!DEVELOPMENT_PORT) {
    console.warn('⚠️  [network.ts] DEVELOPMENT_PORT is not set in .env — using fallback 8000');
  }
}