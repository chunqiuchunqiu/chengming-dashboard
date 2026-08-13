import type { Metadata } from "next";
import { Dashboard } from "./dashboard";

export const metadata: Metadata = {
  title: "澄明｜个人看板",
  description: "只读、可追溯的个人资产、股票研究与日程看板。",
};

export default function Home() {
  return <Dashboard />;
}
