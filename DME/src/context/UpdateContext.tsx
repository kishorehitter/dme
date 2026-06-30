import React, { createContext, useContext, useEffect, useState } from 'react';
import { checkForUpdateThrottled, UpdateInfo } from '../services/updateChecker';

const defaultValue: UpdateInfo = { hasUpdate: false };
const UpdateContext = createContext<UpdateInfo>(defaultValue);

export function UpdateProvider({ children }: { children: React.ReactNode }) {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo>(defaultValue);

  useEffect(() => {
    console.log('[UpdateProvider] mounted, starting check...');
    checkForUpdateThrottled().then((result) => {
        console.log('[UpdateCheck] Result:', JSON.stringify(result));
        setUpdateInfo(result);
    });
  }, []);

  return (
    <UpdateContext.Provider value={updateInfo}>
      {children}
    </UpdateContext.Provider>
  );
}

export const useUpdateInfo = () => useContext(UpdateContext);