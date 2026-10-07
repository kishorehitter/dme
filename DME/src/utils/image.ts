import { API_BASE_URL } from '../config/network';

const CLOUDINARY_CLOUD_NAME = 'dnvxglswf';

/**
 * Resolves a potentially relative image URL to an absolute URL.
 * Handles:
 * - Already absolute URLs (starting with http/https/data/file/content)
 * - Cloudinary storage paths (e.g., 'v178.../local/chat_media/...')
 * - Relative backend paths (prepending the API_BASE_URL base)
 */
export const resolveImageUrl = (url?: string | null): string | undefined => {
  if (!url) return undefined;

  // If it's already an absolute URL or local URI, return as is
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:') || url.startsWith('file://') || url.startsWith('content://')) {
    return url.replace(/https:\/([^/])/g, 'https://$1').replace(/http:\/([^/])/g, 'http://$1');
  }

  // Cloudinary relative storage paths (e.g. 'v12345/local/chat_media/...')
  if (url.startsWith('v') && url.includes('/')) {
    const isRaw = url.endsWith('.enc') || url.endsWith('.pdf') || url.endsWith('.doc') || url.endsWith('.docx') || url.endsWith('.zip');
    const resourceType = isRaw ? 'raw' : 'image';
    return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/${resourceType}/upload/${url.replace(/^\//, '')}`;
  }

  if (url.includes('chat_media/') || url.includes('chat_thumbnails/') || url.includes('local/')) {
    const isRaw = url.endsWith('.enc') || url.endsWith('.pdf') || url.endsWith('.doc') || url.endsWith('.docx') || url.endsWith('.zip');
    const resourceType = isRaw ? 'raw' : 'image';
    return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/${resourceType}/upload/${url.replace(/^\//, '')}`;
  }

  // Prepend base URL for backend relative paths
  const BASE_URL = API_BASE_URL.replace('/api', '');
  let resolvedUrl = `${BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
  
  resolvedUrl = resolvedUrl.replace(/https:\/([^/])/g, 'https://$1').replace(/http:\/([^/])/g, 'http://$1');
  
  return resolvedUrl;
};
