import { createContext } from "react";
export const PageNavigationContext = createContext<{
  role: string;
  permissions: string[];
  navigationScope?: string;
} | null>(null);
