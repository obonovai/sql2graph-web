import { Moon, Sun, Workflow } from "lucide-react";
import { useStore } from "@/hooks/useStore";
import { Chip, IconButton } from "@/components/ui/primitives";

// App identity bar: brand + active-model chip + theme toggle.
export function Header() {
  const provider = useStore((s) => s.form.llm.provider);
  const model = useStore((s) => s.form.llm.model);
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);

  return (
    <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center gap-2">
        <Workflow className="h-4 w-4 text-indigo-500" />
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">rows2graph</span>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <Chip tone="indigo" size="md" title="Active model">
          {provider} / {model}
        </Chip>
        <IconButton onClick={toggleTheme} title="Toggle light/dark">
          {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
        </IconButton>
      </div>
    </div>
  );
}
