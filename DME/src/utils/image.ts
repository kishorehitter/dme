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
  return `${BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
};
