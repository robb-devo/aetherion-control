import { isLiquidGlassAvailable } from "expo-glass-effect";
import ToolsTab from "@/components/tabs/ToolsTab";

export default function ToolsRoute() {
  if (!isLiquidGlassAvailable()) return null;
  return <ToolsTab />;
}
