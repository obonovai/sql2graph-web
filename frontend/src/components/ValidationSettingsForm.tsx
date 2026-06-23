import { SERVER_TYPE_BY_TARGET, useStore } from "../store";
import { Field, NumberInput, Select, TextInput } from "./primitives";

export function ValidationSettingsForm() {
  const target = useStore((s) => s.form.target);
  const validation = useStore((s) => s.form.validation);
  const setValidationMode = useStore((s) => s.setValidationMode);
  const setMaxIterations = useStore((s) => s.setMaxIterations);
  const setServer = useStore((s) => s.setServer);
  const dockerAvailable = useStore((s) => s.options?.docker_available ?? true);

  const serverType = SERVER_TYPE_BY_TARGET[target];
  const s = validation.server;
  const primaryFilled = (serverType === "neo4j" ? s.uri : s.url).trim().length > 0;

  return (
    <div className="space-y-3">
      <Field label="Validation mode">
        <Select value={validation.mode} onChange={(e) => setValidationMode(e.target.value as never)}>
          <option value="none">none — single shot, no checks</option>
          <option value="syntax">syntax — regex sanity checks</option>
          <option value="server">server — validate against a graph DB</option>
        </Select>
      </Field>

      <Field label="Max retries (fix iterations)" hint="generate → validate → fix loop limit">
        <NumberInput
          min={1}
          value={validation.max_iterations}
          onChange={(e) => setMaxIterations(Number(e.target.value))}
        />
      </Field>

      {validation.mode === "server" && (
        <div className="space-y-3 rounded-md border border-slate-200 p-2.5 dark:border-slate-700">
          <p className="text-[11px] leading-tight text-slate-500 dark:text-slate-400">
            Target <b>{target}</b> needs a <b>{serverType}</b> connection. The DB is reached from the{" "}
            <b>backend</b> — "localhost" means the server's localhost.
          </p>

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
                  value={s.notifications_min_severity}
                  onChange={(e) => setServer({ notifications_min_severity: e.target.value as never })}
                >
                  <option value="">(driver default)</option>
                  <option value="OFF">OFF</option>
                  <option value="INFORMATION">INFORMATION</option>
                  <option value="WARNING">WARNING</option>
                </Select>
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
                  ? "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                  : "bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300")
              }
            >
              {dockerAvailable
                ? "Empty config → a throwaway database is auto-provisioned via Docker on the backend (first run takes 10–40s)."
                : "Empty config needs Docker on the backend — none detected. Fill in a connection or pick another mode."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
