import { BackendStatus } from "./backend-status";

export default function Home() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">FountainRank</h1>
      <BackendStatus />
    </main>
  );
}
