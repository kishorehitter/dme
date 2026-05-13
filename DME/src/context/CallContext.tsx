import React, { createContext, useContext, useState, useRef, useEffect } from 'react';
import { DeviceEventEmitter } from 'react-native';

interface CallState {
  isActive: boolean;
  isMinimized: boolean;
  callParams: any;
  duration: number;
  liveKitConfig: { token: string; serverUrl: string } | null;
  isTimerRunning: boolean;
}

interface CallContextType {
  callState: CallState;
  minimizeCall: () => void;
  maximizeCall: () => void;
  startCall: (params: any, config?: { token: string; serverUrl: string }) => void;
  setLiveKitConfig: (config: { token: string; serverUrl: string } | null) => void;
  endCall: () => void;
  updateDuration: (duration: number) => void;
  updateCallParams: (params: any) => void;
  startTimer: () => void;
  stopTimer: () => void;
}

const CallContext = createContext<CallContextType | undefined>(undefined);

export const CallProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [callState, setCallState] = useState<CallState>({
    isActive: false,
    isMinimized: false,
    callParams: null,
    duration: 0,
    liveKitConfig: null,
    isTimerRunning: false,
  });

  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (callState.isActive && callState.isTimerRunning) {
      if (!timerRef.current) {
        timerRef.current = setInterval(() => {
          setCallState(prev => ({ ...prev, duration: prev.duration + 1 }));
        }, 1000);
      }
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }

    return () => {
      if (timerRef.current && (!callState.isActive || !callState.isTimerRunning)) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [callState.isActive, callState.isTimerRunning]);

  const minimizeCall = () => {
    setCallState(prev => ({ ...prev, isMinimized: true }));
  };

  const maximizeCall = () => {
    setCallState(prev => ({ ...prev, isMinimized: false }));
  };

  const startCall = (params: any, config: { token: string; serverUrl: string } | null = null) => {
    setCallState({
      isActive: true,
      isMinimized: false,
      callParams: params,
      duration: 0,
      liveKitConfig: config,
      isTimerRunning: false,
    });
  };

  const setLiveKitConfig = (config: { token: string; serverUrl: string } | null) => {
    setCallState(prev => ({ ...prev, liveKitConfig: config }));
  };

  const endCall = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setCallState({
      isActive: false,
      isMinimized: false,
      callParams: null,
      duration: 0,
      liveKitConfig: null,
      isTimerRunning: false,
    });
    DeviceEventEmitter.emit('call_ended_globally');
  };

  const updateDuration = (duration: number) => {
    setCallState(prev => ({ ...prev, duration }));
  };

  const updateCallParams = (params: any) => {
    setCallState(prev => ({ ...prev, callParams: params }));
  };

  const startTimer = () => {
    setCallState(prev => ({ ...prev, isTimerRunning: true }));
  };

  const stopTimer = () => {
    setCallState(prev => ({ ...prev, isTimerRunning: false }));
  };

  return (
    <CallContext.Provider
      value={{
        callState,
        minimizeCall,
        maximizeCall,
        startCall,
        setLiveKitConfig,
        endCall,
        updateDuration,
        updateCallParams,
        startTimer,
        stopTimer,
      }}
    >
      {children}
    </CallContext.Provider>
  );
};

export const useCall = () => {
  const context = useContext(CallContext);
  if (!context) {
    throw new Error('useCall must be used within a CallProvider');
  }
  return context;
};
