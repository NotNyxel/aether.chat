/** The signed-in user's id, available anywhere inside MainLayout without prop drilling. */
import { createContext, useContext } from 'react';

export const MeContext = createContext<string>('');

export function useMeId(): string {
  return useContext(MeContext);
}
