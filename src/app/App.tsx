import { useEffect, useState, type ComponentType } from "react";
import { AppLayout } from "@/layouts/AppLayout";
import { ProjectProvider } from "@/features/projects/ProjectContext";
import { useRoute } from "@/hooks/useRoute";
import { getAppInfo } from "@/services/system";
import type { AppInfo, RouteId } from "@/types";
import { HomePage } from "@/pages/HomePage";
import { YouTubePage } from "@/pages/YouTubePage";
import { TikTokPage } from "@/pages/TikTokPage";
import { AnalyticsPage } from "@/pages/AnalyticsPage";
import { EditorPage } from "@/pages/EditorPage";
import { SubtitlesPage } from "@/pages/SubtitlesPage";
import { AdsPage } from "@/pages/AdsPage";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { AccountsWindow, showOnStartup } from "@/features/accounts/AccountsWindow";

export interface PageProps {
  navigate: (id: RouteId) => void;
  appInfo: AppInfo | null;
}

const PAGES: Record<RouteId, ComponentType<PageProps>> = {
  home: HomePage,
  youtube: YouTubePage,
  tiktok: TikTokPage,
  analytics: AnalyticsPage,
  editor: EditorPage,
  subtitles: SubtitlesPage,
  ads: AdsPage,
  projects: ProjectsPage,
  settings: SettingsPage,
};

export function App() {
  const { route, navigate } = useRoute();
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [accountsOpen, setAccountsOpen] = useState(showOnStartup);

  useEffect(() => {
    getAppInfo().then(setAppInfo).catch(() => setAppInfo(null));
  }, []);

  const Page = PAGES[route];
  return (
    <ProjectProvider>
      <AppLayout route={route} appInfo={appInfo} onOpenAccounts={() => setAccountsOpen(true)}>
        <Page key={route} navigate={navigate} appInfo={appInfo} />
      </AppLayout>
      {accountsOpen && <AccountsWindow onClose={() => setAccountsOpen(false)} navigate={navigate} />}
    </ProjectProvider>
  );
}
