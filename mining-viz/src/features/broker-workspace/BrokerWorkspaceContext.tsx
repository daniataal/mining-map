import { createContext, useContext, type ReactNode } from 'react';
import { useBrokerWorkspace } from '../../hooks/use-broker-workspace';

type BrokerWorkspaceContextValue = ReturnType<typeof useBrokerWorkspace>;

const BrokerWorkspaceContext = createContext<BrokerWorkspaceContextValue | null>(null);

export function BrokerWorkspaceProvider({ children }: { children: ReactNode }) {
  const value = useBrokerWorkspace();
  return (
    <BrokerWorkspaceContext.Provider value={value}>{children}</BrokerWorkspaceContext.Provider>
  );
}

export function useBrokerWorkspaceContext(): BrokerWorkspaceContextValue {
  const ctx = useContext(BrokerWorkspaceContext);
  if (!ctx) {
    throw new Error('useBrokerWorkspaceContext must be used within BrokerWorkspaceProvider');
  }
  return ctx;
}
