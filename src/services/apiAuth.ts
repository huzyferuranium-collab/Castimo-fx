import { auth } from '../config/firebase';

/**
 * Sign-in header for calls to the trade API. Only real Firebase sign-ins have a token;
 * demo and quick-start sessions return nothing, so the server rejects them.
 */
export async function authHeaders(): Promise<Record<string, string>> {
  try {
    const user = auth.currentUser;
    if (!user) return {};
    const token = await user.getIdToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}
