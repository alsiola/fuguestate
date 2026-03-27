import { Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { DashboardPage } from "./pages/Dashboard";
import { DreamsPage } from "./pages/Dreams";
import { DreamDetailPage } from "./pages/DreamDetail";
import { SpiritQuestsPage } from "./pages/SpiritQuests";
import { SpiritQuestDetailPage } from "./pages/SpiritQuestDetail";
import { BeliefsPage } from "./pages/Beliefs";
import { EpisodesPage } from "./pages/Episodes";
import { OpenLoopsPage } from "./pages/OpenLoops";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="dreams" element={<DreamsPage />} />
        <Route path="dreams/:id" element={<DreamDetailPage />} />
        <Route path="spirit-quests" element={<SpiritQuestsPage />} />
        <Route path="spirit-quests/:id" element={<SpiritQuestDetailPage />} />
        <Route path="beliefs" element={<BeliefsPage />} />
        <Route path="episodes" element={<EpisodesPage />} />
        <Route path="open-loops" element={<OpenLoopsPage />} />
        <Route path="*" element={<Navigate to="" replace />} />
      </Route>
    </Routes>
  );
}
