import AsyncStorage from '@react-native-async-storage/async-storage';

import { getMe, setAgentOnline } from './api';

/*
 * The delivery screens read the online switch from local storage
 * (`medbuy_delivery_online`). The CureBuddy server is now the source of
 * truth: these helpers keep the server and that local flag in step, so the
 * screens that only read the flag stay correct.
 */

export const ONLINE_KEY = 'medbuy_delivery_online';

/**
 * Ask the server whether this agent is online and mirror it locally.
 * Returns null when the server cannot be reached (keep the stored value).
 */
export async function syncAgentOnlineFromServer(): Promise<boolean | null> {
  try {
    const me = await getMe();

    if (!me.agent) {
      return null;
    }

    await AsyncStorage.setItem(ONLINE_KEY, String(me.agent.is_online));

    return me.agent.is_online;
  } catch {
    return null;
  }
}

/** Tell the server first; only remember the new value locally if it accepted it. */
export async function pushAgentOnline(next: boolean): Promise<void> {
  await setAgentOnline(next);

  await AsyncStorage.setItem(ONLINE_KEY, String(next));
}
