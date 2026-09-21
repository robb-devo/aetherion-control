import { isLiquidGlassAvailable } from "expo-glass-effect";
import ServersTab from "@/components/tabs/ServersTab";

export default function ServersRoute() {
  if (!isLiquidGlassAvailable()) return null;
  return <ServersTab />;
}
