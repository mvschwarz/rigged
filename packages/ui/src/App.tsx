import { RigGraph } from "./components/RigGraph.js";

export function App() {
  // Phase 1: no rig selector yet — pass null for "no rig selected" state
  return <RigGraph rigId={null} />;
}
