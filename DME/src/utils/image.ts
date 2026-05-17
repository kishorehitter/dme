import { API_BASE_URL } from '../config/network';

/**
 * Resolves a potentially relative image URL to an absolute URL.
 * Handles:
 * - Already absolute URLs (starting with http/https/data)
 * - Relative URLs (prepending the API_BASE_URL base)
 */
export const resolveImageUrl = (url?: string | null): string | undefined => {
  if (!url) return undefined;

  // If it's already an absolute URL, return as is
  if (url.startsWith('http') || url.startsWith('data:')) {
    return url;
  }

  // Prepend base URL for relative paths
  const BASE_URL = API_BASE_URL.replace('/api', '');
  let resolvedUrl = `${BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
  
  // Fix for double-slashes in protocol (e.g., https:/res.cloudinary.com → https://res.cloudinary.com)
  resolvedUrl = resolvedUrl.replace(/https:\/([^/])/g, 'https://$1');
  
  return resolvedUrl;
};
