import { isLiquidGlassAvailable } from "expo-glass-effect";
import ConsoleTab from "@/components/tabs/ConsoleTab";

export default function ConsoleRoute() {
  if (!isLiquidGlassAvailable()) return null;
  return <ConsoleTab />;
}
