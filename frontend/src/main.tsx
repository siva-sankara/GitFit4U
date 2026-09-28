import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { PwaStatus } from "./components/PwaSettings";
import { startPwaLifecycle } from "./services/pwa";
import { AppProvider } from "./context/AppContext";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./styles/global.css";
import "./styles/layouts.css";
import "./styles/pages.css";
import "./styles/product-polish.css";
import "./styles/dialog.css";
import "./styles/workspace-navigation.css";
import "./styles/enhancement-layout.css";

startPwaLifecycle();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: 0 },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppProvider>
        <App />
        <PwaStatus />
      </AppProvider>
    </QueryClientProvider>
  </StrictMode>,
);
