import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/utils";

interface EgoData {
  name: string;
  personality: string[];
  catchphrase: string;
  born: string;
  mood: string;
}

const moodEmoji: Record<string, string> = {
  "tormented": "😵‍💫",
  "wrestling with demons": "👹",
  "troubled but resolving": "😤",
  "illuminated": "🌟",
  "dormant": "😴",
  "quietly processing": "🧘",
};

export function AgentEgo() {
  const { data } = useQuery({
    queryKey: ["ego"],
    queryFn: () => apiFetch<EgoData>("/api/ego"),
    refetchInterval: 30_000,
  });

  if (!data) return null;

  const emoji = moodEmoji[data.mood] ?? "🤔";

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-lg">{emoji}</span>
        <span className="font-semibold text-sm text-foreground">{data.name}</span>
      </div>
      <p className="text-[10px] text-muted-foreground italic leading-tight">
        "{data.catchphrase}"
      </p>
      <div className="flex flex-wrap gap-1">
        {data.personality.map((trait) => (
          <span key={trait} className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
            {trait}
          </span>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground">
        mood: <span className="text-foreground/70">{data.mood}</span>
      </p>
    </div>
  );
}
