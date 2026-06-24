import { SERVER_TYPE_BY_TARGET, useStore } from "../store";
import { Field, Select, TextInput } from "./primitives";

// The validation MODE and iteration budget now live in the RunSetupBar (always
// visible). This sidebar section holds only the connection details, which matter
// solely for `server` mode; otherwise it explains where the mode toggle lives.
export function ValidationSettingsForm() {
  const target = useStore((s) => s.form.target);
  const mode = useStore((s) => s.form.validation.mode);
  const s = useStore((s) => s.form.validation.server);
  const setServer = useStore((s) => s.setServer);
  const dockerAvailable = useStore((s) => s.options?.docker_available ?? true);

  if (mode !== "server") {
    return (
      <p className="text-xs leading-relaxed text-slate-400 dark:text-slate-500">
        Connection settings appear here when <span className="font-medium">Validation</span> is set to{" "}
        <span className="font-medium">server</span> in the run bar above.
      </p>
    );
  }

  const serverType = SERVER_TYPE_BY_TARGET[target];
  const primaryFilled = (serverType === "neo4j" ? s.uri : s.url).trim().length > 0;

  return (
    <div className="space-y-3">
      {serverType === "neo4j" && (
        <>
          <Field label="URI">
            <TextInput placeholder="bolt://localhost:7687" value={s.uri} onChange={(e) => setServer({ uri: e.target.value })} spellCheck={false} />
          </Field>
          <Field label="Username">
            <TextInput placeholder="neo4j" value={s.username} onChange={(e) => setServer({ username: e.target.value })} spellCheck={false} />
          </Field>
          <Field label="Password">
            <TextInput type="password" value={s.password} onChange={(e) => setServer({ password: e.target.value })} />
          </Field>
          <Field label="Database">
            <TextInput placeholder="neo4j" value={s.database} onChange={(e) => setServer({ database: e.target.value })} spellCheck={false} />
          </Field>
          <Field label="Notifications min severity">
            <Select
              value={s.notifications_min_severity || "default"}
              onChange={(v) =>
                setServer({
                  notifications_min_severity: v === "default" ? "" : (v as "OFF" | "INFORMATION" | "WARNING"),
                })
              }
              options={[
                { value: "default", label: "(driver default)" },
                { value: "OFF", label: "OFF" },
                { value: "INFORMATION", label: "INFORMATION" },
                { value: "WARNING", label: "WARNING" },
              ]}
            />
          </Field>
        </>
      )}

      {serverType === "arangodb" && (
        <>
          <Field label="URL">
            <TextInput placeholder="http://localhost:8529" value={s.url} onChange={(e) => setServer({ url: e.target.value })} spellCheck={false} />
          </Field>
          <Field label="Username">
            <TextInput placeholder="root" value={s.username} onChange={(e) => setServer({ username: e.target.value })} spellCheck={false} />
          </Field>
          <Field label="Password">
            <TextInput type="password" value={s.password} onChange={(e) => setServer({ password: e.target.value })} />
          </Field>
          <Field label="Database">
            <TextInput placeholder="_system" value={s.database} onChange={(e) => setServer({ database: e.target.value })} spellCheck={false} />
          </Field>
        </>
      )}

      {serverType === "gremlin" && (
        <>
          <Field label="URL">
            <TextInput placeholder="ws://localhost:8182/gremlin" value={s.url} onChange={(e) => setServer({ url: e.target.value })} spellCheck={false} />
          </Field>
          <Field label="Traversal source">
            <TextInput placeholder="g" value={s.traversal_source} onChange={(e) => setServer({ traversal_source: e.target.value })} spellCheck={false} />
          </Field>
          <Field label="Username (optional)">
            <TextInput value={s.username} onChange={(e) => setServer({ username: e.target.value })} spellCheck={false} />
          </Field>
          <Field label="Password (optional)">
            <TextInput type="password" value={s.password} onChange={(e) => setServer({ password: e.target.value })} />
          </Field>
        </>
      )}

      {!primaryFilled && (
        <p
          className={
            "rounded-md px-2 py-1.5 text-[11px] " +
            (dockerAvailable
              ? "bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300"
              : "bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300")
          }
        >
          {dockerAvailable
            ? "Empty config → a throwaway database is auto-provisioned via Docker on the backend (first run takes 10–40s)."
            : "Empty config needs Docker on the backend — none detected. Fill in a connection or pick another mode."}
        </p>
      )}
    </div>
  );
}
