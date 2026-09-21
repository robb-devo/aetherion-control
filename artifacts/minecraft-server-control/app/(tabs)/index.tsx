import { isLiquidGlassAvailable } from "expo-glass-effect";
import HomeTab from "@/components/tabs/HomeTab";

export default function IndexRoute() {
  if (!isLiquidGlassAvailable()) return null;
  return <HomeTab />;
}
