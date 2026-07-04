export const checkGoogleDriveAuth = async (): Promise<boolean> => {
  try {
    const res = await fetch('https://drive.google.com/', {
      method: 'GET',
      headers: {
        'Cache-Control': 'no-cache',
      }
    });
    // If the response URL redirects to accounts.google.com, the user is not signed in.
    if (res.url.includes('accounts.google.com') || res.url.includes('ServiceLogin')) {
      return false;
    }
    return true;
  } catch (error) {
    console.error('Error checking Drive auth:', error);
    return false;
  }
};
